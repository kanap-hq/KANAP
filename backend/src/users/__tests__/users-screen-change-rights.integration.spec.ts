import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

// What the users screen reads to offer only the changes the server accepts, and the save of a
// person's profile and roles in one request:
// - the users list (`GET /users`) and a person (`GET /users/:id`) say, for a users administrator who
//   is not an administrator, which people have more rights than they do (`above_own_rights`):
//   an Administrator, or a person with a level above theirs on a module. False for everyone when
//   an administrator reads them.
// - the roles (`GET /roles`) say which ones the reader may give to a person who does not hold them
//   yet (`grantable`): not the Administrator role, nor a role with a level above the reader's own.
//   All of them for an administrator.
// - `PATCH /users/:id` with `role_ids` writes the profile and the roles together: a refused role
//   (above the giver's rights) or a change that would leave the workspace without an enabled
//   Administrator writes neither the profile nor the roles.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'users-screen-change-rights-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Seed = {
  tenantId: string;
  roles: Record<'administrator' | 'contact' | 'userAdmin' | 'budgetReader' | 'budgetAdmin', string>;
  users: Record<'ua' | 'admin' | 'admin2' | 'high' | 'peer', string>;
};

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `screen-rights-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const role = async (name: string, permissions: Record<string, string>, isSystem = false) => {
    const id = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, is_system) VALUES ($1, $2, $3)`, [tenantId, name, isSystem]);
    for (const [resource, level] of Object.entries(permissions)) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, id, resource, level]);
    }
    return id;
  };
  const roles = {
    administrator: await role('Administrator', { users: 'admin' }, true),
    contact: await role('Contact', {}, true),
    userAdmin: await role('Users administrator', { users: 'admin', budget: 'reader' }),
    budgetReader: await role('Budget reader', { budget: 'reader' }),
    budgetAdmin: await role('Budget administrator', { budget: 'admin' }),
  };
  const user = async (key: string, roleId: string, extraRoles: string[] = []) => {
    const id = await insertId(runner,
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, password_hash)
       VALUES ($1, $2, $3, 'Tester', $4, 'enabled', 'stored-hash')`,
      [tenantId, `${key}-${tenantId.slice(0, 8)}@example.test`, key, roleId]);
    for (const [index, extra] of [roleId, ...extraRoles].entries()) {
      await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, $4)`, [tenantId, id, extra, index === 0]);
    }
    return id;
  };
  const users = {
    ua: await user('ua', roles.userAdmin),
    admin: await user('admin', roles.administrator),
    admin2: await user('admin2', roles.administrator),
    // Above a budget reader through their second role only.
    high: await user('high', roles.budgetReader, [roles.budgetAdmin]),
    peer: await user('peer', roles.budgetReader),
  };
  return { tenantId, roles, users };
}

function req(runner: QueryRunner, s: Seed, who: 'ua' | 'admin') {
  return {
    queryRunner: runner,
    user: { sub: s.users[who] },
    tenant: { id: s.tenantId },
    isAdmin: who === 'admin',
    permissionLevel: 'admin',
    permissions: who === 'admin' ? {} : { users: 'admin', budget: 'reader' },
    dataAccessMode: 'all',
  };
}

async function row(runner: QueryRunner, id: string) {
  const rows = await runner.query(
    `SELECT u.first_name, u.status, u.role_id,
            (SELECT array_agg(role_id::text ORDER BY role_id) FROM user_roles WHERE user_id = u.id) AS roles
       FROM users u WHERE u.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

async function refusedWith(fn: () => Promise<unknown>, type: new (...args: any[]) => Error, code: string | null, label: string) {
  const error = await fn().then(() => null, (caught: unknown) => caught);
  assert.ok(error instanceof type, `${label}: ${type.name} (got ${String(error)})`);
  if (code) assert.equal(((error as any).getResponse() as { code?: string }).code, code, `${label}: code`);
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for users-screen-change-rights.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { UsersController } = require('../users.controller');
  const { RolesController } = require('../../roles/roles.controller');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const users = app.get(UsersController);
  const roles = app.get(RolesController);
  const runner = app.get(DataSource).createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const s = await seed(runner);
    const ua = req(runner, s, 'ua');
    const admin = req(runner, s, 'admin');

    // The list and a person: who has more rights than the reader.
    const listed = async (who: typeof ua) => {
      const page = await users.list({ limit: 50, status: 'all' }, who);
      return Object.fromEntries(page.items.map((item: { id: string; above_own_rights?: boolean }) => [item.id, item.above_own_rights]));
    };
    const byUa = await listed(ua);
    assert.deepEqual(
      [s.users.ua, s.users.admin, s.users.admin2, s.users.high, s.users.peer].map((id) => byUa[id]),
      [false, true, true, true, false],
      'list read by a users administrator',
    );
    const byAdmin = await listed(admin);
    assert.ok(Object.values(byAdmin).length === 5 && Object.values(byAdmin).every((value) => value === false), 'list read by an administrator');
    assert.equal((await users.getById(s.users.admin, ua)).above_own_rights, true, 'an Administrator read by a users administrator');
    assert.equal((await users.getById(s.users.high, ua)).above_own_rights, true, 'a person above through a second role');
    assert.equal((await users.getById(s.users.peer, ua)).above_own_rights, false, 'a peer');
    assert.equal((await users.getById(s.users.admin2, admin)).above_own_rights, false, 'read by an administrator');

    // The roles: which ones the reader may give.
    const grantable = async (who: typeof ua) => {
      const { items } = await roles.getRoles(who);
      return Object.fromEntries(items.map((item: { id: string; grantable?: boolean }) => [item.id, item.grantable]));
    };
    const rolesByUa = await grantable(ua);
    assert.deepEqual(
      [s.roles.administrator, s.roles.contact, s.roles.userAdmin, s.roles.budgetReader, s.roles.budgetAdmin].map((id) => rolesByUa[id]),
      [false, true, true, true, false],
      'roles read by a users administrator',
    );
    assert.ok(Object.values(await grantable(admin)).every((value) => value === true), 'roles read by an administrator');

    // The profile and the roles in one request.
    await users.update(s.users.peer, { first_name: 'Both', role_ids: [s.roles.budgetReader, s.roles.contact] }, ua);
    const both = await row(runner, s.users.peer);
    assert.equal(both.first_name, 'Both', 'profile written');
    assert.deepEqual(both.roles, [s.roles.budgetReader, s.roles.contact].sort(), 'roles written');
    assert.equal(both.role_id, s.roles.budgetReader, 'main role is the first one');

    await refusedWith(
      () => users.update(s.users.peer, { first_name: 'Refused', role_ids: [s.roles.budgetAdmin] }, ua),
      ForbiddenException, 'MODULE_RIGHT_REQUIRED', 'a role above the giver',
    );
    assert.deepEqual(await row(runner, s.users.peer), both, 'a refused role writes neither the profile nor the roles');

    await refusedWith(() => users.update(s.users.ua, { first_name: 'Nobody', role_ids: [] }, ua), BadRequestException, null, 'own last role');
    assert.equal((await row(runner, s.users.ua)).first_name, 'ua', 'own last role: profile not written');

    // The last enabled Administrator keeps their role, and their profile stays as it was.
    await users.update(s.users.admin2, { status: 'disabled' }, admin);
    const lastBefore = await row(runner, s.users.admin);
    await refusedWith(
      () => users.update(s.users.admin, { first_name: 'Last', role_ids: [s.roles.contact] }, admin),
      ConflictException, 'LAST_ADMINISTRATOR', 'last Administrator',
    );
    assert.deepEqual(await row(runner, s.users.admin), lastBefore, 'last Administrator: nothing written');

    // An administrator sets both on anyone.
    await users.update(s.users.high, { first_name: 'High', role_ids: [s.roles.budgetAdmin] }, admin);
    const high = await row(runner, s.users.high);
    assert.equal(high.first_name, 'High');
    assert.deepEqual(high.roles, [s.roles.budgetAdmin]);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await app.close();
  }
  console.log('users-screen-change-rights.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
