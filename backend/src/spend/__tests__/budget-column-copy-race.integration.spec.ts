import { copyBudgetColumn } from '../budget-column-operations';
import { SpendVersionsService } from '../spend-versions.service';
import { CapexVersionsService } from '../../capex/capex-versions.service';
import { amountsService, captureAudit, Kind, noFreeze, repeat, seedLine, TABLES } from './round-inputs.fixtures';
import { assert, assertSucceeded, progress, runRaceSpecs, settle, sql, withRace } from './race-harness';

// Race of the column copy without overwrite (plan planning/perf-scale, lot 3A
// review), fixed in lot 3A.
//
// The copy decides on a snapshot read without lock: a line whose destination
// year has no version is "not skipped" (nothing to keep). Meanwhile a budget
// tab creates that version and types months into it. The copy's version
// create is a get-or-create (`budget-version-ensure.ts`): it returns the
// tab's version, and the copy used to replace the months the user typed,
// although the user had not asked to overwrite anything.
//
// Fixed: when the get-or-create finds an existing version and overwrite is
// off, the copy reads the destination column again under the lock every
// amounts write takes, and skips the line when it holds amounts. A save still
// in flight is waited for, then kept.

const SOURCE = 2026;
const DESTINATION = 2027;
const currencySettings = { getSettings: async () => ({ reportingCurrency: 'EUR' }) };

function versionsService(kind: Kind): { createForItem: (...args: any[]) => Promise<any> } {
  return kind === 'opex'
    ? new SpendVersionsService(undefined as any, undefined as any, captureAudit() as any, currencySettings as any)
    : new CapexVersionsService(undefined as any, undefined as any, captureAudit() as any, currencySettings as any);
}

/** What the budget tab posts for a year without version (`BudgetTab.tsx` ensureVersion). */
const uiVersion = { version_name: `Y${DESTINATION}`, budget_year: DESTINATION, as_of_date: `${DESTINATION}-01-01`, input_grain: 'monthly', notes: null };
const typed = Array.from({ length: 12 }, (_, i) => ({ period: `${DESTINATION}-${String(i + 1).padStart(2, '0')}-01`, planned: 50 }));
const copyOperation = {
  sourceYear: SOURCE, sourceColumn: 'budget' as const, destinationYear: DESTINATION, destinationColumn: 'budget' as const,
  percentageIncrease: 0, overwrite: false, dryRun: false,
};

async function destinationMonths(race: { read: (text: string, params?: unknown[]) => Promise<any[]> }, kind: Kind, itemId: string) {
  const fk = kind === 'opex' ? 'spend_item_id' : 'capex_item_id';
  const [version] = await race.read(`SELECT id FROM ${TABLES[kind].versions} WHERE ${fk} = $1 AND budget_year = $2`, [itemId, DESTINATION]);
  assert.ok(version, `${kind}: the destination version exists`);
  return race.read(
    `SELECT to_char(period, 'YYYY-MM-DD') AS period, planned::text AS planned FROM ${TABLES[kind].amounts}
     WHERE version_id = $1 ORDER BY period`,
    [version.id],
  );
}

/**
 * The tab creates the destination year and saves its months (committed)
 * while the copy, past its snapshot, is about to create that year.
 */
async function tabTypedBeforeTheCopyCreatesTheYear(kind: Kind) {
  await withRace(`${kind}-copy-tab`, async (race) => {
    const { itemId } = await race.seedWith((runner) => seedLine(runner, kind, race.tenantId, SOURCE, { planned: repeat('100', 12) }, 1));
    const copier = await race.open('column copy 2026 → 2027');
    const tab = await race.open('budget tab of 2027');

    const copyCreate = race.gate(copier, { label: 'create the destination year', when: 'before', match: sql.insertInto(TABLES[kind].versions) });
    const copyWork = race.start(copier, (manager) => copyBudgetColumn({ manager, audit: captureAudit() as any, freeze: noFreeze }, kind, copyOperation, null));
    assert.equal(await progress(copyWork, { party: copier, gate: copyCreate }), 'gated', 'harness: the copy must pause before creating the destination year');

    const version = await race.start(tab, (manager) => versionsService(kind).createForItem(itemId, { ...uiVersion }, undefined, { manager }));
    await race.start(tab, (manager) => amountsService(kind).bulkUpsert(version.id, { kind: 'monthly', year: DESTINATION, months: typed }, null, { manager }));

    copyCreate.release();
    const copyDone = await settle(copyWork);
    assertSucceeded(copyDone, 'the copy');
    assert.deepEqual((copyDone as any).value.summary, { totalItems: 1, processed: 0, skipped: 1, errors: 0 }, `${kind}: the line is skipped`);
    const months = await destinationMonths(race, kind, itemId);
    assert.deepEqual(months.map((m: any) => Number(m.planned)), repeat('50', 12).map(Number), `${kind}: the months the user typed are kept`);
  });
}

/**
 * The tab's months save is still in flight (not committed) when the copy
 * creates the year: the copy waits for it under the months lock, then keeps
 * what it saved.
 */
async function tabSaveInFlightWhenTheCopyResumes(kind: Kind) {
  await withRace(`${kind}-copy-tab-inflight`, async (race) => {
    const { itemId } = await race.seedWith((runner) => seedLine(runner, kind, race.tenantId, SOURCE, { planned: repeat('100', 12) }, 1));
    const copier = await race.open('column copy 2026 → 2027');
    const tab = await race.open('budget tab of 2027');

    const copyCreate = race.gate(copier, { label: 'create the destination year', when: 'before', match: sql.insertInto(TABLES[kind].versions) });
    const copyWork = race.start(copier, (manager) => copyBudgetColumn({ manager, audit: captureAudit() as any, freeze: noFreeze }, kind, copyOperation, null));
    assert.equal(await progress(copyWork, { party: copier, gate: copyCreate }), 'gated', 'harness: the copy must pause before creating the destination year');

    const version = await race.start(tab, (manager) => versionsService(kind).createForItem(itemId, { ...uiVersion }, undefined, { manager }));
    // The months are written, the save's transaction not committed yet.
    const tabWritten = race.gate(tab, { label: 'write the months', when: 'after', match: sql.insertInto(TABLES[kind].amounts), nth: 2 });
    const tabWork = race.start(tab, (manager) => amountsService(kind).bulkUpsert(version.id, { kind: 'monthly', year: DESTINATION, months: typed }, null, { manager }));
    assert.equal(await progress(tabWork, { party: tab, gate: tabWritten }), 'gated', 'harness: the tab must pause with its months written');

    copyCreate.release();
    assert.equal(await progress(copyWork, { party: copier }), 'blocked', 'the copy waits for the save in flight (months lock)');
    tabWritten.release();
    const [copyDone, tabDone] = await Promise.all([settle(copyWork), settle(tabWork)]);
    assertSucceeded(tabDone, 'the budget tab save');
    assertSucceeded(copyDone, 'the copy');
    assert.deepEqual((copyDone as any).value.summary, { totalItems: 1, processed: 0, skipped: 1, errors: 0 }, `${kind}: the line is skipped`);
    const months = await destinationMonths(race, kind, itemId);
    assert.deepEqual(months.map((m: any) => Number(m.planned)), repeat('50', 12).map(Number), `${kind}: the months the user typed are kept`);
  });
}

/** Overwrite on: the copy replaces the months, as asked (the fix only applies without overwrite). */
async function overwriteStillReplaces(kind: Kind) {
  await withRace(`${kind}-copy-tab-overwrite`, async (race) => {
    const { itemId } = await race.seedWith((runner) => seedLine(runner, kind, race.tenantId, SOURCE, { planned: repeat('100', 12) }, 1));
    const copier = await race.open('column copy 2026 → 2027');
    const tab = await race.open('budget tab of 2027');

    const copyCreate = race.gate(copier, { label: 'create the destination year', when: 'before', match: sql.insertInto(TABLES[kind].versions) });
    const copyWork = race.start(copier, (manager) => copyBudgetColumn(
      { manager, audit: captureAudit() as any, freeze: noFreeze }, kind, { ...copyOperation, overwrite: true }, null,
    ));
    assert.equal(await progress(copyWork, { party: copier, gate: copyCreate }), 'gated', 'harness: the copy must pause before creating the destination year');
    const version = await race.start(tab, (manager) => versionsService(kind).createForItem(itemId, { ...uiVersion }, undefined, { manager }));
    await race.start(tab, (manager) => amountsService(kind).bulkUpsert(version.id, { kind: 'monthly', year: DESTINATION, months: typed }, null, { manager }));
    copyCreate.release();
    const copyDone = await settle(copyWork);
    assertSucceeded(copyDone, 'the copy');
    assert.deepEqual((copyDone as any).value.summary, { totalItems: 1, processed: 1, skipped: 0, errors: 0 }, `${kind}: the line is copied`);
    const months = await destinationMonths(race, kind, itemId);
    assert.deepEqual(months.map((m: any) => Number(m.planned)), repeat('100', 12).map(Number), `${kind}: overwritten with the source`);
  });
}

void runRaceSpecs('Column copy races', [
  ['OPEX: a column copy without overwrite keeps the months a budget tab typed into a year it just created (3A)', () => tabTypedBeforeTheCopyCreatesTheYear('opex')],
  ['CAPEX: a column copy without overwrite keeps the months a budget tab typed into a year it just created (3A)', () => tabTypedBeforeTheCopyCreatesTheYear('capex')],
  ['OPEX: a column copy without overwrite waits for a months save in flight, then keeps it (3A)', () => tabSaveInFlightWhenTheCopyResumes('opex')],
  ['OPEX: a column copy with overwrite still replaces them (3A)', () => overwriteStillReplaces('opex')],
]);
