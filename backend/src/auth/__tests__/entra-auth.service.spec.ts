import * as assert from 'node:assert/strict';
import * as jwt from 'jsonwebtoken';
import { BadRequestException } from '@nestjs/common';
import { EntraAuthService } from '../entra-auth.service';
import { ENTRA_LOGIN_HANDOFF_TYPE, ENTRA_STATE_PURPOSE } from '../access-token.util';

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
    assert.equal(state.tenantId, 'tenant-1');
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

    const signed = jwt.sign(
      { purpose: ENTRA_STATE_PURPOSE, mode: 'login', tenantId: 'tenant-1', nonce: 'nonce-1' },
      'test-entra-state-secret',
      { algorithm: 'HS256' },
    );
    assert.equal(verifyState(signed).tenantId, 'tenant-1');

    // Same key, same claims, no marker: a token that merely verifies is not a state.
    const untyped = jwt.sign(
      { mode: 'login', tenantId: 'tenant-1', nonce: 'nonce-1' },
      'test-entra-state-secret',
      { algorithm: 'HS256' },
    );
    assert.throws(() => verifyState(untyped), (error: unknown) => error instanceof BadRequestException);

    // Another family's marker on the state key.
    const foreign = jwt.sign(
      { purpose: 'access', mode: 'login', tenantId: 'tenant-1', nonce: 'nonce-1' },
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

async function run() {
  await testBuildAuthorizationUrlEmbedsNonceInSignedState();
  await testVerifyStateRequiresTheStatePurposeMarker();
  await testLoginHandoffKeepsItsOwnMarkerAndKey();
}

void run();
