import * as assert from 'node:assert/strict';
import { BillingService } from '../billing.service';
import { PaymentMode, Subscription, SubscriptionStatus, SubscriptionType } from '../subscription.entity';
import { User } from '../../users/user.entity';
import { Features } from '../../config/features';

/**
 * A cloud subscription has one price whatever the number of users: checkout sends
 * quantity 1. When the stored amount is still empty (trial, before the first Stripe
 * sync), the billing page shows the estimate, which must use that same quantity.
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
  const stripeConfig = { getPriceId: () => 'price_max_monthly' };
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

async function testTrialEstimateIsOneSubscription() {
  const { service, manager } = createService(
    { plan_name: 'Trial', seat_limit: null, active_seats: 0, subscription_type: SubscriptionType.MONTHLY, amount: null },
    12,
  );
  const summary = await service.getSubscriptionSummary({ manager: manager as any });
  assert.equal(summary.seats_used, 12);
  assert.equal(summary.estimated_amount, 24900);
  assert.equal(summary.amount, 24900);
  assert.equal(summary.currency, 'EUR');
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

async function run() {
  await testTrialEstimateIsOneSubscription();
  await testSeatFieldsDoNotScaleTheEstimate();
  await testStoredAmountWins();
  await testOnPremiseShowsNoAmount();
  await testStripeQuantityIsNotAUserLimit();
}

void run();
