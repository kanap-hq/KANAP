import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { PermissionGuard } from '../../auth/permission.guard';
import { IncidentsController } from '../incidents.controller';

// Deleting incidents (one, several, and the check before the confirmation) is for incident
// administrators: the permission guard refuses every lower level (Nest answers 403) and lets an
// incident administrator through.

const ROUTES = ['delete', 'bulkDelete', 'deleteCheck'] as const;

function guardFor(level: string): PermissionGuard {
  const user = { id: 'u-1', status: 'enabled', role_id: 'r-1', role: { role_name: 'Incident team' } };
  const manager = { getRepository: () => ({ find: async () => [] }) };
  return new PermissionGuard(
    new Reflector(),
    { findById: async () => user } as any,
    { listForRoles: async () => new Map([['incidents', level]]) } as any,
    { manager } as any,
    { isConfigured: () => false } as any,
  );
}

function context(route: string): ExecutionContext {
  const req = { user: { sub: 'u-1' }, method: route === 'deleteCheck' ? 'POST' : 'DELETE' };
  return {
    getHandler: () => (IncidentsController.prototype as any)[route],
    getClass: () => IncidentsController,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}), getNext: () => undefined }),
  } as unknown as ExecutionContext;
}

async function run() {
  const proto = IncidentsController.prototype as any;
  for (const route of ROUTES) {
    assert.equal(typeof proto[route], 'function', route);
    assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto[route]), { resource: 'incidents', level: 'admin' }, route);
    for (const level of ['reader', 'contributor', 'member']) {
      assert.equal(await guardFor(level).canActivate(context(route)), false, `${route} refused to ${level}`);
    }
    assert.equal(await guardFor('admin').canActivate(context(route)), true, `${route} allowed to admin`);
  }
  // Nest matches routes in declaration order: `DELETE bulk` and `POST delete-check` before `:id`.
  const methods = Object.getOwnPropertyNames(IncidentsController.prototype);
  assert.ok(methods.indexOf('bulkDelete') < methods.indexOf('delete'), 'bulk before :id');
  console.log('incidents.controller.delete-rights: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
