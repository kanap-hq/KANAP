import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { BadRequestException } from '@nestjs/common';
import { UsersService } from '../users.service';
import { UsersController } from '../users.controller';
import { AuthService } from '../../auth/auth.service';
import { Features } from '../../config/features';
import { getInviteLinkExpirationMinutes, getPasswordResetExpirationMinutes } from '../../auth/password-reset.util';

/**
 * An invitation is a password link valid 7 days (`INVITE_LINK_TTL`), apart from the 1 hour reset
 * link (`PASSWORD_RESET_TTL`). In a workspace with Microsoft Entra sign-in the administrator may
 * invite with Microsoft instead: an e-mail with no link and no password, the account "invited"
 * until its first sign-in. An account already linked to Entra gets no invitation either way.
 */

process.env.JWT_SECRET ??= 'invite-sign-in-spec-secret-of-32-characters';
delete process.env.INVITE_LINK_TTL;
delete process.env.PASSWORD_RESET_TTL;

const DAY_S = 24 * 60 * 60;
const ENTRA_TENANT = { id: 't-1', sso_provider: 'entra', sso_enabled: true, entra_tenant_id: 'entra-1' };
const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

function buildInviteService(opts: {
  user?: Record<string, unknown>;
  tenant?: Record<string, unknown> | null;
} = {}) {
  const invitee: any = {
    id: 'u-1', email: 'julie.martin@example.invalid', first_name: 'Julie', last_name: 'Martin',
    tenant_id: 't-1', status: 'disabled', locale: 'fr', role: { role_name: 'Reader' },
    external_auth_provider: null, ...opts.user,
  };
  const admin = { id: 'admin-1', email: 'claire@example.invalid', first_name: 'Claire', last_name: 'Dubois', tenant_id: 't-1' };
  const tokens: any[] = [];
  const saves: any[] = [];
  const passwordMails: any[] = [];
  const microsoftMails: any[] = [];
  const tenant = opts.tenant === undefined ? ENTRA_TENANT : opts.tenant;
  // `query` takes the lock on the person's row (`lockPeople`).
  const manager: any = { query: async () => [] };
  const users = {
    manager,
    findOne: async (query: any) => {
      const id = query?.where?.id;
      if (id === invitee.id) return { ...invitee };
      if (id === admin.id) return { ...admin };
      return null;
    },
    save: async (row: any) => { saves.push({ ...row }); return row; },
  };
  const resetTokens = {
    manager,
    create: (row: any) => ({ id: `token-${tokens.length + 1}`, ...row }),
    save: async (row: any) => { tokens.push(row); return row; },
    findOne: async (query: any) => tokens.find((row) => row.token_hash === query?.where?.token_hash && !row.used_at) ?? null,
    update: async (where: any, value: any) => {
      const row = tokens.find((entry) => entry.id === where.id && !entry.used_at);
      if (!row) return { affected: 0 };
      row.used_at = value.used_at;
      return { affected: 1 };
    },
  };
  const tenants = { findOne: async () => (tenant ? { ...tenant } : null) };
  manager.getRepository = (entity: { name?: string }) => {
    if (entity?.name === 'User') return users;
    if (entity?.name === 'Tenant') return tenants;
    return resetTokens;
  };
  const email = {
    sendUserInviteEmail: async (params: any) => { passwordMails.push(params); },
    sendUserMicrosoftInviteEmail: async (params: any) => { microsoftMails.push(params); },
  };
  const service = new UsersService(users as any, {} as any, {} as any, {} as any, {} as any, email as any, { log: async () => undefined } as any);
  return { service, manager, tokens, saves, passwordMails, microsoftMails, resetTokens, invitee };
}

function lifetimeSeconds(token: string): number {
  const decoded = jwt.decode(token) as { exp: number; iat: number };
  return decoded.exp - decoded.iat;
}

async function testPasswordInvitationLastsSevenDays() {
  const { service, manager, tokens, passwordMails, microsoftMails } = buildInviteService();
  const before = Date.now();
  await service.inviteUser('u-1', 'admin-1', 'https://acme.kanap.net', { manager });

  assert.equal(microsoftMails.length, 0);
  assert.equal(passwordMails.length, 1);
  assert.equal(passwordMails[0].expiresInMinutes, 7 * 24 * 60, 'the e-mail states the 7 days');
  assert.equal(passwordMails[0].firstName, 'Julie', 'the e-mail greets the invitee by first name');
  assert.equal(passwordMails[0].inviterName, 'Claire Dubois', 'the e-mail names the inviting administrator');
  const token = decodeURIComponent(passwordMails[0].inviteUrl.split('#token=')[1]);
  assert.equal(lifetimeSeconds(token), 7 * DAY_S);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].token_hash, hash(token));
  const storedFor = tokens[0].expires_at.getTime() - before;
  assert.ok(Math.abs(storedFor - 7 * DAY_S * 1000) < 60_000, `stored expiry ${storedFor} ms`);

  // The reset link keeps its own hour.
  assert.equal(getPasswordResetExpirationMinutes(), 60);
  assert.equal(getInviteLinkExpirationMinutes(), 7 * 24 * 60);
}

async function testInviteLinkTtlSetsTheInvitationOnly() {
  process.env.INVITE_LINK_TTL = '72h';
  try {
    const { service, manager, passwordMails } = buildInviteService();
    await service.inviteUser('u-1', 'admin-1', 'https://acme.kanap.net', { manager });
    assert.equal(passwordMails[0].expiresInMinutes, 72 * 60);
    assert.equal(lifetimeSeconds(decodeURIComponent(passwordMails[0].inviteUrl.split('#token=')[1])), 72 * 60 * 60);
    assert.equal(getPasswordResetExpirationMinutes(), 60, 'INVITE_LINK_TTL leaves the reset link alone');
  } finally {
    delete process.env.INVITE_LINK_TTL;
  }
}

/** The link sets the password the day after; a reset link of the same age is refused. */
async function testTheInvitationIsAcceptedAfterTheResetHour() {
  const { service, manager, passwordMails, resetTokens } = buildInviteService({ user: { status: 'disabled' } });
  await service.inviteUser('u-1', 'admin-1', 'https://acme.kanap.net', { manager });
  const inviteToken = decodeURIComponent(passwordMails[0].inviteUrl.split('#token=')[1]);

  const passwordsSet: string[] = [];
  const enabled: string[] = [];
  const accountUsers = {
    findById: async () => ({ id: 'u-1', email: 'julie.martin@example.invalid', tenant_id: 't-1', status: 'invited', role: { role_name: 'Reader' } }),
    updateUser: async (id: string) => { passwordsSet.push(id); return { id }; },
    enableUser: async (id: string) => { enabled.push(id); return { id }; },
  };
  const auth = new AuthService(accountUsers as any, { delete: async () => ({ affected: 0 }) } as any, resetTokens as any);
  const resetToken = await auth.createPasswordResetToken({ id: 'u-1', email: 'julie.martin@example.invalid', tenant_id: 't-1' });
  assert.equal(lifetimeSeconds(resetToken), 60 * 60);

  const realNow = Date.now;
  const tomorrow = realNow() + DAY_S * 1000;
  Date.now = () => tomorrow;
  try {
    await assert.rejects(() => auth.resetPasswordWithToken(resetToken, 'Next-password-2026'), /invalid or expired token/);
    await auth.resetPasswordWithToken(inviteToken, 'Next-password-2026');
  } finally {
    Date.now = realNow;
  }
  assert.deepEqual(passwordsSet, ['u-1']);
  assert.deepEqual(enabled, ['u-1'], 'accepting the invitation enables the account');
}

async function testMicrosoftInvitationSendsNoLink() {
  const { service, manager, tokens, saves, passwordMails, microsoftMails } = buildInviteService();
  const result = await service.inviteUser('u-1', 'admin-1', 'https://acme.kanap.net/', { manager, signIn: 'microsoft' });

  assert.equal(passwordMails.length, 0);
  assert.equal(tokens.length, 0, 'no password link is issued');
  assert.deepEqual(microsoftMails, [{
    to: 'julie.martin@example.invalid',
    signInUrl: 'https://acme.kanap.net',
    firstName: 'Julie',
    inviterName: 'Claire Dubois',
    tenantId: 't-1',
    locale: 'fr',
  }]);
  assert.equal(result.status, 'invited', 'invited until the first sign-in');
  assert.equal(saves.at(-1)?.status, 'invited');
}

async function testMicrosoftInvitationKeepsAnEnabledAccount() {
  const { service, manager, saves, microsoftMails } = buildInviteService({ user: { status: 'enabled' } });
  const result = await service.inviteUser('u-1', 'admin-1', 'https://acme.kanap.net', { manager, signIn: 'microsoft' });
  assert.equal(microsoftMails.length, 1);
  assert.equal(result.status, 'enabled');
  assert.equal(saves.length, 0);
}

async function testMicrosoftInvitationNeedsEntraSignIn() {
  for (const tenant of [
    { id: 't-1', sso_provider: 'none', sso_enabled: false, entra_tenant_id: null },
    { ...ENTRA_TENANT, sso_enabled: false },
    { ...ENTRA_TENANT, entra_tenant_id: null },
    null,
  ]) {
    const { service, manager, tokens, saves, passwordMails, microsoftMails } = buildInviteService({ tenant });
    await assert.rejects(
      service.inviteUser('u-1', 'admin-1', 'https://acme.kanap.net', { manager, signIn: 'microsoft' }),
      (err: unknown) => err instanceof BadRequestException && /Microsoft sign-in is not set up/.test(err.message),
    );
    assert.equal(microsoftMails.length + passwordMails.length + tokens.length + saves.length, 0);
  }
}

async function testAnEntraAccountGetsNoInvitation() {
  for (const signIn of ['password', 'microsoft'] as const) {
    const { service, manager, tokens, saves, passwordMails, microsoftMails } = buildInviteService({
      user: { external_auth_provider: 'entra', status: 'enabled' },
    });
    await assert.rejects(
      service.inviteUser('u-1', 'admin-1', 'https://acme.kanap.net', { manager, signIn }),
      /signs in with Microsoft Entra/,
    );
    assert.equal(microsoftMails.length + passwordMails.length + tokens.length + saves.length, 0);
  }
}

async function testTheRouteReadsTheChoice() {
  const ENV_KEYS = ['APP_ENV', 'NODE_ENV', 'APP_BASE_URL', 'PUBLIC_APP_URL', 'APP_URL', 'MARKETING_BASE_URL'] as const;
  const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const savedFeatures = { SINGLE_TENANT: Features.SINGLE_TENANT, EMAIL_ENABLED: Features.EMAIL_ENABLED };
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, { APP_ENV: 'production', APP_BASE_URL: 'https://kanap.net' });
  (Features as any).SINGLE_TENANT = false;
  (Features as any).EMAIL_ENABLED = true;
  try {
    const calls: any[] = [];
    const svc = { inviteUser: async (id: string, _actor: string | null, _base: string, opts: any) => { calls.push(opts.signIn); return { id }; } };
    const controller = new UsersController(svc as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const req = { tenant: { slug: 'acme' }, headers: { host: 'acme.kanap.net' }, user: { sub: 'admin-1' } };
    await controller.invite('u-1', req, { sign_in: 'microsoft' });
    await controller.invite('u-1', req, { sign_in: 'password' });
    await controller.invite('u-1', req, undefined);
    assert.deepEqual(calls, ['microsoft', 'password', 'password'], 'no choice is a password link, as before');
    await assert.rejects(controller.invite('u-1', req, { sign_in: 'sms' }), BadRequestException);
    assert.equal(calls.length, 3);
  } finally {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    Object.assign(Features as any, savedFeatures);
  }
}

async function main() {
  await testPasswordInvitationLastsSevenDays();
  await testInviteLinkTtlSetsTheInvitationOnly();
  await testTheInvitationIsAcceptedAfterTheResetHour();
  await testMicrosoftInvitationSendsNoLink();
  await testMicrosoftInvitationKeepsAnEnabledAccount();
  await testMicrosoftInvitationNeedsEntraSignIn();
  await testAnEntraAccountGetsNoInvitation();
  await testTheRouteReadsTheChoice();
  console.log('users.invite-sign-in.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
