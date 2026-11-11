import * as assert from 'node:assert/strict';
import * as jwt from 'jsonwebtoken';
import { BadRequestException } from '@nestjs/common';
import { EntraAuthService } from '../entra-auth.service';
import { ENTRA_STATE_PURPOSE } from '../access-token.util';
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

/**
 * An invitation ends at the first sign-in: a local account invited by e-mail (status "invited")
 * is linked to its Microsoft identity and enabled by its first Microsoft sign-in. A disabled
 * account is linked but stays disabled, and the session is then refused as before.
 */
async function testFirstMicrosoftSignInEndsTheInvitation() {
  for (const status of ['invited', 'disabled', 'enabled']) {
    const localUser: any = {
      id: 'user-2',
      email: 'julie.martin@example.com',
      status,
      role: { role_name: 'Reader' },
      first_name: 'Julie',
      last_name: 'Martin',
      external_auth_provider: null,
      external_subject: null,
    };
    const saved: any[] = [];
    const repo = {
      // No account carries this Microsoft identity yet: the local account is found by its e-mail.
      findOne: async () => null,
      save: async (value: any) => { saved.push({ ...value }); return value; },
      createQueryBuilder: () => ({
        leftJoinAndSelect: () => repo.createQueryBuilder(),
        where: () => repo.createQueryBuilder(),
        getOne: async () => localUser,
      }),
    };
    const { dataSource } = createMockDataSource(repo);
    const enabled: Array<{ id: string; manager: unknown }> = [];
    const controller = new EntraController(
      { signLoginHandoff: () => 'handoff-token' } as any,
      {} as any,
      {} as any,
      {
        enableUser: async (id: string, _actor: string | null, opts: { manager: unknown }) => {
          enabled.push({ id, manager: opts.manager });
          return { id, status: 'enabled' };
        },
      } as any,
      dataSource as any,
      { log: async () => undefined } as any,
      { notifySsoUserProvisioned: async () => undefined } as any,
      fakeDirectorySync([]) as any,
      securityEvents as any,
    );

    await (controller as any).handleLoginCallback(
      'tenant-1',
      'alpha',
      '/',
      { oid: 'entra-oid-2', email: 'julie.martin@example.com' },
      {},
      { headers: { host: 'alpha.lvh.me' }, protocol: 'http' },
      { cookie: () => undefined, redirect: () => undefined } as any,
    );

    const last = saved.at(-1);
    assert.equal(last.external_auth_provider, 'entra', `${status}: linked`);
    assert.equal(last.external_subject, 'entra-oid-2');
    if (status === 'invited') {
      assert.deepEqual(enabled.map((call) => call.id), ['user-2'], 'the invited account is enabled');
      assert.ok(enabled[0].manager, 'inside the sign-in transaction');
      assert.equal(last.status, 'enabled', 'the later save keeps it enabled');
    } else {
      assert.equal(enabled.length, 0, `${status}: not touched`);
      assert.equal(last.status, status);
    }
  }
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

const WORKSPACE_A = { id: '11111111-1111-4111-8111-111111111111', slug: 'alpha', sso_provider: 'entra', entra_tenant_id: 'aaaaaaaa-0000-4000-8000-00000000000a' };
const WORKSPACE_B = { id: '22222222-2222-4222-8222-222222222222', slug: 'beta', sso_provider: 'entra', entra_tenant_id: 'bbbbbbbb-0000-4000-8000-00000000000b' };

/**
 * The controller on the real state signing, with everything a consent return may touch recorded:
 * workspace lookups, audit entries (with the workspace of their transaction), directory syncs,
 * dropped application tokens and redirects.
 */
function consentHarness(workspaces: Array<Record<string, any>> = [WORKSPACE_A, WORKSPACE_B]) {
  const entra = new EntraAuthService({
    get: (key: string) => ({
      ENTRA_CLIENT_ID: 'client-id-1',
      ENTRA_CLIENT_SECRET: 'client-secret-1',
      ENTRA_REDIRECT_URI: 'https://app.example.test/api/auth/entra/callback',
      ENTRA_AUTHORITY: 'https://login.microsoftonline.com/organizations',
    } as Record<string, string>)[key],
  } as any);
  (entra as any).loadMetadata = async () => ({
    authorization_endpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
    token_endpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
  });
  (entra as any).logger = { warn: () => undefined, error: () => undefined };
  const droppedTokens: string[] = [];
  entra.invalidateAppToken = (directory: string) => { droppedTokens.push(directory); };

  const { dataSource, state } = createMockDataSource({});
  const lookups: string[] = [];
  const auditEntries: Array<{ workspace: unknown; entry: any }> = [];
  const syncs: string[] = [];
  const redirects: string[] = [];
  const controller = new EntraController(
    entra,
    { findById: async (id: string) => { lookups.push(id); return workspaces.find((w) => w.id === id) ?? null; } } as any,
    {} as any,
    {} as any,
    dataSource as any,
    {
      log: async (entry: any) => {
        const scoped = state.tenantQueries.filter((q) => q.params?.length);
        auditEntries.push({ workspace: scoped.at(-1)?.params?.[0], entry });
      },
    } as any,
    {} as any,
    { syncTenant: async (id: string) => { syncs.push(id); return { status: 'ok' }; } } as any,
    securityEvents as any,
  );
  (controller as any).logger = { warn: () => undefined };

  /** The state of the consent address the settings page of `workspace` receives. */
  const consentState = (workspace: Record<string, any>) =>
    new URL(entra.buildAdminConsentUrl(workspace.entra_tenant_id, workspace.id) as string).searchParams.get('state') as string;
  const back = (query: Record<string, unknown>, request: Record<string, unknown> = {}) =>
    controller.callback({ ...browser, ...request, query }, { cookie: () => undefined, redirect: (to: string) => { redirects.push(to); } } as any);
  return { entra, controller, state, lookups, auditEntries, syncs, droppedTokens, redirects, consentState, back };
}

/**
 * The consent return acts only on a state this application signed for that use, within its
 * lifetime. Any other state is refused before anything is read or written.
 */
async function testConsentReturnNeedsAStateSignedForConsent() {
  const providerText = 'text sent back by the provider';
  const refused = async (label: string, state: (h: ReturnType<typeof consentHarness>) => Promise<string> | string, at?: () => number) => {
    const h = consentHarness();
    const value = await state(h);
    const realNow = Date.now;
    if (at) Date.now = at;
    authEvents.length = 0;
    try {
      for (const extra of [
        { admin_consent: 'true', tenant: WORKSPACE_A.entra_tenant_id },
        { admin_consent: 'true' },
        { admin_consent: 'false', error: 'access_denied', error_description: providerText },
      ]) {
        await assert.rejects(
          () => h.back({ state: value, ...extra }),
          (error: unknown) => error instanceof BadRequestException && !String((error as Error).message).includes(providerText),
          `${label}: refused`,
        );
      }
    } finally {
      Date.now = realNow;
    }
    assert.deepEqual(h.auditEntries, [], `${label}: no audit entry`);
    assert.equal(h.state.started, 0, `${label}: no transaction`);
    assert.deepEqual(h.syncs, [], `${label}: no directory sync`);
    assert.deepEqual(h.droppedTokens, [], `${label}: no application token dropped`);
    assert.deepEqual(h.lookups, [], `${label}: no workspace read`);
    assert.deepEqual(h.redirects, [], `${label}: no redirect`);
    assert.deepEqual(await recordedEvents(), [], `${label}: no sign-in event`);
  };

  await refused('a workspace id without a signature', () => `consent:${WORKSPACE_A.id}`);
  await refused('an empty state', () => 'consent:');
  await refused('a state signed with another key', (h) => {
    const [header, payload] = h.consentState(WORKSPACE_A).slice('consent:'.length).split('.');
    return `consent:${header}.${payload}.${Buffer.from('another signature').toString('base64url')}`;
  });
  await refused('a state past its lifetime', (h) => h.consentState(WORKSPACE_A), () => new Date().getTime() + 24 * 3600 * 1000);
  await refused('a sign-in state', async (h) => {
    const { state } = await h.entra.buildAuthorizationUrl({ mode: 'login', tenantId: WORKSPACE_A.id });
    return `consent:${state}`;
  });
  await refused('a setup state', async (h) => {
    const { state } = await h.entra.buildAuthorizationUrl({ mode: 'setup', tenantId: WORKSPACE_A.id });
    return `consent:${state}`;
  });

  // And the other way round: a consent state does not complete a sign-in.
  const h = consentHarness();
  const consentToken = h.consentState(WORKSPACE_A).slice('consent:'.length);
  await assert.rejects(() => h.entra.handleCallback({ code: 'code-1', state: consentToken }), /Invalid Entra state/);
}

/**
 * With a valid state, the entry is written in the workspace the state names, and the consent is
 * granted only when the directory that answered is the one the workspace is connected to.
 */
async function testConsentIsGrantedOnlyForTheWorkspaceDirectory() {
  const granted = consentHarness();
  // Microsoft answers `admin_consent=True`.
  await granted.back({ state: granted.consentState(WORKSPACE_A), admin_consent: 'True', tenant: WORKSPACE_A.entra_tenant_id });
  assert.equal(granted.auditEntries.length, 1);
  assert.equal(granted.auditEntries[0].workspace, WORKSPACE_A.id, 'written in the workspace of the state');
  assert.equal(granted.auditEntries[0].entry.recordId, WORKSPACE_A.id);
  assert.equal(granted.auditEntries[0].entry.sourceRef, 'entra-admin-consent');
  assert.deepEqual(granted.auditEntries[0].entry.after, {
    directory_sync_consent: true,
    error: null,
    consented_directory: WORKSPACE_A.entra_tenant_id,
  });
  assert.deepEqual(granted.lookups, [WORKSPACE_A.id], 'no other workspace is read');
  assert.deepEqual(granted.syncs, [WORKSPACE_A.id]);
  assert.deepEqual(granted.droppedTokens, [WORKSPACE_A.entra_tenant_id]);
  assert.deepEqual(granted.redirects, ['http://alpha.lvh.me/admin/auth?consent=success']);

  const notGranted: Array<[string, Record<string, unknown>, Array<Record<string, any>>?]> = [
    ['no directory in the answer', { admin_consent: 'true' }],
    ['another directory', { admin_consent: 'true', tenant: WORKSPACE_B.entra_tenant_id }],
    ['a directory given twice', { admin_consent: 'true', tenant: [WORKSPACE_A.entra_tenant_id, WORKSPACE_A.entra_tenant_id] }],
    ['consent refused', { admin_consent: 'false', tenant: WORKSPACE_A.entra_tenant_id }],
    ['a workspace without a directory', { admin_consent: 'true', tenant: 'null' }, [{ ...WORKSPACE_A, sso_provider: 'none', entra_tenant_id: null }]],
    ['a workspace without a directory, no directory in the answer', { admin_consent: 'true' }, [{ ...WORKSPACE_A, sso_provider: 'none', entra_tenant_id: null }]],
  ];
  for (const [label, query, workspaces] of notGranted) {
    const h = consentHarness(workspaces);
    await h.back({ state: h.consentState(WORKSPACE_A), ...query });
    assert.equal(h.auditEntries.length, 1, `${label}: one entry`);
    assert.equal(h.auditEntries[0].workspace, WORKSPACE_A.id, `${label}: in the workspace of the state`);
    assert.equal(h.auditEntries[0].entry.after.directory_sync_consent, false, `${label}: not granted`);
    assert.deepEqual(h.syncs, [], `${label}: no directory sync`);
    assert.deepEqual(h.droppedTokens, [], `${label}: no application token dropped`);
    assert.deepEqual(h.redirects, ['http://alpha.lvh.me/admin/auth?consent=error'], label);
  }

  // The provider's text is kept for a valid state, cut to a bounded length.
  const long = consentHarness();
  await long.back({
    state: long.consentState(WORKSPACE_A),
    admin_consent: 'false',
    error: 'access_denied',
    error_description: 'd'.repeat(5000),
    tenant: 't'.repeat(5000),
  });
  const after = long.auditEntries[0].entry.after;
  assert.equal(after.directory_sync_consent, false);
  assert.ok(after.error.length <= 300 && after.error.startsWith('ddd'), 'the error text is bounded');
  assert.ok(after.consented_directory.length <= 100, 'the directory text is bounded');
}

/**
 * A failed return lands on a workspace's page only for a state this application signed. A state
 * signed elsewhere reads no workspace and no mode, whatever it carries, and gets the plain error.
 */
async function testFailedReturnReadsAWorkspaceOnlyFromAnApplicationState() {
  const h = consentHarness();
  for (const naming of [{ tenantId: WORKSPACE_A.id }, { tenant: WORKSPACE_A.id }]) {
    const elsewhere = jwt.sign({ purpose: 'elsewhere', mode: 'login', nonce: 'nonce-1', ...naming }, 'another-key');
    await assert.rejects(() => h.back({ code: 'code-1', state: elsewhere }), /Invalid Entra state/);
  }
  assert.deepEqual(h.lookups, [], 'no workspace read');
  assert.deepEqual(h.redirects, [], 'no redirect');

  // A state of the application past its lifetime: the sign-in page of its workspace, with a short code.
  const { state } = await h.entra.buildAuthorizationUrl({ mode: 'login', tenantId: WORKSPACE_A.id });
  const realNow = Date.now;
  Date.now = () => new Date().getTime() + 3600 * 1000;
  try {
    await h.back({ code: 'code-1', state });
  } finally {
    Date.now = realNow;
  }
  assert.deepEqual(h.lookups, [WORKSPACE_A.id]);
  assert.deepEqual(h.redirects, ['http://alpha.lvh.me/login?ssoError=SSO_FAILED']);
  assert.deepEqual(h.auditEntries, []);

  // The reference of a sign-in redirect, copied into a state the application did not sign: it
  // picks no workspace and no mode, and the failed sign-in is recorded for the host's workspace.
  const copied = consentHarness();
  const issued = await copied.entra.buildAuthorizationUrl({ mode: 'login', tenantId: WORKSPACE_A.id });
  const reference = (jwt.decode(issued.state) as { tenant: string }).tenant;
  authEvents.length = 0;
  for (const mode of ['setup', 'login']) {
    const elsewhere = jwt.sign({ purpose: ENTRA_STATE_PURPOSE, mode, nonce: 'nonce-1', tenant: reference }, 'another-key', { expiresIn: '10m' });
    await assert.rejects(
      () => copied.back({ code: 'code-1', state: elsewhere }, { tenant: { id: WORKSPACE_B.id } }),
      /Invalid Entra state/,
      `${mode}: the plain error`,
    );
  }
  assert.deepEqual(copied.redirects, [], 'no redirect');
  assert.ok(!copied.lookups.includes(WORKSPACE_A.id), 'the workspace of the reference is not read');
  const failure = { tenantId: WORKSPACE_B.id, event: { action: 'sso_login_failed', reason: 'invalid_state' } };
  assert.deepEqual(await recordedEvents(), [failure, failure]);
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
  await withEnv({ APP_ENV: 'development', NODE_ENV: undefined }, testFirstMicrosoftSignInEndsTheInvitation);
  await testCompleteLoginSessionSignsTokensOnTenantHost();
  await testStartSetupDoesNotSetNonceCookie();
  await testStartLoginDoesNotSetNonceCookie();
  await testRefusedSsoSessionsAreRecorded();
  await withEnv({ APP_ENV: 'development', NODE_ENV: undefined }, testFailedSsoRoundTripsAreRecordedInATrustedTenant);
  await withEnv({ ENTRA_STATE_SECRET: 'entra-controller-spec-state-secret' }, testConsentReturnNeedsAStateSignedForConsent);
  await withEnv(
    { APP_ENV: 'development', NODE_ENV: undefined, ENTRA_STATE_SECRET: 'entra-controller-spec-state-secret' },
    testConsentIsGrantedOnlyForTheWorkspaceDirectory,
  );
  await withEnv(
    { APP_ENV: 'development', NODE_ENV: undefined, ENTRA_STATE_SECRET: 'entra-controller-spec-state-secret' },
    testFailedReturnReadsAWorkspaceOnlyFromAnApplicationState,
  );
}

void run();
