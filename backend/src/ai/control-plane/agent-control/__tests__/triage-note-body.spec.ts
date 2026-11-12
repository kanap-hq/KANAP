import * as assert from 'node:assert/strict';
import { triageNoteBody } from '../ai-agent-control.service';

/**
 * The internal note a sample triage proposes is read on the Approvals page: it names the product
 * and the ticket, and names an alert only when the caller chose one.
 */

const base = {
  ticketId: 'FRO-2213',
  runId: 'run-1',
  recommendationId: 'rec-1',
  preparedAt: new Date('2026-11-11T09:00:00.000Z'),
};

function testHeadingNamesTheProductOnly() {
  const body = triageNoteBody({ ...base, alertId: null });
  const [heading] = body.split('\n');
  assert.equal(heading, '[Kadratis triage]');
  assert.doesNotMatch(body, /mock|demo/i);
  assert.match(body, /^Ticket: FRO-2213$/m);
  assert.doesNotMatch(body, /^Alert:/m, 'no alert line without a chosen alert');
}

function testChosenAlertIsNamed() {
  const body = triageNoteBody({ ...base, alertId: 'PRTG-42' });
  assert.match(body, /^Alert: PRTG-42$/m);
}

for (const test of [testHeadingNamesTheProductOnly, testChosenAlertIsNamed]) {
  test();
  console.log(`ok - ${test.name}`);
}
