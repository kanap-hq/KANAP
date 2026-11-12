import * as assert from 'node:assert/strict';
import { FindOperator } from 'typeorm';
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
 *
 * A deleted workspace keeps its customer id. `findOne` applies `deleted_at: IsNull()`
 * when the caller asks for it, and still returns a deleted row when it does not.
 */

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function expectsLiveWorkspace(deletedAt: unknown): boolean {
  return deletedAt instanceof FindOperator && deletedAt.type === 'isNull';
}

function createService(state: {
  tenants: Array<{ id: string; stripe_customer_id: string | null; deleted_at?: Date | null }>;
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
      findOne: async ({ where }: { where: Record<string, unknown> }) =>
        state.tenants.find((t) => {
          if (expectsLiveWorkspace(where.deleted_at) && t.deleted_at != null) return false;
          return where.id ? t.id === where.id : t.stripe_customer_id === where.stripe_customer_id;
        }) ?? null,
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

const DELETED_AT = new Date('2026-06-01T00:00:00.000Z');

async function testDeletedWorkspaceIsNotResolvedByCustomer() {
  const { lookup, stats } = createService({
    tenants: [{ id: TENANT_A, stripe_customer_id: 'cus_live', deleted_at: DELETED_AT }],
    subscriptions: [],
  });
  assert.equal(await lookup({ customerId: 'cus_live', subscriptionId: 'sub_1' }), null);
  assert.equal(stats.contextlessSubscriptionReads, 0);
}

async function testDeletedWorkspaceIsNotResolvedByMetadataHint() {
  // The stored customer has drifted, so only the metadata hint can reach the workspace.
  // Deletion closes that route too: the subscription row still exists, the workspace does not.
  const { lookup, stats } = createService({
    tenants: [{ id: TENANT_A, stripe_customer_id: 'cus_new', deleted_at: DELETED_AT }],
    subscriptions: [{ tenant_id: TENANT_A, stripe_subscription_id: 'sub_live' }],
  });
  const event = subscriptionEvent(TENANT_A, 'sub_live', 'cus_old');
  assert.equal(await lookup({ customerId: 'cus_old', subscriptionId: 'sub_live' }, event), null);
  assert.equal(stats.contextlessSubscriptionReads, 0);
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
  opts: { tenantKnown?: boolean; invoiceUpdateError?: Error; setupIntent?: Record<string, unknown> } = {},
) {
  const row: Record<string, any> = { id: 'local-sub', ...stored };
  const retrieved: string[] = [];
  const invoiceUpdates: unknown[][] = [];
  const customerUpdates: unknown[][] = [];
  /** Transactions open when each payment method was read from Stripe. */
  const paymentMethodReads: number[] = [];
  let openTransactions = 0;
  const queries: string[] = [];
  const manager = {
    query: async (sql: string) => {
      queries.push(sql);
      return [];
    },
    getRepository: () => ({
      // The tenant's one row; a search by subscription id finds it only when it carries that id.
      findOne: async ({ where }: { where: Record<string, unknown> }) =>
        (where?.stripe_subscription_id && where.stripe_subscription_id !== row.stripe_subscription_id ? null : row),
      create: (data: Record<string, unknown>) => ({ ...data }),
      save: async (data: Record<string, unknown>) => data,
    }),
  };
  const dataSource = {
    createQueryRunner: () => {
      const runner = {
        isTransactionActive: false,
        connect: async () => undefined,
        startTransaction: async () => {
          runner.isTransactionActive = true;
          openTransactions += 1;
        },
        commitTransaction: async () => {
          runner.isTransactionActive = false;
          openTransactions -= 1;
        },
        rollbackTransaction: async () => {
          runner.isTransactionActive = false;
          openTransactions -= 1;
        },
        release: async () => undefined,
        query: async () => [],
        manager,
      };
      return runner;
    },
    getRepository: () => ({
      findOne: async () => (opts.tenantKnown === false ? null : { id: TENANT_A, stripe_customer_id: 'cus_1' }),
      update: async () => undefined,
    }),
  };
  const client = {
    subscriptions: {
      retrieve: async (id: string, options?: { expand?: string[] }) => {
        retrieved.push(id);
        // Stripe expands the latest invoice only on request.
        const latest = (stripeSubscription as any)?.latest_invoice;
        if (latest && typeof latest === 'object' && !options?.expand?.includes('latest_invoice')) {
          return { ...(stripeSubscription as any), latest_invoice: latest.id };
        }
        return stripeSubscription;
      },
    },
    invoices: {
      update: async (...args: unknown[]) => {
        invoiceUpdates.push(args);
        if (opts.invoiceUpdateError) throw opts.invoiceUpdateError;
        return { id: args[0] };
      },
      // Read on `invoice.payment_failed` for the reason of the refusal: none here.
      retrieve: async (id: string) => ({ id, payments: { data: [] } }),
    },
    setupIntents: {
      retrieve: async (id: string) => ({ id, ...(opts.setupIntent ?? {}) }),
    },
    paymentMethods: {
      retrieve: async (id: string) => {
        paymentMethodReads.push(openTransactions);
        return { id, type: 'card', card: { brand: 'visa', last4: '4242' } };
      },
    },
    customers: {
      update: async (...args: unknown[]) => {
        customerUpdates.push(args);
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
  const logs = { warn: [] as string[], error: [] as string[] };
  (svc as any).logger = {
    warn: (message: string) => logs.warn.push(message),
    log: () => undefined,
    debug: () => undefined,
    error: (message: string) => logs.error.push(message),
  };
  return { svc, row, retrieved, invoiceUpdates, customerUpdates, logs, paymentMethodReads, queries };
}

/**
 * The events of a tenant are handled one after the other: a transaction lock per tenant comes
 * first (`stripe-webhook-serialization.integration.spec.ts` runs two events together), and the
 * payment method is read from Stripe before the transaction, which holds no Stripe call.
 */
async function testEventHandlingIsSerializedPerTenant() {
  const { svc, row, paymentMethodReads, queries } = createSyncService({ stripe_subscription_id: 'sub_1' });
  await svc.processEvent({
    id: 'evt_pm',
    type: 'customer.subscription.updated',
    data: { object: cloverSubscription({ default_payment_method: 'pm_1' }) },
  });
  assert.equal(row.default_payment_method_id, 'pm_1');
  assert.equal(row.default_payment_method_brand, 'VISA');
  assert.equal(row.default_payment_method_last4, '4242');
  assert.deepEqual(paymentMethodReads, [0], 'the payment method is read outside the transaction');
  assert.ok(/pg_advisory_xact_lock/.test(queries[0] ?? ''), `the transaction starts with the tenant's lock: ${queries[0]}`);
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
 * A live subscription whose cancellation is set ends on a known date. Since basil the customer
 * portal sets `cancel_at` (with `cancel_at_period_end` false); the older flag ends it with the
 * current period. Taking the cancellation back clears the date.
 */
const CANCEL_AT = PERIOD_END - 3 * 86400;

async function testCancellationSetsTheEndDate() {
  const portal = createSyncService({ stripe_subscription_id: 'sub_1' });
  await portal.svc.processEvent({
    id: 'evt_cancel_at',
    type: 'customer.subscription.updated',
    data: { object: cloverSubscription({ cancel_at: CANCEL_AT, cancel_at_period_end: false }) },
  });
  assert.equal(portal.row.canceled_at_effective?.getTime(), CANCEL_AT * 1000, 'cancel_at is the end date');

  const flag = createSyncService({ stripe_subscription_id: 'sub_1' });
  await flag.svc.processEvent({
    id: 'evt_period_end',
    type: 'customer.subscription.updated',
    data: { object: cloverSubscription({ cancel_at: null, cancel_at_period_end: true }) },
  });
  assert.equal(flag.row.canceled_at_effective?.getTime(), PERIOD_END * 1000, 'cancel_at_period_end ends with the period');

  const back = createSyncService({ stripe_subscription_id: 'sub_1', canceled_at_effective: new Date(CANCEL_AT * 1000) });
  await back.svc.processEvent({
    id: 'evt_kept',
    type: 'customer.subscription.updated',
    data: { object: cloverSubscription({ cancel_at: null, cancel_at_period_end: false }) },
  });
  assert.equal(back.row.canceled_at_effective, null, 'a cancellation taken back clears the end date');
}

/**
 * Each sync writes how the subscription is paid from its collection method, and the payment
 * term as Stripe sends it: null for a card subscription.
 */
async function testSyncWritesThePaymentModeAndTerm() {
  const toCard = createSyncService({
    stripe_subscription_id: 'sub_1',
    payment_mode: 'bank_transfer',
    collection_method: 'send_invoice',
    days_until_due: 30,
  });
  await toCard.svc.processEvent({
    id: 'evt_to_card',
    type: 'customer.subscription.updated',
    data: { object: cloverSubscription({ collection_method: 'charge_automatically', days_until_due: null }) },
  });
  assert.equal(toCard.row.collection_method, 'charge_automatically');
  assert.equal(toCard.row.payment_mode, 'card');
  assert.equal(toCard.row.days_until_due, null);

  const toTransfer = createSyncService({ stripe_subscription_id: 'sub_1', payment_mode: 'card', collection_method: 'charge_automatically' });
  await toTransfer.svc.processEvent({
    id: 'evt_to_transfer',
    type: 'customer.subscription.updated',
    data: { object: cloverSubscription({ collection_method: 'send_invoice', days_until_due: 30 }) },
  });
  assert.equal(toTransfer.row.payment_mode, 'bank_transfer');
  assert.equal(toTransfer.row.days_until_due, 30);
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

/**
 * Stripe does not send events in order. The latest invoice of the row never goes back to an
 * earlier state of the same invoice (`paid` then `finalized`), nor to another invoice than the
 * latest one of the subscription read from Stripe (an older one arriving late, or one created in
 * the same second); a new invoice brings its own number, none for a draft.
 */
const SUB_1_PARENT = { type: 'subscription_details', subscription_details: { subscription: 'sub_1', metadata: {} } };

async function testInvoiceStatusNeverGoesBack() {
  const { svc, row } = createSyncService({ stripe_subscription_id: 'sub_1' }, cloverSubscription({ latest_invoice: 'in_1' }));
  const invoice = { id: 'in_1', customer: 'cus_1', number: 'KAN-0046', total: 24900, currency: 'eur', created: 1_792_000_000, parent: SUB_1_PARENT };
  await svc.processEvent(invoiceEvent('invoice.paid', { ...invoice, status: 'paid' }));
  await svc.processEvent(invoiceEvent('invoice.finalized', { ...invoice, status: 'open' }));
  assert.equal(row.latest_invoice_id, 'in_1');
  assert.equal(row.latest_invoice_status, 'paid', 'a late finalized event does not reopen a paid invoice');
  assert.equal(row.latest_invoice_number, 'KAN-0046');

  // An event of an older invoice arriving late leaves the latest one in place.
  await svc.processEvent(invoiceEvent('invoice.paid', { ...invoice, id: 'in_0', number: 'KAN-0045', created: 1_789_000_000, status: 'paid' }));
  assert.equal(row.latest_invoice_id, 'in_1');
  assert.equal(row.latest_invoice_number, 'KAN-0046');
}

async function testInvoicesOfTheSameSecondFollowTheSubscription() {
  // A plan change: the proration invoice and the new period's one, created in the same second.
  const created = 1_792_000_000;
  const stored = {
    stripe_subscription_id: 'sub_1',
    latest_invoice_id: 'in_new',
    latest_invoice_status: 'paid',
    latest_invoice_number: 'KAN-0047',
    latest_invoice_created: new Date(created * 1000),
  };
  const { svc, row } = createSyncService({ ...stored }, cloverSubscription({ latest_invoice: 'in_new' }));
  await svc.processEvent(invoiceEvent('invoice.paid', {
    id: 'in_other', customer: 'cus_1', number: 'KAN-0046', status: 'paid', total: 100, currency: 'eur', created, parent: SUB_1_PARENT,
  }));
  assert.equal(row.latest_invoice_id, 'in_new', 'an invoice that is not the latest one of the subscription is not written');
  assert.equal(row.latest_invoice_number, 'KAN-0047');

  // The subscription's latest invoice is written, even when created in the same second.
  const next = createSyncService({ ...stored }, cloverSubscription({ latest_invoice: { id: 'in_next' } }));
  await next.svc.processEvent(invoiceEvent('invoice.finalized', {
    id: 'in_next', customer: 'cus_1', number: 'KAN-0048', status: 'open', total: 24900, currency: 'eur', created, parent: SUB_1_PARENT,
  }));
  assert.equal(next.row.latest_invoice_id, 'in_next');
  assert.equal(next.row.latest_invoice_number, 'KAN-0048');
}

async function testDraftInvoiceHasNoNumber() {
  const { svc, row } = createSyncService(
    {
      stripe_subscription_id: 'sub_1',
      latest_invoice_id: 'in_1',
      latest_invoice_status: 'paid',
      latest_invoice_number: 'KAN-0045',
      latest_invoice_url: 'https://invoice.stripe.test/in_1',
      latest_invoice_pdf: 'https://invoice.stripe.test/in_1.pdf',
      latest_invoice_created: new Date(1_789_000_000 * 1000),
    },
    cloverSubscription({ latest_invoice: 'in_2' }),
  );
  await svc.processEvent(invoiceEvent('invoice.created', {
    id: 'in_2', customer: 'cus_1', status: 'draft', number: null, hosted_invoice_url: null, invoice_pdf: null,
    total: 24900, currency: 'eur', created: 1_792_000_000, parent: SUB_1_PARENT,
  }));
  assert.equal(row.latest_invoice_id, 'in_2');
  assert.equal(row.latest_invoice_status, 'draft');
  assert.equal(row.latest_invoice_number, null, 'a draft does not keep the number of the previous invoice');
  assert.equal(row.latest_invoice_url, null);
  assert.equal(row.latest_invoice_pdf, null);
}

/**
 * A tenant follows one Stripe subscription. An event of another subscription of the same customer
 * (one the tenant has left) is logged and ignored; it takes the row only when the row has no
 * subscription yet, or when the row's subscription has ended and the event's still runs (a new
 * subscription after a cancellation). An ignored subscription that still runs is logged as an
 * error, with the tenant and both subscriptions, for support to see.
 */
async function testEventOfAnotherSubscriptionIsIgnored() {
  const live = {
    stripe_subscription_id: 'sub_B',
    status: SubscriptionStatus.ACTIVE,
    subscription_type: 'annual',
    payment_mode: 'bank_transfer',
    latest_invoice_id: 'in_B',
    latest_invoice_number: 'KAN-0043',
  };
  const { svc, row, logs } = createSyncService({ ...live }, cloverSubscription({ id: 'sub_A', status: 'past_due' }));
  await svc.processEvent(invoiceEvent('invoice.payment_failed', {
    id: 'in_A', customer: 'cus_1', number: 'KAN-0042', total: 24900, currency: 'eur',
    parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_A', metadata: {} } },
  }));
  await svc.processEvent({
    id: 'evt_old_sub',
    type: 'customer.subscription.updated',
    data: { object: cloverSubscription({ id: 'sub_A', status: 'past_due' }) },
  });
  assert.deepEqual(
    Object.fromEntries(Object.keys(live).map((key) => [key, row[key]])),
    live,
    'the row still follows sub_B',
  );
  assert.equal(logs.error.length, 2, 'each ignored event of a running subscription is an error');
  for (const message of logs.error) {
    for (const part of [TENANT_A, 'sub_B', 'sub_A']) assert.ok(message.includes(part), `${part} in: ${message}`);
  }
  assert.equal(logs.warn.length, 0);

  // First subscription: the row takes it.
  const first = createSyncService({ stripe_subscription_id: null, status: SubscriptionStatus.TRIALING });
  await first.svc.processEvent({ id: 'evt_first', type: 'customer.subscription.updated', data: { object: cloverSubscription({ id: 'sub_new' }) } });
  assert.equal(first.row.stripe_subscription_id, 'sub_new');
  assert.equal(first.row.status, SubscriptionStatus.ACTIVE);

  // A new subscription after a cancellation takes the row; another ended one does not.
  const renewed = createSyncService({ stripe_subscription_id: 'sub_old', status: SubscriptionStatus.CANCELED });
  await renewed.svc.processEvent({ id: 'evt_late', type: 'customer.subscription.deleted', data: { object: cloverSubscription({ id: 'sub_older', status: 'canceled' }) } });
  assert.equal(renewed.row.stripe_subscription_id, 'sub_old');
  // An ended subscription ignored: a warning only.
  assert.equal(renewed.logs.error.length, 0);
  assert.equal(renewed.logs.warn.length, 1);
  await renewed.svc.processEvent({ id: 'evt_renew', type: 'customer.subscription.created', data: { object: cloverSubscription({ id: 'sub_new' }) } });
  assert.equal(renewed.row.stripe_subscription_id, 'sub_new');
  assert.equal(renewed.row.status, SubscriptionStatus.ACTIVE);

  // A checkout is now refused while the subscription runs, but a session opened before stays
  // payable for 24 hours: once paid, the row follows the subscription the tenant has just bought.
  const checkoutOpenedBeforeTheRefusal = createSyncService(
    { stripe_subscription_id: 'sub_A', status: SubscriptionStatus.PAST_DUE },
    cloverSubscription({ id: 'sub_new' }),
  );
  await checkoutOpenedBeforeTheRefusal.svc.processEvent({
    id: 'evt_checkout',
    type: 'checkout.session.completed',
    data: { object: { object: 'checkout.session', id: 'cs_1', mode: 'subscription', customer: 'cus_1', subscription: 'sub_new' } },
  });
  assert.equal(checkoutOpenedBeforeTheRefusal.row.stripe_subscription_id, 'sub_new');
  assert.equal(checkoutOpenedBeforeTheRefusal.row.status, SubscriptionStatus.ACTIVE);
}

/**
 * The `invoice.paid` of a checkout's new subscription may arrive before the checkout completes,
 * and is then ignored (the row still follows the subscription it leaves). Once the row follows
 * the new subscription, its latest invoice fields are those of that subscription's latest invoice.
 */
async function testCheckoutBringsTheLatestInvoiceOfTheNewSubscription() {
  const { svc, row } = createSyncService(
    {
      stripe_subscription_id: 'sub_A',
      status: SubscriptionStatus.PAST_DUE,
      latest_invoice_id: 'in_A',
      latest_invoice_status: 'open',
      latest_invoice_number: 'KAN-0042',
      latest_invoice_url: 'https://invoice.stripe.test/in_A',
    },
    cloverSubscription({
      id: 'sub_new',
      latest_invoice: {
        id: 'in_new', status: 'paid', number: 'KAN-0050', total: 24900, currency: 'eur', created: 1_792_000_000,
        hosted_invoice_url: 'https://invoice.stripe.test/in_new', invoice_pdf: 'https://invoice.stripe.test/in_new.pdf',
      },
    }),
  );
  await svc.processEvent({
    id: 'evt_checkout_invoice',
    type: 'checkout.session.completed',
    data: { object: { object: 'checkout.session', id: 'cs_1', mode: 'subscription', customer: 'cus_1', subscription: 'sub_new' } },
  });
  assert.equal(row.stripe_subscription_id, 'sub_new');
  assert.equal(row.latest_invoice_id, 'in_new');
  assert.equal(row.latest_invoice_status, 'paid');
  assert.equal(row.latest_invoice_number, 'KAN-0050');
  assert.equal(row.latest_invoice_url, 'https://invoice.stripe.test/in_new');
  assert.equal(row.latest_invoice_pdf, 'https://invoice.stripe.test/in_new.pdf');

  // A subscription event of the subscription already followed leaves the invoice fields alone.
  const same = createSyncService(
    { stripe_subscription_id: 'sub_1', latest_invoice_id: 'in_1', latest_invoice_status: 'paid' },
    cloverSubscription({ latest_invoice: { id: 'in_2', status: 'draft' } }),
  );
  await same.svc.processEvent({ id: 'evt_same', type: 'customer.subscription.updated', data: { object: cloverSubscription({ latest_invoice: { id: 'in_2', status: 'draft' } }) } });
  assert.equal(same.row.latest_invoice_id, 'in_1');
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

/** A card saved on the setup page (bank transfer to card) becomes the customer's default payment method. */
function setupCompleted(setupIntent: unknown) {
  return {
    id: 'evt_setup',
    type: 'checkout.session.completed',
    data: { object: { object: 'checkout.session', id: 'cs_setup', mode: 'setup', customer: 'cus_1', setup_intent: setupIntent, subscription: null } },
  };
}

async function testSavedCardBecomesTheDefault() {
  const { svc, customerUpdates } = createSyncService({}, null, { setupIntent: { status: 'succeeded', payment_method: 'pm_saved' } });
  await svc.processEvent(setupCompleted('seti_1'));
  assert.deepEqual(customerUpdates, [['cus_1', { invoice_settings: { default_payment_method: 'pm_saved' } }]]);

  // Not succeeded, or a customer KANAP does not know: the default is left alone.
  const pending = createSyncService({}, null, { setupIntent: { status: 'requires_action', payment_method: 'pm_saved' } });
  await pending.svc.processEvent(setupCompleted('seti_2'));
  assert.deepEqual(pending.customerUpdates, []);
  const unknown = createSyncService({}, null, { tenantKnown: false, setupIntent: { status: 'succeeded', payment_method: 'pm_saved' } });
  await unknown.svc.processEvent(setupCompleted('seti_3'));
  assert.deepEqual(unknown.customerUpdates, []);
}

async function run() {
  await testResolvesByCustomerFirst();
  await testFallsBackOnMetadataWhenTheStoredCustomerHasDrifted();
  await testIgnoresASubscriptionTheTenantHasLeft();
  await testMetadataCannotPointAtAnotherTenantsSubscription();
  await testDeletedWorkspaceIsNotResolvedByCustomer();
  await testDeletedWorkspaceIsNotResolvedByMetadataHint();
  await testReadsTheHintFromAnInvoiceAndRejectsGarbage();
  await testCloverInvoiceResolvesItsSubscription();
  await testCloverSubscriptionUpdatedWritesThePeriods();
  await testSubscriptionEventWithoutPeriodKeepsTheStoredDates();
  await testCancellationSetsTheEndDate();
  await testSyncWritesThePaymentModeAndTerm();
  await testEventHandlingIsSerializedPerTenant();
  await testInvoiceStatusNeverGoesBack();
  await testInvoicesOfTheSameSecondFollowTheSubscription();
  await testDraftInvoiceHasNoNumber();
  await testEventOfAnotherSubscriptionIsIgnored();
  await testCheckoutBringsTheLatestInvoiceOfTheNewSubscription();
  await testInvoiceWithoutTenantIsSetToA4();
  await testInvoiceAlreadyA4AndOtherEventsAreLeftAlone();
  await testStripeErrorOnA4DoesNotStopTheEvent();
  await testSavedCardBecomesTheDefault();
}

void run();
