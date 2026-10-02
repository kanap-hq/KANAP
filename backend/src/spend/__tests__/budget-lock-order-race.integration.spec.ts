import { AiFinancialPlanMutationSupportService } from '../../ai/mutation/ai-financial-plan-mutation-support.service';
import { copyBudgetColumn } from '../budget-column-operations';
import { SpendAllocationsService } from '../spend-allocations.service';
import { SpendVersionsService } from '../spend-versions.service';
import { itemService, lineBody, seedCompany } from './cost-center.fixtures';
import { amountsService, captureAudit, noFreeze, repeat, seedMonths, seedVersion } from './round-inputs.fixtures';
import { assert, assertClean, describe, Outcome, pgCode, progress, Race, runRaceSpecs, settle, sql, withRace } from './race-harness';

// One lock order for every budget writer (plan planning/perf-scale, lot 3B;
// `budget-locks.ts`): the line, its version, the months in period order, the
// round-input records, then allocations and links. The freshness counters'
// triggers update the version (`budget_rev`) and the line (`row_version`)
// after their children; that is deadlock-free only because each writer
// already holds the line and the version.
//
// Without the order, a version PATCH followed by a cell save (version, then
// months) and a cell save whose trigger bumps the version (months, then
// version) deadlock; so do an allocation save (version, then rows) and a
// line update whose analytics trigger bumps the line. Here every writer path
// meets the others on one version, under a gate and free running: none ends
// with a deadlock (40P01); each succeeds or is refused cleanly (the AI with
// a 409 when the amounts it previewed changed meanwhile).

const YEAR = 2026;
const currencySettings = { getSettings: async () => ({ reportingCurrency: 'EUR' }) };

type Seeded = { itemId: string; versionId: string; companies: string[]; axisId: string; values: string[] };

async function seed(race: Race): Promise<Seeded> {
  return race.seedWith(async (runner) => {
    const companies: string[] = [];
    for (const [i, name] of ['Company 1', 'Company 2'].entries()) companies.push((await seedCompany(runner, race.tenantId, name, 6001 + i)).companyId);
    const line = await itemService('opex').create(lineBody('opex', 'Lock order line', { paying_company_id: companies[0] }), undefined, { manager: runner.manager });
    const versionId = await seedVersion(runner, 'opex', race.tenantId, line.id, YEAR);
    await runner.query(`UPDATE spend_versions SET allocation_method = 'manual_pct' WHERE id = $1`, [versionId]);
    await seedMonths(runner, 'opex', race.tenantId, versionId, YEAR, { planned: repeat('100', 12) });
    const [axis] = await runner.query(`INSERT INTO analytics_axes (tenant_id, code, name, sort_order) VALUES ($1, 'nature', 'Nature', 1) RETURNING id`, [race.tenantId]);
    const values: string[] = [];
    for (const name of ['Run', 'Build']) {
      values.push((await runner.query(`INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, $3) RETURNING id`, [race.tenantId, axis.id, name]))[0].id);
    }
    return { itemId: line.id as string, versionId, companies, axisId: axis.id as string, values };
  });
}

const cell = (month: number, planned: number) => ({ kind: 'monthly', year: YEAR, months: [{ period: `${YEAR}-${String(month).padStart(2, '0')}-01`, planned }] });

/** Every writer path of one line and version, as one request each; `round` varies the values. */
function writers(race: Race, s: Seeded, round: number): Array<[string, (manager: any) => Promise<unknown>]> {
  const versions = new SpendVersionsService(undefined as any, undefined as any, captureAudit() as any, currencySettings as any);
  const allocations = new SpendAllocationsService(undefined as any, undefined as any, undefined as any, captureAudit() as any);
  const ai = new AiFinancialPlanMutationSupportService(
    captureAudit() as any, undefined as any, undefined as any, undefined as any, undefined as any, amountsService('opex') as any, versions as any,
  );
  const pct = 50 + (round % 3) * 10;
  return [
    ['version PATCH then a cell save', async (manager) => {
      await versions.updateForItem(s.itemId, { id: s.versionId, notes: `Round ${round}` } as any, null, { manager });
      await amountsService('opex').bulkUpsert(s.versionId, cell(4, 400 + round), null, { manager });
    }],
    ['allocation save', (manager) => allocations.bulkUpsert(s.versionId, [
      { company_id: s.companies[0], department_id: null, allocation_pct: pct },
      { company_id: s.companies[1], department_id: null, allocation_pct: 100 - pct },
    ], undefined, { manager, tenantId: race.tenantId })],
    ['costed lines', (manager) => amountsService('opex').bulkUpsert(s.versionId, {
      kind: 'lines', year: YEAR, measure: 'forecast',
      lines: [{ label: 'Support', quantity_unit: 'people', quantity: String(1 + (round % 3)), unit_price: '1000', price_basis: 'per_month', period_start: `${YEAR}-01-01`, period_end: `${YEAR}-12-31` }],
    }, null, { manager })],
    ['line update with an analytics value', (manager) => itemService('opex').update(
      s.itemId, { notes: `Round ${round}`, analytics_values: { [s.axisId]: s.values[round % 2] } }, undefined, { manager },
    )],
    ['AI amounts', async (manager) => {
      const context: any = { tenantId: race.tenantId, userId: null, manager };
      const prepared = await ai.prepareCreatePreview(context, {
        entity_type: 'spend_items', action: 'upsert_amounts', ref: s.itemId, version_ref: s.versionId,
        amounts: { kind: 'monthly', year: YEAR, months: [{ period: `${YEAR}-06-01`, planned: 600 + round }] },
      } as any);
      await ai.executePreview(context, {
        target_entity_type: prepared.targetEntityType, target_entity_id: prepared.targetEntityId,
        mutation_input: prepared.mutationInput, current_values: prepared.currentValues,
      } as any);
    }],
    ['column copy', (manager) => copyBudgetColumn({ manager, audit: captureAudit() as any, freeze: noFreeze }, 'opex', {
      sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR, destinationColumn: 'revision', percentageIncrease: round % 2, overwrite: true, dryRun: false,
    }, null)],
  ];
}

const deadlocked = (outcome: Outcome) => !outcome.ok && pgCode(outcome.error) === '40P01';

function assertNoDeadlock(outcome: Outcome, who: string) {
  assert.ok(!deadlocked(outcome), `${who} deadlocked (40P01): ${describe(outcome)}`);
  // The AI compares the amounts it previewed under the locks: a change meanwhile is a clean 409.
  assertClean(outcome, who, [409]);
}

/**
 * A cell save holds the line, the version and its months (its trigger, which
 * bumps the version, has not run yet). Every other writer path starts: each
 * waits on the line, none holds a child the cell save will need. Released,
 * all go through in turn.
 */
async function everyWriterWaitsOnTheLine() {
  await withRace('lock-order', async (race) => {
    const s = await seed(race);
    const holder = await race.open('cell save (holds the months)');
    const holds = race.gate(holder, { label: 'lock its months', when: 'after', match: sql.lockOn('spend_amounts') });
    const holderWork = race.start(holder, (manager) => amountsService('opex').bulkUpsert(s.versionId, cell(3, 333), null, { manager }));
    assert.equal(await progress(holderWork, { party: holder, gate: holds }), 'gated', 'harness: the cell save must pause holding its months');

    const others: Array<[string, Promise<unknown>]> = [];
    for (const [who, write] of writers(race, s, 1)) {
      const party = await race.open(who);
      const work = race.start(party, write);
      assert.equal(await progress(work, { party }), 'blocked', `${who} waits (on the line) for the cell save`);
      others.push([who, work]);
    }
    holds.release();
    assertNoDeadlock(await settle(holderWork), 'the cell save');
    for (const [who, work] of others) assertNoDeadlock(await settle(work), who);

    const [{ rev }] = await race.read(`SELECT budget_rev AS rev FROM spend_versions WHERE id = $1`, [s.versionId]);
    assert.ok(Number(rev) > 1, 'the version\'s budget_rev moved');
  });
}

/** The same paths, free running, several rounds at once on one version: never a deadlock. */
async function freeRunning() {
  await withRace('lock-order-free', async (race) => {
    const s = await seed(race);
    const paths = writers(race, s, 0).map(([who]) => who);
    const parties = await Promise.all(paths.map((who) => race.open(who)));
    const outcomes: Array<[string, Outcome]> = [];
    await Promise.all(parties.map(async (party, index) => {
      for (let round = 0; round < 4; round++) {
        const [who, write] = writers(race, s, round + index)[index];
        outcomes.push([`${who} (round ${round})`, await settle(race.start(party, write))]);
      }
    }));
    for (const [who, outcome] of outcomes) assertNoDeadlock(outcome, who);
    assert.ok(outcomes.filter(([, o]) => o.ok).length >= outcomes.length - 4, 'at most the AI rounds are refused');
  });
}

void runRaceSpecs('Budget lock order', [
  ['every writer path waits on the line while a cell save holds its months: no deadlock (3B)', everyWriterWaitsOnTheLine],
  ['every writer path free running on one version: no deadlock (3B)', freeRunning],
]);
