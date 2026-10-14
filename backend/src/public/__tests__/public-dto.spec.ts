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
  await testContactAcceptsCaptchaAliases();
  await testSupportInvoiceNormalisesTheCurrentMarketingPayload();
  await testSupportInvoiceRequiresTheAddressAnIsoCountryAndTheTerms();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
