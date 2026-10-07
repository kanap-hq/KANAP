import 'dotenv/config';
import * as assert from 'node:assert/strict';
import dataSource from '../../data-source';
import { AuditLogsService } from '../../audit/audit-logs.service';
import { AuditLog } from '../../audit/audit.entity';
import { Supplier } from '../../suppliers/supplier.entity';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { seedTenant } from '../../interfaces/__tests__/interface-seed-helpers';
import { buildWhereFromAgFilters } from '../pagination';

// A set filter that ticks values and the empty value (`buildWhereFromAgFilters`,
// shared by the suppliers, accounts, chart of accounts, OPEX, CAPEX, contacts,
// locations and audit log lists), against a real database: a value holding an
// apostrophe and the empty value select the right rows, with and without a
// quick search (the clause is then repeated in each OR branch), on a list read
// through find options (suppliers) and on the audit log list, which compiles
// the clause into its own query builder. The SQL sent carries the values as
// parameters only.

const set = (values: unknown[]) => ({ filterType: 'set', values });
const query = (filters: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  filters: JSON.stringify(filters),
  sort: 'name:ASC',
  limit: 100,
  includeDisabled: 'true',
  ...extra,
});

const APOSTROPHE_VALUE = "ERP O'Neil";

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = await seedTenant(runner, 'set-null');
    await runner.query(
      `INSERT INTO suppliers (tenant_id, name, erp_supplier_id)
       VALUES ($1, 'Alpha', $2), ($1, 'Beta', 'ERP-2'), ($1, 'Gamma', NULL), ($1, 'Delta', 'ERP-4')`,
      [tenantId, APOSTROPHE_VALUE],
    );
    const opts = { manager: runner.manager };

    // The SQL of the clause: placeholders, no value in the text.
    const where = buildWhereFromAgFilters({ erp_supplier_id: set([APOSTROPHE_VALUE, 'ERP-4', null]) });
    const [sql, params] = runner.manager.getRepository(Supplier).createQueryBuilder('s').where(where).getQueryAndParameters();
    assert.match(sql, /IN \(\$\d+, \$\d+\) OR .*erp_supplier_id.* IS NULL/, `the values are placeholders (${sql})`);
    assert.equal(sql.includes('Neil') || sql.includes('ERP-4'), false, 'no value in the SQL text');
    assert.deepEqual(params, [APOSTROPHE_VALUE, 'ERP-4'], 'the values are sent as parameters');

    // Suppliers: find options, with and without a quick search.
    const suppliers = new SuppliersService(undefined as any, { log: async () => undefined } as any);
    const supplierNames = async (filters: Record<string, unknown>, extra?: Record<string, unknown>) => {
      const list = await suppliers.list(query(filters, extra), opts);
      const ids = await suppliers.listIds(query(filters, extra), opts);
      assert.deepEqual(ids.ids.slice().sort(), list.items.map((item: any) => item.id).sort());
      return list.items.map((item: any) => item.name);
    };
    assert.deepEqual(await supplierNames({ erp_supplier_id: set([APOSTROPHE_VALUE, null]) }), ['Alpha', 'Gamma'], 'value with an apostrophe and the empty value');
    assert.deepEqual(await supplierNames({ erp_supplier_id: set([APOSTROPHE_VALUE, 'ERP-4', null]) }), ['Alpha', 'Delta', 'Gamma'], 'two values and the empty value');
    assert.deepEqual(await supplierNames({ erp_supplier_id: set([APOSTROPHE_VALUE, null]) }, { q: 'a' }), ['Alpha', 'Gamma'], 'with a quick search');
    assert.deepEqual(await supplierNames({ erp_supplier_id: set([APOSTROPHE_VALUE]) }), ['Alpha'], 'values only: unchanged');
    assert.deepEqual(await supplierNames({ erp_supplier_id: set([null]) }), ['Gamma'], 'empty value only: unchanged');

    // Audit log list: the clause goes through its own query builder.
    await runner.manager.getRepository(AuditLog).insert([
      { tenant_id: tenantId, table_name: "supplier's notes", action: 'update', source: 'user' },
      { tenant_id: tenantId, table_name: 'suppliers', action: 'update', source: 'user' },
      { tenant_id: tenantId, table_name: 'contacts', action: 'update', source: 'user' },
    ] as any);
    const audit = new AuditLogsService(runner.manager.getRepository(AuditLog));
    const auditTables = async (filters: Record<string, unknown>) => {
      const list = await audit.list({ filters: JSON.stringify(filters), sort: 'table_name:ASC', limit: 100 }, opts);
      return list.items.map((item) => item.table_name);
    };
    assert.deepEqual(await auditTables({ table_name: set(["supplier's notes", 'contacts', null]) }), ['contacts', "supplier's notes"], 'audit log list');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
  console.log('set-filter-null-values.integration.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
