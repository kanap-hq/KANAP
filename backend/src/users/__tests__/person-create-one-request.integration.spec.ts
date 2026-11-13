import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { caught, heldRoles, inRequest, nothingFor, refusedWith, req, type Seed, withSeededWorkspace } from './person-create.fixture';

// @database-spec
// A person and their roles are created in one request (`POST /users` with `role_ids`), under the
// checks of `PUT /users/:id/roles`: a refused role list creates nothing (no person, no role, no
// audit entry), whoever creates. The first role is the main one; an empty list leaves the Contact
// role alone, as `PUT /users/:id/roles` does. An administrator gives every role. The creation is
// written to the history under the person who creates.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'person-create-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

async function testRefusedRoleListCreatesNothing(users: any, dataSource: DataSource, s: Seed) {
  const cases: Array<{ who: 'ua' | 'admin'; role_ids: unknown; type: any; code: string; label: string }> = [
    { who: 'ua', role_ids: [s.roles.budgetReader, s.roles.budgetAdmin], type: ForbiddenException, code: 'MODULE_RIGHT_REQUIRED', label: 'a role above own rights' },
    { who: 'ua', role_ids: [s.roles.administrator], type: ForbiddenException, code: 'administrator_required', label: 'the Administrator role' },
    { who: 'ua', role_ids: 'not-a-list', type: BadRequestException, code: 'ROLE_IDS_INVALID', label: 'not a list of role ids' },
    { who: 'admin', role_ids: [s.roles.budgetReader, 'nope'], type: BadRequestException, code: 'ROLE_IDS_INVALID', label: 'a role id that is not an id' },
  ];
  for (const [index, item] of cases.entries()) {
    const email = s.email(`refused-${index}`);
    await inRequest(dataSource, s, async (runner) => {
      const error = await caught(users.create({ email, first_name: 'New', role_ids: item.role_ids }, req(runner, s, item.who)));
      refusedWith(error, item.type, item.code, `POST /users (${item.label})`);
      await nothingFor(runner, email, item.label);
    });
  }
  // A role that does not exist in the workspace reads as unknown: nothing created either.
  const email = s.email('unknown-role');
  await inRequest(dataSource, s, async (runner) => {
    const error = await caught(users.create({ email, role_ids: [randomUUID()] }, req(runner, s, 'admin')));
    assert.ok(error instanceof BadRequestException, `unknown role: 400 (got ${String(error)})`);
    await nothingFor(runner, email, 'unknown role');
  });
}

async function testCreatedWithEveryRole(users: any, dataSource: DataSource, s: Seed) {
  await inRequest(dataSource, s, async (runner) => {
    const created = await users.create(
      { email: s.email('new-ua'), first_name: 'New', role_ids: [s.roles.budgetReader, s.roles.contact] },
      req(runner, s, 'ua'),
    );
    assert.equal(created.role_id, s.roles.budgetReader, 'the first role is the main role');
    // The history names the person who created them, not the person created.
    const [entry] = await runner.query(
      `SELECT user_id FROM audit_log WHERE table_name = 'users' AND record_id = $1 AND action = 'create'`,
      [created.id],
    );
    assert.equal(entry?.user_id, s.users.ua, 'the creation is the creator\'s in the history');
    assert.deepEqual(await heldRoles(runner, created.id), [
      { role_id: s.roles.budgetReader, is_primary: true },
      { role_id: s.roles.contact, is_primary: false },
    ].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.role_id.localeCompare(b.role_id)), 'every role given');
    // An administrator gives every role.
    const byAdmin = await users.create(
      { email: s.email('new-admin'), role_ids: [s.roles.administrator, s.roles.budgetAdmin] },
      req(runner, s, 'admin'),
    );
    assert.equal(byAdmin.role_id, s.roles.administrator);
    assert.equal((await heldRoles(runner, byAdmin.id)).length, 2, 'an administrator gives every role');
    // No role: the person holds the Contact role alone, as a person whose roles are all taken away.
    const none = await users.create({ email: s.email('new-none'), role_ids: [] }, req(runner, s, 'ua'));
    assert.equal(none.role_id, s.roles.contact);
    assert.deepEqual(await heldRoles(runner, none.id), []);
  });
}

withSeededWorkspace('person-create-one-request.integration.spec', async (users, dataSource, s) => {
  await testRefusedRoleListCreatesNothing(users, dataSource, s);
  await testCreatedWithEveryRole(users, dataSource, s);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
