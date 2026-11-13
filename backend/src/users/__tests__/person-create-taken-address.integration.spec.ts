import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { withTenantExecution } from '../../common/tenant-runner';
import { caught, inRequest, personState, refusedWith, req, type Seed, withSeededWorkspace } from './person-create.fixture';

// @database-spec
// `POST /users` with the address of an existing person (enabled, disabled or invited) is refused
// in any case with 409 `USER_EMAIL_TAKEN`, whoever creates and whatever the roles asked, and that person stays
// as they were. Two creations of the same address at the same time, on two connections, create one
// person: the second waits for the first, then is refused the same way.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'person-create-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

async function testTakenAddressRefused(users: any, dataSource: DataSource, s: Seed) {
  for (const key of ['enabled', 'disabled', 'invited'] as const) {
    for (const who of ['ua', 'admin'] as const) {
      for (const body of [
        { email: s.email(key), first_name: 'Changed', role_ids: [s.roles.contact] },
        { email: s.email(key), first_name: 'Changed', role_id: s.roles.contact },
      ]) {
        await inRequest(dataSource, s, async (runner) => {
          const before = await personState(runner, s.users[key]);
          const error = await caught(users.create(body, req(runner, s, who)));
          refusedWith(error, ConflictException, 'USER_EMAIL_TAKEN', `POST /users: address of a ${key} person, by ${who}`);
          assert.deepEqual(await personState(runner, s.users[key]), before, `${key} person unchanged`);
        });
      }
    }
  }
}

/** The address of an existing person in another case is the same address: refused the same way. */
async function testTakenAddressInAnotherCase(users: any, dataSource: DataSource, s: Seed) {
  for (const key of ['enabled', 'disabled', 'invited'] as const) {
    await inRequest(dataSource, s, async (runner) => {
      const before = await personState(runner, s.users[key]);
      const error = await caught(users.create({ email: s.email(key).toUpperCase(), role_ids: [s.roles.contact] }, req(runner, s, 'admin')));
      refusedWith(error, ConflictException, 'USER_EMAIL_TAKEN', `POST /users: address of a ${key} person in capitals`);
      assert.deepEqual(await personState(runner, s.users[key]), before, `${key} person unchanged`);
      const [{ count }] = await runner.query(`SELECT count(*)::int AS count FROM users WHERE lower(email) = $1`, [s.email(key)]);
      assert.equal(count, 1, 'no second account in another case');
    });
  }
}

/** Two creations of one address at the same time, on two connections: one person, the second refused. */
async function testSameAddressAtOnce(users: any, dataSource: DataSource, s: Seed) {
  const email = s.email('race');
  const one = dataSource.createQueryRunner();
  const two = dataSource.createQueryRunner();
  await one.connect();
  await two.connect();
  try {
    for (const runner of [one, two]) {
      await runner.startTransaction();
      await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [s.tenantId]);
    }
    await users.create({ email, first_name: 'First', role_ids: [s.roles.budgetReader] }, req(one, s, 'ua'));
    let settled = false;
    const second = caught(users.create({ email, first_name: 'Second', role_ids: [s.roles.budgetReader] }, req(two, s, 'admin')))
      .finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(settled, false, 'the second creation waits for the first');
    await one.commitTransaction();
    refusedWith(await second, ConflictException, 'USER_EMAIL_TAKEN', 'second creation of the same address');
    if (two.isTransactionActive) await two.rollbackTransaction();
  } finally {
    for (const runner of [one, two]) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
  }
  const rows = await withTenantExecution(dataSource, s.tenantId, (manager) => manager.query(
    `SELECT first_name FROM users WHERE email = $1`, [email],
  ));
  assert.deepEqual(rows, [{ first_name: 'First' }], 'one person created');
}

withSeededWorkspace('person-create-taken-address.integration.spec', async (users, dataSource, s) => {
  await testTakenAddressRefused(users, dataSource, s);
  await testTakenAddressInAnotherCase(users, dataSource, s);
  await testSameAddressAtOnce(users, dataSource, s);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
