import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { withTenant } from '../../common/tenant-runner';
import { BillingService } from '../billing.service';
import { Tenant } from '../../tenants/tenant.entity';

// On the return from the customer portal (`POST /billing/pay-invoice`), the open invoice of a card
// subscription is charged at once on the subscription's card, without waiting for Stripe's next
// retry: only when that card is not the one refused, and once even when the call is made twice
// together (the tenant's lock, shared with the webhook). Against a real database with a simulated
// Stripe client; the tenants are removed at the end.

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

type Seed = { tenantId: string; customerId: string; subscriptionId: string; invoiceId: string };

async function seedTenant(tag: string): Promise<Seed> {
  const tenantId = randomUUID();
  const short = tenantId.slice(0, 8);
  const seed = { tenantId, customerId: `cus_spec_${short}`, subscriptionId: `sub_spec_${short}`, invoiceId: `in_spec_${short}` };
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, stripe_customer_id, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `pay-invoice-${tag}-${short}`, `Pay invoice ${tag}`, seed.customerId],
  );
  await withTenant(dataSource, tenantId, (manager) =>
    manager.query(
      `INSERT INTO subscriptions (tenant_id, status, stripe_subscription_id, stripe_customer_id, plan_name, seat_limit, active_seats,
                                  collection_method, latest_invoice_id, latest_invoice_status, latest_invoice_created)
       VALUES ($1, 'past_due', $2, $3, 'Kadratis Cloud', NULL, 1, 'charge_automatically', $4, 'open', now() - interval '20 days')`,
      [tenantId, seed.subscriptionId, seed.customerId, seed.invoiceId],
    ),
  ).catch(async (error) => {
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    throw error;
  });
  return seed;
}

async function removeTenant(tenantId: string) {
  await withTenant(dataSource, tenantId, (manager) => manager.query(`DELETE FROM subscriptions WHERE tenant_id = $1`, [tenantId]));
  await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
}

const DECLINED = { code: 'card_declined', decline_code: 'insufficient_funds', message: 'Your card has insufficient funds.', payment_method: { id: 'pm_old' } };

/**
 * A Stripe account with one past due card subscription whose latest invoice is open and was
 * refused on `pm_old`. `pay` says what `invoices.pay` does (after `payDelay` ms).
 */
function stripeAccount(seed: Seed, opts: {
  subscriptionCard?: string | null;
  customerCard?: string | null;
  collectionMethod?: string;
  /**
   * `already_paid`: Stripe's own retry paid the invoice meanwhile, `pay` is refused as such;
   * `processing`: the payment is accepted but not settled yet, the invoice stays open.
   */
  pay?: 'paid' | 'declined' | 'requires_action' | 'already_paid' | 'processing';
  payDelay?: number;
}) {
  const state = { invoiceStatus: 'open', subscriptionStatus: 'past_due', processing: false };
  const pays: Array<{ id: string; params: unknown; options: any }> = [];
  const client = {
    subscriptions: {
      retrieve: async () => ({
        object: 'subscription',
        id: seed.subscriptionId,
        customer: seed.customerId,
        status: state.subscriptionStatus,
        collection_method: opts.collectionMethod ?? 'charge_automatically',
        currency: 'eur',
        latest_invoice: seed.invoiceId,
        default_payment_method: opts.subscriptionCard === undefined ? 'pm_new' : opts.subscriptionCard,
        schedule: null,
        items: { data: [{ id: 'si_1', quantity: 1, price: { id: 'price_spec', currency: 'eur', unit_amount: 24900, recurring: { interval: 'month' } } }] },
      }),
    },
    customers: {
      retrieve: async () => ({ id: seed.customerId, invoice_settings: { default_payment_method: opts.customerCard ?? null } }),
    },
    paymentMethods: { retrieve: async (id: string) => ({ id, type: 'card', card: { brand: 'visa', last4: '4242' } }) },
    prices: { retrieve: async () => null },
    invoices: {
      retrieve: async (id: string) => ({
        object: 'invoice',
        id,
        status: state.invoiceStatus,
        number: 'KAN-0050',
        total: 24900,
        currency: 'eur',
        created: Math.floor(Date.now() / 1000) - 20 * 86400,
        payments: {
          data: [
            { created: 1, payment: { type: 'payment_intent', payment_intent: { id: 'pi_1', status: 'requires_payment_method', last_payment_error: DECLINED } } },
            ...(state.processing ? [{ created: 2, payment: { type: 'payment_intent', payment_intent: { id: 'pi_2', status: 'processing' } } }] : []),
          ],
        },
      }),
      pay: async (id: string, params: unknown, options: unknown) => {
        pays.push({ id, params, options });
        await delay(opts.payDelay ?? 0);
        if (opts.pay === 'declined') {
          throw Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError', code: 'card_declined' });
        }
        if (opts.pay === 'already_paid') {
          state.invoiceStatus = 'paid';
          state.subscriptionStatus = 'active';
          throw Object.assign(new Error('Invoice is already paid'), { type: 'StripeInvalidRequestError', rawType: 'invalid_request_error' });
        }
        if (opts.pay === 'processing') {
          state.processing = true;
          return { id, status: 'open' };
        }
        if (opts.pay === 'requires_action') {
          throw Object.assign(new Error('Payment requires action'), { type: 'StripeInvalidRequestError', code: 'invoice_payment_intent_requires_action' });
        }
        state.invoiceStatus = 'paid';
        state.subscriptionStatus = 'active';
        return { id, status: 'paid' };
      },
    },
  };
  const stripeConfig = { isConfigured: () => true, getPriceId: () => null, getApiVersion: () => '2025-09-30.clover' };
  const audits: Array<Record<string, any>> = [];
  const audit = { log: async (entry: Record<string, any>) => { audits.push(entry); } };
  const service = new BillingService(
    { manager: dataSource.manager } as any,
    {} as any,
    dataSource.getRepository(Tenant) as any,
    { getClient: () => client } as any,
    stripeConfig as any,
    dataSource,
    audit as any,
  );
  (service as any).logger = { warn: () => undefined, log: () => undefined, debug: () => undefined, error: () => undefined };
  return { service, pays, audits };
}

/** One call, as the request runs it: in a transaction of the tenant (with the request's lock wait, when given). */
function payInvoice(service: BillingService, seed: Seed, lockTimeout?: string) {
  return withTenant(dataSource, seed.tenantId, async (manager) => {
    if (lockTimeout) await manager.query(`SELECT set_config('lock_timeout', $1, true)`, [lockTimeout]);
    return (service as any).payOpenInvoice({ tenantId: seed.tenantId, userId: null, manager });
  }) as Promise<any>;
}

async function testNewCardPaysTheInvoiceAtOnce() {
  const seed = await seedTenant('paid');
  try {
    const { service, pays, audits } = stripeAccount(seed, { subscriptionCard: 'pm_new', pay: 'paid' });
    const result = await payInvoice(service, seed);
    assert.equal(result.payment.status, 'paid');
    assert.deepEqual(pays.map((call) => call.id), [seed.invoiceId]);
    assert.equal(pays[0].options?.idempotencyKey, `invoice-pay-${seed.invoiceId}-pm_new`);
    assert.deepEqual(pays[0].params, { payment_method: 'pm_new' }, 'the checked card is the one charged');
    // The summary is read again from Stripe: paid, usable, no reason left.
    assert.equal(result.latest_invoice_status, 'paid');
    assert.equal(result.status, 'active');
    assert.equal(result.access_allowed, true);
    assert.equal(result.last_payment_error_code, null);
    assert.equal(audits.filter((entry) => entry.sourceRef === seed.invoiceId).length, 1, 'the payment is audited');
  } finally {
    await removeTenant(seed.tenantId);
  }
}

async function testCustomerCardWhenTheSubscriptionHasNone() {
  const seed = await seedTenant('customer');
  try {
    const { service, pays } = stripeAccount(seed, { subscriptionCard: null, customerCard: 'pm_portal', pay: 'paid' });
    assert.equal((await payInvoice(service, seed)).payment.status, 'paid');
    assert.equal(pays[0].options?.idempotencyKey, `invoice-pay-${seed.invoiceId}-pm_portal`);
    assert.deepEqual(pays[0].params, { payment_method: 'pm_portal' });
  } finally {
    await removeTenant(seed.tenantId);
  }
}

async function testRefusedCardIsNotChargedAgain() {
  const seed = await seedTenant('unchanged');
  try {
    const { service, pays } = stripeAccount(seed, { subscriptionCard: 'pm_old', pay: 'paid' });
    const result = await payInvoice(service, seed);
    assert.equal(result.payment.status, 'card_unchanged');
    assert.equal(pays.length, 0, 'no second charge on the refused card');
    assert.equal(result.last_payment_error_code, 'insufficient_funds');
  } finally {
    await removeTenant(seed.tenantId);
  }
}

async function testRefusalAndAuthenticationAreAnswered() {
  for (const [pay, status] of [['declined', 'payment_failed'], ['requires_action', 'requires_action']] as const) {
    const seed = await seedTenant(pay.replace('_', '-'));
    try {
      const { service, pays } = stripeAccount(seed, { pay });
      assert.equal((await payInvoice(service, seed)).payment.status, status);
      assert.equal(pays.length, 1);
    } finally {
      await removeTenant(seed.tenantId);
    }
  }
}

/**
 * Stripe's answers that are no refusal: an invoice paid meanwhile (Stripe's retry at the same
 * moment) is answered `paid`; a payment accepted but not settled yet, `processing`.
 */
async function testPaidMeanwhileAndProcessingAreNotRefusals() {
  for (const [pay, status] of [['already_paid', 'paid'], ['processing', 'processing']] as const) {
    const seed = await seedTenant(pay.replace('_', '-'));
    try {
      const { service, pays } = stripeAccount(seed, { pay });
      assert.equal((await payInvoice(service, seed)).payment.status, status, pay);
      assert.equal(pays.length, 1);
    } finally {
      await removeTenant(seed.tenantId);
    }
  }
}

async function testBankTransferIsNotCharged() {
  const seed = await seedTenant('transfer');
  try {
    const { service, pays } = stripeAccount(seed, { collectionMethod: 'send_invoice', pay: 'paid' });
    assert.equal((await payInvoice(service, seed)).payment.status, 'nothing_to_pay');
    assert.equal(pays.length, 0);
  } finally {
    await removeTenant(seed.tenantId);
  }
}

async function testTwoCallsTogetherPayOnce() {
  const seed = await seedTenant('twice');
  try {
    const { service, pays } = stripeAccount(seed, { pay: 'paid', payDelay: 300 });
    const results = await Promise.all([payInvoice(service, seed), payInvoice(service, seed)]);
    assert.equal(pays.length, 1, 'invoices.pay is called once');
    assert.deepEqual(results.map((result) => result.payment.status).sort(), ['nothing_to_pay', 'paid']);
  } finally {
    await removeTenant(seed.tenantId);
  }
}

/**
 * A second call (another tab) while the first one still waits on Stripe beyond the request's lock
 * wait: a clean refusal with its code, nothing charged twice.
 */
async function testSecondCallDuringALongPaymentIsRefused() {
  const seed = await seedTenant('busy');
  try {
    const { service, pays } = stripeAccount(seed, { pay: 'paid', payDelay: 1500 });
    const first = payInvoice(service, seed);
    await delay(300);
    const second = await payInvoice(service, seed, '200ms').then(
      () => { throw new Error('the second call should be refused'); },
      (error: any) => error,
    );
    assert.equal(second?.getStatus?.(), 409);
    assert.equal(second?.getResponse?.()?.code, 'INVOICE_PAYMENT_IN_PROGRESS');
    assert.equal((await first).payment.status, 'paid');
    assert.equal(pays.length, 1);
  } finally {
    await removeTenant(seed.tenantId);
  }
}

async function main() {
  await dataSource.initialize();
  try {
    await testNewCardPaysTheInvoiceAtOnce();
    await testCustomerCardWhenTheSubscriptionHasNone();
    await testRefusedCardIsNotChargedAgain();
    await testRefusalAndAuthenticationAreAnswered();
    await testPaidMeanwhileAndProcessingAreNotRefusals();
    await testBankTransferIsNotCharged();
    await testTwoCallsTogetherPayOnce();
    await testSecondCallDuringALongPaymentIsRefused();
    // eslint-disable-next-line no-console
    console.log('billing-pay-invoice.integration.spec: all assertions passed');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
