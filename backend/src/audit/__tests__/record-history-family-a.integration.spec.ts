// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';
import {
  HISTORY_FIELDS,
  RecordHistoryService,
  type RecordHistoryChange,
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
  calendarReader: Person;
  processReader: Person;
  applicationReader: Person;
  analyticsReader: Person;
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

  // The calendar's own rows; its long year content must never come out.
  const calendar = await rowJson(runner, 'working_day_profiles', data.calendar);
  await audit(runner, { table: 'working_day_profiles', recordId: data.calendar, action: 'create', userId: data.owner, after: calendar });
  await audit(runner, {
    table: 'working_day_profiles', recordId: data.calendar, action: 'update', userId: data.owner,
    before: calendar,
    after: { ...calendar, name: 'France (metropolitan)', region_code: '75', days_by_year: { 2026: ['01', '02'] } },
  });

  // The process's owners as the screen shows them, then its own rows.
  await runner.query(
    `UPDATE business_processes SET owner_user_id = $3, it_owner_user_id = $3, is_default = true
      WHERE tenant_id = $1 AND id = $2`,
    [data.tenantId, data.businessProcess, data.owner],
  );
  const process = await rowJson(runner, 'business_processes', data.businessProcess);
  await audit(runner, { table: 'business_processes', recordId: data.businessProcess, action: 'create', userId: data.owner, after: process });
  await audit(runner, {
    table: 'business_processes', recordId: data.businessProcess, action: 'update', userId: data.owner,
    before: process,
    after: { ...process, description: 'Order to cash end to end', notes: 'SOP linked', is_default: false },
  });

  // The application link: the process is the record, the application the payload value.
  await audit(runner, {
    table: 'application_business_processes', recordId: data.businessProcess, action: 'update', userId: data.owner,
    before: null, after: { application_id: data.application },
  });
  await audit(runner, {
    table: 'application_business_processes', recordId: data.businessProcess, action: 'update', userId: data.owner,
    before: { application_id: data.application }, after: null,
  });

  // The request side names the request, not the process: no process history may read it.
  await audit(runner, {
    table: 'portfolio_request_business_processes', recordId: data.request, action: 'update', userId: data.owner,
    before: [], after: [data.businessProcess],
  });

  // The analytics dimension and its values: a creation and a modification of the dimension, the
  // value additions, modifications and removals, and a forced deletion with its counts.
  await runner.query(
    `UPDATE analytics_axes SET applies_to = 'opex', required = true, open_values = true WHERE tenant_id = $1 AND id = $2`,
    [data.tenantId, data.axis],
  );
  const axis = await rowJson(runner, 'analytics_axes', data.axis);
  await audit(runner, { table: 'analytics_axes', recordId: data.axis, action: 'create', userId: data.owner, after: axis });
  await audit(runner, {
    table: 'analytics_axes', recordId: data.axis, action: 'update', userId: data.owner,
    before: axis, after: { ...axis, description: 'Where the cost sits' },
  });

  const category = await rowJson(runner, 'analytics_categories', data.categoryA);
  await audit(runner, { table: 'analytics_categories', recordId: data.categoryA, action: 'create', userId: data.owner, after: category });
  await audit(runner, {
    table: 'analytics_categories', recordId: data.categoryA, action: 'update', userId: data.owner,
    before: category, after: { ...category, description: 'Cloud spend' },
  });
  const removedValue = await one(
    runner,
    `INSERT INTO analytics_categories (tenant_id, axis_id, name, sort_order) VALUES ($1, $2, 'Retired value', 2) RETURNING id`,
    [data.tenantId, data.axis],
  );
  const removedRow = await rowJson(runner, 'analytics_categories', removedValue);
  await audit(runner, { table: 'analytics_categories', recordId: removedValue, action: 'create', userId: data.owner, after: removedRow });
  await audit(runner, { table: 'analytics_categories', recordId: removedValue, action: 'delete', userId: data.owner, before: removedRow, after: null });

  await audit(runner, {
    table: 'analytics_axes', recordId: data.axis, action: 'delete', userId: data.owner,
    before: axis,
    after: { forced: true, values: 2, lines: 5, opex_lines: 3, capex_lines: 2 },
  });
  const forcedValue = await rowJson(runner, 'analytics_categories', data.categoryB);
  await audit(runner, {
    table: 'analytics_categories', recordId: data.categoryB, action: 'delete', userId: data.owner,
    before: forcedValue,
    after: { forced: true, lines: 5, opex_lines: 3, capex_lines: 2 },
  });
}

async function testPayloadKeys(tenantId: string) {
  const labels = [
    'analytics_axes', 'analytics_categories', 'application_business_processes', 'business_processes',
    'companies', 'company_metrics', 'department_metrics', 'departments', 'working_day_profiles',
  ];
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const rows: Array<{ table_name: string; key: string }> = await runner.query(
      `SELECT DISTINCT a.table_name, jsonb_object_keys(
         CASE WHEN jsonb_typeof(COALESCE(a.after_json, a.before_json)) = 'object'
              THEN COALESCE(a.after_json, a.before_json) ELSE '{}'::jsonb END) AS key
         FROM audit_log a
        WHERE a.tenant_id = $1 AND a.table_name = ANY($2::text[])`,
      [tenantId, labels],
    );
    for (const label of labels) {
      const catalog = HISTORY_FIELDS[label];
      assert.ok(catalog, `${label}: an allow-list`);
      const unclassified = rows
        .filter((row) => row.table_name === label)
        .map((row) => row.key)
        .filter((key) => !Object.prototype.hasOwnProperty.call(catalog, key));
      assert.deepEqual(unclassified, [], `${label} payload keys neither shown nor hidden: ${unclassified.join(', ')}`);
    }
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }
  console.log('  every family A payload key is classified shown or hidden: OK');
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

function findEvent(page: RecordHistoryPage, field: string, event: 'added' | 'removed'): RecordHistoryChange {
  const found = page.items.flatMap((item) => item.changes).find((change) => change.field === field && change.event === event);
  assert.ok(found, `${field}: a ${event} event`);
  return found;
}

async function testCalendarAndProcessEntries(seeded: Seeded) {
  const { data } = seeded;

  const calendar = await readPage(seeded.calendarReader, data.tenantId, 'working_day_profiles', data.calendar, {
    working_day_profiles: 'reader',
  });
  assertPresentable(calendar);
  const calendarCreate = findItem(calendar, 'create');
  assert.equal(findChange(calendarCreate, 'code').after, 'FR');
  assert.equal(findChange(calendarCreate, 'name').after, 'France');
  const calendarUpdate = findItem(calendar, 'update');
  assert.equal(findChange(calendarUpdate, 'name').after, 'France (metropolitan)');
  assert.equal(findChange(calendarUpdate, 'region_code').after, '75');
  assertNoField(calendar, 'days_by_year');
  assert.ok(!JSON.stringify(calendar).includes('2026-01-02'), 'the year content never comes out');

  const process = await readPage(seeded.allReader, data.tenantId, 'business_processes', data.businessProcess, {
    business_processes: 'reader',
    applications: 'reader',
  });
  assertPresentable(process);
  const processCreate = findItem(process, 'create');
  assert.equal(findChange(processCreate, 'is_default').after, true);
  assert.equal((findChange(processCreate, 'owner_user_id').after as any).label, 'Ava Reader');
  assert.equal((findChange(processCreate, 'it_owner_user_id').after as any).label, 'Ava Reader');
  const processUpdate = findItem(process, 'update');
  assert.equal(findChange(processUpdate, 'description').after, 'Order to cash end to end');
  assert.equal(findChange(processUpdate, 'notes').after, 'SOP linked');
  assert.equal(findChange(processUpdate, 'is_default').after, false);
  assertNoField(process, 'categories');

  // The application link, added then removed, named for an applications reader.
  const added = findEvent(process, 'application', 'added');
  assert.equal((added.after as any).kind, 'application');
  assert.equal((added.after as any).label, 'Ledger App');
  const removed = findEvent(process, 'application', 'removed');
  assert.equal((removed.before as any).label, 'Ledger App');

  // Without the applications module the link is a nameless application, never its name.
  const processOnly = await readPage(seeded.processReader, data.tenantId, 'business_processes', data.businessProcess, {
    business_processes: 'reader',
  });
  assert.deepEqual(findEvent(processOnly, 'application', 'added').after, { hidden: true, kind: 'application' });
  assert.ok(!JSON.stringify(processOnly).includes('Ledger App'), 'the application is not named without its module');

  // The request-side link row names the request; it is not an entry of the process history.
  assert.equal(
    process.items.some((item) => item.changes.some((change) => change.field === 'request')),
    false,
    'the request link is not read from the process',
  );
  console.log('  calendar and process own entries, hidden year content, named and hidden application link: OK');
}

async function testAnalyticsEntries(seeded: Seeded) {
  const { data } = seeded;
  const axis = await readPage(seeded.analyticsReader, data.tenantId, 'analytics_axes', data.axis, { analytics: 'reader' });
  assertPresentable(axis);
  const axisCreate = findItem(axis, 'create');
  assert.equal(findChange(axisCreate, 'code').after, 'cost_pool');
  assert.equal(findChange(axisCreate, 'name').after, 'Cost pool');
  assert.equal(findChange(axisCreate, 'applies_to').after, 'opex');
  assert.equal(findChange(axisCreate, 'required').after, true);
  assert.equal(findChange(axisCreate, 'open_values').after, true);
  const axisUpdate = findItem(axis, 'update');
  assert.equal(findChange(axisUpdate, 'description').after, 'Where the cost sits');

  // A value added, modified and removed, from the dimension's side.
  const valueEvents = axis.items.flatMap((item) => item.changes).filter((change) => change.field === 'value');
  assert.ok(valueEvents.some((change) => change.event === 'added' && change.after === 'Cloud'), 'Cloud was added');
  assert.ok(valueEvents.some((change) => change.event === 'added' && change.after === 'Retired value'), 'Retired value was added');
  assert.ok(valueEvents.some((change) => change.event === 'removed' && change.before === 'Retired value'), 'Retired value was removed');
  const valueUpdate = axis.items.find((item) => item.subject.kind === 'value' && item.subject.label === 'Cloud' && item.action === 'update');
  assert.ok(valueUpdate, 'the value modification is an entry');
  assert.equal(findChange(valueUpdate, 'description').after, 'Cloud spend');

  // A forced deletion: its counts are shown, its marker and the total it repeats are not.
  const forced = axis.items.find((item) => item.action === 'delete' && item.subject.kind === 'record');
  assert.ok(forced, 'the forced deletion is an entry');
  assert.equal(findChange(forced, 'values').after, 2);
  assert.equal(findChange(forced, 'opex_lines').after, 3);
  assert.equal(findChange(forced, 'capex_lines').after, 2);
  assertNoField(axis, 'lines');
  assertNoField(axis, 'forced');

  // The value as its own record: the dimension it belongs to is named for an analytics reader.
  const value = await readPage(seeded.analyticsReader, data.tenantId, 'analytics_categories', data.categoryA, { analytics: 'reader' });
  assertPresentable(value);
  const valueCreate = findItem(value, 'create');
  assert.equal(findChange(valueCreate, 'name').after, 'Cloud');
  const dimension = findChange(valueCreate, 'axis_id').after as any;
  assert.equal(dimension.kind, 'analytics_axis');
  assert.equal(dimension.label, 'Cost pool');
  assert.equal(findChange(findItem(value, 'update'), 'description').after, 'Cloud spend');
  for (const field of ['id', 'tenant_id', 'created_at', 'updated_at']) assertNoField(value, field);

  // A forced value deletion: its own record entry shows the line counts, not the marker nor the
  // total the two natures repeat.
  const forcedValue = await readPage(seeded.analyticsReader, data.tenantId, 'analytics_categories', data.categoryB, { analytics: 'reader' });
  const forcedDelete = findItem(forcedValue, 'delete');
  assert.equal(findChange(forcedDelete, 'opex_lines').after, 3);
  assert.equal(findChange(forcedDelete, 'capex_lines').after, 2);
  assertNoField(forcedValue, 'lines');
  assertNoField(forcedValue, 'forced');
  console.log('  analytics dimension and value entries, value child events, forced counts: OK');
}

async function testAccess(seeded: Seeded, foreign: HistorySeed) {
  const { data } = seeded;
  assert.ok((await readPage(seeded.companyReader, data.tenantId, 'companies', data.companyA, { companies: 'reader' })).items.length > 0);
  assert.ok((await readPage(seeded.departmentReader, data.tenantId, 'departments', data.department, { departments: 'reader' })).items.length > 0);
  assert.ok((await readPage(seeded.calendarReader, data.tenantId, 'working_day_profiles', data.calendar, { working_day_profiles: 'reader' })).items.length > 0);
  assert.ok((await readPage(seeded.processReader, data.tenantId, 'business_processes', data.businessProcess, { business_processes: 'reader' })).items.length > 0);
  assert.ok((await readPage(seeded.analyticsReader, data.tenantId, 'analytics_axes', data.axis, { analytics: 'reader' })).items.length > 0);
  assert.ok((await readPage(seeded.analyticsReader, data.tenantId, 'analytics_categories', data.categoryA, { analytics: 'reader' })).items.length > 0);

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
    () => readPage(seeded.noModule, data.tenantId, 'working_day_profiles', data.calendar, { tasks: 'reader' }),
    (error: any) => error?.status === 403 && error?.response?.code === 'MODULE_RIGHT_REQUIRED',
    'a person without the working_day_profiles module gets 403',
  );
  await assert.rejects(
    () => readPage(seeded.noModule, data.tenantId, 'business_processes', data.businessProcess, { tasks: 'reader' }),
    (error: any) => error?.status === 403 && error?.response?.code === 'MODULE_RIGHT_REQUIRED',
    'a person without the business_processes module gets 403',
  );
  await assert.rejects(
    () => readPage(seeded.noModule, data.tenantId, 'analytics_axes', data.axis, { tasks: 'reader' }),
    (error: any) => error?.status === 403 && error?.response?.code === 'MODULE_RIGHT_REQUIRED',
    'a person without the analytics module gets 403',
  );
  await assert.rejects(
    () => readPage(seeded.noModule, data.tenantId, 'analytics_categories', data.categoryA, { tasks: 'reader' }),
    (error: any) => error?.status === 403 && error?.response?.code === 'MODULE_RIGHT_REQUIRED',
    'a person without the analytics module gets 403 on a value',
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
  await assert.rejects(
    () => readPage(seeded.allReader, data.tenantId, 'working_day_profiles', foreign.calendar, { working_day_profiles: 'reader' }),
    (error: any) => error?.status === 404,
    'a calendar of another tenant gets 404',
  );
  await assert.rejects(
    () => readPage(seeded.allReader, data.tenantId, 'business_processes', foreign.businessProcess, { business_processes: 'reader' }),
    (error: any) => error?.status === 404,
    'a process of another tenant gets 404',
  );
  await assert.rejects(
    () => readPage(seeded.allReader, data.tenantId, 'analytics_axes', foreign.axis, { analytics: 'reader' }),
    (error: any) => error?.status === 404,
    'a dimension of another tenant gets 404',
  );
  await assert.rejects(
    () => readPage(seeded.allReader, data.tenantId, 'analytics_categories', foreign.categoryA, { analytics: 'reader' }),
    (error: any) => error?.status === 404,
    'a value of another tenant gets 404',
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
      const calendarReader = await seedPerson(runner, tenantId, { first: 'Cal', last: 'Calendar' }, { working_day_profiles: 'reader' });
      const processReader = await seedPerson(runner, tenantId, { first: 'Pia', last: 'Process' }, { business_processes: 'reader' });
      const applicationReader = await seedPerson(runner, tenantId, { first: 'Ari', last: 'Application' }, { applications: 'reader' });
      const analyticsReader = await seedPerson(runner, tenantId, { first: 'Ana', last: 'Analytics' }, { analytics: 'reader' });
      const allReader = await seedPerson(
        runner,
        tenantId,
        { first: 'Alba', last: 'All' },
        {
          companies: 'reader', departments: 'reader', accounts: 'reader',
          working_day_profiles: 'reader', business_processes: 'reader', applications: 'reader', analytics: 'reader',
        },
      );
      const noModule = await seedPerson(runner, tenantId, { first: 'Nino', last: 'NoModule' }, { tasks: 'reader' });
      return { data, companyReader, departmentReader, calendarReader, processReader, applicationReader, analyticsReader, allReader, noModule };
    });
    const foreign = await seed(foreignTenantId, (runner) => seedHistoryData(runner, foreignTenantId));

    await testAccess(seeded, foreign);
    await testPayloadKeys(tenantId);
    await testCompanyAndDepartmentEntries(seeded);
    await testCalendarAndProcessEntries(seeded);
    await testAnalyticsEntries(seeded);
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
