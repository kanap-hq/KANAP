import { KeyObject } from 'crypto';
import * as assert from 'node:assert/strict';
import { UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { ACCESS_TOKEN_PURPOSE } from '../access-token.util';
import { JwtAuthGuard } from '../jwt-auth.guard';
import { accessTokenVerifyKey } from '../jwt-key';

// The access-token verification key is built once (jwt-key.ts). Given the secret string,
// jsonwebtoken tries createPublicKey (which throws) then createSecretKey, on every call.
// Given a KeyObject it does neither (jsonwebtoken verify.js). This spec asserts that shape:
// a secret KeyObject, reused while the secret is unchanged, passed by the access-token guard.

function testKeyIsBuiltOnceAndFollowsTheSecret() {
  const env = { JWT_SECRET: 'jwt-key-spec-secret-1' } as NodeJS.ProcessEnv;
  const first = accessTokenVerifyKey(env);
  assert.ok(first instanceof KeyObject, 'the verification key is a KeyObject');
  assert.equal(first.type, 'secret');
  assert.equal(accessTokenVerifyKey(env), first, 'the same KeyObject is reused');
  const rotated = accessTokenVerifyKey({ JWT_SECRET: 'jwt-key-spec-secret-2' } as NodeJS.ProcessEnv);
  assert.ok(rotated instanceof KeyObject, 'a changed secret still returns a KeyObject');
  assert.equal(rotated.type, 'secret');
  assert.notEqual(rotated, first, 'a changed secret gives a new key');
  assert.throws(() => accessTokenVerifyKey({} as NodeJS.ProcessEnv), /JWT_SECRET/, 'no secret, no key');
}

function testVerifiesExactlyLikeTheSecretString() {
  const secret = 'jwt-key-spec-secret-é-ü';
  const env = { JWT_SECRET: secret } as NodeJS.ProcessEnv;
  const token = jwt.sign({ sub: 'u1', tenant_id: 't1', typ: 'access' }, secret, { expiresIn: 60 });
  const viaKey = jwt.verify(token, accessTokenVerifyKey(env)) as Record<string, unknown>;
  const viaString = jwt.verify(token, secret) as Record<string, unknown>;
  assert.deepEqual(viaKey, viaString, 'same claims as with the secret string (UTF-8 bytes)');
  const forged = jwt.sign({ sub: 'u1', tenant_id: 't1', typ: 'access' }, 'another-secret', { expiresIn: 60 });
  assert.throws(() => jwt.verify(forged, accessTokenVerifyKey(env)), /invalid signature/);
  const none = jwt.sign({ sub: 'u1' }, '', { algorithm: 'none' } as any);
  assert.throws(() => jwt.verify(none, accessTokenVerifyKey(env)), /jwt signature is required|invalid algorithm/, 'unsigned tokens stay refused');
}

function guardContext(token: string) {
  const req: { headers: { authorization: string }; tenant: { id: string }; user?: { sub?: string } } = {
    headers: { authorization: `Bearer ${token}` },
    tenant: { id: 't1' },
  };
  return {
    req,
    context: {
      getHandler: () => 'handler',
      getClass: () => 'controller',
      switchToHttp: () => ({ getRequest: () => req }),
    },
  };
}

function testGuardVerifiesWithTheCachedKey() {
  const secret = 'jwt-key-spec-guard-secret';
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  const jwtApi = jwt as unknown as { verify: typeof jwt.verify };
  const originalVerify = jwtApi.verify;
  const seen: unknown[] = [];
  jwtApi.verify = ((token: string, secretOrKey: jwt.Secret, options?: jwt.VerifyOptions) => {
    seen.push(secretOrKey);
    return originalVerify(token, secretOrKey, options);
  }) as typeof jwt.verify;
  try {
    const key = accessTokenVerifyKey();
    const claims = { sub: 'u1', tenant_id: 't1', purpose: ACCESS_TOKEN_PURPOSE };
    const guard = new JwtAuthGuard({ getAllAndOverride: () => false } as any);
    const accepted = guardContext(jwt.sign(claims, secret, { expiresIn: 60 }));
    assert.equal(guard.canActivate(accepted.context as any), true, 'the guard accepts a token signed with the secret');
    assert.equal(accepted.req.user?.sub, 'u1');

    const forged = guardContext(jwt.sign(claims, 'another-secret', { expiresIn: 60 }));
    assert.throws(
      () => guard.canActivate(forged.context as any),
      UnauthorizedException,
      'the guard refuses a forged token',
    );

    assert.equal(seen.length, 2, 'the guard verifies each token');
    for (const secretOrKey of seen) {
      assert.ok(secretOrKey instanceof KeyObject, 'the guard verifies with a KeyObject');
      assert.equal((secretOrKey as KeyObject).type, 'secret');
      assert.equal(secretOrKey, key, 'the guard verifies with the cached key');
    }
  } finally {
    jwtApi.verify = originalVerify;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
}

testKeyIsBuiltOnceAndFollowsTheSecret();
testVerifiesExactlyLikeTheSecretString();
testGuardVerifiesWithTheCachedKey();
console.log('jwt-key.spec: ok');
