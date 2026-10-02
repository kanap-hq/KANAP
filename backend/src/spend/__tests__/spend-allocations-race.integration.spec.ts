import { SpendAllocationsService } from '../spend-allocations.service';
import { seedCompany } from './cost-center.fixtures';
import { captureAudit, seedItem, seedVersion } from './round-inputs.fixtures';
import { assert, assertClean, progress, runRaceSpecs, settle, sql, withRace } from './race-harness';

// Known race (plan planning/perf-scale, step 0.3, Annexe A #11), failing until
// lot 3E lands (with the unique index of 3A).
//
// Today `SpendAllocationsService.bulkUpsert` deletes the version's rows and
// inserts the new set, without locking the version and without a unique
// index on (version, company, department). Two saves of the same version:
// B's DELETE waits for the row A deleted, then (its snapshot predating A's
// commit) deletes nothing, and B inserts its set next to A's: the version
// ends with the union of both sets, 200 %.
//
// Target: the save locks the version first (PUT of method, driver and rows
// under the version lock, 3E); the version ends with one of the two sets,
// summing to 100 %. The second save may be refused with a 409 (stale base
// signature), never with a raw database error.

function allocationsService() {
  return new SpendAllocationsService(undefined as any, undefined as any, undefined as any, captureAudit() as any);
}

const rowsKey = (rows: Array<{ company_id: string; allocation_pct: string | number }>) =>
  rows.map((r) => `${r.company_id}:${Number(r.allocation_pct)}`).sort().join(',');

async function twoManualSaves() {
  await withRace('allocations', async (race) => {
    const seeded = await race.seedWith(async (runner) => {
      const c1 = (await seedCompany(runner, race.tenantId, 'Company 1', 6001)).companyId;
      const c2 = (await seedCompany(runner, race.tenantId, 'Company 2', 6002)).companyId;
      const c3 = (await seedCompany(runner, race.tenantId, 'Company 3', 6003)).companyId;
      const itemId = await seedItem(runner, 'opex', race.tenantId, 1);
      const versionId = await seedVersion(runner, 'opex', race.tenantId, itemId, 2026);
      await runner.query(`UPDATE spend_versions SET allocation_method = 'manual_pct' WHERE id = $1`, [versionId]);
      // The version already has a manual split: both users replace it.
      await runner.query(
        `INSERT INTO spend_allocations (tenant_id, version_id, company_id, department_id, allocation_pct) VALUES ($1, $2, $3, NULL, 100)`,
        [race.tenantId, versionId, c1],
      );
      return { c1, c2, c3, versionId };
    });
    const { c1, c2, c3, versionId } = seeded;
    const setA = [{ company_id: c1, department_id: null, allocation_pct: 60 }, { company_id: c2, department_id: null, allocation_pct: 40 }];
    const setB = [{ company_id: c1, department_id: null, allocation_pct: 50 }, { company_id: c3, department_id: null, allocation_pct: 50 }];
    const a = await race.open('A');
    const b = await race.open('B');

    const aDeleted = race.gate(a, { label: 'replace the rows', when: 'after', match: sql.deleteFrom('spend_allocations') });
    const aWork = race.start(a, (manager) => allocationsService().bulkUpsert(versionId, setA, undefined, { manager }));
    assert.equal(await progress(aWork, { party: a, gate: aDeleted }), 'gated', 'harness: A must pause after deleting the rows');

    const bWork = race.start(b, (manager) => allocationsService().bulkUpsert(versionId, setB, undefined, { manager }));
    await progress(bWork, { party: b }); // waits for A today (the row A deleted), and on the version lock once fixed
    aDeleted.release();
    const [aDone, bDone] = await Promise.all([settle(aWork), settle(bWork)]);
    assertClean(aDone, 'A', [409]);
    assertClean(bDone, 'B', [409]);

    const rows: Array<{ company_id: string; allocation_pct: string }> = await race.read(
      `SELECT company_id, allocation_pct FROM spend_allocations WHERE version_id = $1`,
      [versionId],
    );
    const total = rows.reduce((sum, r) => sum + Number(r.allocation_pct), 0);
    const names = new Map([[c1, 'Company 1'], [c2, 'Company 2'], [c3, 'Company 3']]);
    const shown = rows.map((r) => `${names.get(r.company_id)} ${Number(r.allocation_pct)} %`).join(', ');
    assert.ok(
      Math.abs(total - 100) < 0.01 && [rowsKey(setA), rowsKey(setB)].includes(rowsKey(rows)),
      `the version must end with one of the two splits (100 %); it has ${rows.length} rows totalling ${total} %: ${shown}`,
    );
  });
}

void runRaceSpecs('Allocation save races', [
  ['Annexe A #11: two manual allocation saves of one version leave one split of 100 % (3E, 3A index)', twoManualSaves],
]);
