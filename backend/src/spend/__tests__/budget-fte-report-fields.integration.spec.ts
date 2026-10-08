import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import type { AggregateSpec } from '../../common/list-engine/list-aggregate';
import { resolveFteDetachedField, resolveFteField, SUMMARY_SCOPES, SummaryScopeConfig, yearsNamedByFields } from '../spend-summary.builder';
import * as engine from '../budget-list/budget-list.service';
import { realSummaryDeps } from './oracle/oracle-deps';

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
// @database-spec: opens the data-source, so run-ci-tests.js runs this file in its serial database lane.

const Y = new Date().getFullYear();

type Round = { year: number; measure: string; method: 'computed' | 'spread' | 'manual' | 'copied'; fte: string | null };
type Line = { label: string; rounds?: Round[]; versionYears?: number[] };

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
       VALUES ($1, $2, $3, $4, 'EUR', '2020-01-01', 'enabled', now(), now())`,
      [itemId, tenantId, itemNumber, `FTE ${line.label}`],
    );
  } else {
    await runner.query(
      `INSERT INTO capex_items (id, tenant_id, item_number, description, ppe_type, investment_type, priority, currency, effective_start)
       VALUES ($1, $2, $3, $4, 'hardware', 'other', 'low', 'EUR', '2020-01-01')`,
      [itemId, tenantId, itemNumber, `FTE ${line.label}`],
    );
  }
  const years = new Set([...(line.versionYears ?? []), ...(line.rounds ?? []).map((round) => round.year)]);
  const versions = new Map<number, string>();
  for (const year of years) {
    const versionId = randomUUID();
    versions.set(year, versionId);
    if (scope.scope === 'opex') {
      await runner.query(
        `INSERT INTO spend_versions (id, tenant_id, spend_item_id, version_name, input_grain, as_of_date, budget_year, allocation_method)
         VALUES ($1, $2, $3, 'Y' || $5::int, 'monthly', $4::date, $5::int, 'default')`,
        [versionId, tenantId, itemId, `${year}-01-01`, year],
      );
    } else {
      await runner.query(
        `INSERT INTO capex_versions (id, tenant_id, capex_item_id, version_name, as_of_date, budget_year, allocation_method)
         VALUES ($1, $2, $3, 'Y' || $5::int, $4::date, $5::int, 'default')`,
        [versionId, tenantId, itemId, `${year}-01-01`, year],
      );
    }
  }
  for (const round of line.rounds ?? []) {
    await runner.query(
      `INSERT INTO ${scope.roundTable} (tenant_id, version_id, measure, period_start, period_end, method, fte)
       VALUES ($1, $2, $3, make_date($4, 1, 1), make_date($4, 12, 31), $5, $6::numeric)`,
      [tenantId, versions.get(round.year), round.measure, round.year, round.method, round.fte],
    );
  }
  return itemId;
}

const sum = (id: string, field: string, extra: object = {}) => ({ id, fn: 'sum' as const, field, ...extra });

function testKeyParsing() {
  assert.equal(resolveFteField('fte_detached_yBudget'), null, 'fte_ resolution leaves fte_detached_ alone');
  assert.equal(resolveFteField(`fte_detached_y${Y}Budget`), null);
  assert.equal(resolveFteDetachedField(`fte_detached_y${Y}Budget`)?.year, Y);
  assert.equal(resolveFteDetachedField('fte_detached_yRevision')?.column.measure, 'committed');
  assert.equal(resolveFteDetachedField('fte_yBudget'), null);
  assert.equal(resolveFteDetachedField('fte_detached_nonsense'), null);
  assert.deepEqual(yearsNamedByFields([`fte_detached_y${Y - 4}Budget`]), [Y - 4], 'a detached key names its year (bounds, loaded slots)');
  assert.deepEqual(engine.parseFteKeys(`fte_detached_yBudget,fte_detached_y${Y}Budget,fte_yBudget`, Y).map((fte) => fte.key), ['fte_yBudget'], 'grid FTE keys ignore detached keys');
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

async function main() {
  testKeyParsing();
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = await insertTenant(runner, 'main');
    const otherTenantId = await insertTenant(runner, 'other');
    for (const scope of [SUMMARY_SCOPES.opex, SUMMARY_SCOPES.capex]) await checkScope(runner, scope, tenantId, otherTenantId);
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
