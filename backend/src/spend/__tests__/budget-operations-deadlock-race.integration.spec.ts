import { BUDGET_ROWS_HEADERS, BudgetRowsCsvService } from '../budget-rows-csv.service';
import { copyBudgetColumn } from '../budget-column-operations';
import { captureAudit, noFreeze, repeat, seedLine } from './round-inputs.fixtures';
import { assert, assertClean, Outcome, pgCode, progress, runRaceSpecs, settle, sql, withRace } from './race-harness';

// Race of two bulk budget operations (plan planning/perf-scale, step 0.3,
// Annexe A #16), fixed in lot 3B (the tenant lock and the id-order pre-lock,
// moved there from 3F).
//
// Two operations over several lines lock the months of each line in their
// own order: the column copy (and the clear) by line creation date, newest
// first (`budget-column-operations.ts:175`), the budget rows import in file
// order. A copy holding the newest line's months and an import holding the
// oldest line's months each wait for the other: PostgreSQL aborts one with a
// deadlock (40P01) after `deadlock_timeout`, a 500 and the whole operation
// rolled back.
// Fixed: the tenant's bulk operations take one transaction advisory lock (the
// second one gets a 409 "already running", `budget-locks.ts`) and lock their
// target lines in id order before deciding.
//
// Not reproduced on its own: the clear's record-before-months order (a
// column without amounts lost its record before any month was locked). A
// clear and any other writer that visit the lines in the same order cannot
// close a cycle on it; lot 3B fixed the order anyway (`lockStoredMonths`).

const YEAR = 2026;

async function copyVersusImport() {
  await withRace('deadlock', async (race) => {
    const { older, newer } = await race.seedWith(async (runner) => {
      const older = await seedLine(runner, 'opex', race.tenantId, YEAR, { planned: repeat('100', 12) }, 1);
      const newer = await seedLine(runner, 'opex', race.tenantId, YEAR, { planned: repeat('200', 12) }, 2);
      // The copy visits the newest line first.
      await runner.query(`UPDATE spend_items SET created_at = '2026-01-01T00:00:00Z' WHERE id = $1`, [older.itemId]);
      await runner.query(`UPDATE spend_items SET created_at = '2026-01-02T00:00:00Z' WHERE id = $1`, [newer.itemId]);
      return { older, newer };
    });
    const copier = await race.open('column copy');
    const importer = await race.open('budget rows import');

    // The file lists the oldest line first.
    const months = (value: string) => Object.fromEntries(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map((m) => [m, value]));
    const lines: Array<Record<string, string>> = [
      { item_type: 'opex', item_number: '1', year: String(YEAR), measure: 'forecast', period_start: '', period_end: '', method: '', ...months('10') },
      { item_type: 'opex', item_number: '2', year: String(YEAR), measure: 'forecast', period_start: '', period_end: '', method: '', ...months('20') },
    ];
    const file = { buffer: Buffer.from(`﻿${BUDGET_ROWS_HEADERS.join(';')}\n${lines.map((l) => BUDGET_ROWS_HEADERS.map((h) => l[h] ?? '').join(';')).join('\n')}\n`, 'utf8') } as any;

    // Each pauses once it holds the months of its first line.
    const copyHolds = race.gate(copier, { label: 'lock the first line\'s months', when: 'after', match: sql.lockOn('spend_amounts') });
    const copyWork = race.start(copier, (manager) => copyBudgetColumn(
      { manager, audit: captureAudit() as any, freeze: noFreeze },
      'opex',
      { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR, destinationColumn: 'revision', percentageIncrease: 0, overwrite: true, dryRun: false },
      null,
    ));
    assert.equal(await progress(copyWork, { party: copier, gate: copyHolds }), 'gated', 'harness: the copy must pause holding its first line');

    const importHolds = race.gate(importer, { label: 'lock the first line\'s months', when: 'after', match: sql.lockOn('spend_amounts') });
    const importWork = race.start(importer, (manager) => new BudgetRowsCsvService(captureAudit() as any, noFreeze as any).importCsv(
      { file, dryRun: false, userId: null, access: { isAdmin: true, permissions: {} } },
      { manager, tenantId: race.tenantId },
    ));
    // Today: pauses holding the oldest line. With 3F: refused at once (409), or waits for the copy.
    await progress(importWork, { party: importer, gate: importHolds });

    copyHolds.release();
    importHolds.release();
    const [copyDone, importDone] = await Promise.all([settle(copyWork), settle(importWork)]);
    const deadlocked = (o: Outcome) => !o.ok && pgCode(o.error) === '40P01';
    assert.ok(
      !deadlocked(copyDone) && !deadlocked(importDone),
      `a column copy and a budget rows import over the same two lines deadlocked: the ${deadlocked(copyDone) ? 'copy' : 'import'} `
      + 'was aborted with 40P01 and rolled back entirely',
    );
    assertClean(copyDone, 'the column copy', [409]);
    assertClean(importDone, 'the budget rows import', [409]);
    assert.ok(copyDone.ok || importDone.ok, 'at least one of the two operations goes through');
    if (importDone.ok) assert.equal((importDone.value as any)?.ok, true, `the import result: ${JSON.stringify((importDone.value as any)?.errors)}`);

    // What went through is complete: the copy wrote Revision on both lines, the import Forecast on both.
    const [row] = await race.read(
      `SELECT sum(committed) FILTER (WHERE version_id = $1)::text AS older_revision, sum(committed) FILTER (WHERE version_id = $2)::text AS newer_revision,
              sum(forecast) FILTER (WHERE version_id = $1)::text AS older_forecast, sum(forecast) FILTER (WHERE version_id = $2)::text AS newer_forecast
       FROM spend_amounts WHERE version_id IN ($1, $2)`,
      [older.versionId, newer.versionId],
    );
    if (copyDone.ok) assert.deepEqual([Number(row.older_revision), Number(row.newer_revision)], [1200, 2400], 'the copy wrote both lines');
    if (importDone.ok) assert.deepEqual([Number(row.older_forecast), Number(row.newer_forecast)], [120, 240], 'the import wrote both lines');
  });
}

void runRaceSpecs('Mass budget operation races', [
  ['Annexe A #16: a column copy and a budget rows import over the same lines do not deadlock (3F)', copyVersusImport],
]);
