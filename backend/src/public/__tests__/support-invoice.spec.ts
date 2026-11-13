import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BadRequestException, HttpStatus, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { RATE_LIMITS } from '../../common/rate-limit';
import { PublicController, RequestSupportInvoiceDto } from '../public.controller';
import { billingEmailRateLimitKey } from '../billing-email-key';
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

/** A CAPTCHA that accepts every token but `refused-token`. */
const turnstile = {
  verifyOrThrow: async ({ token }: { token?: string }) => {
    if (token === 'refused-token') throw new BadRequestException({ code: 'CAPTCHA_FAILED' });
  },
};

function buildController() {
  const { stripe, calls, state } = buildStripe();
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
  // Nest injects the rate limit storage as a property (ThrottlerModule's).
  Object.assign(controller, { rateLimitStorage: new ThrottlerStorageService() });
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

async function statusOf(run: Promise<unknown>): Promise<number> {
  try {
    await run;
    return 200;
  } catch (error: any) {
    return typeof error?.getStatus === 'function' ? error.getStatus() : 500;
  }
}

async function testBillingAddressBudget() {
  const { controller, calls } = buildController();
  const { limit } = RATE_LIMITS.publicSupportInvoiceBillingEmail;
  for (let i = 0; i < limit; i += 1) assert.equal(await statusOf(submit(controller, VALID_BODY)), 200, `request ${i + 1} goes`);
  const before = calls.length;
  const again = { ...VALID_BODY, billing_email: 'BILLING@example.invalid', company_name: 'Another name' };
  assert.equal(await statusOf(submit(controller, again)), HttpStatus.TOO_MANY_REQUESTS, 'past the budget of one billing address: 429');
  assert.equal(calls.length, before, 'no Stripe call past the budget');
  assert.equal(await statusOf(submit(controller, { ...VALID_BODY, billing_email: 'other@example.invalid' })), 200, 'another billing address goes');
}

async function testPlatformBudget() {
  const { controller, calls } = buildController();
  const { limit } = RATE_LIMITS.publicSupportInvoicePlatform;
  for (let i = 0; i < limit; i += 1) {
    assert.equal(await statusOf(submit(controller, { ...VALID_BODY, billing_email: `buyer${i}@example.invalid` })), 200, `request ${i + 1} goes`);
  }
  const before = calls.length;
  assert.equal(
    await statusOf(submit(controller, { ...VALID_BODY, billing_email: 'late@example.invalid' })),
    HttpStatus.TOO_MANY_REQUESTS,
    'past the budget of the platform: 429',
  );
  assert.equal(calls.length, before, 'no Stripe call past the budget');
}

async function testRefusedRequestsAreNotCounted() {
  const { controller, calls } = buildController();
  const { limit } = RATE_LIMITS.publicSupportInvoicePlatform;
  for (let i = 0; i < limit + 5; i += 1) {
    assert.equal(await statusOf(submit(controller, { ...VALID_BODY, captchaToken: 'refused-token' })), 400, 'CAPTCHA refused');
    assert.equal(await statusOf(submit(controller, { ...VALID_BODY, vat_id: 'FR123' })), 400, 'invalid request');
  }
  assert.deepEqual(calls, []);
  assert.equal(await statusOf(submit(controller, VALID_BODY)), 200, 'refused requests leave both budgets untouched');
}

function testBillingKeyFunction() {
  const key = billingEmailRateLimitKey('victim@gmail.com');
  for (const email of ['victim+1@gmail.com', 'v.ictim@googlemail.com', '"victim"@gmail.com', ' Vic.Tim+invoices @GMAIL.com']) {
    assert.equal(billingEmailRateLimitKey(email), key, email);
  }
  assert.equal(billingEmailRateLimitKey('first.last+x@example.com'), 'first.last@example.com', 'dots stay outside Gmail');
  assert.notEqual(billingEmailRateLimitKey('victim@example.com'), key, 'another domain is another address');
}

async function testBillingKeyIsNormalised() {
  const { controller, calls } = buildController();
  const variants = ['victim+1@gmail.com', 'v.ictim@googlemail.com', '"victim"@gmail.com'];
  for (const email of variants) {
    assert.equal(await statusOf(submit(controller, { ...VALID_BODY, billing_email: email })), 200, `${email} goes`);
  }
  assert.equal(
    await statusOf(submit(controller, { ...VALID_BODY, billing_email: 'Victim@Gmail.com' })),
    HttpStatus.TOO_MANY_REQUESTS,
    'the variants of one address share one budget',
  );
  const sent = callsOf(calls, 'customers.create').map((call) => call.args[0].email);
  assert.deepEqual(sent, variants, 'Stripe receives the address as typed');
}

async function testPlatformRefusalSparesTheBuyer() {
  const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  try {
    const { controller } = buildController();
    const warnings: string[] = [];
    (controller as any).logger.warn = (message: unknown) => warnings.push(String(message));
    const { limit, ttl } = RATE_LIMITS.publicSupportInvoicePlatform;
    const buyer = { ...VALID_BODY, billing_email: 'returning@example.invalid' };
    for (let i = 0; i < limit - 2; i += 1) {
      assert.equal(await statusOf(submit(controller, { ...VALID_BODY, billing_email: `early${i}@example.invalid` })), 200);
    }
    offset = ttl / 2;
    assert.equal(await statusOf(submit(controller, buyer)), 200);
    assert.equal(await statusOf(submit(controller, buyer)), 200, 'the platform budget is now spent');
    for (let i = 0; i < 3; i += 1) assert.equal(await statusOf(submit(controller, buyer)), HttpStatus.TOO_MANY_REQUESTS);
    assert.equal(warnings.length, 1, 'one warning when the platform budget first refuses, not one per refusal');
    assert.ok(!/@|returning|early/.test(warnings[0]), `no address in the warning: ${warnings[0]}`);
    // The platform window ends, the buyer's (opened half a day later) does not.
    offset = ttl + 1_000;
    assert.equal(await statusOf(submit(controller, buyer)), 200, 'the refusals took nothing from the buyer: a third request goes');
    assert.equal(await statusOf(submit(controller, buyer)), HttpStatus.TOO_MANY_REQUESTS, 'then the buyer budget refuses');
    assert.equal(warnings.length, 1, 'a refusal of the buyer budget does not warn');
  } finally {
    Date.now = realNow;
  }
}

async function testStripeFailuresAreNotCounted() {
  const { controller, calls } = buildController();
  const stripe = (controller as any).stripeClient.getClient();
  let configured = false;
  (controller as any).stripeClient = { getClient: () => (configured ? stripe : null) };
  const { limit } = RATE_LIMITS.publicSupportInvoiceBillingEmail;
  for (let i = 0; i < limit + 2; i += 1) {
    assert.equal(await statusOf(submit(controller, VALID_BODY)), HttpStatus.INTERNAL_SERVER_ERROR, 'Stripe is not configured');
  }
  configured = true;
  const create = stripe.customers.create;
  stripe.customers.create = async () => {
    throw Object.assign(new Error('Connection to Stripe failed'), { type: 'StripeConnectionError' });
  };
  for (let i = 0; i < limit + 2; i += 1) {
    const status = await statusOf(submit(controller, VALID_BODY));
    assert.ok(status !== 200 && status !== HttpStatus.TOO_MANY_REQUESTS, `a Stripe error is no success and no 429: ${status}`);
  }
  stripe.customers.create = create;
  for (let i = 0; i < limit; i += 1) assert.equal(await statusOf(submit(controller, VALID_BODY)), 200, 'failed requests left the buyer budget whole');
  assert.equal(await statusOf(submit(controller, VALID_BODY)), HttpStatus.TOO_MANY_REQUESTS);
  assert.ok(callsOf(calls, 'invoices.sendInvoice').length >= 1);
}

async function testClosedOnPremise() {
  const { controller, calls } = buildController();
  (Features as any).SINGLE_TENANT = true;
  try {
    assert.equal(await statusOf(submit(controller, VALID_BODY)), HttpStatus.NOT_FOUND, 'single-tenant: the route does not exist');
    assert.deepEqual(calls, []);
  } finally {
    (Features as any).SINGLE_TENANT = false;
  }
}

function testBudgetValues() {
  assert.deepEqual(RATE_LIMITS.publicRequestSupportInvoice, { limit: 3, ttl: 10 * 60_000 });
  assert.deepEqual(RATE_LIMITS.publicSupportInvoiceBillingEmail, { limit: 3, ttl: 24 * 60 * 60_000 });
  assert.deepEqual(RATE_LIMITS.publicSupportInvoicePlatform, { limit: 20, ttl: 24 * 60 * 60_000 });
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
    testBudgetValues();
    await testBillingAddressBudget();
    await testPlatformBudget();
    await testRefusedRequestsAreNotCounted();
    await testClosedOnPremise();
    testBillingKeyFunction();
    await testBillingKeyIsNormalised();
    await testPlatformRefusalSparesTheBuyer();
    await testStripeFailuresAreNotCounted();
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
