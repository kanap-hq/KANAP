import assert = require('assert');
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RequestSupportInvoiceDto, SendContactDto, StartTrialDto } from '../public.controller';

async function validatePayload<T extends object>(cls: new () => T, payload: Record<string, unknown>) {
  return validate(plainToInstance(cls, payload), { whitelist: true });
}

async function testStartTrialAcceptsCurrentMarketingPayload() {
  const errors = await validatePayload(StartTrialDto, {
    org: 'Acme IT',
    slug: 'acme-it',
    email: 'admin@example.com',
    country_iso: 'OTHER',
    captchaToken: 'captcha-token',
  });

  assert.deepEqual(errors.map((error) => error.property), []);
}

async function testStartTrialAcceptsLegacyMarketingAliases() {
  const errors = await validatePayload(StartTrialDto, {
    org_name: 'Acme IT',
    slug: 'acme-it',
    email: 'admin@example.com',
    country_iso: 'FR',
    captcha_token: 'captcha-token',
  });

  assert.deepEqual(errors.map((error) => error.property), []);
}

// Names: optional, names trimmed (an empty name is absent), 100 characters at most.
async function testStartTrialNames() {
  const base = { org: 'Acme IT', slug: 'acme-it', email: 'admin@example.com', country_iso: 'FR', captchaToken: 'captcha-token' };
  const dto = plainToInstance(StartTrialDto, {
    ...base,
    first_name: '  Ada ',
    last_name: ' ',
  });
  assert.deepEqual((await validate(dto, { whitelist: true })).map((error) => error.property), []);
  assert.equal(dto.first_name, 'Ada');
  assert.equal(dto.last_name, undefined, 'an empty name is absent');

  const errors = await validatePayload(StartTrialDto, {
    ...base,
    first_name: 'A'.repeat(101),
    last_name: 42,
  });
  assert.deepEqual(errors.map((error) => error.property).sort(), ['first_name', 'last_name']);
  assert.deepEqual(
    (await validatePayload(StartTrialDto, { ...base, first_name: 'A'.repeat(100), last_name: 'Lovelace' })).map((e) => e.property),
    [],
  );
}

// The names take the form of a person name only: the first name greets the person in the
// activation e-mail, sent to any address.
async function testStartTrialNameForm() {
  const base = { org: 'Acme IT', slug: 'acme-it', email: 'admin@example.com', country_iso: 'FR', captchaToken: 'captcha-token' };
  for (const name of ['Jean-Luc', "O'Brien", 'Zoë', 'María José', 'Ngozi', 'D’Angelo', 'J. R.', '  Ada ']) {
    const errors = await validatePayload(StartTrialDto, { ...base, first_name: name, last_name: name });
    assert.deepEqual(errors.map((error) => error.property), [], `accepted: ${JSON.stringify(name)}`);
  }
  for (const name of ['www.example.com', 'http://x', 'a\nb', 'a\tb', 'Jean  Luc', '123', 'Ada1', 'ada@example', 'a/b', 'a:b']) {
    const errors = await validatePayload(StartTrialDto, { ...base, first_name: name, last_name: name });
    assert.deepEqual(errors.map((error) => error.property).sort(), ['first_name', 'last_name'], `refused: ${JSON.stringify(name)}`);
  }
}

async function testContactAcceptsCaptchaAliases() {
  for (const captchaField of ['captchaToken', 'captcha_token']) {
    const errors = await validatePayload(SendContactDto, {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      company: 'Acme IT',
      message: 'Please contact me about KANAP.',
      [captchaField]: 'captcha-token',
    });

    assert.deepEqual(errors.map((error) => error.property), []);
  }
}

const SUPPORT_INVOICE_PAYLOAD = {
  company_name: 'Acme IT',
  contact_name: 'Ada Lovelace',
  billing_email: ' Billing@Example.com ',
  address_line1: '1 rue de la Paix',
  postal_code: '75002',
  city: 'Paris',
  country: ' fr ',
  vat_id: 'FR40303265045',
  terms_version: '2026-10-12',
  captchaToken: 'captcha-token',
};

async function testSupportInvoiceNormalisesTheCurrentMarketingPayload() {
  const dto = plainToInstance(RequestSupportInvoiceDto, SUPPORT_INVOICE_PAYLOAD);
  const errors = await validate(dto, { whitelist: true });
  assert.deepEqual(errors.map((error) => error.property), []);
  assert.equal(dto.country, 'FR');
  assert.equal(dto.billing_email, 'billing@example.com');
}

async function testSupportInvoiceRequiresTheAddressAnIsoCountryAndTheTerms() {
  const errors = await validatePayload(RequestSupportInvoiceDto, {
    ...SUPPORT_INVOICE_PAYLOAD,
    address_line1: ' ',
    postal_code: undefined,
    city: '',
    country: 'FRANCE',
    terms_version: undefined,
  });
  assert.deepEqual(
    errors.map((error) => error.property).sort(),
    ['address_line1', 'city', 'country', 'postal_code', 'terms_version'],
  );
}

async function main() {
  await testStartTrialAcceptsCurrentMarketingPayload();
  await testStartTrialAcceptsLegacyMarketingAliases();
  await testStartTrialNames();
  await testStartTrialNameForm();
  await testContactAcceptsCaptchaAliases();
  await testSupportInvoiceNormalisesTheCurrentMarketingPayload();
  await testSupportInvoiceRequiresTheAddressAnIsoCountryAndTheTerms();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
