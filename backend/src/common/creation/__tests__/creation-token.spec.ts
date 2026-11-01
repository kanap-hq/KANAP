/**
 * The creation token (`common/creation/creation-token.ts`): it opens "Cancel creation" for its own
 * tenant, family, record and creator only, for 24 hours, and a changed byte refuses it.
 */
import * as assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import { CREATION_TOKEN_TTL_MS, issueCreationToken, verifyCreationToken, type CreationTokenSubject } from '../creation-token';

const env = { JWT_SECRET: 'creation-token-spec-jwt-secret', CREATION_TOKEN_SECRET: '' } as NodeJS.ProcessEnv;
const NOW = Date.UTC(2026, 10, 1, 9, 0, 0);
const subject: CreationTokenSubject = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  family: 'applications',
  recordId: '22222222-2222-4222-8222-222222222222',
  userId: '33333333-3333-4333-8333-333333333333',
};

const issue = (s: CreationTokenSubject = subject, now = NOW) => issueCreationToken(s, { now, env });
const verify = (token: unknown, s: CreationTokenSubject = subject, now = NOW) => verifyCreationToken(token, s, { now, env });

function testValidToken() {
  const token = issue();
  assert.match(token, /^\d+\.[A-Za-z0-9_-]{43}$/);
  assert.equal(verify(token), true);
  assert.equal(verify(token, subject, NOW + CREATION_TOKEN_TTL_MS - 1), true, 'valid until 24 hours');
  // The record id may come back in another case from a URL.
  assert.equal(verify(token, { ...subject, recordId: subject.recordId.toUpperCase() }), true);
}

function testOtherSubjectsAreRefused() {
  const token = issue();
  assert.equal(verify(token, { ...subject, userId: '44444444-4444-4444-8444-444444444444' }), false, 'other user');
  assert.equal(verify(token, { ...subject, recordId: '55555555-5555-4555-8555-555555555555' }), false, 'other record');
  assert.equal(verify(token, { ...subject, tenantId: '66666666-6666-4666-8666-666666666666' }), false, 'other tenant');
  assert.equal(verify(token, { ...subject, family: 'interfaces' }), false, 'other family');
}

function testExpiredToken() {
  const token = issue();
  assert.equal(verify(token, subject, NOW + CREATION_TOKEN_TTL_MS + 1), false, 'expired after 24 hours');
  assert.equal(verify(token, subject, NOW - 10 * 60 * 1000), false, 'issued well in the future');
}

function testTamperedToken() {
  const token = issue();
  const [issuedAt, signature] = token.split('.');
  const flipped = signature[0] === 'A' ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;
  assert.equal(verify(`${issuedAt}.${flipped}`), false, 'changed signature');
  // A later issue time with the old signature (to stretch its life) does not verify.
  assert.equal(verify(`${Number(issuedAt) + 1000}.${signature}`), false, 'changed issue time');
  for (const bad of [undefined, null, 42, '', 'abc', `${issuedAt}.`, `.${signature}`, `${token}x`]) {
    assert.equal(verify(bad), false, `malformed token ${String(bad)}`);
  }
}

function testKeyIsTheCreationFamilyKey() {
  const token = issue();
  // Signed with the base secret itself, the same text does not verify.
  const [issuedAt] = token.split('.');
  const text = ['kanap-creation', subject.tenantId, subject.family, subject.recordId, subject.userId, issuedAt].join('\n');
  const withJwtSecret = createHmac('sha256', env.JWT_SECRET as string).update(text, 'utf8').digest('base64url');
  assert.equal(verify(`${issuedAt}.${withJwtSecret}`), false);
  // A dedicated key is the only key used.
  const dedicated = { ...env, CREATION_TOKEN_SECRET: 'dedicated-creation-key' } as NodeJS.ProcessEnv;
  assert.equal(verifyCreationToken(token, subject, { now: NOW, env: dedicated }), false);
  assert.equal(verifyCreationToken(issueCreationToken(subject, { now: NOW, env: dedicated }), subject, { now: NOW, env: dedicated }), true);
}

function testIssueNeedsEverySubjectField() {
  assert.throws(() => issue({ ...subject, userId: '' }), /needs a userId/);
  assert.equal(verify(issue(), { ...subject, userId: '' }), false);
}

function run() {
  testValidToken();
  testOtherSubjectsAreRefused();
  testExpiredToken();
  testTamperedToken();
  testKeyIsTheCreationFamilyKey();
  testIssueNeedsEverySubjectField();
  // eslint-disable-next-line no-console
  console.log('creation-token.spec: OK (6 cases)');
}

run();
