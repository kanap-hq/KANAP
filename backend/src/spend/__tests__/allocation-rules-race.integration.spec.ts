import { AllocationRulesService } from '../allocation-rules.service';
import { captureAudit } from './round-inputs.fixtures';
import { assert, assertSucceeded, progress, runRaceSpecs, settle, sql, withRace } from './race-harness';

// Race (plan planning/perf-scale, step 0.3, Annexe A #19), fixed by lot 3A:
// `setTenantMethod` now upserts. Runs in CI.
//
// `AllocationRulesService.setTenantMethod` reads the tenant's rule of the
// year, then inserts it when missing (`allocation-rules.service.ts:183-194`;
// the comment there accepts the failure). Two administrators setting the
// default of a year without rule: the second insert hits
// UNIQUE(tenant_id, fiscal_year) (23505), a 500.
// Target: an upsert; both saves succeed, the year has one rule, the last
// save's method.

const YEAR = 2027;

function rulesService() {
  return new AllocationRulesService(undefined as any, captureAudit() as any);
}

async function twoAdminsSetTheYear() {
  await withRace('allocation-rules', async (race) => {
    const a = await race.open('A (IT users)');
    const b = await race.open('B (headcount)');

    const aInsert = race.gate(a, { label: 'insert the rule', when: 'before', match: sql.insertInto('allocation_rules') });
    const aWork = race.start(a, (manager) => rulesService().setTenantMethod(race.tenantId, YEAR, { mode: 'auto', method: 'it_users' }, null, { manager }));
    assert.equal(await progress(aWork, { party: a, gate: aInsert }), 'gated', 'harness: A must pause before inserting the rule');

    const bWork = race.start(b, (manager) => rulesService().setTenantMethod(race.tenantId, YEAR, { mode: 'auto', method: 'headcount' }, null, { manager }));
    await progress(bWork, { party: b });
    aInsert.release();
    const [aDone, bDone] = await Promise.all([settle(aWork), settle(bWork)]);
    assertSucceeded(bDone, 'B (first to commit)');
    assertSucceeded(aDone, 'A (same year, saved last)');

    const rules: Array<{ method: string }> = await race.read(
      `SELECT method FROM allocation_rules WHERE tenant_id = $1 AND fiscal_year = $2`,
      [race.tenantId, YEAR],
    );
    assert.deepEqual(rules.map((r) => r.method), ['it_users'], 'one rule for the year, with the method saved last');
  });
}

void runRaceSpecs('Allocation rule races', [
  ['Annexe A #19: two administrators set the default allocation of a year without rule (3A)', twoAdminsSetTheYear],
]);
