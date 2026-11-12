import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory, Reflector } from '@nestjs/core';
import { ConflictException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

// A person does not change a person who has more rights than they do: one who holds the
// Administrator role, or a level above theirs on a module, all their roles counted. A users
// administrator who is not an administrator is refused (403 `PERSON_ABOVE_OWN_RIGHTS`, nothing
// written) on such a person for:
// - the administration fields (`PATCH /users/:id`: e-mail, status), as read by the real guard;
// - the invitation (no link is made, the e-mail is not sent);
// - the roles (`PUT /users/:id/roles`: adding or taking one away);
// - enabling and disabling;
// - the delete, the bulk delete and the check before it (refusal `PERSON_ABOVE_OWN_RIGHTS`);
// - the CSV import of people (the row is refused, nothing is written);
// - the data access of the person (`PUT /users/:id/data-access`, and its CSV import: the row is
//   refused).
// The same person still changes a person of their level or below, and their own profile. With a
// second role that lifts their level, they change that person too. An administrator changes
// everyone.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'person-above-own-rights-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Seed = {
  tenantId: string;
  roles: Record<'administrator' | 'contact' | 'userAdmin' | 'budgetReader' | 'budgetAdmin', string>;
  users: Record<'ua' | 'uaBudget' | 'admin' | 'admin2' | 'high' | 'peer' | 'disabledHigh', string>;
};

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `above-rights-${tenantId.slice(0, 8)}`;
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
  const user = async (key: string, roleId: string, extraRoles: string[] = [], status = 'enabled') => {
    const id = await insertId(runner,
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, password_hash)
       VALUES ($1, $2, $3, 'Tester', $4, $5, 'stored-hash')`,
      [tenantId, `${key}-${tenantId.slice(0, 8)}@example.test`, key, roleId, status]);
    for (const [index, extra] of [roleId, ...extraRoles].entries()) {
      await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, $4)`, [tenantId, id, extra, index === 0]);
    }
    return id;
  };
  const users = {
    ua: await user('ua', roles.userAdmin),
    uaBudget: await user('uabudget', roles.userAdmin, [roles.budgetAdmin]),
    admin: await user('admin', roles.administrator),
    admin2: await user('admin2', roles.administrator),
    // Above a budget reader through their second role only.
    high: await user('high', roles.budgetReader, [roles.budgetAdmin]),
    peer: await user('peer', roles.budgetReader),
    disabledHigh: await user('disabledhigh', roles.budgetAdmin, [], 'disabled'),
  };
  return { tenantId, roles, users };
}

function req(runner: QueryRunner, s: Seed, who: 'ua' | 'uaBudget' | 'admin') {
  return {
    queryRunner: runner,
    user: { sub: s.users[who] },
    tenant: { id: s.tenantId },
    isAdmin: who === 'admin',
    permissionLevel: 'admin',
    permissions: who === 'admin' ? {} : { users: 'admin', budget: who === 'ua' ? 'reader' : 'admin' },
  };
}

function ctx(runner: QueryRunner, s: Seed, who: 'ua' | 'admin') {
  const r = req(runner, s, who);
  return { manager: runner.manager, tenantId: s.tenantId, userId: s.users[who], isAdmin: r.isAdmin, permissions: r.permissions };
}

/** The request as `PermissionGuard` fills it for `PATCH /users/:id`, from the person's real roles. */
async function guardedRequest(app: any, runner: QueryRunner, s: Seed, who: 'ua'): Promise<any> {
  const { PermissionGuard } = require('../../auth/permission.guard');
  const { UsersController } = require('../users.controller');
  const { UsersService } = require('../users.service');
  const { PermissionsService } = require('../../permissions/permissions.service');
  const guard = new PermissionGuard(new Reflector(), app.get(UsersService), app.get(PermissionsService), app.get(DataSource), { isConfigured: () => false });
  const request: any = { queryRunner: runner, user: { sub: s.users[who] }, tenant: { id: s.tenantId }, method: 'PATCH' };
  const context = {
    getHandler: () => UsersController.prototype.update,
    getClass: () => UsersController,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}), getNext: () => undefined }),
  } as unknown as ExecutionContext;
  assert.equal(await guard.canActivate(context), true, 'guard lets a users administrator in');
  assert.equal(request.isAdmin, false);
  return request;
}

async function refused(fn: () => Promise<unknown>, label: string) {
  const error = await fn().then(() => null, (caught: unknown) => caught);
  assert.ok(error instanceof ForbiddenException, `${label}: 403 (got ${String(error)})`);
  assert.equal((error.getResponse() as { code?: string }).code, 'PERSON_ABOVE_OWN_RIGHTS', `${label}: code`);
}

async function row(runner: QueryRunner, id: string) {
  const rows = await runner.query(
    `SELECT u.email, u.status, u.first_name, u.role_id, u.password_hash, u.data_access_mode,
            (SELECT array_agg(role_id::text ORDER BY role_id) FROM user_roles WHERE user_id = u.id) AS roles,
            (SELECT count(*)::int FROM password_reset_tokens WHERE user_id = u.id) AS tokens
       FROM users u WHERE u.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

function csv(rows: Array<[string, string, string]>): Express.Multer.File {
  const content = ['email,first_name,last_name,role,company_name,department_name,status',
    ...rows.map(([email, first, role]) => `${email},${first},Tester,${role},,,enabled`)].join('\n');
  return { buffer: Buffer.from(`${content}\n`, 'utf8'), originalname: 'users.csv' } as Express.Multer.File;
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for person-above-own-rights.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { UsersController } = require('../users.controller');
  const { UsersService } = require('../users.service');
  const { DataAccessAdminController } = require('../../data-access/data-access-admin.controller');
  const { DataAccessController } = require('../../data-access/data-access.controller');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const users = app.get(UsersController);
  const svc = app.get(UsersService);
  const dataAccess = app.get(DataAccessAdminController);
  const dataAccessFiles = app.get(DataAccessController);
  const runner = app.get(DataSource).createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  let mailed = 0;
  svc.emailService.sendUserInviteEmail = async () => { mailed += 1; };
  try {
    const s = await seed(runner);
    const ua = req(runner, s, 'ua');
    const base = 'http://above-rights.localhost';
    const email = (tag: string) => `${tag}-${s.tenantId.slice(0, 8)}@example.test`;

    for (const target of [s.users.admin, s.users.high] as const) {
      const before = await row(runner, target);
      // The administration fields, through the real guard.
      const guarded = await guardedRequest(app, runner, s, 'ua');
      await refused(() => users.update(target, { email: email('elsewhere') }, guarded), 'PATCH e-mail');
      await refused(() => users.update(target, { status: 'disabled' }, ua), 'PATCH status');
      // The invitation: no link, no e-mail.
      await refused(() => svc.inviteUser(target, s.users.ua, base, { manager: runner.manager, roleGrant: ua }), 'invite');
      // The roles: adding one the actor holds, or taking all away.
      await refused(() => users.setUserRoles(target, { role_ids: [s.roles.budgetReader] }, ua), 'PUT roles (remove)');
      await refused(() => users.setUserRoles(target, { role_ids: [s.roles.contact] }, ua), 'PUT roles (replace)');
      await refused(() => users.disable(target, ua), 'disable');
      await refused(() => dataAccess.updatePerson(target, { mode: 'all', nodes: [] }, ctx(runner, s, 'ua')), 'data access');
      const accessFile = { buffer: Buffer.from(`email,type,node,access\n${before.email},all,,read\n`, 'utf8'), originalname: 'access.csv' };
      const access = await dataAccessFiles.import(accessFile, 'false', 'en', ctx(runner, s, 'ua'));
      assert.equal(access.ok, false, 'data access import refused');
      // An Administrator's row was already refused: they see all data.
      const expected = target === s.users.admin ? 'DATA_ACCESS_ADMINISTRATOR' : 'PERSON_ABOVE_OWN_RIGHTS';
      assert.deepEqual(access.errors.map((e: { code?: string }) => e.code), [expected], 'data access import: row refused');
      // The delete and its check.
      const single = await users.delete(target, ua).then(() => null, (e: unknown) => e);
      assert.ok(single instanceof ConflictException, 'delete refused');
      assert.equal((single.getResponse() as { code?: string }).code, 'PERSON_ABOVE_OWN_RIGHTS');
      const bulk = await users.bulkDelete({ ids: [target] }, ua);
      assert.deepEqual(bulk.deleted, [], 'bulk delete: nothing deleted');
      assert.equal(bulk.failed[0]?.code, 'PERSON_ABOVE_OWN_RIGHTS', 'bulk delete: code');
      const check = await users.deleteCheck({ ids: [target] }, ua);
      assert.equal(check.refused[0]?.code, 'PERSON_ABOVE_OWN_RIGHTS', 'delete check: code');
      // The import: the row is refused, nothing is written.
      for (const dryRun of ['true', 'false']) {
        const result = await users.import(csv([[(before.email as string), 'Renamed', 'Budget reader']]), dryRun, 'en', undefined, undefined, ua);
        assert.equal(result.ok, false, `import (dryRun ${dryRun}) refused`);
        assert.equal(result.errors[0]?.code, 'PERSON_ABOVE_OWN_RIGHTS', `import (dryRun ${dryRun}): code`);
      }
      assert.deepEqual(await row(runner, target), before, 'nothing written on the person');
    }
    await refused(() => users.enable(s.users.disabledHigh, ua), 'enable');
    assert.equal((await row(runner, s.users.disabledHigh)).status, 'disabled', 'enable refused: still disabled');
    assert.equal(mailed, 0, 'no invitation e-mail');

    // A person of their level or below, and their own profile, stay possible.
    await users.update(s.users.peer, { first_name: 'Peer', status: 'disabled' }, ua);
    await users.enable(s.users.peer, ua);
    await svc.inviteUser(s.users.peer, s.users.ua, base, { manager: runner.manager, roleGrant: ua });
    assert.equal(mailed, 1, 'invitation of a peer');
    await users.setUserRoles(s.users.peer, { role_ids: [s.roles.budgetReader, s.roles.contact] }, ua);
    await users.update(s.users.ua, { first_name: 'Self' }, ua);
    const loaded = await users.import(csv([[email('peer'), 'Imported', 'Budget reader']]), 'false', 'en', undefined, undefined, ua);
    assert.equal(loaded.ok, true, 'import of a peer');
    assert.equal((await row(runner, s.users.peer)).first_name, 'Imported');

    // A second role that lifts the actor's level counts.
    const uaBudget = req(runner, s, 'uaBudget');
    await users.update(s.users.high, { first_name: 'High' }, uaBudget);
    await refused(() => users.update(s.users.admin, { first_name: 'Admin' }, uaBudget), 'PATCH an administrator, budget administrator');

    // An administrator changes everyone.
    const admin = req(runner, s, 'admin');
    await users.update(s.users.admin2, { email: email('admin2-new') }, admin);
    await svc.inviteUser(s.users.admin2, s.users.admin, base, { manager: runner.manager, roleGrant: admin });
    await users.setUserRoles(s.users.high, { role_ids: [s.roles.budgetReader] }, admin);
    await users.delete(s.users.disabledHigh, admin);
    assert.equal(await row(runner, s.users.disabledHigh), null, 'deleted by an administrator');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await app.close();
  }
  console.log('person-above-own-rights.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
