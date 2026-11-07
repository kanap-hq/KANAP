/**
 * HTTP creation routes hand back a creation token signed from JWT_SECRET
 * (`creation-token.ts`; the creation family key, derived when
 * `CREATION_TOKEN_SECRET` is empty). This spec sets no secret: `npm run test:ci`
 * supplies a default when the shell and `backend/.env` leave `JWT_SECRET` empty.
 * The other creation specs keep their own line so they also run alone with
 * `npx ts-node`.
 */
import * as assert from 'node:assert/strict';
import { issueCreationToken, verifyCreationToken } from '../creation-token';

const subject = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  family: 'suppliers',
  recordId: '22222222-2222-4222-8222-222222222222',
  userId: '33333333-3333-4333-8333-333333333333',
};

const token = issueCreationToken(subject);
assert.equal(verifyCreationToken(token, subject), true);
// eslint-disable-next-line no-console
console.log('creation-route-default-secret.spec: ok');
