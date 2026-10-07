import * as assert from 'node:assert/strict';
import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { BillingService } from '../billing.service';
import { CreateCheckoutSessionDto } from '../billing.controller';
import { StripeConfigService } from '../stripe/stripe.config';
import { Subscription, SubscriptionType } from '../subscription.entity';
import { User } from '../../users/user.entity';

/**
 * KANAP sells its current plans only, at their configured prices
 * (`STRIPE_PRICE_<PLAN>_<INTERVAL>`). The legacy `STRIPE_PRICE_MONTHLY` / `_ANNUAL` prices
 * (an old "Starter" plan) can no longer be bought through checkout, and the billing page
 * no longer estimates an amount for a plan that is not sold any more.
 */

const ENV = {
  STRIPE_PRICE_MONTHLY: 'price_legacy_monthly',
  STRIPE_PRICE_ANNUAL: 'price_legacy_annual',
  STRIPE_PRICE_MAX_MONTHLY: 'price_max_monthly',
  STRIPE_PRICE_MAX_ANNUAL: 'price_max_annual',
};

const PRICE_AMOUNTS: Record<string, number> = {
  price_legacy_monthly: 4990,
  price_legacy_annual: 49900,
  price_max_monthly: 24900,
  price_max_annual: 249000,
  price_old_unknown: 1000,
};

const COMPLETE_FR_INVOICE = {
  company: 'Fromage SAS',
  email: 'billing@fromage-co.com',
  phone: '+33 1 23 45 67 89',
  vat_number: 'FR 12 345678901',
  address: { line1: '1 rue de la Paix', postal_code: '75002', city: 'Paris', country: 'FR' },
};

type Call = { method: string; args: unknown[] };

function createService(sub: Partial<Subscription> = {}) {
  const calls: Call[] = [];
  const record = (method: string, impl: (...args: any[]) => unknown) => async (...args: unknown[]) => {
    calls.push({ method, args });
    return impl(...args);
  };
  const client = {
    customers: {
      retrieve: record('customers.retrieve', () => ({ id: 'cus_1' })),
      update: record('customers.update', () => ({ id: 'cus_1' })),
      create: record('customers.create', () => ({ id: 'cus_new' })),
      listTaxIds: record('customers.listTaxIds', () => ({ data: [{ id: 'txi_1', type: 'eu_vat', value: 'FR12345678901' }] })),
      createTaxId: record('customers.createTaxId', () => ({ id: 'txi_new' })),
      deleteTaxId: record('customers.deleteTaxId', () => ({ deleted: true })),
    },
    checkout: {
      sessions: { create: record('checkout.sessions.create', () => ({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' })) },
    },
    subscriptions: { retrieve: record('subscriptions.retrieve', () => null) },
    prices: {
      retrieve: record('prices.retrieve', (priceId: string) => {
        const amount = PRICE_AMOUNTS[priceId];
        if (amount == null) throw new Error(`No such price: ${priceId}`);
        return { id: priceId, currency: 'eur', billing_scheme: 'per_unit', unit_amount: amount, tiers: [] };
      }),
    },
  };
  const tenant = {
    id: 'tenant-1',
    slug: 'fromage',
    name: 'Fromage',
    stripe_customer_id: 'cus_1',
    billing_invoice_info: COMPLETE_FR_INVOICE,
    billing_customer_info: null,
    billing_email: null,
    billing_company_name: null,
    billing_phone: null,
    billing_tax_id: null,
    billing_address: null,
  };
  const subscription = { id: 'local-sub', seat_limit: null, active_seats: 0, amount: null, ...sub } as Subscription;
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
          getCount: async () => 3,
        };
        return { createQueryBuilder: () => qb };
      }
      throw new Error('Unexpected repository');
    },
  };
  const tenants = { findOne: async () => tenant, update: async () => undefined };
  const service = new BillingService(
    { manager } as any,
    {} as any,
    tenants as any,
    { getClient: () => client } as any,
    new StripeConfigService(),
    {} as any,
    { log: async () => undefined } as any,
  );
  return { service, manager, calls };
}

async function expectBadRequest(promise: Promise<unknown>) {
  let caught: unknown = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof BadRequestException, `expected a BadRequestException, got ${String(caught)}`);
}

const pipe = new ValidationPipe({ whitelist: true, transform: true });
const bodyMeta: ArgumentMetadata = { type: 'body', metatype: CreateCheckoutSessionDto, data: '' };

async function testCheckoutBodyRequiresACurrentPlan() {
  await expectBadRequest(pipe.transform({ interval: 'monthly' }, bodyMeta));
  await expectBadRequest(pipe.transform({ plan_key: 'starter', interval: 'monthly' }, bodyMeta));
  await expectBadRequest(pipe.transform({ plan_key: 'max' }, bodyMeta));
  await expectBadRequest(pipe.transform({ plan_key: 'max', interval: 'weekly' }, bodyMeta));
}

async function testCheckoutBodyDropsPriceAndQuantity() {
  const body = await pipe.transform(
    { plan_key: 'max', interval: 'annual', price_id: 'price_legacy_annual', quantity: 7, subscription_type: 'monthly' },
    bodyMeta,
  );
  assert.deepEqual({ ...body }, { plan_key: 'max', interval: 'annual' });
}

async function testCheckoutWithoutCurrentPlanIsRefusedBeforeStripe() {
  for (const opts of [
    { interval: 'monthly' },
    { planKey: 'starter', interval: 'monthly' },
    { interval: 'monthly', priceId: 'price_legacy_monthly' },
  ]) {
    const { service, manager, calls } = createService();
    await expectBadRequest(
      service.createCheckoutSession({ tenantId: 'tenant-1', manager: manager as any, ...(opts as any) }),
    );
    assert.deepEqual(calls, [], `no Stripe call for ${JSON.stringify(opts)}`);
  }
}

async function testCheckoutUsesTheConfiguredPlanPrice() {
  const { service, manager, calls } = createService();
  await service.createCheckoutSession({
    tenantId: 'tenant-1',
    manager: manager as any,
    planKey: 'max',
    interval: 'annual',
    priceId: 'price_legacy_annual',
    quantity: 7,
  } as any);
  const created = calls.filter((call) => call.method === 'checkout.sessions.create');
  assert.equal(created.length, 1);
  const params = created[0].args[0] as { line_items: Array<{ price: string; quantity: number }> };
  assert.deepEqual(params.line_items, [{ price: 'price_max_annual', quantity: 1 }]);
}

async function summaryOf(sub: Partial<Subscription>) {
  const { service, manager, calls } = createService(sub);
  const summary = await service.getSubscriptionSummary({ manager: manager as any });
  const priceRequests = calls.filter((call) => call.method === 'prices.retrieve').map((call) => call.args[0]);
  return { summary, priceRequests };
}

async function testLegacyPlanHasNoEstimate() {
  const { summary, priceRequests } = await summaryOf({
    plan_name: 'Starter',
    subscription_type: SubscriptionType.MONTHLY,
  });
  assert.equal(summary.estimated_amount, null);
  assert.equal(summary.amount, null);
  assert.deepEqual(priceRequests, []);
}

async function testTrialHasNoEstimate() {
  const { summary } = await summaryOf({ plan_name: 'Trial', subscription_type: SubscriptionType.MONTHLY });
  assert.equal(summary.estimated_amount, null);
  assert.equal(summary.amount, null);
}

async function testCurrentPlanIsEstimatedAtItsConfiguredPrice() {
  const monthly = await summaryOf({ plan_name: 'Hosted KANAP', subscription_type: SubscriptionType.MONTHLY });
  assert.equal(monthly.summary.estimated_amount, 24900);
  assert.equal(monthly.summary.amount, 24900);
  assert.deepEqual(monthly.priceRequests, ['price_max_monthly']);

  const annual = await summaryOf({ plan_name: 'Hosted KANAP', subscription_type: SubscriptionType.ANNUAL });
  assert.equal(annual.summary.estimated_amount, 249000);
}

async function testUnknownStoredPriceHasNoEstimate() {
  const { summary, priceRequests } = await summaryOf({
    plan_name: 'Starter',
    subscription_type: SubscriptionType.MONTHLY,
    stripe_price_id: 'price_old_unknown',
  });
  assert.equal(summary.estimated_amount, null);
  assert.equal(summary.amount, null);
  assert.deepEqual(priceRequests, []);
}

async function testStoredCurrentPriceNamesThePlan() {
  // The stored Stripe price is a current plan's price: it names the plan even when the
  // stored plan name is an old one; the interval comes from the subscription.
  const { summary } = await summaryOf({
    plan_name: 'Starter',
    subscription_type: SubscriptionType.ANNUAL,
    stripe_price_id: 'price_max_annual',
  });
  assert.equal(summary.estimated_amount, 249000);
}

async function run() {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(ENV)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    await testCheckoutBodyRequiresACurrentPlan();
    await testCheckoutBodyDropsPriceAndQuantity();
    await testCheckoutWithoutCurrentPlanIsRefusedBeforeStripe();
    await testCheckoutUsesTheConfiguredPlanPrice();
    await testLegacyPlanHasNoEstimate();
    await testTrialHasNoEstimate();
    await testCurrentPlanIsEstimatedAtItsConfiguredPrice();
    await testUnknownStoredPriceHasNoEstimate();
    await testStoredCurrentPriceNamesThePlan();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
