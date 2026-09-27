import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import dataSource from '../../data-source';
import { BulkDeleteResult } from '../delete.types';
import { ReferenceCheckService } from '../reference-check.service';
import { Department } from '../../departments/department.entity';
import { DepartmentsDeleteService } from '../../departments/departments-delete.service';
import { Company } from '../../companies/company.entity';
import { CompaniesDeleteService } from '../../companies/companies-delete.service';
import { Supplier } from '../../suppliers/supplier.entity';
import { SuppliersDeleteService } from '../../suppliers/suppliers-delete.service';
import { User } from '../../users/user.entity';
import { UsersDeleteService } from '../../users/users-delete.service';
import { Application } from '../../applications/application.entity';
import { ApplicationsDeleteService } from '../../applications/applications-delete.service';

// A bulk delete runs in the request transaction. One row whose delete raises a
// database error (a 23503 on an in-use row, a 22P02 on a malformed id) must not
// abort the others: the free rows are really gone once the request commits, and
// the failing rows are reported with their reason. Each case seeds in its own
// committed transaction, runs the bulk delete in one transaction with the
// tenant set and commits it like the tenant interceptor, then reads the table.

const noAudit = { log: async () => undefined } as any;
const noStorage = { deleteObject: async () => undefined } as any;
const MALFORMED_ID = 'not-a-uuid';

type Seeded = { tenantId: string; roleId?: string };

async function inTenant<T>(tenantId: string, fn: (manager: EntityManager) => Promise<T>): Promise<T> {
  return dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    return fn(manager);
  });
}

async function seedTenant(tag: string): Promise<Seeded> {
  const tenantId = randomUUID();
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `bulk-del-${tag}-${tenantId.slice(0, 8)}`, `Bulk delete ${tag}`],
  );
  return { tenantId };
}

/** The request: one transaction with the tenant set, committed on success as the interceptor does. */
async function asRequest<T>(tenantId: string, fn: (manager: EntityManager) => Promise<T>): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const result = await fn(runner.manager);
    await runner.commitTransaction();
    return result;
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }
}

async function remaining(tenantId: string, table: string, ids: string[]): Promise<string[]> {
  const rows = await inTenant(tenantId, (m) =>
    m.query(`SELECT id FROM ${table} WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, ids]),
  );
  return rows.map((r: { id: string }) => r.id).sort();
}

async function cleanup(tenantId: string) {
  await inTenant(tenantId, async (m) => {
    for (const table of [
      'spend_allocations', 'spend_versions', 'spend_items', 'departments', 'applications',
      'suppliers', 'users', 'roles', 'companies',
    ]) {
      await m.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    }
  });
  await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
}

async function withSeed(tag: string, fn: (seed: Seeded) => Promise<void>) {
  const seed = await seedTenant(tag);
  try {
    await fn(seed);
  } finally {
    await cleanup(seed.tenantId);
  }
}

async function one(m: EntityManager, sql: string, params: unknown[]): Promise<string> {
  return (await m.query(sql, params))[0].id as string;
}

async function seedCompany(m: EntityManager, tenantId: string, name: string) {
  return one(m, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Lyon') RETURNING id`, [tenantId, name]);
}

/** An OPEX line whose allocation names the company and the department (both NO ACTION foreign keys). */
async function seedAllocation(m: EntityManager, tenantId: string, companyId: string, departmentId: string | null) {
  const itemId = await one(
    m,
    `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number)
     VALUES ($1, 'Bulk delete line', 'EUR', '2031-01-01', 1) RETURNING id`,
    [tenantId],
  );
  const versionId = await one(
    m,
    `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year)
     VALUES ($1, $2, 'Y2031', '2031-01-01', 2031) RETURNING id`,
    [tenantId, itemId],
  );
  await m.query(
    `INSERT INTO spend_allocations (tenant_id, version_id, company_id, department_id, allocation_pct)
     VALUES ($1, $2, $3, $4, 100)`,
    [tenantId, versionId, companyId, departmentId],
  );
  return itemId;
}

function sorted(values: string[]) {
  return [...values].sort();
}

function failureOf(result: BulkDeleteResult, id: string) {
  const failure = result.failed.find((f) => f.id === id);
  assert.ok(failure, `${id} is reported as failed`);
  return failure!;
}

async function testDepartmentsInUseAndFree() {
  await withSeed('dept', async ({ tenantId }) => {
    const ids = await inTenant(tenantId, async (m) => {
      const companyId = await seedCompany(m, tenantId, 'Department company');
      const dept = (name: string) =>
        one(m, `INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, $3) RETURNING id`, [tenantId, companyId, name]);
      const free = await dept('Free department');
      const inUse = await dept('Allocated department');
      const free2 = await dept('Second free department');
      await seedAllocation(m, tenantId, companyId, inUse);
      return { free, inUse, free2 };
    });

    const service = new DepartmentsDeleteService(dataSource.getRepository(Department), noAudit);
    const result = await asRequest(tenantId, (manager) =>
      service.bulkDelete([ids.free, ids.inUse, ids.free2], null, { manager }),
    );

    const left = await remaining(tenantId, 'departments', [ids.free, ids.inUse, ids.free2]);
    const names = new Map([[ids.free, 'free'], [ids.inUse, 'inUse'], [ids.free2, 'free2']]);
    const label = (list: string[]) => list.map((id) => names.get(id) ?? id).join(', ');
    assert.deepEqual(
      left,
      [ids.inUse],
      `after the commit only the in-use department is left; left: [${label(left)}], reported deleted: [${label(result.deleted)}], ` +
        `failed: ${JSON.stringify(result.failed.map((f) => ({ id: names.get(f.id), name: f.name, reason: f.reason })))}`,
    );
    assert.deepEqual(sorted(result.deleted), sorted([ids.free, ids.free2]), 'both free departments reported deleted');
    const failure = failureOf(result, ids.inUse);
    assert.equal(failure.name, 'Allocated department');
    assert.match(failure.reason, /Cannot delete department "Allocated department": it is being used in allocations/);
  });
}

async function testCompaniesMixedBatch() {
  await withSeed('comp', async ({ tenantId }) => {
    const ids = await inTenant(tenantId, async (m) => {
      const free = await seedCompany(m, tenantId, 'Free company');
      const inUse = await seedCompany(m, tenantId, 'Allocated company');
      const free2 = await seedCompany(m, tenantId, 'Second free company');
      await seedAllocation(m, tenantId, inUse, null);
      return { free, inUse, free2 };
    });

    const service = new CompaniesDeleteService(dataSource.getRepository(Company), noAudit, new ReferenceCheckService());
    const result = await asRequest(tenantId, (manager) =>
      service.bulkDelete([ids.free, ids.inUse, ids.free2], null, { manager }),
    );

    assert.deepEqual(sorted(result.deleted), sorted([ids.free, ids.free2]));
    const failure = failureOf(result, ids.inUse);
    assert.equal(failure.name, 'Allocated company');
    assert.match(failure.reason, /Cannot delete company "Allocated company"/);
    assert.deepEqual(await remaining(tenantId, 'companies', [ids.free, ids.inUse, ids.free2]), [ids.inUse]);
  });
}

async function testSuppliersMixedBatch() {
  await withSeed('supp', async ({ tenantId }) => {
    const ids = await inTenant(tenantId, async (m) => {
      const supplier = (name: string) => one(m, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, name]);
      const free = await supplier('Free supplier');
      const inUse = await supplier('Referenced supplier');
      const free2 = await supplier('Second free supplier');
      await m.query(
        `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, supplier_id)
         VALUES ($1, 'Supplier line', 'EUR', '2031-01-01', 1, $2)`,
        [tenantId, inUse],
      );
      return { free, inUse, free2 };
    });

    const service = new SuppliersDeleteService(dataSource.getRepository(Supplier), noAudit, new ReferenceCheckService());
    const result = await asRequest(tenantId, (manager) =>
      service.bulkDelete([ids.free, MALFORMED_ID, ids.inUse, ids.free2], null, { manager }),
    );

    assert.deepEqual(sorted(result.deleted), sorted([ids.free, ids.free2]));
    assert.equal(failureOf(result, MALFORMED_ID).name, 'Unknown');
    const failure = failureOf(result, ids.inUse);
    assert.equal(failure.name, 'Referenced supplier');
    assert.match(failure.reason, /Referenced supplier/);
    assert.deepEqual(await remaining(tenantId, 'suppliers', [ids.free, ids.inUse, ids.free2]), [ids.inUse]);
  });
}

async function testUsersMixedBatch() {
  await withSeed('user', async ({ tenantId }) => {
    const tag = tenantId.slice(0, 8);
    const ids = await inTenant(tenantId, async (m) => {
      const roleId = randomUUID();
      await m.query(
        `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
         VALUES ($1, $2, 'Bulk delete role', 'Bulk delete role', false, false, now(), now())`,
        [roleId, tenantId],
      );
      const user = (email: string) =>
        one(
          m,
          `INSERT INTO users (tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status)
           VALUES ($1, 'Bulk', 'Tester', $2, null, $3, false, 'enabled') RETURNING id`,
          [tenantId, email, roleId],
        );
      return {
        free: await user(`free-${tag}@bulk-delete.test`),
        actor: await user(`actor-${tag}@bulk-delete.test`),
        free2: await user(`free2-${tag}@bulk-delete.test`),
      };
    });

    const service = new UsersDeleteService(dataSource.getRepository(User), noAudit);
    const result = await asRequest(tenantId, (manager) =>
      service.bulkDelete([ids.free, MALFORMED_ID, ids.actor, ids.free2], ids.actor, { manager }),
    );

    assert.deepEqual(sorted(result.deleted), sorted([ids.free, ids.free2]));
    assert.equal(failureOf(result, MALFORMED_ID).name, 'Unknown');
    const failure = failureOf(result, ids.actor);
    assert.equal(failure.name, `actor-${tag}@bulk-delete.test`);
    assert.match(failure.reason, /You cannot delete your own account/);
    assert.deepEqual(await remaining(tenantId, 'users', [ids.free, ids.actor, ids.free2]), [ids.actor]);
  });
}

async function testApplicationsMixedBatch() {
  await withSeed('app', async ({ tenantId }) => {
    const ids = await inTenant(tenantId, async (m) => {
      const app = (name: string) => one(m, `INSERT INTO applications (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, name]);
      return { free: await app('Free application'), free2: await app('Second free application') };
    });
    const missing = randomUUID();

    const service = new ApplicationsDeleteService(dataSource.getRepository(Application), noAudit, noStorage);
    const result = await asRequest(tenantId, (manager) =>
      service.bulkDelete([ids.free, MALFORMED_ID, missing, ids.free2], null, { manager }),
    );

    assert.deepEqual(sorted(result.deleted), sorted([ids.free, ids.free2]));
    assert.equal(failureOf(result, MALFORMED_ID).name, 'Unknown');
    assert.match(failureOf(result, missing).reason, /Application not found/);
    assert.deepEqual(await remaining(tenantId, 'applications', [ids.free, ids.free2]), []);
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [
      testDepartmentsInUseAndFree,
      testCompaniesMixedBatch,
      testSuppliersMixedBatch,
      testUsersMixedBatch,
      testApplicationsMixedBatch,
    ]) {
      try {
        await test();
        console.log(`  ok ${test.name}`);
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n').slice(0, 6).join(' | ')}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`bulk-delete-savepoint.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('bulk-delete-savepoint.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
