import * as assert from 'node:assert/strict';
import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { BillingService } from '../billing.service';
import { ChangePlanDto, CreateCheckoutSessionDto, RequestInvoiceDto } from '../billing.controller';
import { Subscription } from '../subscription.entity';
import { User } from '../../users/user.entity';
import { GTC_VERSION } from '../terms';

/**
 * A tenant subscribes (card checkout or bank transfer) only with complete invoice
 * details. The check runs before any Stripe call, so Stripe never answers with a raw
 * "customer needs a valid email" error. With complete details, the Stripe customer
 * receives the current details and the EU VAT number as an `eu_vat` tax id, the invoice
 * mentions (operation nature, SIREN of a French customer) and the invoice language.
 * Creating the customer is idempotent.
 */

type Call = { method: string; args: unknown[] };

const COMPLETE_FR_INVOICE = {
  company: 'Fromage SAS',
  email: 'billing@fromage-co.com',
  phone: '+33 1 23 45 67 89',
  vat_number: 'FR 12 345678901',
  address: { line1: '1 rue de la Paix', postal_code: '75002', city: 'Paris', country: 'FR' },
};

const COMPLETE_DE_INVOICE = {
  company: 'Käse GmbH',
  email: 'rechnung@kaese.test',
  vat_number: 'DE123456789',
  address: { line1: 'Hauptstrasse 1', postal_code: '10115', city: 'Berlin', country: 'DE' },
};

const FR_MENTIONS = {
  invoice_settings: {
    custom_fields: [
      { name: "Nature de l'opération", value: 'Prestation de services' },
      { name: 'SIREN', value: '345678901' },
    ],
  },
  preferred_locales: ['fr'],
};

/** True when `key` appears at any depth of `value`. */
function hasKeyDeep(value: unknown, key: string): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([k, v]) => k === key || hasKeyDeep(v, key));
}

function createTenant(invoiceInfo: Record<string, unknown> | null, stripeCustomerId: string | null = 'cus_1') {
  return {
    id: 'tenant-1',
    slug: 'fromage',
    name: 'Fromage',
    stripe_customer_id: stripeCustomerId,
    billing_invoice_info: invoiceInfo,
    billing_customer_info: null,
    billing_email: null,
    billing_company_name: null,
    billing_phone: null,
    billing_tax_id: null,
    billing_address: null,
  };
}

function createService(opts: {
  tenant: ReturnType<typeof createTenant>;
  taxIds?: Array<{ id: string; type: string; value: string }>;
  createTaxIdError?: unknown;
  /** A running Stripe subscription (plan change). */
  subscription?: Partial<Subscription>;
  retrievedCustomer?: Record<string, unknown>;
  /** Price id per interval; one id for both by default. */
  priceIds?: Record<string, string>;
  /** The Stripe subscription `subscriptions.retrieve` returns (a running one by default). */
  stripeSubscription?: Record<string, any>;
  /** What Stripe does on `subscriptions.update`: may change `state`, returns the answer. */
  onSubscriptionUpdate?: (params: Record<string, any>, state: Record<string, any>) => unknown;
  schedule?: Record<string, any>;
  /** The customer's saved cards (`customers.listPaymentMethods`). */
  cards?: Array<Record<string, unknown>>;
  /** What `invoices.retrieve` returns (nothing by default). */
  retrievedInvoice?: Record<string, unknown>;
}) {
  const calls: Call[] = [];
  const record = (method: string, impl: (...args: any[]) => unknown) => async (...args: unknown[]) => {
    calls.push({ method, args });
    return impl(...args);
  };
  const stripeState: Record<string, any> | null = opts.stripeSubscription
    ? JSON.parse(JSON.stringify(opts.stripeSubscription))
    : null;
  const schedule = opts.schedule ?? null;
  const client = {
    customers: {
      retrieve: record('customers.retrieve', () => opts.retrievedCustomer ?? { id: 'cus_1' }),
      update: record('customers.update', () => ({ id: 'cus_1' })),
      create: record('customers.create', () => ({ id: 'cus_new' })),
      listTaxIds: record('customers.listTaxIds', () => ({ data: opts.taxIds ?? [] })),
      createTaxId: record('customers.createTaxId', () => {
        if (opts.createTaxIdError) throw opts.createTaxIdError;
        return { id: 'txi_new' };
      }),
      deleteTaxId: record('customers.deleteTaxId', () => ({ deleted: true })),
      listPaymentMethods: record('customers.listPaymentMethods', () => ({ data: opts.cards ?? [] })),
    },
    checkout: {
      sessions: { create: record('checkout.sessions.create', () => ({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' })) },
    },
    subscriptions: {
      create: record('subscriptions.create', () => ({ id: 'sub_1', latest_invoice: null })),
      retrieve: record('subscriptions.retrieve', () => {
        if (stripeState) return JSON.parse(JSON.stringify(stripeState));
        return opts.subscription ? { id: 'sub_1', status: 'active', items: { data: [{ id: 'si_1' }] } } : null;
      }),
      update: record('subscriptions.update', (_id: string, params: Record<string, any>) =>
        (opts.onSubscriptionUpdate && stripeState ? opts.onSubscriptionUpdate(params, stripeState) : { id: 'sub_1' })),
    },
    subscriptionSchedules: {
      create: record('subscriptionSchedules.create', () => schedule),
      retrieve: record('subscriptionSchedules.retrieve', () => schedule),
      update: record('subscriptionSchedules.update', (id: string) => ({ id })),
      release: record('subscriptionSchedules.release', (id: string) => {
        // Released: the subscription no longer has a schedule.
        if (stripeState) stripeState.schedule = null;
        return { id };
      }),
    },
    invoices: {
      list: record('invoices.list', () => ({ data: [] })),
      retrieve: record('invoices.retrieve', () => opts.retrievedInvoice ?? null),
      finalizeInvoice: record('invoices.finalizeInvoice', () => null),
      update: record('invoices.update', () => null),
    },
    prices: { retrieve: record('prices.retrieve', () => null) },
    paymentMethods: { retrieve: record('paymentMethods.retrieve', () => null) },
  };

  const subscription = {
    id: 'local-sub',
    plan_name: 'Trial',
    seat_limit: null,
    ...(opts.subscription ?? {}),
  } as unknown as Subscription;
  /** A copy of the local subscription record at each save. */
  const saves: Array<Partial<Subscription>> = [];
  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === Subscription) {
        return {
          findOne: async () => subscription,
          create: (data: Partial<Subscription>) => data,
          save: async (data: Subscription) => {
            saves.push({ ...data });
            return data;
          },
        };
      }
      if (entity === User) {
        // Seats counted by the subscription summary a bank transfer request returns.
        const qb: any = { leftJoin: () => qb, where: () => qb, andWhere: () => qb, getCount: async () => 3 };
        return { createQueryBuilder: () => qb };
      }
      throw new Error('Unexpected repository');
    },
  };
  const tenants = {
    findOne: async () => opts.tenant,
    update: async () => undefined,
  };
  const stripeConfig = {
    getPriceId: (interval: string) => opts.priceIds?.[interval] ?? 'price_max',
    getCheckoutSuccessUrl: () => 'https://fromage.kanap.test/admin/billing',
    getCheckoutCancelUrl: () => 'https://fromage.kanap.test/admin/billing',
  };
  const audits: Array<{ entry: Record<string, unknown>; opts: { manager?: unknown } | undefined }> = [];
  const audit = {
    log: async (entry: Record<string, unknown>, opts?: { manager?: unknown }) => {
      audits.push({ entry, opts });
    },
  };
  const service = new BillingService(
    { manager } as any,
    {} as any,
    tenants as any,
    { getClient: () => client } as any,
    stripeConfig as any,
    {} as any,
    audit as any,
  );
  return { service, manager, calls, audits, subscription, saves };
}

async function expectBadRequest(promise: Promise<unknown>, expected: Record<string, unknown>) {
  let caught: unknown = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof BadRequestException, `expected a BadRequestException, got ${String(caught)}`);
  assert.deepEqual((caught as BadRequestException).getResponse(), expected);
}

const INCOMPLETE = {
  message: 'BILLING_PROFILE_INCOMPLETE',
  // The company falls back to the tenant name; nothing else is filled in.
  missing: ['email', 'addressLine1', 'postalCode', 'city', 'country'],
};

async function testRequestInvoiceRefusesIncompleteProfile() {
  const { service, manager, calls } = createService({ tenant: createTenant(null) });
  await expectBadRequest(service.requestInvoice('tenant-1', 'max', 'annual', 'user-1', manager as any, GTC_VERSION), INCOMPLETE);
  assert.deepEqual(calls, []);
}

async function testCheckoutRefusesIncompleteProfile() {
  const { service, manager, calls } = createService({ tenant: createTenant(null) });
  await expectBadRequest(
    service.createCheckoutSession({ tenantId: 'tenant-1', manager: manager as any, planKey: 'max', interval: 'monthly', termsVersion: GTC_VERSION }),
    INCOMPLETE,
  );
  assert.deepEqual(calls, []);
}

async function testCheckoutRefusesEuProfileWithoutVat() {
  const { service, manager, calls } = createService({
    tenant: createTenant({ ...COMPLETE_FR_INVOICE, vat_number: null }),
  });
  await expectBadRequest(
    service.createCheckoutSession({ tenantId: 'tenant-1', manager: manager as any, planKey: 'max', interval: 'monthly', termsVersion: GTC_VERSION }),
    { message: 'BILLING_PROFILE_INCOMPLETE', missing: ['vatNumber'] },
  );
  assert.deepEqual(calls, []);
}

async function testCheckoutPushesDetailsAndVatToExistingCustomer() {
  const { service, manager, calls } = createService({ tenant: createTenant(COMPLETE_FR_INVOICE) });
  const session = await service.createCheckoutSession({
    tenantId: 'tenant-1',
    manager: manager as any,
    planKey: 'max',
    interval: 'monthly',
    termsVersion: GTC_VERSION,
  });
  assert.equal(session.id, 'cs_1');

  const update = calls.find((call) => call.method === 'customers.update');
  assert.ok(update, 'the existing customer is updated');
  assert.equal(update!.args[0], 'cus_1');
  assert.deepEqual(update!.args[1], {
    email: 'billing@fromage-co.com',
    name: 'Fromage SAS',
    phone: '+33 1 23 45 67 89',
    address: { line1: '1 rue de la Paix', city: 'Paris', postal_code: '75002', country: 'FR' },
    ...FR_MENTIONS,
    metadata: { siren: '345678901' },
  });
  assert.ok(!hasKeyDeep(update!.args[1], 'default_payment_method'), 'the default payment method is left alone');
  const created = calls.filter((call) => call.method === 'customers.createTaxId');
  assert.deepEqual(created.map((call) => call.args), [['cus_1', { type: 'eu_vat', value: 'FR12345678901' }]]);

  // The customer carries its details before the checkout session starts.
  const order = calls.map((call) => call.method);
  assert.ok(order.indexOf('customers.createTaxId') < order.indexOf('checkout.sessions.create'));
}

async function testStaleVatIdIsReplacedAndSameOneKept() {
  const { service, manager, calls } = createService({
    tenant: createTenant(COMPLETE_FR_INVOICE),
    taxIds: [
      { id: 'txi_old', type: 'eu_vat', value: 'FR99999999999' },
      { id: 'txi_ch', type: 'ch_vat', value: 'CHE-123.456.788 MWST' },
    ],
  });
  await service.createCheckoutSession({ tenantId: 'tenant-1', manager: manager as any, planKey: 'max', interval: 'monthly', termsVersion: GTC_VERSION });
  assert.deepEqual(
    calls.filter((call) => call.method === 'customers.deleteTaxId').map((call) => call.args),
    [['cus_1', 'txi_old']],
  );
  assert.equal(calls.filter((call) => call.method === 'customers.createTaxId').length, 1);

  const same = createService({
    tenant: createTenant(COMPLETE_FR_INVOICE),
    taxIds: [{ id: 'txi_same', type: 'eu_vat', value: 'FR12345678901' }],
  });
  await same.service.createCheckoutSession({ tenantId: 'tenant-1', manager: same.manager as any, planKey: 'max', interval: 'monthly', termsVersion: GTC_VERSION });
  assert.equal(same.calls.filter((call) => call.method === 'customers.deleteTaxId').length, 0);
  assert.equal(same.calls.filter((call) => call.method === 'customers.createTaxId').length, 0);
}

async function testRefusedVatNumberBecomesVatNumberInvalid() {
  const stripeError = Object.assign(new Error('Invalid value for eu_vat.'), {
    type: 'StripeInvalidRequestError',
    code: 'tax_id_invalid',
    param: 'value',
    requestId: 'req_123',
    statusCode: 400,
  });
  const { service, manager, calls } = createService({
    tenant: createTenant(COMPLETE_FR_INVOICE),
    createTaxIdError: stripeError,
  });
  const warnings: string[] = [];
  (service as any).logger = { warn: (message: string) => warnings.push(message) };
  await expectBadRequest(service.requestInvoice('tenant-1', 'max', 'annual', 'user-1', manager as any, GTC_VERSION), {
    message: 'VAT_NUMBER_INVALID',
  });
  // Stripe's refusal stays diagnosable from the API logs.
  assert.equal(warnings.length, 1);
  for (const part of ['tax_id_invalid', 'param=value', 'req_123', 'Invalid value for eu_vat.']) {
    assert.ok(warnings[0].includes(part), `the warning carries ${part}: ${warnings[0]}`);
  }
  assert.equal(calls.filter((call) => call.method === 'subscriptions.create').length, 0);

  const checkout = createService({ tenant: createTenant(COMPLETE_FR_INVOICE), createTaxIdError: stripeError });
  await expectBadRequest(
    checkout.service.createCheckoutSession({ tenantId: 'tenant-1', manager: checkout.manager as any, planKey: 'max', interval: 'monthly', termsVersion: GTC_VERSION }),
    { message: 'VAT_NUMBER_INVALID' },
  );
  assert.equal(checkout.calls.filter((call) => call.method === 'checkout.sessions.create').length, 0);
}

/** GTC art. 2: no subscription without accepting the current general terms of sale. */
async function testSubscribeRefusesWithoutTheCurrentTerms() {
  for (const termsVersion of [undefined, null, '', '2020-01-01']) {
    const transfer = createService({ tenant: createTenant(COMPLETE_FR_INVOICE) });
    await expectBadRequest(
      transfer.service.requestInvoice('tenant-1', 'max', 'annual', 'user-1', transfer.manager as any, termsVersion as any),
      { message: 'TERMS_NOT_ACCEPTED' },
    );
    assert.deepEqual(transfer.calls, [], `no Stripe call for transfer with ${String(termsVersion)}`);
    assert.deepEqual(transfer.audits, []);

    const card = createService({ tenant: createTenant(COMPLETE_FR_INVOICE) });
    await expectBadRequest(
      card.service.createCheckoutSession({
        tenantId: 'tenant-1',
        manager: card.manager as any,
        planKey: 'max',
        interval: 'monthly',
        termsVersion: termsVersion as any,
        userId: 'user-1',
      }),
      { message: 'TERMS_NOT_ACCEPTED' },
    );
    assert.deepEqual(card.calls, [], `no Stripe call for card with ${String(termsVersion)}`);
    assert.deepEqual(card.audits, []);
  }
}

function expectedAcceptance(paymentPath: 'card' | 'transfer', interval: 'monthly' | 'annual') {
  return {
    table: 'tenants',
    recordId: 'tenant-1',
    action: 'update',
    before: null,
    after: { terms_acceptance: { terms_version: GTC_VERSION, payment_path: paymentPath, plan_key: 'max', interval } },
    userId: 'user-1',
    sourceRef: 'terms_acceptance',
  };
}

async function testAcceptedTermsAreAudited() {
  const card = createService({ tenant: createTenant(COMPLETE_FR_INVOICE) });
  const session = await card.service.createCheckoutSession({
    tenantId: 'tenant-1',
    manager: card.manager as any,
    planKey: 'max',
    interval: 'monthly',
    termsVersion: GTC_VERSION,
    userId: 'user-1',
  });
  assert.equal(session.id, 'cs_1');
  assert.deepEqual(card.audits.map((a) => a.entry), [expectedAcceptance('card', 'monthly')]);
  // Written with the request's manager: its transaction carries the tenant.
  assert.equal(card.audits[0].opts?.manager, card.manager);

  const transfer = createService({ tenant: createTenant(COMPLETE_FR_INVOICE) });
  await transfer.service.requestInvoice('tenant-1', 'max', 'annual', 'user-1', transfer.manager as any, GTC_VERSION);
  assert.equal(transfer.calls.filter((call) => call.method === 'subscriptions.create').length, 1);
  const acceptance = transfer.audits.filter((a) => a.entry.sourceRef === 'terms_acceptance');
  assert.deepEqual(acceptance.map((a) => a.entry), [expectedAcceptance('transfer', 'annual')]);
  assert.equal(acceptance[0].opts?.manager, transfer.manager);
}

const RUNNING = { stripe_subscription_id: 'sub_1', status: 'active' } as Partial<Subscription>;

/** A plan change is a new commitment under the general terms of sale. */
async function testChangePlanRequiresTheCurrentTerms() {
  for (const termsVersion of [undefined, null, '', '2020-01-01']) {
    const { service, manager, calls, audits } = createService({ tenant: createTenant(COMPLETE_FR_INVOICE), subscription: RUNNING });
    await expectBadRequest(
      service.changePlan('tenant-1', 'max', 'annual', 'user-1', manager as any, termsVersion as any),
      { message: 'TERMS_NOT_ACCEPTED' },
    );
    assert.deepEqual(calls, [], `no Stripe call for a plan change with ${String(termsVersion)}`);
    assert.deepEqual(audits, []);
  }

  const { service, manager, calls, audits } = createService({ tenant: createTenant(COMPLETE_FR_INVOICE), subscription: RUNNING });
  (service as any).logger = { warn: () => undefined };
  await service.changePlan('tenant-1', 'max', 'annual', 'user-1', manager as any, GTC_VERSION);
  assert.equal(calls.filter((call) => call.method === 'subscriptions.update').length, 1);
  const acceptance = audits.filter((a) => a.entry.sourceRef === 'terms_acceptance');
  assert.deepEqual(acceptance.map((a) => a.entry), [expectedAcceptance('card', 'annual')]);
  assert.equal(acceptance[0].opts?.manager, manager);
  // The acceptance is recorded before Stripe is called.
  assert.equal(audits[0].entry.sourceRef, 'terms_acceptance');
}

async function testSubscribeBodiesKeepTheTermsVersion() {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const checkoutMeta: ArgumentMetadata = { type: 'body', metatype: CreateCheckoutSessionDto, data: '' };
  const invoiceMeta: ArgumentMetadata = { type: 'body', metatype: RequestInvoiceDto, data: '' };
  const checkout = await pipe.transform({ plan_key: 'max', interval: 'monthly', terms_version: GTC_VERSION }, checkoutMeta);
  assert.equal(checkout.terms_version, GTC_VERSION);
  const invoice = await pipe.transform({ plan_key: 'max', subscription_type: 'annual', terms_version: GTC_VERSION }, invoiceMeta);
  assert.equal(invoice.terms_version, GTC_VERSION);
  const changeMeta: ArgumentMetadata = { type: 'body', metatype: ChangePlanDto, data: '' };
  const change = await pipe.transform({ plan_key: 'max', subscription_type: 'annual', terms_version: GTC_VERSION }, changeMeta);
  // Validated through the DTO class: its whitelist would drop an undeclared field.
  assert.ok(change instanceof ChangePlanDto);
  assert.equal(change.terms_version, GTC_VERSION);
}

async function testNewCustomerCarriesMentionsAndAnIdempotencyKey() {
  const { service, manager, calls } = createService({ tenant: createTenant(COMPLETE_FR_INVOICE, null) });
  await service.createCheckoutSession({ tenantId: 'tenant-1', manager: manager as any, planKey: 'max', interval: 'monthly', termsVersion: GTC_VERSION });
  const creates = calls.filter((call) => call.method === 'customers.create');
  assert.equal(creates.length, 1);
  assert.equal(creates[0].args.length, 2);
  assert.deepEqual(creates[0].args[0], {
    email: 'billing@fromage-co.com',
    name: 'Fromage SAS',
    phone: '+33 1 23 45 67 89',
    address: { line1: '1 rue de la Paix', city: 'Paris', postal_code: '75002', country: 'FR' },
    ...FR_MENTIONS,
    metadata: { siren: '345678901', tenant_id: 'tenant-1', tenant_slug: 'fromage' },
    tax_id_data: [{ type: 'eu_vat', value: 'FR12345678901' }],
  });
  const options = creates[0].args[1] as Record<string, string>;
  assert.deepEqual(Object.keys(options), ['idempotencyKey']);
  assert.match(options.idempotencyKey, /^tenant-customer-tenant-1-new-[0-9a-f]{16}$/);
  assert.ok(!hasKeyDeep(creates[0].args[0], 'default_payment_method'));
}

/** The idempotency key of the `customers.create` a checkout sends for this invoice profile. */
async function creationKey(invoiceInfo: Record<string, unknown>): Promise<{ key: string; params: Record<string, any> }> {
  const { service, manager, calls } = createService({ tenant: createTenant(invoiceInfo, null) });
  await service.createCheckoutSession({ tenantId: 'tenant-1', manager: manager as any, planKey: 'max', interval: 'monthly', termsVersion: GTC_VERSION });
  const create = calls.find((call) => call.method === 'customers.create')!;
  return { key: (create.args[1] as { idempotencyKey: string }).idempotencyKey, params: create.args[0] as Record<string, any> };
}

async function testIdempotencyKeyFollowsThePayload() {
  // A retry with the same details reuses the key; corrected details are a new request.
  const first = await creationKey(COMPLETE_FR_INVOICE);
  const retry = await creationKey(COMPLETE_FR_INVOICE);
  const corrected = await creationKey({ ...COMPLETE_FR_INVOICE, email: 'compta@fromage-co.com' });
  assert.equal(retry.key, first.key);
  assert.notEqual(corrected.key, first.key);
  assert.match(corrected.key, /^tenant-customer-tenant-1-new-[0-9a-f]{16}$/);
}

async function testNewCustomerWithoutSirenSendsNoSirenKey() {
  const { params } = await creationKey(COMPLETE_DE_INVOICE);
  assert.deepEqual(params.metadata, { tenant_id: 'tenant-1', tenant_slug: 'fromage' });
}

async function testRecreatedCustomerUsesAnotherIdempotencyKey() {
  // The stored customer was deleted in Stripe: the new one must not replay the first creation.
  const { service, manager, calls } = createService({
    tenant: createTenant(COMPLETE_FR_INVOICE, 'cus_deleted'),
    retrievedCustomer: { id: 'cus_deleted', deleted: true },
  });
  await service.createCheckoutSession({ tenantId: 'tenant-1', manager: manager as any, planKey: 'max', interval: 'monthly', termsVersion: GTC_VERSION });
  const creates = calls.filter((call) => call.method === 'customers.create');
  assert.equal(creates.length, 1);
  assert.match((creates[0].args[1] as { idempotencyKey: string }).idempotencyKey, /^tenant-customer-tenant-1-cus_deleted-[0-9a-f]{16}$/);
}

async function testGermanCustomerGetsNatureOnlyAndGerman() {
  const { service, manager, calls } = createService({ tenant: createTenant(COMPLETE_DE_INVOICE) });
  await service.createCheckoutSession({ tenantId: 'tenant-1', manager: manager as any, planKey: 'max', interval: 'monthly', termsVersion: GTC_VERSION });
  const update = calls.find((call) => call.method === 'customers.update');
  assert.deepEqual(update!.args[1], {
    email: 'rechnung@kaese.test',
    name: 'Käse GmbH',
    phone: undefined,
    address: { line1: 'Hauptstrasse 1', city: 'Berlin', postal_code: '10115', country: 'DE' },
    invoice_settings: { custom_fields: [{ name: "Nature de l'opération", value: 'Prestation de services' }] },
    preferred_locales: ['de'],
    // No SIREN outside France: an empty value removes one the customer may still carry.
    metadata: { siren: '' },
  });
}

async function testDraftInvoiceIsSetToA4BeforeFinalizing() {
  const { service, calls } = createService({ tenant: createTenant(COMPLETE_FR_INVOICE) });
  await (service as any).ensureInvoiceAccessible({ id: 'in_draft', status: 'draft', rendering: { pdf: { page_size: 'letter' } } });
  const invoiceCalls = calls.filter((call) => call.method.startsWith('invoices.'));
  assert.deepEqual(invoiceCalls.map((call) => call.method).slice(0, 2), ['invoices.update', 'invoices.finalizeInvoice']);
  assert.deepEqual(invoiceCalls[0].args, ['in_draft', { rendering: { pdf: { page_size: 'a4' } } }]);
}

/*
 * GTC art. 6.3. Monthly to annual applies at once: a new annual period starts today, the unused
 * part of the month is credited and the difference is invoiced and charged now; the change
 * applies only once that invoice is paid. Annual to monthly applies at the end of the annual
 * period, never refunded. The local record follows Stripe, never ahead of it.
 */
const PRICE_IDS = { monthly: 'price_monthly', annual: 'price_annual' };
const MONTHLY_PRICE = { id: 'price_monthly', currency: 'eur', unit_amount: 24900, recurring: { interval: 'month' } };
const ANNUAL_PRICE = { id: 'price_annual', currency: 'eur', unit_amount: 249000, recurring: { interval: 'year' } };
const PERIOD = { start: 1792000000, end: 1823536000 };

function stripeSubscription(price: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    collection_method: 'charge_automatically',
    latest_invoice: 'in_previous',
    items: { data: [{ id: 'si_1', price, quantity: 1 }] },
    ...extra,
  };
}

function runningOn(interval: 'monthly' | 'annual') {
  return { ...RUNNING, subscription_type: interval, stripe_price_id: PRICE_IDS[interval] } as Partial<Subscription>;
}

const CUSTOMER_WITH_CARD = { id: 'cus_1', invoice_settings: { default_payment_method: { id: 'pm_card', type: 'card' } } };

const IMMEDIATE_CHANGE = {
  items: [{ id: 'si_1', price: 'price_annual' }],
  metadata: { plan_key: 'max' },
  billing_cycle_anchor: 'now',
  proration_behavior: 'always_invoice',
  payment_behavior: 'pending_if_incomplete',
  expand: ['latest_invoice'],
};

async function testMonthlyToAnnualIsInvoicedAndChargedAtOnce() {
  const invoice = {
    id: 'in_new',
    number: 'KAN-0012',
    status: 'paid',
    total: 224100,
    currency: 'eur',
    hosted_invoice_url: 'https://invoice.stripe.test/in_new',
    rendering: { pdf: { page_size: 'letter' } },
  };
  const { service, manager, calls, audits, subscription } = createService({
    tenant: createTenant(COMPLETE_FR_INVOICE),
    subscription: runningOn('monthly'),
    priceIds: PRICE_IDS,
    // A switch to monthly was planned earlier: the immediate change replaces it.
    stripeSubscription: stripeSubscription(MONTHLY_PRICE, { schedule: 'sub_sched_old' }),
    onSubscriptionUpdate: (params, state) => {
      state.items.data[0].price = ANNUAL_PRICE;
      state.metadata = params.metadata;
      state.schedule = null;
      state.latest_invoice = invoice;
      return { ...state };
    },
  });
  const result: any = await service.changePlan('tenant-1', 'max', 'annual', 'user-1', manager as any, GTC_VERSION);

  const updates = calls.filter((call) => call.method === 'subscriptions.update');
  assert.deepEqual(updates.map((call) => call.args), [['sub_1', IMMEDIATE_CHANGE]]);
  assert.deepEqual(result.change, {
    status: 'paid',
    invoice: { number: 'KAN-0012', amount: 224100, currency: 'EUR', hosted_invoice_url: 'https://invoice.stripe.test/in_new' },
  });

  // The customer carries the invoice mentions and language before Stripe invoices the change.
  const order = calls.map((call) => call.method);
  const push = calls.find((call) => call.method === 'customers.update');
  assert.ok(push, 'the invoicing details are pushed to the customer');
  assert.deepEqual((push!.args[1] as any).invoice_settings, FR_MENTIONS.invoice_settings);
  assert.deepEqual((push!.args[1] as any).preferred_locales, ['fr']);
  assert.ok(order.indexOf('customers.update') < order.indexOf('subscriptions.update'));
  assert.ok(order.indexOf('subscriptionSchedules.release') < order.indexOf('subscriptions.update'));
  assert.deepEqual(calls.find((call) => call.method === 'subscriptionSchedules.release')!.args, ['sub_sched_old']);

  // The invoice of the change is A4.
  assert.ok(calls.some((call) => call.method === 'invoices.update'
    && call.args[0] === 'in_new' && JSON.stringify(call.args[1]) === JSON.stringify({ rendering: { pdf: { page_size: 'a4' } } })));

  // Paid: the local record follows Stripe and the change is audited.
  assert.equal(subscription.subscription_type, 'annual');
  assert.equal(subscription.stripe_price_id, 'price_annual');
  assert.equal(result.subscription_type, 'annual');
  assert.equal(audits.filter((a) => a.entry.table === 'subscriptions').length, 1);
}

async function testUnpaidChangeSendsToTheInvoiceAndChangesNothing() {
  const invoice = {
    id: 'in_open',
    number: 'KAN-0013',
    status: 'open',
    total: 224100,
    currency: 'eur',
    hosted_invoice_url: 'https://invoice.stripe.test/in_open',
  };
  const { service, manager, calls, audits, subscription, saves } = createService({
    tenant: createTenant(COMPLETE_FR_INVOICE),
    subscription: runningOn('monthly'),
    priceIds: PRICE_IDS,
    stripeSubscription: stripeSubscription(MONTHLY_PRICE),
    // 3-D Secure: Stripe keeps the change pending until the invoice is paid.
    onSubscriptionUpdate: (_params, state) => ({
      ...state,
      latest_invoice: invoice,
      pending_update: { expires_at: PERIOD.start, subscription_items: [{ id: 'si_1', price: 'price_annual' }] },
    }),
  });
  const result: any = await service.changePlan('tenant-1', 'max', 'annual', 'user-1', manager as any, GTC_VERSION);

  assert.deepEqual(calls.filter((call) => call.method === 'subscriptions.update').map((call) => call.args), [['sub_1', IMMEDIATE_CHANGE]]);
  assert.deepEqual(result.change, {
    status: 'requires_payment',
    invoice: { number: 'KAN-0013', amount: 224100, currency: 'EUR', hosted_invoice_url: 'https://invoice.stripe.test/in_open' },
  });
  assert.equal(subscription.subscription_type, 'monthly');
  assert.equal(subscription.stripe_price_id, 'price_monthly');
  assert.ok(saves.every((saved) => saved.subscription_type !== 'annual' && saved.stripe_price_id !== 'price_annual'),
    'the local record is never moved to annual before payment');
  assert.equal(audits.filter((a) => a.entry.table === 'subscriptions').length, 0);
}

async function testAnnualToMonthlyIsScheduledAtPeriodEnd() {
  const fromSubscription = {
    id: 'sub_sched_1',
    current_phase: { start_date: PERIOD.start, end_date: PERIOD.end },
    phases: [{ start_date: PERIOD.start, end_date: PERIOD.end, items: [{ price: 'price_annual', quantity: 1 }], collection_method: null }],
  };
  const expectedPhases = {
    end_behavior: 'release',
    proration_behavior: 'none',
    phases: [
      { items: [{ price: 'price_annual', quantity: 1 }], start_date: PERIOD.start, end_date: PERIOD.end },
      {
        items: [{ price: 'price_monthly', quantity: 1 }],
        collection_method: 'charge_automatically',
        duration: { interval: 'month', interval_count: 1 },
      },
    ],
  };
  for (const existing of [null, 'sub_sched_1']) {
    const { service, manager, calls, saves, subscription } = createService({
      tenant: createTenant(COMPLETE_FR_INVOICE),
      subscription: runningOn('annual'),
      priceIds: PRICE_IDS,
      stripeSubscription: stripeSubscription(ANNUAL_PRICE, { schedule: existing }),
      schedule: fromSubscription,
    });
    const result: any = await service.changePlan('tenant-1', 'max', 'monthly', 'user-1', manager as any, GTC_VERSION);

    assert.deepEqual(result.change, { status: 'scheduled', effective_at: new Date(PERIOD.end * 1000).toISOString() });
    // No price change now: no subscription update, no invoice.
    assert.equal(calls.filter((call) => call.method === 'subscriptions.update').length, 0);
    if (existing) {
      assert.equal(calls.filter((call) => call.method === 'subscriptionSchedules.create').length, 0);
      assert.deepEqual(calls.find((call) => call.method === 'subscriptionSchedules.retrieve')!.args, ['sub_sched_1']);
    } else {
      assert.deepEqual(calls.find((call) => call.method === 'subscriptionSchedules.create')!.args, [{ from_subscription: 'sub_1' }]);
    }
    assert.deepEqual(calls.find((call) => call.method === 'subscriptionSchedules.update')!.args, ['sub_sched_1', expectedPhases]);
    assert.equal(subscription.subscription_type, 'annual');
    assert.ok(saves.every((saved) => saved.subscription_type !== 'monthly' && saved.stripe_price_id !== 'price_monthly'));
  }
}

async function testBankTransferAnnualSwitchesToCardAtPeriodEnd() {
  const { service, manager, calls } = createService({
    tenant: createTenant(COMPLETE_FR_INVOICE),
    // The customer's default payment method is a card: the switch is scheduled at once.
    retrievedCustomer: CUSTOMER_WITH_CARD,
    subscription: runningOn('annual'),
    priceIds: PRICE_IDS,
    stripeSubscription: stripeSubscription(ANNUAL_PRICE, { collection_method: 'send_invoice' }),
    onSubscriptionUpdate: (_params, state) => ({ ...state }),
    schedule: {
      id: 'sub_sched_1',
      current_phase: { start_date: PERIOD.start, end_date: PERIOD.end },
      phases: [{ start_date: PERIOD.start, end_date: PERIOD.end, items: [{ price: 'price_annual', quantity: 1 }], collection_method: 'send_invoice' }],
    },
  });
  const result: any = await service.changePlan('tenant-1', 'max', 'monthly', 'user-1', manager as any, GTC_VERSION);
  assert.equal(result.change.status, 'scheduled');
  // Stripe refuses a card phase while the subscription keeps its bank transfer settings.
  const order = calls.map((call) => call.method);
  assert.deepEqual(calls.filter((call) => call.method === 'subscriptions.update').map((call) => call.args), [
    ['sub_1', { payment_settings: { payment_method_types: ['card'], payment_method_options: { customer_balance: '' } } }],
  ]);
  assert.ok(order.indexOf('subscriptions.update') < order.indexOf('subscriptionSchedules.update'));
  const phases = (calls.find((call) => call.method === 'subscriptionSchedules.update')!.args[1] as any).phases;
  assert.equal(phases[0].collection_method, 'send_invoice');
  assert.equal(phases[1].collection_method, 'charge_automatically');
}

async function testSamePlanAndIntervalIsRefused() {
  const { service, manager, calls } = createService({
    tenant: createTenant(COMPLETE_FR_INVOICE),
    subscription: runningOn('annual'),
    priceIds: PRICE_IDS,
    stripeSubscription: stripeSubscription(ANNUAL_PRICE),
  });
  await expectBadRequest(
    service.changePlan('tenant-1', 'max', 'annual', 'user-1', manager as any, GTC_VERSION),
    { message: 'PLAN_UNCHANGED', error: 'Bad Request', statusCode: 400 },
  );
  assert.equal(calls.filter((call) => call.method === 'subscriptions.update').length, 0);
}

async function testTransferToAnnualStartsTheAnnualPeriodNow() {
  const monthly = createService({
    tenant: createTenant(COMPLETE_FR_INVOICE),
    subscription: runningOn('monthly'),
    priceIds: PRICE_IDS,
    stripeSubscription: stripeSubscription(MONTHLY_PRICE),
    onSubscriptionUpdate: (_params, state) => ({ ...state, latest_invoice: null }),
  });
  await monthly.service.requestInvoice('tenant-1', 'max', 'annual', 'user-1', monthly.manager as any, GTC_VERSION);
  const update = monthly.calls.find((call) => call.method === 'subscriptions.update')!;
  assert.equal(update.args[0], 'sub_1');
  const params = update.args[1] as Record<string, any>;
  assert.equal(params.billing_cycle_anchor, 'now');
  assert.equal(params.proration_behavior, 'always_invoice');
  assert.equal(params.collection_method, 'send_invoice');
  assert.equal(params.days_until_due, 30);
  assert.deepEqual(params.items, [{ id: 'si_1', price: 'price_annual' }]);

  // Annual card to annual transfer keeps the period: only the payment method changes.
  const annual = createService({
    tenant: createTenant(COMPLETE_FR_INVOICE),
    subscription: runningOn('annual'),
    priceIds: PRICE_IDS,
    stripeSubscription: stripeSubscription(ANNUAL_PRICE),
    onSubscriptionUpdate: (_params, state) => ({ ...state, latest_invoice: null }),
  });
  await annual.service.requestInvoice('tenant-1', 'max', 'annual', 'user-1', annual.manager as any, GTC_VERSION);
  const same = annual.calls.find((call) => call.method === 'subscriptions.update')!.args[1] as Record<string, any>;
  assert.ok(!('billing_cycle_anchor' in same), 'the same price does not restart the period');
}

/** The plan dialog confirms the transfer invoice: number, amount, due date and its Stripe page. */
async function testTransferReturnsTheInvoiceToPay() {
  const invoice = {
    id: 'in_transfer',
    number: 'KAN-0027',
    status: 'open',
    total: 224100,
    currency: 'eur',
    due_date: 1794528000,
    hosted_invoice_url: 'https://invoice.stripe.test/in_transfer',
  };
  const { service, manager } = createService({
    tenant: createTenant(COMPLETE_FR_INVOICE),
    subscription: runningOn('monthly'),
    priceIds: PRICE_IDS,
    stripeSubscription: stripeSubscription(MONTHLY_PRICE),
    onSubscriptionUpdate: (_params, state) => ({ ...state, latest_invoice: 'in_transfer' }),
    retrievedInvoice: invoice,
  });
  const result: any = await service.requestInvoice('tenant-1', 'max', 'annual', 'user-1', manager as any, GTC_VERSION);
  assert.equal(result.hosted_invoice_url, 'https://invoice.stripe.test/in_transfer');
  assert.deepEqual(result.invoice, {
    number: 'KAN-0027',
    amount: 224100,
    currency: 'EUR',
    hosted_invoice_url: 'https://invoice.stripe.test/in_transfer',
    due_date: new Date(1794528000 * 1000).toISOString(),
  });
}

/*
 * A switch to monthly planned by a subscription schedule shows on the billing page and can be
 * cancelled ("Keep annual"). A bank transfer subscription moves to card only once the customer
 * has a card.
 */
const SWITCH_END = PERIOD.end + 31 * 86400;
const PLANNED_SWITCH = {
  id: 'sub_sched_1',
  status: 'active',
  current_phase: { start_date: PERIOD.start, end_date: PERIOD.end },
  phases: [
    { start_date: PERIOD.start, end_date: PERIOD.end, items: [{ price: 'price_annual', quantity: 1 }] },
    { start_date: PERIOD.end, end_date: SWITCH_END, items: [{ price: 'price_monthly', quantity: 1 }] },
  ],
};
const SWITCH_TO_MONTHLY = { interval: 'monthly', effective_at: new Date(PERIOD.end * 1000).toISOString() };

function annualWithPlannedSwitch(extra: Record<string, unknown> = {}, schedule: Record<string, any> = PLANNED_SWITCH) {
  return createService({
    tenant: createTenant(COMPLETE_FR_INVOICE),
    subscription: runningOn('annual'),
    priceIds: PRICE_IDS,
    stripeSubscription: stripeSubscription(ANNUAL_PRICE, { schedule: 'sub_sched_1', ...extra }),
    onSubscriptionUpdate: (_params, state) => ({ ...state }),
    schedule,
  });
}

async function testSummaryShowsThePlannedSwitch() {
  const planned = annualWithPlannedSwitch();
  const summary: any = await planned.service.getSubscriptionSummary({ manager: planned.manager as any, forceStripeRefresh: true });
  assert.deepEqual(summary.scheduled_change, SWITCH_TO_MONTHLY);
  assert.deepEqual(planned.calls.filter((call) => call.method === 'subscriptionSchedules.retrieve').map((call) => call.args), [['sub_sched_1']]);

  // No schedule: nothing planned, and no schedule is read.
  const none = createService({
    tenant: createTenant(COMPLETE_FR_INVOICE),
    subscription: runningOn('annual'),
    priceIds: PRICE_IDS,
    stripeSubscription: stripeSubscription(ANNUAL_PRICE, { schedule: null }),
  });
  const plain: any = await none.service.getSubscriptionSummary({ manager: none.manager as any, forceStripeRefresh: true });
  assert.equal(plain.scheduled_change, null);
  assert.equal(none.calls.filter((call) => call.method.startsWith('subscriptionSchedules.')).length, 0);

  // A schedule whose next phase keeps the price plans no switch.
  const samePrice = annualWithPlannedSwitch({}, {
    ...PLANNED_SWITCH,
    phases: [PLANNED_SWITCH.phases[0], { ...PLANNED_SWITCH.phases[1], items: [{ price: 'price_annual', quantity: 1 }] }],
  });
  const kept: any = await samePrice.service.getSubscriptionSummary({ manager: samePrice.manager as any, forceStripeRefresh: true });
  assert.equal(kept.scheduled_change, null);
}

async function testKeepAnnualReleasesTheScheduleAndAudits() {
  const { service, manager, calls, audits } = annualWithPlannedSwitch();
  const summary: any = await service.cancelScheduledChange({ tenantId: 'tenant-1', userId: 'user-1', manager: manager as any });

  assert.deepEqual(calls.filter((call) => call.method === 'subscriptionSchedules.release').map((call) => call.args), [['sub_sched_1']]);
  // A card subscription keeps its payment settings; nothing else changes in Stripe.
  assert.equal(calls.filter((call) => call.method === 'subscriptions.update').length, 0);
  assert.equal(summary.scheduled_change, null);
  assert.deepEqual(audits.map((a) => a.entry), [{
    table: 'subscriptions',
    recordId: 'local-sub',
    action: 'update',
    before: { stripe_subscription_id: 'sub_1', scheduled_change: SWITCH_TO_MONTHLY },
    after: { stripe_subscription_id: 'sub_1', scheduled_change: null },
    userId: 'user-1',
    sourceRef: 'sub_sched_1',
  }]);
  assert.equal(audits[0].opts?.manager, manager);

  // Nothing planned: nothing to release, nothing audited.
  const none = createService({
    tenant: createTenant(COMPLETE_FR_INVOICE),
    subscription: runningOn('annual'),
    priceIds: PRICE_IDS,
    stripeSubscription: stripeSubscription(ANNUAL_PRICE, { schedule: null }),
  });
  await none.service.cancelScheduledChange({ tenantId: 'tenant-1', userId: 'user-1', manager: none.manager as any });
  assert.equal(none.calls.filter((call) => call.method === 'subscriptionSchedules.release').length, 0);
  assert.deepEqual(none.audits, []);
}

async function testKeepAnnualGivesBankTransferBack() {
  // The switch had made the transfer subscription card-only; keeping annual restores the transfer.
  const { service, manager, calls } = annualWithPlannedSwitch({ collection_method: 'send_invoice' });
  await service.cancelScheduledChange({ tenantId: 'tenant-1', userId: 'user-1', manager: manager as any });
  const order = calls.map((call) => call.method);
  assert.ok(order.indexOf('subscriptionSchedules.release') < order.indexOf('subscriptions.update'));
  assert.deepEqual(calls.filter((call) => call.method === 'subscriptions.update').map((call) => call.args), [[
    'sub_1',
    {
      payment_settings: {
        payment_method_types: ['customer_balance', 'card'],
        payment_method_options: {
          customer_balance: { funding_type: 'bank_transfer', bank_transfer: { type: 'eu_bank_transfer', eu_bank_transfer: { country: 'FR' } } },
        },
      },
    },
  ]]);
}

async function testSelectingAnnualWhileASwitchIsPlannedKeepsIt() {
  const { service, manager, calls, audits } = annualWithPlannedSwitch();
  const result: any = await service.changePlan('tenant-1', 'max', 'annual', 'user-1', manager as any, GTC_VERSION);
  assert.deepEqual(result.change, { status: 'scheduled_change_cancelled' });
  assert.equal(result.scheduled_change, null);
  assert.deepEqual(calls.filter((call) => call.method === 'subscriptionSchedules.release').map((call) => call.args), [['sub_sched_1']]);
  assert.equal(calls.filter((call) => call.method === 'subscriptions.update').length, 0);
  assert.equal(calls.filter((call) => call.method === 'subscriptionSchedules.update').length, 0);
  assert.equal(audits.filter((a) => a.entry.table === 'subscriptions' && a.entry.sourceRef === 'sub_sched_1').length, 1);
}

const BANK_TRANSFER_SCHEDULE = {
  id: 'sub_sched_1',
  current_phase: { start_date: PERIOD.start, end_date: PERIOD.end },
  phases: [{ start_date: PERIOD.start, end_date: PERIOD.end, items: [{ price: 'price_annual', quantity: 1 }], collection_method: 'send_invoice' }],
};

async function testTransferToCardWithoutACardRequiresOne() {
  const { service, manager, calls } = createService({
    tenant: createTenant(COMPLETE_FR_INVOICE),
    subscription: runningOn('annual'),
    priceIds: PRICE_IDS,
    stripeSubscription: stripeSubscription(ANNUAL_PRICE, { collection_method: 'send_invoice', currency: 'eur' }),
    onSubscriptionUpdate: (_params, state) => ({ ...state }),
    schedule: BANK_TRANSFER_SCHEDULE,
  });
  const result: any = await service.changePlan('tenant-1', 'max', 'monthly', 'user-1', manager as any, GTC_VERSION, {
    successUrl: 'https://fromage.lvh.me/admin/billing',
    cancelUrl: 'https://fromage.lvh.me/admin/billing',
  });

  assert.deepEqual(result.change, { status: 'requires_card', setup_url: 'https://checkout.stripe.test/cs_1' });
  assert.deepEqual(calls.filter((call) => call.method === 'checkout.sessions.create').map((call) => call.args), [[{
    mode: 'setup',
    customer: 'cus_1',
    currency: 'eur',
    payment_method_types: ['card'],
    success_url: 'https://fromage.lvh.me/admin/billing?card_saved=monthly',
    cancel_url: 'https://fromage.lvh.me/admin/billing',
    metadata: { tenant_id: 'tenant-1', purpose: 'plan_change_card' },
    setup_intent_data: { metadata: { tenant_id: 'tenant-1' } },
  }]]);
  // Nothing changes until a card is saved: no schedule, no subscription update.
  assert.equal(calls.filter((call) => call.method.startsWith('subscriptionSchedules.')).length, 0);
  assert.equal(calls.filter((call) => call.method === 'subscriptions.update').length, 0);

  // Without return URLs in the request, the checkout ones from the configuration.
  const configured = createService({
    tenant: createTenant(COMPLETE_FR_INVOICE),
    subscription: runningOn('annual'),
    priceIds: PRICE_IDS,
    stripeSubscription: stripeSubscription(ANNUAL_PRICE, { collection_method: 'send_invoice' }),
  });
  await configured.service.changePlan('tenant-1', 'max', 'monthly', 'user-1', configured.manager as any, GTC_VERSION);
  const params = configured.calls.find((call) => call.method === 'checkout.sessions.create')!.args[0] as Record<string, unknown>;
  assert.equal(params.success_url, 'https://fromage.kanap.test/admin/billing?card_saved=monthly');
  assert.equal(params.cancel_url, 'https://fromage.kanap.test/admin/billing');
}

async function testTransferToCardWithASavedCardMakesItTheDefault() {
  // A card saved on the setup page before its webhook arrived: it becomes the default, then the switch is scheduled.
  const { service, manager, calls } = createService({
    tenant: createTenant(COMPLETE_FR_INVOICE),
    subscription: runningOn('annual'),
    priceIds: PRICE_IDS,
    stripeSubscription: stripeSubscription(ANNUAL_PRICE, { collection_method: 'send_invoice' }),
    onSubscriptionUpdate: (_params, state) => ({ ...state }),
    schedule: BANK_TRANSFER_SCHEDULE,
    cards: [{ id: 'pm_saved', type: 'card' }],
  });
  const result: any = await service.changePlan('tenant-1', 'max', 'monthly', 'user-1', manager as any, GTC_VERSION);
  assert.equal(result.change.status, 'scheduled');
  assert.ok(calls.some((call) => call.method === 'customers.update'
    && JSON.stringify(call.args) === JSON.stringify(['cus_1', { invoice_settings: { default_payment_method: 'pm_saved' } }])));
  assert.equal(calls.filter((call) => call.method === 'checkout.sessions.create').length, 0);
  assert.equal(calls.filter((call) => call.method === 'subscriptionSchedules.update').length, 1);
}

async function run() {
  await testRequestInvoiceRefusesIncompleteProfile();
  await testCheckoutRefusesIncompleteProfile();
  await testCheckoutRefusesEuProfileWithoutVat();
  await testCheckoutPushesDetailsAndVatToExistingCustomer();
  await testStaleVatIdIsReplacedAndSameOneKept();
  await testRefusedVatNumberBecomesVatNumberInvalid();
  await testSubscribeRefusesWithoutTheCurrentTerms();
  await testAcceptedTermsAreAudited();
  await testChangePlanRequiresTheCurrentTerms();
  await testSubscribeBodiesKeepTheTermsVersion();
  await testNewCustomerCarriesMentionsAndAnIdempotencyKey();
  await testRecreatedCustomerUsesAnotherIdempotencyKey();
  await testIdempotencyKeyFollowsThePayload();
  await testNewCustomerWithoutSirenSendsNoSirenKey();
  await testGermanCustomerGetsNatureOnlyAndGerman();
  await testDraftInvoiceIsSetToA4BeforeFinalizing();
  await testMonthlyToAnnualIsInvoicedAndChargedAtOnce();
  await testUnpaidChangeSendsToTheInvoiceAndChangesNothing();
  await testAnnualToMonthlyIsScheduledAtPeriodEnd();
  await testBankTransferAnnualSwitchesToCardAtPeriodEnd();
  await testSamePlanAndIntervalIsRefused();
  await testTransferToAnnualStartsTheAnnualPeriodNow();
  await testTransferReturnsTheInvoiceToPay();
  await testSummaryShowsThePlannedSwitch();
  await testKeepAnnualReleasesTheScheduleAndAudits();
  await testKeepAnnualGivesBankTransferBack();
  await testSelectingAnnualWhileASwitchIsPlannedKeepsIt();
  await testTransferToCardWithoutACardRequiresOne();
  await testTransferToCardWithASavedCardMakesItTheDefault();
}

void run();
