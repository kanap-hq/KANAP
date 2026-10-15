import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { Company } from '../../companies/company.entity';
import { CompaniesDeleteService } from '../../companies/companies-delete.service';
import { Supplier } from '../../suppliers/supplier.entity';
import { SuppliersDeleteService } from '../../suppliers/suppliers-delete.service';

// A supplier or a company still in use cannot be deleted (recette Fournisseurs, lot 4). The
// refusal names what uses it, counted per kind (the groups of the "Used by" panel for a
// supplier), with a code the interface translates; a bulk delete reports it per item. The
// foreign keys of contracts back it: a raw delete of a supplier or a company that a contract
// names is refused by the database, and deleting a contract's owner clears the owner.

const noAudit = { log: async () => undefined } as any;

async function withRollback(fn: (runner: QueryRunner, tenantId: string) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Delete in use', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `del-in-use-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await fn(runner, tenantId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(sql, params))[0].id as string;
}

const supplier = (r: QueryRunner, t: string, name: string) =>
  one(r, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [t, name]);
const company = (r: QueryRunner, t: string, name: string) =>
  one(r, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Lyon') RETURNING id`, [t, name]);
const contract = (r: QueryRunner, t: string, name: string, companyId: string, supplierId: string, ownerId: string | null = null) =>
  one(
    r,
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, owner_user_id, start_date)
     VALUES ($1, $2, $3, $4, $5, '2024-01-01') RETURNING id`,
    [t, name, companyId, supplierId, ownerId],
  );

/** The refusal of a single delete: a 409 with the code and the counts per kind. */
async function expectInUse(run: () => Promise<unknown>, code: string, usages: Array<{ type: string; total: number }>, message: RegExp) {
  await assert.rejects(run, (err: unknown) => {
    assert.ok(err instanceof ConflictException, `a 409, got ${(err as Error)?.constructor?.name}: ${(err as Error)?.message}`);
    const body = err.getResponse() as Record<string, unknown>;
    assert.equal(body.code, code);
    assert.deepEqual(body.usages, usages);
    assert.match(String(body.message), message);
    return true;
  });
}

async function remaining(runner: QueryRunner, table: string, ids: string[]) {
  const rows = await runner.query(`SELECT id FROM ${table} WHERE id = ANY($1::uuid[])`, [ids]);
  return rows.map((r: { id: string }) => r.id).sort();
}

async function testSupplierUsedByAContractIsRefused() {
  await withRollback(async (runner, t) => {
    const companyId = await company(runner, t, 'Contract company');
    const used = await supplier(runner, t, 'Contracted supplier');
    await contract(runner, t, 'Support contract', companyId, used);
    await contract(runner, t, 'Second contract', companyId, used);
    await runner.query(`INSERT INTO applications (tenant_id, name, supplier_id) VALUES ($1, 'Supplied app', $2)`, [t, used]);
    const svc = new SuppliersDeleteService(runner.manager.getRepository(Supplier), noAudit);

    await expectInUse(
      () => svc.delete(used, { manager: runner.manager, userId: null }),
      'SUPPLIER_IN_USE',
      [{ type: 'contracts', total: 2 }, { type: 'applications', total: 1 }],
      /^Cannot delete supplier "Contracted supplier": it is used by 2 contracts and 1 application\. Disable it instead\.$/,
    );
    assert.deepEqual(await remaining(runner, 'suppliers', [used]), [used], 'the supplier is kept');
    const [app] = await runner.query(`SELECT supplier_id FROM applications WHERE tenant_id = $1`, [t]);
    assert.equal(app.supplier_id, used, 'the application keeps its supplier');
  });
}

async function testSupplierBulkReportsEachRefusal() {
  await withRollback(async (runner, t) => {
    const companyId = await company(runner, t, 'Bulk company');
    const free = await supplier(runner, t, 'Free supplier');
    const used = await supplier(runner, t, 'Used supplier');
    await contract(runner, t, 'Bulk contract', companyId, used);
    const svc = new SuppliersDeleteService(runner.manager.getRepository(Supplier), noAudit);

    const result = await svc.bulkDelete([free, used], null, { manager: runner.manager });
    assert.deepEqual(result.deleted, [free]);
    assert.equal(result.failed.length, 1);
    const failure = result.failed[0] as any;
    assert.equal(failure.id, used);
    assert.equal(failure.name, 'Used supplier');
    assert.equal(failure.code, 'SUPPLIER_IN_USE');
    assert.deepEqual(failure.usages, [{ type: 'contracts', total: 1 }]);
    assert.match(failure.reason, /it is used by 1 contract\. Disable it instead\./);
    assert.deepEqual(await remaining(runner, 'suppliers', [free, used]), [used]);
  });
}

async function testCompanyUsedByAContractIsRefused() {
  await withRollback(async (runner, t) => {
    const used = await company(runner, t, 'Contracting company');
    const free = await company(runner, t, 'Free company');
    const supplierId = await supplier(runner, t, 'Company supplier');
    await contract(runner, t, 'Company contract', used, supplierId);
    const svc = new CompaniesDeleteService(runner.manager.getRepository(Company), noAudit);

    await expectInUse(
      () => svc.delete(used, { manager: runner.manager, userId: null }),
      'COMPANY_IN_USE',
      [{ type: 'contracts', total: 1 }],
      /^Cannot delete company "Contracting company": it is used by 1 contract\. Disable it instead\.$/,
    );
    const result = await svc.bulkDelete([used, free], null, { manager: runner.manager });
    assert.deepEqual(result.deleted, [free]);
    assert.equal((result.failed[0] as any)?.code, 'COMPANY_IN_USE');
    assert.deepEqual(await remaining(runner, 'companies', [used, free]), [used]);
  });
}

/** The keys refuse what bypasses the services, and a deleted owner leaves the contract without one. */
async function testForeignKeysBackTheRefusal() {
  await withRollback(async (runner, t) => {
    const companyId = await company(runner, t, 'Key company');
    const supplierId = await supplier(runner, t, 'Key supplier');
    const roleId = randomUUID();
    await runner.query(
      `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
       VALUES ($1, $2, 'Key role', 'Key role', false, false, now(), now())`,
      [roleId, t],
    );
    const ownerId = await one(
      runner,
      `INSERT INTO users (tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status)
       VALUES ($1, 'Key', 'Owner', $2, null, $3, false, 'enabled') RETURNING id`,
      [t, `owner-${t.slice(0, 8)}@delete-in-use.test`, roleId],
    );
    const contractId = await contract(runner, t, 'Key contract', companyId, supplierId, ownerId);

    for (const [table, id, constraint] of [
      ['suppliers', supplierId, 'fk_contracts_supplier'],
      ['companies', companyId, 'fk_contracts_company'],
    ] as const) {
      await runner.query('SAVEPOINT raw_delete');
      await assert.rejects(
        runner.query(`DELETE FROM ${table} WHERE id = $1`, [id]),
        (err: any) => err?.code === '23503' && err?.constraint === constraint,
        `a raw delete of the ${table} row is refused by ${constraint}`,
      );
      await runner.query('ROLLBACK TO SAVEPOINT raw_delete');
    }

    await runner.query(`DELETE FROM users WHERE id = $1`, [ownerId]);
    const [row] = await runner.query(`SELECT owner_user_id FROM contracts WHERE id = $1`, [contractId]);
    assert.equal(row.owner_user_id, null, 'the contract loses its deleted owner');
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [
      testSupplierUsedByAContractIsRefused,
      testSupplierBulkReportsEachRefusal,
      testCompanyUsedByAContractIsRefused,
      testForeignKeysBackTheRefusal,
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
    throw new Error(`delete-in-use.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('delete-in-use.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
