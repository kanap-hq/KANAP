// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../../data-source';
import { REQUIRE_LEVEL_KEY } from '../../../auth/require-level.decorator';
import { AuditLog } from '../../../audit/audit.entity';
import { AuditService } from '../../../audit/audit.service';
import { AccountsController } from '../../../accounts/accounts.controller';
import { AnalyticsAxesController } from '../../../analytics/analytics-axes.controller';
import { AnalyticsCategoriesController } from '../../../analytics/analytics-categories.controller';
import { CompaniesController } from '../../../companies/companies.controller';
import { ContactsController } from '../../../contacts/contacts.controller';
import { ContractsController } from '../../../contracts/contracts.controller';
import { CostCentersController } from '../../../cost-centers/cost-centers.controller';
import { DepartmentsController } from '../../../departments/departments.controller';
import { LocationsController } from '../../../locations/locations.controller';
import { Supplier } from '../../../suppliers/supplier.entity';
import { SuppliersController } from '../../../suppliers/suppliers.controller';
import { SuppliersDeleteService } from '../../../suppliers/suppliers-delete.service';
import { SuppliersService } from '../../../suppliers/suppliers.service';
import { WorkingDayProfilesController } from '../../../working-day-profiles/working-day-profiles.controller';

// The creation routes of the reference data and contracts (lot V2, `common/creation/creation-routes.ts`):
// `POST` hands the creator a token; `GET :id/creation` counts what was written since the creation;
// `DELETE :id/creation` deletes the record for its creator at the create level, through the
// family's delete and its audit entry. Another person's token, or the token of another record, is
// refused with `CREATION_CANCEL_EXPIRED`. The suppliers run it end to end; every family's routes
// ask the level of its create route.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'creation-routes-spec-secret';

const FAMILIES = [
  AccountsController,
  AnalyticsAxesController,
  AnalyticsCategoriesController,
  CompaniesController,
  ContactsController,
  ContractsController,
  CostCentersController,
  DepartmentsController,
  LocationsController,
  SuppliersController,
  WorkingDayProfilesController,
];

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
    `creation-routes-${tag}`,
    `creation-routes-${tag}`,
  ]);
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const roleId = randomUUID();
  await runner.query(
    `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, 'Suppliers member', 'Suppliers member', false, false, now(), now())`,
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
  const ctx = (userId: string) => ({
    tenantId,
    userId,
    isAdmin: false,
    permissions: { suppliers: 'member' },
    manager: runner.manager,
    queryRunner: runner,
  });
  // The controller reads the person and the transaction from the request as well.
  const req = (userId: string) => ({ user: { sub: userId }, tenant: { id: tenantId }, queryRunner: runner });
  return { tenantId, creatorId, otherId, ctx, req };
}

function suppliersController(runner: QueryRunner) {
  const manager = runner.manager;
  const audit = new AuditService(manager.getRepository(AuditLog));
  const controller = Object.create(SuppliersController.prototype) as SuppliersController;
  Object.assign(controller, {
    svc: new SuppliersService(manager.getRepository(Supplier), audit),
    deleteSvc: new SuppliersDeleteService(manager.getRepository(Supplier), audit),
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
  for (const family of FAMILIES) {
    const create = Reflect.getMetadata(REQUIRE_LEVEL_KEY, (family.prototype as any).create);
    assert.ok(create, `${family.name}.create has a level`);
    for (const method of ['creationChanges', 'cancelCreation'] as const) {
      const route = (family.prototype as any)[method];
      assert.equal(typeof route, 'function', `${family.name}.${method} exists`);
      assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, route), create, `${family.name}.${method} needs the create level`);
    }
  }
}

async function testCreatorCancelsTheCreation() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, creatorId, otherId, ctx, req } = await seed(runner);
    const controller = suppliersController(runner);

    const created = await controller.create({ name: 'Creation routes spec' } as any, req(creatorId), ctx(creatorId) as any);
    assert.equal(typeof created.creation_token, 'string', 'the create route hands a creation token');
    const other = await controller.create({ name: 'Another supplier' } as any, req(creatorId), ctx(creatorId) as any);

    const fresh = await controller.creationChanges(created.id, created.creation_token, ctx(creatorId) as any);
    assert.deepEqual(fresh, { changes: { fields: 0, children: {} } }, 'nothing written since the creation');

    await controller.update(created.id, { name: 'Creation routes spec', notes: 'Signed' } as any, req(creatorId));
    const edited = await controller.creationChanges(created.id, created.creation_token, ctx(creatorId) as any);
    assert.deepEqual(edited, { changes: { fields: 1, children: {} } }, 'one field changed');

    // Another person's token for this supplier, or the token of another supplier: refused.
    await refusedAsExpired(controller.creationChanges(created.id, created.creation_token, ctx(otherId) as any), 'other user, preflight');
    await refusedAsExpired(controller.cancelCreation(created.id, { token: created.creation_token }, ctx(otherId) as any), 'other user');
    await refusedAsExpired(controller.cancelCreation(created.id, { token: other.creation_token }, ctx(creatorId) as any), 'other supplier');
    await refusedAsExpired(controller.cancelCreation(created.id, {}, ctx(creatorId) as any), 'no token');

    // Another person edited the other supplier: its creator's cancel is over.
    await controller.update(other.id, { name: 'Another supplier', notes: 'Theirs' } as any, req(otherId));
    await refusedAsExpired(controller.creationChanges(other.id, other.creation_token, ctx(creatorId) as any), 'another author, preflight');
    await refusedAsExpired(controller.cancelCreation(other.id, { token: other.creation_token }, ctx(creatorId) as any), 'another author');

    // The creator, a member without the admin level, cancels it with its token.
    await controller.cancelCreation(created.id, { token: created.creation_token }, ctx(creatorId) as any);
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM suppliers WHERE tenant_id = $1 AND id = $2`, [tenantId, created.id]);
    assert.equal(n, 0, 'the supplier is gone');
    const deletions = await runner.query(
      `SELECT user_id FROM audit_log WHERE tenant_id = $1 AND table_name = 'suppliers' AND record_id = $2 AND action = 'delete'`,
      [tenantId, created.id],
    );
    assert.deepEqual(deletions.map((row: any) => row.user_id), [creatorId], 'the delete is audited under its creator');
    const [{ kept }] = await runner.query(`SELECT count(*)::int AS kept FROM suppliers WHERE tenant_id = $1 AND id = $2`, [tenantId, other.id]);
    assert.equal(kept, 1, 'the other supplier stays');
  });
}

async function main() {
  testRoutesNeedTheCreateLevel();
  console.log('  ok testRoutesNeedTheCreateLevel');
  await dataSource.initialize();
  try {
    await testCreatorCancelsTheCreation();
    console.log('  ok testCreatorCancelsTheCreation');
  } finally {
    await dataSource.destroy();
  }
  console.log('creation-routes.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
