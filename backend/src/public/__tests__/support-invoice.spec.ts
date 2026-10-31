import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { PublicController, RequestSupportInvoiceDto } from '../public.controller';
import { Features } from '../../config/features';
import { GTC_VERSION } from '../../billing/terms';
import { BACKEND_ROOT } from '../../common/__tests__/backend-root';

// The Enterprise Support invoice (public form on /offer, no tenant): a full billing address
// with an ISO country, a valid VAT number in the EU, the general terms of sale accepted; the
// customer carries the invoice mentions and language of the tenant flow, the invoice is A4,
// and a double click or a retry creates nothing twice. The body goes through the global
// ValidationPipe (whitelist + transform) like a real request.

const PRICE_ID = 'price_support_test';
const pipe = new ValidationPipe({ whitelist: true, transform: true });

type Call = { method: string; args: any[] };

function buildStripe() {
  const calls: Call[] = [];
  const state = { invoiceStatus: 'draft', pageSize: null as string | null };
  const invoice = () => ({
    id: 'in_1',
    status: state.invoiceStatus,
    collection_method: 'send_invoice',
    hosted_invoice_url: state.invoiceStatus === 'draft' ? null : 'https://invoice.example.test/in_1',
    number: state.invoiceStatus === 'draft' ? null : 'KANAP-0001',
    rendering: state.pageSize ? { pdf: { page_size: state.pageSize } } : null,
  });
  const record = (method: string, run: (...args: any[]) => any) => async (...args: any[]) => {
    calls.push({ method, args });
    return run(...args);
  };
  const stripe = {
    customers: {
      create: record('customers.create', () => ({ id: 'cus_1' })),
      update: record('customers.update', () => ({ id: 'cus_1' })),
    },
    subscriptions: {
      // Like an idempotent replay, the expanded invoice is the one of the first response: a draft.
      create: record('subscriptions.create', () => ({
        id: 'sub_1',
        latest_invoice: { id: 'in_1', status: 'draft', collection_method: 'send_invoice' },
      })),
    },
    invoices: {
      retrieve: record('invoices.retrieve', () => invoice()),
      update: record('invoices.update', (_id: string, params: any) => {
        state.pageSize = params?.rendering?.pdf?.page_size ?? state.pageSize;
        return invoice();
      }),
      finalizeInvoice: record('invoices.finalizeInvoice', () => {
        state.invoiceStatus = 'open';
        return invoice();
      }),
      sendInvoice: record('invoices.sendInvoice', () => invoice()),
    },
  };
  return { stripe, calls, state };
}

function buildController() {
  const { stripe, calls, state } = buildStripe();
  const turnstile = { verifyOrThrow: async () => undefined };
  const controller = new PublicController(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { send: async () => undefined } as any,
    {} as any,
    {} as any,
    turnstile as any,
    { getClient: () => stripe } as any,
    {} as any,
    {} as any,
  );
  return { controller, calls, state };
}

const VALID_BODY = Object.freeze({
  company_name: ' Fromagerie Example ',
  contact_name: 'Ada Example',
  billing_email: ' Billing@Example.invalid ',
  address_line1: ' 1 rue de la Paix ',
  postal_code: '75002',
  city: 'Paris',
  country: ' fr ',
  vat_id: 'FR 40 303 265 045',
  terms_version: GTC_VERSION,
  captchaToken: 'captcha-token',
});

const REQUEST = { ip: '127.0.0.1', headers: { host: 'kanap.example.test' } };

/** Runs the body through the ValidationPipe, then the route. */
async function submit(controller: PublicController, body: Record<string, unknown>) {
  const dto = await pipe.transform({ ...body }, { type: 'body', metatype: RequestSupportInvoiceDto });
  return controller.requestSupportInvoice(dto, REQUEST);
}

async function expectRefused(body: Record<string, unknown>, label: string) {
  const { controller, calls } = buildController();
  let error: unknown;
  try {
    await submit(controller, body);
  } catch (e) {
    error = e;
  }
  assert.ok(error instanceof BadRequestException, `${label}: expected a 400, got ${String(error)}`);
  assert.deepEqual(calls, [], `${label}: no Stripe call on a refused request`);
}

function without(key: string): Record<string, unknown> {
  const body: Record<string, unknown> = { ...VALID_BODY };
  delete body[key];
  return body;
}

function emptyStrings(value: unknown, at = 'params'): string[] {
  if (value === '') return [at];
  if (Array.isArray(value)) return value.flatMap((item, i) => emptyStrings(item, `${at}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => emptyStrings(item, `${at}.${key}`));
  }
  return [];
}

function callsOf(calls: Call[], method: string): Call[] {
  return calls.filter((call) => call.method === method);
}

async function testRequiredAddress() {
  for (const field of ['address_line1', 'city', 'postal_code']) {
    await expectRefused(without(field), `missing ${field}`);
    await expectRefused({ ...VALID_BODY, [field]: '   ' }, `blank ${field}`);
  }
}

async function testIsoCountry() {
  await expectRefused({ ...VALID_BODY, country: 'FRANCE' }, 'country FRANCE');
  await expectRefused({ ...VALID_BODY, country: 'OTHER' }, 'country OTHER');
  await expectRefused(without('country'), 'missing country');

  const { controller, calls } = buildController();
  await submit(controller, VALID_BODY);
  const [create] = callsOf(calls, 'customers.create');
  assert.equal(create.args[0].address.country, 'FR');
}

async function testEuVatRule() {
  await expectRefused(without('vat_id'), 'EU without VAT');
  await expectRefused({ ...VALID_BODY, vat_id: 'FR123' }, 'EU with a malformed VAT');
  await expectRefused({ ...VALID_BODY, country: 'DE', vat_id: 'FR40303265045' }, 'VAT of another country');

  // Outside the EU the VAT number is optional and never sent as an eu_vat tax id.
  const { controller, calls } = buildController();
  await submit(controller, { ...without('vat_id'), country: 'CH' });
  const [create] = callsOf(calls, 'customers.create');
  assert.equal(create.args[0].tax_id_data, undefined);
  assert.deepEqual(create.args[0].preferred_locales, ['en']);
}

async function testTermsRequired() {
  await expectRefused(without('terms_version'), 'no GTC');
  await expectRefused({ ...VALID_BODY, terms_version: '2020-01-01' }, 'old GTC version');
}

async function testCustomerPayload() {
  const { controller, calls } = buildController();
  const answer = await submit(controller, VALID_BODY);
  assert.equal(answer.ok, true);
  assert.equal(answer.invoice_status, 'open');

  const [create] = callsOf(calls, 'customers.create');
  const [params, options] = create.args;
  assert.deepEqual(emptyStrings(params), [], 'no empty string in the customer payload');
  assert.equal(params.name, 'Fromagerie Example');
  assert.equal(params.email, 'billing@example.invalid');
  assert.deepEqual(params.address, { line1: '1 rue de la Paix', city: 'Paris', postal_code: '75002', country: 'FR' });
  assert.deepEqual(params.tax_id_data, [{ type: 'eu_vat', value: 'FR40303265045' }]);
  assert.deepEqual(params.invoice_settings.custom_fields, [
    { name: "Nature de l'opération", value: 'Prestation de services' },
    { name: 'SIREN', value: '303265045' },
  ]);
  assert.deepEqual(params.preferred_locales, ['fr']);
  assert.equal(params.metadata.siren, '303265045');
  assert.equal(params.metadata.billing_channel, 'enterprise-support');
  assert.equal(params.metadata.contact_name, 'Ada Example');
  assert.match(options.idempotencyKey, /^support-invoice-[0-9a-f]{64}-customer$/);

  const [subscription] = callsOf(calls, 'subscriptions.create');
  assert.equal(subscription.args[0].customer, 'cus_1');
  assert.equal(subscription.args[0].days_until_due, 30);
  assert.deepEqual(subscription.args[0].items, [{ price: PRICE_ID, quantity: 1 }]);
  const base = options.idempotencyKey.replace(/-customer$/, '');
  assert.equal(subscription.args[1].idempotencyKey, `${base}-subscription`);
}

async function testIdempotencyKeysFollowThePayload() {
  const keysOf = async (body: Record<string, unknown>) => {
    const { controller, calls } = buildController();
    await submit(controller, body);
    return [
      callsOf(calls, 'customers.create')[0].args[1].idempotencyKey,
      callsOf(calls, 'subscriptions.create')[0].args[1].idempotencyKey,
    ];
  };
  const first = await keysOf(VALID_BODY);
  assert.deepEqual(await keysOf({ ...VALID_BODY }), first, 'an identical retry reuses the keys');
  assert.deepEqual(
    await keysOf({ ...VALID_BODY, billing_email: 'billing@example.invalid', country: 'FR' }),
    first,
    'the keys follow the normalised payload',
  );
  const corrected = await keysOf({ ...VALID_BODY, postal_code: '75003' });
  assert.notEqual(corrected[0], first[0], 'a corrected form is a new customer request');
  assert.notEqual(corrected[1], first[1], 'a corrected form is a new subscription request');
}

async function testA4BeforeFinalize() {
  const { controller, calls } = buildController();
  await submit(controller, VALID_BODY);
  const methods = calls.map((call) => call.method);
  const a4 = calls.findIndex(
    (call) => call.method === 'invoices.update' && call.args[1]?.rendering?.pdf?.page_size === 'a4',
  );
  const finalize = methods.indexOf('invoices.finalizeInvoice');
  assert.ok(a4 >= 0, 'the draft is set to A4');
  assert.ok(finalize > a4, 'A4 is set before finalizing');
  assert.equal(methods.filter((m) => m === 'invoices.sendInvoice').length, 1);
}

async function testRetryFinalizesAndSendsOnce() {
  // Same controller, same Stripe state: the second request is the retry of a double click.
  const { controller, calls } = buildController();
  const first = await submit(controller, VALID_BODY);
  const second = await submit(controller, VALID_BODY);
  assert.equal(callsOf(calls, 'invoices.finalizeInvoice').length, 1, 'finalized once');
  assert.equal(callsOf(calls, 'invoices.sendInvoice').length, 1, 'sent once');
  assert.equal(second.hosted_invoice_url, first.hosted_invoice_url);
  assert.equal(second.invoice_number, first.invoice_number);
}

async function testTermsAcceptanceRecordedOnCustomer() {
  const { controller, calls } = buildController();
  const before = Date.now();
  await submit(controller, VALID_BODY);
  const [update] = callsOf(calls, 'customers.update');
  assert.ok(update, 'the acceptance is written on the customer');
  assert.equal(update.args[0], 'cus_1');
  assert.equal(update.args[1].metadata.gtc_version, GTC_VERSION);
  const acceptedAt = Date.parse(update.args[1].metadata.gtc_accepted_at);
  assert.ok(acceptedAt >= before - 1000 && acceptedAt <= Date.now() + 1000);
  const methods = calls.map((call) => call.method);
  assert.ok(methods.indexOf('customers.update') < methods.indexOf('subscriptions.create'));
}

function testMarketingSendsTheCurrentVersion() {
  const file = path.join(BACKEND_ROOT, '..', 'marketing', 'web', 'src', 'content', 'legal', 'terms-version.ts');
  const source = fs.readFileSync(file, 'utf8');
  const match = /GTC_VERSION\s*=\s*'([^']+)'/.exec(source);
  assert.ok(match, 'marketing declares GTC_VERSION');
  assert.equal(match[1], GTC_VERSION, 'the offer form sends the version the backend expects');
}

async function main() {
  const savedPrice = process.env.STRIPE_PRICE_ENTERPRISE_SUPPORT_ANNUAL;
  const savedNotify = process.env.ENTERPRISE_SUPPORT_NOTIFY_EMAIL;
  const savedBankCountry = process.env.STRIPE_EU_BANK_TRANSFER_COUNTRY;
  const savedSingleTenant = Features.SINGLE_TENANT;
  process.env.STRIPE_PRICE_ENTERPRISE_SUPPORT_ANNUAL = PRICE_ID;
  delete process.env.ENTERPRISE_SUPPORT_NOTIFY_EMAIL;
  delete process.env.STRIPE_EU_BANK_TRANSFER_COUNTRY;
  (Features as any).SINGLE_TENANT = false;
  try {
    await testRequiredAddress();
    await testIsoCountry();
    await testEuVatRule();
    await testTermsRequired();
    await testCustomerPayload();
    await testIdempotencyKeysFollowThePayload();
    await testA4BeforeFinalize();
    await testRetryFinalizesAndSendsOnce();
    await testTermsAcceptanceRecordedOnCustomer();
    testMarketingSendsTheCurrentVersion();
  } finally {
    if (savedPrice === undefined) delete process.env.STRIPE_PRICE_ENTERPRISE_SUPPORT_ANNUAL;
    else process.env.STRIPE_PRICE_ENTERPRISE_SUPPORT_ANNUAL = savedPrice;
    if (savedNotify !== undefined) process.env.ENTERPRISE_SUPPORT_NOTIFY_EMAIL = savedNotify;
    if (savedBankCountry !== undefined) process.env.STRIPE_EU_BANK_TRANSFER_COUNTRY = savedBankCountry;
    (Features as any).SINGLE_TENANT = savedSingleTenant;
  }
  console.log('support-invoice.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
