import * as assert from 'node:assert/strict';
import {
  FUNNEL_WEEKS,
  needsAttention,
  ownActivityCutoff,
  stepsDone,
  trialState,
  weekStart,
  weeklyFunnel,
} from '../trial-funnel';

// The rules of the trial funnel (`doc/trial-funnel.md`): the state of a sign-up, the 24-hour
// alert, the instant after which a creation is the person's own, the steps done and the weekly
// counts.

const now = new Date('2026-11-04T12:00:00Z'); // a Wednesday
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3600_000);
const trial = (trial_end: Date | null, extra: Record<string, unknown> = {}) =>
  ({ status: 'trialing', plan_name: 'Trial', trial_end, stripe_subscription_id: null, ...extra });

function testState() {
  const future = new Date('2026-11-20T00:00:00Z');
  assert.equal(trialState({ activated_at: null, has_tenant: false, subscription: null, now }), 'awaiting_activation');
  assert.equal(trialState({ activated_at: now, has_tenant: false, subscription: null, now }), 'awaiting_activation', 'a deleted workspace has no row to read');
  assert.equal(trialState({ activated_at: now, has_tenant: true, subscription: trial(future), now }), 'trialing');
  assert.equal(trialState({ activated_at: now, has_tenant: true, subscription: trial(hoursAgo(1)), now }), 'ended');
  assert.equal(trialState({ activated_at: now, has_tenant: true, subscription: null, now }), 'ended', 'no subscription: no running trial');
  assert.equal(
    trialState({ activated_at: now, has_tenant: true, subscription: trial(hoursAgo(1), { stripe_subscription_id: 'sub_1', status: 'canceled' }), now }),
    'converted',
    'a subscription linked to Stripe is a conversion, whatever became of it',
  );
  assert.equal(trialState({ activated_at: now, has_tenant: true, subscription: trial(null, { plan_name: 'Internal', status: 'active' }), now }), 'internal');
}

function testAttention() {
  const base = { state: 'trialing' as const, first_sign_in_at: null, now };
  assert.equal(needsAttention({ ...base, activated_at: hoursAgo(24) }), true, '24 hours without a sign-in');
  assert.equal(needsAttention({ ...base, activated_at: hoursAgo(23.9) }), false, 'not yet 24 hours');
  assert.equal(needsAttention({ ...base, activated_at: hoursAgo(48), first_sign_in_at: hoursAgo(47) }), false, 'signed in');
  assert.equal(needsAttention({ ...base, state: 'ended', activated_at: hoursAgo(48) }), false, 'only a running trial');
  assert.equal(needsAttention({ ...base, state: 'awaiting_activation', activated_at: null }), false);
}

function testCutoff() {
  const activated = hoursAgo(10).toISOString();
  assert.equal(ownActivityCutoff({ activated_at: activated, sample_data: null, last_reset_at: null, now })?.toISOString(), activated);
  assert.equal(
    ownActivityCutoff({ activated_at: activated, sample_data: { status: 'loaded', ever_loaded_at: hoursAgo(9).toISOString(), loaded_at: hoursAgo(9).toISOString() }, last_reset_at: null, now })?.toISOString(),
    hoursAgo(9).toISOString(),
    'the sample data load is not the person',
  );
  assert.equal(
    ownActivityCutoff({ activated_at: activated, sample_data: { status: 'idle', ever_loaded_at: hoursAgo(9).toISOString() }, last_reset_at: hoursAgo(5), now })?.toISOString(),
    hoursAgo(5).toISOString(),
    'nor the reset that follows',
  );
  assert.equal(
    ownActivityCutoff({ activated_at: activated, sample_data: { status: 'loading' }, last_reset_at: null, now })?.toISOString(),
    now.toISOString(),
    'nothing counts while a load runs',
  );
  assert.equal(ownActivityCutoff({ activated_at: null, sample_data: null, last_reset_at: null, now }), null);
}

function testSteps() {
  const path = ['a', 'b', 'c', 'd', 'e'];
  assert.equal(stepsDone(path, []), 0);
  assert.equal(stepsDone(path, [['a', 'b'], ['a', 'c', 'd', 'x']]), 3, 'the best person, keys of another path ignored');
}

function testWeeks() {
  assert.equal(weekStart(new Date('2026-11-04T12:00:00Z')), '2026-11-02');
  assert.equal(weekStart(new Date('2026-11-08T23:59:00Z')), '2026-11-02', 'Sunday closes the week');
  assert.equal(weekStart(new Date('2026-11-09T00:00:00Z')), '2026-11-09');

  const weeks = weeklyFunnel([
    { created_at: '2026-11-03T10:00:00Z', activated_at: '2026-11-03T10:05:00Z', first_sign_in_at: '2026-11-03T10:10:00Z', state: 'converted' },
    { created_at: '2026-11-02T08:00:00Z', activated_at: null, first_sign_in_at: null, state: 'awaiting_activation' },
    { created_at: '2026-10-28T08:00:00Z', activated_at: '2026-10-28T08:01:00Z', first_sign_in_at: null, state: 'ended' },
    { created_at: '2025-01-01T08:00:00Z', activated_at: null, first_sign_in_at: null, state: 'awaiting_activation' },
  ], now);
  assert.equal(weeks.length, FUNNEL_WEEKS);
  assert.deepEqual(weeks[0], { week: '2026-11-02', created: 2, activated: 1, signed_in: 1, converted: 1 });
  assert.deepEqual(weeks[1], { week: '2026-10-26', created: 1, activated: 1, signed_in: 0, converted: 0 });
  assert.equal(weeks.reduce((sum, week) => sum + week.created, 0), 3, 'older sign-ups fall outside the weeks');
}

testState();
testAttention();
testCutoff();
testSteps();
testWeeks();
console.log('trial-funnel: ok');
