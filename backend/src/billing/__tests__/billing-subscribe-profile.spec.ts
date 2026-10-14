import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { BillingService } from '../billing.service';
import { Subscription } from '../subscription.entity';

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
  retrievedCustomer?: Record<string, unknown>;
}) {
  const calls: Call[] = [];
  const record = (method: string, impl: (...args: any[]) => unknown) => async (...args: unknown[]) => {
    calls.push({ method, args });
    return impl(...args);
  };
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
    },
    checkout: {
      sessions: { create: record('checkout.sessions.create', () => ({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' })) },
    },
    subscriptions: {
      create: record('subscriptions.create', () => ({ id: 'sub_1', latest_invoice: null })),
      retrieve: record('subscriptions.retrieve', () => null),
      update: record('subscriptions.update', () => ({ id: 'sub_1' })),
    },
    invoices: {
      list: record('invoices.list', () => ({ data: [] })),
      retrieve: record('invoices.retrieve', () => null),
      finalizeInvoice: record('invoices.finalizeInvoice', () => null),
      update: record('invoices.update', () => null),
    },
    prices: { retrieve: record('prices.retrieve', () => null) },
    paymentMethods: { retrieve: record('paymentMethods.retrieve', () => null) },
  };

  const subscription = { id: 'local-sub', plan_name: 'Trial', seat_limit: null } as unknown as Subscription;
  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === Subscription) {
        return {
          findOne: async () => subscription,
          create: (data: Partial<Subscription>) => data,
          save: async (data: Subscription) => data,
        };
      }
      throw new Error('Unexpected repository');
    },
  };
  const tenants = {
    findOne: async () => opts.tenant,
    update: async () => undefined,
  };
  const stripeConfig = {
    getPriceId: () => 'price_max',
    getCheckoutSuccessUrl: () => 'https://fromage.kanap.test/admin/billing',
    getCheckoutCancelUrl: () => 'https://fromage.kanap.test/admin/billing',
  };
  const audit = { log: async () => undefined };
  const service = new BillingService(
    { manager } as any,
    {} as any,
    tenants as any,
    { getClient: () => client } as any,
    stripeConfig as any,
    {} as any,
    audit as any,
  );
  return { service, manager, calls };
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
  await expectBadRequest(service.requestInvoice('tenant-1', 'max', 'annual', 'user-1', manager as any), INCOMPLETE);
  assert.deepEqual(calls, []);
}

async function testCheckoutRefusesIncompleteProfile() {
  const { service, manager, calls } = createService({ tenant: createTenant(null) });
  await expectBadRequest(
    service.createCheckoutSession({ tenantId: 'tenant-1', manager: manager as any, planKey: 'max', interval: 'monthly' }),
    INCOMPLETE,
  );
  assert.deepEqual(calls, []);
}

async function testCheckoutRefusesEuProfileWithoutVat() {
  const { service, manager, calls } = createService({
    tenant: createTenant({ ...COMPLETE_FR_INVOICE, vat_number: null }),
  });
  await expectBadRequest(
    service.createCheckoutSession({ tenantId: 'tenant-1', manager: manager as any, planKey: 'max', interval: 'monthly' }),
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
  await service.createCheckoutSession({ tenantId: 'tenant-1', manager: manager as any, planKey: 'max', interval: 'monthly' });
  assert.deepEqual(
    calls.filter((call) => call.method === 'customers.deleteTaxId').map((call) => call.args),
    [['cus_1', 'txi_old']],
  );
  assert.equal(calls.filter((call) => call.method === 'customers.createTaxId').length, 1);

  const same = createService({
    tenant: createTenant(COMPLETE_FR_INVOICE),
    taxIds: [{ id: 'txi_same', type: 'eu_vat', value: 'FR12345678901' }],
  });
  await same.service.createCheckoutSession({ tenantId: 'tenant-1', manager: same.manager as any, planKey: 'max', interval: 'monthly' });
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
  await expectBadRequest(service.requestInvoice('tenant-1', 'max', 'annual', 'user-1', manager as any), {
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
    checkout.service.createCheckoutSession({ tenantId: 'tenant-1', manager: checkout.manager as any, planKey: 'max', interval: 'monthly' }),
    { message: 'VAT_NUMBER_INVALID' },
  );
  assert.equal(checkout.calls.filter((call) => call.method === 'checkout.sessions.create').length, 0);
}

async function testNewCustomerCarriesMentionsAndAnIdempotencyKey() {
  const { service, manager, calls } = createService({ tenant: createTenant(COMPLETE_FR_INVOICE, null) });
  await service.createCheckoutSession({ tenantId: 'tenant-1', manager: manager as any, planKey: 'max', interval: 'monthly' });
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
  await service.createCheckoutSession({ tenantId: 'tenant-1', manager: manager as any, planKey: 'max', interval: 'monthly' });
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
  await service.createCheckoutSession({ tenantId: 'tenant-1', manager: manager as any, planKey: 'max', interval: 'monthly' });
  const creates = calls.filter((call) => call.method === 'customers.create');
  assert.equal(creates.length, 1);
  assert.match((creates[0].args[1] as { idempotencyKey: string }).idempotencyKey, /^tenant-customer-tenant-1-cus_deleted-[0-9a-f]{16}$/);
}

async function testGermanCustomerGetsNatureOnlyAndGerman() {
  const { service, manager, calls } = createService({ tenant: createTenant(COMPLETE_DE_INVOICE) });
  await service.createCheckoutSession({ tenantId: 'tenant-1', manager: manager as any, planKey: 'max', interval: 'monthly' });
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

async function run() {
  await testRequestInvoiceRefusesIncompleteProfile();
  await testCheckoutRefusesIncompleteProfile();
  await testCheckoutRefusesEuProfileWithoutVat();
  await testCheckoutPushesDetailsAndVatToExistingCustomer();
  await testStaleVatIdIsReplacedAndSameOneKept();
  await testRefusedVatNumberBecomesVatNumberInvalid();
  await testNewCustomerCarriesMentionsAndAnIdempotencyKey();
  await testRecreatedCustomerUsesAnotherIdempotencyKey();
  await testIdempotencyKeyFollowsThePayload();
  await testNewCustomerWithoutSirenSendsNoSirenKey();
  await testGermanCustomerGetsNatureOnlyAndGerman();
  await testDraftInvoiceIsSetToA4BeforeFinalizing();
}

void run();
