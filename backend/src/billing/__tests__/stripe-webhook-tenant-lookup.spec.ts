import * as assert from 'node:assert/strict';
import { StripeWebhookService } from '../stripe-webhook.service';
import { SubscriptionStatus } from '../subscription.entity';

/**
 * A Stripe event has to be attributed to a tenant. The customer id is the normal route.
 * Its fallback used to search `subscriptions` by subscription id on a context-less
 * connection: that table is under FORCE RLS, so the query returned zero rows whatever the
 * data, and the fallback never worked.
 *
 * The mock reproduces that RLS semantic: subscription rows are only visible to a manager
 * whose runner carries the owning tenant as `app.current_tenant`.
 */

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function createService(state: {
  tenants: Array<{ id: string; stripe_customer_id: string | null }>;
  subscriptions: Array<{ tenant_id: string; stripe_subscription_id: string }>;
}) {
  const stats = { contextlessSubscriptionReads: 0 };
  const createQueryRunner = () => {
    let context: string | null = null;
    return {
      isTransactionActive: false,
      connect: async () => undefined,
      startTransaction: async () => undefined,
      commitTransaction: async () => undefined,
      rollbackTransaction: async () => undefined,
      release: async () => undefined,
      query: async (sql: string, params?: any[]) => {
        if (/set_config\('app\.current_tenant'/.test(sql)) context = params?.[0] ?? null;
        return [];
      },
      manager: {
        query: async (sql: string, params: any[] = []) => {
          if (!/FROM subscriptions/.test(sql)) return [];
          const [tenantId, subscriptionId] = params;
          return state.subscriptions
            .filter((row) => row.tenant_id === context) // RLS
            .filter((row) => row.tenant_id === tenantId && row.stripe_subscription_id === subscriptionId)
            .map(() => ({ '?column?': 1 }));
        },
      },
    };
  };
  const dataSource = {
    createQueryRunner,
    query: async (sql: string) => {
      if (/FROM subscriptions/.test(sql)) stats.contextlessSubscriptionReads += 1;
      return []; // RLS: no context, no rows
    },
    getRepository: () => ({
      findOne: async ({ where }: { where: Record<string, string> }) =>
        state.tenants.find((t) =>
          where.id ? t.id === where.id : t.stripe_customer_id === where.stripe_customer_id,
        ) ?? null,
    }),
  };
  const svc = new StripeWebhookService({} as any, {} as any, dataSource as any, {} as any);
  const lookup = (identifiers: { customerId?: string; subscriptionId?: string }, event?: unknown) =>
    (svc as any).lookupTenant(identifiers, event) as Promise<{ id: string } | null>;
  return { lookup, stats };
}

const subscriptionEvent = (tenantId: string, subscriptionId: string, customer: string) => ({
  type: 'customer.subscription.updated',
  data: { object: { object: 'subscription', id: subscriptionId, customer, metadata: { tenant_id: tenantId } } },
});

async function testResolvesByCustomerFirst() {
  const { lookup, stats } = createService({
    tenants: [{ id: TENANT_A, stripe_customer_id: 'cus_live' }],
    subscriptions: [],
  });
  const tenant = await lookup({ customerId: 'cus_live', subscriptionId: 'sub_1' });
  assert.equal(tenant?.id, TENANT_A);
  assert.equal(stats.contextlessSubscriptionReads, 0);
}

async function testFallsBackOnMetadataWhenTheStoredCustomerHasDrifted() {
  // Billing recreated the customer: the tenant now stores cus_new, while its live
  // subscription still belongs to cus_old and keeps sending events under that id.
  const { lookup, stats } = createService({
    tenants: [{ id: TENANT_A, stripe_customer_id: 'cus_new' }],
    subscriptions: [{ tenant_id: TENANT_A, stripe_subscription_id: 'sub_live' }],
  });
  const event = subscriptionEvent(TENANT_A, 'sub_live', 'cus_old');
  const tenant = await lookup({ customerId: 'cus_old', subscriptionId: 'sub_live' }, event);
  assert.equal(tenant?.id, TENANT_A, 'the event of the live subscription reaches its tenant');
  assert.equal(stats.contextlessSubscriptionReads, 0, 'subscriptions is never read without a tenant context');
}

async function testIgnoresASubscriptionTheTenantHasLeft() {
  // Applying an event rewrites the tenant's subscription row and customer id. A late
  // "deleted" event from an abandoned subscription must not overwrite the live one.
  const { lookup } = createService({
    tenants: [{ id: TENANT_A, stripe_customer_id: 'cus_new' }],
    subscriptions: [{ tenant_id: TENANT_A, stripe_subscription_id: 'sub_live' }],
  });
  const event = subscriptionEvent(TENANT_A, 'sub_abandoned', 'cus_old');
  assert.equal(await lookup({ customerId: 'cus_old', subscriptionId: 'sub_abandoned' }, event), null);
}

async function testMetadataCannotPointAtAnotherTenantsSubscription() {
  const { lookup } = createService({
    tenants: [{ id: TENANT_A, stripe_customer_id: null }, { id: TENANT_B, stripe_customer_id: null }],
    subscriptions: [{ tenant_id: TENANT_B, stripe_subscription_id: 'sub_b' }],
  });
  const event = subscriptionEvent(TENANT_A, 'sub_b', 'cus_x');
  assert.equal(await lookup({ customerId: 'cus_x', subscriptionId: 'sub_b' }, event), null);
}

async function testReadsTheHintFromAnInvoiceAndRejectsGarbage() {
  const { lookup } = createService({
    tenants: [{ id: TENANT_A, stripe_customer_id: null }],
    subscriptions: [{ tenant_id: TENANT_A, stripe_subscription_id: 'sub_live' }],
  });
  const invoice = {
    type: 'invoice.paid',
    data: { object: { object: 'invoice', customer: 'cus_old', subscription: 'sub_live', subscription_details: { metadata: { tenant_id: TENANT_A } } } },
  };
  assert.equal((await lookup({ customerId: 'cus_old', subscriptionId: 'sub_live' }, invoice))?.id, TENANT_A);

  const garbage = subscriptionEvent("x'; DROP TABLE tenants; --", 'sub_live', 'cus_old');
  assert.equal(await lookup({ customerId: 'cus_old', subscriptionId: 'sub_live' }, garbage), null);
  assert.equal(await lookup({ customerId: 'cus_old', subscriptionId: 'sub_live' }, undefined), null);
}

/**
 * Since basil, an invoice names its subscription under `parent.subscription_details` and a
 * subscription carries its period on its items. The webhook sync resolves both shapes and
 * never writes null over a stored period because the payload does not carry it.
 */
const PERIOD_START = 1_790_000_000;
const PERIOD_END = 1_792_592_000;
const STORED_END = new Date('2026-10-01T00:00:00.000Z');

function cloverSubscription(overrides: Record<string, unknown> = {}, item: Record<string, unknown> = {}) {
  return {
    object: 'subscription',
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    collection_method: 'charge_automatically',
    currency: 'eur',
    quantity: 1,
    items: {
      data: [{
        quantity: 1,
        current_period_start: PERIOD_START,
        current_period_end: PERIOD_END,
        price: { id: 'price_unknown', currency: 'eur', unit_amount: 24900, recurring: { interval: 'month' } },
        ...item,
      }],
    },
    ...overrides,
  };
}

function createSyncService(
  stored: Record<string, unknown>,
  stripeSubscription: unknown = null,
  opts: { tenantKnown?: boolean; invoiceUpdateError?: Error } = {},
) {
  const row: Record<string, any> = { id: 'local-sub', ...stored };
  const retrieved: string[] = [];
  const invoiceUpdates: unknown[][] = [];
  const manager = {
    getRepository: () => ({
      findOne: async () => row,
      create: (data: Record<string, unknown>) => ({ ...data }),
      save: async (data: Record<string, unknown>) => data,
    }),
  };
  const dataSource = {
    createQueryRunner: () => ({
      isTransactionActive: false,
      connect: async () => undefined,
      startTransaction: async () => undefined,
      commitTransaction: async () => undefined,
      rollbackTransaction: async () => undefined,
      release: async () => undefined,
      query: async () => [],
      manager,
    }),
    getRepository: () => ({
      findOne: async () => (opts.tenantKnown === false ? null : { id: TENANT_A, stripe_customer_id: 'cus_1' }),
      update: async () => undefined,
    }),
  };
  const client = {
    subscriptions: {
      retrieve: async (id: string) => {
        retrieved.push(id);
        return stripeSubscription;
      },
    },
    invoices: {
      update: async (...args: unknown[]) => {
        invoiceUpdates.push(args);
        if (opts.invoiceUpdateError) throw opts.invoiceUpdateError;
        return { id: args[0] };
      },
    },
  };
  const svc = new StripeWebhookService(
    {} as any,
    { getClient: () => client } as any,
    dataSource as any,
    { log: async () => undefined } as any,
  );
  (svc as any).logger = { warn: () => undefined, log: () => undefined, debug: () => undefined, error: () => undefined };
  return { svc, row, retrieved, invoiceUpdates };
}

async function testCloverInvoiceResolvesItsSubscription() {
  const { svc, row, retrieved } = createSyncService(
    { stripe_subscription_id: 'sub_1', status: SubscriptionStatus.ACTIVE },
    cloverSubscription({ status: 'past_due' }),
  );
  await svc.processEvent({
    id: 'evt_1',
    type: 'invoice.payment_failed',
    data: {
      object: {
        object: 'invoice',
        id: 'in_1',
        customer: 'cus_1',
        status: 'open',
        number: 'KANAP-0002',
        total: 24900,
        currency: 'eur',
        parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_1', metadata: {} } },
      },
    },
  });
  assert.deepEqual(retrieved, ['sub_1'], 'the subscription named by invoice.parent is synced');
  assert.equal(row.status, SubscriptionStatus.PAST_DUE);
  assert.equal(row.latest_invoice_id, 'in_1');
  assert.equal(row.latest_invoice_status, 'open');
  assert.equal(row.current_period_end?.getTime(), PERIOD_END * 1000);
}

async function testCloverSubscriptionUpdatedWritesThePeriods() {
  const { svc, row } = createSyncService({ stripe_subscription_id: 'sub_1', current_period_end: STORED_END, next_payment_at: STORED_END });
  await svc.processEvent({ id: 'evt_2', type: 'customer.subscription.updated', data: { object: cloverSubscription() } });
  assert.equal(row.current_period_start?.getTime(), PERIOD_START * 1000);
  assert.equal(row.current_period_end?.getTime(), PERIOD_END * 1000);
  assert.equal(row.next_payment_at?.getTime(), PERIOD_END * 1000);
  assert.equal(row.canceled_at_effective, null);
}

async function testSubscriptionEventWithoutPeriodKeepsTheStoredDates() {
  const { svc, row } = createSyncService({
    stripe_subscription_id: 'sub_1',
    current_period_end: STORED_END,
    next_payment_at: STORED_END,
    canceled_at_effective: STORED_END,
  });
  const payload = cloverSubscription({ cancel_at_period_end: true }, { current_period_start: undefined, current_period_end: undefined });
  await svc.processEvent({ id: 'evt_3', type: 'customer.subscription.updated', data: { object: payload } });
  assert.equal(row.current_period_end?.getTime(), STORED_END.getTime());
  assert.equal(row.next_payment_at?.getTime(), STORED_END.getTime());
  assert.equal(row.canceled_at_effective?.getTime(), STORED_END.getTime());
}

/**
 * Invoice PDFs are A4. `invoice.created` and `invoice.finalized` set the format on every
 * invoice of the account, before and apart from the tenant lookup (an Enterprise Support
 * invoice has no tenant), and a Stripe error there does not stop the event.
 */
const A4 = { rendering: { pdf: { page_size: 'a4' } } };

function invoiceEvent(type: string, invoice: Record<string, unknown>) {
  return { id: 'evt_inv', type, data: { object: { object: 'invoice', status: 'open', ...invoice } } };
}

async function testInvoiceWithoutTenantIsSetToA4() {
  const { svc, invoiceUpdates } = createSyncService({}, null, { tenantKnown: false });
  await svc.processEvent(invoiceEvent('invoice.finalized', { id: 'in_support', customer: 'cus_unknown' }));
  assert.deepEqual(invoiceUpdates, [['in_support', A4]]);

  const created = createSyncService({}, null, { tenantKnown: false });
  await created.svc.processEvent(invoiceEvent('invoice.created', { id: 'in_new', customer: 'cus_unknown', rendering: { pdf: { page_size: 'letter' } } }));
  assert.deepEqual(created.invoiceUpdates, [['in_new', A4]]);
}

async function testInvoiceAlreadyA4AndOtherEventsAreLeftAlone() {
  const { svc, invoiceUpdates } = createSyncService({}, null, { tenantKnown: false });
  await svc.processEvent(invoiceEvent('invoice.finalized', { id: 'in_a4', customer: 'cus_unknown', ...A4 }));
  await svc.processEvent(invoiceEvent('invoice.paid', { id: 'in_paid', customer: 'cus_unknown' }));
  await svc.processEvent(invoiceEvent('invoice.updated', { id: 'in_upd', customer: 'cus_unknown' }));
  assert.deepEqual(invoiceUpdates, []);
}

async function testStripeErrorOnA4DoesNotStopTheEvent() {
  const { svc, row, invoiceUpdates } = createSyncService(
    { stripe_subscription_id: 'sub_1', status: SubscriptionStatus.ACTIVE },
    cloverSubscription(),
    { invoiceUpdateError: new Error('Stripe is down') },
  );
  await svc.processEvent(invoiceEvent('invoice.finalized', {
    id: 'in_2',
    customer: 'cus_1',
    number: 'KANAP-0003',
    parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_1', metadata: {} } },
  }));
  assert.equal(invoiceUpdates.length, 1, 'the A4 update was attempted');
  assert.equal(row.latest_invoice_id, 'in_2', 'the event is still applied to the tenant');
  assert.equal(row.latest_invoice_number, 'KANAP-0003');
}

async function run() {
  await testResolvesByCustomerFirst();
  await testFallsBackOnMetadataWhenTheStoredCustomerHasDrifted();
  await testIgnoresASubscriptionTheTenantHasLeft();
  await testMetadataCannotPointAtAnotherTenantsSubscription();
  await testReadsTheHintFromAnInvoiceAndRejectsGarbage();
  await testCloverInvoiceResolvesItsSubscription();
  await testCloverSubscriptionUpdatedWritesThePeriods();
  await testSubscriptionEventWithoutPeriodKeepsTheStoredDates();
  await testInvoiceWithoutTenantIsSetToA4();
  await testInvoiceAlreadyA4AndOtherEventsAreLeftAlone();
  await testStripeErrorOnA4DoesNotStopTheEvent();
}

void run();
