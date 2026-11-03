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
import { InterfacesController } from '../interfaces.controller';
import { InterfacesCrudService } from '../services/interfaces-crud.service';

// An interface created by the screen once its draft has its title, both applications and its data
// category (lot 3 of the creation frame): `POST /interfaces` hands the creator a token;
// `GET :id/creation` counts what was written since (nothing for a fresh interface: its legs, its
// mapping set and its specification come with the creation), `DELETE :id/creation` deletes it for
// its creator alone.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'interface-cancel-creation-spec-secret';

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
    `interface-creation-${tag}`,
    `interface-creation-${tag}`,
  ]);
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const roleId = randomUUID();
  await runner.query(
    `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, 'Applications member', 'Applications member', false, false, now(), now())`,
    [roleId, tenantId],
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
  const app = async (name: string) => (await runner.query(`INSERT INTO applications (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, name]))[0].id as string;
  const source = await app('CRM');
  const target = await app('ERP');
  const ctx = (userId: string) => ({ tenantId, userId, manager: runner.manager }) as any;
  return { tenantId, creatorId, otherId, source, target, ctx };
}

function setup(runner: QueryRunner) {
  const audit = new AuditService(runner.manager.getRepository(AuditLog));
  const crud = Object.create(InterfacesCrudService.prototype) as InterfacesCrudService;
  // The save, the audit and the delete are real; the settings-driven steps are stubbed.
  Object.assign(crud, {
    audit,
    interfaceMappings: { ensureDefaultSetForInterface: async () => undefined },
    integratedDocuments: { provisionForInterface: async () => undefined, deleteForEntity: async () => undefined },
    ensureApplication: async (id: string) => ({ id }),
    computeDefaultLifecycle: () => 'active',
    computeDefaultCriticality: async () => ({ code: 'medium', incomplete: false }),
    normalizeLifecycle: async () => 'active',
    normalizeDataCategory: async () => 'master_data',
    normalizeDataClass: async () => null,
    syncMiddlewareApplications: async () => undefined,
    createDefaultLegs: async () => undefined,
  });
  const controller = Object.create(InterfacesController.prototype) as InterfacesController;
  Object.assign(controller, {
    svc: {
      create: (body: any, tenantId: string, userId: string | null, opts: any) => crud.create(body, tenantId, userId, opts),
      delete: (id: string, userId: string | null, opts: any) => crud.delete(id, userId, opts),
    },
  });
  return { controller, audit };
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
    const meta = Reflect.getMetadata(REQUIRE_LEVEL_KEY, (InterfacesController.prototype as any)[method]);
    assert.deepEqual(meta, { resource: 'applications', level: 'member' }, `${method} needs applications:member`);
  }
}

async function testCreatedThenCancelled() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, creatorId, otherId, source, target, ctx } = await seed(runner);
    const { controller, audit } = setup(runner);
    const body = { name: 'Orders', business_purpose: 'Orders', source_application_id: source, target_application_id: target, data_category: 'master_data' };

    const created: any = await controller.create(body as any, ctx(creatorId));
    assert.equal(typeof created.creation_token, 'string', 'the route hands a creation token');
    assert.match(created.interface_reference, /^INT-\d+$/);
    const fresh = await controller.creationChanges(created.id, created.creation_token, ctx(creatorId));
    assert.deepEqual(fresh, { changes: { fields: 0, children: {} } }, 'nothing written since the creation');

    await audit.log(
      { table: 'interfaces', recordId: created.id, action: 'update', before: { criticality: 'medium' }, after: { criticality: 'high' }, userId: creatorId },
      { manager: runner.manager },
    );
    const edited = await controller.creationChanges(created.id, created.creation_token, ctx(creatorId));
    assert.deepEqual(edited, { changes: { fields: 1, children: {} } }, 'one field');

    await refusedAsExpired(controller.creationChanges(created.id, created.creation_token, ctx(otherId)), 'other user, changes');
    await refusedAsExpired(controller.cancelCreation(created.id, { token: created.creation_token }, ctx(otherId)), 'other user, cancel');
    await refusedAsExpired(controller.cancelCreation(created.id, {}, ctx(creatorId)), 'no token');

    // Another author ends the creator's cancel.
    const second: any = await controller.create({ ...body, name: 'Invoices', business_purpose: 'Invoices' } as any, ctx(creatorId));
    await audit.log(
      { table: 'interfaces', recordId: second.id, action: 'update', before: { criticality: 'medium' }, after: { criticality: 'low' }, userId: otherId },
      { manager: runner.manager },
    );
    await refusedAsExpired(controller.cancelCreation(second.id, { token: second.creation_token }, ctx(creatorId)), 'another author');

    await controller.cancelCreation(created.id, { token: created.creation_token }, ctx(creatorId));
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM interfaces WHERE tenant_id = $1 AND id = $2`, [tenantId, created.id]);
    assert.equal(n, 0, 'the interface is gone');
    const [deleted] = await runner.query(
      `SELECT user_id FROM audit_log WHERE tenant_id = $1 AND table_name = 'interfaces' AND record_id = $2 AND action = 'delete'`,
      [tenantId, created.id],
    );
    assert.equal(deleted?.user_id, creatorId, 'the delete is audited under the creator');
  });
}

async function main() {
  await dataSource.initialize();
  try {
    testRoutesNeedTheCreateLevel();
    console.log('  ok testRoutesNeedTheCreateLevel');
    await testCreatedThenCancelled();
    console.log('  ok testCreatedThenCancelled');
  } finally {
    await dataSource.destroy();
  }
  console.log('interface-cancel-creation.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
