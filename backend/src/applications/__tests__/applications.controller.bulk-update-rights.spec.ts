import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, RequestMethod, type ExecutionContext } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { PermissionGuard } from '../../auth/permission.guard';
import { ApplicationsController } from '../applications.controller';

// Changing several applications at once (lot F2 of 26.11.8) is for the members of the applications,
// as the edit of one application: the permission guard refuses a reader and a contributor (Nest
// answers 403) and lets a member and an administrator through. The route is declared before every
// POST route whose first segment is a parameter, so `bulk-update` never reads as an application id.

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

function context(): ExecutionContext {
  const req = { user: { sub: 'u-1' }, method: 'POST' };
  return {
    getHandler: () => (ApplicationsController.prototype as any).bulkUpdate,
    getClass: () => ApplicationsController,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}), getNext: () => undefined }),
  } as unknown as ExecutionContext;
}

async function run() {
  const proto = ApplicationsController.prototype as any;
  assert.equal(typeof proto.bulkUpdate, 'function');
  assert.equal(Reflect.getMetadata(PATH_METADATA, proto.bulkUpdate), 'bulk-update');
  assert.equal(Reflect.getMetadata(METHOD_METADATA, proto.bulkUpdate), RequestMethod.POST);
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.bulkUpdate), { resource: 'applications', level: 'member' });
  for (const level of ['reader', 'contributor']) {
    await assert.rejects(
      () => guardFor(level).canActivate(context()),
      (error: unknown) => {
        assert.ok(error instanceof ForbiddenException, level);
        assert.equal(error.getStatus(), 403, `${level}: status`);
        const response = error.getResponse() as { code?: string; params?: unknown };
        assert.equal(response.code, 'MODULE_RIGHT_REQUIRED', `${level}: code`);
        assert.deepEqual(response.params, { resource: 'applications', level: 'member' }, `${level}: params`);
        return true;
      },
      `bulkUpdate refused to ${level}`,
    );
  }
  for (const level of ['member', 'admin']) {
    assert.equal(await guardFor(level).canActivate(context()), true, `bulkUpdate allowed to ${level}`);
  }

  // Declaration order: Nest matches the first route declared.
  const names = Object.getOwnPropertyNames(proto);
  const position = names.indexOf('bulkUpdate');
  const firstParamPost = names.findIndex((name) => {
    const handler = proto[name];
    if (typeof handler !== 'function' || Reflect.getMetadata(METHOD_METADATA, handler) !== RequestMethod.POST) return false;
    return String(Reflect.getMetadata(PATH_METADATA, handler) ?? '').startsWith(':');
  });
  assert.ok(firstParamPost > position, 'bulk-update is declared before the POST routes of one application');
  console.log('applications.controller.bulk-update-rights.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
