import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ScheduledTasksService } from '../scheduled-tasks/scheduled-tasks.service';
import { Subscription } from '../../billing/subscription.entity';
import { TRIAL_WORKSPACE_RETENTION_DAYS } from '../../billing/plans.config';
import { computeTrialDeletionAt } from '../../billing/subscription-freeze.util';
import { StripeConfigService } from '../../billing/stripe/stripe.config';
import { withTenant } from '../../common/tenant-runner';
import { Features } from '../../config/features';
import { TenantStatus } from '../../tenants/tenant.entity';
import { AdminTenantsService } from './admin-tenants.service';

export const TRIAL_WORKSPACE_EXPIRY_TASK_NAME = 'trial-workspace-expiry';

/**
 * `tenants.deletion_reason` of a deletion started by this task. It also finds the tenants whose
 * deletion an interruption left halfway (deleting, or frozen by a failed purge).
 */
export const TRIAL_WORKSPACE_EXPIRY_REASON =
  `Trial ended more than ${TRIAL_WORKSPACE_RETENTION_DAYS} days ago without a subscription`;

/** Deletions per run at most; the rest waits for the next day. */
export const TRIAL_WORKSPACE_EXPIRY_MAX_PER_RUN = 20;

export type TrialWorkspaceExpirySummary = {
  skipped?: string;
  candidates: number;
  deleted: string[];
  cancelled: string[];
  deferred: number;
  errors: string[];
};

type CandidateRow = { id: string; slug: string; status: TenantStatus };

/**
 * Daily, cloud only: deletes the workspaces whose trial ended more than
 * TRIAL_WORKSPACE_RETENTION_DAYS days ago without a subscription (`computeTrialDeletionAt`),
 * through the platform-admin deletion path (`AdminTenantsService.deleteTenant`): same purge,
 * audit entries with a system origin. Never the system tenants nor the default tenant.
 *
 * Safe to stop at any point: the subscription rows are read again, locked, in the purge
 * transaction; a tenant left deleting (or frozen by a failed purge) with this task's reason is
 * taken up again by the next run, and one whose purge was committed is marked deleted.
 */
@Injectable()
export class TrialWorkspaceExpiryService implements OnModuleInit {
  private readonly logger = new Logger(TrialWorkspaceExpiryService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly scheduledTasks: ScheduledTasksService,
    private readonly adminTenants: AdminTenantsService,
    private readonly stripeConfig: StripeConfigService,
  ) {}

  onModuleInit() {
    if (Features.SINGLE_TENANT) return;
    this.scheduledTasks.register({
      name: TRIAL_WORKSPACE_EXPIRY_TASK_NAME,
      description: `Deletes the workspaces whose trial ended more than ${TRIAL_WORKSPACE_RETENTION_DAYS} days ago without a subscription`,
      defaultCron: '15 4 * * *',
      handler: () => this.run(),
    });
  }

  /** `tenantIds` limits the run to these tenants (specs share their database with other tenants). */
  async run(opts?: { now?: Date; tenantIds?: string[]; maxPerRun?: number }): Promise<TrialWorkspaceExpirySummary> {
    const summary: TrialWorkspaceExpirySummary = { candidates: 0, deleted: [], cancelled: [], deferred: 0, errors: [] };
    if (!this.billingEnforced()) {
      summary.skipped = 'Billing is not configured: trials are not enforced';
      return summary;
    }
    const now = (opts?.now ?? new Date()).getTime();
    const maxPerRun = opts?.maxPerRun ?? TRIAL_WORKSPACE_EXPIRY_MAX_PER_RUN;

    for (const tenant of await this.candidates(opts?.tenantIds)) {
      try {
        const due = await withTenant(this.dataSource, tenant.id, (manager) => this.isDue(manager, tenant, now, false));
        if (!due) continue;
        summary.candidates += 1;
        if (summary.deleted.length >= maxPerRun) {
          summary.deferred += 1;
          continue;
        }
        const result = await this.adminTenants.deleteTenant(
          tenant.id,
          null,
          { confirmSlug: tenant.slug, reason: TRIAL_WORKSPACE_EXPIRY_REASON },
          {
            origin: { source: 'system', sourceRef: TRIAL_WORKSPACE_EXPIRY_TASK_NAME },
            stillDue: (manager) => this.isDue(manager, tenant, now, true),
          },
        );
        if (result.cancelled) {
          summary.cancelled.push(tenant.slug);
          this.logger.log(`[${TRIAL_WORKSPACE_EXPIRY_TASK_NAME}] Not deleted, no longer due: ${tenant.slug} (${tenant.id})`);
        } else {
          summary.deleted.push(tenant.slug);
          this.logger.log(`[${TRIAL_WORKSPACE_EXPIRY_TASK_NAME}] Deleted workspace ${tenant.slug} (${tenant.id})`);
        }
      } catch (error: any) {
        const message = `${tenant.slug} (${tenant.id}): ${error?.message || String(error)}`;
        summary.errors.push(message);
        this.logger.error(`[${TRIAL_WORKSPACE_EXPIRY_TASK_NAME}] Deletion failed for ${message}`);
      }
    }
    if (summary.deferred > 0) {
      this.logger.warn(`[${TRIAL_WORKSPACE_EXPIRY_TASK_NAME}] ${summary.deferred} workspace(s) left for the next run (${maxPerRun} per run)`);
    }
    return summary;
  }

  private billingEnforced(): boolean {
    return !Features.SINGLE_TENANT && this.stripeConfig.isConfigured();
  }

  /**
   * Active tenants, and the tenants this task left halfway: deleting, or frozen by a failed purge
   * (a platform administrator's freeze sets `frozen_at`; a failed purge does not).
   */
  private candidates(tenantIds?: string[]): Promise<CandidateRow[]> {
    const defaultSlug = (process.env.DEFAULT_TENANT_SLUG || 'default').trim();
    return this.dataSource.query(
      `SELECT id, slug, status
         FROM tenants
        WHERE deleted_at IS NULL
          AND is_system_tenant IS NOT TRUE
          AND slug <> $1
          AND (status = $2
               OR (status IN ($3, $4) AND deletion_reason = $5 AND frozen_at IS NULL))
          AND ($6::uuid[] IS NULL OR id = ANY($6::uuid[]))
        ORDER BY created_at ASC, id ASC`,
      [
        defaultSlug,
        TenantStatus.ACTIVE,
        TenantStatus.DELETING,
        TenantStatus.FROZEN,
        TRIAL_WORKSPACE_EXPIRY_REASON,
        tenantIds ?? null,
      ],
    );
  }

  /**
   * Whether the tenant is due, from its subscription row (`lock`: held until the purge
   * transaction ends, so a subscription written meanwhile waits for it). A tenant this task left
   * deleting with no subscription row any more had its purge committed: it is due, to be marked
   * deleted.
   */
  private async isDue(manager: EntityManager, tenant: CandidateRow, now: number, lock: boolean): Promise<boolean> {
    const subscription = await manager.getRepository(Subscription).findOne({
      where: { tenant_id: tenant.id },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!subscription) return tenant.status === TenantStatus.DELETING;
    const deletionAt = computeTrialDeletionAt(subscription, this.billingEnforced());
    return deletionAt != null && deletionAt.getTime() <= now;
  }
}
