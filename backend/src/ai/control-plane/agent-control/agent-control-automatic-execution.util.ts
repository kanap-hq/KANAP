import { isRecord } from '../../../common/object-guards';
import { isAutomatableAutonomyActionClass } from '../agent/ai-agent-autonomy';
import { AiActionRequest } from '../entities/ai-action-request.entity';
import { PLANNER_TERMINAL_TRANSITIONS, actionClass } from './agent-control-constants.util';

/**
 * Decisions of the automatic execution of the actions one ticket triage prepared.
 *
 * A terminal ticket transition (solve/close) reuses the status_update capability
 * (action class 'status'): it runs on its own when the agent's Status update
 * autonomy is automatic, like every other status move. A ticket never closes
 * before its reply to the requester goes out: in one automatic pass the terminal
 * transitions run after every other action, and a terminal transition waits in
 * the approvals queue while a requester reply of the same batch did not run.
 */

type AutomaticCandidate = Pick<AiActionRequest, 'id' | 'capability_name' | 'action_payload_json' | 'metadata_json'>
  & Partial<Pick<AiActionRequest, 'created_at'>>;

export const CLOSE_WAITS_FOR_REQUESTER_REPLY = 'close_waits_for_requester_reply';

/**
 * True for a solve/close status update. New provider payloads stamp the neutral
 * terminal flag; transitionKey remains a legacy persisted-row fallback.
 */
export function isTerminalStatusAction(action: Pick<AiActionRequest, 'capability_name' | 'action_payload_json'>): boolean {
  if (!action.capability_name.includes('status_update')) return false;
  const payload = isRecord(action.action_payload_json) ? action.action_payload_json : null;
  if (!payload) return false;
  if (payload.terminal === true) return true;
  const transitionKey = typeof payload.transitionKey === 'string' ? payload.transitionKey : null;
  return transitionKey != null && PLANNER_TERMINAL_TRANSITIONS.has(transitionKey);
}

function createdAtMs(action: AutomaticCandidate): number {
  const value = action.created_at instanceof Date ? action.created_at.getTime() : Number.NaN;
  return Number.isFinite(value) ? value : 0;
}

/** Execution order of a batch: terminal transitions last, then creation time, then id. */
export function orderAutomaticPreparedActions<T extends AutomaticCandidate>(actions: T[]): T[] {
  return [...actions].sort((left, right) =>
    Number(isTerminalStatusAction(left)) - Number(isTerminalStatusAction(right))
    || createdAtMs(left) - createdAtMs(right)
    || left.id.localeCompare(right.id));
}

export type AutomaticPreparedActionDecision =
  | { run: true; actionClass: string }
  | { run: false; actionClass: string; reason: string | null };

/**
 * Whether one action of the batch runs on its own. `executedActionIds` holds the
 * actions of the batch that already ran in this pass: the reply outcome a close
 * depends on.
 */
export function decideAutomaticPreparedAction(
  action: AutomaticCandidate,
  input: {
    batch: AutomaticCandidate[];
    policyEnabledForClass: (className: string) => boolean;
    executedActionIds: ReadonlySet<string>;
  },
): AutomaticPreparedActionDecision {
  const className = actionClass(action);
  if (!isAutomatableAutonomyActionClass(className) || !input.policyEnabledForClass(className)) {
    return { run: false, actionClass: className, reason: null };
  }
  if (isTerminalStatusAction(action)) {
    const replyNotSent = input.batch.some((candidate) =>
      candidate.id !== action.id
      && actionClass(candidate) === 'public_reply'
      && !input.executedActionIds.has(candidate.id));
    if (replyNotSent) {
      return { run: false, actionClass: className, reason: CLOSE_WAITS_FOR_REQUESTER_REPLY };
    }
  }
  return { run: true, actionClass: className };
}
