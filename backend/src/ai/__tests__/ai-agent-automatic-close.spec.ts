import * as assert from 'node:assert/strict';
import {
  TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY,
  TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY,
} from '../control-plane/capability/capability-contract';
import {
  CLOSE_WAITS_FOR_REQUESTER_REPLY,
  decideAutomaticPreparedAction,
  isTerminalStatusAction,
  orderAutomaticPreparedActions,
} from '../control-plane/agent-control/agent-control-automatic-execution.util';
import { AiActionRequest } from '../control-plane/entities/ai-action-request.entity';

// Issue #1653: a close or solve follows the automatic Status update setting, and
// never runs before the requester reply of the same batch.

type Candidate = Pick<AiActionRequest, 'id' | 'capability_name' | 'action_payload_json' | 'metadata_json' | 'created_at'>;

function statusAction(id: string, payload: Record<string, unknown>, createdAt = '2026-11-16T10:00:00Z'): Candidate {
  return {
    id,
    capability_name: TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY,
    action_payload_json: { action: 'status_update', ...payload },
    metadata_json: {},
    created_at: new Date(createdAt),
  };
}

function replyAction(id: string, createdAt = '2026-11-16T10:00:01Z'): Candidate {
  return {
    id,
    capability_name: TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY,
    action_payload_json: { action: 'public_reply', body: 'Closing this ticket.' },
    metadata_json: { triage_action: 'planner_prepare_administrative_close_reply' },
    created_at: new Date(createdAt),
  };
}

type Outcome = { id: string; status: 'executed' | 'skipped' | 'failed'; reason: string | null };

/** Mirrors the loop of executeAutomaticPreparedActions without a service desk. */
function simulate(batch: Candidate[], enabledClasses: string[], failingIds: string[] = []): Outcome[] {
  const executed = new Set<string>();
  const outcomes: Outcome[] = [];
  for (const action of orderAutomaticPreparedActions(batch)) {
    const decision = decideAutomaticPreparedAction(action, {
      batch,
      policyEnabledForClass: (className) => enabledClasses.includes(className),
      executedActionIds: executed,
    });
    if (!decision.run) {
      outcomes.push({ id: action.id, status: 'skipped', reason: decision.reason });
      continue;
    }
    if (failingIds.includes(action.id)) {
      outcomes.push({ id: action.id, status: 'failed', reason: 'provider error' });
      continue;
    }
    executed.add(action.id);
    outcomes.push({ id: action.id, status: 'executed', reason: null });
  }
  return outcomes;
}

function testTerminalStatusFollowsStatusPolicy() {
  const terminalFlag = statusAction('close-flag', { transitionKey: 'closed', terminal: true });
  const legacySolved = statusAction('close-legacy', { transitionKey: 'solved' });
  assert.equal(isTerminalStatusAction(terminalFlag), true);
  assert.equal(isTerminalStatusAction(legacySolved), true);
  for (const action of [terminalFlag, legacySolved]) {
    assert.deepEqual(simulate([action], ['status']), [{ id: action.id, status: 'executed', reason: null }]);
    assert.deepEqual(simulate([action], []), [{ id: action.id, status: 'skipped', reason: null }]);
  }
}

function testNonTerminalStatusUnchanged() {
  const pending = statusAction('pending', { transitionKey: 'pending', terminal: false });
  assert.equal(isTerminalStatusAction(pending), false);
  assert.deepEqual(simulate([pending], ['status']), [{ id: 'pending', status: 'executed', reason: null }]);
  assert.deepEqual(simulate([pending], []), [{ id: 'pending', status: 'skipped', reason: null }]);
}

function testReplyRunsBeforeClose() {
  // Close created first and given first: the order is still reply, then close.
  const close = statusAction('close', { transitionKey: 'closed', terminal: true }, '2026-11-16T09:00:00Z');
  const reply = replyAction('reply', '2026-11-16T10:00:00Z');
  assert.deepEqual(
    orderAutomaticPreparedActions([close, reply]).map((action) => action.id),
    ['reply', 'close'],
  );
  assert.deepEqual(simulate([close, reply], ['status', 'public_reply']), [
    { id: 'reply', status: 'executed', reason: null },
    { id: 'close', status: 'executed', reason: null },
  ]);
}

function testCloseWaitsWhenReplyFails() {
  const close = statusAction('close', { transitionKey: 'closed', terminal: true });
  const reply = replyAction('reply');
  assert.deepEqual(simulate([close, reply], ['status', 'public_reply'], ['reply']), [
    { id: 'reply', status: 'failed', reason: 'provider error' },
    { id: 'close', status: 'skipped', reason: CLOSE_WAITS_FOR_REQUESTER_REPLY },
  ]);
}

function testCloseWaitsWhenReplyAsksFirst() {
  const close = statusAction('close', { transitionKey: 'closed', terminal: true });
  const reply = replyAction('reply');
  assert.deepEqual(simulate([close, reply], ['status']), [
    { id: 'reply', status: 'skipped', reason: null },
    { id: 'close', status: 'skipped', reason: CLOSE_WAITS_FOR_REQUESTER_REPLY },
  ]);
}

function testNonTerminalStatusDoesNotWaitForReply() {
  const pending = statusAction('pending', { transitionKey: 'pending', terminal: false });
  const reply = replyAction('reply');
  assert.deepEqual(simulate([pending, reply], ['status']), [
    { id: 'pending', status: 'executed', reason: null },
    { id: 'reply', status: 'skipped', reason: null },
  ]);
}

function run() {
  testTerminalStatusFollowsStatusPolicy();
  testNonTerminalStatusUnchanged();
  testReplyRunsBeforeClose();
  testCloseWaitsWhenReplyFails();
  testCloseWaitsWhenReplyAsksFirst();
  testNonTerminalStatusDoesNotWaitForReply();
  console.log('ai-agent-automatic-close.spec: all tests passed');
}

run();
