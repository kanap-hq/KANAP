import * as assert from 'node:assert/strict';
import { contributor, prepared, project, scheduler } from './roadmap-scheduler.fixtures';

/**
 * Characterisation tests for runScheduler.
 *
 * A 1,691-line capacity-constrained scheduler had no test at all, so these pin the behaviour
 * it has TODAY rather than the behaviour anyone intended. They exist to make a change to it
 * fail loudly: nothing here is a specification to design against.
 *
 * Two things make it testable without a database:
 *
 *  - `Object.create(PortfolioRoadmapService.prototype)` resolves the eight `this.*` helpers
 *    the scheduler calls (computeEffectiveWeeklyCapacity, addCommittedLoad, …) without running
 *    the constructor, so no repositories or Nest wiring are needed.
 *  - options come from `parseRoadmapGenerate`, exactly as in production. Building a partial
 *    options object by hand is what makes the scheduler report "no effective capacity": the
 *    capacity maths reads `contextSwitchGrace` and `contextSwitchPenaltyPct`, and undefined
 *    values turn the whole factor into NaN.
 */

async function testSchedulesASingleProjectAcrossItsWeeks() {
  // 10 days for a contributor at 20 days/month (4.62 d/week) spans three week starts.
  const run = scheduler();
  const result = await run(prepared([project('p1', new Map([['c1', 10]]))], [contributor('c1', 20)]));

  assert.equal(result.schedule.length, 1, 'the project is scheduled');
  assert.equal(result.unschedulable.length, 0);
  const item = result.schedule[0];
  assert.equal(item.projectId, 'p1');
  assert.equal(item.plannedStart, '2026-01-05');
  assert.equal(item.plannedEnd, '2026-01-23');
  assert.equal(item.durationWeeks, 3);
  assert.equal(item.remainingEffortDays, 10);
  assert.deepEqual(item.activeWeekStarts, ['2026-01-05', '2026-01-12', '2026-01-19']);
  assert.deepEqual(item.contributorLoads, [
    { contributorId: 'c1', contributorName: 'Contributor c1', days: 10 },
  ]);
  assert.equal(result.roadmapEndDate, '2026-01-23');
}

async function testSerialisesProjectsSharingAContributor() {
  // parallelizationLimit defaults to 1: two 10-day projects on one contributor queue up
  // rather than overlap, in priority order (p5a 100 before p5b 50).
  const run = scheduler();
  const result = await run(
    prepared(
      [
        project('p5a', new Map([['c1', 10]])),
        project('p5b', new Map([['c1', 10]]), { priorityScore: 50 }),
      ],
      [contributor('c1', 20)],
    ),
  );

  assert.equal(result.schedule.length, 2);
  const byId = new Map(result.schedule.map((s: any) => [s.projectId, s]));
  assert.equal((byId.get('p5a') as any).plannedStart, '2026-01-05');
  assert.equal((byId.get('p5b') as any).plannedStart, '2026-01-26');
  assert.equal(result.roadmapEndDate, '2026-02-13');
}

async function testReportsAProjectWithNoAllocableCapacity() {
  const run = scheduler();
  const result = await run(prepared([project('p0', new Map([['c0', 5]]))], [contributor('c0', 0)]));

  assert.equal(result.schedule.length, 0);
  assert.equal(result.unschedulable.length, 1);
  assert.equal(result.unschedulable[0].projectId, 'p0');
  assert.equal(result.unschedulable[0].reason, 'no_effective_capacity');
  assert.match(result.unschedulable[0].details ?? '', /no allocable weekly capacity/i);
  assert.equal(result.roadmapEndDate, null);
}

async function testSchedulesALongProjectToAFarHorizon() {
  const run = scheduler();
  const result = await run(prepared([project('p2', new Map([['c1', 200]]))], [contributor('c1', 20)]));

  assert.equal(result.schedule.length, 1);
  assert.equal(result.unschedulable.length, 0);
  assert.equal(result.roadmapEndDate, '2026-11-06');
}

async function testIsDeterministic() {
  const run = scheduler();
  const first = await run(prepared([project('p1', new Map([['c1', 10]]))], [contributor('c1', 20)]));
  const second = await run(prepared([project('p1', new Map([['c1', 10]]))], [contributor('c1', 20)]));

  assert.deepEqual(second.schedule, first.schedule, 'the same input yields the same schedule');
  assert.equal(second.roadmapEndDate, first.roadmapEndDate);
}

async function testOccupationLedgerIsProducedOnDemand() {
  const run = scheduler();
  const without = await run(prepared([project('p1', new Map([['c1', 10]]))], [contributor('c1', 20)]), false);
  const with_ = await run(prepared([project('p1', new Map([['c1', 10]]))], [contributor('c1', 20)]), true);

  assert.equal(without.weeklyProjectLoad, null, 'no ledger unless asked for');
  assert.ok(with_.weeklyProjectLoad, 'the ledger is produced when collectOccupation is set');
  assert.ok(with_.weeklyProjectLoad.has('c1'), 'keyed by contributor');
}

async function run() {
  await testSchedulesASingleProjectAcrossItsWeeks();
  await testSerialisesProjectsSharingAContributor();
  await testReportsAProjectWithNoAllocableCapacity();
  await testSchedulesALongProjectToAFarHorizon();
  await testIsDeterministic();
  await testOccupationLedgerIsProducedOnDemand();
}

void run();
