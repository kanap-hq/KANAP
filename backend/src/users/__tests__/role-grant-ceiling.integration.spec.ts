import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

// A person gives only the rights they hold. A users administrator who is not an administrator:
// - gives a role whose rights they hold (`PUT /users/:id/roles`), and keeps on a person the roles
//   that person already holds;
// - does not give the Administrator role (403 `administrator_required`) or a role with a level
//   above their own on a module (403 `MODULE_RIGHT_REQUIRED`), to themselves or to anyone, by the
//   roles of a person, the main role (`PATCH /users/:id`), a new person (`POST /users`) or the CSV
//   import (check and load): nothing changes;
// - does not raise a right of a role above their own (`PUT /roles/:id/permissions`); a right kept
//   or lowered stays possible;
// - does not name a role of another tenant (400, as an unknown role).
// An administrator gives every role.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'role-grant-ceiling-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type RoleKey = 'administrator' | 'contact' | 'userAdmin' | 'budgetReader' | 'budgetAdmin';
type UserKey = 'userAdmin' | 'target' | 'admin' | 'heldAdmin';
type Seed = { tenantId: string; roles: Record<RoleKey, string>; users: Record<UserKey, string>; otherTenantRole: string };
type Harness = { app: any; dataSource: DataSource; users: any; roles: any };

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for role-grant-ceiling.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { UsersController } = require('../users.controller');
  const { RolesController } = require('../../roles/roles.controller');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  return { app, dataSource: app.get(DataSource), users: app.get(UsersController), roles: app.get(RolesController) };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

async function tenant(runner: QueryRunner, prefix: string): Promise<string> {
  const tenantId = randomUUID();
  const slug = `${prefix}-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  return tenantId;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const otherTenantId = await tenant(runner, 'role-grant-other');
  const otherTenantRole = await insertId(runner, `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Budget reader')`, [otherTenantId]);

  const tenantId = await tenant(runner, 'role-grant');
  const role = async (name: string, permissions: Record<string, string>, isSystem = false) => {
    const id = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, is_system) VALUES ($1, $2, $3)`, [tenantId, name, isSystem]);
    for (const [resource, level] of Object.entries(permissions)) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, id, resource, level]);
    }
    return id;
  };
  const roles: Record<RoleKey, string> = {
    administrator: await role('Administrator', { users: 'admin', budget: 'admin', projects: 'admin' }, true),
    contact: await role('Contact', {}, true),
    userAdmin: await role('Users administrator', { users: 'admin', budget: 'reader' }),
    budgetReader: await role('Budget reader', { budget: 'reader' }),
    budgetAdmin: await role('Budget administrator', { budget: 'admin' }),
  };
  const user = (key: string, roleId: string) => insertId(runner,
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, $3, 'Tester', $4, 'enabled')`,
    [tenantId, `${key}-${tenantId.slice(0, 8)}@example.test`, key, roleId]);
  const users: Record<UserKey, string> = {
    userAdmin: await user('useradmin', roles.userAdmin),
    target: await user('target', roles.contact),
    admin: await user('admin', roles.administrator),
    heldAdmin: await user('heldadmin', roles.administrator),
  };
  return { tenantId, roles, users, otherTenantRole };
}

function req(runner: QueryRunner, s: Seed, who: 'userAdmin' | 'admin') {
  return {
    queryRunner: runner,
    user: { sub: s.users[who] },
    tenant: { id: s.tenantId },
    isAdmin: who === 'admin',
    permissionLevel: 'admin',
    permissions: who === 'admin' ? {} : { users: 'admin', budget: 'reader' },
  };
}

async function heldRoles(runner: QueryRunner, userId: string): Promise<string[]> {
  const rows: Array<{ role_id: string }> = await runner.query(
    `SELECT role_id FROM users WHERE id = $1 UNION SELECT role_id FROM user_roles WHERE user_id = $1 ORDER BY 1`,
    [userId],
  );
  return rows.map((row) => row.role_id);
}

async function refused(fn: () => Promise<unknown>, code: string, label: string, params?: Record<string, unknown>) {
  const error = await fn().then(() => null, (caught: unknown) => caught);
  assert.ok(error instanceof ForbiddenException, `${label}: refused`);
  const body = error.getResponse() as { code?: string; params?: Record<string, unknown> };
  assert.equal(body.code, code, `${label}: code`);
  if (params) assert.deepEqual(body.params, params, `${label}: params`);
}

async function testRolesOfAPerson(h: Harness, runner: QueryRunner, s: Seed) {
  const ua = req(runner, s, 'userAdmin');
  for (const userId of [s.users.userAdmin, s.users.target]) {
    const before = await heldRoles(runner, userId);
    await refused(() => h.users.setUserRoles(userId, { role_ids: [s.roles.administrator] }, ua), 'administrator_required', 'PUT roles: Administrator');
    await refused(
      () => h.users.setUserRoles(userId, { role_ids: [s.roles.budgetReader, s.roles.budgetAdmin] }, ua),
      'MODULE_RIGHT_REQUIRED', 'PUT roles: level above own', { resource: 'budget', level: 'admin' },
    );
    assert.deepEqual(await heldRoles(runner, userId), before, 'PUT roles refused: roles kept');
  }
  const result = await h.users.setUserRoles(s.users.target, { role_ids: [s.roles.budgetReader] }, ua);
  assert.deepEqual(result.items.map((item: { id: string }) => item.id), [s.roles.budgetReader], 'PUT roles within own rights');
  // The roles of a person who has more rights than the giver do not change, even kept ones.
  await refused(() => h.users.setUserRoles(s.users.heldAdmin, { role_ids: [s.roles.administrator, s.roles.budgetReader] }, ua),
    'PERSON_ABOVE_OWN_RIGHTS', 'PUT roles: an administrator');
  assert.deepEqual(await heldRoles(runner, s.users.heldAdmin), [s.roles.administrator]);
  // A role of another tenant reads as unknown.
  const error = await h.users.setUserRoles(s.users.target, { role_ids: [s.otherTenantRole] }, ua).then(() => null, (e: unknown) => e);
  assert.ok(error instanceof BadRequestException, 'PUT roles: role of another tenant');
  // An administrator gives every role.
  await h.users.setUserRoles(s.users.target, { role_ids: [s.roles.administrator] }, req(runner, s, 'admin'));
  assert.deepEqual(await heldRoles(runner, s.users.target), [s.roles.administrator]);
  await h.users.setUserRoles(s.users.target, { role_ids: [s.roles.contact] }, req(runner, s, 'admin'));
}

async function testMainRoleAndNewPerson(h: Harness, runner: QueryRunner, s: Seed) {
  const ua = req(runner, s, 'userAdmin');
  await refused(() => h.users.update(s.users.userAdmin, { role_id: s.roles.administrator }, ua), 'administrator_required', 'PATCH role_id: Administrator');
  await refused(() => h.users.update(s.users.target, { role_id: s.roles.budgetAdmin }, ua), 'MODULE_RIGHT_REQUIRED', 'PATCH role_id: level above own');
  assert.deepEqual(await heldRoles(runner, s.users.userAdmin), [s.roles.userAdmin], 'PATCH refused: main role kept');
  const updated = await h.users.update(s.users.target, { role_id: s.roles.budgetReader }, ua);
  assert.equal(updated.role_id, s.roles.budgetReader, 'PATCH role_id within own rights');

  const email = (tag: string) => `${tag}-${s.tenantId.slice(0, 8)}@example.test`;
  await refused(() => h.users.create({ email: email('new-a'), role_id: s.roles.administrator }, ua), 'administrator_required', 'POST /users role_id');
  await refused(() => h.users.create({ email: email('new-b'), role_name: 'Administrator' }, ua), 'administrator_required', 'POST /users role_name');
  await refused(() => h.users.create({ email: email('new-c'), role_id: s.roles.budgetAdmin }, ua), 'MODULE_RIGHT_REQUIRED', 'POST /users level above own');
  const [{ count }] = await runner.query(`SELECT count(*)::int AS count FROM users WHERE email LIKE 'new-%'`);
  assert.equal(count, 0, 'POST /users refused: nobody created');
  const created = await h.users.create({ email: email('new-d'), role_id: s.roles.budgetReader }, ua);
  assert.equal(created.role_id, s.roles.budgetReader, 'POST /users within own rights');
}

function csv(rows: Array<[string, string]>): Express.Multer.File {
  const content = ['email,first_name,last_name,role,company_name,department_name,status', ...rows.map(([email, role]) => `${email},Probe,Row,${role},,,contact`)].join('\n');
  return { buffer: Buffer.from(`${content}\n`, 'utf8'), originalname: 'users.csv' } as Express.Multer.File;
}

async function testCsvImport(h: Harness, runner: QueryRunner, s: Seed) {
  const ua = req(runner, s, 'userAdmin');
  const targetEmail = `target-${s.tenantId.slice(0, 8)}@example.test`;
  const before = await heldRoles(runner, s.users.target);
  for (const dryRun of ['true', 'false']) {
    await refused(() => h.users.import(csv([[`csv-a-${s.tenantId.slice(0, 8)}@example.test`, 'Administrator']]), dryRun, 'en', undefined, undefined, ua),
      'administrator_required', `import (dryRun ${dryRun}): new person as Administrator`);
    await refused(() => h.users.import(csv([[targetEmail, 'Budget administrator']]), dryRun, 'en', undefined, undefined, ua),
      'MODULE_RIGHT_REQUIRED', `import (dryRun ${dryRun}): main role above own`);
  }
  assert.deepEqual(await heldRoles(runner, s.users.target), before, 'import refused: roles kept');
  const loaded = await h.users.import(csv([[`csv-b-${s.tenantId.slice(0, 8)}@example.test`, 'Budget reader']]), 'false', 'en', undefined, undefined, ua);
  assert.equal(loaded.ok, true, 'import within own rights');
  assert.equal(loaded.inserted, 1);
  // A role the person already holds becomes their main role.
  await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, false)`, [s.tenantId, s.users.target, s.roles.budgetReader]);
  const main = await h.users.import(csv([[targetEmail, 'Budget reader']]), 'false', 'en', undefined, undefined, ua);
  assert.equal(main.ok, true, 'import: a held role as main role');
  assert.equal((await runner.query(`SELECT role_id FROM users WHERE id = $1`, [s.users.target]))[0].role_id, s.roles.budgetReader);
}

async function permissionsOf(runner: QueryRunner, roleId: string): Promise<Record<string, string>> {
  const rows: Array<{ resource: string; level: string }> = await runner.query(`SELECT resource, level FROM role_permissions WHERE role_id = $1`, [roleId]);
  return Object.fromEntries(rows.map((row) => [row.resource, row.level]));
}

async function testRolePermissions(h: Harness, runner: QueryRunner, s: Seed) {
  const ua = req(runner, s, 'userAdmin');
  await refused(() => h.roles.setRolePermissions(s.roles.budgetReader, { permissions: { budget: 'admin' } }, ua),
    'MODULE_RIGHT_REQUIRED', 'PUT permissions: raised above own', { resource: 'budget', level: 'admin' });
  await refused(() => h.roles.setRolePermissions(s.roles.userAdmin, { permissions: { projects: 'reader' } }, ua),
    'MODULE_RIGHT_REQUIRED', 'PUT permissions: own role, module not held', { resource: 'projects', level: 'reader' });
  assert.deepEqual(await permissionsOf(runner, s.roles.budgetReader), { budget: 'reader' }, 'refused: rights kept');
  assert.deepEqual(await permissionsOf(runner, s.roles.userAdmin), { users: 'admin', budget: 'reader' }, 'refused: own role kept');
  // A right kept or lowered stays possible.
  await h.roles.setRolePermissions(s.roles.budgetAdmin, { permissions: { budget: 'admin', users: null } }, ua);
  await h.roles.setRolePermissions(s.roles.budgetAdmin, { permissions: { budget: 'reader' } }, ua);
  assert.equal((await permissionsOf(runner, s.roles.budgetAdmin)).budget, 'reader', 'lowered');
  // An administrator raises any right.
  await h.roles.setRolePermissions(s.roles.budgetReader, { permissions: { budget: 'admin' } }, req(runner, s, 'admin'));
  assert.equal((await permissionsOf(runner, s.roles.budgetReader)).budget, 'admin');
}

async function testTasksReadAddedWithBudget(h: Harness, runner: QueryRunner, s: Seed) {
  // The tasks read that comes with a budget right is added only for a person who reads tasks.
  await runner.query(`DELETE FROM role_permissions WHERE role_id = $1 AND resource = 'tasks'`, [s.roles.budgetAdmin]);
  await h.roles.setRolePermissions(s.roles.budgetAdmin, { permissions: { budget: 'reader' } }, req(runner, s, 'userAdmin'));
  assert.deepEqual(await permissionsOf(runner, s.roles.budgetAdmin), { budget: 'reader' }, 'no tasks read added by a person without it');
  await h.roles.setRolePermissions(s.roles.budgetAdmin, { permissions: { budget: 'reader' } }, req(runner, s, 'admin'));
  assert.deepEqual(await permissionsOf(runner, s.roles.budgetAdmin), { budget: 'reader', tasks: 'reader' }, 'added by an administrator');
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      await testRolesOfAPerson(harness, runner, s);
      await testMainRoleAndNewPerson(harness, runner, s);
      await testCsvImport(harness, runner, s);
      await testRolePermissions(harness, runner, s);
      await testTasksReadAddedWithBudget(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('role-grant-ceiling.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
