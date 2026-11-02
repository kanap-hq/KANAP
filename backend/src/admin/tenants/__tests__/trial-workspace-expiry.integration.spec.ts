import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../../data-source';
import { TRIAL_WORKSPACE_RETENTION_DAYS } from '../../../billing/plans.config';
import { TenantStatus } from '../../../tenants/tenant.entity';
import {
  TRIAL_WORKSPACE_EXPIRY_REASON,
  TRIAL_WORKSPACE_EXPIRY_TASK_NAME,
  TrialWorkspaceExpiryService,
} from '../trial-workspace-expiry.service';
import { buildServices, cleanupTenants, inTenant, runSpecs, Services } from './tenant-reset-test-helpers';

// The daily deletion of expired trials (TrialWorkspaceExpiryService) against a real database:
// which workspaces go, the cap per run, the resumption after an interruption, a subscription that
// arrives between the selection and the purge. The tenants are committed (the services open
// their own connections), the runs are limited to them, and they are removed at the end.

const DAY_MS = 86400000;
const NOW = new Date();
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

type SeedOptions = {
  tag: string;
  status?: TenantStatus;
  isSystem?: boolean;
  slug?: string;
  frozenAt?: Date | null;
  deletionReason?: string | null;
  /** Its subscription row (one per tenant), or none. */
  subscriptions?: Array<{ status: string | null; trialEnd?: Date | null; stripeSubscriptionId?: string | null; planName?: string }>;
  withData?: boolean;
};

function expiryService(svc: Services, billingConfigured = true) {
  return new TrialWorkspaceExpiryService(
    dataSource,
    { register: () => undefined } as any,
    svc.admin,
    { isConfigured: () => billingConfigured } as any,
  );
}

async function seedTenant(opts: SeedOptions): Promise<string> {
  const id = randomUUID();
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, is_system_tenant, frozen_at, deletion_reason, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [
      id,
      opts.slug ?? `trx-${opts.tag}-${id.slice(0, 8)}`,
      `Trial expiry ${opts.tag}`,
      opts.status ?? TenantStatus.ACTIVE,
      opts.isSystem ?? false,
      opts.frozenAt ?? null,
      opts.deletionReason ?? null,
    ],
  );
  // A failed seed removes its tenant row: the caller never got the id to clean it up.
  await inTenant(id, async (manager) => {
    for (const sub of opts.subscriptions ?? []) {
      await manager.query(
        `INSERT INTO subscriptions (tenant_id, status, trial_end, stripe_subscription_id, plan_name, seat_limit, active_seats)
         VALUES ($1, $2, $3, $4, $5, NULL, 0)`,
        [id, sub.status, sub.trialEnd ?? null, sub.stripeSubscriptionId ?? null, sub.planName ?? 'Trial'],
      );
    }
    if (opts.withData) {
      await manager.query(
        `INSERT INTO audit_log (tenant_id, table_name, record_id, action, source) VALUES ($1, 'spec_marker', $1, 'update', 'user')`,
        [id],
      );
    }
  }).catch(async (error) => {
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [id]);
    throw error;
  });
  return id;
}

const trialEndedDaysAgo = (days: number) => [{ status: 'trialing', trialEnd: daysAgo(days) }];

async function tenantRow(id: string) {
  const [row] = await dataSource.query(
    `SELECT slug, status, deleted_at, deletion_reason, deletion_requested_at FROM tenants WHERE id = $1`,
    [id],
  );
  return row;
}

async function subscriptionCount(id: string): Promise<number> {
  const [row] = await inTenant(id, (manager) => manager.query(`SELECT count(*)::int AS n FROM subscriptions WHERE tenant_id = $1`, [id]));
  return row.n;
}

async function auditOf(id: string) {
  return inTenant(id, (manager) => manager.query(
    `SELECT table_name, action, source, source_ref, user_id, after_json->>'status' AS status
       FROM audit_log WHERE tenant_id = $1 AND table_name = 'tenants_admin' ORDER BY created_at, id`,
    [id],
  ));
}

// Spec 1: only the workspaces whose trial ended more than 30 days ago go; every other case stays.
async function testSelection() {
  const svc = buildServices();
  const previousDefault = process.env.DEFAULT_TENANT_SLUG;
  const defaultSlug = `trx-default-${randomUUID().slice(0, 8)}`;
  process.env.DEFAULT_TENANT_SLUG = defaultSlug;
  const ids: Record<string, string> = {};
  try {
    ids.running = await seedTenant({ tag: 'running', subscriptions: [{ status: 'trialing', trialEnd: new Date(NOW.getTime() + 5 * DAY_MS) }] });
    ids.ended29 = await seedTenant({ tag: 'ended29', subscriptions: trialEndedDaysAgo(TRIAL_WORKSPACE_RETENTION_DAYS - 1) });
    ids.ended31 = await seedTenant({ tag: 'ended31', subscriptions: trialEndedDaysAgo(TRIAL_WORKSPACE_RETENTION_DAYS + 1), withData: true });
    ids.subscribed = await seedTenant({ tag: 'subscribed', subscriptions: [{ status: 'active', stripeSubscriptionId: 'sub_spec_1', planName: 'Hosted KANAP' }] });
    ids.stripeTrial = await seedTenant({ tag: 'stripetrial', subscriptions: [{ status: 'trialing', trialEnd: daysAgo(40), stripeSubscriptionId: 'sub_spec_2' }] });
    ids.reactivated = await seedTenant({ tag: 'reactivated', subscriptions: [{ status: 'active', planName: 'Internal' }] });
    ids.canceled = await seedTenant({ tag: 'canceled', subscriptions: [{ status: 'canceled', trialEnd: daysAgo(90), stripeSubscriptionId: 'sub_spec_3' }] });
    ids.pastDue = await seedTenant({ tag: 'pastdue', subscriptions: [{ status: 'past_due', stripeSubscriptionId: 'sub_spec_4' }] });
    ids.noSubscription = await seedTenant({ tag: 'nosub' });
    ids.noTrialEnd = await seedTenant({ tag: 'noend', subscriptions: [{ status: 'trialing', trialEnd: null }] });
    ids.adminFrozen = await seedTenant({ tag: 'frozen', status: TenantStatus.FROZEN, frozenAt: daysAgo(2), subscriptions: trialEndedDaysAgo(40) });
    ids.system = await seedTenant({ tag: 'system', isSystem: true, subscriptions: trialEndedDaysAgo(40) });
    ids.defaultTenant = await seedTenant({ tag: 'default', slug: defaultSlug, subscriptions: trialEndedDaysAgo(40) });

    const scope = Object.values(ids);
    const ended31Slug = (await tenantRow(ids.ended31)).slug;

    // Without billing (no trial lock), nothing happens.
    const idle = await expiryService(svc, false).run({ tenantIds: scope });
    assert.ok(idle.skipped);
    assert.equal((await tenantRow(ids.ended31)).status, TenantStatus.ACTIVE);

    const summary = await expiryService(svc).run({ tenantIds: scope });
    assert.deepEqual(summary.errors, []);
    assert.deepEqual(summary.deleted, [ended31Slug]);
    assert.equal(summary.candidates, 1);
    assert.equal(summary.deferred, 0);

    const deleted = await tenantRow(ids.ended31);
    assert.equal(deleted.status, TenantStatus.DELETED);
    assert.ok(deleted.deleted_at);
    assert.equal(deleted.deletion_reason, TRIAL_WORKSPACE_EXPIRY_REASON);
    assert.equal(await subscriptionCount(ids.ended31), 0, 'the purge ran');
    const audit = await auditOf(ids.ended31);
    assert.deepEqual(
      audit.map((row: any) => [row.action, row.source, row.source_ref, row.user_id, row.status]),
      [['update', 'system', TRIAL_WORKSPACE_EXPIRY_TASK_NAME, null, TenantStatus.DELETED]],
      'the completion entry survives the purge, with a system origin',
    );

    for (const [name, id] of Object.entries(ids)) {
      if (name === 'ended31') continue;
      const row = await tenantRow(id);
      assert.equal(row.deleted_at, null, `${name} is kept`);
      assert.equal(row.deletion_requested_at, null, `${name} was never marked`);
    }

    // A second run finds nothing more.
    const again = await expiryService(svc).run({ tenantIds: scope });
    assert.deepEqual([again.deleted, again.candidates], [[], 0]);
  } finally {
    if (previousDefault === undefined) delete process.env.DEFAULT_TENANT_SLUG;
    else process.env.DEFAULT_TENANT_SLUG = previousDefault;
    await cleanupTenants(Object.values(ids));
  }
}

// Spec 2: at most `maxPerRun` deletions per run, the oldest tenants first; the rest goes next time.
async function testCapPerRun() {
  const svc = buildServices();
  const ids: string[] = [];
  try {
    for (let i = 0; i < 3; i += 1) {
      ids.push(await seedTenant({ tag: `cap${i}`, subscriptions: trialEndedDaysAgo(45) }));
    }
    const first = await expiryService(svc).run({ tenantIds: ids, maxPerRun: 2 });
    assert.deepEqual([first.deleted.length, first.deferred, first.candidates], [2, 1, 3]);
    const statuses = await Promise.all(ids.map(async (id) => (await tenantRow(id)).status));
    assert.equal(statuses.filter((status) => status === TenantStatus.DELETED).length, 2);

    const second = await expiryService(svc).run({ tenantIds: ids, maxPerRun: 2 });
    assert.deepEqual([second.deleted.length, second.deferred], [1, 0]);
    for (const id of ids) assert.equal((await tenantRow(id)).status, TenantStatus.DELETED);
  } finally {
    await cleanupTenants(ids);
  }
}

// Spec 3: a deletion this task left halfway is finished by the next run.
async function testResumption() {
  const svc = buildServices();
  const ids: Record<string, string> = {};
  try {
    // Stopped before or during the purge (rolled back): still deleting, rows still there.
    ids.beforePurge = await seedTenant({
      tag: 'beforepurge', status: TenantStatus.DELETING, deletionReason: TRIAL_WORKSPACE_EXPIRY_REASON, subscriptions: trialEndedDaysAgo(35),
    });
    // Stopped after the purge's commit: still deleting, no subscription row any more.
    ids.afterPurge = await seedTenant({ tag: 'afterpurge', status: TenantStatus.DELETING, deletionReason: TRIAL_WORKSPACE_EXPIRY_REASON });
    // A failed purge (frozen, without frozen_at): tried again.
    ids.failed = await seedTenant({
      tag: 'failed', status: TenantStatus.FROZEN, deletionReason: TRIAL_WORKSPACE_EXPIRY_REASON, subscriptions: trialEndedDaysAgo(35),
    });
    // Deleting for another reason (a platform administrator's deletion): not this task's.
    ids.adminDeleting = await seedTenant({ tag: 'admindel', status: TenantStatus.DELETING, deletionReason: 'Closed', subscriptions: trialEndedDaysAgo(35) });
    // Left deleting by this task, but reactivated meanwhile: cancelled, set back to active.
    ids.reactivated = await seedTenant({
      tag: 'react', status: TenantStatus.DELETING, deletionReason: TRIAL_WORKSPACE_EXPIRY_REASON, subscriptions: [{ status: 'active', planName: 'Internal' }],
    });

    const summary = await expiryService(svc).run({ tenantIds: Object.values(ids) });
    assert.deepEqual(summary.errors, []);
    assert.equal(summary.deleted.length, 3);
    for (const name of ['beforePurge', 'afterPurge', 'failed']) {
      assert.equal((await tenantRow(ids[name])).status, TenantStatus.DELETED, `${name} is deleted`);
    }
    assert.equal((await tenantRow(ids.adminDeleting)).status, TenantStatus.DELETING, 'another deletion is left alone');
    assert.equal(await subscriptionCount(ids.adminDeleting), 1);
    // Not due: never selected for deletion, so it stays as it is for a person to look at.
    assert.equal((await tenantRow(ids.reactivated)).status, TenantStatus.DELETING);
    assert.equal(await subscriptionCount(ids.reactivated), 1);
  } finally {
    await cleanupTenants(Object.values(ids));
  }
}

// Spec 4: a subscription written between the selection and the purge stops the deletion.
async function testSubscribedMeanwhile() {
  const svc = buildServices();
  const ids: string[] = [];
  try {
    const id = await seedTenant({ tag: 'meanwhile', subscriptions: trialEndedDaysAgo(40), withData: true });
    ids.push(id);
    const service = expiryService(svc);
    const deleteTenant = svc.admin.deleteTenant.bind(svc.admin);
    (svc.admin as any).deleteTenant = async (...args: Parameters<typeof deleteTenant>) => {
      await inTenant(id, (manager) => manager.query(
        `UPDATE subscriptions SET status = 'active', stripe_subscription_id = 'sub_spec_late' WHERE tenant_id = $1`,
        [id],
      ));
      return deleteTenant(...args);
    };

    const summary = await service.run({ tenantIds: ids });
    assert.deepEqual([summary.deleted, summary.cancelled.length, summary.errors], [[], 1, []]);
    const row = await tenantRow(id);
    assert.equal(row.status, TenantStatus.ACTIVE);
    assert.equal(row.deletion_reason, null);
    assert.equal(row.deletion_requested_at, null);
    assert.equal(await subscriptionCount(id), 1, 'nothing was purged');
    const [marker] = await inTenant(id, (manager) => manager.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND table_name = 'spec_marker'`, [id],
    ));
    assert.equal(marker.n, 1);
    const audit = await auditOf(id);
    assert.deepEqual(
      audit.map((entry: any) => [entry.source, entry.source_ref, entry.status]),
      [['system', TRIAL_WORKSPACE_EXPIRY_TASK_NAME, TenantStatus.DELETING], ['system', TRIAL_WORKSPACE_EXPIRY_TASK_NAME, TenantStatus.ACTIVE]],
    );
  } finally {
    await cleanupTenants(ids);
  }
}

void runSpecs('trial-workspace-expiry.integration.spec', [
  testSelection,
  testCapPerRun,
  testResumption,
  testSubscribedMeanwhile,
]);
