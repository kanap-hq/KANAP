import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { PermissionGuard } from '../../auth/permission.guard';
import { ContactsController } from '../contacts.controller';

// Deleting contacts, one or several, is for contact administrators: the permission guard refuses
// every lower level (Nest answers 403) and lets a contact administrator through.

const ROUTES = ['remove', 'bulkDelete'] as const;

function guardFor(level: string): PermissionGuard {
  const user = { id: 'u-1', status: 'enabled', role_id: 'r-1', role: { role_name: 'Master data team' } };
  const manager = { getRepository: () => ({ find: async () => [] }) };
  return new PermissionGuard(
    new Reflector(),
    { findById: async () => user } as any,
    { listForRoles: async () => new Map([['contacts', level]]) } as any,
    { manager } as any,
    { isConfigured: () => false } as any,
  );
}

function context(route: string): ExecutionContext {
  const req = { user: { sub: 'u-1' }, method: route === 'deleteCheck' ? 'POST' : 'DELETE' };
  return {
    getHandler: () => (ContactsController.prototype as any)[route],
    getClass: () => ContactsController,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}), getNext: () => undefined }),
  } as unknown as ExecutionContext;
}

async function run() {
  const proto = ContactsController.prototype as any;
  for (const route of ROUTES) {
    assert.equal(typeof proto[route], 'function', route);
    assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto[route]), { resource: 'contacts', level: 'admin' }, route);
    for (const level of ['reader', 'contributor', 'member']) {
      assert.equal(await guardFor(level).canActivate(context(route)), false, `${route} refused to ${level}`);
    }
    assert.equal(await guardFor('admin').canActivate(context(route)), true, `${route} allowed to admin`);
  }
  console.log('contacts.controller.delete-rights.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
