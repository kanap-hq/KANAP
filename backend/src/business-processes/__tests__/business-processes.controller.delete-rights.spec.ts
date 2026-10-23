import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { PermissionGuard } from '../../auth/permission.guard';
import { BusinessProcessesController } from '../business-processes.controller';

// Deleting business processes (one, several, and the check before the confirmation) is for
// business process administrators: the permission guard refuses every lower level (Nest answers
// 403) and lets an administrator through.

const ROUTES = ['delete', 'bulkDelete', 'deleteCheck'] as const;

function guardFor(level: string): PermissionGuard {
  const user = { id: 'u-1', status: 'enabled', role_id: 'r-1', role: { role_name: 'Master data team' } };
  const manager = { getRepository: () => ({ find: async () => [] }) };
  return new PermissionGuard(
    new Reflector(),
    { findById: async () => user } as any,
    { listForRoles: async () => new Map([['business_processes', level]]) } as any,
    { manager } as any,
    { isConfigured: () => false } as any,
  );
}

function context(route: string): ExecutionContext {
  const req = { user: { sub: 'u-1' }, method: route === 'deleteCheck' ? 'POST' : 'DELETE' };
  return {
    getHandler: () => (BusinessProcessesController.prototype as any)[route],
    getClass: () => BusinessProcessesController,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}), getNext: () => undefined }),
  } as unknown as ExecutionContext;
}

async function run() {
  const proto = BusinessProcessesController.prototype as any;
  for (const route of ROUTES) {
    assert.equal(typeof proto[route], 'function', route);
    assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto[route]), { resource: 'business_processes', level: 'admin' }, route);
    for (const level of ['reader', 'contributor', 'member']) {
      assert.equal(await guardFor(level).canActivate(context(route)), false, `${route} refused to ${level}`);
    }
    assert.equal(await guardFor('admin').canActivate(context(route)), true, `${route} allowed to admin`);
  }
  console.log('business-processes.controller.delete-rights.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
