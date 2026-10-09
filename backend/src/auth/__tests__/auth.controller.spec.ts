import * as assert from 'node:assert/strict';
import * as jwt from 'jsonwebtoken';
import { AuthController } from '../auth.controller';
import { REFRESH_TOKEN_COOKIE_NAME } from '../auth-cookie.util';
import { PASSWORD_RESET_PURPOSE, PROVISIONING_PURPOSE } from '../access-token.util';
import { deriveSecret } from '../token-secret.util';

function createTenantDataSource(manager: any = { id: 'tenant-manager-1' }) {
  const queries: Array<{ sql: string; params?: any[] }> = [];
  const runner = {
    manager,
    isTransactionActive: false,
    connect: async () => undefined,
    startTransaction: async () => {
      runner.isTransactionActive = true;
    },
    query: async (sql: string, params?: any[]) => {
      queries.push({ sql, params });
    },
    commitTransaction: async () => {
      runner.isTransactionActive = false;
    },
    rollbackTransaction: async () => {
      runner.isTransactionActive = false;
    },
    release: async () => undefined,
  };
  return {
    manager,
    queries,
    dataSource: {
      createQueryRunner: () => runner,
    } as any,
  };
}

function createController(
  authOverrides?: Partial<Record<'validateUser' | 'signTokens' | 'refreshAccessToken' | 'revokeToken', any>>,
  dataSource?: any,
) {
  const auth = {
    validateUser: async () => ({
      id: 'user-1',
      email: 'user@example.com',
      role: 'member',
      tenant_id: 'tenant-1',
    }),
    signTokens: async () => ({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 900,
      refresh_expires_in: 14_400,
    }),
    refreshAccessToken: async () => ({
      access_token: 'access-token',
      expires_in: 900,
      refresh_expires_in: 14_400,
    }),
    revokeToken: async () => undefined,
    signToken: () => ({ access_token: 'access-token' }),
    ...authOverrides,
  };

  const controller = new AuthController(
    auth as any,
    // `login` also records the sign-in; the spec needs a minimal users service, not an empty object.
    { touchLastLogin: async () => undefined } as any,
    {} as any,
    {} as any,
    {} as any,
    { maybeRefreshOnLogin: async () => undefined } as any,
    dataSource ?? createTenantDataSource().dataSource,
    {} as any,
    { recordAuthEvent: async () => undefined } as any,
  );

  return { controller, auth };
}

function createResponseRecorder() {
  const calls: Array<{ name: string; value: string; options: Record<string, any> }> = [];
  return {
    calls,
    response: {
      cookie: (name: string, value: string, options: Record<string, any>) => {
        calls.push({ name, value, options });
      },
    } as any,
  };
}

async function testRefreshPassesTenantIdToAuthService() {
  let capturedArgs: any[] | null = null;
  const tenantDb = createTenantDataSource();
  const { controller } = createController({
    refreshAccessToken: async (...args: any[]) => {
      capturedArgs = args;
      return {
        access_token: 'new-access-token',
        expires_in: 900,
        refresh_expires_in: 14_400,
      };
    },
  }, tenantDb.dataSource);
  const { response, calls } = createResponseRecorder();

  const result = await controller.refreshToken(
    { refresh_token: 'refresh-token-1' },
    {
      tenant: { id: 'tenant-1' },
      queryRunner: { manager: { id: 'request-manager-1' } },
      secure: false,
      headers: { 'x-forwarded-proto': 'https' },
    },
    response,
  );

  assert.deepEqual(capturedArgs, ['refresh-token-1', 'tenant-1', tenantDb.manager]);
  assert.deepEqual(tenantDb.queries[0]?.params, ['tenant-1']);
  assert.equal(result.access_token, 'new-access-token');
  assert.equal(calls[0]?.name, REFRESH_TOKEN_COOKIE_NAME);
  assert.equal(calls[0]?.value, 'refresh-token-1');
  assert.equal(calls[0]?.options?.secure, true);
}

async function testLogoutPassesTenantIdToAuthService() {
  let capturedArgs: any[] | null = null;
  const tenantDb = createTenantDataSource();
  const { controller } = createController({
    revokeToken: async (...args: any[]) => {
      capturedArgs = args;
    },
  }, tenantDb.dataSource);
  const { response, calls } = createResponseRecorder();

  const result = await controller.logout(
    { refresh_token: 'refresh-token-1' },
    {
      tenant: { id: 'tenant-1' },
      queryRunner: { manager: { id: 'request-manager-1' } },
      headers: { 'x-forwarded-proto': 'https' },
    },
    response,
  );

  assert.deepEqual(capturedArgs, ['refresh-token-1', 'tenant-1', tenantDb.manager]);
  assert.deepEqual(tenantDb.queries[0]?.params, ['tenant-1']);
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0]?.name, REFRESH_TOKEN_COOKIE_NAME);
  assert.equal(calls[0]?.options?.maxAge, 0);
  assert.equal(calls[0]?.options?.secure, true);
}

async function testLoginUsesTenantRunnerEvenWhenRequestRunnerIsReleased() {
  const tenantDb = createTenantDataSource();
  let validateManager: any = null;
  let signManager: any = null;
  const { controller } = createController({
    validateUser: async (_email: string, _password: string, manager: any) => {
      validateManager = manager;
      return {
        id: 'user-1',
        email: 'user@example.com',
        role: 'member',
        tenant_id: 'tenant-1',
      };
    },
    signTokens: async (_payload: any, manager: any) => {
      signManager = manager;
      return {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 900,
        refresh_expires_in: 14_400,
      };
    },
  }, tenantDb.dataSource);
  const { response, calls } = createResponseRecorder();

  const result = await controller.login(
    { email: 'user@example.com', password: 'Password!2026' },
    {
      tenant: { id: 'tenant-1' },
      queryRunner: { isReleased: true, manager: { id: 'released-manager' } },
      secure: false,
      headers: { 'x-forwarded-proto': 'https' },
    },
    response,
  );

  assert.equal(validateManager, tenantDb.manager);
  assert.equal(signManager, tenantDb.manager);
  assert.deepEqual(tenantDb.queries[0]?.params, ['tenant-1']);
  assert.equal((result as any).refresh_token, undefined);
  assert.equal(result.access_token, 'access-token');
  assert.equal(result.expires_in, 900);
  assert.equal(result.refresh_expires_in, 14_400);
  assert.equal(calls[0]?.name, REFRESH_TOKEN_COOKIE_NAME);
  assert.equal(calls[0]?.value, 'refresh-token');
  assert.equal(calls[0]?.options?.secure, true);
}

async function testProvisioningExchangeUsesItsOwnKeyAndRejectsTheLegacyOne() {
  const JWT_SECRET = 'auth-controller-spec-jwt-secret';
  process.env.JWT_SECRET = JWT_SECRET;
  const payload = {
    purpose: PROVISIONING_PURPOSE,
    tenant_id: 'tenant-1',
    email: 'user@example.com',
    exp: Math.floor(Date.now() / 1000) + 600,
  };

  const exchangeWith = async (token: string, dedicatedKey?: string) => {
    const previous = process.env.PROVISIONING_TOKEN_SECRET;
    if (dedicatedKey === undefined) delete process.env.PROVISIONING_TOKEN_SECRET;
    else process.env.PROVISIONING_TOKEN_SECRET = dedicatedKey;
    try {
      const { controller } = createController();
      // `AuthController` is constructed with an empty users service everywhere in this spec;
      // the exchange path needs exactly these two methods.
      (controller as any).users = {
        findByEmail: async () => ({ id: 'user-1', email: 'user@example.com', role: 'member' }),
        touchLastLogin: async () => undefined,
      };
      return await controller.exchangeProvisioningToken({ token }, {});
    } finally {
      if (previous === undefined) delete process.env.PROVISIONING_TOKEN_SECRET;
      else process.env.PROVISIONING_TOKEN_SECRET = previous;
    }
  };

  // Historical contract of the external issuer: `purpose: 'provision'` signed with `JWT_SECRET`.
  // It keeps working until an operator sets the dedicated key.
  assert.equal((await exchangeWith(jwt.sign(payload, JWT_SECRET))).access_token, 'access-token');
  // A token signed with another family's KEY is still refused: the key is not shared anymore
  // for the families that derive (they are the ones the constat was about).
  await assert.rejects(
    () => exchangeWith(jwt.sign(payload, deriveSecret(JWT_SECRET, 'password-reset'))),
    /invalid or expired token/,
  );

  // Dedicated key configured: it becomes the only accepted key (lockstep with the issuer).
  const dedicated = 'dedicated-provisioning-key';
  assert.equal((await exchangeWith(jwt.sign(payload, dedicated), dedicated)).access_token, 'access-token');
  await assert.rejects(() => exchangeWith(jwt.sign(payload, JWT_SECRET), dedicated), /invalid or expired token/);
  await assert.rejects(
    () => exchangeWith(jwt.sign(payload, deriveSecret(JWT_SECRET, 'password-reset')), dedicated),
    /invalid or expired token/,
  );

  // Wrong purpose on the right key is still refused, in both configurations.
  await assert.rejects(
    () => exchangeWith(jwt.sign({ ...payload, purpose: PASSWORD_RESET_PURPOSE }, JWT_SECRET)),
    /invalid token payload/,
  );
  await assert.rejects(
    () => exchangeWith(jwt.sign({ ...payload, purpose: PASSWORD_RESET_PURPOSE }, dedicated), dedicated),
    /invalid token payload/,
  );
}

async function testProvisioningExchangeIsRecordedAsASignIn() {
  const JWT_SECRET = 'auth-controller-spec-jwt-secret';
  process.env.JWT_SECRET = JWT_SECRET;
  delete process.env.PROVISIONING_TOKEN_SECRET;
  const payload = { purpose: PROVISIONING_PURPOSE, tenant_id: 'tenant-1', email: 'user@example.com', exp: Math.floor(Date.now() / 1000) + 600 };
  const events: Array<{ tenantId: unknown; event: any }> = [];
  const exchange = async (token: string, req: any, user: any = { id: 'user-1', email: 'user@example.com', role: 'member' }) => {
    const { controller } = createController();
    (controller as any).users = { findByEmail: async () => user };
    (controller as any).securityEvents = { recordAuthEvent: async (tenantId: unknown, event: any) => { events.push({ tenantId, event }); } };
    return controller.exchangeProvisioningToken({ token }, req);
  };

  // A sign-in in the tenant the verified token names.
  await exchange(jwt.sign(payload, JWT_SECRET), { tenant: { id: 'tenant-host' } });
  assert.deepEqual(events.pop(), { tenantId: 'tenant-1', event: { action: 'login', userId: 'user-1', reason: 'provisioning' } });
  // A token that does not verify names no trusted tenant: the host's tenant only, or none.
  const foreign = jwt.sign(payload, 'another-key');
  await assert.rejects(() => exchange(foreign, { tenant: { id: 'tenant-host' } }), /invalid or expired token/);
  assert.deepEqual(events.pop(), { tenantId: 'tenant-host', event: { action: 'login_failed', reason: 'invalid_token' } });
  await assert.rejects(() => exchange(foreign, {}), /invalid or expired token/);
  assert.deepEqual(events.pop(), { tenantId: undefined, event: { action: 'login_failed', reason: 'invalid_token' } });
  // A verified token for an address the tenant does not have.
  await assert.rejects(() => exchange(jwt.sign(payload, JWT_SECRET), {}, null), /user not found/);
  assert.deepEqual(events.pop(), { tenantId: 'tenant-1', event: { action: 'login_failed', reason: 'unknown_user' } });
  assert.equal(events.length, 0);
}

async function run() {
  await testRefreshPassesTenantIdToAuthService();
  await testLogoutPassesTenantIdToAuthService();
  await testLoginUsesTenantRunnerEvenWhenRequestRunnerIsReleased();
  await testProvisioningExchangeUsesItsOwnKeyAndRejectsTheLegacyOne();
  await testProvisioningExchangeIsRecordedAsASignIn();
}

void run();
