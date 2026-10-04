import dataSource from '../../data-source';
import { FreezeService } from '../../freeze/freeze.service';
import { UserTimeAggregateService } from '../../portfolio/services/user-time-aggregate.service';
import { BUDGET_OPERATION_RUNNING } from '../budget-locks';
import { SpendItem } from '../spend-item.entity';
import { SpendItemsDeleteService } from '../spend-items-delete.service';
import { loadBudgetFile } from './budget-file.fixtures';
import { itemService, lineBody, seedCompany } from './cost-center.fixtures';
import { captureAudit, seedVersion } from './round-inputs.fixtures';
import {
  assert,
  assertSucceeded,
  describe,
  httpStatus,
  Outcome,
  pgCode,
  progress,
  Race,
  runRaceSpecs,
  settle,
  sql,
  withRace,
} from './race-harness';

// Freeze and unfreeze of a year against the other budget writers (plan
// planning/perf-scale, lot 3B review). Freezing or unfreezing the tenant's
// default column pins or unpins the FX rate set on every version of the year
// (`freeze.service.ts`): one UPDATE over many lines. It used to take no lock
// first, so it locked the versions in the order it scanned them. Against an
// item CSV import (now the budget file load), which holds the tenant's
// budget-operations lock and then its lines and versions in id order, each
// ended up holding a version the other wanted: PostgreSQL ended the unfreeze
// with a deadlock (40P01).
//
// Fixed: a pin or unpin is a bulk budget operation. It takes the tenant's
// lock (refused at once with a 409 `operation_running` while another bulk
// operation runs, and refusing them meanwhile), then the year's lines, then
// their versions, in id order (`budget-locks.ts`), before its UPDATE.

const YEAR = new Date().getFullYear();

/** The freeze service with its outside services stubbed: the latest rate set is `rateSetId`. */
function freezeService(rateSetId: string | null = null) {
  return new FreezeService(
    undefined as any,
    { refreshTenant: async () => undefined } as any,
    { getLatestRateSet: async () => (rateSetId ? { id: rateSetId } : null) } as any,
    { getSettings: async () => ({ reportingCurrency: 'EUR' }) } as any,
  );
}

const unfreeze = (manager: any) => freezeService().unfreeze(YEAR, [{ scope: 'opex' }], null, { manager });

/** Refused at once with a 409 `operation_running` that names the running operation. */
function assertOperationRunning(outcome: Outcome, who: string) {
  assert.notEqual(pgCode((outcome as any).error), '40P01', `${who} ended in a deadlock (40P01)`);
  assert.ok(!outcome.ok && httpStatus(outcome.error) === 409, `${who} must be refused with a 409 while a bulk operation runs; it ${describe(outcome)}`);
  const body = (outcome.error as any).getResponse?.();
  assert.equal(body?.code, 'operation_running', `${who}: code operation_running`);
  assert.equal(body?.message, BUDGET_OPERATION_RUNNING, `${who}: the message says what runs`);
}

/** Two OPEX lines of the race company, each with its version of the year, pinned to a rate set. */
async function seedPinnedLines(race: Race) {
  return race.seedWith(async (runner) => {
    const { companyId } = await seedCompany(runner, race.tenantId, 'Race company', 6000);
    const a = await itemService('opex').create(lineBody('opex', 'Line A', { paying_company_id: companyId }), undefined, { manager: runner.manager });
    const b = await itemService('opex').create(lineBody('opex', 'Line B', { paying_company_id: companyId }), undefined, { manager: runner.manager });
    const [{ id: rateSetId }] = await runner.query(
      `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates) VALUES ($1, $2, 'EUR', '{}'::jsonb) RETURNING id`,
      [race.tenantId, YEAR],
    );
    // Line A's version first: an UPDATE of the year's versions in scan order meets it first.
    const va = await seedVersion(runner, 'opex', race.tenantId, a.id, YEAR);
    const vb = await seedVersion(runner, 'opex', race.tenantId, b.id, YEAR);
    await runner.query(`UPDATE spend_versions SET fx_rate_set_id = $2 WHERE tenant_id = $1 AND budget_year = $3`, [race.tenantId, rateSetId, YEAR]);
    return { a: a.id as string, b: b.id as string, va, vb, rateSetId: rateSetId as string };
  });
}

/** The OPEX budget file naming both lines, line B first, with this year's budget changed. */
async function importFile(race: Race, s: { a: string; b: string }): Promise<string> {
  const rows = await race.read(`SELECT id, item_number::int AS n FROM spend_items WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [race.tenantId, [s.a, s.b]]);
  const number = (id: string) => rows.find((row: any) => row.id === id)!.n;
  return `item_number,name,currency,budget_${YEAR}\nOPX-${number(s.b)},Line B,EUR,1200.00\nOPX-${number(s.a)},Line A,EUR,1200.00\n`;
}

async function pinnedVersions(race: Race): Promise<number> {
  const [row] = await race.read(`SELECT count(*)::int AS n FROM spend_versions WHERE budget_year = $1 AND fx_rate_set_id IS NOT NULL`, [YEAR]);
  return Number(row.n);
}

/** The reviewer's case: an unfreeze while an OPEX budget file load holds one of the year's versions. */
async function unfreezeDuringImport() {
  await withRace('freeze-import', async (race) => {
    const s = await seedPinnedLines(race);
    const file = await importFile(race, s);
    const importer = await race.open('OPEX budget file load');
    const freezer = await race.open('unfreeze (FX unpin)');

    const importHolds = race.gate(importer, { label: 'lock the versions of the year', when: 'after', match: sql.lockOn('spend_versions') });
    const importWork = race.start(importer, (manager) => loadBudgetFile(manager, 'opex', race.tenantId, file));
    assert.equal(await progress(importWork, { party: importer, gate: importHolds }), 'gated', 'harness: the load must pause holding the versions');

    const freezeWork = race.start(freezer, unfreeze);
    const freezeProgress = await progress(freezeWork, { party: freezer });
    importHolds.release();
    const [importDone, freezeDone] = await Promise.all([settle(importWork), settle(freezeWork)]);
    assert.notEqual(pgCode((importDone as any).error), '40P01', 'the load ended in a deadlock (40P01)');
    assertSucceeded(importDone, 'the load');
    assert.equal((importDone as any).value?.ok, true, `the load result: ${JSON.stringify((importDone as any).value?.errors)}`);
    assert.equal((importDone as any).value?.updated, 2, 'the load wrote both lines');
    assertOperationRunning(freezeDone, 'the unfreeze');
    assert.equal(freezeProgress, 'settled', 'the unfreeze does not wait for the load: it is refused at once');
    assert.equal(await pinnedVersions(race), 2, 'the refused unfreeze unpinned nothing');

    // Once the load is done, the unfreeze runs.
    assertSucceeded(await settle(race.start(freezer, unfreeze)), 'the unfreeze after the load');
    assert.equal(await pinnedVersions(race), 0, 'the unfreeze unpinned the year');
  });
}

/** The other way round: while an unfreeze unpins the year, a budget file load is refused at once. */
async function importDuringUnfreeze() {
  await withRace('import-freeze', async (race) => {
    const s = await seedPinnedLines(race);
    const file = await importFile(race, s);
    const freezer = await race.open('unfreeze (FX unpin)');
    const importer = await race.open('OPEX budget file load');

    const freezeHolds = race.gate(freezer, { label: 'lock the versions of the year', when: 'after', match: sql.lockOn('spend_versions') });
    const freezeWork = race.start(freezer, unfreeze);
    assert.equal(await progress(freezeWork, { party: freezer, gate: freezeHolds }), 'gated', 'harness: the unfreeze must pause holding the versions');

    const importWork = race.start(importer, (manager) => loadBudgetFile(manager, 'opex', race.tenantId, file));
    assert.equal(await progress(importWork, { party: importer }), 'settled', 'the load does not wait for the unfreeze');
    assertOperationRunning(await settle(importWork), 'the load');
    freezeHolds.release();
    assertSucceeded(await settle(freezeWork), 'the unfreeze');
    assert.equal(await pinnedVersions(race), 0, 'the unfreeze unpinned the year');

    // Once the unfreeze is done, the load runs.
    const after = await settle(race.start(importer, (manager) => loadBudgetFile(manager, 'opex', race.tenantId, file)));
    assertSucceeded(after, 'the load after the unfreeze');
    assert.equal((after as any).value?.updated, 2, 'the load wrote both lines');
  });
}

/**
 * A freeze pins after a bulk line delete, which holds the lines in id order
 * and deletes each one's versions in turn: the freeze waits for the first
 * line, it never holds a version the delete still has to remove.
 */
async function freezeDuringBulkDelete() {
  await withRace('freeze-delete', async (race) => {
    const s = await seedPinnedLines(race);
    await race.seedWith((runner) => runner.query(`UPDATE spend_versions SET fx_rate_set_id = NULL WHERE tenant_id = $1`, [race.tenantId]));
    const remover = await race.open('bulk delete');
    const freezer = await race.open('freeze (FX pin)');
    const deleter = new SpendItemsDeleteService(
      dataSource.getRepository(SpendItem), undefined as any, undefined as any, undefined as any,
      captureAudit() as any, { deleteFile: async () => undefined } as any, new UserTimeAggregateService(),
    );

    // Paused before the second line's versions go: it holds both lines and the first line's version.
    const deleteHolds = race.gate(remover, { label: 'delete the second line\'s versions', when: 'before', match: sql.deleteFrom('spend_versions'), nth: 2 });
    const deleteWork = race.start(remover, (manager) => deleter.bulkDelete([s.a, s.b], null, { manager }));
    assert.equal(await progress(deleteWork, { party: remover, gate: deleteHolds }), 'gated', 'harness: the delete must pause between the two lines');

    const freezeWork = race.start(freezer, (manager) => freezeService(s.rateSetId).freeze(YEAR, [{ scope: 'opex' }], null, { manager }));
    assert.equal(await progress(freezeWork, { party: freezer }), 'blocked', 'the freeze waits for the delete');
    deleteHolds.release();
    const [deleteDone, freezeDone] = await Promise.all([settle(deleteWork), settle(freezeWork)]);
    assertSucceeded(deleteDone, 'the bulk delete');
    assert.deepEqual((deleteDone as any).value?.failed, [], `no line failed to delete: ${JSON.stringify((deleteDone as any).value?.failed)}`);
    assert.notEqual(pgCode((freezeDone as any).error), '40P01', 'the freeze ended in a deadlock (40P01)');
    assertSucceeded(freezeDone, 'the freeze');
    const [left] = await race.read(`SELECT count(*)::int AS n FROM spend_items WHERE id = ANY($1::uuid[])`, [[s.a, s.b]]);
    assert.equal(Number(left.n), 0, 'both lines are deleted');
  });
}

void runRaceSpecs('Freeze and unfreeze against the bulk budget operations', [
  ['an unfreeze during an OPEX budget file load is refused at once, never a deadlock (3B review)', unfreezeDuringImport],
  ['an OPEX budget file load during an unfreeze is refused at once (3B review)', importDuringUnfreeze],
  ['a freeze during a bulk line delete waits for it, never a deadlock (3B review)', freezeDuringBulkDelete],
]);
