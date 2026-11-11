import * as assert from 'node:assert/strict';
import * as jwt from 'jsonwebtoken';
import { BadRequestException } from '@nestjs/common';
import { EntraAuthService } from '../entra-auth.service';
import { ENTRA_LOGIN_HANDOFF_TYPE, ENTRA_STATE_PURPOSE, FOREIGN_TOKEN_MARKERS } from '../access-token.util';

function createService() {
  return new EntraAuthService({
    get: (key: string) => ({
      ENTRA_CLIENT_ID: 'client-id-1',
      ENTRA_CLIENT_SECRET: 'client-secret-1',
      ENTRA_REDIRECT_URI: 'https://dev.kanap.net/api/auth/entra/callback',
      ENTRA_AUTHORITY: 'https://login.microsoftonline.com/organizations',
    } as Record<string, string>)[key],
  } as any);
}

async function withStateSecret(secret: string | undefined, fn: () => Promise<void> | void) {
  const previous = process.env.ENTRA_STATE_SECRET;
  if (secret === undefined) delete process.env.ENTRA_STATE_SECRET;
  else process.env.ENTRA_STATE_SECRET = secret;
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env.ENTRA_STATE_SECRET;
    else process.env.ENTRA_STATE_SECRET = previous;
  }
}

async function testBuildAuthorizationUrlEmbedsNonceInSignedState() {
  const previousStateSecret = process.env.ENTRA_STATE_SECRET;
  process.env.ENTRA_STATE_SECRET = 'test-entra-state-secret';

  try {
    const service = new EntraAuthService({
      get: (key: string) => ({
        ENTRA_CLIENT_ID: 'client-id-1',
        ENTRA_CLIENT_SECRET: 'client-secret-1',
        ENTRA_REDIRECT_URI: 'https://dev.kanap.net/api/auth/entra/callback',
        ENTRA_AUTHORITY: 'https://login.microsoftonline.com/organizations',
      } as Record<string, string>)[key],
    } as any);

    (service as any).loadMetadata = async () => ({
      issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0',
      authorization_endpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
      token_endpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
      jwks_uri: 'https://login.microsoftonline.com/organizations/discovery/v2.0/keys',
    });

    const result = await service.buildAuthorizationUrl({
      mode: 'login',
      tenantId: 'tenant-1',
      redirectTo: '/admin/auth',
    });

    const url = new URL(result.url);
    const urlNonce = url.searchParams.get('nonce');
    const stateRaw = url.searchParams.get('state');

    assert.ok(urlNonce);
    assert.ok(stateRaw);
    assert.equal(result.nonce, urlNonce);

    const state = jwt.verify(stateRaw, 'test-entra-state-secret') as any;
    assert.equal(state.mode, 'login');
    // The readable part of the state names no workspace: only the service reads the reference.
    assert.equal(state.tenantId, undefined);
    assert.ok(!Buffer.from(stateRaw.split('.')[1], 'base64url').toString('utf8').includes('tenant-1'));
    assert.equal((service as any).verifyState(stateRaw).tenantId, 'tenant-1');
    assert.equal(state.redirectTo, '/admin/auth');
    assert.equal(state.nonce, urlNonce);
    // Explicit typing of the SSO state family (RFC 8725 §3.12).
    assert.equal(state.purpose, ENTRA_STATE_PURPOSE);
  } finally {
    if (previousStateSecret === undefined) {
      delete process.env.ENTRA_STATE_SECRET;
    } else {
      process.env.ENTRA_STATE_SECRET = previousStateSecret;
    }
  }
}

async function testVerifyStateRequiresTheStatePurposeMarker() {
  process.env.JWT_SECRET = 'entra-auth-spec-jwt-secret';
  await withStateSecret('test-entra-state-secret', () => {
    const service = createService();
    const verifyState = (token: string) => (service as any).verifyState(token) as { purpose: string; tenantId: string };

    const tenant = (service as any).sealTenantId('tenant-1') as string;

    const signed = jwt.sign(
      { purpose: ENTRA_STATE_PURPOSE, mode: 'login', tenant, nonce: 'nonce-1' },
      'test-entra-state-secret',
      { algorithm: 'HS256' },
    );
    assert.equal(verifyState(signed).tenantId, 'tenant-1');

    // Same key, same claims, no marker: a token that merely verifies is not a state.
    const untyped = jwt.sign(
      { mode: 'login', tenant, nonce: 'nonce-1' },
      'test-entra-state-secret',
      { algorithm: 'HS256' },
    );
    assert.throws(() => verifyState(untyped), (error: unknown) => error instanceof BadRequestException);

    // Another family's marker on the state key.
    const foreign = jwt.sign(
      { purpose: 'access', mode: 'login', tenant, nonce: 'nonce-1' },
      'test-entra-state-secret',
      { algorithm: 'HS256' },
    );
    assert.throws(() => verifyState(foreign), (error: unknown) => error instanceof BadRequestException);
  });
}

async function testLoginHandoffKeepsItsOwnMarkerAndKey() {
  process.env.JWT_SECRET = 'entra-auth-spec-jwt-secret';
  const stateSecret = 'test-entra-state-secret';
  await withStateSecret(stateSecret, () => {
    const service = createService();
    const token = service.signLoginHandoff({ tenantId: 'tenant-1', userId: 'user-1' });

    // Not signed with the access-token secret: the guard cannot verify it, let alone use it.
    assert.throws(() => jwt.verify(token, process.env.JWT_SECRET as string), /invalid signature/);
    assert.doesNotThrow(() => jwt.verify(token, stateSecret));

    const decoded = jwt.decode(token) as Record<string, unknown>;
    assert.equal(decoded.type, ENTRA_LOGIN_HANDOFF_TYPE);
    assert.equal(decoded.purpose, undefined, 'the handoff is typed by `type`, not by `purpose`');
    assert.equal(service.verifyLoginHandoff(token).userId, 'user-1');

    // Should an operator ever point both families at the same key, the `type` marker still
    // identifies the handoff as a foreign family (see `checkAccessTokenPurpose`).
    const sameKey = jwt.verify(token, stateSecret) as Record<string, unknown>;
    assert.equal(sameKey.type, ENTRA_LOGIN_HANDOFF_TYPE);
    assert.equal(sameKey.purpose, undefined);
  });
}

/**
 * The admin-consent address carries a state signed with the state key, typed for that use, short
 * lived and naming the workspace. Sign-in and consent states do not stand in for each other.
 */
async function testConsentStateIsSignedForItsOwnUse() {
  process.env.JWT_SECRET = 'entra-auth-spec-jwt-secret';
  const stateSecret = 'test-entra-state-secret';
  await withStateSecret(stateSecret, async () => {
    const service = createService();
    (service as any).logger = { warn: () => undefined, error: () => undefined };
    (service as any).loadMetadata = async () => ({
      authorization_endpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
      token_endpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
    });
    const verifyConsentState = (token: string) => (service as any).verifyConsentState(token) as { tenantId: string };
    const verifyState = (token: string) => (service as any).verifyState(token);
    const refused = (error: unknown) => error instanceof BadRequestException && error.message === 'Invalid Entra state';

    const url = new URL(service.buildAdminConsentUrl('directory-1', 'tenant-1') as string);
    // Same consent address and return address as before: only the state changes.
    assert.equal(`${url.origin}${url.pathname}`, 'https://login.microsoftonline.com/directory-1/v2.0/adminconsent');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://dev.kanap.net/api/auth/entra/callback');
    assert.equal(url.searchParams.get('client_id'), 'client-id-1');

    const state = url.searchParams.get('state') as string;
    assert.ok(state.startsWith('consent:'));
    const token = state.slice('consent:'.length);
    const payload = jwt.verify(token, stateSecret) as Record<string, any>;
    assert.equal(payload.tenantId, 'tenant-1');
    assert.equal(typeof payload.purpose, 'string');
    assert.notEqual(payload.purpose, ENTRA_STATE_PURPOSE, 'a use of its own');
    assert.ok(FOREIGN_TOKEN_MARKERS.includes(payload.purpose), 'never an access token');
    assert.ok(payload.exp - payload.iat > 0 && payload.exp - payload.iat <= 3600, 'short lived');
    assert.throws(() => jwt.verify(token, process.env.JWT_SECRET as string), /invalid signature/);

    assert.equal(verifyConsentState(token).tenantId, 'tenant-1');

    // A consent state is not a sign-in state, and a sign-in or setup state is not a consent state.
    assert.throws(() => verifyState(token), refused);
    await assert.rejects(() => service.handleCallback({ code: 'code-1', state: token }), refused);
    for (const mode of ['login', 'setup'] as const) {
      const signIn = await service.buildAuthorizationUrl({ mode, tenantId: 'tenant-1' });
      assert.throws(() => verifyConsentState(signIn.state), refused, mode);
    }
    assert.throws(() => verifyConsentState(service.signLoginHandoff({ tenantId: 'tenant-1', userId: 'user-1' })), refused);

    // Not signed, signed with another key, without the marker, without a workspace, expired.
    const { purpose } = payload;
    assert.throws(() => verifyConsentState('tenant-1'), refused);
    assert.throws(() => verifyConsentState(''), refused);
    assert.throws(() => verifyConsentState(jwt.sign({ purpose, tenantId: 'tenant-1' }, 'another-key', { expiresIn: '5m' })), refused);
    assert.throws(() => verifyConsentState(jwt.sign({ tenantId: 'tenant-1' }, stateSecret, { expiresIn: '5m' })), refused);
    assert.throws(() => verifyConsentState(jwt.sign({ purpose }, stateSecret, { expiresIn: '5m' })), refused);
    assert.throws(() => verifyConsentState(jwt.sign({ purpose, tenantId: 'tenant-1' }, stateSecret, { expiresIn: -60 })), refused);
    // A state without an expiry is not short lived.
    assert.throws(() => verifyConsentState(jwt.sign({ purpose, tenantId: 'tenant-1' }, stateSecret)), refused);
    assert.equal(verifyConsentState(jwt.sign({ purpose, tenantId: 'tenant-1' }, stateSecret, { expiresIn: '5m' })).tenantId, 'tenant-1');
  });
}

/**
 * A sign-in state is handed out before anyone signs in: it names the workspace by a reference
 * only this application reads. A state built elsewhere names no workspace.
 */
async function testStateNamesTheWorkspaceBySealedReference() {
  process.env.JWT_SECRET = 'entra-auth-spec-jwt-secret';
  const stateSecret = 'test-entra-state-secret';
  const metadata = async () => ({
    authorization_endpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
    token_endpoint: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
  });
  const readable = (token: string) => Buffer.from(token.split('.')[1], 'base64url').toString('utf8');
  const workspace = '11111111-1111-4111-8111-111111111111';

  let otherKeyState = '';
  await withStateSecret('another-entra-state-secret', async () => {
    const other = createService();
    (other as any).loadMetadata = metadata;
    otherKeyState = (await other.buildAuthorizationUrl({ mode: 'login', tenantId: workspace })).state;
  });

  await withStateSecret(stateSecret, async () => {
    const service = createService();
    (service as any).logger = { warn: () => undefined, error: () => undefined };
    (service as any).loadMetadata = metadata;
    const verifyState = (token: string) => (service as any).verifyState(token) as { tenantId: string; mode: string };

    for (const mode of ['login', 'setup'] as const) {
      const first = (await service.buildAuthorizationUrl({ mode, tenantId: workspace })).state;
      const second = (await service.buildAuthorizationUrl({ mode, tenantId: workspace })).state;
      for (const state of [first, second]) {
        assert.ok(!readable(state).includes(workspace), `${mode}: the workspace id is not readable`);
        assert.equal((jwt.decode(state) as any).tenantId, undefined);
        assert.equal(verifyState(state).tenantId, workspace);
        assert.deepEqual(service.peekState(state), { mode, tenantId: workspace });
      }
      assert.notEqual((jwt.decode(first) as any).tenant, (jwt.decode(second) as any).tenant, 'a fresh reference each time');
    }

    // Signed by the application's key, but naming the workspace by its id: not a state.
    const byId = { purpose: ENTRA_STATE_PURPOSE, mode: 'login', nonce: 'nonce-1' };
    for (const naming of [{ tenantId: workspace }, { tenant: workspace }, { tenantId: workspace, tenant: workspace }]) {
      const token = jwt.sign({ ...byId, ...naming }, stateSecret, { algorithm: 'HS256', expiresIn: '10m' });
      assert.throws(() => verifyState(token), (error: unknown) => error instanceof BadRequestException);
      assert.equal(service.peekState(token)?.tenantId, undefined);
    }

    // A state built elsewhere, a reference sealed with another key, an altered reference: no workspace.
    assert.equal(service.peekState(jwt.sign({ mode: 'login', tenantId: workspace }, 'another-key'))?.tenantId, undefined);
    assert.equal(service.peekState(otherKeyState)?.tenantId, undefined);
    assert.throws(() => verifyState(otherKeyState), (error: unknown) => error instanceof BadRequestException);
    const reference = (jwt.decode((await service.buildAuthorizationUrl({ mode: 'login', tenantId: workspace })).state) as any).tenant as string;
    const altered = Buffer.from(reference, 'base64url');
    altered[altered.length - 1] ^= 1;
    for (const tenant of [altered.toString('base64url'), reference.slice(0, 20), '', 42, null]) {
      const token = jwt.sign({ ...byId, tenant }, stateSecret, { algorithm: 'HS256', expiresIn: '10m' });
      assert.throws(() => verifyState(token), (error: unknown) => error instanceof BadRequestException);
      assert.equal(service.peekState(token)?.tenantId, undefined);
    }
    assert.equal(service.peekState('not-a-token'), null);

    // A reference copied into a state the application did not sign, or signed for another use:
    // neither workspace nor mode.
    const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    for (const mode of ['login', 'setup']) {
      const copied = { purpose: ENTRA_STATE_PURPOSE, mode, nonce: 'nonce-1', tenant: reference };
      assert.equal(service.peekState(jwt.sign(copied, 'another-key', { expiresIn: '10m' })), null);
      assert.equal(service.peekState(`${b64({ alg: 'none', typ: 'JWT' })}.${b64(copied)}.`), null);
      assert.equal(service.peekState(`${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(copied)}.${b64('x')}`), null);
      assert.equal(service.peekState(jwt.sign({ ...copied, purpose: 'access' }, stateSecret, { expiresIn: '10m' })), null);
      assert.equal(service.peekState(jwt.sign({ mode, nonce: 'nonce-1', tenant: reference }, stateSecret, { expiresIn: '10m' })), null);
    }
    // A state the application signed still names its workspace and mode once past its lifetime.
    const past = jwt.sign({ purpose: ENTRA_STATE_PURPOSE, mode: 'setup', nonce: 'nonce-1', tenant: reference }, stateSecret, { expiresIn: -60 });
    assert.deepEqual(service.peekState(past), { mode: 'setup', tenantId: workspace });
  });
}

async function run() {
  await testBuildAuthorizationUrlEmbedsNonceInSignedState();
  await testVerifyStateRequiresTheStatePurposeMarker();
  await testLoginHandoffKeepsItsOwnMarkerAndKey();
  await testConsentStateIsSignedForItsOwnUse();
  await testStateNamesTheWorkspaceBySealedReference();
}

void run();
