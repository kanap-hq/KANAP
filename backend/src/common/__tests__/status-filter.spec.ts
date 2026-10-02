import * as assert from 'node:assert/strict';
import { Brackets } from 'typeorm';
import { buildStatusWhereFragment, applyStatusFilter, extractStatusFilterFromAgModel } from '../status-filter';
import { resolveLifecycleState, StatusState } from '../status';

async function testExplicitStatusFragment() {
  const fragment = buildStatusWhereFragment({
    alias: 'c',
    explicitStatus: StatusState.DISABLED,
  });
  assert.ok(fragment);
  assert.equal(fragment?.sql, '(c.disabled_at IS NOT NULL AND c.disabled_at <= :c_as_of)');
  assert.ok(fragment?.params.c_as_of instanceof Date);
}

async function testDefaultActiveFragment() {
  const fragment = buildStatusWhereFragment({ alias: 'companies' });
  assert.ok(fragment);
  assert.equal(
    fragment?.sql,
    '(companies.disabled_at IS NULL OR companies.disabled_at > :companies_as_of)',
  );
  assert.ok(fragment?.params.companies_as_of instanceof Date);
}

async function testPeriodWindowFragment() {
  const fragment = buildStatusWhereFragment({
    alias: 'd',
    period: { start: '2024-01-01', end: '2024-12-31' },
  });
  assert.ok(fragment);
  assert.equal(fragment?.sql, '(d.disabled_at IS NULL OR d.disabled_at >= :d_period_start)');
  assert.ok(fragment?.params.d_period_start instanceof Date);
}

async function testPeriodStartBoundaryInclusive() {
  // When only a period.start is provided and status is neutral, we gate using
  // disabled_at >= :period_start (inclusive of the start boundary).
  const fragment = buildStatusWhereFragment({ alias: 't', period: { start: '2025-01-01' } });
  assert.ok(fragment);
  assert.equal(fragment?.sql, '(t.disabled_at IS NULL OR t.disabled_at >= :t_period_start)');
  const start = fragment?.params?.t_period_start as Date;
  assert.ok(start instanceof Date);
  assert.equal(start.toISOString().slice(0, 10), '2025-01-01');
}

async function testPeriodStartPreferredOverAsOfWhenNeutral() {
  // If both asOf and period.start are provided without explicit status,
  // the period.start comparison should be used (not as_of), to match period window intent.
  const fragment = buildStatusWhereFragment({ alias: 'x', asOf: '2027-01-01', period: { start: '2026-01-01' } });
  assert.ok(fragment);
  assert.equal(fragment?.sql, '(x.disabled_at IS NULL OR x.disabled_at >= :x_period_start)');
  // Ensure we did not set x_as_of when period.start drives the condition
  assert.ok(!('x_as_of' in (fragment?.params || {})));
}

async function testApplyStatusFilterAddsClause() {
  // applyStatusFilter wraps the fragment in a Brackets; unwrap it the way TypeORM would.
  const clauses: Array<{ sql: string; params: Record<string, unknown> }> = [];
  const qb = {
    andWhere(condition: Brackets) {
      assert.ok(condition instanceof Brackets);
      condition.whereFactory({
        where(sql: string, params: Record<string, unknown>) {
          clauses.push({ sql, params });
          return this;
        },
      } as any);
      return this;
    },
  };

  const result = applyStatusFilter(qb as any, { alias: 'x' });
  assert.equal(result, qb);
  assert.equal(clauses.length, 1);
  assert.match(clauses[0].sql, /x\.disabled_at IS NULL OR x\.disabled_at > :x_as_of/);
}

async function testApplyStatusFilterSkipsWhenIncludingDisabled() {
  let called = false;
  const qb = {
    andWhere() {
      called = true;
      return this;
    },
  };
  const result = applyStatusFilter(qb as any, { alias: 'x', includeDisabled: true });
  assert.equal(result, qb);
  assert.equal(called, false);
}

async function testExplicitStatusAppliesWithIncludeDisabled() {
  // "All" lifts only the default scope: a status ticked in the column filter still applies.
  const disabled = buildStatusWhereFragment({ alias: 'c', explicitStatus: StatusState.DISABLED, includeDisabled: true });
  assert.equal(disabled?.sql, '(c.disabled_at IS NOT NULL AND c.disabled_at <= :c_as_of)');
  const enabled = buildStatusWhereFragment({ alias: 'c', explicitStatus: StatusState.ENABLED, includeDisabled: true });
  assert.equal(enabled?.sql, '(c.disabled_at IS NULL OR c.disabled_at > :c_as_of)');
  const withPeriod = buildStatusWhereFragment({
    alias: 'c',
    explicitStatus: StatusState.DISABLED,
    includeDisabled: true,
    period: { start: '2026-01-01', end: '2026-12-31T23:59:59.999Z' },
  });
  assert.equal(withPeriod?.sql, '(c.disabled_at IS NOT NULL AND c.disabled_at <= :c_as_of)');
  assert.equal((withPeriod?.params.c_as_of as Date).toISOString(), '2026-12-31T23:59:59.999Z');
  assert.equal(buildStatusWhereFragment({ alias: 'c', explicitStatus: null, includeDisabled: true }), null);
}

async function testEmptySetMatchesNothing() {
  // The checklist's Clear sends an empty set: nothing matches, as in the generic filter engine.
  const cleared = extractStatusFilterFromAgModel({ status: { filterType: 'set', values: [] }, name: { filter: 'x' } });
  assert.deepEqual(cleared, { matchNone: true, sanitizedFilters: { name: { filter: 'x' } } });
  // A set holding no status value matches nothing too.
  assert.equal(extractStatusFilterFromAgModel({ status: { filterType: 'set', values: ['archived'] } }).matchNone, true);
  // One status, or both (no constraint), never match nothing.
  assert.deepEqual(extractStatusFilterFromAgModel({ status: { filterType: 'set', values: ['disabled'] } }), { status: StatusState.DISABLED, sanitizedFilters: {} });
  assert.deepEqual(extractStatusFilterFromAgModel({ status: { filterType: 'set', values: ['enabled', 'disabled'] } }), { sanitizedFilters: {} });
  assert.deepEqual(extractStatusFilterFromAgModel({ name: { filter: 'x' } }), { sanitizedFilters: { name: { filter: 'x' } } });

  // The fragment is `1 = 0` whatever the scope or an explicit status.
  for (const opts of [{}, { includeDisabled: true }, { explicitStatus: StatusState.ENABLED }, { period: { start: '2026-01-01' } }]) {
    assert.deepEqual(buildStatusWhereFragment({ alias: 'c', matchNone: true, ...opts }), { sql: '1 = 0', params: {} });
  }
}

async function testDisabledWithoutADate() {
  // "Disabled" without a date: a date already passed stays, otherwise the end of validity is now.
  const now = new Date('2026-10-01T10:00:00Z');
  const nowFactory = () => now;
  const past = new Date('2025-03-31T12:00:00Z');
  const future = new Date('2031-06-30T12:00:00Z');
  assert.deepEqual(resolveLifecycleState({ currentDisabledAt: past, nextStatus: 'disabled', nowFactory }), { status: StatusState.DISABLED, disabled_at: past });
  assert.deepEqual(resolveLifecycleState({ currentDisabledAt: future, nextStatus: 'disabled', nowFactory }), { status: StatusState.DISABLED, disabled_at: now });
  assert.deepEqual(resolveLifecycleState({ currentDisabledAt: null, nextStatus: 'disabled', nowFactory }), { status: StatusState.DISABLED, disabled_at: now });
  // A date given wins; enabled clears the date.
  assert.deepEqual(resolveLifecycleState({ currentDisabledAt: past, nextStatus: 'disabled', nextDisabledAt: future, nowFactory }), { status: StatusState.ENABLED, disabled_at: future });
  assert.deepEqual(resolveLifecycleState({ currentDisabledAt: future, nextStatus: 'enabled', nowFactory }), { status: StatusState.ENABLED, disabled_at: null });
}

async function testExcludeMode() {
  // Exclude mode (the user unticked values from "all"): the statuses kept are the others.
  const read = (values: unknown[]) => extractStatusFilterFromAgModel({ status: { filterType: 'set', mode: 'exclude', values }, other: { filterType: 'text' } });
  assert.deepEqual(read(['disabled']), { status: StatusState.ENABLED, sanitizedFilters: { other: { filterType: 'text' } } });
  assert.deepEqual(read(['enabled']), { status: StatusState.DISABLED, sanitizedFilters: { other: { filterType: 'text' } } });
  assert.deepEqual(read([]), { sanitizedFilters: { other: { filterType: 'text' } } }, 'nothing unticked: every status');
  assert.deepEqual(read(['enabled', 'disabled']), { matchNone: true, sanitizedFilters: { other: { filterType: 'text' } } }, 'everything unticked: no line');
  assert.deepEqual(read(['bogus']), { sanitizedFilters: { other: { filterType: 'text' } } }, 'an unknown value excludes nothing');
}

(async () => {
  await testExcludeMode();
  await testEmptySetMatchesNothing();
  await testDisabledWithoutADate();
  await testExplicitStatusFragment();
  await testExplicitStatusAppliesWithIncludeDisabled();
  await testDefaultActiveFragment();
  await testPeriodWindowFragment();
  await testPeriodStartBoundaryInclusive();
  await testPeriodStartPreferredOverAsOfWhenNeutral();
  await testApplyStatusFilterAddsClause();
  await testApplyStatusFilterSkipsWhenIncludingDisabled();
  console.log('Status filter helper tests passed.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
