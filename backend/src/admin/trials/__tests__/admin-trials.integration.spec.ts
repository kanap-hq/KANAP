import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../../data-source';
import {
  ActivatedTenant,
  buildServices,
  cleanupTenants,
  createActivatedTenant,
  inTenant,
  refusal,
  runSpecs,
} from '../../tenants/__tests__/tenant-reset-test-helpers';
import { DiscoveryCallService } from '../../../discovery-call/discovery-call.service';
import { AdminTrialsService, TrialFunnelRow } from '../admin-trials.service';

// The trial funnel (`doc/trial-funnel.md`) on the spec database: each milestone read from the audit
// log and the tables that hold it, events made up at known instants; the 24-hour alert and the
// order; the state filter; the discovery call set by hand.
// @database-spec: opens the data-source, so run-ci-tests.js runs it on a database lane.

const HOUR = 3600_000;
const DAY = 24 * HOUR;

const service = () => new AdminTrialsService(dataSource, new DiscoveryCallService(dataSource));

/** The sign-up of the tenant, activated at `activatedAt`. */
async function activatedAt(t: ActivatedTenant, at: Date) {
  await dataSource.query(`UPDATE trial_signups SET activated_at = $2, created_at = $2 WHERE slug = $1`, [t.slug, at]);
}

async function audit(t: ActivatedTenant, at: Date, entry: { table: string; action: string; source?: string; userId?: string | null; after?: unknown }) {
  await inTenant(t.tenantId, (m) => m.query(
    `INSERT INTO audit_log (tenant_id, table_name, record_id, action, after_json, user_id, source, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [t.tenantId, entry.table, randomUUID(), entry.action, entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.userId === undefined ? t.ownerId : entry.userId, entry.source ?? 'user', at],
  ));
}

const signIn = (t: ActivatedTenant, at: Date) => audit(t, at, { table: 'auth', action: 'login' });

async function rowOf(slug: string, query: { state?: string } = {}, now?: Date): Promise<TrialFunnelRow | undefined> {
  const funnel = await service().list(query, now);
  return funnel.items.find((item) => item.slug === slug);
}

async function testMilestones() {
  const svc = buildServices();
  let t: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'tf-mile', orgName: 'Funnel Milestones', signup: true });
    const t0 = new Date(Date.now() - 10 * DAY);
    const at = (ms: number) => new Date(t0.getTime() + ms);
    await activatedAt(t, t0);
    await dataSource.query(`UPDATE trial_signups SET first_name = 'Ada', last_name = 'Lovelace' WHERE slug = $1`, [t.slug]);
    // The sample data loads in the person's name for half an hour.
    await dataSource.query(
      `UPDATE tenants SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{demo}', $2::jsonb) WHERE id = $1`,
      [t.tenantId, JSON.stringify({ status: 'loaded', ever_loaded_at: at(30 * 60_000).toISOString(), loaded_at: at(30 * 60_000).toISOString() })],
    );
    await audit(t, at(10 * 60_000), { table: 'applications', action: 'create' });
    await audit(t, at(12 * 60_000), { table: 'spend_items', action: 'create', source: 'budget_file' });

    await signIn(t, at(HOUR));
    await audit(t, at(2 * HOUR), { table: 'technologies', action: 'create', source: 'system', userId: null });
    await audit(t, at(3 * HOUR), { table: 'applications', action: 'create' });
    await audit(t, at(5 * HOUR), { table: 'spend_items', action: 'create', source: 'budget_file' });
    await audit(t, at(6 * HOUR), { table: 'users', action: 'update', after: { status: 'invited' } });
    await audit(t, at(2 * DAY), { table: 'onboarding', action: 'onboarding.step_done', after: { step_key: 'budget_line' } });
    await signIn(t, at(8 * DAY));
    await inTenant(t.tenantId, async (m) => {
      const [conversation] = await m.query(`INSERT INTO ai_conversations (tenant_id, user_id) VALUES ($1, $2) RETURNING id`, [t!.tenantId, t!.ownerId]);
      await m.query(
        `INSERT INTO ai_messages (conversation_id, tenant_id, role, content, created_at) VALUES ($1, $2, 'assistant', 'Hello', $3), ($1, $2, 'user', 'How?', $4)`,
        [conversation.id, t!.tenantId, at(3 * HOUR + 1000), at(4 * HOUR)],
      );
      await m.query(`INSERT INTO tenant_onboarding (tenant_id, angle, mode, chosen_at) VALUES ($1, 'budget', 'example', $2)`, [t!.tenantId, at(HOUR)]);
      for (const key of ['budget_overview', 'budget_line', 'budget_report', 'own_company']) {
        await m.query(
          `INSERT INTO onboarding_steps (tenant_id, user_id, angle, mode, step_key) VALUES ($1, $2, 'budget', $3, $4)`,
          [t!.tenantId, t!.ownerId, key === 'own_company' ? 'own_data' : 'example', key],
        );
      }
      await new DiscoveryCallService(dataSource).recordClick(m, t!.tenantId, t!.ownerId, 'last_step');
      await new DiscoveryCallService(dataSource).recordClick(m, t!.tenantId, t!.ownerId, 'about');
    });

    const row = await rowOf(t.slug);
    assert.ok(row, 'the sign-up has its row');
    const date = (value: string | null) => (value ? new Date(value).getTime() : null);
    assert.equal(row!.tenant_id, t.tenantId);
    assert.equal(row!.contact_name, 'Ada Lovelace');
    assert.equal(row!.state, 'trialing');
    assert.equal(row!.needs_attention, false);
    assert.equal(date(row!.activated_at), t0.getTime());
    assert.equal(date(row!.first_sign_in_at), at(HOUR).getTime(), 'first sign-in');
    assert.equal(date(row!.last_sign_in_at), at(8 * DAY).getTime(), 'last sign-in');
    assert.equal(date(row!.back_after_1_day_at), at(2 * DAY).getTime(), 'back after a day: the step done on day two');
    assert.equal(date(row!.back_after_7_days_at), at(8 * DAY).getTime(), 'back after a week: the sign-in of day eight');
    assert.equal(date(row!.sample_data_loaded_at), at(30 * 60_000).getTime());
    assert.equal(date(row!.first_record_at), at(3 * HOUR).getTime(), 'neither the sample data nor a system creation');
    assert.equal(date(row!.first_import_at), at(5 * HOUR).getTime(), 'the budget file after the sample data');
    assert.equal(date(row!.first_invitation_at), at(6 * HOUR).getTime());
    assert.equal(date(row!.first_plaid_question_at), at(4 * HOUR).getTime(), 'the first question, not the answer');
    assert.deepEqual([row!.angle, row!.mode, row!.steps_done, row!.steps_total], ['budget', 'example', 3, 5]);
    assert.equal(row!.discovery_call_first_click?.placement, 'last_step', 'the first click');
    assert.equal(row!.discovery_call, null);
    assert.equal(row!.converted_at, null);

    await inTenant(t.tenantId, (m) => m.query(`UPDATE subscriptions SET stripe_subscription_id = 'sub_spec', status = 'active' WHERE tenant_id = $1`, [t!.tenantId]));
    await audit(t, at(9 * DAY), { table: 'subscriptions', action: 'update', source: 'webhook', userId: null, after: { status: 'active', stripe_subscription_id: 'sub_spec' } });
    const converted = await rowOf(t.slug);
    assert.equal(converted!.state, 'converted');
    assert.equal(date(converted!.converted_at), at(9 * DAY).getTime());
    assert.equal((await rowOf(t.slug, { state: 'trialing' })), undefined, 'the state filter');
    assert.ok(await rowOf(t.slug, { state: 'converted' }));
  } finally {
    await cleanupTenants([t?.tenantId]);
  }
}

async function testAttentionAndOrder() {
  const svc = buildServices();
  let silent: ActivatedTenant | undefined;
  let fresh: ActivatedTenant | undefined;
  const pendingSlug = `tf-pending-${randomUUID().slice(0, 8)}`;
  try {
    silent = await createActivatedTenant(svc, { tag: 'tf-silent', orgName: 'Funnel Silent', signup: true });
    fresh = await createActivatedTenant(svc, { tag: 'tf-fresh', orgName: 'Funnel Fresh', signup: true });
    await activatedAt(silent, new Date(Date.now() - 25 * HOUR));
    await activatedAt(fresh, new Date(Date.now() - 2 * HOUR));
    await dataSource.query(
      `INSERT INTO trial_signups (org_name, slug, email, created_at) VALUES ('Funnel Pending', $1, $2, now())`,
      [pendingSlug, `${pendingSlug}@funnel-spec.test`],
    );

    const funnel = await service().list();
    const bySlug = new Map(funnel.items.map((item) => [item.slug, item]));
    assert.equal(bySlug.get(silent.slug)?.needs_attention, true, 'no sign-in 25 hours after the activation');
    assert.equal(bySlug.get(fresh.slug)?.needs_attention, false, 'two hours: not yet');
    const pending = bySlug.get(pendingSlug);
    assert.deepEqual([pending?.state, pending?.tenant_id, pending?.needs_attention], ['awaiting_activation', null, false]);
    assert.ok(funnel.attention >= 1);
    const firstCalm = funnel.items.findIndex((item) => !item.needs_attention);
    assert.ok(funnel.items.slice(firstCalm).every((item) => !item.needs_attention), 'the workspaces to look at come first');
    assert.ok(funnel.items.indexOf(bySlug.get(silent.slug)!) < firstCalm);
    assert.ok(funnel.weeks[0].created >= 2, 'this week counts the new sign-ups');

    await signIn(silent, new Date());
    assert.equal((await rowOf(silent.slug))?.needs_attention, false, 'a sign-in clears it');
  } finally {
    await cleanupTenants([silent?.tenantId, fresh?.tenantId]);
    await dataSource.query(`DELETE FROM trial_signups WHERE slug = $1`, [pendingSlug]);
  }
}

async function testDiscoveryCallByHand() {
  const svc = buildServices();
  let t: ActivatedTenant | undefined;
  let other: ActivatedTenant | undefined;
  try {
    t = await createActivatedTenant(svc, { tag: 'tf-call', orgName: 'Funnel Call', signup: true });
    other = await createActivatedTenant(svc, { tag: 'tf-nosignup', orgName: 'Funnel No Signup' });
    const admin = randomUUID();

    const saved = await service().saveDiscoveryCall(t.tenantId, { scheduled_at: '2030-05-02T09:00:00Z', note: ' Teams ' }, admin);
    assert.deepEqual([saved.scheduled_at, saved.status, saved.source, saved.note], ['2030-05-02T09:00:00.000Z', 'booked', 'manual', 'Teams']);
    assert.equal((await rowOf(t.slug))?.discovery_call?.scheduled_at, '2030-05-02T09:00:00.000Z', 'the funnel shows it');

    const invalid = await refusal(() => service().saveDiscoveryCall(t!.tenantId, { scheduled_at: 'tomorrow' }, admin));
    assert.equal(invalid.getStatus?.(), 400);
    assert.equal(invalid.getResponse?.().code, 'discovery_call_invalid');

    const notTrial = await refusal(() => service().saveDiscoveryCall(other!.tenantId, { scheduled_at: '2030-05-02T09:00:00Z' }, admin));
    assert.equal(notTrial.getStatus?.(), 404, 'a workspace without a trial sign-up');
    const badId = await refusal(() => service().removeDiscoveryCall('not-an-id', admin));
    assert.equal(badId.getStatus?.(), 400);

    await service().removeDiscoveryCall(t.tenantId, admin);
    assert.equal((await rowOf(t.slug))?.discovery_call, null);
    const actions = await inTenant(t.tenantId, (m) => m.query(
      `SELECT action, user_id FROM audit_log WHERE tenant_id = $1 AND table_name = 'trial' ORDER BY created_at, id`,
      [t!.tenantId],
    ));
    assert.deepEqual(actions.map((row: any) => [row.action, row.user_id]), [
      ['trial.discovery_call_updated', admin],
      ['trial.discovery_call_removed', admin],
    ]);
  } finally {
    await cleanupTenants([t?.tenantId, other?.tenantId]);
  }
}

runSpecs('admin-trials', [testMilestones, testAttentionAndOrder, testDiscoveryCallByHand]).catch((err) => {
  console.error(err);
  process.exit(1);
});
