// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';
import { AuditLogParentFamilyA1855700000000 as Migration } from '../../migrations/1855700000000-audit-log-parent-family-a';

// Migration 1855700000000 (audit rows linked to their family A parent), against a real database,
// in a transaction rolled back at the end. It seeds two tenants with a company metric, a department
// metric and an analytics value, with their parent in the payload on either side, plus rows without
// a parent (an invalid uuid, an absent key, a record's own row) and one already filled. Then:
// - the three labels get their parent, tenant by tenant, in batches smaller than the seed;
// - the rows without a parent stay NULL; a filled row is never rewritten;
// - a second run changes nothing and says so;
// - the tenant setting is restored and RLS stays ENABLE + FORCE on every table read.
// @database-spec: the data source of the migrated test database.

const migration = new Migration();
const PREFIX = '[Migration] AuditLogParentFamilyA:';

async function captureLog<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: any[]) => { lines.push(args.map(String).join(' ')); };
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = original;
  }
}

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

async function setTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function insertAudit(
  runner: QueryRunner,
  tenantId: string,
  table: string,
  before: unknown,
  after: unknown,
  parent?: { table: string; id: string } | null,
): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO audit_log (tenant_id, table_name, record_id, action, before_json, after_json, parent_table, parent_id, source)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, 'user') RETURNING id`,
    [
      tenantId, table, randomUUID(), after == null ? 'delete' : 'update',
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after),
      parent?.table ?? null, parent?.id ?? null,
    ],
  );
  return row.id as string;
}

type Seeded = { company: string; department: string; axis: string; rows: Record<string, string>; already: { id: string; parent: string } };

async function seedTenant(runner: QueryRunner, tag: string): Promise<{ tenantId: string; seeded: Seeded }> {
  const tenantId = await createRaceTenant(`audit-parent-family-a-${tag}`);
  await setTenant(runner, tenantId);
  const [company] = await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Alpha Co', 'FR', 'Lyon') RETURNING id`,
    [tenantId],
  );
  const [department] = await runner.query(
    `INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, 'Finance') RETURNING id`,
    [tenantId, company.id],
  );
  const [axis] = await runner.query(
    `INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, 'cost_pool', 'Cost pool') RETURNING id`,
    [tenantId],
  );
  const [otherCompany] = await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Beta Co', 'FR', 'Lyon') RETURNING id`,
    [tenantId],
  );

  const rows: Record<string, string> = {};
  rows.companyMetric = await insertAudit(runner, tenantId, 'company_metrics', null, { company_id: company.id, fiscal_year: 2026, headcount: 100 });
  rows.departmentMetric = await insertAudit(runner, tenantId, 'department_metrics', { department_id: department.id, fiscal_year: 2026, headcount: 10 }, null);
  rows.category = await insertAudit(runner, tenantId, 'analytics_categories', { axis_id: axis.id, name: 'Cloud' }, { axis_id: axis.id, name: 'Cloud spend' });
  rows.invalidUuid = await insertAudit(runner, tenantId, 'company_metrics', null, { company_id: 'not-a-uuid' });
  rows.missingKey = await insertAudit(runner, tenantId, 'department_metrics', null, { fiscal_year: 2026 });
  // A uuid no row of the parent table carries: the backfill must not set it as a parent.
  rows.missingParent = await insertAudit(runner, tenantId, 'company_metrics', null, { company_id: randomUUID() });
  rows.ownRecord = await insertAudit(runner, tenantId, 'companies', null, { id: company.id, name: 'Alpha Co' });
  const already = await insertAudit(
    runner, tenantId, 'company_metrics', null, { company_id: company.id },
    { table: 'companies', id: otherCompany.id },
  );
  return { tenantId, seeded: { company: company.id, department: department.id, axis: axis.id, rows, already: { id: already, parent: otherCompany.id } } };
}

async function rowsOf(runner: QueryRunner, tenantId: string) {
  await setTenant(runner, tenantId);
  return runner.query(
    `SELECT id, table_name, parent_table, parent_id::text AS parent_id FROM audit_log WHERE tenant_id = $1 ORDER BY id`,
    [tenantId],
  );
}

async function rowSecurity(runner: QueryRunner, table: string) {
  const [row] = await runner.query(
    `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = $1::regclass`,
    [table],
  );
  return row;
}

async function currentTenantSetting(runner: QueryRunner): Promise<string> {
  const [row] = await runner.query(`SELECT coalesce(current_setting('app.current_tenant', true), '') AS value`);
  return row.value;
}

/** Records every statement the migration sends through `runner`. */
function recordStatements(runner: QueryRunner): { statements: string[]; stop: () => void } {
  const statements: string[] = [];
  const original = runner.query.bind(runner);
  (runner as any).query = (sql: string, ...rest: unknown[]) => {
    statements.push(sql);
    return (original as any)(sql, ...rest);
  };
  return { statements, stop: () => { (runner as any).query = original; } };
}

async function testBackfill(tenants: Array<{ tenantId: string; seeded: Seeded }>) {
  await inRolledBackTransaction(async (runner) => {
    migration.batchSize = 2;
    const recorded = recordStatements(runner);
    let first;
    try {
      first = await captureLog(() => migration.up(runner));
    } finally {
      recorded.stop();
      migration.batchSize = 50000;
    }
    const log = first.lines.join('\n');
    assert.ok(log.includes(PREFIX), 'the counts are logged under the migration prefix');
    // Other tenants of the lane may hold rows of these labels too: the counts are the run's, not
    // a fixed total. The rows seeded above prove the mapping label by label.
    assert.match(log, /\d+ audit row\(s\) given a parent, \d+ left without one/);
    const statements = recorded.statements.join('\n');
    assert.doesNotMatch(statements, /ROW LEVEL SECURITY|row_security/i, 'the migration never touches RLS');
    assert.ok(recorded.statements.filter((sql) => /WITH candidates AS/.test(sql)).length >= 2, 'several batches per tenant');
    assert.equal(await currentTenantSetting(runner), '', 'the tenant setting is restored');

    for (const { tenantId, seeded } of tenants) {
      const rows = new Map<string, any>((await rowsOf(runner, tenantId)).map((row: any) => [row.id, row]));
      assert.equal(rows.get(seeded.rows.companyMetric).parent_table, 'companies');
      assert.equal(rows.get(seeded.rows.companyMetric).parent_id, seeded.company);
      assert.equal(rows.get(seeded.rows.departmentMetric).parent_table, 'departments');
      assert.equal(rows.get(seeded.rows.departmentMetric).parent_id, seeded.department, 'a deletion reads the before side');
      assert.equal(rows.get(seeded.rows.category).parent_table, 'analytics_axes');
      assert.equal(rows.get(seeded.rows.category).parent_id, seeded.axis);
      assert.equal(rows.get(seeded.rows.invalidUuid).parent_id, null, 'an invalid uuid stays without a parent');
      assert.equal(rows.get(seeded.rows.missingKey).parent_id, null, 'an absent key stays without a parent');
      assert.equal(rows.get(seeded.rows.missingParent).parent_id, null, 'a parent absent from the tenant stays unset');
      assert.equal(rows.get(seeded.rows.ownRecord).parent_id, null, 'a record own row keeps parent NULL');
      assert.equal(rows.get(seeded.already.id).parent_table, 'companies', 'a filled row is not rewritten');
      assert.equal(rows.get(seeded.already.id).parent_id, seeded.already.parent);
    }

    const second = await captureLog(() => migration.up(runner));
    assert.match(second.lines.join('\n'), /no audit row to fill, nothing changed/, 'a second run changes nothing');

    for (const table of ['audit_log', 'companies', 'departments', 'analytics_axes', 'company_metrics', 'department_metrics', 'analytics_categories']) {
      assert.deepEqual(await rowSecurity(runner, table), { enabled: true, forced: true }, `${table}: RLS stayed ENABLE + FORCE`);
    }

    // A revert has no tenant positioned (a real `migration:revert`): its down still clears the
    // family's parents, tenant by tenant, without touching another family's parent.
    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
    await migration.down(runner);
    assert.equal(await currentTenantSetting(runner), '', 'down restores the tenant setting');
    for (const { tenantId, seeded } of tenants) {
      const rows = new Map<string, any>((await rowsOf(runner, tenantId)).map((row: any) => [row.id, row]));
      for (const id of [seeded.rows.companyMetric, seeded.rows.departmentMetric, seeded.rows.category]) {
        assert.equal(rows.get(id).parent_id, null, 'down clears the family parent');
      }
      assert.equal(rows.get(seeded.already.id).parent_id, null, 'down clears a parent of the family label');
    }
    console.log('  family A parent backfill: two tenants, both sides of the payload, idempotent, RLS untouched: OK');
  });
}

async function run() {
  await dataSource.initialize();
  const tenants: Array<{ tenantId: string; seeded: Seeded }> = [];
  try {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      tenants.push(await seedTenant(runner, 'one'));
      tenants.push(await seedTenant(runner, 'two'));
      await runner.commitTransaction();
    } finally {
      await runner.release();
    }
    await testBackfill(tenants);
    console.log('audit-log-parent-family-a-migration.integration.spec: ok');
  } finally {
    for (const tenant of tenants) await dropRaceTenant(tenant.tenantId);
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
