import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { UsersController } from '../users.controller';
import { UsersService } from '../users.service';
import { Features } from '../../config/features';

// The invitation e-mail links to the tenant address of the request
// (`https://<slug>.kanap.net`), and the service never falls back to the
// configured marketing address.

const ENV_KEYS = ['APP_ENV', 'NODE_ENV', 'APP_BASE_URL', 'PUBLIC_APP_URL', 'APP_URL', 'MARKETING_BASE_URL'] as const;

async function withProductionCloud(fn: () => Promise<void>) {
  const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const savedFeatures = { SINGLE_TENANT: Features.SINGLE_TENANT, EMAIL_ENABLED: Features.EMAIL_ENABLED };
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, {
    APP_ENV: 'production',
    APP_BASE_URL: 'https://kanap.net',
    APP_URL: 'https://app.kanap.net',
    MARKETING_BASE_URL: 'https://kanap.net',
  });
  (Features as any).SINGLE_TENANT = false;
  (Features as any).EMAIL_ENABLED = true;
  try {
    await fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    Object.assign(Features as any, savedFeatures);
  }
}

async function testControllerPassesTheTenantAddress() {
  await withProductionCloud(async () => {
    const calls: any[] = [];
    const svc = {
      inviteUser: async (id: string, actorId: string | null, baseUrl: string) => {
        calls.push({ id, actorId, baseUrl });
        return { id, status: 'invited' };
      },
    };
    const controller = new UsersController(svc as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    await controller.invite('u-1', { tenant: { slug: 'acme' }, headers: { host: 'acme.kanap.net' }, user: { sub: 'admin-1' } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].baseUrl, 'https://acme.kanap.net');
  });
}

function buildInviteService() {
  const sent: any[] = [];
  const user = {
    id: 'u-1', email: 'new.user@example.invalid', tenant_id: 't-1', status: 'disabled', locale: 'en',
    role: { role_name: 'Reader' }, external_auth_provider: null,
  };
  const repo = { findOne: async () => ({ ...user }), save: async (row: any) => row, manager: {} };
  const tokens = { create: (row: any) => row, save: async () => undefined };
  const manager: any = { getRepository: (entity: { name?: string }) => (entity?.name === 'User' ? repo : tokens) };
  const email = { sendUserInviteEmail: async (params: any) => { sent.push(params); } };
  const audit = { log: async () => undefined };
  const service = new UsersService(repo as any, {} as any, {} as any, {} as any, {} as any, email as any, audit as any);
  process.env.JWT_SECRET ??= 'invite-link-spec-secret';
  return { service, manager, sent };
}

async function testInvitationLinkOpensTheTenantAddress() {
  await withProductionCloud(async () => {
    const { service, manager, sent } = buildInviteService();
    const controller = new UsersController(service, {} as any, {} as any, {} as any, {} as any, {} as any);
    await controller.invite('u-1', {
      tenant: { slug: 'acme' },
      headers: { host: 'acme.kanap.net' },
      user: { sub: 'admin-1' },
      queryRunner: { manager, isReleased: false, isTransactionActive: false, release: async () => undefined },
    });
    assert.equal(sent.length, 1);
    assert.match(sent[0].inviteUrl, /^https:\/\/acme\.kanap\.net\/accept-invite#token=[^/]+$/);
  });
}

async function testServiceRequiresABaseUrl() {
  await withProductionCloud(async () => {
    const { service, manager, sent } = buildInviteService();

    await assert.rejects(
      service.inviteUser('u-1', 'admin-1', undefined, { manager }),
      /application URL is not configured/,
    );
    assert.equal(sent.length, 0, 'no e-mail goes out without a base URL');
  });
}

async function main() {
  await testControllerPassesTheTenantAddress();
  await testInvitationLinkOpensTheTenantAddress();
  await testServiceRequiresABaseUrl();
  console.log('users.invite-link.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
