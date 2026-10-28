// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';
import {
  RecordHistoryService,
  type RecordHistoryContext,
  type RecordHistoryItem,
  type RecordHistoryPage,
} from '../record-history.service';
import {
  audit,
  seedHistoryData,
  seedPerson,
  type HistorySeed,
  type Person,
} from './record-history.fixtures';

// The reference-data records of lot 2, family A: companies and departments (point 1), the working
// day calendars and business processes (point 2), the analytics dimensions and values (point 3).
// Each page reads its own history through the common service: the record check is its reference
// family's rule (tenant, RLS, module), a person without the record's module gets 403, an unknown,
// missing or foreign record 404. The own entries and the child kinds read in words, and a reference
// to another module is named only when the reader reads it.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

async function readPage(
  person: Person,
  tenantId: string,
  table: string,
  id: string,
  permissions: Record<string, string>,
): Promise<RecordHistoryPage> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const ctx: RecordHistoryContext = {
      tenantId,
      userId: person.id,
      isAdmin: false,
      permissions,
      manager: runner.manager,
    };
    return await new RecordHistoryService().list(ctx, table, id);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }
}

function findItem(page: RecordHistoryPage, action: string, kind: RecordHistoryItem['subject']['kind'] = 'record'): RecordHistoryItem {
  const item = page.items.find((candidate) => candidate.action === action && candidate.subject.kind === kind);
  assert.ok(item, `a ${action} entry of a ${kind}`);
  return item;
}

function findChange(item: RecordHistoryItem, field: string) {
  const change = item.changes.find((candidate) => candidate.field === field);
  assert.ok(change, `${field}: the field is presented`);
  return change;
}

function assertNoField(page: RecordHistoryPage, field: string) {
  assert.equal(
    page.items.some((item) => item.changes.some((change) => change.field === field)),
    false,
    `${field}: a hidden field never becomes a change`,
  );
}

/** Every value is a scalar, a resolved reference or a hidden one: never a raw payload. */
function assertPresentable(page: RecordHistoryPage) {
  for (const item of page.items) {
    for (const change of item.changes) {
      for (const value of [change.before, change.after]) {
        if (value === null || value === undefined || typeof value !== 'object') continue;
        assert.ok(
          (value as any).hidden === true || typeof (value as any).kind === 'string',
          `${change.field}: a structured value is a reference`,
        );
      }
    }
  }
  const serialized = JSON.stringify(page);
  for (const raw of ['after_json', 'before_json', 'tenant_id', 'created_at', 'updated_at', 'row_version', 'days_by_year']) {
    assert.ok(!serialized.includes(`"${raw}"`), `${raw}: no raw payload key`);
  }
}

async function rowJson(runner: QueryRunner, table: string, id: string): Promise<Record<string, unknown>> {
  const [row] = await runner.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE t.id = $1`, [id]);
  if (!row?.row) throw new Error(`no ${table} row ${id}`);
  return row.row as Record<string, unknown>;
}

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const [row] = await runner.query(sql, params);
  return row.id as string;
}

type Seeded = {
  data: HistorySeed;
  companyReader: Person;
  departmentReader: Person;
  allReader: Person;
  noModule: Person;
};

async function seedFamilyAAudits(runner: QueryRunner, data: HistorySeed) {
  // The company's own rows: a creation and a modification, from the stored row. Its chart of
  // accounts is set first, so the creation payload carries the reference the page shows.
  await runner.query(`UPDATE companies SET coa_id = $3 WHERE tenant_id = $1 AND id = $2`, [data.tenantId, data.companyA, data.coa]);
  const company = await rowJson(runner, 'companies', data.companyA);
  await audit(runner, { table: 'companies', recordId: data.companyA, action: 'create', userId: data.owner, after: company });
  await audit(runner, {
    table: 'companies', recordId: data.companyA, action: 'update', userId: data.owner,
    before: company,
    after: { ...company, name: 'Alpha Co Group', city: 'Paris', status: 'disabled', disabled_at: '2026-06-30T00:00:00.000Z' },
  });

  // A company metric, written before its parent rule existed: the rule fills its parent now.
  const companyMetric = await one(
    runner,
    `INSERT INTO company_metrics (tenant_id, company_id, fiscal_year, headcount, it_users, turnover)
     VALUES ($1, $2, 2026, 100, 20, 12.5) RETURNING id`,
    [data.tenantId, data.companyA],
  );
  const metricRow = await rowJson(runner, 'company_metrics', companyMetric);
  await audit(runner, { table: 'company_metrics', recordId: companyMetric, action: 'create', userId: data.owner, after: metricRow });
  await audit(runner, {
    table: 'company_metrics', recordId: companyMetric, action: 'update', userId: data.owner,
    before: metricRow, after: { ...metricRow, headcount: 120, it_users: 22 },
  });

  // The department's own rows and its headcount child.
  const department = await rowJson(runner, 'departments', data.department);
  await audit(runner, { table: 'departments', recordId: data.department, action: 'create', userId: data.owner, after: department });
  await audit(runner, {
    table: 'departments', recordId: data.department, action: 'update', userId: data.owner,
    before: department, after: { ...department, name: 'Finance and accounting', description: 'Accounting' },
  });
  const departmentMetric = await one(
    runner,
    `INSERT INTO department_metrics (tenant_id, department_id, fiscal_year, headcount) VALUES ($1, $2, 2026, 10) RETURNING id`,
    [data.tenantId, data.department],
  );
  const departmentMetricRow = await rowJson(runner, 'department_metrics', departmentMetric);
  await audit(runner, { table: 'department_metrics', recordId: departmentMetric, action: 'create', userId: data.owner, after: departmentMetricRow });
  await audit(runner, {
    table: 'department_metrics', recordId: departmentMetric, action: 'update', userId: data.owner,
    before: departmentMetricRow, after: { ...departmentMetricRow, headcount: 12 },
  });
}

async function testCompanyAndDepartmentEntries(seeded: Seeded) {
  const { data } = seeded;

  const company = await readPage(seeded.allReader, data.tenantId, 'companies', data.companyA, {
    companies: 'reader',
    accounts: 'reader',
  });
  assertPresentable(company);
  const companyCreate = findItem(company, 'create');
  assert.equal(companyCreate.actor.name, 'Ava Reader');
  assert.equal(findChange(companyCreate, 'name').after, 'Alpha Co');
  assert.equal(findChange(companyCreate, 'country_iso').after, 'FR');
  const chart = findChange(companyCreate, 'coa_id').after as any;
  assert.equal(chart.kind, 'chart_of_accounts');
  assert.equal(chart.label, 'FR · Local chart');
  const companyUpdate = findItem(company, 'update');
  assert.equal(findChange(companyUpdate, 'name').before, 'Alpha Co');
  assert.equal(findChange(companyUpdate, 'name').after, 'Alpha Co Group');
  assert.equal(findChange(companyUpdate, 'status').after, 'disabled');
  for (const field of ['id', 'tenant_id', 'created_at', 'updated_at']) assertNoField(company, field);

  // The chart of accounts is another module: a company reader without accounts never sees it named.
  const companyOnly = await readPage(seeded.companyReader, data.tenantId, 'companies', data.companyA, { companies: 'reader' });
  assert.deepEqual((findChange(findItem(companyOnly, 'create'), 'coa_id').after as any), { hidden: true, kind: 'chart_of_accounts' });
  assert.ok(!JSON.stringify(companyOnly).includes('FR · Local chart'), 'the chart is not named without its module');

  // The metrics child: its title carries the year, its fields the values.
  const metricCreate = findItem(company, 'create', 'metrics');
  assert.equal(metricCreate.subject.label, '2026');
  assert.equal(findChange(metricCreate, 'headcount').after, 100);
  assert.equal(findChange(metricCreate, 'it_users').after, 20);
  assert.equal(findChange(metricCreate, 'turnover').after, 12.5);
  const metricUpdate = findItem(company, 'update', 'metrics');
  assert.equal(findChange(metricUpdate, 'headcount').before, 100);
  assert.equal(findChange(metricUpdate, 'headcount').after, 120);
  assertNoField(company, 'fiscal_year');
  assertNoField(company, 'company_id');
  assertNoField(company, 'frozen_at');

  const department = await readPage(seeded.allReader, data.tenantId, 'departments', data.department, {
    departments: 'reader',
    companies: 'reader',
  });
  assertPresentable(department);
  const departmentCreate = findItem(department, 'create');
  const companyRef = findChange(departmentCreate, 'company_id').after as any;
  assert.equal(companyRef.kind, 'company');
  assert.equal(companyRef.label, 'Alpha Co');
  assert.equal(findChange(findItem(department, 'update'), 'name').after, 'Finance and accounting');
  const departmentMetric = findItem(department, 'update', 'metrics');
  assert.equal(departmentMetric.subject.label, '2026');
  assert.equal(findChange(departmentMetric, 'headcount').before, 10);
  assert.equal(findChange(departmentMetric, 'headcount').after, 12);
  assertNoField(department, 'department_id');
  assertNoField(department, 'fiscal_year');
  console.log('  company and department own entries and metrics children read in words: OK');
}

async function testAccess(seeded: Seeded, foreign: HistorySeed) {
  const { data } = seeded;
  assert.ok((await readPage(seeded.companyReader, data.tenantId, 'companies', data.companyA, { companies: 'reader' })).items.length > 0);
  assert.ok((await readPage(seeded.departmentReader, data.tenantId, 'departments', data.department, { departments: 'reader' })).items.length > 0);

  await assert.rejects(
    () => readPage(seeded.noModule, data.tenantId, 'companies', data.companyA, { tasks: 'reader' }),
    (error: any) => error?.status === 403 && error?.response?.code === 'MODULE_RIGHT_REQUIRED',
    'a person without the companies module gets 403',
  );
  await assert.rejects(
    () => readPage(seeded.noModule, data.tenantId, 'departments', data.department, { tasks: 'reader' }),
    (error: any) => error?.status === 403 && error?.response?.code === 'MODULE_RIGHT_REQUIRED',
    'a person without the departments module gets 403',
  );
  await assert.rejects(
    () => readPage(seeded.companyReader, data.tenantId, 'unknown_table', data.companyA, { companies: 'reader' }),
    (error: any) => error?.status === 404,
    'an unknown table gets 404',
  );
  await assert.rejects(
    () => readPage(seeded.companyReader, data.tenantId, 'companies', 'not-a-uuid', { companies: 'reader' }),
    (error: any) => error?.status === 404,
    'a malformed id gets 404',
  );
  await assert.rejects(
    () => readPage(seeded.companyReader, data.tenantId, 'companies', randomUUID(), { companies: 'reader' }),
    (error: any) => error?.status === 404,
    'a missing company gets 404',
  );
  await assert.rejects(
    () => readPage(seeded.allReader, data.tenantId, 'companies', foreign.companyA, { companies: 'reader' }),
    (error: any) => error?.status === 404,
    'a company of another tenant gets 404',
  );
  await assert.rejects(
    () => readPage(seeded.allReader, data.tenantId, 'departments', foreign.department, { departments: 'reader' }),
    (error: any) => error?.status === 404,
    'a department of another tenant gets 404',
  );
  console.log('  200 with the module, 403 without it, 404 for unknown, missing and foreign records: OK');
}

async function run() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('record-history-family-a');
  const foreignTenantId = await createRaceTenant('record-history-family-a-foreign');
  try {
    const seeded = await seed(tenantId, async (runner) => {
      const data = await seedHistoryData(runner, tenantId);
      await seedFamilyAAudits(runner, data);
      const companyReader = await seedPerson(runner, tenantId, { first: 'Cora', last: 'Company' }, { companies: 'reader' });
      const departmentReader = await seedPerson(runner, tenantId, { first: 'Dora', last: 'Department' }, { departments: 'reader' });
      const allReader = await seedPerson(
        runner,
        tenantId,
        { first: 'Alba', last: 'All' },
        { companies: 'reader', departments: 'reader', accounts: 'reader' },
      );
      const noModule = await seedPerson(runner, tenantId, { first: 'Nino', last: 'NoModule' }, { tasks: 'reader' });
      return { data, companyReader, departmentReader, allReader, noModule };
    });
    const foreign = await seed(foreignTenantId, (runner) => seedHistoryData(runner, foreignTenantId));

    await testAccess(seeded, foreign);
    await testCompanyAndDepartmentEntries(seeded);
    console.log('record-history-family-a.integration.spec: ok');
  } finally {
    await dropRaceTenant(tenantId);
    await dropRaceTenant(foreignTenantId);
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
