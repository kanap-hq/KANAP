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
// - The exact name of a system or built-in role on `POST /roles` is refused (400) and leaves the
//   role as it was, as `PUT /roles/:id` does; other names stay free.
// - A tenant reads only its own roles: the names of another tenant change nothing.
// - The names the screen shows for the system and built-in roles, in its four languages, are
//   reserved the same way, on creation, rename, duplicate and a users file (a new person naming
//   one gets ROLE_NOT_FOUND: `POST /users` makes no role). A role
//   already stored under such a name keeps it.
// - These refusals carry a code: ROLE_NAME_RESERVED for a name of a system or built-in role,
//   ROLE_NAME_TAKEN for the name of another role.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'system-role-names-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Seed = { tenantId: string; otherTenantId: string; adminUserId: string; administrator: string; analyst: string; storedFrench: string };
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
  await runner.query(`INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Buyers', 'Buyers')`, [tenantId]);
  // A role stored earlier under a name the screen shows for a built-in role.
  const storedFrench = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Lecteur budget', 'Stored')`, [tenantId]);
  await runner.query(`INSERT INTO roles (tenant_id, role_name, role_description, is_built_in) VALUES ($1, 'Budget Member', 'Built in', true)`, [tenantId]);
  const adminUserId = await insertId(runner,
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, 'Ada', 'Admin', $3, 'enabled')`,
    [tenantId, `admin-${tenantId.slice(0, 8)}@example.test`, administrator]);
  return { tenantId, otherTenantId, adminUserId, administrator, analyst, storedFrench };
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

async function refusedWith(fn: () => Promise<unknown>, code: string, label: string) {
  const error = await fn().then(() => null, (caught: unknown) => caught);
  assert.ok(error instanceof BadRequestException, `${label}: refused`);
  assert.equal(error.getStatus(), 400, `${label}: status`);
  assert.equal((error.getResponse() as { code?: string }).code, code, `${label}: code`);
}

function csv(email: string, role: string): Express.Multer.File {
  const content = ['email,first_name,last_name,role,company_name,department_name,status', `${email},Probe,Row,${role},,,contact`].join('\n');
  return { buffer: Buffer.from(`${content}\n`, 'utf8'), originalname: 'users.csv' } as Express.Multer.File;
}

async function testRefusalsCarryACode(h: Harness, runner: QueryRunner, s: Seed) {
  for (const name of ['Administrator', 'Contact', 'Budget Member', ' administrator']) {
    await refusedWith(() => h.roles.createRole({ role_name: name, role_description: 'x' }, req(runner, s)), 'ROLE_NAME_RESERVED', `POST /roles "${name}"`);
  }
  await refusedWith(() => h.roles.updateRole(s.analyst, { role_name: 'administrator' }, req(runner, s)), 'ROLE_NAME_RESERVED', 'PUT /roles/:id "administrator"');
  await refusedWith(() => h.roles.updateRole(s.analyst, { role_name: 'Buyers' }, req(runner, s)), 'ROLE_NAME_TAKEN', 'PUT /roles/:id "Buyers"');
}

async function testShownNamesAreReserved(h: Harness, runner: QueryRunner, s: Seed) {
  const before = await roleNames(runner);
  const shown = ['Administrateur', 'Administrador', ' administrateur ', 'ADMINISTRADOR', 'Kontakt', 'Membre budget', 'membre BUDGET ', 'KI-Agenten-Leser', 'budget member'];
  for (const name of shown) {
    await refusedWith(() => h.roles.createRole({ role_name: name, role_description: 'x' }, req(runner, s)), 'ROLE_NAME_RESERVED', `POST /roles "${name}"`);
    await refusedWith(() => h.roles.updateRole(s.analyst, { role_name: name }, req(runner, s)), 'ROLE_NAME_RESERVED', `PUT /roles/:id "${name}"`);
  }
  await refusedWith(() => h.roles.duplicateRole(s.analyst, { role_name: 'Administrador' }, req(runner, s)), 'ROLE_NAME_RESERVED', 'duplicate as "Administrador"');
  // A new person names an existing role: an unknown name is refused before any role is made.
  await refusedWith(() => h.users.create({ email: `fr-${s.tenantId.slice(0, 8)}@example.test`, role_name: 'Administrateur' }, req(runner, s)),
    'ROLE_NOT_FOUND', 'POST /users role_name "Administrateur"');
  for (const dryRun of ['true', 'false']) {
    const result = await h.users.import(csv(`csv-${s.tenantId.slice(0, 8)}@example.test`, 'Administrateur'), dryRun, 'en', undefined, undefined, req(runner, s));
    assert.equal(result.ok, false, `import (dryRun ${dryRun}): refused`);
    assert.deepEqual(result.errors.map((error: { code?: string }) => error.code), ['ROLE_NAME_RESERVED'], `import (dryRun ${dryRun}): code`);
    assert.deepEqual(result.rolesToCreate, [], `import (dryRun ${dryRun}): no role to create`);
  }
  assert.deepEqual(await roleNames(runner), before, 'no role created');
  const [row] = await runner.query(`SELECT role_name FROM roles WHERE id = $1`, [s.analyst]);
  assert.equal(row.role_name, 'Analyst', 'the role keeps its name');
  // A role already stored under such a name stays as it is, and is still found by it.
  const kept = await h.roles.updateRole(s.storedFrench, { role_description: 'Kept' }, req(runner, s));
  assert.equal(kept.role_name, 'Lecteur budget');
  const imported = await h.users.import(csv(`csv-kept-${s.tenantId.slice(0, 8)}@example.test`, 'Lecteur budget'), 'true', 'en', undefined, undefined, req(runner, s));
  assert.equal(imported.ok, true, 'import naming the stored role');
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
  const descriptions = async () => runner.query(`SELECT role_name, role_description FROM roles ORDER BY role_name`);
  const before = await descriptions();
  for (const name of ['Administrator', 'Contact', 'Budget Member']) {
    await refusedAsTaken(() => h.roles.createRole({ role_name: name, role_description: 'Changed' }, req(runner, s)), `POST /roles exact "${name}"`);
  }
  assert.deepEqual(await descriptions(), before, 'system and built-in roles kept');
  const same = await h.roles.createRole({ role_name: 'Analyst', role_description: 'Analyst role' }, req(runner, s));
  assert.equal(same.id, s.analyst, 'the exact name of another role returns it');
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
      await testRefusalsCarryACode(harness, runner, s);
      await testShownNamesAreReserved(harness, runner, s);
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
