import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import {
  businessContributorNoAccess,
  businessContributorScope,
  codedForbidden,
  moduleRightRequired,
  outsideParticipation,
  requestContextMissing,
} from '../module-right-required';

function body(error: ForbiddenException): Record<string, unknown> {
  assert.ok(error instanceof ForbiddenException, 'a ForbiddenException');
  assert.equal(error.getStatus(), 403, 'status');
  return error.getResponse() as Record<string, unknown>;
}

assert.deepEqual(body(codedForbidden('SOME_CODE', 'English sentence.')), {
  statusCode: 403,
  error: 'Forbidden',
  code: 'SOME_CODE',
  message: 'English sentence.',
});
assert.deepEqual(body(codedForbidden('SOME_CODE', 'English sentence.', { family: 'projects' })).params, { family: 'projects' });

assert.deepEqual(body(moduleRightRequired('budget', 'reader', 'Needs the budget.')), {
  statusCode: 403,
  error: 'Forbidden',
  code: 'MODULE_RIGHT_REQUIRED',
  message: 'Needs the budget.',
  params: { resource: 'budget', level: 'reader' },
});

const family = body(outsideParticipation('applications', 'You can only link applications you take part in.'));
assert.equal(family.code, 'OUTSIDE_PARTICIPATION');
assert.deepEqual(family.params, { family: 'applications' });
assert.equal(family.message, 'You can only link applications you take part in.');

assert.equal(body(businessContributorNoAccess('interfaces', 'x')).code, 'BUSINESS_CONTRIBUTOR_NO_ACCESS');
assert.deepEqual(body(businessContributorNoAccess('interfaces', 'x')).params, { family: 'interfaces' });
assert.equal(body(businessContributorScope('applications', 'x')).code, 'BUSINESS_CONTRIBUTOR_SCOPE');
assert.equal(body(requestContextMissing('Tenant context is not available')).code, 'REQUEST_CONTEXT_MISSING');
assert.equal(body(requestContextMissing('Tenant context is not available')).message, 'Tenant context is not available');

console.log('coded-forbidden.spec: ok');
