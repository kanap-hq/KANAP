import * as assert from 'node:assert/strict';
import { contributor, prepared, project, scheduler } from './roadmap-scheduler.fixtures';

/**
 * Every sentence the roadmap writes comes with a code and its parameters, so the web app writes
 * it in the reader's language. The English text stays in the response, unchanged, for API and AI
 * readers.
 */

async function testUnschedulableDetailsCarryACode() {
  const run = scheduler();
  const result = await run(prepared([project('p0', new Map([['c0', 5]]))], [contributor('c0', 0)]));

  const item = result.unschedulable[0];
  const detailsText = {
    code: 'no_allocable_capacity_for',
    params: {
      contributors: [{ code: 'contributor_capacity', params: { name: 'Contributor c0', weeklyCapacity: 0 } }],
    },
  };
  assert.equal(item.details, 'No allocable weekly capacity for: Contributor c0 (0d/week)', 'the English text is kept');
  assert.deepEqual(item.detailsText, detailsText);

  const explanation = result.explanations.find((entry: any) => entry.itemRef.projectId === 'p0');
  assert.deepEqual(explanation.finalReasonText, detailsText);
  assert.deepEqual(explanation.summaryText, {
    code: 'summary_unschedulable',
    params: { project: 'Project p0', reason: detailsText },
  });
  assert.equal(explanation.summary, `Project p0 could not be scheduled: ${item.details}`);
  assert.deepEqual(explanation.blockerReasons.map((reason: any) => reason.labelText), [detailsText]);
}

async function testScheduledProjectNamesItsStart() {
  const run = scheduler();
  const result = await run(prepared([project('p1', new Map([['c1', 10]]))], [contributor('c1', 20)]));

  const explanation = result.explanations[0];
  assert.deepEqual(explanation.summaryText, {
    code: 'summary_schedulable',
    params: { project: 'Project p1', week: '2026-01-05' },
  });
  assert.equal(explanation.summary, 'Project p1 started in 2026-01-05 when it became schedulable.');
  assert.deepEqual(explanation.finalReasonText, { code: 'final_started', params: { week: '2026-01-05' } });
  assert.equal(explanation.finalReason, 'Started in 2026-01-05');
}

async function testWaitingForABlockerNamesItAndItsReleaseWeek() {
  const run = scheduler();
  const input = prepared(
    [project('p1', new Map([['c1', 10]])), project('p2', new Map([['c2', 5]]))],
    [contributor('c1', 20), contributor('c2', 20)],
  );
  input.blockersByProject.set('p2', ['p1']);
  const result = await run(input);

  const explanation = result.explanations.find((entry: any) => entry.itemRef.projectId === 'p2');
  const waiting = explanation.blockerReasons.find((reason: any) => reason.projectId === 'p1');
  assert.deepEqual(waiting.labelText, {
    code: 'waiting_for_until',
    params: { blocker: 'Project p1', week: '2026-01-26' },
  });
  assert.equal(waiting.label, 'Waiting for Project p1 until 2026-01-26');
  assert.deepEqual(explanation.summaryText, {
    code: 'summary_blockers',
    params: { project: 'Project p2', week: '2026-01-26' },
  });
  assert.deepEqual(explanation.finalReasonText, { code: 'final_blockers', params: { week: '2026-01-26' } });
}

async function testConstraintConflictIsCodedEverywhere() {
  // The pinned project waits for its blocker, so it slips past its pin.
  const run = scheduler();
  const pin = { type: 'pin_start', startWeek: '2026-01-05' };
  const input = prepared(
    [
      project('p5a', new Map([['c1', 10]])),
      project('p5b', new Map([['c2', 5]]), { constraint: pin }),
    ],
    [contributor('c1', 20), contributor('c2', 20)],
  );
  input.blockersByProject.set('p5b', ['p5a']);
  const result = await run(input);

  const explanation = result.explanations.find((entry: any) => entry.itemRef.projectId === 'p5b');
  const actual = explanation.actualStartWeek;
  assert.notEqual(actual, '2026-01-05', 'the pin slipped');
  const conflict = { code: 'conflict_pin_start_slipped', params: { week: '2026-01-05', actual } };
  assert.deepEqual(explanation.blockerReasons[0].labelText, conflict);
  assert.equal(explanation.blockerReasons[0].label, `Pinned start 2026-01-05 slipped to ${actual}.`);
  assert.deepEqual(explanation.finalReasonText, conflict);
  assert.deepEqual(explanation.summaryText, {
    code: 'summary_constraint_conflict',
    params: { project: 'Project p5b', week: actual, constraint: pin, conflict },
  });
  assert.equal(
    explanation.summary,
    `Project p5b started in ${actual} under pin start 2026-01-05, with a conflict: Pinned start 2026-01-05 slipped to ${actual}.`,
  );

  const warning = result.scenarioWarnings.find((entry: any) => entry.itemRef?.projectId === 'p5b');
  assert.deepEqual(warning.messageText, {
    code: 'warning_constraint_conflict',
    params: { project: 'Project p5b', conflict },
  });
  assert.equal(warning.message, `Project p5b: Pinned start 2026-01-05 slipped to ${actual}.`);
}

async function testBlockerOnHoldIsCoded() {
  const run = scheduler();
  const input = prepared(
    [project('p1', new Map([['c1', 5]])), project('p2', new Map([['c1', 5]]))],
    [contributor('c1', 20)],
  );
  input.candidates.delete('p1');
  (input.projectRowsById.get('p1') as { status: string }).status = 'on_hold';
  input.blockersByProject.set('p2', ['p1']);
  const result = await run(input);

  const item = result.unschedulable.find((entry: any) => entry.projectId === 'p2');
  assert.equal(item.reason, 'blocker_on_hold');
  assert.equal(item.details, 'Blocker Project p1 is on hold');
  assert.deepEqual(item.detailsText, { code: 'blocker_on_hold', params: { blocker: 'Project p1' } });

  const explanation = result.explanations.find((entry: any) => entry.itemRef.projectId === 'p2');
  const reason = explanation.blockerReasons.find((entry: any) => entry.projectId === 'p1');
  assert.deepEqual(reason.labelText, { code: 'blocker_is_on_hold', params: { blocker: 'Project p1' } });
  assert.equal(reason.label, 'Project p1 is on hold');
}

async function run() {
  await testUnschedulableDetailsCarryACode();
  await testScheduledProjectNamesItsStart();
  await testWaitingForABlockerNamesItAndItsReleaseWeek();
  await testConstraintConflictIsCodedEverywhere();
  await testBlockerOnHoldIsCoded();
}

void run();
