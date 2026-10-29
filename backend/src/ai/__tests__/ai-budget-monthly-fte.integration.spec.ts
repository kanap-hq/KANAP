import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { computeColumn, type CostLine } from '../../spend/costing.util';
import { linesCalculation, linesResult } from '../../spend/round-inputs.util';
import { readStaffing, staffingRequest, type StaffingGroup } from '../../spend/reports/shared/reportAggregates';
import { CAPEX_NUMBER_OFFSET } from '../../spend/__tests__/round-inputs.fixtures';

// The FTE month by month in Plaid and the MCP server (lot L8 C of the Plaid pass), against the
// database, every figure compared with the "Staffing by month" report's own request and reader
// (`staffingRequest`, `readStaffing`, the server copy of the screen's code) sent to the report's
// route on the same lines (all active, both natures):
// - by cost center: the report's groups, order, months, average (sum ÷ 12) and peak, rounded to 2
//   decimals; a month no line details is null, not 0; the groups without any month left out;
// - the FTE declared without monthly detail and the FTE whose amount no longer follows its lines,
//   the report's two notices, in overall with the note;
// - a line priced per piece counts no FTE; by line (reference and title), a shorter list (`limit`);
// - the refusals in words (metrics, then_by).
// @database-spec: boots the application context, so run-ci-tests.js runs this file in a database lane.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-budget-monthly-fte-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const Y = new Date().getFullYear();
const CALENDARS = new Map();

type Harness = { app: any; dataSource: DataSource; aggregates: any; budgetLines: any };

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-budget-monthly-fte.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiAggregateExecutor } = require('../query/ai-aggregate.executor');
  const { BudgetLinesService } = require('../../spend/budget-lines.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  return { app, dataSource: app.get(DataSource), aggregates: app.get(AiAggregateExecutor), budgetLines: app.get(BudgetLinesService) };
}

/** A people line priced per month (no calendar), or a pieces line, over months `from` to `to` of Y. */
function costLine(unit: 'people' | 'pieces', quantity: string, from = 1, to = 12): CostLine {
  const last = new Date(Date.UTC(Y, to, 0)).getUTCDate();
  return {
    label: `${quantity} ${unit}`,
    quantity_unit: unit,
    quantity,
    unit_price: unit === 'people' ? '3000' : '100',
    price_basis: unit === 'people' ? 'per_month' : 'per_piece',
    frequency: 'per_month',
    days_per_month: null,
    period_start: `${Y}-${String(from).padStart(2, '0')}-01`,
    period_end: `${Y}-${String(to).padStart(2, '0')}-${last}`,
    working_day_profile_id: null,
  };
}

type Round = { method: 'computed' | 'copied'; fte: string; calc: object; total: string };
function computed(lines: CostLine[]): Round {
  const result = computeColumn(lines, Y, CALENDARS);
  const calc = linesCalculation(lines, CALENDARS, result);
  return { method: 'computed', fte: result.fte, calc, total: calc.total };
}
/** A copy without line detail: an FTE and no month. */
const NO_DETAIL: Round = {
  method: 'copied',
  fte: '1.75',
  calc: { kind: 'copy', source_year: Y - 1, source_measure: 'planned', uplift_pct: '0', source_total: '1000', total: '1000', source_method: 'spread' },
  total: '1000',
};
/** A copy that keeps the result of its lines: months from the lines, an amount that no longer follows them. */
function copiedWithLines(lines: CostLine[]): Round {
  const result = computeColumn(lines, Y, CALENDARS);
  return { ...NO_DETAIL, fte: result.fte, calc: { ...NO_DETAIL.calc, lines_result: linesResult(lines, CALENDARS, result) } };
}

type CostCenter = 'ops' | 'apps' | 'pieces' | 'copied';
type Line = { label: string; nature: 'opex' | 'capex'; costCenter: CostCenter | null; round: Round | null };

/**
 * - Ops: 2 people all year, 1 person from July with a pieces line (months 2 then 3: average 2.5, peak 3);
 * - Apps (CAPEX): 3 people January to March (average 0.75, peak 3);
 * - Pieces: pieces only (twelve months of 0);
 * - Copied: a copy without line detail (FTE 1.75, no month: left out, in the notice);
 * - no cost center: a copy that keeps its lines, 1 person all year (the other notice), and a line without FTE.
 */
const LINES: Line[] = [
  { label: 'ops team', nature: 'opex', costCenter: 'ops', round: computed([costLine('people', '2')]) },
  { label: 'ops summer', nature: 'opex', costCenter: 'ops', round: computed([costLine('people', '1', 7, 12), costLine('pieces', '4')]) },
  { label: 'apps sprint', nature: 'capex', costCenter: 'apps', round: computed([costLine('people', '3', 1, 3)]) },
  { label: 'pieces only', nature: 'opex', costCenter: 'pieces', round: computed([costLine('pieces', '10')]) },
  { label: 'copied', nature: 'opex', costCenter: 'copied', round: NO_DETAIL },
  { label: 'detached', nature: 'opex', costCenter: null, round: copiedWithLines([costLine('people', '1')]) },
  { label: 'licences', nature: 'opex', costCenter: null, round: null },
];

type Seed = { tenantId: string; userId: string; costCenters: Record<CostCenter, string>; refs: Record<string, string> };

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR"}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ai-monthly-${tag}`, `AI monthly FTE ${tag}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const roleId = await insertId(runner,
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in) VALUES ($1, 'Administrator', 'monthly spec', false, false)`, [tenantId]);
  const userId = randomUUID();
  await runner.query(
    `INSERT INTO users (id, tenant_id, first_name, last_name, email, role_id, mfa_enabled, status, data_access_mode)
     VALUES ($1, $2, 'Monthly', 'Spec', $3, $4, false, 'enabled', 'all')`,
    [userId, tenantId, `monthly-${tag}@example.test`, roleId],
  );
  const companyId = await insertId(runner,
    `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES ($1, $2, 'FR', 'Lyon', 'enabled')`, [tenantId, `Company ${tag}`]);
  const costCenterIds = {} as Record<CostCenter, string>;
  const costCenters = {} as Record<CostCenter, string>;
  for (const [i, name] of (['ops', 'apps', 'pieces', 'copied'] as CostCenter[]).entries()) {
    const code = `CC${i + 1}`;
    costCenterIds[name] = await insertId(runner,
      `INSERT INTO cost_centers (tenant_id, code, kind, name, company_id) VALUES ($1, $2, 'cost_center', $3, $4)`,
      [tenantId, code, `Center ${name}`, companyId]);
    costCenters[name] = `${code} · Center ${name}`;
  }
  const refs: Record<string, string> = {};
  for (const [i, line] of LINES.entries()) {
    const number = i + 1;
    const costCenterId = line.costCenter ? costCenterIds[line.costCenter] : null;
    const itemId = line.nature === 'opex'
      ? await insertId(runner,
        `INSERT INTO spend_items (tenant_id, nature, item_number, product_name, currency, effective_start, status, cost_center_id)
         VALUES ($1, 'opex', $2, $3, 'EUR', '2020-01-01', 'enabled', $4)`,
        [tenantId, number, `Line ${line.label}`, costCenterId])
      : await insertId(runner,
        `INSERT INTO spend_items (tenant_id, nature, item_number, legacy_number, product_name, currency, effective_start, status, cost_center_id)
         VALUES ($1, 'capex', $2::int + ${CAPEX_NUMBER_OFFSET}, 'CPX-' || $2::int, $3, 'EUR', '2020-01-01', 'enabled', $4)`,
        [tenantId, number, `Line ${line.label}`, costCenterId]);
    refs[line.label] = `BL-${line.nature === 'opex' ? number : number + CAPEX_NUMBER_OFFSET}`;
    const versionId = await insertId(runner,
      `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year, allocation_method)
       VALUES ($1, $2, 'Y' || $4::int, $3::date, $4::int, 'default')`,
      [tenantId, itemId, `${Y}-01-01`, Y]);
    await runner.query(
      `INSERT INTO spend_amounts (tenant_id, version_id, period, planned) VALUES ($1, $2, make_date($3, 1, 1), $4::numeric)`,
      [tenantId, versionId, Y, line.round?.total ?? 500],
    );
    if (!line.round) continue;
    await runner.query(
      `INSERT INTO spend_round_inputs (tenant_id, version_id, measure, period_start, period_end, method, fte, last_calculation)
       VALUES ($1, $2, 'planned', make_date($3, 1, 1), make_date($3, 12, 31), $4, $5::numeric, $6::jsonb)`,
      [tenantId, versionId, Y, line.round.method, line.round.fte, JSON.stringify(line.round.calc)],
    );
  }
  return { tenantId, userId, costCenters, refs };
}

function context(runner: QueryRunner, seed: Seed) {
  return { tenantId: seed.tenantId, userId: seed.userId, isPlatformHost: false, surface: 'mcp' as const, authMethod: 'api_key' as const, manager: runner.manager };
}

const round2 = (value: number | null) => (value == null ? null : Math.round(value * 100) / 100);
const months = (values: Array<number | null>) => values.map(round2);
const NONE = '(none)';

/** The report's rows, total and notices: its own request sent to its route, read by its own reader. */
async function report(harness: Harness, runner: QueryRunner, group: StaffingGroup) {
  const request = staffingRequest({ scope: 'all', year: Y, metric: 'budget', group, filters: {} });
  const result = await harness.budgetLines.summaryAggregateRequest(request, { manager: runner.manager });
  return readStaffing(result, { none: NONE, unnamed: '(unnamed)' }, (a, b) => a.localeCompare(b));
}

async function testByCostCenterAsTheReport(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed);
  const ai = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'cost_center', metric: 'y_budget_fte_by_month' });
  const expected = await report(harness, runner, { kind: 'costCenter' });
  assert.equal(ai.function, 'by_month', 'computed by the server');
  assert.deepEqual(
    ai.groups.map((group: any) => [group.key ?? NONE, group.months, group.average, group.peak]),
    expected.rows.map((row) => [row.label, months(row.months), round2(row.average), round2(row.peak)]),
    'the report\'s groups, order, months, average and peak',
  );
  const byKey = new Map(ai.groups.map((group: any) => [group.key, group]));
  const ops: any = byKey.get(seed.costCenters.ops);
  assert.deepEqual(ops.months, [2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3], 'two people, a third from July; the pieces count nothing');
  assert.deepEqual([ops.average, ops.peak], [2.5, 3], 'the average is the sum ÷ 12, the peak the highest month');
  const apps: any = byKey.get(seed.costCenters.apps);
  assert.deepEqual([apps.average, apps.peak, apps.months.slice(0, 4)], [0.75, 3, [3, 3, 3, 0]], 'three months of 3: the average over the year (9 ÷ 12)');
  assert.deepEqual((byKey.get(seed.costCenters.pieces) as any).months, Array(12).fill(0), 'a pieces line counts no FTE');
  assert.equal(byKey.has(seed.costCenters.copied), false, 'no month: the group is left out');
  assert.ok(byKey.has(null), 'the lines without a cost center are a group');
  assert.deepEqual(ai.groups.map((group: any) => group.key).slice(0, 2), [seed.costCenters.ops, null], 'largest average first');

  assert.deepEqual([ai.overall.months, ai.overall.average, ai.overall.peak], [months(expected.total.months), round2(expected.total.average), round2(expected.total.peak)], 'overall, as the report\'s total row');
  assert.deepEqual(ai.overall.months, [6, 6, 6, 3, 3, 3, 4, 4, 4, 4, 4, 4], 'every line together');
  assert.equal(ai.overall.fte_without_monthly_detail, expected.noDetail?.fte, 'the FTE without monthly detail, as the report\'s notice');
  assert.equal(ai.overall.fte_without_monthly_detail, 1.75);
  assert.equal(ai.overall.fte_amount_not_following_lines, expected.detached?.fte, 'the FTE whose amount no longer follows its lines, as the report\'s notice');
  assert.equal(ai.overall.fte_amount_not_following_lines, 1);
  assert.match(ai.monthly_fte_note, /a null month is one no line of the group details, which is not 0/);
  assert.match(ai.monthly_fte_note, /fte_without_monthly_detail/);
  assert.equal(ai.overall.count, LINES.length, 'every line');
  assert.equal(ai.amounts_currency, undefined, 'FTE have no currency');
  console.log('ok - the FTE by month by cost center equal the report');
}

async function testNullMonthsLinesAndLimit(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed);
  // Only the copy without detail: no month anywhere, every month null (not 0), its FTE in the notice.
  const copied = await harness.aggregates.execute(ctx, {
    entity_type: 'budget_lines', group_by: 'cost_center', metric: 'y_budget_fte_by_month', filters: { cost_center: [seed.costCenters.copied] },
  });
  assert.deepEqual(copied.groups, [], 'no group without a month');
  assert.deepEqual([copied.overall.months, copied.overall.average, copied.overall.peak], [Array(12).fill(null), null, null], 'every month null');
  assert.equal(copied.overall.fte_without_monthly_detail, 1.75, 'said in the notice');

  // By line: the report's item rows, by reference and title.
  const lines = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'line', metric: 'y_budget_fte_by_month' });
  const expected = await report(harness, runner, { kind: 'item' });
  assert.deepEqual(
    lines.groups.map((group: any) => [group.key, group.title, group.months, group.average, group.peak]),
    expected.rows.map((row) => [row.key, row.label, months(row.months), round2(row.average), round2(row.peak)]),
    'the report\'s lines',
  );
  assert.deepEqual(lines.groups.slice(0, 2).map((group: any) => [group.key, group.title]), [[seed.refs['ops team'], 'Line ops team'], [seed.refs.detached, 'Line detached']]);
  assert.ok(lines.groups.some((group: any) => group.key === seed.refs['apps sprint']), 'both natures');
  assert.ok(lines.groups.every((group: any) => /^BL-\d+$/.test(group.key)), 'by reference, never by id');

  const top = await harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'line', metric: 'y_budget_fte_by_month', limit: 2 });
  assert.deepEqual(top.groups, lines.groups.slice(0, 2), 'the largest averages');
  assert.deepEqual([top.limit, top.group_count, top.truncated], [2, lines.groups.length, true]);
  assert.deepEqual(top.overall, lines.overall, 'overall over every line');
  console.log('ok - null months, lines and a limit');
}

async function testRefusals(harness: Harness, runner: QueryRunner, seed: Seed) {
  const ctx = context(runner, seed);
  const refused = async (input: Record<string, unknown>, pattern: RegExp, label: string) => {
    await assert.rejects(harness.aggregates.execute(ctx, { entity_type: 'budget_lines', group_by: 'supplier', ...input }), (error: any) => {
      assert.match(error.message, pattern, label);
      return true;
    });
  };
  await refused({ metrics: ['y_budget_fte', 'y_budget_fte_by_month'], function: 'sum' }, /y_budget_fte_by_month is the FTE month by month .* does not take metrics/, 'among metrics');
  await refused({ metric: 'y_budget_fte_by_month', then_by: 'nature' }, /does not take then_by.*filter on one value of the first and group by the second/, 'with then_by');
  await refused({ metric: 'y_budget_fte_by_month', direction: 'increase' }, /direction applies to a change between two columns/, 'with direction');
  console.log('ok - the refusals');
}

async function run() {
  const harness = await createHarness();
  const runner = harness.dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const s = await seed(runner);
    await testByCostCenterAsTheReport(harness, runner, s);
    await testNullMonthsLinesAndLimit(harness, runner, s);
    await testRefusals(harness, runner, s);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await harness.app.close();
  }
  console.log('ai-budget-monthly-fte.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
