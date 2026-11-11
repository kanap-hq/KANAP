import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { PermissionGuard } from '../../auth/permission.guard';
import { ApplicationsController } from '../applications.controller';

// Deleting applications (one, several, and the check before the confirmation) is for the
// administrators of the applications, as the Delete action of the application page: the permission
// guard refuses every lower level (Nest answers 403) and lets an administrator through. Cancelling
// one's own creation keeps the create level: it has its own route.

const ROUTES = ['delete', 'bulkDelete', 'deleteCheck'] as const;

function guardFor(level: string): PermissionGuard {
  const user = { id: 'u-1', status: 'enabled', role_id: 'r-1', role: { role_name: 'IT landscape team' } };
  const manager = { getRepository: () => ({ find: async () => [] }) };
  return new PermissionGuard(
    new Reflector(),
    { findById: async () => user } as any,
    { listForRoles: async () => new Map([['applications', level]]) } as any,
    { manager } as any,
    { isConfigured: () => false } as any,
  );
}

function context(route: string): ExecutionContext {
  const req = { user: { sub: 'u-1' }, method: route === 'deleteCheck' ? 'POST' : 'DELETE' };
  return {
    getHandler: () => (ApplicationsController.prototype as any)[route],
    getClass: () => ApplicationsController,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}), getNext: () => undefined }),
  } as unknown as ExecutionContext;
}

async function expectModuleRightRefusal(guard: PermissionGuard, route: string, label: string): Promise<void> {
  await assert.rejects(
    () => guard.canActivate(context(route)),
    (error: unknown) => {
      assert.ok(error instanceof ForbiddenException, label);
      assert.equal(error.getStatus(), 403, `${label}: status`);
      const response = error.getResponse() as { code?: string; params?: unknown };
      assert.equal(response.code, 'MODULE_RIGHT_REQUIRED', `${label}: code`);
      assert.deepEqual(response.params, { resource: 'applications', level: 'admin' }, `${label}: params`);
      return true;
    },
    label,
  );
}

async function run() {
  const proto = ApplicationsController.prototype as any;
  for (const route of ROUTES) {
    assert.equal(typeof proto[route], 'function', route);
    assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto[route]), { resource: 'applications', level: 'admin' }, route);
    for (const level of ['reader', 'contributor', 'member']) {
      await expectModuleRightRefusal(guardFor(level), route, `${route} refused to ${level}`);
    }
    assert.equal(await guardFor('admin').canActivate(context(route)), true, `${route} allowed to admin`);
  }
  assert.deepEqual(
    Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.cancelCreation),
    { resource: 'applications', level: 'member' },
    'cancelling a creation keeps the create level',
  );
  assert.equal(await guardFor('member').canActivate(context('cancelCreation')), true, 'cancelCreation allowed to member');
  console.log('applications.controller.delete-rights.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
