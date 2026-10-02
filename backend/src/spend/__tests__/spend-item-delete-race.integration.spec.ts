import dataSource from '../../data-source';
import { UserTimeAggregateService } from '../../portfolio/services/user-time-aggregate.service';
import { SpendItem } from '../spend-item.entity';
import { SpendItemsDeleteService } from '../spend-items-delete.service';
import { amountsService, captureAudit, noFreeze, repeat, seedLine } from './round-inputs.fixtures';
import { assert, assertClean, assertSucceeded, progress, runRaceSpecs, settle, sql, withRace } from './race-harness';

// Race of the line delete (plan planning/perf-scale, step 0.3, Annexe A #17),
// fixed in lot 3B.
//
// A budget cell save reads the version, then writes the months. The delete of
// the line (`spend-items-delete.service.ts:51-92`) takes no lock on the line
// and removes versions and months; committed between the cell's read and its
// write, it leaves the cell's INSERT pointing at a version that no longer
// exists: a raw foreign key violation (23503), a 500 that the autosave drops.
//
// Contract chosen: at service level the cell save either succeeds (it ran
// before the delete, which then removes its months too) or is refused with a
// clean HTTP error, 404 "not found" or 409 (`parent_gone`), never a raw
// database error. Lot 3B gives this: the delete locks the line first and
// every writer locks the line before its version, so the cell waits for the
// delete and then finds no line (or the delete waits for the cell). Lot 1D's
// filter (23503 → 409 parent_gone) only relabels the HTTP answer of today's
// code; it does not make this service-level spec pass, on purpose.
// Either way the line and everything under it are gone afterwards.

function deleteService() {
  return new SpendItemsDeleteService(
    dataSource.getRepository(SpendItem), undefined as any, undefined as any, undefined as any,
    captureAudit() as any, { deleteFile: async () => undefined } as any, new UserTimeAggregateService(),
  );
}

async function deleteVersusCellSave() {
  await withRace('delete', async (race) => {
    const { itemId, versionId } = await race.seedWith((runner) =>
      seedLine(runner, 'opex', race.tenantId, 2026, { planned: repeat('100', 12) }, 1));
    const cell = await race.open('budget cell');
    const remover = await race.open('delete');

    const cellRead = race.gate(cell, { label: 'read the version', when: 'after', match: sql.select('spend_versions') });
    const cellWork = race.start(cell, (manager) => amountsService('opex', captureAudit(), noFreeze).bulkUpsert(
      versionId, { kind: 'monthly', year: 2026, months: [{ period: '2026-03-01', planned: 123 }] }, null, { manager },
    ));
    assert.equal(await progress(cellWork, { party: cell, gate: cellRead }), 'gated', 'harness: the cell save must pause after reading the version');

    const deleteWork = race.start(remover, (manager) => deleteService().delete(itemId, { manager, userId: null }));
    await progress(deleteWork, { party: remover }); // finishes today; waits for the cell's lock on the line once fixed
    cellRead.release();
    const [cellDone, deleteDone] = await Promise.all([settle(cellWork), settle(deleteWork)]);
    assertSucceeded(deleteDone, 'the delete');
    assertClean(cellDone, 'the budget cell save', [404, 409]);

    const [left] = await race.read(
      `SELECT (SELECT count(*) FROM spend_items WHERE id = $1)::int AS items,
              (SELECT count(*) FROM spend_versions WHERE spend_item_id = $1)::int AS versions,
              (SELECT count(*) FROM spend_amounts WHERE version_id = $2)::int AS months`,
      [itemId, versionId],
    );
    assert.deepEqual(left, { items: 0, versions: 0, months: 0 }, 'the line and everything under it are gone');
  });
}

void runRaceSpecs('Line delete races', [
  ['Annexe A #17: a line delete during a budget cell save ends cleanly (3B)', deleteVersusCellSave],
]);
