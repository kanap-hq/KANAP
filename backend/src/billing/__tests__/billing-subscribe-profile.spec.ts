import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { BillingService } from '../billing.service';
import { Subscription } from '../subscription.entity';

/**
 * A tenant subscribes (card checkout or bank transfer) only with complete invoice
 * details. The check runs before any Stripe call, so Stripe never answers with a raw
 * "customer needs a valid email" error. With complete details, the Stripe customer
 * receives the current details and the EU VAT number as an `eu_vat` tax id.
 */

type Call = { method: string; args: unknown[] };

const COMPLETE_FR_INVOICE = {
  company: 'Fromage SAS',
  email: 'billing@fromage-co.com',
  phone: '+33 1 23 45 67 89',
  vat_number: 'FR 12 345678901',
  address: { line1: '1 rue de la Paix', postal_code: '75002', city: 'Paris', country: 'FR' },
};

function createTenant(invoiceInfo: Record<string, unknown> | null) {
  return {
    id: 'tenant-1',
    slug: 'fromage',
    name: 'Fromage',
    stripe_customer_id: 'cus_1',
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
}) {
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
  });
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

async function run() {
  await testRequestInvoiceRefusesIncompleteProfile();
  await testCheckoutRefusesIncompleteProfile();
  await testCheckoutRefusesEuProfileWithoutVat();
  await testCheckoutPushesDetailsAndVatToExistingCustomer();
  await testStaleVatIdIsReplacedAndSameOneKept();
  await testRefusedVatNumberBecomesVatNumberInvalid();
}

void run();
