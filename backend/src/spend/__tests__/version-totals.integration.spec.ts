import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { toCents } from '../../common/amount';
import { VersionTotals1853720000000 } from '../../migrations/1853720000000-version-totals';
import { loadVersionTotals, SUMMARY_COLUMNS, SUMMARY_SCOPES } from '../spend-summary.builder';
import {
  amountsService,
  assert,
  inRolledBackTransaction,
  Kind,
  Measure,
  MEASURES,
  period,
  repeat,
  runSpecs,
  seedItem,
  seedLine,
  seedMonths,
  seedTenant,
  seedVersion,
  setTenant,
  TABLES,
} from './round-inputs.fixtures';
import { DORMANT_CAPEX_TABLES, seedDormantCapexItem, seedDormantCapexVersion } from './dormant-capex.fixtures';

// Budget totals per version kept by the amounts triggers (migration
// 1853720000000), against the database: every way months are written,
// moved and deleted (cascades included) leaves `*_version_totals` equal to
// the sums the list engine used to aggregate (months of the version's own
// year, NULL as zero; a version whose months were all deleted keeps a row of
// zeros); the summary reads the same cents as the old aggregate; the rebuild
// and a rerun of the migration repair a damaged tenant; a TRUNCATE and a
// change of budget year cannot leave the totals behind.
// @database-spec: run-ci-tests.js runs this file in its serial database lane.

const KINDS: Kind[] = ['opex', 'capex'];
const YEAR = 2034;

/**
 * The tables a check reads. The OPEX and CAPEX lines share the spend_* tables since lot Z1. The
 * dormant capex_* tables (dropped by lot Z2) keep their triggers, and the rebuild function and the
 * migration still repair them: their test seeds its CAPEX case there (`capex_dormant`).
 */
type Family = Kind | 'capex_dormant';
const FAMILY: Record<Family, { versions: string; amounts: string; totals: string }> = {
  opex: { versions: TABLES.opex.versions, amounts: TABLES.opex.amounts, totals: 'spend_version_totals' },
  capex: { versions: TABLES.capex.versions, amounts: TABLES.capex.amounts, totals: 'spend_version_totals' },
  capex_dormant: { versions: DORMANT_CAPEX_TABLES.versions, amounts: DORMANT_CAPEX_TABLES.amounts, totals: DORMANT_CAPEX_TABLES.totals },
};

const identityFx = {
  resolveRates: async () => ({ map: new Map(), settings: { reportingCurrency: 'EUR' } }),
  convertValue: (amount: number, rate: number) => amount * rate,
};

type Sums = Record<string, string>;

const asText = (alias: string) => MEASURES.map((m) => `${alias}.${m}::numeric(20, 2)::text AS ${m}`).join(', ');

/** Per version of the tenant, the sums of its months of its own year, recomputed from the amounts (NULL as 0). */
async function recomputed(runner: QueryRunner, kind: Family, tenantId: string): Promise<Map<string, Sums>> {
  const rows = await runner.query(
    `SELECT s.version_id, ${asText('s')}
     FROM (SELECT a.version_id, ${MEASURES.map((m) => `sum(coalesce(a.${m}, 0)) AS ${m}`).join(', ')}
           FROM ${FAMILY[kind].amounts} a
           JOIN ${FAMILY[kind].versions} v ON v.id = a.version_id AND v.tenant_id = a.tenant_id
           WHERE a.tenant_id = $1 AND EXTRACT(YEAR FROM a.period) = v.budget_year
           GROUP BY a.version_id) s`,
    [tenantId],
  );
  return new Map(rows.map((row: any) => [row.version_id, Object.fromEntries(MEASURES.map((m) => [m, row[m]]))]));
}

/** The stored totals of the tenant, keyed like `recomputed`. */
async function stored(runner: QueryRunner, kind: Family, tenantId: string): Promise<Map<string, Sums>> {
  const rows = await runner.query(`SELECT t.version_id, ${asText('t')} FROM ${FAMILY[kind].totals} t WHERE t.tenant_id = $1`, [tenantId]);
  return new Map(rows.map((row: any) => [row.version_id, Object.fromEntries(MEASURES.map((m) => [m, row[m]]))]));
}

const sorted = <T>(map: Map<string, T>) => new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));

/**
 * The stored totals are exactly the recomputed sums: no missing row, no
 * different value, and a row of a version without any month in its year
 * holds zeros (the triggers never delete a row).
 */
async function assertTotalsMatch(runner: QueryRunner, kind: Family, tenantId: string, label: string) {
  const expected = await recomputed(runner, kind, tenantId);
  const actual = await stored(runner, kind, tenantId);
  for (const versionId of actual.keys()) if (!expected.has(versionId)) expected.set(versionId, zeros);
  assert.deepEqual(sorted(actual), sorted(expected), `${kind}: ${label}`);
}

/** The stored row of one version (the five sums as 2-decimal text, and its ctid), or undefined. */
async function totalsRow(runner: QueryRunner, kind: Family, versionId: string) {
  const [row] = await runner.query(`SELECT t.ctid::text AS ctid, ${asText('t')} FROM ${FAMILY[kind].totals} t WHERE t.version_id = $1`, [versionId]);
  return row as (Sums & { ctid: string }) | undefined;
}

const values = (row: (Sums & { ctid?: string }) | undefined) => (row ? Object.fromEntries(MEASURES.map((m) => [m, row[m]])) : undefined);
const zeros = Object.fromEntries(MEASURES.map((m) => [m, '0.00']));

/**
 * The summary's version totals (cents and reporting) of every line of the
 * tenant, against the aggregate the builder ran before the totals tables:
 * same versions, same cents, a reporting entry exactly for those versions.
 * The one difference: a version whose months were all deleted keeps a row of
 * zeros, so the summary reports it with zeros where the aggregate had no row
 * (`emptied` lists the versions expected so).
 */
async function assertSummaryMatchesAggregate(runner: QueryRunner, kind: Kind, tenantId: string, years: number[], label: string, emptied: string[] = []) {
  const config = SUMMARY_SCOPES[kind];
  const items = await runner.query(`SELECT * FROM ${TABLES[kind].items} WHERE tenant_id = $1`, [tenantId]);
  const totals = await loadVersionTotals(config, { fxRates: identityFx as any }, runner.manager, tenantId, items, years, { reporting: true });
  const kept = Array.from(totals.versionsByItemYear.values()).flatMap((perYear) => Array.from(perYear.values()));
  const rows: Array<Record<string, string>> = kept.length
    ? await runner.query(
      `SELECT a.version_id, ${SUMMARY_COLUMNS.map((c) => `COALESCE(SUM(a.${c.measure}), 0)::text AS ${c.measure}`).join(', ')}
       FROM ${TABLES[kind].amounts} a
       JOIN ${TABLES[kind].versions} v ON v.id = a.version_id AND v.tenant_id = a.tenant_id
       WHERE a.tenant_id = $1 AND a.version_id = ANY($2::uuid[]) AND EXTRACT(YEAR FROM a.period) = v.budget_year
       GROUP BY a.version_id`,
      [tenantId, kept.map((v) => v.id)],
    )
    : [];
  const expected = new Map(rows.map((row) => [row.version_id, Object.fromEntries(SUMMARY_COLUMNS.map((c) => [c.key, toCents(row[c.measure])]))]));
  assert.ok(expected.size > 0, `${kind}: ${label}: the comparison covers versions with months`);
  for (const versionId of emptied) {
    assert.ok(!expected.has(versionId), `${kind}: ${label}: an emptied version has no month in its year`);
    expected.set(versionId, Object.fromEntries(SUMMARY_COLUMNS.map((c) => [c.key, 0n])));
  }
  assert.deepEqual(sorted(totals.cents), sorted(expected), `${kind}: ${label}: summary cents equal the old aggregate`);
  assert.deepEqual([...totals.reporting.keys()].sort(), [...expected.keys()].sort(), `${kind}: ${label}: reported versions`);
}

async function insertMonth(runner: QueryRunner, kind: Family, tenantId: string, versionId: string, month: string, cells: Record<string, string | null>) {
  const measures = Object.keys(cells);
  await runner.query(
    `INSERT INTO ${FAMILY[kind].amounts} (tenant_id, version_id, period${measures.map((m) => `, ${m}`).join('')})
     VALUES ($1, $2, $3${measures.map((_, i) => `, $${i + 4}`).join('')})`,
    [tenantId, versionId, month, ...measures.map((m) => cells[m])],
  );
}

/** Months inserted one by one and in one statement, NULL and zero included. */
async function testInsertedMonths(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `vt-insert-${kind}`);
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR, {
      planned: repeat('100.10', 12), committed: repeat('3', 12), forecast: repeat('0.01', 12), actual: repeat('-2.5', 12),
    });
    assert.deepEqual(
      values(await totalsRow(runner, kind, versionId)),
      { planned: '1201.20', committed: '36.00', forecast: '0.12', actual: '-30.00', expected_landing: '0.00' },
      `${kind}: twelve single-row inserts add up, an omitted column is 0`,
    );

    // One statement, three months; NULL counts as zero.
    const nextVersion = await seedVersion(runner, kind, tenantId, itemId, YEAR + 1);
    await runner.query(
      `INSERT INTO ${TABLES[kind].amounts} (tenant_id, version_id, period, planned, forecast, expected_landing)
       VALUES ($1, $2, $3, 10, NULL, NULL), ($1, $2, $4, NULL, 4, NULL), ($1, $2, $5, 5.55, 1, NULL)`,
      [tenantId, nextVersion, period(1, YEAR + 1), period(2, YEAR + 1), period(3, YEAR + 1)],
    );
    const next = await totalsRow(runner, kind, nextVersion);
    assert.deepEqual([next?.planned, next?.forecast, next?.expected_landing, next?.committed], ['15.55', '5.00', '0.00', '0.00'], `${kind}: a multi-row insert, NULL as 0`);

    // A version whose only months hold NULL or zero still has its row (the summary reports it with zeros).
    const nullVersion = await seedVersion(runner, kind, tenantId, itemId, YEAR + 2);
    await insertMonth(runner, kind, tenantId, nullVersion, period(5, YEAR + 2), Object.fromEntries(MEASURES.map((m) => [m, null])));
    await insertMonth(runner, kind, tenantId, nullVersion, period(6, YEAR + 2), {});
    assert.deepEqual(values(await totalsRow(runner, kind, nullVersion)), zeros, `${kind}: months of NULL and zero give a row of zeros`);
    // A version without any month has no row.
    const emptyVersion = await seedVersion(runner, kind, tenantId, itemId, YEAR + 3);
    assert.equal(await totalsRow(runner, kind, emptyVersion), undefined, `${kind}: no month, no row`);

    await assertTotalsMatch(runner, kind, tenantId, 'after the inserts');
    await assertSummaryMatchesAggregate(runner, kind, tenantId, [YEAR, YEAR + 1, YEAR + 2, YEAR + 3], 'after the inserts');
  });
}

/** Months outside their version's year count nowhere, like in the aggregate. */
async function testOffYearMonths(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `vt-offyear-${kind}`);
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('10', 12) });
    const before = await totalsRow(runner, kind, versionId);
    await insertMonth(runner, kind, tenantId, versionId, period(1, YEAR + 1), { planned: '500' });
    await insertMonth(runner, kind, tenantId, versionId, period(12, YEAR - 1), { planned: '700' });
    const after = await totalsRow(runner, kind, versionId);
    assert.equal(after?.planned, '120.00', `${kind}: months of other years are not counted`);
    assert.equal(after?.ctid, before?.ctid, `${kind}: nor do they write the row`);

    // A version with months of other years only has no row.
    const otherVersion = await seedVersion(runner, kind, tenantId, itemId, YEAR + 2);
    await insertMonth(runner, kind, tenantId, otherVersion, period(3, YEAR), { planned: '9' });
    assert.equal(await totalsRow(runner, kind, otherVersion), undefined, `${kind}: only off-year months, no row`);

    await runner.query(`UPDATE ${TABLES[kind].amounts} SET planned = 1 WHERE version_id = $1 AND period > $2`, [versionId, period(12, YEAR)]);
    assert.equal((await totalsRow(runner, kind, versionId))?.planned, '120.00', `${kind}: updating an off-year month changes nothing`);
    await runner.query(`DELETE FROM ${TABLES[kind].amounts} WHERE version_id = $1 AND period < $2`, [versionId, period(1, YEAR)]);
    assert.equal((await totalsRow(runner, kind, versionId))?.planned, '120.00', `${kind}: nor does deleting one`);

    await assertTotalsMatch(runner, kind, tenantId, 'with off-year months');
    await assertSummaryMatchesAggregate(runner, kind, tenantId, [YEAR, YEAR + 1, YEAR + 2], 'with off-year months');
  });
}

/** Updates and deletes apply their net change; an update that changes no amount leaves the row untouched. */
async function testUpdatesAndDeletes(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `vt-update-${kind}`);
    const { versionId } = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('10', 12), forecast: repeat('1', 12) });
    const amounts = TABLES[kind].amounts;

    await runner.query(`UPDATE ${amounts} SET planned = planned + 0.5 WHERE version_id = $1 AND period < $2`, [versionId, period(4, YEAR)]);
    assert.equal((await totalsRow(runner, kind, versionId))?.planned, '121.50', `${kind}: a three-row update`);

    await runner.query(`UPDATE ${amounts} SET forecast = NULL WHERE version_id = $1 AND period = $2`, [versionId, period(12, YEAR)]);
    assert.equal((await totalsRow(runner, kind, versionId))?.forecast, '11.00', `${kind}: a value set to NULL counts as 0`);

    const before = await totalsRow(runner, kind, versionId);
    await runner.query(`UPDATE ${amounts} SET planned = planned, updated_at = now() WHERE version_id = $1`, [versionId]);
    assert.equal((await totalsRow(runner, kind, versionId))?.ctid, before?.ctid, `${kind}: an update that changes no amount writes no totals row`);

    await runner.query(`DELETE FROM ${amounts} WHERE version_id = $1 AND period IN ($2, $3)`, [versionId, period(1, YEAR), period(12, YEAR)]);
    const after = await totalsRow(runner, kind, versionId);
    assert.deepEqual([after?.planned, after?.forecast], ['101.00', '10.00'], `${kind}: deleted months are subtracted`);

    // The last months of the year go: the row stays, at zero (the triggers never delete a row); a new month adds its own value.
    await runner.query(`DELETE FROM ${amounts} WHERE version_id = $1`, [versionId]);
    assert.deepEqual(values(await totalsRow(runner, kind, versionId)), zeros, `${kind}: no month left, a row of zeros`);
    await assertTotalsMatch(runner, kind, tenantId, 'a version without months');
    await insertMonth(runner, kind, tenantId, versionId, period(7, YEAR), { planned: '42' });
    assert.equal((await totalsRow(runner, kind, versionId))?.planned, '42.00', `${kind}: the new month on the same row`);

    await assertTotalsMatch(runner, kind, tenantId, 'after updates and deletes');
    await assertSummaryMatchesAggregate(runner, kind, tenantId, [YEAR], 'after updates and deletes');
  });
}

/** The amounts write path (INSERT … ON CONFLICT DO UPDATE fires both the insert and the update trigger). */
async function testAmountsWritePath(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `vt-write-${kind}`);
    const itemId = await seedItem(runner, kind, tenantId);
    const versionId = await seedVersion(runner, kind, tenantId, itemId, YEAR);
    const service = amountsService(kind);
    const opts = { manager: runner.manager };

    await service.bulkUpsert(versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(3, YEAR), planned: 30, forecast: 3 }] }, null, opts);
    await assertTotalsMatch(runner, kind, tenantId, 'a first monthly write creates its months and the row');
    await service.bulkUpsert(versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(3, YEAR), planned: 31 }, { period: period(9, YEAR), committed: 9.99 }] }, null, opts);
    await assertTotalsMatch(runner, kind, tenantId, 'a monthly write updates one month and creates another');
    await service.bulkUpsert(versionId, { kind: 'annual', year: YEAR, totals: { planned: 1000, actual: 12 } }, null, opts);
    await assertTotalsMatch(runner, kind, tenantId, 'a yearly spread over the twelve months');
    const row = await totalsRow(runner, kind, versionId);
    assert.deepEqual([row?.planned, row?.actual, row?.forecast, row?.committed], ['1000.00', '12.00', '3.00', '9.99'], `${kind}: the spread replaced only its columns`);
    await service.bulkUpsert(versionId, { kind: 'quarterly', year: YEAR, measure: 'forecast', Q1: 30, Q2: 0, Q3: 0, Q4: 90 }, null, opts);
    assert.equal((await totalsRow(runner, kind, versionId))?.forecast, '120.00', `${kind}: a quarterly spread`);
    await assertSummaryMatchesAggregate(runner, kind, tenantId, [YEAR], 'after the amounts writes');
  });
}

/** An update moving months to another version or another year: both versions follow, an emptied version loses its row. */
async function testMovedMonths(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `vt-move-${kind}`);
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('10', 12) });
    const otherItem = await seedItem(runner, kind, tenantId, 2, 'Other line');
    const sameYear = await seedVersion(runner, kind, tenantId, otherItem, YEAR);
    const nextYear = await seedVersion(runner, kind, tenantId, itemId, YEAR + 1);
    const amounts = TABLES[kind].amounts;

    // Two months to a version of the same year that has none yet: it gains a row.
    await runner.query(`UPDATE ${amounts} SET version_id = $2 WHERE version_id = $1 AND period IN ($3, $4)`, [versionId, sameYear, period(1, YEAR), period(2, YEAR)]);
    assert.equal((await totalsRow(runner, kind, versionId))?.planned, '100.00', `${kind}: the source version loses the moved months`);
    assert.equal((await totalsRow(runner, kind, sameYear))?.planned, '20.00', `${kind}: the target version gains them`);

    // One month to a version of another year: the source loses it, the target does not count it.
    await runner.query(`UPDATE ${amounts} SET version_id = $2 WHERE version_id = $1 AND period = $3`, [versionId, nextYear, period(3, YEAR)]);
    assert.equal((await totalsRow(runner, kind, versionId))?.planned, '90.00', `${kind}: the month left its version`);
    assert.equal(await totalsRow(runner, kind, nextYear), undefined, `${kind}: an off-year month gives the target no row`);

    // One month moved to the next year within its version: out of its year, so out of its totals; and back.
    await runner.query(`UPDATE ${amounts} SET period = $2 WHERE version_id = $1 AND period = $3`, [versionId, period(4, YEAR + 1), period(4, YEAR)]);
    assert.equal((await totalsRow(runner, kind, versionId))?.planned, '80.00', `${kind}: a month moved out of the year`);
    await runner.query(`UPDATE ${amounts} SET period = $2 WHERE version_id = $1 AND period = $3`, [versionId, period(4, YEAR), period(4, YEAR + 1)]);
    assert.equal((await totalsRow(runner, kind, versionId))?.planned, '90.00', `${kind}: and back into it`);

    // Back to the first version: the target has no month left and keeps a row of zeros.
    await runner.query(`UPDATE ${amounts} SET version_id = $1 WHERE version_id = $2`, [versionId, sameYear]);
    assert.deepEqual(values(await totalsRow(runner, kind, sameYear)), zeros, `${kind}: an emptied version keeps a row of zeros`);
    assert.equal((await totalsRow(runner, kind, versionId))?.planned, '110.00', `${kind}: the first version gets them back`);

    await assertTotalsMatch(runner, kind, tenantId, 'after the moves');
    await assertSummaryMatchesAggregate(runner, kind, tenantId, [YEAR, YEAR + 1], 'after the moves', [sameYear]);
  });
}

/** Deleting a version, a line or every amount of the tenant: the rows go, none comes back, no foreign key error. */
async function testCascades(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `vt-cascade-${kind}`);
    const t = TABLES[kind];
    const itemFk = 'spend_item_id';
    const a = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('1', 12) }, 1);
    const b = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('2', 12) }, 2);
    const c = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('3', 12) }, 3);
    const cNext = await seedVersion(runner, kind, tenantId, c.itemId, YEAR + 1);
    await seedMonths(runner, kind, tenantId, cNext, YEAR + 1, { forecast: repeat('4', 12) });
    await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('5', 12) }, 4);
    const count = async () => Number((await runner.query(`SELECT count(*) AS n FROM ${FAMILY[kind].totals} WHERE tenant_id = $1`, [tenantId]))[0].n);
    assert.equal(await count(), 5, `${kind}: one row per version with months`);

    await runner.query(`DELETE FROM ${t.versions} WHERE id = $1`, [a.versionId]);
    assert.equal(await totalsRow(runner, kind, a.versionId), undefined, `${kind}: a deleted version takes its row`);

    await runner.query(`DELETE FROM ${t.items} WHERE id = $1`, [b.itemId]);
    assert.equal(await totalsRow(runner, kind, b.versionId), undefined, `${kind}: a deleted line takes its versions' rows`);

    // The delete services' order: the months (their rows drop to zero), then the versions (the rows go), then the line.
    await runner.query(`DELETE FROM ${t.amounts} WHERE tenant_id = $1 AND version_id = ANY($2::uuid[])`, [tenantId, [c.versionId, cNext]]);
    assert.deepEqual(values(await totalsRow(runner, kind, cNext)), zeros, `${kind}: deleted months leave their version's row at zero`);
    await runner.query(`DELETE FROM ${t.versions} WHERE tenant_id = $1 AND ${itemFk} = $2`, [tenantId, c.itemId]);
    assert.equal(await totalsRow(runner, kind, cNext), undefined, `${kind}: the deleted versions take their rows`);
    await runner.query(`DELETE FROM ${t.items} WHERE id = $1`, [c.itemId]);
    assert.equal(await count(), 1, `${kind}: only the untouched line keeps its row`);

    // The tenant purge order: the totals first, then every month of the tenant.
    await runner.query(`DELETE FROM ${FAMILY[kind].totals} WHERE tenant_id = $1`, [tenantId]);
    await runner.query(`DELETE FROM ${t.amounts} WHERE tenant_id = $1`, [tenantId]);
    assert.equal(await count(), 0, `${kind}: nothing left after a purge`);
  });
}

/** Rows carry the tenant of their months; another tenant reads none and cannot write one. */
async function testTenantIsolation(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantA = await seedTenant(runner, `vt-rls-a-${kind}`);
    const { itemId, versionId } = await seedLine(runner, kind, tenantA, YEAR, { planned: repeat('8', 12) });
    const [row] = await runner.query(`SELECT tenant_id::text AS tenant_id FROM ${FAMILY[kind].totals} WHERE version_id = $1`, [versionId]);
    assert.equal(row?.tenant_id, tenantA, `${kind}: the row carries the months' tenant`);
    const otherVersion = await seedVersion(runner, kind, tenantA, itemId, YEAR + 1);

    await seedTenant(runner, `vt-rls-b-${kind}`);
    assert.equal((await runner.query(`SELECT 1 FROM ${FAMILY[kind].totals} WHERE version_id = $1`, [versionId])).length, 0, `${kind}: invisible to another tenant`);
    await runner.query('SAVEPOINT vt_rls');
    await assert.rejects(
      runner.query(`INSERT INTO ${FAMILY[kind].totals} (tenant_id, version_id, planned) VALUES ($1, $2, 1)`, [tenantA, otherVersion]),
      /row-level security/,
      `${kind}: another tenant cannot write a row of tenant A`,
    );
    await runner.query('ROLLBACK TO SAVEPOINT vt_rls');
    await setTenant(runner, tenantA);
    assert.equal((await totalsRow(runner, kind, versionId))?.planned, '96.00');
  });
}

/**
 * The families the rebuild function and the migration repair: the spend_* tables (labelled OPEX by
 * both, the lines of both natures since lot Z1) and the dormant capex_* tables (labelled CAPEX).
 */
const REBUILD_FAMILIES = ['opex', 'capex_dormant'] as const;
type RebuildFamily = typeof REBUILD_FAMILIES[number];

async function seedFamilyItem(runner: QueryRunner, family: RebuildFamily, tenantId: string) {
  return family === 'opex' ? seedItem(runner, 'opex', tenantId) : seedDormantCapexItem(runner, tenantId);
}

async function seedFamilyVersion(runner: QueryRunner, family: RebuildFamily, tenantId: string, itemId: string, year: number) {
  return family === 'opex' ? seedVersion(runner, 'opex', tenantId, itemId, year) : seedDormantCapexVersion(runner, tenantId, itemId, year);
}

async function seedFamilyMonths(runner: QueryRunner, family: RebuildFamily, tenantId: string, versionId: string, year: number, values: Partial<Record<Measure, string[]>>) {
  if (family === 'opex') return seedMonths(runner, 'opex', tenantId, versionId, year, values);
  for (let month = 1; month <= 12; month++) {
    const measures = Object.keys(values) as Measure[];
    await insertMonth(runner, family, tenantId, versionId, period(month, year), Object.fromEntries(measures.map((m) => [m, values[m]![month - 1]])));
  }
}

/**
 * The backfill: months loaded while the triggers are off (data from before
 * the migration, a tenant import), a wrong value and a non-zero row without
 * months are repaired by the rebuild function, then by a rerun of the
 * migration itself. A row of zeros without months is valid and kept.
 */
async function testRebuildAndMigrationRerun() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'vt-rebuild');
    const lines = {} as Record<RebuildFamily, { versionId: string; loaded: string; empty: string }>;
    for (const kind of REBUILD_FAMILIES) {
      const itemId = await seedFamilyItem(runner, kind, tenantId);
      const versionId = await seedFamilyVersion(runner, kind, tenantId, itemId, YEAR);
      await seedFamilyMonths(runner, kind, tenantId, versionId, YEAR, { planned: repeat('7', 12) });
      // Months loaded with the triggers off, NULL included.
      await runner.query(`ALTER TABLE ${FAMILY[kind].amounts} DISABLE TRIGGER USER`);
      const loaded = await seedFamilyVersion(runner, kind, tenantId, itemId, YEAR + 1);
      await seedFamilyMonths(runner, kind, tenantId, loaded, YEAR + 1, { forecast: repeat('2', 12), actual: repeat('1', 12) });
      await runner.query(`UPDATE ${FAMILY[kind].amounts} SET actual = NULL WHERE version_id = $1 AND period = $2`, [loaded, period(1, YEAR + 1)]);
      await runner.query(`ALTER TABLE ${FAMILY[kind].amounts} ENABLE TRIGGER USER`);
      // A wrong value, and a row for a version without any month.
      await runner.query(`UPDATE ${FAMILY[kind].totals} SET planned = planned + 1 WHERE version_id = $1`, [versionId]);
      const empty = await seedFamilyVersion(runner, kind, tenantId, itemId, YEAR + 2);
      await runner.query(`INSERT INTO ${FAMILY[kind].totals} (tenant_id, version_id, planned) VALUES ($1, $2, 5)`, [tenantId, empty]);
      assert.notDeepEqual(sorted(await stored(runner, kind, tenantId)), sorted(await recomputed(runner, kind, tenantId)), `${kind}: damaged`);
      lines[kind] = { versionId, loaded, empty };
    }

    // The rebuild function, under RLS with the tenant set.
    const report = await runner.query(
      `SELECT scope, tenant_id::text AS tenant_id, inserted::int, corrected::int FROM budget_version_totals_rebuild($1) ORDER BY scope`,
      [tenantId],
    );
    assert.deepEqual(report, [
      { scope: 'CAPEX', tenant_id: tenantId, inserted: 1, corrected: 2 },
      { scope: 'OPEX', tenant_id: tenantId, inserted: 1, corrected: 2 },
    ], 'the rebuild reports what it repaired');
    for (const kind of REBUILD_FAMILIES) {
      await assertTotalsMatch(runner, kind, tenantId, 'after the rebuild');
      assert.deepEqual(values(await totalsRow(runner, kind, lines[kind].loaded)), { ...zeros, forecast: '24.00', actual: '11.00' }, `${kind}: the loaded months, NULL as 0`);
      assert.deepEqual(values(await totalsRow(runner, kind, lines[kind].empty)), zeros, `${kind}: a row without months is set back to zeros, not deleted`);
    }
    assert.deepEqual(await runner.query(`SELECT * FROM budget_version_totals_rebuild($1)`, [tenantId]), [], 'a second rebuild has nothing to do');
    for (const kind of REBUILD_FAMILIES) {
      assert.deepEqual(values(await totalsRow(runner, kind, lines[kind].empty)), zeros, `${kind}: the rebuild keeps a row of zeros without months`);
    }

    // The migration itself, rerun on a migrated database with new damage: it repairs and stays idempotent.
    for (const kind of REBUILD_FAMILIES) {
      await runner.query(`UPDATE ${FAMILY[kind].totals} SET forecast = 0 WHERE version_id = $1`, [lines[kind].loaded]);
      await runner.query(`DELETE FROM ${FAMILY[kind].totals} WHERE version_id = $1`, [lines[kind].versionId]);
    }
    // RLS goes back as it was found: a table found without FORCE stays so.
    await runner.query(`ALTER TABLE capex_versions NO FORCE ROW LEVEL SECURITY`);
    const logged: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => { logged.push(args.join(' ')); };
    try {
      await new VersionTotals1853720000000().up(runner);
    } finally {
      console.log = log;
    }
    await setTenant(runner, tenantId);
    for (const kind of REBUILD_FAMILIES) await assertTotalsMatch(runner, kind, tenantId, 'after the migration rerun');
    const [{ slug }] = await runner.query(`SELECT slug FROM tenants WHERE id = $1`, [tenantId]);
    assert.deepEqual(logged.filter((line) => line.includes(tenantId)), [
      `[Migration] VersionTotals: tenant ${slug} (${tenantId}) OPEX: 1 row(s) inserted, 1 corrected`,
      `[Migration] VersionTotals: tenant ${slug} (${tenantId}) CAPEX: 1 row(s) inserted, 1 corrected`,
    ], 'the migration logs the tenant repairs');
    assert.deepEqual(await rlsState(runner), {
      capex_amounts: 'enabled+forced', capex_version_totals: 'enabled+forced', capex_versions: 'enabled',
      spend_amounts: 'enabled+forced', spend_version_totals: 'enabled+forced', spend_versions: 'enabled+forced',
    }, 'RLS is back as found after the backfill');
  });
}

const BUDGET_TABLES = ['spend_amounts', 'capex_amounts', 'spend_versions', 'capex_versions', 'spend_version_totals', 'capex_version_totals'];

async function rlsState(runner: QueryRunner): Promise<Record<string, string>> {
  const rows: Array<{ name: string; enabled: boolean; forced: boolean }> = await runner.query(
    `SELECT relname::text AS name, relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class
     WHERE relname = ANY($1::text[]) AND relkind = 'r' ORDER BY relname`,
    [BUDGET_TABLES],
  );
  return Object.fromEntries(rows.map((row) => [row.name, `${row.enabled ? 'enabled' : 'disabled'}${row.forced ? '+forced' : ''}`]));
}

/**
 * A backfill that fails inside the migration transaction surfaces its own
 * error, not the 25P02 of a statement run after it; the rollback puts RLS
 * back. The failure is forced by a check constraint the rebuild violates.
 */
async function testMigrationFailureKeepsItsError() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'vt-migration-error');
    const { versionId } = await seedLine(runner, 'opex', tenantId, YEAR, { planned: repeat('100000', 12) });
    await runner.query(`ALTER TABLE spend_version_totals ADD CONSTRAINT spec_planned_below_million CHECK (planned < 1000000) NOT VALID`);
    await runner.query(`UPDATE spend_version_totals SET planned = 0 WHERE version_id = $1`, [versionId]);
    await runner.query('SAVEPOINT vt_migration');
    await assert.rejects(
      new VersionTotals1853720000000().up(runner),
      (error: any) => error?.driverError?.code === '23514' && /spec_planned_below_million/.test(String(error?.message)),
      'the check violation of the rebuild, not 25P02',
    );
    await runner.query('ROLLBACK TO SAVEPOINT vt_migration');
    assert.deepEqual(Object.values(await rlsState(runner)), Array(6).fill('enabled+forced'), 'RLS is back after the rollback');
  });
}

/** TRUNCATE of an amounts table bypasses the statement triggers: it truncates the totals too. */
async function testTruncate(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `vt-truncate-${kind}`);
    const { versionId } = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('3', 12) });
    assert.equal((await totalsRow(runner, kind, versionId))?.planned, '36.00');
    await runner.query(`TRUNCATE ${TABLES[kind].amounts}`);
    assert.equal(await totalsRow(runner, kind, versionId), undefined, `${kind}: no month left anywhere, no totals row`);
    await insertMonth(runner, kind, tenantId, versionId, period(2, YEAR), { planned: '5' });
    assert.equal((await totalsRow(runner, kind, versionId))?.planned, '5.00', `${kind}: the next month starts a new row`);
    await assertTotalsMatch(runner, kind, tenantId, 'after a truncate');
  });
}

/**
 * The triggers count a month by its version's budget year: the year cannot
 * change once the version has months, nor where RLS hides them; it can while
 * the version has none.
 */
async function testBudgetYearGuard(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `vt-year-${kind}`);
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('1', 12) });
    const versions = TABLES[kind].versions;
    const changeYear = (id: string, year: number) => runner.query(`UPDATE ${versions} SET budget_year = $2 WHERE id = $1`, [id, year]);

    await runner.query('SAVEPOINT vt_year');
    await assert.rejects(changeYear(versionId, YEAR + 5), (error: any) => error?.driverError?.code === '23514' && /has months/.test(String(error?.message)), `${kind}: refused with months`);
    await runner.query('ROLLBACK TO SAVEPOINT vt_year');

    // Months of another year count too: they would enter the new year.
    const offYear = await seedVersion(runner, kind, tenantId, itemId, YEAR + 1);
    await insertMonth(runner, kind, tenantId, offYear, period(1, YEAR + 2), { planned: '9' });
    await assert.rejects(changeYear(offYear, YEAR + 2), /has months/, `${kind}: refused with months of another year`);
    await runner.query('ROLLBACK TO SAVEPOINT vt_year');

    const empty = await seedVersion(runner, kind, tenantId, itemId, YEAR + 3);
    await changeYear(empty, YEAR + 4);
    assert.equal(Number((await runner.query(`SELECT budget_year FROM ${versions} WHERE id = $1`, [empty]))[0].budget_year), YEAR + 4, `${kind}: allowed without months`);
    await runner.query('RELEASE SAVEPOINT vt_year');

    // RLS off on the versions only, no tenant (a migration): the months are hidden, so the change is refused.
    await runner.query('SAVEPOINT vt_year_rls');
    await runner.query(`ALTER TABLE ${versions} DISABLE ROW LEVEL SECURITY`);
    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
    await assert.rejects(changeYear(empty, YEAR + 6), /hidden by row level security/, `${kind}: refused when RLS hides the months`);
    await runner.query('ROLLBACK TO SAVEPOINT vt_year_rls');
    await setTenant(runner, tenantId);
  });
}

void runSpecs('version-totals.integration.spec', [
  ...KINDS.flatMap((kind): Array<[string, () => Promise<void>]> => [
    [`${kind}: inserted months, NULL as zero`, () => testInsertedMonths(kind)],
    [`${kind}: months outside the version's year`, () => testOffYearMonths(kind)],
    [`${kind}: updates and deletes`, () => testUpdatesAndDeletes(kind)],
    [`${kind}: the amounts write path`, () => testAmountsWritePath(kind)],
    [`${kind}: months moved to another version or year`, () => testMovedMonths(kind)],
    [`${kind}: cascades`, () => testCascades(kind)],
    [`${kind}: tenant isolation`, () => testTenantIsolation(kind)],
    [`${kind}: truncate`, () => testTruncate(kind)],
    [`${kind}: budget year guard`, () => testBudgetYearGuard(kind)],
  ]),
  ['rebuild and migration rerun', testRebuildAndMigrationRerun],
  ['a failed backfill keeps its error', testMigrationFailureKeepsItsError],
]);
