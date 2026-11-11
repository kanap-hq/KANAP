import { isRecord } from '../../../common/object-guards';
import { AgentQueueLiveTargetLike } from '../agent/ai-agent-work-queue.service';
import { AiActionRequest } from '../entities/ai-action-request.entity';
import { AiAgentAuditEvent } from '../entities/ai-agent-audit-event.entity';
import { AiAgentDefinition } from '../entities/ai-agent-definition.entity';
import { AiAgentTargetState } from '../entities/ai-agent-target-state.entity';
import { AiAgentWorkItem } from '../entities/ai-agent-work-item.entity';
import { AiApproval } from '../entities/ai-approval.entity';
import { AiDecision } from '../entities/ai-decision.entity';
import { AiEvaluation } from '../entities/ai-evaluation.entity';
import { AiEvidence } from '../entities/ai-evidence.entity';
import { AiLiveTestTarget } from '../entities/ai-live-test-target.entity';
import { AiObservation } from '../entities/ai-observation.entity';
import { AiRecommendation } from '../entities/ai-recommendation.entity';
import { AiRunStep } from '../entities/ai-run-step.entity';
import { AiRun } from '../entities/ai-run.entity';
import { AiToolExecution } from '../entities/ai-tool-execution.entity';
import { inputWithoutValues, metadataWithoutErrorMessage } from '../evidence/run-result-visibility';
import { cleanAgentPriority, metadataObject, stringFromMetadata, toIso } from './agent-control-util';
import { auditActivityType } from './ai-agent-activity-timeline';

/**
 * Serialisers for the agent control read side: runs, steps, tool executions, evidence,
 * observations, decisions, action requests, approvals, work items and audit events.
 *
 * Extracted verbatim from the module-level header of ai-agent-control.service.ts, together
 * with the activity-detail types and bounds they use.
 *
 * A run, its steps, its tool executions and its evidence carry what the tools returned. Their
 * serialisers take `resultsReadable` (evidence/run-result-visibility.ts): without it the line
 * stays (the tool, the names of its arguments, its status and the code of a failure) and the
 * result is left out, with the values of the arguments and their fingerprint, and the message of
 * a failure, which quotes the same data.
 */

export function serializeRun(run: AiRun, resultsReadable: boolean) {
  return {
    id: run.id,
    tenant_id: run.tenant_id,
    user_id: run.user_id,
    conversation_id: run.conversation_id,
    request_id: run.request_id,
    ai_api_key_id: run.ai_api_key_id,
    invocation_channel: run.invocation_channel,
    trigger_kind: run.trigger_kind,
    status: run.status,
    input_summary: resultsReadable ? run.input_summary : inputWithoutValues(run.input_summary),
    output_summary: resultsReadable ? run.output_summary : null,
    usage_json: run.usage_json,
    cost_json: run.cost_json,
    metadata_json: run.metadata_json,
    started_at: toIso(run.started_at),
    completed_at: toIso(run.completed_at),
    created_at: toIso(run.created_at),
    updated_at: toIso(run.updated_at),
  };
}

export function serializeToolExecution(tool: AiToolExecution, resultsReadable: boolean) {
  return {
    id: tool.id,
    tenant_id: tool.tenant_id,
    run_id: tool.run_id,
    step_id: tool.step_id,
    action_request_id: tool.action_request_id,
    approval_id: tool.approval_id,
    capability_name: tool.capability_name,
    capability_version: tool.capability_version,
    surface: tool.surface,
    effect: tool.effect,
    status: tool.status,
    input_hash: resultsReadable ? tool.input_hash : null,
    input_summary: resultsReadable ? tool.input_summary : inputWithoutValues(tool.input_summary),
    output_summary: resultsReadable ? tool.output_summary : null,
    error_message: resultsReadable ? tool.error_message : null,
    duration_ms: tool.duration_ms,
    usage_json: tool.usage_json,
    cost_json: tool.cost_json,
    metadata_json: resultsReadable ? tool.metadata_json : metadataWithoutErrorMessage(tool.metadata_json),
    started_at: toIso(tool.started_at),
    completed_at: toIso(tool.completed_at),
    created_at: toIso(tool.created_at),
  };
}

export function serializeRunStep(step: AiRunStep, resultsReadable: boolean) {
  return {
    id: step.id,
    run_id: step.run_id,
    step_index: step.step_index,
    kind: step.kind,
    status: step.status,
    capability_name: step.capability_name,
    capability_version: step.capability_version,
    input_summary: resultsReadable ? step.input_summary : inputWithoutValues(step.input_summary),
    output_summary: resultsReadable ? step.output_summary : null,
    error_message: resultsReadable ? step.error_message : null,
    started_at: toIso(step.started_at),
    completed_at: toIso(step.completed_at),
    created_at: toIso(step.created_at),
  };
}

// Human-readable per-task detail derived from an action's proposed payload, used
// to surface "what the agent actually proposed/did" inline in the Activity
// timeline (KANAP IA spec 23 §4.3) instead of only a generic label. Bounded:
// long text is truncated; only the proposed content and diffs are exposed.
export const ACTIVITY_DETAIL_BODY_MAX = 1200;
export type ActivityCheckDetail = {
  listed: number;
  enqueued: number;
  deduped: number;
  processed: number;
  errorCount: number;
  errors: string[];
  status: string | null;
  reason: string | null;
};

export type ActivityActionDetail = {
  capabilityName: string | null;
  body: string | null;
  changes: Array<{ field: string; from: string | null; to: string | null }> | null;
  reason: string | null;
  rationale: string | null;
  evidenceCount: number | null;
  check?: ActivityCheckDetail | null;
};

// The watcher stores its poll summary as the audit event metadata; the timeline
// used to throw it away (detail: null) and show a bare "Ticket check completed".
export function activityCheckDetail(event: AiAgentAuditEvent): ActivityActionDetail | null {
  if (auditActivityType(event) !== 'check') return null;
  const metadata = metadataObject(event.metadata_json);
  const count = (value: unknown): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  };
  const errors = (Array.isArray(metadata.errors) ? metadata.errors : [])
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim().slice(0, 200));
  const check: ActivityCheckDetail = {
    listed: count(metadata.listed),
    enqueued: count(metadata.enqueued),
    deduped: count(metadata.deduped),
    processed: count(metadata.processed),
    errorCount: errors.length,
    errors: errors.slice(0, 3),
    status: stringFromMetadata(metadata.status),
    reason: stringFromMetadata(metadata.reason),
  };
  return {
    capabilityName: null,
    body: null,
    changes: null,
    reason: null,
    rationale: null,
    evidenceCount: null,
    check,
  };
}

export function activityActionDetail(action: AiActionRequest): ActivityActionDetail | null {
  const payload = isRecord(action.action_payload_json) ? action.action_payload_json : null;
  const evidenceCount = Array.isArray(action.evidence_ids) ? action.evidence_ids.length : null;
  const truncate = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.length > ACTIVITY_DETAIL_BODY_MAX ? `${trimmed.slice(0, ACTIVITY_DETAIL_BODY_MAX)}…` : trimmed;
  };
  if (!payload) {
    return evidenceCount
      ? { capabilityName: action.capability_name, body: null, changes: null, reason: null, rationale: null, evidenceCount }
      : null;
  }
  const body = truncate(payload.note_body) ?? truncate(payload.reply_body) ?? truncate(payload.body);
  const reason = truncate(payload.reason);
  const changes: Array<{ field: string; from: string | null; to: string | null }> = [];
  const current = isRecord(payload.current) ? payload.current : null;
  const proposed = isRecord(payload.proposed) ? payload.proposed : null;
  if (proposed) {
    for (const [field, value] of Object.entries(proposed)) {
      if (value == null || value === '') continue;
      changes.push({
        field,
        from: current && current[field] != null && current[field] !== '' ? String(current[field]) : null,
        to: String(value),
      });
    }
  } else {
    const target = payload.targetStatusLabel ?? payload.targetStatus ?? payload.transitionKey;
    if (target != null && target !== '') {
      const from = current ? (current.statusLabel ?? current.status ?? null) : null;
      changes.push({ field: 'status', from: from != null && from !== '' ? String(from) : null, to: String(target) });
    }
  }
  const assignmentTarget = isRecord(payload.target) ? payload.target : null;
  if (assignmentTarget && assignmentTarget.label != null && assignmentTarget.label !== '') {
    changes.push({
      field: assignmentTarget.kind === 'group' ? 'group' : 'assignee',
      from: null,
      to: String(assignmentTarget.label),
    });
  }
  if (!body && !reason && changes.length === 0 && !evidenceCount) return null;
  return {
    capabilityName: action.capability_name,
    body,
    changes: changes.length > 0 ? changes : null,
    reason,
    rationale: null,
    evidenceCount,
  };
}

export function serializeEvidence(evidence: AiEvidence, resultsReadable: boolean) {
  return {
    id: evidence.id,
    tenant_id: evidence.tenant_id,
    run_id: evidence.run_id,
    tool_execution_id: evidence.tool_execution_id,
    action_request_id: evidence.action_request_id,
    source_provider: evidence.source_provider,
    source_object_type: evidence.source_object_type,
    source_object_id: evidence.source_object_id,
    source_uri: evidence.source_uri,
    trust_level: evidence.trust_level,
    redaction_status: evidence.redaction_status,
    // The summary quotes the result and the hash is its fingerprint.
    content_hash: resultsReadable ? evidence.content_hash : null,
    summary: resultsReadable ? evidence.summary : null,
    payload_json: resultsReadable ? evidence.payload_json : null,
    retention_class: evidence.retention_class,
    collected_at: toIso(evidence.collected_at),
    created_at: toIso(evidence.created_at),
  };
}

export function serializeObservation(observation: AiObservation) {
  return {
    id: observation.id,
    tenant_id: observation.tenant_id,
    run_id: observation.run_id,
    observation_type: observation.observation_type,
    status: observation.status,
    source_provider: observation.source_provider,
    source_object_type: observation.source_object_type,
    source_object_id: observation.source_object_id,
    severity: observation.severity,
    summary: observation.summary,
    evidence_ids: observation.evidence_ids,
    metadata_json: observation.metadata_json,
    observed_at: toIso(observation.observed_at),
    created_at: toIso(observation.created_at),
    updated_at: toIso(observation.updated_at),
  };
}

// Explicit field picks — the raw metadata_json also carries agent execution
// bookkeeping that has no business on a review surface.
export function serializeMonitoringAlertDiagnosis(observation: AiObservation) {
  const metadata = isRecord(observation.metadata_json) ? observation.metadata_json as Record<string, unknown> : {};
  const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
  const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const record = (value: unknown): Record<string, unknown> | null => (isRecord(value) ? value : null);
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  return {
    observation_id: observation.id,
    run_id: observation.run_id ?? null,
    observed_at: toIso(observation.observed_at),
    severity: observation.severity ?? null,
    summary: observation.summary ?? null,
    alert: record(metadata.alert),
    current_state: record(metadata.current_state),
    related_alerts: list(metadata.related_alerts),
    history_window_minutes: count(metadata.history_window_minutes),
    history_point_count: count(metadata.history_point_count),
    history_summary: record(metadata.history_summary),
    kanap_context: record(metadata.kanap_context),
    brief: {
      summary: text(metadata.brief_summary),
      probable_causes: list(metadata.probable_causes),
      business_impact: text(metadata.business_impact),
      recommended_actions: list(metadata.recommended_actions),
      used_sources: list(metadata.used_sources),
      rejected_sources: list(metadata.rejected_sources),
      needs_human_review: metadata.needs_human_review === true,
      confidence: text(metadata.brief_confidence),
      language: text(metadata.brief_language),
      fallback: metadata.synthesis_fallback === true,
      fallback_reason: text(metadata.synthesis_fallback_reason),
      model: text(metadata.synthesis_model),
    },
    synthesis: {
      model: text(metadata.synthesis_model),
      tokens: count(metadata.synthesis_tokens),
      cost_eur: count(metadata.synthesis_cost_eur),
    },
    knowledge: {
      status: text(metadata.knowledge_status),
      result_count: count(metadata.knowledge_result_count),
    },
    web: {
      status: text(metadata.web_search_status),
      result_count: count(metadata.web_result_count),
    },
  };
}

export function serializeRecommendation(recommendation: AiRecommendation) {
  return {
    id: recommendation.id,
    tenant_id: recommendation.tenant_id,
    run_id: recommendation.run_id,
    observation_id: recommendation.observation_id,
    recommendation_type: recommendation.recommendation_type,
    status: recommendation.status,
    summary: recommendation.summary,
    rationale: recommendation.rationale,
    confidence: recommendation.confidence,
    proposed_action_class: recommendation.proposed_action_class,
    max_autonomy_level: recommendation.max_autonomy_level,
    evidence_ids: recommendation.evidence_ids,
    metadata_json: recommendation.metadata_json,
    created_at: toIso(recommendation.created_at),
    updated_at: toIso(recommendation.updated_at),
  };
}

export function serializeDecision(decision: AiDecision) {
  return {
    id: decision.id,
    tenant_id: decision.tenant_id,
    run_id: decision.run_id,
    recommendation_id: decision.recommendation_id,
    decision: decision.decision,
    status: decision.status,
    reason: decision.reason,
    evidence_ids: decision.evidence_ids,
    policy_result_json: decision.policy_result_json,
    metadata_json: decision.metadata_json,
    created_at: toIso(decision.created_at),
    updated_at: toIso(decision.updated_at),
  };
}

export function serializeEvaluation(evaluation: AiEvaluation) {
  return {
    id: evaluation.id,
    tenant_id: evaluation.tenant_id,
    run_id: evaluation.run_id,
    recommendation_id: evaluation.recommendation_id,
    decision_id: evaluation.decision_id,
    status: evaluation.status,
    outcome: evaluation.outcome,
    scores_json: evaluation.scores_json,
    feedback_json: evaluation.feedback_json,
    metadata_json: evaluation.metadata_json,
    created_at: toIso(evaluation.created_at),
    updated_at: toIso(evaluation.updated_at),
  };
}

export type ActionExecutionReadiness = {
  can_execute: boolean;
  can_reject: boolean;
  blocked_reason: string | null;
  requires_sandbox_write_target: boolean;
  sandbox_write_target_ref: string | null;
};

export type ActionAgentLink = { agent_definition_id: string | null; agent_exists: boolean | null };

export function serializeActionRequest(
  action: AiActionRequest,
  executionReadiness?: ActionExecutionReadiness | null,
  agentLink?: ActionAgentLink | null,
) {
  return {
    id: action.id,
    tenant_id: action.tenant_id,
    run_id: action.run_id,
    tool_execution_id: action.tool_execution_id,
    conversation_id: action.conversation_id,
    user_id: action.user_id,
    preview_id: action.preview_id,
    capability_name: action.capability_name,
    capability_version: action.capability_version,
    effect: action.effect,
    status: action.status,
    target_type: action.target_type,
    target_id: action.target_id,
    target_ref: action.target_ref,
    idempotency_key: action.idempotency_key,
    action_payload_json: action.action_payload_json,
    provider_kind: action.provider_kind,
    provider_key: action.provider_key,
    input_hash: action.input_hash,
    input_summary: action.input_summary,
    evidence_ids: action.evidence_ids,
    expires_at: toIso(action.expires_at),
    approved_at: toIso(action.approved_at),
    rejected_at: toIso(action.rejected_at),
    executed_at: toIso(action.executed_at),
    error_message: action.error_message,
    metadata_json: action.metadata_json,
    execution_readiness: executionReadiness ?? null,
    // The agent is only linked through metadata (no FK), so it can outlive the
    // agent's deletion; the UI needs to know whether it still resolves.
    agent_definition_id: agentLink?.agent_definition_id ?? null,
    agent_exists: agentLink?.agent_exists ?? null,
    created_at: toIso(action.created_at),
    updated_at: toIso(action.updated_at),
  };
}

export function serializeApproval(approval: AiApproval) {
  return {
    id: approval.id,
    tenant_id: approval.tenant_id,
    action_request_id: approval.action_request_id,
    capability_name: approval.capability_name,
    capability_version: approval.capability_version,
    source: approval.source,
    status: approval.status,
    actor_user_id: approval.actor_user_id,
    actor_label: approval.actor_label,
    input_hash: approval.input_hash,
    evidence_ids: approval.evidence_ids,
    reason: approval.reason,
    matched_policy_id: approval.matched_policy_id,
    matched_policy_version: approval.matched_policy_version,
    decision_json: approval.decision_json,
    expires_at: toIso(approval.expires_at),
    decided_at: toIso(approval.decided_at),
    created_at: toIso(approval.created_at),
  };
}

export function serializeLiveTarget(target: AiLiveTestTarget | AgentQueueLiveTargetLike) {
  return {
    id: target.id,
    tenant_id: 'tenant_id' in target ? target.tenant_id : null,
    provider_kind: target.provider_kind,
    provider_key: target.provider_key,
    environment: target.environment,
    target_kind: target.target_kind,
    target_key: target.target_key,
    external_ref: target.external_ref,
    allowed_effect: target.allowed_effect,
    safety_label: target.safety_label,
    enabled: target.enabled,
    expires_at: 'expires_at' in target ? toIso(target.expires_at) : null,
    metadata_json: 'metadata_json' in target ? target.metadata_json : null,
    created_at: 'created_at' in target ? toIso(target.created_at) : null,
    updated_at: 'updated_at' in target ? toIso(target.updated_at) : null,
  };
}

export function serializeAgentDefinition(definition: AiAgentDefinition) {
  return {
    id: definition.id,
    tenant_id: definition.tenant_id,
    agent_key: definition.agent_key,
    name: definition.name,
    description: definition.description,
    agent_type: definition.agent_type,
    status: definition.status,
    environment: definition.environment,
    provider_bindings_json: definition.provider_bindings_json,
    allowed_capabilities_json: definition.allowed_capabilities_json,
    forbidden_capabilities_json: definition.forbidden_capabilities_json,
    max_autonomy_level: definition.max_autonomy_level,
    default_approval_requirement: definition.default_approval_requirement,
    agent_priority: cleanAgentPriority(definition.agent_priority),
    trigger_policy_json: definition.trigger_policy_json,
    scope_policy_json: definition.scope_policy_json,
    queue_policy_json: definition.queue_policy_json,
    response_policy_json: definition.response_policy_json,
    evaluation_policy_json: definition.evaluation_policy_json,
    persona_json: definition.persona_json ?? null,
    llm_model_config_id: definition.llm_model_config_id ?? null,
    config_version: definition.config_version ?? 1,
    updated_by_user_id: definition.updated_by_user_id ?? null,
    metadata_json: definition.metadata_json,
    created_at: toIso(definition.created_at),
    updated_at: toIso(definition.updated_at),
  };
}

export function serializeAgentWorkItem(workItem: AiAgentWorkItem) {
  return {
    id: workItem.id,
    tenant_id: workItem.tenant_id,
    agent_definition_id: workItem.agent_definition_id,
    trigger_id: workItem.trigger_id,
    source_provider_kind: workItem.source_provider_kind,
    source_provider_key: workItem.source_provider_key,
    source_object_type: workItem.source_object_type,
    source_object_ref: workItem.source_object_ref,
    source_object_updated_at: toIso(workItem.source_object_updated_at),
    work_kind: workItem.work_kind,
    status: workItem.status,
    priority: workItem.priority,
    dedup_key: workItem.dedup_key,
    lease_owner: workItem.lease_owner,
    leased_until: toIso(workItem.leased_until),
    attempt_count: workItem.attempt_count,
    max_attempts: workItem.max_attempts,
    next_attempt_at: toIso(workItem.next_attempt_at),
    last_run_id: workItem.last_run_id,
    last_action_request_ids: workItem.last_action_request_ids,
    last_error: workItem.last_error,
    metadata_json: workItem.metadata_json,
    created_at: toIso(workItem.created_at),
    updated_at: toIso(workItem.updated_at),
  };
}

export function serializeAgentTargetState(state: AiAgentTargetState) {
  return {
    id: state.id,
    tenant_id: state.tenant_id,
    agent_definition_id: state.agent_definition_id,
    provider_kind: state.provider_kind,
    provider_key: state.provider_key,
    target_type: state.target_type,
    target_ref: state.target_ref,
    last_seen_external_updated_at: toIso(state.last_seen_external_updated_at),
    last_processed_external_updated_at: toIso(state.last_processed_external_updated_at),
    next_review_at: toIso(state.next_review_at),
    last_run_id: state.last_run_id,
    last_public_reply_hash: state.last_public_reply_hash,
    last_internal_note_hash: state.last_internal_note_hash,
    last_classification_hash: state.last_classification_hash,
    last_assignment_hash: state.last_assignment_hash,
    agent_touched: state.agent_touched,
    needs_followup: state.needs_followup,
    claim_status: state.claim_status,
    claim_expires_at: toIso(state.claim_expires_at),
    claim_acquired_at: toIso(state.claim_acquired_at),
    claim_owner_work_item_id: state.claim_owner_work_item_id,
    claim_owner_run_id: state.claim_owner_run_id,
    claim_owner_priority: state.claim_owner_priority,
    claim_owner_action_request_ids: state.claim_owner_action_request_ids,
    claim_metadata_json: state.claim_metadata_json,
    state_json: state.state_json,
    created_at: toIso(state.created_at),
    updated_at: toIso(state.updated_at),
  };
}

export function serializeAgentAuditEvent(event: AiAgentAuditEvent) {
  return {
    id: event.id,
    tenant_id: event.tenant_id,
    agent_definition_id: event.agent_definition_id,
    work_item_id: event.work_item_id,
    event_type: event.event_type,
    severity: event.severity,
    message: event.message,
    metadata_json: event.metadata_json,
    created_at: toIso(event.created_at),
  };
}
