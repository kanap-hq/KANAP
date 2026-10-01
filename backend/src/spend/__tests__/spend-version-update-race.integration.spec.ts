import { CapexVersionsService } from '../../capex/capex-versions.service';
import { SpendVersionsService } from '../spend-versions.service';
import { captureAudit, Kind, seedItem, seedVersion } from './round-inputs.fixtures';
import { assert, assertSucceeded, progress, runRaceSpecs, settle, sql, withRace } from './race-harness';

// Known race of the budget version update (plan planning/perf-scale, step
// 0.3), failing until lot 3B lands (split from spend-versions-race, whose
// create races lot 3A fixed).
//
// Annexe A #2 on versions: `updateForItem` merges the body into the version it
// read and `save()`s it, so a concurrent change of another field is put back.
// Target: targeted UPDATE under the version lock.

const YEAR = 2027;
const currencySettings = { getSettings: async () => ({ reportingCurrency: 'EUR' }) };

function versionsService(kind: Kind): { updateForItem: (...args: any[]) => Promise<any> } {
  return kind === 'opex'
    ? new SpendVersionsService(undefined as any, undefined as any, captureAudit() as any, currencySettings as any)
    : new CapexVersionsService(undefined as any, undefined as any, captureAudit() as any, currencySettings as any);
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

void runRaceSpecs('Budget version update races', [
  ['Annexe A #2 on versions: a view change keeps the allocation method committed meanwhile (3B)', methodVersusView],
]);
