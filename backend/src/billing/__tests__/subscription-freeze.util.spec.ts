import * as assert from 'node:assert/strict';
import { CollectionMethod, Subscription, SubscriptionStatus } from '../subscription.entity';
import { computeFreezeEffectiveAt, computeTrialDeletionAt, evaluateSubscriptionAccess } from '../subscription-freeze.util';
import { BillingService } from '../billing.service';

const DAY_MS = 86400000;
const NOW = new Date('2026-07-05T00:00:00.000Z').getTime();

function sub(partial: Partial<Subscription>): Subscription {
  return {
    tenant_id: 'tenant-1',
    status: SubscriptionStatus.ACTIVE,
    collection_method: CollectionMethod.CHARGE_AUTOMATICALLY,
    ...partial,
  } as Subscription;
}

function testUnconfiguredAlwaysAllowed() {
  // On-prem / single-tenant: no billing configured -> AI never blocked,
  // regardless of subscription (including none).
  assert.equal(evaluateSubscriptionAccess(null, NOW, false).allowed, true);
  assert.equal(
    evaluateSubscriptionAccess(sub({ status: SubscriptionStatus.PAST_DUE }), NOW, false).allowed,
    true,
  );
}

function testMissingSubscriptionIsFrozen() {
  const d = evaluateSubscriptionAccess(null, NOW, true);
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'SUBSCRIPTION_FROZEN');
}

function testActiveAllowed() {
  assert.equal(evaluateSubscriptionAccess(sub({ status: SubscriptionStatus.ACTIVE }), NOW, true).allowed, true);
}

function testTrialing() {
  const active = evaluateSubscriptionAccess(
    sub({ status: SubscriptionStatus.TRIALING, trial_end: new Date(NOW + DAY_MS) }),
    NOW,
    true,
  );
  assert.equal(active.allowed, true);

  const expired = evaluateSubscriptionAccess(
    sub({ status: SubscriptionStatus.TRIALING, trial_end: new Date(NOW - DAY_MS) }),
    NOW,
    true,
  );
  assert.equal(expired.allowed, false);
  assert.equal(expired.reason, 'TRIAL_EXPIRED');
}

function testPastDueGraceWindow() {
  // Within grace: current_period_end 1 day ago + 14 day grace -> still allowed.
  const withinGrace = evaluateSubscriptionAccess(
    sub({ status: SubscriptionStatus.PAST_DUE, current_period_end: new Date(NOW - DAY_MS) }),
    NOW,
    true,
  );
  assert.equal(withinGrace.allowed, true);

  // Past grace: current_period_end 20 days ago + 14 day grace -> frozen.
  const frozen = evaluateSubscriptionAccess(
    sub({ status: SubscriptionStatus.PAST_DUE, current_period_end: new Date(NOW - 20 * DAY_MS) }),
    NOW,
    true,
  );
  assert.equal(frozen.allowed, false);
  assert.equal(frozen.reason, 'SUBSCRIPTION_FROZEN');
}

function testUnknownStatusFrozen() {
  const d = evaluateSubscriptionAccess(sub({ status: 'canceled' as SubscriptionStatus }), NOW, true);
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'SUBSCRIPTION_FROZEN');
}

function testComputeFreezeInvoiceBased() {
  const at = computeFreezeEffectiveAt(sub({
    collection_method: CollectionMethod.SEND_INVOICE,
    latest_invoice_created: new Date(NOW),
    days_until_due: 7,
  }));
  assert.equal(at, NOW + 7 * DAY_MS + 14 * DAY_MS);
}

/** The row a Stripe refresh stores for `stripeSub` (the billing page forces one on each view). */
async function storedAfterRefresh(stripeSub: unknown): Promise<Subscription> {
  const row = sub({ stripe_subscription_id: 'sub_1', status: SubscriptionStatus.ACTIVE });
  const manager = { getRepository: () => ({ save: async (data: Subscription) => data }) };
  const client = { subscriptions: { retrieve: async () => stripeSub } };
  const service = new BillingService(
    {} as any,
    {} as any,
    {} as any,
    { getClient: () => client } as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return (service as any).refreshSubscriptionFromStripe(row, manager);
}

async function testPastDueCloverSubscriptionKeepsItsGrace() {
  // 2025-09-30.clover: the period is on the subscription item. A card subscription that
  // goes past due one day after its period end still has 13 days of grace.
  const periodEnd = NOW - DAY_MS;
  const stored = await storedAfterRefresh({
    id: 'sub_1',
    status: 'past_due',
    collection_method: 'charge_automatically',
    items: { data: [{ quantity: 1, current_period_start: (periodEnd - 30 * DAY_MS) / 1000, current_period_end: periodEnd / 1000 }] },
  });
  assert.equal(stored.status, SubscriptionStatus.PAST_DUE);
  assert.equal(computeFreezeEffectiveAt(stored), periodEnd + 14 * DAY_MS);
  assert.equal(evaluateSubscriptionAccess(stored, NOW, true).allowed, true);
}

function testTrialDeletionDate() {
  const trialEnd = new Date(NOW - 3 * DAY_MS);
  const trial = (partial: Partial<Subscription> = {}) =>
    sub({ status: SubscriptionStatus.TRIALING, trial_end: trialEnd, stripe_subscription_id: null, ...partial });

  // A local trial: its end plus 30 days, whether the trial is over or not.
  assert.equal(computeTrialDeletionAt(trial(), true)?.getTime(), trialEnd.getTime() + 30 * DAY_MS);
  const running = new Date(NOW + 5 * DAY_MS);
  assert.equal(computeTrialDeletionAt(trial({ trial_end: running }), true)?.getTime(), running.getTime() + 30 * DAY_MS);

  // No billing (on-premise), no subscription, no trial end: no date.
  assert.equal(computeTrialDeletionAt(trial(), false), null);
  assert.equal(computeTrialDeletionAt(null, true), null);
  assert.equal(computeTrialDeletionAt(trial({ trial_end: null }), true), null);

  // Subscribed (a Stripe trial included), reactivated, paid then canceled or frozen: never.
  assert.equal(computeTrialDeletionAt(trial({ stripe_subscription_id: 'sub_1' }), true), null);
  for (const status of [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE, SubscriptionStatus.CANCELED, SubscriptionStatus.UNPAID, SubscriptionStatus.INCOMPLETE_EXPIRED, null]) {
    assert.equal(computeTrialDeletionAt(trial({ status: status as any }), true), null, `status ${status}`);
  }
  // Set back to trialing by hand: any trace of a subscription, or another plan name, keeps it.
  assert.equal(computeTrialDeletionAt(trial({ latest_invoice_id: 'in_1' }), true), null);
  assert.equal(computeTrialDeletionAt(trial({ current_period_end: new Date(NOW - 60 * DAY_MS) }), true), null);
  assert.equal(computeTrialDeletionAt(trial({ canceled_at: new Date(NOW - 60 * DAY_MS) }), true), null);
  assert.equal(computeTrialDeletionAt(trial({ plan_name: 'Internal' }), true), null);
  assert.equal(computeTrialDeletionAt(trial({ plan_name: 'Hosted KANAP' }), true), null);
  assert.ok(computeTrialDeletionAt(trial({ plan_name: 'Trial' }), true));
}

async function run() {
  testUnconfiguredAlwaysAllowed();
  testMissingSubscriptionIsFrozen();
  testActiveAllowed();
  testTrialing();
  testPastDueGraceWindow();
  testUnknownStatusFrozen();
  testComputeFreezeInvoiceBased();
  await testPastDueCloverSubscriptionKeepsItsGrace();
  testTrialDeletionDate();
  // eslint-disable-next-line no-console
  console.log('subscription-freeze.util.spec: all assertions passed');
}

void run();
