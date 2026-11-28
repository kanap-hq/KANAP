import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { Features } from '../../config/features';
import { InstallationAdminGuard } from '../installation-admin.guard';

// The installation administrator guard against a real database, on-premise (single-tenant): the
// roles are read in the request's tenant transaction, where `user_roles` is under forced row level
// security. The workspace is committed (a read outside the transaction would not see it otherwise)
// and removed at the end.
// - Administrator as the primary role: allowed;
// - Administrator as an extra role: allowed (the guard of the scheduled tasks read the roles
//   outside the transaction and refused this person);
// - another role: 403 `administrator_required`;
// - an Administrator whose data access is limited: the guard allows, and the data access stays
//   "all" (an Administrator is never limited, data_access_apply): the reserved route serves them;
// - a limited person without the Administrator role: 403 `administrator_required`, before the
//   tenant interceptor would answer `DATA_ACCESS_LIMITED`;
// - the person is read again, as `PermissionGuard` does, while the access token still names the
//   former state: an Administrator moved to another role gets 403 `administrator_required`, a
//   disabled one 401 `USER_DISABLED`, a person whose extra Administrator role was removed 403.

type Seeded = {
  tenantId: string;
  primaryAdmin: string;
  extraAdmin: string;
  reader: string;
  limitedAdmin: string;
  limitedReader: string;
  demoted: string;
  disabled: string;
  extraRemoved: string;
};

function contextOf(req: Record<string, unknown>): any {
  return { switchToHttp: () => ({ getRequest: () => req }) };
}

async function inTenant<T>(tenantId: string, fn: (runner: QueryRunner) => Promise<T>, commit = false): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const result = await fn(runner);
    if (commit) await runner.commitTransaction();
    else await runner.rollbackTransaction();
    return result;
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
}

async function seed(): Promise<Seeded> {
  const tenantId = randomUUID();
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Installation guard', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `installation-guard-${tenantId.slice(0, 8)}`],
  );
  return inTenant(tenantId, async (runner) => {
    const role = async (name: string) => {
      const [row] = await runner.query(
        `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in)
         VALUES ($1, $2, 'installation guard spec', false, false) RETURNING id`,
        [tenantId, name],
      );
      return row.id as string;
    };
    const administrator = await role('Administrator');
    const reader = await role('IT Landscape Reader');
    const person = async (roleId: string, mode: 'all' | 'limited', extraRoleId?: string) => {
      const id = randomUUID();
      await runner.query(
        `INSERT INTO users (id, tenant_id, email, role_id, status, data_access_mode) VALUES ($1, $2, $3, $4, 'enabled', $5)`,
        [id, tenantId, `guard-${id.slice(0, 8)}@example.invalid`, roleId, mode],
      );
      if (extraRoleId) {
        await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)`, [tenantId, id, extraRoleId]);
      }
      return id;
    };
    const seeded = {
      tenantId,
      primaryAdmin: await person(administrator, 'all'),
      extraAdmin: await person(reader, 'all', administrator),
      reader: await person(reader, 'all'),
      limitedAdmin: await person(administrator, 'limited'),
      limitedReader: await person(reader, 'limited'),
      demoted: await person(administrator, 'all'),
      disabled: await person(administrator, 'all'),
      extraRemoved: await person(reader, 'all', administrator),
    };
    // After their access token was signed: one moved to another role, one disabled, one whose
    // extra Administrator role was removed.
    await runner.query(`UPDATE users SET role_id = $2 WHERE id = $1`, [seeded.demoted, reader]);
    await runner.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [seeded.disabled]);
    await runner.query(`DELETE FROM user_roles WHERE user_id = $1`, [seeded.extraRemoved]);
    return seeded;
  }, true);
}

async function remove(seeded: Seeded) {
  await inTenant(seeded.tenantId, async (runner) => {
    for (const table of ['user_roles', 'users', 'roles']) {
      await runner.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [seeded.tenantId]);
    }
  }, true);
  await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [seeded.tenantId]);
}

/** The guard's answer for a person, in a request transaction of the workspace (as TenantInitGuard opens it). */
async function answer(seeded: Seeded, userId: string, primaryRole: string): Promise<true | string> {
  const guard = new InstallationAdminGuard(dataSource);
  return inTenant(seeded.tenantId, async (runner) => {
    const req = { user: { sub: userId, email: 'someone@example.invalid', role: { role_name: primaryRole } }, queryRunner: runner };
    try {
      assert.equal(await guard.canActivate(contextOf(req)), true);
      return true;
    } catch (error) {
      assert.ok(error instanceof ForbiddenException || error instanceof UnauthorizedException, `a 403 or a 401, got ${String(error)}`);
      return `${error.getStatus()} ${String((error.getResponse() as Record<string, unknown>).code)}`;
    }
  });
}

async function dataAccessModeOf(seeded: Seeded, userId: string): Promise<string> {
  return inTenant(seeded.tenantId, async (runner) => {
    const [row] = await runner.query(`SELECT data_access_apply($1) AS mode`, [userId]);
    return row.mode as string;
  });
}

async function run() {
  await dataSource.initialize();
  const previousSingleTenant = Features.SINGLE_TENANT;
  Features.SINGLE_TENANT = true;
  let seeded: Seeded | null = null;
  try {
    seeded = await seed();
    assert.equal(await answer(seeded, seeded.primaryAdmin, 'Administrator'), true, 'Administrator as the primary role');
    assert.equal(await answer(seeded, seeded.extraAdmin, 'IT Landscape Reader'), true, 'Administrator as an extra role');
    assert.equal(await answer(seeded, seeded.reader, 'IT Landscape Reader'), '403 administrator_required', 'another role');
    assert.equal(await answer(seeded, seeded.limitedAdmin, 'Administrator'), true, 'a limited Administrator passes the guard');
    assert.equal(await dataAccessModeOf(seeded, seeded.limitedAdmin), 'all', 'an Administrator is never limited');
    assert.equal(await answer(seeded, seeded.limitedReader, 'IT Landscape Reader'), '403 administrator_required', 'a limited person without the role');
    // The token still says Administrator (or the former extra role): the database decides.
    assert.deepEqual(
      {
        demoted: await answer(seeded, seeded.demoted, 'Administrator'),
        disabled: await answer(seeded, seeded.disabled, 'Administrator'),
        extraRemoved: await answer(seeded, seeded.extraRemoved, 'IT Landscape Reader'),
      },
      { demoted: '403 administrator_required', disabled: '401 USER_DISABLED', extraRemoved: '403 administrator_required' },
      'the person as stored, with a token still valid',
    );
  } finally {
    Features.SINGLE_TENANT = previousSingleTenant;
    if (seeded) await remove(seeded);
    await dataSource.destroy();
  }
  console.log('installation-admin.guard.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
