import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { withTenant } from '../../common/tenant-runner';
import { StripeWebhookService } from '../stripe-webhook.service';
import { BillingService } from '../billing.service';
import { CollectionMethod, Subscription, SubscriptionStatus } from '../subscription.entity';

// A refused payment: the tenant's row keeps the code and the message of the refusal, read where
// Stripe carries them since basil (the PaymentIntent of the invoice, and the
// `payment_intent.payment_failed` event), until that invoice is paid. Stripe events replayed
// against a real database with a simulated Stripe client; the tenants are removed at the end.

const A4 = { rendering: { pdf: { page_size: 'a4' } } };
const DECLINED = {
  code: 'card_declined',
  decline_code: 'insufficient_funds',
  message: 'Your card has insufficient funds.',
  payment_method: { id: 'pm_old', object: 'payment_method' },
};

type Seed = { tenantId: string; customerId: string; subscriptionId: string };

async function seedTenant(tag: string): Promise<Seed> {
  const tenantId = randomUUID();
  const customerId = `cus_spec_${tenantId.slice(0, 8)}`;
  const subscriptionId = `sub_spec_${tenantId.slice(0, 8)}`;
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, stripe_customer_id, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `payment-failure-${tag}-${tenantId.slice(0, 8)}`, `Payment failure ${tag}`, customerId],
  );
  await withTenant(dataSource, tenantId, (manager) =>
    manager.query(
      `INSERT INTO subscriptions (tenant_id, status, stripe_subscription_id, stripe_customer_id, plan_name, seat_limit, active_seats, collection_method)
       VALUES ($1, 'active', $2, $3, 'Kadratis Cloud', NULL, 1, 'charge_automatically')`,
      [tenantId, subscriptionId, customerId],
    ),
  ).catch(async (error) => {
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    throw error;
  });
  return { tenantId, customerId, subscriptionId };
}

async function removeTenant(tenantId: string) {
  await withTenant(dataSource, tenantId, (manager) => manager.query(`DELETE FROM subscriptions WHERE tenant_id = $1`, [tenantId]));
  await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
}

async function storedError(tenantId: string): Promise<{ code: string | null; message: string | null; status: string | null }> {
  const rows = await withTenant(dataSource, tenantId, (manager) =>
    manager.query(
      `SELECT last_payment_error_code, last_payment_error_message, latest_invoice_status FROM subscriptions WHERE tenant_id = $1`,
      [tenantId],
    ),
  );
  return { code: rows[0]?.last_payment_error_code ?? null, message: rows[0]?.last_payment_error_message ?? null, status: rows[0]?.latest_invoice_status ?? null };
}

/**
 * A Stripe account holding one subscription whose latest invoice is `invoiceId`. `invoices` gives
 * each invoice as `invoices.retrieve` returns it with its payments expanded; `retrieves` records
 * the expansions asked for.
 */
function stripeAccount(seed: Seed, invoiceId: string | (() => string), invoices: Record<string, any>) {
  const retrieves: Array<{ id: string; expand: string[] }> = [];
  const client = {
    subscriptions: {
      retrieve: async () => ({
        object: 'subscription',
        id: seed.subscriptionId,
        customer: seed.customerId,
        status: 'past_due',
        collection_method: 'charge_automatically',
        currency: 'eur',
        latest_invoice: typeof invoiceId === 'function' ? invoiceId() : invoiceId,
        default_payment_method: 'pm_old',
        items: { data: [{ quantity: 1, price: { id: 'price_spec', currency: 'eur', unit_amount: 24900, recurring: { interval: 'month' } } }] },
      }),
    },
    paymentMethods: { retrieve: async (id: string) => ({ id, type: 'card', card: { brand: 'visa', last4: '0341' } }) },
    invoices: {
      update: async (id: string) => ({ id }),
      retrieve: async (id: string, params?: { expand?: string[] }) => {
        retrieves.push({ id, expand: params?.expand ?? [] });
        return invoices[id] ?? null;
      },
    },
  };
  const config = { getApiVersion: () => '2025-09-30.clover' };
  const svc = new StripeWebhookService(config as any, { getClient: () => client } as any, dataSource, { log: async () => undefined } as any);
  (svc as any).logger = { warn: () => undefined, log: () => undefined, debug: () => undefined, error: () => undefined };
  return { svc, retrieves };
}

function invoiceEvent(seed: Seed, type: string, invoice: Record<string, unknown>) {
  return {
    id: `evt_${type}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    data: {
      object: {
        object: 'invoice',
        customer: seed.customerId,
        parent: { type: 'subscription_details', subscription_details: { subscription: seed.subscriptionId, metadata: {} } },
        total: 24900,
        currency: 'eur',
        created: 1_792_000_000,
        ...A4,
        ...invoice,
      },
    },
  };
}

function paymentIntentFailed(seed: Seed, paymentIntentId: string) {
  return {
    id: `evt_pi_${paymentIntentId}`,
    type: 'payment_intent.payment_failed',
    data: {
      object: {
        object: 'payment_intent',
        id: paymentIntentId,
        customer: seed.customerId,
        status: 'requires_payment_method',
        metadata: {},
        last_payment_error: DECLINED,
      },
    },
  };
}

/** The invoice as `invoices.retrieve` gives it with `payments.data.payment.payment_intent` expanded. */
function invoiceWithPayment(invoiceId: string, status: string, paymentIntentId: string) {
  return {
    object: 'invoice',
    id: invoiceId,
    status,
    number: 'KAN-0047',
    payments: {
      data: [{
        object: 'invoice_payment',
        status: 'open',
        created: 1_792_003_600,
        payment: { type: 'payment_intent', payment_intent: { id: paymentIntentId, object: 'payment_intent', last_payment_error: DECLINED } },
      }],
    },
  };
}

/**
 * A card renewal refused, then paid: the reason is written from the PaymentIntent event and from
 * the invoice's PaymentIntent, stays through later events of the open invoice, and is cleared
 * when that invoice is paid.
 */
async function testRefusalIsKeptUntilTheInvoiceIsPaid() {
  const seed = await seedTenant('kept');
  try {
    const invoiceId = `in_spec_${seed.tenantId.slice(0, 8)}`;
    const { svc } = stripeAccount(seed, invoiceId, { [invoiceId]: invoiceWithPayment(invoiceId, 'open', 'pi_refused') });

    await svc.processEvent(invoiceEvent(seed, 'invoice.created', { id: invoiceId, status: 'draft', number: null }));
    await svc.processEvent(paymentIntentFailed(seed, 'pi_refused'));
    assert.deepEqual(await storedError(seed.tenantId), { code: 'insufficient_funds', message: DECLINED.message, status: 'draft' }, 'the PaymentIntent event writes the reason');

    await svc.processEvent(invoiceEvent(seed, 'invoice.payment_failed', { id: invoiceId, status: 'open', number: 'KAN-0047' }));
    assert.deepEqual(await storedError(seed.tenantId), { code: 'insufficient_funds', message: DECLINED.message, status: 'open' }, 'invoice.payment_failed keeps it');

    await svc.processEvent(invoiceEvent(seed, 'invoice.updated', { id: invoiceId, status: 'open', number: 'KAN-0047' }));
    assert.equal((await storedError(seed.tenantId)).code, 'insufficient_funds', 'another event of the open invoice keeps it');

    await svc.processEvent(invoiceEvent(seed, 'invoice.paid', { id: invoiceId, status: 'paid', number: 'KAN-0047' }));
    assert.deepEqual(await storedError(seed.tenantId), { code: null, message: null, status: 'paid' }, 'the payment of the invoice clears it');
  } finally {
    await removeTenant(seed.tenantId);
  }
}

/** Without the PaymentIntent event, `invoice.payment_failed` reads the reason on the invoice's PaymentIntent. */
async function testInvoiceFailureReadsItsPaymentIntent() {
  const seed = await seedTenant('invoice');
  try {
    const invoiceId = `in_spec_${seed.tenantId.slice(0, 8)}`;
    const { svc, retrieves } = stripeAccount(seed, invoiceId, { [invoiceId]: invoiceWithPayment(invoiceId, 'open', 'pi_refused') });
    await svc.processEvent(invoiceEvent(seed, 'invoice.finalized', { id: invoiceId, status: 'open', number: 'KAN-0047' }));
    assert.equal((await storedError(seed.tenantId)).code, null, 'nothing refused yet');
    await svc.processEvent(invoiceEvent(seed, 'invoice.payment_failed', { id: invoiceId, status: 'open', number: 'KAN-0047' }));
    assert.deepEqual(await storedError(seed.tenantId), { code: 'insufficient_funds', message: DECLINED.message, status: 'open' });
    assert.ok(
      retrieves.some((call) => call.id === invoiceId && call.expand.includes('payments.data.payment.payment_intent')),
      'the invoice is read with its PaymentIntents',
    );
  } finally {
    await removeTenant(seed.tenantId);
  }
}

/** A refused PaymentIntent that does not pay the tenant's latest invoice writes nothing. */
async function testRefusalOfAnotherPaymentIsIgnored() {
  const seed = await seedTenant('other');
  try {
    const invoiceId = `in_spec_${seed.tenantId.slice(0, 8)}`;
    const { svc } = stripeAccount(seed, invoiceId, { [invoiceId]: invoiceWithPayment(invoiceId, 'open', 'pi_of_the_invoice') });
    await svc.processEvent(invoiceEvent(seed, 'invoice.finalized', { id: invoiceId, status: 'open', number: 'KAN-0047' }));
    await svc.processEvent(paymentIntentFailed(seed, 'pi_elsewhere'));
    assert.deepEqual(await storedError(seed.tenantId), { code: null, message: null, status: 'open' });
  } finally {
    await removeTenant(seed.tenantId);
  }
}

/**
 * The row follows another invoice: the refused one is voided and a new invoice, not tried yet,
 * becomes the latest. The reason of the voided invoice's refusal goes with it.
 */
async function testReasonGoesWithTheInvoiceItBelongsTo() {
  const seed = await seedTenant('next');
  try {
    const refused = `in_spec_${seed.tenantId.slice(0, 8)}_a`;
    const next = `in_spec_${seed.tenantId.slice(0, 8)}_b`;
    let latest = refused;
    const { svc } = stripeAccount(seed, () => latest, {
      [refused]: invoiceWithPayment(refused, 'open', 'pi_refused'),
      [next]: { object: 'invoice', id: next, status: 'open', number: 'KAN-0048', payments: { data: [] } },
    });
    await svc.processEvent(invoiceEvent(seed, 'invoice.payment_failed', { id: refused, status: 'open', number: 'KAN-0047' }));
    assert.equal((await storedError(seed.tenantId)).code, 'insufficient_funds');
    await svc.processEvent(invoiceEvent(seed, 'invoice.voided', { id: refused, status: 'void', number: 'KAN-0047' }));
    latest = next;
    await svc.processEvent(invoiceEvent(seed, 'invoice.finalized', { id: next, status: 'open', number: 'KAN-0048' }));
    assert.deepEqual(await storedError(seed.tenantId), { code: null, message: null, status: 'open' }, 'the new invoice has no refusal yet');
  } finally {
    await removeTenant(seed.tenantId);
  }
}

/** The same on a refresh from Stripe (the billing page forces one): another latest invoice, no reason. */
async function testRefreshClearsTheReasonOfAnotherInvoice() {
  const row = {
    tenant_id: 'tenant-1',
    status: SubscriptionStatus.PAST_DUE,
    collection_method: CollectionMethod.CHARGE_AUTOMATICALLY,
    stripe_subscription_id: 'sub_1',
    latest_invoice_id: 'in_refused',
    latest_invoice_status: 'open',
    last_payment_error_code: 'insufficient_funds',
    last_payment_error_message: DECLINED.message,
  } as Subscription;
  const client = {
    subscriptions: {
      retrieve: async () => ({
        id: 'sub_1',
        status: 'past_due',
        collection_method: 'charge_automatically',
        latest_invoice: { object: 'invoice', id: 'in_next', status: 'open', number: 'KAN-0048', payments: { data: [] } },
        items: { data: [{ quantity: 1 }] },
      }),
    },
    invoices: { retrieve: async (id: string) => ({ object: 'invoice', id, status: 'open', payments: { data: [] } }) },
  };
  const service = new BillingService({} as any, {} as any, {} as any, { getClient: () => client } as any, {} as any, {} as any, {} as any);
  (service as any).logger = { warn: () => undefined, log: () => undefined, debug: () => undefined, error: () => undefined };
  const manager = { getRepository: () => ({ save: async (data: Subscription) => data }) };
  const sub: Subscription = await (service as any).refreshSubscriptionFromStripe(row, manager);
  assert.equal(sub.latest_invoice_id, 'in_next');
  assert.equal(sub.last_payment_error_code, null);
  assert.equal(sub.last_payment_error_message, null);
}

async function main() {
  await dataSource.initialize();
  try {
    await testRefusalIsKeptUntilTheInvoiceIsPaid();
    await testInvoiceFailureReadsItsPaymentIntent();
    await testRefusalOfAnotherPaymentIsIgnored();
    await testReasonGoesWithTheInvoiceItBelongsTo();
    await testRefreshClearsTheReasonOfAnotherInvoice();
    // eslint-disable-next-line no-console
    console.log('stripe-payment-failure.integration.spec: all assertions passed');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
