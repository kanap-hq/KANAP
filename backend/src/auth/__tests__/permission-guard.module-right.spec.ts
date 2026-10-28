import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../permission.guard';
import { RequireAnyLevel, RequireLevel } from '../require-level.decorator';

// A missing module right answers a coded 403 (MODULE_RIGHT_REQUIRED) that names the module and
// the level, so the screens can say which right to ask for. No user, or no right at all, keeps
// its own answer.

class TestController {
  @RequireLevel('budget', 'member')
  memberRoute() {
    return undefined;
  }

  @RequireAnyLevel([
    { resource: 'budget', level: 'member' },
    { resource: 'infrastructure', level: 'admin' },
  ])
  anyRoute() {
    return undefined;
  }
}

const USER = { id: 'u-1', status: 'enabled', role_id: 'r-1', role: { role_name: 'Budget team' } };

function guardFor(permissions: Array<[string, string]> | null, user: unknown = USER): PermissionGuard {
  const manager = { getRepository: () => ({ find: async () => [] }) };
  return new PermissionGuard(
    new Reflector(),
    { findById: async () => user } as any,
    { listForRoles: async () => new Map(permissions ?? []) } as any,
    { manager } as any,
    { isConfigured: () => false } as any,
  );
}

function context(route: 'memberRoute' | 'anyRoute'): ExecutionContext {
  const req = { user: { sub: 'u-1' }, method: 'GET' };
  return {
    getHandler: () => (TestController.prototype as any)[route],
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}), getNext: () => undefined }),
  } as unknown as ExecutionContext;
}

function assertModuleRight(error: unknown, resource: string, level: string): void {
  assert.ok(error instanceof ForbiddenException, 'a ForbiddenException');
  assert.equal(error.getStatus(), 403, 'status');
  assert.deepEqual(
    error.getResponse(),
    {
      statusCode: 403,
      error: 'Forbidden',
      code: 'MODULE_RIGHT_REQUIRED',
      message: 'You do not have the rights for this action.',
      params: { resource, level },
    },
    'code, message and the right that is missing',
  );
}

async function run() {
  // A reader on a route that asks for member is refused: the answer names budget and member.
  await assert.rejects(
    () => guardFor([['budget', 'reader']]).canActivate(context('memberRoute')),
    (error: unknown) => {
      assertModuleRight(error, 'budget', 'member');
      return true;
    },
    'member route refused to a reader',
  );

  // @RequireAnyLevel: the refusal names the first entry of the list.
  await assert.rejects(
    () => guardFor([['budget', 'reader']]).canActivate(context('anyRoute')),
    (error: unknown) => {
      assertModuleRight(error, 'budget', 'member');
      return true;
    },
    'any-level route refused to a reader',
  );

  // A later entry of @RequireAnyLevel still opens the route.
  assert.equal(
    await guardFor([['infrastructure', 'admin']]).canActivate(context('anyRoute')),
    true,
    'any-level route allowed by its second entry',
  );

  // A user whose roles grant nothing keeps the NO_ACCESS refusal.
  await assert.rejects(
    () => guardFor([]).canActivate(context('memberRoute')),
    (error: unknown) => {
      assert.ok(error instanceof ForbiddenException, 'a ForbiddenException');
      assert.equal(error.getStatus(), 403, 'status');
      assert.equal((error.getResponse() as { error?: string }).error, 'NO_ACCESS', 'code');
      return true;
    },
    'no right at all is NO_ACCESS',
  );

  // A request with no user still answers false, for the authentication layer to handle.
  assert.equal(
    await guardFor([['budget', 'reader']], null).canActivate(context('memberRoute')),
    false,
    'no user answers false',
  );

  console.log('permission-guard.module-right.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
