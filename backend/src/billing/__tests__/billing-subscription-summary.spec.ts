import * as assert from 'node:assert/strict';
import { BillingService } from '../billing.service';
import { PaymentMode, Subscription, SubscriptionStatus, SubscriptionType } from '../subscription.entity';
import { User } from '../../users/user.entity';
import { Features } from '../../config/features';

/**
 * A cloud subscription has one price whatever the number of users: checkout sends
 * quantity 1. When the stored amount is still empty (before the first Stripe sync),
 * the billing page shows the estimate, which must use that same quantity.
 * On-premise has no hosted subscription and shows no amount. Neither mode has a user
 * limit, and the Stripe quantity never becomes one.
 */

const MONTHLY_PRICE = { currency: 'eur', billing_scheme: 'per_unit', unit_amount: 24900, tiers: [] };

function createService(sub: Partial<Subscription>, enabledUsers: number, stripeSubscription: unknown = null) {
  const subscription = { ...sub } as Subscription;
  const priceRequests: string[] = [];
  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === Subscription) {
        return {
          findOne: async () => subscription,
          create: (data: Partial<Subscription>) => data,
          save: async (data: Subscription) => data,
        };
      }
      if (entity === User) {
        const qb: any = {
          leftJoin: () => qb,
          where: () => qb,
          andWhere: () => qb,
          getCount: async () => enabledUsers,
        };
        return { createQueryBuilder: () => qb };
      }
      throw new Error('Unexpected repository');
    },
  };
  const stripeClient = {
    getClient: () => ({
      subscriptions: { retrieve: async () => stripeSubscription },
      prices: {
        retrieve: async (priceId: string) => {
          priceRequests.push(priceId);
          return MONTHLY_PRICE;
        },
      },
    }),
  };
  const stripeConfig = { getPriceId: (_interval: string, planKey: string) => (planKey === 'max' ? 'price_max_monthly' : null) };
  const service = new BillingService(
    { manager } as any,
    {} as any,
    {} as any,
    stripeClient as any,
    stripeConfig as any,
    {} as any,
    {} as any,
  );
  return { service, manager, priceRequests };
}

async function testEstimateIsOneSubscription() {
  const { service, manager } = createService(
    { plan_name: 'Hosted KANAP', seat_limit: null, active_seats: 0, subscription_type: SubscriptionType.MONTHLY, amount: null },
    12,
  );
  const summary = await service.getSubscriptionSummary({ manager: manager as any });
  assert.equal(summary.seats_used, 12);
  assert.equal(summary.estimated_amount, 24900);
  assert.equal(summary.amount, 24900);
  assert.equal(summary.currency, 'EUR');
}

async function testTrialHasNoEstimate() {
  // "Trial" is no plan on sale: no estimate (the billing page shows no amount for a trial).
  const { service, manager, priceRequests } = createService(
    { plan_name: 'Trial', seat_limit: null, active_seats: 0, subscription_type: SubscriptionType.MONTHLY, amount: null },
    12,
  );
  const summary = await service.getSubscriptionSummary({ manager: manager as any });
  assert.equal(summary.seats_used, 12);
  assert.equal(summary.estimated_amount, null);
  assert.equal(summary.amount, null);
  assert.deepEqual(priceRequests, []);
}

async function testSeatFieldsDoNotScaleTheEstimate() {
  // A subscription carrying a seat limit and a Stripe quantity from an older plan.
  const { service, manager } = createService(
    {
      plan_name: 'Hosted KANAP',
      seat_limit: 25,
      active_seats: 8,
      subscription_type: SubscriptionType.MONTHLY,
      stripe_price_id: 'price_max_monthly',
      amount: null,
    },
    30,
  );
  const summary = await service.getSubscriptionSummary({ manager: manager as any });
  assert.equal(summary.estimated_amount, 24900);
  assert.equal(summary.amount, 24900);
}

async function testStoredAmountWins() {
  const { service, manager } = createService(
    { plan_name: 'Hosted KANAP', seat_limit: null, active_seats: 1, subscription_type: SubscriptionType.MONTHLY, amount: 19900, currency: 'EUR' },
    40,
  );
  const summary = await service.getSubscriptionSummary({ manager: manager as any });
  assert.equal(summary.amount, 19900);
  assert.equal(summary.estimated_amount, 24900);
}

async function testOnPremiseShowsNoAmount() {
  const features = Features as { SINGLE_TENANT: boolean };
  const previous = features.SINGLE_TENANT;
  features.SINGLE_TENANT = true;
  try {
    const { service, manager, priceRequests } = createService(
      {
        plan_name: 'On-Prem',
        seat_limit: 1000,
        active_seats: 0,
        subscription_type: SubscriptionType.ANNUAL,
        payment_mode: PaymentMode.CARD,
        status: SubscriptionStatus.ACTIVE,
        amount: null,
      },
      12,
    );
    const summary = await service.getSubscriptionSummary({ manager: manager as any });
    assert.equal(summary.plan_name, 'On-Prem');
    // Stored before on-premise became unlimited: the summary heals it to null.
    assert.equal(summary.seat_limit, null);
    assert.equal(summary.seats_used, 12);
    assert.equal(summary.amount, null);
    assert.equal(summary.estimated_amount, null);
    assert.deepEqual(priceRequests, []);
  } finally {
    features.SINGLE_TENANT = previous;
  }
}

async function testStripeQuantityIsNotAUserLimit() {
  // A Stripe subscription whose price matches no plan: the sync used to copy its
  // quantity (1 since checkout sends 1) into the user limit.
  const { service, manager } = createService(
    {
      plan_name: 'Hosted KANAP (old price)',
      seat_limit: null,
      active_seats: 0,
      subscription_type: SubscriptionType.MONTHLY,
      stripe_subscription_id: 'sub_1',
      amount: null,
    },
    5,
    {
      id: 'sub_1',
      status: 'active',
      quantity: 1,
      currency: 'eur',
      plan: { nickname: 'Old price' },
      items: { data: [{ quantity: 1, price: { id: 'price_unknown', ...MONTHLY_PRICE } }] },
    },
  );
  const summary = await service.getSubscriptionSummary({ manager: manager as any, forceStripeRefresh: true });
  assert.equal(summary.plan_name, 'Old price');
  assert.equal(summary.seat_limit, null);
  assert.equal(summary.active_seats, 1);
  assert.equal(summary.amount, 24900);
}

/**
 * Since basil, Stripe sends the billing period on the subscription items, no longer at the
 * top level. The billing page forces a refresh on each view: reading the top level wrote
 * null over the stored period, the page lost its renewal date and a past-due card
 * subscription lost its grace period.
 */
const PERIOD_START = 1_790_000_000;
const PERIOD_END = 1_792_592_000;
const STORED_START = new Date('2026-09-01T00:00:00.000Z');
const STORED_END = new Date('2026-10-01T00:00:00.000Z');

function stripeSubscription(overrides: Record<string, unknown>, item: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    status: 'active',
    collection_method: 'charge_automatically',
    currency: 'eur',
    items: { data: [{ quantity: 1, price: { id: 'price_max_monthly', ...MONTHLY_PRICE }, ...item }] },
    ...overrides,
  };
}

function storedSubscription(overrides: Partial<Subscription> = {}): Partial<Subscription> {
  return {
    plan_name: 'Hosted KANAP',
    seat_limit: null,
    active_seats: 1,
    subscription_type: SubscriptionType.MONTHLY,
    stripe_subscription_id: 'sub_1',
    amount: null,
    ...overrides,
  };
}

async function testCloverPeriodIsReadFromTheItems() {
  const { service, manager } = createService(
    storedSubscription(),
    3,
    stripeSubscription({}, { current_period_start: PERIOD_START, current_period_end: PERIOD_END }),
  );
  const summary = await service.getSubscriptionSummary({ manager: manager as any, forceStripeRefresh: true });
  const end = new Date(PERIOD_END * 1000).toISOString();
  assert.equal(summary.current_period_start, new Date(PERIOD_START * 1000).toISOString());
  assert.equal(summary.current_period_end, end);
  assert.equal(summary.next_payment_at, end);
  assert.equal(summary.renewal_at, end);
  assert.equal(summary.payment_due_at, end);
  assert.equal(summary.canceled_at_effective, null);
}

async function testCloverCancelAtPeriodEndUsesTheItemPeriod() {
  const { service, manager } = createService(
    storedSubscription(),
    3,
    stripeSubscription({ cancel_at_period_end: true }, { current_period_start: PERIOD_START, current_period_end: PERIOD_END }),
  );
  const summary = await service.getSubscriptionSummary({ manager: manager as any, forceStripeRefresh: true });
  assert.equal(summary.canceled_at_effective, new Date(PERIOD_END * 1000).toISOString());
}

async function testMissingPeriodKeepsTheStoredDates() {
  // A payload with no period anywhere: the stored dates stay, they are not wiped.
  const { service, manager } = createService(
    storedSubscription({
      current_period_start: STORED_START,
      current_period_end: STORED_END,
      next_payment_at: STORED_END,
      canceled_at_effective: STORED_END,
    }),
    3,
    stripeSubscription({ cancel_at_period_end: true }),
  );
  const summary = await service.getSubscriptionSummary({ manager: manager as any, forceStripeRefresh: true });
  assert.equal(summary.current_period_start, STORED_START.toISOString());
  assert.equal(summary.current_period_end, STORED_END.toISOString());
  assert.equal(summary.next_payment_at, STORED_END.toISOString());
  assert.equal(summary.canceled_at_effective, STORED_END.toISOString());
  assert.equal(summary.renewal_at, STORED_END.toISOString());
}

async function testLegacyTopLevelPeriodStillWorks() {
  // 2023-10-16 shape: the period on the subscription wins over the stored dates.
  const { service, manager } = createService(
    storedSubscription({ current_period_start: STORED_START, current_period_end: STORED_END, next_payment_at: STORED_END }),
    3,
    stripeSubscription({ current_period_start: PERIOD_START, current_period_end: PERIOD_END }),
  );
  const summary = await service.getSubscriptionSummary({ manager: manager as any, forceStripeRefresh: true });
  assert.equal(summary.current_period_start, new Date(PERIOD_START * 1000).toISOString());
  assert.equal(summary.current_period_end, new Date(PERIOD_END * 1000).toISOString());
  assert.equal(summary.next_payment_at, new Date(PERIOD_END * 1000).toISOString());
}

async function run() {
  await testEstimateIsOneSubscription();
  await testTrialHasNoEstimate();
  await testSeatFieldsDoNotScaleTheEstimate();
  await testStoredAmountWins();
  await testOnPremiseShowsNoAmount();
  await testStripeQuantityIsNotAUserLimit();
  await testCloverPeriodIsReadFromTheItems();
  await testCloverCancelAtPeriodEndUsesTheItemPeriod();
  await testMissingPeriodKeepsTheStoredDates();
  await testLegacyTopLevelPeriodStillWorks();
}

void run();
