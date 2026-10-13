import { CapexVersionsService } from '../spend-versions.service';
import { SpendVersionsService } from '../spend-versions.service';
import { loadBudgetFile } from './budget-file.fixtures';
import { captureAudit, Kind, seedItem } from './round-inputs.fixtures';
import { assert, assertSucceeded, httpStatus, progress, runRaceSpecs, settle, sql, withRace } from './race-harness';

// Races of the budget version create (plan planning/perf-scale, step 0.3,
// Annexe A #13), fixed by lot 3A.
//
// A version used to be created after a check without lock
// (`spend-versions.service.ts`, the CAPEX twin, and `createBudgetVersion` used
// by the copy and both CSV imports). Two callers that both saw no version for
// the year both inserted; the second hit the unique index (23505): a 500 for
// the budget tab's get-or-create, the whole import rolled back for a CSV.
// CAPEX turned the year index violation into a 400, still an error for the
// second user. Now one shared get-or-create (`budget-version-ensure.ts`:
// `INSERT … ON CONFLICT DO NOTHING`, then read): both callers end with the
// same version, no error.
//
// The version update race (Annexe A #2 on versions, lot 3B) is in
// spend-version-update-race.integration.spec.ts.

const YEAR = 2027;
const currencySettings = { getSettings: async () => ({ reportingCurrency: 'EUR' }) };
// The lines of both natures and their versions are in the spend_* tables since lot Z1.
const VERSIONS: Record<Kind, string> = { opex: 'spend_versions', capex: 'spend_versions' };
const ITEMS: Record<Kind, string> = { opex: 'spend_items', capex: 'spend_items' };
const ITEM_FK: Record<Kind, string> = { opex: 'spend_item_id', capex: 'spend_item_id' };

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

/**
 * The AI's create_version (`refuseExisting`) meets a budget tab creating the
 * same year: the tab gets its version, the AI's action is refused (409)
 * instead of reporting, and auditing, a creation that did not happen.
 */
async function aiCreateVersusTab(kind: Kind) {
  await withRace(`${kind}-version-ai`, async (race) => {
    const itemId = await race.seedWith((runner) => seedItem(runner, kind, race.tenantId, 1));
    const ai = await race.open('AI create_version');
    const tab = await race.open('budget tab');
    const aiAudit = captureAudit();
    const aiService: { createForItem: (...args: any[]) => Promise<unknown> } = kind === 'opex'
      ? new SpendVersionsService(undefined as any, undefined as any, aiAudit as any, currencySettings as any)
      : new CapexVersionsService(undefined as any, undefined as any, aiAudit as any, currencySettings as any);

    // Before the line lock (lot 3B): every version create locks the line first, so the tab can
    // only create the year before the AI takes the line, not between the lock and the insert.
    const aiInsert = race.gate(ai, { label: 'lock the line', when: 'before', match: sql.lockOn(ITEMS[kind]) });
    const aiWork = race.start(ai, (manager) => aiService.createForItem(itemId, { ...uiVersion } as any, undefined, { manager, refuseExisting: true }));
    assert.equal(await progress(aiWork, { party: ai, gate: aiInsert }), 'gated', 'harness: the AI must pause before locking the line');
    const tabWork = race.start(tab, (manager) => versionsService(kind).createForItem(itemId, { ...uiVersion }, undefined, { manager }));
    await progress(tabWork, { party: tab });
    aiInsert.release();
    const [aiDone, tabDone] = await Promise.all([settle(aiWork), settle(tabWork)]);
    assertSucceeded(tabDone, 'the budget tab');
    assert.ok(!aiDone.ok && httpStatus(aiDone.error) === 409, `the AI's create must be refused with 409; it ${aiDone.ok ? 'succeeded' : `failed: ${(aiDone.error as Error)?.message}`}`);
    assert.match((aiDone as any).error.message, new RegExp(`already has a budget version for ${YEAR}`));
    assert.deepEqual(aiAudit.entries, [], 'no creation audited for the AI');
    assert.equal((await versionsOf(race, kind, itemId)).length, 1, 'one version for the item and year');
  });
}

/**
 * A budget file load writes a year without version while the budget tab
 * creates it: the load goes through and both share one version. The load
 * holds the line when it reaches the insert, so the tab waits for it.
 */
async function importVersusTab() {
  await withRace('opex-version-csv', async (race) => {
    const itemId = await race.seedWith((runner) => seedItem(runner, 'opex', race.tenantId, 7));
    const importer = await race.open('budget file load');
    const tab = await race.open('budget tab');
    const header = Array.from({ length: 12 }, (_, i) => `budget_${YEAR}_${String(i + 1).padStart(2, '0')}`).join(',');
    const file = `item_number,${header}\nOPX-7,${Array.from({ length: 12 }, () => '100').join(',')}\n`;

    const importInsert = race.gate(importer, { label: 'insert the version', when: 'before', match: sql.insertInto('spend_versions') });
    const importWork = race.start(importer, (manager) => loadBudgetFile(manager, 'opex', race.tenantId, file));
    assert.equal(await progress(importWork, { party: importer, gate: importInsert }), 'gated', 'harness: the load must pause before inserting the version');

    const tabWork = race.start(tab, (manager) => versionsService('opex').createForItem(itemId, { ...uiVersion }, undefined, { manager }));
    await progress(tabWork, { party: tab });
    importInsert.release();
    const [importDone, tabDone] = await Promise.all([settle(importWork), settle(tabWork)]);
    assertSucceeded(tabDone, 'the budget tab');
    assertSucceeded(importDone, 'the budget file load (the whole file is rolled back otherwise)');
    assert.equal((importDone as any).value?.ok, true, `the load must succeed: ${JSON.stringify((importDone as any).value?.errors)}`);

    const versions = await versionsOf(race, 'opex', itemId);
    assert.equal(versions.length, 1, 'one version for the item and year');
    assert.equal((tabDone as any).value?.id, versions[0].id, 'the tab got the version the load created');
    const [row] = await race.read(`SELECT sum(planned)::text AS total FROM spend_amounts WHERE version_id = $1`, [versions[0].id]);
    assert.equal(Number(row?.total), 1200, 'the imported months are in the shared version');
  });
}

void runRaceSpecs('Budget version races', [
  ['Annexe A #13: two budget tabs create the same OPEX year, both get the version (3A)', () => twoTabsCreateTheYear('opex')],
  ['Annexe A #13: two budget tabs create the same CAPEX year, both get the version (3A)', () => twoTabsCreateTheYear('capex')],
  ['Annexe A #13: a budget file load and a budget tab create the same year, the load goes through (3A)', importVersusTab],
  ['Annexe A #13: the AI creates an OPEX year a budget tab creates meanwhile, the AI is refused, not credited (3A)', () => aiCreateVersusTab('opex')],
  ['Annexe A #13: the AI creates a CAPEX year a budget tab creates meanwhile, the AI is refused, not credited (3A)', () => aiCreateVersusTab('capex')],
]);
