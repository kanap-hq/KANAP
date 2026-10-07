import * as assert from 'node:assert/strict';
import { mergeScalarFields, resolveDirectoryNames } from '../entra-directory-sync.util';
import { EntraController } from '../entra.controller';

function createMockDataSource(repo: any) {
  const state = {
    started: 0,
    committed: 0,
    rolledBack: 0,
    released: 0,
    tenantQueries: [] as Array<{ sql: string; params?: any[] }>,
  };

  const manager = {
    getRepository: () => repo,
  };

  const runner = {
    isTransactionActive: false,
    manager,
    connect: async () => {},
    startTransaction: async () => {
      state.started += 1;
      runner.isTransactionActive = true;
    },
    commitTransaction: async () => {
      state.committed += 1;
      runner.isTransactionActive = false;
    },
    rollbackTransaction: async () => {
      state.rolledBack += 1;
      runner.isTransactionActive = false;
    },
    release: async () => {
      state.released += 1;
    },
    query: async (sql: string, params?: any[]) => {
      state.tenantQueries.push({ sql, params });
      return [];
    },
  };

  return {
    state,
    manager,
    dataSource: {
      createQueryRunner: () => runner,
    },
  };
}

/** Records what the login path hands to the directory sync. */
const managerSyncCalls: Array<{ tenantId: string; entries: any[] }> = [];

function fakeDirectorySync(calls: typeof managerSyncCalls) {
  return {
    applyDirectoryProfile: async (user: any, profile: any, _manager: any, claims?: any) => {
      mergeScalarFields(user, profile, resolveDirectoryNames(profile, claims));
      user.external_synced_at = new Date();
    },
    syncDirectoryManagers: async (tenantId: string, entries: any[]) => {
      calls.push({ tenantId, entries });
      return { updated: 0, unresolved: 0 };
    },
  };
}

async function testHandleLoginCallbackRedirectsToTenantSessionHandoff() {
  const existingUser = {
    id: 'user-1',
    email: 'user@example.com',
    role: { role_name: 'Contact' },
    first_name: '',
    last_name: '',
    job_title: null,
    business_phone: null,
    mobile_phone: null,
  };

  const repo = {
    findOne: async () => existingUser,
    save: async (value: any) => value,
    createQueryBuilder: () => ({
      leftJoinAndSelect: () => repo.createQueryBuilder(),
      where: async () => existingUser,
      getOne: async () => existingUser,
    }),
  };

  const { dataSource, state } = createMockDataSource(repo);
  const handoffCalls: any[] = [];
  let redirectTarget = '';
  const cookieCalls: Array<{ name: string; value: string; options: Record<string, any> }> = [];

  const controller = new EntraController(
    {
      signLoginHandoff: (payload: any) => {
        handoffCalls.push(payload);
        return 'handoff-token';
      },
    } as any,
    {} as any,
    {} as any,
    { touchLastLogin: async () => undefined } as any,
    dataSource as any,
    { log: async () => undefined } as any,
    { notifySsoUserProvisioned: async () => undefined } as any,
    fakeDirectorySync(managerSyncCalls) as any,
  );

  await (controller as any).handleLoginCallback(
    'tenant-1',
    'alpha',
    '/dashboard',
    {
      oid: 'entra-oid-1',
      email: 'user@example.com',
    },
    { manager: { id: 'entra-manager-1' } },
    {
      headers: {
        host: 'alpha.lvh.me',
      },
      protocol: 'http',
    },
    {
      cookie: (name: string, value: string, options: Record<string, any>) => {
        cookieCalls.push({ name, value, options });
      },
      redirect: (value: string) => {
        redirectTarget = value;
      },
    } as any,
  );

  assert.deepEqual(handoffCalls[0], {
    tenantId: 'tenant-1',
    userId: 'user-1',
    redirectTo: '/dashboard',
  });
  assert.equal(state.started, 1);
  assert.equal(state.committed, 1);
  assert.equal(state.rolledBack, 0);
  assert.equal(state.released, 1);
  assert.equal(state.tenantQueries[0]?.params?.[0], 'tenant-1');
  assert.equal(cookieCalls.length, 0);
  assert.equal(redirectTarget, 'http://alpha.lvh.me/login/callback#handoff=handoff-token');
  // The reporting line is refreshed at sign-in, inside the login transaction.
  assert.deepEqual(managerSyncCalls, [
    { tenantId: 'tenant-1', entries: [{ userId: 'user-1', managerExternalId: 'entra-manager-1' }] },
  ]);
}

async function testCompleteLoginSessionSignsTokensOnTenantHost() {
  const existingUser = {
    id: 'user-1',
    email: 'user@example.com',
    role: { role_name: 'Contact' },
    status: 'enabled',
  };

  const repo = {
    findOne: async () => existingUser,
  };

  const { dataSource, manager, state } = createMockDataSource(repo);
  const signTokenCalls: any[][] = [];
  let redirectTarget = '';
  const cookieCalls: Array<{ name: string; value: string; options: Record<string, any> }> = [];

  const controller = new EntraController(
    {
      verifyLoginHandoff: (token: string) => {
        assert.equal(token, 'handoff-token');
        return {
          tenantId: 'tenant-1',
          userId: 'user-1',
          redirectTo: '/dashboard',
        };
      },
    } as any,
    {
      findById: async () => ({
        id: 'tenant-1',
        slug: 'alpha',
        sso_provider: 'entra',
        entra_tenant_id: 'entra-tenant-1',
      }),
    } as any,
    {
      signTokens: async (...args: any[]) => {
        signTokenCalls.push(args);
        return {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 900,
          refresh_expires_in: 14_400,
        };
      },
    } as any,
    { touchLastLogin: async () => undefined } as any,
    dataSource as any,
    { log: async () => undefined } as any,
    { notifySsoUserProvisioned: async () => undefined } as any,
    fakeDirectorySync(managerSyncCalls) as any,
  );

  const result = await controller.completeLoginSession(
    {
      handoff: 'handoff-token',
    },
    {
      tenant: {
        id: 'tenant-1',
      },
      headers: {
        host: 'alpha.lvh.me',
      },
      protocol: 'http',
    },
    {
      cookie: (name: string, value: string, options: Record<string, any>) => {
        cookieCalls.push({ name, value, options });
      },
    } as any,
  );

  assert.equal(signTokenCalls.length, 1);
  assert.deepEqual(signTokenCalls[0]?.[0], {
    id: 'user-1',
    email: 'user@example.com',
    role: { role_name: 'Contact' },
    tenant_id: 'tenant-1',
  });
  assert.equal(signTokenCalls[0]?.[1], manager);
  assert.equal(state.started, 1);
  assert.equal(state.committed, 1);
  assert.equal(state.rolledBack, 0);
  assert.equal(state.released, 1);
  assert.equal(state.tenantQueries[0]?.params?.[0], 'tenant-1');
  assert.equal(cookieCalls[0]?.name, 'refresh_token');
  assert.equal(cookieCalls[0]?.value, 'refresh-token');
  assert.equal(cookieCalls[0]?.options?.path, '/');
  assert.equal(redirectTarget, '');
  assert.deepEqual(result, {
    access_token: 'access-token',
    expires_in: 900,
    refresh_expires_in: 14_400,
    redirectTo: '/dashboard',
  });
}

async function testStartSetupDoesNotSetNonceCookie() {
  const cookieCalls: Array<{ name: string; value: string; options: Record<string, any> }> = [];
  const buildCalls: any[] = [];
  const controller = new EntraController(
    {
      buildAuthorizationUrl: async (params: any) => {
        buildCalls.push(params);
        return {
          url: 'https://login.microsoftonline.com/authorize',
          nonce: 'nonce-from-service',
          state: 'signed-state',
        };
      },
    } as any,
    {} as any,
    {} as any,
    { touchLastLogin: async () => undefined } as any,
    {} as any,
    { log: async () => undefined } as any,
    { notifySsoUserProvisioned: async () => undefined } as any,
    fakeDirectorySync(managerSyncCalls) as any,
  );

  const result = await controller.startSetup(
    {
      tenant: {
        id: 'tenant-1',
      },
    } as any,
  );

  assert.deepEqual(buildCalls[0], {
    mode: 'setup',
    tenantId: 'tenant-1',
    redirectTo: '/admin/auth',
  });
  assert.deepEqual(result, { url: 'https://login.microsoftonline.com/authorize' });
  assert.equal(cookieCalls.length, 0);
}

async function testStartLoginDoesNotSetNonceCookie() {
  const cookieCalls: Array<{ name: string; value: string; options: Record<string, any> }> = [];
  const buildCalls: any[] = [];
  let redirectTarget = '';
  const controller = new EntraController(
    {
      buildAuthorizationUrl: async (params: any) => {
        buildCalls.push(params);
        return {
          url: 'https://login.microsoftonline.com/authorize',
          nonce: 'nonce-from-service',
          state: 'signed-state',
        };
      },
    } as any,
    {
      findById: async () => ({
        id: 'tenant-1',
        sso_provider: 'entra',
        entra_tenant_id: 'entra-tenant-1',
      }),
    } as any,
    {} as any,
    { touchLastLogin: async () => undefined } as any,
    {} as any,
    { log: async () => undefined } as any,
    { notifySsoUserProvisioned: async () => undefined } as any,
    fakeDirectorySync(managerSyncCalls) as any,
  );

  await controller.startLogin(
    {
      tenant: {
        id: 'tenant-1',
      },
      query: {
        redirectTo: '/admin/auth',
      },
    },
    {
      cookie: (name: string, value: string, options: Record<string, any>) => {
        cookieCalls.push({ name, value, options });
      },
      redirect: (value: string) => {
        redirectTarget = value;
      },
    } as any,
  );

  assert.deepEqual(buildCalls[0], {
    mode: 'login',
    tenantId: 'tenant-1',
    redirectTo: '/admin/auth',
  });
  assert.equal(redirectTarget, 'https://login.microsoftonline.com/authorize');
  assert.equal(cookieCalls.length, 0);
}

/** Runs `fn` with the given environment values, then restores them. */
async function withEnv(values: Record<string, string | undefined>, fn: () => Promise<void>) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function run() {
  // A local development host keeps the redirect on that host in development mode only
  // (common/url.ts); the other modes are covered in common/__tests__/app-links.spec.ts.
  await withEnv({ APP_ENV: 'development', NODE_ENV: undefined }, testHandleLoginCallbackRedirectsToTenantSessionHandoff);
  await testCompleteLoginSessionSignsTokensOnTenantHost();
  await testStartSetupDoesNotSetNonceCookie();
  await testStartLoginDoesNotSetNonceCookie();
}

void run();
