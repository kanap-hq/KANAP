import assert = require('assert');
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { Features } from '../../config/features';
import { AI_SIGNUP_CONSENT_VERSIONS, CURRENT_AI_SIGNUP_CONSENT_VERSION, aiSignupConsentLocation, consentLocationMatches } from '../ai-signup-consent';
import { PublicController, RequestSupportInvoiceDto, SendContactDto, StartTrialDto } from '../public.controller';

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

// Names and consent: optional, names trimmed (an empty name is absent), 100 characters at most.
async function testStartTrialNamesAndConsent() {
  const base = { org: 'Acme IT', slug: 'acme-it', email: 'admin@example.com', country_iso: 'FR', captchaToken: 'captcha-token' };
  const dto = plainToInstance(StartTrialDto, {
    ...base,
    first_name: '  Ada ',
    last_name: ' ',
    ai_consent: true,
    ai_consent_version: CURRENT_AI_SIGNUP_CONSENT_VERSION,
  });
  assert.deepEqual((await validate(dto, { whitelist: true })).map((error) => error.property), []);
  assert.equal(dto.first_name, 'Ada');
  assert.equal(dto.last_name, undefined, 'an empty name is absent');
  assert.equal(dto.ai_consent, true);

  const errors = await validatePayload(StartTrialDto, {
    ...base,
    first_name: 'A'.repeat(101),
    last_name: 42,
    ai_consent: 'yes',
    ai_consent_version: 20261101,
  });
  assert.deepEqual(errors.map((error) => error.property).sort(), ['ai_consent', 'ai_consent_version', 'first_name', 'last_name']);
  assert.deepEqual(
    (await validatePayload(StartTrialDto, { ...base, first_name: 'A'.repeat(100), last_name: 'Lovelace', ai_consent: false })).map((e) => e.property),
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

// The consent versions: the current one is listed, with the place its text names.
function testConsentVersions() {
  assert.ok(Object.keys(AI_SIGNUP_CONSENT_VERSIONS).includes(CURRENT_AI_SIGNUP_CONSENT_VERSION));
  assert.equal(aiSignupConsentLocation(CURRENT_AI_SIGNUP_CONSENT_VERSION), 'US');
  assert.equal(aiSignupConsentLocation('1999-01-01'), null);
  for (const place of ['US', 'usa', 'United States', 'United States of America', 'États-Unis', "États-Unis d'Amérique", ' U.S.A. ']) {
    assert.equal(consentLocationMatches(CURRENT_AI_SIGNUP_CONSENT_VERSION, place), true, place);
  }
  for (const place of ['Germany', 'EU', '', null, 'US-East']) {
    assert.equal(consentLocationMatches(CURRENT_AI_SIGNUP_CONSENT_VERSION, place), false, String(place));
  }
  assert.equal(consentLocationMatches('1999-01-01', 'US'), false);
}

// A ticked box with an unknown or missing version: 400 INVALID_CONSENT_VERSION, before the
// CAPTCHA and any write or e-mail. An unticked box ignores the version.
async function testStartTrialRefusesAnUnknownConsentVersion() {
  const calls: string[] = [];
  const controller = new PublicController(
    { findBySlug: async () => null } as any,
    {} as any, {} as any, {} as any,
    { send: async () => { calls.push('email'); } } as any,
    {} as any,
    {
      findOne: async () => null,
      create: (row: any) => ({ ...row }),
      save: async (row: any) => { calls.push('save'); return row; },
    } as any,
    { verifyOrThrow: async () => { calls.push('captcha'); } } as any,
    {} as any, {} as any, {} as any, {} as any,
  );
  const body = { org: 'Acme IT', slug: 'acme-it', email: 'admin@example.com', country_iso: 'FR', captchaToken: 'captcha-token' };
  const req = { protocol: 'https', ip: '127.0.0.1', headers: { host: 'kanap.example.test' } };
  const savedUrl = process.env.MARKETING_BASE_URL;
  const savedSingleTenant = Features.SINGLE_TENANT;
  process.env.MARKETING_BASE_URL = 'https://www.kanap.example.test';
  (Features as any).SINGLE_TENANT = false;
  try {
    for (const version of ['2025-01-01', undefined, '']) {
      await assert.rejects(controller.startTrial({ ...body, ai_consent: true, ai_consent_version: version } as any, req), (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal((error.getResponse() as any).code, 'INVALID_CONSENT_VERSION');
        return true;
      });
    }
    assert.deepEqual(calls, []);
    assert.deepEqual(await controller.startTrial({ ...body, ai_consent: false, ai_consent_version: 'any' } as any, req), { ok: true });
    assert.deepEqual(calls, ['captcha', 'save', 'email']);
  } finally {
    if (savedUrl === undefined) delete process.env.MARKETING_BASE_URL;
    else process.env.MARKETING_BASE_URL = savedUrl;
    (Features as any).SINGLE_TENANT = savedSingleTenant;
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
  await testStartTrialNamesAndConsent();
  await testStartTrialNameForm();
  testConsentVersions();
  await testStartTrialRefusesAnUnknownConsentVersion();
  await testContactAcceptsCaptchaAliases();
  await testSupportInvoiceNormalisesTheCurrentMarketingPayload();
  await testSupportInvoiceRequiresTheAddressAnIsoCountryAndTheTerms();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
