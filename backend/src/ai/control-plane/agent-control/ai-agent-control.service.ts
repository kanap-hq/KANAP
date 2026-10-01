import { resolvePlannerClassificationProposal } from '../providers/ticket-classification';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FindOptionsWhere, In, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { Features } from '../../../config/features';
import { decodeNumericHtmlEntities } from '../../../common/html-entities';
import { AiExecutionContextWithManager } from '../../ai.types';
import {
  AGENT_AUTONOMY_POLICY_SOURCE,
  AgentAutonomyMode,
  actionClassForCapabilityName,
  agentAutonomyPolicyKey,
  approvedCapabilityForAutonomyActionClass,
  autonomyGrantRequiresAcknowledgement,
  autonomyRiskTier,
  AUTONOMY_RISK_TIER_BY_ACTION_CLASS,
  isAgentAutonomyPolicyMetadata,
  isAutomatableAutonomyActionClass,
} from '../agent/ai-agent-autonomy';
import {
  AGENT_ACTIVITY_AUDIT_TYPES,
  AGENT_ACTIVITY_TYPES,
  AgentActivityType,
  auditActivityType,
  auditActivityTypeSql,
  decodeActivityCursor,
  mergeActivityPage,
} from './ai-agent-activity-timeline';
import { normalizeQueuePolicyRetention } from '../agent/ai-agent-activity-retention';
import {
  checkIntervalMinutesForDefinition,
  checksPerDay,
  normalizeTriggerPolicyCheckInterval,
} from '../agent/ai-agent-check-interval';
import {
  AgentQueueLiveTargetLike,
  AiAgentWorkQueueService,
  DEFAULT_APPROVAL_TTL_SECONDS,
  markWorkItemAttemptFailure,
  monitoringAlertDedupKey,
  resolveAuditEventLinks,
  SRE_MONITORING_ALLOWED_CAPABILITIES,
  withOrphanedAuditLinks,
} from '../agent/ai-agent-work-queue.service';
import { AttentionScope, countAttention, stampAttentionAcknowledged } from './ai-agent-attention.util';
import { helpdeskAgentDefaults, sreAgentDefaults } from '../agent/agent-definition-defaults';
import { LEGACY_GLPI_TICKETING_PROVIDER_KEY } from '../providers/provider-constants';
import { AiAdapterConfig } from '../providers/adapter-config.entity';
import { normalizeMonitoringScopePolicy } from '../agent/monitoring-targeting';
import { requireMonitoringBinding } from '../agent/provider-binding';
import { requireTicketingBinding, resolveTicketingBinding } from '../agent/ticketing-binding';
import {
  createProviderSubtreeResolver,
  expandServiceDeskTargetingSubtrees,
  normalizeServiceDeskScopePolicy,
  normalizeServiceDeskTargeting,
  TargetingPreviewSummary,
  ticketMatchesServiceDeskTargeting,
} from '../agent/service-desk-targeting';
import { AiApprovalService } from '../approval/ai-approval.service';
import {
  CapabilityExecutionResult,
  TICKETING_ASSIGNMENT_UPDATE_APPROVED_CAPABILITY,
  TICKETING_ASSIGNMENT_UPDATE_PREPARE_CAPABILITY,
  TICKETING_CLASSIFICATION_CONTEXT_CAPABILITY,
  TICKETING_CLASSIFICATION_UPDATE_APPROVED_CAPABILITY,
  TICKETING_CLASSIFICATION_UPDATE_PREPARE_CAPABILITY,
  TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY,
  TICKETING_INTERNAL_NOTE_PREPARE_CAPABILITY,
  TICKETING_LIFECYCLE_CONTEXT_CAPABILITY,
  TICKETING_PARTICIPANT_CONTEXT_CAPABILITY,
  TICKETING_PARTICIPANT_UPDATE_APPROVED_CAPABILITY,
  TICKETING_PARTICIPANT_UPDATE_PREPARE_CAPABILITY,
  TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY,
  TICKETING_PUBLIC_REPLY_PREPARE_CAPABILITY,
  TICKETING_ROUTING_CONTEXT_CAPABILITY,
  TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY,
  TICKETING_STATUS_UPDATE_PREPARE_CAPABILITY,
  TICKETING_TICKET_ATTACHMENT_READ_CAPABILITY,
  TICKETING_TICKET_NOTES_LIST_CAPABILITY,
} from '../capability/capability-contract';
import {
  AiCapabilityRegistry,
  KANAP_ENTITY_FAMILIES,
  KanapEntityFamily,
  providerCapabilityContracts,
} from '../capability/ai-capability.registry';
import { AiAgentBuiltinQuotaService } from '../agent/ai-agent-builtin-quota.service';
import { AiCapabilityDispatcherService } from '../dispatcher/ai-capability-dispatcher.service';
import { AiReadonlyDiagnosticWorkflowService } from '../diagnostics/ai-readonly-diagnostic-workflow.service';
import { AiTenantExecutionService } from '../../execution/ai-tenant-execution.service';
import { AiActionRequest } from '../entities/ai-action-request.entity';
import { hashStableJson } from '../evidence/ai-evidence.service';
import { AiAgentAuditEvent } from '../entities/ai-agent-audit-event.entity';
import { AiModelConfig } from '../../ai-model-config.entity';
import { AiAgentLlmClient } from './ai-agent-llm-client';
import { AiAgentDefinition } from '../entities/ai-agent-definition.entity';
import { AiAgentTargetState } from '../entities/ai-agent-target-state.entity';
import { AiAgentWorkItem } from '../entities/ai-agent-work-item.entity';
import { AiApproval } from '../entities/ai-approval.entity';
import { AiApprovalPolicy } from '../entities/ai-approval-policy.entity';
import { AiDecision } from '../entities/ai-decision.entity';
import { AiEvaluation } from '../entities/ai-evaluation.entity';
import { AiEvidence } from '../entities/ai-evidence.entity';
import { AiLiveTestTarget } from '../entities/ai-live-test-target.entity';
import { AiObservation } from '../entities/ai-observation.entity';
import { AiRecommendation } from '../entities/ai-recommendation.entity';
import { AiRun } from '../entities/ai-run.entity';
import { AiRunStep } from '../entities/ai-run-step.entity';
import { AiToolExecution } from '../entities/ai-tool-execution.entity';
import { AiLiveTestTargetService } from '../live-readiness/ai-live-test-target.service';
import { AiProviderRegistryService } from '../providers/provider-registry.service';
import { MAX_INTERNAL_NOTE_CHARS, MAX_PUBLIC_REPLY_CHARS } from '../providers/ticket-safety';
import {
  MonitoringReferenceCatalogKind,
  ProviderActionExecutionReadiness,
  ProviderActionPlannerProfile,
  RefItem,
  TicketAttachmentReadResult,
  TicketAttachmentRef,
  TicketRecord,
  TicketReferenceCatalogKind,
  ticketActorRoleFromResponsePolicy,
} from '../providers/provider.types';
import {
  AiAgentPromptCompilerService,
  CompiledAgentProfile,
  CompiledGuidance,
  compileSystemPrompt,
  guidanceHash,
  RUNTIME_SAFETY_FLOOR_ACTION_PLANNER,
  RUNTIME_SAFETY_FLOOR_INTERPRETER,
  RUNTIME_SAFETY_FLOOR_MONITORING_DIAGNOSIS,
  RUNTIME_SAFETY_FLOOR_PLANNER,
  RUNTIME_SAFETY_FLOOR_SYNTHESIS,
  VerbatimCandidate,
} from './ai-agent-prompt-compiler.service';
import {
  AiDiagnosticBriefSynthesisService,
  buildFallbackDiagnosticBrief,
  DiagnosticBriefAlertEvidence,
  DiagnosticBriefResult,
  DiagnosticBriefSynthesisInput,
  DiagnosticHistorySummary,
  estimateDiagnosticBriefUsage,
} from './ai-diagnostic-brief-synthesis.service';
import {
  KanapEntityContextResolver,
  KanapEntityDispatchOutcome,
} from './ai-kanap-entity-context.service';
import {
  ActionPlannerResult,
  ActionPlannerPromptInput,
  AiAgentActionPlannerService,
  estimateActionPlannerUsage,
  PlannerAction,
  PlannerActionType,
} from './ai-agent-action-planner.service';
import {
  AiKnowledgeSearchPlannerService,
  KnowledgePlannerCandidate,
  KnowledgeResultInterpretation,
  KnowledgeSearchPlan,
} from './ai-knowledge-search-planner.service';
import {
  AiReplySynthesisService,
  estimateReplySynthesisUsage,
  ReplySynthesisEntitySource,
  ReplySynthesisRejectedSource,
  ReplySynthesisResult,
  ReplySynthesisSource,
} from './ai-reply-synthesis.service';
import {
  AiSharedContextProfileService,
  SharedContextProfileInput,
  SharedContextResolution,
} from './ai-shared-context-profile.service';
import {
  AiTicketEvidenceExtractionService,
  estimateTicketEvidenceExtractionUsage,
  TicketEvidenceExtractionResult,
} from './ai-ticket-evidence-extraction.service';
import {
  AiTicketNeedRepresentationService,
  estimateTicketNeedRepresentationUsage,
  TicketNeedRepresentationBuildResult,
} from './ai-ticket-need-representation.service';
import { KnowledgeQueryDerivation } from './ai-ticket-need-representation.types';
import { isRecord } from '../../../common/object-guards';
import {
  normalizeKnowledgeText,
  cleanKnowledgeCandidate,
  uniqueKnowledgeCandidates,
  extractKnowledgePhrases,
  extractKnowledgeTokens,
  buildKnowledgeQuery,
  buildKnowledgeQueryCandidates,
  buildShortKnowledgeQueryCandidates,
  buildWebSearchQueryCandidates,
  stripKnowledgeAccents,
  latestRequesterBody,
  extractKnowledgePreferenceTerms,
  buildFallbackKnowledgeSearchPlan,
  knowledgeItemsFromOutput,
  stripWebText,
  webSearchItemsFromOutput,
  knowledgeDocumentFromOutput,
  knowledgeDocumentRef,
  knowledgeCandidateKey,
  knowledgeScoreSortValue,
  mergeKnowledgeAttempts,
  plannerCandidatesFromKnowledge,
  applyKnowledgeInterpretation,
  knowledgeRelevanceTerms,
  knowledgeItemLexicalOverlap,
  filterKnowledgeItemsByRelevance,
  plannerKnowledgeSummary,
  plannerWebSummary,
  buildFallbackKnowledgeInterpretation,
  serializeKnowledgeSearchPlan,
  serializeKnowledgeNeedRepresentation,
  serializeKnowledgeQueryDerivation,
  serializeTicketImageExtraction,
  serializeKnowledgeInterpretation,
  ticketLooksFrench,
  MAX_KNOWLEDGE_DOCUMENTS_FOR_REPLY,
} from './agent-control-knowledge.util';
import {
  summarizeMonitoringHistory,
  compactRelatedMonitoringAlerts,
  buildMonitoringRetrievalQueryCandidates,
  MAX_MONITORING_RELATED_ALERTS,
} from './agent-control-monitoring.util';
import {
  ActionAgentLink,
  ActionExecutionReadiness,
  ActivityActionDetail,
  serializeRun,
  serializeToolExecution,
  serializeRunStep,
  activityCheckDetail,
  activityActionDetail,
  serializeEvidence,
  serializeObservation,
  serializeMonitoringAlertDiagnosis,
  serializeRecommendation,
  serializeDecision,
  serializeEvaluation,
  serializeActionRequest,
  serializeApproval,
  serializeLiveTarget,
  serializeAgentDefinition,
  serializeAgentWorkItem,
  serializeAgentTargetState,
  serializeAgentAuditEvent,
} from './agent-control-serializers.util';
import {
  readKanapDataBlock,
  addEstimatedUsage,
  dateKey,
  withinDateRange,
  cleanSingleLine,
  requireBoundedLine,
  hasOwn,
  uniqueBoundsApplied,
  cleanAgentKey,
  slugAgentKey,
  cleanAgentType,
  cleanAgentEnvironment,
  cleanAgentStatus,
  normalizedPolicyObject,
  normalizePersona,
  normalizeResponsePolicyForConfig,
  autonomyLevelRank,
  capabilityNameFromEntry,
  normalizeAllowedCapabilitiesForConfig,
  normalizeScopePolicyForAgentType,
  definitionAllowsCapability,
  allowedCapabilityNames,
  lifecycleAllowedTransitions,
  lifecycleTransitionKey,
  normalizePlannerStatusTransitionKey,
  lifecycleTransitionByKey,
  lifecycleTransitionIsTerminal,
  preferredTerminalLifecycleTransition,
  plannerStatusTransitionIsTerminal,
  resolvePlannerStatusTransition,
  plannerActionKindKey,
  resolvePlannerAssignmentTarget,
  resolveVerbatimCandidate,
  plannerActionKey,
  configSnapshot,
  changedConfigDiff,
  autonomyThresholds,
  normalizeKnowledgeSources,
  readAgentKnowledgeSources,
  proposalHash,
} from './agent-control-definition.util';
import {
  possibleCapabilityCapsForAgentType,
  proposalStillBlocksRegeneration,
  actionSortTime,
  actionIsActivePending,
  definitionIdFromMetadata,
  numberFromMetadata,
  withApprovedBatchContext,
  approvedBatchExecutionAttempts,
  actionExecutionSkipReason,
  actionClass,
  numericMetadata,
  ACTION_TYPE_CAPABILITY_TABLE,
  APPROVED_ACTION_EXECUTING_STATUS,
  AUTONOMY_ACTION_CLASSES,
  AUTONOMY_RECOMMENDATION_REASON_CODES,
  CLOSE_TRIAGE_ACTIONS,
  DEFAULT_BULK_EXECUTION_PHASE,
  HELPDESK_REVIEW_ACTION_CAPABILITIES,
  KnowledgeDocumentFetchAttempt,
  PHASE_1_PLANNER_OWNED_ACTION_TYPES,
  PLANNER_ASSIGNMENT_ACTION_TYPE,
  PLANNER_CLASSIFICATION_ACTION_TYPE,
  PLANNER_OWNED_ACTION_TYPES,
  PLANNER_TERMINAL_TRANSITIONS,
  STATIC_CAPABILITY_EXECUTION_PHASES,
  TARGETING_CATALOG_BROWSE_TTL_MS,
  TARGETING_CATALOG_OPTIONS_TTL_MS,
  TARGETING_ENUM_OPTIONS_TTL_MS,
  TARGETING_OPTIONS_STALE_SERVE_MS,
  UUID_RE,
} from './agent-control-constants.util';

import {
  actionRequestIdsFromCapabilityOutput,
  ticketNotesFromOutput,
  parseTime,
  isoFromTime,
  actionPayloadBody,
  actionPayloadVisibility,
  actionProviderResultNoteId,
  actionExecutedTime,
  normalizeTimelineBody,
  ticketNoteTime,
  ticketNoteFingerprint,
  latestTicketNote,
  resolveActionProviderNote,
  actionConversationTime,
  actionConversationTimeOrNull,
  latestExecutedAction,
  isKanapMarkedBody,
  buildTicketTimeline,
  evaluateConversationGate,
  timelineSummaryLines,
  buildTriageNote,
  configuredReplyLanguage,
  resolveReplyLanguage,
  normalizeKnowledgeReplyText,
  sanitizeForProvider,
  sanitizeInlineForProvider,
  renderProviderBody,
  latestRequesterExcerpt,
  replyLocale,
  sourceLineFromKnowledge,
  sourceLineFromWeb,
  fallbackSourceLines,
  synthesisSourceLine,
  rejectedSynthesisSourceLine,
  limitedSourceLines,
  renderSynthesizedRequesterReply,
  renderSynthesizedTriageNote,
  buildRequesterReply,
  buildStatusUpdateProposal,
  MAX_SYNTHESIZED_REQUESTER_BODY_CHARS,
} from './agent-control-timeline-synthesis.util';

export type AgentControlListRunsOptions = {
  limit?: number;
  status?: string | null;
};

export type AgentControlListActionsOptions = {
  limit?: number;
  status?: string | null;
};

export type AgentControlActivityType = AgentActivityType;

export type AgentControlActivityOptions = {
  agentDefinitionId?: string | null;
  from?: string | null;
  to?: string | null;
  targetRef?: string | null;
  types?: AgentControlActivityType[] | null;
  actorUserId?: string | null;
  status?: string | null;
  limit?: number;
  // Keyset cursor from the previous page's `nextCursor`. Deliberately opaque:
  // the timeline merges several sources, so a raw offset can't address it.
  cursor?: string | null;
};

export type AgentControlMockTriageInput = {
  alert_id?: string | null;
  ticket_id?: string | null;
  provider_key?: string | null;
  include_directory?: boolean | null;
  user_id_or_email?: string | null;
  note_body?: string | null;
};

export type AgentControlTicketingReadInput = {
  provider_key?: string | null;
  target_key?: string | null;
};

export type AgentControlTicketingTriageInput = {
  work_item_id?: string | null;
  provider_key?: string | null;
  target_key?: string | null;
  // Required on the non-work_item_id path: which agent a manual "test on a
  // ticket" run should exercise.
  agent_definition_id?: string | null;
};

export type AgentControlMonitoringDiagnosisInput = {
  // Queued path (scheduled poller / retry): run an existing monitoring work item.
  work_item_id?: string | null;
  // Manual test path: run a named SRE agent against one alert; a work item is
  // enqueued (or the active one reused) so the queued and manual paths share
  // the same lease/claim/outcome bookkeeping.
  agent_definition_id?: string | null;
  alert_id?: string | null;
};

type RunLlmUsageEstimate = {
  estimatedTokens: number;
  estimatedCostEur: number;
};

type HelpdeskTicketingTriageRunOptions = {
  workflow?: string;
  sourceEndpoint?: string;
  observationType?: string;
  recommendationType?: string;
  evaluationType?: string;
  proposalEvaluationType?: string;
};

const TICKETING_TRIAGE_RUN_OPTIONS: Required<HelpdeskTicketingTriageRunOptions> = {
  workflow: 'agent_control_center_ticketing_triage',
  sourceEndpoint: 'uat/ticketing-triage',
  observationType: 'ticketing_ticket_triage',
  recommendationType: 'ticketing_triage_actions',
  evaluationType: 'ticketing_triage_uat',
  proposalEvaluationType: 'ticketing_triage_proposal',
};

// Monitoring mirror of the ticketing run-options bundle. Recommendation and
// evaluation types are already named so IMPL-4 (full diagnosis pipeline) can
// consume them without re-deciding the vocabulary.
const MONITORING_DIAGNOSIS_RUN_OPTIONS = {
  workflow: 'agent_control_center_monitoring_diagnosis',
  sourceEndpoint: 'agents/monitoring-diagnosis/test',
  observationType: 'monitoring_alert_diagnostic',
  recommendationType: 'monitoring_diagnosis_actions',
  evaluationType: 'monitoring_diagnosis_uat',
  proposalEvaluationType: 'monitoring_diagnosis_proposal',
} as const;

// Minimal normalized-alert view the diagnosis pipeline consumes; matches the
// MonitoringAlert contract without importing its full shape.
export type MonitoringAlertLike = {
  id: string;
  status?: string | null;
  severity?: string | null;
  ackState?: string | null;
  // Untrusted provider text — reaches the LLM only under the payload's
  // untrusted_alert_text key. Not persisted on queue rows; the diagnosis
  // observation stores a clamped display excerpt (compactAlert.message) so the
  // review surface can show the reviewer what the tool actually reported.
  message?: string | null;
  deviceName?: string | null;
  // Display name of the failing check itself (untrusted provider text).
  checkName?: string | null;
  // Provider device object id (optional adapter metadata): gates the
  // monitored-object read that feeds the §4.5 IP tiebreak.
  deviceId?: string | null;
  occurrenceStartedAt?: string | null;
  observedAt?: string | null;
  lastCheckedAt?: string | null;
  lastValue?: string | null;
  objectKind?: string | null;
  groupPath?: string[] | null;
  sourceUri?: string | null;
};

const MONITORING_HISTORY_WINDOW_MINUTES = 60;
const MAX_MONITORING_KNOWLEDGE_DOCUMENTS = 2;
const MAX_MONITORING_SIMILAR_TICKETS = 3;

// Deterministic history digest (D11): min/max/latest per channel computed
// control-plane side so raw point arrays never reach an LLM payload.

// The small helpers and the targeting-option types they need live in their own module:
// every other concern in this file used them, and none of them depend on anything here.
export type {
  AgentControlTargetingOptionField,
  AgentControlMonitoringTargetingOptionField,
} from './agent-control-util';
import {
  cleanAgentPriority,
  metadataObject,
  stringFromMetadata,
  toIso,
  trimmedString,
  manualTicketRef,
  approvalDecisionReason,
  cleanTargetingOptionField,
  cleanMonitoringTargetingOptionField,
  cleanTargetingOptionLimit,
  cleanTargetingOptionQuery,
  providerKeyFromBindings,
  adapterData,
  adapterFailureMessage,
  safeLimit,
  clampText,
  stripHeadlineTags,
} from './agent-control-util';

export type AgentControlAgentDefinitionInput = {
  agent_key?: string | null;
  name?: string | null;
  description?: string | null;
  agent_type?: string | null;
  environment?: string | null;
  agent_priority?: number | null;
  provider_bindings_json?: Record<string, unknown> | null;
  allowed_capabilities_json?: Record<string, unknown> | unknown[] | null;
  forbidden_capabilities_json?: Record<string, unknown> | unknown[] | null;
  persona_json?: Record<string, unknown> | null;
  trigger_policy_json?: Record<string, unknown> | null;
  scope_policy_json?: Record<string, unknown> | null;
  knowledge_sources?: Record<string, unknown> | null;
  queue_policy_json?: Record<string, unknown> | null;
  response_policy_json?: Record<string, unknown> | null;
  evaluation_policy_json?: Record<string, unknown> | null;
  llm_model_config_id?: string | null;
};

export type AgentControlAgentStatusInput = {
  status?: string | null;
  // Optional scheduled-poll flip so a run-mode change (off / manual only / watching)
  // lands atomically with the status write instead of racing a second request.
  watching?: boolean | null;
};

export type AgentControlAutonomyInput = {
  actionClass?: string | null;
  mode?: AgentAutonomyMode | null;
  confirm?: boolean | null;
  overrideAcknowledged?: boolean | null;
  overrideReason?: string | null;
};

export type AgentControlTargetingPreviewInput = {
  scope_policy_json?: Record<string, unknown> | null;
};

export type AgentControlBulkApproveInput = {
  action_request_ids?: string[] | null;
  execute?: boolean | null;
  reason?: string | null;
};

type AgentControlBulkApproveOptions = {
  queueExecution?: boolean;
};

type AdapterResultLike<T> =
  | { ok: true; data: T; evidence?: unknown[]; warnings?: string[] }
  | { ok: false; errorCode: string; message: string; retryable: boolean; evidence?: unknown[] };

export type TicketLike = {
  id: string;
  title: string;
  status?: string | null;
  priority?: string | null;
  description?: string | null;
  updatedAt?: string | null;
  updated_at?: string | null;
  attachments?: TicketAttachmentRef[];
};

export type TicketNoteLike = {
  id: string;
  visibility: 'public' | 'internal';
  authorId?: string | null;
  author?: string | null;
  authorRole?: 'requester' | 'support' | 'kanap_agent' | 'unknown';
  body: string;
  createdAt: string;
  updatedAt?: string | null;
  updateFingerprint?: string | null;
  attachments?: TicketAttachmentRef[];
};

export type TicketTimelineEntry = {
  id: string;
  kind: 'description' | 'followup';
  visibility: 'public' | 'internal';
  actor: 'requester_candidate' | 'kanap_agent' | 'support_or_unknown';
  actorSource: 'provider_requester_user' | 'provider_support_user' | 'kanap_marker' | 'public_non_kanap_followup' | 'initial_ticket';
  actorId: string | null;
  body: string;
  createdAt: string | null;
  updatedAt: string | null;
  updateFingerprint: string | null;
};

export type ConversationActionGate = {
  can_prepare_internal_note: boolean;
  can_prepare_public_reply: boolean;
  can_prepare_sourced_answer: boolean;
  can_prepare_administrative_close_reply: boolean;
  internal_note_reason: string;
  public_reply_reason: string;
  sourced_answer_reason: string;
  administrative_close_reply_reason: string;
  latest_requester_message_at: string | null;
  latest_requester_message_id: string | null;
  last_agent_internal_note_at: string | null;
  last_agent_internal_note_action_id: string | null;
  last_agent_public_reply_at: string | null;
  last_agent_public_reply_action_id: string | null;
  requester_classification_confidence: 'provider_requester_user' | 'initial_ticket' | 'public_non_kanap_followup' | 'none';
  ticket_history_entry_count: number;
  latest_ticket_note_id: string | null;
  latest_ticket_note_at: string | null;
  latest_ticket_note_fingerprint: string | null;
  latest_requester_message_fingerprint: string | null;
  prepared_at: string;
};

export type KnowledgeSearchItem = {
  id?: string;
  ref?: string | null;
  title?: string | null;
  summary?: string | null;
  snippet?: string | null;
  content_markdown?: string | null;
  status?: string | null;
  updated_at?: string | null;
  score?: number | null;
  // 'selected' = validated by the LLM interpreter; 'unvalidated' = retrieved but not validated
  // (LLM-fallback path), handed to synthesis as a candidate to judge. Set when presenting items
  // for the reply; absent for raw search/merge candidates. See applyKnowledgeInterpretation (#3).
  validation_status?: 'selected' | 'unvalidated' | null;
};

export type KnowledgeSearchAttempt = {
  query: string;
  result: CapabilityExecutionResult<Record<string, unknown>>;
  items: KnowledgeSearchItem[];
};

export type WebSearchResultItem = {
  title: string;
  url: string;
  description: string;
};

export type MergedKnowledgeCandidate = KnowledgeSearchItem & {
  search_queries: string[];
  match_count?: number;
};


// KANAP data enrichment sub-block (plan 37 §4.5): kanap_data.enabled defaults to FALSE
// when the block is absent — existing (helpdesk) definitions predate it and must not
// silently gain KANAP entity reads (helpdesk-safety). The SRE seed writes the block
// explicitly enabled with all five domains, so SRE agents get it from day one. Within an
// explicitly present block, a missing domain key defaults to ON (master-switch
// semantics); unknown domain keys are dropped.



// Terminal ticket transitions (solve/close) are destructive cleanup actions. Even
// though they reuse the status_update capability (action class 'status', which is
// in the low-risk automation allowlist), they must NEVER auto-execute. New
// provider payloads stamp the neutral terminal flag; transitionKey remains a
// legacy persisted-row backstop.
function isTerminalStatusAction(action: AiActionRequest): boolean {
  if (!action.capability_name.includes('status_update')) return false;
  const payload = isRecord(action.action_payload_json) ? action.action_payload_json : null;
  if (!payload) return false;
  if (payload.terminal === true) return true;
  const transitionKey = typeof payload.transitionKey === 'string' ? payload.transitionKey : null;
  return transitionKey != null && PLANNER_TERMINAL_TRANSITIONS.has(transitionKey);
}

function actionMetadataString(action: AiActionRequest, field: string): string | null {
  const metadata = isRecord(action.metadata_json) ? action.metadata_json : null;
  const value = metadata?.[field];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function capabilityPhaseKey(action: Pick<AiActionRequest, 'capability_name' | 'capability_version'>): string {
  return `${action.capability_name}:${action.capability_version}`;
}

function bulkApproveOrder(action: AiActionRequest, executionPhases?: Map<string, number>): number {
  return executionPhases?.get(action.id)
    ?? STATIC_CAPABILITY_EXECUTION_PHASES.get(capabilityPhaseKey(action))
    ?? DEFAULT_BULK_EXECUTION_PHASE;
}

function bulkApproveActionSort(
  left: AiActionRequest,
  right: AiActionRequest,
  executionPhases?: Map<string, number>,
): number {
  const orderDiff = bulkApproveOrder(left, executionPhases) - bulkApproveOrder(right, executionPhases);
  if (orderDiff !== 0) return orderDiff;
  const leftTime = actionSortTime(left);
  const rightTime = actionSortTime(right);
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.id.localeCompare(right.id);
}


/**
 * Stage identity for the run-step and usage telemetry writers.
 *
 * Four run-step writers and six usage writers used to be ten near-identical methods that
 * differed only in these values and in one JSON key, so adding a stage meant adding a copy.
 * Call sites keep their original order: `chargeRunLlmUsage` must stay after the usage mirror
 * for the same stage, because it charges the run-scoped ledger.
 *
 * `diagnosticBrief` deliberately shares the `synthesis` run-step kind, so the run detail view
 * renders it alongside the ticketing synthesis steps; its capability name is what identifies
 * the monitoring stage.
 */
/**
 * Keys under which a stage's usage and cost are stored in `ai_runs.usage_json` / `cost_json`.
 * The cost views read these exact keys, so a misspelt one must not compile.
 */
export type RunUsageStageKey =
  | 'synthesis'
  | 'diagnostic_brief'
  | 'need_representation'
  | 'evidence_extraction'
  | 'knowledge_interpretation'
  | 'action_planner';

export const RUN_STEP_STAGES = {
  synthesis: { kind: 'synthesis', capabilityName: 'answer_synthesis' },
  diagnosticBrief: { kind: 'synthesis', capabilityName: 'diagnostic_brief_synthesis' },
  needRepresentation: { kind: 'need_representation', capabilityName: 'ticket_need_representation' },
  evidenceExtraction: { kind: 'evidence_extraction', capabilityName: 'ticket_image_evidence_extraction' },
} as const;

@Injectable()
export class AiAgentControlService {
  private readonly logger = new Logger(AiAgentControlService.name);
  private readonly targetingOptionsCache = new Map<string, { expiresAt: number; staleUntil: number; refreshing?: boolean; options: RefItem[]; total?: number }>();

  constructor(
    private readonly diagnostics: AiReadonlyDiagnosticWorkflowService,
    private readonly approvals: AiApprovalService,
    private readonly dispatcher: AiCapabilityDispatcherService,
    private readonly liveTargets: AiLiveTestTargetService,
    private readonly providers: AiProviderRegistryService,
    private readonly agentQueue?: AiAgentWorkQueueService,
    private readonly knowledgePlanner?: AiKnowledgeSearchPlannerService,
    private readonly replySynthesis?: AiReplySynthesisService,
    private readonly promptCompiler?: AiAgentPromptCompilerService,
    private readonly sharedContextProfiles?: AiSharedContextProfileService,
    private readonly actionPlanner?: AiAgentActionPlannerService,
    private readonly ticketNeedBuilder?: AiTicketNeedRepresentationService,
    private readonly ticketEvidenceExtractor?: AiTicketEvidenceExtractionService,
    private readonly capabilities?: AiCapabilityRegistry,
    private readonly builtinQuota?: AiAgentBuiltinQuotaService,
    private readonly tenantExecutor?: AiTenantExecutionService,
    private readonly diagnosticBriefSynthesis?: AiDiagnosticBriefSynthesisService,
    private readonly llmClient?: AiAgentLlmClient,
  ) {}

  private async actionPlannerProfileForProvider(
    context: AiExecutionContextWithManager,
    providerKind: string,
    providerKey: string,
  ): Promise<ProviderActionPlannerProfile | null> {
    const providerLookup = (this.providers as unknown as {
      provider?: (ctx: AiExecutionContextWithManager, kind: any, key: string) => Promise<{ actionPlannerProfile?: ProviderActionPlannerProfile }>;
    }).provider;
    if (typeof providerLookup !== 'function') {
      return null;
    }
    try {
      const provider = await providerLookup.call(this.providers, context, providerKind, providerKey);
      return provider?.actionPlannerProfile ?? null;
    } catch {
      return null;
    }
  }

  private agentPromptCompiler(): AiAgentPromptCompilerService {
    return this.promptCompiler ?? new AiAgentPromptCompilerService();
  }

  private async compileAgentPromptRuntime(
    context: AiExecutionContextWithManager,
    definition: AiAgentDefinition | null,
  ): Promise<{
    profile: CompiledAgentProfile;
    sharedContextResolution: SharedContextResolution;
    plannerGuidance: CompiledGuidance;
    interpreterGuidance: CompiledGuidance;
    synthesisGuidance: CompiledGuidance;
    actionPlannerGuidance: CompiledGuidance;
    promptProfileSummary: Record<string, unknown>;
  }> {
    const sharedContextResolution = this.sharedContextProfiles
      ? await this.sharedContextProfiles.resolveForAgent(context, definition)
      : { resolved: false, reason: 'not_configured' as const, requested_profile_id: null, context: null };
    const compiler = this.agentPromptCompiler();
    const profile = compiler.compile(definition?.persona_json ?? null, sharedContextResolution.context);
    const plannerGuidance = compiler.sliceFor(profile, 'planner');
    const interpreterGuidance = compiler.sliceFor(profile, 'interpreter');
    const synthesisGuidance = compiler.sliceFor(profile, 'synthesis');
    const actionPlannerGuidance = compiler.sliceFor(profile, 'action_planner');
    const promptProfileSummary = {
      prompt_profile_version: definition?.config_version ?? null,
      shared_context_profile_id: sharedContextResolution.context?.profile_id ?? sharedContextResolution.requested_profile_id,
      shared_context_version: sharedContextResolution.context?.version ?? null,
      shared_context_resolved: sharedContextResolution.resolved,
      shared_context_resolution_reason: sharedContextResolution.reason,
      guidance_hash: guidanceHash(synthesisGuidance),
      action_planner_guidance_hash: guidanceHash(actionPlannerGuidance),
      bounds_applied: synthesisGuidance.bounds_applied,
    };
    return {
      profile,
      sharedContextResolution,
      plannerGuidance,
      interpreterGuidance,
      synthesisGuidance,
      actionPlannerGuidance,
      promptProfileSummary,
    };
  }

  private async recordAgentAuditEvent(
    context: AiExecutionContextWithManager,
    input: {
      agentDefinitionId?: string | null;
      eventType: string;
      severity?: string | null;
      message: string;
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    if (this.agentQueue) {
      await this.agentQueue.recordAuditEvent(context, input);
      return;
    }
    const repo = context.manager.getRepository(AiAgentAuditEvent);
    const links = await resolveAuditEventLinks(context.manager, context.tenantId, input);
    await repo.save(repo.create({
      tenant_id: context.tenantId,
      agent_definition_id: links.agentDefinitionId,
      work_item_id: null,
      event_type: input.eventType,
      severity: input.severity ?? 'info',
      message: input.message,
      metadata_json: withOrphanedAuditLinks(input.metadata, links.orphaned),
      created_at: new Date(),
    }));
  }

  private async evidenceIdsForTool(context: AiExecutionContextWithManager, toolExecutionId: string): Promise<string[]> {
    const rows = await context.manager.getRepository(AiEvidence).find({
      where: {
        tenant_id: context.tenantId,
        tool_execution_id: toolExecutionId,
      },
    });
    return rows.map((row) => row.id);
  }

  private async ticketTargetingEligibility(
    context: AiExecutionContextWithManager,
    definition: AiAgentDefinition,
    ticket: TicketRecord,
    providerKey: string,
  ): Promise<{ matched: boolean; hasInactivityAge: boolean }> {
    let targeting = normalizeServiceDeskTargeting(definition.scope_policy_json);
    const needsSubtrees = targeting.predicates.some((predicate) =>
      predicate.field === 'category' || predicate.field === 'entity');
    if (needsSubtrees) {
      const provider = await this.providers.ticketing(context, providerKey);
      targeting = await expandServiceDeskTargetingSubtrees(targeting, createProviderSubtreeResolver(provider, context));
    }
    const hasInactivityAge = targeting.predicates.some((predicate) =>
      predicate.field === 'inactivity_age' && predicate.operator === 'gte',
    );
    const needsAgentTouched = targeting.predicates.some((predicate) => predicate.field === 'touched_by');
    let agentTouched = false;
    if (needsAgentTouched) {
      const state = await context.manager.getRepository(AiAgentTargetState).findOne({
        where: {
          tenant_id: context.tenantId,
          agent_definition_id: definition.id,
          provider_kind: 'ticketing',
          provider_key: providerKey,
          target_type: 'ticket',
          target_ref: ticket.id,
        },
      });
      agentTouched = state?.agent_touched === true;
    }
    return {
      matched: ticketMatchesServiceDeskTargeting(ticket, targeting, { agentTouched }),
      hasInactivityAge,
    };
  }

  private async recordStageRunStep(
    context: AiExecutionContextWithManager,
    stage: { kind: string; capabilityName: string; capabilityVersion?: string },
    input: {
      runId: string;
      stepIndex: number;
      status: 'completed' | 'skipped' | 'failed';
      inputSummary: Record<string, unknown>;
      outputSummary: Record<string, unknown>;
      errorMessage?: string | null;
    },
  ): Promise<void> {
    const now = new Date();
    await context.manager.getRepository(AiRunStep).save(context.manager.getRepository(AiRunStep).create({
      tenant_id: context.tenantId,
      run_id: input.runId,
      step_index: input.stepIndex,
      kind: stage.kind,
      status: input.status,
      capability_name: stage.capabilityName,
      capability_version: stage.capabilityVersion ?? '1.0.0',
      input_summary: input.inputSummary,
      output_summary: input.outputSummary,
      error_message: input.errorMessage ?? null,
      started_at: now,
      completed_at: now,
      created_at: now,
    }));
  }

  /**
   * Per-stage usage mirror, written under run.usage_json[stageKey] and run.cost_json[stageKey].
   * The caller charges the run-scoped ledger separately (chargeRunLlmUsage), after this call.
   */
  private async recordStageUsage(
    context: AiExecutionContextWithManager,
    stageKey: RunUsageStageKey,
    runId: string,
    result: {
      usage?: { input_tokens?: number | null; output_tokens?: number | null } | null;
      estimated_tokens?: number | null;
      estimated_cost_eur?: number | null;
      model?: string | null;
    } | null | undefined,
  ): Promise<void> {
    const repo = context.manager.getRepository(AiRun);
    const run = await repo.findOne({
      where: {
        id: runId,
        tenant_id: context.tenantId,
      },
    });
    if (!run) return;
    run.usage_json = {
      ...(isRecord(run.usage_json) ? run.usage_json : {}),
      [stageKey]: {
        input_tokens: result?.usage?.input_tokens ?? null,
        output_tokens: result?.usage?.output_tokens ?? null,
        estimated_tokens: result?.estimated_tokens,
      },
    };
    run.cost_json = {
      ...(isRecord(run.cost_json) ? run.cost_json : {}),
      [stageKey]: {
        estimated_cost_eur: result?.estimated_cost_eur,
        model: result?.model ?? null,
      },
    };
    run.updated_at = new Date();
    await repo.save(run);
  }

  private async recordAndEnforceHelpdeskRunCap(
    context: AiExecutionContextWithManager,
    input: {
      definition: AiAgentDefinition | null;
      runId: string;
      stage: string;
      usage: RunLlmUsageEstimate;
    },
  ): Promise<RunLlmUsageEstimate> {
    const usage = {
      estimatedTokens: Math.max(0, Math.round(Number(input.usage.estimatedTokens) || 0)),
      estimatedCostEur: Number(Math.max(0, Number(input.usage.estimatedCostEur) || 0).toFixed(6)),
    };
    if (!this.agentQueue || !input.definition) {
      return usage;
    }
    const guardrails = this.agentQueue.runGuardrails(input.definition);
    const repo = context.manager.getRepository(AiRun);
    const run = await repo.findOne({
      where: {
        id: input.runId,
        tenant_id: context.tenantId,
      },
    });
    if (run) {
      run.usage_json = {
        ...(isRecord(run.usage_json) ? run.usage_json : {}),
        estimated_tokens: usage.estimatedTokens,
        estimation_stage: input.stage,
      };
      run.cost_json = {
        ...(isRecord(run.cost_json) ? run.cost_json : {}),
        estimated_cost_eur: usage.estimatedCostEur,
      };
      run.metadata_json = {
        ...(isRecord(run.metadata_json) ? run.metadata_json : {}),
        agent_definition_id: input.definition.id,
        agent_key: input.definition.agent_key,
      };
      run.updated_at = new Date();
    }
    if (
      usage.estimatedTokens > guardrails.maxEstimatedTokens
      || usage.estimatedCostEur > guardrails.maxEstimatedCostEur
    ) {
      if (run) {
        run.status = 'failed';
        run.output_summary = {
          error: 'Agent run exceeded the configured per-run economic cap.',
          reason: 'per_run_guardrail_exceeded',
          estimated_tokens: usage.estimatedTokens,
          estimated_cost_eur: usage.estimatedCostEur,
          cap: guardrails,
          stage: input.stage,
        };
        run.completed_at = new Date();
        await repo.save(run);
      }
      await this.agentQueue.recordAuditEvent(context, {
        agentDefinitionId: input.definition.id,
        eventType: 'per_run_cap_exceeded',
        severity: 'warning',
        message: 'Agent run failed because the per-run economic cap was exceeded.',
        metadata: {
          run_id: input.runId,
          stage: input.stage,
          usage,
          cap: guardrails,
        },
      });
      throw new ForbiddenException('Agent run exceeded the configured per-run economic cap.');
    }
    if (run) {
      await repo.save(run);
    }
    return usage;
  }

  private async unchangedProposalSuppressionReason(
    context: AiExecutionContextWithManager,
    input: {
      capabilityName: string;
      providerKind: string;
      providerKey: string;
      targetType: string;
      targetRef: string;
      proposalHash: string;
      contextHash: string;
    },
  ): Promise<string | null> {
    const actions = await context.manager.getRepository(AiActionRequest).find({
      where: {
        tenant_id: context.tenantId,
        provider_kind: input.providerKind,
        provider_key: input.providerKey,
        target_type: input.targetType,
        target_ref: input.targetRef,
        capability_name: input.capabilityName,
      },
      order: { created_at: 'DESC' },
    });
    const now = Date.now();
    const matching = actions.find((action) =>
      proposalStillBlocksRegeneration(action, now)
      && actionMetadataString(action, 'proposal_hash') === input.proposalHash
      && actionMetadataString(action, 'proposal_context_hash') === input.contextHash,
    );
    if (!matching) {
      return null;
    }
    return `unchanged_${matching.status}_proposal:${matching.id}`;
  }

  // Replace-on-write: expire this agent's earlier *pending* proposal of the same
  // capability on this ticket before preparing a new one. Suppression above is
  // intentionally NOT agent-scoped (foreign stacking is the claim/supersede
  // layer). This expiry IS agent-scoped. Approved-but-unexecuted rows are left
  // alone — silently withdrawing an operator approval is worse than a rare stack
  // on manual re-run.
  private async expirePriorPendingSameClass(
    context: AiExecutionContextWithManager,
    input: {
      providerKind: string;
      providerKey: string;
      targetType: string;
      targetRef: string;
      capabilityName: string;
      agentDefinitionId: string | null;
      // Narrows the sweep inside one capability. Assignment proposals carry a kind
      // (group / technician): a new group proposal must not expire a pending technician
      // proposal that is still perfectly valid, and vice versa.
      matchPayload?: (payload: unknown) => boolean;
      // The freshly prepared replacement must survive its own supersede sweep: callers expire
      // AFTER a successful prepare (so a failed prepare never destroys the prior proposal),
      // which means the new pending row already exists when this runs.
      excludeActionIds?: string[];
      excludeRunId?: string | null;
    },
  ): Promise<number> {
    const candidates = await context.manager.getRepository(AiActionRequest).find({
      where: {
        tenant_id: context.tenantId,
        provider_kind: input.providerKind,
        provider_key: input.providerKey,
        target_type: input.targetType,
        target_ref: input.targetRef,
        capability_name: input.capabilityName,
        status: 'pending',
      },
    });
    const excludeIds = new Set(input.excludeActionIds ?? []);
    const now = new Date();
    let expired = 0;
    for (const action of candidates) {
      if (excludeIds.has(action.id) || (input.excludeRunId && action.run_id === input.excludeRunId)) {
        continue;
      }
      if (input.agentDefinitionId
        && actionMetadataString(action, 'agent_definition_id') !== input.agentDefinitionId) {
        continue;
      }
      if (input.matchPayload && !input.matchPayload(action.action_payload_json)) {
        continue;
      }
      const metadata = isRecord(action.metadata_json) ? action.metadata_json : {};
      action.status = 'expired';
      action.updated_at = now;
      action.metadata_json = {
        ...metadata,
        withdrawn_reason: 'superseded_by_new_proposal',
        withdrawn_at: now.toISOString(),
      };
      await context.manager.getRepository(AiActionRequest).save(action);
      expired += 1;
    }
    return expired;
  }

  // Safety: planner proposals must not survive a newer plan/profile or a ticket that is no longer
  // eligible for the planned close. Scoped to this agent's proposals for this ticket; returns the
  // number withdrawn.
  private async withdrawSupersededPlannerProposals(
    context: AiExecutionContextWithManager,
    input: {
      providerKind: string;
      providerKey: string;
      targetType: string;
      targetRef: string;
      agentDefinitionId: string | null;
      currentPlannerActionKeys?: Set<string> | null;
      currentGuidanceHash?: string | null;
      closeNoLongerEligible?: boolean;
    },
  ): Promise<number> {
    const candidates = await context.manager.getRepository(AiActionRequest).find({
      where: {
        tenant_id: context.tenantId,
        provider_kind: input.providerKind,
        provider_key: input.providerKey,
        target_type: input.targetType,
        target_ref: input.targetRef,
        status: 'pending',
        capability_name: In([
          TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY,
          TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY,
          TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY,
        ]),
      },
    });
    const now = new Date();
    let withdrawn = 0;
    for (const action of candidates) {
      const metadata = isRecord(action.metadata_json) ? action.metadata_json : {};
      const triageAction = actionMetadataString(action, 'triage_action');
      const plannerAction = metadata.source === 'action_planner' || metadata.planner_action === true;
      const legacyCloseAction = !!triageAction && CLOSE_TRIAGE_ACTIONS.has(triageAction);
      if (!plannerAction && !legacyCloseAction) {
        continue;
      }
      if (input.agentDefinitionId
        && actionMetadataString(action, 'agent_definition_id') !== input.agentDefinitionId) {
        continue;
      }
      const plannerKey = actionMetadataString(action, 'planner_action_key');
      const guidanceHashValue = actionMetadataString(action, 'action_planner_guidance_hash');
      let withdrawnReason: string | null = null;
      if (input.closeNoLongerEligible && (
        legacyCloseAction
        || triageAction === 'planner_prepare_administrative_close_reply'
        || triageAction === 'planner_prepare_terminal_status'
      )) {
        withdrawnReason = 'no_longer_eligible';
      } else if (
        input.currentGuidanceHash
        && guidanceHashValue
        && guidanceHashValue !== input.currentGuidanceHash
      ) {
        withdrawnReason = 'superseded_by_new_guidance';
      } else if (
        input.currentPlannerActionKeys
        && plannerKey
        && !input.currentPlannerActionKeys.has(plannerKey)
      ) {
        withdrawnReason = 'superseded_by_new_plan';
      }
      if (!withdrawnReason) {
        continue;
      }
      action.status = 'expired';
      action.updated_at = now;
      action.metadata_json = {
        ...metadata,
        withdrawn_reason: withdrawnReason,
        withdrawn_at: now.toISOString(),
      };
      await context.manager.getRepository(AiActionRequest).save(action);
      withdrawn += 1;
    }
    return withdrawn;
  }

  private async recoverPreparedTicketingActionIds(
    context: AiExecutionContextWithManager,
    input: { runId: string; targetRef: string },
  ): Promise<string[]> {
    const actions = await context.manager.getRepository(AiActionRequest).find({
      where: {
        tenant_id: context.tenantId,
        run_id: input.runId,
        target_type: 'ticket',
        target_ref: input.targetRef,
        capability_name: In(HELPDESK_REVIEW_ACTION_CAPABILITIES),
      },
    });
    return actions.map((action) => action.id);
  }

  private async ensureProposalEvaluations(
    context: AiExecutionContextWithManager,
    input: {
      runId: string;
      recommendationId: string;
      decisionId: string;
      actions: AiActionRequest[];
      agentMetadata: Record<string, unknown>;
      evaluationType?: string;
    },
  ): Promise<AiActionRequest[]> {
    const actionRepo = context.manager.getRepository(AiActionRequest);
    const evaluationRepo = context.manager.getRepository(AiEvaluation);
    const updated: AiActionRequest[] = [];
    for (const action of input.actions) {
      const metadata = isRecord(action.metadata_json) ? action.metadata_json : {};
      const existingEvaluationId = typeof metadata.evaluation_id === 'string' ? metadata.evaluation_id : null;
      const existingEvaluation = existingEvaluationId
        ? await evaluationRepo.findOne({ where: { id: existingEvaluationId, tenant_id: context.tenantId } })
        : null;
      const evaluation = existingEvaluation && isRecord(existingEvaluation.metadata_json) && existingEvaluation.metadata_json.action_request_id === action.id
        ? existingEvaluation
        : await evaluationRepo.save(evaluationRepo.create({
          tenant_id: context.tenantId,
          run_id: input.runId,
          recommendation_id: input.recommendationId,
          decision_id: input.decisionId,
          status: ['executed', 'rejected', 'expired', 'dismissed', 'failed'].includes(action.status) ? 'completed' : 'pending',
          outcome: action.status === 'executed'
            ? 'provider_action_executed'
            : action.status === 'rejected'
              ? 'provider_action_rejected'
              : action.status === 'expired'
                ? 'provider_action_expired_unreviewed'
                : action.status === 'dismissed'
                  ? 'provider_action_dismissed'
                  : action.status === 'failed'
                    ? 'provider_action_failed'
                    : null,
          scores_json: null,
          feedback_json: null,
          metadata_json: {
            ...input.agentMetadata,
            evaluation_type: input.evaluationType ?? TICKETING_TRIAGE_RUN_OPTIONS.proposalEvaluationType,
            action_request_id: action.id,
            action_class: action.capability_name,
            target_ref: action.target_ref ?? null,
          },
          created_at: new Date(),
          updated_at: new Date(),
        }));
      action.metadata_json = {
        ...metadata,
        evaluation_id: evaluation.id,
        proposal_evaluation_id: evaluation.id,
      };
      action.updated_at = new Date();
      updated.push(await actionRepo.save(action));
    }
    return updated;
  }

  private async providerExecutionReadinessForActions(
    context: AiExecutionContextWithManager,
    actions: AiActionRequest[],
  ): Promise<Map<string, ProviderActionExecutionReadiness>> {
    const result = new Map<string, ProviderActionExecutionReadiness>();
    const providerLookup = (this.providers as unknown as {
      provider?: (ctx: AiExecutionContextWithManager, kind: any, key: string) => Promise<{
        executionReadinessForActions?: (
          ctx: AiExecutionContextWithManager,
          input: { actions: any[] },
        ) => Promise<ProviderActionExecutionReadiness[]>;
      }>;
    }).provider;
    if (typeof providerLookup !== 'function') {
      return result;
    }
    const groups = new Map<string, AiActionRequest[]>();
    for (const action of actions) {
      const providerKind = trimmedString(action.provider_kind);
      const providerKey = trimmedString(action.provider_key);
      if (!providerKind || !providerKey) {
        continue;
      }
      const key = `${providerKind}:${providerKey}`;
      groups.set(key, [...(groups.get(key) ?? []), action]);
    }
    for (const group of groups.values()) {
      const first = group[0];
      const providerKind = trimmedString(first.provider_kind);
      const providerKey = trimmedString(first.provider_key);
      if (!providerKind || !providerKey) {
        continue;
      }
      try {
        const provider = await providerLookup.call(this.providers, context, providerKind, providerKey);
        if (typeof provider.executionReadinessForActions !== 'function') {
          continue;
        }
        const readiness = await provider.executionReadinessForActions(context, {
          actions: group.map((action) => ({
            id: action.id,
            tenant_id: action.tenant_id,
            provider_kind: action.provider_kind,
            provider_key: action.provider_key,
            target_type: action.target_type,
            target_id: action.target_id,
            target_ref: action.target_ref,
            capability_name: action.capability_name,
            capability_version: action.capability_version,
            status: action.status,
            action_payload_json: action.action_payload_json,
            metadata_json: action.metadata_json,
          })),
        });
        for (const item of readiness) {
          result.set(item.action_request_id, item);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || 'Provider readiness check failed.');
        for (const action of group) {
          result.set(action.id, {
            action_request_id: action.id,
            blocked_reason: `Provider readiness check failed: ${message}`,
          });
        }
      }
    }
    return result;
  }

  private async assertActionSafeForUiExecution(
    context: AiExecutionContextWithManager,
    action: AiActionRequest,
  ): Promise<void> {
    if (action.tenant_id !== context.tenantId) {
      throw new ForbiddenException('Action request does not belong to this tenant.');
    }
    if (!['pending', 'approved', APPROVED_ACTION_EXECUTING_STATUS, 'executed'].includes(action.status)) {
      throw new ForbiddenException(`Action is ${action.status}.`);
    }
    if (action.expires_at && action.expires_at <= new Date()) {
      throw new ForbiddenException('Action request is expired.');
    }
    if ((action.provider_kind && !action.provider_key) || (!action.provider_kind && action.provider_key)) {
      throw new ForbiddenException('Action request provider identity is incomplete.');
    }
    const providerReadiness = await this.providerExecutionReadinessForActions(context, [action]);
    const blockedReason = providerReadiness.get(action.id)?.blocked_reason ?? null;
    if (blockedReason) {
      throw new ForbiddenException(blockedReason);
    }
  }

  private async executionReadinessForActions(
    context: AiExecutionContextWithManager,
    actions: AiActionRequest[],
  ): Promise<Map<string, ActionExecutionReadiness>> {
    const now = Date.now();
    const providerReadiness = await this.providerExecutionReadinessForActions(context, actions);
    const result = new Map<string, ActionExecutionReadiness>();
    for (const action of actions) {
      const expiresAt = action.expires_at instanceof Date
        ? action.expires_at.getTime()
        : Date.parse(String(action.expires_at ?? ''));
      const expired = Number.isFinite(expiresAt) && expiresAt <= now;
      const activeDecisionStatus = action.status === 'pending' || action.status === 'approved';
      const providerBlockedReason = providerReadiness.get(action.id)?.blocked_reason ?? null;
      let blockedReason: string | null = null;
      if (action.tenant_id !== context.tenantId) {
        blockedReason = 'Action request does not belong to this tenant.';
      } else if (!activeDecisionStatus) {
        blockedReason = `Action is ${action.status}.`;
      } else if (expired) {
        blockedReason = 'Action request is expired.';
      } else if ((action.provider_kind && !action.provider_key) || (!action.provider_kind && action.provider_key)) {
        blockedReason = 'Action request provider identity is incomplete.';
      } else if (providerBlockedReason) {
        blockedReason = providerBlockedReason;
      }
      const providerSpecific = providerReadiness.get(action.id);

      result.set(action.id, {
        can_execute: blockedReason === null,
        can_reject: activeDecisionStatus && !expired,
        blocked_reason: blockedReason,
        requires_sandbox_write_target: providerSpecific?.requires_sandbox_write_target ?? false,
        sandbox_write_target_ref: providerSpecific?.sandbox_write_target_ref ?? null,
      });
    }
    return result;
  }

  async listRuns(context: AiExecutionContextWithManager, options: AgentControlListRunsOptions = {}) {
    const limit = safeLimit(options.limit, 25, 100);
    const where: FindOptionsWhere<AiRun> = { tenant_id: context.tenantId };
    if (options.status && options.status !== 'all') {
      where.status = options.status;
    }

    const runRepo = context.manager.getRepository(AiRun);
    const toolRepo = context.manager.getRepository(AiToolExecution);
    const evidenceRepo = context.manager.getRepository(AiEvidence);
    const actionRepo = context.manager.getRepository(AiActionRequest);
    const runs = await runRepo.find({
      where,
      order: { created_at: 'DESC' },
      take: limit,
    });

    const items = await Promise.all(runs.map(async (run) => {
      const [
        runToolExecutions,
        runEvidence,
        directActionRequests,
      ] = await Promise.all([
        toolRepo.find({ where: { tenant_id: context.tenantId, run_id: run.id } }),
        evidenceRepo.find({ where: { tenant_id: context.tenantId, run_id: run.id } }),
        actionRepo.find({ where: { tenant_id: context.tenantId, run_id: run.id } }),
      ]);
      const linkedActionIds = Array.from(new Set([
        ...directActionRequests.map((action) => action.id),
        ...runToolExecutions
          .map((tool) => tool.action_request_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
        ...runEvidence
          .map((row) => row.action_request_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ]));
      const linkedActions = linkedActionIds.length > directActionRequests.length
        ? await actionRepo.find({
          where: {
            tenant_id: context.tenantId,
            id: In(linkedActionIds),
          },
        })
        : directActionRequests;
      const pendingActionCount = linkedActions.filter((action) => actionIsActivePending(action)).length;
      return {
        ...serializeRun(run),
        counts: {
          tool_executions: runToolExecutions.length,
          evidence: runEvidence.length,
          action_requests: linkedActionIds.length,
          pending_actions: pendingActionCount,
        },
      };
    }));

    return { items };
  }

  async getRunDetail(context: AiExecutionContextWithManager, runId: string) {
    const runRepo = context.manager.getRepository(AiRun);
    const run = await runRepo.findOne({
      where: { id: runId, tenant_id: context.tenantId },
    });
    if (!run) {
      throw new NotFoundException('AI run not found.');
    }

    const [
      runSteps,
      toolExecutions,
      evidence,
      observations,
      recommendations,
      decisions,
      evaluations,
      actionRequests,
    ] = await Promise.all([
      context.manager.getRepository(AiRunStep).find({
        where: { tenant_id: context.tenantId, run_id: run.id },
        order: { step_index: 'ASC', created_at: 'ASC' },
      }),
      context.manager.getRepository(AiToolExecution).find({
        where: { tenant_id: context.tenantId, run_id: run.id },
        order: { created_at: 'ASC' },
      }),
      context.manager.getRepository(AiEvidence).find({
        where: { tenant_id: context.tenantId, run_id: run.id },
        order: { created_at: 'ASC' },
      }),
      context.manager.getRepository(AiObservation).find({
        where: { tenant_id: context.tenantId, run_id: run.id },
        order: { created_at: 'ASC' },
      }),
      context.manager.getRepository(AiRecommendation).find({
        where: { tenant_id: context.tenantId, run_id: run.id },
        order: { created_at: 'ASC' },
      }),
      context.manager.getRepository(AiDecision).find({
        where: { tenant_id: context.tenantId, run_id: run.id },
        order: { created_at: 'ASC' },
      }),
      context.manager.getRepository(AiEvaluation).find({
        where: { tenant_id: context.tenantId, run_id: run.id },
        order: { created_at: 'ASC' },
      }),
      context.manager.getRepository(AiActionRequest).find({
        where: { tenant_id: context.tenantId, run_id: run.id },
        order: { updated_at: 'ASC', created_at: 'ASC' },
      }),
    ]);

    const linkedActionIds = Array.from(new Set([
      ...actionRequests.map((action) => action.id),
      ...toolExecutions
        .map((tool) => tool.action_request_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ...evidence
        .map((row) => row.action_request_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ]));
    const linkedActions = linkedActionIds.length > actionRequests.length
      ? await context.manager.getRepository(AiActionRequest).find({
        where: {
          tenant_id: context.tenantId,
          id: In(linkedActionIds),
        },
      })
      : [];
    const mergedActionRequests = Array.from(new Map([
      ...actionRequests,
      ...linkedActions,
    ].map((action) => [action.id, action])).values())
      .sort((left, right) => actionSortTime(left) - actionSortTime(right));

    const actionIds = mergedActionRequests.map((action) => action.id);
    const approvals = actionIds.length > 0
      ? await context.manager.getRepository(AiApproval).find({
        where: {
          tenant_id: context.tenantId,
          action_request_id: In(actionIds),
        },
        order: { created_at: 'DESC' },
      })
      : [];

    const readiness = await this.executionReadinessForActions(context, mergedActionRequests);
    const agentLinks = await this.agentLinksForActions(context, mergedActionRequests);
    return {
      run: serializeRun(run),
      run_steps: runSteps.map(serializeRunStep),
      tool_executions: toolExecutions.map(serializeToolExecution),
      evidence: evidence.map(serializeEvidence),
      observations: observations.map(serializeObservation),
      recommendations: recommendations.map(serializeRecommendation),
      decisions: decisions.map(serializeDecision),
      evaluations: evaluations.map(serializeEvaluation),
      action_requests: mergedActionRequests.map((action) => serializeActionRequest(action, readiness.get(action.id), agentLinks.get(action.id))),
      approvals: approvals.map(serializeApproval),
    };
  }

  /** Whether each action's metadata-linked agent still exists in the tenant (one lookup per batch). */
  private async agentLinksForActions(
    context: AiExecutionContextWithManager,
    actions: AiActionRequest[],
  ): Promise<Map<string, ActionAgentLink>> {
    const ids = Array.from(new Set(
      actions.map((action) => definitionIdFromMetadata(action.metadata_json)).filter((id): id is string => !!id),
    ));
    const live = new Set<string>();
    if (ids.length > 0) {
      const definitions = await context.manager.getRepository(AiAgentDefinition).find({
        where: { tenant_id: context.tenantId, id: In(ids) },
      });
      definitions.forEach((definition) => live.add(definition.id));
    }
    return new Map(actions.map((action) => {
      const agentDefinitionId = definitionIdFromMetadata(action.metadata_json);
      return [action.id, {
        agent_definition_id: agentDefinitionId,
        agent_exists: agentDefinitionId ? live.has(agentDefinitionId) : null,
      }];
    }));
  }

  async listActionRequests(context: AiExecutionContextWithManager, options: AgentControlListActionsOptions = {}) {
    const limit = safeLimit(options.limit, 50, 100);
    const where: FindOptionsWhere<AiActionRequest> = { tenant_id: context.tenantId };
    if (options.status && options.status !== 'all') {
      where.status = options.status;
    }
    const items = await context.manager.getRepository(AiActionRequest).find({
      where,
      order: { created_at: 'DESC' },
      take: options.status === 'pending' ? Math.max(limit * 4, 100) : limit,
    });
    const visibleItems = options.status === 'pending'
      ? items.filter((action) => actionIsActivePending(action)).slice(0, limit)
      : items;
    const readiness = await this.executionReadinessForActions(context, visibleItems);
    const agentLinks = await this.agentLinksForActions(context, visibleItems);
    return { items: visibleItems.map((action) => serializeActionRequest(action, readiness.get(action.id), agentLinks.get(action.id))) };
  }

  private async uniqueAgentKey(
    context: AiExecutionContextWithManager,
    requestedKey: string | null,
    name: string,
  ): Promise<string> {
    const repo = context.manager.getRepository(AiAgentDefinition);
    const base = requestedKey ? cleanAgentKey(requestedKey) : slugAgentKey(name);
    let candidate = base;
    let suffix = 2;
    while (await repo.findOne({ where: { tenant_id: context.tenantId, agent_key: candidate } })) {
      candidate = `${base}.${suffix++}`;
      if (candidate.length > 120) {
        candidate = `${base.slice(0, 110)}.${suffix}`;
      }
    }
    return candidate;
  }

  private async uniqueEnabledMonitoringProviderKey(
    context: AiExecutionContextWithManager,
  ): Promise<string | null> {
    const configs = await context.manager.getRepository(AiAdapterConfig).find({
      where: {
        tenant_id: context.tenantId,
        provider_kind: 'monitoring',
        enabled: true,
      },
    });
    const providerKeys = Array.from(new Set(configs
      .map((config) => typeof config.provider_key === 'string' ? config.provider_key.trim() : '')
      .filter(Boolean)));
    return providerKeys.length === 1 ? providerKeys[0] : null;
  }

  async listAgentDefinitions(context: AiExecutionContextWithManager) {
    const items = await context.manager.getRepository(AiAgentDefinition).find({
      where: { tenant_id: context.tenantId },
      order: { agent_key: 'ASC' },
    });
    return { items: items.map(serializeAgentDefinition) };
  }

  async getAgentDefinition(context: AiExecutionContextWithManager, id: string) {
    const definition = await context.manager.getRepository(AiAgentDefinition).findOne({
      where: { id, tenant_id: context.tenantId },
    });
    if (!definition) {
      throw new NotFoundException('Agent definition not found.');
    }
    return { agent_definition: serializeAgentDefinition(definition) };
  }

  async listSharedContextProfiles(context: AiExecutionContextWithManager) {
    if (!this.sharedContextProfiles) {
      throw new ForbiddenException('Shared context profiles are not available.');
    }
    return this.sharedContextProfiles.list(context);
  }

  async createSharedContextProfile(context: AiExecutionContextWithManager, input: SharedContextProfileInput = {}) {
    if (!this.sharedContextProfiles) {
      throw new ForbiddenException('Shared context profiles are not available.');
    }
    return this.sharedContextProfiles.create(context, input);
  }

  async updateSharedContextProfile(context: AiExecutionContextWithManager, id: string, input: SharedContextProfileInput = {}) {
    if (!this.sharedContextProfiles) {
      throw new ForbiddenException('Shared context profiles are not available.');
    }
    return this.sharedContextProfiles.update(context, id, input);
  }

  async archiveSharedContextProfile(context: AiExecutionContextWithManager, id: string) {
    if (!this.sharedContextProfiles) {
      throw new ForbiddenException('Shared context profiles are not available.');
    }
    return this.sharedContextProfiles.archive(context, id);
  }

  async getAgentEffectivePrompt(context: AiExecutionContextWithManager, id: string) {
    const definition = await context.manager.getRepository(AiAgentDefinition).findOne({
      where: { id, tenant_id: context.tenantId },
    });
    if (!definition) {
      throw new NotFoundException('Agent definition not found.');
    }
    const runtime = await this.compileAgentPromptRuntime(context, definition);
    const compiler = this.agentPromptCompiler();
    const taskPreview = (floor: string[], guidance: CompiledGuidance) => ({
      system_prompt: compileSystemPrompt(floor, guidance),
      guidance_json: compiler.guidancePayload(guidance),
      bounds_applied: guidance.bounds_applied,
    });
    // SRE agents run a single LLM stage (monitoring_diagnosis); the helpdesk task
    // prompts never execute for them and must not appear in the settings preview.
    if (definition.agent_type === 'sre') {
      const diagnosisGuidance = compiler.sliceFor(runtime.profile, 'monitoring_diagnosis');
      const monitoringDiagnosis = taskPreview(RUNTIME_SAFETY_FLOOR_MONITORING_DIAGNOSIS, diagnosisGuidance);
      return {
        agent_definition_id: definition.id,
        prompt_profile: runtime.promptProfileSummary,
        shared_context_resolved: runtime.sharedContextResolution.resolved,
        shared_context_resolution_reason: runtime.sharedContextResolution.reason,
        bounds_applied: uniqueBoundsApplied([monitoringDiagnosis.bounds_applied]),
        tasks: {
          monitoring_diagnosis: monitoringDiagnosis,
        },
      };
    }
    const actionPlanner = taskPreview(RUNTIME_SAFETY_FLOOR_ACTION_PLANNER, runtime.actionPlannerGuidance);
    const planner = taskPreview(RUNTIME_SAFETY_FLOOR_PLANNER, runtime.plannerGuidance);
    const interpreter = taskPreview(RUNTIME_SAFETY_FLOOR_INTERPRETER, runtime.interpreterGuidance);
    const synthesis = taskPreview(RUNTIME_SAFETY_FLOOR_SYNTHESIS, runtime.synthesisGuidance);
    return {
      agent_definition_id: definition.id,
      prompt_profile: runtime.promptProfileSummary,
      shared_context_resolved: runtime.sharedContextResolution.resolved,
      shared_context_resolution_reason: runtime.sharedContextResolution.reason,
      bounds_applied: uniqueBoundsApplied([
        actionPlanner.bounds_applied,
        planner.bounds_applied,
        interpreter.bounds_applied,
        synthesis.bounds_applied,
      ]),
      tasks: {
        action_planner: actionPlanner,
        planner,
        interpreter,
        synthesis,
      },
    };
  }

  async previewAgentTargeting(
    context: AiExecutionContextWithManager,
    id: string,
    input: AgentControlTargetingPreviewInput = {},
  ): Promise<{ preview: TargetingPreviewSummary }> {
    if (!this.agentQueue) {
      throw new ForbiddenException('Agent work queue is not available.');
    }
    const definition = await context.manager.getRepository(AiAgentDefinition).findOne({
      where: { id, tenant_id: context.tenantId },
    });
    if (!definition) {
      throw new NotFoundException('Agent definition not found.');
    }
    const scopePolicy = Object.prototype.hasOwnProperty.call(input, 'scope_policy_json')
      ? normalizeServiceDeskScopePolicy(input.scope_policy_json)
      : normalizeServiceDeskScopePolicy(definition.scope_policy_json);
    const previewDefinition = {
      ...definition,
      scope_policy_json: scopePolicy,
    } as AiAgentDefinition;
    const targeting = normalizeServiceDeskTargeting(scopePolicy);
    const config = this.agentQueue.resolveScopeIngestionConfig(previewDefinition);
    const maxResults = Math.max(1, Math.min(config.maxTicketsPerCycle, config.maxProviderRequestsPerCycle, 20));
    const ticketingBinding = requireTicketingBinding(definition);
    const provider = await this.providers.ticketing(context, ticketingBinding.providerKey);
    const subtreeResolver = createProviderSubtreeResolver(provider, context);
    const scopeEntityIds = config.entityId ? await subtreeResolver('entity', [config.entityId]) : null;
    const scopeCategoryIds = config.categoryId ? await subtreeResolver('category', [config.categoryId]) : null;
    const expandedTargeting = await expandServiceDeskTargetingSubtrees(targeting, subtreeResolver);
    const tickets: TicketRecord[] = [];
    if (config.mode === 'agent_involved') {
      const refs = await this.agentQueue.listAgentTouchedTicketRefs(context, previewDefinition, maxResults);
      for (const ref of refs.slice(0, maxResults)) {
        const fetched = await provider.getTicket(context, { ticketId: ref });
        if (fetched.ok !== false) {
          tickets.push(fetched.data);
        }
      }
    } else {
      const scope = config.mode === 'all_open'
        ? {
          mode: 'all_open' as const,
          maxResults,
          statusValues: config.statusValues,
          entityId: config.entityId ?? null,
          categoryId: config.categoryId ?? null,
          entityIds: scopeEntityIds,
          categoryIds: scopeCategoryIds,
          lastChangedBefore: config.lastChangedBefore ?? null,
        }
        : {
          mode: 'new_tickets_only' as const,
          createdAfter: config.createdAfter ?? '',
          maxResults,
          statusValues: config.statusValues,
          entityId: config.entityId ?? null,
          categoryId: config.categoryId ?? null,
          entityIds: scopeEntityIds,
          categoryIds: scopeCategoryIds,
        };
      const listed = await provider.listTicketsForScope(context, { scope });
      if (listed.ok === false) {
        throw new BadRequestException(listed.message);
      }
      const rows = isRecord(listed.data) && Array.isArray(listed.data.tickets) ? listed.data.tickets : [];
      tickets.push(...rows.slice(0, maxResults));
    }
    const matches = tickets.filter((ticket) => ticketMatchesServiceDeskTargeting(ticket, expandedTargeting, {
      agentTouched: config.mode === 'agent_involved',
    }));
    const matchRefs = Array.from(new Set(matches.map((ticket) => ticket.id).filter(Boolean)));
    const overlapStates = matchRefs.length > 0
      ? await context.manager.getRepository(AiAgentTargetState).find({
        where: {
          tenant_id: context.tenantId,
          provider_kind: ticketingBinding.providerKind,
          provider_key: ticketingBinding.providerKey,
          target_type: 'ticket',
          target_ref: In(matchRefs),
        },
      })
      : [];
    const overlapRefs = new Set(overlapStates
      .filter((state) => state.agent_definition_id !== definition.id)
      .map((state) => state.target_ref));
    // Runs/day is an estimate the operator uses to size the agent, so it must
    // not promise more than the agent can physically do. Three ceilings apply:
    // the review cooldown (how often the same ticket may come back), how many
    // scheduled checks a day the configured interval allows times the
    // per-check ticket limit, and the daily run cap itself.
    const cooldownRunsPerDay = (matches.length * 86_400) / this.agentQueue.reviewCooldownSeconds(previewDefinition);
    const scheduleCeiling = checksPerDay(checkIntervalMinutesForDefinition(previewDefinition)) * config.maxTicketsPerCycle;
    const dailyRunCap = numericMetadata(
      metadataObject(metadataObject(metadataObject(definition.queue_policy_json).economic_guardrails).daily).max_agent_runs,
    );
    const ceilings = [cooldownRunsPerDay, scheduleCeiling];
    if (dailyRunCap > 0) ceilings.push(dailyRunCap);
    return {
      preview: {
        matchEstimate: matches.length,
        sampleSize: tickets.length,
        capped: tickets.length >= maxResults,
        overlapEstimate: overlapRefs.size,
        runsPerDayEstimate: Number(Math.min(...ceilings).toFixed(2)),
        resolution: targeting.resolution,
      },
    };
  }

  async getAgentTargetingOptions(
    context: AiExecutionContextWithManager,
    id: string,
    fieldInput: string,
    input: { query?: string | null; limit?: number | string | null } = {},
  ): Promise<{ options: RefItem[]; total?: number }> {
    const limit = cleanTargetingOptionLimit(input.limit);
    const query = cleanTargetingOptionQuery(input.query);
    const definition = await context.manager.getRepository(AiAgentDefinition).findOne({
      where: {
        id,
        tenant_id: context.tenantId,
      },
    });
    if (!definition) {
      throw new NotFoundException('Agent definition not found.');
    }
    // Kind-aware options: SRE definitions resolve reference data from their
    // monitoring binding; every other agent type keeps the ticketing path.
    // Same endpoint, same `{ options: RefItem[] }` response shape either way.
    const monitoringOptions = definition.agent_type === 'sre';
    const field = monitoringOptions
      ? cleanMonitoringTargetingOptionField(fieldInput)
      : cleanTargetingOptionField(fieldInput);
    const binding = monitoringOptions
      ? requireMonitoringBinding(definition, 'Targeting options require a monitoring provider binding.')
      : requireTicketingBinding(definition);
    const providerKey = binding.providerKey;
    const connectionKey = binding.connectionKey;
    const isEnumField = monitoringOptions
      ? field === 'status' || field === 'severity' || field === 'ack_state'
      : field === 'status' || field === 'priority' || field === 'type';
    const ttlMs = isEnumField
      ? TARGETING_ENUM_OPTIONS_TTL_MS
      : query ? TARGETING_CATALOG_OPTIONS_TTL_MS : TARGETING_CATALOG_BROWSE_TTL_MS;
    const cacheQuery = query.toLocaleLowerCase();
    const cacheKey = [
      context.tenantId,
      binding.providerKind,
      connectionKey,
      providerKey,
      field,
      cacheQuery,
      limit,
    ].join('|');
    const cloneOptions = (options: RefItem[]): RefItem[] => options.map((item) => ({
      value: item.value,
      label: item.label,
      ...(item.metadata ? { metadata: { ...item.metadata } } : {}),
    }));
    const now = Date.now();
    const cached = this.targetingOptionsCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return { options: cloneOptions(cached.options), ...(cached.total === undefined ? {} : { total: cached.total }) };
    }

    const filterEnumOptions = (source: RefItem[]): RefItem[] => {
      const normalizedQuery = query.toLocaleLowerCase();
      return source
        .filter((item) => !normalizedQuery
          || item.label.toLocaleLowerCase().includes(normalizedQuery)
          || item.value.toLocaleLowerCase().includes(normalizedQuery))
        .slice(0, limit);
    };
    const fetchAndCache = async (fetchContext: AiExecutionContextWithManager): Promise<{ options: RefItem[]; total?: number }> => {
      let options: RefItem[];
      // Catalogue size when the provider knows it cheaply; enum fields are fully
      // listed, so their page length is already the total.
      let total: number | undefined;
      if (monitoringOptions) {
        const provider = await this.providers.monitoring(fetchContext, providerKey);
        if (isEnumField) {
          const result = await provider.describeReferenceEnums(fetchContext);
          if (result.ok === false) {
            throw new BadRequestException(result.message);
          }
          const source = field === 'status'
            ? result.data.statuses
            : field === 'severity'
              ? result.data.severities
              : result.data.ackStates;
          options = filterEnumOptions(source);
          total = options.length;
        } else {
          const result = await provider.searchReferenceCatalog(fetchContext, {
            kind: field as MonitoringReferenceCatalogKind,
            query,
            limit,
          });
          if (result.ok === false) {
            throw new BadRequestException(result.message);
          }
          options = result.data.items.slice(0, limit);
        }
      } else {
        const provider = await this.providers.ticketing(fetchContext, providerKey);
        if (isEnumField) {
          const result = await provider.describeReferenceEnums(fetchContext);
          if (result.ok === false) {
            throw new BadRequestException(result.message);
          }
          const source = field === 'status'
            ? result.data.statuses
            : field === 'priority'
              ? result.data.priorities
              : result.data.types;
          options = filterEnumOptions(source);
          total = options.length;
        } else {
          const result = await provider.searchReferenceCatalog(fetchContext, {
            kind: field as TicketReferenceCatalogKind,
            query,
            limit,
          });
          if (result.ok === false) {
            throw new BadRequestException(result.message);
          }
          options = result.data.items.slice(0, limit);
          total = typeof (result.data as { total?: unknown }).total === 'number'
            ? Math.max(0, Math.floor((result.data as { total: number }).total))
            : undefined;
        }
      }
      const safeOptions = options.map((item) => ({
        value: String(item.value),
        label: String(item.label),
        ...(item.metadata ? { metadata: { ...item.metadata } } : {}),
      }));
      const fetchedAt = Date.now();
      this.targetingOptionsCache.set(cacheKey, {
        expiresAt: fetchedAt + ttlMs,
        staleUntil: fetchedAt + TARGETING_OPTIONS_STALE_SERVE_MS,
        options: safeOptions,
        ...(total === undefined ? {} : { total }),
      });
      return { options: safeOptions, ...(total === undefined ? {} : { total }) };
    };

    // Expired but still stale-servable: answer immediately from the stale copy and
    // refresh in the background. The refresh runs in its own tenant execution — the
    // request's entity manager is released as soon as this handler returns.
    if (cached && cached.staleUntil > now && this.tenantExecutor) {
      if (!cached.refreshing) {
        cached.refreshing = true;
        void this.tenantExecutor
          .runWithContext(context, (managedContext) => fetchAndCache(managedContext), { transaction: false })
          .catch((error: any) => {
            this.logger.warn(`Targeting options background refresh failed for ${field} (tenant ${context.tenantId}): ${String(error?.message ?? error)}`);
          })
          .finally(() => {
            const entry = this.targetingOptionsCache.get(cacheKey);
            if (entry) {
              entry.refreshing = false;
            }
          });
      }
      return { options: cloneOptions(cached.options), ...(cached.total === undefined ? {} : { total: cached.total }) };
    }

    const fetched = await fetchAndCache(context);
    return { options: cloneOptions(fetched.options), ...(fetched.total === undefined ? {} : { total: fetched.total }) };
  }

  async createAgentDefinition(
    context: AiExecutionContextWithManager,
    input: AgentControlAgentDefinitionInput = {},
  ) {
    const repo = context.manager.getRepository(AiAgentDefinition);
    const name = cleanSingleLine(input.name, 160);
    if (!name) {
      throw new BadRequestException('Agent name is required.');
    }
    const agentType = cleanAgentType(input.agent_type ?? 'helpdesk');
    // Helpdesk and SRE are the only agent families with a working runtime and capability
    // model today; creating another type would yield a non-functional shell or
    // mis-validated capabilities. Fail closed until each type ships its own model.
    if (agentType !== 'helpdesk' && agentType !== 'sre') {
      throw new BadRequestException('Only Helpdesk and SRE agents can be created today. Other agent types are not available yet.');
    }
    const inputBindings = normalizedPolicyObject(input.provider_bindings_json, 'Provider bindings');
    const defaults = agentType === 'sre'
      ? sreAgentDefaults({
        monitoringProviderKey: providerKeyFromBindings(inputBindings, 'monitoring')
          ?? await this.uniqueEnabledMonitoringProviderKey(context),
      })
      : helpdeskAgentDefaults({
        ticketingProviderKey: providerKeyFromBindings(inputBindings, 'ticketing')
          ?? (this.agentQueue
            ? await this.agentQueue.defaultTicketingProviderKeyForNewDefinition(context)
            : LEGACY_GLPI_TICKETING_PROVIDER_KEY),
      });
    const agentKey = await this.uniqueAgentKey(context, input.agent_key ? cleanAgentKey(input.agent_key) : null, name);
    const providerBindings = inputBindings ?? defaults.provider_bindings_json;
    const allowedCapabilities = input.allowed_capabilities_json !== undefined
      ? normalizeAllowedCapabilitiesForConfig(input.allowed_capabilities_json, agentType)
      : defaults.allowed_capabilities_json;
    const forbiddenCapabilities = input.forbidden_capabilities_json !== undefined
      ? (() => { throw new ForbiddenException('Forbidden capabilities are immutable from this endpoint.'); })()
      : [...defaults.forbidden_capabilities_json];
    const scopePolicy = normalizedPolicyObject(input.scope_policy_json, 'Scope policy') ?? defaults.scope_policy_json;
    const normalizedScopePolicy = normalizeScopePolicyForAgentType(agentType, scopePolicy);
    const now = new Date();
    const definition = await repo.save(repo.create({
      tenant_id: context.tenantId,
      agent_key: agentKey,
      name,
      description: cleanSingleLine(input.description, 500),
      agent_type: agentType,
      status: 'draft',
      environment: cleanAgentEnvironment(input.environment ?? defaults.environment),
      provider_bindings_json: providerBindings,
      allowed_capabilities_json: allowedCapabilities,
      forbidden_capabilities_json: forbiddenCapabilities,
      max_autonomy_level: defaults.max_autonomy_level,
      default_approval_requirement: defaults.default_approval_requirement,
      agent_priority: cleanAgentPriority(input.agent_priority, defaults.agent_priority),
      trigger_policy_json: normalizeTriggerPolicyCheckInterval(
        normalizedPolicyObject(input.trigger_policy_json, 'Trigger policy') ?? defaults.trigger_policy_json,
      ),
      scope_policy_json: normalizedScopePolicy,
      queue_policy_json: normalizeQueuePolicyRetention(
        normalizedPolicyObject(input.queue_policy_json, 'Queue policy') ?? defaults.queue_policy_json,
      ),
      response_policy_json: normalizeResponsePolicyForConfig(
        normalizedPolicyObject(input.response_policy_json, 'Response policy') ?? defaults.response_policy_json,
      ),
      evaluation_policy_json: normalizedPolicyObject(input.evaluation_policy_json, 'Evaluation policy')
        ?? defaults.evaluation_policy_json,
      // A new agent starts with its own (blank) persona — it does NOT inherit family
      // identity (mission/tone/instructions).
      persona_json: normalizePersona(input.persona_json, null),
      config_version: 1,
      updated_by_user_id: context.userId || null,
      metadata_json: {
        created_from_ui: true,
        user_modified: true,
      },
      created_at: now,
      updated_at: now,
    }));
    await this.recordAgentAuditEvent(context, {
      agentDefinitionId: definition.id,
      eventType: 'agent_config_updated',
      severity: 'info',
      message: `Agent ${definition.name} was created.`,
      metadata: {
        actor_user_id: context.userId || null,
        config_version: definition.config_version,
        diff: { created: { before: null, after: configSnapshot(definition) } },
      },
    });
    return { agent_definition: serializeAgentDefinition(definition) };
  }

  async updateAgentDefinition(
    context: AiExecutionContextWithManager,
    id: string,
    input: AgentControlAgentDefinitionInput = {},
  ) {
    const repo = context.manager.getRepository(AiAgentDefinition);
    const definition = await repo.findOne({ where: { id, tenant_id: context.tenantId } });
    if (!definition) {
      throw new NotFoundException('Agent definition not found.');
    }
    if (Object.prototype.hasOwnProperty.call(input, 'forbidden_capabilities_json')) {
      throw new ForbiddenException('Forbidden capabilities are immutable from this endpoint.');
    }
    const before = configSnapshot(definition);
    if (Object.prototype.hasOwnProperty.call(input, 'name')) {
      const name = cleanSingleLine(input.name, 160);
      if (!name) throw new BadRequestException('Agent name is required.');
      definition.name = name;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'description')) {
      definition.description = cleanSingleLine(input.description, 500);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'environment')) {
      definition.environment = cleanAgentEnvironment(input.environment);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'agent_priority')) {
      definition.agent_priority = cleanAgentPriority(input.agent_priority, cleanAgentPriority(definition.agent_priority, 100));
    }
    if (Object.prototype.hasOwnProperty.call(input, 'provider_bindings_json')) {
      definition.provider_bindings_json = normalizedPolicyObject(input.provider_bindings_json, 'Provider bindings');
    }
    if (Object.prototype.hasOwnProperty.call(input, 'allowed_capabilities_json')) {
      definition.allowed_capabilities_json = normalizeAllowedCapabilitiesForConfig(input.allowed_capabilities_json, definition.agent_type);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'persona_json')) {
      definition.persona_json = normalizePersona(input.persona_json, definition.persona_json);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'trigger_policy_json')) {
      // The check frequency is operator-editable, so its bounds are enforced
      // here too — never on the client alone.
      definition.trigger_policy_json = normalizeTriggerPolicyCheckInterval(
        normalizedPolicyObject(input.trigger_policy_json, 'Trigger policy'),
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, 'scope_policy_json')) {
      definition.scope_policy_json = normalizeScopePolicyForAgentType(definition.agent_type, normalizedPolicyObject(input.scope_policy_json, 'Scope policy'));
    }
    if (Object.prototype.hasOwnProperty.call(input, 'knowledge_sources')) {
      // Patch only the knowledge_sources sub-block, preserving the rest of scope_policy_json.
      definition.scope_policy_json = normalizeScopePolicyForAgentType(definition.agent_type, {
        ...(isRecord(definition.scope_policy_json) ? definition.scope_policy_json : {}),
        knowledge_sources: normalizeKnowledgeSources(input.knowledge_sources),
      });
    }
    if (Object.prototype.hasOwnProperty.call(input, 'queue_policy_json')) {
      // Retention is operator-editable, so the bounds are enforced here too —
      // never on the client alone.
      definition.queue_policy_json = normalizeQueuePolicyRetention(
        normalizedPolicyObject(input.queue_policy_json, 'Queue policy'),
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, 'response_policy_json')) {
      definition.response_policy_json = normalizeResponsePolicyForConfig(
        normalizedPolicyObject(input.response_policy_json, 'Response policy'),
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, 'evaluation_policy_json')) {
      definition.evaluation_policy_json = normalizedPolicyObject(input.evaluation_policy_json, 'Evaluation policy');
    }
    if (Object.prototype.hasOwnProperty.call(input, 'llm_model_config_id')) {
      const configId = typeof input.llm_model_config_id === 'string' && input.llm_model_config_id.trim()
        ? input.llm_model_config_id.trim()
        : null;
      if (configId) {
        const config = await context.manager.getRepository(AiModelConfig).findOne({
          where: { id: configId, tenant_id: context.tenantId },
        });
        if (!config) {
          throw new BadRequestException('AI model configuration not found.');
        }
        if (config.status !== 'active') {
          throw new BadRequestException('An archived AI model cannot be assigned.');
        }
      }
      definition.llm_model_config_id = configId;
    }
    definition.metadata_json = {
      ...metadataObject(definition.metadata_json),
      user_modified: true,
    };
    definition.config_version = Math.max(1, numericMetadata(definition.config_version) || 1) + 1;
    definition.updated_by_user_id = context.userId || null;
    definition.updated_at = new Date();
    const saved = await repo.save(definition);
    const after = configSnapshot(saved);
    const diff = changedConfigDiff(before, after);
    await this.recordAgentAuditEvent(context, {
      agentDefinitionId: saved.id,
      eventType: 'agent_config_updated',
      severity: 'info',
      message: `Agent ${saved.name} configuration was updated.`,
      metadata: {
        actor_user_id: context.userId || null,
        config_version: saved.config_version,
        diff,
      },
    });
    return { agent_definition: serializeAgentDefinition(saved), diff };
  }

  async updateAgentStatus(
    context: AiExecutionContextWithManager,
    id: string,
    input: AgentControlAgentStatusInput = {},
  ) {
    const repo = context.manager.getRepository(AiAgentDefinition);
    const definition = await repo.findOne({ where: { id, tenant_id: context.tenantId } });
    if (!definition) {
      throw new NotFoundException('Agent definition not found.');
    }
    const before = configSnapshot(definition);
    const status = cleanAgentStatus(input.status);
    definition.status = status;
    if (typeof input.watching === 'boolean') {
      const watching = input.watching === true;
      const trigger = isRecord(definition.trigger_policy_json) ? definition.trigger_policy_json : {};
      definition.trigger_policy_json = {
        ...trigger,
        scheduled_poll: {
          ...(isRecord(trigger.scheduled_poll) ? trigger.scheduled_poll : {}),
          enabled: watching,
        },
        production_polling_enabled: watching,
      };
    }
    definition.metadata_json = {
      ...metadataObject(definition.metadata_json),
      user_modified: true,
    };
    definition.config_version = Math.max(1, numericMetadata(definition.config_version) || 1) + 1;
    definition.updated_by_user_id = context.userId || null;
    definition.updated_at = new Date();
    const saved = await repo.save(definition);
    const diff = changedConfigDiff(before, configSnapshot(saved));
    await this.recordAgentAuditEvent(context, {
      agentDefinitionId: saved.id,
      eventType: 'agent_config_updated',
      severity: 'info',
      message: `Agent ${saved.name} status changed to ${status}.`,
      metadata: {
        actor_user_id: context.userId || null,
        config_version: saved.config_version,
        diff,
      },
    });
    return { agent_definition: serializeAgentDefinition(saved), diff };
  }

  async deleteAgentDefinition(context: AiExecutionContextWithManager, id: string) {
    const repo = context.manager.getRepository(AiAgentDefinition);
    const definition = await repo.findOne({ where: { id, tenant_id: context.tenantId } });
    if (!definition) {
      throw new NotFoundException('Agent definition not found.');
    }
    // Remove this agent's earned-autonomy policies (metadata-linked, no FK) so no orphan
    // auto-approval policy survives the agent.
    const policyRepo = context.manager.getRepository(AiApprovalPolicy);
    const orphanPolicyIds = (await policyRepo.find({ where: { tenant_id: context.tenantId } }))
      .filter((policy) => isAgentAutonomyPolicyMetadata(policy.metadata_json) && policy.metadata_json.agent_definition_id === definition.id)
      .map((policy) => policy.id);
    if (orphanPolicyIds.length > 0) {
      await policyRepo.delete({ id: In(orphanPolicyIds), tenant_id: context.tenantId });
    }
    // Its expired/failed proposals are metadata-linked too and would otherwise
    // pile up in "Needs attention" with nobody left to re-run them.
    const stamped = await stampAttentionAcknowledged(context.manager, context.tenantId, {
      agentDefinitionId: definition.id,
      userId: context.userId || null,
      reason: 'agent_deleted',
    });
    await this.recordAgentAuditEvent(context, {
      agentDefinitionId: definition.id,
      eventType: 'agent_deleted',
      severity: 'info',
      message: `Agent ${definition.name} was deleted.`,
      metadata: {
        actor_user_id: context.userId || null,
        agent_key: definition.agent_key,
        acknowledged_actions: stamped.action_ids.length,
      },
    });
    // Audit events reach a definition twice: directly (agent_definition_id) and
    // through its work items (work_item_id), both ON DELETE SET NULL, while the
    // work items CASCADE. Left to the cascades, the outcome depends on the order
    // PostgreSQL fires the FK triggers (trigger-name order), which differs
    // between a migrated and a pg_restore'd database.
    // Unlink the audit rows from the work items, then delete the work items, so
    // the final delete only has single-path cascades left.
    const scope = [context.tenantId, definition.id];
    await context.manager.query(
      `UPDATE ai_agent_audit_events
          SET work_item_id = NULL
        WHERE tenant_id = $1
          AND work_item_id IN (
            SELECT id FROM ai_agent_work_items WHERE tenant_id = $1 AND agent_definition_id = $2
          )`,
      scope,
    );
    await context.manager.query(
      'DELETE FROM ai_agent_work_items WHERE tenant_id = $1 AND agent_definition_id = $2',
      scope,
    );
    // FK cascades remove triggers, target states, and agent-scoped pauses;
    // audit events are SET NULL so the deletion record is preserved.
    await repo.delete({ id: definition.id, tenant_id: context.tenantId });
    return { deleted: true, id: definition.id };
  }

  private async autonomyRowsForDefinition(
    context: AiExecutionContextWithManager,
    definition: AiAgentDefinition,
  ) {
    const thresholds = autonomyThresholds(definition);
    const actions = await context.manager.getRepository(AiActionRequest).find({
      where: { tenant_id: context.tenantId },
      order: { created_at: 'ASC' },
    });
    const policies = await context.manager.getRepository(AiApprovalPolicy).find({
      where: { tenant_id: context.tenantId },
      order: { policy_version: 'DESC' },
    });
    const openIncident = metadataObject(definition.evaluation_policy_json).open_incident === true;
    return AUTONOMY_ACTION_CLASSES.map((actionClassName) => {
      const capabilityName = approvedCapabilityForAutonomyActionClass(actionClassName);
      const classActions = actions.filter((action) =>
        definitionIdFromMetadata(action.metadata_json) === definition.id
        && actionClass(action) === actionClassName);
      const firstProposalAt = classActions.length > 0
        ? classActions.reduce((earliest, action) => Math.min(earliest, actionSortTime(action)), Number.POSITIVE_INFINITY)
        : null;
      const decidedActions = classActions.filter((action) =>
        !!action.approved_at
        || !!action.rejected_at
        || ['approved', 'executed', 'rejected'].includes(action.status));
      const accepted = decidedActions.filter((action) =>
        !!action.approved_at
        || action.status === 'approved'
        || action.status === 'executed').length;
      const decided = decidedActions.length;
      const acceptanceRate = decided > 0 ? accepted / decided : null;
      const daysActive = firstProposalAt && Number.isFinite(firstProposalAt)
        ? Math.floor((Date.now() - firstProposalAt) / (24 * 60 * 60 * 1000))
        : 0;
      const matchingPolicy = policies.find((policy) =>
        isAgentAutonomyPolicyMetadata(policy.metadata_json)
        && policy.metadata_json.agent_definition_id === definition.id
        && policy.metadata_json.action_class === actionClassName) ?? null;
      const reasons: string[] = [];
      // Every action class is automatable now; the risk tier decides how the
      // grant is obtained (see ai-agent-autonomy.ts), not whether it is possible,
      // so there is no ACTION_CLASS_NOT_ALLOWLISTED blocker any more.
      if (!capabilityName || !definitionAllowsCapability(definition, capabilityName)) {
        reasons.push('CAPABILITY_NOT_ALLOWED');
      }
      if (decided < thresholds.minimumDecided) {
        reasons.push('INSUFFICIENT_DECIDED_PROPOSALS');
      }
      if (acceptanceRate === null || acceptanceRate < thresholds.minimumAcceptanceRate) {
        reasons.push('ACCEPTANCE_RATE_TOO_LOW');
      }
      if (daysActive < thresholds.minimumObservationDays) {
        reasons.push('OBSERVATION_WINDOW_TOO_SHORT');
      }
      if (openIncident) {
        reasons.push('OPEN_INCIDENT_FLAG');
      }
      const hardReasons = reasons.filter((reason) => !AUTONOMY_RECOMMENDATION_REASON_CODES.has(reason));
      return {
        actionClass: actionClassName,
        capabilityName,
        mode: matchingPolicy && matchingPolicy.enabled && matchingPolicy.status === 'enabled' ? 'automatic' : 'ask_first',
        riskTier: autonomyRiskTier(actionClassName) ?? 'high',
        // High-tier grants always need the acknowledgement + written reason, even
        // when every eval gate passes. Surfaced so the dialog can say so upfront.
        acknowledgementRequired: autonomyGrantRequiresAcknowledgement(actionClassName),
        eligible: reasons.length === 0,
        recommendationOverrideAvailable: reasons.length > 0 && hardReasons.length === 0,
        hardReasons,
        reasons,
        progress: {
          decided,
          required: thresholds.minimumDecided,
          acceptanceRate: acceptanceRate === null ? null : Number(acceptanceRate.toFixed(4)),
          requiredRate: thresholds.minimumAcceptanceRate,
          daysActive,
          requiredDays: thresholds.minimumObservationDays,
        },
        effectiveCeiling: null,
        demotion: null,
        policy: matchingPolicy ? {
          id: matchingPolicy.id,
          policy_key: matchingPolicy.policy_key,
          policy_version: matchingPolicy.policy_version,
          enabled: matchingPolicy.enabled,
          status: matchingPolicy.status,
          live_test_safety: matchingPolicy.live_test_safety,
        } : null,
      };
    });
  }

  private async demoteUnsafeAutomaticRows(
    context: AiExecutionContextWithManager,
    definition: AiAgentDefinition,
    rows: Array<{
      actionClass: string;
      mode: string;
      progress: { decided: number; acceptanceRate: number | null };
      policy: { id: string; policy_version: number } | null;
    }>,
  ): Promise<boolean> {
    let changed = false;
    const policyRepo = context.manager.getRepository(AiApprovalPolicy);
    for (const row of rows) {
      if (
        row.mode !== 'automatic'
        || !row.policy
        || row.progress.decided <= 0
        || row.progress.acceptanceRate === null
        || row.progress.acceptanceRate >= 0.5
      ) {
        continue;
      }
      const policy = await policyRepo.findOne({
        where: {
          id: row.policy.id,
          tenant_id: context.tenantId,
        },
      });
      if (!policy || !policy.enabled) {
        continue;
      }
      policy.enabled = false;
      policy.status = 'disabled';
      policy.policy_version += 1;
      policy.updated_at = new Date();
      const saved = await policyRepo.save(policy);
      await this.recordAgentAuditEvent(context, {
        agentDefinitionId: definition.id,
        eventType: 'agent_autonomy_demoted',
        severity: 'warning',
        message: `Automatic mode was turned off for ${row.actionClass} because acceptance dropped below 50%.`,
        metadata: {
          actor_user_id: null,
          action_class: row.actionClass,
          reason: 'rolling_acceptance_below_50_percent',
          acceptance_rate: row.progress.acceptanceRate,
          decided: row.progress.decided,
          policy_id: saved.id,
          policy_version: saved.policy_version,
        },
      });
      changed = true;
    }
    return changed;
  }

  async getAgentAutonomy(context: AiExecutionContextWithManager, id: string) {
    const definition = await context.manager.getRepository(AiAgentDefinition).findOne({
      where: { id, tenant_id: context.tenantId },
    });
    if (!definition) {
      throw new NotFoundException('Agent definition not found.');
    }
    let items = await this.autonomyRowsForDefinition(context, definition);
    if (await this.demoteUnsafeAutomaticRows(context, definition, items)) {
      items = await this.autonomyRowsForDefinition(context, definition);
    }
    return {
      agent_definition: serializeAgentDefinition(definition),
      riskTiers: AUTONOMY_RISK_TIER_BY_ACTION_CLASS,
      // The recommendation thresholds the rows are measured against, so the UI
      // never has to hardcode "20 decisions" again.
      thresholds: autonomyThresholds(definition),
      items,
    };
  }

  async setAgentAutonomy(
    context: AiExecutionContextWithManager,
    id: string,
    input: AgentControlAutonomyInput = {},
  ) {
    const definition = await context.manager.getRepository(AiAgentDefinition).findOne({
      where: { id, tenant_id: context.tenantId },
    });
    if (!definition) {
      throw new NotFoundException('Agent definition not found.');
    }
    const actionClassName = cleanSingleLine(input.actionClass, 80);
    if (!actionClassName || !AUTONOMY_ACTION_CLASSES.includes(actionClassName as typeof AUTONOMY_ACTION_CLASSES[number])) {
      throw new BadRequestException('Unsupported action class.');
    }
    const mode = input.mode === 'automatic' || input.mode === 'ask_first' ? input.mode : null;
    if (!mode) {
      throw new BadRequestException('Autonomy mode must be ask_first or automatic.');
    }
    const policyRepo = context.manager.getRepository(AiApprovalPolicy);
    const policyKey = agentAutonomyPolicyKey(definition.id, actionClassName);
    const existingPolicies = (await policyRepo.find({ where: { tenant_id: context.tenantId, policy_key: policyKey } }))
      .sort((left, right) => right.policy_version - left.policy_version);
    const existingPolicy = existingPolicies[0] ?? null;

    if (mode === 'ask_first') {
      let policy = existingPolicy;
      if (policy) {
        policy.enabled = false;
        policy.status = 'disabled';
        policy.policy_version += 1;
        policy.updated_at = new Date();
        policy = await policyRepo.save(policy);
      }
      await this.recordAgentAuditEvent(context, {
        agentDefinitionId: definition.id,
        eventType: 'agent_autonomy_revoked',
        severity: 'info',
        message: `Automatic mode was turned off for ${actionClassName}.`,
        metadata: {
          actor_user_id: context.userId || null,
          action_class: actionClassName,
          policy_id: policy?.id ?? null,
          policy_version: policy?.policy_version ?? null,
        },
      });
      return this.getAgentAutonomy(context, definition.id);
    }

    if (input.confirm !== true) {
      throw new ForbiddenException('Automatic mode requires explicit confirmation.');
    }
    const rows = await this.autonomyRowsForDefinition(context, definition);
    const row = rows.find((candidate) => candidate.actionClass === actionClassName);
    const hardReasons = row?.reasons.filter((reason) => !AUTONOMY_RECOMMENDATION_REASON_CODES.has(reason)) ?? ['ACTION_CLASS_NOT_FOUND'];
    const overrideReason = cleanSingleLine(input.overrideReason, 500);
    const riskTier = autonomyRiskTier(actionClassName);
    const acknowledgementRequired = autonomyGrantRequiresAcknowledgement(actionClassName);
    const acknowledged = input.overrideAcknowledged === true && !!overrideReason;
    const overrideGranted = !!row
      && !row.eligible
      && hardReasons.length === 0
      && acknowledged;
    if (!row || (!row.eligible && !overrideGranted)) {
      throw new ForbiddenException({
        message: 'Automatic mode is not eligible for this action class.',
        reasons: row?.reasons ?? ['ACTION_CLASS_NOT_FOUND'],
        hardReasons,
        recommendationOverrideAvailable: !!row && !row.eligible && hardReasons.length === 0,
        progress: row?.progress ?? null,
      });
    }
    // High-risk classes act in front of the requester or move work between
    // people. The acknowledgement and its written reason are mandatory for them
    // whatever the eligibility says — enforced here, never trusted from the
    // client, which only mirrors this rule in its dialog.
    if (acknowledgementRequired && !acknowledged) {
      throw new ForbiddenException({
        message: 'This action class always requires an explicit acknowledgement and a reason before it can run automatically.',
        reasons: ['HIGH_RISK_ACKNOWLEDGEMENT_REQUIRED'],
        hardReasons: [],
        riskTier,
        acknowledgementRequired: true,
        progress: row.progress,
      });
    }
    const capabilityName = approvedCapabilityForAutonomyActionClass(actionClassName);
    if (!capabilityName || !isAutomatableAutonomyActionClass(actionClassName)) {
      throw new ForbiddenException('This action class cannot run automatically.');
    }
    if (!definitionAllowsCapability(definition, capabilityName)) {
      throw new ForbiddenException('The agent definition does not allow this capability.');
    }
    const ticketingBinding = requireTicketingBinding(definition);
    const providerKey = ticketingBinding.providerKey;
    const providerKind = ticketingBinding.providerKind;
    const now = new Date();
    const nextPolicyVersion = existingPolicy ? existingPolicy.policy_version + 1 : 1;
    const policy = await policyRepo.save(policyRepo.create({
      ...(existingPolicy ?? {}),
      tenant_id: context.tenantId,
      policy_key: policyKey,
      policy_version: nextPolicyVersion,
      name: `${definition.name}: automatic ${actionClassName}`,
      description: `Eval-gated agent autonomy grant for a ${riskTier}-risk helpdesk action class.`,
      status: 'enabled',
      enabled: true,
      capability_name: capabilityName,
      capability_version: '1.0.0',
      effect: 'write',
      provider_kind: providerKind,
      provider_key: providerKey,
      environment: definition.environment,
      trigger_surface: 'internal',
      trigger_kind: 'internal',
      max_autonomy_level: 'A3',
      target_type: 'ticket',
      target_constraints_json: { allowed_patterns: ['^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$'] },
      evidence_requirements_json: { min_count: 1 },
      evaluation_requirements_json: null,
      min_confidence: 0.5,
      cooldown_seconds: 0,
      budget_constraints_json: {
        window_minutes: 60,
        max_failed_actions: 0,
        max_operator_rejections: 0,
        max_provider_errors: 0,
        max_recent_cost: 100,
        cost_json_key: 'estimated_cost_eur',
      },
      live_test_safety: 'live_write_gated',
      metadata_json: {
        created_by: AGENT_AUTONOMY_POLICY_SOURCE,
        agent_definition_id: definition.id,
        agent_key: definition.agent_key,
        action_class: actionClassName,
        risk_tier: riskTier,
        acknowledgement: acknowledgementRequired ? {
          required: true,
          acknowledged: true,
          reason: overrideReason,
          granted_by_user_id: context.userId || null,
          granted_at: now.toISOString(),
        } : null,
        granted_by_user_id: context.userId || null,
        granted_at: now.toISOString(),
        eligibility: row.progress,
        override: overrideGranted ? {
          acknowledged: true,
          reason: overrideReason,
          granted_by_user_id: context.userId || null,
          granted_at: now.toISOString(),
          bypassed_recommendation_reasons: row.reasons.filter((reason) => AUTONOMY_RECOMMENDATION_REASON_CODES.has(reason)),
          hard_reasons: hardReasons,
          eligibility_snapshot: row.progress,
        } : null,
      },
      created_at: existingPolicy?.created_at ?? now,
      updated_at: now,
    }));
    await this.recordAgentAuditEvent(context, {
      agentDefinitionId: definition.id,
      eventType: 'agent_autonomy_granted',
      severity: 'info',
      message: `Automatic mode was enabled for ${actionClassName}.`,
      metadata: {
        actor_user_id: context.userId || null,
        action_class: actionClassName,
        // The tier is part of the audit record: a high-tier grant is a different
        // decision from a low-tier one and must read as such months later.
        risk_tier: riskTier,
        acknowledgement_required: acknowledgementRequired,
        acknowledgement_reason: acknowledgementRequired ? overrideReason : null,
        policy_id: policy.id,
        policy_version: policy.policy_version,
        eligibility: row.progress,
        override: overrideGranted ? {
          reason: overrideReason,
          bypassed_recommendation_reasons: row.reasons.filter((reason) => AUTONOMY_RECOMMENDATION_REASON_CODES.has(reason)),
        } : null,
      },
    });
    return this.getAgentAutonomy(context, definition.id);
  }

  async getBadges(context: AiExecutionContextWithManager) {
    const pendingApprovals = await context.manager.getRepository(AiActionRequest)
      .createQueryBuilder('action')
      .where('action.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('action.status = :status', { status: 'pending' })
      .andWhere('(action.expires_at IS NULL OR action.expires_at > now())')
      .getCount();
    return { pendingApprovals };
  }

  async listActivity(context: AiExecutionContextWithManager, options: AgentControlActivityOptions = {}) {
    const limit = safeLimit(options.limit, 50, 100);
    // Keyset pagination: every source stream is read in the same (time desc)
    // order from the cursor, `limit + 1` rows each, so the merged head is
    // exactly the next page. The former "fetch up to 400 per table, merge, then
    // slice by offset" silently dropped entries past the first pages.
    const cursor = decodeActivityCursor(options.cursor);
    const cursorDate = cursor ? new Date(Date.parse(cursor.at)) : null;
    const fetchLimit = limit + 1;
    const wantedTypes = new Set<AgentControlActivityType>(
      options.types?.length ? options.types : AGENT_ACTIVITY_TYPES,
    );
    const from = options.from ? new Date(options.from) : null;
    const to = options.to ? new Date(options.to) : null;
    const fromDate = from && Number.isFinite(from.getTime()) ? from : null;
    const toDate = to && Number.isFinite(to.getTime()) ? to : null;
    const targetRef = options.targetRef?.trim() || null;
    const status = options.status?.trim() || null;
    const agentDefinitionId = options.agentDefinitionId?.trim() || null;
    const actorUserId = options.actorUserId?.trim() || null;

    type ActivityEntry = {
      id: string;
      at: string;
      type: AgentControlActivityType;
      agentDefinitionId: string | null;
      agentKey: string | null;
      targetType: string | null;
      targetRef: string | null;
      titleKey: string;
      status: string | null;
      actorUserId: string | null;
      actionRequestId: string | null;
      approvalId: string | null;
      runId: string | null;
      auditEventId: string | null;
      capabilityName: string | null;
      actionClass: string | null;
      eventType: string | null;
      severity: string | null;
      errorMessage: string | null;
      detail: ActivityActionDetail | null;
    };

    const entries: ActivityEntry[] = [];
    const iso = (value: Date | string): string => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
    // Time window + cursor bound on the column an entry stream is ordered by.
    // Counting queries reuse the same builder without the cursor bound.
    const applyWindow = <T extends SelectQueryBuilder<any>>(qb: T, column: string, withCursor: boolean): T => {
      if (fromDate) qb.andWhere(`${column} >= :windowFrom`, { windowFrom: fromDate });
      if (toDate) qb.andWhere(`${column} <= :windowTo`, { windowTo: toDate });
      if (withCursor && cursorDate) qb.andWhere(`${column} <= :windowCursor`, { windowCursor: cursorDate });
      return qb;
    };
    // Total is honest but only computed for the first page — "load more" pages
    // keep the count the UI already has instead of paying six COUNTs a minute.
    const countTotals = cursor == null;
    let total = 0;
    const readStream = async <E extends ObjectLiteral>(
      build: (withCursor: boolean) => SelectQueryBuilder<E>,
      orderColumn: string,
    ): Promise<E[]> => {
      const rows = await build(true).orderBy(orderColumn, 'DESC').take(fetchLimit).getMany();
      if (countTotals) {
        total += await build(false).getCount();
      }
      return rows;
    };

    const actionStream = (withCursor: boolean, orderColumn: string): SelectQueryBuilder<AiActionRequest> => {
      const qb = context.manager.getRepository(AiActionRequest).createQueryBuilder('action')
        .where('action.tenant_id = :tenantId', { tenantId: context.tenantId });
      if (agentDefinitionId) {
        qb.andWhere("action.metadata_json ->> 'agent_definition_id' = :agentDefinitionId", { agentDefinitionId });
      }
      if (targetRef) {
        qb.andWhere('action.target_ref ILIKE :targetRef', { targetRef: `%${targetRef}%` });
      }
      if (status) {
        qb.andWhere('action.status = :status', { status });
      }
      if (actorUserId) {
        qb.andWhere('action.user_id = :actorUserId', { actorUserId });
      }
      return applyWindow(qb, orderColumn, withCursor);
    };
    const actionBase = (action: AiActionRequest) => ({
      agentDefinitionId: definitionIdFromMetadata(action.metadata_json),
      agentKey: null,
      targetType: action.target_type,
      targetRef: action.target_ref,
      actorUserId: action.user_id,
      actionRequestId: action.id,
      approvalId: null,
      runId: action.run_id,
      auditEventId: null,
      capabilityName: action.capability_name,
      actionClass: actionClass(action),
      eventType: null,
      severity: null,
      errorMessage: action.error_message,
      detail: activityActionDetail(action),
    });

    const actionRows: AiActionRequest[] = [];
    if (wantedTypes.has('proposal')) {
      const proposals = await readStream(
        (withCursor) => actionStream(withCursor, 'action.created_at'),
        'action.created_at',
      );
      actionRows.push(...proposals);
      for (const action of proposals) {
        entries.push({
          ...actionBase(action),
          id: `action:${action.id}:proposal`,
          at: iso(action.created_at),
          type: 'proposal',
          titleKey: 'proposal_created',
          status: action.status,
        });
      }
    }
    if (wantedTypes.has('execution')) {
      const executions = await readStream(
        (withCursor) => actionStream(withCursor, 'action.executed_at').andWhere('action.executed_at IS NOT NULL'),
        'action.executed_at',
      );
      actionRows.push(...executions);
      for (const action of executions) {
        entries.push({
          ...actionBase(action),
          id: `action:${action.id}:execution`,
          at: iso(action.executed_at as Date),
          type: 'execution',
          titleKey: 'action_executed',
          status: action.status,
        });
      }
    }
    if (wantedTypes.has('error')) {
      const failures = await readStream(
        (withCursor) => actionStream(withCursor, 'COALESCE(action.updated_at, action.created_at)')
          .andWhere("action.status IN ('failed', 'provider_error')"),
        'COALESCE(action.updated_at, action.created_at)',
      );
      actionRows.push(...failures);
      for (const action of failures) {
        entries.push({
          ...actionBase(action),
          id: `action:${action.id}:error`,
          at: iso(action.updated_at ?? action.created_at),
          type: 'error',
          titleKey: 'action_failed',
          status: action.status,
        });
      }
    }

    const actionById = new Map(actionRows.map((action) => [action.id, action]));
    if (wantedTypes.has('decision')) {
      const decisionOrder = 'COALESCE(approval.decided_at, approval.created_at)';
      // The agent/ticket filters live on the linked action request: pushed down
      // as EXISTS so the page stays exact instead of being thinned after the
      // fetch (which would leave holes between pages).
      const decisionStream = (withCursor: boolean) => {
        const qb = context.manager.getRepository(AiApproval).createQueryBuilder('approval')
          .where('approval.tenant_id = :tenantId', { tenantId: context.tenantId });
        if (status) {
          qb.andWhere('approval.status = :status', { status });
        }
        if (actorUserId) {
          qb.andWhere('approval.actor_user_id = :actorUserId', { actorUserId });
        }
        if (agentDefinitionId) {
          qb.andWhere(
            `EXISTS (SELECT 1 FROM ai_action_requests linked
                      WHERE linked.id = approval.action_request_id
                        AND linked.tenant_id = approval.tenant_id
                        AND linked.metadata_json ->> 'agent_definition_id' = :agentDefinitionId)`,
            { agentDefinitionId },
          );
        }
        if (targetRef) {
          qb.andWhere(
            `EXISTS (SELECT 1 FROM ai_action_requests linked
                      WHERE linked.id = approval.action_request_id
                        AND linked.tenant_id = approval.tenant_id
                        AND linked.target_ref ILIKE :targetRef)`,
            { targetRef: `%${targetRef}%` },
          );
        }
        return applyWindow(qb, decisionOrder, withCursor);
      };
      const approvals = await readStream(decisionStream, decisionOrder);
      const missingActionIds = approvals
        .map((approval) => approval.action_request_id)
        .filter((id) => !actionById.has(id));
      if (missingActionIds.length > 0) {
        const linkedActions = await context.manager.getRepository(AiActionRequest).find({
          where: {
            tenant_id: context.tenantId,
            id: In(Array.from(new Set(missingActionIds))),
          },
        });
        for (const action of linkedActions) {
          actionById.set(action.id, action);
        }
      }
      for (const approval of approvals) {
        const action = actionById.get(approval.action_request_id) ?? null;
        const actionAgentDefinitionId = action ? definitionIdFromMetadata(action.metadata_json) : null;
        const actionDetail = action ? activityActionDetail(action) : null;
        const decisionDetail = (actionDetail || approval.reason)
          ? {
            capabilityName: actionDetail?.capabilityName ?? approval.capability_name,
            body: actionDetail?.body ?? null,
            changes: actionDetail?.changes ?? null,
            reason: actionDetail?.reason ?? null,
            rationale: approval.reason ?? null,
            evidenceCount: actionDetail?.evidenceCount ?? null,
          }
          : null;
        entries.push({
          id: `approval:${approval.id}`,
          at: iso(approval.decided_at ?? approval.created_at),
          type: 'decision',
          agentDefinitionId: actionAgentDefinitionId,
          agentKey: null,
          targetType: action?.target_type ?? null,
          targetRef: action?.target_ref ?? null,
          titleKey: approval.status === 'approved'
            ? 'decision_approved'
            : approval.status === 'dismissed'
              ? 'decision_dismissed'
              : 'decision_rejected',
          status: approval.status,
          actorUserId: approval.actor_user_id,
          actionRequestId: approval.action_request_id,
          approvalId: approval.id,
          runId: action?.run_id ?? null,
          auditEventId: null,
          capabilityName: approval.capability_name,
          actionClass: action ? actionClass(action) : approval.capability_name,
          eventType: null,
          severity: null,
          errorMessage: null,
          detail: decisionDetail,
        });
      }
    }

    // Derived from the classifier's own list so a newly audit-derived type
    // (e.g. the acknowledgements now filed under "decision") can never be
    // selected by the filter yet skipped by this gate.
    if (AGENT_ACTIVITY_AUDIT_TYPES.some((type) => wantedTypes.has(type))) {
      const auditTypeSql = auditActivityTypeSql('event', wantedTypes);
      const auditStream = (withCursor: boolean) => {
        const qb = context.manager.getRepository(AiAgentAuditEvent).createQueryBuilder('event')
          .where('event.tenant_id = :tenantId', { tenantId: context.tenantId });
        if (agentDefinitionId) {
          qb.andWhere('event.agent_definition_id = :agentDefinitionId', { agentDefinitionId });
        }
        if (status) {
          qb.andWhere('(event.severity = :status OR event.event_type = :status)', { status });
        }
        if (actorUserId) {
          qb.andWhere("event.metadata_json ->> 'actor_user_id' = :actorUserId", { actorUserId });
        }
        // Same classification as auditActivityType, evaluated in SQL so a
        // filtered page is complete instead of being thinned after the fetch.
        if (auditTypeSql) {
          qb.andWhere(auditTypeSql);
        }
        return applyWindow(qb, 'event.created_at', withCursor);
      };
      const auditEvents = await readStream(auditStream, 'event.created_at');
      for (const event of auditEvents) {
        entries.push({
          id: `audit:${event.id}`,
          at: iso(event.created_at),
          type: auditActivityType(event),
          agentDefinitionId: event.agent_definition_id,
          agentKey: null,
          targetType: stringFromMetadata(metadataObject(event.metadata_json).target_type),
          targetRef: stringFromMetadata(metadataObject(event.metadata_json).target_ref),
          titleKey: event.event_type,
          status: event.severity,
          actorUserId: stringFromMetadata(metadataObject(event.metadata_json).actor_user_id),
          actionRequestId: stringFromMetadata(metadataObject(event.metadata_json).action_request_id),
          approvalId: null,
          runId: stringFromMetadata(metadataObject(event.metadata_json).run_id),
          auditEventId: event.id,
          capabilityName: null,
          actionClass: stringFromMetadata(metadataObject(event.metadata_json).action_class),
          eventType: event.event_type,
          severity: event.severity,
          errorMessage: event.severity === 'error'
            ? (stringFromMetadata(metadataObject(event.metadata_json).error) ?? event.message)
            : null,
          // The poll summary the watcher already stores: how many tickets/alerts
          // were seen, queued, skipped as duplicates, processed.
          detail: activityCheckDetail(event),
        });
      }
    }

    if (wantedTypes.has('error')) {
      const runStream = (withCursor: boolean) => {
        const qb = context.manager.getRepository(AiRun).createQueryBuilder('run')
          .where('run.tenant_id = :tenantId', { tenantId: context.tenantId })
          .andWhere("run.status IN ('failed', 'provider_error')");
        if (agentDefinitionId) {
          qb.andWhere("run.metadata_json ->> 'agent_definition_id' = :agentDefinitionId", { agentDefinitionId });
        }
        if (actorUserId) {
          qb.andWhere('run.user_id = :actorUserId', { actorUserId });
        }
        if (status) {
          qb.andWhere('run.status = :status', { status });
        }
        if (targetRef) {
          qb.andWhere(
            `(run.metadata_json ->> 'target_ref' ILIKE :targetRef OR run.metadata_json ->> 'targetRef' ILIKE :targetRef)`,
            { targetRef: `%${targetRef}%` },
          );
        }
        return applyWindow(qb, 'run.created_at', withCursor);
      };
      const runs = await readStream(runStream, 'run.created_at');
      for (const run of runs) {
        const metadata = metadataObject(run.metadata_json);
        entries.push({
          id: `run:${run.id}:error`,
          at: iso(run.created_at),
          type: 'error',
          agentDefinitionId: definitionIdFromMetadata(run.metadata_json),
          agentKey: null,
          targetType: stringFromMetadata(metadata.target_type ?? metadata.targetType),
          targetRef: stringFromMetadata(metadata.target_ref ?? metadata.targetRef),
          titleKey: 'run_failed',
          status: run.status,
          actorUserId: run.user_id,
          actionRequestId: null,
          approvalId: null,
          runId: run.id,
          auditEventId: null,
          capabilityName: null,
          actionClass: null,
          eventType: null,
          severity: 'error',
          errorMessage: stringFromMetadata(metadata.error_message ?? metadata.errorMessage),
          detail: null,
        });
      }
    }

    const page = mergeActivityPage(entries, limit, cursor);
    const definitionIds = Array.from(new Set(page.items
      .map((entry) => entry.agentDefinitionId)
      .filter((id): id is string => !!id)));
    const definitions = definitionIds.length > 0
      ? await context.manager.getRepository(AiAgentDefinition).find({
        where: { tenant_id: context.tenantId, id: In(definitionIds) },
      })
      : [];
    const definitionKeyById = new Map(definitions.map((definition) => [definition.id, definition.agent_key]));

    return {
      items: page.items.map((entry) => ({
        ...entry,
        agentKey: entry.agentDefinitionId ? definitionKeyById.get(entry.agentDefinitionId) ?? null : null,
      })),
      total: countTotals ? total : null,
      limit,
      nextCursor: page.nextCursor,
    };
  }

  async getHelpdeskEvaluationDaily(
    context: AiExecutionContextWithManager,
    options: { days?: number; agentDefinitionId?: string } = {},
  ) {
    const days = Math.max(1, Math.min(180, Math.floor(options.days ?? 30)));
    const end = new Date();
    const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
    const start = new Date(endDay);
    start.setUTCDate(start.getUTCDate() - days + 1);
    // When scoped to one agent, the trend must reflect only that agent's own
    // activity and must never show days before it existed: floor the window at
    // the agent's creation day so a freshly created agent starts with an empty
    // (not back-filled) history. See agentic-control-plane issue #1.
    const agentDefinitionId = options.agentDefinitionId?.trim() || null;
    if (agentDefinitionId) {
      const definition = await context.manager.getRepository(AiAgentDefinition).findOne({
        where: { id: agentDefinitionId, tenant_id: context.tenantId },
      });
      if (!definition) {
        throw new NotFoundException('Agent definition not found.');
      }
      const created = definition.created_at instanceof Date
        ? definition.created_at
        : new Date(definition.created_at);
      if (Number.isFinite(created.getTime())) {
        const createdDay = new Date(Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate()));
        if (createdDay.getTime() > start.getTime()) {
          start.setTime(createdDay.getTime());
        }
      }
    }
    type Daily = {
      day: string;
      proposals: number;
      decided: number;
      acceptanceRate: number | null;
      executed: number;
      dismissed: number;
      costEur: number;
      tokens: number;
    };
    const byDay = new Map<string, Daily>();
    for (let day = new Date(start); day.getTime() <= endDay.getTime(); day.setUTCDate(day.getUTCDate() + 1)) {
      const key = dateKey(day);
      byDay.set(key, {
        day: key,
        proposals: 0,
        decided: 0,
        acceptanceRate: null,
        executed: 0,
        dismissed: 0,
        costEur: 0,
        tokens: 0,
      });
    }

    if (typeof (context.manager as unknown as { query?: unknown }).query === 'function') {
      const [actionRows, runRows] = await Promise.all([
        context.manager.query(
          `
            SELECT
              date_trunc('day', created_at AT TIME ZONE 'UTC')::date AS day,
              COUNT(*)::int AS proposals,
              COUNT(*) FILTER (WHERE status IN ('executed', 'rejected'))::int AS decided,
              COUNT(*) FILTER (WHERE status = 'executed')::int AS executed,
              COUNT(*) FILTER (WHERE status = 'dismissed')::int AS dismissed
            FROM ai_action_requests
            WHERE tenant_id = $1
              AND provider_kind = 'ticketing'
              AND capability_name = ANY($2)
              AND created_at >= $3
              AND created_at <= $4
              -- Agent-attributed rows only: definitionless diagnostic/mock-triage
              -- actions must not pollute the unscoped evaluation trend.
              AND metadata_json ->> 'agent_definition_id' IS NOT NULL
              AND ($5::text IS NULL OR metadata_json ->> 'agent_definition_id' = $5::text)
            GROUP BY 1
          `,
          [context.tenantId, HELPDESK_REVIEW_ACTION_CAPABILITIES, start, end, agentDefinitionId],
        ),
        context.manager.query(
          `
            SELECT
              date_trunc('day', created_at AT TIME ZONE 'UTC')::date AS day,
              COALESCE(SUM(COALESCE((usage_json ->> 'estimated_tokens')::numeric, (usage_json ->> 'total_tokens')::numeric, 0)), 0)::float AS tokens,
              COALESCE(SUM(COALESCE((cost_json ->> 'estimated_cost_eur')::numeric, (cost_json ->> 'total_cost_eur')::numeric, (cost_json ->> 'total_cost')::numeric, 0)), 0)::float AS cost_eur
            FROM ai_runs
            WHERE tenant_id = $1
              AND created_at >= $2
              AND created_at <= $3
              AND ($4::text IS NULL OR metadata_json ->> 'agent_definition_id' = $4::text)
            GROUP BY 1
          `,
          [context.tenantId, start, end, agentDefinitionId],
        ),
      ]);
      for (const row of actionRows as Array<Record<string, unknown>>) {
        const key = row.day instanceof Date ? dateKey(row.day) : String(row.day ?? '').slice(0, 10);
        const target = byDay.get(key);
        if (!target) continue;
        target.proposals = numericMetadata(row.proposals);
        target.decided = numericMetadata(row.decided);
        target.executed = numericMetadata(row.executed);
        target.dismissed = numericMetadata(row.dismissed);
      }
      for (const row of runRows as Array<Record<string, unknown>>) {
        const key = row.day instanceof Date ? dateKey(row.day) : String(row.day ?? '').slice(0, 10);
        const target = byDay.get(key);
        if (!target) continue;
        target.tokens = Math.round(numericMetadata(row.tokens));
        target.costEur = Number(numericMetadata(row.cost_eur).toFixed(6));
      }
      for (const row of byDay.values()) {
        row.acceptanceRate = row.decided > 0
          ? Number((row.executed / row.decided).toFixed(4))
          : null;
      }
      return { days: Array.from(byDay.values()) };
    }

    const [actions, runs] = await Promise.all([
      context.manager.getRepository(AiActionRequest).find({
        where: {
          tenant_id: context.tenantId,
          provider_kind: 'ticketing',
        },
      }),
      context.manager.getRepository(AiRun).createQueryBuilder('run')
        .where('run.tenant_id = :tenantId', { tenantId: context.tenantId })
        .andWhere('run.created_at >= :start', { start })
        .getMany(),
    ]);

    const acceptedByDay = new Map<string, number>();
    for (const action of actions) {
      if (!HELPDESK_REVIEW_ACTION_CAPABILITIES.includes(action.capability_name)) continue;
      // Agent-attributed rows only, mirroring the SQL path: definitionless
      // diagnostic/mock-triage actions must not pollute the evaluation trend.
      const actionDefinitionId = stringFromMetadata(metadataObject(action.metadata_json).agent_definition_id);
      if (!actionDefinitionId) continue;
      if (agentDefinitionId && actionDefinitionId !== agentDefinitionId) continue;
      if (!withinDateRange(action.created_at, start, end)) continue;
      const key = dateKey(action.created_at instanceof Date ? action.created_at : new Date(action.created_at));
      const row = byDay.get(key);
      if (!row) continue;
      row.proposals += 1;
      if (action.status === 'executed') {
        row.decided += 1;
        row.executed += 1;
        acceptedByDay.set(key, (acceptedByDay.get(key) ?? 0) + 1);
      } else if (action.status === 'rejected') {
        row.decided += 1;
      } else if (action.status === 'dismissed') {
        row.dismissed += 1;
      }
    }
    for (const run of runs) {
      if (agentDefinitionId && stringFromMetadata(metadataObject(run.metadata_json).agent_definition_id) !== agentDefinitionId) continue;
      if (!withinDateRange(run.created_at, start, end)) continue;
      const key = dateKey(run.created_at instanceof Date ? run.created_at : new Date(run.created_at));
      const row = byDay.get(key);
      if (!row) continue;
      const usage = { tokens: 0, cost: 0 };
      addEstimatedUsage(usage, run);
      row.tokens += usage.tokens;
      row.costEur += usage.cost;
    }
    for (const [key, row] of byDay) {
      row.tokens = Math.round(row.tokens);
      row.costEur = Number(row.costEur.toFixed(6));
      row.acceptanceRate = row.decided > 0
        ? Number(((acceptedByDay.get(key) ?? 0) / row.decided).toFixed(4))
        : null;
    }
    return { days: Array.from(byDay.values()) };
  }

  /**
   * What every agent of this tenant cost in LLM calls today and over the
   * trailing 7 days. Fleet-wide on purpose: it covers desk AND SRE agents, so
   * it is keyed on "the run carries an agent definition id" rather than on the
   * agent type (which would silently drop SRE). Chat/MCP runs carry no agent
   * definition id and are excluded.
   *
   * Aggregated in SQL (one scan of the 7-day window, no per-agent query, no
   * N+1) and tenant-filtered explicitly on top of RLS. The in-memory fallback
   * exists for the unit-test manager, which has no raw `query`.
   */
  private async agentCostTotals(
    context: AiExecutionContextWithManager,
    now = new Date(),
  ): Promise<{ today_eur: number; last_7_days_eur: number }> {
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const windowStart = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
    const runCostSql = "COALESCE((cost_json ->> 'estimated_cost_eur')::numeric, (cost_json ->> 'total_cost_eur')::numeric, (cost_json ->> 'total_cost')::numeric, 0)";
    if (typeof (context.manager as unknown as { query?: unknown }).query === 'function') {
      const rows = await context.manager.query(
        `
          SELECT
            COALESCE(SUM(${runCostSql}) FILTER (WHERE created_at >= $2), 0)::float AS today_eur,
            COALESCE(SUM(${runCostSql}), 0)::float AS last_7_days_eur
          FROM ai_runs
          WHERE tenant_id = $1
            AND created_at >= $3
            AND metadata_json ->> 'agent_definition_id' IS NOT NULL
        `,
        [context.tenantId, todayStart, windowStart],
      ) as Array<Record<string, unknown>>;
      const row = rows[0] ?? {};
      return {
        today_eur: Number(numericMetadata(row.today_eur).toFixed(6)),
        last_7_days_eur: Number(numericMetadata(row.last_7_days_eur).toFixed(6)),
      };
    }
    const runs = await context.manager.getRepository(AiRun).find({ where: { tenant_id: context.tenantId } });
    let today = 0;
    let week = 0;
    for (const run of runs) {
      if (!stringFromMetadata(metadataObject(run.metadata_json).agent_definition_id)) continue;
      const created = run.created_at instanceof Date ? run.created_at : new Date(run.created_at ?? run.started_at);
      if (!Number.isFinite(created.getTime()) || created < windowStart) continue;
      const cost = metadataObject(run.cost_json);
      const value = numericMetadata(cost.estimated_cost_eur ?? cost.total_cost_eur ?? cost.total_cost);
      week += value;
      if (created >= todayStart) today += value;
    }
    return {
      today_eur: Number(today.toFixed(6)),
      last_7_days_eur: Number(week.toFixed(6)),
    };
  }

  async getQueueOverview(context: AiExecutionContextWithManager, options: { limit?: number } = {}) {
    if (!this.agentQueue) {
      return {
        definitions: [],
        work_items: [],
        target_states: [],
        action_requests: [],
        target_links: [],
        monitoring_diagnoses: [],
        counts: {} as Record<string, number>,
        cost: { today_eur: 0, last_7_days_eur: 0 },
        helpdesk: { summary: null, summaries: [], fleet: null, audit_events: [] },
        emergency_pause: null,
      };
    }
    const overview = await this.agentQueue.listOverview(context, { limit: safeLimit(options.limit, 50, 100) });
    const actionIds = new Set<string>();
    const runIds = new Set<string>();
    for (const workItem of overview.workItems) {
      for (const id of workItem.last_action_request_ids ?? []) {
        if (typeof id === 'string' && id.length > 0) {
          actionIds.add(id);
        }
      }
      if (typeof workItem.last_run_id === 'string' && workItem.last_run_id.length > 0) {
        runIds.add(workItem.last_run_id);
      }
    }
    for (const state of overview.targetStates) {
      const stateJson = isRecord(state.state_json) ? state.state_json : null;
      const latestIds = Array.isArray(stateJson?.latest_action_request_ids) ? stateJson.latest_action_request_ids : [];
      for (const id of latestIds) {
        if (typeof id === 'string' && id.length > 0) {
          actionIds.add(id);
        }
      }
      if (typeof state.last_run_id === 'string' && state.last_run_id.length > 0) {
        runIds.add(state.last_run_id);
      }
    }
    const [linkedActionRequests, runActionRequests] = await Promise.all([
      actionIds.size > 0
        ? context.manager.getRepository(AiActionRequest).find({
          where: {
            tenant_id: context.tenantId,
            id: In(Array.from(actionIds)),
          },
        })
        : Promise.resolve([]),
      runIds.size > 0
        ? context.manager.getRepository(AiActionRequest).find({
          where: {
            tenant_id: context.tenantId,
            run_id: In(Array.from(runIds)),
          },
        })
        : Promise.resolve([]),
    ]);
    const actionRequests = Array.from(new Map([
      ...linkedActionRequests,
      ...runActionRequests,
    ].map((action) => [action.id, action])).values());
    const readiness = await this.executionReadinessForActions(context, actionRequests);
    const agentLinks = await this.agentLinksForActions(context, actionRequests);
    const ticketRefsByProvider = new Map<string, Set<string>>();
    const collectTicketRef = (
      providerKind: string | null | undefined,
      providerKey: string | null | undefined,
      targetType: string | null | undefined,
      targetRef: string | null | undefined,
    ) => {
      if (providerKind !== 'ticketing' || targetType !== 'ticket') return;
      if (typeof providerKey !== 'string' || providerKey.length === 0) return;
      if (typeof targetRef !== 'string' || targetRef.length === 0) return;
      const refs = ticketRefsByProvider.get(providerKey) ?? new Set<string>();
      refs.add(targetRef);
      ticketRefsByProvider.set(providerKey, refs);
    };
    for (const workItem of overview.workItems) {
      collectTicketRef(workItem.source_provider_kind, workItem.source_provider_key, workItem.source_object_type, workItem.source_object_ref);
    }
    for (const state of overview.targetStates) {
      collectTicketRef(state.provider_kind, state.provider_key, state.target_type, state.target_ref);
    }
    for (const action of actionRequests) {
      collectTicketRef(action.provider_kind, action.provider_key, action.target_type, action.target_ref);
    }
    const [targetLinks, cost] = await Promise.all([
      this.resolveTicketTargetLinks(context, ticketRefsByProvider),
      this.agentCostTotals(context),
    ]);
    // Per-agent earned-autonomy summary for the fleet view: which action classes run
    // automatically (an enabled agent-autonomy policy). One query, grouped by agent.
    const automaticByDefinition = new Map<string, string[]>();
    if (overview.definitions.length > 0) {
      const autonomyPolicies = await context.manager.getRepository(AiApprovalPolicy).find({
        where: { tenant_id: context.tenantId, enabled: true, status: 'enabled' },
      });
      for (const policy of autonomyPolicies) {
        if (isAgentAutonomyPolicyMetadata(policy.metadata_json)) {
          const list = automaticByDefinition.get(policy.metadata_json.agent_definition_id) ?? [];
          if (!list.includes(policy.metadata_json.action_class)) {
            list.push(policy.metadata_json.action_class);
          }
          automaticByDefinition.set(policy.metadata_json.agent_definition_id, list);
        }
      }
    }
    return {
      definitions: overview.definitions.map((definition) => ({
        ...serializeAgentDefinition(definition),
        automatic_action_classes: automaticByDefinition.get(definition.id) ?? [],
      })),
      work_items: overview.workItems.map(serializeAgentWorkItem),
      target_states: overview.targetStates.map(serializeAgentTargetState),
      action_requests: actionRequests.map((action) => serializeActionRequest(action, readiness.get(action.id), agentLinks.get(action.id))),
      target_links: targetLinks,
      monitoring_diagnoses: overview.monitoringDiagnoses,
      counts: overview.counts,
      cost,
      helpdesk: {
        summary: overview.helpdesk.summary,
        summaries: overview.helpdesk.summaries,
        fleet: overview.helpdesk.fleet,
        audit_events: overview.helpdesk.auditEvents.map(serializeAgentAuditEvent),
      },
      emergency_pause: null,
    };
  }

  // Human-facing deep links into the external ticketing UI for the queue's
  // tickets, resolved per provider at read time (nothing stored). Links are
  // cosmetic: any provider or config failure just leaves tickets unlinked.
  private async resolveTicketTargetLinks(
    context: AiExecutionContextWithManager,
    ticketRefsByProvider: Map<string, Set<string>>,
  ): Promise<Array<{ provider_kind: string; provider_key: string; target_type: string; target_ref: string; url: string }>> {
    const links: Array<{ provider_kind: string; provider_key: string; target_type: string; target_ref: string; url: string }> = [];
    for (const [providerKey, refs] of ticketRefsByProvider) {
      try {
        const provider = await this.providers.ticketing(context, providerKey);
        if (typeof provider.getTicketWebUrls !== 'function') continue;
        const urls = await provider.getTicketWebUrls(context, { ticketRefs: Array.from(refs) });
        for (const [ref, url] of Object.entries(urls)) {
          if (url) {
            links.push({ provider_kind: 'ticketing', provider_key: providerKey, target_type: 'ticket', target_ref: ref, url });
          }
        }
      } catch {
        // Cosmetic feature: never fail the queue read over a broken link source.
      }
    }
    return links;
  }

  async getHelpdeskWorkItemContext(context: AiExecutionContextWithManager, workItemId: string) {
    const workItem = await context.manager.getRepository(AiAgentWorkItem).findOne({
      where: {
        id: workItemId,
        tenant_id: context.tenantId,
      },
    });
    if (!workItem) {
      throw new NotFoundException('Agent work item not found.');
    }
    if (
      workItem.source_provider_kind !== 'ticketing'
      || workItem.source_object_type !== 'ticket'
    ) {
      throw new BadRequestException('Helpdesk context is only available for ticketing work items.');
    }

    const definition = await context.manager.getRepository(AiAgentDefinition).findOne({
      where: {
        id: workItem.agent_definition_id,
        tenant_id: context.tenantId,
      },
    });
    if (!definition || definition.agent_type !== 'helpdesk') {
      throw new BadRequestException('Helpdesk context is only available for a helpdesk ticket triage agent.');
    }
    const binding = requireTicketingBinding(definition, 'Helpdesk context requires a ticketing provider binding.');
    if (
      workItem.source_provider_kind !== binding.providerKind
      || workItem.source_provider_key !== binding.providerKey
    ) {
      throw new BadRequestException('Helpdesk context work item provider does not match the agent ticketing binding.');
    }

    const targetState = await context.manager.getRepository(AiAgentTargetState).findOne({
      where: {
        tenant_id: context.tenantId,
        agent_definition_id: workItem.agent_definition_id,
        provider_kind: workItem.source_provider_kind,
        provider_key: workItem.source_provider_key,
        target_type: workItem.source_object_type,
        target_ref: workItem.source_object_ref,
      },
    });

    const metadata = {
      workflow: 'helpdesk_context_read',
      source: 'admin_ui',
      agent_definition_id: definition.id,
      agent_key: definition.agent_key,
      agent_work_item_id: workItem.id,
      agent_work_kind: workItem.work_kind,
      target_ref: workItem.source_object_ref,
      phase: 11,
    };
    let stepIndex = 1;
    let runId: string | undefined;
    const executeContextRead = async (capabilityName: string) => {
      const result = await this.dispatcher.execute(context, {
        capabilityName,
        input: {
          provider_key: workItem.source_provider_key,
          ticket_id: workItem.source_object_ref,
        },
        execution: {
          surface: 'internal',
          trigger_kind: 'internal',
          runId,
          stepIndex: stepIndex++,
          metadata,
        },
      });
      runId = result.run_id;
      return {
        run_id: result.run_id,
        step_id: result.step_id,
        tool_execution_id: result.tool_execution_id,
        evidence_ids: await this.evidenceIdsForTool(context, result.tool_execution_id),
        output: result.output,
      };
    };

    const classification = await executeContextRead(TICKETING_CLASSIFICATION_CONTEXT_CAPABILITY);
    const lifecycle = await executeContextRead(TICKETING_LIFECYCLE_CONTEXT_CAPABILITY);
    const routing = await executeContextRead(TICKETING_ROUTING_CONTEXT_CAPABILITY);
    const participants = await executeContextRead(TICKETING_PARTICIPANT_CONTEXT_CAPABILITY);

    return {
      work_item: serializeAgentWorkItem(workItem),
      target_state: targetState ? serializeAgentTargetState(targetState) : null,
      run_id: runId ?? classification.run_id,
      classification,
      lifecycle,
      routing,
      participants,
    };
  }

  async runMockTriage(context: AiExecutionContextWithManager, input: AgentControlMockTriageInput = {}) {
    const providerKey = trimmedString(input.provider_key) ?? 'mock';
    if (providerKey !== 'mock') {
      throw new BadRequestException('The Agent Control Center mock triage endpoint is mock-only.');
    }
    const alertId = trimmedString(input.alert_id) ?? 'mock-alert-001';
    const ticketId = trimmedString(input.ticket_id) ?? 'mock-ticket-1001';
    const includeDirectory = input.include_directory !== false;

    const diagnostic = await this.diagnostics.runMockDiagnostic(context, {
      alert_id: alertId,
      provider_key: providerKey,
      include_directory: includeDirectory,
      user_id_or_email: trimmedString(input.user_id_or_email) ?? 'sap.operator@example.invalid',
      continue_on_provider_error: false,
    }, {
      surface: 'internal',
      trigger_kind: 'internal',
      metadata: {
        uat_workflow: 'agent_control_center_mock_triage',
        source: 'admin_ui',
      },
    });

    const runId = diagnostic.run_id;
    if (!runId) {
      throw new BadRequestException('Mock diagnostic did not create an AI run.');
    }
    const noteBody = trimmedString(input.note_body) ?? [
      '[KANAP mock triage]',
      `Alert: ${alertId}`,
      `Ticket: ${ticketId}`,
      `Run: ${runId}`,
      `Recommendation: ${diagnostic.recommendation_id}`,
      `Prepared at: ${new Date().toISOString()}`,
      'This internal note was prepared by the Agent Control Center and requires human approval before posting.',
    ].join('\n');

    const proposal = await this.diagnostics.proposeInternalNoteForRecommendation(context, {
      recommendation_id: diagnostic.recommendation_id,
      ticket_id: ticketId,
      provider_key: providerKey,
      note_body: noteBody,
    });

    return {
      diagnostic,
      proposal,
      detail: await this.getRunDetail(context, proposal.run_id ?? runId),
    };
  }

  async listGlpiReadTargets(context: AiExecutionContextWithManager) {
    return this.listTicketingReadTargets(context, { provider_key: LEGACY_GLPI_TICKETING_PROVIDER_KEY });
  }

  async listTicketingReadTargets(
    context: AiExecutionContextWithManager,
    input: Pick<AgentControlTicketingReadInput, 'provider_key'> = {},
  ) {
    const providerKey = trimmedString(input.provider_key);
    if (!providerKey) {
      throw new BadRequestException('provider_key is required for ticketing read targets.');
    }
    const [targets, applicability] = await Promise.all([
      this.liveTargets.findEnabledTargets(context, {
        providerKind: 'ticketing',
        providerKey,
        allowedEffect: 'read',
        targetKind: 'ticket',
      }),
      this.providers.getApplicability(context, 'ticketing', providerKey),
    ]);

    return {
      provider: {
        provider_kind: 'ticketing',
        provider_key: providerKey,
        available: applicability.available,
        reason_code: applicability.reasonCode ?? null,
        message: applicability.message ?? null,
      },
      items: targets.map(serializeLiveTarget),
      ready: applicability.available && targets.length === 1,
    };
  }

  private async executeAutomaticPreparedActions(
    context: AiExecutionContextWithManager,
    input: {
      definition: AiAgentDefinition | null;
      actions: AiActionRequest[];
      baseMetadata: Record<string, unknown>;
      runId: string;
      stepIndex: number;
    },
  ): Promise<{
    executions: Array<{
      action_request_id: string;
      action_class: string;
      status: 'executed' | 'skipped' | 'failed';
      tool_execution_id: string | null;
      error_message: string | null;
    }>;
    nextStepIndex: number;
  }> {
    if (!input.definition || input.actions.length === 0) {
      return { executions: [], nextStepIndex: input.stepIndex };
    }
    const autonomyRows = await this.autonomyRowsForDefinition(context, input.definition);
    await this.demoteUnsafeAutomaticRows(context, input.definition, autonomyRows);
    const policies = await context.manager.getRepository(AiApprovalPolicy).find({
      where: { tenant_id: context.tenantId },
      order: { policy_version: 'DESC' },
    });
    const policyEnabledForClass = (className: string) => policies.some((policy) =>
      policy.enabled
      && policy.status === 'enabled'
      && isAgentAutonomyPolicyMetadata(policy.metadata_json)
      && policy.metadata_json.agent_definition_id === input.definition?.id
      && policy.metadata_json.action_class === className);
    const executions: Array<{
      action_request_id: string;
      action_class: string;
      status: 'executed' | 'skipped' | 'failed';
      tool_execution_id: string | null;
      error_message: string | null;
    }> = [];
    let stepIndex = input.stepIndex;
    for (const action of input.actions) {
      const className = actionClass(action);
      // Hard safety boundary: terminal solve/close is destructive and stays
      // human-approved even when 'status' autonomy is automatic.
      const terminalStatus = isTerminalStatusAction(action);
      if (terminalStatus || !isAutomatableAutonomyActionClass(className) || !policyEnabledForClass(className)) {
        executions.push({
          action_request_id: action.id,
          action_class: className,
          status: 'skipped',
          tool_execution_id: null,
          error_message: terminalStatus ? 'terminal_status_requires_approval' : null,
        });
        continue;
      }
      try {
        const result = await this.dispatcher.execute(context, {
          capabilityName: action.capability_name,
          input: { action_request_id: action.id },
          execution: {
            surface: 'internal',
            trigger_kind: 'internal',
            runId: input.runId,
            stepIndex: stepIndex++,
            metadata: {
              ...input.baseMetadata,
              triage_action: 'automatic_execution',
              agent_autonomy_automatic: true,
              action_request_id: action.id,
              action_class: className,
            },
          },
        });
        executions.push({
          action_request_id: action.id,
          action_class: className,
          status: 'executed',
          tool_execution_id: result.tool_execution_id,
          error_message: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || 'Automatic execution failed.');
        await this.recordAgentAuditEvent(context, {
          agentDefinitionId: input.definition.id,
          eventType: 'agent_autonomy_execution_failed',
          severity: 'warning',
          message: `Automatic execution failed for ${className}.`,
          metadata: {
            action_request_id: action.id,
            action_class: className,
            run_id: input.runId,
            error_message: message,
          },
        });
        executions.push({
          action_request_id: action.id,
          action_class: className,
          status: 'failed',
          tool_execution_id: null,
          error_message: message,
        });
      }
    }
    return { executions, nextStepIndex: stepIndex };
  }

  async runGlpiRead(context: AiExecutionContextWithManager, input: Pick<AgentControlTicketingReadInput, 'target_key'> = {}) {
    return this.runTicketingRead(context, {
      provider_key: LEGACY_GLPI_TICKETING_PROVIDER_KEY,
      target_key: input.target_key,
    }, {
      workflow: 'agent_control_center_glpi_read',
      unavailableMessage: 'GLPI provider is unavailable',
    });
  }

  async runTicketingRead(
    context: AiExecutionContextWithManager,
    input: AgentControlTicketingReadInput = {},
    options: { workflow?: string; unavailableMessage?: string } = {},
  ) {
    const providerKey = trimmedString(input.provider_key);
    if (!providerKey) {
      throw new BadRequestException('provider_key is required for ticketing read.');
    }
    const target = await this.liveTargets.requireSingleEnabledTarget(context, {
      providerKind: 'ticketing',
      providerKey,
      allowedEffect: 'read',
      targetKind: 'ticket',
      targetKey: trimmedString(input.target_key),
    });

    const applicability = await this.providers.getApplicability(context, 'ticketing', providerKey);
    if (!applicability.available) {
      throw new ForbiddenException(`${options.unavailableMessage ?? 'Ticketing provider is unavailable'}: ${applicability.message ?? applicability.reasonCode ?? 'not ready'}.`);
    }

    const result = await this.dispatcher.execute(context, {
      capabilityName: 'ticketing.ticket.get',
      input: {
        provider_key: target.provider_key,
        ticket_id: target.external_ref,
      },
      execution: {
        surface: 'internal',
        trigger_kind: 'internal',
        metadata: {
          uat_workflow: options.workflow ?? 'agent_control_center_ticketing_read',
          source: 'admin_ui',
          live_target_id: target.id,
          live_target_key: target.target_key,
          live_target_environment: target.environment,
          safety_label: target.safety_label,
        },
      },
    });

    return {
      target: serializeLiveTarget(target),
      result,
      detail: await this.getRunDetail(context, result.run_id),
    };
  }

  async runTicketingTriage(context: AiExecutionContextWithManager, input: AgentControlTicketingTriageInput = {}) {
    const workItemId = trimmedString(input.work_item_id);
    if (workItemId) {
      return this.runHelpdeskTicketingTriage(context, { work_item_id: workItemId }, TICKETING_TRIAGE_RUN_OPTIONS);
    }
    const providerKey = trimmedString(input.provider_key);
    if (!providerKey) {
      throw new BadRequestException('provider_key is required for manual ticketing triage.');
    }
    return this.runHelpdeskTicketingTriage(context, {
      provider_key: providerKey,
      target_key: input.target_key,
      agent_definition_id: input.agent_definition_id,
    }, TICKETING_TRIAGE_RUN_OPTIONS);
  }

  // Deterministic monitoring-diagnosis skeleton (WS-A6). No LLM calls, no
  // recommendations, no built-in quota reservation yet — IMPL-4 replaces the
  // marked seam with the full diagnosis pipeline while keeping the
  // work-item/claim/target-state finalization contract intact.
  // Stored-dossier read for the Monitor tab: the diagnoses the agent already
  // produced for one watched monitoring target, newest first. Read-only —
  // review surface, no provider calls.
  async listMonitoringAlertDiagnoses(
    context: AiExecutionContextWithManager,
    input: { agent_definition_id: string; target_ref: string; limit?: number },
  ) {
    const definitionId = trimmedString(input.agent_definition_id);
    const targetRef = trimmedString(input.target_ref);
    if (!definitionId || !targetRef) {
      throw new BadRequestException('agent_definition_id and target_ref are required.');
    }
    const definition = await context.manager.getRepository(AiAgentDefinition).findOne({
      where: { id: definitionId, tenant_id: context.tenantId },
    });
    if (!definition) {
      throw new NotFoundException('Agent definition was not found.');
    }
    const limit = Math.max(1, Math.min(10, Math.floor(input.limit ?? 5)));
    const observations = await context.manager.getRepository(AiObservation)
      .createQueryBuilder('observation')
      .where('observation.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('observation.observation_type = :observationType', { observationType: MONITORING_DIAGNOSIS_RUN_OPTIONS.observationType })
      .andWhere('observation.source_object_id = :targetRef', { targetRef })
      .andWhere("observation.metadata_json->>'agent_definition_id' = :definitionId", { definitionId })
      .orderBy('observation.created_at', 'DESC')
      .take(limit)
      .getMany();
    return { diagnoses: observations.map((observation) => serializeMonitoringAlertDiagnosis(observation)) };
  }

  async runMonitoringDiagnosis(
    context: AiExecutionContextWithManager,
    input: AgentControlMonitoringDiagnosisInput = {},
  ) {
    if (!this.agentQueue) {
      throw new ForbiddenException('Agent work queue is required to run monitoring diagnosis.');
    }
    const workItemId = trimmedString(input.work_item_id);
    if (workItemId) {
      return this.runMonitoringDiagnosisForWorkItem(context, workItemId);
    }
    const definitionId = trimmedString(input.agent_definition_id);
    const alertId = trimmedString(input.alert_id);
    if (!definitionId || !alertId) {
      throw new BadRequestException('agent_definition_id and alert_id are required for a manual monitoring diagnosis test.');
    }
    const definition = await context.manager.getRepository(AiAgentDefinition).findOne({
      where: { id: definitionId, tenant_id: context.tenantId },
    });
    if (!definition) {
      throw new NotFoundException('Agent definition not found.');
    }
    this.agentQueue.assertSreMonitoringDefinitionRunnable(definition);
    const binding = requireMonitoringBinding(definition, 'Monitoring diagnosis requires a monitoring provider binding.');
    const applicability = await this.providers.getApplicability(context, binding.providerKind, binding.providerKey);
    if (!applicability.available) {
      throw new ForbiddenException(`Monitoring provider is unavailable: ${applicability.message ?? applicability.reasonCode ?? 'not ready'}.`);
    }
    // Direct provider read before enqueue: the occurrence-scoped dedup key
    // needs the live occurrence timestamp. The queued run re-reads the alert
    // through the audited dispatcher capability below.
    const provider = await this.providers.monitoring(context, binding.providerKey);
    const fetched = await provider.getAlert(context, { alertId });
    const alert = adapterData<MonitoringAlertLike>(fetched);
    if (!alert) {
      throw new BadRequestException(adapterFailureMessage(fetched) ?? 'Monitoring alert read did not return alert data.');
    }
    const enqueued = await this.agentQueue.enqueueMonitoringScopedAlert(context, {
      definition,
      // Operator-run test on a single alert: allowed in Manual run mode.
      trigger: 'manual',
      alert: {
        id: alert.id,
        status: alert.status ?? null,
        severity: alert.severity ?? null,
        deviceName: alert.deviceName ?? null,
        occurrenceStartedAt: alert.occurrenceStartedAt ?? null,
        observedAt: alert.observedAt ?? null,
        sourceUri: alert.sourceUri ?? null,
      },
      dedupKey: monitoringAlertDedupKey(binding.providerKey, alert.id, alert.occurrenceStartedAt ?? null),
      metadata: {
        source: 'manual_diagnosis_test',
        source_endpoint: MONITORING_DIAGNOSIS_RUN_OPTIONS.sourceEndpoint,
      },
    });
    return this.runMonitoringDiagnosisForWorkItem(context, enqueued.workItem.id);
  }

  private async runMonitoringDiagnosisForWorkItem(
    context: AiExecutionContextWithManager,
    workItemId: string,
  ) {
    if (!this.agentQueue) {
      throw new ForbiddenException('Agent work queue is required to run monitoring diagnosis.');
    }
    const queuedWorkItem = await context.manager.getRepository(AiAgentWorkItem).findOne({
      where: { id: workItemId, tenant_id: context.tenantId },
    });
    if (!queuedWorkItem) {
      throw new NotFoundException('Agent work item not found.');
    }
    if (queuedWorkItem.source_provider_kind !== 'monitoring' || queuedWorkItem.source_object_type !== 'sensor') {
      throw new BadRequestException('Queued monitoring diagnosis work item must target a monitoring sensor.');
    }
    const definition = await context.manager.getRepository(AiAgentDefinition).findOne({
      where: { id: queuedWorkItem.agent_definition_id, tenant_id: context.tenantId },
    });
    if (!definition) {
      throw new ForbiddenException('Queued monitoring diagnosis work item has no tenant-scoped agent definition.');
    }
    this.agentQueue.assertSreMonitoringDefinitionRunnable(definition);
    const binding = requireMonitoringBinding(definition, 'Queued monitoring diagnosis requires a monitoring provider binding.');
    if (
      queuedWorkItem.source_provider_kind !== binding.providerKind
      || queuedWorkItem.source_provider_key !== binding.providerKey
    ) {
      throw new BadRequestException('Queued monitoring diagnosis work item provider does not match the agent monitoring binding.');
    }
    // Lets the LLM client resolve this agent's assigned registry model for
    // every downstream stage without threading the definition through them.
    context.agentId = definition.id;
    // Assigned model's €/Mtok prices for pre-flight cost projections (null = free).
    const llmPrices = (await this.llmClient?.resolvePrices(context)) ?? null;
    let leasedWorkItem = await this.agentQueue.acquireWorkItem(context, queuedWorkItem.id, {
      leaseOwner: `sre-monitoring-diagnosis:${context.userId || 'system'}`,
    });
    const agentMetadata = this.agentQueue.agentExecutionMetadata(definition, leasedWorkItem);
    const baseMetadata = {
      uat_workflow: MONITORING_DIAGNOSIS_RUN_OPTIONS.workflow,
      source: 'agent_control_center',
      provider_key: binding.providerKey,
      ...agentMetadata,
    };
    try {
      const applicability = await this.providers.getApplicability(context, binding.providerKind, binding.providerKey);
      if (!applicability.available) {
        throw new ForbiddenException(`Monitoring provider is unavailable: ${applicability.message ?? applicability.reasonCode ?? 'not ready'}.`);
      }

      let stepIndex = 1;
      const allEvidenceIds: string[] = [];
      const alertResult = await this.dispatcher.execute<AdapterResultLike<MonitoringAlertLike>>(context, {
        capabilityName: 'monitoring.alert.get',
        input: {
          provider_key: binding.providerKey,
          alert_id: leasedWorkItem.source_object_ref,
        },
        execution: {
          surface: 'internal',
          trigger_kind: 'internal',
          stepIndex: stepIndex++,
          metadata: baseMetadata,
        },
      });
      leasedWorkItem = await this.agentQueue.markRunning(context, leasedWorkItem, alertResult.run_id);
      allEvidenceIds.push(...await this.evidenceIdsForTool(context, alertResult.tool_execution_id));
      const alert = adapterData<MonitoringAlertLike>(alertResult.output);
      const alertReadNotFound = !alert
        && !!alertResult.output
        && alertResult.output.ok === false
        && alertResult.output.errorCode === 'not_found';
      if (!alert && !alertReadNotFound) {
        throw new BadRequestException(adapterFailureMessage(alertResult.output) ?? 'Monitoring alert read did not return alert data.');
      }

      // Escalation path: an alert that already cleared (back up) or no longer
      // exists completes with an 'alert_cleared' outcome — no further provider
      // reads, no quota reservation, no LLM spend.
      if (!alert || String(alert.status ?? '').trim().toLowerCase() === 'up') {
        const clearedSnapshot = {
          id: alert?.id ?? leasedWorkItem.source_object_ref,
          status: alert?.status ?? 'up',
          severity: alert?.severity ?? null,
          deviceName: alert?.deviceName ?? null,
          // The occurrence is over — mirrors the poller's clearance re-arm.
          occurrenceStartedAt: null,
          observedAt: alert?.observedAt ?? null,
          sourceUri: alert?.sourceUri ?? null,
        };
        const outcome = await this.agentQueue.recordMonitoringDiagnosisOutcome(context, {
          definition,
          workItem: leasedWorkItem,
          runId: alertResult.run_id,
          alert: clearedSnapshot,
          metadata: {
            outcome: 'alert_cleared',
            diagnosis_stage: 'alert_cleared',
          },
        });
        return {
          status: 'completed',
          agent_definition: serializeAgentDefinition(definition),
          work_item: serializeAgentWorkItem(outcome.workItem),
          target_state: serializeAgentTargetState(outcome.targetState),
          diagnostic: {
            run_id: alertResult.run_id,
            alert_tool_execution_id: alertResult.tool_execution_id,
            outcome: 'alert_cleared',
            diagnosis_stage: 'alert_cleared',
            alert: {
              id: clearedSnapshot.id,
              status: clearedSnapshot.status,
              severity: clearedSnapshot.severity,
              device_name: clearedSnapshot.deviceName,
            },
            evidence_ids: allEvidenceIds,
          },
        };
      }

      // On the built-in provider one diagnosis consumes one included message
      // (same unit as a chat message) — reserved after applicability and the
      // cleared-alert escape, before any LLM work (ticketing triage placement).
      await this.builtinQuota?.reserveRun(context);

      // PR #95 discipline: run-scoped ledger charged with ACTUAL per-stage
      // usage, never a whole-run snapshot estimate.
      const runLlmUsageLedger: RunLlmUsageEstimate = {
        estimatedTokens: 0,
        estimatedCostEur: 0,
      };
      const currentRunLlmUsage = (): RunLlmUsageEstimate => ({
        estimatedTokens: runLlmUsageLedger.estimatedTokens,
        estimatedCostEur: runLlmUsageLedger.estimatedCostEur,
      });
      const chargeRunLlmUsage = (usage: { estimated_tokens?: number | null; estimated_cost_eur?: number | null } | null | undefined) => {
        const estimatedTokens = Number(usage?.estimated_tokens ?? 0);
        const estimatedCostEur = Number(usage?.estimated_cost_eur ?? 0);
        if (Number.isFinite(estimatedTokens) && estimatedTokens > 0) {
          runLlmUsageLedger.estimatedTokens += Math.round(estimatedTokens);
        }
        if (Number.isFinite(estimatedCostEur) && estimatedCostEur > 0) {
          runLlmUsageLedger.estimatedCostEur = Number((runLlmUsageLedger.estimatedCostEur + estimatedCostEur).toFixed(6));
        }
      };

      // Bounded history window through the existing dispatcher capability,
      // digested deterministically before any LLM sees it.
      const historyResult = await this.dispatcher.execute<AdapterResultLike<{ points?: unknown[] }>>(context, {
        capabilityName: 'monitoring.sensor.history',
        input: {
          provider_key: binding.providerKey,
          sensor_id: leasedWorkItem.source_object_ref,
          window_minutes: MONITORING_HISTORY_WINDOW_MINUTES,
        },
        execution: {
          surface: 'internal',
          trigger_kind: 'internal',
          runId: alertResult.run_id,
          stepIndex: stepIndex++,
          metadata: {
            ...baseMetadata,
            diagnosis_action: 'read_sensor_history',
          },
        },
      });
      allEvidenceIds.push(...await this.evidenceIdsForTool(context, historyResult.tool_execution_id));
      const history = adapterData<{ metric?: string; unit?: string; windowMinutes?: number; points?: unknown[] }>(historyResult.output);
      const historySummary = summarizeMonitoringHistory(history, MONITORING_HISTORY_WINDOW_MINUTES);
      const historyPointCount = historySummary?.channels.reduce((sum, channel) => sum + channel.point_count, 0) ?? 0;

      // Current state + related alerts through dispatcher capabilities so the
      // whole evidence chain is audited (WS-A8 replaces the skeleton's direct
      // provider reads). Both are best-effort: a failed read degrades to
      // missing evidence, never a failed diagnosis.
      let currentState: { status: string | null; value: number | string | null; unit: string | null; observed_at: string | null } | null = null;
      const stateResult = await this.dispatcher.execute<AdapterResultLike<{ status?: string | null; value?: unknown; unit?: string | null; observedAt?: string | null }>>(context, {
        capabilityName: 'monitoring.state.get',
        input: {
          provider_key: binding.providerKey,
          sensor_id: leasedWorkItem.source_object_ref,
        },
        execution: {
          surface: 'internal',
          trigger_kind: 'internal',
          runId: alertResult.run_id,
          stepIndex: stepIndex++,
          metadata: {
            ...baseMetadata,
            diagnosis_action: 'read_current_state',
          },
        },
      });
      allEvidenceIds.push(...await this.evidenceIdsForTool(context, stateResult.tool_execution_id));
      const stateData = adapterData<{ status?: string | null; value?: unknown; unit?: string | null; observedAt?: string | null }>(stateResult.output);
      if (stateData) {
        currentState = {
          status: stateData.status ?? null,
          value: typeof stateData.value === 'number' || typeof stateData.value === 'string' ? stateData.value : null,
          unit: stateData.unit ?? null,
          observed_at: stateData.observedAt ?? null,
        };
      }
      const relatedResult = await this.dispatcher.execute<AdapterResultLike<{ alerts?: unknown[] }>>(context, {
        capabilityName: 'monitoring.alert.related.list',
        input: {
          provider_key: binding.providerKey,
          sensor_id: leasedWorkItem.source_object_ref,
          limit: MAX_MONITORING_RELATED_ALERTS,
        },
        execution: {
          surface: 'internal',
          trigger_kind: 'internal',
          runId: alertResult.run_id,
          stepIndex: stepIndex++,
          metadata: {
            ...baseMetadata,
            diagnosis_action: 'read_related_alerts',
          },
        },
      });
      allEvidenceIds.push(...await this.evidenceIdsForTool(context, relatedResult.tool_execution_id));
      const relatedData = adapterData<{ alerts?: unknown[] }>(relatedResult.output);
      const relatedAlerts = compactRelatedMonitoringAlerts(relatedData?.alerts, alert.id);
      const relatedAlertIds = relatedAlerts.map((entry) => entry.id);

      // KANAP entity enrichment per the retrieval-source policy (§4.5): every
      // lookup flows through the dispatcher via the resolver's dispatch
      // callback; denied/unavailable families degrade to notes, never errors.
      const knowledgeSources = readAgentKnowledgeSources(definition);

      // One bounded monitored-object read resolves the device host address so
      // the KANAP asset correlation can apply the documented IP-equality
      // tiebreak on ambiguous device names (§4.5 matching rule). Fetched only
      // when asset correlation is actually on AND the adapter attached the
      // device object id on the alert (`deviceId` — PRTG carries the sensor
      // row's parentid). Without a device id the read is skipped entirely:
      // querying with the CHECK object id would be a guaranteed not_found on
      // adapters whose device lookups are id-exact (two wasted provider
      // requests per diagnosis), so the correlation degrades to name-only
      // matching instead. Best-effort like every enrichment source: a failed
      // read also degrades to name-only matching, never a failed diagnosis.
      let deviceHostAddress: string | null = null;
      const deviceObjectId = trimmedString(alert.deviceId);
      if (
        knowledgeSources.kanapData.enabled
        && knowledgeSources.kanapData.domains.assets
        && (alert.deviceName ?? '').trim()
        && deviceObjectId
      ) {
        try {
          const objectResult = await this.dispatcher.execute<AdapterResultLike<{ hostAddress?: string | null }>>(context, {
            capabilityName: 'monitoring.object.get',
            input: {
              provider_key: binding.providerKey,
              object_id: deviceObjectId,
            },
            execution: {
              surface: 'internal',
              trigger_kind: 'internal',
              runId: alertResult.run_id,
              stepIndex: stepIndex++,
              metadata: {
                ...baseMetadata,
                diagnosis_action: 'read_monitored_object',
              },
            },
          });
          allEvidenceIds.push(...await this.evidenceIdsForTool(context, objectResult.tool_execution_id));
          const objectData = adapterData<{ hostAddress?: string | null }>(objectResult.output);
          deviceHostAddress = trimmedString(objectData?.hostAddress);
        } catch (error) {
          this.logger.warn(`Monitored-object read skipped for alert ${alert.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      const entityResolver = new KanapEntityContextResolver({
        dispatch: async (dispatchContext, capabilityName, capabilityInput): Promise<KanapEntityDispatchOutcome> => {
          try {
            const result = await this.dispatcher.execute<Record<string, unknown>>(dispatchContext, {
              capabilityName,
              input: capabilityInput,
              execution: {
                surface: 'internal',
                trigger_kind: 'internal',
                runId: alertResult.run_id,
                stepIndex: stepIndex++,
                metadata: {
                  ...baseMetadata,
                  diagnosis_action: 'kanap_entity_lookup',
                  entity_capability: capabilityName,
                },
              },
            });
            allEvidenceIds.push(...await this.evidenceIdsForTool(dispatchContext, result.tool_execution_id));
            return { ok: true, output: result.output };
          } catch (error) {
            // Resolver contract: never rethrow. A denied or failing family is
            // "source unavailable" in the resolution notes, not a run failure.
            const message = error instanceof Error ? error.message : String(error);
            if (error instanceof ForbiddenException) {
              return { ok: false, errorKind: 'missing_permission', message };
            }
            if (error instanceof NotFoundException) {
              return { ok: false, errorKind: 'unavailable', message };
            }
            return { ok: false, errorKind: 'error', message };
          }
        },
      });
      const kanapContext = await entityResolver.resolveAlertContext({
        context,
        alert: { deviceName: alert.deviceName ?? null, hostAddress: deviceHostAddress },
        kanapData: knowledgeSources.kanapData,
      });
      const entitySources: ReplySynthesisEntitySource[] = kanapContext.sources.map((source) => ({
        ref: source.ref,
        url: source.url,
        title: source.label,
      }));

      // Similar-ticket context when (and only when) this SRE agent carries an
      // optional ticketing binding (D6); skipped silently when unbound.
      const ticketingBinding = resolveTicketingBinding(definition);
      const retrievalQueryCandidates = buildMonitoringRetrievalQueryCandidates(alert, historySummary);
      let similarTickets: Array<{ id: string; title: string; status: string | null }> = [];
      let similarTicketsStatus: string = ticketingBinding ? 'executed' : 'no_ticketing_binding';
      if (ticketingBinding) {
        const similarQuery = retrievalQueryCandidates[0] ?? '';
        if (!similarQuery) {
          similarTicketsStatus = 'skipped_empty_query';
        } else {
          try {
            const similarResult = await this.dispatcher.execute<AdapterResultLike<{ tickets?: unknown[] }>>(context, {
              capabilityName: 'ticketing.ticket.search_similar',
              input: {
                provider_key: ticketingBinding.providerKey,
                query: similarQuery,
                limit: MAX_MONITORING_SIMILAR_TICKETS,
              },
              execution: {
                surface: 'internal',
                trigger_kind: 'internal',
                runId: alertResult.run_id,
                stepIndex: stepIndex++,
                metadata: {
                  ...baseMetadata,
                  diagnosis_action: 'search_similar_tickets',
                },
              },
            });
            allEvidenceIds.push(...await this.evidenceIdsForTool(context, similarResult.tool_execution_id));
            const ticketsData = adapterData<{ tickets?: unknown[] }>(similarResult.output);
            similarTickets = (Array.isArray(ticketsData?.tickets) ? ticketsData.tickets : [])
              .filter(isRecord)
              .map((ticket) => ({
                id: trimmedString(ticket.id) ?? '',
                title: clampText(typeof ticket.title === 'string' ? ticket.title : '', 200),
                status: trimmedString(ticket.status),
              }))
              .filter((ticket) => !!ticket.id)
              .slice(0, MAX_MONITORING_SIMILAR_TICKETS);
          } catch (error) {
            similarTicketsStatus = 'failed';
            this.logger.warn(`Similar-ticket search skipped for alert ${alert.id}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      // Knowledge retrieval per policy — same dispatch contracts as the
      // ticketing flow (search_knowledge with the agent's library restriction,
      // get_document for top hits), but best-effort: for a monitoring
      // diagnosis every enrichment source is optional and the deterministic
      // alert evidence must survive any retrieval failure.
      const knowledgeQueryCandidates = knowledgeSources.knowledgeEnabled ? retrievalQueryCandidates : [];
      let knowledgeStatus: string = knowledgeSources.knowledgeEnabled ? 'executed' : 'disabled_by_agent';
      const knowledgeAttempts: Array<{ query: string; items: KnowledgeSearchItem[] }> = [];
      for (const [candidateIndex, knowledgeQuery] of knowledgeQueryCandidates.entries()) {
        try {
          const result = await this.dispatcher.execute<Record<string, unknown>>(context, {
            capabilityName: 'search_knowledge',
            input: {
              query: knowledgeQuery,
              limit: 5,
              offset: 0,
              ...(knowledgeSources.knowledgeLibraryIds ? { library_ids: knowledgeSources.knowledgeLibraryIds } : {}),
            },
            execution: {
              surface: 'internal',
              trigger_kind: 'internal',
              runId: alertResult.run_id,
              stepIndex: stepIndex++,
              metadata: {
                ...baseMetadata,
                knowledge_query_source: 'monitoring_alert',
                knowledge_query_index: candidateIndex + 1,
                knowledge_query_count: knowledgeQueryCandidates.length,
              },
            },
          });
          allEvidenceIds.push(...await this.evidenceIdsForTool(context, result.tool_execution_id));
          knowledgeAttempts.push({ query: knowledgeQuery, items: knowledgeItemsFromOutput(result.output) });
        } catch (error) {
          knowledgeStatus = 'failed';
          this.logger.warn(`Knowledge search skipped for alert ${alert.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const knowledgeItems: KnowledgeSearchItem[] = [];
      const seenKnowledgeRefs = new Set<string>();
      for (const attempt of knowledgeAttempts) {
        for (const item of attempt.items) {
          if (knowledgeItems.length >= MAX_MONITORING_KNOWLEDGE_DOCUMENTS) break;
          const ref = knowledgeDocumentRef(item);
          if (!ref || seenKnowledgeRefs.has(ref.toLocaleLowerCase())) continue;
          seenKnowledgeRefs.add(ref.toLocaleLowerCase());
          knowledgeItems.push(item);
        }
        if (knowledgeItems.length >= MAX_MONITORING_KNOWLEDGE_DOCUMENTS) break;
      }
      const enrichedKnowledgeItems = [...knowledgeItems];
      for (const [documentIndex, item] of knowledgeItems.entries()) {
        const documentId = knowledgeDocumentRef(item);
        if (!documentId) continue;
        try {
          const result = await this.dispatcher.execute<Record<string, unknown>>(context, {
            capabilityName: 'get_document',
            input: { document_id: documentId },
            execution: {
              surface: 'internal',
              trigger_kind: 'internal',
              runId: alertResult.run_id,
              stepIndex: stepIndex++,
              metadata: {
                ...baseMetadata,
                knowledge_document_source: 'monitoring_alert',
                knowledge_document_index: documentIndex + 1,
                knowledge_document_ref: documentId,
              },
            },
          });
          allEvidenceIds.push(...await this.evidenceIdsForTool(context, result.tool_execution_id));
          const fullDocument = knowledgeDocumentFromOutput(item, result.output);
          if (fullDocument) {
            enrichedKnowledgeItems[documentIndex] = fullDocument;
          }
        } catch (error) {
          this.logger.warn(`Knowledge document fetch skipped for alert ${alert.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Web search per policy — identical gating to the ticketing flow; the
      // web_search capability applies the public-query sanitization (alert
      // queries carry hostnames, so this is not optional).
      let webSearchResults: WebSearchResultItem[] = [];
      let webSearchStatus: string = knowledgeSources.webEnabled ? 'disabled_by_platform' : 'disabled_by_agent';
      let webSearchQuery: string | null = null;
      let webSearchError: string | null = null;
      if (knowledgeSources.webEnabled && Features.AI_WEB_SEARCH_READY) {
        const webQuery = retrievalQueryCandidates[0] ?? '';
        webSearchQuery = webQuery || null;
        if (webQuery) {
          try {
            const webResult = await this.dispatcher.execute<Record<string, unknown>>(context, {
              capabilityName: 'web_search',
              input: { query: webQuery, count: 5 },
              execution: {
                surface: 'internal',
                trigger_kind: 'internal',
                runId: alertResult.run_id,
                stepIndex: stepIndex++,
                metadata: {
                  ...baseMetadata,
                  web_query_source: 'monitoring_alert',
                },
              },
            });
            allEvidenceIds.push(...await this.evidenceIdsForTool(context, webResult.tool_execution_id));
            webSearchResults = webSearchItemsFromOutput(webResult.output);
            webSearchStatus = 'executed';
          } catch (error) {
            webSearchStatus = 'failed';
            webSearchError = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Web search skipped for alert ${alert.id}: ${webSearchError}`);
          }
        } else {
          webSearchStatus = 'skipped_empty_query';
        }
      }

      // ONE structured LLM stage: the diagnostic brief, with the monitoring
      // planner profile's vocabulary/validation notes and citations gated by
      // the knownSources allowlist. Conservative fallback on every failure.
      const promptRuntime = await this.compileAgentPromptRuntime(context, definition);
      const diagnosisGuidance = this.agentPromptCompiler().sliceFor(promptRuntime.profile, 'monitoring_diagnosis');
      const diagnosisGuidanceHash = guidanceHash(diagnosisGuidance);
      const briefLanguage = promptRuntime.profile.output_style?.language && promptRuntime.profile.output_style.language !== 'auto'
        ? promptRuntime.profile.output_style.language
        : 'en';
      const plannerProfile = await this.actionPlannerProfileForProvider(context, binding.providerKind, binding.providerKey);
      const alertEvidence: DiagnosticBriefAlertEvidence = {
        alert: {
          id: alert.id,
          status: alert.status ?? null,
          severity: alert.severity ?? null,
          ack_state: alert.ackState ?? null,
          device_name: alert.deviceName ?? null,
          occurrence_started_at: alert.occurrenceStartedAt ?? null,
          observed_at: alert.observedAt ?? null,
          last_checked_at: alert.lastCheckedAt ?? null,
          last_value: alert.lastValue ?? null,
          object_kind: alert.objectKind ?? null,
          group_path: Array.isArray(alert.groupPath) ? alert.groupPath : null,
          source_uri: alert.sourceUri ?? null,
        },
        untrusted_message: typeof alert.message === 'string' && alert.message.trim() ? alert.message : null,
        current_state: currentState,
        history_summary: historySummary,
        related_alerts: relatedAlerts,
        similar_tickets: similarTickets,
      };
      const briefInput: DiagnosticBriefSynthesisInput = {
        compiledPrompt: diagnosisGuidance,
        language: briefLanguage,
        alertEvidence,
        kanapContext,
        knowledgeDocs: enrichedKnowledgeItems,
        webResults: webSearchResults,
        entitySources,
        plannerProfile,
      };
      const briefInputSummary = {
        language: briefLanguage,
        knowledge_source_count: enrichedKnowledgeItems.length,
        web_source_count: webSearchResults.length,
        entity_source_count: entitySources.length,
        kanap_asset_match: kanapContext.assetMatch,
        prompt_profile: promptRuntime.promptProfileSummary,
        guidance_hash: diagnosisGuidanceHash,
      };
      const guardrails = this.agentQueue.runGuardrails(definition);
      let brief: DiagnosticBriefResult;
      let briefProjection: { estimatedTokens: number; estimatedCostEur: number } | null = null;
      if (!this.diagnosticBriefSynthesis) {
        brief = buildFallbackDiagnosticBrief(briefInput, 'synthesis_service_unavailable');
        await this.recordStageRunStep(context, RUN_STEP_STAGES.diagnosticBrief, {
          runId: alertResult.run_id,
          stepIndex: stepIndex++,
          status: 'skipped',
          inputSummary: briefInputSummary,
          outputSummary: { fallback_reason: brief.fallback_reason },
        });
      } else if (process.env.AI_AGENT_DIAGNOSTIC_BRIEF === '0') {
        brief = buildFallbackDiagnosticBrief(briefInput, 'synthesis_disabled_by_env');
        await this.recordStageRunStep(context, RUN_STEP_STAGES.diagnosticBrief, {
          runId: alertResult.run_id,
          stepIndex: stepIndex++,
          status: 'skipped',
          inputSummary: briefInputSummary,
          outputSummary: { fallback_reason: brief.fallback_reason },
        });
      } else {
        const briefPayload = this.diagnosticBriefSynthesis.buildPromptPayload(briefInput);
        briefProjection = estimateDiagnosticBriefUsage({
          systemPrompt: compileSystemPrompt(RUNTIME_SAFETY_FLOOR_MONITORING_DIAGNOSIS, diagnosisGuidance),
          userPayload: briefPayload,
        }, llmPrices, this.diagnosticBriefSynthesis.maxOutputTokens());
        const baseUsageEstimate = currentRunLlmUsage();
        if (
          baseUsageEstimate.estimatedTokens + briefProjection.estimatedTokens > guardrails.maxEstimatedTokens
          || baseUsageEstimate.estimatedCostEur + briefProjection.estimatedCostEur > guardrails.maxEstimatedCostEur
        ) {
          brief = buildFallbackDiagnosticBrief(briefInput, 'synthesis_projected_over_per_run_cap');
          await this.recordStageRunStep(context, RUN_STEP_STAGES.diagnosticBrief, {
            runId: alertResult.run_id,
            stepIndex: stepIndex++,
            status: 'skipped',
            inputSummary: {
              ...briefInputSummary,
              projected_tokens: briefProjection.estimatedTokens,
              projected_cost_eur: briefProjection.estimatedCostEur,
            },
            outputSummary: {
              fallback_reason: brief.fallback_reason,
              base_estimated_tokens: baseUsageEstimate.estimatedTokens,
              base_estimated_cost_eur: baseUsageEstimate.estimatedCostEur,
              cap: guardrails,
            },
          });
        } else {
          const briefStepIndex = stepIndex++;
          brief = await this.diagnosticBriefSynthesis.synthesizeDiagnosticBrief(context, briefInput);
          if (brief.estimated_tokens > 0) {
            await this.recordStageUsage(context, 'diagnostic_brief', alertResult.run_id, brief);
            chargeRunLlmUsage(brief);
          }
          await this.recordStageRunStep(context, RUN_STEP_STAGES.diagnosticBrief, {
            runId: alertResult.run_id,
            stepIndex: briefStepIndex,
            status: brief.fallback
              ? (brief.fallback_reason === 'no_llm_runtime_configured' ? 'skipped' : 'failed')
              : 'completed',
            inputSummary: {
              ...briefInputSummary,
              model: brief.model,
              projected_tokens: briefProjection.estimatedTokens,
              projected_cost_eur: briefProjection.estimatedCostEur,
            },
            outputSummary: {
              fallback: brief.fallback,
              fallback_reason: brief.fallback_reason,
              needs_human_review: brief.needs_human_review,
              confidence: brief.confidence,
              used_source_count: brief.used_sources.length,
              rejected_source_count: brief.rejected_sources.length,
              recommended_action_count: brief.recommended_actions.length,
              tokens: brief.estimated_tokens,
              cost_eur: brief.estimated_cost_eur,
              latency_ms: brief.latency_ms,
            },
            errorMessage: brief.fallback ? brief.fallback_reason : null,
          });
        }
      }

      // Final per-run cap enforcement on the actual-usage ledger (D11) — same
      // audit/failure semantics as the ticketing flow.
      const runUsageEstimate = await this.recordAndEnforceHelpdeskRunCap(context, {
        definition,
        runId: alertResult.run_id,
        stage: 'before_diagnosis_finalization',
        usage: currentRunLlmUsage(),
      });

      const compactAlert = {
        id: alert.id,
        status: alert.status ?? null,
        severity: alert.severity ?? null,
        ack_state: alert.ackState ?? null,
        device_name: alert.deviceName ?? null,
        check_name: alert.checkName ?? null,
        // Untrusted provider text, display-only in review surfaces.
        message: clampText(alert.message ?? '', 500) || null,
        occurrence_started_at: alert.occurrenceStartedAt ?? null,
        observed_at: alert.observedAt ?? null,
        last_value: alert.lastValue ?? null,
        source_uri: alert.sourceUri ?? null,
      };
      const kanapContextMetadata = {
        asset_match: kanapContext.assetMatch,
        lookups_used: kanapContext.lookupsUsed,
        entity_refs: entitySources.map((source) => source.ref),
        owners: kanapContext.owners ?? [],
        notes: kanapContext.notes,
      };
      const briefMetadata = {
        diagnosis_stage: 'llm_brief',
        brief_summary: clampText(brief.summary, 2000),
        probable_causes: brief.probable_causes,
        business_impact: brief.business_impact,
        recommended_actions: brief.recommended_actions,
        used_sources: brief.used_sources,
        rejected_sources: brief.rejected_sources,
        needs_human_review: brief.needs_human_review,
        brief_confidence: brief.confidence,
        brief_language: brief.language,
        synthesis_model: brief.model,
        synthesis_tokens: brief.estimated_tokens,
        synthesis_usage: brief.usage,
        synthesis_cost_eur: brief.estimated_cost_eur,
        synthesis_latency_ms: brief.latency_ms,
        synthesis_fallback: brief.fallback,
        synthesis_fallback_reason: brief.fallback_reason,
      };
      const recommendedActionKinds = Array.from(new Set(brief.recommended_actions.map((action) => action.action)));

      const now = new Date();
      const observationRepo = context.manager.getRepository(AiObservation);
      const summaryBits = [
        `Alert ${alert.id}`,
        alert.status ? `status ${alert.status}` : null,
        alert.severity ? `severity ${alert.severity}` : null,
        alert.deviceName ? `device ${alert.deviceName}` : null,
      ].filter(Boolean).join(', ');
      const observation = await observationRepo.save(observationRepo.create({
        tenant_id: context.tenantId,
        run_id: alertResult.run_id,
        observation_type: MONITORING_DIAGNOSIS_RUN_OPTIONS.observationType,
        status: 'observed',
        source_provider: `${binding.providerKind}:${binding.providerKey}`,
        source_object_type: 'sensor',
        source_object_id: alert.id,
        severity: alert.severity ?? null,
        summary: `${summaryBits}. ${relatedAlerts.length} related alert(s), ${historyPointCount} history point(s) in the last ${MONITORING_HISTORY_WINDOW_MINUTES} minutes.`,
        evidence_ids: allEvidenceIds,
        metadata_json: {
          ...agentMetadata,
          provider_key: binding.providerKey,
          alert: compactAlert,
          current_state: currentState,
          related_alert_ids: relatedAlertIds,
          related_alerts: relatedAlerts,
          history_window_minutes: MONITORING_HISTORY_WINDOW_MINUTES,
          history_point_count: historyPointCount,
          history_summary: historySummary,
          kanap_context: kanapContextMetadata,
          knowledge_status: knowledgeStatus,
          knowledge_query_candidates: knowledgeQueryCandidates,
          knowledge_result_count: enrichedKnowledgeItems.length,
          web_search_enabled: knowledgeSources.webEnabled === true,
          web_search_ready: Features.AI_WEB_SEARCH_READY,
          web_search_status: webSearchStatus,
          web_search_query: webSearchQuery,
          web_search_error: webSearchError,
          web_result_count: webSearchResults.length,
          similar_tickets_status: similarTicketsStatus,
          similar_ticket_count: similarTickets.length,
          run_usage_estimate: runUsageEstimate,
          ...briefMetadata,
        },
        observed_at: now,
        created_at: now,
        updated_at: now,
      }));

      // Recommend-only (15.A): the brief itself is the deliverable. The full
      // diagnosis lives in AiRecommendation metadata — no prepared actions, no
      // provider writes, no approval surface involvement.
      const recommendationRepo = context.manager.getRepository(AiRecommendation);
      const recommendation = await recommendationRepo.save(recommendationRepo.create({
        tenant_id: context.tenantId,
        run_id: alertResult.run_id,
        observation_id: observation.id,
        recommendation_type: MONITORING_DIAGNOSIS_RUN_OPTIONS.recommendationType,
        status: 'proposed',
        summary: clampText(brief.summary, 500),
        rationale: brief.probable_causes.length > 0
          ? clampText(brief.probable_causes.map((cause) => cause.cause).join(' | '), 800)
          : (brief.fallback
            ? 'Deterministic fallback brief — automated diagnosis was unavailable for this alert.'
            : 'No probable cause could be identified from the collected evidence.'),
        confidence: brief.confidence === 'high' ? 0.85 : brief.confidence === 'medium' ? 0.6 : 0.35,
        proposed_action_class: 'monitoring_diagnosis',
        max_autonomy_level: 'A1',
        evidence_ids: allEvidenceIds,
        metadata_json: {
          ...agentMetadata,
          provider_key: binding.providerKey,
          alert: compactAlert,
          kanap_context: kanapContextMetadata,
          recommended_action_kinds: recommendedActionKinds,
          similar_tickets: similarTickets,
          run_usage_estimate: runUsageEstimate,
          ...briefMetadata,
        },
        created_at: now,
        updated_at: now,
      }));

      // Shadow-mode evaluation shell, like triage: pending until a human
      // calibrates the diagnosis quality.
      const evaluationRepo = context.manager.getRepository(AiEvaluation);
      const evaluation = await evaluationRepo.save(evaluationRepo.create({
        tenant_id: context.tenantId,
        run_id: alertResult.run_id,
        recommendation_id: recommendation.id,
        decision_id: null,
        status: 'pending',
        outcome: null,
        scores_json: null,
        feedback_json: null,
        metadata_json: {
          ...agentMetadata,
          evaluation_type: MONITORING_DIAGNOSIS_RUN_OPTIONS.evaluationType,
          brief_confidence: brief.confidence,
          needs_human_review: brief.needs_human_review,
          synthesis_fallback_reason: brief.fallback_reason,
        },
        created_at: now,
        updated_at: now,
      }));

      const outcome = await this.agentQueue.recordMonitoringDiagnosisOutcome(context, {
        definition,
        workItem: leasedWorkItem,
        runId: alertResult.run_id,
        alert: {
          id: alert.id,
          status: alert.status ?? null,
          severity: alert.severity ?? null,
          deviceName: alert.deviceName ?? null,
          occurrenceStartedAt: alert.occurrenceStartedAt ?? null,
          observedAt: alert.observedAt ?? null,
          sourceUri: alert.sourceUri ?? null,
        },
        metadata: {
          observation_id: observation.id,
          recommendation_id: recommendation.id,
          evaluation_id: evaluation.id,
          diagnosis_stage: 'llm_brief',
          brief_confidence: brief.confidence,
          needs_human_review: brief.needs_human_review,
          ...(brief.fallback_reason ? { fallback_reason: brief.fallback_reason } : {}),
          recommended_action_kinds: recommendedActionKinds,
        },
      });

      return {
        status: 'completed',
        agent_definition: serializeAgentDefinition(definition),
        work_item: serializeAgentWorkItem(outcome.workItem),
        target_state: serializeAgentTargetState(outcome.targetState),
        diagnostic: {
          run_id: alertResult.run_id,
          alert_tool_execution_id: alertResult.tool_execution_id,
          history_tool_execution_id: historyResult.tool_execution_id,
          state_tool_execution_id: stateResult.tool_execution_id,
          related_tool_execution_id: relatedResult.tool_execution_id,
          observation_id: observation.id,
          recommendation_id: recommendation.id,
          evaluation_id: evaluation.id,
          evidence_ids: allEvidenceIds,
          alert: compactAlert,
          current_state: currentState,
          related_alert_count: relatedAlerts.length,
          history_point_count: historyPointCount,
          history_summary: historySummary,
          kanap_context: kanapContextMetadata,
          knowledge_status: knowledgeStatus,
          knowledge_result_count: enrichedKnowledgeItems.length,
          web_search_status: webSearchStatus,
          web_result_count: webSearchResults.length,
          similar_tickets_status: similarTicketsStatus,
          similar_ticket_count: similarTickets.length,
          run_usage_estimate: runUsageEstimate,
          diagnosis_stage: 'llm_brief',
          brief: {
            summary: brief.summary,
            probable_causes: brief.probable_causes,
            business_impact: brief.business_impact,
            recommended_actions: brief.recommended_actions,
            used_sources: brief.used_sources,
            rejected_sources: brief.rejected_sources,
            needs_human_review: brief.needs_human_review,
            confidence: brief.confidence,
            language: brief.language,
            fallback: brief.fallback,
            fallback_reason: brief.fallback_reason,
            model: brief.model,
          },
        },
      };
    } catch (error) {
      if (this.agentQueue && leasedWorkItem) {
        await this.agentQueue.failWorkItem(context, leasedWorkItem, error);
        // Savepoint-wrapped callers (the monitoring poller) roll this
        // bookkeeping back together with the failed attempt's writes; the
        // marker lets them re-apply it after the rollback so attempt counting,
        // backoff and dead-lettering survive on the poller path.
        markWorkItemAttemptFailure(error, leasedWorkItem.id);
      }
      throw error;
    }
  }

  private async runHelpdeskTicketingTriage(
    context: AiExecutionContextWithManager,
    input: AgentControlTicketingTriageInput = {},
    options: HelpdeskTicketingTriageRunOptions = {},
  ) {
    const workItemId = trimmedString(input.work_item_id);
    let target: AiLiveTestTarget | AgentQueueLiveTargetLike;
    let agentDefinition: AiAgentDefinition | null = null;
    let requestedDefinition: AiAgentDefinition | null = null;
    let leasedWorkItem: AiAgentWorkItem | null = null;
    let workItemCreated = false;
    let agentMetadata: Record<string, unknown> = {};
    if (workItemId) {
      if (!this.agentQueue) {
        throw new ForbiddenException('Agent work queue is required to run queued ticketing triage.');
      }
      const queuedWorkItem = await context.manager.getRepository(AiAgentWorkItem).findOne({
        where: {
          id: workItemId,
          tenant_id: context.tenantId,
        },
      });
      if (!queuedWorkItem) {
        throw new NotFoundException('Agent work item not found.');
      }
      if (
        queuedWorkItem.source_provider_kind !== 'ticketing'
        || queuedWorkItem.source_object_type !== 'ticket'
      ) {
        throw new BadRequestException('Queued ticket triage work item must target a ticketing ticket.');
      }
      agentDefinition = await context.manager.getRepository(AiAgentDefinition).findOne({
        where: {
          id: queuedWorkItem.agent_definition_id,
          tenant_id: context.tenantId,
        },
      });
      if (!agentDefinition) {
        throw new ForbiddenException('Queued ticketing triage work item has no tenant-scoped agent definition.');
      }
      this.agentQueue.assertHelpdeskTicketingDefinitionRunnable(agentDefinition, null);
      const binding = requireTicketingBinding(agentDefinition, 'Queued ticket triage requires a ticketing provider binding.');
      if (
        queuedWorkItem.source_provider_kind !== binding.providerKind
        || queuedWorkItem.source_provider_key !== binding.providerKey
      ) {
        throw new BadRequestException('Queued ticket triage work item provider does not match the agent ticketing binding.');
      }
      leasedWorkItem = await this.agentQueue.acquireWorkItem(context, queuedWorkItem.id, {
        leaseOwner: `helpdesk-new-ticket-poller:${context.userId || 'system'}`,
      });
      agentMetadata = this.agentQueue.agentExecutionMetadata(agentDefinition, leasedWorkItem);
      target = {
        id: `work-item:${leasedWorkItem.id}`,
        provider_kind: queuedWorkItem.source_provider_kind,
        provider_key: queuedWorkItem.source_provider_key,
        environment: agentDefinition.environment,
        target_kind: queuedWorkItem.source_object_type,
        target_key: `ticket:${queuedWorkItem.source_object_ref}`,
        external_ref: queuedWorkItem.source_object_ref,
        allowed_effect: 'read',
        safety_label: 'scheduled_new_tickets_only',
        enabled: true,
      };
    } else {
      const providerKey = trimmedString(input.provider_key);
      if (!providerKey) {
        throw new BadRequestException('provider_key is required for manual ticketing triage.');
      }
      const requestedDefinitionId = trimmedString(input.agent_definition_id);
      if (!requestedDefinitionId) {
        throw new BadRequestException('agent_definition_id is required for manual ticketing triage.');
      }
      requestedDefinition = await context.manager.getRepository(AiAgentDefinition).findOne({
        where: { id: requestedDefinitionId, tenant_id: context.tenantId },
      });
      if (!requestedDefinition) {
        throw new NotFoundException('Agent definition not found.');
      }
      // Agent-scoped manual run: the operator names the agent and a ticket number, and the
      // target is built from the agent's own provider binding. The UAT live-test-target
      // registry (a hand-curated allowlist of a few tickets) is deliberately bypassed — the
      // scheduled poll already reaches any ticket the targeting matches, so a manual
      // read-and-propose run on an operator-chosen ticket is no broader.
      const binding = requireTicketingBinding(requestedDefinition, 'Manual ticket triage requires a ticketing provider binding.');
      if (binding.providerKind !== 'ticketing' || binding.providerKey !== providerKey) {
        throw new BadRequestException('Manual ticket triage provider does not match the agent ticketing binding.');
      }
      const ticketRef = manualTicketRef(input.target_key);
      if (!ticketRef) {
        throw new BadRequestException('A ticket number is required to run an agent on a ticket.');
      }
      target = {
        id: `manual-agent-test:${requestedDefinition.id}:${ticketRef}`,
        provider_kind: binding.providerKind,
        provider_key: binding.providerKey,
        environment: requestedDefinition.environment,
        target_kind: 'ticket',
        target_key: `ticket:${ticketRef}`,
        external_ref: ticketRef,
        allowed_effect: 'read',
        safety_label: 'manual_agent_test',
        enabled: true,
      };
    }

    if (!workItemId && this.agentQueue) {
      if (!requestedDefinition) {
        throw new BadRequestException('agent_definition_id is required for manual ticketing triage.');
      }
      const enqueued = await this.agentQueue.enqueueTicketingScopedTicket(context, {
        definition: requestedDefinition,
        // Operator-run test on a single ticket: allowed in Manual run mode.
        trigger: 'manual',
        ticket: { id: String(target.external_ref) },
        metadata: {
          source: 'manual_safe_target',
          target_id: target.id,
          target_key: target.target_key,
          target_environment: target.environment,
          target_safety_label: target.safety_label,
          source_endpoint: options.sourceEndpoint ?? TICKETING_TRIAGE_RUN_OPTIONS.sourceEndpoint,
        },
      });
      agentDefinition = requestedDefinition;
      workItemCreated = enqueued.created;
      leasedWorkItem = await this.agentQueue.acquireWorkItem(context, enqueued.workItem.id, {
        leaseOwner: `agent-control-center:${context.userId || 'system'}`,
      });
      agentMetadata = this.agentQueue.agentExecutionMetadata(agentDefinition, leasedWorkItem);
    }
    // Lets the LLM client resolve this agent's assigned registry model for
    // every downstream stage without threading the definition through them.
    context.agentId = agentDefinition?.id ?? null;
    // Assigned model's €/Mtok prices for pre-flight cost projections (null = free).
    const llmPrices = (await this.llmClient?.resolvePrices(context)) ?? null;
    const promptRuntime = await this.compileAgentPromptRuntime(context, agentDefinition);

    // One approval window for the whole run: compute a single expiry anchor here and stamp it on
    // every proposal this run prepares, so all proposals for the ticket expire together rather
    // than each action class lapsing on its own clock.
    const runApprovalTtlSeconds = typeof agentMetadata.approval_ttl_seconds === 'number'
      && Number.isFinite(agentMetadata.approval_ttl_seconds)
      && agentMetadata.approval_ttl_seconds > 0
      ? agentMetadata.approval_ttl_seconds
      : DEFAULT_APPROVAL_TTL_SECONDS;
    const proposalExpiresAt = new Date(Date.now() + runApprovalTtlSeconds * 1000).toISOString();
    const baseMetadata = {
      uat_workflow: options.workflow ?? TICKETING_TRIAGE_RUN_OPTIONS.workflow,
      source: 'admin_ui',
      live_target_id: target.id,
      live_target_key: target.target_key,
      live_target_environment: target.environment,
      safety_label: target.safety_label,
      work_item_created: workItemCreated,
      ...agentMetadata,
      proposal_expires_at: proposalExpiresAt,
    };
    try {
      const applicability = await this.providers.getApplicability(context, 'ticketing', target.provider_key);
      if (!applicability.available) {
        throw new ForbiddenException(`Ticketing provider is unavailable: ${applicability.message ?? applicability.reasonCode ?? 'not ready'}.`);
      }
      // On the built-in provider, one triage run consumes one included message (same
      // unit as a chat message), reserved before any provider or LLM work happens.
      await this.builtinQuota?.reserveRun(context);

      let stepIndex = 1;
      const allEvidenceIds: string[] = [];
      const runLlmUsageLedger: RunLlmUsageEstimate = {
        estimatedTokens: 0,
        estimatedCostEur: 0,
      };
      const currentRunLlmUsage = (): RunLlmUsageEstimate => ({
        estimatedTokens: runLlmUsageLedger.estimatedTokens,
        estimatedCostEur: runLlmUsageLedger.estimatedCostEur,
      });
      const chargeRunLlmUsage = (usage: { estimated_tokens?: number | null; estimated_cost_eur?: number | null } | null | undefined) => {
        const estimatedTokens = Number(usage?.estimated_tokens ?? 0);
        const estimatedCostEur = Number(usage?.estimated_cost_eur ?? 0);
        if (Number.isFinite(estimatedTokens) && estimatedTokens > 0) {
          runLlmUsageLedger.estimatedTokens += Math.round(estimatedTokens);
        }
        if (Number.isFinite(estimatedCostEur) && estimatedCostEur > 0) {
          runLlmUsageLedger.estimatedCostEur = Number((runLlmUsageLedger.estimatedCostEur + estimatedCostEur).toFixed(6));
        }
      };

      const ticketResult = await this.dispatcher.execute<AdapterResultLike<TicketLike>>(context, {
        capabilityName: 'ticketing.ticket.get',
        input: {
          provider_key: target.provider_key,
          ticket_id: target.external_ref,
        },
        execution: {
          surface: 'internal',
          trigger_kind: 'internal',
          stepIndex: stepIndex++,
          metadata: baseMetadata,
        },
      });
      if (leasedWorkItem && this.agentQueue) {
        leasedWorkItem = await this.agentQueue.markRunning(context, leasedWorkItem, ticketResult.run_id);
      }
      allEvidenceIds.push(...await this.evidenceIdsForTool(context, ticketResult.tool_execution_id));

      const ticket = adapterData<TicketLike>(ticketResult.output);
    if (!ticket) {
      throw new BadRequestException(adapterFailureMessage(ticketResult.output) ?? 'Ticket read did not return ticket data.');
    }

    const ticketNotesResult = await this.dispatcher.execute<AdapterResultLike<{ notes: TicketNoteLike[] }>>(context, {
      capabilityName: TICKETING_TICKET_NOTES_LIST_CAPABILITY,
      input: {
        provider_key: target.provider_key,
        ticket_id: target.external_ref,
      },
      execution: {
        surface: 'internal',
        trigger_kind: 'internal',
        runId: ticketResult.run_id,
        stepIndex: stepIndex++,
        metadata: {
          ...baseMetadata,
          triage_action: 'read_ticket_history',
        },
      },
    });
    allEvidenceIds.push(...await this.evidenceIdsForTool(context, ticketNotesResult.tool_execution_id));
    const ticketNotesData = adapterData<{ notes: TicketNoteLike[] }>(ticketNotesResult.output);
    if (!ticketNotesData) {
      throw new BadRequestException(adapterFailureMessage(ticketNotesResult.output) ?? 'Ticket history read did not return note data.');
    }
    const classificationContextResult = await this.dispatcher.execute<AdapterResultLike<Record<string, unknown>>>(context, {
      capabilityName: TICKETING_CLASSIFICATION_CONTEXT_CAPABILITY,
      input: {
        provider_key: target.provider_key,
        ticket_id: target.external_ref,
        category_scope_keys: agentDefinition ? normalizeServiceDeskTargeting(agentDefinition.scope_policy_json).predicates
          .filter((predicate) => predicate.field === 'category' && (predicate.operator === 'eq' || predicate.operator === 'in'))
          .flatMap((predicate) => (Array.isArray(predicate.value) ? predicate.value : [predicate.value]).map(String)) : [],
      },
      execution: {
        surface: 'internal',
        trigger_kind: 'internal',
        runId: ticketResult.run_id,
        stepIndex: stepIndex++,
        metadata: {
          ...baseMetadata,
          triage_action: 'read_classification_context',
        },
      },
    });
    allEvidenceIds.push(...await this.evidenceIdsForTool(context, classificationContextResult.tool_execution_id));
    const classificationContext = adapterData<Record<string, unknown>>(classificationContextResult.output);

    const lifecycleContextResult = await this.dispatcher.execute<AdapterResultLike<Record<string, unknown>>>(context, {
      capabilityName: TICKETING_LIFECYCLE_CONTEXT_CAPABILITY,
      input: {
        provider_key: target.provider_key,
        ticket_id: target.external_ref,
      },
      execution: {
        surface: 'internal',
        trigger_kind: 'internal',
        runId: ticketResult.run_id,
        stepIndex: stepIndex++,
        metadata: {
          ...baseMetadata,
          triage_action: 'read_lifecycle_context',
        },
      },
    });
    allEvidenceIds.push(...await this.evidenceIdsForTool(context, lifecycleContextResult.tool_execution_id));
    const lifecycleContext = adapterData<Record<string, unknown>>(lifecycleContextResult.output);

    const routingContextResult = await this.dispatcher.execute<AdapterResultLike<Record<string, unknown>>>(context, {
      capabilityName: TICKETING_ROUTING_CONTEXT_CAPABILITY,
      input: {
        provider_key: target.provider_key,
        ticket_id: target.external_ref,
      },
      execution: {
        surface: 'internal',
        trigger_kind: 'internal',
        runId: ticketResult.run_id,
        stepIndex: stepIndex++,
        metadata: {
          ...baseMetadata,
          triage_action: 'read_routing_context',
        },
      },
    });
    allEvidenceIds.push(...await this.evidenceIdsForTool(context, routingContextResult.tool_execution_id));
    const routingContext = adapterData<Record<string, unknown>>(routingContextResult.output);

    const participantContextResult = await this.dispatcher.execute<AdapterResultLike<Record<string, unknown>>>(context, {
      capabilityName: TICKETING_PARTICIPANT_CONTEXT_CAPABILITY,
      input: {
        provider_key: target.provider_key,
        ticket_id: target.external_ref,
      },
      execution: {
        surface: 'internal',
        trigger_kind: 'internal',
        runId: ticketResult.run_id,
        stepIndex: stepIndex++,
        metadata: {
          ...baseMetadata,
          triage_action: 'read_participant_context',
        },
      },
    });
    allEvidenceIds.push(...await this.evidenceIdsForTool(context, participantContextResult.tool_execution_id));
    const participantContext = adapterData<Record<string, unknown>>(participantContextResult.output);

    const priorTargetActions = await context.manager.getRepository(AiActionRequest).find({
      where: {
        tenant_id: context.tenantId,
        provider_kind: target.provider_kind,
        provider_key: target.provider_key,
        target_type: target.target_kind,
        target_ref: ticket.id,
        capability_name: In([
          TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY,
          TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY,
        ]),
      },
    });
    const kanapPublicBodies = new Set(
      priorTargetActions
        .filter((action) => action.capability_name === TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY)
        .map(actionPayloadBody)
        .filter((body): body is string => !!body)
        .map(normalizeTimelineBody),
    );
    const ticketTimeline = buildTicketTimeline(ticket, ticketNotesData.notes, kanapPublicBodies);
    const conversationGate = evaluateConversationGate(priorTargetActions, ticketTimeline, ticketNotesData.notes);
    const ticketForKnowledge = {
      ...ticket,
      description: [
        ticket.description,
        ...ticketTimeline
          .filter((entry) => entry.actor === 'requester_candidate')
          .slice(-4)
          .map((entry) => entry.body),
      ].filter((entry) => typeof entry === 'string' && entry.trim().length > 0).join('\n\n'),
    };

    const preKnowledgeGuardrails = this.agentQueue && agentDefinition ? this.agentQueue.runGuardrails(agentDefinition) : null;
    const plannerSystemPrompt = compileSystemPrompt(RUNTIME_SAFETY_FLOOR_PLANNER, promptRuntime.plannerGuidance);
    let ticketImageExtraction: TicketEvidenceExtractionResult = {
      attachmentRefs: [
        ...(ticket.attachments ?? []),
        ...ticketNotesData.notes.flatMap((note) => note.attachments ?? []),
      ],
      evidence: [],
      warnings: [],
      skippedReason: null,
      model: null,
      usage: null,
      estimated_tokens: 0,
      estimated_cost_eur: 0,
      latency_ms: 0,
    };
    if (this.ticketEvidenceExtractor) {
      const evidenceProjection = estimateTicketEvidenceExtractionUsage({
        systemPrompt: plannerSystemPrompt,
        ticket,
        notes: ticketNotesData.notes,
        maxImages: this.ticketEvidenceExtractor.maxImageCount(),
      }, llmPrices, this.ticketEvidenceExtractor.maxOutputTokens());
      const evidenceInputSummary = {
        attachment_count: evidenceProjection.attachmentCount,
        projected_image_call_count: evidenceProjection.imageCallCount,
        projected_tokens: evidenceProjection.estimatedTokens,
        projected_cost_eur: evidenceProjection.estimatedCostEur,
        prompt_profile: promptRuntime.promptProfileSummary,
      };
      const evidenceBaseUsageEstimate = currentRunLlmUsage();
      if (
        evidenceProjection.imageCallCount > 0
        && preKnowledgeGuardrails
        && (
          evidenceBaseUsageEstimate.estimatedTokens + evidenceProjection.estimatedTokens > preKnowledgeGuardrails.maxEstimatedTokens
          || evidenceBaseUsageEstimate.estimatedCostEur + evidenceProjection.estimatedCostEur > preKnowledgeGuardrails.maxEstimatedCostEur
        )
      ) {
        ticketImageExtraction = {
          ...ticketImageExtraction,
          warnings: [`${evidenceProjection.attachmentCount} screenshot(s) not analyzed: projected over the per-run LLM usage cap.`],
          skippedReason: 'vision_projected_over_per_run_cap',
        };
        await this.recordStageRunStep(context, RUN_STEP_STAGES.evidenceExtraction, {
          runId: ticketResult.run_id,
          stepIndex: stepIndex++,
          status: 'skipped',
          inputSummary: evidenceInputSummary,
          outputSummary: {
            skipped_reason: ticketImageExtraction.skippedReason,
            base_estimated_tokens: evidenceBaseUsageEstimate.estimatedTokens,
            base_estimated_cost_eur: evidenceBaseUsageEstimate.estimatedCostEur,
            cap: preKnowledgeGuardrails,
          },
        });
      } else {
        const evidenceStepIndex = evidenceProjection.attachmentCount > 0 ? stepIndex++ : null;
        try {
          ticketImageExtraction = await this.ticketEvidenceExtractor.extractImageEvidence(context, {
            ticket,
            notes: ticketNotesData.notes,
            profile: promptRuntime.plannerGuidance,
            readAttachment: async (ref) => {
              const result = await this.dispatcher.execute<AdapterResultLike<TicketAttachmentReadResult>>(context, {
                capabilityName: TICKETING_TICKET_ATTACHMENT_READ_CAPABILITY,
                input: {
                  provider_key: target.provider_key,
                  ticket_id: target.external_ref,
                  target: ref.target,
                  source: ref.source,
                  ...(ref.sourceNoteId ? { source_note_id: ref.sourceNoteId } : {}),
                },
                execution: {
                  surface: 'internal',
                  trigger_kind: 'internal',
                  runId: ticketResult.run_id,
                  stepIndex: stepIndex++,
                  metadata: {
                    ...baseMetadata,
                    triage_action: 'read_ticket_attachment',
                    attachment_id: ref.id,
                    attachment_source: ref.source,
                    attachment_source_note_id: ref.sourceNoteId ?? null,
                  },
                },
              });
              allEvidenceIds.push(...await this.evidenceIdsForTool(context, result.tool_execution_id));
              return adapterData<TicketAttachmentReadResult>(result.output);
            },
          });
          if (ticketImageExtraction.estimated_tokens > 0) {
            await this.recordStageUsage(context, 'evidence_extraction', ticketResult.run_id, ticketImageExtraction);
            chargeRunLlmUsage(ticketImageExtraction);
          }
          if (evidenceStepIndex != null) {
            await this.recordStageRunStep(context, RUN_STEP_STAGES.evidenceExtraction, {
              runId: ticketResult.run_id,
              stepIndex: evidenceStepIndex,
              status: ticketImageExtraction.skippedReason && ticketImageExtraction.estimated_tokens === 0 ? 'skipped' : 'completed',
              inputSummary: evidenceInputSummary,
              outputSummary: {
                evidence_count: ticketImageExtraction.evidence.length,
                warning_count: ticketImageExtraction.warnings.length,
                skipped_reason: ticketImageExtraction.skippedReason,
                model: ticketImageExtraction.model,
                tokens: ticketImageExtraction.estimated_tokens,
                cost_eur: ticketImageExtraction.estimated_cost_eur,
                latency_ms: ticketImageExtraction.latency_ms,
              },
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error || 'vision extraction failed');
          ticketImageExtraction = {
            ...ticketImageExtraction,
            warnings: [`${ticketImageExtraction.attachmentRefs.length} screenshot(s) not analyzed: ${message.slice(0, 180)}.`],
            skippedReason: 'vision_call_error',
          };
          if (evidenceStepIndex != null) {
            await this.recordStageRunStep(context, RUN_STEP_STAGES.evidenceExtraction, {
              runId: ticketResult.run_id,
              stepIndex: evidenceStepIndex,
              status: 'failed',
              inputSummary: evidenceInputSummary,
              outputSummary: { skipped_reason: ticketImageExtraction.skippedReason },
              errorMessage: message,
            });
          }
        }
      }
    }

    let knowledgeNeedRepresentation: TicketNeedRepresentationBuildResult | null = null;
    const fallbackPreferenceTerms = extractKnowledgePreferenceTerms(ticketTimeline).positiveTerms;
    const shortFallbackKnowledgeQueries = uniqueKnowledgeCandidates([
      ...fallbackPreferenceTerms,
      fallbackPreferenceTerms.slice(0, 4).join(' '),
      ...buildShortKnowledgeQueryCandidates(ticketForKnowledge),
    ]);
    let knowledgeQueryDerivation: KnowledgeQueryDerivation = {
      source: 'deterministic_fallback',
      queries: shortFallbackKnowledgeQueries,
      exact_queries: [],
      facet_queries: [],
      fallback_queries: shortFallbackKnowledgeQueries,
      dropped_queries: [],
      warnings: ['Legacy lexical query derivation used because the ticket need builder is not available.'],
    };
    if (this.ticketNeedBuilder) {
      const needInput = {
        ticket,
        timeline: ticketTimeline,
        imageEvidence: ticketImageExtraction.evidence,
        profile: promptRuntime.plannerGuidance,
      };
      const needPayload = this.ticketNeedBuilder.buildPromptPayload(needInput);
      const needProjection = estimateTicketNeedRepresentationUsage({
        systemPrompt: plannerSystemPrompt,
        userPayload: needPayload,
      }, llmPrices, this.ticketNeedBuilder.maxOutputTokens());
      const needInputSummary = {
        image_evidence_count: ticketImageExtraction.evidence.length,
        projected_tokens: needProjection.estimatedTokens,
        projected_cost_eur: needProjection.estimatedCostEur,
        prompt_profile: promptRuntime.promptProfileSummary,
      };
      const needBaseUsageEstimate = currentRunLlmUsage();
      if (
        process.env.AI_AGENT_NEED_BUILDER_LLM !== '0'
        && preKnowledgeGuardrails
        && (
          needBaseUsageEstimate.estimatedTokens + needProjection.estimatedTokens > preKnowledgeGuardrails.maxEstimatedTokens
          || needBaseUsageEstimate.estimatedCostEur + needProjection.estimatedCostEur > preKnowledgeGuardrails.maxEstimatedCostEur
        )
      ) {
        knowledgeNeedRepresentation = this.ticketNeedBuilder.buildDeterministicNeedRepresentation(needInput, [
          'Need builder skipped: projected over the per-run LLM usage cap.',
        ]);
        await this.recordStageRunStep(context, RUN_STEP_STAGES.needRepresentation, {
          runId: ticketResult.run_id,
          stepIndex: stepIndex++,
          status: 'skipped',
          inputSummary: needInputSummary,
          outputSummary: {
            fallback_reason: 'need_representation_projected_over_per_run_cap',
            base_estimated_tokens: needBaseUsageEstimate.estimatedTokens,
            base_estimated_cost_eur: needBaseUsageEstimate.estimatedCostEur,
            cap: preKnowledgeGuardrails,
          },
        });
      } else {
        const needStepIndex = process.env.AI_AGENT_NEED_BUILDER_LLM === '0' ? null : stepIndex++;
        try {
          knowledgeNeedRepresentation = await this.ticketNeedBuilder.buildNeedRepresentation(context, needInput);
          if (knowledgeNeedRepresentation.estimated_tokens > 0) {
            await this.recordStageUsage(context, 'need_representation', ticketResult.run_id, knowledgeNeedRepresentation);
            chargeRunLlmUsage(knowledgeNeedRepresentation);
          }
          if (needStepIndex != null) {
            await this.recordStageRunStep(context, RUN_STEP_STAGES.needRepresentation, {
              runId: ticketResult.run_id,
              stepIndex: needStepIndex,
              status: knowledgeNeedRepresentation.estimated_tokens > 0 ? 'completed' : 'skipped',
              inputSummary: needInputSummary,
              outputSummary: {
                source: knowledgeNeedRepresentation.source,
                warning_count: knowledgeNeedRepresentation.warnings.length,
                model: knowledgeNeedRepresentation.model,
                tokens: knowledgeNeedRepresentation.estimated_tokens,
                cost_eur: knowledgeNeedRepresentation.estimated_cost_eur,
                latency_ms: knowledgeNeedRepresentation.latency_ms,
              },
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error || 'Need representation failed.');
          knowledgeNeedRepresentation = this.ticketNeedBuilder.buildDeterministicNeedRepresentation(needInput, [
            `Need builder unavailable: ${message.slice(0, 220)}`,
          ]);
          if (needStepIndex != null) {
            await this.recordStageRunStep(context, RUN_STEP_STAGES.needRepresentation, {
              runId: ticketResult.run_id,
              stepIndex: needStepIndex,
              status: 'failed',
              inputSummary: needInputSummary,
              outputSummary: { fallback_reason: 'need_representation_error' },
              errorMessage: message,
            });
          }
        }
      }
      knowledgeQueryDerivation = this.ticketNeedBuilder.deriveKnowledgeQueries({
        need: knowledgeNeedRepresentation.need,
        fallbackTitle: ticket.title,
        fallbackDescription: ticket.description,
      });
    }
    const deterministicKnowledgeQueries = knowledgeQueryDerivation.queries;
    const knowledgeSources = readAgentKnowledgeSources(agentDefinition);
    let knowledgeSearchPlan: KnowledgeSearchPlan;
    let knowledgeQueryCandidates: string[];
    const knowledgeAttempts: KnowledgeSearchAttempt[] = [];
    let mergedKnowledgeCandidates: MergedKnowledgeCandidate[] = [];
    let knowledgeInterpretation: KnowledgeResultInterpretation;
    let selectedKnowledgeItems: KnowledgeSearchItem[] = [];
    let unvalidatedKnowledgeItems: KnowledgeSearchItem[] = [];
    let knowledgeLowRelevance: Array<{ ref: string | null; title: string | null; score: number | null; lexical_overlap: number; reason: string }> = [];
    if (!knowledgeSources.knowledgeEnabled) {
      // Knowledge search is disabled for this agent — gather no KANAP knowledge so the
      // triage relies on the LLM (and web, when enabled). The plan/interpretation are kept
      // as valid empty structures for the downstream audit metadata.
      knowledgeSearchPlan = buildFallbackKnowledgeSearchPlan(ticket, ticketTimeline, []);
      knowledgeQueryCandidates = [];
      knowledgeInterpretation = buildFallbackKnowledgeInterpretation(knowledgeSearchPlan, []);
    } else {
      const plannedKnowledgeSearch = this.ticketNeedBuilder && knowledgeNeedRepresentation
        ? {
          source: knowledgeNeedRepresentation.source,
          need: knowledgeNeedRepresentation.need,
          intent: knowledgeNeedRepresentation.need.intent,
          language: knowledgeNeedRepresentation.need.language,
          positive_terms: uniqueKnowledgeCandidates([
            ...knowledgeNeedRepresentation.need.symptoms,
            ...knowledgeNeedRepresentation.need.constraints.positive,
            ...knowledgeNeedRepresentation.need.entities.applications,
            ...knowledgeNeedRepresentation.need.entities.modules,
          ]),
          negative_terms: uniqueKnowledgeCandidates(knowledgeNeedRepresentation.need.constraints.negative),
          queries: deterministicKnowledgeQueries,
          rationale: 'Derived from TicketNeedRepresentation facets.',
          confidence: knowledgeNeedRepresentation.need.confidence,
          model: knowledgeNeedRepresentation.model,
          warnings: uniqueKnowledgeCandidates([
            ...knowledgeNeedRepresentation.need.warnings,
            ...knowledgeNeedRepresentation.warnings,
            ...knowledgeQueryDerivation.warnings,
          ]),
        } satisfies KnowledgeSearchPlan
        : this.knowledgePlanner
        ? await this.knowledgePlanner.planKnowledgeSearch(context, {
          ticket,
          timeline: ticketTimeline,
          profile: promptRuntime.plannerGuidance,
        })
        : buildFallbackKnowledgeSearchPlan(ticket, ticketTimeline, deterministicKnowledgeQueries);
      knowledgeSearchPlan = {
        ...plannedKnowledgeSearch,
        queries: this.ticketNeedBuilder
          ? uniqueKnowledgeCandidates(plannedKnowledgeSearch.queries)
          : uniqueKnowledgeCandidates([
            ...plannedKnowledgeSearch.queries,
            ...deterministicKnowledgeQueries,
          ]),
      };
      knowledgeQueryCandidates = knowledgeSearchPlan.queries;
      for (const [candidateIndex, knowledgeQuery] of knowledgeQueryCandidates.entries()) {
        const result = await this.dispatcher.execute<Record<string, unknown>>(context, {
          capabilityName: 'search_knowledge',
          input: {
            query: knowledgeQuery,
            limit: 10,
            offset: 0,
            // Restrict to the agent's configured libraries (intersected with the agent
            // user's accessible libraries by the search service); omit = all accessible.
            ...(knowledgeSources.knowledgeLibraryIds ? { library_ids: knowledgeSources.knowledgeLibraryIds } : {}),
          },
          execution: {
            surface: 'internal',
            trigger_kind: 'internal',
            runId: ticketResult.run_id,
            stepIndex: stepIndex++,
            metadata: {
              ...baseMetadata,
              knowledge_query_source: 'ticket',
              knowledge_query_index: candidateIndex + 1,
              knowledge_query_count: knowledgeQueryCandidates.length,
            },
          },
        });
        allEvidenceIds.push(...await this.evidenceIdsForTool(context, result.tool_execution_id));
        const items = knowledgeItemsFromOutput(result.output);
        knowledgeAttempts.push({
          query: knowledgeQuery,
          result,
          items,
        });
      }
      mergedKnowledgeCandidates = mergeKnowledgeAttempts(knowledgeAttempts);
      knowledgeInterpretation = this.knowledgePlanner
        ? await this.knowledgePlanner.interpretKnowledgeResults(context, {
          plan: knowledgeSearchPlan,
          ticket,
          timeline: ticketTimeline,
          candidates: plannerCandidatesFromKnowledge(mergedKnowledgeCandidates),
          profile: promptRuntime.interpreterGuidance,
        })
        : buildFallbackKnowledgeInterpretation(knowledgeSearchPlan, mergedKnowledgeCandidates);
      if (knowledgeInterpretation.estimated_tokens > 0) {
        await this.recordStageUsage(context, 'knowledge_interpretation', ticketResult.run_id, knowledgeInterpretation);
        chargeRunLlmUsage(knowledgeInterpretation);
      }
      const appliedInterpretation = applyKnowledgeInterpretation(mergedKnowledgeCandidates, knowledgeInterpretation);
      selectedKnowledgeItems = appliedInterpretation.selected;
      unvalidatedKnowledgeItems = appliedInterpretation.unvalidated;
      // Relevance is judged by the LLM interpreter (which docs to select) and by synthesis
      // (explicit off-topic rejection), NOT by a crude score/lexical heuristic: a relevant
      // internal doc (e.g. a recipe) and an off-topic one can both have ts_rank 0 and zero
      // lexical overlap, so the heuristic cannot tell them apart. We therefore only FLAG
      // low-relevance items for observability — we never drop presented docs before synthesis,
      // otherwise a genuinely relevant internal source gets discarded (regression #33).
      knowledgeLowRelevance = filterKnowledgeItemsByRelevance(
        ticketForKnowledge,
        [...selectedKnowledgeItems, ...unvalidatedKnowledgeItems],
      ).dropped;
      if (knowledgeLowRelevance.length > 0) {
        this.logger.debug(`Flagged ${knowledgeLowRelevance.length} low-relevance knowledge candidate(s) (kept for synthesis) for ticket ${ticket.id}.`);
      }
    }
    // Present LLM-validated selections first, then unvalidated candidates, tagged so synthesis
    // and the triage note can distinguish them. selected/unvalidated are mutually exclusive
    // (applyKnowledgeInterpretation returns one or the other), so a simple concat + cap is safe.
    const knowledgeItems: KnowledgeSearchItem[] = [
      ...selectedKnowledgeItems.map((item) => ({ ...item, validation_status: 'selected' as const })),
      ...unvalidatedKnowledgeItems.map((item) => ({ ...item, validation_status: 'unvalidated' as const })),
    ].slice(0, MAX_KNOWLEDGE_DOCUMENTS_FOR_REPLY);
    const presentedKnowledgeRefs = new Set(
      knowledgeItems.map((item) => knowledgeDocumentRef(item)?.toLocaleLowerCase()).filter((ref): ref is string => !!ref),
    );
    const selectedKnowledgeAttempt = knowledgeAttempts.find((attempt) =>
      attempt.items.some((item) => {
        const ref = knowledgeDocumentRef(item);
        return !!ref && presentedKnowledgeRefs.has(ref.toLocaleLowerCase());
      }),
    ) ?? knowledgeAttempts.find((attempt) => attempt.items.length > 0)
      ?? knowledgeAttempts[knowledgeAttempts.length - 1];
    // Knowledge search is optional: an agent may run with KANAP knowledge disabled
    // (relying on the LLM and, when enabled, web search — see the disabled branch
    // above), and a ticket may produce no query candidates. In either case there is
    // simply no knowledge tool result to reference, so triage must still proceed
    // rather than fail the whole work item.
    const knowledgeResult = selectedKnowledgeAttempt?.result ?? null;
    const enrichedKnowledgeItems = [...knowledgeItems];
    const knowledgeDocumentAttempts: KnowledgeDocumentFetchAttempt[] = [];
    for (const [documentIndex, item] of knowledgeItems.slice(0, MAX_KNOWLEDGE_DOCUMENTS_FOR_REPLY).entries()) {
      const documentId = knowledgeDocumentRef(item);
      if (!documentId) {
        continue;
      }
      try {
        const result = await this.dispatcher.execute<Record<string, unknown>>(context, {
          capabilityName: 'get_document',
          input: {
            document_id: documentId,
          },
          execution: {
            surface: 'internal',
            trigger_kind: 'internal',
            runId: ticketResult.run_id,
            stepIndex: stepIndex++,
            metadata: {
              ...baseMetadata,
              knowledge_document_source: 'ticket',
              knowledge_document_index: documentIndex + 1,
              knowledge_document_ref: documentId,
            },
          },
        });
        allEvidenceIds.push(...await this.evidenceIdsForTool(context, result.tool_execution_id));
        const fullDocument = knowledgeDocumentFromOutput(item, result.output);
        if (fullDocument) {
          enrichedKnowledgeItems[documentIndex] = fullDocument;
        }
        knowledgeDocumentAttempts.push({
          document_id: documentId,
          result,
          item: fullDocument,
        });
      } catch (error) {
        knowledgeDocumentAttempts.push({
          document_id: documentId,
          error_message: error instanceof Error ? error.message : String(error || 'Document fetch failed.'),
        });
      }
    }

    // Web search (best-effort): only when this agent has web search enabled AND a Brave Search
    // key is configured platform-side. Web findings are recorded as external (lower) trust and
    // never outrank KANAP knowledge — they augment the internal note and only fill a gap in the
    // requester reply when no knowledge matched. The capability sanitises the query to public-only
    // terms (internal refs stripped) and throws if nothing public-meaningful remains; we treat any
    // failure as "no web results" so triage still proceeds on knowledge + the LLM.
    let webSearchResults: WebSearchResultItem[] = [];
    let webSearchStatus: string = knowledgeSources.webEnabled ? 'disabled_by_platform' : 'disabled_by_agent';
    let webSearchQuery: string | null = null;
    let webSearchError: string | null = null;
    const webQueryCandidates = knowledgeSources.webEnabled && Features.AI_WEB_SEARCH_READY
      ? buildWebSearchQueryCandidates(ticketForKnowledge, ticketTimeline, knowledgeQueryCandidates)
      : [];
    if (knowledgeSources.webEnabled && Features.AI_WEB_SEARCH_READY) {
      const webQuery = webQueryCandidates[0] ?? trimmedString(ticket.title) ?? '';
      webSearchQuery = webQuery || null;
      if (webQuery) {
        try {
          const webResult = await this.dispatcher.execute<Record<string, unknown>>(context, {
            capabilityName: 'web_search',
            input: { query: webQuery, count: 5 },
            execution: {
              surface: 'internal',
              trigger_kind: 'internal',
              runId: ticketResult.run_id,
              stepIndex: stepIndex++,
              metadata: {
                ...baseMetadata,
                web_query_source: 'ticket',
              },
            },
          });
          allEvidenceIds.push(...await this.evidenceIdsForTool(context, webResult.tool_execution_id));
          webSearchResults = webSearchItemsFromOutput(webResult.output);
          webSearchStatus = 'executed';
        } catch (error) {
          webSearchStatus = 'failed';
          webSearchError = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Web search skipped for ticket ${ticket.id}: ${webSearchError}`);
        }
      } else {
        webSearchStatus = 'skipped_empty_query';
      }
    }

    const synthesisLanguage = resolveReplyLanguage(agentDefinition, ticket, knowledgeSearchPlan.language);
    // Assigned inside the `runReplySynthesis` closure below. Flow analysis cannot see that write,
    // so without keeping the declared union here the reads after the closure call narrow to `null`.
    let replySynthesisResult: ReplySynthesisResult | null = null as ReplySynthesisResult | null;
    let synthesisFallbackReason: string | null = null;
    let synthesisProjection: { estimatedTokens: number; estimatedCostEur: number } | null = null;
    const synthesisInputSummary = {
      language: synthesisLanguage,
      knowledge_source_count: enrichedKnowledgeItems.length,
      web_source_count: webSearchResults.length,
      model: null,
      prompt_profile: promptRuntime.promptProfileSummary,
    };
    const runReplySynthesis = async (): Promise<void> => {
      if (replySynthesisResult || synthesisFallbackReason) {
        return;
      }
      if (!this.replySynthesis) {
        synthesisFallbackReason = 'synthesis_service_unavailable';
        await this.recordStageRunStep(context, RUN_STEP_STAGES.synthesis, {
          runId: ticketResult.run_id,
          stepIndex: stepIndex++,
          status: 'skipped',
          inputSummary: synthesisInputSummary,
          outputSummary: { fallback_reason: synthesisFallbackReason },
        });
        return;
      }
      if (process.env.AI_AGENT_REPLY_SYNTHESIS === '0') {
        synthesisFallbackReason = 'synthesis_disabled_by_env';
        await this.recordStageRunStep(context, RUN_STEP_STAGES.synthesis, {
          runId: ticketResult.run_id,
          stepIndex: stepIndex++,
          status: 'skipped',
          inputSummary: synthesisInputSummary,
          outputSummary: { fallback_reason: synthesisFallbackReason },
        });
        return;
      }
      const synthesisPayload = this.replySynthesis.buildPromptPayload({
        ticket,
        timeline: ticketTimeline,
        language: synthesisLanguage,
        knowledgeDocs: enrichedKnowledgeItems.slice(0, MAX_KNOWLEDGE_DOCUMENTS_FOR_REPLY),
        webResults: webSearchResults,
        imageEvidence: ticketImageExtraction.evidence,
        interpretation: serializeKnowledgeInterpretation(knowledgeInterpretation),
        profile: promptRuntime.synthesisGuidance,
      });
      synthesisProjection = estimateReplySynthesisUsage({
        systemPrompt: compileSystemPrompt(RUNTIME_SAFETY_FLOOR_SYNTHESIS, promptRuntime.synthesisGuidance),
        userPayload: synthesisPayload,
      }, llmPrices, this.replySynthesis.maxOutputTokens());
      const baseUsageEstimate = currentRunLlmUsage();
      const guardrails = this.agentQueue && agentDefinition ? this.agentQueue.runGuardrails(agentDefinition) : null;
      if (
        guardrails
        && (
          baseUsageEstimate.estimatedTokens + synthesisProjection.estimatedTokens > guardrails.maxEstimatedTokens
          || baseUsageEstimate.estimatedCostEur + synthesisProjection.estimatedCostEur > guardrails.maxEstimatedCostEur
        )
      ) {
        synthesisFallbackReason = 'synthesis_projected_over_per_run_cap';
        await this.recordStageRunStep(context, RUN_STEP_STAGES.synthesis, {
          runId: ticketResult.run_id,
          stepIndex: stepIndex++,
          status: 'skipped',
          inputSummary: {
            ...synthesisInputSummary,
            projected_tokens: synthesisProjection.estimatedTokens,
            projected_cost_eur: synthesisProjection.estimatedCostEur,
          },
          outputSummary: {
            fallback_reason: synthesisFallbackReason,
            base_estimated_tokens: baseUsageEstimate.estimatedTokens,
            base_estimated_cost_eur: baseUsageEstimate.estimatedCostEur,
            cap: guardrails,
          },
        });
      } else {
        const synthesisStepIndex = stepIndex++;
        try {
          replySynthesisResult = await this.replySynthesis.synthesizeTicketReply(context, {
            ticket,
            timeline: ticketTimeline,
            language: synthesisLanguage,
            knowledgeDocs: enrichedKnowledgeItems.slice(0, MAX_KNOWLEDGE_DOCUMENTS_FOR_REPLY),
            webResults: webSearchResults,
            imageEvidence: ticketImageExtraction.evidence,
            interpretation: serializeKnowledgeInterpretation(knowledgeInterpretation),
            profile: promptRuntime.synthesisGuidance,
          });
          if (replySynthesisResult.fallback_reason) {
            synthesisFallbackReason = replySynthesisResult.fallback_reason;
          }
          await this.recordStageUsage(context, 'synthesis', ticketResult.run_id, replySynthesisResult);
          chargeRunLlmUsage(replySynthesisResult);
          await this.recordStageRunStep(context, RUN_STEP_STAGES.synthesis, {
            runId: ticketResult.run_id,
            stepIndex: synthesisStepIndex,
            status: 'completed',
            inputSummary: {
              ...synthesisInputSummary,
              model: replySynthesisResult.model,
              projected_tokens: synthesisProjection?.estimatedTokens ?? null,
              projected_cost_eur: synthesisProjection?.estimatedCostEur ?? null,
            },
            outputSummary: {
              usable: replySynthesisResult.usable,
              needs_human_review: replySynthesisResult.needs_human_review,
              reply_length: replySynthesisResult.requester_reply.length,
              used_source_count: replySynthesisResult.used_sources.length,
              rejected_source_count: replySynthesisResult.rejected_sources.length,
              tokens: replySynthesisResult.estimated_tokens,
              cost_eur: replySynthesisResult.estimated_cost_eur,
              latency_ms: replySynthesisResult.latency_ms,
              fallback_reason: replySynthesisResult.fallback_reason,
            },
          });
        } catch (error) {
          synthesisFallbackReason = error instanceof Error ? `synthesis_error:${error.message.slice(0, 180)}` : 'synthesis_error';
          await this.recordStageRunStep(context, RUN_STEP_STAGES.synthesis, {
            runId: ticketResult.run_id,
            stepIndex: synthesisStepIndex,
            status: 'failed',
            inputSummary: {
              ...synthesisInputSummary,
              projected_tokens: synthesisProjection?.estimatedTokens ?? null,
              projected_cost_eur: synthesisProjection?.estimatedCostEur ?? null,
            },
            outputSummary: { fallback_reason: synthesisFallbackReason },
            errorMessage: synthesisFallbackReason,
          });
        }
      }
    };
    const buildSynthesisMetadata = () => replySynthesisResult ? {
      synthesis_model: replySynthesisResult.model,
      synthesis_tokens: replySynthesisResult.estimated_tokens,
      synthesis_usage: replySynthesisResult.usage,
      synthesis_cost_eur: replySynthesisResult.estimated_cost_eur,
      synthesis_usable: replySynthesisResult.usable,
      synthesis_needs_human_review: replySynthesisResult.needs_human_review,
      synthesis_used_sources: replySynthesisResult.used_sources,
      synthesis_rejected_sources: replySynthesisResult.rejected_sources,
      synthesis_confidence: replySynthesisResult.confidence,
      synthesis_language: replySynthesisResult.language,
      synthesis_fallback_reason: synthesisFallbackReason,
      synthesis_latency_ms: replySynthesisResult.latency_ms,
    } : {
      synthesis_model: null,
      synthesis_tokens: null,
      synthesis_usage: null,
      synthesis_cost_eur: null,
      synthesis_usable: false,
      synthesis_needs_human_review: true,
      synthesis_used_sources: [],
      synthesis_rejected_sources: [],
      synthesis_confidence: null,
      synthesis_language: synthesisLanguage,
      synthesis_fallback_reason: synthesisFallbackReason ?? 'synthesis_not_attempted',
      synthesis_latency_ms: null,
    };

    const actionPlannerGuidanceHash = guidanceHash(promptRuntime.actionPlannerGuidance);
    const assignmentWriteCapable = !!agentDefinition
      && definitionAllowsCapability(agentDefinition, TICKETING_ASSIGNMENT_UPDATE_PREPARE_CAPABILITY)
      && definitionAllowsCapability(agentDefinition, TICKETING_ASSIGNMENT_UPDATE_APPROVED_CAPABILITY);
    const assignmentRoutingAvailable = assignmentWriteCapable && routingContext?.assignmentSupported === true;
    const classificationWriteCapable = !!agentDefinition
      && definitionAllowsCapability(agentDefinition, TICKETING_CLASSIFICATION_UPDATE_PREPARE_CAPABILITY)
      && definitionAllowsCapability(agentDefinition, TICKETING_CLASSIFICATION_UPDATE_APPROVED_CAPABILITY);
    const classificationAvailable = classificationWriteCapable && classificationContext?.classificationSupported === true;
    const plannerOwnedActionTypes: PlannerActionType[] = [
      ...PHASE_1_PLANNER_OWNED_ACTION_TYPES,
      ...(assignmentRoutingAvailable ? [PLANNER_ASSIGNMENT_ACTION_TYPE] : []),
      ...(classificationAvailable ? [PLANNER_CLASSIFICATION_ACTION_TYPE] : []),
    ];
    const closeWriteCapable = !!agentDefinition
      && definitionAllowsCapability(agentDefinition, TICKETING_STATUS_UPDATE_PREPARE_CAPABILITY)
      && definitionAllowsCapability(agentDefinition, TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY)
      && definitionAllowsCapability(agentDefinition, TICKETING_PUBLIC_REPLY_PREPARE_CAPABILITY)
      && definitionAllowsCapability(agentDefinition, TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY);
    const targetingEligibility = closeWriteCapable && agentDefinition
      ? await this.ticketTargetingEligibility(context, agentDefinition, ticket as TicketRecord, target.provider_key)
      : { matched: false, hasInactivityAge: false };
    const closeEligible = closeWriteCapable
      && lifecycleContext?.terminal !== true
      && targetingEligibility.hasInactivityAge
      && targetingEligibility.matched;

    let actionPlannerResult: ActionPlannerResult | null = null;
    let actionPlannerFallbackReason: string | null = null;
    let actionPlannerProjection: { estimatedTokens: number; estimatedCostEur: number } | null = null;
    const providerActionPlannerProfile = await this.actionPlannerProfileForProvider(
      context,
      target.provider_kind,
      target.provider_key,
    );
    const actionPlannerInput = {
      ticket,
      timeline: ticketTimeline,
      contexts: {
        classification: classificationContext,
        lifecycle: lifecycleContext,
        routing: routingContext,
        participants: participantContext,
      },
      gates: conversationGate as unknown as Record<string, unknown>,
      close_eligibility: {
        matched: closeEligible,
        has_inactivity_age: targetingEligibility.hasInactivityAge,
        terminal: lifecycleContext?.terminal === true,
      },
      reply_language: synthesisLanguage,
      knowledge_summary: plannerKnowledgeSummary(knowledgeItems, knowledgeLowRelevance.length, knowledgeInterpretation, knowledgeSearchPlan, knowledgeQueryDerivation),
      web_summary: plannerWebSummary(webSearchResults, webSearchStatus, webSearchQuery),
      image_evidence: ticketImageExtraction.evidence,
      granted_capabilities: allowedCapabilityNames(agentDefinition),
      owned_action_types: plannerOwnedActionTypes,
      provider_profile: providerActionPlannerProfile,
      verbatim_candidates: promptRuntime.profile.verbatim_candidates,
      profile: promptRuntime.actionPlannerGuidance,
    };
    if (!this.actionPlanner) {
      actionPlannerFallbackReason = 'action_planner_service_unavailable';
    } else if (!agentDefinition) {
      actionPlannerFallbackReason = 'action_planner_no_agent_definition';
    } else if (process.env.AI_AGENT_ACTION_PLANNER === '0') {
      actionPlannerFallbackReason = 'action_planner_disabled_by_env';
    } else {
      const actionPlannerPayload = this.actionPlanner.buildPromptPayload(actionPlannerInput);
      actionPlannerProjection = estimateActionPlannerUsage({
        systemPrompt: compileSystemPrompt(RUNTIME_SAFETY_FLOOR_ACTION_PLANNER, promptRuntime.actionPlannerGuidance),
        userPayload: actionPlannerPayload,
      }, llmPrices, this.actionPlanner.maxOutputTokens());
      const actionPlannerBaseUsageEstimate = currentRunLlmUsage();
      const guardrails = this.agentQueue && agentDefinition ? this.agentQueue.runGuardrails(agentDefinition) : null;
      if (
        guardrails
        && (
          actionPlannerBaseUsageEstimate.estimatedTokens + actionPlannerProjection.estimatedTokens > guardrails.maxEstimatedTokens
          || actionPlannerBaseUsageEstimate.estimatedCostEur + actionPlannerProjection.estimatedCostEur > guardrails.maxEstimatedCostEur
        )
      ) {
        actionPlannerFallbackReason = 'action_planner_projected_over_per_run_cap';
      } else {
        actionPlannerResult = await this.actionPlanner.planActions(context, actionPlannerInput);
        if (actionPlannerResult) {
          await this.recordStageUsage(context, 'action_planner', ticketResult.run_id, actionPlannerResult);
          chargeRunLlmUsage(actionPlannerResult);
        } else {
          actionPlannerFallbackReason = 'action_planner_unavailable_or_invalid';
        }
      }
    }

    const plannerFallbackActive = actionPlannerResult == null;
    const verbatimCandidates = promptRuntime.profile.verbatim_candidates;
    const plannerAuthorizedActions: Array<{
      action: PlannerAction;
      plannerActionKey: string;
      replyBody: string | null;
      terminal: boolean;
    }> = [];
    const plannerSkippedActions: Record<string, string> = {};
    const markPlannerSkipped = (actionType: PlannerActionType, reason: string) => {
      if (!plannerSkippedActions[actionType]) {
        plannerSkippedActions[actionType] = reason;
      }
    };
    if (actionPlannerResult) {
      const seenPlannerActions = new Set<string>();
      for (const action of actionPlannerResult.actions) {
        const actionType = action.action_type;
        const actionKey = plannerActionKindKey(action);
        if (!PLANNER_OWNED_ACTION_TYPES.has(actionType)) {
          markPlannerSkipped(actionType, 'action_type_not_owned_in_phase_1');
          continue;
        }
        if (actionType === PLANNER_ASSIGNMENT_ACTION_TYPE && !assignmentRoutingAvailable) {
          markPlannerSkipped(actionType, assignmentWriteCapable ? 'assignment_not_supported_by_provider' : 'prepare_capability_not_granted');
          continue;
        }
        if (actionType === PLANNER_CLASSIFICATION_ACTION_TYPE && !classificationAvailable) {
          markPlannerSkipped(actionType, classificationWriteCapable ? 'classification_not_supported_by_provider' : 'prepare_capability_not_granted');
          continue;
        }
        if (actionType !== PLANNER_CLASSIFICATION_ACTION_TYPE && seenPlannerActions.has(actionKey)) {
          markPlannerSkipped(actionType, 'duplicate_planner_action');
          continue;
        }
        seenPlannerActions.add(actionKey);
        const capabilityNames = ACTION_TYPE_CAPABILITY_TABLE[actionType];
        if (!capabilityNames) {
          markPlannerSkipped(actionType, 'action_type_not_mapped_to_capability');
          continue;
        }
        if (!agentDefinition || !definitionAllowsCapability(agentDefinition, capabilityNames.prepare)) {
          markPlannerSkipped(actionType, 'prepare_capability_not_granted');
          continue;
        }
        if (!definitionAllowsCapability(agentDefinition, capabilityNames.approved)) {
          markPlannerSkipped(actionType, 'approved_capability_not_granted');
          continue;
        }
        let authorizedAction = action;
        let replyBody: string | null = null;
        let terminal = false;
        if (actionType === 'internal_note') {
          if (!conversationGate.can_prepare_internal_note) {
            markPlannerSkipped(actionType, conversationGate.internal_note_reason);
            continue;
          }
        } else if (actionType === 'requester_reply') {
          const replyKind = action.reply_kind;
          if (replyKind !== 'sourced_answer' && replyKind !== 'administrative') {
            markPlannerSkipped(actionType, 'missing_or_invalid_reply_kind');
            continue;
          }
          if (replyKind === 'sourced_answer' && !conversationGate.can_prepare_sourced_answer) {
            markPlannerSkipped(actionType, conversationGate.sourced_answer_reason);
            continue;
          }
          if (replyKind === 'administrative') {
            const isCloseReply = action.administrative_intent === 'close_reply';
            if (isCloseReply) {
              if (!conversationGate.can_prepare_administrative_close_reply) {
                markPlannerSkipped(actionType, conversationGate.administrative_close_reply_reason);
                continue;
              }
              if (!closeEligible) {
                markPlannerSkipped(actionType, 'ticket_not_eligible_for_administrative_close_reply');
                continue;
              }
            } else if (!conversationGate.can_prepare_public_reply) {
              markPlannerSkipped(actionType, conversationGate.public_reply_reason);
              continue;
            }
            if (action.verbatim_ref) {
              const candidate = resolveVerbatimCandidate(verbatimCandidates, action.verbatim_ref);
              if (!candidate) {
                markPlannerSkipped(actionType, 'verbatim_ref_not_found_in_trusted_config');
                continue;
              }
              replyBody = candidate.text.replace(/\r\n/g, '\n').trim();
            } else {
              // No ref, but the model may have written the configured exact message
              // straight into body: snap to the trusted candidate so the verbatim
              // guarantee still holds. Otherwise treat body as a free administrative draft.
              const bodyAsCandidate = action.body
                ? resolveVerbatimCandidate(verbatimCandidates, action.body)
                : null;
              replyBody = bodyAsCandidate
                ? bodyAsCandidate.text.replace(/\r\n/g, '\n').trim()
                : sanitizeForProvider(action.body, MAX_SYNTHESIZED_REQUESTER_BODY_CHARS);
            }
            if (!replyBody) {
              markPlannerSkipped(actionType, 'administrative_reply_body_missing');
              continue;
            }
          }
        } else if (actionType === 'status_update') {
          const resolvedTransition = resolvePlannerStatusTransition(lifecycleContext, action, closeEligible);
          if (!resolvedTransition.key) {
            markPlannerSkipped(actionType, 'missing_transition_key');
            continue;
          }
          if (!resolvedTransition.transition || lifecycleContext?.terminal === true) {
            markPlannerSkipped(actionType, 'transition_not_allowed');
            continue;
          }
          terminal = lifecycleTransitionIsTerminal(resolvedTransition.transition);
          if (terminal && !closeEligible) {
            markPlannerSkipped(actionType, 'terminal_transition_requires_close_eligibility');
            continue;
          }
          authorizedAction = {
            ...action,
            transition_key: resolvedTransition.key,
            ...(resolvedTransition.resolution ? { transition_resolution: resolvedTransition.resolution } : {}),
          } as PlannerAction;
        } else if (actionType === PLANNER_CLASSIFICATION_ACTION_TYPE) {
          if (plannerAuthorizedActions.some((entry) => entry.action.action_type === PLANNER_CLASSIFICATION_ACTION_TYPE)) {
            markPlannerSkipped(actionType, 'one_classification_per_plan');
            continue;
          }
          const resolved = resolvePlannerClassificationProposal(classificationContext, {
            proposed: action.proposed ?? undefined,
          });
          if (!resolved.proposed) {
            markPlannerSkipped(actionType, resolved.reason ?? 'classification_field_not_in_catalogue');
            continue;
          }
          authorizedAction = { ...action, proposed: resolved.proposed };
        } else if (actionType === PLANNER_ASSIGNMENT_ACTION_TYPE) {
          // Resolve first, so an invalid or already-present target reports its own reason
          // instead of being masked by the per-kind cap.
          const resolvedTarget = resolvePlannerAssignmentTarget(routingContext, action);
          if (!resolvedTarget.target) {
            markPlannerSkipped(actionType, resolvedTarget.reason ?? 'assignment_target_not_in_routing_catalogue');
            continue;
          }
          // One group AND one technician may be proposed in the same plan, at most one per
          // kind: the writes are additive, so both can apply in one approved batch.
          if (plannerAuthorizedActions.some((entry) => entry.action.action_type === PLANNER_ASSIGNMENT_ACTION_TYPE
            && entry.action.target?.kind === resolvedTarget.target!.kind)) {
            markPlannerSkipped(actionType, 'one_assignment_per_kind_per_plan');
            continue;
          }
          authorizedAction = { ...action, target: resolvedTarget.target } as PlannerAction;
        }
        plannerAuthorizedActions.push({
          action: authorizedAction,
          plannerActionKey: plannerActionKey(authorizedAction, actionPlannerGuidanceHash),
          replyBody,
          terminal,
        });
      }
    }
    for (const actionType of plannerOwnedActionTypes) {
      if (
        actionPlannerResult
        && !plannerAuthorizedActions.some((entry) => entry.action.action_type === actionType)
        && !plannerSkippedActions[actionType]
      ) {
        plannerSkippedActions[actionType] = 'not_selected_by_action_planner';
      }
    }
    const plannerActionSummaries = plannerAuthorizedActions.map((entry) => ({
      action_type: entry.action.action_type,
      key: entry.plannerActionKey,
      reply_kind: entry.action.reply_kind ?? null,
      administrative_intent: entry.action.administrative_intent ?? null,
      transition_key: entry.action.transition_key ?? null,
      transition_resolution: isRecord(entry.action) && typeof entry.action.transition_resolution === 'string'
        ? entry.action.transition_resolution
        : null,
      target: entry.action.target ?? null,
      proposed: entry.action.proposed ?? null,
      terminal: entry.terminal,
      reason: entry.action.reason,
    }));
    const plannerPlannedActionSummaries = (actionPlannerResult?.actions ?? []).map((action) => ({
      action_type: action.action_type,
      reply_kind: action.reply_kind ?? null,
      administrative_intent: action.administrative_intent ?? null,
      transition_key: action.transition_key ?? null,
      target: action.target ?? null,
      proposed: action.proposed ?? null,
      verbatim_ref: action.verbatim_ref ?? null,
      body_present: typeof action.body === 'string' && action.body.trim().length > 0,
      reason: action.reason,
    }));
    const actionPlannerMetadata = {
      enabled: process.env.AI_AGENT_ACTION_PLANNER !== '0',
      owned_action_types: plannerOwnedActionTypes,
      used: actionPlannerResult != null,
      fallback_reason: actionPlannerFallbackReason,
      model: actionPlannerResult?.model ?? null,
      projected_tokens: actionPlannerProjection?.estimatedTokens ?? null,
      projected_cost_eur: actionPlannerProjection?.estimatedCostEur ?? null,
      tokens: actionPlannerResult?.estimated_tokens ?? null,
      cost_eur: actionPlannerResult?.estimated_cost_eur ?? null,
      latency_ms: actionPlannerResult?.latency_ms ?? null,
      guidance_hash: actionPlannerGuidanceHash,
      rationale: actionPlannerResult?.rationale ?? null,
      confidence: actionPlannerResult?.confidence ?? null,
      planned_actions: plannerPlannedActionSummaries,
      authorized_actions: plannerActionSummaries,
      skipped_actions: plannerSkippedActions,
    };
    const fallbackPrepareInternalNote = plannerFallbackActive && conversationGate.can_prepare_internal_note;
    // Drives whether we ATTEMPT synthesis below — the actual external prepare is gated on a usable
    // result (fallbackPublicReplyUsable), computed once synthesis has run.
    const fallbackPreparePublicReply = plannerFallbackActive && conversationGate.can_prepare_public_reply;
    const fallbackStatusUpdateProposal = plannerFallbackActive
      ? buildStatusUpdateProposal(lifecycleContext, conversationGate.can_prepare_public_reply)
      : null;

    const plannerNeedsSourcedSynthesis = plannerAuthorizedActions.some((entry) =>
      entry.action.action_type === 'requester_reply' && entry.action.reply_kind === 'sourced_answer',
    );
    if (plannerNeedsSourcedSynthesis || fallbackPreparePublicReply) {
      await runReplySynthesis();
    }
    const runUsageEstimate = await this.recordAndEnforceHelpdeskRunCap(context, {
      definition: agentDefinition,
      runId: ticketResult.run_id,
      stage: 'before_proposal_preparation',
      usage: currentRunLlmUsage(),
    });
    const synthesisMetadata = buildSynthesisMetadata();
    // Fail closed (#47): in the legacy fallback (action planner unavailable), only prepare the
    // EXTERNAL requester reply and the pending transition when synthesis actually produced a
    // usable, grounded answer. A failed / skipped / truncated synthesis must never ship a generic
    // "no reliable answer" public reply, nor move the ticket to pending as if we were waiting on
    // the requester — the internal note alone carries the escalation for a technician to complete.
    const fallbackPublicReplyUsable = fallbackPreparePublicReply && replySynthesisResult?.usable === true;
    const fallbackStatusUpdateInput = fallbackPublicReplyUsable ? fallbackStatusUpdateProposal : null;

    let effectivePlannerActions = [...plannerAuthorizedActions];
    const plannerDowngradedActions: Record<string, string> = {};
    const sourcedReplyAction = effectivePlannerActions.find((entry) =>
      entry.action.action_type === 'requester_reply' && entry.action.reply_kind === 'sourced_answer',
    ) ?? null;
    if (sourcedReplyAction && (!replySynthesisResult || !replySynthesisResult.usable)) {
      const downgradeReason = synthesisFallbackReason
        ?? replySynthesisResult?.fallback_reason
        ?? 'synthesis_unavailable_or_unusable';
      plannerDowngradedActions.requester_reply = downgradeReason;
      plannerSkippedActions.requester_reply = downgradeReason;
      effectivePlannerActions = effectivePlannerActions.filter((entry) => entry !== sourcedReplyAction);
      effectivePlannerActions = effectivePlannerActions.filter((entry) => {
        if (entry.action.action_type !== 'status_update') {
          return true;
        }
        const transitionKey = normalizePlannerStatusTransitionKey(entry.action.transition_key);
        if (transitionKey !== 'pending') {
          return true;
        }
        const statusDowngradeReason = `pending_requires_usable_requester_reply: ${downgradeReason}`;
        plannerDowngradedActions.status_update = statusDowngradeReason;
        plannerSkippedActions.status_update = statusDowngradeReason;
        return false;
      });
      const hasInternalNote = effectivePlannerActions.some((entry) => entry.action.action_type === 'internal_note');
      const canPrepareDowngradeInternalNote = !!agentDefinition
        && conversationGate.can_prepare_internal_note
        && definitionAllowsCapability(agentDefinition, TICKETING_INTERNAL_NOTE_PREPARE_CAPABILITY)
        && definitionAllowsCapability(agentDefinition, TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY);
      if (!hasInternalNote && canPrepareDowngradeInternalNote) {
        delete plannerSkippedActions.internal_note;
        const downgradeAction: PlannerAction = {
          action_type: 'internal_note',
          reason: `Escalate internally because sourced reply synthesis was not usable: ${downgradeReason}.`,
        };
        effectivePlannerActions.push({
          action: downgradeAction,
          plannerActionKey: `downgrade:${sourcedReplyAction.plannerActionKey}:internal_note`,
          replyBody: null,
          terminal: false,
        });
      }
    }
    // Internal-note body: a usable synthesis renders the full triage note; otherwise, if the
    // planner deliberately handled the ticket itself — an internal escalation (no requester reply
    // prepared) or a planner-authored administrative reply (synthesis skipped by design) — the note
    // carries the agent's rationale instead of the "synthesis unavailable, complete manually"
    // boilerplate (which is only honest when a sourced answer was expected and failed).
    // Snake_case gate tokens are filtered out.
    const effectiveInternalNoteAction = effectivePlannerActions.find((entry) => entry.action.action_type === 'internal_note') ?? null;
    const hasEffectiveRequesterReply = effectivePlannerActions.some((entry) => entry.action.action_type === 'requester_reply');
    const effectiveAdministrativeReplyAction = effectivePlannerActions.find((entry) =>
      entry.action.action_type === 'requester_reply' && entry.action.reply_kind === 'administrative') ?? null;
    // An internal escalation = the planner ran, prepared an internal note, and NO requester reply
    // is being prepared (either never selected, #35, or downgraded after unusable synthesis, #37).
    const isPlannerEscalation = !!actionPlannerResult && !!effectiveInternalNoteAction && !hasEffectiveRequesterReply;
    const isPlannerAdministrativeReply = !!actionPlannerResult && !!effectiveInternalNoteAction && !!effectiveAdministrativeReplyAction;
    const isProseReason = (value: string): boolean => value.length > 0 && !/^[a-z0-9_]+$/.test(value);
    const plannerReasonProse = (reasons: Array<string | null | undefined>): string | null =>
      reasons
        .map((reason) => (reason ?? '').trim())
        .filter(isProseReason)
        .filter((reason, index, all) => all.indexOf(reason) === index)
        .join(' — ') || null;
    const escalationReason = isPlannerEscalation && actionPlannerResult
      ? plannerReasonProse([actionPlannerResult.rationale, effectiveInternalNoteAction.action.reason])
      : null;
    const administrativeReason = isPlannerAdministrativeReply && actionPlannerResult
      ? plannerReasonProse([
        actionPlannerResult.rationale,
        effectiveAdministrativeReplyAction.action.reason,
        effectiveInternalNoteAction.action.reason,
      ])
      : null;
    const noteBody = isPlannerEscalation
      ? buildTriageNote(ticket, knowledgeItems, ticketTimeline, webSearchResults, { kind: 'escalation', reason: escalationReason })
      : (replySynthesisResult
        ? renderSynthesizedTriageNote(ticket, ticketTimeline, replySynthesisResult)
        : (isPlannerAdministrativeReply
          ? buildTriageNote(ticket, knowledgeItems, ticketTimeline, webSearchResults, { kind: 'administrative_reply', reason: administrativeReason })
          : buildTriageNote(ticket, knowledgeItems, ticketTimeline, webSearchResults, null)));

    const plannerClassificationUpdate = effectivePlannerActions.find((entry) => entry.action.action_type === PLANNER_CLASSIFICATION_ACTION_TYPE) ?? null;
    const classificationUpdateInput = plannerClassificationUpdate?.action.proposed
      ? { proposed: plannerClassificationUpdate.action.proposed, reason: plannerClassificationUpdate.action.reason }
      : null;

    const effectivePlannerActionSummaries = effectivePlannerActions.map((entry) => ({
      action_type: entry.action.action_type,
      key: entry.plannerActionKey,
      reply_kind: entry.action.reply_kind ?? null,
      administrative_intent: entry.action.administrative_intent ?? null,
      transition_key: entry.action.transition_key ?? null,
      transition_resolution: isRecord(entry.action) && typeof entry.action.transition_resolution === 'string'
        ? entry.action.transition_resolution
        : null,
      target: entry.action.target ?? null,
      proposed: entry.action.proposed ?? null,
      terminal: entry.terminal,
      reason: entry.action.reason,
    }));
    const actionPlannerMetadataForAudit = {
      ...actionPlannerMetadata,
      effective_actions: effectivePlannerActionSummaries,
      downgraded_actions: plannerDowngradedActions,
      skipped_actions: plannerSkippedActions,
    };
    const proposalScope = {
      providerKind: target.provider_kind,
      providerKey: target.provider_key,
      targetType: target.target_kind,
      targetRef: ticket.id,
    };
    const proposalAgentDefinitionId = stringFromMetadata(metadataObject(baseMetadata).agent_definition_id);
    const effectivePlannerActionKeys = new Set(effectivePlannerActions.map((entry) => entry.plannerActionKey));
    await this.withdrawSupersededPlannerProposals(context, {
      ...proposalScope,
      agentDefinitionId: stringFromMetadata(metadataObject(baseMetadata).agent_definition_id),
      currentPlannerActionKeys: actionPlannerResult ? effectivePlannerActionKeys : null,
      currentGuidanceHash: actionPlannerGuidanceHash,
      closeNoLongerEligible: !closeEligible,
    });

    const now = new Date();
    const observationRepo = context.manager.getRepository(AiObservation);
    const observation = await observationRepo.save(observationRepo.create({
      tenant_id: context.tenantId,
      run_id: ticketResult.run_id,
      observation_type: options.observationType ?? TICKETING_TRIAGE_RUN_OPTIONS.observationType,
      status: 'observed',
      source_provider: `${target.provider_kind}:${target.provider_key}`,
      source_object_type: 'ticket',
      source_object_id: ticket.id,
      severity: ticket.priority ?? null,
      summary: `Ticket ${ticket.id}: ${ticket.title}. ${knowledgeItems.length} knowledge result(s) found.`,
      evidence_ids: allEvidenceIds,
      metadata_json: {
        ...agentMetadata,
        provider_key: target.provider_key,
        target_key: target.target_key,
        ticket_history_entry_count: ticketTimeline.length,
        latest_requester_message_at: conversationGate.latest_requester_message_at,
        classification_context: classificationContext,
        lifecycle_context: lifecycleContext,
        routing_context: routingContext,
        participant_context: participantContext,
        knowledge_need_representation: serializeKnowledgeNeedRepresentation(knowledgeNeedRepresentation),
        knowledge_query_derivation: serializeKnowledgeQueryDerivation(knowledgeQueryDerivation),
        ticket_image_evidence: ticketImageExtraction.evidence,
        ticket_image_evidence_warnings: ticketImageExtraction.warnings,
        ticket_image_evidence_skipped_reason: ticketImageExtraction.skippedReason,
        ticket_attachment_refs: ticketImageExtraction.attachmentRefs,
        run_usage_estimate: runUsageEstimate,
        knowledge_result_count: knowledgeItems.length,
        knowledge_low_relevance_count: knowledgeLowRelevance.length,
        knowledge_low_relevance: knowledgeLowRelevance,
        web_search_enabled: knowledgeSources.webEnabled === true,
        web_search_ready: Features.AI_WEB_SEARCH_READY,
        web_search_status: webSearchStatus,
        web_search_query: webSearchQuery,
        web_search_query_candidates: webQueryCandidates,
        web_search_error: webSearchError,
        web_result_count: webSearchResults.length,
        knowledge_candidate_count: mergedKnowledgeCandidates.length,
        knowledge_query: selectedKnowledgeAttempt?.query ?? null,
        knowledge_query_attempt_count: knowledgeAttempts.length,
        knowledge_document_fetch_count: knowledgeDocumentAttempts.filter((attempt) => !!attempt.result).length,
        knowledge_search_plan: serializeKnowledgeSearchPlan(knowledgeSearchPlan),
        knowledge_result_interpretation: serializeKnowledgeInterpretation(knowledgeInterpretation),
        action_planner: actionPlannerMetadataForAudit,
        ...synthesisMetadata,
      },
      observed_at: now,
      created_at: now,
      updated_at: now,
    }));

    const expectedActionLabels = [
      fallbackPrepareInternalNote || effectivePlannerActions.some((entry) => entry.action.action_type === 'internal_note') ? 'internal note' : null,
      fallbackPublicReplyUsable || effectivePlannerActions.some((entry) => entry.action.action_type === 'requester_reply') ? 'requester reply' : null,
      fallbackStatusUpdateInput || effectivePlannerActions.some((entry) => entry.action.action_type === 'status_update') ? 'status update' : null,
      classificationUpdateInput ? 'classification update' : null,
      effectivePlannerActions.some((entry) => entry.action.action_type === PLANNER_ASSIGNMENT_ACTION_TYPE) ? 'assignment update' : null,
    ].filter((label): label is string => !!label);
    const anyActionEligible = expectedActionLabels.length > 0;
    const recommendationRepo = context.manager.getRepository(AiRecommendation);
    const recommendation = await recommendationRepo.save(recommendationRepo.create({
      tenant_id: context.tenantId,
      run_id: ticketResult.run_id,
      observation_id: observation.id,
      recommendation_type: options.recommendationType ?? TICKETING_TRIAGE_RUN_OPTIONS.recommendationType,
      status: anyActionEligible ? 'proposed' : 'skipped',
      summary: anyActionEligible
        ? `Prepare ${expectedActionLabels.join(' and ')} with the related KANAP knowledge and ticket history context.`
        : 'Do not prepare a ticketing action; the action planner/builders found no eligible action for this run.',
      rationale: anyActionEligible
        ? 'The workflow read the ticket history, searched the KANAP knowledge base, authorized the instruction-driven plan for owned actions, and kept non-owned deterministic builders unchanged.'
        : 'The workflow read the ticket history and no owned planner action or non-owned deterministic builder produced an eligible proposal.',
      confidence: knowledgeItems.length > 0 ? 0.72 : 0.46,
      proposed_action_class: 'ticket_triage_followups',
      max_autonomy_level: 'A2',
      evidence_ids: allEvidenceIds,
      metadata_json: {
        ...agentMetadata,
        provider_key: target.provider_key,
        target_key: target.target_key,
        conversation_gate: conversationGate,
        classification_context: classificationContext,
        lifecycle_context: lifecycleContext,
        routing_context: routingContext,
        participant_context: participantContext,
        knowledge_need_representation: serializeKnowledgeNeedRepresentation(knowledgeNeedRepresentation),
        knowledge_query_derivation: serializeKnowledgeQueryDerivation(knowledgeQueryDerivation),
        ticket_image_evidence: ticketImageExtraction.evidence,
        ticket_image_evidence_warnings: ticketImageExtraction.warnings,
        ticket_image_evidence_skipped_reason: ticketImageExtraction.skippedReason,
        ticket_attachment_refs: ticketImageExtraction.attachmentRefs,
        run_usage_estimate: runUsageEstimate,
        ticket_history: ticketTimeline.map((entry) => ({
          id: entry.id,
          visibility: entry.visibility,
          actor: entry.actor,
          created_at: entry.createdAt,
          body_preview: clampText(entry.body, 220),
        })),
        knowledge_query: selectedKnowledgeAttempt?.query ?? null,
        knowledge_search_plan: serializeKnowledgeSearchPlan(knowledgeSearchPlan),
        knowledge_query_attempts: knowledgeAttempts.map((attempt) => ({
          query: attempt.query,
          result_count: attempt.items.length,
          tool_execution_id: attempt.result.tool_execution_id,
        })),
        knowledge_candidates: mergedKnowledgeCandidates.map((item) => ({
          ref: item.ref ?? item.id ?? null,
          title: item.title ?? null,
          score: item.score ?? null,
          search_queries: item.search_queries,
        })),
        knowledge_result_interpretation: serializeKnowledgeInterpretation(knowledgeInterpretation),
        knowledge_low_relevance: knowledgeLowRelevance,
        knowledge_document_fetches: knowledgeDocumentAttempts.map((attempt) => ({
          document_id: attempt.document_id,
          tool_execution_id: attempt.result?.tool_execution_id ?? null,
          status: attempt.result ? 'completed' : 'failed',
          error_message: attempt.error_message ?? null,
        })),
        knowledge_results: knowledgeItems.map((item) => ({
          ref: item.ref ?? item.id ?? null,
          title: item.title ?? null,
          score: item.score ?? null,
        })),
        action_planner: actionPlannerMetadataForAudit,
        ...synthesisMetadata,
      },
      created_at: now,
      updated_at: now,
    }));

    const decisionRepo = context.manager.getRepository(AiDecision);
    const decision = await decisionRepo.save(decisionRepo.create({
      tenant_id: context.tenantId,
      run_id: ticketResult.run_id,
      recommendation_id: recommendation.id,
      decision: anyActionEligible ? 'prepare_action' : 'no_action',
      status: anyActionEligible ? 'pending_human_approval' : 'skipped',
      reason: anyActionEligible
        ? `Prepared ${expectedActionLabels.join(' and ')} action request(s); no write will occur without explicit approval.`
        : 'Skipped ticketing action preparation because no eligible planner or builder action was selected.',
      evidence_ids: allEvidenceIds,
      policy_result_json: {
        autonomy_level: 'A2',
        approval_required: anyActionEligible,
        action_planner_used: actionPlannerResult != null,
      },
      metadata_json: {
        ...agentMetadata,
        provider_key: target.provider_key,
        target_key: target.target_key,
        conversation_gate: conversationGate,
        action_planner: actionPlannerMetadataForAudit,
      },
      created_at: now,
      updated_at: now,
    }));

    const evaluationRepo = context.manager.getRepository(AiEvaluation);
    const evaluation = await evaluationRepo.save(evaluationRepo.create({
      tenant_id: context.tenantId,
      run_id: ticketResult.run_id,
      recommendation_id: recommendation.id,
      decision_id: decision.id,
      status: anyActionEligible ? 'pending' : 'completed',
      outcome: anyActionEligible ? null : 'no_eligible_action_selected',
      scores_json: null,
      feedback_json: null,
      metadata_json: {
        ...agentMetadata,
        evaluation_type: options.evaluationType ?? TICKETING_TRIAGE_RUN_OPTIONS.evaluationType,
      },
      created_at: now,
      updated_at: now,
    }));

    const plannerInternalNote = effectivePlannerActions.find((entry) => entry.action.action_type === 'internal_note') ?? null;
    const plannerRequesterReply = effectivePlannerActions.find((entry) => entry.action.action_type === 'requester_reply') ?? null;
    const plannerStatusUpdate = effectivePlannerActions.find((entry) => entry.action.action_type === 'status_update') ?? null;
    // At most two: one group and one technician, capped per kind in the authorization loop.
    const plannerAssignmentUpdates = effectivePlannerActions.filter((entry) => entry.action.action_type === PLANNER_ASSIGNMENT_ACTION_TYPE
      && !!entry.action.target);
    // Diagnostics and the skip-reason ternaries keep reporting the first proposal; both
    // prepared action requests are durable rows in their own right.
    const assignmentUpdateInput = plannerAssignmentUpdates[0]
      ? { target: plannerAssignmentUpdates[0].action.target!, reason: plannerAssignmentUpdates[0].action.reason }
      : null;
    const plannerStatusTransitionKey = plannerStatusUpdate && typeof plannerStatusUpdate.action.transition_key === 'string'
      ? plannerStatusUpdate.action.transition_key
      : null;
    const plannerSuppressionReasons: Record<string, string> = {};
    const plannerProposalContextHash = (entry: { action: PlannerAction; terminal: boolean }): string => proposalHash({
      action_type: entry.action.action_type,
      ticket: ticket.id,
      updated_at: ticket.updatedAt ?? ticket.updated_at ?? null,
      latest_requester_message_fingerprint: conversationGate.latest_requester_message_fingerprint,
      latest_ticket_note_fingerprint: conversationGate.latest_ticket_note_fingerprint,
      close_bucket: entry.terminal || entry.action.administrative_intent === 'close_reply'
        ? (ticket.updatedAt ?? ticket.updated_at ?? null)
        : null,
    });
    const plannerProposalHashFor = (entry: { action: PlannerAction; plannerActionKey: string; replyBody: string | null; terminal: boolean }): string => proposalHash({
      action_type: entry.action.action_type,
      planner_action_key: entry.plannerActionKey,
      ...(entry.action.action_type === PLANNER_CLASSIFICATION_ACTION_TYPE ? { proposed: entry.action.proposed ?? null } : {}),
      guidance_hash: actionPlannerGuidanceHash,
      reply_kind: entry.action.reply_kind ?? null,
      administrative_intent: entry.action.administrative_intent ?? null,
      verbatim_ref: entry.action.verbatim_ref ?? null,
      body_fingerprint: entry.replyBody ? proposalHash({ body: entry.replyBody }) : null,
      transition_key: entry.action.transition_key ?? null,
      terminal: entry.terminal,
    });
    const plannerMetadata = (
      entry: { action: PlannerAction; plannerActionKey: string; terminal: boolean },
      proposalHashValue: string | null,
      contextHashValue: string | null,
      triageAction: string,
    ): Record<string, unknown> => ({
      ...baseMetadata,
      source: 'action_planner',
      planner_action: true,
      planner_action_key: entry.plannerActionKey,
      action_planner_guidance_hash: actionPlannerGuidanceHash,
      planner_reason: entry.action.reason,
      planner_reply_kind: entry.action.reply_kind ?? null,
      planner_administrative_intent: entry.action.administrative_intent ?? null,
      triage_action: triageAction,
      conversation_gate: conversationGate,
      proposal_hash: proposalHashValue,
      proposal_context_hash: contextHashValue,
      ...(entry.terminal ? { terminal: true, destructive: true, risk: 'high' } : {}),
    });
    const plannerInternalNoteProposalHash = plannerInternalNote
      ? plannerProposalHashFor({ ...plannerInternalNote, replyBody: noteBody })
      : null;
    const plannerInternalNoteContextHash = plannerInternalNote
      ? plannerProposalContextHash(plannerInternalNote)
      : null;
    const plannerInternalNoteSuppression = plannerInternalNote && plannerInternalNoteProposalHash && plannerInternalNoteContextHash
      ? await this.unchangedProposalSuppressionReason(context, {
        capabilityName: TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY,
        ...proposalScope,
        proposalHash: plannerInternalNoteProposalHash,
        contextHash: plannerInternalNoteContextHash,
      })
      : null;
    if (plannerInternalNoteSuppression) {
      plannerSuppressionReasons.internal_note = plannerInternalNoteSuppression;
    }
    const synthesisActionMetadata = {
      synthesis_usable: synthesisMetadata.synthesis_usable === true,
      synthesis_fallback_reason: stringFromMetadata(synthesisMetadata.synthesis_fallback_reason),
    };
    const proposal = ((fallbackPrepareInternalNote || plannerInternalNote) && !plannerInternalNoteSuppression)
      ? await this.dispatcher.execute(context, {
        capabilityName: TICKETING_INTERNAL_NOTE_PREPARE_CAPABILITY,
        input: {
          provider_key: target.provider_key,
          ticket_id: ticket.id,
          note_body: noteBody,
          evidence_ids: allEvidenceIds,
          observation_id: observation.id,
          recommendation_id: recommendation.id,
          decision_id: decision.id,
          evaluation_id: evaluation.id,
        },
        execution: {
          surface: 'internal',
          trigger_kind: 'internal',
          runId: ticketResult.run_id,
          stepIndex: stepIndex++,
          metadata: {
            ...synthesisActionMetadata,
            ...(plannerInternalNote
              ? plannerMetadata(
                plannerInternalNote,
                plannerInternalNoteProposalHash,
                plannerInternalNoteContextHash,
                'planner_prepare_internal_note',
              )
              : {
                ...baseMetadata,
                triage_action: 'prepare_internal_note',
                conversation_gate: conversationGate,
              }),
          },
        },
      })
      : null;
    if (proposal && adapterData(proposal.output) != null) {
      await this.expirePriorPendingSameClass(context, {
        ...proposalScope,
        capabilityName: TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY,
        agentDefinitionId: proposalAgentDefinitionId,
        excludeActionIds: actionRequestIdsFromCapabilityOutput(proposal.output),
        excludeRunId: ticketResult.run_id,
      });
    }
    const requesterReplyBody = replySynthesisResult
      ? renderSynthesizedRequesterReply(ticket, replySynthesisResult)
      : buildRequesterReply(ticket, enrichedKnowledgeItems, ticketTimeline, webSearchResults);
    const plannerRequesterReplyBody = plannerRequesterReply
      ? plannerRequesterReply.replyBody ?? requesterReplyBody
      : null;
    const plannerRequesterReplyProposalHash = plannerRequesterReply && plannerRequesterReplyBody
      ? plannerProposalHashFor({ ...plannerRequesterReply, replyBody: plannerRequesterReplyBody })
      : null;
    const plannerRequesterReplyContextHash = plannerRequesterReply
      ? plannerProposalContextHash(plannerRequesterReply)
      : null;
    const plannerRequesterReplySuppression = plannerRequesterReply && plannerRequesterReplyProposalHash && plannerRequesterReplyContextHash
      ? await this.unchangedProposalSuppressionReason(context, {
        capabilityName: TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY,
        ...proposalScope,
        proposalHash: plannerRequesterReplyProposalHash,
        contextHash: plannerRequesterReplyContextHash,
      })
      : null;
    if (plannerRequesterReplySuppression) {
      plannerSuppressionReasons.requester_reply = plannerRequesterReplySuppression;
    }
    const publicReplyProposal = ((fallbackPublicReplyUsable || plannerRequesterReply) && !plannerRequesterReplySuppression)
      ? await this.dispatcher.execute(context, {
        capabilityName: TICKETING_PUBLIC_REPLY_PREPARE_CAPABILITY,
        input: {
          provider_key: target.provider_key,
          ticket_id: ticket.id,
          reply_body: plannerRequesterReplyBody ?? requesterReplyBody,
          evidence_ids: allEvidenceIds,
          observation_id: observation.id,
          recommendation_id: recommendation.id,
          decision_id: decision.id,
          evaluation_id: evaluation.id,
        },
        execution: {
          surface: 'internal',
          trigger_kind: 'internal',
          runId: ticketResult.run_id,
          stepIndex: stepIndex++,
          metadata: {
            ...synthesisActionMetadata,
            ...(plannerRequesterReply
              ? plannerMetadata(
                plannerRequesterReply,
                plannerRequesterReplyProposalHash,
                plannerRequesterReplyContextHash,
                plannerRequesterReply.action.administrative_intent === 'close_reply'
                  ? 'planner_prepare_administrative_close_reply'
                  : 'planner_prepare_public_reply',
              )
              : {
                ...baseMetadata,
                triage_action: 'prepare_public_reply',
                conversation_gate: conversationGate,
              }),
          },
        },
      })
      : null;
    if (publicReplyProposal && adapterData(publicReplyProposal.output) != null) {
      await this.expirePriorPendingSameClass(context, {
        ...proposalScope,
        capabilityName: TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY,
        agentDefinitionId: proposalAgentDefinitionId,
        excludeActionIds: actionRequestIdsFromCapabilityOutput(publicReplyProposal.output),
        excludeRunId: ticketResult.run_id,
      });
    }
    const classificationProposalHash = plannerClassificationUpdate
      ? plannerProposalHashFor({ ...plannerClassificationUpdate, replyBody: null }) : null;
    const classificationContextHash = plannerClassificationUpdate
      ? plannerProposalContextHash(plannerClassificationUpdate) : null;
    const classificationSuppressionReason = classificationUpdateInput && classificationProposalHash && classificationContextHash
      ? await this.unchangedProposalSuppressionReason(context, {
        capabilityName: TICKETING_CLASSIFICATION_UPDATE_APPROVED_CAPABILITY,
        ...proposalScope,
        proposalHash: classificationProposalHash,
        contextHash: classificationContextHash,
      })
      : null;
    if (classificationSuppressionReason) plannerSuppressionReasons.classification_update = classificationSuppressionReason;
    const classificationUpdateProposal = classificationUpdateInput && !classificationSuppressionReason
      ? await this.dispatcher.execute(context, {
        capabilityName: TICKETING_CLASSIFICATION_UPDATE_PREPARE_CAPABILITY,
        input: {
          provider_key: target.provider_key,
          ticket_id: ticket.id,
          proposed: classificationUpdateInput.proposed,
          reason: classificationUpdateInput.reason,
          evidence_ids: allEvidenceIds,
          observation_id: observation.id,
          recommendation_id: recommendation.id,
          decision_id: decision.id,
          evaluation_id: evaluation.id,
        },
        execution: {
          surface: 'internal',
          trigger_kind: 'internal',
          runId: ticketResult.run_id,
          stepIndex: stepIndex++,
          metadata: plannerMetadata(plannerClassificationUpdate!, classificationProposalHash, classificationContextHash, 'planner_prepare_classification_update'),
        },
      })
      : null;
    if (classificationUpdateProposal && adapterData(classificationUpdateProposal.output) != null) {
      await this.expirePriorPendingSameClass(context, {
        ...proposalScope,
        capabilityName: TICKETING_CLASSIFICATION_UPDATE_APPROVED_CAPABILITY,
        agentDefinitionId: proposalAgentDefinitionId,
        excludeActionIds: actionRequestIdsFromCapabilityOutput(classificationUpdateProposal.output),
        excludeRunId: ticketResult.run_id,
      });
    }
    const statusUpdateInput = fallbackStatusUpdateInput;
    const plannerStatusProposalHash = plannerStatusUpdate
      ? plannerProposalHashFor({ ...plannerStatusUpdate, replyBody: null })
      : null;
    const plannerStatusContextHash = plannerStatusUpdate
      ? plannerProposalContextHash(plannerStatusUpdate)
      : null;
    const plannerStatusSuppression = plannerStatusUpdate && plannerStatusProposalHash && plannerStatusContextHash
      ? await this.unchangedProposalSuppressionReason(context, {
        capabilityName: TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY,
        ...proposalScope,
        proposalHash: plannerStatusProposalHash,
        contextHash: plannerStatusContextHash,
      })
      : null;
    if (plannerStatusSuppression) {
      plannerSuppressionReasons.status_update = plannerStatusSuppression;
    }
    const statusProposalHash = statusUpdateInput
      ? proposalHash({
        action: 'status_update',
        transition_key: statusUpdateInput.transitionKey,
      })
      : null;
    const statusContextHash = statusUpdateInput
      ? proposalHash({
        current: lifecycleContext,
        transition_key: statusUpdateInput.transitionKey,
      })
      : null;
    const statusSuppressionReason = statusUpdateInput && statusProposalHash && statusContextHash
      ? await this.unchangedProposalSuppressionReason(context, {
        capabilityName: TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY,
        ...proposalScope,
        proposalHash: statusProposalHash,
        contextHash: statusContextHash,
      })
      : null;
    const statusUpdateProposal = plannerStatusUpdate && plannerStatusTransitionKey && !plannerStatusSuppression
      ? await this.dispatcher.execute(context, {
        capabilityName: TICKETING_STATUS_UPDATE_PREPARE_CAPABILITY,
        input: {
          provider_key: target.provider_key,
          ticket_id: ticket.id,
          transition_key: plannerStatusTransitionKey,
          reason: plannerStatusUpdate.action.reason,
          evidence_ids: allEvidenceIds,
          observation_id: observation.id,
          recommendation_id: recommendation.id,
          decision_id: decision.id,
          evaluation_id: evaluation.id,
        },
        execution: {
          surface: 'internal',
          trigger_kind: 'internal',
          runId: ticketResult.run_id,
          stepIndex: stepIndex++,
          metadata: plannerMetadata(
            plannerStatusUpdate,
            plannerStatusProposalHash,
            plannerStatusContextHash,
            plannerStatusUpdate.terminal ? 'planner_prepare_terminal_status' : 'planner_prepare_status_update',
          ),
        },
      })
      : statusUpdateInput && !statusSuppressionReason
      ? await this.dispatcher.execute(context, {
        capabilityName: TICKETING_STATUS_UPDATE_PREPARE_CAPABILITY,
        input: {
          provider_key: target.provider_key,
          ticket_id: ticket.id,
          transition_key: statusUpdateInput.transitionKey,
          reason: statusUpdateInput.reason,
          evidence_ids: allEvidenceIds,
          observation_id: observation.id,
          recommendation_id: recommendation.id,
          decision_id: decision.id,
          evaluation_id: evaluation.id,
        },
        execution: {
          surface: 'internal',
          trigger_kind: 'internal',
          runId: ticketResult.run_id,
          stepIndex: stepIndex++,
          metadata: {
            ...baseMetadata,
            triage_action: 'prepare_status_update',
            proposal_hash: statusProposalHash,
            proposal_context_hash: statusContextHash,
          },
        },
      })
      : null;
    if (statusUpdateProposal && adapterData(statusUpdateProposal.output) != null) {
      await this.expirePriorPendingSameClass(context, {
        ...proposalScope,
        capabilityName: TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY,
        agentDefinitionId: proposalAgentDefinitionId,
        excludeActionIds: actionRequestIdsFromCapabilityOutput(statusUpdateProposal.output),
        excludeRunId: ticketResult.run_id,
      });
    }
    // One prepare per proposed kind. Each carries its own hashes and suppression check, and
    // expires only the pending proposals of the SAME kind: a fresh group proposal must not
    // withdraw a technician proposal that is still waiting for review.
    const assignmentUpdateProposals: Array<Awaited<ReturnType<typeof this.dispatcher.execute>>> = [];
    for (const entry of plannerAssignmentUpdates) {
      const proposalHashValue = plannerProposalHashFor({ ...entry, replyBody: null });
      const contextHashValue = plannerProposalContextHash(entry);
      const suppression = proposalHashValue && contextHashValue
        ? await this.unchangedProposalSuppressionReason(context, {
          capabilityName: TICKETING_ASSIGNMENT_UPDATE_APPROVED_CAPABILITY,
          ...proposalScope,
          proposalHash: proposalHashValue,
          contextHash: contextHashValue,
        })
        : null;
      if (suppression) {
        // First suppression wins for the action type, like every other planner action.
        plannerSuppressionReasons.assignment_update = plannerSuppressionReasons.assignment_update ?? suppression;
        continue;
      }
      const targetKind = entry.action.target?.kind ?? null;
      const prepared = await this.dispatcher.execute(context, {
        capabilityName: TICKETING_ASSIGNMENT_UPDATE_PREPARE_CAPABILITY,
        input: {
          provider_key: target.provider_key,
          ticket_id: ticket.id,
          target: entry.action.target,
          reason: entry.action.reason,
          evidence_ids: allEvidenceIds,
          observation_id: observation.id,
          recommendation_id: recommendation.id,
          decision_id: decision.id,
          evaluation_id: evaluation.id,
        },
        execution: {
          surface: 'internal',
          trigger_kind: 'internal',
          runId: ticketResult.run_id,
          stepIndex: stepIndex++,
          metadata: plannerMetadata(entry, proposalHashValue, contextHashValue, 'planner_prepare_assignment_update'),
        },
      });
      assignmentUpdateProposals.push(prepared);
      if (adapterData(prepared.output) != null) {
        await this.expirePriorPendingSameClass(context, {
          ...proposalScope,
          capabilityName: TICKETING_ASSIGNMENT_UPDATE_APPROVED_CAPABILITY,
          agentDefinitionId: proposalAgentDefinitionId,
          matchPayload: (payload) => isRecord(payload)
            && isRecord(payload.target)
            && payload.target.kind === targetKind,
          excludeActionIds: actionRequestIdsFromCapabilityOutput(prepared.output),
          excludeRunId: ticketResult.run_id,
        });
      }
    }
    const assignmentUpdateProposal = assignmentUpdateProposals[0] ?? null;

    const plannerSkippedActionsWithSuppression = {
      ...plannerSkippedActions,
      ...plannerSuppressionReasons,
    };
    const actionPlannerOutcomeMetadata = {
      ...actionPlannerMetadataForAudit,
      skipped_actions: plannerSkippedActionsWithSuppression,
      suppression_reasons: plannerSuppressionReasons,
    };

    const directPreparedActionIds = Array.from(new Set([
      ...(proposal ? actionRequestIdsFromCapabilityOutput(proposal.output) : []),
      ...(publicReplyProposal ? actionRequestIdsFromCapabilityOutput(publicReplyProposal.output) : []),
      ...(classificationUpdateProposal ? actionRequestIdsFromCapabilityOutput(classificationUpdateProposal.output) : []),
      ...(statusUpdateProposal ? actionRequestIdsFromCapabilityOutput(statusUpdateProposal.output) : []),
      ...assignmentUpdateProposals.flatMap((prepared) => actionRequestIdsFromCapabilityOutput(prepared.output)),
    ]));
    const expectedPreparedActionCount = [
      !!proposal && adapterData(proposal.output) != null,
      !!publicReplyProposal && adapterData(publicReplyProposal.output) != null,
      !!classificationUpdateProposal && adapterData(classificationUpdateProposal.output) != null,
      !!statusUpdateProposal && adapterData(statusUpdateProposal.output) != null,
      ...assignmentUpdateProposals.map((prepared) => adapterData(prepared.output) != null),
    ].filter(Boolean).length;
    const recoveredPreparedActionIds = directPreparedActionIds.length >= expectedPreparedActionCount
      ? []
      : await this.recoverPreparedTicketingActionIds(context, {
        runId: ticketResult.run_id,
        targetRef: ticket.id,
      });
    const preparedActionIds = Array.from(new Set([
      ...directPreparedActionIds,
      ...recoveredPreparedActionIds,
    ]));
    let durablePreparedActions = preparedActionIds.length > 0
      ? await context.manager.getRepository(AiActionRequest).find({
        where: {
          tenant_id: context.tenantId,
          id: In(preparedActionIds),
        },
      })
      : [];
    if (expectedPreparedActionCount > 0 && durablePreparedActions.length === 0) {
      throw new BadRequestException('Ticket triage prepared a proposal but did not create a durable action request for review.');
    }
    durablePreparedActions = await this.ensureProposalEvaluations(context, {
      runId: ticketResult.run_id,
      recommendationId: recommendation.id,
      decisionId: decision.id,
      actions: durablePreparedActions,
      agentMetadata,
      evaluationType: options.proposalEvaluationType,
    });
    const automaticExecution = await this.executeAutomaticPreparedActions(context, {
      definition: agentDefinition,
      actions: durablePreparedActions,
      baseMetadata,
      runId: ticketResult.run_id,
      stepIndex,
    });
    stepIndex = automaticExecution.nextStepIndex;
    const executedAutomaticActionIds = new Set(
      automaticExecution.executions
        .filter((execution) => execution.status === 'executed')
        .map((execution) => execution.action_request_id),
    );
    if (executedAutomaticActionIds.size > 0) {
      durablePreparedActions = await context.manager.getRepository(AiActionRequest).find({
        where: {
          tenant_id: context.tenantId,
          id: In(durablePreparedActions.map((action) => action.id)),
        },
      });
    }
    const durablePreparedActionIds = durablePreparedActions.map((action) => action.id);
    let finalWorkItem: AiAgentWorkItem | null = leasedWorkItem;
    let targetState: AiAgentTargetState | null = null;
    if (this.agentQueue && agentDefinition && leasedWorkItem) {
      const outcome = await this.agentQueue.recordManualTicketingTriageOutcome(context, {
        definition: agentDefinition,
        workItem: leasedWorkItem,
        runId: ticketResult.run_id,
        actionRequestIds: durablePreparedActionIds,
        ticket,
        knowledgeResultCount: knowledgeItems.length,
        metadata: {
          observation_id: observation.id,
          recommendation_id: recommendation.id,
          decision_id: decision.id,
          evaluation_id: evaluation.id,
          knowledge_query: selectedKnowledgeAttempt?.query ?? null,
          knowledge_search_plan: serializeKnowledgeSearchPlan(knowledgeSearchPlan),
          knowledge_query_attempts: knowledgeAttempts.map((attempt) => ({
            query: attempt.query,
            result_count: attempt.items.length,
            tool_execution_id: attempt.result.tool_execution_id,
          })),
          knowledge_candidate_count: mergedKnowledgeCandidates.length,
          knowledge_low_relevance_count: knowledgeLowRelevance.length,
          knowledge_result_interpretation: serializeKnowledgeInterpretation(knowledgeInterpretation),
          knowledge_candidates: mergedKnowledgeCandidates.map((item) => ({
            ref: item.ref ?? item.id ?? null,
            title: item.title ?? null,
            score: item.score ?? null,
            search_queries: item.search_queries,
          })),
          knowledge_low_relevance: knowledgeLowRelevance,
          conversation_gate: conversationGate,
          classification_context: classificationContext,
          lifecycle_context: lifecycleContext,
          routing_context: routingContext,
          participant_context: participantContext,
          knowledge_need_representation: serializeKnowledgeNeedRepresentation(knowledgeNeedRepresentation),
          knowledge_query_derivation: serializeKnowledgeQueryDerivation(knowledgeQueryDerivation),
          ticket_image_evidence: ticketImageExtraction.evidence,
          ticket_image_evidence_warnings: ticketImageExtraction.warnings,
          ticket_image_evidence_skipped_reason: ticketImageExtraction.skippedReason,
          ticket_attachment_refs: ticketImageExtraction.attachmentRefs,
          run_usage_estimate: runUsageEstimate,
          automatic_executions: automaticExecution.executions,
          ticket_history_entry_count: ticketTimeline.length,
          action_planner: actionPlannerOutcomeMetadata,
          phase11_proposals: {
            planner_owned: {
              internal_note: plannerInternalNote ? {
                proposal_hash: plannerInternalNoteProposalHash,
                proposal_context_hash: plannerInternalNoteContextHash,
                suppression_reason: plannerInternalNoteSuppression,
              } : null,
              requester_reply: plannerRequesterReply ? {
                reply_kind: plannerRequesterReply.action.reply_kind ?? null,
                administrative_intent: plannerRequesterReply.action.administrative_intent ?? null,
                proposal_hash: plannerRequesterReplyProposalHash,
                proposal_context_hash: plannerRequesterReplyContextHash,
                suppression_reason: plannerRequesterReplySuppression,
              } : null,
              status_update: plannerStatusUpdate ? {
                transition_key: plannerStatusTransitionKey,
                terminal: plannerStatusUpdate.terminal,
                proposal_hash: plannerStatusProposalHash,
                proposal_context_hash: plannerStatusContextHash,
                suppression_reason: plannerStatusSuppression,
              } : null,
            },
            classification: classificationUpdateInput ? {
              ...classificationUpdateInput,
              proposal_hash: classificationProposalHash,
              proposal_context_hash: classificationContextHash,
              suppression_reason: classificationSuppressionReason,
            } : null,
            status: plannerStatusUpdate ? {
              source: 'action_planner',
              transitionKey: plannerStatusTransitionKey,
              reason: plannerStatusUpdate.action.reason,
              terminal: plannerStatusUpdate.terminal,
              proposal_hash: plannerStatusProposalHash,
              proposal_context_hash: plannerStatusContextHash,
              suppression_reason: plannerStatusSuppression,
            } : statusUpdateInput ? {
              ...statusUpdateInput,
              proposal_hash: statusProposalHash,
              proposal_context_hash: statusContextHash,
              suppression_reason: statusSuppressionReason,
            } : null,
            assignment: assignmentUpdateInput,
          },
          skipped_actions: {
            internal_note: plannerSkippedActionsWithSuppression.internal_note
              ?? (conversationGate.can_prepare_internal_note ? null : conversationGate.internal_note_reason),
            public_reply: plannerSkippedActionsWithSuppression.requester_reply
              ?? (conversationGate.can_prepare_public_reply ? null : conversationGate.public_reply_reason),
            classification: plannerSkippedActionsWithSuppression.classification_update ?? (classificationUpdateInput ? null : classificationAvailable ? 'not_selected_by_action_planner' : classificationWriteCapable ? 'classification_not_supported_by_provider' : 'classification_capability_not_granted'),
            status: plannerSkippedActionsWithSuppression.status_update
              ?? statusSuppressionReason
              ?? (statusUpdateInput ? null : 'no_safe_status_transition'),
            assignment: plannerSkippedActionsWithSuppression.assignment_update ?? (assignmentUpdateInput ? null : (assignmentRoutingAvailable ? 'not_selected_by_action_planner' : assignmentWriteCapable ? 'no_supported_assignment_target' : 'assignment_capability_not_granted')),
            participants: 'provider_participant_update_not_prepared',
          },
        },
      });
      finalWorkItem = outcome.workItem;
      targetState = outcome.targetState;
    }

    return {
      target: serializeLiveTarget(target),
      agent_definition: agentDefinition ? serializeAgentDefinition(agentDefinition) : null,
      work_item: finalWorkItem ? serializeAgentWorkItem(finalWorkItem) : null,
      target_state: targetState ? serializeAgentTargetState(targetState) : null,
      diagnostic: {
        run_id: ticketResult.run_id,
        ticket_tool_execution_id: ticketResult.tool_execution_id,
        ticket_notes_tool_execution_id: ticketNotesResult.tool_execution_id,
        classification_context_tool_execution_id: classificationContextResult.tool_execution_id,
        lifecycle_context_tool_execution_id: lifecycleContextResult.tool_execution_id,
        routing_context_tool_execution_id: routingContextResult.tool_execution_id,
        participant_context_tool_execution_id: participantContextResult.tool_execution_id,
        knowledge_tool_execution_id: knowledgeResult?.tool_execution_id ?? null,
        knowledge_tool_execution_ids: knowledgeAttempts.map((attempt) => attempt.result.tool_execution_id),
        knowledge_document_tool_execution_ids: knowledgeDocumentAttempts
          .map((attempt) => attempt.result?.tool_execution_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
        knowledge_query: selectedKnowledgeAttempt?.query ?? null,
        knowledge_query_candidates: knowledgeQueryCandidates,
        knowledge_search_plan: serializeKnowledgeSearchPlan(knowledgeSearchPlan),
        knowledge_need_representation: serializeKnowledgeNeedRepresentation(knowledgeNeedRepresentation),
        knowledge_query_derivation: serializeKnowledgeQueryDerivation(knowledgeQueryDerivation),
        ticket_image_extraction: serializeTicketImageExtraction(ticketImageExtraction),
        ticket_image_evidence: ticketImageExtraction.evidence,
        ticket_image_evidence_warnings: ticketImageExtraction.warnings,
        ticket_image_evidence_skipped_reason: ticketImageExtraction.skippedReason,
        ticket_attachment_refs: ticketImageExtraction.attachmentRefs,
        knowledge_query_attempts: knowledgeAttempts.map((attempt) => ({
          query: attempt.query,
          result_count: attempt.items.length,
          tool_execution_id: attempt.result.tool_execution_id,
        })),
        knowledge_candidates: mergedKnowledgeCandidates.map((item) => ({
          ref: item.ref ?? item.id ?? null,
          title: item.title ?? null,
          score: item.score ?? null,
          search_queries: item.search_queries,
        })),
        knowledge_result_interpretation: serializeKnowledgeInterpretation(knowledgeInterpretation),
        knowledge_low_relevance: knowledgeLowRelevance,
        evidence_ids: allEvidenceIds,
        observation_id: observation.id,
        recommendation_id: recommendation.id,
        decision_id: decision.id,
        evaluation_id: evaluation.id,
        action_request_ids: durablePreparedActionIds,
        conversation_gate: conversationGate,
        classification_context: classificationContext,
        lifecycle_context: lifecycleContext,
        routing_context: routingContext,
        participant_context: participantContext,
        run_usage_estimate: runUsageEstimate,
        automatic_executions: automaticExecution.executions,
        action_planner: actionPlannerOutcomeMetadata,
        skipped_actions: {
          internal_note: plannerSkippedActionsWithSuppression.internal_note
            ?? (conversationGate.can_prepare_internal_note ? null : conversationGate.internal_note_reason),
          public_reply: plannerSkippedActionsWithSuppression.requester_reply
            ?? (conversationGate.can_prepare_public_reply ? null : conversationGate.public_reply_reason),
          classification: plannerSkippedActionsWithSuppression.classification_update ?? (classificationUpdateInput ? null : classificationAvailable ? 'not_selected_by_action_planner' : classificationWriteCapable ? 'classification_not_supported_by_provider' : 'classification_capability_not_granted'),
          status: plannerSkippedActionsWithSuppression.status_update
            ?? statusSuppressionReason
            ?? (statusUpdateInput ? null : 'no_safe_status_transition'),
          assignment: plannerSkippedActionsWithSuppression.assignment_update ?? (assignmentUpdateInput ? null : (assignmentRoutingAvailable ? 'not_selected_by_action_planner' : assignmentWriteCapable ? 'no_supported_assignment_target' : 'assignment_capability_not_granted')),
          participants: 'provider_participant_update_not_prepared',
        },
        ticket_history_entry_count: ticketTimeline.length,
        knowledge_results: knowledgeItems,
        knowledge_low_relevance_count: knowledgeLowRelevance.length,
        knowledge_documents: enrichedKnowledgeItems.slice(0, MAX_KNOWLEDGE_DOCUMENTS_FOR_REPLY).map((item) => ({
          ref: item.ref ?? item.id ?? null,
          title: item.title ?? null,
          score: item.score ?? null,
          content_length: item.content_markdown?.length ?? 0,
        })),
        synthesis: synthesisMetadata,
        internal_note_tool_execution_id: proposal?.tool_execution_id ?? null,
        public_reply_tool_execution_id: publicReplyProposal?.tool_execution_id ?? null,
        classification_update_tool_execution_id: classificationUpdateProposal?.tool_execution_id ?? null,
        status_update_tool_execution_id: statusUpdateProposal?.tool_execution_id ?? null,
        assignment_update_tool_execution_id: assignmentUpdateProposal?.tool_execution_id ?? null,
      },
      proposal,
      public_reply_proposal: publicReplyProposal,
      classification_update_proposal: classificationUpdateProposal,
      status_update_proposal: statusUpdateProposal,
      assignment_update_proposal: assignmentUpdateProposal,
      detail: await this.getRunDetail(context, ticketResult.run_id),
    };
    } catch (error) {
      if (this.agentQueue && leasedWorkItem) {
        await this.agentQueue.failWorkItem(context, leasedWorkItem, error);
      }
      throw error;
    }
  }

  async approveActionRequest(
    context: AiExecutionContextWithManager,
    actionRequestId: string,
    options: { execute?: boolean | null; reason?: string | null } = {},
  ) {
    if (options.execute !== false) {
      const pendingAction = await context.manager.getRepository(AiActionRequest).findOne({
        where: { id: actionRequestId, tenant_id: context.tenantId },
      });
      if (!pendingAction) {
        throw new NotFoundException('Action request not found.');
      }
      await this.assertActionSafeForUiExecution(context, pendingAction);
    }

    const approved = await this.approvals.approveActionRequest(context, actionRequestId, {
      source: 'human_ui',
      reason: approvalDecisionReason(options.reason, 'Approved from Agent Control Center.'),
      actorLabel: null,
    });

    let execution: unknown = null;
    if (options.execute !== false) {
      // Carry the agent id so an agent-scoped emergency pause blocks this write too.
      // Without it the dispatcher only sees tenant-wide pauses and an agent-scoped
      // "pause this agent" would not hold its already-pending human-approved writes.
      // Invariant: agent-produced write proposals MUST stamp agent_definition_id into
      // metadata_json at preparation time (agentExecutionMetadata / triage baseMetadata)
      // for this guard to apply.
      const agentDefinitionId = definitionIdFromMetadata(approved.action.metadata_json);
      execution = await this.dispatcher.execute(context, {
        capabilityName: approved.action.capability_name,
        capabilityVersion: approved.action.capability_version,
        input: { action_request_id: approved.action.id },
        execution: {
          surface: 'internal',
          trigger_kind: 'internal',
          runId: approved.action.run_id,
          stepIndex: 200,
          metadata: {
            uat_workflow: 'agent_control_center_approved_execution',
            source: 'admin_ui',
            action_request_id: approved.action.id,
            ...(agentDefinitionId ? { agent_definition_id: agentDefinitionId } : {}),
          },
        },
      });
    }

    const freshAction = await context.manager.getRepository(AiActionRequest).findOne({
      where: { id: actionRequestId, tenant_id: context.tenantId },
    });
    const detailRunId = freshAction?.run_id ?? approved.action.run_id;
    const responseAction = freshAction ?? approved.action;
    await this.agentQueue?.resolveWaitingApprovalForActionRequest(context, responseAction.id);
    const readiness = await this.executionReadinessForActions(context, [responseAction]);

    return {
      action: serializeActionRequest(responseAction, readiness.get(responseAction.id)),
      approval: serializeApproval(approved.approval),
      execution,
      detail: detailRunId ? await this.getRunDetail(context, detailRunId) : null,
    };
  }

  private async stampBulkApprovalContext(
    context: AiExecutionContextWithManager,
    actions: AiActionRequest[],
    options: AgentControlBulkApproveOptions = {},
  ): Promise<AiActionRequest[]> {
    const actionRequestIds = actions.map((action) => action.id);
    const batchId = hashStableJson({
      tenant_id: context.tenantId,
      action_request_ids: actionRequestIds,
    });
    const now = new Date();
    const repo = context.manager.getRepository(AiActionRequest);
    const stamped: AiActionRequest[] = [];
    for (const action of actions) {
      const existingMetadata = isRecord(action.metadata_json) ? action.metadata_json : {};
      const existingBatch = isRecord(existingMetadata.approved_batch_context)
        ? existingMetadata.approved_batch_context
        : {};
      action.metadata_json = {
        ...existingMetadata,
        approved_batch_context: {
          ...existingBatch,
          batch_id: batchId,
          action_request_ids: actionRequestIds,
          target_type: action.target_type ?? null,
          target_ref: action.target_ref ?? null,
          stamped_at: typeof existingBatch.stamped_at === 'string' ? existingBatch.stamped_at : now.toISOString(),
          ...(options.queueExecution
            ? {
              execution_queued: true,
              execution_queued_at: now.toISOString(),
            }
            : {}),
        },
      };
      action.updated_at = now;
      stamped.push(await repo.save(action));
    }
    return stamped;
  }

  private async bulkExecutionPhases(
    context: AiExecutionContextWithManager,
    actions: AiActionRequest[],
  ): Promise<Map<string, number>> {
    const byCapability = new Map<string, number>();
    const byAction = new Map<string, number>();
    for (const action of actions) {
      const key = capabilityPhaseKey(action);
      if (!byCapability.has(key)) {
        let phase = STATIC_CAPABILITY_EXECUTION_PHASES.get(key) ?? DEFAULT_BULK_EXECUTION_PHASE;
        if (this.capabilities) {
          try {
            const resolved = await this.capabilities.resolve(context, action.capability_name, action.capability_version);
            if (typeof resolved.contract.execution_phase === 'number' && Number.isFinite(resolved.contract.execution_phase)) {
              phase = resolved.contract.execution_phase;
            }
          } catch {
            // Unknown dynamic capabilities keep the default phase and then sort by created_at.
          }
        }
        byCapability.set(key, phase);
      }
      byAction.set(action.id, byCapability.get(key) ?? DEFAULT_BULK_EXECUTION_PHASE);
    }
    return byAction;
  }

  private bulkApproveReason(action: AiActionRequest, execution: unknown, fallback: string | null): string | null {
    if (action.error_message) {
      return action.error_message;
    }
    const output = isRecord(execution) ? execution.output : null;
    if (isRecord(output) && output.ok === false && typeof output.message === 'string') {
      return output.message;
    }
    return fallback;
  }

  // Resolve the validated, batch-stamped, ordered execution plan for an approved
  // bulk. Stamping (approved_batch_context) is committed here so each action can
  // later execute in its own transaction and still see its siblings' baselines.
  async planApprovedBulkExecution(
    context: AiExecutionContextWithManager,
    input: AgentControlBulkApproveInput,
  ): Promise<{ orderedIds: string[]; requested: number }> {
    const requestedIds = Array.from(new Set((input.action_request_ids ?? [])
      .map((id) => trimmedString(id))
      .filter((id): id is string => !!id)));
    if (requestedIds.length === 0) {
      throw new BadRequestException('At least one action request id is required.');
    }
    if (requestedIds.length > 20) {
      throw new BadRequestException('Bulk approval is limited to 20 action requests.');
    }

    const repo = context.manager.getRepository(AiActionRequest);
    const found = await repo.find({
      where: {
        id: In(requestedIds),
        tenant_id: context.tenantId,
      },
    });
    const byId = new Map(found.map((action) => [action.id, action]));
    const missingIds = requestedIds.filter((id) => !byId.has(id));
    if (missingIds.length > 0) {
      throw new NotFoundException('One or more action requests were not found.');
    }

    const first = found[0];
    const sameTarget = found.every((action) =>
      action.provider_kind === first.provider_kind
      && action.provider_key === first.provider_key
      && action.target_type === first.target_type
      && action.target_ref === first.target_ref);
    if (!sameTarget) {
      throw new BadRequestException('Bulk approval only supports actions for one target.');
    }

    const executionPhases = await this.bulkExecutionPhases(context, found);
    const runnable = found
      .filter((action) => ['approved', 'executed'].includes(action.status))
      .sort((left, right) => bulkApproveActionSort(left, right, executionPhases));
    if (runnable.length === 0) {
      return { orderedIds: [], requested: requestedIds.length };
    }

    const stamped = await this.stampBulkApprovalContext(context, runnable);
    const stampedById = new Map(stamped.map((action) => [action.id, action]));
    const ordered = runnable
      .map((action) => stampedById.get(action.id) ?? action)
      .sort((left, right) => bulkApproveActionSort(left, right, executionPhases));
    return { orderedIds: ordered.map((action) => action.id), requested: requestedIds.length };
  }

  // Execute a single approved action. Designed to run inside its OWN transaction
  // (one per action) so row locks on the ticket work item / target state release
  // between slow ticketing writes and never block the queue-overview reconciliation.
  private async actionExecutionResult(
    context: AiExecutionContextWithManager,
    action: AiActionRequest,
    execution: unknown,
    failure: string | null,
  ): Promise<{
    action_request_id: string;
    ok: boolean;
    status: string;
    reason: string | null;
    action: ReturnType<typeof serializeActionRequest>;
    execution: unknown;
  }> {
    await this.agentQueue?.resolveWaitingApprovalForActionRequest(context, action.id);
    const readiness = await this.executionReadinessForActions(context, [action]);
    const ok = action.status === 'executed';
    return {
      action_request_id: action.id,
      ok,
      status: action.status,
      reason: ok ? null : this.bulkApproveReason(action, execution, failure),
      action: serializeActionRequest(action, readiness.get(action.id)),
      execution,
    };
  }

  private async skippedActionExecutionResult(
    context: AiExecutionContextWithManager,
    action: AiActionRequest,
  ): Promise<{
    action_request_id: string;
    ok: boolean;
    status: string;
    reason: string | null;
    action: ReturnType<typeof serializeActionRequest>;
    execution: unknown;
  }> {
    await this.agentQueue?.resolveWaitingApprovalForActionRequest(context, action.id);
    const readiness = await this.executionReadinessForActions(context, [action]);
    const ok = action.status === 'executed';
    return {
      action_request_id: action.id,
      ok,
      status: action.status,
      reason: ok ? null : actionExecutionSkipReason(action),
      action: serializeActionRequest(action, readiness.get(action.id)),
      execution: null,
    };
  }

  private async claimApprovedActionForExecution(
    context: AiExecutionContextWithManager,
    action: AiActionRequest,
  ): Promise<{ action: AiActionRequest; claimId: string } | null> {
    if (action.status !== 'approved') {
      return null;
    }
    const repo = context.manager.getRepository(AiActionRequest);
    const now = new Date();
    const claimId = randomUUID();
    const result = await repo.update({
      id: action.id,
      tenant_id: context.tenantId,
      status: 'approved',
    }, {
      status: APPROVED_ACTION_EXECUTING_STATUS,
      error_message: null,
      // TypeORM's deep-partial update type maps the `Record<string, unknown>` jsonb column to
      // `unknown`-valued leaves, which it cannot accept; the value is a plain JSON object that is
      // written as-is.
      metadata_json: withApprovedBatchContext(action.metadata_json, {
        execution_claim_id: claimId,
        execution_claimed_at: now.toISOString(),
      }) as Parameters<typeof repo.update>[1]['metadata_json'],
      updated_at: now,
    });
    if ((result.affected ?? 0) !== 1) {
      return null;
    }
    const claimed = await repo.findOne({
      where: { id: action.id, tenant_id: context.tenantId },
    });
    if (!claimed || claimed.status !== APPROVED_ACTION_EXECUTING_STATUS) {
      return null;
    }
    return { action: claimed, claimId };
  }

  private async persistApprovedActionExecutionFailure(
    context: AiExecutionContextWithManager,
    actionRequestId: string,
    message: string,
  ): Promise<AiActionRequest | null> {
    const repo = context.manager.getRepository(AiActionRequest);
    const action = await repo.findOne({
      where: { id: actionRequestId, tenant_id: context.tenantId },
    });
    if (!action || ['executed', 'expired', 'rejected'].includes(action.status)) {
      return action;
    }
    const now = new Date();
    const errorMessage = message.slice(0, 4000);
    action.status = 'approved';
    action.error_message = errorMessage;
    action.metadata_json = withApprovedBatchContext(action.metadata_json, {
      execution_attempts: approvedBatchExecutionAttempts(action) + 1,
      last_attempt_at: now.toISOString(),
      last_execution_error: errorMessage,
      execution_claim_id: null,
      execution_claimed_at: null,
    });
    action.updated_at = now;
    return repo.save(action);
  }

  async executeSingleApprovedAction(
    context: AiExecutionContextWithManager,
    actionRequestId: string,
    options: { batchIds?: string[]; stepIndex?: number } = {},
  ): Promise<{
    action_request_id: string;
    ok: boolean;
    status: string;
    reason: string | null;
    action: ReturnType<typeof serializeActionRequest>;
    execution: unknown;
  }> {
    const repo = context.manager.getRepository(AiActionRequest);
    const action = await repo.findOne({
      where: { id: actionRequestId, tenant_id: context.tenantId },
    });
    if (!action) {
      throw new NotFoundException('Action request not found.');
    }
    if (action.status !== 'approved') {
      return this.skippedActionExecutionResult(context, action);
    }

    const claimed = await this.claimApprovedActionForExecution(context, action);
    if (!claimed) {
      const fresh = await repo.findOne({
        where: { id: action.id, tenant_id: context.tenantId },
      });
      return this.skippedActionExecutionResult(context, fresh ?? action);
    }

    let execution: unknown = null;
    let failure: string | null = null;
    try {
      await this.assertActionSafeForUiExecution(context, claimed.action);
      const agentDefinitionId = definitionIdFromMetadata(claimed.action.metadata_json);
      const batchIds = options.batchIds && options.batchIds.length > 0 ? options.batchIds : [claimed.action.id];
      execution = await this.dispatcher.execute(context, {
        capabilityName: claimed.action.capability_name,
        capabilityVersion: claimed.action.capability_version,
        input: { action_request_id: claimed.action.id },
        execution: {
          surface: 'internal',
          trigger_kind: 'internal',
          runId: claimed.action.run_id,
          stepIndex: 200 + (options.stepIndex ?? 0),
          metadata: {
            uat_workflow: 'agent_control_center_bulk_async_execution',
            source: 'admin_ui',
            action_request_id: claimed.action.id,
            bulk_action_request_ids: batchIds,
            action_execution_claim_id: claimed.claimId,
            ...(agentDefinitionId ? { agent_definition_id: agentDefinitionId } : {}),
          },
        },
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    const freshAction = await repo.findOne({
      where: { id: claimed.action.id, tenant_id: context.tenantId },
    });
    let responseAction = freshAction ?? claimed.action;
    if (!failure && ['failed', APPROVED_ACTION_EXECUTING_STATUS].includes(responseAction.status)) {
      failure = this.bulkApproveReason(responseAction, execution, null)
        ?? 'Action execution did not complete successfully.';
    }
    if (failure) {
      responseAction = await this.persistApprovedActionExecutionFailure(context, claimed.action.id, failure)
        ?? responseAction;
    }
    return this.actionExecutionResult(context, responseAction, execution, failure);
  }

  async executeApprovedActionRequestsBulk(
    context: AiExecutionContextWithManager,
    input: AgentControlBulkApproveInput,
  ) {
    const { orderedIds, requested } = await this.planApprovedBulkExecution(context, input);
    const results: Array<{
      action_request_id: string;
      ok: boolean;
      status: string;
      reason: string | null;
      action: ReturnType<typeof serializeActionRequest>;
      execution: unknown;
    }> = [];

    for (let index = 0; index < orderedIds.length; index += 1) {
      results.push(await this.executeSingleApprovedAction(context, orderedIds[index], {
        batchIds: orderedIds,
        stepIndex: index,
      }));
    }

    const executed = results.filter((result) => result.ok).length;
    return {
      results,
      approvals: [],
      execution_mode: 'background',
      summary: {
        requested,
        processed: results.length,
        approved: results.filter((result) => result.status === 'approved' || result.status === 'executed').length,
        queued: 0,
        executed,
        needs_review: results.length === 0 ? requested : results.length - executed,
      },
    };
  }

  async approveActionRequestsBulk(
    context: AiExecutionContextWithManager,
    input: AgentControlBulkApproveInput,
    options: AgentControlBulkApproveOptions = {},
  ) {
    const requestedIds = Array.from(new Set((input.action_request_ids ?? [])
      .map((id) => trimmedString(id))
      .filter((id): id is string => !!id)));
    if (requestedIds.length === 0) {
      throw new BadRequestException('At least one action request id is required.');
    }
    if (requestedIds.length > 20) {
      throw new BadRequestException('Bulk approval is limited to 20 action requests.');
    }

    const repo = context.manager.getRepository(AiActionRequest);
    const found = await repo.find({
      where: {
        id: In(requestedIds),
        tenant_id: context.tenantId,
      },
    });
    const byId = new Map(found.map((action) => [action.id, action]));
    const missingIds = requestedIds.filter((id) => !byId.has(id));
    if (missingIds.length > 0) {
      throw new NotFoundException('One or more action requests were not found.');
    }

    const first = found[0];
    const sameTarget = found.every((action) =>
      action.provider_kind === first.provider_kind
      && action.provider_key === first.provider_key
      && action.target_type === first.target_type
      && action.target_ref === first.target_ref);
    if (!sameTarget) {
      throw new BadRequestException('Bulk approval only supports actions for one target.');
    }

    const executionPhases = await this.bulkExecutionPhases(context, found);
    const runnable = found
      .filter((action) => ['pending', 'approved', 'executed'].includes(action.status))
      .sort((left, right) => bulkApproveActionSort(left, right, executionPhases));
    if (runnable.length === 0) {
      throw new BadRequestException('No executable action requests were provided.');
    }

    const stamped = await this.stampBulkApprovalContext(context, runnable, options);
    const stampedById = new Map(stamped.map((action) => [action.id, action]));
    const ordered = runnable
      .map((action) => stampedById.get(action.id) ?? action)
      .sort((left, right) => bulkApproveActionSort(left, right, executionPhases));
    const results: Array<{
      action_request_id: string;
      ok: boolean;
      status: string;
      reason: string | null;
      action: ReturnType<typeof serializeActionRequest>;
      execution: unknown;
    }> = [];
    const approvals: Array<ReturnType<typeof serializeApproval>> = [];

    for (const action of ordered) {
      let execution: unknown = null;
      let failure: string | null = null;
      let responseAction = action;
      try {
        await this.assertActionSafeForUiExecution(context, action);
        let approvedAction = action;
        if (action.status !== 'executed') {
          const approved = await this.approvals.approveActionRequest(context, action.id, {
            source: 'human_ui',
            reason: approvalDecisionReason(input.reason, 'Approved from Agent Control Center bulk approval.'),
            actorLabel: null,
          });
          approvals.push(serializeApproval(approved.approval));
          approvedAction = approved.action;
        }

        if (input.execute !== false && approvedAction.status !== 'executed') {
          const agentDefinitionId = definitionIdFromMetadata(approvedAction.metadata_json);
          execution = await this.dispatcher.execute(context, {
            capabilityName: approvedAction.capability_name,
            capabilityVersion: approvedAction.capability_version,
            input: { action_request_id: approvedAction.id },
            execution: {
              surface: 'internal',
              trigger_kind: 'internal',
              runId: approvedAction.run_id,
              stepIndex: 200 + results.length,
              metadata: {
                uat_workflow: 'agent_control_center_bulk_approved_execution',
                source: 'admin_ui',
                action_request_id: approvedAction.id,
                bulk_action_request_ids: ordered.map((candidate) => candidate.id),
                ...(agentDefinitionId ? { agent_definition_id: agentDefinitionId } : {}),
              },
            },
          });
        }
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }

      const freshAction = await repo.findOne({
        where: { id: action.id, tenant_id: context.tenantId },
      });
      responseAction = freshAction ?? responseAction;
      await this.agentQueue?.resolveWaitingApprovalForActionRequest(context, responseAction.id);
      const readiness = await this.executionReadinessForActions(context, [responseAction]);
      const ok = input.execute === false
        ? responseAction.status === 'approved' || responseAction.status === 'executed'
        : responseAction.status === 'executed';
      results.push({
        action_request_id: responseAction.id,
        ok,
        status: responseAction.status,
        reason: ok ? null : this.bulkApproveReason(responseAction, execution, failure),
        action: serializeActionRequest(responseAction, readiness.get(responseAction.id)),
        execution,
      });
    }

    const approved = results.filter((result) => result.status === 'approved' || result.status === 'executed').length;
    const queued = options.queueExecution
      ? results.filter((result) => result.status === 'approved').length
      : 0;
    const executed = results.filter((result) => result.status === 'executed' && result.ok).length;
    const successful = results.filter((result) => result.ok).length;
    const needsReview = results.length - successful;
    return {
      results,
      approvals,
      execution_mode: options.queueExecution ? 'queued' : input.execute === false ? 'approve_only' : 'synchronous',
      summary: {
        requested: requestedIds.length,
        processed: results.length,
        approved,
        queued,
        executed,
        needs_review: needsReview,
      },
    };
  }

  async rejectActionRequest(
    context: AiExecutionContextWithManager,
    actionRequestId: string,
    reason?: string | null,
  ) {
    const rejected = await this.approvals.rejectActionRequest(
      context,
      actionRequestId,
      approvalDecisionReason(reason, 'Rejected from Agent Control Center.'),
    );
    const freshAction = await context.manager.getRepository(AiActionRequest).findOne({
      where: { id: actionRequestId, tenant_id: context.tenantId },
    });
    const detailRunId = freshAction?.run_id ?? rejected.action.run_id;
    const responseAction = freshAction ?? rejected.action;
    await this.agentQueue?.resolveWaitingApprovalForActionRequest(context, responseAction.id);
    const readiness = await this.executionReadinessForActions(context, [responseAction]);

    return {
      action: serializeActionRequest(responseAction, readiness.get(responseAction.id)),
      approval: serializeApproval(rejected.approval),
      detail: detailRunId ? await this.getRunDetail(context, detailRunId) : null,
    };
  }

  /**
   * Acknowledge a "Needs attention" row: a failed / dead-lettered / expired
   * proposal or work item the operator has seen and consciously drops.
   *
   * The acknowledgement is stamped into the record's own `metadata_json` (zero
   * migration) and audited, so the timeline shows who cleared what. Idempotent:
   * re-acknowledging keeps the first stamp and reports `already: true` instead
   * of rewriting history.
   */
  async acknowledgeAttention(
    context: AiExecutionContextWithManager,
    input: { kind: 'action' | 'work_item'; id: string },
  ) {
    const acknowledgedAt = new Date();
    const stamp = (metadata: unknown) => {
      const base = isRecord(metadata) ? { ...metadata } : {};
      base.attention_acknowledged = {
        at: acknowledgedAt.toISOString(),
        user_id: context.userId || null,
      };
      return base;
    };
    const existingStamp = (metadata: unknown): { at?: unknown } | null => {
      const record = isRecord(metadata) ? metadata : null;
      const stamped = record ? record.attention_acknowledged : null;
      return isRecord(stamped) ? stamped : null;
    };

    if (input.kind === 'work_item') {
      const repo = context.manager.getRepository(AiAgentWorkItem);
      const workItem = await repo.findOne({ where: { id: input.id, tenant_id: context.tenantId } });
      if (!workItem) {
        throw new NotFoundException('Work item not found.');
      }
      const already = existingStamp(workItem.metadata_json);
      if (already) {
        return {
          kind: 'work_item' as const,
          id: workItem.id,
          already: true,
          acknowledged_at: typeof already.at === 'string' ? already.at : null,
        };
      }
      workItem.metadata_json = stamp(workItem.metadata_json) as any;
      workItem.updated_at = acknowledgedAt;
      await repo.save(workItem);
      await this.agentQueue?.recordAuditEvent(context, {
        agentDefinitionId: workItem.agent_definition_id ?? null,
        workItemId: workItem.id,
        eventType: 'agent_attention_acknowledged',
        severity: 'info',
        message: 'Operator acknowledged a work item that needed attention.',
        metadata: {
          kind: 'work_item',
          work_item_id: workItem.id,
          target_type: workItem.source_object_type ?? null,
          target_ref: workItem.source_object_ref ?? null,
          actor_user_id: context.userId || null,
        },
      });
      return {
        kind: 'work_item' as const,
        id: workItem.id,
        already: false,
        acknowledged_at: acknowledgedAt.toISOString(),
      };
    }

    const repo = context.manager.getRepository(AiActionRequest);
    const action = await repo.findOne({ where: { id: input.id, tenant_id: context.tenantId } });
    if (!action) {
      throw new NotFoundException('Action request not found.');
    }
    const already = existingStamp(action.metadata_json);
    if (already) {
      return {
        kind: 'action' as const,
        id: action.id,
        already: true,
        acknowledged_at: typeof already.at === 'string' ? already.at : null,
      };
    }
    action.metadata_json = stamp(action.metadata_json) as any;
    action.updated_at = acknowledgedAt;
    await repo.save(action);
    await this.agentQueue?.recordAuditEvent(context, {
      agentDefinitionId: definitionIdFromMetadata(action.metadata_json),
      eventType: 'agent_attention_acknowledged',
      severity: 'info',
      message: 'Operator acknowledged a proposal that needed attention.',
      metadata: {
        kind: 'action',
        action_request_id: action.id,
        capability_name: action.capability_name,
        target_type: action.target_type ?? null,
        target_ref: action.target_ref ?? null,
        actor_user_id: context.userId || null,
      },
    });
    return {
      kind: 'action' as const,
      id: action.id,
      already: false,
      acknowledged_at: acknowledgedAt.toISOString(),
    };
  }

  /** How many rows currently need attention — the whole backlog, not the page the UI fetched. */
  async getAttentionSummary(context: AiExecutionContextWithManager, scope: AttentionScope = {}) {
    return countAttention(context.manager, context.tenantId, scope);
  }

  /**
   * Acknowledge every row that needs attention in one go (optionally for one
   * agent). Same stamp as the single acknowledgement, one audit event for the
   * batch. Proposals still being retried are left alone — see the util.
   */
  async acknowledgeAllAttention(context: AiExecutionContextWithManager, scope: AttentionScope = {}) {
    const stamped = await stampAttentionAcknowledged(context.manager, context.tenantId, {
      agentDefinitionId: scope.agentDefinitionId ?? null,
      userId: context.userId || null,
    });
    const acknowledgedActions = stamped.action_ids.length;
    const acknowledgedWorkItems = stamped.work_item_ids.length;
    if (acknowledgedActions + acknowledgedWorkItems > 0) {
      await this.recordAgentAuditEvent(context, {
        agentDefinitionId: scope.agentDefinitionId ?? null,
        eventType: 'agent_attention_acknowledged',
        severity: 'info',
        message: `Operator acknowledged ${acknowledgedActions} proposal(s) and ${acknowledgedWorkItems} check(s) that needed attention.`,
        metadata: {
          kind: 'bulk',
          acknowledged_actions: acknowledgedActions,
          acknowledged_work_items: acknowledgedWorkItems,
          agent_definition_id: scope.agentDefinitionId ?? null,
          actor_user_id: context.userId || null,
        },
      });
    }
    return {
      acknowledged_actions: acknowledgedActions,
      acknowledged_work_items: acknowledgedWorkItems,
      total: acknowledgedActions + acknowledgedWorkItems,
    };
  }

  async dismissActionRequest(
    context: AiExecutionContextWithManager,
    actionRequestId: string,
    reason?: string | null,
  ) {
    const dismissed = await this.approvals.dismissActionRequest(
      context,
      actionRequestId,
      approvalDecisionReason(reason, 'Dismissed from Agent Control Center.'),
    );
    const freshAction = await context.manager.getRepository(AiActionRequest).findOne({
      where: { id: actionRequestId, tenant_id: context.tenantId },
    });
    const detailRunId = freshAction?.run_id ?? dismissed.action.run_id;
    const responseAction = freshAction ?? dismissed.action;
    await this.agentQueue?.resolveWaitingApprovalForActionRequest(context, responseAction.id);
    const readiness = await this.executionReadinessForActions(context, [responseAction]);

    return {
      action: serializeActionRequest(responseAction, readiness.get(responseAction.id)),
      approval: serializeApproval(dismissed.approval),
      detail: detailRunId ? await this.getRunDetail(context, detailRunId) : null,
    };
  }
}
