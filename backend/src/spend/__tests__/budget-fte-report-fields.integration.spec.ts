import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import type { AggregateSpec } from '../../common/list-engine/list-aggregate';
import { resolveFteField, resolveFteVariantField, SUMMARY_SCOPES, SummaryScopeConfig, yearsNamedByFields } from '../spend-summary.builder';
import * as engine from '../budget-list/budget-list.service';
import { realSummaryDeps } from './oracle/oracle-deps';
import { computeColumn, type CostLine } from '../costing.util';
import { linesCalculation } from '../round-inputs.util';

// FTE reports, lot 1: the list fields and measures the budget reports read
// for an FTE measure, on OPEX and CAPEX, in a rolled-back transaction:
// - `minus` between two FTE fields (null when both lines are unknown, an
//   unknown side as 0 against a known one) and its `part`s;
// - `has_fte`: 'yes' when a line has a round with an FTE in any year and
//   column, as a filter and as a group key;
// - `fte_detached_<slot><Suffix>`: the FTE of a round whose amount no longer
//   follows its lines (method spread or manual), null for a computed round,
//   a round without FTE (lines removed), a line without rounds;
// - another tenant's line is never counted.
// FTE reports, lot 2b: the staffing report's monthly fields, on OPEX and CAPEX:
// - `fte_month_<MM>_<slot><Suffix>`: a round's FTE of one month, from its
//   calculation when its kind is `computed` (computed or edited by hand), else
//   from its `lines_result` (spread, copy); null without detail, without FTE,
//   without rounds;
// - `fte_nodetail_<slot><Suffix>`: the FTE of a round without monthly detail;
// - their sums grouped by a key, 14 FTE measures in one grouped request (the
//   FTE cap), and another tenant's line never counted.
// FTE reports, lot 3: the line totals of a round, from its lines' result, on
// OPEX and CAPEX:
// - `staff_cost_<slot><Suffix>` (people and days lines, pieces left out) and
//   `day_cost_<slot><Suffix>` (per-day priced lines): amounts converted like
//   the column's amount (exactly, a USD line on a rate set), 0 without detail;
// - `staff_fte_<slot><Suffix>`: the lines' result's own FTE (twelve one-month
//   lines give 1.00, not 0.96), null without detail;
// - `days_<slot><Suffix>`: the days the per-day lines buy (people full time,
//   5 days a month, a 40-day bundle: day cost ÷ days = 500, the day's price),
//   null without detail or without a per-day line;
// - every calculation comes from the real costing (`computeColumn`);
// - computed and spread (`lines_result`) rounds, a round without detail, a
//   line without rounds, their sums grouped by a key, another tenant never counted.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file in its serial database lane.

const Y = new Date().getFullYear();

type Round = { year: number; measure: string; method: 'computed' | 'spread' | 'manual' | 'copied'; fte: string | null; calc?: object | null };
type Line = { label: string; rounds?: Round[]; versionYears?: number[]; currency?: string; fxRateSetId?: string; planned?: Record<number, string> };

/**
 * The lines of the scenario (same for OPEX and CAPEX):
 * - computed: Budget Y 2.50 (computed), Budget Y-1 1.00;
 * - spread: Budget Y 1.25 over lines then spread (detached);
 * - manual: Budget Y 0.75 over lines then edited by hand (detached), Budget Y-1 2.00;
 * - removed: Budget Y spread, its lines removed (no FTE);
 * - no rounds: a version of Y without any round;
 * - old staff: an FTE only in Forecast Y-3 (a staffing line all the same).
 */
const LINES: Line[] = [
  { label: 'computed', rounds: [{ year: Y, measure: 'planned', method: 'computed', fte: '2.50' }, { year: Y - 1, measure: 'planned', method: 'computed', fte: '1.00' }] },
  { label: 'spread', rounds: [{ year: Y, measure: 'planned', method: 'spread', fte: '1.25' }] },
  { label: 'manual', rounds: [{ year: Y, measure: 'planned', method: 'manual', fte: '0.75' }, { year: Y - 1, measure: 'planned', method: 'computed', fte: '2.00' }] },
  { label: 'removed', rounds: [{ year: Y, measure: 'planned', method: 'spread', fte: null }] },
  { label: 'no rounds', versionYears: [Y] },
  { label: 'old staff', rounds: [{ year: Y - 3, measure: 'forecast', method: 'computed', fte: '3.00' }] },
];

async function insertTenant(runner: QueryRunner, tag: string): Promise<string> {
  const id = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR"}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [id, `fte-${tag}-${id.slice(0, 8)}`, `FTE reports ${tag}`],
  );
  return id;
}

/** One line of the scope with its versions and rounds; its id. */
async function insertLine(runner: QueryRunner, scope: SummaryScopeConfig, tenantId: string, itemNumber: number, line: Line): Promise<string> {
  const itemId = randomUUID();
  if (scope.scope === 'opex') {
    await runner.query(
      `INSERT INTO spend_items (id, tenant_id, item_number, product_name, currency, effective_start, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, '2020-01-01', 'enabled', now(), now())`,
      [itemId, tenantId, itemNumber, `FTE ${line.label}`, line.currency ?? 'EUR'],
    );
  } else {
    await runner.query(
      `INSERT INTO capex_items (id, tenant_id, item_number, description, ppe_type, investment_type, priority, currency, effective_start)
       VALUES ($1, $2, $3, $4, 'hardware', 'other', 'low', $5, '2020-01-01')`,
      [itemId, tenantId, itemNumber, `FTE ${line.label}`, line.currency ?? 'EUR'],
    );
  }
  const years = new Set([...(line.versionYears ?? []), ...(line.rounds ?? []).map((round) => round.year)]);
  const versions = new Map<number, string>();
  for (const year of years) {
    const versionId = randomUUID();
    versions.set(year, versionId);
    if (scope.scope === 'opex') {
      await runner.query(
        `INSERT INTO spend_versions (id, tenant_id, spend_item_id, version_name, input_grain, as_of_date, budget_year, allocation_method, fx_rate_set_id)
         VALUES ($1, $2, $3, 'Y' || $5::int, 'monthly', $4::date, $5::int, 'default', $6)`,
        [versionId, tenantId, itemId, `${year}-01-01`, year, line.fxRateSetId ?? null],
      );
    } else {
      await runner.query(
        `INSERT INTO capex_versions (id, tenant_id, capex_item_id, version_name, as_of_date, budget_year, allocation_method, fx_rate_set_id)
         VALUES ($1, $2, $3, 'Y' || $5::int, $4::date, $5::int, 'default', $6)`,
        [versionId, tenantId, itemId, `${year}-01-01`, year, line.fxRateSetId ?? null],
      );
    }
    const planned = line.planned?.[year];
    if (planned != null) {
      await runner.query(
        `INSERT INTO ${scope.scope === 'opex' ? 'spend_amounts' : 'capex_amounts'} (tenant_id, version_id, period, planned) VALUES ($1, $2, make_date($3, 1, 1), $4::numeric)`,
        [tenantId, versionId, year, planned],
      );
    }
  }
  for (const round of line.rounds ?? []) {
    await runner.query(
      `INSERT INTO ${scope.roundTable} (tenant_id, version_id, measure, period_start, period_end, method, fte, last_calculation)
       VALUES ($1, $2, $3, make_date($4, 1, 1), make_date($4, 12, 31), $5, $6::numeric, $7::jsonb)`,
      [tenantId, versions.get(round.year), round.measure, round.year, round.method, round.fte, round.calc == null ? null : JSON.stringify(round.calc)],
    );
  }
  return itemId;
}

const sum = (id: string, field: string, extra: object = {}) => ({ id, fn: 'sum' as const, field, ...extra });

function testKeyParsing() {
  for (const key of ['fte_detached_yBudget', `fte_detached_y${Y}Budget`, 'fte_month_03_yBudget', `fte_month_12_y${Y}Budget`, 'fte_nodetail_yBudget', 'fte_month_13_yBudget', 'fte_month_3_yBudget']) {
    assert.equal(resolveFteField(key), null, `fte_ resolution leaves ${key} alone`);
  }
  const detached = resolveFteVariantField(`fte_detached_y${Y}Budget`);
  assert.deepEqual([detached?.variant, detached?.year, detached?.column.measure], ['detached', Y, 'planned']);
  assert.equal(resolveFteVariantField('fte_detached_yRevision')?.column.measure, 'committed');
  const month = resolveFteVariantField(`fte_month_03_y${Y}Budget`);
  assert.deepEqual([month?.variant, month?.variant === 'month' ? month.month : null, month?.year], ['month', 3, Y]);
  const december = resolveFteVariantField('fte_month_12_yRevision');
  assert.deepEqual([december?.variant === 'month' ? december.month : null, december?.slot, december?.column.measure], [12, 'y', 'committed']);
  const nodetail = resolveFteVariantField('fte_nodetail_yMinus1Budget');
  assert.deepEqual([nodetail?.variant, nodetail?.slot], ['nodetail', 'yMinus1']);
  for (const key of ['fte_yBudget', 'yBudget', 'fte_detached_nonsense', 'fte_month_00_yBudget', 'fte_month_13_yBudget', 'fte_month_3_yBudget', 'fte_month_yBudget', 'fte_nodetail_', 'fte_other_yBudget']) {
    assert.equal(resolveFteVariantField(key), null, `${key} is not a variant`);
  }
  assert.deepEqual(yearsNamedByFields([`fte_detached_y${Y - 4}Budget`]), [Y - 4], 'a detached key names its year (bounds, loaded slots)');
  assert.deepEqual(yearsNamedByFields([`fte_month_01_y${Y - 5}Budget`, `fte_nodetail_y${Y + 3}Forecast`]).sort(), [Y - 5, Y + 3], 'a month or no-detail key names its year');
  // Lot 3: the line totals.
  for (const [key, variant, measure] of [[`staff_cost_y${Y}Budget`, 'staff_cost', 'planned'], ['staff_fte_yRevision', 'staff_fte', 'committed'], ['day_cost_yMinus1Budget', 'day_cost', 'planned'], [`days_y${Y}Landing`, 'days', 'expected_landing']]) {
    const resolved = resolveFteVariantField(key);
    assert.deepEqual([resolved?.variant, resolved?.column.measure], [variant, measure], key);
    assert.equal(resolveFteField(key), null, `fte_ resolution leaves ${key} alone`);
  }
  for (const key of ['staff_cost_', 'staff_cost_nonsense', 'staff_yBudget', 'days_fte_yBudget', 'day_yBudget', 'fte_days_yBudget', 'staff_cost_y99Budget']) {
    assert.equal(resolveFteVariantField(key), null, `${key} is not a variant`);
  }
  assert.deepEqual(yearsNamedByFields([`staff_cost_y${Y - 6}Budget`, `staff_fte_y${Y - 7}Budget`, `day_cost_y${Y + 4}Budget`, `days_y${Y + 5}Forecast`]).sort(), [Y - 7, Y - 6, Y + 4, Y + 5], 'a line total names its year');
  assert.deepEqual(
    engine.parseFteKeys(`fte_detached_yBudget,fte_detached_y${Y}Budget,fte_month_01_yBudget,fte_month_02_y${Y}Budget,fte_nodetail_yBudget,staff_cost_yBudget,staff_fte_yBudget,day_cost_yBudget,days_yBudget,fte_yBudget`, Y).map((fte) => fte.key),
    ['fte_yBudget'],
    'grid FTE keys ignore the report variants',
  );
  console.log('ok - key parsing');
}

async function checkScope(runner: QueryRunner, scope: SummaryScopeConfig, tenantId: string, otherTenantId: string) {
  const m = runner.manager;
  const deps = realSummaryDeps(scope);
  const name = scope.scope.toUpperCase();
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [otherTenantId]);
  const otherLine = await insertLine(runner, scope, otherTenantId, 1, { label: 'other tenant', rounds: [{ year: Y, measure: 'planned', method: 'spread', fte: '9.00' }] });
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const ids: Record<string, string> = {};
  for (const [i, line] of LINES.entries()) ids[line.label] = await insertLine(runner, scope, tenantId, 1 + i, line);
  const aggregate = (spec: AggregateSpec, query: Record<string, unknown> = {}) => engine.budgetListAggregate(scope, deps, query, spec, m);

  // A3: detached FTE, next to the FTE itself, on a fixed slot and a dynamic year.
  const total = (await aggregate({
    groupBy: [],
    measures: [sum('fte', 'fte_yBudget'), sum('detached', 'fte_detached_yBudget'), sum('detachedYear', `fte_detached_y${Y}Budget`), sum('detachedRevision', 'fte_detached_yRevision')],
  })).total;
  assert.equal(total.count, LINES.length, `${name}: every line of the tenant, none of the other`);
  assert.equal(total.values.fte, 4.5, `${name}: the declared FTE of Budget Y`);
  assert.equal(total.values.detached, 2, `${name}: spread 1.25 + manual 0.75`);
  assert.equal(total.count - total.unknown.detached, 2, `${name}: two lines concerned`);
  assert.equal(total.values.detachedYear, 2, `${name}: the same on the dynamic year`);
  assert.equal(total.unknown.detachedYear, LINES.length - 2);
  assert.equal(total.values.detachedRevision, null, `${name}: no Revision round, no value`);
  assert.equal(total.unknown.detachedRevision, LINES.length);

  const perLine = await aggregate({ groupBy: ['id'], measures: [sum('fte', 'fte_yBudget'), sum('detached', 'fte_detached_yBudget')] });
  const byId = new Map(perLine.groups.map((group) => [group.keys[0], group.values]));
  const expected: Record<string, [number | null, number | null]> = {
    computed: [2.5, null], spread: [1.25, 1.25], manual: [0.75, 0.75], removed: [null, null], 'no rounds': [null, null], 'old staff': [null, null],
  };
  for (const [label, [fte, detached]] of Object.entries(expected)) {
    assert.deepEqual([byId.get(ids[label])?.fte, byId.get(ids[label])?.detached], [fte, detached], `${name}: ${label}`);
  }
  assert.equal(byId.has(otherLine), false, `${name}: another tenant's line is not a group`);
  console.log(`ok - ${name}: fte_detached_ reads the FTE of the rounds that are not computed`);

  // A1: FTE minus FTE, and its parts.
  const delta = (await aggregate({
    groupBy: [],
    measures: [
      sum('d', 'fte_yBudget', { minus: `fte_y${Y - 1}Budget` }),
      sum('up', 'fte_yBudget', { minus: `fte_y${Y - 1}Budget`, part: 'positive' }),
      sum('down', 'fte_yBudget', { minus: `fte_y${Y - 1}Budget`, part: 'negative' }),
      { id: 'lo', fn: 'min', field: 'fte_yBudget', minus: `fte_y${Y - 1}Budget` },
    ],
  })).total;
  // computed 2.50 - 1.00, spread 1.25 - unknown, manual 0.75 - 2.00; the others unknown on both sides.
  assert.equal(delta.values.d, 1.5, `${name}: 1.50 + 1.25 - 1.25`);
  assert.equal(delta.unknown.d, LINES.length - 3, `${name}: lines unknown on both sides have no value`);
  assert.equal(delta.values.up, 2.75, `${name}: the increases`);
  assert.equal(delta.values.down, -1.25, `${name}: the decreases`);
  assert.equal(delta.unknown.up, LINES.length - 3, `${name}: a part keeps unknown lines unknown`);
  assert.equal(delta.values.lo, -1.25);
  const top = await aggregate({
    groupBy: ['id'],
    measures: [sum('d', 'fte_yBudget', { minus: `fte_y${Y - 1}Budget` })],
    having: [{ measure: 'd', op: 'gt', value: 1.25 }],
    order: [{ by: 'measure', id: 'd', dir: 'DESC' }],
  });
  assert.deepEqual(top.groups.map((group) => [group.keys[0], group.values.d]), [[ids.computed, 1.5]], `${name}: a having bound in FTE, as is`);
  await assert.rejects(
    aggregate({ groupBy: [], measures: [sum('d', 'fte_yBudget', { minus: 'yBudget' })] }),
    (err: unknown) => err instanceof BadRequestException && /yBudget is not an FTE field/.test((err as Error).message),
    `${name}: an FTE minus an amount is refused`,
  );
  console.log(`ok - ${name}: FTE minus FTE`);

  // A2: has_fte as a group key and as a filter.
  const grouped = await aggregate({ groupBy: ['has_fte'], measures: [sum('fte', 'fte_yBudget')], order: [{ by: 'key', index: 0, dir: 'ASC', nulls: 'LAST' }] });
  assert.deepEqual(grouped.groups.map((group) => [group.keys[0], group.count, group.values.fte]), [['yes', 4, 4.5], [null, 2, null]], `${name}: four staffing lines, any year`);
  const filtered = await aggregate(
    { groupBy: ['id'], measures: [sum('fte', 'fte_yBudget'), sum('detached', 'fte_detached_yBudget')] },
    { filters: { has_fte: { filterType: 'set', values: ['yes'] } } },
  );
  assert.deepEqual(new Set(filtered.groups.map((group) => group.keys[0])), new Set([ids.computed, ids.spread, ids.manual, ids['old staff']]), `${name}: the filter keeps the lines with an FTE`);
  assert.equal(filtered.total.values.fte, 4.5);
  assert.equal(filtered.total.count - filtered.total.unknown.detached, 2, `${name}: the notice reads on the total row of the same aggregate`);
  const blank = await aggregate({ groupBy: [], measures: [] }, { filters: { has_fte: { filterType: 'set', values: [null] } } });
  assert.equal(blank.total.count, 2, `${name}: the others are blank`);
  console.log(`ok - ${name}: has_fte as a group and a filter`);

  // The other tenant's session sees its own line only.
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [otherTenantId]);
  const other = await aggregate({ groupBy: ['has_fte'], measures: [sum('detached', 'fte_detached_yBudget')] });
  assert.deepEqual(other.groups.map((group) => [group.keys[0], group.count, group.values.detached]), [['yes', 1, 9]], `${name}: the other tenant reads its own line only`);
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  console.log(`ok - ${name}: another tenant's line is never counted`);
}

/** Twelve monthly FTE as stored (decimal strings): `first` for January, `h1` to June, `h2` from July. */
const fteMonths = (h1: string, h2: string, first = h1) => [first, ...Array(5).fill(h1), ...Array(6).fill(h2)];
const linesResult = (months: string[]) => ({ total: '1000', fte: '0', fte_period: '0', month_amounts: Array(12).fill('0'), fte_months: months, active_months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], lines: [] });
const computedCalc = (months: string[]) => ({ kind: 'computed', ...linesResult(months) });
const copyCalc = (result?: object) => ({ kind: 'copy', source_year: Y - 1, source_measure: 'planned', uplift_pct: '0', source_total: '1000', total: '1000', source_method: 'spread', ...(result ? { lines_result: result } : {}) });
const budget = (method: Round['method'], fte: string | null, calc: object | null): Round => ({ year: Y, measure: 'planned', method, fte, calc });

/**
 * The lines of the monthly scenario (same for OPEX and CAPEX), Budget Y:
 * - computed (EUR): computed, months 3 to June then 2; Budget Y-1 computed, months 5;
 * - hand-edited (USD): manual over a `computed` calculation, months 1;
 * - spread (EUR): an annual spread with `lines_result`, months 0 to June then 1.5;
 * - copy (USD): a copy with `lines_result`, January 0.5, then 0.25;
 * - no detail (EUR): a copy without `lines_result`, FTE 1.75;
 * - legacy (USD): a spread without any calculation, FTE 0.60;
 * - removed (USD): a computed calculation but no FTE (lines removed);
 * - no rounds (EUR): a version of Y without any round.
 */
const MONTH_LINES: Line[] = [
  { label: 'computed', currency: 'EUR', rounds: [budget('computed', '2.50', computedCalc(fteMonths('3', '2'))), { year: Y - 1, measure: 'planned', method: 'computed', fte: '5.00', calc: computedCalc(fteMonths('5', '5')) }] },
  { label: 'hand-edited', currency: 'USD', rounds: [budget('manual', '1.00', computedCalc(fteMonths('1', '1')))] },
  { label: 'spread', currency: 'EUR', rounds: [budget('spread', '0.75', { kind: 'annual', total: '1000', profile: 'flat', active_months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], weights: Array(12).fill('1'), lines_result: linesResult(fteMonths('0', '1.5')) })] },
  { label: 'copy', currency: 'USD', rounds: [budget('copied', '0.27', copyCalc(linesResult(fteMonths('0.25', '0.25', '0.5'))))] },
  { label: 'no detail', currency: 'EUR', rounds: [budget('copied', '1.75', copyCalc())] },
  { label: 'legacy', currency: 'USD', rounds: [budget('spread', '0.60', null)] },
  { label: 'removed', currency: 'USD', rounds: [budget('spread', null, computedCalc(fteMonths('7', '7')))] },
  { label: 'no rounds', currency: 'EUR', versionYears: [Y] },
];

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
/** The staffing report's request: twelve monthly sums and the two notice sums, 14 FTE measures. */
const staffingMeasures = (suffix: string) => [
  ...MONTHS.map((mm) => sum(`m${mm}`, `fte_month_${mm}_${suffix}`)),
  sum('detached', `fte_detached_${suffix}`),
  sum('nodetail', `fte_nodetail_${suffix}`),
];

async function checkMonths(runner: QueryRunner, scope: SummaryScopeConfig) {
  const m = runner.manager;
  const deps = realSummaryDeps(scope);
  const name = scope.scope.toUpperCase();
  const tenantId = await insertTenant(runner, `${scope.scope}-months`);
  const otherTenantId = await insertTenant(runner, `${scope.scope}-months-other`);
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [otherTenantId]);
  const otherLine = await insertLine(runner, scope, otherTenantId, 1, { label: 'other tenant', rounds: [budget('computed', '9.00', computedCalc(fteMonths('9', '9')))] });
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const ids: Record<string, string> = {};
  for (const [i, line] of MONTH_LINES.entries()) ids[line.label] = await insertLine(runner, scope, tenantId, 1 + i, line);
  const aggregate = (spec: AggregateSpec, query: Record<string, unknown> = {}) => engine.budgetListAggregate(scope, deps, query, spec, m);

  // A1 and A2 per line: the months where there is detail, the FTE without detail where there is none.
  const perLine = await aggregate({ groupBy: ['id'], measures: [sum('jan', 'fte_month_01_yBudget'), sum('jun', `fte_month_06_y${Y}Budget`), sum('dec', 'fte_month_12_yBudget'), sum('nodetail', 'fte_nodetail_yBudget')] });
  const byId = new Map(perLine.groups.map((group) => [group.keys[0], group.values]));
  const expected: Record<string, [number | null, number | null, number | null, number | null]> = {
    computed: [3, 3, 2, null],
    'hand-edited': [1, 1, 1, null],
    spread: [0, 0, 1.5, null],
    copy: [0.5, 0.25, 0.25, null],
    'no detail': [null, null, null, 1.75],
    legacy: [null, null, null, 0.6],
    removed: [null, null, null, null],
    'no rounds': [null, null, null, null],
  };
  for (const [label, values] of Object.entries(expected)) {
    const got = byId.get(ids[label]);
    assert.deepEqual([got?.jan, got?.jun, got?.dec, got?.nodetail], values, `${name}: ${label}`);
  }
  assert.equal(byId.has(otherLine), false, `${name}: another tenant's line is not a group`);
  console.log(`ok - ${name}: fte_month_ reads the lines' result, fte_nodetail_ the FTE without it`);

  // The staffing report's request: 14 FTE measures grouped by a key, sums per month, the notices on the total row.
  const staffing = await aggregate({ groupBy: ['currency'], measures: staffingMeasures('yBudget'), order: [{ by: 'key', index: 0, dir: 'ASC' }] });
  const row = (values: Record<string, number | null>) => [MONTHS.map((mm) => values[`m${mm}`]), values.nodetail];
  const months = (first: number, h1: number, h2: number) => [first, ...Array(5).fill(h1), ...Array(6).fill(h2)];
  assert.deepEqual(staffing.groups.map((group) => [group.keys[0], group.count, ...row(group.values)]), [
    ['EUR', 4, months(3, 3, 3.5), 1.75],
    ['USD', 4, months(1.5, 1.25, 1.25), 0.6],
  ], `${name}: monthly sums per currency`);
  const total = staffing.total;
  assert.equal(total.count, MONTH_LINES.length, `${name}: every line of the tenant, none of the other`);
  assert.deepEqual(row(total.values), [months(4.5, 4.25, 4.75), 2.35], `${name}: the total row`);
  assert.equal(total.unknown.m01, 4, `${name}: four lines without a month`);
  assert.equal(total.count - total.unknown.nodetail, 2, `${name}: two lines declare FTE without monthly detail`);
  assert.equal(total.values.detached, 4.37, `${name}: hand-edited 1 + spread 0.75 + copy 0.27 + no detail 1.75 + legacy 0.60`);
  assert.equal(total.count - total.unknown.detached, 5);
  const byLine = await aggregate({ groupBy: ['id'], measures: [...staffingMeasures(`y${Y}Budget`), sum('fte', 'fte_yBudget'), sum('prev', `fte_month_01_y${Y - 1}Budget`)] });
  assert.equal(byLine.groups.length, MONTH_LINES.length, `${name}: 16 FTE measures grouped by id`);
  assert.deepEqual(row(byLine.total.values), [months(4.5, 4.25, 4.75), 2.35], `${name}: a dynamic year reads the same rounds`);
  assert.equal(byLine.total.values.prev, 5, `${name}: another year reads its own round`);
  await assert.rejects(
    aggregate({ groupBy: ['id'], measures: [...staffingMeasures('yBudget').slice(0, 8), sum('amount', 'yBudget')] }),
    (err: unknown) => err instanceof BadRequestException && /at most 8 measures with group keys/.test((err as Error).message),
    `${name}: 9 measures with an amount among them are refused`,
  );
  console.log(`ok - ${name}: monthly sums grouped by a key, 14 and 16 FTE measures`);

  // The other tenant's session sees its own line only.
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [otherTenantId]);
  const other = await aggregate({ groupBy: [], measures: staffingMeasures('yBudget') });
  assert.deepEqual([other.total.count, ...row(other.total.values)], [1, Array(12).fill(9), null], `${name}: the other tenant reads its own line only`);
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  console.log(`ok - ${name}: another tenant's months are never counted`);
}

const CALENDAR_ID = '55555555-5555-4555-8555-555555555555';
/** A calendar of 20 working days in every month of every year. */
const CALENDARS = new Map([[CALENDAR_ID, { name: 'Twenty', code: 'T20', days: Array(12).fill('20') }]]);

/** A line as the costing reads it: over the whole of `year` unless months are given, priced per day on the 20-day calendar. */
function costLine(
  quantity_unit: CostLine['quantity_unit'],
  price_basis: CostLine['price_basis'],
  quantity: string,
  unit_price: string,
  opts: { year?: number; days_per_month?: string; month?: number; frequency?: CostLine['frequency'] } = {},
): CostLine {
  const year = opts.year ?? Y;
  const mm = opts.month == null ? null : String(opts.month).padStart(2, '0');
  return {
    label: `${quantity} ${quantity_unit} ${price_basis}`,
    quantity_unit,
    quantity,
    unit_price,
    price_basis,
    frequency: opts.frequency ?? (quantity_unit === 'days' ? 'once' : 'per_month'),
    days_per_month: opts.days_per_month ?? null,
    period_start: mm ? `${year}-${mm}-01` : `${year}-01-01`,
    period_end: mm ? `${year}-${mm}-${new Date(Date.UTC(year, opts.month!, 0)).getUTCDate()}` : `${year}-12-31`,
    working_day_profile_id: price_basis === 'per_day' ? CALENDAR_ID : null,
  };
}

/** What the real costing gives for `lines` in `year`: the stored calculation, the round's FTE and the column's total. */
function costed(lines: CostLine[], year = Y) {
  const result = computeColumn(lines, year, CALENDARS);
  const calc = linesCalculation(lines, CALENDARS, result);
  return { calc, result, fte: result.fte, total: calc.total };
}
const computedRound = (lines: CostLine[], year = Y): Round => {
  const c = costed(lines, year);
  return { year, measure: 'planned', method: 'computed', fte: c.fte, calc: c.calc };
};

/** The three per-day cases of the review (500 a day, a 20-day calendar). */
const FULL_TIME = costLine('people', 'per_day', '2', '500');
const PART_TIME = costLine('people', 'per_day', '1', '500', { days_per_month: '5' });
const BUNDLE = costLine('days', 'per_day', '40', '500');
const PIECES = costLine('pieces', 'per_piece', '1', '100');
/** Twelve people lines of one month each: 0.08 FTE each when rounded per line, 1.00 FTE for the column. */
const TWELVE = Array.from({ length: 12 }, (_, i) => costLine('people', 'per_month', '1', '1000', { month: i + 1 }));
const USD_LINE = costLine('people', 'per_day', '1', '500.5');
const USD_RATE = 0.8765;

/**
 * The lines of the line totals scenario (same for OPEX and CAPEX), Budget Y,
 * every calculation from the real costing (`computeColumn`, `linesCalculation`):
 * - full time (EUR): 2 people full time at 500 a day (240,000, 480 days, 2 FTE)
 *   and a piece; Budget Y-1: 1 person full time at 100 a day;
 * - part time (EUR): 1 person 5 days a month at 500 a day (30,000, 60 days);
 * - bundle (EUR): 40 days at 500 a day (20,000, 40 days);
 * - per month (EUR): 1 person at 3,000 a month (36,000, no days) and a piece;
 * - twelve (EUR): twelve people lines of one month each at 1,000 a month (1.00 FTE);
 * - spread (EUR): an annual spread with `lines_result`, 0.5 person at 2,400 a month and a piece;
 * - no detail (EUR): a copy without `lines_result`, FTE 1.75;
 * - pieces only (EUR), computed: a piece, FTE 0;
 * - usd (USD) on a rate set (USD 0.8765): 1 person full time at 500.50 a day, its amount the column's total;
 * - no rounds (EUR): a version of Y without any round.
 */
const totalsLines = (rateSetId: string): Line[] => {
  const spread = costed([costLine('people', 'per_month', '0.5', '2400'), PIECES]);
  const { kind: _computed, ...spreadResult } = spread.calc;
  return [
    { label: 'full time', currency: 'EUR', rounds: [computedRound([FULL_TIME, PIECES]), computedRound([costLine('people', 'per_day', '1', '100', { year: Y - 1 })], Y - 1)] },
    { label: 'part time', currency: 'EUR', rounds: [computedRound([PART_TIME])] },
    { label: 'bundle', currency: 'EUR', rounds: [computedRound([BUNDLE])] },
    { label: 'per month', currency: 'EUR', rounds: [computedRound([costLine('people', 'per_month', '1', '3000'), PIECES])] },
    { label: 'twelve', currency: 'EUR', rounds: [computedRound(TWELVE)] },
    {
      label: 'spread',
      currency: 'EUR',
      rounds: [budget('spread', spread.fte, {
        kind: 'annual', total: spread.total, profile: 'flat', active_months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], weights: Array(12).fill('1'), lines_result: spreadResult,
      })],
    },
    { label: 'no detail', currency: 'EUR', rounds: [budget('copied', '1.75', copyCalc())] },
    { label: 'pieces only', currency: 'EUR', rounds: [computedRound([costLine('pieces', 'per_piece', '1', '50')])] },
    { label: 'usd', currency: 'USD', fxRateSetId: rateSetId, planned: { [Y]: costed([USD_LINE]).total }, rounds: [computedRound([USD_LINE])] },
    { label: 'no rounds', currency: 'EUR', versionYears: [Y] },
  ];
};

/** `Math.round(Number(local) * rate * 100)`, the builder's conversion, in units. */
const converted = (local: string, rate: number) => Math.round(Number(local) * rate * 100) / 100;

const lineTotalMeasures = (suffix: string) => [
  sum('cost', `staff_cost_${suffix}`), sum('fte', `staff_fte_${suffix}`), sum('dayCost', `day_cost_${suffix}`), sum('days', `days_${suffix}`),
];

/** The fixtures are what the review reproduced with the real costing. */
function testCostingFixtures() {
  const line = (l: CostLine) => costed([l]).calc.lines[0];
  assert.deepEqual([line(FULL_TIME).total, line(FULL_TIME).total_days], ['240000.00', '240'], '2 people full time: the calendar\'s days, whatever the quantity');
  assert.deepEqual([line(PART_TIME).total, line(PART_TIME).total_days], ['30000.00', '240'], '5 days a month: the calendar\'s days, not the days worked');
  assert.deepEqual([line(BUNDLE).total, line(BUNDLE).total_days], ['20000.00', '240'], 'a 40-day bundle: the calendar\'s days, not the bundle');
  const twelve = costed(TWELVE);
  assert.equal(twelve.fte, '1', 'twelve one-month lines: 1 FTE for the column');
  assert.equal(twelve.calc.lines.reduce((acc, l) => acc + Number(l.fte), 0).toFixed(2), '0.96', 'but 0.96 summed per line');
  console.log('ok - costing fixtures');
}

async function checkLineTotals(runner: QueryRunner, scope: SummaryScopeConfig) {
  const m = runner.manager;
  const deps = realSummaryDeps(scope);
  const name = scope.scope.toUpperCase();
  const tenantId = await insertTenant(runner, `${scope.scope}-totals`);
  const otherTenantId = await insertTenant(runner, `${scope.scope}-totals-other`);
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [otherTenantId]);
  const otherLine = await insertLine(runner, scope, otherTenantId, 1, { label: 'other tenant', rounds: [computedRound([costLine('people', 'per_day', '9', '100')])] });
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const [{ id: rateSetId }] = await runner.query(
    `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates) VALUES ($1, $2, 'EUR', $3::jsonb) RETURNING id`,
    [tenantId, Y, JSON.stringify({ USD: USD_RATE })],
  );
  const lines = totalsLines(rateSetId);
  const ids: Record<string, string> = {};
  for (const [i, line] of lines.entries()) ids[line.label] = await insertLine(runner, scope, tenantId, 1 + i, line);
  const aggregate = (spec: AggregateSpec, query: Record<string, unknown> = {}) => engine.budgetListAggregate(scope, deps, query, spec, m);

  // Per line: people and days lines in the staff totals, per-day lines in the day totals, pieces in neither.
  const perLine = await aggregate({ groupBy: ['id'], measures: [...lineTotalMeasures('yBudget'), sum('amount', 'yBudget'), sum('prevCost', `staff_cost_y${Y - 1}Budget`), sum('prevDays', `days_y${Y - 1}Budget`)] });
  const byId = new Map(perLine.groups.map((group) => [group.keys[0], group.values]));
  const usdCost = converted('120120.00', USD_RATE);
  const expected: Record<string, [number | null, number | null, number | null, number | null]> = {
    'full time': [240000, 2, 240000, 480],
    'part time': [30000, 0.25, 30000, 60],
    bundle: [20000, 0.17, 20000, 40],
    'per month': [36000, 1, 0, null],
    twelve: [12000, 1, 0, null],
    spread: [14400, 0.5, 0, null],
    'no detail': [0, null, 0, null],
    'pieces only': [0, 0, 0, null],
    usd: [usdCost, 1, usdCost, 240],
    'no rounds': [0, null, 0, null],
  };
  for (const [label, values] of Object.entries(expected)) {
    const got = byId.get(ids[label]);
    assert.deepEqual([got?.cost, got?.fte, got?.dayCost, got?.days], values, `${name}: ${label}`);
  }
  for (const label of ['full time', 'part time', 'bundle']) {
    const got = byId.get(ids[label])!;
    assert.equal(got.dayCost! / got.days!, 500, `${name}: ${label}: day cost ÷ days is the price of a day`);
  }
  assert.equal(byId.get(ids.twelve)?.cost! / byId.get(ids.twelve)?.fte!, 12000, `${name}: twelve one-month lines: the column's FTE, not the lines' rounded FTE summed`);
  assert.equal(byId.has(otherLine), false, `${name}: another tenant's line is not a group`);
  assert.equal(byId.get(ids.usd)?.amount, usdCost, `${name}: the USD line's amount, converted on its rate set`);
  assert.notEqual(usdCost, 120120, `${name}: the rate applies`);
  assert.deepEqual([byId.get(ids['full time'])?.prevCost, byId.get(ids['full time'])?.prevDays], [24000, 240], `${name}: another year reads its own round`);
  assert.equal(perLine.reportingCurrency, 'EUR', `${name}: the staff cost is in the reporting currency`);
  console.log(`ok - ${name}: line totals per line, pieces left out, days bought, converted like the amount`);

  // The cost per FTE report's request: grouped sums with the notices, on a dynamic year.
  const report = await aggregate({
    groupBy: ['currency'],
    measures: [...lineTotalMeasures(`y${Y}Budget`), sum('detached', `fte_detached_y${Y}Budget`), sum('nodetail', `fte_nodetail_y${Y}Budget`)],
    order: [{ by: 'key', index: 0, dir: 'ASC' }],
  });
  const row = (values: Record<string, number | null>) => [values.cost, values.fte, values.dayCost, values.days, values.detached, values.nodetail];
  assert.deepEqual(report.groups.map((group) => [group.keys[0], group.count, ...row(group.values)]), [
    ['EUR', 9, 352400, 4.92, 290000, 580, 2.25, 1.75],
    ['USD', 1, usdCost, 1, usdCost, 240, null, null],
  ], `${name}: sums per currency`);
  const total = report.total;
  assert.equal(total.count, lines.length, `${name}: every line of the tenant, none of the other`);
  assert.deepEqual(row(total.values), [Math.round((352400 + usdCost) * 100) / 100, 5.92, Math.round((290000 + usdCost) * 100) / 100, 820, 2.25, 1.75], `${name}: the total row`);
  assert.equal(total.unknown.fte, 2, `${name}: no staff FTE without detail (no detail, no rounds)`);
  assert.equal(total.unknown.days, 6, `${name}: days only where a per-day line is`);
  assert.equal(total.unknown.cost, undefined, `${name}: an amount is never unknown`);
  console.log(`ok - ${name}: line totals grouped by a key, the notices beside them`);

  // The other tenant's session sees its own line only.
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [otherTenantId]);
  const other = await aggregate({ groupBy: [], measures: lineTotalMeasures('yBudget') });
  assert.deepEqual([other.total.count, other.total.values.cost, other.total.values.fte, other.total.values.dayCost, other.total.values.days], [1, 216000, 9, 216000, 2160], `${name}: the other tenant reads its own line only`);
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  console.log(`ok - ${name}: another tenant's line totals are never counted`);
}

async function main() {
  testKeyParsing();
  testCostingFixtures();
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = await insertTenant(runner, 'main');
    const otherTenantId = await insertTenant(runner, 'other');
    for (const scope of [SUMMARY_SCOPES.opex, SUMMARY_SCOPES.capex]) await checkScope(runner, scope, tenantId, otherTenantId);
    for (const scope of [SUMMARY_SCOPES.opex, SUMMARY_SCOPES.capex]) await checkMonths(runner, scope);
    for (const scope of [SUMMARY_SCOPES.opex, SUMMARY_SCOPES.capex]) await checkLineTotals(runner, scope);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
  console.log('budget-fte-report-fields.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
