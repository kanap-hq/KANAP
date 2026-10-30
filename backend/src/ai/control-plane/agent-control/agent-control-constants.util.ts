import { actionClassForCapabilityName } from '../agent/ai-agent-autonomy';
import { SRE_MONITORING_ALLOWED_CAPABILITIES } from '../agent/ai-agent-work-queue.service';
import { providerCapabilityContracts } from '../capability/ai-capability.registry';
import { CapabilityExecutionResult, TICKETING_ASSIGNMENT_UPDATE_APPROVED_CAPABILITY, TICKETING_ASSIGNMENT_UPDATE_PREPARE_CAPABILITY, TICKETING_CLASSIFICATION_CONTEXT_CAPABILITY, TICKETING_CLASSIFICATION_UPDATE_APPROVED_CAPABILITY, TICKETING_CLASSIFICATION_UPDATE_PREPARE_CAPABILITY, TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY, TICKETING_INTERNAL_NOTE_PREPARE_CAPABILITY, TICKETING_LIFECYCLE_CONTEXT_CAPABILITY, TICKETING_PARTICIPANT_CONTEXT_CAPABILITY, TICKETING_PARTICIPANT_UPDATE_APPROVED_CAPABILITY, TICKETING_PARTICIPANT_UPDATE_PREPARE_CAPABILITY, TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY, TICKETING_PUBLIC_REPLY_PREPARE_CAPABILITY, TICKETING_ROUTING_CONTEXT_CAPABILITY, TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY, TICKETING_STATUS_UPDATE_PREPARE_CAPABILITY, TICKETING_TICKET_NOTES_LIST_CAPABILITY } from '../capability/capability-contract';
import { AiActionRequest } from '../entities/ai-action-request.entity';
import { metadataObject, stringFromMetadata } from './agent-control-util';
import { PlannerActionType } from './ai-agent-action-planner.service';
import type { KnowledgeSearchItem } from './ai-agent-control.service';

/**
 * Shared constants and small action helpers for the agent control service: capability
 * ceilings per agent type, planner action tables, autonomy action classes, targeting cache
 * TTLs, and the helpers that read metadata off an action request.
 *
 * Extracted verbatim from the module-level header of ai-agent-control.service.ts. This block
 * was what blocked the definition cluster: possibleCapabilityCapsForAgentType and the
 * capability caps it reads are needed by agent-definition normalisation, and they could not
 * travel with it without dragging the capability tables along.
 */

export type KnowledgeDocumentFetchAttempt = {
  document_id: string;
  result?: CapabilityExecutionResult<Record<string, unknown>>;
  item?: KnowledgeSearchItem | null;
  error_message?: string | null;
};

export const APPROVED_ACTION_EXECUTING_STATUS = 'executing';
export const HELPDESK_REVIEW_ACTION_CAPABILITIES = [
  TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY,
  TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY,
  TICKETING_CLASSIFICATION_UPDATE_APPROVED_CAPABILITY,
  TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY,
  TICKETING_ASSIGNMENT_UPDATE_APPROVED_CAPABILITY,
  TICKETING_PARTICIPANT_UPDATE_APPROVED_CAPABILITY,
];
export const DEFAULT_BULK_EXECUTION_PHASE = 999;
export const STATIC_CAPABILITY_EXECUTION_PHASES = new Map(
  providerCapabilityContracts().map((contract) => [
    `${contract.name}:${contract.version}`,
    contract.execution_phase ?? DEFAULT_BULK_EXECUTION_PHASE,
  ]),
);
export const AUTONOMY_ACTION_CLASSES = ['internal_note', 'classification', 'status', 'public_reply', 'assignment', 'participant'] as const;
export const AUTONOMY_RECOMMENDATION_REASON_CODES = new Set([
  'INSUFFICIENT_DECIDED_PROPOSALS',
  'ACCEPTANCE_RATE_TOO_LOW',
  'OBSERVATION_WINDOW_TOO_SHORT',
]);
export const HELPDESK_POSSIBLE_CAPABILITY_CAPS = new Map<string, string>([
  ['ticketing.ticket.get', 'A1'],
  [TICKETING_TICKET_NOTES_LIST_CAPABILITY, 'A1'],
  [TICKETING_CLASSIFICATION_CONTEXT_CAPABILITY, 'A1'],
  [TICKETING_LIFECYCLE_CONTEXT_CAPABILITY, 'A1'],
  [TICKETING_ROUTING_CONTEXT_CAPABILITY, 'A1'],
  [TICKETING_PARTICIPANT_CONTEXT_CAPABILITY, 'A1'],
  ['search_knowledge', 'A1'],
  ['get_document', 'A1'],
  // Provisioned onto every helpdesk agent by HELP_DESK_ALLOWED_CAPABILITIES (work-queue service).
  // Must be listed here or config saves round-tripping the capability are rejected. Read-only/A1;
  // the run loop no-ops it unless both the per-agent toggle and platform web search are enabled.
  ['web_search', 'A1'],
  [TICKETING_INTERNAL_NOTE_PREPARE_CAPABILITY, 'A2'],
  [TICKETING_PUBLIC_REPLY_PREPARE_CAPABILITY, 'A2'],
  [TICKETING_CLASSIFICATION_UPDATE_PREPARE_CAPABILITY, 'A2'],
  [TICKETING_STATUS_UPDATE_PREPARE_CAPABILITY, 'A2'],
  [TICKETING_ASSIGNMENT_UPDATE_PREPARE_CAPABILITY, 'A2'],
  [TICKETING_PARTICIPANT_UPDATE_PREPARE_CAPABILITY, 'A2'],
  [TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY, 'A3'],
  [TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY, 'A3'],
  [TICKETING_CLASSIFICATION_UPDATE_APPROVED_CAPABILITY, 'A3'],
  [TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY, 'A3'],
  [TICKETING_ASSIGNMENT_UPDATE_APPROVED_CAPABILITY, 'A3'],
  [TICKETING_PARTICIPANT_UPDATE_APPROVED_CAPABILITY, 'A3'],
]);
// SRE cap table derived from the seed list (single source of truth in the
// work-queue service): every 15.A SRE capability is a read capped at A1 —
// prepare/approved write pairs only arrive with 15.B.
export const SRE_POSSIBLE_CAPABILITY_CAPS = new Map<string, string>(
  SRE_MONITORING_ALLOWED_CAPABILITIES.map((capability) => [capability.name, capability.max_autonomy_level]),
);
// Capability validation is per agent type: monitoring reads are meaningless on a
// helpdesk agent and ticketing writes are meaningless on an SRE agent — both are
// rejected with the same "not available for this agent type" error.
export function possibleCapabilityCapsForAgentType(agentType: unknown): Map<string, string> {
  return agentType === 'sre' ? SRE_POSSIBLE_CAPABILITY_CAPS : HELPDESK_POSSIBLE_CAPABILITY_CAPS;
}
export const SUPPRESS_UNCHANGED_PROPOSAL_STATUSES = new Set(['pending', 'approved', 'rejected', 'executed']);
export const CLOSE_TRIAGE_ACTIONS = new Set(['prepare_close', 'prepare_close_reply']);
export const PHASE_1_PLANNER_OWNED_ACTION_TYPES = [
  'internal_note',
  'requester_reply',
  'status_update',
] as const satisfies readonly PlannerActionType[];
// Instruction-driven group routing: owned only when the agent holds the assignment
// capability pair and the provider exposes a routing catalogue for the ticket.
export const PLANNER_ASSIGNMENT_ACTION_TYPE = 'assignment_update' as const satisfies PlannerActionType;
export const PLANNER_CLASSIFICATION_ACTION_TYPE = 'classification_update' as const satisfies PlannerActionType;
// Observer adds: owned only when the agent holds the participant capability pair and
// the provider can add an observer on this ticket.
export const PLANNER_PARTICIPANT_ACTION_TYPE = 'participant_update' as const satisfies PlannerActionType;
export const PLANNER_OWNED_ACTION_TYPES = new Set<PlannerActionType>([...PHASE_1_PLANNER_OWNED_ACTION_TYPES, PLANNER_ASSIGNMENT_ACTION_TYPE, PLANNER_CLASSIFICATION_ACTION_TYPE, PLANNER_PARTICIPANT_ACTION_TYPE]);
export const PLANNER_TERMINAL_TRANSITIONS = new Set(['solved', 'closed', 'resolved']);
export const ACTION_TYPE_CAPABILITY_TABLE: Record<string, { prepare: string; approved: string } | undefined> = {
  internal_note: {
    prepare: TICKETING_INTERNAL_NOTE_PREPARE_CAPABILITY,
    approved: TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY,
  },
  requester_reply: {
    prepare: TICKETING_PUBLIC_REPLY_PREPARE_CAPABILITY,
    approved: TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY,
  },
  status_update: {
    prepare: TICKETING_STATUS_UPDATE_PREPARE_CAPABILITY,
    approved: TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY,
  },
  classification_update: {
    prepare: TICKETING_CLASSIFICATION_UPDATE_PREPARE_CAPABILITY,
    approved: TICKETING_CLASSIFICATION_UPDATE_APPROVED_CAPABILITY,
  },
  assignment_update: {
    prepare: TICKETING_ASSIGNMENT_UPDATE_PREPARE_CAPABILITY,
    approved: TICKETING_ASSIGNMENT_UPDATE_APPROVED_CAPABILITY,
  },
  participant_update: {
    prepare: TICKETING_PARTICIPANT_UPDATE_PREPARE_CAPABILITY,
    approved: TICKETING_PARTICIPANT_UPDATE_APPROVED_CAPABILITY,
  },
};
// `group` is the assignable-group catalogue and `technician` the named-technician
// catalogue (both routing targets), served read-only to the UI. Neither is an enum field:
// they go through the provider catalog search, like `category` and `entity`.
export const TARGETING_ENUM_OPTIONS_TTL_MS = 60 * 60 * 1000;
export const TARGETING_CATALOG_OPTIONS_TTL_MS = 2 * 60 * 1000;
// Empty-query catalog lists (what every dropdown-open shows) change rarely but can be
// slow to produce on large GLPI instances: keep them fresh much longer, and serve a
// stale copy (up to the stale-serve bound) while a background refresh replaces it.
export const TARGETING_CATALOG_BROWSE_TTL_MS = 30 * 60 * 1000;
export const TARGETING_OPTIONS_STALE_SERVE_MS = 24 * 60 * 60 * 1000;

// An identical earlier proposal only suppresses regeneration while it is still a live or
// settled decision. A proposal/action that lapsed (pending or approved past its expiry, or
// swept to 'expired') is gone from the operator's queue or no longer executable, so it must
// NOT keep blocking a fresh proposal — otherwise a stale ticket, whose context hash never
// changes, becomes permanently un-proposable after its first proposal expired.
export function proposalStillBlocksRegeneration(action: AiActionRequest, now: number): boolean {
  if (action.status === 'expired') {
    return false;
  }
  if (!SUPPRESS_UNCHANGED_PROPOSAL_STATUSES.has(action.status)) {
    return false;
  }
  if ((action.status === 'pending' || action.status === 'approved') && action.expires_at) {
    const expiresAt = action.expires_at instanceof Date
      ? action.expires_at.getTime()
      : Date.parse(String(action.expires_at));
    if (Number.isFinite(expiresAt) && expiresAt <= now) {
      return false;
    }
  }
  return true;
}




export function actionSortTime(action: AiActionRequest): number {
  const updated = action.updated_at instanceof Date ? action.updated_at.getTime() : Date.parse(String(action.updated_at ?? ''));
  if (Number.isFinite(updated)) return updated;
  const created = action.created_at instanceof Date ? action.created_at.getTime() : Date.parse(String(action.created_at ?? ''));
  return Number.isFinite(created) ? created : 0;
}

export function actionIsActivePending(action: AiActionRequest, now = Date.now()): boolean {
  if (action.status !== 'pending') return false;
  if (!action.expires_at) return true;
  const expiresAt = action.expires_at instanceof Date ? action.expires_at.getTime() : Date.parse(String(action.expires_at));
  return Number.isFinite(expiresAt) && expiresAt > now;
}



export function definitionIdFromMetadata(value: unknown): string | null {
  return stringFromMetadata(metadataObject(value).agent_definition_id);
}

export function numberFromMetadata(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

export function withApprovedBatchContext(
  metadata: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const existing = metadataObject(metadata);
  const batch = metadataObject(existing.approved_batch_context);
  return {
    ...existing,
    approved_batch_context: {
      ...batch,
      ...patch,
    },
  };
}

export function approvedBatchExecutionAttempts(action: AiActionRequest): number {
  const metadata = metadataObject(action.metadata_json);
  const batch = metadataObject(metadata.approved_batch_context);
  return numberFromMetadata(batch.execution_attempts);
}

export function actionExecutionSkipReason(action: AiActionRequest | null): string | null {
  if (!action) {
    return 'Action request was not claimed for execution.';
  }
  if (action.status === 'executed') {
    return null;
  }
  if (action.status === APPROVED_ACTION_EXECUTING_STATUS) {
    return 'Action request is already being executed.';
  }
  if (action.error_message) {
    return action.error_message;
  }
  if (action.status === 'approved') {
    return 'Action request was not claimed for execution.';
  }
  return `Action is ${action.status}.`;
}

export function actionClass(action: Pick<AiActionRequest, 'metadata_json' | 'capability_name'>): string {
  return actionClassForCapabilityName(
    stringFromMetadata(metadataObject(action.metadata_json).action_class) ?? action.capability_name,
  );
}

export function numericMetadata(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}


export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
