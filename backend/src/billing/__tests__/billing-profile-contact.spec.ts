import * as assert from 'node:assert/strict';
import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { BillingService } from '../billing.service';
import { UpdateBillingProfileDto } from '../billing.controller';
import { Subscription } from '../subscription.entity';

/**
 * The billing page has one invoicing section, saved field by field.
 * - A tenant who only filled the former customer card finds those values in the
 *   invoicing details (field by field, before the tenant billing columns), and the
 *   checks and the checkout use them; the next save writes them as invoicing values.
 * - A field present in the PATCH payload replaces the stored value, an empty string or
 *   null clears it (an empty email included); a field left out stays as it is.
 */

type TenantRow = Record<string, any>;
type Call = { method: string; args: unknown[] };

const CUSTOMER_CARD = {
  name: 'Claire Martin',
  company: 'Fromage SAS',
  email: 'compta@fromage-co.com',
  vat_number: 'FR12345678901',
  address: { line1: '1 rue de la Paix', postal_code: '75002', city: 'Paris', country: 'FR' },
};

const COMPLETE_INVOICE = {
  name: 'Accounts payable',
  company: 'Fromage SAS',
  email: 'billing@fromage-co.com',
  phone: '+33 1 23 45 67 89',
  vat_number: 'FR12345678901',
  address: { line1: '1 rue de la Paix', line2: 'Bat. B', postal_code: '75002', city: 'Paris', state: null, country: 'FR' },
};

function createTenant(overrides: Partial<TenantRow> = {}): TenantRow {
  return {
    id: 'tenant-1',
    slug: 'fromage',
    name: 'Fromage',
    stripe_customer_id: 'cus_1',
    billing_invoice_info: {},
    billing_customer_info: {},
    billing_email: null,
    billing_company_name: null,
    billing_phone: null,
    billing_tax_id: null,
    billing_address: null,
    ...overrides,
  };
}

function createService(tenant: TenantRow) {
  const calls: Call[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const record = (method: string, impl: (...args: any[]) => unknown) => async (...args: unknown[]) => {
    calls.push({ method, args });
    return impl(...args);
  };
  const client = {
    customers: {
      retrieve: record('customers.retrieve', () => ({ id: 'cus_1' })),
      update: record('customers.update', () => ({ id: 'cus_1' })),
      create: record('customers.create', () => ({ id: 'cus_new' })),
      listTaxIds: record('customers.listTaxIds', () => ({ data: [] })),
      createTaxId: record('customers.createTaxId', () => ({ id: 'txi_new' })),
      deleteTaxId: record('customers.deleteTaxId', () => ({ deleted: true })),
    },
    checkout: {
      sessions: { create: record('checkout.sessions.create', () => ({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' })) },
    },
    subscriptions: {
      retrieve: record('subscriptions.retrieve', () => null),
      update: record('subscriptions.update', () => ({ id: 'sub_1' })),
    },
    invoices: { list: record('invoices.list', () => ({ data: [] })) },
    prices: { retrieve: record('prices.retrieve', () => null) },
  };
  const subscription = { id: 'local-sub', plan_name: 'Trial', seat_limit: null } as unknown as Subscription;
  const tenantRepo = {
    findOne: async () => tenant,
    update: async (_where: unknown, columns: Record<string, unknown>) => {
      updates.push(columns);
      Object.assign(tenant, columns);
    },
  };
  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === Subscription) {
        return {
          findOne: async () => subscription,
          create: (data: Partial<Subscription>) => data,
          save: async (data: Subscription) => data,
        };
      }
      return tenantRepo;
    },
  };
  const stripeConfig = {
    getPriceId: () => 'price_max',
    getCheckoutSuccessUrl: () => 'https://fromage.kanap.test/admin/billing',
    getCheckoutCancelUrl: () => 'https://fromage.kanap.test/admin/billing',
  };
  const service = new BillingService(
    { manager } as any,
    {} as any,
    tenantRepo as any,
    { getClient: () => client } as any,
    stripeConfig as any,
    {} as any,
    { log: async () => undefined } as any,
  );
  return { service, manager, calls, updates };
}

const pipe = new ValidationPipe({ whitelist: true, transform: true });
const bodyMeta: ArgumentMetadata = { type: 'body', metatype: UpdateBillingProfileDto, data: '' };

/** The body as the controller receives it: through the global validation pipe. */
async function validBody(body: Record<string, unknown>): Promise<UpdateBillingProfileDto> {
  return pipe.transform(body, bodyMeta);
}

async function patch(tenant: TenantRow, body: Record<string, unknown>) {
  const { service, manager, updates } = createService(tenant);
  const dto = await validBody(body);
  const result = await service.updateBillingProfile({
    tenantId: tenant.id,
    customer: dto.customer ?? undefined,
    invoice: dto.invoice ?? undefined,
    manager: manager as any,
  });
  return { result, updates };
}

async function testInvoiceDetailsBorrowTheCustomerCard() {
  const tenant = createTenant({
    billing_customer_info: CUSTOMER_CARD,
    // The tenant columns come after the customer card, and fill what it lacks.
    billing_email: 'old@fromage-co.com',
    billing_phone: '+33 9 99 99 99 99',
  });
  const { service } = createService(tenant);
  const profile = await service.getBillingProfile({ tenantId: tenant.id });
  assert.deepEqual(profile.invoice, {
    name: 'Claire Martin',
    company: 'Fromage SAS',
    email: 'compta@fromage-co.com',
    phone: '+33 9 99 99 99 99',
    vatNumber: 'FR12345678901',
    address: { line1: '1 rue de la Paix', line2: null, city: 'Paris', state: null, postalCode: '75002', country: 'FR' },
  });
  assert.deepEqual(profile.invoice_missing_fields, []);
}

async function testSavedInvoiceValuesComeFirst() {
  const tenant = createTenant({
    billing_customer_info: CUSTOMER_CARD,
    // Saved by the former page, which left empty fields out of the record.
    billing_invoice_info: { email: 'billing@fromage-co.com', address: { city: 'Lyon' } },
  });
  const { service } = createService(tenant);
  const profile = await service.getBillingProfile({ tenantId: tenant.id });
  assert.equal(profile.invoice.email, 'billing@fromage-co.com');
  assert.equal(profile.invoice.address.city, 'Lyon');
  assert.equal(profile.invoice.address.line1, '1 rue de la Paix');
  assert.equal(profile.invoice.company, 'Fromage SAS');
}

async function testCheckoutUsesTheBorrowedDetails() {
  const tenant = createTenant({ billing_customer_info: CUSTOMER_CARD });
  const { service, manager, calls } = createService(tenant);
  const session = await service.createCheckoutSession({
    tenantId: tenant.id,
    manager: manager as any,
    planKey: 'max',
    interval: 'monthly',
  });
  assert.equal(session.id, 'cs_1');
  const update = calls.find((call) => call.method === 'customers.update');
  assert.ok(update, 'the Stripe customer receives the invoicing details');
  assert.deepEqual(update!.args[1], {
    email: 'compta@fromage-co.com',
    name: 'Fromage SAS',
    phone: undefined,
    address: { line1: '1 rue de la Paix', city: 'Paris', postal_code: '75002', country: 'FR' },
  });
}

async function testNextSaveWritesTheBorrowedValues() {
  const tenant = createTenant({ billing_customer_info: CUSTOMER_CARD });
  const { result, updates } = await patch(tenant, { invoice: { phone: '+33 1 00 00 00 00' } });
  assert.equal(result.invoice.email, 'compta@fromage-co.com');
  assert.equal(result.invoice.phone, '+33 1 00 00 00 00');
  assert.deepEqual(tenant.billing_invoice_info, {
    name: 'Claire Martin',
    company: 'Fromage SAS',
    email: 'compta@fromage-co.com',
    phone: '+33 1 00 00 00 00',
    vat_number: 'FR12345678901',
    address: { line1: '1 rue de la Paix', line2: null, city: 'Paris', state: null, postal_code: '75002', country: 'FR' },
  });
  // The customer card's record is left as it was.
  assert.equal(updates.length, 1);
  assert.ok(!('billing_customer_info' in updates[0]), 'the customer contact is not rewritten');
  assert.deepEqual(tenant.billing_customer_info, CUSTOMER_CARD);
}

async function testClearingFields() {
  const tenant = createTenant({ billing_invoice_info: COMPLETE_INVOICE, billing_customer_info: CUSTOMER_CARD });
  const { result } = await patch(tenant, {
    invoice: { email: '', vatNumber: null, address: { city: '' } },
  });
  assert.equal(result.invoice.email, null);
  assert.equal(result.invoice.vatNumber, null);
  assert.equal(result.invoice.address.city, null);
  // Fields left out of the payload are untouched.
  assert.equal(result.invoice.name, 'Accounts payable');
  assert.equal(result.invoice.company, 'Fromage SAS');
  assert.equal(result.invoice.phone, '+33 1 23 45 67 89');
  assert.deepEqual(result.invoice.address, {
    line1: '1 rue de la Paix',
    line2: 'Bat. B',
    city: null,
    state: null,
    postalCode: '75002',
    country: 'FR',
  });
  assert.deepEqual(result.invoice_missing_fields, ['email', 'city', 'vatNumber']);
  assert.equal(tenant.billing_email, null);
  assert.equal(tenant.billing_tax_id, null);

  // Read again: a cleared field stays empty, the customer card does not fill it back.
  const { service } = createService(tenant);
  const profile = await service.getBillingProfile({ tenantId: tenant.id });
  assert.equal(profile.invoice.email, null);
  assert.equal(profile.invoice.vatNumber, null);
  assert.equal(profile.invoice.address.city, null);
  assert.deepEqual(profile.invoice_missing_fields, ['email', 'city', 'vatNumber']);
}

async function testClearingTheCompanyKeepsItEmpty() {
  const tenant = createTenant({ billing_invoice_info: COMPLETE_INVOICE });
  const { result } = await patch(tenant, { invoice: { company: null } });
  assert.equal(result.invoice.company, null);
  assert.deepEqual(result.invoice_missing_fields, ['company']);
}

async function testEmptyEmailIsAcceptedAndAMalformedOneRefused() {
  for (const email of ['', '   ', null]) {
    const body = await validBody({ invoice: { email } });
    assert.equal(body.invoice?.email, email);
  }
  const valid = await validBody({ invoice: { email: 'billing@fromage-co.com' } });
  assert.equal(valid.invoice?.email, 'billing@fromage-co.com');
  let caught: unknown = null;
  try {
    await validBody({ invoice: { email: 'not-an-email' } });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof BadRequestException, 'a malformed email is refused');
}

async function run() {
  await testInvoiceDetailsBorrowTheCustomerCard();
  await testSavedInvoiceValuesComeFirst();
  await testCheckoutUsesTheBorrowedDetails();
  await testNextSaveWritesTheBorrowedValues();
  await testClearingFields();
  await testClearingTheCompanyKeepsItEmpty();
  await testEmptyEmailIsAcceptedAndAMalformedOneRefused();
}

void run();
