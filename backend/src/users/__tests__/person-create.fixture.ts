import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantExecution } from '../../common/tenant-runner';
import { purgeTenantTables } from '../../admin/tenants/tenant-data-purge';
import { TENANT_PURGE_TABLES } from '../../admin/tenants/tenant-purge.inventory';

// The workspace of the person creation specs (`POST /users`): committed, purged at the end.

export type RoleKey = 'administrator' | 'contact' | 'userAdmin' | 'budgetReader' | 'budgetAdmin';
export type UserKey = 'admin' | 'ua' | 'enabled' | 'disabled' | 'invited';
export type Seed = { tenantId: string; roles: Record<RoleKey, string>; users: Record<UserKey, string>; email: (tag: string) => string };

async function seed(setup: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const email = (tag: string) => `${tag}-${tenantId.slice(0, 8)}@example.test`;
  await setup.startTransaction();
  try {
    const slug = `person-create-${tenantId.slice(0, 8)}`;
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
    const roles: Record<RoleKey, string> = {
      administrator: await role('Administrator', { users: 'admin', budget: 'admin' }, true),
      contact: await role('Contact', {}, true),
      userAdmin: await role('Users administrator', { users: 'admin', budget: 'reader' }),
      budgetReader: await role('Budget reader', { budget: 'reader' }),
      budgetAdmin: await role('Budget administrator', { budget: 'admin' }),
    };
    const user = async (key: string, roleId: string, status: string) => {
      const id = (await setup.query(
        `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status)
         VALUES ($1, $2, $3, 'Tester', $4, $5) RETURNING id`,
        [tenantId, email(key), key, roleId, status],
      ))[0].id as string;
      await setup.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, id, roleId]);
      return id;
    };
    const users: Record<UserKey, string> = {
      admin: await user('admin', roles.administrator, 'enabled'),
      ua: await user('ua', roles.userAdmin, 'enabled'),
      enabled: await user('enabled', roles.budgetReader, 'enabled'),
      disabled: await user('disabled', roles.budgetReader, 'disabled'),
      invited: await user('invited', roles.budgetReader, 'invited'),
    };
    await setup.commitTransaction();
    return { tenantId, roles, users, email };
  } catch (error) {
    if (setup.isTransactionActive) await setup.rollbackTransaction();
    throw error;
  }
}

export function req(runner: QueryRunner, s: Seed, who: 'admin' | 'ua') {
  return {
    queryRunner: runner,
    user: { sub: s.users[who] },
    tenant: { id: s.tenantId },
    isAdmin: who === 'admin',
    permissionLevel: 'admin',
    permissions: who === 'admin' ? {} : { users: 'admin', budget: 'reader' },
  };
}

/** Runs `fn` in a transaction of its own, rolled back: what the request wrote before a refusal is still visible inside. */
export async function inRequest<T>(dataSource: DataSource, s: Seed, fn: (runner: QueryRunner) => Promise<T>): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    await runner.startTransaction();
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [s.tenantId]);
    return await fn(runner);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
}

export async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => null, (error: unknown) => error);
}

export function refusedWith(error: unknown, type: any, code: string, label: string) {
  assert.ok(error instanceof type, `${label}: ${type.name} (got ${String(error)})`);
  assert.equal(((error as any).getResponse() as { code?: string }).code, code, `${label}: code`);
}

/** Nothing exists for `email` in the request's transaction: no person, no role row, no audit entry. */
export async function nothingFor(runner: QueryRunner, email: string, label: string) {
  const [row] = await runner.query(
    `SELECT (SELECT count(*)::int FROM users WHERE email = $1) AS users,
            (SELECT count(*)::int FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE u.email = $1) AS roles,
            (SELECT count(*)::int FROM audit_log WHERE table_name IN ('users', 'user_roles') AND (after_json->>'email' = $1)) AS audit`,
    [email],
  );
  assert.deepEqual(row, { users: 0, roles: 0, audit: 0 }, `${label}: nothing created`);
}

export async function personState(runner: QueryRunner, userId: string) {
  return (await runner.query(
    `SELECT u.first_name, u.status, u.role_id, u.updated_at,
            (SELECT array_agg(role_id::text ORDER BY role_id) FROM user_roles WHERE user_id = u.id) AS roles
       FROM users u WHERE u.id = $1`,
    [userId],
  ))[0];
}

export async function heldRoles(runner: QueryRunner, userId: string) {
  return (await runner.query(
    `SELECT role_id::text, is_primary FROM user_roles WHERE user_id = $1 ORDER BY is_primary DESC, role_id`,
    [userId],
  )) as Array<{ role_id: string; is_primary: boolean }>;
}


/** Boots the application, seeds a workspace, runs `fn`, then purges the workspace. */
export async function withSeededWorkspace(label: string, fn: (users: any, dataSource: DataSource, s: Seed) => Promise<void>) {
  if (!process.env.DATABASE_URL) throw new Error(`DATABASE_URL is required for ${label}.`);
  const { AppModule } = require('../../app.module');
  const { UsersController } = require('../users.controller');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const dataSource = app.get(DataSource);
  const setup = dataSource.createQueryRunner();
  await setup.connect();
  let s: Seed | null = null;
  try {
    s = await seed(setup);
    await fn(app.get(UsersController), dataSource, s);
  } finally {
    if (s) {
      const tenantId = s.tenantId;
      await withTenantExecution(dataSource, tenantId, (manager) => purgeTenantTables(manager, TENANT_PURGE_TABLES));
      await setup.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    }
    await setup.release();
    await app.close();
  }
  console.log(`${label}: ok`);
}
