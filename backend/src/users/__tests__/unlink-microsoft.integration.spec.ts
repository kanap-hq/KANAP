import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

// "Unlink from Microsoft" on the users screen (`POST /users/:id/unlink-microsoft`): the person's
// account becomes local (link removed, a password it holds kept, one entry in its history written
// in the name of the administrator). Under the rules of every write on a person: a users
// administrator who is not an administrator is refused on a person with more rights (403
// `PERSON_ABOVE_OWN_RIGHTS`, nothing written); an administrator unlinks everyone. A local account
// is left as it is.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'unlink-microsoft-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for unlink-microsoft.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { UsersController } = require('../users.controller');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const users = app.get(UsersController);
  const runner = app.get(DataSource).createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, sso_provider, sso_enabled, entra_tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, 'entra', true, $4, now(), now())`,
      [tenantId, `unlink-${tenantId.slice(0, 8)}`, `unlink-${tenantId.slice(0, 8)}`, randomUUID()],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const role = async (name: string, permissions: Record<string, string>, isSystem = false) => {
      const id = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, is_system) VALUES ($1, $2, $3)`, [tenantId, name, isSystem]);
      for (const [resource, level] of Object.entries(permissions)) {
        await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, id, resource, level]);
      }
      return id;
    };
    const administrator = await role('Administrator', { users: 'admin' }, true);
    const userAdmin = await role('Users administrator', { users: 'admin', budget: 'reader' });
    const budgetReader = await role('Budget reader', { budget: 'reader' });
    const budgetAdmin = await role('Budget administrator', { budget: 'admin' });
    const user = async (key: string, roleId: string, linked: boolean) => {
      const id = await insertId(runner,
        `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, password_hash, external_auth_provider, external_subject, external_synced_at)
         VALUES ($1, $2, $3, 'Tester', $4, 'enabled', 'stored-hash', $5, $6, $7)`,
        [tenantId, `${key}-${tenantId.slice(0, 8)}@example.test`, key, roleId,
          linked ? 'entra' : null, linked ? `oid-${key}` : null, linked ? new Date() : null]);
      await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, id, roleId]);
      return id;
    };
    const ua = await user('ua', userAdmin, false);
    const admin = await user('admin', administrator, true);
    const peer = await user('peer', budgetReader, true);
    const high = await user('high', budgetAdmin, true);
    const local = await user('local', budgetReader, false);
    const req = (who: string, isAdmin: boolean) => ({
      queryRunner: runner,
      user: { sub: who },
      tenant: { id: tenantId },
      isAdmin,
      permissionLevel: 'admin',
      permissions: isAdmin ? {} : { users: 'admin', budget: 'reader' },
    });
    const link = async (id: string) =>
      (await runner.query(
        `SELECT external_auth_provider, external_subject, external_synced_at, password_hash FROM users WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      ))[0];
    const history = async (id: string) =>
      runner.query(
        `SELECT user_id, source, before_json->>'external_auth_provider' AS before_provider, after_json->>'external_auth_provider' AS after_provider
           FROM audit_log WHERE tenant_id = $1 AND table_name = 'users' AND record_id = $2`,
        [tenantId, id],
      );

    // A users administrator unlinks a person of their level.
    await users.unlinkMicrosoft(peer, req(ua, false));
    assert.deepEqual(
      { ...(await link(peer)) },
      { external_auth_provider: null, external_subject: null, external_synced_at: null, password_hash: 'stored-hash' },
      'the account is local and keeps its password',
    );
    assert.deepEqual(
      (await history(peer)).map((row: any) => ({ ...row })),
      [{ user_id: ua, source: 'user', before_provider: 'entra', after_provider: null }],
      'one entry in the person\'s history, in the administrator\'s name',
    );

    // Not a person with more rights: refused, nothing written.
    for (const target of [high, admin]) {
      const error = await users.unlinkMicrosoft(target, req(ua, false)).then(() => null, (caught: unknown) => caught);
      assert.ok(error instanceof ForbiddenException, `403 (got ${String(error)})`);
      assert.equal((error.getResponse() as { code?: string }).code, 'PERSON_ABOVE_OWN_RIGHTS');
      assert.equal((await link(target)).external_auth_provider, 'entra', 'still linked');
      assert.equal((await history(target)).length, 0, 'nothing written');
    }

    // An administrator unlinks everyone.
    await users.unlinkMicrosoft(high, req(admin, true));
    assert.equal((await link(high)).external_auth_provider, null);

    // A local account is left as it is.
    await users.unlinkMicrosoft(local, req(admin, true));
    assert.equal((await history(local)).length, 0, 'no entry for a local account');

    // Not a user id: 404.
    const missing = await users.unlinkMicrosoft('me', req(admin, true)).then(() => null, (caught: unknown) => caught);
    assert.ok(missing instanceof NotFoundException);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await app.close();
  }
  console.log('unlink-microsoft.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
