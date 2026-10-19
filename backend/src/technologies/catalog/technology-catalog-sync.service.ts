import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ScheduledTasksService } from '../../admin/scheduled-tasks/scheduled-tasks.service';
import { AuditService } from '../../audit/audit.service';
import { withTenant } from '../../common/tenant-runner';
import { Features } from '../../config/features';
import {
  endoflifeSlug,
  valuesOf,
  versionsOfReleases,
  type CatalogState,
  type CatalogVersionValues,
} from './catalog-releases';
import { TENANT_LANGUAGE_METADATA_KEY, tenantSeedLanguage } from '../../analytics/recommended-dimensions.seed';
import { TechnologyCpeEvents } from '../technology-cpe-events';
import { TechnologyCatalogService, type CatalogLanguage, type CatalogProduct } from './technology-catalog.service';

export const CATALOG_SYNC_TASK_NAME = 'technology-catalog';
export const ENDOFLIFE_DEFAULT_BASE_URL = 'https://endoflife.date/api/v1';
/** A product read successfully less than this long ago is not read again (a restart, a manual run). */
const FRESH_MS = 20 * 60 * 60 * 1000;
/** endoflife.date publishes no rate: one request a second stays polite (about 90 products at most). */
const SPACING_MS = 1000;
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;
/** An answer of endoflife.date over this size is refused (a product page weighs a few dozen KB). */
export const MAX_ANSWER_BYTES = 1024 * 1024;

export type CatalogRuntime = {
  baseUrl: string;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  spacingMs: number;
  retryDelayMs: number;
};

export type CatalogSyncSummary = {
  refresh_enabled: boolean;
  products: number;
  requests: number;
  refreshed: number;
  failed_products: string[];
  /** Release cycles left out because endoflife.date gave something unusable (logged). */
  rejected_releases: number;
  errors: string[];
  tenants_synced: number;
  technologies_updated: number;
  versions_added: number;
  versions_updated: number;
  versions_attached: number;
  cpe_added: number;
  /** Versions where a catalog date was not applied because it would contradict the other one (logged). */
  dates_kept: string[];
  /** Technologies whose unreadable `catalog_state` was rebuilt (logged). */
  malformed_states: number;
};

export type TenantSyncResult = {
  technologies: number;
  versions_added: number;
  versions_updated: number;
  cpe_added: number;
  /** Versions typed with a catalog label before the catalog had them, now attached to it. */
  versions_attached: number;
  /** One line per technology whose sync failed: its changes are undone, the others are kept. */
  errors: string[];
  /** Versions where a catalog date was not applied because it would contradict the other one. */
  dates_kept: string[];
  /** Technologies whose `catalog_state` was unreadable and was rebuilt. */
  malformed_states: string[];
};

const emptyResult = (): TenantSyncResult => ({
  technologies: 0, versions_added: 0, versions_updated: 0, cpe_added: 0, versions_attached: 0, errors: [], dates_kept: [], malformed_states: [],
});

function addResult(total: TenantSyncResult, one: TenantSyncResult) {
  total.technologies += one.technologies;
  total.versions_added += one.versions_added;
  total.versions_updated += one.versions_updated;
  total.cpe_added += one.cpe_added;
  total.versions_attached += one.versions_attached;
  total.errors.push(...one.errors);
  total.dates_kept.push(...one.dates_kept);
  total.malformed_states.push(...one.malformed_states);
}

const DATE_FIELDS = ['standard_support_end', 'extended_support_end'] as const;

function rowValues(row: VersionRow): CatalogVersionValues {
  return { standard_support_end: row.standard_support_end ?? null, extended_support_end: row.extended_support_end ?? null, cpe_version: row.cpe_version ?? null };
}

const consistent = (v: CatalogVersionValues) => !(v.standard_support_end && v.extended_support_end && v.extended_support_end < v.standard_support_end);

/**
 * Puts back the date (or, failing one, both dates) that `target` changes from `current` when the
 * two dates would contradict each other (extended before standard); returns the fields put back.
 */
function keepConsistent(target: CatalogVersionValues, current: CatalogVersionValues): Array<keyof CatalogVersionValues> {
  if (consistent(target)) return [];
  const moved = DATE_FIELDS.filter((field) => target[field] !== current[field]);
  for (const field of moved) {
    if (consistent({ ...target, [field]: current[field] })) {
      target[field] = current[field];
      return [field];
    }
  }
  for (const field of moved) target[field] = current[field];
  return moved;
}

/** The identifiers this sync offers: the shipped file, and the living entry on top of it. */
function offeredIdentifiers(shipped: CatalogProduct, product: CatalogProduct): string[] {
  return Array.from(new Set([...shipped.cpe_products, ...product.cpe_products].map((p) => p.toLowerCase()))).sort();
}

function sameText(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left ?? '').trim() === (right ?? '').trim();
}

/**
 * The state of a technology without a usable one: the identifiers and versions of the shipped
 * file, the identifiers of the entry it holds, and the versions of the catalog it holds (with
 * their values), all counted as offered. The caller removes nothing from it: this state cannot
 * tell an identifier the shipped catalog withdrew from one the tenant added.
 */
function startingState(shipped: CatalogProduct, product: CatalogProduct, cpeProducts: string[], rows: VersionRow[]): CatalogState {
  const held = new Set(cpeProducts.map((p) => p.toLowerCase()));
  const versions: Record<string, CatalogVersionValues> = Object.fromEntries(shipped.versions.map((v) => [v.key, valuesOf(v)]));
  const prefix = `${product.key}:`;
  for (const row of rows) {
    if (!row.catalog_key?.startsWith(prefix)) continue;
    const key = row.catalog_key.slice(prefix.length);
    if (!versions[key]) versions[key] = rowValues(row);
  }
  return {
    cpe_products: Array.from(new Set([...shipped.cpe_products, ...product.cpe_products.filter((p) => held.has(p))])).sort(),
    versions,
  };
}

/** `technologies.catalog_state` when it has the expected shape; null when absent or unreadable. */
export function readState(raw: unknown): CatalogState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { cpe_products: cpe, versions } = raw as Record<string, unknown>;
  if (!Array.isArray(cpe) || !cpe.every((p) => typeof p === 'string')) return null;
  if (!versions || typeof versions !== 'object' || Array.isArray(versions)) return null;
  const description = (raw as Record<string, unknown>).description;
  if (description !== undefined && description !== null && typeof description !== 'string') return null;
  const out: CatalogState = { cpe_products: [...cpe], versions: {}, ...(typeof description === 'string' ? { description } : {}) };
  for (const [key, value] of Object.entries(versions as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    const field = (x: unknown) => (x === undefined || x === null ? null : typeof x === 'string' ? x : undefined);
    const values = { standard_support_end: field(v.standard_support_end), extended_support_end: field(v.extended_support_end), cpe_version: field(v.cpe_version) };
    if (Object.values(values).some((x) => x === undefined)) return null;
    out.versions[key] = values as CatalogVersionValues;
  }
  return out;
}

/** The body of an answer, refused past `MAX_ANSWER_BYTES` (announced or counted while it is read). */
async function readBody(response: Response): Promise<string> {
  const announced = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(announced) && announced > MAX_ANSWER_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new BadAnswer(`endoflife.date answered more than ${MAX_ANSWER_BYTES} bytes`);
  }
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_ANSWER_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new BadAnswer(`endoflife.date answered more than ${MAX_ANSWER_BYTES} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export function defaultCatalogRuntime(): CatalogRuntime {
  return {
    baseUrl: ((process.env.ENDOFLIFE_API_BASE_URL ?? '').trim() || ENDOFLIFE_DEFAULT_BASE_URL).replace(/\/+$/, ''),
    fetch: (input, init) => fetch(input, init),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    spacingMs: SPACING_MS,
    retryDelayMs: RETRY_DELAY_MS,
  };
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`endoflife.date answered HTTP ${status}`);
  }
}

/** A failure of the service (no answer, timeout, 429, 5xx) rather than of the product (404, a bad answer). */
function serviceFailure(error: unknown): boolean {
  if (error instanceof HttpError) return [408, 429].includes(error.status) || error.status >= 500;
  return !(error instanceof BadAnswer);
}

class BadAnswer extends Error {}

type TechnologyRow = { id: string; catalog_key: string; cpe_products: string[]; description: string | null; catalog_state: CatalogState | null };
type TechnologyUpdate = {
  id: string;
  cpe_added: string[];
  cpe_removed: string[];
  description: string | null;
  description_mode: 'fill' | 'update' | null;
  description_seen: string | null;
  state: CatalogState;
};
type VersionRow = {
  id: string;
  technology_id: string;
  label: string;
  build_prefixes: string[];
  catalog_key: string | null;
  standard_support_end: string | null;
  extended_support_end: string | null;
  cpe_version: string | null;
};

const FIELDS: Array<keyof CatalogVersionValues> = ['standard_support_end', 'extended_support_end', 'cpe_version'];

/** JSON with the keys of every object sorted: PostgreSQL gives a jsonb back in its own key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * The living catalog (lot C4, withdrawals and description corrections in lot C5): keeps the
 * technologies adopted from the catalog up to date with the versions, end-of-support dates and
 * CPE identifiers the catalog gains, and with the identifiers and descriptions the shipped
 * catalog corrects, leaving a value the tenant typed as the tenant left it.
 *
 * - Refresh (only while `TECHNOLOGY_CATALOG_SYNC_ENABLED`): the release cycles of endoflife.date
 *   (API v1, `GET /products/{product}`, `ENDOFLIFE_API_BASE_URL` to use a mirror) for the entries
 *   at least one tenant adopted, read into the platform cache `technology_catalog_products` with
 *   the rules of the shipped catalog (`catalog-releases.ts`). A product read less than 20 hours ago
 *   is skipped; one that fails keeps its last versions and is read again at the next run; after two
 *   failures of the service in a row, the others wait for the next run. A remote answer withdraws
 *   nothing: only the shipped file (`shippedProduct`) drops an identifier.
 * - Sync, tenant by tenant, after each refresh and at every start (the shipped catalog of a new
 *   KANAP version, in both deployment modes): `syncTenant`.
 *
 * Scheduled task `technology-catalog` (daily, and once when the server starts), registered in both
 * modes: off, it reads nothing from the network and syncs the shipped catalog only. The scheduler
 * awaits the handler and records a failure; nothing here is started without being awaited.
 */
@Injectable()
export class TechnologyCatalogSyncService implements OnModuleInit {
  private readonly logger = new Logger(TechnologyCatalogSyncService.name);
  private lastRequestAt = 0;

  constructor(
    private readonly dataSource: DataSource,
    private readonly scheduledTasks: ScheduledTasksService,
    private readonly catalog: TechnologyCatalogService,
    private readonly audit: AuditService,
    /** Queues a rematch once the caller's transaction has committed (lot T6b). Absent in some specs. */
    @Optional() private readonly cpeEvents?: TechnologyCpeEvents,
  ) {}

  onModuleInit() {
    this.scheduledTasks.register({
      name: CATALOG_SYNC_TASK_NAME,
      description: 'Keeps the versions, end-of-support dates and product identifiers of the technologies adopted from the catalog up to date, including identifiers and descriptions the shipped catalog corrects',
      defaultCron: '40 4 * * *',
      handler: () => this.run(),
      runOnStartup: true,
    });
  }

  /** The tenants in use, as the other scheduled tasks read them. */
  protected async tenantIds(): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM tenants WHERE status IN ('active', 'frozen') AND deleted_at IS NULL ORDER BY id ASC`,
    );
    return rows.map((r) => r.id);
  }

  /** The catalog keys adopted by at least one tenant, without saying which tenant adopted which. */
  async adoptedKeys(): Promise<string[]> {
    const keys = new Set<string>();
    for (const tenantId of await this.tenantIds()) {
      const rows: Array<{ catalog_key: string }> = await withTenant(this.dataSource, tenantId, (mg) => mg.query(
        `SELECT DISTINCT catalog_key FROM technologies WHERE tenant_id = $1 AND catalog_key IS NOT NULL`,
        [tenantId],
      ));
      for (const row of rows) keys.add(row.catalog_key);
    }
    return Array.from(keys).sort();
  }

  /** The scheduled run: refresh the cache (when on), then sync every tenant. */
  async run(runtime: CatalogRuntime = defaultCatalogRuntime()): Promise<CatalogSyncSummary> {
    const summary: CatalogSyncSummary = {
      refresh_enabled: Features.TECHNOLOGY_CATALOG_SYNC_ENABLED,
      products: 0, requests: 0, refreshed: 0, failed_products: [], rejected_releases: 0, errors: [],
      tenants_synced: 0, technologies_updated: 0, versions_added: 0, versions_updated: 0, versions_attached: 0, cpe_added: 0,
      dates_kept: [], malformed_states: 0,
    };
    if (Features.TECHNOLOGY_CATALOG_SYNC_ENABLED) await this.refresh(runtime, summary);
    const products = await this.catalog.effectiveProducts(this.dataSource.manager, undefined, { now: runtime.now() });
    for (const tenantId of await this.tenantIds()) {
      try {
        const result = await withTenant(this.dataSource, tenantId, (mg) => this.syncTenant(mg, tenantId, products));
        summary.tenants_synced += 1;
        summary.technologies_updated += result.technologies;
        summary.versions_added += result.versions_added;
        summary.versions_updated += result.versions_updated;
        summary.cpe_added += result.cpe_added;
        summary.versions_attached += result.versions_attached;
        summary.dates_kept.push(...result.dates_kept.map((line) => `${tenantId} ${line}`));
        summary.malformed_states += result.malformed_states.length;
        if (result.malformed_states.length) {
          this.logger.warn(`[${CATALOG_SYNC_TASK_NAME}] tenant ${tenantId}: unreadable catalog state rebuilt for ${result.malformed_states.join(', ')}`);
        }
        for (const error of result.errors) summary.errors.push(`Sync of tenant ${tenantId}: ${error}`);
      } catch (error: any) {
        summary.errors.push(`Sync of tenant ${tenantId}: ${error?.message ?? error}`);
      }
    }
    if (summary.dates_kept.length > 0) {
      this.logger.warn(`[${CATALOG_SYNC_TASK_NAME}] ${summary.dates_kept.length} catalog date(s) not applied, they would contradict the other date: ${summary.dates_kept.slice(0, 20).join(' | ')}`);
    }
    if (summary.errors.length > 0) this.logger.warn(`[${CATALOG_SYNC_TASK_NAME}] ${summary.errors.length} failure(s): ${summary.errors.join(' | ')}`);
    if (summary.products > 0 && summary.failed_products.length === summary.products) {
      throw new Error(`No product could be read from endoflife.date: ${summary.errors[0] ?? 'unknown error'}`);
    }
    // Everything else was done: the run is recorded as failed so that the failure shows in the
    // scheduled tasks, with what failed.
    if (summary.errors.length > 0) {
      throw new Error(`Partial failure, ${summary.errors.length} error(s): ${summary.errors.slice(0, 5).join(' | ')}`.slice(0, 2000));
    }
    return summary;
  }

  /** Reads the release cycles of the adopted entries into the cache; a product that fails is read again at the next run. */
  async refresh(runtime: CatalogRuntime, summary: CatalogSyncSummary): Promise<void> {
    const adopted = (await this.adoptedKeys())
      .map((key) => this.catalog.shippedProduct(key))
      .filter((p): p is CatalogProduct => !!p && endoflifeSlug(p) !== null);
    const keys = adopted.map((p) => p.key);
    const states: Array<{ catalog_key: string; last_success_at: Date | null; last_attempt_at: Date | null }> = keys.length
      ? await this.dataSource.query(
        `SELECT catalog_key, last_success_at, last_attempt_at FROM technology_catalog_products WHERE catalog_key = ANY($1::text[])`,
        [keys],
      )
      : [];
    const state = new Map(states.map((s) => [s.catalog_key, s]));
    const now = runtime.now();
    const due = adopted
      .filter((p) => {
        const success = state.get(p.key)?.last_success_at;
        return !success || now - new Date(success).getTime() >= FRESH_MS;
      })
      // Tried longest ago first, never tried first of all: every product gets its turn.
      .sort((a, b) => {
        const x = state.get(a.key)?.last_attempt_at ? new Date(state.get(a.key)!.last_attempt_at!).getTime() : null;
        const y = state.get(b.key)?.last_attempt_at ? new Date(state.get(b.key)!.last_attempt_at!).getTime() : null;
        if (x !== y) return x === null ? -1 : y === null ? 1 : x - y;
        return a.key.localeCompare(b.key);
      });
    summary.products = due.length;
    const today = new Date(now).toISOString().slice(0, 10);
    let failedInARow = 0;
    for (const product of due) {
      if (failedInARow >= 2) {
        summary.failed_products.push(product.key);
        continue;
      }
      try {
        const page = await this.request(`${runtime.baseUrl}/products/${encodeURIComponent(endoflifeSlug(product)!)}`, runtime, summary);
        const releases = page?.result?.releases;
        if (!Array.isArray(releases)) throw new BadAnswer('endoflife.date answered without release cycles');
        const rejected: string[] = [];
        const versions = versionsOfReleases(releases, today, product.key, (reason) => rejected.push(reason));
        if (rejected.length) {
          summary.rejected_releases += rejected.length;
          this.logger.warn(`[${CATALOG_SYNC_TASK_NAME}] ${product.key}: ${rejected.length} release value(s) left out: ${rejected.slice(0, 10).join(' | ')}`);
        }
        await this.dataSource.query(
          `INSERT INTO technology_catalog_products (catalog_key, versions, last_success_at, last_attempt_at, last_error)
           VALUES ($1, $2::jsonb, $3, $3, NULL)
           ON CONFLICT (catalog_key) DO UPDATE SET versions = EXCLUDED.versions, last_success_at = $3, last_attempt_at = $3, last_error = NULL`,
          [product.key, JSON.stringify(versions), new Date(runtime.now())],
        );
        summary.refreshed += 1;
        failedInARow = 0;
      } catch (error: any) {
        failedInARow = serviceFailure(error) ? failedInARow + 1 : 0;
        const message = String(error?.message ?? error).slice(0, 500);
        summary.failed_products.push(product.key);
        summary.errors.push(`${product.key}: ${message}`);
        await this.dataSource.query(
          `INSERT INTO technology_catalog_products (catalog_key, last_attempt_at, last_error) VALUES ($1, $3, $2)
           ON CONFLICT (catalog_key) DO UPDATE SET last_attempt_at = $3, last_error = EXCLUDED.last_error`,
          [product.key, message, new Date(runtime.now())],
        ).catch(() => undefined);
      }
    }
    const skipped = summary.failed_products.length - summary.errors.length;
    if (skipped > 0) summary.errors.push(`Stopped after two products failed in a row: ${skipped} product(s) left for the next run`);
  }

  /** One request at the cadence, tried `ATTEMPTS` times on a failure of the service. */
  private async request(url: string, runtime: CatalogRuntime, summary: CatalogSyncSummary): Promise<any> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const wait = this.lastRequestAt + runtime.spacingMs - runtime.now();
      if (wait > 0) await runtime.sleep(wait);
      this.lastRequestAt = runtime.now();
      summary.requests += 1;
      try {
        const response = await runtime.fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        if (!response.ok) throw new HttpError(response.status);
        const body = await readBody(response);
        try {
          return JSON.parse(body);
        } catch {
          throw new BadAnswer('endoflife.date answered with something other than JSON');
        }
      } catch (error) {
        lastError = error;
        if (!serviceFailure(error) || attempt === ATTEMPTS) break;
        await runtime.sleep(runtime.retryDelayMs * attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /**
   * Brings the technologies of one tenant adopted from the catalog up to date with `products` (the
   * living catalog), in the caller's transaction, under the tenant's context:
   * - a version the catalog never offered to the technology is created with its dates (provenance:
   *   its `catalog_key`); one it offered and the tenant deleted is not created again; a version
   *   typed before with the same label (without case) and no `catalog_key` is attached to the
   *   catalog instead, its empty values filled;
   * - on a version of the catalog (`technology_versions.catalog_key`), each of the end of standard
   *   support, the end of extended support and `cpe_version` follows the catalog while it still
   *   holds the value the catalog last wrote (`catalog_state`); a value the tenant changed stays.
   *   An empty `cpe_version` is always completed. A date the catalog withdraws (null) never erases
   *   one. A catalog date that would contradict the other date (extended before standard) is not
   *   applied, the rest is, and the version is named in `dates_kept`;
   * - an identifier the catalog gained is added to `cpe_products`; one the tenant removed is not.
   *   One present in `catalog_state.cpe_products`, absent from the shipped catalog and from the
   *   catalog this sync offers, and still held (without case) is removed. Afterwards the state
   *   lists what is currently offered, so an identifier the tenant removed stays in it while the
   *   catalog still offers it, and one the catalog withdrew leaves it and is added again if the
   *   catalog offers it later. One the tenant added, absent from the state, stays. The shipped
   *   file is the only source of a withdrawal: an endoflife.date answer or the cache that omits
   *   an identifier removes nothing;
   * - an empty description the catalog never filled receives the catalog's short description, in
   *   the tenant's language (`tenantLanguage`). One the catalog wrote (`catalog_state.description`)
   *   and the tenant left unchanged (the same text, edge spaces ignored) follows the catalog's
   *   description in that language when it changes. One the tenant changed stays. One the catalog
   *   withdraws leaves the text in place.
   * A technology without a usable state (adopted before the living catalog, or an unreadable one,
   * named in `malformed_states`) starts from the shipped catalog and from what it holds of the
   * catalog, all counted as offered: what it lacks counts as removed by the tenant, an empty value
   * on a version is completed, and only later additions reach it. Nothing is removed on that pass,
   * and the state written then does not record an identifier the shipped file no longer lists, so
   * a later pass does not remove it either.
   * One audit row per technology changed (`system`, `technology-catalog`), including
   * `cpe_products_removed` and `description_updated`. A technology whose CPE identifiers changed
   * is matched again with the vulnerabilities once the transaction commits. A technology whose
   * writes fail is left as it was and named in `errors`; the others are synced.
   */
  async syncTenant(mg: EntityManager, tenantId: string, products: Map<string, CatalogProduct>): Promise<TenantSyncResult> {
    const result = emptyResult();
    const keys = Array.from(products.keys());
    if (keys.length === 0) return result;
    // Two processes starting at once sync one after the other; an adoption waits on the row locks.
    await mg.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`technology-catalog-sync:${tenantId}`]);
    const technologies: TechnologyRow[] = await mg.query(
      `SELECT id, catalog_key, cpe_products, description, catalog_state FROM technologies
        WHERE tenant_id = $1 AND catalog_key = ANY($2::text[]) ORDER BY id FOR UPDATE`,
      [tenantId, keys],
    );
    if (technologies.length === 0) return result;
    const versions: VersionRow[] = await mg.query(
      `SELECT id, technology_id, label, build_prefixes, catalog_key, cpe_version,
              to_char(standard_support_end, 'YYYY-MM-DD') AS standard_support_end,
              to_char(extended_support_end, 'YYYY-MM-DD') AS extended_support_end
         FROM technology_versions WHERE tenant_id = $1 AND technology_id = ANY($2::uuid[])`,
      [tenantId, technologies.map((t) => t.id)],
    );
    const language = await this.tenantLanguage(mg, tenantId);
    // All technologies at once; when that fails, one at a time, each under its own savepoint: a
    // product whose values the database refuses holds back its own technologies only.
    await mg.query(`SAVEPOINT technology_catalog_sync`);
    try {
      const all = await this.apply(mg, tenantId, technologies, versions, products, language);
      await mg.query(`RELEASE SAVEPOINT technology_catalog_sync`);
      return all;
    } catch {
      await mg.query(`ROLLBACK TO SAVEPOINT technology_catalog_sync`);
    }
    for (const tech of technologies) {
      await mg.query(`SAVEPOINT technology_catalog_sync`);
      try {
        const one = await this.apply(mg, tenantId, [tech], versions.filter((v) => v.technology_id === tech.id), products, language);
        await mg.query(`RELEASE SAVEPOINT technology_catalog_sync`);
        addResult(result, one);
      } catch (error: any) {
        await mg.query(`ROLLBACK TO SAVEPOINT technology_catalog_sync`);
        result.errors.push(`${tech.catalog_key}: ${String(error?.message ?? error).slice(0, 300)}`);
      }
    }
    return result;
  }

  /**
   * The language of the descriptions the sync fills: the tenant's (`tenants.metadata.language`,
   * set at its creation) when it has one; otherwise the language most of its enabled users chose
   * (`users.locale`, the one the adoption reads), the first in en, fr, de, es order on a tie;
   * otherwise English.
   */
  private async tenantLanguage(mg: EntityManager, tenantId: string): Promise<CatalogLanguage> {
    const [tenant]: Array<{ metadata: unknown }> = await mg.query(`SELECT metadata FROM tenants WHERE id = $1`, [tenantId]);
    const metadata = tenant?.metadata && typeof tenant.metadata === 'object' ? (tenant.metadata as Record<string, unknown>) : {};
    if (metadata[TENANT_LANGUAGE_METADATA_KEY]) return tenantSeedLanguage(metadata);
    const rows: Array<{ locale: string; n: number }> = await mg.query(
      `SELECT lower(split_part(locale, '-', 1)) AS locale, count(*)::int AS n FROM users
        WHERE tenant_id = $1 AND status = 'enabled' AND lower(split_part(locale, '-', 1)) IN ('en', 'fr', 'de', 'es')
        GROUP BY 1`,
      [tenantId],
    );
    const order: CatalogLanguage[] = ['en', 'fr', 'de', 'es'];
    const best = rows.sort((a, b) => b.n - a.n || order.indexOf(a.locale as CatalogLanguage) - order.indexOf(b.locale as CatalogLanguage))[0];
    return (best?.locale as CatalogLanguage) ?? 'en';
  }

  /** The sync of `technologies` (see `syncTenant`), in one pass. */
  private async apply(
    mg: EntityManager,
    tenantId: string,
    technologies: TechnologyRow[],
    versions: VersionRow[],
    products: Map<string, CatalogProduct>,
    language: CatalogLanguage,
  ): Promise<TenantSyncResult> {
    const result = emptyResult();
    const byKey = new Map(versions.filter((v) => v.catalog_key).map((v) => [`${v.technology_id}|${v.catalog_key}`, v]));

    const inserts: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const techUpdates: TechnologyUpdate[] = [];
    const changes = new Map<string, { label: string[]; updated: string[]; attached: string[]; cpe: string[]; removed: string[]; description: boolean; descriptionUpdated: boolean }>();
    const changeOf = (id: string) => changes.get(id) ?? changes.set(id, { label: [], updated: [], attached: [], cpe: [], removed: [], description: false, descriptionUpdated: false }).get(id)!;

    for (const tech of technologies) {
      const product = products.get(tech.catalog_key)!;
      const shipped = this.catalog.shippedProduct(tech.catalog_key) ?? product;
      const rows = versions.filter((v) => v.technology_id === tech.id);
      const parsed = readState(tech.catalog_state);
      if (tech.catalog_state !== null && tech.catalog_state !== undefined && !parsed) result.malformed_states.push(tech.catalog_key);
      // No usable state (adopted before the living catalog, or unreadable): what the shipped file
      // offers and what the technology holds of the catalog count as offered, so nothing the tenant
      // deleted comes back; an empty value on a version counts as the catalog's and is completed.
      const bootstrap = !parsed;
      const state: CatalogState = parsed ?? startingState(shipped, product, tech.cpe_products, rows);

      const has = new Set(tech.cpe_products.map((p) => p.toLowerCase()));
      const offeredBefore = new Set(state.cpe_products.map((p) => p.toLowerCase()));
      const offered = offeredIdentifiers(shipped, product);
      const offeredNow = new Set(offered);
      const cpeAdded = Array.from(new Set(product.cpe_products.map((p) => p.toLowerCase())))
        .filter((p) => !offeredBefore.has(p) && !has.has(p));
      // No usable state yet: it cannot tell an identifier the shipped catalog withdrew from one
      // the tenant added, so this pass removes nothing. The state written here lists only what is
      // offered now, so that withdrawn identifier is not removed on a later pass either.
      const cpeRemoved = bootstrap ? [] : Array.from(offeredBefore).filter((p) => !offeredNow.has(p) && has.has(p)).sort();
      state.cpe_products = offered;
      if (cpeAdded.length) changeOf(tech.id).cpe.push(...cpeAdded);
      if (cpeRemoved.length) changeOf(tech.id).removed.push(...cpeRemoved);
      const loose = new Map(rows.filter((r) => !r.catalog_key).map((r) => [r.label.toLowerCase(), r]));

      for (const version of product.versions) {
        const next = valuesOf(version);
        const memo = state.versions[version.key];
        const fullKey = `${product.key}:${version.key}`;
        const row = byKey.get(`${tech.id}|${fullKey}`);
        if (!row) {
          const typed = loose.get(version.label.toLowerCase());
          if (typed) {
            // Typed with this label before the catalog had it (a server import, a link): attached to
            // the catalog, its empty values filled; a value the tenant gave stays the tenant's.
            loose.delete(version.label.toLowerCase());
            const current = rowValues(typed);
            const target: CatalogVersionValues = { ...current };
            for (const field of FIELDS) if (current[field] === null) target[field] = next[field];
            const kept = keepConsistent(target, current);
            if (kept.length) result.dates_kept.push(`${product.key} ${typed.label}`);
            const newMemo: CatalogVersionValues = { ...next };
            for (const field of kept) newMemo[field] = current[field];
            updates.push({
              id: typed.id, catalog_key: fullKey, ...target, attach: true,
              build_prefixes: typed.build_prefixes.length ? undefined : version.build_prefixes ?? [],
              seen: { ...current, catalog_key: null },
            });
            state.versions[version.key] = newMemo;
            continue;
          }
          if (!memo) {
            inserts.push({
              technology_id: tech.id, label: version.label, cpe_version: next.cpe_version, build_prefixes: version.build_prefixes ?? [],
              standard_support_end: next.standard_support_end, extended_support_end: next.extended_support_end, catalog_key: fullKey,
            });
          }
          // Offered before and gone: deleted by the tenant, left alone.
          state.versions[version.key] = next;
          continue;
        }
        const current = rowValues(row);
        const base = memo ?? current;
        const target: CatalogVersionValues = { ...current };
        const newMemo: CatalogVersionValues = { ...base };
        for (const field of FIELDS) {
          const was = base[field] ?? null;
          const now = current[field];
          const fresh = next[field];
          // An empty cpe_version on a version of the catalog is never the tenant's choice.
          const empty = now === null && (field === 'cpe_version' || bootstrap);
          if (now !== was && !empty) {
            newMemo[field] = fresh; // the tenant's value stays
            continue;
          }
          if (fresh === null && now !== null && field !== 'cpe_version') continue; // a date withdrawn upstream never erases one
          target[field] = fresh;
          newMemo[field] = fresh;
        }
        const kept = keepConsistent(target, current);
        if (kept.length) result.dates_kept.push(`${product.key} ${row.label}`);
        for (const field of kept) newMemo[field] = current[field];
        state.versions[version.key] = newMemo;
        if (!FIELDS.some((field) => target[field] !== current[field])) continue;
        updates.push({ id: row.id, catalog_key: row.catalog_key, ...target, attach: false, seen: { ...current, catalog_key: row.catalog_key } });
      }
      // An empty description the catalog never filled receives the catalog's, in the tenant's
      // language. One the catalog wrote and the tenant left unchanged (edge spaces ignored)
      // follows a new catalog description in that language. One the tenant changed stays. One
      // the catalog withdraws leaves the text in place.
      const fresh = this.catalog.description(product.key, language);
      const remembered = typeof state.description === 'string' ? state.description : null;
      let description: string | null = null;
      let descriptionMode: 'fill' | 'update' | null = null;
      let descriptionSeen: string | null = null;
      if (!remembered?.trim()) {
        if (!tech.description?.trim() && fresh) {
          description = fresh;
          descriptionMode = 'fill';
          state.description = fresh;
          changeOf(tech.id).description = true;
        }
      } else if (sameText(tech.description, remembered) && fresh && !sameText(fresh, remembered)) {
        description = fresh;
        descriptionMode = 'update';
        descriptionSeen = remembered.trim();
        state.description = fresh;
        changeOf(tech.id).descriptionUpdated = true;
      }
      techUpdates.push({
        id: tech.id, cpe_added: cpeAdded, cpe_removed: cpeRemoved, description,
        description_mode: descriptionMode, description_seen: descriptionSeen, state,
      });
    }

    if (inserts.length) {
      const added: Array<{ technology_id: string; label: string }> = await mg.query(
        `INSERT INTO technology_versions (tenant_id, technology_id, label, cpe_version, build_prefixes, standard_support_end, extended_support_end, catalog_key)
         SELECT $1, v.technology_id, v.label, v.cpe_version, ARRAY(SELECT jsonb_array_elements_text(v.build_prefixes)),
                v.standard_support_end::date, v.extended_support_end::date, v.catalog_key
           FROM jsonb_to_recordset($2::jsonb) AS v(technology_id uuid, label text, cpe_version text, build_prefixes jsonb,
                                                   standard_support_end text, extended_support_end text, catalog_key text)
         ON CONFLICT (tenant_id, technology_id, lower(label)) DO NOTHING
         RETURNING technology_id, label`,
        [tenantId, JSON.stringify(inserts)],
      );
      for (const row of added) changeOf(row.technology_id).label.push(row.label);
      result.versions_added = added.length;
    }
    if (updates.length) {
      // Compare and set: a value the tenant changed since it was read is not overwritten. An UPDATE
      // answers [rows, count]: read its rows through a CTE.
      const updated: Array<{ technology_id: string; label: string; attach: boolean }> = await mg.query(
        `WITH changed AS (
         UPDATE technology_versions v
            SET catalog_key = u.catalog_key,
                standard_support_end = u.standard_support_end::date,
                extended_support_end = u.extended_support_end::date,
                cpe_version = u.cpe_version,
                build_prefixes = CASE WHEN u.build_prefixes IS NULL THEN v.build_prefixes
                                      ELSE ARRAY(SELECT jsonb_array_elements_text(u.build_prefixes)) END,
                updated_at = now()
           FROM jsonb_to_recordset($2::jsonb) AS u(id uuid, catalog_key text, standard_support_end text, extended_support_end text,
                                                   cpe_version text, build_prefixes jsonb, attach boolean, seen jsonb)
          WHERE v.tenant_id = $1 AND v.id = u.id
            AND v.catalog_key IS NOT DISTINCT FROM u.seen->>'catalog_key'
            AND to_char(v.standard_support_end, 'YYYY-MM-DD') IS NOT DISTINCT FROM u.seen->>'standard_support_end'
            AND to_char(v.extended_support_end, 'YYYY-MM-DD') IS NOT DISTINCT FROM u.seen->>'extended_support_end'
            AND v.cpe_version IS NOT DISTINCT FROM u.seen->>'cpe_version'
         RETURNING v.technology_id, v.label, u.attach
         )
         SELECT technology_id, label, attach FROM changed`,
        [tenantId, JSON.stringify(updates)],
      );
      for (const row of updated) (row.attach ? changeOf(row.technology_id).attached : changeOf(row.technology_id).updated).push(row.label);
      result.versions_attached = updated.filter((row) => row.attach).length;
      result.versions_updated = updated.length - result.versions_attached;
    }
    const written = techUpdates.filter((tech) => {
      const original = technologies.find((t) => t.id === tech.id)!;
      return tech.cpe_added.length > 0 || tech.cpe_removed.length > 0 || tech.description !== null || canonical(original.catalog_state) !== canonical(tech.state);
    });
    if (written.length) {
      await mg.query(
        `UPDATE technologies t
            SET catalog_state = u.state,
                cpe_products = CASE
                  WHEN jsonb_array_length(u.cpe_added) = 0 AND jsonb_array_length(u.cpe_removed) = 0 THEN t.cpe_products
                  ELSE ARRAY(
                    SELECT DISTINCT p
                      FROM unnest(t.cpe_products || CASE WHEN jsonb_array_length(u.cpe_added) = 0 THEN '{}'::text[]
                                                         ELSE ARRAY(SELECT jsonb_array_elements_text(u.cpe_added)) END) AS p
                     WHERE NOT EXISTS (
                       SELECT 1 FROM jsonb_array_elements_text(u.cpe_removed) AS x WHERE lower(x) = lower(p))
                     ORDER BY 1)
                  END,
                -- Filled while empty, or replaced while it still holds the text the catalog wrote.
                -- A description typed since it was read stays.
                description = CASE
                  WHEN u.description IS NULL THEN t.description
                  WHEN u.description_mode = 'fill' AND NULLIF(btrim(t.description), '') IS NULL THEN u.description
                  WHEN u.description_mode = 'update' AND btrim(t.description) = u.description_seen THEN u.description
                  ELSE t.description
                  END,
                updated_at = CASE
                  WHEN jsonb_array_length(u.cpe_added) = 0 AND jsonb_array_length(u.cpe_removed) = 0 AND u.description IS NULL THEN t.updated_at
                  ELSE now()
                  END
           FROM jsonb_to_recordset($2::jsonb) AS u(id uuid, cpe_added jsonb, cpe_removed jsonb, description text,
                                                   description_mode text, description_seen text, state jsonb)
          WHERE t.tenant_id = $1 AND t.id = u.id`,
        [tenantId, JSON.stringify(written)],
      );
      result.cpe_added = written.reduce((sum, tech) => sum + tech.cpe_added.length, 0);
    }
    for (const [technologyId, change] of changes) {
      if (!change.label.length && !change.updated.length && !change.attached.length && !change.cpe.length && !change.removed.length && !change.description && !change.descriptionUpdated) continue;
      result.technologies += 1;
      await this.audit.log({
        table: 'technologies', recordId: technologyId, action: 'update', before: null,
        after: {
          catalog_sync: {
            versions_added: change.label, versions_updated: change.updated, versions_attached: change.attached,
            cpe_products_added: change.cpe, cpe_products_removed: change.removed,
            description_filled: change.description, description_updated: change.descriptionUpdated,
          },
        },
        source: 'system', sourceRef: CATALOG_SYNC_TASK_NAME,
      }, { manager: mg });
    }
    for (const tech of written) {
      if (tech.cpe_added.length === 0 && tech.cpe_removed.length === 0) continue;
      // Same bridge as a manual edit: after commit, the feed matches this technology again
      // (rows of a removed product disappear) and collects an identifier it has never seen.
      await this.cpeEvents?.emit({ manager: mg, tenantId, technologyId: tech.id, products: tech.cpe_added });
    }
    return result;
  }
}
