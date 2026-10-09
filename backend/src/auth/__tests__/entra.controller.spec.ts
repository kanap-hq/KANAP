import * as assert from 'node:assert/strict';
import { mergeScalarFields, resolveDirectoryNames } from '../entra-directory-sync.util';
import { waitForBackgroundWork } from '../../common/background-work';
import { EntraController, ssoFailureReason } from '../entra.controller';

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

/** Records the sign-in events the controller hands to the security log. */
const authEvents: Array<{ tenantId: string | null | undefined; event: any }> = [];
const securityEvents = {
  recordAuthEvent: async (tenantId: string | null | undefined, event: any) => {
    authEvents.push({ tenantId, event });
  },
};

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
    securityEvents as any,
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
    securityEvents as any,
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
  // The session issued is a single sign-on sign-in of the hand-off's account, in the host's tenant.
  assert.deepEqual(authEvents.at(-1), { tenantId: 'tenant-1', event: { action: 'sso_login', userId: 'user-1' } });
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
    securityEvents as any,
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
    securityEvents as any,
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

/** Single sign-on set up for every tenant (`entra`), or for none (`none`). */
function ssoController(entra: Record<string, unknown>, repo: any = { findOne: async () => null }, sso: 'entra' | 'none' = 'entra') {
  const { dataSource } = createMockDataSource(repo);
  return new EntraController(
    { peekState: () => null, ...entra } as any,
    {
      findById: async (id: string) => (sso === 'entra'
        ? { id, slug: 'alpha', sso_provider: 'entra', entra_tenant_id: 'entra-tenant-1' }
        : { id, slug: 'alpha', sso_provider: 'none', entra_tenant_id: null }),
    } as any,
    { signTokens: async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 900, refresh_expires_in: 14_400 }) } as any,
    { touchLastLogin: async () => undefined } as any,
    dataSource as any,
    { log: async () => undefined } as any,
    { notifySsoUserProvisioned: async () => undefined } as any,
    fakeDirectorySync(managerSyncCalls) as any,
    securityEvents as any,
  );
}

const browser = { headers: { host: 'alpha.lvh.me' }, protocol: 'http' };
const noCookies = { cookie: () => undefined, redirect: () => undefined } as any;

/** The events the routes handed over without waiting, once they are all written. */
async function recordedEvents() {
  assert.equal(await waitForBackgroundWork(Date.now() + 2000), 0, 'event writes finished');
  return [...authEvents];
}

async function testRefusedSsoSessionsAreRecorded() {
  // A disabled account behind a valid hand-off: the refusal, with the account, in the host's tenant.
  const handoff = { verifyLoginHandoff: () => ({ tenantId: 'tenant-1', userId: 'user-7', redirectTo: '/' }) };
  const disabled = ssoController(handoff, { findOne: async () => ({ id: 'user-7', status: 'disabled', role: { role_name: 'Member' } }) });
  authEvents.length = 0;
  await assert.rejects(() => disabled.completeLoginSession({ handoff: 'h' }, { ...browser, tenant: { id: 'tenant-1' } }, noCookies), /not allowed/);
  assert.deepEqual(await recordedEvents(), [{ tenantId: 'tenant-1', event: { action: 'sso_login_failed', reason: 'sso_failed', userId: 'user-7' } }]);

  // A hand-off of another tenant, on a host with single sign-on: the host's tenant gets the
  // refusal, without that tenant's account.
  const foreign = ssoController({ verifyLoginHandoff: () => ({ tenantId: 'tenant-2', userId: 'user-8', redirectTo: '/' }) });
  authEvents.length = 0;
  await assert.rejects(() => foreign.completeLoginSession({ handoff: 'h' }, { ...browser, tenant: { id: 'tenant-1' } }, noCookies), /ENTRA_TENANT_MISMATCH/);
  assert.deepEqual(await recordedEvents(), [{ tenantId: 'tenant-1', event: { action: 'sso_login_failed', reason: 'tenant_mismatch', userId: null } }]);

  // A hand-off that does not verify, on a host with single sign-on.
  const invalid = ssoController({ verifyLoginHandoff: () => { throw new Error('Invalid Entra login session'); } });
  authEvents.length = 0;
  await assert.rejects(() => invalid.completeLoginSession({ handoff: 'h' }, { ...browser, tenant: { id: 'tenant-1' } }, noCookies));
  assert.deepEqual(await recordedEvents(), [{ tenantId: 'tenant-1', event: { action: 'sso_login_failed', reason: 'invalid_token', userId: null } }]);

  // On a host without single sign-on, or without a tenant, a request where nothing verifies writes
  // nothing: an invalid hand-off, a hand-off of another tenant, no hand-off at all.
  const plain = (entra: Record<string, unknown>) => ssoController(entra, undefined, 'none');
  authEvents.length = 0;
  for (let i = 0; i < 20; i += 1) {
    await assert.rejects(() => plain({ verifyLoginHandoff: () => { throw new Error('Invalid Entra login session'); } })
      .completeLoginSession({ handoff: `h-${i}` }, { ...browser, tenant: { id: 'tenant-1' } }, noCookies));
  }
  await assert.rejects(() => plain({ verifyLoginHandoff: () => ({ tenantId: 'tenant-2', userId: 'user-8', redirectTo: '/' }) })
    .completeLoginSession({ handoff: 'h' }, { ...browser, tenant: { id: 'tenant-1' } }, noCookies), /ENTRA_TENANT_MISMATCH/);
  await assert.rejects(() => plain({}).completeLoginSession({}, { ...browser, tenant: { id: 'tenant-1' } }, noCookies), /Missing Entra login session/);
  await assert.rejects(() => invalid.completeLoginSession({ handoff: 'h' }, { ...browser }, noCookies), /TENANT_REQUIRED/);
  assert.deepEqual(await recordedEvents(), []);
}

async function testFailedSsoRoundTripsAreRecordedInATrustedTenant() {
  // Failure after the state is verified: the tenant it names gets the event, without the provider's text.
  const mismatch = ssoController({
    handleCallback: async () => ({ mode: 'login', tenantId: 'tenant-1', redirectTo: '/', claims: { tid: 'other-directory' } }),
    peekState: () => ({ mode: 'login', tenantId: 'tenant-1' }),
  });
  authEvents.length = 0;
  await mismatch.callback({ ...browser, query: { code: 'c', state: 's' } }, noCookies);
  assert.deepEqual(await recordedEvents(), [{ tenantId: 'tenant-1', event: { action: 'sso_login_failed', reason: 'tenant_mismatch' } }]);

  // Failure before the state is verified, on the shared callback host (no tenant): nothing written,
  // whatever tenant the unverified state names.
  const unverified = ssoController({
    handleCallback: async () => { throw new Error('Invalid Entra state'); },
    peekState: () => ({ mode: 'login', tenantId: 'tenant-9' }),
  });
  authEvents.length = 0;
  await unverified.callback({ ...browser, query: { code: 'c', state: 's' } }, noCookies);
  assert.deepEqual(await recordedEvents(), []);
  // The same on a host whose tenant has single sign-on set up: that tenant gets it.
  await unverified.callback({ ...browser, tenant: { id: 'tenant-1' }, query: { code: 'c', state: 's' } }, noCookies);
  assert.deepEqual(await recordedEvents(), [{ tenantId: 'tenant-1', event: { action: 'sso_login_failed', reason: 'invalid_state' } }]);

  // A host whose tenant has no single sign-on (a single-tenant installation without Entra): a run
  // of round trips that verify nothing writes nothing.
  const plain = ssoController({
    handleCallback: async () => { throw new Error('Invalid Entra state'); },
    peekState: () => ({ mode: 'login', tenantId: 'tenant-1' }),
  }, undefined, 'none');
  (plain as any).logger = { warn: () => undefined };
  authEvents.length = 0;
  for (let i = 0; i < 20; i += 1) {
    await plain.callback({ ...browser, tenant: { id: 'tenant-1' }, query: { code: `c-${i}`, state: 's' } }, noCookies);
  }
  assert.deepEqual(await recordedEvents(), []);

  // A failed setup round trip is not a sign-in.
  const setup = ssoController({
    handleCallback: async () => ({ mode: 'setup', tenantId: 'tenant-1', redirectTo: '/', claims: {} }),
    peekState: () => ({ mode: 'setup', tenantId: 'tenant-1' }),
  });
  authEvents.length = 0;
  await setup.callback({ ...browser, query: { code: 'c', state: 's' } }, noCookies);
  assert.deepEqual(await recordedEvents(), []);

  assert.equal(ssoFailureReason(new Error('Failed to complete Entra sign-in: AADSTS50011 details')), 'sso_failed');
  assert.equal(ssoFailureReason(new Error('ENTRA_EMAIL_UNVERIFIED')), 'email_unverified');
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
  await testRefusedSsoSessionsAreRecorded();
  await withEnv({ APP_ENV: 'development', NODE_ENV: undefined }, testFailedSsoRoundTripsAreRecordedInATrustedTenant);
}

void run();
