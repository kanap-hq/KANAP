import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { caught, inRequest, refusedWith, req, type Seed, withSeededWorkspace } from './person-create.fixture';

// @database-spec
// `POST /users` names an existing role: a `role_name` or a `role_id` the workspace does not have is
// refused with 400 `ROLE_NOT_FOUND` and nothing is written (no role made on the fly, no person),
// whoever creates. A known name still gives that role, a system role's name in another case too.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'person-create-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

async function testUnknownRoleRefused(users: any, dataSource: DataSource, s: Seed) {
  const cases: Array<{ who: 'ua' | 'admin'; body: Record<string, unknown>; label: string }> = [
    { who: 'ua', body: { role_name: 'Made up role' }, label: 'unknown name, users administrator' },
    { who: 'admin', body: { role_name: 'Made up role' }, label: 'unknown name, administrator' },
    { who: 'admin', body: { role_id: randomUUID() }, label: 'unknown role id' },
  ];
  for (const [index, item] of cases.entries()) {
    const email = s.email(`unknown-role-${index}`);
    await inRequest(dataSource, s, async (runner) => {
      const error = await caught(users.create({ email, ...item.body }, req(runner, s, item.who)));
      refusedWith(error, BadRequestException, 'ROLE_NOT_FOUND', `POST /users (${item.label})`);
      const [row] = await runner.query(
        `SELECT (SELECT count(*)::int FROM roles WHERE role_name = 'Made up role') AS roles,
                (SELECT count(*)::int FROM users WHERE email = $1) AS users`,
        [email],
      );
      assert.deepEqual(row, { roles: 0, users: 0 }, `${item.label}: nothing written`);
    });
  }
}

async function testKnownNameGiven(users: any, dataSource: DataSource, s: Seed) {
  await inRequest(dataSource, s, async (runner) => {
    const byName = await users.create({ email: s.email('known-name'), role_name: 'Budget reader' }, req(runner, s, 'ua'));
    assert.equal(byName.role_id, s.roles.budgetReader, 'a known name gives that role');
    const bySystemName = await users.create({ email: s.email('system-name'), role_name: 'contact' }, req(runner, s, 'ua'));
    assert.equal(bySystemName.role_id, s.roles.contact, 'a system role name in another case');
    const byDefault = await users.create({ email: s.email('no-role') }, req(runner, s, 'ua'));
    assert.equal(byDefault.role_id, s.roles.contact, 'no role named: the Contact role');
  });
}

withSeededWorkspace('person-create-unknown-role.integration.spec', async (users, dataSource, s) => {
  await testUnknownRoleRefused(users, dataSource, s);
  await testKnownNameGiven(users, dataSource, s);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
