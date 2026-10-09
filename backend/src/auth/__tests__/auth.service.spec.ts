import * as assert from 'node:assert/strict';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { JwtAuthGuard } from '../jwt-auth.guard';
import { ACCESS_TOKEN_PURPOSE, PASSWORD_RESET_PURPOSE } from '../access-token.util';
import { deriveSecret } from '../token-secret.util';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createContext(req: any) {
  return {
    getHandler: () => 'handler',
    getClass: () => 'controller',
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

function guardRequest(accessToken: string, tenantId: string) {
  return {
    headers: { authorization: `Bearer ${accessToken}` },
    tenant: { id: tenantId },
  };
}

function createService() {
  const state = {
    findOneArgs: [] as any[],
    saveArgs: [] as any[],
    deleteArgs: [] as any[],
  };

  const repo = {
    create: (value: any) => ({ ...value }),
    save: async (value: any) => {
      state.saveArgs.push(value);
      return value;
    },
    findOne: async (value: any): Promise<Record<string, unknown> | null> => {
      state.findOneArgs.push(value);
      return null;
    },
    delete: async (value: any) => {
      state.deleteArgs.push(value);
      return { affected: 1 };
    },
  };

  const service = new AuthService({} as any, repo as any, repo as any);
  return { service, repo, state };
}

async function testSignTokensIncludeTenantIdInAccessAndRefreshTokens() {
  process.env.JWT_SECRET = 'auth-service-spec-secret';
  const { service, state } = createService();

  const result = await service.signTokens({
    id: 'user-1',
    email: 'user@example.com',
    role: { role_name: 'Member' },
    tenant_id: 'tenant-1',
  });

  const payload = jwt.verify(result.access_token, process.env.JWT_SECRET as string) as Record<string, any>;

  assert.equal(payload.sub, 'user-1');
  assert.equal(payload.tenant_id, 'tenant-1');
  assert.equal(state.saveArgs.length, 1);
  assert.equal(state.saveArgs[0]?.tenant_id, 'tenant-1');
}

async function testRefreshAccessTokenRejectsTenantMismatchAndMintsTenantBoundTokens() {
  process.env.JWT_SECRET = 'auth-service-spec-secret';
  const refreshToken = 'refresh-token-raw';
  const expectedHash = hashToken(refreshToken);
  const { service, repo, state } = createService();

  repo.findOne = async (value: any) => {
    state.findOneArgs.push(value);
    if (value?.where?.token_hash === expectedHash && value?.where?.tenant_id === 'tenant-1') {
      return {
        id: 'refresh-record-1',
        tenant_id: 'tenant-1',
        expires_at: new Date(Date.now() + 60_000),
        user: {
          id: 'user-1',
          email: 'user@example.com',
          role: { role_name: 'Member' },
          // `refreshAccessToken` refuses a disabled account; the fixture must carry a status.
          status: 'enabled',
        },
      };
    }
    return null;
  };

  await assert.rejects(
    () => service.refreshAccessToken(refreshToken, 'tenant-2'),
    (error: unknown) => {
      assert.ok(error instanceof UnauthorizedException);
      return true;
    },
  );

  assert.deepEqual(state.findOneArgs[0]?.where, {
    token_hash: expectedHash,
    tenant_id: 'tenant-2',
  });

  const refreshed = await service.refreshAccessToken(refreshToken, 'tenant-1');
  const payload = jwt.verify(refreshed.access_token, process.env.JWT_SECRET as string) as Record<string, any>;

  assert.deepEqual(state.findOneArgs[1]?.where, {
    token_hash: expectedHash,
    tenant_id: 'tenant-1',
  });
  assert.equal(payload.tenant_id, 'tenant-1');
  assert.equal(state.saveArgs.length, 1);
}

async function testRevokeTokenDeletesByHashAndTenant() {
  const refreshToken = 'refresh-token-raw';
  const expectedHash = hashToken(refreshToken);
  const { service, state } = createService();

  await service.revokeToken(refreshToken, 'tenant-1');

  assert.deepEqual(state.deleteArgs[0], {
    token_hash: expectedHash,
    tenant_id: 'tenant-1',
  });
}

async function testPasswordResetConsumesTokenAndRevokesSessions() {
  process.env.JWT_SECRET = 'auth-service-spec-secret';
  const resetTokenRepoState = {
    saved: [] as any[],
    updates: [] as any[],
  };
  const resetTokenRepo = {
    create: (value: any) => ({ id: 'reset-token-1', ...value }),
    save: async (value: any) => {
      resetTokenRepoState.saved.push(value);
      return value;
    },
    findOne: async (query: any) => {
      const hash = query?.where?.token_hash;
      const saved = resetTokenRepoState.saved.find((entry) => entry.token_hash === hash);
      if (!saved || saved.used_at) return null;
      return saved;
    },
    update: async (where: any, value: any) => {
      resetTokenRepoState.updates.push({ where, value });
      const saved = resetTokenRepoState.saved.find((entry) => entry.id === where.id && entry.used_at === null);
      if (!saved) return { affected: 0 };
      saved.used_at = value.used_at;
      return { affected: 1 };
    },
  };
  const refreshRepo = {
    delete: async (value: any) => {
      assert.deepEqual(value, { user_id: 'user-1' });
      return { affected: 2 };
    },
  };
  const users = {
    findById: async () => ({
      id: 'user-1',
      email: 'user@example.com',
      tenant_id: 'tenant-1',
      status: 'enabled',
      role: { role_name: 'Member' },
    }),
    updateUser: async () => ({ id: 'user-1' }),
  };
  const service = new AuthService(users as any, refreshRepo as any, resetTokenRepo as any);

  const token = await service.createPasswordResetToken({
    id: 'user-1',
    email: 'user@example.com',
    tenant_id: 'tenant-1',
  });

  await service.resetPasswordWithToken(token, 'NextPassword!2026');

  assert.equal(resetTokenRepoState.updates.length, 1);
  await assert.rejects(() => service.resetPasswordWithToken(token, 'OtherPassword!2026'));
}

async function testEveryAccessTokenPathIsMarkedAsAnAccessToken() {
  process.env.JWT_SECRET = 'auth-service-spec-secret';
  // No deadline: the guard refuses a token without the marker, so each acceptance below proves
  // that path marks its token.
  process.env.JWT_LEGACY_ACCESS_TOKEN_DEADLINE = '';
  const { service, repo } = createService();

  repo.findOne = async () => ({
    id: 'refresh-record-1',
    tenant_id: 'tenant-1',
    expires_at: new Date(Date.now() + 60_000),
    user: { id: 'user-1', email: 'user@example.com', role: { role_name: 'Member' }, status: 'enabled' },
  });

  const signed = await service.signTokens({
    id: 'user-1',
    email: 'user@example.com',
    role: { role_name: 'Member' },
    tenant_id: 'tenant-1',
  });
  const refreshed = await service.refreshAccessToken('refresh-token-raw', 'tenant-1');
  const exchanged = service.signToken({
    id: 'user-1',
    email: 'user@example.com',
    role: { role_name: 'Member' },
    tenant_id: 'tenant-1',
  });

  const guard = new JwtAuthGuard({ getAllAndOverride: () => false } as any);
  for (const [label, token] of [
    ['login', signed.access_token],
    ['refresh', refreshed.access_token],
    ['provisioning exchange', exchanged.access_token],
  ] as const) {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as Record<string, unknown>;
    assert.equal(payload.purpose, ACCESS_TOKEN_PURPOSE, `${label} access token must carry the purpose marker`);
    assert.equal(
      guard.canActivate(createContext(guardRequest(token, 'tenant-1'))),
      true,
      `${label} access token must be accepted by the guard`,
    );
  }
}

async function testLegacyPasswordResetTokenSignedWithJwtSecretIsRejected() {
  process.env.JWT_SECRET = 'auth-service-spec-secret';
  process.env.PASSWORD_RESET_SECRET = '';
  const resetTokenRepoState = { saved: [] as any[], updates: [] as any[] };
  const resetTokenRepo = {
    create: (value: any) => ({ id: 'reset-token-1', ...value }),
    save: async (value: any) => {
      resetTokenRepoState.saved.push(value);
      return value;
    },
    findOne: async (query: any) => {
      const saved = resetTokenRepoState.saved.find((entry) => entry.token_hash === query?.where?.token_hash);
      return !saved || saved.used_at ? null : saved;
    },
    update: async (where: any, value: any) => {
      resetTokenRepoState.updates.push({ where, value });
      const saved = resetTokenRepoState.saved.find((entry) => entry.id === where.id && entry.used_at === null);
      if (!saved) return { affected: 0 };
      saved.used_at = value.used_at;
      return { affected: 1 };
    },
  };
  const users = {
    findById: async () => ({
      id: 'user-1',
      email: 'user@example.com',
      tenant_id: 'tenant-1',
      status: 'enabled',
      role: { role_name: 'Member' },
    }),
    updateUser: async () => ({ id: 'user-1' }),
    enableUser: async () => ({ id: 'user-1' }),
  };
  const service = new AuthService(users as any, { delete: async () => ({ affected: 0 }) } as any, resetTokenRepo as any);

  // A link issued by the previous build: same claims, signed with the shared access-token secret.
  const legacyUser = { id: 'user-1', email: 'user@example.com', tenant_id: 'tenant-1' };
  const legacyToken = jwt.sign(
    { purpose: PASSWORD_RESET_PURPOSE, ...legacyUser, jti: 'legacy-jti' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' },
  );
  const currentToken = await service.createPasswordResetToken(legacyUser);
  assert.equal(resetTokenRepoState.saved.length, 1, 'only the current-family link is persisted');

  const guard = new JwtAuthGuard({ getAllAndOverride: () => false } as any);
  const rejects = (token: string, label: string) => assert.throws(
    () => guard.canActivate(createContext(guardRequest(token, 'tenant-1'))),
    (error: unknown) => {
      assert.ok(error instanceof UnauthorizedException, label);
      return true;
    },
    label,
  );

  // The link of the previous build is neither a usable credential nor a usable reset link.
  rejects(legacyToken, 'legacy reset link as Bearer');
  await assert.rejects(() => service.resetPasswordWithToken(legacyToken, 'NextPassword!2026'));
  assert.equal(resetTokenRepoState.updates.length, 0, 'the previous build key can no longer consume a link');

  // Current links stay usable, and are still not credentials.
  rejects(currentToken, 'current reset link as Bearer');
  await service.resetPasswordWithToken(currentToken, 'NextPassword!2026');
  assert.equal(resetTokenRepoState.updates.length, 1, 'exactly one consumption');
  rejects(currentToken, 'consumed reset link as Bearer');
  await assert.rejects(() => service.resetPasswordWithToken(currentToken, 'OtherPassword!2026'));
}

async function run() {
  await testSignTokensIncludeTenantIdInAccessAndRefreshTokens();
  await testRefreshAccessTokenRejectsTenantMismatchAndMintsTenantBoundTokens();
  await testRevokeTokenDeletesByHashAndTenant();
  await testPasswordResetConsumesTokenAndRevokesSessions();
  await testEveryAccessTokenPathIsMarkedAsAnAccessToken();
  await testLegacyPasswordResetTokenSignedWithJwtSecretIsRejected();
}

void run();
