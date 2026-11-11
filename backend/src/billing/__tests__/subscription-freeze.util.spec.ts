import * as assert from 'node:assert/strict';
import { CollectionMethod, Subscription, SubscriptionStatus } from '../subscription.entity';
import { computeFreezeDate, computeFreezeEffectiveAt, computeTrialDeletionAt, evaluateSubscriptionAccess } from '../subscription-freeze.util';
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
  // Within grace: the unpaid invoice is 1 day old, 14 days of grace -> still allowed.
  const withinGrace = evaluateSubscriptionAccess(
    sub({ status: SubscriptionStatus.PAST_DUE, latest_invoice_created: new Date(NOW - DAY_MS) }),
    NOW,
    true,
  );
  assert.equal(withinGrace.allowed, true);

  // Past grace: the unpaid invoice is 20 days old -> frozen.
  const frozen = evaluateSubscriptionAccess(
    sub({ status: SubscriptionStatus.PAST_DUE, latest_invoice_created: new Date(NOW - 20 * DAY_MS) }),
    NOW,
    true,
  );
  assert.equal(frozen.allowed, false);
  assert.equal(frozen.reason, 'SUBSCRIPTION_FROZEN');
}

/**
 * One freeze rule (doc/architecture.md): 14 days after the unpaid invoice, after its due date
 * for a bank transfer. A card renewal refused on 10/11 freezes on 24/11, whatever the end of the
 * period Stripe has already opened (10/12 for a monthly, a year later for an annual).
 */
function testCardGraceStartsAtTheUnpaidInvoice() {
  const invoicedAt = new Date('2026-11-10T09:00:00.000Z');
  for (const periodEnd of ['2026-12-10T09:00:00.000Z', '2027-11-10T09:00:00.000Z']) {
    const at = computeFreezeEffectiveAt(sub({
      status: SubscriptionStatus.PAST_DUE,
      latest_invoice_created: invoicedAt,
      current_period_start: invoicedAt,
      current_period_end: new Date(periodEnd),
      days_until_due: null,
    }));
    assert.equal(at, new Date('2026-11-24T09:00:00.000Z').getTime(), `period ending ${periodEnd}`);
  }
  // No invoice date stored: the start of the period the unpaid renewal opened.
  assert.equal(
    computeFreezeEffectiveAt(sub({ current_period_start: invoicedAt, current_period_end: new Date('2026-12-10T09:00:00.000Z') })),
    new Date('2026-11-24T09:00:00.000Z').getTime(),
  );
  assert.equal(computeFreezeEffectiveAt(sub({})), null);
}

/**
 * A stale invoice date: the row still holds the previous, paid invoice (the subscription could
 * not be read again while the new invoice's events came) and is past due. The grace starts at
 * the start of the period the unpaid renewal opened, the later of the two dates.
 */
function testStaleInvoiceDateUsesThePeriodStart() {
  const periodStart = new Date('2026-11-10T09:00:00.000Z');
  for (const previousInvoice of ['2026-10-10T09:00:00.000Z', '2025-11-10T09:00:00.000Z']) {
    const stale = sub({
      status: SubscriptionStatus.PAST_DUE,
      latest_invoice_created: new Date(previousInvoice),
      current_period_start: periodStart,
    });
    assert.equal(computeFreezeEffectiveAt(stale), new Date('2026-11-24T09:00:00.000Z').getTime(), `previous invoice of ${previousInvoice}`);
    assert.equal(evaluateSubscriptionAccess(stale, new Date('2026-11-11T09:00:00.000Z').getTime(), true).allowed, true);
  }
}

/**
 * The freeze date of the summary: ahead or passed while past due; for an ended subscription its
 * end, or the end of the grace of an invoice left unpaid when earlier; for unpaid, the end of the
 * grace once passed; none for a subscription in good standing.
 */
function testFreezeDateOfTheSummary() {
  const invoicedAt = new Date(NOW - 3 * DAY_MS);
  const graceEnd = invoicedAt.getTime() + 14 * DAY_MS;
  assert.equal(computeFreezeDate(sub({ status: SubscriptionStatus.ACTIVE, latest_invoice_created: invoicedAt }), NOW), null);
  assert.equal(computeFreezeDate(sub({ status: SubscriptionStatus.TRIALING, trial_end: new Date(NOW - DAY_MS) }), NOW), null);
  assert.equal(computeFreezeDate(sub({ status: SubscriptionStatus.PAST_DUE, latest_invoice_created: invoicedAt }), NOW), graceEnd);

  // Unpaid: Stripe's date of the status is not stored, so only a passed grace dates the freeze.
  assert.equal(computeFreezeDate(sub({ status: SubscriptionStatus.UNPAID, latest_invoice_created: invoicedAt }), NOW), null);
  const longUnpaid = new Date(NOW - 40 * DAY_MS);
  assert.equal(
    computeFreezeDate(sub({ status: SubscriptionStatus.UNPAID, latest_invoice_created: longUnpaid }), NOW),
    longUnpaid.getTime() + 14 * DAY_MS,
  );

  // Canceled after the dunning: the first of the cancellation and the end of the grace.
  const canceledAt = new Date(NOW - DAY_MS);
  assert.equal(
    computeFreezeDate(sub({ status: SubscriptionStatus.CANCELED, canceled_at: canceledAt, latest_invoice_status: 'open', latest_invoice_created: longUnpaid }), NOW),
    longUnpaid.getTime() + 14 * DAY_MS,
  );
  assert.equal(
    computeFreezeDate(sub({ status: SubscriptionStatus.CANCELED, canceled_at: canceledAt, latest_invoice_status: 'open', latest_invoice_created: invoicedAt }), NOW),
    canceledAt.getTime(),
  );
  // Canceled at the end of a paid period: that end.
  const endedAt = new Date(NOW - 5 * DAY_MS);
  assert.equal(
    computeFreezeDate(sub({ status: SubscriptionStatus.CANCELED, canceled_at: new Date(NOW - 60 * DAY_MS), canceled_at_effective: endedAt, latest_invoice_status: 'paid', latest_invoice_created: longUnpaid }), NOW),
    endedAt.getTime(),
  );
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
  // 2025-09-30.clover: the period is on the subscription item. A card renewal refused one day
  // ago (the period it opened starts then) still has 13 days of grace.
  const periodStart = NOW - DAY_MS;
  const stored = await storedAfterRefresh({
    id: 'sub_1',
    status: 'past_due',
    collection_method: 'charge_automatically',
    items: { data: [{ quantity: 1, current_period_start: periodStart / 1000, current_period_end: (periodStart + 30 * DAY_MS) / 1000 }] },
  });
  assert.equal(stored.status, SubscriptionStatus.PAST_DUE);
  assert.equal(computeFreezeEffectiveAt(stored), periodStart + 14 * DAY_MS);
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
  testCardGraceStartsAtTheUnpaidInvoice();
  testStaleInvoiceDateUsesThePeriodStart();
  testFreezeDateOfTheSummary();
  await testPastDueCloverSubscriptionKeepsItsGrace();
  testTrialDeletionDate();
  // eslint-disable-next-line no-console
  console.log('subscription-freeze.util.spec: all assertions passed');
}

void run();
