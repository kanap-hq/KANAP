import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import dataSource from '../../../data-source';
import { Features } from '../../../config/features';
import { TenantInitGuard } from '../../../common/tenant-init.guard';
import { ScheduledTasksController } from '../scheduled-tasks.controller';
import { SystemAdminGuard } from '../system-admin.guard';

// Who opens the scheduled task routes (`/admin/scheduled-tasks`), with the roles stored in the
// database. The request goes through the real TenantInitGuard (the request's tenant transaction),
// then the real SystemAdminGuard on the controller's route. On site the Administrator role opens
// them, as the principal role or as an extra role, as the screen counts it (`isGlobalAdmin`); an
// extra role is read in the workspace of the request, so an Administrator role of another workspace
// does not count. In the cloud only a platform administrator on the platform host passes, whatever
// the roles. The seed is committed (an uncommitted row would be invisible to another connection for
// a reason unrelated to the workspace context), then deleted.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file in its database lane.

type Seed = {
  tenantId: string;
  otherTenantId: string;
  administratorId: string;
  extraAdministratorId: string;
  readerId: string;
};

const READER_ROLE = { role_name: 'Budget Reader' };
const ADMINISTRATOR_ROLE = { role_name: 'Administrator' };

async function seed(): Promise<Seed> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    const otherTenantId = randomUUID();
    for (const id of [tenantId, otherTenantId]) {
      await runner.query(
        `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
         VALUES ($1, $2, 'System admin guard', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
        [id, `system-admin-guard-${id.slice(0, 8)}`],
      );
    }
    const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
    const inTenant = (id: string) => runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [id]);

    // The other workspace: its Administrator role, and a second role of that name in another case.
    await inTenant(otherTenantId);
    const foreignRoleId = await one(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Administrator') RETURNING id`, [otherTenantId]);
    const foreignRoleId2 = await one(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'administrator ') RETURNING id`, [otherTenantId]);

    await inTenant(tenantId);
    const administratorRole = await one(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Administrator') RETURNING id`, [tenantId]);
    const readerRole = await one(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Budget Reader') RETURNING id`, [tenantId]);
    const person = async (label: string, principalRole: string, extraRoles: string[]) => {
      const userId = await one(
        `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status) VALUES ($1, $2, 'Guard', $3, $4, 'enabled') RETURNING id`,
        [tenantId, principalRole, label, `${label}-${randomUUID()}@example.invalid`],
      );
      await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, userId, principalRole]);
      for (const roleId of extraRoles) {
        await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, false)`, [tenantId, userId, roleId]);
      }
      return userId;
    };
    const administratorId = await person('administrator', administratorRole, []);
    const extraAdministratorId = await person('extra-administrator', readerRole, [administratorRole]);
    // A reader whose rows name an Administrator role of the other workspace: one row of this
    // workspace pointing at that role, one row stored in the other workspace.
    const readerId = await person('reader', readerRole, [foreignRoleId]);
    await inTenant(otherTenantId);
    await runner.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, false)`,
      [otherTenantId, readerId, foreignRoleId2],
    );
    await runner.commitTransaction();
    return { tenantId, otherTenantId, administratorId, extraAdministratorId, readerId };
  } catch (error) {
    await runner.rollbackTransaction().catch(() => undefined);
    throw error;
  } finally {
    await runner.release();
  }
}

/** `users`, `roles` and `user_roles` hold no key to `tenants`: each is emptied in its workspace. */
async function cleanUp(s: Seed | undefined) {
  if (!s) return;
  for (const id of [s.tenantId, s.otherTenantId]) {
    await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [id]);
      await manager.query(`DELETE FROM user_roles WHERE tenant_id = $1`, [id]);
      await manager.query(`DELETE FROM users WHERE tenant_id = $1`, [id]);
      await manager.query(`DELETE FROM roles WHERE tenant_id = $1`, [id]);
      await manager.query(`DELETE FROM tenants WHERE id = $1`, [id]);
    });
  }
}

function contextOf(req: any): ExecutionContext {
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

type Answer = { status: number; code?: string };

/** `GET /admin/scheduled-tasks` up to its guards: the tenant transaction, then the guard. */
async function call(
  tenantId: string,
  user: { sub: string; email: string; role: { role_name: string } },
  isPlatformHost = false,
): Promise<Answer> {
  const req: any = { method: 'GET', headers: {}, tenant: { id: tenantId }, user: { ...user, tenant_id: tenantId }, isPlatformHost };
  const context = contextOf(req);
  try {
    assert.equal(await new TenantInitGuard(dataSource, new Reflector()).canActivate(context), true);
    assert.ok(req.queryRunner, 'the request holds its tenant transaction');
    const allowed = await new SystemAdminGuard().canActivate(context);
    return { status: allowed ? 200 : 403 };
  } catch (error) {
    if (error instanceof HttpException) {
      const body = error.getResponse() as { code?: string };
      return { status: error.getStatus(), code: body?.code };
    }
    throw error;
  } finally {
    if (req.queryRunner) {
      await req.queryRunner.rollbackTransaction().catch(() => undefined);
      await req.queryRunner.release().catch(() => undefined);
    }
  }
}

const ALLOWED: Answer = { status: 200 };
const NOT_ADMINISTRATOR: Answer = { status: 403, code: 'administrator_required' };
const NOT_PLATFORM: Answer = { status: 403, code: 'platform_admin_required' };

async function testSingleTenant(s: Seed) {
  const previous = Features.SINGLE_TENANT;
  Features.SINGLE_TENANT = true;
  try {
    const email = 'guard@example.invalid';
    assert.deepEqual(await call(s.tenantId, { sub: s.administratorId, email, role: ADMINISTRATOR_ROLE }), ALLOWED,
      'Administrator as the principal role');
    assert.deepEqual(await call(s.tenantId, { sub: s.extraAdministratorId, email, role: READER_ROLE }), ALLOWED,
      'Administrator as an extra role (principal role Budget Reader)');
    assert.deepEqual(await call(s.tenantId, { sub: s.readerId, email, role: READER_ROLE }), NOT_ADMINISTRATOR,
      'neither: the Administrator roles of another workspace do not count');
  } finally {
    Features.SINGLE_TENANT = previous;
  }
  console.log('ok - on site: Administrator as the principal or an extra role passes; another workspace\'s Administrator role does not');
}

async function testCloud(s: Seed) {
  const previousSingleTenant = Features.SINGLE_TENANT;
  const previousAllowlist = process.env.PLATFORM_ADMIN_EMAILS;
  Features.SINGLE_TENANT = false;
  process.env.PLATFORM_ADMIN_EMAILS = 'platform@example.invalid';
  try {
    const platform = 'platform@example.invalid';
    const other = 'someone@example.invalid';
    // Platform host: the platform administrator only, whatever the stored roles.
    assert.deepEqual(await call(s.tenantId, { sub: s.administratorId, email: platform, role: READER_ROLE }, true), ALLOWED,
      'platform host, platform administrator');
    assert.deepEqual(await call(s.tenantId, { sub: s.administratorId, email: other, role: ADMINISTRATOR_ROLE }, true), NOT_PLATFORM,
      'platform host, Administrator who is not a platform administrator');
    assert.deepEqual(await call(s.tenantId, { sub: s.extraAdministratorId, email: other, role: READER_ROLE }, true), NOT_PLATFORM,
      'platform host, Administrator as an extra role');
    // A workspace host: always refused.
    assert.deepEqual(await call(s.tenantId, { sub: s.administratorId, email: other, role: ADMINISTRATOR_ROLE }), NOT_PLATFORM,
      'workspace host, Administrator');
    assert.deepEqual(await call(s.tenantId, { sub: s.extraAdministratorId, email: other, role: READER_ROLE }), NOT_PLATFORM,
      'workspace host, Administrator as an extra role');
    assert.deepEqual(await call(s.tenantId, { sub: s.administratorId, email: platform, role: ADMINISTRATOR_ROLE }), NOT_PLATFORM,
      'workspace host, platform administrator');
  } finally {
    Features.SINGLE_TENANT = previousSingleTenant;
    if (previousAllowlist === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
    else process.env.PLATFORM_ADMIN_EMAILS = previousAllowlist;
  }
  console.log('ok - in the cloud: platform host and platform administrator only, roles ignored');
}

async function main() {
  await dataSource.initialize();
  let s: Seed | undefined;
  try {
    s = await seed();
    await testSingleTenant(s);
    await testCloud(s);
    console.log('system-admin.guard.integration.spec: ok');
  } finally {
    await cleanUp(s);
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
