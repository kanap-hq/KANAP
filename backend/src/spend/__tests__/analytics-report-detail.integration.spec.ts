// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import appDataSource from '../../data-source';
import { applyDataAccess } from '../../data-access/data-access';
import { hiddenCategoryLineCounts } from '../../data-access/hidden-links';
import { LIMITED_ROLE, PgClient, roleExists } from '../../data-access/__tests__/data-access-test-helpers';
import { seed, type Seed } from '../../data-access/__tests__/data-access-line-seed';
import { budgetListAccess } from '../budget-list/budget-list.runtime';
import { BudgetLinesService } from '../budget-lines.service';
import { BudgetReportExportService } from '../reports/budget-report-export.service';
import { realSummaryDeps } from './oracle/oracle-deps';
import * as R from '../../../../frontend/src/pages/reports/reportAggregates';
import * as T from '../../../../frontend/src/pages/reports/reportTables';

/**
 * The analytics report's detail by line, on the data-scoped access reference example
 * (`data-access-line-seed.ts`): seven lines of 100 EUR in 2026 on the first dimension's value;
 * L5 is made CAPEX, so the detail shows both natures together. Ulla reads everything; Rita reads
 * L1 to L4 and hides L5 to L7.
 *
 * The cases: one value row (count 7, 700 EUR) with its OPEX and CAPEX lines under it, each a
 * seventh of the value; Rita's value row counts and sums her four lines, and the hidden count is 3;
 * the export with the detail carries the reference, nature and share columns, the export without it
 * does not; the split gives the value 6/7 OPEX and 1/7 CAPEX, on screen and in the export, and Rita's
 * split covers her four OPEX lines only.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 2 });
const YEAR = 2026;

const LABELS: T.ReportTableLabels = {
  columnNames: { budget: 'Budget', revision: 'Revision', forecast: 'Forecast', follow_up: 'Actuals', landing: 'Expected landing' },
  columnFte: (column) => `${column} FTE`,
  metric: 'Metric',
  year: 'Year',
  column: 'Column',
  selection: 'Selection',
  total: 'Total',
  totalFte: 'Total FTE',
  item: 'Line',
  reference: 'Ref',
  shareOfTotal: 'Share of total',
  delta: 'Delta',
  pctIncrease: '% increase',
  consolidationAccount: 'Consolidation account',
  consolidationUnassigned: 'Unassigned',
  consolidationTotal: (metric) => `Total ${metric}`,
  analyticsUnassigned: 'Unassigned',
  analyticsUnnamed: 'Unnamed value',
  analyticsTotal: (metric) => `Total ${metric}`,
  analyticsLines: 'Lines',
  analyticsNature: 'Nature',
  analyticsOpexShare: 'OPEX share',
  analyticsCapexShare: 'CAPEX share',
  analyticsLevel: 'Level',
  analyticsLevelValue: 'Value',
  analyticsLevelLine: 'Line',
  natureOpex: 'OPEX',
  natureCapex: 'CAPEX',
  monthNames: T.shortMonthNames('en'),
  average: 'Average',
  peak: 'Peak',
  fte: 'FTE',
  staffCost: 'Staff cost',
  costPerFte: 'Cost per FTE',
  days: 'Days',
  dayCost: 'Day cost',
  dailyRate: 'Daily rate',
};

function clientOf(runner: QueryRunner): PgClient {
  return { query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params as any[]) }) } as unknown as PgClient;
}

function services() {
  const deps = realSummaryDeps({ scope: 'opex' });
  const lines = new (BudgetLinesService as any)(deps.allocationCalculator, deps.fxRates, undefined, undefined, undefined, undefined, undefined);
  return { lines: lines as BudgetLinesService, export: new BudgetReportExportService(undefined as any, undefined as any, lines) };
}

async function as<T>(runner: QueryRunner, person: string, fn: (m: EntityManager) => Promise<T>): Promise<T> {
  await runner.query('SAVEPOINT person');
  try {
    await applyDataAccess(runner, person);
    return await fn(runner.manager);
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT person');
  }
}

function ctxOf(s: Seed, person: string, manager: EntityManager) {
  return { tenantId: s.tenantId, userId: person, isAdmin: false, permissions: {}, manager };
}

function rowsOf(table: T.ReportTableData) {
  return table.rows.map((row) => ({
    group: row.group,
    level: row.level,
    levelLabel: row.levelLabel,
    count: row.count,
    reference: row.reference,
    nature: row.nature,
    year: row[String(YEAR)],
    share: row[`share_${YEAR}`],
  }));
}

async function testUnscoped(runner: QueryRunner, s: Seed): Promise<void> {
  const svc = services();
  await as(runner, s.persons.ulla, async (m) => {
    const valueAnswer = await svc.lines.summaryAggregateRequest(R.analyticsRequest({
      axisId: s.axis1, years: [YEAR], metric: 'budget', excludedIds: [], filters: {}, measure: 'amount',
    }), { manager: m, access: budgetListAccess(ctxOf(s, s.persons.ulla, m)) });
    const lineAnswer = await svc.lines.summaryAggregateRequest(R.analyticsLinesRequest({
      scope: 'all', axisId: s.axis1, years: [YEAR], metric: 'budget', excludedIds: [], filters: {}, measure: 'amount',
    }), { manager: m, access: budgetListAccess(ctxOf(s, s.persons.ulla, m)) });
    const table = T.analyticsTable(
      { scope: 'all', years: [YEAR], metric: 'budget', measure: 'amount', dimension: 'Dimension', detail: true },
      valueAnswer as any,
      LABELS,
      lineAnswer as any,
    );
    const rows = rowsOf(table);
    assert.deepEqual(rows[0], { group: 'a1 value', level: 0, levelLabel: 'Value', count: 7, reference: undefined, nature: undefined, year: 700, share: undefined });
    const lines = rows.slice(1);
    assert.equal(lines.length, 7, 'the seven lines of the value');
    assert.equal(lines.filter((line) => line.nature === 'OPEX').length, 6);
    assert.equal(lines.filter((line) => line.nature === 'CAPEX').length, 1);
    assert.ok(lines.every((line) => String(line.reference ?? '').startsWith('BL-')), 'every line has its BL reference');
    assert.ok(lines.every((line) => line.levelLabel === 'Line'), 'every line row says Line');
    assert.ok(lines.every((line) => line.share === 1 / 7), 'each line is a seventh of the value');
    assert.deepEqual(lines.map((line) => line.year), [100, 100, 100, 100, 100, 100, 100]);
    console.log('  unscoped: one value row (7 lines, 700) and its OPEX and CAPEX lines, shares exact: OK');

    const natureAnswer = await svc.lines.summaryAggregateRequest(R.analyticsNatureRequest({
      axisId: s.axis1, years: [YEAR], metric: 'budget', excludedIds: [], filters: {}, measure: 'amount',
    }), { manager: m, access: budgetListAccess(ctxOf(s, s.persons.ulla, m)) });
    const split = T.analyticsTable(
      { scope: 'all', years: [YEAR], metric: 'budget', measure: 'amount', dimension: 'Dimension', split: true },
      valueAnswer as any,
      LABELS,
      undefined,
      natureAnswer as any,
    );
    assert.deepEqual([split.rows[0][`opex_${YEAR}`], split.rows[0][`capex_${YEAR}`]], [600 / 700, 100 / 700], 'six OPEX lines, one CAPEX');
    assert.deepEqual([split.footer[0][`opex_${YEAR}`], split.footer[0][`capex_${YEAR}`]], [600 / 700, 100 / 700], 'the total, from the values together');
    console.log('  unscoped: split of the value and the total: OK');
  });
}

async function testLimited(runner: QueryRunner, s: Seed): Promise<void> {
  const svc = services();
  await as(runner, s.persons.rita, async (m) => {
    const valueAnswer = await svc.lines.summaryAggregateRequest(R.analyticsRequest({
      axisId: s.axis1, years: [YEAR], metric: 'budget', excludedIds: [], filters: {}, measure: 'amount',
    }), { manager: m, access: budgetListAccess(ctxOf(s, s.persons.rita, m)) });
    const lineAnswer = await svc.lines.summaryAggregateRequest(R.analyticsLinesRequest({
      scope: 'all', axisId: s.axis1, years: [YEAR], metric: 'budget', excludedIds: [], filters: {}, measure: 'amount',
    }), { manager: m, access: budgetListAccess(ctxOf(s, s.persons.rita, m)) });
    assert.equal((valueAnswer as any).dataAccessLimited, true);
    const table = T.analyticsTable(
      { scope: 'all', years: [YEAR], metric: 'budget', measure: 'amount', dimension: 'Dimension', detail: true },
      valueAnswer as any,
      LABELS,
      lineAnswer as any,
    );
    const rows = rowsOf(table);
    assert.deepEqual(rows[0], { group: 'a1 value', level: 0, levelLabel: 'Value', count: 4, reference: undefined, nature: undefined, year: 400, share: undefined });
    assert.equal(rows.length, 5, 'her four lines only');
    assert.ok(rows.slice(1).every((line) => line.share === 1 / 4));
    const hidden = await hiddenCategoryLineCounts(m, s.axis1, [s.category1], `${YEAR}-01-01`);
    assert.equal(hidden.get(s.category1.toLowerCase()), 3, 'L5 to L7');
    const natureAnswer = await svc.lines.summaryAggregateRequest(R.analyticsNatureRequest({
      axisId: s.axis1, years: [YEAR], metric: 'budget', excludedIds: [], filters: {}, measure: 'amount',
    }), { manager: m, access: budgetListAccess(ctxOf(s, s.persons.rita, m)) });
    const { byValue } = R.readAnalyticsNatures([YEAR], natureAnswer as any);
    assert.deepEqual(byValue.get(s.category1), { opex: { [YEAR]: 400 }, capex: { [YEAR]: null } }, 'her four OPEX lines, the CAPEX L5 hidden');
    console.log('  limited: totals and count on her four lines, 3 hidden lines: OK');
  });
}

function csvRows(body: Buffer): string[][] {
  return body.toString('utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/).map((line) => line.split(','));
}

async function testExport(runner: QueryRunner, s: Seed): Promise<void> {
  const svc = services();
  await as(runner, s.persons.ulla, async (m) => {
    const ctx = ctxOf(s, s.persons.ulla, m);
    const base = { axis: s.axis1, startYear: String(YEAR), endYear: String(YEAR), metric: 'budget', format: 'csv', language: 'en' };
    const without = await svc.export.export('analytics', { ...base, detail: 'values' }, ctx);
    const withoutRows = csvRows(without.body);
    const axisName = `a1-${s.tenantId.slice(0, 8)}`;
    assert.deepEqual(withoutRows[0], [axisName, 'Lines', String(YEAR)], 'values only: no reference, nature or share column');
    assert.equal(withoutRows.length, 1 + 2, 'the value row and the total');
    assert.equal(withoutRows[1][1], '7');

    const withDetail = await svc.export.export('analytics', { ...base, detail: 'lines' }, ctx);
    const withRows = csvRows(withDetail.body);
    assert.deepEqual(withRows[0], [axisName, 'Lines', 'Level', 'Ref', 'Nature', String(YEAR), `Share of total ${YEAR}`]);
    assert.equal(withRows.length, 1 + 9, 'the value row, the seven lines and the total');
    assert.equal(withRows[1][2], 'Value', 'the value row says Value');
    assert.ok(withRows.slice(2, 9).every((row) => row[2] === 'Line'), 'every line row says Line');
    assert.ok(withRows.slice(2, 9).every((row) => /^BL-\d+$/.test(row[3])), 'every line names its reference');
    assert.deepEqual(withRows.slice(2, 9).map((row) => row[4]).sort(), ['CAPEX', 'OPEX', 'OPEX', 'OPEX', 'OPEX', 'OPEX', 'OPEX']);
    assert.ok(withRows.slice(2, 9).every((row) => row[6] === '14.29%'), 'a seventh, as the CSV writes a percent');
    console.log('  export: without detail the value row only, with detail its lines, references, natures and shares: OK');

    const withSplit = await svc.export.export('analytics', { ...base, detail: 'values', split: 'nature' }, ctx);
    const splitRows = csvRows(withSplit.body);
    assert.deepEqual(splitRows[0], [axisName, 'Lines', String(YEAR), `OPEX share ${YEAR}`, `CAPEX share ${YEAR}`]);
    assert.deepEqual(splitRows[1].slice(3), ['85.71%', '14.29%'], 'the value: six sevenths OPEX');
    assert.deepEqual(splitRows[2].slice(3), ['85.71%', '14.29%'], 'the total');
    await assert.rejects(svc.export.export('analytics', { ...base, split: 'yes' }, ctx), /split must be none or nature/);
    console.log('  export: the split columns, an unknown split refused: OK');
  });
}

async function run(): Promise<void> {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    if (!(await roleExists(clientOf(runner)))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`analytics report detail: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('analytics report detail');
    await runner.startTransaction();
    try {
      const s = await seed(clientOf(runner));
      // One CAPEX line on the same value, so the detail shows both natures together.
      await runner.query(`UPDATE spend_items SET nature = 'capex' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.lines.L5]);
      await testUnscoped(runner, s);
      await testLimited(runner, s);
      await testExport(runner, s);
    } finally {
      await runner.rollbackTransaction();
    }
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
  console.log('analytics-report-detail.integration.spec: OK');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
