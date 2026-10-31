import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import dataSource from '../../data-source';
import { Features } from '../../config/features';
import { buildServices, cleanupTenants, inTenant, runSpecs, Services } from '../../admin/tenants/__tests__/tenant-reset-test-helpers';
import { AiModelConfig } from '../../ai/ai-model-config.entity';
import { AiModelResolverService } from '../../ai/ai-model-resolver.service';
import { AiSettings } from '../../ai/ai-settings.entity';
import { AiSettingsService } from '../../ai/ai-settings.service';
import { AiAgentDefinition } from '../../ai/control-plane/entities/ai-agent-definition.entity';
import { BuiltinRuntimeSnapshot } from '../../ai/platform/platform-ai-config.service';
import { CURRENT_AI_SIGNUP_CONSENT_VERSION } from '../ai-signup-consent';
import { PublicController } from '../public.controller';
import { TrialSignup } from '../trial-signup.entity';

// Trial sign-up with first name, last name and the consent box to the included model of Plaid,
// through the real controller, AiSettingsService and AiModelResolverService on the spec
// database. The platform's included model, the CAPTCHA, the e-mails and the sample data load
// are doubles.
// - box ticked: the sign-up keeps the consent (version, moment, request address); the
//   activation opens the workspace with Plaid on and the included model confirmed by the owner;
// - box ticked, no included model on the platform: consent kept, Plaid off;
// - box not ticked, or an old form without the new fields: no `ai_settings` row, as before;
// - unknown version: 400 INVALID_CONSENT_VERSION before the CAPTCHA, nothing written or sent;
// - a new sign-up of the same slug without the box clears the earlier consent.
// @database-spec: opens the data-source, so run-ci-tests.js runs it on a database lane.

const KEY_US = 'anthropic||Anthropic|US';
const CLIENT_IP = '203.0.113.7';

function builtinRuntime(): BuiltinRuntimeSnapshot {
  return {
    identity: { name: 'Anthropic', location: 'US', key: KEY_US },
    provider: 'anthropic',
    model: 'claude-included-1',
    endpointUrl: null,
    apiKey: null,
    hasApiKey: true,
    rateLimits: { tenantPerMinute: 30, userPerHour: 60 },
  };
}

type Harness = {
  controller: PublicController;
  resolver: AiModelResolverService;
  platform: { runtime: BuiltinRuntimeSnapshot | null };
  sent: Array<{ to: string; text: string }>;
  captcha: string[];
  warnings: string[];
};

function harness(svc: Services): Harness {
  const platform: Harness['platform'] = { runtime: builtinRuntime() };
  const platformService = { getBuiltinRuntime: async () => platform.runtime } as any;
  const providerRegistry = { get: () => undefined, validate: () => [] } as any;
  const cipher = { canEncrypt: () => false, encrypt: (value: string) => value, decrypt: (value: string) => value } as any;
  const repo = dataSource.getRepository.bind(dataSource);
  const resolver = new AiModelResolverService(
    repo(AiModelConfig), repo(AiSettings), repo(AiAgentDefinition), platformService, providerRegistry, cipher,
  );
  const aiSettings = new AiSettingsService(repo(AiSettings), providerRegistry, cipher, platformService, resolver, svc.audit);
  const warnings: string[] = [];
  (aiSettings as any).logger = { warn: (message: unknown) => { warnings.push(String(message)); }, log: () => undefined };
  const sent: Harness['sent'] = [];
  const captcha: string[] = [];
  const controller = new PublicController(
    svc.tenants, svc.users, svc.baseline, dataSource,
    { send: async (message: { to: string; text: string }) => { sent.push(message); } } as any,
    svc.auth, repo(TrialSignup),
    { verifyOrThrow: async () => { captcha.push('verified'); } } as any,
    {} as any, {} as any,
    { provisionTrialSampleData: async () => undefined } as any,
    aiSettings,
  );
  return { controller, resolver, platform, sent, captcha, warnings };
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
  return `rs-cs-${randomUUID().slice(0, 8)}`;
}

function signupBody(slug: string, extra: Record<string, unknown> = {}) {
  return { org: 'Consent Org', slug, email: `owner-${slug}@reset-spec.test`, country_iso: 'FR', captchaToken: 'captcha', ...extra };
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
    `SELECT first_name, last_name, ai_consent_version, ai_consent_at, ai_consent_ip FROM trial_signups WHERE slug = $1`, [slug]);
  return row;
}

async function settingsRows(tenantId: string) {
  return inTenant(tenantId, (m) => m.query(
    `SELECT id, chat_enabled, builtin_accepted_key, builtin_accepted_at, builtin_accepted_by,
            signup_consent_version, signup_consent_at, signup_consent_ip
       FROM ai_settings WHERE tenant_id = $1`, [tenantId]));
}

async function cleanup(slugs: string[]) {
  const rows = await dataSource.query(`SELECT id FROM tenants WHERE slug = ANY($1)`, [slugs]);
  await cleanupTenants(rows.map((row: { id: string }) => row.id));
  await dataSource.query(`DELETE FROM trial_signups WHERE slug = ANY($1)`, [slugs]);
}

// Names and box ticked: the sign-up keeps both; the workspace opens with an administrator
// named, Plaid on and the included model confirmed by that administrator, with an audit entry.
async function testConsentTurnsPlaidOn() {
  const svc = buildServices();
  const h = harness(svc);
  const slug = newSlug();
  try {
    const token = await signUp(h, signupBody(slug, {
      first_name: 'Ada', last_name: 'Lovelace', ai_consent: true, ai_consent_version: CURRENT_AI_SIGNUP_CONSENT_VERSION,
    }));
    assert.match(h.sent[0].text, /Ada/, 'the e-mail greets by the first name');
    const signup = await signupRow(slug);
    assert.equal(signup.first_name, 'Ada');
    assert.equal(signup.last_name, 'Lovelace');
    assert.equal(signup.ai_consent_version, CURRENT_AI_SIGNUP_CONSENT_VERSION);
    assert.ok(signup.ai_consent_at instanceof Date);
    assert.equal(signup.ai_consent_ip, CLIENT_IP);

    const { tenantId, owner } = await activate(h, token, slug);
    assert.equal(owner.first_name, 'Ada');
    assert.equal(owner.last_name, 'Lovelace');
    const rows = await settingsRows(tenantId);
    assert.equal(rows.length, 1);
    const [settings] = rows;
    assert.equal(settings.chat_enabled, true);
    assert.equal(settings.builtin_accepted_key, KEY_US);
    assert.equal(settings.builtin_accepted_by, owner.id);
    assert.equal(settings.builtin_accepted_at.getTime(), signup.ai_consent_at.getTime());
    assert.equal(settings.signup_consent_version, CURRENT_AI_SIGNUP_CONSENT_VERSION);
    assert.equal(settings.signup_consent_at.getTime(), signup.ai_consent_at.getTime());
    assert.equal(settings.signup_consent_ip, CLIENT_IP);

    const readiness = await inTenant(tenantId, (m) => h.resolver.readiness(tenantId, null, m));
    assert.deepEqual(readiness.errors, [], 'the included model resolves as confirmed');
    assert.equal(readiness.usesBuiltin, true);

    const audits = await inTenant(tenantId, (m) => m.query(
      `SELECT action, user_id, source, source_ref, after_json FROM audit_log WHERE tenant_id = $1 AND table_name = 'ai_settings'`,
      [tenantId]));
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'create');
    assert.equal(audits[0].user_id, owner.id);
    assert.equal(audits[0].source, 'system');
    assert.equal(audits[0].after_json.chat_enabled, true);
    assert.equal(audits[0].after_json.signup_consent_version, CURRENT_AI_SIGNUP_CONSENT_VERSION);
  } finally {
    await cleanup([slug]);
  }
}

// Box ticked, no included model on the platform: the consent is kept, Plaid stays off, one warning.
async function testConsentWithoutIncludedModel() {
  const svc = buildServices();
  const h = harness(svc);
  h.platform.runtime = null;
  const slug = newSlug();
  try {
    const token = await signUp(h, signupBody(slug, { ai_consent: true, ai_consent_version: CURRENT_AI_SIGNUP_CONSENT_VERSION }));
    const { tenantId } = await activate(h, token, slug);
    const [settings] = await settingsRows(tenantId);
    assert.equal(settings.chat_enabled, false);
    assert.equal(settings.builtin_accepted_key, null);
    assert.equal(settings.builtin_accepted_by, null);
    assert.equal(settings.signup_consent_version, CURRENT_AI_SIGNUP_CONSENT_VERSION);
    assert.equal(settings.signup_consent_ip, CLIENT_IP);
    assert.equal(h.warnings.length, 1);
    assert.match(h.warnings[0], new RegExp(tenantId));
  } finally {
    await cleanup([slug]);
  }
}

// Box not ticked (names given): the names reach the administrator, no `ai_settings` row.
async function testNoConsent() {
  const svc = buildServices();
  const h = harness(svc);
  const slug = newSlug();
  try {
    const token = await signUp(h, signupBody(slug, { first_name: ' Grace ', last_name: 'Hopper', ai_consent: false }));
    const signup = await signupRow(slug);
    assert.equal(signup.ai_consent_version, null);
    assert.equal(signup.ai_consent_at, null);
    assert.equal(signup.ai_consent_ip, null);
    const { tenantId, owner } = await activate(h, token, slug);
    assert.equal(owner.first_name, 'Grace');
    assert.equal(owner.last_name, 'Hopper');
    assert.deepEqual(await settingsRows(tenantId), [], 'no ai_settings row, as before');
  } finally {
    await cleanup([slug]);
  }
}

// Ticked with an unknown version: 400 before the CAPTCHA; nothing written, nothing sent.
async function testUnknownVersion() {
  const svc = buildServices();
  const h = harness(svc);
  const slug = newSlug();
  try {
    for (const version of ['1999-01-01', undefined]) {
      await assert.rejects(
        withConfig(() => h.controller.startTrial(signupBody(slug, { ai_consent: true, ai_consent_version: version }) as any, REQUEST)),
        (error: unknown) => {
          assert.ok(error instanceof BadRequestException);
          assert.equal((error.getResponse() as any).code, 'INVALID_CONSENT_VERSION');
          return true;
        },
      );
    }
    assert.deepEqual(h.captcha, [], 'the CAPTCHA token is not spent');
    assert.equal(h.sent.length, 0, 'no e-mail');
    assert.equal(await signupRow(slug), undefined, 'no sign-up row');
  } finally {
    await cleanup([slug]);
  }
}

// An old form (none of the new fields): sign-up and activation as before, no names.
async function testOldForm() {
  const svc = buildServices();
  const h = harness(svc);
  const slug = newSlug();
  try {
    const token = await signUp(h, signupBody(slug));
    const signup = await signupRow(slug);
    assert.deepEqual(
      [signup.first_name, signup.last_name, signup.ai_consent_version, signup.ai_consent_at, signup.ai_consent_ip],
      [null, null, null, null, null],
    );
    const { tenantId, owner } = await activate(h, token, slug);
    assert.equal(owner.first_name, null);
    assert.equal(owner.last_name, null);
    assert.deepEqual(await settingsRows(tenantId), []);
  } finally {
    await cleanup([slug]);
  }
}

// A new sign-up of the same slug without the box clears the consent of the earlier one.
async function testSignUpAgainClearsConsent() {
  const svc = buildServices();
  const h = harness(svc);
  const slug = newSlug();
  try {
    await signUp(h, signupBody(slug, { first_name: 'Ada', ai_consent: true, ai_consent_version: CURRENT_AI_SIGNUP_CONSENT_VERSION }));
    assert.equal((await signupRow(slug)).ai_consent_version, CURRENT_AI_SIGNUP_CONSENT_VERSION);
    const token = await signUp(h, signupBody(slug));
    const signup = await signupRow(slug);
    assert.deepEqual(
      [signup.first_name, signup.ai_consent_version, signup.ai_consent_at, signup.ai_consent_ip],
      [null, null, null, null],
    );
    const { tenantId } = await activate(h, token, slug);
    assert.deepEqual(await settingsRows(tenantId), [], 'Plaid stays off');
  } finally {
    await cleanup([slug]);
  }
}

runSpecs('trial-signup-consent.integration.spec', [
  testConsentTurnsPlaidOn,
  testConsentWithoutIncludedModel,
  testNoConsent,
  testUnknownVersion,
  testOldForm,
  testSignUpAgainClearsConsent,
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
