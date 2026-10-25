import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { UsersController } from '../users.controller';

// GET /api/users/me names no route (the current user is /api/auth/me): the id of the users routes
// is a uuid, and a name that is not one answers 404 instead of a database cast error (500).

const VALID_ID = '11111111-1111-4111-8111-111111111111';

const refuse = async (): Promise<never> => {
  throw new Error('a malformed id must not reach the service');
};

function controller(service: any = { findById: refuse, updateUser: refuse }): UsersController {
  return new UsersController(
    service,
    { deleteUser: refuse } as any,
    null as any,
    null as any,
    null as any,
    null as any,
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof NotFoundException && error.getStatus() === 404;
}

async function run() {
  const req = { queryRunner: { manager: {} }, user: { sub: VALID_ID } } as any;

  for (const call of [
    async () => controller().getById('me', req),
    async () => controller().getUserRoles('me', req),
    async () => controller().update('me', {}, req),
    async () => controller().setUserRoles('me', { role_ids: [] }, req),
    async () => controller().delete('me', req),
  ]) {
    await assert.rejects(call, isNotFound);
  }

  // A well-formed id still reaches the service.
  let asked: string | null = null;
  const user = await controller({
    findById: async (id: string) => { asked = id; return null; },
  }).getById(VALID_ID, req);
  assert.equal(user, null);
  assert.equal(asked, VALID_ID);

  console.log('users.controller.params.spec.ts OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
