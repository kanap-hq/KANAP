import { amountsService, captureAudit, Kind, MEASURES, noFreeze, period, repeat, seedItem, seedLine, seedVersion, TABLES } from './round-inputs.fixtures';
import { assert, assertSucceeded, databaseName, Party, progress, Race, runRaceSpecs, settle, sql, withRace } from './race-harness';

// Concurrent budget writes and the totals per version (migration
// 1853720000000, plan planning/perf-scale lot 2A). Not a known race: this
// spec passes and runs in test:ci (it is not in the races EXCLUDE list).
//
// Two request transactions write the same version at once, forced into the
// overlapping order by the harness gates. The trigger applies each
// statement's change as an increment on the version's totals row: a writer
// that finds the row changed by a running transaction waits for it, then adds
// to the row as that transaction left it, so once both have committed the
// stored totals equal the sums of the committed months, whichever commits
// first. A recompute by SUM in READ COMMITTED would miss the other writer's
// uncommitted months and lose them on commit.
//
// The same blindness is why the trigger never deletes a totals row when a
// version's last month goes: in each delete race below, the deleting
// transaction cannot see a month another one is writing. A version left
// without months keeps a row of zeros.
//
// The spread race (creationWhileAMonthIsHeld) guards the lock order:
// creating the zero months of a write never locks the totals row, so a writer
// that creates months while waiting for a month held by another one does not
// deadlock with it.
//
// @database-spec: run-ci-tests.js runs this file in its serial database lane
// (the gates must not see another spec's locks). Like every race spec it
// commits throwaway tenants, so it never runs on a developer's `appdb`: there
// it reports itself skipped (CI's `appdb` is a throwaway container and runs
// it).

const YEAR = 2035;

type Sums = Record<string, string>;

const cell = (month: number, values: Record<string, number>) => ({ period: period(month, YEAR), ...values });

function save(kind: Kind, race: Race, party: Party, versionId: string, payload: Record<string, unknown>) {
  return race.start(party, (manager) => amountsService(kind, captureAudit(), noFreeze).bulkUpsert(versionId, { year: YEAR, ...payload }, null, { manager }));
}

/** Raw statements of one request of the party, in order (the triggers do the rest). */
function statements(race: Race, party: Party, list: Array<[string, unknown[]]>) {
  return race.start(party, async (manager) => {
    for (const [text, params] of list) await manager.query(text, params);
  });
}

/** A committed version of the race tenant with the given planned months (month number → value, null for an omitted column). */
async function seedPlannedMonths(race: Race, kind: Kind, months: Record<number, number | null>): Promise<string> {
  return race.seedWith(async (runner) => {
    const id = await seedVersion(runner, kind, race.tenantId, await seedItem(runner, kind, race.tenantId), YEAR);
    for (const [month, planned] of Object.entries(months)) {
      await runner.query(
        `INSERT INTO ${TABLES[kind].amounts} (tenant_id, version_id, period, planned) VALUES ($1, $2, $3, $4)`,
        [race.tenantId, id, period(Number(month), YEAR), planned],
      );
    }
    return id;
  });
}

/** The stored totals of the version and the sums of its months of its year, as 2-decimal text. */
async function totalsAndSums(race: Race, kind: Kind, versionId: string): Promise<{ stored: Sums | undefined; months: Sums }> {
  const stored = await race.readOne(
    `SELECT ${MEASURES.map((m) => `${m}::numeric(20, 2)::text AS ${m}`).join(', ')}
     FROM spend_version_totals WHERE version_id = $1`,
    [versionId],
  );
  const months = await race.readOne(
    `SELECT ${MEASURES.map((m) => `coalesce(sum(coalesce(${m}, 0)), 0)::numeric(20, 2)::text AS ${m}`).join(', ')}
     FROM ${TABLES[kind].amounts} WHERE version_id = $1 AND extract(year FROM period) = $2`,
    [versionId, YEAR],
  );
  return { stored, months };
}

async function assertTotals(race: Race, kind: Kind, versionId: string, expected: Partial<Sums>, label: string) {
  const { stored, months } = await totalsAndSums(race, kind, versionId);
  assert.deepEqual(stored, months, `${kind}: ${label}: the stored totals equal the sums of the months`);
  for (const [measure, value] of Object.entries(expected)) assert.equal(stored?.[measure], value, `${kind}: ${label}: ${measure}`);
}

/**
 * A pauses right after the statement writing its months (its trigger has run,
 * its transaction is open); B writes the same version meanwhile; then A
 * commits and B finishes. Both succeed.
 */
async function overlap(kind: Kind, race: Race, versionId: string, aPayload: Record<string, unknown>, bPayload: Record<string, unknown>) {
  const a = await race.open('A');
  const b = await race.open('B');
  const aWrote = race.gate(a, { label: 'write its months', when: 'after', match: sql.insertInto(TABLES[kind].amounts), nth: 2 });
  const aWork = save(kind, race, a, versionId, aPayload);
  assert.equal(await progress(aWork, { party: a, gate: aWrote }), 'gated', 'harness: A must pause after writing its months');
  const bWork = save(kind, race, b, versionId, bPayload);
  await progress(bWork, { party: b });
  aWrote.release();
  const [aDone, bDone] = await Promise.all([settle(aWork), settle(bWork)]);
  assertSucceeded(aDone, 'A');
  assertSucceeded(bDone, 'B');
}

/** Two users save different months of one version. */
async function differentMonths(kind: Kind) {
  await withRace(`totals-months-${kind}`, async (race) => {
    const { versionId } = await race.seedWith((runner) => seedLine(runner, kind, race.tenantId, YEAR, { planned: repeat('100', 12), forecast: repeat('5', 12) }));
    await overlap(kind, race, versionId,
      { kind: 'monthly', months: [cell(3, { planned: 111 })] },
      { kind: 'monthly', months: [cell(6, { planned: 222 })] });
    await assertTotals(race, kind, versionId, { planned: '1333.00', forecast: '60.00' }, 'two months saved at once');
  });
}

/** Two users save the same month: one its Budget, the other its Forecast. */
async function sameMonthOtherColumns(kind: Kind) {
  await withRace(`totals-cell-${kind}`, async (race) => {
    const { versionId } = await race.seedWith((runner) => seedLine(runner, kind, race.tenantId, YEAR, { planned: repeat('100', 12), forecast: repeat('5', 12) }));
    await overlap(kind, race, versionId,
      { kind: 'monthly', months: [cell(3, { planned: 111 })] },
      { kind: 'monthly', months: [cell(3, { forecast: 7 })] });
    await assertTotals(race, kind, versionId, { planned: '1211.00', forecast: '62.00' }, 'one month, two columns');
  });
}

/** Two users save the same cell: the last one wins in the month, and in the total. */
async function sameCell(kind: Kind) {
  await withRace(`totals-same-${kind}`, async (race) => {
    const { versionId } = await race.seedWith((runner) => seedLine(runner, kind, race.tenantId, YEAR, { planned: repeat('100', 12) }));
    await overlap(kind, race, versionId,
      { kind: 'monthly', months: [cell(3, { planned: 111 })] },
      { kind: 'monthly', months: [cell(3, { planned: 333 })] });
    await assertTotals(race, kind, versionId, { planned: '1433.00' }, 'one cell saved twice');
  });
}

/**
 * A holds February (locked for its write, totals not touched yet) while B
 * spreads the year: B creates July to December, then waits for February. B's
 * new months hold zeros and do not lock the totals row, so A writes its total
 * and commits, and B finishes. A lock taken there would deadlock A and B.
 */
async function creationWhileAMonthIsHeld(kind: Kind) {
  await withRace(`totals-create-${kind}`, async (race) => {
    const versionId = await race.seedWith(async (runner) => {
      const itemId = await seedItem(runner, kind, race.tenantId);
      const id = await seedVersion(runner, kind, race.tenantId, itemId, YEAR);
      for (let month = 1; month <= 6; month++) {
        await runner.query(`INSERT INTO ${TABLES[kind].amounts} (tenant_id, version_id, period, planned) VALUES ($1, $2, $3, 100)`, [race.tenantId, id, period(month, YEAR)]);
      }
      return id;
    });
    const a = await race.open('A (February)');
    const b = await race.open('B (yearly spread)');
    const aLocked = race.gate(a, { label: 'lock its months', when: 'after', match: sql.lockOn(TABLES[kind].amounts) });
    const aWork = save(kind, race, a, versionId, { kind: 'monthly', months: [cell(2, { planned: 150 })] });
    assert.equal(await progress(aWork, { party: a, gate: aLocked }), 'gated', 'harness: A must pause holding February');
    const bWork = save(kind, race, b, versionId, { kind: 'annual', totals: { planned: 2400 } });
    assert.equal(await progress(bWork, { party: b }), 'blocked', 'B created its months and waits for February');
    aLocked.release();
    const [aDone, bDone] = await Promise.all([settle(aWork), settle(bWork)]);
    assertSucceeded(aDone, 'A');
    assertSucceeded(bDone, 'B (no deadlock)');
    await assertTotals(race, kind, versionId, { planned: '2400.00' }, 'the spread written after the cell');
  });
}

/** The first two writes of a version with no month yet: one totals row, both values. */
async function firstWrites(kind: Kind) {
  await withRace(`totals-first-${kind}`, async (race) => {
    const versionId = await race.seedWith(async (runner) => seedVersion(runner, kind, race.tenantId, await seedItem(runner, kind, race.tenantId), YEAR));
    await overlap(kind, race, versionId,
      { kind: 'monthly', months: [cell(1, { planned: 10 })] },
      { kind: 'monthly', months: [cell(2, { planned: 20, actual: 1.5 })] });
    await assertTotals(race, kind, versionId, { planned: '30.00', actual: '1.50' }, 'two first writes');
    const [{ rows }] = await race.read(
      `SELECT count(*)::int AS rows FROM spend_version_totals WHERE version_id = $1`,
      [versionId],
    );
    assert.equal(rows, 1, `${kind}: one totals row`);
  });
}

/**
 * B creates a zero February (the first step of a budget
 * write: no totals lock) and pauses; A deletes January, the version's only
 * valued month, and commits; B writes 5 in February. February was invisible
 * to A: had A dropped the row as the version's last month went, B's 5 would
 * find no row to add to and the list would read 0.
 */
async function lastValuedMonthDeletedWhileAMonthIsCreated(kind: Kind) {
  await withRace(`totals-delete-create-${kind}`, async (race) => {
    const amounts = TABLES[kind].amounts;
    const versionId = await seedPlannedMonths(race, kind, { 1: 10 });
    const a = await race.open('A (deletes January)');
    const b = await race.open('B (creates February, then writes it)');
    const bCreated = race.gate(b, { label: 'create a zero February', when: 'after', match: sql.insertInto(amounts) });
    const bWork = statements(race, b, [
      [`INSERT INTO ${amounts} (tenant_id, version_id, period) VALUES ($1, $2, $3) ON CONFLICT (version_id, period) DO NOTHING`, [race.tenantId, versionId, period(2, YEAR)]],
      [`INSERT INTO ${amounts} (tenant_id, version_id, period, planned) VALUES ($1, $2, $3, 5)
        ON CONFLICT (version_id, period) DO UPDATE SET planned = EXCLUDED.planned`, [race.tenantId, versionId, period(2, YEAR)]],
    ]);
    assert.equal(await progress(bWork, { party: b, gate: bCreated }), 'gated', 'harness: B must pause after creating February');
    const aWork = statements(race, a, [[`DELETE FROM ${amounts} WHERE version_id = $1 AND period = $2`, [versionId, period(1, YEAR)]]]);
    await progress(aWork, { party: a });
    bCreated.release();
    const [aDone, bDone] = await Promise.all([settle(aWork), settle(bWork)]);
    assertSucceeded(aDone, 'A');
    assertSucceeded(bDone, 'B');
    await assertTotals(race, kind, versionId, { planned: '5.00' }, 'a value written after the last valued month went');
  });
}

/**
 * B inserts 5 in February (its increment holds the totals
 * row) and pauses; A deletes January, a zero month. A changes no amount, so
 * it neither waits for B nor touches the row; it used to wait, then drop the
 * row on a check that could not see B's February.
 */
async function zeroMonthDeletedWhileAMonthIsWritten(kind: Kind) {
  await withRace(`totals-delete-zero-${kind}`, async (race) => {
    const amounts = TABLES[kind].amounts;
    const versionId = await seedPlannedMonths(race, kind, { 1: 0 });
    const a = await race.open('A (deletes the zero January)');
    const b = await race.open('B (writes February)');
    const bWrote = race.gate(b, { label: 'write February', when: 'after', match: sql.insertInto(amounts) });
    const bWork = statements(race, b, [[`INSERT INTO ${amounts} (tenant_id, version_id, period, planned) VALUES ($1, $2, $3, 5)`, [race.tenantId, versionId, period(2, YEAR)]]]);
    assert.equal(await progress(bWork, { party: b, gate: bWrote }), 'gated', 'harness: B must pause after writing February');
    const aWork = statements(race, a, [[`DELETE FROM ${amounts} WHERE version_id = $1 AND period = $2`, [versionId, period(1, YEAR)]]]);
    assert.equal(await progress(aWork, { party: a }), 'settled', 'A deletes a zero month without waiting for the totals row');
    bWrote.release();
    const [aDone, bDone] = await Promise.all([settle(aWork), settle(bWork)]);
    assertSucceeded(aDone, 'A');
    assertSucceeded(bDone, 'B');
    await assertTotals(race, kind, versionId, { planned: '5.00' }, 'a zero month deleted while another is written');
  });
}

/**
 * A and B delete the two zero months of a version at once; each still sees
 * the other's month. The version ends without months and keeps its row of
 * zeros; the next month written adds to that row.
 */
async function bothZeroMonthsDeleted(kind: Kind) {
  await withRace(`totals-delete-both-${kind}`, async (race) => {
    const amounts = TABLES[kind].amounts;
    const versionId = await seedPlannedMonths(race, kind, { 1: 0, 2: null });
    const a = await race.open('A (deletes January)');
    const b = await race.open('B (deletes February)');
    const aDeleted = race.gate(a, { label: 'delete January', when: 'after', match: sql.deleteFrom(amounts) });
    const aWork = statements(race, a, [[`DELETE FROM ${amounts} WHERE version_id = $1 AND period = $2`, [versionId, period(1, YEAR)]]]);
    assert.equal(await progress(aWork, { party: a, gate: aDeleted }), 'gated', 'harness: A must pause after deleting January');
    const bWork = statements(race, b, [[`DELETE FROM ${amounts} WHERE version_id = $1 AND period = $2`, [versionId, period(2, YEAR)]]]);
    assert.equal(await progress(bWork, { party: b }), 'settled', 'B deletes a zero month without waiting');
    aDeleted.release();
    const [aDone, bDone] = await Promise.all([settle(aWork), settle(bWork)]);
    assertSucceeded(aDone, 'A');
    assertSucceeded(bDone, 'B');
    const { stored } = await totalsAndSums(race, kind, versionId);
    assert.ok(stored, `${kind}: the version keeps its totals row`);
    await assertTotals(race, kind, versionId, { planned: '0.00', forecast: '0.00' }, 'both months deleted at once');
    const c = await race.open('C (writes March)');
    assertSucceeded(await settle(statements(race, c, [[`INSERT INTO ${amounts} (tenant_id, version_id, period, planned) VALUES ($1, $2, $3, 7)`, [race.tenantId, versionId, period(3, YEAR)]]])), 'C');
    await assertTotals(race, kind, versionId, { planned: '7.00' }, 'a month written afterwards');
  });
}

const races: Array<[string, () => Promise<void>]> = [
  ['two months of one OPEX version saved at once', () => differentMonths('opex')],
  ['two months of one CAPEX version saved at once', () => differentMonths('capex')],
  ['one OPEX month, two columns saved at once', () => sameMonthOtherColumns('opex')],
  ['one OPEX cell saved twice at once', () => sameCell('opex')],
  ['an OPEX spread creating months while another save holds a month (no deadlock)', () => creationWhileAMonthIsHeld('opex')],
  ['a CAPEX spread creating months while another save holds a month (no deadlock)', () => creationWhileAMonthIsHeld('capex')],
  ['the first two writes of an OPEX version', () => firstWrites('opex')],
  ['an OPEX version\'s last valued month deleted while another save creates a month', () => lastValuedMonthDeletedWhileAMonthIsCreated('opex')],
  ['a CAPEX version\'s last valued month deleted while another save creates a month', () => lastValuedMonthDeletedWhileAMonthIsCreated('capex')],
  ['an OPEX zero month deleted while another save writes a month', () => zeroMonthDeletedWhileAMonthIsWritten('opex')],
  ['a CAPEX zero month deleted while another save writes a month', () => zeroMonthDeletedWhileAMonthIsWritten('capex')],
  ['the two zero months of an OPEX version deleted at once', () => bothZeroMonthsDeleted('opex')],
  ['the two zero months of a CAPEX version deleted at once', () => bothZeroMonthsDeleted('capex')],
];

if (databaseName() === 'appdb' && process.env.GITHUB_ACTIONS !== 'true') {
  console.log('Version totals races: skipped on appdb (race specs commit throwaway tenants); run them on appdb_perf');
} else {
  void runRaceSpecs('Version totals races', races);
}
