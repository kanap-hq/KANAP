import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { deltaRequests, readDelta, type DeltaMode, type MetricKey, type ReportMeasure } from '../../spend/reports/shared/reportAggregates';
import { CAPEX_NUMBER_OFFSET } from '../../spend/__tests__/round-inputs.fixtures';

// The change between two budget columns in Plaid and the MCP server (lot L8 C of the Plaid pass),
// against the database, every figure compared with the "Top increase / decrease" report's own
// request and reader (`deltaRequests`, `readDelta`, the server copy of the screen's code) sent to
// the report's route on the same lines (all active, both natures):
// - the top 10 increases from the budget to the revision of Y, by line (reference and title, never
//   the id): the report's lines, order, figures and totals over every line;
// - the decreases (`direction`), a shorter top (`limit`), by supplier (the changes of its lines);
// - pct_increase null when the source is 0; the FTE change (a side without FTE);
// - the amounts in the reporting currency, a line without a rate left out and named;
// - group_by line on the other metrics, the refusals in words (metrics, then_by, direction).
// @database-spec: boots the application context, so run-ci-tests.js runs this file in a database lane.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-budget-delta-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const Y = new Date().getFullYear();
/** The USD rate of Y (a USD amount times the rate, in EUR); GBP has no rate. */
const USD_RATE = 1.25;

type Harness = { app: any; dataSource: DataSource; aggregates: any; budgetLines: any };

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-budget-delta.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiAggregateExecutor } = require('../query/ai-aggregate.executor');
  const { BudgetLinesService } = require('../../spend/budget-lines.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  return { app, dataSource: app.get(DataSource), aggregates: app.get(AiAggregateExecutor), budgetLines: app.get(BudgetLinesService) };
}

type Line = {
  label: string;
  nature: 'opex' | 'capex';
  supplier: 's1' | 's2' | null;
  currency: 'EUR' | 'USD' | 'GBP';
  /** Budget Y and revision Y, in the line's currency. */
  amounts: [number, number];
  /** The FTE of the budget and of the revision (null: no FTE on that side). */
  fte?: [number | null, number | null];
};

/** Twelve lines that rise (no two by the same change), two that fall, one without a rate; both natures. */
const LINES: Line[] = [
  { label: 'alpha', nature: 'opex', supplier: 's1', currency: 'EUR', amounts: [1000, 1500], fte: [1, 1.5] },
  { label: 'bravo', nature: 'opex', supplier: 's1', currency: 'EUR', amounts: [2000, 2100], fte: [2, 2] },
  { label: 'charlie', nature: 'opex', supplier: 's2', currency: 'EUR', amounts: [500, 1200], fte: [0.5, 1.25] },
  { label: 'delta', nature: 'capex', supplier: 's2', currency: 'EUR', amounts: [3000, 3300], fte: [null, 1] },
  { label: 'echo', nature: 'opex', supplier: null, currency: 'EUR', amounts: [0, 800] },
  { label: 'foxtrot', nature: 'opex', supplier: 's1', currency: 'USD', amounts: [400, 600] },
  { label: 'golf', nature: 'capex', supplier: null, currency: 'EUR', amounts: [1000, 1050] },
  { label: 'hotel', nature: 'opex', supplier: 's2', currency: 'EUR', amounts: [700, 1010] },
  { label: 'india', nature: 'opex', supplier: 's1', currency: 'EUR', amounts: [100, 160] },
  { label: 'juliet', nature: 'opex', supplier: null, currency: 'EUR', amounts: [900, 1350] },
  { label: 'kilo', nature: 'opex', supplier: 's2', currency: 'EUR', amounts: [1200, 1210] },
  { label: 'lima', nature: 'opex', supplier: 's1', currency: 'EUR', amounts: [50, 51] },
  { label: 'mike', nature: 'opex', supplier: 's1', currency: 'EUR', amounts: [5000, 4000], fte: [3, 2] },
  { label: 'november', nature: 'opex', supplier: 's2', currency: 'EUR', amounts: [800, 750], fte: [1, 0.5] },
  { label: 'oscar', nature: 'opex', supplier: null, currency: 'GBP', amounts: [10000, 20000] },
];

type Seed = { tenantId: string; userId: string; suppliers: Record<'s1' | 's2', string>; refs: Record<string, string> };

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ai-delta-${tag}`, `AI delta ${tag}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  await runner.query(
    `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates) VALUES ($1, $2, 'EUR', $3::jsonb)`,
    [tenantId, Y, JSON.stringify({ USD: USD_RATE })],
  );
  const roleId = await insertId(runner,
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in) VALUES ($1, 'Administrator', 'delta spec', false, false)`, [tenantId]);
  const userId = randomUUID();
  await runner.query(
    `INSERT INTO users (id, tenant_id, first_name, last_name, email, role_id, mfa_enabled, status, data_access_mode)
     VALUES ($1, $2, 'Delta', 'Spec', $3, $4, false, 'enabled', 'all')`,
    [userId, tenantId, `delta-${tag}@example.test`, roleId],
  );
  const suppliers = { s1: `Supplier one ${tag}`, s2: `Supplier two ${tag}` };
  const supplierIds = {
    s1: await insertId(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2)`, [tenantId, suppliers.s1]),
    s2: await insertId(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2)`, [tenantId, suppliers.s2]),
  };
  const refs: Record<string, string> = {};
  for (const [i, line] of LINES.entries()) {
    const number = i + 1;
    const supplierId = line.supplier ? supplierIds[line.supplier] : null;
    const itemId = line.nature === 'opex'
      ? await insertId(runner,
        `INSERT INTO spend_items (tenant_id, nature, item_number, product_name, currency, effective_start, status, supplier_id)
         VALUES ($1, 'opex', $2, $3, $4, '2020-01-01', 'enabled', $5)`,
        [tenantId, number, `Line ${line.label}`, line.currency, supplierId])
      : await insertId(runner,
        `INSERT INTO spend_items (tenant_id, nature, item_number, legacy_number, product_name, currency, effective_start, status, supplier_id)
         VALUES ($1, 'capex', $2::int + ${CAPEX_NUMBER_OFFSET}, 'CPX-' || $2::int, $3, $4, '2020-01-01', 'enabled', $5)`,
        [tenantId, number, `Line ${line.label}`, line.currency, supplierId]);
    refs[line.label] = `BL-${line.nature === 'opex' ? number : number + CAPEX_NUMBER_OFFSET}`;
    const versionId = await insertId(runner,
      `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year, allocation_method)
       VALUES ($1, $2, 'Y' || $4::int, $3::date, $4::int, 'default')`,
      [tenantId, itemId, `${Y}-01-01`, Y]);
    await runner.query(
      `INSERT INTO spend_amounts (tenant_id, version_id, period, planned, committed) VALUES ($1, $2, make_date($3, 1, 1), $4::numeric, $5::numeric)`,
      [tenantId, versionId, Y, line.amounts[0], line.amounts[1]],
    );
    for (const [measure, fte] of [['planned', line.fte?.[0]], ['committed', line.fte?.[1]]] as Array<[string, number | null | undefined]>) {
      if (fte == null) continue;
      await runner.query(
        `INSERT INTO spend_round_inputs (tenant_id, version_id, measure, period_start, period_end, method, fte)
         VALUES ($1, $2, $3, make_date($4, 1, 1), make_date($4, 12, 31), 'computed', $5::numeric)`,
        [tenantId, versionId, measure, Y, fte],
      );
    }
  }
  return { tenantId, userId, suppliers, refs };
}

function context(runner: QueryRunner, seed: Seed) {
  return { tenantId: seed.tenantId, userId: seed.userId, isPlatformHost: false, surface: 'mcp' as const, authMethod: 'api_key' as const, manager: runner.manager };
}

const round2 = (value: number | null) => (value == null ? null : Math.round(value * 100) / 100);
const BUDGET = { year: Y, metric: 'budget' as MetricKey };
const REVISION = { year: Y, metric: 'revision' as MetricKey };

/** The report's rows and totals: its own request sent to its route, read by its own reader. */
async function report(harness: Harness, runner: QueryRunner, mode: DeltaMode, measure: ReportMeasure, topCount = 10) {
  const [request] = deltaRequests({
    scope: 'all', source: BUDGET, destination: REVISION, modes: [mode], topCount, excludedIds: [], excludedAccounts: [], filters: {}, measure,
  });
  const result = await harness.budgetLines.summaryAggregateRequest(request, { manager: runner.manager });
  return readDelta([mode], [result], measure);
}

/** The report's rows as the AI names them: the reference, the title and the figures. */
function reportRows(rows: Array<{ itemNumber?: number; name: string; previous: number | null; current: number | null; delta: number; pct_increase: number | null }>) {
  return rows.map((row) => [`BL-${row.itemNumber}`, row.name, row.previous, row.current, row.delta, round2(row.pct_increase)]);
}
const aiRows = (groups: any[]) => groups.map((group) => [group.key, group.title, group.previous, group.current, group.delta, group.pct_increase]);

async function testTopIncreasesAsTheReport(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed);
  const ai = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'line', metric: 'y_review_minus_y_budget' });
  const expected = await report(harness, runner, 'increase', 'amount');
  assert.equal(ai.function, 'delta', 'a change computed by the server');
  assert.equal(ai.direction, 'increase', 'increases by default');
  assert.equal(ai.limit, 10, 'the report\'s top 10 by default');
  assert.equal(expected.processed.length, 10, 'the report keeps 10 lines');
  assert.deepEqual(aiRows(ai.groups), reportRows(expected.processed), 'the report\'s lines, order and figures');
  assert.deepEqual(ai.groups.slice(0, 3).map((group: any) => group.key), [seed.refs.echo, seed.refs.charlie, seed.refs.alpha], 'largest change first');
  assert.ok(ai.groups.every((group: any) => /^BL-\d+$/.test(group.key) && !('id' in group)), 'lines named by reference, never by id');
  assert.ok(ai.groups.some((group: any) => group.key === seed.refs.delta), 'both natures');
  assert.equal(ai.group_count, 12, 'twelve lines rise');
  assert.equal(ai.truncated, true, 'two past the top');
  assert.deepEqual(
    [ai.overall.net, ai.overall.gross_increase, ai.overall.gross_decrease],
    [expected.allTotals.net, expected.allTotals.grossIncrease, expected.allTotals.grossDecrease],
    'the totals over every line, as the report',
  );
  // Over every line with a rate: the falls positive in gross_decrease (1,000 + 50), the net their difference.
  assert.equal(ai.overall.gross_decrease, 1050, 'the falls, as a positive figure');
  assert.equal(Math.round(ai.overall.net * 100), Math.round((ai.overall.gross_increase - 1050) * 100), 'net = increases - decreases');
  assert.equal(ai.overall.count, LINES.length, 'every line');
  // The USD line converted at the rate of Y: 400 → 500, 600 → 750.
  const foxtrot = ai.groups.find((group: any) => group.key === seed.refs.foxtrot);
  assert.deepEqual([foxtrot.previous, foxtrot.current, foxtrot.delta, foxtrot.pct_increase], [500, 750, 250, 50], 'the USD line in EUR');
  assert.equal(ai.amounts_currency, 'EUR', 'the amounts name their currency');
  assert.deepEqual(ai.amounts_fx_missing.map((pair: any) => [pair.currency, pair.year, pair.lines]), [['GBP', Y, 1]], 'the GBP line left out and named');
  assert.equal(ai.groups.some((group: any) => group.key === seed.refs.oscar), false, 'the line without a rate is in no change');
  // A source of 0: no percentage.
  const echo = ai.groups.find((group: any) => group.key === seed.refs.echo);
  assert.deepEqual([echo.previous, echo.current, echo.delta, echo.pct_increase], [0, 800, 800, null], 'pct_increase null when the source is 0');
  console.log('ok - the top 10 increases equal the report');
}

async function testDecreasesLimitAndSupplier(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed);
  const falls = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'line', metric: 'y_review_minus_y_budget', direction: 'decrease' });
  const expected = await report(harness, runner, 'decrease', 'amount');
  assert.equal(falls.direction, 'decrease');
  assert.deepEqual(aiRows(falls.groups), reportRows(expected.processed), 'the report\'s decreases');
  assert.deepEqual(falls.groups.map((group: any) => [group.key, group.delta]), [[seed.refs.mike, -1000], [seed.refs.november, -50]], 'largest fall first');

  const three = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'line', metric: 'y_review_minus_y_budget', limit: 3 });
  assert.deepEqual(aiRows(three.groups), reportRows((await report(harness, runner, 'increase', 'amount', 3)).processed), 'a top 3, as the report');
  assert.equal(three.limit, 3);

  // By supplier: the changes of its lines added up, in EUR; the groups that rise only.
  const bySupplier = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'supplier', metric: 'y_review_minus_y_budget' });
  const sums = new Map<string | null, [number, number]>();
  for (const line of LINES) {
    if (line.currency === 'GBP') continue;
    const rate = line.currency === 'USD' ? USD_RATE : 1;
    const key = line.supplier ? seed.suppliers[line.supplier] : null;
    const [previous, current] = sums.get(key) ?? [0, 0];
    sums.set(key, [previous + line.amounts[0] * rate, current + line.amounts[1] * rate]);
  }
  const expectedSuppliers = [...sums.entries()]
    .map(([key, [previous, current]]) => [key, previous, current, current - previous, round2(((current - previous) / previous) * 100)])
    .filter((row) => (row[3] as number) > 0)
    .sort((a, b) => (b[3] as number) - (a[3] as number));
  assert.deepEqual(
    bySupplier.groups.map((group: any) => [group.key, group.previous, group.current, group.delta, group.pct_increase]),
    expectedSuppliers,
    'each supplier: the sum of its lines, largest change first',
  );
  assert.ok(bySupplier.groups.some((group: any) => group.key === null), 'the lines without a supplier are a group');
  assert.equal(bySupplier.groups.every((group: any) => group.title === undefined), true, 'a title for lines only');
  console.log('ok - decreases, a shorter top and the suppliers');
}

async function testFteChange(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed);
  const rises = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'line', metric: 'y_review_fte_minus_y_budget_fte' });
  const expected = await report(harness, runner, 'increase', 'fte');
  assert.deepEqual(aiRows(rises.groups), reportRows(expected.processed), 'the FTE change, as the report');
  assert.deepEqual(rises.groups.map((group: any) => [group.key, group.previous, group.current, group.delta, group.pct_increase]), [
    [seed.refs.delta, null, 1, 1, null],
    [seed.refs.charlie, 0.5, 1.25, 0.75, 150],
    [seed.refs.alpha, 1, 1.5, 0.5, 50],
  ], 'a side without FTE is null and counts 0 in the change');
  assert.deepEqual(
    [rises.overall.net, rises.overall.gross_increase, rises.overall.gross_decrease],
    [expected.allTotals.net, expected.allTotals.grossIncrease, expected.allTotals.grossDecrease],
    'the FTE totals, as the report',
  );
  assert.deepEqual([rises.overall.gross_increase, rises.overall.gross_decrease, rises.overall.net], [2.25, 1.5, 0.75], 'rises 2.25, falls 1.5');
  assert.equal(rises.amounts_currency, undefined, 'FTE have no currency');
  assert.equal(rises.amounts_fx_missing, undefined, 'nor missing rates');
  const falls = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'line', metric: 'y_review_fte_minus_y_budget_fte', direction: 'decrease' });
  assert.deepEqual(aiRows(falls.groups), reportRows((await report(harness, runner, 'decrease', 'fte')).processed), 'the FTE decreases');
  console.log('ok - the FTE change equals the report');
}

async function testLineGroupAndRefusals(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed);
  // group_by line on a plain metric: one group per line, named by reference and title.
  const sums = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'line', metric: 'y_budget', function: 'sum', limit: 2 });
  assert.deepEqual(sums.groups.map((group: any) => [group.key, group.title, group.value]), [
    [seed.refs.mike, 'Line mike', 5000],
    [seed.refs.delta, 'Line delta', 3000],
  ], 'the largest lines, by reference and title');
  // BL-9: no other reference holds it.
  const counted = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'line', q: seed.refs.india });
  assert.deepEqual(counted.groups.map((group: any) => [group.key, group.title, group.count]), [[seed.refs.india, 'Line india', 1]], 'q finds a line by its reference');

  const refused = async (input: Record<string, unknown>, pattern: RegExp, label: string) => {
    await assert.rejects(harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'supplier', ...input }), (error: any) => {
      assert.match(error.message, pattern, label);
      return true;
    });
  };
  await refused({ metrics: ['y_budget', 'y_review_minus_y_budget'], function: 'sum' }, /y_review_minus_y_budget is a change between two columns .* does not take metrics/, 'a change among metrics');
  await refused({ metric: 'y_review_minus_y_budget', then_by: 'nature' }, /does not take then_by.*filter on one value of the first and group by the second/, 'a change with then_by');
  await refused({ metric: 'y_budget', function: 'sum', direction: 'decrease' }, /direction applies to a change between two columns/, 'direction without a change');
  await refused({ group_by: 'line', then_by: 'supplier' }, /A line has one value of every other field/, 'a line crossed');
  await refused({ metric: 'y_budget_minus_y_budget', function: 'sum' }, /Unsupported metric field/, 'a column minus itself is no metric');
  console.log('ok - group_by line and the refusals');
}

async function run() {
  const harness = await createHarness();
  const runner = harness.dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const s = await seed(runner);
    await testTopIncreasesAsTheReport(harness, runner, s);
    await testDecreasesLimitAndSupplier(harness, runner, s);
    await testFteChange(harness, runner, s);
    await testLineGroupAndRefusals(harness, runner, s);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await harness.app.close();
  }
  console.log('ai-budget-delta.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
