import { CapexVersionsService } from '../../capex/capex-versions.service';
import { BUDGET_ROWS_HEADERS, BudgetRowsCsvService } from '../budget-rows-csv.service';
import { SpendVersionsService } from '../spend-versions.service';
import { captureAudit, Kind, noFreeze, seedItem, seedVersion } from './round-inputs.fixtures';
import { assert, assertSucceeded, progress, runRaceSpecs, settle, sql, withRace } from './race-harness';

// Known races of the budget versions (plan planning/perf-scale, step 0.3).
//
// Annexe A #13, failing until lot 3A lands: a version is created after a
// check without lock (`spend-versions.service.ts:30-66`, the CAPEX twin, and
// `createBudgetVersion` used by the copy and both CSV imports). Two callers
// that both see no version for the year both insert; the second hits the
// unique index (23505): a 500 for the budget tab's get-or-create, the whole
// import rolled back for a CSV. CAPEX turns the year index violation into a
// 400, still an error for the second user.
// Target: one shared get-or-create (`INSERT … ON CONFLICT (item, year) DO
// NOTHING`, then read): both callers end with the same version, no error.
//
// Annexe A #2 on versions, failing until lot 3B lands: `updateForItem` merges
// the body into the version it read and `save()`s it, so a concurrent change
// of another field is put back. Target: targeted UPDATE under the version lock.

const YEAR = 2027;
const currencySettings = { getSettings: async () => ({ reportingCurrency: 'EUR' }) };
const VERSIONS: Record<Kind, string> = { opex: 'spend_versions', capex: 'capex_versions' };
const ITEM_FK: Record<Kind, string> = { opex: 'spend_item_id', capex: 'capex_item_id' };

function versionsService(kind: Kind): { createForItem: (...args: any[]) => Promise<any>; updateForItem: (...args: any[]) => Promise<any> } {
  return kind === 'opex'
    ? new SpendVersionsService(undefined as any, undefined as any, captureAudit() as any, currencySettings as any)
    : new CapexVersionsService(undefined as any, undefined as any, captureAudit() as any, currencySettings as any);
}

/** What the budget tab posts for a year without version (`BudgetTab.tsx` ensureVersion). */
const uiVersion = { version_name: `Y${YEAR}`, budget_year: YEAR, as_of_date: `${YEAR}-01-01`, input_grain: 'monthly', notes: null };

async function versionsOf(race: { read: (text: string, params?: unknown[]) => Promise<any[]> }, kind: Kind, itemId: string) {
  return race.read(`SELECT id FROM ${VERSIONS[kind]} WHERE ${ITEM_FK[kind]} = $1 AND budget_year = $2`, [itemId, YEAR]);
}

/** Two budget tabs type in the same year without version: both get the same version. */
async function twoTabsCreateTheYear(kind: Kind) {
  await withRace(`${kind}-version`, async (race) => {
    const itemId = await race.seedWith((runner) => seedItem(runner, kind, race.tenantId, 1));
    const a = await race.open('A');
    const b = await race.open('B');

    const aInsert = race.gate(a, { label: 'insert the version', when: 'before', match: sql.insertInto(VERSIONS[kind]) });
    const aWork = race.start(a, (manager) => versionsService(kind).createForItem(itemId, { ...uiVersion }, undefined, { manager }));
    assert.equal(await progress(aWork, { party: a, gate: aInsert }), 'gated', 'harness: A must pause before inserting the version');

    const bWork = race.start(b, (manager) => versionsService(kind).createForItem(itemId, { ...uiVersion }, undefined, { manager }));
    await progress(bWork, { party: b });
    aInsert.release();
    const [aDone, bDone] = await Promise.all([settle(aWork), settle(bWork)]);
    assertSucceeded(bDone, 'B (first to commit)');
    assertSucceeded(aDone, 'A (second get-or-create of the same year)');
    assert.equal((aDone as any).value?.id, (bDone as any).value?.id, 'both callers must end with the same version');
    assert.equal((await versionsOf(race, kind, itemId)).length, 1, 'one version for the item and year');
  });
}

/** A budget rows import writes a year without version while the budget tab creates it: the import goes through. */
async function importVersusTab() {
  await withRace('opex-version-csv', async (race) => {
    const itemId = await race.seedWith((runner) => seedItem(runner, 'opex', race.tenantId, 7));
    const importer = await race.open('CSV import');
    const tab = await race.open('budget tab');
    const months = { jan: '100', feb: '100', mar: '100', apr: '100', may: '100', jun: '100', jul: '100', aug: '100', sep: '100', oct: '100', nov: '100', dec: '100' };
    const line: Record<string, string> = { item_type: 'opex', item_number: '7', year: String(YEAR), measure: 'planned', period_start: '', period_end: '', ...months, method: '' };
    const file = { buffer: Buffer.from(`﻿${BUDGET_ROWS_HEADERS.join(';')}\n${BUDGET_ROWS_HEADERS.map((h) => line[h] ?? '').join(';')}\n`, 'utf8') } as any;

    const importInsert = race.gate(importer, { label: 'insert the version', when: 'before', match: sql.insertInto('spend_versions') });
    const importWork = race.start(importer, (manager) => new BudgetRowsCsvService(captureAudit() as any, noFreeze as any).importCsv(
      { file, dryRun: false, userId: null, access: { isAdmin: true, permissions: {} } },
      { manager, tenantId: race.tenantId },
    ));
    assert.equal(await progress(importWork, { party: importer, gate: importInsert }), 'gated', 'harness: the import must pause before inserting the version');

    const tabWork = race.start(tab, (manager) => versionsService('opex').createForItem(itemId, { ...uiVersion }, undefined, { manager }));
    await progress(tabWork, { party: tab });
    importInsert.release();
    const [importDone, tabDone] = await Promise.all([settle(importWork), settle(tabWork)]);
    assertSucceeded(tabDone, 'the budget tab');
    assertSucceeded(importDone, 'the CSV import (the whole file is rolled back otherwise)');
    assert.equal((importDone as any).value?.ok, true, `the import must succeed: ${JSON.stringify((importDone as any).value?.errors)}`);

    const versions = await versionsOf(race, 'opex', itemId);
    assert.equal(versions.length, 1, 'one version for the item and year');
    const [row] = await race.read(`SELECT sum(planned)::text AS total FROM spend_amounts WHERE version_id = $1`, [versions[0].id]);
    assert.equal(Number(row?.total), 1200, 'the imported months are in the shared version');
  });
}

/**
 * The allocations tab changes the method while the budget tab changes the
 * view (both PATCH the version): the view change must not put the old method
 * back.
 */
async function methodVersusView() {
  await withRace('opex-version-update', async (race) => {
    const { itemId, versionId } = await race.seedWith(async (runner) => {
      const itemId = await seedItem(runner, 'opex', race.tenantId, 1);
      return { itemId, versionId: await seedVersion(runner, 'opex', race.tenantId, itemId, YEAR, 'annual') };
    });
    const allocationsTab = await race.open('allocations tab (method)');
    const budgetTab = await race.open('budget tab (view)');

    const viewRead = race.gate(budgetTab, { label: 'read the version', when: 'after', match: sql.select('spend_versions') });
    const viewWork = race.start(budgetTab, (manager) => versionsService('opex').updateForItem(itemId, { id: versionId, input_grain: 'monthly' } as any, undefined, { manager }));
    assert.equal(await progress(viewWork, { party: budgetTab, gate: viewRead }), 'gated', 'harness: the view change must pause after reading the version');

    const methodWork = race.start(allocationsTab, (manager) => versionsService('opex').updateForItem(itemId, { id: versionId, allocation_method: 'manual_pct' } as any, undefined, { manager }));
    await progress(methodWork, { party: allocationsTab });
    viewRead.release();
    const [methodDone, viewDone] = await Promise.all([settle(methodWork), settle(viewWork)]);
    assertSucceeded(methodDone, 'the method change');
    assertSucceeded(viewDone, 'the view change');

    const row = await race.readOne(`SELECT input_grain::text AS input_grain, allocation_method FROM spend_versions WHERE id = $1`, [versionId]);
    assert.equal(row?.input_grain, 'monthly', 'the view change is saved');
    assert.equal(
      row?.allocation_method, 'manual_pct',
      `the view change put the allocation method back to "${row?.allocation_method}" over the "manual_pct" committed meanwhile`,
    );
  });
}

void runRaceSpecs('Budget version races', [
  ['Annexe A #13: two budget tabs create the same OPEX year, both get the version (3A)', () => twoTabsCreateTheYear('opex')],
  ['Annexe A #13: two budget tabs create the same CAPEX year, both get the version (3A)', () => twoTabsCreateTheYear('capex')],
  ['Annexe A #13: a budget rows import and a budget tab create the same year, the import goes through (3A)', importVersusTab],
  ['Annexe A #2 on versions: a view change keeps the allocation method committed meanwhile (3B)', methodVersusView],
]);
