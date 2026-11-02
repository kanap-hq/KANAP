import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import dataSource from '../../data-source';
import { Features } from '../../config/features';
import { buildServices, cleanupTenants, inTenant, runSpecs, Services } from '../../admin/tenants/__tests__/tenant-reset-test-helpers';
import { PublicController, StartTrialDto } from '../public.controller';
import { TrialSignup } from '../trial-signup.entity';

// Trial sign-up with first and last name, through the real controller on the spec database.
// The CAPTCHA, the e-mails and the sample data load are doubles.
// - names given: the sign-up keeps them, the activation e-mail greets by the first name, the
//   Administrator created at activation carries them, and no `ai_settings` row is written;
// - an old form without the names: sign-up and activation as before;
// - a new sign-up of the same slug without the names clears them;
// - an old form that still sends `ai_consent`: the validation pipe drops the field, the sign-up
//   goes through and Plaid stays off.
// @database-spec: opens the data-source, so run-ci-tests.js runs it on a database lane.

const CLIENT_IP = '203.0.113.7';

type Harness = {
  controller: PublicController;
  sent: Array<{ to: string; text: string }>;
};

function harness(svc: Services): Harness {
  const sent: Harness['sent'] = [];
  const controller = new PublicController(
    svc.tenants, svc.users, svc.baseline, dataSource,
    { send: async (message: { to: string; text: string }) => { sent.push(message); } } as any,
    svc.auth, dataSource.getRepository(TrialSignup),
    { verifyOrThrow: async () => undefined } as any,
    {} as any, {} as any,
    { provisionTrialSampleData: async () => undefined } as any,
  );
  return { controller, sent };
}

async function withConfig<T>(fn: () => Promise<T>): Promise<T> {
  const saved = { app: process.env.APP_BASE_URL, marketing: process.env.MARKETING_BASE_URL };
  const savedSingleTenant = Features.SINGLE_TENANT;
  process.env.APP_BASE_URL = 'https://kanap.example.test';
  process.env.MARKETING_BASE_URL = 'https://www.kanap.example.test';
  (Features as any).SINGLE_TENANT = false;
  try {
    return await fn();
  } finally {
    if (saved.app === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = saved.app;
    if (saved.marketing === undefined) delete process.env.MARKETING_BASE_URL;
    else process.env.MARKETING_BASE_URL = saved.marketing;
    (Features as any).SINGLE_TENANT = savedSingleTenant;
  }
}

const REQUEST = { protocol: 'https', ip: CLIENT_IP, headers: { host: 'kanap.example.test' } };

function newSlug() {
  return `rs-tn-${randomUUID().slice(0, 8)}`;
}

function signupBody(slug: string, extra: Record<string, unknown> = {}) {
  return { org: 'Names Org', slug, email: `owner-${slug}@reset-spec.test`, country_iso: 'FR', captchaToken: 'captcha', ...extra };
}

/** Signs up through the controller; answers the activation token taken from the e-mail. */
async function signUp(h: Harness, body: Record<string, unknown>): Promise<string> {
  const before = h.sent.length;
  assert.deepEqual(await withConfig(() => h.controller.startTrial(body as any, REQUEST)), { ok: true });
  assert.equal(h.sent.length, before + 1, 'one activation e-mail');
  const match = /activate\.html#token=([0-9a-f]+)/.exec(h.sent[h.sent.length - 1].text);
  assert.ok(match, 'the e-mail carries the activation link');
  return match[1];
}

async function activate(h: Harness, token: string, slug: string) {
  await withConfig(() => h.controller.activateTrial({ token }, REQUEST));
  const [tenant] = await dataSource.query(`SELECT id FROM tenants WHERE slug = $1 AND deleted_at IS NULL`, [slug]);
  const [owner] = await inTenant(tenant.id, (m) => m.query(
    `SELECT id, first_name, last_name FROM users WHERE tenant_id = $1 AND email = $2`, [tenant.id, `owner-${slug}@reset-spec.test`]));
  return { tenantId: tenant.id as string, owner: owner as { id: string; first_name: string | null; last_name: string | null } };
}

async function signupRow(slug: string) {
  const [row] = await dataSource.query(
    `SELECT first_name, last_name FROM trial_signups WHERE slug = $1`, [slug]);
  return row;
}

async function settingsRows(tenantId: string) {
  return inTenant(tenantId, (m) => m.query(
    `SELECT id FROM ai_settings WHERE tenant_id = $1`, [tenantId]));
}

async function cleanup(slugs: string[]) {
  const rows = await dataSource.query(`SELECT id FROM tenants WHERE slug = ANY($1)`, [slugs]);
  await cleanupTenants(rows.map((row: { id: string }) => row.id));
  await dataSource.query(`DELETE FROM trial_signups WHERE slug = ANY($1)`, [slugs]);
}

// Names given: the sign-up keeps them, the e-mail greets by the first name, the workspace
// opens with an administrator named and no `ai_settings` row.
async function testNamesReachTheAdministrator() {
  const svc = buildServices();
  const h = harness(svc);
  const slug = newSlug();
  try {
    const token = await signUp(h, signupBody(slug, { first_name: ' Ada ', last_name: 'Lovelace' }));
    assert.match(h.sent[0].text, /Ada/, 'the e-mail greets by the first name');
    const signup = await signupRow(slug);
    assert.equal(signup.first_name, 'Ada');
    assert.equal(signup.last_name, 'Lovelace');
    const { tenantId, owner } = await activate(h, token, slug);
    assert.equal(owner.first_name, 'Ada');
    assert.equal(owner.last_name, 'Lovelace');
    assert.deepEqual(await settingsRows(tenantId), [], 'no ai_settings row: Plaid stays off');
  } finally {
    await cleanup([slug]);
  }
}

// An old form (no names): sign-up and activation as before.
async function testOldForm() {
  const svc = buildServices();
  const h = harness(svc);
  const slug = newSlug();
  try {
    const token = await signUp(h, signupBody(slug));
    const signup = await signupRow(slug);
    assert.deepEqual([signup.first_name, signup.last_name], [null, null]);
    const { tenantId, owner } = await activate(h, token, slug);
    assert.equal(owner.first_name, null);
    assert.equal(owner.last_name, null);
    assert.deepEqual(await settingsRows(tenantId), []);
  } finally {
    await cleanup([slug]);
  }
}

// A new sign-up of the same slug without the names clears the names of the earlier one.
async function testSignUpAgainClearsNames() {
  const svc = buildServices();
  const h = harness(svc);
  const slug = newSlug();
  try {
    await signUp(h, signupBody(slug, { first_name: 'Ada', last_name: 'Lovelace' }));
    assert.equal((await signupRow(slug)).first_name, 'Ada');
    const token = await signUp(h, signupBody(slug));
    const signup = await signupRow(slug);
    assert.deepEqual([signup.first_name, signup.last_name], [null, null]);
    const { owner } = await activate(h, token, slug);
    assert.deepEqual([owner.first_name, owner.last_name], [null, null]);
  } finally {
    await cleanup([slug]);
  }
}

// An old form that still sends the consent box: the application's validation pipe
// (whitelist) drops the field; the sign-up and the activation go through, Plaid stays off.
async function testOldConsentFieldIsIgnored() {
  const svc = buildServices();
  const h = harness(svc);
  const slug = newSlug();
  try {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const body = await pipe.transform(
      signupBody(slug, { first_name: 'Grace', ai_consent: true, ai_consent_version: '2026-11-01' }),
      { type: 'body', metatype: StartTrialDto },
    );
    assert.equal('ai_consent' in body, false, 'the pipe drops ai_consent');
    assert.equal('ai_consent_version' in body, false, 'the pipe drops ai_consent_version');
    const token = await signUp(h, body);
    const { tenantId, owner } = await activate(h, token, slug);
    assert.equal(owner.first_name, 'Grace');
    assert.deepEqual(await settingsRows(tenantId), [], 'Plaid stays off');
  } finally {
    await cleanup([slug]);
  }
}

runSpecs('trial-signup-names.integration.spec', [
  testNamesReachTheAdministrator,
  testOldForm,
  testSignUpAgainClearsNames,
  testOldConsentFieldIsIgnored,
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
