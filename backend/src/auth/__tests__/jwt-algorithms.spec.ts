/**
 * Each token family is accepted only in the algorithm it is issued with. Every token this API
 * issues (access, password reset, SSO state, SSO login handoff) is signed with HS256, and a token
 * signed with the right key in another HMAC algorithm is refused. Provisioning tokens, issued
 * outside this repository with a shared secret, are accepted in any HMAC algorithm.
 */
import * as assert from 'node:assert/strict';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { EntraAuthService } from '../entra-auth.service';
import { JwtAuthGuard } from '../jwt-auth.guard';
import {
  ACCESS_TOKEN_PURPOSE,
  ENTRA_LOGIN_HANDOFF_TYPE,
  ENTRA_STATE_PURPOSE,
  PASSWORD_RESET_PURPOSE,
  PROVISIONING_PURPOSE,
} from '../access-token.util';
import { getEntraStateSecret, getPasswordResetSecret, getProvisioningSecret } from '../token-secret.util';

const JWT_SECRET = 'jwt-algorithms-spec-secret';
const TENANT_ID = 'tenant-1';

process.env.JWT_SECRET = JWT_SECRET;
process.env.PASSWORD_RESET_SECRET = '';
process.env.PROVISIONING_TOKEN_SECRET = '';
process.env.ENTRA_STATE_SECRET = '';
process.env.JWT_LEGACY_ACCESS_TOKEN_DEADLINE = '';

const OTHER_HMAC_ALGORITHMS: jwt.Algorithm[] = ['HS384', 'HS512'];

function hash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function algorithmOf(token: string): string | undefined {
  return (jwt.decode(token, { complete: true }) as jwt.Jwt | null)?.header.alg;
}

// --- access tokens ----------------------------------------------------------------------------

function guardAccepts(token: string): boolean {
  const guard = new JwtAuthGuard({ getAllAndOverride: () => false } as any);
  const req = { headers: { authorization: `Bearer ${token}` }, tenant: { id: TENANT_ID } };
  const context = {
    getHandler: () => 'handler',
    getClass: () => 'controller',
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
  try {
    return guard.canActivate(context);
  } catch (error) {
    assert.ok(error instanceof UnauthorizedException, `expected UnauthorizedException, got ${String(error)}`);
    return false;
  }
}

async function testAccessTokensAreHs256Only() {
  const claims = { purpose: ACCESS_TOKEN_PURPOSE, sub: 'user-1', email: 'user@example.com', tenant_id: TENANT_ID };
  assert.equal(guardAccepts(jwt.sign(claims, JWT_SECRET, { algorithm: 'HS256', expiresIn: 60 })), true, 'HS256 access token');
  for (const algorithm of OTHER_HMAC_ALGORITHMS) {
    const token = jwt.sign(claims, JWT_SECRET, { algorithm, expiresIn: 60 });
    assert.equal(guardAccepts(token), false, `${algorithm} access token on the right key`);
  }

  // Every issuing path signs with HS256, and the guard accepts what it issues.
  const service = new AuthService(
    {} as any,
    { create: (value: any) => value, save: async (value: any) => value } as any,
    {} as any,
  );
  const user = { id: 'user-1', email: 'user@example.com', role: { role_name: 'Member' }, tenant_id: TENANT_ID };
  const issued = [(await service.signTokens(user)).access_token, service.signToken(user).access_token];
  for (const token of issued) {
    assert.equal(algorithmOf(token), 'HS256');
    assert.equal(guardAccepts(token), true, 'issued access token');
  }
}

// --- password-reset links ---------------------------------------------------------------------

function createResetService() {
  const records = new Map<string, { id: string; token_hash: string; expires_at: Date; used_at: Date | null }>();
  const resetRepo = {
    create: (value: any) => ({ id: `reset-${records.size + 1}`, ...value }),
    save: async (value: any) => {
      records.set(value.token_hash, value);
      return value;
    },
    findOne: async ({ where }: any) => {
      const record = records.get(where.token_hash);
      return record && record.used_at === null ? record : null;
    },
    update: async (where: any, value: any) => {
      const record = [...records.values()].find((entry) => entry.id === where.id && entry.used_at === null);
      if (!record) return { affected: 0 };
      record.used_at = value.used_at;
      return { affected: 1 };
    },
  };
  const users = {
    findById: async () => ({ id: 'user-1', email: 'user@example.com', status: 'enabled', role: { role_name: 'Member' } }),
    updateUser: async () => ({ id: 'user-1' }),
    enableUser: async () => ({ id: 'user-1' }),
  };
  const service = new AuthService(users as any, { delete: async () => ({ affected: 0 }) } as any, resetRepo as any);
  /** Stores a link the way `createPasswordResetToken` does, so only the algorithm can refuse it. */
  const store = (token: string) => {
    void resetRepo.save(resetRepo.create({ token_hash: hash(token), expires_at: new Date(Date.now() + 600_000), used_at: null }));
  };
  return { service, records, store };
}

async function testPasswordResetLinksAreHs256Only() {
  const { service, records, store } = createResetService();
  const user = { id: 'user-1', email: 'user@example.com', tenant_id: TENANT_ID };

  for (const algorithm of OTHER_HMAC_ALGORITHMS) {
    const token = jwt.sign(
      { purpose: PASSWORD_RESET_PURPOSE, sub: user.id, email: user.email, tenant_id: TENANT_ID, jti: `jti-${algorithm}` },
      getPasswordResetSecret(),
      { algorithm, expiresIn: '1h' },
    );
    store(token);
    await assert.rejects(
      () => service.resetPasswordWithToken(token, 'NextPassword!2026'),
      /invalid or expired token/,
      `${algorithm} reset link on the right key`,
    );
    assert.equal(records.get(hash(token))?.used_at, null, `${algorithm} reset link is not consumed`);
  }

  const issued = await service.createPasswordResetToken(user);
  assert.equal(algorithmOf(issued), 'HS256');
  await service.resetPasswordWithToken(issued, 'NextPassword!2026');
  assert.ok(records.get(hash(issued))?.used_at instanceof Date, 'HS256 reset link is consumed');
}

// --- SSO state and login handoff --------------------------------------------------------------

function createEntraService() {
  return new EntraAuthService({
    get: (key: string) => ({
      ENTRA_CLIENT_ID: 'client-id-1',
      ENTRA_CLIENT_SECRET: 'client-secret-1',
      ENTRA_REDIRECT_URI: 'https://kanap.example.test/api/auth/entra/callback',
      ENTRA_AUTHORITY: 'https://login.microsoftonline.com/organizations',
    } as Record<string, string>)[key],
  } as any);
}

function isBadRequest(error: unknown) {
  return error instanceof BadRequestException;
}

function testSsoStateIsHs256Only() {
  const service = createEntraService();
  const verifyState = (token: string) => (service as any).verifyState(token) as { tenantId: string };
  const state = { purpose: ENTRA_STATE_PURPOSE, mode: 'login', tenantId: TENANT_ID, nonce: 'nonce-1' };

  for (const algorithm of OTHER_HMAC_ALGORITHMS) {
    const token = jwt.sign(state, getEntraStateSecret(), { algorithm, expiresIn: '10m' });
    assert.throws(() => verifyState(token), isBadRequest, `${algorithm} SSO state on the right key`);
  }

  const issued = (service as any).signState(state) as string;
  assert.equal(algorithmOf(issued), 'HS256');
  assert.equal(verifyState(issued).tenantId, TENANT_ID);
}

function testSsoLoginHandoffIsHs256Only() {
  const service = createEntraService();
  const handoff = { type: ENTRA_LOGIN_HANDOFF_TYPE, tenantId: TENANT_ID, userId: 'user-1', redirectTo: '/' };

  for (const algorithm of OTHER_HMAC_ALGORITHMS) {
    const token = jwt.sign(handoff, getEntraStateSecret(), { algorithm, expiresIn: '2m' });
    assert.throws(() => service.verifyLoginHandoff(token), isBadRequest, `${algorithm} login handoff on the right key`);
  }

  const issued = service.signLoginHandoff({ tenantId: TENANT_ID, userId: 'user-1' });
  assert.equal(algorithmOf(issued), 'HS256');
  assert.equal(service.verifyLoginHandoff(issued).userId, 'user-1');
}

// --- provisioning tokens ----------------------------------------------------------------------

function createProvisioningController() {
  const runner = {
    manager: {},
    isTransactionActive: false,
    connect: async () => undefined,
    startTransaction: async () => {
      runner.isTransactionActive = true;
    },
    query: async () => undefined,
    commitTransaction: async () => {
      runner.isTransactionActive = false;
    },
    rollbackTransaction: async () => {
      runner.isTransactionActive = false;
    },
    release: async () => undefined,
  };
  return new AuthController(
    { signToken: () => ({ access_token: 'access-token' }) } as any,
    { findByEmail: async () => ({ id: 'user-1', email: 'user@example.com', role: 'member' }) } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { createQueryRunner: () => runner } as any,
    {} as any,
    { recordAuthEvent: async () => undefined } as any,
  );
}

async function testProvisioningAcceptsEveryHmacAlgorithm() {
  const controller = createProvisioningController();
  const payload = { purpose: PROVISIONING_PURPOSE, tenant_id: TENANT_ID, email: 'user@example.com' };
  for (const algorithm of ['HS256', ...OTHER_HMAC_ALGORITHMS] as jwt.Algorithm[]) {
    const token = jwt.sign(payload, getProvisioningSecret(), { algorithm, expiresIn: '10m' });
    const result = await controller.exchangeProvisioningToken({ token }, {});
    assert.equal(result.access_token, 'access-token', `${algorithm} provisioning token`);
  }
  // The key still decides: an HMAC token on another key is refused.
  const foreign = jwt.sign(payload, 'another-secret', { algorithm: 'HS512', expiresIn: '10m' });
  await assert.rejects(() => controller.exchangeProvisioningToken({ token: foreign }, {}), /invalid or expired token/);
}

async function run() {
  await testAccessTokensAreHs256Only();
  await testPasswordResetLinksAreHs256Only();
  testSsoStateIsHs256Only();
  testSsoLoginHandoffIsHs256Only();
  await testProvisioningAcceptsEveryHmacAlgorithm();
  // eslint-disable-next-line no-console
  console.log('jwt-algorithms.spec: OK (5 cases)');
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
