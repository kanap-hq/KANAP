import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { BadRequestException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

// The names of the system roles (Administrator, Contact) stay theirs: no other role takes one of
// them, whatever its case or surrounding spaces.
// - Creating a role by such a name, through the Roles screen (`POST /roles`) or a duplicate, is
//   refused and creates nothing; a new person (`POST /users` with `role_name`) or a users file
//   naming it gets the system role.
// - Renaming a role to such a name (`PUT /roles/:id`) is refused and keeps its name.
// - The exact name of a system role still returns that role, and other names stay free.
// - A tenant reads only its own roles: the names of another tenant change nothing.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'system-role-names-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Seed = { tenantId: string; otherTenantId: string; adminUserId: string; administrator: string; analyst: string };
type Harness = { app: any; dataSource: DataSource; roles: any; users: any };

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for system-role-names.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { RolesController } = require('../roles.controller');
  const { UsersController } = require('../../users/users.controller');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  return { app, dataSource: app.get(DataSource), roles: app.get(RolesController), users: app.get(UsersController) };
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
  return tenantId;
}

async function useTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const otherTenantId = await tenant(runner, 'role-names-other');
  await useTenant(runner, otherTenantId);
  await runner.query(`INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Auditor', 'Auditor')`, [otherTenantId]);

  const tenantId = await tenant(runner, 'role-names');
  await useTenant(runner, tenantId);
  const administrator = await insertId(runner,
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system) VALUES ($1, 'Administrator', 'Administrator', true)`, [tenantId]);
  await runner.query(`INSERT INTO roles (tenant_id, role_name, role_description, is_system) VALUES ($1, 'Contact', 'Contact', true)`, [tenantId]);
  const analyst = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Analyst', 'Analyst')`, [tenantId]);
  const adminUserId = await insertId(runner,
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, 'Ada', 'Admin', $3, 'enabled')`,
    [tenantId, `admin-${tenantId.slice(0, 8)}@example.test`, administrator]);
  return { tenantId, otherTenantId, adminUserId, administrator, analyst };
}

function req(runner: QueryRunner, s: Seed) {
  return { queryRunner: runner, user: { sub: s.adminUserId }, tenant: { id: s.tenantId }, isAdmin: true, permissions: {} };
}

async function roleNames(runner: QueryRunner): Promise<string[]> {
  const rows: Array<{ role_name: string }> = await runner.query(`SELECT role_name FROM roles ORDER BY role_name`);
  return rows.map((row) => row.role_name);
}

async function refusedAsTaken(fn: () => Promise<unknown>, label: string) {
  const error = await fn().then(() => null, (caught: unknown) => caught);
  assert.ok(error instanceof BadRequestException, `${label}: refused`);
  assert.equal(error.getStatus(), 400, `${label}: status`);
}

async function testCreationBySystemNameIsRefused(h: Harness, runner: QueryRunner, s: Seed) {
  const before = await roleNames(runner);
  for (const name of ['administrator', 'ADMINISTRATOR', ' Administrator ', 'contact', 'CONTACT ']) {
    await refusedAsTaken(() => h.roles.createRole({ role_name: name, role_description: 'x' }, req(runner, s)), `POST /roles "${name}"`);
  }
  await refusedAsTaken(() => h.roles.duplicateRole(s.analyst, { role_name: 'administrator' }, req(runner, s)), 'duplicate as "administrator"');
  // A new person named with a system role's name in another case gets that system role.
  const created = await h.users.create({ email: `new-${s.tenantId.slice(0, 8)}@example.test`, role_name: ' administrator' }, req(runner, s));
  assert.equal(created.role_id, s.administrator, 'POST /users with role_name " administrator": the system role');
  assert.deepEqual(await roleNames(runner), before, 'no role created');
}

async function testRenameToSystemNameIsRefused(h: Harness, runner: QueryRunner, s: Seed) {
  for (const name of ['administrator', 'ADMINISTRATOR', 'Administrator', ' contact']) {
    await refusedAsTaken(() => h.roles.updateRole(s.analyst, { role_name: name }, req(runner, s)), `PUT /roles/:id "${name}"`);
  }
  const [row] = await runner.query(`SELECT role_name FROM roles WHERE id = $1`, [s.analyst]);
  assert.equal(row.role_name, 'Analyst', 'the role keeps its name');
}

async function testOtherNamesStayFree(h: Harness, runner: QueryRunner, s: Seed) {
  const same = await h.roles.createRole({ role_name: 'Administrator', role_description: 'Administrator' }, req(runner, s));
  assert.equal(same.id, s.administrator, 'the exact name returns the system role');
  const renamed = await h.roles.updateRole(s.analyst, { role_name: 'Administrators of finance' }, req(runner, s));
  assert.equal(renamed.role_name, 'Administrators of finance');
  // The other tenant's role names are not read here.
  const created = await h.roles.createRole({ role_name: 'Auditor', role_description: 'Auditor' }, req(runner, s));
  assert.equal(created.role_name, 'Auditor');
  const [row] = await runner.query(`SELECT tenant_id FROM roles WHERE id = $1`, [created.id]);
  assert.equal(row.tenant_id, s.tenantId, 'created in the tenant of the request');
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      await testCreationBySystemNameIsRefused(harness, runner, s);
      await testRenameToSystemNameIsRefused(harness, runner, s);
      await testOtherNamesStayFree(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('system-role-names.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
