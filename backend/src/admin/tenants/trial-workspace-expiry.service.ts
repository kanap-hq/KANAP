import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ScheduledTasksService } from '../scheduled-tasks/scheduled-tasks.service';
import { Subscription } from '../../billing/subscription.entity';
import { TRIAL_WORKSPACE_RETENTION_DAYS } from '../../billing/plans.config';
import { computeTrialDeletionAt } from '../../billing/subscription-freeze.util';
import { StripeClientService, StripeConfigService } from '../../billing/stripe';
import { withTenant } from '../../common/tenant-runner';
import { Features } from '../../config/features';
import { DISCOVERY_CALL_RETENTION_DAYS, eraseExpiredDiscoveryCall } from '../../discovery-call/discovery-call.service';
import { TenantStatus } from '../../tenants/tenant.entity';
import { AdminTenantsService } from './admin-tenants.service';

export const TRIAL_WORKSPACE_EXPIRY_TASK_NAME = 'trial-workspace-expiry';

/**
 * `tenants.deletion_reason` of a deletion started by this task. It also finds the tenants whose
 * deletion an interruption left halfway (deleting, or frozen by a failed purge): a fixed text.
 */
export const TRIAL_WORKSPACE_EXPIRY_REASON = 'Trial ended without a subscription (automatic deletion)';

/** Deletion attempts per run at most; the rest waits for the next day. */
export const TRIAL_WORKSPACE_EXPIRY_MAX_PER_RUN = 20;

export type TrialWorkspaceExpirySummary = {
  skipped?: string;
  candidates: number;
  deleted: string[];
  cancelled: string[];
  /** Due, but kept: Stripe holds a subscription or an open checkout for the customer. */
  kept: string[];
  deferred: number;
  /** Discovery calls whose note and date were erased (`eraseExpiredDiscoveryCall`). */
  discoveryCallsErased: number;
  errors: string[];
};

type CandidateRow = { id: string; slug: string; status: TenantStatus; stripe_customer_id: string | null };

/**
 * Daily, cloud only: deletes the workspaces whose trial ended more than
 * TRIAL_WORKSPACE_RETENTION_DAYS days ago without a subscription (`computeTrialDeletionAt`),
 * through the platform-admin deletion path (`AdminTenantsService.deleteTenant`): same purge,
 * audit entries with a system origin. Never the system tenants nor the default tenant.
 *
 * A tenant with a Stripe customer is kept while Stripe holds a subscription or an open checkout
 * for it (a checkout writes nothing here until it is paid).
 *
 * Safe to stop at any point: the subscription row is read again, locked, in the purge
 * transaction; a tenant left deleting (or frozen by a failed purge) with this task's reason is
 * taken up again by the next run: deleted when still due or already purged, set back to active
 * otherwise.
 *
 * Each run first erases the note and the date of the discovery call of the subscribed workspaces
 * DISCOVERY_CALL_RETENTION_DAYS days after the call, billing configured or not: one short
 * transaction per live tenant, under its row-level security.
 */
@Injectable()
export class TrialWorkspaceExpiryService implements OnModuleInit {
  private readonly logger = new Logger(TrialWorkspaceExpiryService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly scheduledTasks: ScheduledTasksService,
    private readonly adminTenants: AdminTenantsService,
    private readonly stripeConfig: StripeConfigService,
    private readonly stripeClient: StripeClientService,
  ) {}

  onModuleInit() {
    if (Features.SINGLE_TENANT) return;
    this.scheduledTasks.register({
      name: TRIAL_WORKSPACE_EXPIRY_TASK_NAME,
      description: `Deletes the workspaces whose trial ended more than ${TRIAL_WORKSPACE_RETENTION_DAYS} days ago without a subscription; `
        + `erases the discovery call note and date of subscribed workspaces ${DISCOVERY_CALL_RETENTION_DAYS} days after the call`,
      defaultCron: '15 4 * * *',
      handler: () => this.run(),
    });
  }

  /**
   * `tenantIds` limits the run to these tenants (specs share their database with other tenants).
   * Throws at the end when a tenant failed, so the run is recorded as failed; the others went on.
   */
  async run(opts?: { now?: Date; tenantIds?: string[]; maxPerRun?: number }): Promise<TrialWorkspaceExpirySummary> {
    const summary: TrialWorkspaceExpirySummary = {
      candidates: 0, deleted: [], cancelled: [], kept: [], deferred: 0, discoveryCallsErased: 0, errors: [],
    };
    const clock = opts?.now ?? new Date();
    if (!Features.SINGLE_TENANT) await this.eraseDiscoveryCalls(clock, opts?.tenantIds, summary);
    if (!this.billingEnforced()) {
      summary.skipped = 'Billing is not configured: trials are not enforced';
      return this.finish(summary);
    }
    const now = clock.getTime();
    const maxPerRun = opts?.maxPerRun ?? TRIAL_WORKSPACE_EXPIRY_MAX_PER_RUN;
    let attempts = 0;

    for (const tenant of await this.candidates(opts?.tenantIds)) {
      try {
        const subscription = await withTenant(this.dataSource, tenant.id, (manager) => this.readSubscription(manager, tenant.id, false));
        const due = this.isDue(tenant, subscription, now);
        // A deletion this task left halfway goes through deleteTenant even when no longer due:
        // its re-check then sets the tenant back to active.
        if (!due && tenant.status === TenantStatus.ACTIVE) continue;
        summary.candidates += 1;
        if (attempts >= maxPerRun) {
          summary.deferred += 1;
          continue;
        }
        attempts += 1;

        const customerId = subscription?.stripe_customer_id ?? tenant.stripe_customer_id;
        const blocker = due && customerId ? await this.stripeBlocker(customerId) : null;
        if (blocker) {
          summary.kept.push(tenant.slug);
          this.logger.warn(`[${TRIAL_WORKSPACE_EXPIRY_TASK_NAME}] Kept ${tenant.slug} (${tenant.id}): ${blocker}`);
          continue;
        }

        const result = await this.adminTenants.deleteTenant(
          tenant.id,
          null,
          { confirmSlug: tenant.slug, reason: TRIAL_WORKSPACE_EXPIRY_REASON },
          {
            origin: { source: 'system', sourceRef: TRIAL_WORKSPACE_EXPIRY_TASK_NAME },
            stillDue: async (manager) => this.isDue(tenant, await this.readSubscription(manager, tenant.id, true), now),
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
    return this.finish(summary);
  }

  private finish(summary: TrialWorkspaceExpirySummary): TrialWorkspaceExpirySummary {
    if (summary.errors.length > 0) {
      throw new Error(
        `${summary.errors.length} failure(s), ${summary.deleted.length} deleted: ${summary.errors.join(' | ')}`,
      );
    }
    return summary;
  }

  /** Every live tenant (or `tenantIds`), one transaction each; a failure is recorded, the others go on. */
  private async eraseDiscoveryCalls(now: Date, tenantIds: string[] | undefined, summary: TrialWorkspaceExpirySummary) {
    const tenants: Array<{ id: string; slug: string }> = await this.dataSource.query(
      `SELECT id, slug FROM tenants
        WHERE deleted_at IS NULL AND ($1::uuid[] IS NULL OR id = ANY($1::uuid[]))
        ORDER BY created_at ASC, id ASC`,
      [tenantIds ?? null],
    );
    for (const tenant of tenants) {
      try {
        summary.discoveryCallsErased += await withTenant(
          this.dataSource,
          tenant.id,
          (manager) => eraseExpiredDiscoveryCall(manager, tenant.id, now),
        );
      } catch (error: any) {
        const message = `discovery call of ${tenant.slug} (${tenant.id}): ${error?.message || String(error)}`;
        summary.errors.push(message);
        this.logger.error(`[${TRIAL_WORKSPACE_EXPIRY_TASK_NAME}] Erasure failed for ${message}`);
      }
    }
    if (summary.discoveryCallsErased > 0) {
      this.logger.log(`[${TRIAL_WORKSPACE_EXPIRY_TASK_NAME}] ${summary.discoveryCallsErased} discovery call note(s) and date(s) erased`);
    }
  }

  private billingEnforced(): boolean {
    return !Features.SINGLE_TENANT && this.stripeConfig.isConfigured();
  }

  /**
   * Active tenants, and the tenants this task left halfway: deleting, or frozen by a failed purge
   * (a platform administrator's freeze sets `frozen_at`; a failed purge does not). Oldest first.
   */
  private candidates(tenantIds?: string[]): Promise<CandidateRow[]> {
    const defaultSlug = (process.env.DEFAULT_TENANT_SLUG || 'default').trim();
    return this.dataSource.query(
      `SELECT id, slug, status, stripe_customer_id
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

  /** `lock`: held until the purge transaction ends, so a subscription written meanwhile waits for it. */
  private readSubscription(manager: EntityManager, tenantId: string, lock: boolean): Promise<Subscription | null> {
    return manager.getRepository(Subscription).findOne({
      where: { tenant_id: tenantId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
  }

  /**
   * Whether the tenant is due. A tenant this task left halfway (deleting, or frozen by a purge
   * whose commit reported an error) with no subscription row any more had its purge committed:
   * it is due, to be marked deleted.
   */
  private isDue(tenant: CandidateRow, subscription: Subscription | null, now: number): boolean {
    if (!subscription) return tenant.status !== TenantStatus.ACTIVE;
    const deletionAt = computeTrialDeletionAt(subscription, this.billingEnforced());
    return deletionAt != null && deletionAt.getTime() <= now;
  }

  /**
   * What Stripe holds for the customer that rules the deletion out: a subscription that is not an
   * expired first payment, or a checkout still open (it gets its subscription only once paid, up
   * to a day later). Null when nothing; throws when Stripe cannot be read (the tenant is kept).
   */
  private async stripeBlocker(customerId: string): Promise<string | null> {
    const stripe = this.stripeClient.getClient();
    if (!stripe) throw new Error('Stripe client unavailable');
    const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
    const live = (subscriptions.data ?? []).find((sub: { status: string }) => sub.status !== 'incomplete_expired');
    if (live) return `Stripe subscription ${live.id} (${live.status})`;
    const sessions = await stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 1 });
    if ((sessions.data ?? []).length > 0) return `open Stripe checkout ${sessions.data[0].id}`;
    return null;
  }
}
