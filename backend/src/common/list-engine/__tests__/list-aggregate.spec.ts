import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { AGGREGATE_LIMITS, aggregateSql, AggregateSpec, validateAggregateSpec } from '../list-aggregate';
import type { ListState } from '../list-engine.types';
import { SqlStatement } from '../sql-statement';
import { BudgetListConfig } from '../../../spend/budget-list/budget-list.config';
import type { BudgetListRuntime } from '../../../spend/budget-list/budget-list.runtime';
import { SUMMARY_SCOPES } from '../../../spend/spend-summary.builder';

// The aggregate statement builder of the list engine (lot 2B, PR D), without
// a database: the spec checks, the tenant on every table it reads, values
// bound and never written into the text, the fields a group or a measure
// refuses, and the parts of the statement (groups, others, total). What the
// statement returns is checked against the rows in
// `spend/__tests__/budget-aggregate-differential.integration.spec.ts`.

const TENANT = '11111111-1111-4111-8111-111111111111';
const Y = 2026;

function runtime(scope: 'opex' | 'capex' = 'opex', canReadAccounts = true): BudgetListRuntime {
  return {
    canReadAccounts,
    scope: SUMMARY_SCOPES[scope],
    tenantId: TENANT,
    currentYear: Y,
    fx: { rows: [{ setKey: 'live', year: Y, currency: 'USD', rate: 0.9 }], knownSets: [], reportingCurrency: 'EUR' },
    axes: { ids: ['22222222-2222-4222-8222-222222222222'], defaultAxisId: '22222222-2222-4222-8222-222222222222' },
    costCenters: [{ id: '33333333-3333-4333-8333-333333333333', code: 'CC1', name: 'Root', path: 'Root', holder_id: null, holder_name: null }],
    ruleLabels: new Map([[Y, 'Headcount'], [Y + 1, 'Headcount']]),
  };
}

const state = (patch: Partial<ListState> = {}): ListState => ({
  page: 1, limit: 20, skip: 0, sort: { field: 'created_at', direction: 'DESC' }, filters: {}, scope: null, ...patch,
});

/** The statement as built (the tenant is `$1`) and as run (`finalize` numbers the parameters in order of use). */
function build(spec: AggregateSpec, patch: Partial<ListState> = {}, scope: 'opex' | 'capex' = 'opex', canReadAccounts = true) {
  const stmt = new SqlStatement(TENANT);
  const raw = aggregateSql(stmt, new BudgetListConfig(runtime(scope, canReadAccounts)), state(patch), spec);
  return { raw, ...stmt.finalize(raw) };
}

const isBadRequest = (pattern: RegExp) => (err: unknown) => err instanceof BadRequestException && pattern.test(err.message);
const sum = (id: string, field: string, extra: object = {}) => ({ id, fn: 'sum' as const, field, ...extra });

function testSpecChecks() {
  const ok: AggregateSpec = { groupBy: ['supplier_name'], measures: [sum('b', 'yBudget')] };
  assert.doesNotThrow(() => validateAggregateSpec(ok));
  const refused: Array<[unknown, RegExp]> = [
    [null, /a spec is required/],
    [{ groupBy: 'supplier_name', measures: [] }, /groupBy must be a list/],
    [{ groupBy: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], measures: [] }, /at most 6 group fields/],
    [{ groupBy: [], measures: [sum('b', 'yBudget'), sum('b', 'yLanding')] }, /used twice/],
    [{ groupBy: [], measures: [sum('1b', 'yBudget')] }, /invalid measure id/],
    [{ groupBy: [], measures: [sum('b; DROP', 'yBudget')] }, /invalid measure id/],
    [{ groupBy: [], measures: [{ id: 'b', fn: 'median', field: 'yBudget' }] }, /unknown function/],
    [{ groupBy: [], measures: [{ id: 'b', fn: 'sum' }] }, /needs a field/],
    [{ groupBy: [], measures: [sum('b', 'yBudget', { part: 'both' })] }, /part is positive or negative/],
    [{ groupBy: [], measures: [sum('b', 'yBudget')], having: [{ measure: 'x', op: 'gt', value: 0 }] }, /no measure "x" for a condition/],
    [{ groupBy: [], measures: [sum('b', 'yBudget')], having: [{ measure: 'b', op: 'like', value: 0 }] }, /unknown condition/],
    [{ groupBy: [], measures: [sum('b', 'yBudget')], having: [{ measure: 'b', op: 'gt', value: Infinity }] }, /finite number/],
    [{ groupBy: [], measures: [sum('b', 'yBudget')], order: [{ by: 'measure', id: 'x', dir: 'ASC' }] }, /no measure "x" to order by/],
    [{ groupBy: ['currency'], measures: [], order: [{ by: 'key', index: 1, dir: 'ASC' }] }, /no group key 1/],
    [{ groupBy: [], measures: [], order: [{ by: 'count', dir: 'UP' }] }, /ASC or DESC/],
    [{ groupBy: [], measures: [], order: [{ by: 'count', dir: 'ASC', nulls: 'MIDDLE' }] }, /FIRST or LAST/],
    [{ groupBy: [], measures: [], order: Array.from({ length: 11 }, () => ({ by: 'count', dir: 'ASC' })) }, /at most 10 order terms/],
    [{ groupBy: [], measures: [], order: Array.from({ length: 20_000 }, () => ({ by: 'count', dir: 'ASC' })) }, /at most 10 order terms/],
    [{ groupBy: [], measures: [], limit: 0 }, /limit must be an integer/],
    [{ groupBy: [], measures: [], limit: 2.5 }, /limit must be an integer/],
    [{ groupBy: [], measures: [], others: true }, /others needs a limit/],
  ];
  for (const [spec, pattern] of refused) assert.throws(() => validateAggregateSpec(spec as any), isBadRequest(pattern), `${JSON.stringify(spec)} refused`);
}

function testFieldsAGroupOrAMeasureRefuses() {
  assert.throws(() => build({ groupBy: ['yBudget'], measures: [] }), isBadRequest(/yBudget \(money\) cannot group lines/));
  assert.throws(() => build({ groupBy: ['created_at'], measures: [] }), isBadRequest(/created_at \(ts\) cannot group lines/));
  assert.throws(() => build({ groupBy: [], measures: [sum('b', 'supplier_name')] }), isBadRequest(/supplier_name is not an amount or an FTE field/));
  // FTE lot 1 (A1): an FTE subtracts an FTE; an FTE and an amount never mix.
  assert.doesNotThrow(() => build({ groupBy: [], measures: [sum('b', 'fte_yBudget', { minus: 'fte_yLanding' })] }), 'FTE minus FTE');
  assert.doesNotThrow(() => build({ groupBy: ['id'], measures: [sum('b', 'fte_y2027Budget', { minus: 'fte_y2026Budget', part: 'negative' })] }), 'FTE minus FTE, a part');
  assert.doesNotThrow(() => build({ groupBy: [], measures: [sum('b', 'fte_detached_yBudget', { part: 'positive' })] }), 'a part of an FTE');
  assert.throws(() => build({ groupBy: [], measures: [sum('b', 'fte_yBudget', { minus: 'yLanding' })] }), isBadRequest(/yLanding is not an FTE field/));
  assert.throws(() => build({ groupBy: [], measures: [sum('b', 'fte_yBudget', { minus: 'supplier_name' })] }), isBadRequest(/supplier_name is not an FTE field/));
  assert.throws(() => build({ groupBy: [], measures: [sum('b', 'yBudget', { minus: 'fte_yLanding' })] }), isBadRequest(/fte_yLanding is not an amount field/));
  // Group keys of every other kind compile.
  for (const key of ['supplier_name', 'status', 'id', 'project_stream_name', 'item_number', 'effective_start', 'cost_center_path', 'analytics_22222222-2222-4222-8222-222222222222', 'nonexistent']) {
    assert.doesNotThrow(() => build({ groupBy: [key], measures: [] }), key);
  }
}

function testTenantOnEveryTableAndValuesBound() {
  const supplier = "O'Brien; DROP TABLE spend_items";
  const { raw, sql, params } = build(
    {
      groupBy: ['supplier_name', 'cost_center_path'],
      measures: [sum('b', 'yBudget'), sum('d', 'y2027Budget', { minus: 'yBudget', part: 'positive' }), { id: 'f', fn: 'avg', field: 'fte_yBudget' }],
      having: [{ measure: 'b', op: 'gt', value: 1234.56 }],
      limit: 7,
      others: true,
    },
    { filters: { supplier_name: { filterType: 'set', values: [supplier] } }, q: 'cyber', scope: 'active' },
  );
  // Every table the statement reads names the tenant (`$1` as built), besides RLS.
  for (const table of ['JOIN spend_items ai ON ai.tenant_id = $1', 'JOIN spend_version_totals at ON at.tenant_id = $1',
    'LEFT JOIN suppliers sup ON sup.tenant_id = $1', 'LEFT JOIN spend_versions v2026 ON v2026.tenant_id = $1',
    'LEFT JOIN spend_round_inputs ri2026_planned ON ri2026_planned.tenant_id = $1', 'FROM suppliers x WHERE x.tenant_id = $1']) {
    assert.ok(raw.includes(table), `reads ${table}`);
  }
  assert.ok(raw.includes('WHERE (i.tenant_id = $1)'), 'the core names the tenant');
  assert.ok(raw.includes('WHERE av.tenant_id = $1'), 'the amounts table names the tenant');
  const tables = Array.from(raw.matchAll(/(?:FROM|JOIN) (spend_\w+|suppliers|companies|accounts|users|tasks|portfolio_\w+|analytics_\w+|contract_\w+|contracts) (\w+)/g));
  assert.ok(tables.length >= 8, 'the statement reads several tables');
  for (const [, table, alias] of tables) {
    assert.ok(new RegExp(`${alias}\\.tenant_id = (\\$1|\\w+\\.tenant_id)`).test(raw), `${table} ${alias} is read for the tenant`);
  }
  assert.ok(params.includes(TENANT), 'the tenant is bound');
  assert.equal(sql.includes(supplier), false, 'a filter value is never written into the text');
  assert.ok(params.some((p) => Array.isArray(p) && p.includes(supplier)), 'it is bound');
  assert.ok(params.includes('cyber'), 'the quick search is bound');
  assert.ok(params.includes('1234.56'), 'a condition on an amount is bound as written');
  assert.ok(/> \(\$\d+::numeric \* 100\)/.test(raw), 'and compared exactly with the cents');
  assert.ok(params.includes(7), 'the limit is bound');
  assert.equal(new Set((sql.match(/\$\d+/g) ?? []).map((p) => Number(p.slice(1)))).size, params.length, 'every parameter is read, none is left over');
}

function testParts() {
  const plain = build({ groupBy: ['currency'], measures: [sum('b', 'yBudget')] }).sql;
  assert.equal(/\b1 AS one\b/.test(plain), false, 'no unused column');
  assert.ok(plain.includes(`NULLIF((i.currency::text)::text, '') AS k0`), 'a text key reads blank as null');
  assert.ok(plain.includes('row_number() OVER (ORDER BY g.n DESC, g.k0 COLLATE "und-x-icu" ASC NULLS FIRST)'), 'default order: count, then the key in the ICU order, blanks first');
  assert.ok(plain.includes("'g' AS part") && plain.includes("'t' AS part"), 'groups and the total');
  assert.equal(plain.includes("'o' AS part"), false, 'no others row without a limit');
  assert.equal(plain.includes('x.rn <='), false, 'no limit');
  assert.ok(plain.includes('coalesce(am.y2026_planned, 0::float8) AS v0'), 'a line reads its converted cents');
  assert.ok(plain.includes('round(coalesce(sum((agg_lines.v0)::bigint) FILTER (WHERE abs(agg_lines.v0) < 1e15), 0)'), 'and the group sums them exactly (the footer totals rule)');

  const top = build({ groupBy: ['currency'], measures: [sum('b', 'yBudget')], order: [{ by: 'measure', id: 'b', dir: 'DESC', nulls: 'LAST' }], limit: 3, others: true }).sql;
  assert.ok(top.includes("'o' AS part"), 'the others row with a limit');
  assert.ok(/x\.rn <= \$\d+/.test(top) && /r\.rn > \$\d+/.test(top), 'groups up to the limit, the others past it');
  assert.ok(top.includes('FROM agg_groups r'), 'the total covers every group');

  const multi = build({ groupBy: ['project_name'], measures: [] }).sql;
  assert.ok(multi.includes(`NULLIF((proj.project_name)::text, '') AS k0`), 'a multi-valued field groups under its joined names');
  assert.equal(/unnest\(proj\./.test(multi), false, 'its names are not split');

  const none = build({ groupBy: [], measures: [] }).sql;
  assert.ok(none.includes('HAVING count(*) > 0') && !none.includes('GROUP BY'), 'no key: one group, only when there are lines');

  const unknown = build({ groupBy: ['nonexistent'], measures: [] }).sql;
  assert.ok(unknown.includes('NULL::text AS k0'), 'a key the list does not know groups every line under null');

  const byNumber = build({ groupBy: ['item_number'], measures: [], order: [{ by: 'key', index: 0, dir: 'DESC' }] }).sql;
  assert.ok(byNumber.includes('(g.k0)::numeric DESC'), 'a number key sorts as a number');

  const capex = build({ groupBy: ['priority'], measures: [sum('b', 'yBudget')] }, {}, 'capex').sql;
  assert.ok(capex.includes('FROM capex_items i') && capex.includes('JOIN capex_version_totals at'), 'CAPEX reads its own tables');

  // An explicit key order follows a ranked enum's business order (Q4); the final tie-break stays the key's text.
  const ranked = build({ groupBy: ['priority'], measures: [], order: [{ by: 'key', index: 0, dir: 'ASC' }] }, {}, 'capex').sql;
  assert.ok(ranked.includes(`ORDER BY (CASE g.k0 WHEN 'mandatory' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END) ASC, g.k0 COLLATE "und-x-icu" ASC NULLS FIRST)`), 'priority by its rank, then its text');
  const status = build({ groupBy: ['status'], measures: [], order: [{ by: 'key', index: 0, dir: 'DESC' }] }).sql;
  assert.ok(status.includes(`(CASE g.k0 WHEN 'enabled' THEN 0 WHEN 'disabled' THEN 1 END) DESC`), 'status by its rank');
  assert.ok(plain.includes('ORDER BY g.n DESC, g.k0 COLLATE "und-x-icu" ASC NULLS FIRST'), 'without an explicit key order, the text only');

  // A measure order puts groups without a value last in either direction unless asked otherwise.
  const fteOrder = (dir: 'ASC' | 'DESC', nulls?: 'FIRST' | 'LAST') => build({ groupBy: ['currency'], measures: [{ id: 'f', fn: 'sum', field: 'fte_yBudget' }], order: [{ by: 'measure', id: 'f', dir, ...(nulls ? { nulls } : {}) }] }).sql;
  assert.ok(/END\) DESC NULLS LAST, g\.k0/.test(fteOrder('DESC')), 'descending: no value last');
  assert.ok(/END\) ASC NULLS LAST, g\.k0/.test(fteOrder('ASC')), 'ascending: no value last');
  assert.ok(/END\) DESC NULLS FIRST, g\.k0/.test(fteOrder('DESC', 'FIRST')), 'unless asked');
}

/**
 * PR E (lot 2D): a spec with keys takes at most `groupedMeasures` measures, whatever the keys (one
 * group per line through `id`, a name, a note or a combination); without keys, `measures`. The
 * report fields compile and read the tenant.
 */
function testGroupedCapAndReportFields() {
  const sums = (n: number) => Array.from({ length: n }, (_, i) => sum(`m${i}`, 'yBudget'));
  const refused = isBadRequest(new RegExp(`at most ${AGGREGATE_LIMITS.groupedMeasures} measures with group keys`));
  for (const groupBy of [['id'], ['item_number'], ['product_name'], ['notes'], ['currency'], ['supplier_name', 'notes']]) {
    assert.throws(() => validateAggregateSpec({ groupBy, measures: sums(AGGREGATE_LIMITS.groupedMeasures + 1) }), refused, groupBy.join(', '));
    assert.doesNotThrow(() => build({ groupBy, measures: sums(AGGREGATE_LIMITS.groupedMeasures) }), groupBy.join(', '));
  }
  assert.doesNotThrow(() => build({ groupBy: [], measures: sums(AGGREGATE_LIMITS.measures) }), 'one group keeps the cap of 60');
  assert.throws(() => validateAggregateSpec({ groupBy: [], measures: sums(AGGREGATE_LIMITS.measures + 1) }), isBadRequest(/at most 60 measures/));

  const axis = '22222222-2222-4222-8222-222222222222';
  const valueId = build({ groupBy: [`analytics_id_${axis}`, `analytics_${axis}`], measures: [] }, { filters: { [`analytics_id_${axis}`]: { filterType: 'set', values: [null] } } }).raw;
  assert.ok(valueId.includes(`NULLIF((ax0.category_id::text)::text, '') AS k0`), 'the value id of a dimension groups');
  assert.ok(valueId.includes(`LEFT JOIN spend_item_analytics_values ax0 ON ax0.tenant_id = $1`), 'its link reads the tenant');
  const unknownAxis = build({ groupBy: ['analytics_id_44444444-4444-4444-8444-444444444444'], measures: [] }).sql;
  assert.ok(unknownAxis.includes('NULLIF((NULL::text)::text, \'\') AS k0'), 'a dimension the tenant does not have reads null');

  const consolidation = build({ groupBy: ['account_consolidation_key', 'account_consolidation_label'], measures: [sum('b', 'yBudget')] }).raw;
  assert.ok(consolidation.includes('cons_labels AS (SELECT k.key, min(k.label COLLATE "und-x-icu") AS label'), 'one label per key, the least in the ICU order');
  assert.ok(/FROM accounts ca\s+WHERE ca\.tenant_id = \$1/.test(consolidation), 'the labels read the tenant\'s accounts');
  assert.ok(consolidation.includes('LEFT JOIN accounts acc ON acc.tenant_id = $1'), 'the line\'s account reads the tenant');
  assert.ok(consolidation.includes('AND EXISTS (SELECT 1 FROM spend_items li WHERE li.tenant_id = $1 AND li.account_id = ca.id)'), 'the labels: accounts the lines use only');
  // A caller who cannot read the accounts page: null keys and labels, as a filter or a sort too, no account read.
  const hidden = build(
    { groupBy: ['account_consolidation_key', 'account_consolidation_label'], measures: [sum('b', 'yBudget')], order: [{ by: 'key', index: 0, dir: 'ASC' }] },
    { filters: { account_consolidation_key: { filterType: 'set', values: ['c_600'] } }, sort: { field: 'account_consolidation_label', direction: 'ASC' } },
    'opex',
    false,
  ).raw;
  assert.ok(hidden.includes(`NULLIF((NULL::text)::text, '') AS k0`) && hidden.includes(`NULLIF((NULL::text)::text, '') AS k1`), 'keys read as null');
  assert.equal(/cons_labels|accounts ca|JOIN accounts/.test(hidden), false, 'no account is read for him');

  const local = build({ groupBy: ['id'], measures: [sum('l', 'local_y2026Budget'), sum('r', 'y2026Budget')] }).raw;
  assert.ok(local.includes('* 100 AS planned_local') && local.includes('* coalesce(fx.rate, 1::float8) * 100 AS planned'), 'a local amount is the same chain at rate 1');
  assert.ok(local.includes('AS y2026_planned_local') && local.includes('AS y2026_planned'), 'both read from the one amounts table');

  const version = build({ groupBy: ['has_version_yMinus2', 'has_version_y2028'], measures: [] }).raw;
  assert.ok(version.includes(`(CASE WHEN v2024.id IS NULL THEN NULL ELSE 'yes' END)`) && version.includes('LEFT JOIN spend_versions v2028 ON v2028.tenant_id = $1'), 'a version of the year, within validity');
}

/**
 * FTE lot 1: `minus` and `part` on FTE fields (A1), `has_fte` (A2) and
 * `fte_detached_…` (A3). What they return is checked on a seeded database in
 * `spend/__tests__/budget-fte-report-fields.integration.spec.ts`.
 */
function testFteReportFields() {
  const delta = build({
    groupBy: [],
    measures: [sum('d', 'fte_y2027Budget', { minus: 'fte_y2026Budget' }), sum('p', 'fte_y2027Budget', { minus: 'fte_y2026Budget', part: 'positive' })],
    having: [{ measure: 'd', op: 'gte', value: 0.5 }],
  }).raw;
  const a = `(CASE WHEN v2027.id IS NULL THEN NULL ELSE ri2027_planned.fte END)`;
  const b = `(CASE WHEN v2026.id IS NULL THEN NULL ELSE ri2026_planned.fte END)`;
  assert.ok(delta.includes(`(CASE WHEN ${a} IS NOT NULL OR ${b} IS NOT NULL THEN (coalesce(${a}, 0) - coalesce(${b}, 0)) END) AS v0`), 'null when both are unknown, else the unknown side as 0');
  assert.ok(delta.includes(`THEN greatest((coalesce(${a}, 0) - coalesce(${b}, 0)), 0) END) AS v1`), 'a part of a known value only');
  assert.ok(delta.includes('sum(agg_lines.v0) AS s0'), 'an FTE delta sums as a numeric');
  assert.ok(/>= \$\d+::numeric(?! \* 100)/.test(delta), 'an FTE bound is compared as is');

  const detached = build({ groupBy: [], measures: [sum('f', 'fte_y2026Budget'), sum('x', 'fte_detached_y2026Budget')] }, {}, 'capex').raw;
  assert.equal((detached.match(/LEFT JOIN capex_round_inputs ri2026_planned/g) ?? []).length, 1, 'one round join for the FTE and its detached part');
  assert.ok(detached.includes(`(CASE WHEN v2026.id IS NULL THEN NULL WHEN ri2026_planned.method <> 'computed' THEN ri2026_planned.fte END)`), 'detached: a round that is not computed');
  assert.equal(build({ groupBy: [], measures: [sum('x', 'fte_detached_yRevision')] }).raw.includes('ri2026_committed.method'), true, 'a fixed slot');

  for (const scope of ['opex', 'capex'] as const) {
    const { raw, params } = build({ groupBy: ['has_fte'], measures: [] }, { filters: { has_fte: { filterType: 'set', values: ['yes'] } } }, scope);
    const versions = scope === 'opex' ? 'spend_versions' : 'capex_versions';
    const rounds = scope === 'opex' ? 'spend_round_inputs' : 'capex_round_inputs';
    const fk = scope === 'opex' ? 'spend_item_id' : 'capex_item_id';
    assert.ok(raw.includes(`EXISTS (SELECT 1 FROM ${versions} hfv`), `${scope}: has_fte reads the versions`);
    assert.ok(raw.includes(`JOIN ${rounds} hfr ON hfr.tenant_id = $1 AND hfr.version_id = hfv.id AND hfr.fte IS NOT NULL`), `${scope}: its rounds for the tenant`);
    assert.ok(raw.includes(`WHERE hfv.tenant_id = $1 AND hfv.${fk} = i.id`), `${scope}: its versions for the tenant`);
    assert.ok(params.some((p) => Array.isArray(p) && p.includes('yes')), `${scope}: the filter value is bound`);
  }
}

testSpecChecks();
testFteReportFields();
testFieldsAGroupOrAMeasureRefuses();
testGroupedCapAndReportFields();
testTenantOnEveryTableAndValuesBound();
testParts();
console.log('list-aggregate.spec: ok');
