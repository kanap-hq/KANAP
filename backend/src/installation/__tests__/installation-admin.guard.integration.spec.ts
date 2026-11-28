import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ExecutionContext, ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { Features } from '../../config/features';
import { TenantInitGuard } from '../../common/tenant-init.guard';
import { ScheduledTasksController } from '../../admin/scheduled-tasks/scheduled-tasks.controller';
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
// Then the scheduled task route (`GET /admin/scheduled-tasks`) up to its guards: the real
// TenantInitGuard opens the request's tenant transaction, then this guard runs.
// - on site, an extra Administrator role passes; Administrator roles of another workspace (a row
//   of this workspace naming that role, a row stored in the other workspace) do not count: 403;
// - in the cloud, the platform host and a platform administrator pass whatever their roles; an
//   Administrator, primary or extra, who is not a platform administrator gets 403
//   `platform_admin_required`, and so does everyone on a workspace host.

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
  otherTenantId: string;
  foreignExtra: string;
  platformPerson: string;
  platformEmail: string;
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
  const otherTenantId = randomUUID();
  for (const id of [tenantId, otherTenantId]) {
    await dataSource.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Installation guard', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [id, `installation-guard-${id.slice(0, 8)}`],
    );
  }
  // Two Administrator roles of another workspace.
  const [foreignRole, foreignRole2] = await inTenant(otherTenantId, async (runner) => {
    const ids: string[] = [];
    for (const name of ['Administrator', 'administrator ']) {
      const [row] = await runner.query(
        `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in)
         VALUES ($1, $2, 'installation guard spec', false, false) RETURNING id`,
        [otherTenantId, name],
      );
      ids.push(row.id as string);
    }
    return ids;
  }, true);
  const platformEmail = `platform-${tenantId.slice(0, 8)}@example.invalid`;
  const seededInTenant = await inTenant(tenantId, async (runner) => {
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
    const person = async (roleId: string, mode: 'all' | 'limited', extraRoleId?: string, email?: string) => {
      const id = randomUUID();
      await runner.query(
        `INSERT INTO users (id, tenant_id, email, role_id, status, data_access_mode) VALUES ($1, $2, $3, $4, 'enabled', $5)`,
        [id, tenantId, email ?? `guard-${id.slice(0, 8)}@example.invalid`, roleId, mode],
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
      otherTenantId,
      // A reader whose extra role row, stored in this workspace, names the other workspace's Administrator role.
      foreignExtra: await person(reader, 'all', foreignRole),
      platformPerson: await person(reader, 'all', undefined, platformEmail),
      platformEmail,
    };
    // After their access token was signed: one moved to another role, one disabled, one whose
    // extra Administrator role was removed.
    await runner.query(`UPDATE users SET role_id = $2 WHERE id = $1`, [seeded.demoted, reader]);
    await runner.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [seeded.disabled]);
    await runner.query(`DELETE FROM user_roles WHERE user_id = $1`, [seeded.extraRemoved]);
    return seeded;
  }, true);
  // And a second row for that reader, stored in the other workspace.
  await inTenant(otherTenantId, (runner) => runner.query(
    `INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)`,
    [otherTenantId, seededInTenant.foreignExtra, foreignRole2],
  ), true);
  return seededInTenant;
}

async function remove(seeded: Seeded) {
  for (const tenantId of [seeded.tenantId, seeded.otherTenantId]) {
    await inTenant(tenantId, async (runner) => {
      for (const table of ['user_roles', 'users', 'roles']) {
        await runner.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
      }
    }, true);
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  }
}

function routeContextOf(req: Record<string, unknown>): ExecutionContext {
  const http = { getRequest: () => req, getResponse: () => ({}), getNext: () => undefined };
  return {
    getHandler: () => ScheduledTasksController.prototype.list,
    getClass: () => ScheduledTasksController,
    switchToHttp: () => http,
    getType: () => 'http',
    getArgs: () => [req, {}, undefined],
    getArgByIndex: (i: number) => [req, {}, undefined][i],
    switchToRpc: () => { throw new Error('http only'); },
    switchToWs: () => { throw new Error('http only'); },
  } as unknown as ExecutionContext;
}

/** `GET /admin/scheduled-tasks` up to its guards: the tenant transaction, then this guard. */
async function throughScheduledTasks(
  seeded: Seeded,
  userId: string,
  token: { email: string; primaryRole: string },
  isPlatformHost = false,
): Promise<true | string> {
  const req: any = {
    method: 'GET',
    headers: {},
    tenant: { id: seeded.tenantId },
    user: { sub: userId, email: token.email, role: { role_name: token.primaryRole }, tenant_id: seeded.tenantId },
    isPlatformHost,
  };
  const context = routeContextOf(req);
  try {
    assert.equal(await new TenantInitGuard(dataSource, new Reflector()).canActivate(context), true);
    assert.ok(req.queryRunner, 'the request holds its tenant transaction');
    assert.equal(await new InstallationAdminGuard(dataSource).canActivate(context), true);
    return true;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    return `${error.getStatus()} ${String((error.getResponse() as Record<string, unknown>).code)}`;
  } finally {
    if (req.queryRunner) {
      await req.queryRunner.rollbackTransaction().catch(() => undefined);
      await req.queryRunner.release().catch(() => undefined);
    }
  }
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
  const previousAllowlist = process.env.PLATFORM_ADMIN_EMAILS;
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

    // The scheduled task route carries this guard.
    const routeGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, ScheduledTasksController) ?? [];
    assert.ok(routeGuards.includes(InstallationAdminGuard), 'the scheduled task routes are behind InstallationAdminGuard');
    const someone = 'someone@example.invalid';
    assert.deepEqual(
      {
        extraAdmin: await throughScheduledTasks(seeded, seeded.extraAdmin, { email: someone, primaryRole: 'IT Landscape Reader' }),
        foreignExtra: await throughScheduledTasks(seeded, seeded.foreignExtra, { email: someone, primaryRole: 'IT Landscape Reader' }),
      },
      { extraAdmin: true, foreignExtra: '403 administrator_required' },
      'on site, through the scheduled task route: the Administrator roles of another workspace do not count',
    );

    Features.SINGLE_TENANT = false;
    process.env.PLATFORM_ADMIN_EMAILS = seeded.platformEmail;
    const platform = { email: seeded.platformEmail, primaryRole: 'IT Landscape Reader' };
    const administrator = { email: someone, primaryRole: 'Administrator' };
    const extraAdministrator = { email: someone, primaryRole: 'IT Landscape Reader' };
    assert.deepEqual(
      {
        platformHostPlatformAdmin: await throughScheduledTasks(seeded, seeded.platformPerson, platform, true),
        platformHostAdministrator: await throughScheduledTasks(seeded, seeded.primaryAdmin, administrator, true),
        platformHostExtraAdministrator: await throughScheduledTasks(seeded, seeded.extraAdmin, extraAdministrator, true),
        workspaceHostAdministrator: await throughScheduledTasks(seeded, seeded.primaryAdmin, administrator),
        workspaceHostExtraAdministrator: await throughScheduledTasks(seeded, seeded.extraAdmin, extraAdministrator),
        workspaceHostPlatformAdmin: await throughScheduledTasks(seeded, seeded.platformPerson, platform),
      },
      {
        platformHostPlatformAdmin: true,
        platformHostAdministrator: '403 platform_admin_required',
        platformHostExtraAdministrator: '403 platform_admin_required',
        workspaceHostAdministrator: '403 platform_admin_required',
        workspaceHostExtraAdministrator: '403 platform_admin_required',
        workspaceHostPlatformAdmin: '403 platform_admin_required',
      },
      'in the cloud, through the scheduled task route: the platform host and a platform administrator only, roles ignored',
    );
  } finally {
    Features.SINGLE_TENANT = previousSingleTenant;
    if (previousAllowlist === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
    else process.env.PLATFORM_ADMIN_EMAILS = previousAllowlist;
    if (seeded) await remove(seeded);
    await dataSource.destroy();
  }
  console.log('installation-admin.guard.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
