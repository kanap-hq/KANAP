// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { Location } from '../../locations/location.entity';
import { Tenant } from '../../tenants/tenant.entity';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { Application } from '../application.entity';
import { ApplicationsController } from '../applications.controller';
import { ApplicationsDeleteService } from '../applications-delete.service';
import { ApplicationsCrudService } from '../services/applications-crud.service';

// "Cancel creation" of an application (lot 1a of the creation frame): `POST /applications` hands
// the creator a token; `GET :id/creation` counts what was written since the creation;
// `DELETE :id/creation` deletes the record for its creator at the create level (member), through
// the usual delete and its audit entry. Another person's token, or the token of another
// application, is refused with `CREATION_CANCEL_EXPIRED`.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'application-cancel-creation-spec-secret';

type Ctx = { tenantId: string; userId: string; isAdmin: boolean; permissions: Record<string, string>; manager: any };

async function inRolledBackTransaction(fn: (runner: QueryRunner) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function seed(runner: QueryRunner) {
  const tag = randomUUID().slice(0, 8);
  const tenantId = randomUUID();
  await runner.query(`INSERT INTO tenants (id, slug, name, status, created_at, updated_at) VALUES ($1, $2, $3, 'active', now(), now())`, [
    tenantId,
    `cancel-creation-${tag}`,
    `cancel-creation-${tag}`,
  ]);
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const roleId = randomUUID();
  await runner.query(
    `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, 'Applications member', 'Applications member', false, false, now(), now())`,
    [roleId, tenantId],
  );
  await runner.query(
    `INSERT INTO role_permissions (id, tenant_id, role_id, resource, level, created_at, updated_at)
     VALUES ($1, $2, $3, 'applications', 'member', now(), now())`,
    [randomUUID(), tenantId, roleId],
  );
  const user = async (name: string) => {
    const id = randomUUID();
    await runner.query(
      `INSERT INTO users (id, tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Tester', $4, null, $5, false, 'enabled', now(), now())`,
      [id, tenantId, name, `${name.toLowerCase()}-${tag}@example.com`, roleId],
    );
    return id;
  };
  const creatorId = await user('Creator');
  const otherId = await user('Other');
  const ctx = (userId: string): Ctx => ({
    tenantId,
    userId,
    isAdmin: false,
    permissions: { applications: 'member' },
    manager: runner.manager,
  });
  return { tenantId, creatorId, otherId, ctx };
}

function controllerFor(runner: QueryRunner) {
  const manager = runner.manager;
  const audit = new AuditService(manager.getRepository(AuditLog));
  const settings = new ItOpsSettingsService(manager.getRepository(Tenant), manager.getRepository(Location), audit);
  const crud = new ApplicationsCrudService(manager.getRepository(Application), audit, null as any, settings, null as any);
  const integratedDocuments = { deleteForEntity: async () => undefined } as any;
  const deleteSvc = new ApplicationsDeleteService(manager.getRepository(Application), audit, { deleteObject: async () => undefined } as any, integratedDocuments);
  const controller = Object.create(ApplicationsController.prototype) as ApplicationsController;
  Object.assign(controller, {
    svc: {
      create: (body: any, userId: string | null, opts: any) => crud.create(body, userId, opts),
      update: (id: string, body: any, userId: string | null, opts: any) => crud.update(id, body, userId, opts),
    },
    deleteSvc,
  });
  return controller;
}

async function refusedAsExpired(promise: Promise<unknown>, message: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ForbiddenException, message);
    assert.equal((error.getResponse() as any).code, 'CREATION_CANCEL_EXPIRED', message);
    return true;
  });
}

function testRoutesNeedTheCreateLevel() {
  for (const method of ['create', 'creationChanges', 'cancelCreation'] as const) {
    const meta = Reflect.getMetadata(REQUIRE_LEVEL_KEY, (ApplicationsController.prototype as any)[method]);
    assert.deepEqual(meta, { resource: 'applications', level: 'member' }, `${method} needs applications:member`);
  }
}

async function testCreatorCancelsTheCreation() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, creatorId, otherId, ctx } = await seed(runner);
    const controller = controllerFor(runner);

    const created = await controller.create({ name: 'Cancel creation spec' } as any, ctx(creatorId) as any);
    assert.equal(typeof created.creation_token, 'string', 'the create route hands a creation token');
    const other = await controller.create({ name: 'Another application' } as any, ctx(creatorId) as any);

    const fresh = await controller.creationChanges(created.id, created.creation_token, ctx(creatorId) as any);
    assert.deepEqual(fresh, { changes: { fields: 0, children: {} } }, 'nothing written since the creation');

    await controller.update(created.id, { version: '2.1' } as any, ctx(creatorId) as any);
    const edited = await controller.creationChanges(created.id, created.creation_token, ctx(creatorId) as any);
    assert.deepEqual(edited, { changes: { fields: 1, children: {} } }, 'one field changed');

    // Another person's token for this application, or the token of another application: refused.
    await refusedAsExpired(controller.creationChanges(created.id, created.creation_token, ctx(otherId) as any), 'other user, preflight');
    await refusedAsExpired(controller.cancelCreation(created.id, { token: created.creation_token }, ctx(otherId) as any), 'other user');
    await refusedAsExpired(controller.cancelCreation(created.id, { token: other.creation_token }, ctx(creatorId) as any), 'other application');
    await refusedAsExpired(controller.cancelCreation(created.id, {}, ctx(creatorId) as any), 'no token');

    // The creator, a member without the admin level, cancels it with its token.
    await controller.cancelCreation(created.id, { token: created.creation_token }, ctx(creatorId) as any);
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM applications WHERE tenant_id = $1 AND id = $2`, [tenantId, created.id]);
    assert.equal(n, 0, 'the application is gone');
    const deletions = await runner.query(
      `SELECT user_id FROM audit_log WHERE tenant_id = $1 AND table_name = 'applications' AND record_id = $2 AND action = 'delete'`,
      [tenantId, created.id],
    );
    assert.deepEqual(deletions.map((row: any) => row.user_id), [creatorId], 'the delete is audited under its creator');
    const [{ kept }] = await runner.query(`SELECT count(*)::int AS kept FROM applications WHERE tenant_id = $1 AND id = $2`, [tenantId, other.id]);
    assert.equal(kept, 1, 'the other application stays');
  });
}

async function main() {
  await dataSource.initialize();
  try {
    testRoutesNeedTheCreateLevel();
    console.log('  ok testRoutesNeedTheCreateLevel');
    await testCreatorCancelsTheCreation();
    console.log('  ok testCreatorCancelsTheCreation');
  } finally {
    await dataSource.destroy();
  }
  console.log('application-cancel-creation.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
