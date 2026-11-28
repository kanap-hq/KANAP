import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, Optional } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AiSecretCipherService } from '../ai/ai-secret-cipher.service';
import { Features } from '../config/features';
import { INSTALLATION_DOMAINS, installationDomain } from './installation-domains';
import {
  domainState,
  InstallationDomain,
  InstallationSettingDeclaration,
  InstallationSettingValue,
  InstallationSettingWriteError,
  ResolvedDomain,
  resolveDomain,
  validateWrite,
} from './installation-settings';
import { installationSettingsSnapshot, InstallationSettingsSnapshot } from './installation-settings.snapshot';

export const INSTALLATION_SETTINGS_REFRESH_MS = 30_000;
/** Another snapshot than this process's one (a spec standing for a second process). */
export const INSTALLATION_SETTINGS_SNAPSHOT = Symbol('INSTALLATION_SETTINGS_SNAPSHOT');

export type InstallationSettingsState = {
  /** Whether a secret can be stored (the encryption key is set). */
  encryption_available: boolean;
  settings: ReturnType<typeof domainState>;
};

/**
 * The installation settings (installation-settings.ts): loads each domain's row into the
 * process's snapshot before the API listens, refreshes it every 30 seconds, and serves the AI page
 * of the installation (`admin/installation/<domain>`). Writes go through the request's transaction
 * with their audit entry; a refresh or the start writes nothing. The snapshot only reads outside
 * any transaction, so it holds committed rows only: the state of a page is resolved from the
 * request's transaction without touching it, and the controller refreshes it once the response of
 * a write is sent.
 */
@Injectable()
export class InstallationSettingsService implements OnModuleDestroy {
  private readonly logger = new Logger(InstallationSettingsService.name);
  private readonly snapshot: InstallationSettingsSnapshot;
  private timer: NodeJS.Timeout | null = null;
  private readonly unreadableSecrets = new Set<string>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly cipher: AiSecretCipherService,
    @Optional() @Inject(INSTALLATION_SETTINGS_SNAPSHOT) snapshot?: InstallationSettingsSnapshot,
  ) {
    this.snapshot = snapshot ?? installationSettingsSnapshot;
  }

  /**
   * Before the API listens (main.ts): the first load, the file values that cannot be read (one
   * warning each, when `warn`), then a refresh every 30 seconds. A failed load leaves the
   * database empty for this process (the file, then the default), with a warning.
   */
  async start(options: { warn: boolean }): Promise<void> {
    await this.refresh().catch((error) => {
      this.logger.warn(`Installation settings could not be read, the configuration file and the defaults apply: ${messageOf(error)}`);
    });
    if (options.warn) {
      for (const warning of this.fileWarnings()) this.logger.warn(warning);
    }
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.refresh().catch((error) => this.logger.warn(`Installation settings refresh failed: ${messageOf(error)}`));
    }, INSTALLATION_SETTINGS_REFRESH_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  onModuleDestroy(): void {
    this.stop();
  }

  /** One line per variable the file sets to a value that cannot be read (never the value). */
  fileWarnings(): string[] {
    const lines: string[] = [];
    for (const domain of INSTALLATION_DOMAINS) {
      for (const setting of this.snapshot.resolve(domain).values()) {
        if (!setting.fileUnreadable) continue;
        lines.push(
          `[CONFIG] ${setting.declaration.env} cannot be read (${expected(setting.declaration)}): it is ignored, `
          + 'the value set on the screen or the default applies.',
        );
      }
    }
    return lines;
  }

  /**
   * Reads every domain's committed row into the snapshot and updates the switches of `Features`.
   * A refresh that ends after one begun later keeps nothing (installation-settings.snapshot.ts).
   */
  async refresh(): Promise<void> {
    const read = this.snapshot.beginRead();
    for (const domain of INSTALLATION_DOMAINS) {
      const row = await this.readRow(domain, this.dataSource.manager);
      if (this.snapshot.setRow(domain.name, row ? this.decryptRow(domain, row).values : null, read)) {
        this.snapshot.applyFeatures(domain, Features as unknown as Record<string, unknown>);
      }
    }
  }

  /** A domain's row read in the given transaction and resolved there: the snapshot does not move. */
  private async resolveIn(domain: InstallationDomain, manager: EntityManager): Promise<{ row: Record<string, unknown> | null; resolved: ResolvedDomain }> {
    const row = await this.readRow(domain, manager);
    const stored = row ? this.decryptRow(domain, row) : null;
    return { row, resolved: resolveDomain(domain, stored?.values ?? null, process.env, stored?.unreadable) };
  }

  private async readRow(domain: InstallationDomain, manager: EntityManager): Promise<Record<string, unknown> | null> {
    const columns = ['id', ...domain.settings.map((setting) => setting.column)];
    const [row] = await manager.query(`SELECT ${columns.join(', ')} FROM ${domain.table} WHERE singleton = true`);
    return row ?? null;
  }

  /**
   * The row by setting key, a secret decrypted; one that cannot be decrypted counts as absent,
   * with a warning, and its key is in `unreadable`.
   */
  private decryptRow(domain: InstallationDomain, row: Record<string, unknown>): { values: Record<string, unknown>; unreadable: Set<string> } {
    const values: Record<string, unknown> = {};
    const unreadable = new Set<string>();
    for (const setting of domain.settings) {
      const stored = row[setting.column];
      if (setting.type !== 'secret' || stored == null) {
        values[setting.key] = stored ?? null;
        continue;
      }
      try {
        values[setting.key] = this.cipher.decrypt(String(stored));
        this.unreadableSecrets.delete(setting.column);
      } catch {
        values[setting.key] = null;
        unreadable.add(setting.key);
        if (!this.unreadableSecrets.has(setting.column)) {
          this.unreadableSecrets.add(setting.column);
          this.logger.warn(`[SECRETS] ${domain.table}.${setting.column} cannot be decrypted (the encryption key is missing or is another one): it is ignored.`);
        }
      }
    }
    return { values, unreadable };
  }

  private domainOf(name: string): InstallationDomain {
    const domain = installationDomain(name);
    if (!domain) throw new NotFoundException('Unknown installation settings page.');
    return domain;
  }

  private stateOf(resolved: ResolvedDomain): InstallationSettingsState {
    return { encryption_available: this.cipher.canEncrypt(), settings: domainState(resolved) };
  }

  /** The state of a domain, read from the database in the request's transaction. */
  async getState(name: string, manager: EntityManager): Promise<InstallationSettingsState> {
    const domain = this.domainOf(name);
    return this.stateOf((await this.resolveIn(domain, manager)).resolved);
  }

  /**
   * Sets the given settings (null clears one), in the request's transaction, under a lock that
   * serialises the writes of the installation; one audit entry with the changed settings only (a
   * secret as a boolean). A write that changes nothing writes nothing. Returns the state read in
   * the transaction; the snapshot waits for the commit (the controller refreshes it).
   */
  async update(
    name: string,
    body: unknown,
    context: { manager: EntityManager; userId: string | null },
  ): Promise<InstallationSettingsState> {
    const domain = this.domainOf(name);
    const { manager, userId } = context;
    await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [domain.table]);
    const { row: existing, resolved } = await this.resolveIn(domain, manager);
    let values: Map<string, InstallationSettingValue | null>;
    try {
      values = validateWrite(domain, body, resolved, { canEncrypt: this.cipher.canEncrypt() });
    } catch (error) {
      if (error instanceof InstallationSettingWriteError) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          code: error.code,
          setting: error.setting,
          message: error.message,
          ...error.details,
        });
      }
      throw error;
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const writes: Array<{ declaration: InstallationSettingDeclaration; stored: unknown }> = [];
    for (const declaration of domain.settings) {
      if (!values.has(declaration.key)) continue;
      const next = values.get(declaration.key) ?? null;
      const current = existing?.[declaration.column] ?? null;
      if (declaration.type === 'secret') {
        // A new key always counts as a change (the stored one is not compared); clearing an absent one does not.
        if (next === null && current === null) continue;
        before[declaration.auditKey] = current !== null;
        after[declaration.auditKey] = next !== null;
        writes.push({ declaration, stored: next === null ? null : this.cipher.encrypt(String(next)) });
        continue;
      }
      if (next === current) continue;
      before[declaration.key] = current;
      after[declaration.key] = next;
      writes.push({ declaration, stored: next });
    }
    if (writes.length === 0) return this.stateOf(resolved);

    const columns = writes.map((write) => write.declaration.column);
    const [saved] = await manager.query(
      `
        INSERT INTO ${domain.table} (singleton, ${columns.join(', ')}, updated_at)
        VALUES (true, ${columns.map((_, index) => `$${index + 1}`).join(', ')}, now())
        ON CONFLICT (singleton) DO UPDATE SET
          ${columns.map((column) => `${column} = EXCLUDED.${column}`).join(', ')},
          updated_at = now()
        RETURNING id
      `,
      writes.map((write) => write.stored),
    );

    await this.audit.log(
      // The table of the domain (installation_ai_settings, ...): each has its label in the audit log
      // (frontend/src/lib/audit/__fixtures__/audit-tables.json).
      { table: domain.table, recordId: saved.id, action: existing ? 'update' : 'create', before: existing ? before : null, after, userId },
      { manager },
    );
    return this.stateOf((await this.resolveIn(domain, manager)).resolved);
  }
}

function expected(declaration: InstallationSettingDeclaration): string {
  return declaration.type === 'integer' ? 'a positive whole number is expected' : 'a value is expected';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
