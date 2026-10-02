import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { aggregateSql, AggregateSpec, validateAggregateSpec } from '../list-aggregate';
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

function runtime(scope: 'opex' | 'capex' = 'opex'): BudgetListRuntime {
  return {
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
function build(spec: AggregateSpec, patch: Partial<ListState> = {}, scope: 'opex' | 'capex' = 'opex') {
  const stmt = new SqlStatement(TENANT);
  const raw = aggregateSql(stmt, new BudgetListConfig(runtime(scope)), state(patch), spec);
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
  assert.throws(() => build({ groupBy: [], measures: [sum('b', 'fte_yBudget', { minus: 'fte_yLanding' })] }), isBadRequest(/minus and part apply to amounts only/));
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
  assert.ok(params.includes('123456'), 'a condition on an amount is bound in cents');
  assert.ok(params.includes(7), 'the limit is bound');
  assert.equal(new Set((sql.match(/\$\d+/g) ?? []).map((p) => Number(p.slice(1)))).size, params.length, 'every parameter is read, none is left over');
}

function testParts() {
  const plain = build({ groupBy: ['currency'], measures: [sum('b', 'yBudget')] }).sql;
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
}

testSpecChecks();
testFieldsAGroupOrAMeasureRefuses();
testTenantOnEveryTableAndValuesBound();
testParts();
console.log('list-aggregate.spec: ok');
