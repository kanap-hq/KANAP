import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantExecution } from '../../common/tenant-runner';
import { purgeTenantTables } from '../../admin/tenants/tenant-data-purge';
import { TENANT_PURGE_TABLES } from '../../admin/tenants/tenant-purge.inventory';

// A write on a person locks their row before it reads their rights. While an administrator makes a
// person Administrator (their transaction not committed yet), a users administrator's write on the
// same person waits, then reads the person as an Administrator and is refused (403
// `PERSON_ABOVE_OWN_RIGHTS`): their roles (`PATCH /users/:id` with `role_ids`) and their e-mail
// stay as the administrator left them. Two real transactions on two connections.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'person-write-lock-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Seed = {
  tenantId: string;
  roles: Record<'administrator' | 'contact' | 'userAdmin' | 'reader', string>;
  users: Record<'admin' | 'ua' | 'p1' | 'p2', string>;
  email: (tag: string) => string;
};

async function seed(setup: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const email = (tag: string) => `${tag}-${tenantId.slice(0, 8)}@example.test`;
  await setup.startTransaction();
  try {
    const slug = `person-lock-${tenantId.slice(0, 8)}`;
    await setup.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, slug, slug],
    );
    await setup.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const role = async (name: string, permissions: Record<string, string>, isSystem = false) => {
      const id = (await setup.query(`INSERT INTO roles (tenant_id, role_name, is_system) VALUES ($1, $2, $3) RETURNING id`, [tenantId, name, isSystem]))[0].id;
      for (const [resource, level] of Object.entries(permissions)) {
        await setup.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, id, resource, level]);
      }
      return id as string;
    };
    const roles = {
      administrator: await role('Administrator', { users: 'admin' }, true),
      contact: await role('Contact', {}, true),
      userAdmin: await role('Users administrator', { users: 'admin', budget: 'reader' }),
      reader: await role('Budget reader', { budget: 'reader' }),
    };
    const user = async (key: string, roleId: string) => {
      const id = (await setup.query(
        `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, password_hash)
         VALUES ($1, $2, $3, 'Tester', $4, 'enabled', 'stored-hash') RETURNING id`,
        [tenantId, email(key), key, roleId],
      ))[0].id as string;
      await setup.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, id, roleId]);
      return id;
    };
    const users = {
      admin: await user('admin', roles.administrator),
      ua: await user('ua', roles.userAdmin),
      p1: await user('p1', roles.reader),
      p2: await user('p2', roles.reader),
    };
    await setup.commitTransaction();
    return { tenantId, roles, users, email };
  } catch (error) {
    if (setup.isTransactionActive) await setup.rollbackTransaction();
    throw error;
  }
}

function req(runner: QueryRunner, s: Seed, who: 'admin' | 'ua') {
  return {
    queryRunner: runner,
    user: { sub: s.users[who] },
    tenant: { id: s.tenantId },
    isAdmin: who === 'admin',
    permissionLevel: 'admin',
    permissions: who === 'admin' ? {} : { users: 'admin', budget: 'reader' },
  };
}

async function state(dataSource: DataSource, s: Seed, id: string) {
  return withTenantExecution(dataSource, s.tenantId, async (manager) => (await manager.query(
    `SELECT u.email, u.role_id,
            (SELECT array_agg(role_id::text ORDER BY role_id) FROM user_roles WHERE user_id = u.id) AS roles
       FROM users u WHERE u.id = $1`,
    [id],
  ))[0]);
}

/** The administrator makes `target` Administrator; meanwhile the users administrator writes `body` on them. */
async function race(app: any, dataSource: DataSource, s: Seed, target: string, body: Record<string, unknown>) {
  const { UsersController } = require('../users.controller');
  const users = app.get(UsersController);
  const one = dataSource.createQueryRunner();
  const two = dataSource.createQueryRunner();
  await one.connect();
  await two.connect();
  try {
    for (const runner of [one, two]) {
      await runner.startTransaction();
      await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [s.tenantId]);
    }
    await users.setUserRoles(target, { role_ids: [s.roles.administrator] }, req(one, s, 'admin'));
    let settled = false;
    const second = users.update(target, body, req(two, s, 'ua')).then(() => null, (e: unknown) => e).finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(settled, false, 'the second write waits for the first');
    await one.commitTransaction();
    const error = await second;
    if (two.isTransactionActive) await two.rollbackTransaction();
    return error;
  } finally {
    for (const runner of [one, two]) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
  }
}

function refused(error: unknown, label: string) {
  assert.ok(error instanceof ForbiddenException, `${label}: 403 (got ${String(error)})`);
  assert.equal((error.getResponse() as { code?: string }).code, 'PERSON_ABOVE_OWN_RIGHTS', `${label}: code`);
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for person-write-lock.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const dataSource = app.get(DataSource);
  const setup = dataSource.createQueryRunner();
  await setup.connect();
  let s: Seed | null = null;
  try {
    s = await seed(setup);

    // Their roles: the Administrator role the first write gave stays.
    refused(await race(app, dataSource, s, s.users.p1, { role_ids: [s.roles.reader] }), 'roles');
    const p1 = await state(dataSource, s, s.users.p1);
    assert.deepEqual(p1.roles, [s.roles.administrator], 'roles: the Administrator role stays');
    assert.equal(p1.role_id, s.roles.administrator);

    // Their e-mail: the new Administrator keeps their address.
    refused(await race(app, dataSource, s, s.users.p2, { email: s.email('elsewhere') }), 'e-mail');
    assert.equal((await state(dataSource, s, s.users.p2)).email, s.email('p2'), 'e-mail unchanged');
  } finally {
    if (s) {
      const tenantId = s.tenantId;
      await withTenantExecution(dataSource, tenantId, (manager) => purgeTenantTables(manager, TENANT_PURGE_TABLES));
      await setup.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    }
    await setup.release();
    await app.close();
  }
  console.log('person-write-lock.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
