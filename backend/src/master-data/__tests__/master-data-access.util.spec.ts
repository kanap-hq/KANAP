import * as assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { assertCanManageMasterDataScope, canManageMasterDataScope } from '../master-data-access.util';

// Who may copy or freeze company / department metrics. Access comes from the
// guard's merged view of all the user's roles, never from the legacy role_id.

const masterDataAdmin = { permissions: { companies: 'admin', departments: 'admin', suppliers: 'admin' } };
assert.equal(canManageMasterDataScope(masterDataAdmin, 'companies'), true, 'master data admin manages companies');
assert.equal(canManageMasterDataScope(masterDataAdmin, 'departments'), true, 'master data admin manages departments');

assert.equal(canManageMasterDataScope({ isAdmin: true, permissions: {} }, 'companies'), true, 'Administrator has no permission rows');
assert.equal(canManageMasterDataScope({ permissions: { budget_ops: 'admin' } }, 'departments'), true, 'budget admin manages both');

const companiesOnly = { permissions: { companies: 'admin', departments: 'member' } };
assert.equal(canManageMasterDataScope(companiesOnly, 'companies'), true, 'scope admin');
assert.equal(canManageMasterDataScope(companiesOnly, 'departments'), false, 'member of the other scope is not enough');

assert.equal(canManageMasterDataScope({ permissions: { companies: 'member' } }, 'companies'), false, 'master data member refused');
assert.equal(canManageMasterDataScope({}, 'companies'), false, 'no rights at all');

assert.throws(
  () => assertCanManageMasterDataScope({ permissions: { companies: 'member' } }, 'companies', 'copy company metrics'),
  (err: unknown) => err instanceof ForbiddenException
    && err.message === 'You need Companies admin permissions to copy company metrics'
    && (err.getResponse() as { code?: string }).code === 'MODULE_RIGHT_REQUIRED'
    && JSON.stringify((err.getResponse() as { params?: unknown }).params) === JSON.stringify({ resource: 'companies', level: 'admin' }),
);
assert.doesNotThrow(() => assertCanManageMasterDataScope(masterDataAdmin, 'companies', 'copy company metrics'));

console.log('master-data-access.util.spec: ok');
