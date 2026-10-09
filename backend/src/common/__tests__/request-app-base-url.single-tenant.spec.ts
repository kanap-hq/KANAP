import * as assert from 'node:assert/strict';
import type * as UrlModule from '../url';
import type * as AuthControllerModule from '../../auth/auth.controller';
import type * as UsersControllerModule from '../../users/users.controller';
import type * as UsersServiceModule from '../../users/users.service';
import type * as FeaturesModule from '../../config/features';

// Single-tenant (on-premise): every request carries the one tenant
// (`req.tenant = { slug: 'default' }`), and e-mail links open APP_BASE_URL as
// configured, never an address derived from the tenant slug.
// `Features` reads DEPLOYMENT_MODE once, when it is first imported: the
// modules are loaded below, after the mode is set.

const ENV_KEYS = ['DEPLOYMENT_MODE', 'APP_ENV', 'NODE_ENV', 'APP_BASE_URL', 'PUBLIC_APP_URL', 'APP_URL', 'MARKETING_BASE_URL'] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
process.env.DEPLOYMENT_MODE = 'single-tenant';

const { resolveAppBaseUrl } = require('../url') as typeof UrlModule;
const { Features } = require('../../config/features') as typeof FeaturesModule;
const { AuthController } = require('../../auth/auth.controller') as typeof AuthControllerModule;
const { UsersController } = require('../../users/users.controller') as typeof UsersControllerModule;
const { UsersService } = require('../../users/users.service') as typeof UsersServiceModule;

async function withEnv(env: Record<string, string>, fn: () => void | Promise<void>) {
  const before = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) if (key !== 'DEPLOYMENT_MODE') delete process.env[key];
  Object.assign(process.env, env);
  try {
    await fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

const onPremRequest = (host: string) => ({ tenant: { id: undefined, slug: 'default', name: 'Default' }, headers: { host } });

async function testModeIsSingleTenant() {
  assert.equal(Features.SINGLE_TENANT, true, 'the modules were loaded in single-tenant mode');
}

async function testProductionUsesTheConfiguredAddress() {
  await withEnv({ NODE_ENV: 'production', APP_BASE_URL: 'https://app.acme-corp.com' }, () => {
    assert.equal(resolveAppBaseUrl(onPremRequest('app.acme-corp.com')), 'https://app.acme-corp.com');
  });
  await withEnv({ NODE_ENV: 'production', APP_BASE_URL: 'https://kanap.acme-corp.com' }, () => {
    assert.equal(resolveAppBaseUrl(onPremRequest('kanap.acme-corp.com')), 'https://kanap.acme-corp.com');
  });
}

// Outside production the configured address is kept too; development mode follows only a
// local development host.
async function testNonProductionUsesTheConfiguredAddress() {
  await withEnv({ NODE_ENV: 'development', APP_BASE_URL: 'https://app.acme-corp.com' }, () => {
    assert.equal(resolveAppBaseUrl(onPremRequest('app.acme-corp.com')), 'https://app.acme-corp.com', 'host app.acme-corp.com');
    assert.equal(resolveAppBaseUrl(onPremRequest('kanap.local')), 'https://app.acme-corp.com', 'host kanap.local');
    assert.equal(resolveAppBaseUrl(onPremRequest('localhost')), 'http://localhost', 'host localhost');
  });
  await withEnv({ APP_BASE_URL: 'https://app.acme-corp.com' }, () => {
    for (const host of ['kanap.local', 'localhost']) {
      assert.equal(resolveAppBaseUrl(onPremRequest(host)), 'https://app.acme-corp.com', `run mode not set, host ${host}`);
    }
  });
}

async function testPasswordResetLink() {
  await withEnv({ NODE_ENV: 'production', APP_BASE_URL: 'https://app.acme-corp.com' }, async () => {
    const savedEmail = Features.EMAIL_ENABLED;
    (Features as any).EMAIL_ENABLED = true;
    try {
      const sent: any[] = [];
      const auth = { createPasswordResetToken: async () => 'reset-token', getPasswordResetExpirationMinutes: () => 60 };
      const users = { findByEmail: async (email: string) => ({ id: 'u-1', email, locale: 'en', external_auth_provider: null }) };
      const emails = { sendPasswordResetEmail: async (params: any) => { sent.push(params); } };
      const controller = new AuthController(
        auth as any, users as any, {} as any, {} as any, emails as any, {} as any, {} as any, {} as any,
        { recordAuthEvent: async () => undefined } as any,
      );
      await controller.requestPasswordReset({ email: 'user@example.invalid' }, onPremRequest('app.acme-corp.com'));
      assert.equal(sent.length, 1);
      assert.equal(sent[0].resetUrl, 'https://app.acme-corp.com/reset-password#token=reset-token');
    } finally {
      (Features as any).EMAIL_ENABLED = savedEmail;
    }
  });
}

async function testInviteLink() {
  await withEnv({ NODE_ENV: 'production', APP_BASE_URL: 'https://app.acme-corp.com' }, async () => {
    const savedEmail = Features.EMAIL_ENABLED;
    (Features as any).EMAIL_ENABLED = true;
    process.env.JWT_SECRET ??= 'invite-link-single-tenant-spec-secret';
    try {
      const sent: any[] = [];
      const user = {
        id: 'u-1', email: 'new.user@example.invalid', tenant_id: 't-1', status: 'disabled', locale: 'en',
        role: { role_name: 'Reader' }, external_auth_provider: null,
      };
      const repo = { findOne: async () => ({ ...user }), save: async (row: any) => row, manager: {} };
      const tokens = { create: (row: any) => row, save: async () => undefined };
      const manager: any = { getRepository: (entity: { name?: string }) => (entity?.name === 'User' ? repo : tokens) };
      const email = { sendUserInviteEmail: async (params: any) => { sent.push(params); } };
      const service = new UsersService(repo as any, {} as any, {} as any, {} as any, {} as any, email as any, { log: async () => undefined } as any);
      const controller = new UsersController(service, {} as any, {} as any, {} as any, {} as any, {} as any);
      await controller.invite('u-1', { ...onPremRequest('app.acme-corp.com'), user: { sub: 'admin-1' }, queryRunner: {
        manager, isReleased: false, isTransactionActive: false, release: async () => undefined,
      } });
      assert.equal(sent.length, 1);
      assert.match(sent[0].inviteUrl, /^https:\/\/app\.acme-corp\.com\/accept-invite#token=[^/]+$/);
    } finally {
      (Features as any).EMAIL_ENABLED = savedEmail;
    }
  });
}

async function main() {
  try {
    await testModeIsSingleTenant();
    await testProductionUsesTheConfiguredAddress();
    await testNonProductionUsesTheConfiguredAddress();
    await testPasswordResetLink();
    await testInviteLink();
  } finally {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
  console.log('request-app-base-url.single-tenant.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
