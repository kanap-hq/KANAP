import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { AiExecutionContextWithManager } from '../ai.types';
import { AiAggregateExecutor } from '../query/ai-aggregate.executor';
import { AiQueryExecutor } from '../query/ai-query.executor';
import { adaptFilters } from '../query/ai-filter.adapter';
import { describeAiEntityFilters } from '../query/ai-filter-description.util';
import { getAiEntityRegistry } from '../query/registries';
import { budgetLineTotalFields } from '../query/registries/budget-amount-fields';
import { SpendItemsService, CapexItemsService } from '../../spend/spend-items.service';
import { ItemNumberService } from '../../common/item-number.service';
import { SUMMARY_SCOPES } from '../../spend/spend-summary.builder';
import * as engine from '../../spend/budget-list/budget-list.service';
import { computeColumn, type CostLine } from '../../spend/costing.util';
import { linesCalculation, linesResult } from '../../spend/round-inputs.util';
import {
  costPerFteRequests,
  dailyRateRequests,
  readCostPerFte,
  readDailyRate,
  type AggregateRequest,
  type ColumnFilters,
} from '../../spend/reports/shared/reportAggregates';
import { CAPEX_NUMBER_OFFSET, inRolledBackTransaction, Kind, runSpecs } from '../../spend/__tests__/round-inputs.fixtures';
import { realAllocationCalculator, realSummaryDeps } from '../../spend/__tests__/oracle/oracle-deps';
import { budgetReadService } from '../../spend/__tests__/budget-lines.fixtures';
import { PgClient, roleExists, seedNodes, seedPerson, seedRole } from '../../data-access/__tests__/data-access-test-helpers';

// Staff cost, cost per FTE and day rate in the AI layer (lot L2 of the Plaid and MCP pass), against
// the database, on OPEX and CAPEX, every figure compared with the "Cost per FTE" report's own
// requests and readers (`spend/reports/shared/reportAggregates.ts`) run on the same lines:
// - the registries list the staff cost, staff FTE, day cost and days of every year and column
//   (`y_budget_staff_cost`...), described once per family, and the two ratio metrics;
// - aggregate_entities by supplier: the FTE, staff cost, cost per FTE, days, day cost and day rate
//   of each supplier and overall equal the report's, without and with a filter; the report's
//   notices (FTE without line detail, staff cost priced per month); a sum of a staff field;
// - a line in a currency without a rate: its cost left out as in the report, named in
//   amounts_fx_missing;
// - query_entities: the staff totals of every line kept and of the page, a filter and a sort;
// - a person limited to one company adds up the lines of that company only.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file in a database lane.

const Y = new Date().getFullYear();
const KINDS: Kind[] = ['opex', 'capex'];
const ENTITY: Record<Kind, 'budget_lines'> = { opex: 'budget_lines', capex: 'budget_lines' };

const CALENDAR_ID = '66666666-6666-4666-8666-666666666666';
/** A calendar of 20 working days in every month. */
const CALENDARS = new Map([[CALENDAR_ID, { name: 'Twenty', code: 'T20', days: Array(12).fill('20') }]]);

function costLine(quantity_unit: CostLine['quantity_unit'], price_basis: CostLine['price_basis'], quantity: string, unit_price: string, days_per_month: string | null = null): CostLine {
  return {
    label: `${quantity} ${quantity_unit} ${price_basis}`,
    quantity_unit,
    quantity,
    unit_price,
    price_basis,
    frequency: quantity_unit === 'days' ? 'once' : 'per_month',
    days_per_month,
    period_start: `${Y}-01-01`,
    period_end: `${Y}-12-31`,
    working_day_profile_id: price_basis === 'per_day' ? CALENDAR_ID : null,
  };
}

/** A Budget Y round computed from `lines` by the real costing, or a copy without line detail. */
type Round = { method: 'computed' | 'copied'; fte: string; calc: object; total: string };
function computed(lines: CostLine[]): Round {
  const result = computeColumn(lines, Y, CALENDARS);
  const calc = linesCalculation(lines, CALENDARS, result);
  return { method: 'computed', fte: result.fte, calc, total: calc.total };
}
const NO_DETAIL: Round = {
  method: 'copied',
  fte: '1.75',
  calc: { kind: 'copy', source_year: Y - 1, source_measure: 'planned', uplift_pct: '0', source_total: '1000', total: '1000', source_method: 'spread' },
  total: '1000',
};
/** A copy that keeps the result of `lines` (`lines_result`): its amount no longer follows them. */
function copiedWithLines(lines: CostLine[]): Round {
  const result = computeColumn(lines, Y, CALENDARS);
  return { ...NO_DETAIL, fte: result.fte, calc: { ...NO_DETAIL.calc, lines_result: linesResult(lines, CALENDARS, result) } };
}

const FULL_TIME = costLine('people', 'per_day', '2', '500');
const BUNDLE = costLine('days', 'per_day', '40', '500');
const PER_MONTH = costLine('people', 'per_month', '1', '3000');
const PART_TIME = costLine('people', 'per_day', '1', '500', '5');
const PIECES = costLine('pieces', 'per_piece', '1', '100');
const USD_DAY = costLine('people', 'per_day', '1', '500.5');

type Line = { label: string; supplier: 'Alpha' | 'Bravo' | 'Charlie' | null; company: 'fr' | 'es' | null; currency?: string; round: Round };

/**
 * The lines of both natures (fromage-like: contractors per supplier, a supplier paid in USD
 * without a rate, lines without a supplier):
 * - Alpha: 2 people full time at 500 a day and a piece (FR), a 40-day bundle (ES);
 * - Bravo: 1 person at 3,000 a month (FR: staff cost without days), 1 person 5 days a month (ES);
 * - Charlie (USD, no rate for Y): 1 person full time at 500.50 a day (FR);
 * - no supplier: pieces only (FR), a copy without line detail, FTE 1.75 (no company).
 */
const LINES: Line[] = [
  { label: 'alpha full time', supplier: 'Alpha', company: 'fr', round: computed([FULL_TIME, PIECES]) },
  { label: 'alpha bundle', supplier: 'Alpha', company: 'es', round: computed([BUNDLE]) },
  { label: 'bravo per month', supplier: 'Bravo', company: 'fr', round: computed([PER_MONTH]) },
  { label: 'bravo part time', supplier: 'Bravo', company: 'es', round: computed([PART_TIME]) },
  { label: 'charlie usd', supplier: 'Charlie', company: 'fr', currency: 'USD', round: computed([USD_DAY]) },
  { label: 'pieces only', supplier: null, company: 'fr', round: computed([PIECES]) },
  { label: 'no detail', supplier: null, company: null, round: NO_DETAIL },
];

type Seed = { tenantId: string; suppliers: Record<string, string>; companies: Record<'fr' | 'es', { id: string; name: string }>; ids: Record<string, string> };

async function seed(runner: QueryRunner, kind: Kind, lines: Line[] = LINES): Promise<Seed> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR"}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ai-staff-${kind}-${tag}`, `AI staff cost ${kind} ${tag}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const suppliers: Record<string, string> = {};
  for (const name of ['Alpha', 'Bravo', 'Charlie']) {
    suppliers[name] = (await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, `${name} ${tag}`]))[0].id;
  }
  const company = async (name: string) => ({
    id: (await runner.query(
      `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES ($1, $2, 'FR', 'Lyon', 'enabled') RETURNING id`,
      [tenantId, `${name} ${tag}`],
    ))[0].id as string,
    name: `${name} ${tag}`,
  });
  const companies = { fr: await company('Fromage France'), es: await company('Fromage Espana') };
  const ids: Record<string, string> = {};
  for (const [i, line] of lines.entries()) {
    const itemId = randomUUID();
    ids[line.label] = itemId;
    const supplierId = line.supplier ? suppliers[line.supplier] : null;
    const companyId = line.company ? companies[line.company].id : null;
    if (kind === 'opex') {
      await runner.query(
        `INSERT INTO spend_items (id, tenant_id, item_number, product_name, currency, effective_start, status, supplier_id, paying_company_id)
         VALUES ($1, $2, $3, $4, $5, '2020-01-01', 'enabled', $6, $7)`,
        [itemId, tenantId, i + 1, `Staff ${line.label}`, line.currency ?? 'EUR', supplierId, companyId],
      );
    } else {
      await runner.query(
        `INSERT INTO spend_items (id, tenant_id, nature, item_number, legacy_number, product_name, currency, effective_start, supplier_id, paying_company_id)
         VALUES ($1, $2, 'capex', $3::int + ${CAPEX_NUMBER_OFFSET}, 'CPX-' || $3::int, $4, $5, '2020-01-01', $6, $7)`,
        [itemId, tenantId, i + 1, `Staff ${line.label}`, line.currency ?? 'EUR', supplierId, companyId],
      );
    }
    const versionId = randomUUID();
    await runner.query(
      `INSERT INTO spend_versions (id, tenant_id, spend_item_id, version_name, as_of_date, budget_year, allocation_method)
       VALUES ($1, $2, $3, 'Y' || $5::int, $4::date, $5::int, 'default')`,
      [versionId, tenantId, itemId, `${Y}-01-01`, Y],
    );
    await runner.query(
      `INSERT INTO spend_amounts (tenant_id, version_id, period, planned) VALUES ($1, $2, make_date($3, 1, 1), $4::numeric)`,
      [tenantId, versionId, Y, line.round.total],
    );
    await runner.query(
      `INSERT INTO spend_round_inputs (tenant_id, version_id, measure, period_start, period_end, method, fte, last_calculation)
       VALUES ($1, $2, 'planned', make_date($3, 1, 1), make_date($3, 12, 31), $4, $5::numeric, $6::jsonb)`,
      [tenantId, versionId, Y, line.round.method, line.round.fte, JSON.stringify(line.round.calc)],
    );
  }
  return { tenantId, suppliers, companies, ids };
}

/** The item service of a nature with the real exchange rates (a currency without a rate is left out). */
function itemService(kind: Kind): any {
  const deps = realSummaryDeps({ scope: kind });
  const args: any[] = Array.from({ length: 11 }, () => undefined);
  args[4] = deps.allocationCalculator;
  args[6] = deps.fxRates;
  args[10] = new ItemNumberService();
  return kind === 'opex' ? new (SpendItemsService as any)(...args) : new (CapexItemsService as any)(...args);
}

// Constructor positions: budgetLines 1; the query executor's allocation calculator 22, policy 23.
function queryExecutor(): AiQueryExecutor {
  const args: any[] = Array.from({ length: 25 }, () => ({}));
  args[1] = budgetReadService();
  args[6] = { listContractsForSpendItem: async () => ({ items: [] }), listContractsForCapexItem: async () => ({ items: [] }) };
  args[22] = realAllocationCalculator();
  args[23] = { canReadEntityType: async () => true, effectiveAccess: async () => ({ isAdmin: false, permissions: {} }) };
  return new (AiQueryExecutor as any)(...args);
}

function aggregateExecutor(): AiAggregateExecutor {
  const args: any[] = Array.from({ length: 23 }, () => ({}));
  args[1] = budgetReadService();
  args[21] = { canReadEntityType: async () => true, effectiveAccess: async () => ({ isAdmin: false, permissions: {} }) };
  return new (AiAggregateExecutor as any)(...args);
}

function context(runner: QueryRunner, tenantId: string, userId: string | null = null): AiExecutionContextWithManager {
  return { tenantId, userId, isPlatformHost: false, surface: 'mcp', authMethod: 'jwt', manager: runner.manager } as unknown as AiExecutionContextWithManager;
}

const round2 = (value: number | null) => (value == null ? null : Math.round(value * 100) / 100);
const LABELS = { none: 'none', unnamed: '(unnamed)' };
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The report's rows by supplier for Budget Y, read by its own functions on its own requests
 * (`/spend-items/summary/aggregate`, `/capex-items/…`, grouped by supplier id and name), as
 * `[name or none, fte, cost, cost per FTE, days, day cost, day rate]`, keyed by name, with the total row
 * and the notices.
 */
async function reportFigures(runner: QueryRunner, kind: Kind, filters: ColumnFilters) {
  const scope = SUMMARY_SCOPES[kind];
  const params = { scope: kind, columns: [{ year: Y, metric: 'budget' as const }], group: { kind: 'supplier' as const }, filters };
  const run = async (requests: AggregateRequest[]) => {
    const out = [];
    for (const request of requests) out.push(await engine.budgetListAggregate(scope, realSummaryDeps(scope), request.query, request.spec as any, runner.manager));
    return out as any[];
  };
  const fte = readCostPerFte(params.columns, await run(costPerFteRequests(params)), LABELS, byText);
  const rate = readDailyRate(params.columns, await run(dailyRateRequests(params)), LABELS, byText);
  const name = (row: { name: string | null }) => (row.name == null ? 'none' : row.name);
  return {
    costPerFte: new Map(fte.rows.map((row) => [name(row), [row.cells[0].fte, row.cells[0].cost, round2(row.cells[0].ratio)]])),
    dayRate: new Map(rate.rows.map((row) => [name(row), [row.cells[0].days, row.cells[0].cost, round2(row.cells[0].rate)]])),
    total: { fte: fte.total[0], rate: rate.total[0] },
    noDetail: fte.noDetail[0]?.fte ?? null,
    detached: fte.detached[0]?.fte ?? null,
    monthly: rate.monthly[0]?.amount ?? null,
  };
}

/** The AI aggregate's groups, keyed as the report's rows. */
function aiFigures(result: any) {
  const key = (group: any) => (group.key == null ? 'none' : group.key);
  return {
    costPerFte: new Map(result.groups.map((group: any) => [key(group), [group.staff_fte, group.staff_cost, group.cost_per_fte]])),
    dayRate: new Map(result.groups.filter((group: any) => group.days != null).map((group: any) => [key(group), [group.days, group.day_cost, group.day_rate]])),
  };
}

/** The AI's cost per FTE and day rate by supplier equal the report's, groups, totals and notices. */
async function compareWithReport(runner: QueryRunner, kind: Kind, tenantId: string, aiFilters: Record<string, any>, label: string) {
  const registry = getAiEntityRegistry(ENTITY[kind]);
  const report = await reportFigures(runner, kind, adaptFilters(registry, aiFilters).filters);
  const aggregate = aggregateExecutor();
  const ctx = context(runner, tenantId);
  const perFte: any = await aggregate.execute(ctx, { entity_type: ENTITY[kind], group_by: 'supplier', metric: 'y_budget_cost_per_fte', filters: aiFilters });
  const dayRate: any = await aggregate.execute(ctx, { entity_type: ENTITY[kind], group_by: 'supplier', metric: 'y_budget_day_rate', filters: aiFilters });

  assert.equal(perFte.function, 'ratio', `${kind} ${label}: a ratio`);
  assert.ok(report.costPerFte.size > 0, `${kind} ${label}: the report has rows`);
  assert.deepEqual(aiFigures(perFte).costPerFte, report.costPerFte, `${kind} ${label}: FTE, staff cost and cost per FTE per supplier, as the report`);
  assert.deepEqual([...aiFigures(perFte).costPerFte.keys()], [...report.costPerFte.keys()], `${kind} ${label}: the report's order (FTE, largest first)`);
  assert.deepEqual(aiFigures(dayRate).dayRate, report.dayRate, `${kind} ${label}: days, day cost and day rate per supplier, as the report`);
  assert.deepEqual(dayRate.groups.map((group: any) => group.key ?? 'none'), [...report.dayRate.keys()], `${kind} ${label}: the day rate keeps the report's rows and order`);
  assert.deepEqual(
    [perFte.overall.staff_fte, perFte.overall.staff_cost, perFte.overall.cost_per_fte, perFte.overall.value],
    [report.total.fte.fte, report.total.fte.cost, round2(report.total.fte.ratio), round2(report.total.fte.ratio)],
    `${kind} ${label}: overall, the ratio of the totals`,
  );
  assert.deepEqual(
    [dayRate.overall.days, dayRate.overall.day_cost, dayRate.overall.day_rate, dayRate.overall.value],
    [report.total.rate.days, report.total.rate.cost, round2(report.total.rate.rate), round2(report.total.rate.rate)],
    `${kind} ${label}: overall day rate`,
  );
  assert.equal(perFte.overall.fte_without_line_detail ?? null, report.noDetail, `${kind} ${label}: the FTE without line detail, as the report's notice`);
  assert.equal(perFte.overall.fte_amount_not_following_lines ?? null, report.detached, `${kind} ${label}: the FTE whose amount no longer follows its lines, as the report's notice`);
  assert.equal(dayRate.overall.staff_cost_not_in_day_rate ?? null, report.monthly, `${kind} ${label}: the staff cost priced per month, as the report's notice`);
  assert.equal(perFte.amounts_currency, 'EUR', `${kind} ${label}: the ratios name their currency`);
  assert.match(perFte.ratio_note, /never divide amounts by FTE/);
  return { perFte, dayRate, report };
}

async function testRegistryAndDescription() {
  for (const kind of KINDS) {
    const registry = getAiEntityRegistry(ENTITY[kind]);
    const lineTotals = budgetLineTotalFields();
    assert.equal(Object.keys(lineTotals).length, 100, 'four line totals for every year and column');
    for (const [key, field] of Object.entries(lineTotals)) {
      assert.deepEqual(registry.fields[key], field, `${kind}: ${key} in the registry`);
      assert.equal(registry.sortFields[key], field.grid, `${kind}: ${key} sorts`);
    }
    assert.deepEqual(
      [registry.fields.y_plus1_review_days.grid, registry.fields.y_budget_staff_cost.grid, registry.fields.y_minus2_landing_staff_fte.grid, registry.fields.y_actual_day_cost.grid],
      ['days_yPlus1Revision', 'staff_cost_yBudget', 'staff_fte_yMinus2Landing', 'day_cost_yFollowUp'],
      `${kind}: each key reads the engine's line total of its year and column`,
    );

    const description = describeAiEntityFilters(ENTITY[kind], registry);
    assert.deepEqual(description.field_families?.map((family) => [family.family, family.fields.length, family.sortable, family.aggregable]), [
      ['<year>_<column>_staff_cost', 25, true, true],
      ['<year>_<column>_staff_fte', 25, true, true],
      ['<year>_<column>_day_cost', 25, true, true],
      ['<year>_<column>_days', 25, true, true],
    ], `${kind}: one entry per family`);
    // The ratio metrics first; the change between two columns and the FTE by month follow (lot L8 C).
    assert.deepEqual(description.metric_families?.slice(0, 2).map((family) => [family.family, family.metrics?.length]), [
      ['<year>_<column>_cost_per_fte', 25],
      ['<year>_<column>_day_rate', 25],
    ], `${kind}: the ratio metrics`);
    assert.ok(description.metric_families![1].metrics!.includes('y_budget_day_rate'));
    assert.equal(description.fields.some((field) => field.field.endsWith('_staff_cost')), false, `${kind}: no family key listed one by one`);
    assert.equal(description.sort_fields.includes('y_budget_staff_cost'), false, `${kind}: the family keys are not repeated in sort_fields`);
    assert.ok(description.sort_fields.includes('y_budget_fte'), `${kind}: the other sort fields stay`);
    // The MCP answers at most 64,000 characters.
    assert.ok(JSON.stringify(description).length < 60_000, `${kind}: the description stays under the MCP limit (${JSON.stringify(description).length})`);
  }
  console.log('ok - registries and description');
}

async function testAggregateAsTheReport(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner, kind);
    const { perFte, dayRate, report } = await compareWithReport(runner, kind, s.tenantId, {}, 'every line');

    // The scenario itself, so that the comparison is not empty on both sides.
    const alpha = `Alpha ${s.tenantId.slice(0, 8)}`;
    const bravo = `Bravo ${s.tenantId.slice(0, 8)}`;
    const charlie = `Charlie ${s.tenantId.slice(0, 8)}`;
    assert.deepEqual(report.costPerFte.get(alpha), [2.17, 260000, 119815.67], `${kind}: Alpha, 2 people and a 40-day bundle`);
    assert.deepEqual(report.dayRate.get(alpha), [520, 260000, 500], `${kind}: Alpha's day rate is the price of a day`);
    assert.deepEqual(report.costPerFte.get(bravo), [1.25, 66000, 52800], `${kind}: Bravo, a person per month and a part-timer`);
    assert.deepEqual(report.dayRate.get(bravo), [60, 30000, 500], `${kind}: Bravo's day rate leaves the person per month out`);
    assert.equal(dayRate.overall.staff_cost_not_in_day_rate, 36000, `${kind}: the person per month is named`);
    assert.equal(perFte.overall.fte_without_line_detail, 1.75, `${kind}: the copy without line detail is named`);
    // USD has no rate for Y: the report and Plaid leave its cost out and keep its FTE and days.
    assert.deepEqual(report.costPerFte.get(charlie), [1, 0, 0], `${kind}: the USD line's cost left out, as the report`);
    assert.deepEqual(report.dayRate.get(charlie), [240, 0, 0], `${kind}: the USD line's days kept, as the report`);
    assert.deepEqual(perFte.amounts_fx_missing, [{ currency: 'USD', year: Y, lines: 1 }], `${kind}: the line without a rate is named`);
    assert.deepEqual(report.costPerFte.get('none'), [0, 0, null], `${kind}: pieces only: a staff FTE of 0, no cost per FTE`);
    assert.equal(report.dayRate.has('none'), false, `${kind}: no days without a supplier`);

    // The same with a filter, given to both as Plaid gives it.
    const company = s.companies.fr.name;
    const filtered = await compareWithReport(runner, kind, s.tenantId, { paying_company: [company] }, 'one paying company');
    assert.deepEqual([...filtered.report.costPerFte.keys()].sort(), [alpha, bravo, charlie, 'none'].sort(), `${kind}: the filter keeps the FR lines (the pieces line without a supplier among them)`);
    assert.deepEqual(filtered.perFte.filters_applied, ['paying_company']);

    // A sum of a staff field, with its overall total.
    const aggregate = aggregateExecutor();
    const ctx = context(runner, s.tenantId);
    const fte: any = await aggregate.execute(ctx, { entity_type: ENTITY[kind], group_by: 'supplier', metric: 'y_budget_staff_fte', function: 'sum' });
    assert.deepEqual(fte.groups.find((group: any) => group.key === alpha), { key: alpha, value: 2.17, unknown: 0 }, `${kind}: a staff FTE sums with the unknown count`);
    assert.deepEqual([fte.overall.value, fte.overall.unknown, fte.overall.count], [4.42, 1, LINES.length], `${kind}: overall, the no-detail line unknown`);
    assert.equal(fte.amounts_currency, undefined, `${kind}: an FTE has no currency`);
    const days: any = await aggregate.execute(ctx, { entity_type: ENTITY[kind], group_by: 'supplier', metric: 'y_budget_days', function: 'sum' });
    assert.equal(days.amounts_currency, undefined, `${kind}: days have no currency`);
    assert.equal(days.overall.value, 820, `${kind}: every day bought`);
    const cost: any = await aggregate.execute(ctx, { entity_type: ENTITY[kind], group_by: 'supplier', metric: 'y_budget_staff_cost', function: 'sum' });
    assert.equal(cost.amounts_currency, 'EUR', `${kind}: a staff cost names its currency`);
    assert.equal(cost.overall.value, 326000, `${kind}: the staff cost of every line, the USD line left out`);
    const amount: any = await aggregate.execute(ctx, { entity_type: ENTITY[kind], group_by: 'currency', metric: 'y_budget', function: 'sum' });
    assert.equal(amount.overall.unknown, undefined, `${kind}: an amount has no unknown count`);

    await assert.rejects(
      aggregate.execute(ctx, { entity_type: ENTITY[kind], group_by: 'supplier', metric: 'y_budget_cost_per_ftes', function: 'sum' }),
      /Unsupported metric field/,
      `${kind}: an unknown ratio is refused`,
    );
  });
  console.log(`ok - ${kind}: cost per FTE and day rate by supplier as the report`);
}

/** A copy that keeps its lines' result: the report's third notice, its figures from the lines. */
async function testAmountNotFollowingLines(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner, kind, [...LINES, { label: 'alpha copied', supplier: 'Alpha', company: 'es', round: copiedWithLines([FULL_TIME]) }]);
    const { perFte, report } = await compareWithReport(runner, kind, s.tenantId, {}, 'a copy with its lines');
    assert.equal(report.detached, 2, `${kind}: the report names the 2 FTE of the copy`);
    assert.equal(perFte.overall.fte_amount_not_following_lines, 2, `${kind}: so does Plaid (the copy without detail left out of it)`);
    assert.equal(perFte.overall.fte_without_line_detail, 1.75, `${kind}: the copy without detail stays apart`);
    assert.deepEqual(report.costPerFte.get(`Alpha ${s.tenantId.slice(0, 8)}`), [4.17, 500000, 119904.08], `${kind}: the copy counts at the cost of its lines`);
  });
  console.log(`ok - ${kind}: the FTE whose amount no longer follows its lines, as the report`);
}

async function testQueryTotals(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner, kind);
    const query = queryExecutor();
    const ctx = context(runner, s.tenantId);
    const sorted: any = await query.execute(ctx, { entity_type: ENTITY[kind], sort: { field: 'y_budget_staff_cost', direction: 'desc' }, limit: 2 });
    assert.deepEqual(sorted.items.map((item: any) => item.label), ['Staff alpha full time', 'Staff bravo per month'], `${kind}: sorted on the staff cost`);
    const totals = sorted.amount_totals.values;
    assert.deepEqual(
      [totals.y_budget_staff_cost, totals.y_budget_staff_fte, totals.y_budget_day_cost, totals.y_budget_days],
      [326000, 4.42, 290000, 820],
      `${kind}: the staff totals of every line, as the report's total row`,
    );
    assert.equal(totals.y_plus1_budget_staff_fte, undefined, `${kind}: another year only when named`);
    assert.match(sorted.amount_totals.note, /never from dividing these totals/);
    const page = sorted.page_amount_totals.values;
    assert.deepEqual(
      [page.y_budget_staff_cost, page.y_budget_staff_fte, page.y_budget_day_cost, page.y_budget_days],
      [276000, 3, 240000, 480],
      `${kind}: the staff totals of the two lines listed`,
    );

    const filtered: any = await query.execute(ctx, { entity_type: ENTITY[kind], filters: { y_budget_days: { op: 'gte', value: 100 } } });
    assert.deepEqual(filtered.items.map((item: any) => item.label).sort(), ['Staff alpha full time', 'Staff charlie usd'], `${kind}: a filter on the days`);
    assert.deepEqual(filtered.filters_applied, ['y_budget_days']);
    assert.equal(filtered.amount_totals.values.y_budget_days, 720, `${kind}: the totals follow the filter`);
    assert.deepEqual(
      [filtered.page_amount_totals.values.y_budget_days, filtered.page_amount_totals.values.y_budget_staff_cost],
      [720, filtered.amount_totals.values.y_budget_staff_cost],
      `${kind}: a page holding every line kept has their totals`,
    );

    const nextYear: any = await query.execute(ctx, { entity_type: ENTITY[kind], filters: { y_plus1_budget_staff_fte: { op: 'gt', value: 0 } } });
    assert.equal(nextYear.total, 0, `${kind}: no staff next year`);
    assert.equal(nextYear.amount_totals.values.y_plus1_budget_staff_fte, null, `${kind}: the year a filter names is summed, unknown without a line`);
    assert.equal(nextYear.amount_totals.values.y_plus1_budget_staff_cost, 0, `${kind}: an amount is 0`);
    assert.equal(nextYear.page_amount_totals.values.y_plus1_budget_staff_fte, null, `${kind}: an empty page`);
  });
  console.log(`ok - ${kind}: query totals of the staff fields`);
}

/** A person limited to the FR company adds up the FR lines only, as the report filtered on that company. */
async function testLimitedPerson(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const client: PgClient = {
      connect: async () => undefined,
      end: async () => undefined,
      query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params as any[]) }),
    };
    if (!(await roleExists(client))) {
      if (process.env.CI) assert.fail('CI installs kanap_data_limited before the migrations');
      console.log(`skip - ${kind}: kanap_data_limited not installed`);
      return;
    }
    const s = await seed(runner, kind);
    const role = await seedRole(client, s.tenantId, 'Budget member');
    const person = await seedPerson(client, s.tenantId, 'limited', role);
    await seedNodes(client, s.tenantId, person, [{ type: 'company', id: s.companies.fr.id, access: 'read' }]);
    const registry = getAiEntityRegistry(ENTITY[kind]);
    const expected = await reportFigures(runner, kind, adaptFilters(registry, { paying_company: [s.companies.fr.name] }).filters);

    assert.equal((await runner.query(`SELECT data_access_apply($1) AS mode`, [person]))[0].mode, 'limited');
    const ctx = context(runner, s.tenantId, person);
    const aggregate = aggregateExecutor();
    const perFte: any = await aggregate.execute(ctx, { entity_type: ENTITY[kind], group_by: 'supplier', metric: 'y_budget_cost_per_fte' });
    assert.deepEqual(aiFigures(perFte).costPerFte, expected.costPerFte, `${kind}: the FR lines only`);
    assert.deepEqual([perFte.overall.staff_fte, perFte.overall.staff_cost], [expected.total.fte.fte, expected.total.fte.cost], `${kind}: overall within the access`);
    assert.equal(perFte.data_access, 'limited', `${kind}: said within your access`);
    const listed: any = await queryExecutor().execute(ctx, { entity_type: ENTITY[kind] });
    assert.equal(listed.amount_totals.values.y_budget_staff_fte, expected.total.fte.fte, `${kind}: the query totals within the access`);
  });
  console.log(`ok - ${kind}: a limited person adds up their lines only`);
}

void runSpecs('ai-staff-cost.integration.spec', [
  ['registries and description', testRegistryAndDescription],
  ...KINDS.flatMap((kind): Array<[string, () => Promise<void>]> => [
    [`aggregate as the report (${kind})`, () => testAggregateAsTheReport(kind)],
    [`amount not following its lines (${kind})`, () => testAmountNotFollowingLines(kind)],
    [`query totals (${kind})`, () => testQueryTotals(kind)],
    [`limited person (${kind})`, () => testLimitedPerson(kind)],
  ]),
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
