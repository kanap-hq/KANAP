import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

// Duplicating a role follows the rule of the gifts: a users administrator who is not an
// administrator duplicates only a role they could give (the `grantable` of `GET /roles`). A role
// with a level above their own on a module is refused (403 `MODULE_RIGHT_REQUIRED`) and no copy is
// written; a role within their rights is copied with its rights, and the tasks read that comes with
// a budget right is not added by a person without it. An administrator duplicates every role.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'role-duplicate-ceiling-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type RoleKey = 'administrator' | 'userAdmin' | 'budgetReader' | 'budgetAdmin' | 'builtInReader';
type Seed = { tenantId: string; roles: Record<RoleKey, string>; users: Record<'userAdmin' | 'admin', string> };

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `role-duplicate-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const role = async (name: string, permissions: Record<string, string>, flags: { system?: boolean; builtIn?: boolean } = {}) => {
    const id = (await runner.query(
      `INSERT INTO roles (tenant_id, role_name, is_system, is_built_in) VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenantId, name, !!flags.system, !!flags.builtIn],
    ))[0].id as string;
    for (const [resource, level] of Object.entries(permissions)) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, id, resource, level]);
    }
    return id;
  };
  const roles: Record<RoleKey, string> = {
    administrator: await role('Administrator', { users: 'admin', budget: 'admin' }, { system: true }),
    userAdmin: await role('Users administrator', { users: 'admin', budget: 'reader' }),
    budgetReader: await role('Budget reader probe', { budget: 'reader' }),
    budgetAdmin: await role('Budget administrator probe', { budget: 'admin' }),
    builtInReader: await role('Built-in budget reader probe', { budget: 'reader' }, { builtIn: true }),
  };
  const user = async (key: string, roleId: string) => (await runner.query(
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, $3, 'Tester', $4, 'enabled') RETURNING id`,
    [tenantId, `${key}-${tenantId.slice(0, 8)}@example.test`, key, roleId],
  ))[0].id as string;
  return { tenantId, roles, users: { userAdmin: await user('useradmin', roles.userAdmin), admin: await user('admin', roles.administrator) } };
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

async function permissionsOf(runner: QueryRunner, roleId: string): Promise<Record<string, string>> {
  const rows: Array<{ resource: string; level: string }> = await runner.query(`SELECT resource, level FROM role_permissions WHERE role_id = $1`, [roleId]);
  return Object.fromEntries(rows.map((row) => [row.resource, row.level]));
}

async function rolesNamed(runner: QueryRunner, name: string): Promise<number> {
  return (await runner.query(`SELECT count(*)::int AS count FROM roles WHERE role_name LIKE $1`, [`${name}%`]))[0].count;
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for role-duplicate-ceiling.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { RolesController } = require('../roles.controller');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const roles = app.get(RolesController);
  const runner = app.get(DataSource).createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const s = await seed(runner);
    const ua = req(runner, s, 'userAdmin');

    // A role above the users administrator's rights: refused, no copy, nothing in the audit log.
    const error = await roles.duplicateRole(s.roles.budgetAdmin, { role_name: 'Copy above' }, ua).then(() => null, (e: unknown) => e);
    assert.ok(error instanceof ForbiddenException, `duplicate above own rights: 403 (got ${String(error)})`);
    const body = error.getResponse() as { code?: string; params?: Record<string, unknown> };
    assert.equal(body.code, 'MODULE_RIGHT_REQUIRED');
    assert.deepEqual(body.params, { resource: 'budget', level: 'admin' });
    assert.equal(await rolesNamed(runner, 'Copy above'), 0, 'no copy written');
    const [{ count: audited }] = await runner.query(`SELECT count(*)::int AS count FROM audit_log WHERE table_name = 'roles' AND after_json->>'role_name' LIKE 'Copy above%'`);
    assert.equal(audited, 0, 'no audit entry');

    // Within their rights, built-in or not: copied with its rights, no tasks read added.
    for (const source of [s.roles.budgetReader, s.roles.builtInReader]) {
      const copy = await roles.duplicateRole(source, { role_name: `Copy within ${source.slice(0, 8)}` }, ua);
      assert.deepEqual(await permissionsOf(runner, copy.id), { budget: 'reader' }, 'copied with its rights only');
    }

    // An administrator duplicates every role.
    const byAdmin = await roles.duplicateRole(s.roles.budgetAdmin, { role_name: 'Copy by admin' }, req(runner, s, 'admin'));
    assert.equal((await permissionsOf(runner, byAdmin.id)).budget, 'admin', 'an administrator copies a role of any level');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await app.close();
  }
  console.log('role-duplicate-ceiling.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
