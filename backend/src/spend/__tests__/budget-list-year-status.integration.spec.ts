import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { SpendItemsService } from '../spend-items.service';
import { CapexItemsService } from '../../capex/capex-items.service';
import {
  assert,
  inRolledBackTransaction,
  Kind,
  repeat,
  runSpecs,
  seedItem,
  seedMonths,
  seedTenant,
  seedVersion,
  setTenant,
  TABLES,
} from './round-inputs.fixtures';

// The OPEX and CAPEX lists' Enabled and Disabled read the current year: a line
// whose end of validity falls on or after January 1 (UTC) is Enabled for the
// whole year, a line that ended before January 1 is Disabled. Pages, counts,
// the status column filter, ids, neighbours, footer totals, filter values and
// aggregates agree; another tenant's lines are never counted. The item pickers
// (`list`) keep "not ended as of now".
// @database-spec: runSpecs opens the data-source, so run-ci-tests.js runs this file in its serial database lane.

// The year the list reads (`readRequest`: `new Date().getFullYear()`). Every date below is a UTC
// instant; the Enabled and Disabled assertions depend on the year only, never on the time of the run.
const Y = new Date().getFullYear();
const KINDS: Kind[] = ['opex', 'capex'];

const identityFx = {
  resolveRates: async () => ({ map: new Map(), settings: { reportingCurrency: 'EUR' } }),
  convertValue: (amount: number, rate: number) => amount * rate,
};
const noAllocations = { computeForVersions: async () => new Map() };

function itemService(kind: Kind): any {
  if (kind === 'opex') {
    const args: any[] = Array.from({ length: 11 }, () => undefined);
    args[4] = noAllocations;
    args[6] = identityFx;
    return new (SpendItemsService as any)(...args);
  }
  const args: any[] = Array.from({ length: 12 }, () => undefined);
  args[4] = noAllocations;
  args[7] = identityFx;
  return new (CapexItemsService as any)(...args);
}

type LineKey = 'lastYear' | 'lastInstant' | 'yearStart' | 'earlier' | 'later' | 'nextYear' | 'blank';

/** In this year and, except in the year's first day, already passed: yesterday, or January 1 (UTC). */
const earlierThisYear = new Date(Math.max(Date.UTC(Y, 0, 1), Date.now() - 24 * 3600 * 1000)).toISOString();

/** Each line: item number, end of validity, monthly Budget of Y-1 (distinct powers of two, so a sum names its lines). */
const LINES: Record<LineKey, { n: number; end: string | null; monthly: number }> = {
  lastYear: { n: 1, end: `${Y - 1}-06-30T12:00:00.000Z`, monthly: 1 },
  lastInstant: { n: 2, end: `${Y - 1}-12-31T23:59:59.999Z`, monthly: 2 },
  yearStart: { n: 3, end: `${Y}-01-01T00:00:00.000Z`, monthly: 4 },
  earlier: { n: 4, end: earlierThisYear, monthly: 8 },
  later: { n: 5, end: `${Y}-12-31T12:00:00.000Z`, monthly: 16 },
  nextYear: { n: 6, end: `${Y + 1}-06-30T12:00:00.000Z`, monthly: 32 },
  blank: { n: 7, end: null, monthly: 64 },
};
const ENABLED: LineKey[] = ['yearStart', 'earlier', 'later', 'nextYear', 'blank'];
const DISABLED: LineKey[] = ['lastYear', 'lastInstant'];
const yearBudget = (keys: LineKey[]) => keys.reduce((sum, key) => sum + LINES[key].monthly * 12, 0);

type Fixture = { tenantId: string; ids: Record<LineKey, string> };

/** A line per key with its own supplier (named after the line), a Y-1 version and twelve Budget months. */
async function seedLines(runner: QueryRunner, kind: Kind, tenantId: string, prefix: string, monthlyScale = 1): Promise<Record<LineKey, string>> {
  const ids = {} as Record<LineKey, string>;
  for (const [key, line] of Object.entries(LINES) as Array<[LineKey, (typeof LINES)[LineKey]]>) {
    const id = await seedItem(runner, kind, tenantId, line.n, `${prefix} ${key}`);
    const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, `${prefix} ${key}`]);
    await runner.query(
      `UPDATE ${TABLES[kind].items} SET supplier_id = $2, disabled_at = $3, status = $4 WHERE id = $1`,
      [id, supplier.id, line.end, line.end && new Date(line.end).getTime() <= Date.now() ? 'disabled' : 'enabled'],
    );
    const versionId = await seedVersion(runner, kind, tenantId, id, Y - 1);
    await seedMonths(runner, kind, tenantId, versionId, Y - 1, { planned: repeat(String(line.monthly * monthlyScale), 12) });
    ids[key] = id;
  }
  return ids;
}

async function withFixture(kind: Kind, fn: (runner: QueryRunner, fixture: Fixture, svc: any) => Promise<void>) {
  await inRolledBackTransaction(async (runner) => {
    // Another tenant first, with the same lines and far larger amounts: never counted.
    const otherTenant = await seedTenant(runner, `year-status-other-${kind}`);
    await seedLines(runner, kind, otherTenant, 'Other', 1000);
    const tenantId = await seedTenant(runner, `year-status-${kind}`);
    await setTenant(runner, tenantId);
    const ids = await seedLines(runner, kind, tenantId, 'Line');
    await fn(runner, { tenantId, ids }, itemService(kind));
  });
}

const BY_NUMBER = { sort: 'item_number:ASC', limit: 100 };
const ALL = { includeDisabled: 'true' };
const statusFilter = (values: string[]) => JSON.stringify({ status: { filterType: 'set', values } });

async function testPagesAndCounts(kind: Kind) {
  await withFixture(kind, async (runner, { ids }, svc) => {
    const opts = { manager: runner.manager };
    const idsOf = (keys: LineKey[]) => keys.map((key) => ids[key]);
    const enabled = await svc.summary({ ...BY_NUMBER, status: 'enabled' }, opts);
    assert.deepEqual(enabled.items.map((row: any) => row.id), idsOf(ENABLED), `${kind}: Enabled keeps every line not ended before January 1`);
    assert.equal(enabled.total, ENABLED.length, `${kind}: the Enabled count`);
    const disabled = await svc.summary({ ...BY_NUMBER, status: 'disabled' }, opts);
    assert.deepEqual(disabled.items.map((row: any) => row.id), idsOf(DISABLED), `${kind}: Disabled holds the lines ended before January 1`);
    assert.equal(disabled.total, DISABLED.length, `${kind}: the Disabled count`);
    const all = await svc.summary({ ...BY_NUMBER, ...ALL }, opts);
    assert.equal(all.total, ENABLED.length + DISABLED.length, `${kind}: All is unchanged and holds this tenant's lines only`);

    // A page past the end counts the list apart.
    const pastEnd = await svc.summary({ status: 'enabled', page: 3, limit: 2 }, opts);
    assert.deepEqual([pastEnd.items.length, pastEnd.total], [1, ENABLED.length], `${kind}: the last page of Enabled`);
    const beyond = await svc.summary({ status: 'enabled', page: 9, limit: 2 }, opts);
    assert.deepEqual([beyond.items.length, beyond.total], [0, ENABLED.length], `${kind}: a page past the end still counts Enabled`);

    // The status column filter (the AI's status filter too) follows the same rule, also under "all".
    const ticked = await svc.summary({ ...BY_NUMBER, ...ALL, filters: statusFilter(['disabled']) }, opts);
    assert.deepEqual(ticked.items.map((row: any) => row.id), idsOf(DISABLED), `${kind}: the column filter's Disabled`);
    const tickedEnabled = await svc.summary({ ...BY_NUMBER, filters: statusFilter(['enabled']) }, opts);
    assert.deepEqual(tickedEnabled.items.map((row: any) => row.id), idsOf(ENABLED), `${kind}: the column filter's Enabled`);
  });
}

async function testIdsAndNeighbours(kind: Kind) {
  await withFixture(kind, async (runner, { ids }, svc) => {
    const opts = { manager: runner.manager };
    const idsOf = (keys: LineKey[]) => keys.map((key) => ids[key]);
    const enabled = await svc.summaryIds({ ...BY_NUMBER, status: 'enabled' }, opts);
    assert.deepEqual([enabled.ids, enabled.total], [idsOf(ENABLED), ENABLED.length], `${kind}: the Enabled ids`);
    assert.deepEqual(enabled.item_numbers, ENABLED.map((key) => LINES[key].n), `${kind}: with their references`);
    const fallback = await svc.summaryIds({ sort: 'item_number:ASC' }, opts);
    assert.deepEqual(fallback.ids, idsOf(ENABLED), `${kind}: without a status, the ids are the Enabled lines`);
    const disabled = await svc.summaryIds({ ...BY_NUMBER, status: 'disabled' }, opts);
    assert.deepEqual(disabled.ids, idsOf(DISABLED), `${kind}: the Disabled ids`);

    // The workspace of a line that ended earlier this year walks the Enabled list.
    const earlier = await svc.summaryNeighbors({ sort: 'item_number:ASC', status: 'enabled' }, ids.earlier, opts);
    assert.deepEqual(
      [earlier.index, earlier.total, earlier.prev?.id, earlier.next?.id],
      [1, ENABLED.length, ids.yearStart, ids.later],
      `${kind}: neighbours in Enabled`,
    );
    const noStatus = await svc.summaryNeighbors({ sort: 'item_number:ASC' }, ids.yearStart, opts);
    assert.deepEqual([noStatus.index, noStatus.prev, noStatus.next?.id], [0, null, ids.earlier], `${kind}: without a status, neighbours in Enabled`);
    const ended = await svc.summaryNeighbors({ sort: 'item_number:ASC' }, ids.lastInstant, opts);
    assert.deepEqual([ended.index, ended.total], [null, ENABLED.length], `${kind}: a line ended last year is not in Enabled`);
    const inDisabled = await svc.summaryNeighbors({ sort: 'item_number:ASC', status: 'disabled' }, ids.lastInstant, opts);
    assert.deepEqual(
      [inDisabled.index, inDisabled.total, inDisabled.prev?.id, inDisabled.next],
      [1, DISABLED.length, ids.lastYear, null],
      `${kind}: neighbours in Disabled`,
    );
    const notDisabled = await svc.summaryNeighbors({ sort: 'item_number:ASC', status: 'disabled' }, ids.earlier, opts);
    assert.equal(notDisabled.index, null, `${kind}: a line ended earlier this year is not in Disabled`);
  });
}

async function testTotalsFilterValuesAndAggregates(kind: Kind) {
  await withFixture(kind, async (runner, _fixture, svc) => {
    const opts = { manager: runner.manager };
    const totals = (query: Record<string, unknown>) => svc.summaryTotals({ ...query, amounts: 'yMinus1Budget' }, opts);
    assert.equal((await totals({ status: 'enabled' })).yMinus1Budget, yearBudget(ENABLED), `${kind}: the Enabled footer total`);
    assert.equal((await totals({})).yMinus1Budget, yearBudget(ENABLED), `${kind}: without a status, the Enabled footer total`);
    assert.equal((await totals({ status: 'disabled' })).yMinus1Budget, yearBudget(DISABLED), `${kind}: the Disabled footer total`);
    assert.equal((await totals(ALL)).yMinus1Budget, yearBudget([...ENABLED, ...DISABLED]), `${kind}: the All footer total, this tenant only`);

    const names = (keys: LineKey[]) => keys.map((key) => `Line ${key}`).sort();
    const values = async (query: Record<string, unknown>) => ((await svc.summaryFilterValues({ ...query, fields: 'supplier_name' }, opts)).supplier_name as string[]).slice().sort();
    assert.deepEqual(await values({ status: 'enabled' }), names(ENABLED), `${kind}: the Enabled filter values`);
    assert.deepEqual(await values({ status: 'disabled' }), names(DISABLED), `${kind}: the Disabled filter values`);

    const spec = { groupBy: [], measures: [{ id: 'budget', fn: 'sum', field: 'yMinus1Budget' }] };
    const enabled: any = await svc.summaryAggregate({ status: 'enabled' }, spec, opts);
    assert.deepEqual([enabled.total.count, enabled.total.values.budget], [ENABLED.length, yearBudget(ENABLED)], `${kind}: the Enabled aggregate`);
    const disabled: any = await svc.summaryAggregate({ status: 'disabled' }, spec, opts);
    assert.deepEqual([disabled.total.count, disabled.total.values.budget], [DISABLED.length, yearBudget(DISABLED)], `${kind}: the Disabled aggregate`);
  });
}

/**
 * The item pickers (`GET /spend-items`, `/capex-items`) keep "not ended as of now". What has ended
 * depends on the time of the run (31 December afternoon, the first hours of the year in another
 * time zone), so the expectation reads the clock the picker reads: the transaction's `now()`.
 */
async function testPickersKeepTheirRule(kind: Kind) {
  await withFixture(kind, async (runner, { ids }, svc) => {
    const opts = { manager: runner.manager };
    const [{ now }] = await runner.query(`SELECT now() AS now`);
    const at = new Date(now).getTime();
    const keys = Object.keys(LINES) as LineKey[];
    const endOf = (key: LineKey) => (LINES[key].end == null ? Infinity : new Date(LINES[key].end!).getTime());
    const listed = new Set((await svc.list({ status: 'enabled', limit: 100 }, opts)).items.map((item: any) => item.id));
    assert.deepEqual(keys.filter((key) => listed.has(ids[key])), keys.filter((key) => endOf(key) > at), `${kind}: the picker keeps the lines not ended as of now`);
    // Well after any run time: always listed.
    assert.ok(listed.has(ids.nextYear) && listed.has(ids.blank), `${kind}: the picker keeps the lines still running`);
    // A line that ended earlier this year: in Enabled, not in the picker (except on the year's first day, where it may not have ended yet).
    if (endOf('earlier') <= at) assert.ok(!listed.has(ids.earlier), `${kind}: the picker leaves out a line already ended this year`);
  });
}

runSpecs('budget list year status', [
  ...KINDS.flatMap((kind): Array<[string, () => Promise<void>]> => [
    [`pages and counts (${kind})`, () => testPagesAndCounts(kind)],
    [`ids and neighbours (${kind})`, () => testIdsAndNeighbours(kind)],
    [`totals, filter values and aggregates (${kind})`, () => testTotalsFilterValuesAndAggregates(kind)],
    [`pickers keep their rule (${kind})`, () => testPickersKeepTheirRule(kind)],
  ]),
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
