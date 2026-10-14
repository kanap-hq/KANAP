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
  /** A running Stripe subscription (plan change). */
  subscription?: Partial<Subscription>;
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
      retrieve: record('subscriptions.retrieve', () =>
        opts.subscription ? { id: 'sub_1', status: 'active', items: { data: [{ id: 'si_1' }] } } : null),
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

  const subscription = {
    id: 'local-sub',
    plan_name: 'Trial',
    seat_limit: null,
    ...(opts.subscription ?? {}),
  } as unknown as Subscription;
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
    getPriceId: () => 'price_max',
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
  return { service, manager, calls, audits };
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
}

void run();
