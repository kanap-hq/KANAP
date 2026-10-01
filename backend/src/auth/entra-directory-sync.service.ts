import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { EntraAuthService } from './entra-auth.service';
import { UsersService } from '../users/users.service';
import { TenantsService } from '../tenants/tenants.service';
import { Tenant } from '../tenants/tenant.entity';
import { ScheduledTasksService } from '../admin/scheduled-tasks/scheduled-tasks.service';
import { Features } from '../config/features';
import { withTenant } from '../common/tenant-runner';
import { User } from '../users/user.entity';
import { Company } from '../companies/company.entity';
import { Department } from '../departments/department.entity';
import {
  DirectoryProfile,
  decideDirectoryAction,
  mergeScalarFields,
  readManagerExternalId,
  resolveDirectoryNames,
} from './entra-directory-sync.util';
import { TeamMemberConfigService } from '../portfolio/team-member-config.service';

export const ENTRA_DIRECTORY_SYNC_TASK = 'entra-directory-sync';

/** Graph `$filter=id in (...)` stays well below URL/operator limits at this size. */
const GRAPH_ID_BATCH = 15;

export type DirectorySyncStatus = 'ok' | 'consent_required' | 'error';

export type TenantSyncResult = {
  status: DirectorySyncStatus;
  message?: string | null;
  synced: number;
  disabled: number;
  removed: number;
  /** Contributor rows whose manager was written from the directory. */
  managers_updated: number;
  /** Directory managers left aside: not a KANAP user yet, or refused. */
  managers_unresolved: number;
};

/** One synced user and the object id of their manager in the directory. */
export type DirectoryManagerEntry = {
  userId: string;
  managerExternalId: string | null;
};

/**
 * Daily Microsoft Entra directory sync.
 *
 * Runs with application permissions (client credentials), so it only works for
 * tenants whose Entra admin granted consent; others are reported as
 * `consent_required` and keep login-time enrichment only. Both deployment
 * modes: no-op without ENTRA_* env config, per-tenant under RLS otherwise.
 */
@Injectable()
export class EntraDirectorySyncService implements OnModuleInit {
  private readonly logger = new Logger(EntraDirectorySyncService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly entra: EntraAuthService,
    private readonly users: UsersService,
    private readonly tenants: TenantsService,
    private readonly scheduledTasks: ScheduledTasksService,
    private readonly contributors: TeamMemberConfigService,
  ) {}

  onModuleInit() {
    this.scheduledTasks.register({
      name: ENTRA_DIRECTORY_SYNC_TASK,
      description:
        'Refreshes Microsoft Entra user attributes and disables accounts removed or deactivated in the directory (tenants with Entra SSO and admin consent only)',
      defaultCron: '0 3 * * *',
      handler: () => this.runAll(),
    });
  }

  async runAll(): Promise<Record<string, any>> {
    if (!Features.ENTRA_SSO) return { skipped: 'entra_not_configured', tenantsProcessed: 0 };

    const tenants: Array<{ id: string; slug: string }> = await this.dataSource.query(
      `SELECT id, slug FROM tenants
       WHERE status = 'active' AND sso_provider = 'entra' AND sso_enabled = true AND entra_tenant_id IS NOT NULL`,
    );

    const summary = {
      tenantsProcessed: 0,
      synced: 0,
      disabled: 0,
      removed: 0,
      managers_updated: 0,
      managers_unresolved: 0,
      consentRequired: 0,
      errors: [] as string[],
    };
    for (const tenant of tenants) {
      try {
        const result = await this.syncTenant(tenant.id);
        summary.tenantsProcessed++;
        summary.synced += result.synced;
        summary.disabled += result.disabled;
        summary.removed += result.removed;
        summary.managers_updated += result.managers_updated;
        summary.managers_unresolved += result.managers_unresolved;
        if (result.status === 'consent_required') summary.consentRequired++;
        else if (result.status === 'error') summary.errors.push(`${tenant.slug}: ${result.message}`);
      } catch (err: any) {
        summary.errors.push(`${tenant.slug}: ${err?.message || err}`);
        this.logger.warn(`[${ENTRA_DIRECTORY_SYNC_TASK}] tenant ${tenant.slug} failed: ${err?.message || err}`);
      }
    }
    return summary;
  }

  async syncTenant(tenantId: string): Promise<TenantSyncResult> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || tenant.sso_provider !== 'entra' || !tenant.entra_tenant_id) {
      return {
        status: 'error',
        message: 'SSO_NOT_CONFIGURED',
        synced: 0,
        disabled: 0,
        removed: 0,
        managers_updated: 0,
        managers_unresolved: 0,
      };
    }

    const result: TenantSyncResult = {
      status: 'ok',
      message: null,
      synced: 0,
      disabled: 0,
      removed: 0,
      managers_updated: 0,
      managers_unresolved: 0,
    };

    let token: string;
    try {
      token = await this.entra.acquireAppToken(tenant.entra_tenant_id);
      // A token is issued even without admin consent; only Graph tells the truth.
      // Probe once so tenants with no linked users still report consent_required.
      await this.entra.probeDirectoryAccess(token);
    } catch (err: any) {
      // Never keep a token that Graph refused: the next run must re-acquire.
      this.entra.invalidateAppToken(tenant.entra_tenant_id);
      result.status = this.entra.isConsentError(err) ? 'consent_required' : 'error';
      result.message = err?.message || String(err);
      await this.recordStatus(tenant, result);
      return result;
    }

    const managerEntries: DirectoryManagerEntry[] = [];

    try {
      await withTenant(this.dataSource, tenantId, async (manager) => {
        const repo = manager.getRepository(User);
        const users = (
          await repo.find({
            where: { external_auth_provider: 'entra', status: In(['enabled', 'invited', 'contact']) } as any,
          })
        ).filter((u) => !!u.external_subject);

        for (let i = 0; i < users.length; i += GRAPH_ID_BATCH) {
          const chunk = users.slice(i, i + GRAPH_ID_BATCH);
          const profiles = await this.entra.fetchDirectoryUsers(
            token,
            chunk.map((u) => u.external_subject as string),
          );
          const byId = new Map(profiles.filter((p) => p.id).map((p) => [p.id as string, p]));

          for (const user of chunk) {
            const profile = byId.get(user.external_subject as string);
            const action = decideDirectoryAction(profile);
            if (action !== 'sync') {
              const reason = action === 'disable_removed' ? 'removed' : 'deactivated';
              await this.users.disableUser(user.id, null, { manager, sourceRef: `entra-sync:${reason}` });
              if (action === 'disable_removed') result.removed++;
              else result.disabled++;
              continue;
            }
            await this.applyDirectoryProfile(user, profile as DirectoryProfile, manager);
            await repo.save(user);
            result.synced++;
            const managerExternalId = readManagerExternalId(profile);
            if (managerExternalId) managerEntries.push({ userId: user.id, managerExternalId });
          }
        }
      });

      // The reporting line gets its own short transaction: the pass above spans
      // Graph calls, and the cycle guard's advisory lock must not be held for
      // that long against someone editing a manager by hand.
      if (managerEntries.length > 0) {
        const managers = await withTenant(this.dataSource, tenantId, (manager) =>
          this.syncDirectoryManagers(tenantId, managerEntries, manager),
        );
        result.managers_updated = managers.updated;
        result.managers_unresolved = managers.unresolved;
      }
    } catch (err: any) {
      this.entra.invalidateAppToken(tenant.entra_tenant_id);
      result.status = this.entra.isConsentError(err) ? 'consent_required' : 'error';
      result.message = err?.message || String(err);
    }

    await this.recordStatus(tenant, result);
    return result;
  }

  /**
   * Write directory-owned fields onto a user: names/title/phones (non-empty
   * wins, empty never clears), department and company matched by name against
   * existing KANAP records (never auto-created), locale only if unset, and the
   * external_synced_at stamp. Shared by the login path and the scheduled sync.
   * Caller saves the entity.
   */
  async applyDirectoryProfile(
    user: User,
    profile: DirectoryProfile,
    manager: EntityManager,
    claims?: { given_name?: string; family_name?: string; name?: string } | null,
  ): Promise<void> {
    mergeScalarFields(user, profile, resolveDirectoryNames(profile, claims));

    const companyName = (profile.companyName ?? '').trim();
    if (companyName) {
      const company = await manager
        .getRepository(Company)
        .createQueryBuilder('c')
        .where('LOWER(c.name) = LOWER(:name)', { name: companyName })
        .getOne();
      if (company) user.company_id = company.id;
    }

    const departmentName = (profile.department ?? '').trim();
    if (departmentName) {
      const candidates = await manager
        .getRepository(Department)
        .createQueryBuilder('d')
        .where('LOWER(d.name) = LOWER(:name)', { name: departmentName })
        .getMany();
      const match =
        candidates.find((d) => !!user.company_id && (d as any).company_id === user.company_id) ?? candidates[0];
      if (match) user.department_id = match.id;
    }

    user.external_synced_at = new Date();
  }

  /**
   * Reporting line from the directory, for the nightly sync and for the
   * login-time refresh. Manager object ids are resolved to KANAP users through
   * `external_subject`; the value is written on the synced person's contributor
   * row, when they have one -- users who are not contributors carry no
   * reporting line, and a manager who is not a KANAP user yet is left for a
   * later run rather than clearing what is stored.
   *
   * Writes go through TeamMemberConfigService, so the directory obeys the same
   * rules as a manual edit (tenant, not self, no cycle) and stamps
   * `manager_source = 'entra'`, which makes the field read-only in the app.
   * The caller supplies a transactional manager: the cycle guard takes a
   * transaction-scoped advisory lock, and the contributor table is under FORCE
   * row level security.
   */
  async syncDirectoryManagers(
    tenantId: string,
    entries: DirectoryManagerEntry[],
    manager: EntityManager,
  ): Promise<{ updated: number; unresolved: number }> {
    const wanted = entries.filter((entry) => !!entry.managerExternalId);
    if (wanted.length === 0) return { updated: 0, unresolved: 0 };

    // Two batched reads for the whole set, never one query per person.
    const managerRows: Array<{ id: string; external_subject: string }> = await manager.query(
      `SELECT id, external_subject FROM users
       WHERE tenant_id = $1 AND external_auth_provider = 'entra' AND external_subject = ANY($2::text[])`,
      [tenantId, [...new Set(wanted.map((entry) => entry.managerExternalId as string))]],
    );
    const userIdByExternalSubject = new Map(managerRows.map((row) => [row.external_subject, row.id]));

    const contributorRows: Array<{
      id: string;
      user_id: string;
      manager_user_id: string | null;
      manager_source: string | null;
    }> = await manager.query(
      `SELECT id, user_id, manager_user_id, manager_source
       FROM portfolio_team_member_configs
       WHERE tenant_id = $1 AND user_id = ANY($2::uuid[])`,
      [tenantId, wanted.map((entry) => entry.userId)],
    );
    const contributorByUserId = new Map(contributorRows.map((row) => [row.user_id, row]));

    let updated = 0;
    let unresolved = 0;
    for (const entry of wanted) {
      const contributor = contributorByUserId.get(entry.userId);
      if (!contributor) continue;

      const managerUserId = userIdByExternalSubject.get(entry.managerExternalId as string);
      if (!managerUserId) {
        unresolved += 1;
        continue;
      }
      // Steady state is a no-op: rewriting every night would fill the audit
      // trail with changes nobody made.
      if (contributor.manager_user_id === managerUserId && contributor.manager_source === 'entra') continue;

      try {
        await this.contributors.update(
          contributor.id,
          { manager_user_id: managerUserId },
          null,
          { manager, managerSource: 'entra' },
        );
        updated += 1;
      } catch (err: any) {
        // A reporting line only half-represented in KANAP can close a loop the
        // directory does not have. One refusal must not stop the others.
        unresolved += 1;
        this.logger.warn(
          `[${ENTRA_DIRECTORY_SYNC_TASK}] manager not applied to contributor ${contributor.id}: ${err?.message || err}`,
        );
      }
    }

    return { updated, unresolved };
  }

  private async recordStatus(tenant: Tenant, result: TenantSyncResult): Promise<void> {
    const previous = ((tenant.entra_metadata as any)?.directory_sync ?? {}) as Record<string, any>;
    const now = new Date().toISOString();
    const directory_sync = {
      status: result.status,
      message: result.message ?? null,
      last_attempt_at: now,
      last_success_at: result.status === 'ok' ? now : previous.last_success_at ?? null,
      ...(result.status === 'ok'
        ? {
            synced: result.synced,
            disabled: result.disabled,
            removed: result.removed,
            managers_updated: result.managers_updated,
            managers_unresolved: result.managers_unresolved,
          }
        : {}),
    };
    try {
      // Only the sync's own key: the tenant was loaded when the sync started,
      // and the rest of entra_metadata may have changed since. Nothing is written
      // when SSO was disconnected or moved to another directory meanwhile.
      await this.tenants.setEntraMetadataKey(tenant.id, 'directory_sync', directory_sync, {
        whenEntraTenantId: tenant.entra_tenant_id,
      });
    } catch (err: any) {
      this.logger.warn(`[${ENTRA_DIRECTORY_SYNC_TASK}] could not record status for tenant ${tenant.id}: ${err?.message || err}`);
    }
  }
}
