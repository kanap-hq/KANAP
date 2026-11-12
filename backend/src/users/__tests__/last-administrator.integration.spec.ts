import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { ConflictException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantExecution } from '../../common/tenant-runner';
import { purgeTenantTables } from '../../admin/tenants/tenant-data-purge';
import { TENANT_PURGE_TABLES } from '../../admin/tenants/tenant-purge.inventory';

// A workspace keeps at least one enabled Administrator. Refused (409 `LAST_ADMINISTRATOR`,
// nothing written) for the last enabled one, themselves included:
// - taking their role away (`PUT /users/:id/roles`, the main role of `PATCH /users/:id`);
// - disabling them (`POST /users/:id/disable`, the status of `PATCH /users/:id`);
// - deleting them (delete, bulk delete, the check before it);
// - an import row that disables them or changes their role (the row is refused).
// With two enabled Administrators, each of these goes through for one of them. Two writes that each
// take one of the two last Administrators away run one after the other: the second is refused.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'last-administrator-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Seed = { tenantId: string; admin: string; admin2: string; contact: string; reader: string; adminRole: string; email: (tag: string) => string };

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `last-admin-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, ${runner.isTransactionActive ? 'true' : 'false'})`, [tenantId]);
  const role = async (name: string, isSystem: boolean, permissions: Record<string, string> = {}) => {
    const id = (await runner.query(`INSERT INTO roles (tenant_id, role_name, is_system) VALUES ($1, $2, $3) RETURNING id`, [tenantId, name, isSystem]))[0].id;
    for (const [resource, level] of Object.entries(permissions)) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, id, resource, level]);
    }
    return id;
  };
  const adminRole = await role('Administrator', true, { users: 'admin' });
  const contact = await role('Contact', true);
  const reader = await role('Budget reader', false, { budget: 'reader' });
  const email = (tag: string) => `${tag}-${tenantId.slice(0, 8)}@example.test`;
  const user = async (key: string) => {
    const id = (await runner.query(
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, $3, 'Tester', $4, 'enabled') RETURNING id`,
      [tenantId, email(key), key, adminRole]))[0].id;
    await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, id, adminRole]);
    return id;
  };
  return { tenantId, admin: await user('admin'), admin2: await user('admin2'), contact, reader, adminRole, email };
}

function req(runner: QueryRunner, s: Seed, who: string) {
  return { queryRunner: runner, user: { sub: who }, tenant: { id: s.tenantId }, isAdmin: true, permissionLevel: 'admin', permissions: {} };
}

async function refused(fn: () => Promise<unknown>, label: string) {
  const error = await fn().then(() => null, (caught: unknown) => caught);
  assert.ok(error instanceof ConflictException, `${label}: 409 (got ${String(error)})`);
  assert.equal((error.getResponse() as { code?: string }).code, 'LAST_ADMINISTRATOR', `${label}: code`);
}

async function state(runner: QueryRunner, id: string) {
  const rows = await runner.query(
    `SELECT u.status, u.role_id, (SELECT array_agg(role_id::text ORDER BY role_id) FROM user_roles WHERE user_id = u.id) AS roles
       FROM users u WHERE u.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

function csv(rows: Array<[string, string, string]>): Express.Multer.File {
  const content = ['email,first_name,last_name,role,company_name,department_name,status',
    ...rows.map(([email, role, status]) => `${email},Row,Tester,${role},,,${status}`)].join('\n');
  return { buffer: Buffer.from(`${content}\n`, 'utf8'), originalname: 'users.csv' } as Express.Multer.File;
}

async function testLastAdministrator(app: any, runner: QueryRunner) {
  const { UsersController } = require('../users.controller');
  const users = app.get(UsersController);
  const s = await seed(runner);
  // The second Administrator goes first: their role taken away. The one left is the last.
  await users.setUserRoles(s.admin2, { role_ids: [s.reader] }, req(runner, s, s.admin));
  const last = s.admin;
  const asLast = req(runner, s, last);
  const before = await state(runner, last);
  await refused(() => users.setUserRoles(last, { role_ids: [s.reader] }, asLast), 'PUT roles');
  // Taking every role away from oneself has its own refusal: through the other person.
  await refused(() => users.setUserRoles(last, { role_ids: [] }, req(runner, s, s.admin2)), 'PUT roles (none)');
  // The main role, once the extra row is gone: only `role_id` holds the role.
  await runner.query(`DELETE FROM user_roles WHERE user_id = $1`, [last]);
  await refused(() => users.update(last, { role_id: s.reader }, asLast), 'PATCH main role');
  await refused(() => users.update(last, { status: 'disabled' }, asLast), 'PATCH status');
  await refused(() => users.disable(last, asLast), 'disable');
  // The delete, through the other person (one's own account is refused anyway).
  const other = req(runner, s, s.admin2);
  const single = await users.delete(last, other).then(() => null, (e: unknown) => e);
  assert.ok(single instanceof ConflictException, 'delete refused');
  assert.equal((single.getResponse() as { code?: string }).code, 'LAST_ADMINISTRATOR');
  const bulk = await users.bulkDelete({ ids: [last] }, other);
  assert.deepEqual(bulk.deleted, []);
  assert.equal(bulk.failed[0]?.code, 'LAST_ADMINISTRATOR', 'bulk delete');
  const check = await users.deleteCheck({ ids: [last] }, other);
  assert.equal(check.refused[0]?.code, 'LAST_ADMINISTRATOR', 'delete check');
  for (const dryRun of ['true', 'false']) {
    for (const [role, status] of [['Administrator', 'disabled'], ['Budget reader', 'enabled']]) {
      const result = await users.import(csv([[s.email('admin'), role, status]]), dryRun, 'en', undefined, undefined, asLast);
      assert.equal(result.ok, false, `import (${role}, ${status}, dryRun ${dryRun}) refused`);
      assert.equal(result.errors[0]?.code, 'LAST_ADMINISTRATOR');
    }
  }
  const after = await state(runner, last);
  assert.equal(after.status, before.status, 'still enabled');
  assert.equal(after.role_id, s.adminRole, 'still Administrator');

  // With a second enabled Administrator, each change goes through.
  await users.setUserRoles(s.admin2, { role_ids: [s.adminRole] }, asLast);
  await users.update(last, { status: 'disabled' }, asLast);
  await users.enable(last, other);
  await users.disable(s.admin2, asLast);
  await users.enable(s.admin2, asLast);
  await users.setUserRoles(s.admin2, { role_ids: [s.reader] }, asLast);
  await users.setUserRoles(s.admin2, { role_ids: [s.adminRole] }, asLast);
  const loaded = await users.import(csv([[s.email('admin2'), 'Budget reader', 'enabled']]), 'false', 'en', undefined, undefined, asLast);
  assert.equal(loaded.ok, true, 'import: one Administrator stays');
  await runner.query(`UPDATE users SET role_id = $2 WHERE id = $1`, [s.admin2, s.adminRole]);
  await users.delete(s.admin2, asLast);
  assert.equal(await state(runner, s.admin2), null, 'deleted while another stays');
}

/** Two transactions that each disable one of the two last Administrators: the second is refused. */
async function testConcurrentWrites(app: any, dataSource: DataSource) {
  const { UsersController } = require('../users.controller');
  const users = app.get(UsersController);
  const setup = dataSource.createQueryRunner();
  await setup.connect();
  let s: Seed | null = null;
  try {
    s = await seed(setup);
    const one = dataSource.createQueryRunner();
    const two = dataSource.createQueryRunner();
    await one.connect();
    await two.connect();
    try {
      for (const runner of [one, two]) {
        await runner.startTransaction();
        await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [s.tenantId]);
      }
      await users.disable(s.admin, req(one, s, s.admin2));
      // The second waits on the first one's lock, then reads its result.
      const second = users.disable(s.admin2, req(two, s, s.admin)).then(() => null, (e: unknown) => e);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await one.commitTransaction();
      const error = await second;
      assert.ok(error instanceof ConflictException, `concurrent disable refused (got ${String(error)})`);
      assert.equal((error.getResponse() as { code?: string }).code, 'LAST_ADMINISTRATOR');
      await two.rollbackTransaction();
    } finally {
      for (const runner of [one, two]) {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
      }
    }
  } finally {
    if (s) {
      const tenantId = s.tenantId;
      await withTenantExecution(dataSource, tenantId, (manager) => purgeTenantTables(manager, TENANT_PURGE_TABLES));
      await setup.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    }
    await setup.release();
  }
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for last-administrator.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const dataSource = app.get(DataSource);
  try {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await testLastAdministrator(app, runner);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
    await testConcurrentWrites(app, dataSource);
  } finally {
    await app.close();
  }
  console.log('last-administrator.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
