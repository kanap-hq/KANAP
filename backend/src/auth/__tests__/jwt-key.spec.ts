import * as assert from 'node:assert/strict';
import * as jwt from 'jsonwebtoken';
import { accessTokenVerifyKey } from '../jwt-key';

// The access-token verification key is built once (jwt-key.ts): jsonwebtoken given the secret
// string tried it as a public key (a thrown error) then built the secret key, on every request.

function testKeyIsBuiltOnceAndFollowsTheSecret() {
  const env = { JWT_SECRET: 'jwt-key-spec-secret-1' } as NodeJS.ProcessEnv;
  const first = accessTokenVerifyKey(env);
  assert.equal(accessTokenVerifyKey(env), first, 'the same KeyObject is reused');
  assert.equal(first.type, 'secret');
  const rotated = accessTokenVerifyKey({ JWT_SECRET: 'jwt-key-spec-secret-2' } as NodeJS.ProcessEnv);
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

function testFasterThanTheString() {
  const secret = 'x'.repeat(64);
  const env = { JWT_SECRET: secret } as NodeJS.ProcessEnv;
  const token = jwt.sign({ sub: 'u1' }, secret, { expiresIn: 60 });
  const time = (fn: () => void) => {
    for (let i = 0; i < 300; i += 1) fn();
    const started = process.hrtime.bigint();
    for (let i = 0; i < 3000; i += 1) fn();
    return Number(process.hrtime.bigint() - started) / 3000 / 1000;
  };
  const withString = time(() => jwt.verify(token, secret));
  const withKey = time(() => jwt.verify(token, accessTokenVerifyKey(env)));
  console.log(`  verify: ${withString.toFixed(1)} µs with the secret string, ${withKey.toFixed(1)} µs with the cached key`);
  assert.ok(withKey < withString, 'the cached key is cheaper per request');
}

testKeyIsBuiltOnceAndFollowsTheSecret();
testVerifiesExactlyLikeTheSecretString();
testFasterThanTheString();
console.log('jwt-key.spec: ok');
