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

/** A role and a user of the tenant. */
async function seedUser(runner: QueryRunner, t: string, email: string, companyId: string | null = null) {
  const roleId = randomUUID();
  await runner.query(
    `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, $3, 'Usage role', false, false, now(), now())`,
    [roleId, t, `Role ${email}`],
  );
  return one(
    runner,
    `INSERT INTO users (tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status, company_id)
     VALUES ($1, 'Usage', 'User', $2, null, $3, false, 'enabled', $4) RETURNING id`,
    [t, email, roleId, companyId],
  );
}

/**
 * A company that anything uses is refused, every kind counted; its own yearly metrics never
 * block and go with it. Nothing is cascaded or cleared on the objects that use it.
 */
async function testCompanyUsedByEveryKindIsRefused() {
  await withRollback(async (runner, t) => {
    const used = await company(runner, t, 'Busy company');
    const tag = t.slice(0, 8);
    await runner.query(`INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, 'Usage department')`, [t, used]);
    const userId = await seedUser(runner, t, `usage-${tag}@delete-in-use.test`, used);
    await runner.query(
      `INSERT INTO locations (tenant_id, name, hosting_type, location_reference, operating_company_id)
       VALUES ($1, 'Usage site', 'on_premise', $2, $3)`,
      [t, `LOC-${tag}`, used],
    );
    await runner.query(`INSERT INTO tasks (tenant_id, title, item_number, company_id) VALUES ($1, 'Usage task', 1, $2)`, [t, used]);
    const app = (name: string) => one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, $2) RETURNING id`, [t, name]);
    const source = await app('Usage source app');
    const target = await app('Usage target app');
    await runner.query(`INSERT INTO application_companies (tenant_id, application_id, company_id) VALUES ($1, $2, $3)`, [t, source, used]);
    const interfaceId = await one(
      runner,
      `INSERT INTO interfaces (tenant_id, name, business_purpose, source_application_id, target_application_id, data_category,
                               integration_route_type, interface_reference)
       VALUES ($1, 'Usage interface', 'Usage', $2, $3, 'master_data', 'direct', $4) RETURNING id`,
      [t, source, target, `INT-${tag}`],
    );
    await runner.query(`INSERT INTO interface_companies (tenant_id, interface_id, company_id) VALUES ($1, $2, $3)`, [t, interfaceId, used]);
    await runner.query(`INSERT INTO portfolio_projects (tenant_id, name, item_number, company_id) VALUES ($1, 'Usage project', 1, $2)`, [t, used]);
    await runner.query(`INSERT INTO portfolio_requests (tenant_id, name, item_number, company_id) VALUES ($1, 'Usage request', 1, $2)`, [t, used]);
    await runner.query(
      `INSERT INTO portfolio_team_member_configs (tenant_id, user_id, item_number, default_company_id) VALUES ($1, $2, 1, $3)`,
      [t, userId, used],
    );
    await runner.query(
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, paying_company_id)
       VALUES ($1, 'Usage line', 'EUR', '2031-01-01', 1, $2)`,
      [t, used],
    );
    const supplierId = await supplier(runner, t, 'Usage supplier');
    await contract(runner, t, 'Usage contract', used, supplierId);
    await runner.query(`INSERT INTO cost_centers (tenant_id, code, kind, name, company_id) VALUES ($1, 'U-1', 'cost_center', 'Usage center', $2)`, [t, used]);
    const svc = new CompaniesDeleteService(runner.manager.getRepository(Company), noAudit);

    await runner.query('SAVEPOINT every_kind');
    await expectInUse(
      () => svc.delete(used, { manager: runner.manager, userId: null }),
      'COMPANY_IN_USE',
      [
        { type: 'budget_lines', total: 1 },
        { type: 'contracts', total: 1 },
        { type: 'cost_centers', total: 1 },
        { type: 'departments', total: 1 },
        { type: 'users', total: 1 },
        { type: 'locations', total: 1 },
        { type: 'tasks', total: 1 },
        { type: 'applications', total: 1 },
        { type: 'interfaces', total: 1 },
        { type: 'projects', total: 1 },
        { type: 'requests', total: 1 },
        { type: 'team_members', total: 1 },
      ],
      /^Cannot delete company "Busy company": it is used by 1 budget line, 1 contract, 1 cost center, 1 department, 1 user, 1 location, 1 task, 1 application, 1 interface, 1 project, 1 request and 1 team member\. Disable it instead\.$/,
    );
    await runner.query('ROLLBACK TO SAVEPOINT every_kind');

    // Only the metrics: deleted with the company.
    const metricsOnly = await company(runner, t, 'Metrics company');
    await runner.query(`INSERT INTO company_metrics (tenant_id, company_id, fiscal_year, headcount) VALUES ($1, $2, 2030, 12)`, [t, metricsOnly]);
    await svc.delete(metricsOnly, { manager: runner.manager, userId: null });
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM company_metrics WHERE company_id = $1`, [metricsOnly]);
    assert.equal(n, 0, 'the metrics go with the company');
  });
}

/** The keys refuse a raw delete of a company each kind still uses (nothing cascades or clears). */
async function testCompanyKeysRestrictEveryKind() {
  const expected: Record<string, string> = {
    'departments.company_id': 'r',
    'users.company_id': 'r',
    'locations.operating_company_id': 'r',
    'tasks.company_id': 'r',
    'spend_items.paying_company_id': 'r',
    'application_companies.company_id': 'r',
    'interface_companies.company_id': 'r',
    'portfolio_projects.company_id': 'r',
    'portfolio_requests.company_id': 'r',
    'portfolio_team_member_configs.default_company_id': 'r',
    'contracts.company_id': 'r',
    'cost_centers.company_id': 'r',
    'company_metrics.company_id': 'c',
  };
  const rows: Array<{ col: string; action: string }> = await dataSource.query(
    `SELECT c.conrelid::regclass::text || '.' || a.attname AS col, c.confdeltype AS action
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = 'companies'::regclass AND array_length(c.conkey, 1) = 1`,
  );
  const actual: Record<string, string[]> = {};
  for (const row of rows) (actual[row.col] ??= []).push(row.action);
  for (const [col, action] of Object.entries(expected)) {
    assert.deepEqual(actual[col], [action], `${col}: one key, ON DELETE ${action === 'r' ? 'RESTRICT' : 'CASCADE'}`);
  }
}

/** A deleted supplier takes its contact links with it; the contacts stay. */
async function testSupplierDeleteRemovesItsContactLinks() {
  await withRollback(async (runner, t) => {
    const supplierId = await supplier(runner, t, 'Linked supplier');
    const contactId = await one(
      runner,
      `INSERT INTO contacts (tenant_id, email, first_name, last_name) VALUES ($1, $2, 'Link', 'Contact') RETURNING id`,
      [t, `link-${t.slice(0, 8)}@delete-in-use.test`],
    );
    await runner.query(`INSERT INTO supplier_contacts (tenant_id, supplier_id, contact_id, role) VALUES ($1, $2, $3, 'commercial')`, [t, supplierId, contactId]);
    const svc = new SuppliersDeleteService(runner.manager.getRepository(Supplier), noAudit);
    await svc.delete(supplierId, { manager: runner.manager, userId: null });
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM supplier_contacts WHERE supplier_id = $1`, [supplierId]);
    assert.equal(n, 0, 'the links go with the supplier');
    assert.deepEqual(await remaining(runner, 'contacts', [contactId]), [contactId], 'the contact stays');
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
      testCompanyUsedByEveryKindIsRefused,
      testCompanyKeysRestrictEveryKind,
      testSupplierDeleteRemovesItsContactLinks,
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
