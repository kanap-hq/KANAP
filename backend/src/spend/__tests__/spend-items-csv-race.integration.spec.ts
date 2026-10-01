import { csvService, itemService, lineBody, seedCompany } from './cost-center.fixtures';
import { assert, assertSucceeded, progress, runRaceSpecs, settle, sql, withRace } from './race-harness';

// Race of the OPEX line import (plan planning/perf-scale, step 0.3, Annexe
// A #3), fixed in lot 3B.
//
// The OPEX line import reads every existing line first
// (`spend-items-csv.service.ts:551-555`), then writes each one by merging the
// file's row into the line it read and calling TypeORM `save()`
// (`:595-618`, `:704-718`). A column the file does not carry, changed by a
// user meanwhile, is put back to the value read at the start of the import.
// Fixed: the import locks the lines it names before deciding, and writes only
// the columns present in the file, under the line's lock
// (`item-locked-update.ts`); the user's change stays. The new CSV engine adds
// the freshness check of the export (decision D6).

async function importVersusEdit() {
  await withRace('opex-csv', async (race) => {
    const { itemId, projectId } = await race.seedWith(async (runner) => {
      const { companyId, accountId } = await seedCompany(runner, race.tenantId, 'Race company', 6000);
      const [project] = await runner.query(
        `INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, 'Race project', 1) RETURNING id`,
        [race.tenantId],
      );
      const line = await itemService('opex').create(
        lineBody('opex', 'Race line', { paying_company_id: companyId, account_id: accountId, notes: 'Start' }), undefined, { manager: runner.manager },
      );
      return { itemId: line.id as string, projectId: project.id as string };
    });
    const importer = await race.open('OPEX line import');
    const user = await race.open('user (project)');

    const csv = csvService('opex');
    const headers: string[] = csv.csvHeaders();
    const row: Record<string, string> = {
      product_name: 'Race line', company_name: 'Race company', account_number: '6000', currency: 'EUR', status: 'enabled', notes: 'From the file',
    };
    const file = { buffer: Buffer.from(`${headers.join(';')}\n${headers.map((h) => row[h] ?? '').join(';')}\n`, 'utf8') } as any;

    const importRead = race.gate(importer, { label: 'read the existing line', when: 'after', match: sql.select('spend_items') });
    const importWork = race.start(importer, (manager) => csv.importCsv({ file, dryRun: false, userId: null }, { manager }));
    assert.equal(await progress(importWork, { party: importer, gate: importRead }), 'gated', 'harness: the import must pause after reading the line');

    const userWork = race.start(user, (manager) => itemService('opex').update(itemId, { project_id: projectId }, undefined, { manager }));
    await progress(userWork, { party: user });
    importRead.release();
    const [importDone, userDone] = await Promise.all([settle(importWork), settle(userWork)]);
    assertSucceeded(userDone, 'the user\'s project change');
    assertSucceeded(importDone, 'the import');
    assert.equal((importDone as any).value?.ok, true, `the import result: ${JSON.stringify((importDone as any).value?.errors)}`);

    const stored = await race.readOne(
      `SELECT i.notes, p.name AS project FROM spend_items i LEFT JOIN portfolio_projects p ON p.id = i.project_id WHERE i.id = $1`,
      [itemId],
    );
    assert.equal(stored?.notes, 'From the file', 'the file\'s notes are imported');
    assert.equal(
      stored?.project, 'Race project',
      `the import put the line's project back to ${stored?.project ? `"${stored.project}"` : 'none'}: a column absent from the file `
      + 'was rewritten with the state read at the start of the import, over the user\'s change',
    );
  });
}

void runRaceSpecs('OPEX line import races', [
  ['Annexe A #3: a line import keeps a column absent from the file that a user changed meanwhile (3F, 3B)', importVersusEdit],
]);
