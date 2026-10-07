import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { PublicController } from '../public.controller';
import { Features } from '../../config/features';
import { validateStartupEnv } from '../../common/env';

// Trial links come from the configuration: the activation link from MARKETING_BASE_URL, the new
// tenant's address from the configured application address (common/url.ts). The request host
// stands in only in development mode, on a local development host. Without a configured
// address the answer is an explicit error, before anything is saved or sent.

const ENV_KEYS = ['APP_ENV', 'NODE_ENV', 'APP_BASE_URL', 'PUBLIC_APP_URL', 'APP_URL', 'MARKETING_BASE_URL'] as const;
const MARKETING_NOT_CONFIGURED = /^marketing URL is not configured: set MARKETING_BASE_URL$/;
const APP_NOT_CONFIGURED = /^application URL is not configured: set APP_BASE_URL$/;

const PROD_CLOUD = {
  APP_ENV: 'production',
  APP_BASE_URL: 'https://kanap.net',
  APP_URL: 'https://app.kanap.net',
  MARKETING_BASE_URL: 'https://kanap.net',
};

async function withConfig(env: Record<string, string>, fn: () => Promise<void>) {
  const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const savedSingleTenant = Features.SINGLE_TENANT;
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  (Features as any).SINGLE_TENANT = false;
  try {
    await fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    (Features as any).SINGLE_TENANT = savedSingleTenant;
  }
}

function request(host: string, extraHeaders: Record<string, string> = {}) {
  return { protocol: 'http', ip: '127.0.0.1', headers: { host, ...extraHeaders } };
}

const UNKNOWN_HOST = request('other.example.test', {
  'x-forwarded-host': 'other.example.test',
  'x-forwarded-proto': 'http',
});

function signupBody(slug: string, email: string) {
  return { org: 'Acme IT', slug, email, country_iso: 'FR', captchaToken: 'captcha-token' };
}

/** A controller on fakes that records every write and every email. */
function buildController() {
  const writes: string[] = [];
  const sent: Array<{ to: string; text: string }> = [];
  const pendingSignup = {
    id: 's-1',
    slug: 'acme',
    org_name: 'Acme IT',
    email: 'owner@example.invalid',
    country_iso: 'FR',
    activated_at: null,
    expires_at: new Date(Date.now() + 60 * 60 * 1000),
  };
  const trialSignups = {
    findOne: async (options: any) => (options?.where?.token_hash ? { ...pendingSignup } : null),
    create: (row: any) => ({ ...row }),
    save: async (row: any) => {
      writes.push('trial signup');
      return row;
    },
  };
  const tenants = {
    findBySlug: async () => null,
    createTenant: async (input: any) => {
      writes.push('tenant');
      return { id: 't-1', ...input };
    },
  };
  const users = {
    createUser: async (input: any) => {
      writes.push('user');
      return { id: 'u-1', email: input.email };
    },
  };
  const companies = { create: async () => { writes.push('company'); } };
  const runnerManager = {
    query: async () => [],
    getRepository: () => ({
      update: async () => { writes.push('signup update'); },
      save: async () => { writes.push('subscription'); },
    }),
  };
  const dataSource = {
    createQueryRunner: () => {
      writes.push('query runner');
      return {
        manager: runnerManager,
        isTransactionActive: true,
        connect: async () => undefined,
        startTransaction: async () => undefined,
        commitTransaction: async () => undefined,
        rollbackTransaction: async () => undefined,
        release: async () => undefined,
        query: async () => [],
      };
    },
  };
  const emails = {
    send: async (message: { to: string; text: string }) => { sent.push(message); },
  };
  const auth = { createPasswordResetToken: async () => 'reset-token' };
  const turnstile = { verifyOrThrow: async () => undefined };
  const controller = new PublicController(
    tenants as any,
    users as any,
    companies as any,
    dataSource as any,
    emails as any,
    auth as any,
    trialSignups as any,
    {} as any,
    turnstile as any,
    {} as any,
    {} as any,
  );
  return { controller, writes, sent };
}

function activationLink(text: string): string {
  const match = /(\S+\/activate\.html#token=[0-9a-f]+)/.exec(text);
  assert.ok(match, 'the activation email carries the link');
  return match[1];
}

async function startTrialLink(env: Record<string, string>, req: any): Promise<string> {
  let link = '';
  await withConfig(env, async () => {
    const { controller, sent } = buildController();
    assert.deepEqual(await controller.startTrial(signupBody('acme', 'owner@example.invalid') as any, req), { ok: true });
    assert.equal(sent.length, 1);
    link = activationLink(sent[0].text);
  });
  return link;
}

async function rejectedStartTrial(env: Record<string, string>, req: any, body: ReturnType<typeof signupBody>) {
  let response: unknown;
  await withConfig(env, async () => {
    const { controller, writes, sent } = buildController();
    await assert.rejects(controller.startTrial(body as any, req), (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.match(error.message, MARKETING_NOT_CONFIGURED);
      response = error.getResponse();
      return true;
    });
    assert.deepEqual(writes, [], 'no sign-up is saved');
    assert.equal(sent.length, 0, 'no email is sent');
  });
  return response;
}

async function testMissingMarketingAddressIsRefused() {
  for (const env of [{}, { APP_ENV: 'qa' }, { APP_ENV: 'production', APP_BASE_URL: 'https://kanap.net' }] as Array<Record<string, string>>) {
    const first = await rejectedStartTrial(env, UNKNOWN_HOST, signupBody('acme', 'owner@example.invalid'));
    const second = await rejectedStartTrial(env, UNKNOWN_HOST, signupBody('other-co', 'someone@example.test'));
    assert.deepEqual(first, second, 'the same answer whatever was entered');
  }
}

async function testConfiguredMarketingAddress() {
  const configured = { MARKETING_BASE_URL: 'https://www.example.test/' };
  const expected = /^https:\/\/www\.example\.test\/activate\.html#token=[0-9a-f]{64}$/;
  for (const env of [configured, { ...configured, APP_ENV: 'production' }, { ...configured, APP_ENV: 'development' }]) {
    assert.match(await startTrialLink(env, UNKNOWN_HOST), expected);
    assert.match(await startTrialLink(env, request('lvh.me')), expected);
  }
}

async function testDevelopmentFollowsOnlyALocalHost() {
  assert.match(
    await startTrialLink({ APP_ENV: 'development' }, request('lvh.me')),
    /^http:\/\/lvh\.me\/activate\.html#token=[0-9a-f]{64}$/,
  );
  await rejectedStartTrial({ APP_ENV: 'development' }, UNKNOWN_HOST, signupBody('acme', 'owner@example.invalid'));
}

async function activatedTenantUrl(env: Record<string, string>, req: any): Promise<string> {
  let tenantUrl = '';
  await withConfig(env, async () => {
    const { controller } = buildController();
    const result = await controller.activateTrial({ token: 'activation-token' }, req);
    assert.equal(result.reset_token, 'reset-token');
    tenantUrl = result.tenant_url;
  });
  return tenantUrl;
}

async function testTenantAddressFromConfiguration() {
  assert.equal(await activatedTenantUrl(PROD_CLOUD, UNKNOWN_HOST), 'https://acme.kanap.net');
  assert.equal(await activatedTenantUrl(PROD_CLOUD, request('kanap.net', { 'x-forwarded-proto': 'https' })), 'https://acme.kanap.net');
  assert.equal(await activatedTenantUrl({ APP_BASE_URL: 'https://qa.kanap.net' }, UNKNOWN_HOST), 'https://acme.qa.kanap.net');
  assert.equal(await activatedTenantUrl({ APP_ENV: 'development' }, request('lvh.me')), 'http://acme.lvh.me');
}

async function testTenantAddressNotConfigured() {
  await withConfig({ MARKETING_BASE_URL: 'https://www.example.test' }, async () => {
    const { controller, writes } = buildController();
    await assert.rejects(controller.activateTrial({ token: 'activation-token' }, UNKNOWN_HOST), (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.match(error.message, APP_NOT_CONFIGURED);
      return true;
    });
    assert.deepEqual(writes, [], 'no tenant is created');
  });
}

function testStartupWarning() {
  const base = { DATABASE_URL: 'postgres://example.test/db', JWT_SECRET: 'trial-links-spec-secret', APP_BASE_URL: 'https://kanap.example.test' };
  const marketingLine = (env: Record<string, string>, singleTenant: boolean) =>
    validateStartupEnv({ ...base, CORS_ORIGINS: 'https://kanap.example.test', ...env }, { singleTenant })
      .warnings.filter((line) => line.includes('MARKETING_BASE_URL'));
  assert.equal(marketingLine({}, false).length, 1, 'multi-tenant, run mode not set');
  assert.ok(marketingLine({}, false)[0].startsWith('[CONFIG]'));
  assert.equal(marketingLine({ APP_ENV: 'production' }, false).length, 1, 'multi-tenant production');
  assert.deepEqual(marketingLine({ APP_ENV: 'production', MARKETING_BASE_URL: 'https://www.example.test' }, false), []);
  assert.deepEqual(marketingLine({ APP_ENV: 'development' }, false), [], 'development');
  assert.deepEqual(marketingLine({}, true), [], 'single-tenant has no trial sign-up');
}

async function main() {
  testStartupWarning();
  await testMissingMarketingAddressIsRefused();
  await testConfiguredMarketingAddress();
  await testDevelopmentFollowsOnlyALocalHost();
  await testTenantAddressFromConfiguration();
  await testTenantAddressNotConfigured();
  console.log('trial-links.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
