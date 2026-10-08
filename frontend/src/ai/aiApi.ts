import { getAccessToken } from '../auth/accessTokenStore';
import api, { requestTokenRefresh } from '../api';
import {
  ChatStreamEvent,
  AiApiKeyRecord,
  AiMutationPreview,
  BuiltinUsage,
  ChatConversation,
  ConversationMessagesResponse,
} from './aiTypes';
import i18n from '../i18n';
import type { AiBuiltinProvider } from './includedModel';

const MAX_STREAM_BUFFER_CHARS = 1_048_576;

export type ProviderDescriptor = {
  id: string;
  label: string;
  description: string;
  capabilities: {
    supportsStreaming: boolean;
    supportsToolCalling: boolean;
    requiresApiKey: boolean;
    allowsCustomEndpoint: boolean;
  };
};

export type AiWebSearchTestResult = {
  ok: boolean;
  message: string;
  latency_ms: number | null;
};

export type AiGlpiTestResult = {
  ok: boolean;
  message: string;
  latency_ms: number | null;
};

export type AiMonitoringCredentialShape = 'api_token' | 'username_passhash' | 'secret_ref' | 'none';

export type AiMonitoringIntegration = {
  provider_key: string;
  implementation: string;
  enabled: boolean;
  environment: 'sandbox' | 'production';
  base_url: string;
  server_timezone: string | null;
  request_timeout_seconds: number | null;
  credential: {
    present: boolean;
    shape: AiMonitoringCredentialShape;
  };
  updated_at: string;
};

export type AiPrtgIntegrationUpdatePayload = {
  base_url: string;
  enabled: boolean;
  environment?: 'sandbox' | 'production';
  server_timezone?: string;
  /** Whole seconds (5–120); null clears back to the built-in default. */
  request_timeout_seconds?: number | null;
  /** Write-only: omitted or empty keeps the stored credential. */
  api_token?: string;
  username?: string;
  passhash?: string;
};

export type AiPrtgTestResult = {
  ok: boolean;
  prtg_version?: string;
  sensor_count?: number;
  message: string;
};

export type AiSettingsPayload = {
  instance_features: { ai_chat: boolean; ai_mcp: boolean; ai_settings: boolean; ai_web_search: boolean };
  settings: {
    chat_enabled: boolean;
    mcp_enabled: boolean;
    provider_source: 'builtin' | 'custom';
    chat_model_config_id: string | null;
    llm_provider: string | null;
    llm_endpoint_url: string | null;
    llm_model: string | null;
    mcp_key_max_lifetime_days: number | null;
    conversation_retention_days: number | null;
    web_search_enabled: boolean;
    llm_supports_vision: boolean;
    glpi_enabled: boolean;
    glpi_url: string | null;
    has_glpi_user_token: boolean;
    has_glpi_app_token: boolean;
    has_llm_api_key: boolean;
    provider_secret_writable: boolean;
    provider_validation_errors: string[];
    chat_ready: boolean;
    builtin_provider?: AiBuiltinProvider;
    created_at: string;
    updated_at: string;
  };
  available_providers: ProviderDescriptor[];
};

export type AiProviderTestResult = {
  ok: boolean;
  provider: string | null;
  model: string | null;
  latency_ms: number | null;
  message: string;
  validation_errors: string[];
};

export type AiModelConfigUsage = {
  chat: boolean;
  agents: { id: string; name: string }[];
};

export type AiModelConfig = {
  id: string;
  name: string;
  provider: string;
  model: string;
  endpoint_url: string | null;
  has_api_key: boolean;
  supports_vision: boolean;
  price_input_eur_per_mtok: number | null;
  price_output_eur_per_mtok: number | null;
  llm_timeout_ms: number | null;
  status: 'active' | 'archived';
  is_default: boolean;
  used_by: AiModelConfigUsage;
  messages_this_month: number;
  validation_errors: string[];
  created_at: string;
  updated_at: string;
};

// Reduced shape returned by GET /ai/model-configs for agent admins without
// AI settings access — just enough to assign models to agents.
export type AiModelAssignmentOption = {
  id: string;
  name: string;
  supports_vision: boolean;
  status: 'active' | 'archived';
  is_default: boolean;
};

export type AiModelConfigInput = {
  name?: string;
  provider?: string;
  model?: string;
  endpoint_url?: string | null;
  api_key?: string | null;
  supports_vision?: boolean;
  price_input_eur_per_mtok?: number | null;
  price_output_eur_per_mtok?: number | null;
  llm_timeout_ms?: number | null;
  is_default?: boolean;
};

export type AiUsageWindow = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  message_count: number;
};

export type AiAdminOverview = {
  totals: {
    conversations_all: number;
    conversations_7d: number;
    conversations_30d: number;
    active_users_30d: number;
  };
  usage: {
    current_month: AiUsageWindow;
    last_30_days: AiUsageWindow;
  };
  recent_activity: Array<{
    conversation_id: string;
    title: string | null;
    user_id: string | null;
    provider: string | null;
    model: string | null;
    updated_at: string;
  }>;
  agents: Array<{
    agent_definition_id: string;
    name: string;
    messages_current_month: number;
    messages_last_30_days: number;
  }>;
  costs: {
    current_month: { agents_eur: number; chat_eur: number; total_eur: number };
    last_30_days: { agents_eur: number; chat_eur: number; total_eur: number };
    by_agent: Array<{
      agent_definition_id: string;
      name: string;
      cost_current_month_eur: number;
      cost_last_30_days_eur: number;
    }>;
    by_model: Array<{
      model: string | null;
      cost_current_month_eur: number;
      cost_last_30_days_eur: number;
    }>;
    chat_priced: boolean;
  };
};

export type AiAgentControlRunItem = {
  id: string;
  tenant_id: string;
  user_id: string | null;
  conversation_id: string | null;
  request_id: string | null;
  ai_api_key_id: string | null;
  invocation_channel: string;
  trigger_kind: string;
  status: string;
  input_summary: Record<string, unknown> | null;
  output_summary: Record<string, unknown> | null;
  usage_json: Record<string, unknown> | null;
  cost_json: Record<string, unknown> | null;
  metadata_json: Record<string, unknown> | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  counts?: {
    tool_executions: number;
    evidence: number;
    action_requests: number;
    pending_actions: number;
  };
};

export type AiAgentControlToolExecution = {
  id: string;
  run_id: string;
  action_request_id: string | null;
  approval_id: string | null;
  capability_name: string;
  capability_version: string;
  surface: string;
  effect: string;
  status: string;
  input_summary: Record<string, unknown> | null;
  output_summary: Record<string, unknown> | null;
  error_message: string | null;
  duration_ms: number | null;
  metadata_json: Record<string, unknown> | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
};

export type AiAgentControlEvidence = {
  id: string;
  run_id: string | null;
  tool_execution_id: string | null;
  action_request_id: string | null;
  source_provider: string;
  source_object_type: string;
  source_object_id: string | null;
  trust_level: string;
  redaction_status: string;
  summary: string;
  payload_json: Record<string, unknown> | unknown[] | null;
  collected_at: string | null;
  created_at: string | null;
};

export type AiAgentControlObservation = {
  id: string;
  run_id: string | null;
  observation_type: string;
  status: string;
  source_provider: string;
  source_object_type: string;
  severity: string | null;
  summary: string;
  evidence_ids: string[] | null;
  created_at: string | null;
};

export type AiAgentControlRecommendation = {
  id: string;
  run_id: string | null;
  observation_id: string | null;
  recommendation_type: string;
  status: string;
  summary: string;
  rationale: string | null;
  confidence: number | null;
  proposed_action_class: string | null;
  max_autonomy_level: string;
  evidence_ids: string[] | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string | null;
};

export type AiAgentControlDecision = {
  id: string;
  run_id: string | null;
  recommendation_id: string | null;
  decision: string;
  status: string;
  reason: string;
  created_at: string | null;
};

export type AiAgentControlEvaluation = {
  id: string;
  run_id: string | null;
  recommendation_id: string | null;
  decision_id: string | null;
  status: string;
  outcome: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string | null;
};

export type AiAgentControlActionRequest = {
  id: string;
  run_id: string | null;
  tool_execution_id: string | null;
  capability_name: string;
  capability_version: string;
  effect: string;
  status: string;
  target_type: string | null;
  target_id: string | null;
  target_ref: string | null;
  action_payload_json: Record<string, unknown> | null;
  provider_kind: string | null;
  provider_key: string | null;
  input_summary: Record<string, unknown> | null;
  evidence_ids: string[] | null;
  expires_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  executed_at: string | null;
  error_message: string | null;
  metadata_json: Record<string, unknown> | null;
  execution_readiness: {
    can_execute: boolean;
    can_reject: boolean;
    blocked_reason: string | null;
    requires_sandbox_write_target: boolean;
    sandbox_write_target_ref: string | null;
  } | null;
  // The agent is linked through metadata only, so it can outlive the agent's
  // deletion. `agent_exists` is null when the row carries no agent at all.
  agent_definition_id?: string | null;
  agent_exists?: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

export type AiAgentControlAttentionSummary = {
  actions: number;
  work_items: number;
  total: number;
};

export type AiAgentControlAgentDefinition = {
  id: string;
  agent_key: string;
  name: string;
  description: string | null;
  agent_type: string;
  status: string;
  environment: string;
  provider_bindings_json: Record<string, unknown> | null;
  allowed_capabilities_json: Record<string, unknown> | unknown[] | null;
  forbidden_capabilities_json: Record<string, unknown> | unknown[] | null;
  max_autonomy_level: string;
  default_approval_requirement: string;
  agent_priority: number;
  trigger_policy_json: Record<string, unknown> | null;
  scope_policy_json: Record<string, unknown> | null;
  queue_policy_json: Record<string, unknown> | null;
  response_policy_json: Record<string, unknown> | null;
  evaluation_policy_json: Record<string, unknown> | null;
  persona_json: Record<string, unknown> | null;
  llm_model_config_id: string | null;
  config_version: number;
  updated_by_user_id: string | null;
  metadata_json: Record<string, unknown> | null;
  // Action classes currently running automatically (enabled autonomy policies).
  automatic_action_classes?: string[];
  created_at: string | null;
  updated_at: string | null;
};

// KANAP-data enrichment domains an SRE agent may search (scope_policy_json
// .knowledge_sources.kanap_data.domains). Keep in sync with the five-family
// whitelist of the backend entity capabilities (plan 37 §4.5).
export type AiAgentKanapDataDomains = {
  applications: boolean;
  assets: boolean;
  interfaces: boolean;
  connections: boolean;
  locations: boolean;
};

export type AiAgentKanapDataSources = {
  enabled: boolean;
  domains: AiAgentKanapDataDomains;
};

// Per-agent retrieval-source policy written to scope_policy_json.knowledge_sources.
// DATA-LOSS GUARD: the backend replaces the WHOLE knowledge_sources sub-block on
// every update — any persist call for this block (e.g. the workspace Settings
// autosave) MUST read kanap_data from the current definition and round-trip it.
// Omitting kanap_data resets it to disabled and silently wipes the SRE agent's
// KANAP-data policy (backend defaults absent kanap_data to OFF).
export type AiAgentKnowledgeSourcesInput = {
  knowledge: { enabled: boolean; all_libraries: boolean; library_ids: string[] };
  web: { enabled: boolean };
  precedence?: string;
  kanap_data?: AiAgentKanapDataSources;
};

export type AiAgentControlAgentDefinitionInput = {
  agent_key?: string | null;
  name?: string | null;
  description?: string | null;
  agent_type?: string | null;
  environment?: string | null;
  agent_priority?: number | null;
  provider_bindings_json?: Record<string, unknown> | null;
  allowed_capabilities_json?: Record<string, unknown> | unknown[] | null;
  persona_json?: Record<string, unknown> | null;
  trigger_policy_json?: Record<string, unknown> | null;
  scope_policy_json?: Record<string, unknown> | null;
  knowledge_sources?: AiAgentKnowledgeSourcesInput | null;
  queue_policy_json?: Record<string, unknown> | null;
  response_policy_json?: Record<string, unknown> | null;
  evaluation_policy_json?: Record<string, unknown> | null;
  llm_model_config_id?: string | null;
};

export type AiAgentControlRefItem = {
  value: string;
  label: string;
  metadata?: Record<string, unknown>;
};

// Keep in sync with MonitoringTargetPredicateOperator in
// backend/src/ai/control-plane/agent/monitoring-targeting.ts — monitoring
// targeting has no `lte` (unlike ticketing targeting).
export type AiMonitoringTargetingOperator = 'eq' | 'in' | 'gte' | 'not';

export type AiMonitoringTargetingPredicate = {
  field: string;
  operator: AiMonitoringTargetingOperator;
  value: unknown;
};

// The exact shape the backend's normalizeMonitoringTargeting expects under an
// SRE agent's scope_policy_json.targeting.
export type AiMonitoringTargetingModel = {
  schema_version: 1;
  combinator: 'and';
  predicates: AiMonitoringTargetingPredicate[];
};

export type AiKnowledgeLibrary = {
  id: string;
  name: string;
  slug?: string | null;
};

export type AiSharedContextProfile = {
  id: string;
  profile_key: string;
  name: string;
  description: string | null;
  content_json: { lines?: string[] } | Record<string, unknown> | null;
  status: string;
  config_version: number;
  updated_by_user_id: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

export type AiSharedContextProfileInput = {
  profile_key?: string | null;
  name?: string | null;
  description?: string | null;
  content_json?: { lines?: string[] } | Record<string, unknown> | null;
  lines?: string[] | null;
};

export type AiAgentEffectivePromptTask = {
  system_prompt: string;
  guidance_json: Record<string, unknown>;
  bounds_applied?: string[];
};

export type AiAgentEffectivePrompt = {
  agent_definition_id: string;
  prompt_profile: Record<string, unknown>;
  shared_context_resolved: boolean;
  shared_context_resolution_reason: string | null;
  bounds_applied?: string[];
  // Helpdesk agents expose the four triage tasks; SRE agents expose monitoring_diagnosis only.
  tasks: Partial<Record<'action_planner' | 'planner' | 'interpreter' | 'synthesis' | 'monitoring_diagnosis', AiAgentEffectivePromptTask>>;
};

export type AiAgentControlAutonomyItem = {
  actionClass: string;
  capabilityName: string | null;
  mode: 'ask_first' | 'automatic';
  // Automation risk tier. `high` (requester reply, assignment, participants)
  // always requires the acknowledgement + reason, even when eligible.
  riskTier: 'low' | 'high';
  acknowledgementRequired: boolean;
  eligible: boolean;
  recommendationOverrideAvailable?: boolean;
  hardReasons?: string[];
  reasons: string[];
  progress: {
    decided: number;
    required: number;
    acceptanceRate: number | null;
    requiredRate: number;
    daysActive: number;
    requiredDays: number;
  };
  effectiveCeiling: string | null;
  demotion: { at: string; reason: string } | null;
  policy: {
    id: string;
    policy_key: string;
    policy_version: number;
    enabled: boolean;
    status: string;
    live_test_safety: string;
  } | null;
};

export type AiAgentControlAutonomyResult = {
  agent_definition: AiAgentControlAgentDefinition;
  riskTiers: Record<string, 'low' | 'high'>;
  // Recommendation thresholds the rows are measured against — the UI reads them
  // from here instead of hardcoding "20 decisions".
  thresholds: {
    minimumDecided: number;
    minimumAcceptanceRate: number;
    minimumObservationDays: number;
  };
  items: AiAgentControlAutonomyItem[];
};

export type AiAgentControlWorkItem = {
  id: string;
  agent_definition_id: string;
  trigger_id: string | null;
  source_provider_kind: string;
  source_provider_key: string;
  source_object_type: string;
  source_object_ref: string;
  source_object_updated_at: string | null;
  work_kind: string;
  status: string;
  priority: number;
  dedup_key: string;
  lease_owner: string | null;
  leased_until: string | null;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_run_id: string | null;
  last_action_request_ids: string[] | null;
  last_error: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

export type AiAgentControlTargetState = {
  id: string;
  agent_definition_id: string;
  provider_kind: string;
  provider_key: string;
  target_type: string;
  target_ref: string;
  last_seen_external_updated_at: string | null;
  last_processed_external_updated_at: string | null;
  next_review_at: string | null;
  last_run_id: string | null;
  last_public_reply_hash: string | null;
  last_internal_note_hash: string | null;
  last_classification_hash: string | null;
  last_assignment_hash: string | null;
  agent_touched: boolean;
  needs_followup: boolean;
  claim_status: string;
  claim_expires_at: string | null;
  claim_acquired_at: string | null;
  claim_owner_work_item_id: string | null;
  claim_owner_run_id: string | null;
  claim_owner_priority: number | null;
  claim_owner_action_request_ids: string[] | null;
  claim_metadata_json: Record<string, unknown> | null;
  state_json: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

export type AiAgentControlTargetingPreview = {
  matchEstimate: number;
  sampleSize: number;
  capped: boolean;
  overlapEstimate: number;
  runsPerDayEstimate: number;
  resolution: Array<{
    predicate: { field: string; operator: string; value: unknown };
    resolution: 'pushed_down' | 'locally_filtered_bounded_fetch' | 'control_plane_resolved' | 'unsupported';
    reason: string;
  }>;
};

export type AiAgentControlAuditEvent = {
  id: string;
  tenant_id: string;
  agent_definition_id: string | null;
  work_item_id: string | null;
  event_type: string;
  severity: string;
  message: string;
  metadata_json: Record<string, unknown> | null;
  created_at: string | null;
};

export type AiAgentControlHelpdeskSummary = {
  agentDefinitionId: string;
  ingestion: {
    enabled: boolean;
    mode: string;
    paused: boolean;
    pauseReason: string | null;
    enabledAt: string | null;
    createdAfter: string | null;
    entityId: string | null;
    categoryId: string | null;
    maxTicketsPerCycle: number | null;
    maxProviderRequestsPerCycle: number | null;
    lastPollAt: string | null;
    lastPollStatus: string | null;
    lastAuditEventId: string | null;
  };
  guardrails: {
    configured: boolean;
    perRun: {
      maxEstimatedTokens: number;
      maxEstimatedCostEur: number;
    } | null;
    daily: {
      windowStart: string;
      windowEnd: string;
      runs: number;
      estimatedTokens: number;
      estimatedCostEur: number;
      cap: {
        maxRuns: number;
        maxTokens: number;
        maxCostEur: number;
      };
      reached: boolean;
      reachedReasons: string[];
    } | null;
  };
  emergencyPause: AiAgentControlEmergencyPause | null;
  evaluation: {
    windowStart: string;
    windowEnd: string;
    proposalsByActionClass: Record<string, number>;
    terminalByStatus: Record<string, number>;
    acceptanceRate: number | null;
    dismissRate: number | null;
    rejectionReasons: Record<string, number>;
    medianApprovalLatencySeconds: number | null;
    runsPerTicket: number | null;
    tokensPerTicket: number | null;
    costPerTicketEur: number | null;
    kbHitRate: number | null;
  };
};

// Deep link into the external tool's own web UI for a queue target (e.g. the
// GLPI ticket page), resolved by the backend provider at read time.
export type AiAgentControlTargetLink = {
  provider_kind: string;
  provider_key: string;
  target_type: string;
  target_ref: string;
  url: string;
};

export type AiAgentControlQueueOverview = {
  definitions: AiAgentControlAgentDefinition[];
  work_items: AiAgentControlWorkItem[];
  target_states: AiAgentControlTargetState[];
  action_requests: AiAgentControlActionRequest[];
  target_links?: AiAgentControlTargetLink[];
  monitoring_diagnoses?: AiAgentControlMonitoringDiagnosisCard[];
  counts: Record<string, number>;
  // Fleet LLM spend across every agent of the tenant (desk + SRE), today and
  // over the trailing 7 days.
  cost?: { today_eur: number; last_7_days_eur: number };
  helpdesk?: {
    summary: AiAgentControlHelpdeskSummary | null;
    summaries?: AiAgentControlHelpdeskSummary[];
    fleet?: AiAgentControlHelpdeskSummary['evaluation'] | null;
    audit_events: AiAgentControlAuditEvent[];
  };
  emergency_pause?: AiAgentControlEmergencyPause | null;
};

export type AiAgentControlHelpdeskContextRead = {
  run_id: string;
  step_id: string;
  tool_execution_id: string;
  evidence_ids: string[];
  output: unknown;
};

export type AiAgentControlHelpdeskContextResult = {
  work_item: AiAgentControlWorkItem;
  target_state: AiAgentControlTargetState | null;
  run_id: string;
  classification: AiAgentControlHelpdeskContextRead;
  lifecycle: AiAgentControlHelpdeskContextRead;
  routing: AiAgentControlHelpdeskContextRead;
  participants: AiAgentControlHelpdeskContextRead;
};

export type AiAgentControlApproval = {
  id: string;
  action_request_id: string;
  capability_name: string;
  capability_version: string;
  source: string;
  status: string;
  actor_user_id: string | null;
  actor_label: string | null;
  reason: string | null;
  expires_at: string | null;
  decided_at: string | null;
  created_at: string | null;
};

export type AiAgentControlRunStep = {
  id: string;
  run_id: string;
  step_index: number;
  kind: string;
  status: string;
  capability_name: string | null;
  capability_version: string | null;
  input_summary: Record<string, unknown> | null;
  output_summary: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
};

export type AiAgentControlRunDetail = {
  run: AiAgentControlRunItem;
  run_steps: AiAgentControlRunStep[];
  tool_executions: AiAgentControlToolExecution[];
  evidence: AiAgentControlEvidence[];
  observations: AiAgentControlObservation[];
  recommendations: AiAgentControlRecommendation[];
  decisions: AiAgentControlDecision[];
  evaluations: AiAgentControlEvaluation[];
  action_requests: AiAgentControlActionRequest[];
  approvals: AiAgentControlApproval[];
};

export type AiAgentControlExecutionMode = 'queued' | 'approve_only' | 'synchronous' | 'background' | (string & {});

export type AiAgentControlBulkApproveResult = {
  results: Array<{
    action_request_id: string;
    ok: boolean;
    status: string;
    reason: string | null;
    action: AiAgentControlActionRequest;
    execution: unknown;
  }>;
  approvals: AiAgentControlApproval[];
  execution_mode?: AiAgentControlExecutionMode;
  summary: {
    requested: number;
    processed: number;
    approved?: number;
    queued?: number;
    executed: number;
    needs_review: number;
  };
};

export type AiAgentControlMockTriageResult = {
  diagnostic: {
    run_id: string | null;
    evidence_ids: string[];
    observation_ids: string[];
    recommendation_id: string;
    decision_id: string;
    evaluation_id: string;
  };
  proposal: {
    run_id: string | null;
    action_request_id: string;
    decision_id: string;
    evaluation_id: string;
  };
  detail: AiAgentControlRunDetail;
};

export type AiAgentControlLiveTarget = {
  id: string;
  tenant_id: string;
  provider_kind: string;
  provider_key: string;
  environment: string;
  target_kind: string;
  target_key: string;
  external_ref: string;
  allowed_effect: string;
  safety_label: string;
  enabled: boolean;
  expires_at: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

export type AiAgentControlTicketingReadTargetsResult = {
  provider: {
    provider_kind: string;
    provider_key: string;
    available: boolean;
    reason_code: string | null;
    message: string | null;
  };
  items: AiAgentControlLiveTarget[];
  ready: boolean;
};

export type AiAgentControlTicketingReadResult = {
  target: AiAgentControlLiveTarget;
  result: {
    run_id: string;
    step_id: string;
    tool_execution_id: string;
    output: unknown;
  };
  detail: AiAgentControlRunDetail;
};

export type AiAgentControlTicketingTriageResult = {
  target: AiAgentControlLiveTarget;
  agent_definition: AiAgentControlAgentDefinition | null;
  work_item: AiAgentControlWorkItem | null;
  target_state: AiAgentControlTargetState | null;
  diagnostic: {
    run_id: string;
    ticket_tool_execution_id: string;
    ticket_notes_tool_execution_id?: string;
    knowledge_tool_execution_id: string;
    knowledge_tool_execution_ids?: string[];
    knowledge_query?: string;
    knowledge_query_candidates?: string[];
    knowledge_search_plan?: Record<string, unknown>;
    knowledge_query_attempts?: Array<{
      query: string;
      result_count: number;
      tool_execution_id: string;
    }>;
    knowledge_candidates?: Array<{
      ref?: string | null;
      title?: string | null;
      search_queries?: string[];
    }>;
    knowledge_result_interpretation?: Record<string, unknown>;
    internal_note_tool_execution_id?: string | null;
    public_reply_tool_execution_id?: string | null;
    evidence_ids: string[];
    observation_id: string;
    recommendation_id: string;
    decision_id: string;
    evaluation_id: string;
    action_request_ids?: string[];
    automatic_executions?: Array<{
      action_request_id: string;
      action_class: string;
      status: 'executed' | 'skipped' | 'failed';
      tool_execution_id: string | null;
      error_message: string | null;
    }>;
    conversation_gate?: {
      can_prepare_internal_note?: boolean;
      can_prepare_public_reply?: boolean;
      internal_note_reason?: string;
      public_reply_reason?: string;
      latest_requester_message_at?: string | null;
      latest_requester_message_id?: string | null;
      last_agent_internal_note_at?: string | null;
      last_agent_internal_note_action_id?: string | null;
      last_agent_public_reply_at?: string | null;
      last_agent_public_reply_action_id?: string | null;
      requester_classification_confidence?: string;
      ticket_history_entry_count?: number;
      latest_ticket_note_id?: string | null;
      latest_ticket_note_at?: string | null;
      latest_ticket_note_fingerprint?: string | null;
      latest_requester_message_fingerprint?: string | null;
      prepared_at?: string | null;
    };
    skipped_actions?: {
      internal_note?: string | null;
      public_reply?: string | null;
    };
    ticket_history_entry_count?: number;
    knowledge_results: Array<{
      id?: string;
      ref?: string | null;
      title?: string | null;
      summary?: string | null;
      snippet?: string | null;
      status?: string | null;
      updated_at?: string | null;
    }>;
  };
  proposal: {
    run_id: string;
    step_id: string;
    tool_execution_id: string;
    output: unknown;
  } | null;
  public_reply_proposal?: {
    run_id: string;
    step_id: string;
    tool_execution_id: string;
    output: unknown;
  };
  detail: AiAgentControlRunDetail;
};

export type AiAgentControlHelpdeskIngestionPollResult = {
  tenantId: string;
  status: string;
  reason?: string | null;
  listed: number;
  enqueued: number;
  deduped: number;
  processed: number;
  errors: string[];
};

// Mirrors MonitoringAlertIngestionPollSummary in
// backend/src/ai/control-plane/agent/ai-agent-monitoring-alert-ingestion.service.ts.
export type AiAgentControlMonitoringIngestionPollResult = {
  tenantId: string;
  agentDefinitionId?: string | null;
  agentKey?: string | null;
  status: 'disabled' | 'paused' | 'completed' | 'failed' | 'skipped';
  reason?: string | null;
  listed: number;
  enqueued: number;
  deduped: number;
  processed: number;
  errors: string[];
  agents?: AiAgentControlMonitoringIngestionPollResult[];
};

// Citation entry of a diagnostic brief (kind 'entity' = a KANAP record; url is
// the deep link, ref is the business reference the model cited by).
export type AiAgentControlDiagnosticSource = {
  kind: 'knowledge' | 'web' | 'entity';
  ref: string | null;
  url: string | null;
  title: string;
};

// Mirrors DiagnosticBriefResult in
// backend/src/ai/control-plane/agent-control/ai-diagnostic-brief-synthesis.service.ts
// (usage/cost internals omitted — the UI surfaces the reviewable fields).
export type AiAgentControlDiagnosticBrief = {
  language: string;
  summary: string;
  probable_causes: Array<{
    cause: string;
    confidence: 'low' | 'medium' | 'high';
    rationale: string | null;
  }>;
  business_impact: string;
  recommended_actions: Array<{
    action: string;
    rationale: string | null;
    urgency: 'low' | 'medium' | 'high';
  }>;
  used_sources: AiAgentControlDiagnosticSource[];
  rejected_sources: Array<AiAgentControlDiagnosticSource & { reason: string }>;
  needs_human_review: boolean;
  confidence: 'low' | 'medium' | 'high';
  fallback: boolean;
  fallback_reason: string | null;
  model: string | null;
};

export type AiAgentControlMonitoringDiagnosisResult = {
  status: string;
  agent_definition: AiAgentControlAgentDefinition;
  work_item: AiAgentControlWorkItem;
  target_state: AiAgentControlTargetState | null;
  // The diagnosis pipeline attaches many stage-specific fields (tool execution
  // ids, enrichment statuses, usage ledger); only the stable reviewable core is
  // typed here — everything else stays reachable through the index signature.
  diagnostic: {
    run_id: string | null;
    diagnosis_stage: string;
    outcome?: string | null;
    alert?: Record<string, unknown> | null;
    brief?: AiAgentControlDiagnosticBrief | null;
    kanap_context?: Record<string, unknown> | null;
    knowledge_status?: string | null;
    web_search_status?: string | null;
    similar_tickets_status?: string | null;
    evidence_ids?: string[];
    [key: string]: unknown;
  };
};

// List-level alert dossier card: the latest stored diagnosis per watched
// monitoring target. Mirrors MonitoringDiagnosisCard in
// backend/src/ai/control-plane/agent/ai-agent-work-queue.service.ts.
export type AiAgentControlMonitoringDiagnosisCard = {
  target_ref: string;
  observation_id: string;
  run_id: string | null;
  observed_at: string | null;
  check_name: string | null;
  device_name: string | null;
  severity: string | null;
  status_at_diagnosis: string | null;
  brief_summary: string | null;
  brief_confidence: string | null;
  needs_human_review: boolean;
  synthesis_fallback: boolean;
  occurrence_started_at: string | null;
  source_uri: string | null;
};

export type AiAgentControlDiagnosisCause = {
  cause?: string;
  confidence?: string;
  rationale?: string | null;
};

export type AiAgentControlDiagnosisRecommendedAction = {
  action?: string;
  rationale?: string | null;
  urgency?: string;
};

// One stored diagnosis dossier. Mirrors serializeMonitoringAlertDiagnosis in
// backend/src/ai/control-plane/agent-control/ai-agent-control.service.ts.
export type AiAgentControlMonitoringAlertDiagnosis = {
  observation_id: string;
  run_id: string | null;
  observed_at: string | null;
  severity: string | null;
  summary: string | null;
  alert: Record<string, unknown> | null;
  current_state: Record<string, unknown> | null;
  related_alerts: Array<Record<string, unknown>>;
  history_window_minutes: number | null;
  history_point_count: number | null;
  history_summary: Record<string, unknown> | null;
  kanap_context: Record<string, unknown> | null;
  brief: {
    summary: string | null;
    probable_causes: AiAgentControlDiagnosisCause[];
    business_impact: string | null;
    recommended_actions: AiAgentControlDiagnosisRecommendedAction[];
    used_sources: AiAgentControlDiagnosticSource[];
    rejected_sources: Array<AiAgentControlDiagnosticSource & { reason?: string }>;
    needs_human_review: boolean;
    confidence: string | null;
    language: string | null;
    fallback: boolean;
    fallback_reason: string | null;
    model: string | null;
  };
  synthesis: { model: string | null; tokens: number | null; cost_eur: number | null };
  knowledge: { status: string | null; result_count: number | null };
  web: { status: string | null; result_count: number | null };
};

export type AiAgentControlEmergencyPause = {
  id: string;
  active: boolean;
  scope: string | null;
  agent_definition_id: string | null;
  reason: string;
  created_at: string | null;
  expires_at: string | null;
};

export type AiAgentControlBadgeSummary = {
  pendingApprovals: number;
};

export type AiAgentControlActivityType = 'proposal' | 'decision' | 'execution' | 'configuration' | 'check' | 'pause' | 'error';

export const AI_AGENT_CONTROL_ACTIVITY_TYPES: AiAgentControlActivityType[] = [
  'proposal',
  'decision',
  'execution',
  'configuration',
  'check',
  'pause',
  'error',
];

// What a watcher cycle actually did, as stored in its audit event.
export type AiAgentControlActivityCheck = {
  listed: number;
  enqueued: number;
  deduped: number;
  processed: number;
  errorCount: number;
  errors: string[];
  status: string | null;
  reason: string | null;
};

export type AiAgentControlActivityDetail = {
  capabilityName: string | null;
  body: string | null;
  changes: Array<{ field: string; from: string | null; to: string | null }> | null;
  reason: string | null;
  rationale: string | null;
  evidenceCount: number | null;
  check?: AiAgentControlActivityCheck | null;
};

export type AiAgentControlActivityEntry = {
  id: string;
  at: string;
  type: AiAgentControlActivityType;
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
  detail: AiAgentControlActivityDetail | null;
};

export type AiAgentControlActivityResult = {
  items: AiAgentControlActivityEntry[];
  // Only counted on the first page (no cursor); null on "load more" pages.
  total: number | null;
  limit: number;
  nextCursor: string | null;
};

export type AiAgentControlEvaluationDailyResult = {
  days: Array<{
    day: string;
    proposals: number;
    decided: number;
    acceptanceRate: number | null;
    executed: number;
    dismissed: number;
    costEur: number;
    tokens: number;
  }>;
};

export class ChatStreamRequestError extends Error {
  status: number;
  code: string | null;
  builtin_usage?: BuiltinUsage;

  constructor(
    message: string,
    opts: {
      status: number;
      code?: string | null;
      builtin_usage?: BuiltinUsage;
    },
  ) {
    super(message);
    this.name = 'ChatStreamRequestError';
    this.status = opts.status;
    this.code = opts.code ?? null;
    this.builtin_usage = opts.builtin_usage;
  }
}

function getBaseURL(): string {
  const env = import.meta.env.VITE_API_URL as string | undefined;
  if (!env) return 'http://localhost:8080';
  // If relative path (e.g. "/api"), resolve against current origin
  if (env.startsWith('/')) return window.location.origin + env;
  return env;
}

export async function* streamChat(params: {
  message: string;
  conversation_id?: string;
  attachment_ids?: string[];
  truncate_from_message_id?: string | null;
  signal?: AbortSignal;
}): AsyncGenerator<ChatStreamEvent> {
  const { signal, ...body } = params;

  const send = () => {
    const token = getAccessToken();
    return fetch(`${getBaseURL()}/ai/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      credentials: 'include',
      signal,
    });
  };

  let response = await send();

  // This streaming call uses raw fetch, so it bypasses the axios response interceptor that
  // refreshes an expired access token and replays the request (api.ts). Without this, an
  // expired token ended the stream with a hard 401 while every other call recovered.
  if (response.status === 401) {
    const refreshed = await requestTokenRefresh();
    if (refreshed) response = await send();
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    let payload: any = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }
    throw new ChatStreamRequestError(
      payload?.message || raw || i18n.t('ai:errors.streamRequestFailed'),
      {
        status: response.status,
        code: payload?.code ?? null,
        builtin_usage: payload?.builtin_usage,
      },
    );
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error(i18n.t('ai:errors.noResponseBody'));

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_STREAM_BUFFER_CHARS) {
        throw new Error(i18n.t('ai:errors.streamBufferExceeded'));
      }

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      if (buffer.length > MAX_STREAM_BUFFER_CHARS) {
        throw new Error(i18n.t('ai:errors.streamBufferExceeded'));
      }

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          yield JSON.parse(trimmed) as ChatStreamEvent;
        } catch {
          // skip malformed lines
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      try {
        yield JSON.parse(buffer.trim()) as ChatStreamEvent;
      } catch {
        // skip
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore reader cleanup errors
    }
  }
}

export const aiConversationsApi = {
  async list(params?: { page?: number; limit?: number }): Promise<ChatConversation[]> {
    const res = await api.get('/ai/conversations', { params });
    return res.data;
  },
  async create(): Promise<ChatConversation> {
    const res = await api.post('/ai/conversations');
    return res.data;
  },
  async getMessages(id: string): Promise<ConversationMessagesResponse> {
    const res = await api.get(`/ai/conversations/${id}/messages`);
    const { messages, conversation_usage } = res.data;
    return { messages, conversation_usage };
  },
  async getPreviews(id: string): Promise<AiMutationPreview[]> {
    const res = await api.get(`/ai/conversations/${id}/previews`);
    return res.data;
  },
  async archive(id: string) {
    const res = await api.delete(`/ai/conversations/${id}`);
    return res.data;
  },
  async rename(id: string, title: string): Promise<ChatConversation> {
    const res = await api.patch(`/ai/conversations/${id}`, { title });
    return res.data;
  },
  async uploadInlineAttachment(conversationId: string, file: File): Promise<{
    id: string;
    conversation_id: string;
    mime_type: string;
    size: number;
    kind: string;
    original_filename: string;
  }> {
    const form = new FormData();
    form.append('file', file);
    const res = await api.post(`/ai/conversations/${conversationId}/attachments/inline`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  },
  buildAttachmentUrl(conversationId: string, attachmentId: string): string {
    return `/ai/conversations/${conversationId}/attachments/${attachmentId}/inline`;
  },
};

export const aiAdminApi = {
  async getSettings(): Promise<AiSettingsPayload> {
    const res = await api.get('/ai/settings');
    return res.data;
  },
  async updateSettings(payload: Record<string, unknown>): Promise<{ settings: AiSettingsPayload['settings'] }> {
    const res = await api.patch('/ai/settings', payload);
    return res.data;
  },
  async testProvider(payload: Record<string, unknown>): Promise<AiProviderTestResult> {
    const res = await api.post('/ai/settings/test-provider', payload);
    return res.data;
  },
  async testWebSearch(): Promise<AiWebSearchTestResult> {
    const res = await api.post('/ai/settings/test-web-search');
    return res.data;
  },
  async testGlpi(payload: Record<string, unknown>): Promise<AiGlpiTestResult> {
    const res = await api.post('/ai/settings/test-glpi', payload);
    return res.data;
  },
  async listMonitoringIntegrations(): Promise<{ integrations: AiMonitoringIntegration[] }> {
    const res = await api.get('/ai/admin/integrations/monitoring');
    return res.data;
  },
  async updatePrtgIntegration(payload: AiPrtgIntegrationUpdatePayload): Promise<{ ok: boolean }> {
    const res = await api.put('/ai/admin/integrations/monitoring/prtg', payload);
    return res.data;
  },
  async testPrtgIntegration(payload: { base_url?: string; api_token?: string }): Promise<AiPrtgTestResult> {
    const res = await api.post('/ai/admin/integrations/monitoring/prtg/test', payload);
    return res.data;
  },
  async getOverview(): Promise<AiAdminOverview> {
    const res = await api.get('/ai/admin/overview');
    return res.data;
  },
  async getBuiltinUsage(): Promise<BuiltinUsage> {
    const res = await api.get('/ai/settings/builtin-usage');
    return res.data;
  },
};

export const aiModelConfigsApi = {
  async list(): Promise<{ model_configs: AiModelConfig[]; secret_writable: boolean }> {
    const res = await api.get('/ai/model-configs');
    return res.data;
  },
  async listAssignable(): Promise<{ model_configs: AiModelAssignmentOption[] }> {
    const res = await api.get('/ai/model-configs');
    return res.data;
  },
  async create(payload: AiModelConfigInput): Promise<{ model_config: AiModelConfig }> {
    const res = await api.post('/ai/model-configs', payload);
    return res.data;
  },
  async update(id: string, payload: AiModelConfigInput): Promise<{ model_config: AiModelConfig }> {
    const res = await api.patch(`/ai/model-configs/${id}`, payload);
    return res.data;
  },
  async archive(id: string): Promise<{ model_config: AiModelConfig }> {
    const res = await api.delete(`/ai/model-configs/${id}`);
    return res.data;
  },
  async restore(id: string): Promise<{ model_config: AiModelConfig }> {
    const res = await api.post(`/ai/model-configs/${id}/restore`);
    return res.data;
  },
  async setDefault(id: string): Promise<{ model_config: AiModelConfig }> {
    const res = await api.post(`/ai/model-configs/${id}/set-default`);
    return res.data;
  },
  async clearDefault(id: string): Promise<{ model_config: AiModelConfig }> {
    const res = await api.post(`/ai/model-configs/${id}/clear-default`);
    return res.data;
  },
  async test(id: string): Promise<AiProviderTestResult> {
    const res = await api.post(`/ai/model-configs/${id}/test`);
    return res.data;
  },
};

export const aiAgentControlApi = {
  async listAgents(): Promise<{ items: AiAgentControlAgentDefinition[] }> {
    const res = await api.get('/ai/admin/control-plane/agents');
    return res.data;
  },
  async createAgent(payload: AiAgentControlAgentDefinitionInput): Promise<{ agent_definition: AiAgentControlAgentDefinition }> {
    const res = await api.post('/ai/admin/control-plane/agents', payload);
    return res.data;
  },
  async getAgent(id: string): Promise<{ agent_definition: AiAgentControlAgentDefinition }> {
    const res = await api.get(`/ai/admin/control-plane/agents/${id}`);
    return res.data;
  },
  async updateAgent(id: string, payload: AiAgentControlAgentDefinitionInput): Promise<{
    agent_definition: AiAgentControlAgentDefinition;
    diff: Record<string, unknown>;
  }> {
    const res = await api.post(`/ai/admin/control-plane/agents/${id}`, payload);
    return res.data;
  },
  async updateAgentStatus(id: string, payload: { status: string; watching?: boolean }): Promise<{
    agent_definition: AiAgentControlAgentDefinition;
    diff: Record<string, unknown>;
  }> {
    const res = await api.post(`/ai/admin/control-plane/agents/${id}/status`, payload);
    return res.data;
  },
  async previewAgentTargeting(id: string, payload: { scope_policy_json?: Record<string, unknown> | null }): Promise<{ preview: AiAgentControlTargetingPreview }> {
    const res = await api.post(`/ai/admin/control-plane/agents/${id}/targeting-preview`, payload);
    return res.data;
  },
  // Kind-aware provider-sourced pickers (13.7 pattern): for helpdesk agents the
  // backend resolves the ticketing binding and serves status/priority/type/
  // category/entity; for SRE agents it resolves the monitoring binding and
  // serves status/severity/ack_state (enums) plus group/device/check_type
  // (catalog search). Same endpoint, same `{ options }` response shape.
  async getAgentTargetingOptions(
    id: string,
    field:
      | 'status' | 'priority' | 'type' | 'category' | 'entity'
      | 'severity' | 'ack_state' | 'group' | 'technician' | 'device' | 'check_type',
    params: { query?: string; limit?: number } = {},
    // `total` is present only when the backend knows the catalogue size cheaply.
  ): Promise<{ options: AiAgentControlRefItem[]; total?: number }> {
    const res = await api.get(`/ai/admin/control-plane/agents/${id}/targeting-options/${field}`, { params });
    return res.data;
  },
  async deleteAgent(id: string): Promise<{ deleted: boolean; id: string }> {
    const res = await api.delete(`/ai/admin/control-plane/agents/${id}`);
    return res.data;
  },
  async getEffectivePrompt(id: string): Promise<AiAgentEffectivePrompt> {
    const res = await api.get(`/ai/admin/control-plane/agents/${id}/effective-prompt`);
    return res.data;
  },
  async listSharedContextProfiles(): Promise<{ items: AiSharedContextProfile[] }> {
    const res = await api.get('/ai/admin/control-plane/shared-context-profiles');
    return res.data;
  },
  async createSharedContextProfile(payload: AiSharedContextProfileInput): Promise<{ profile: AiSharedContextProfile }> {
    const res = await api.post('/ai/admin/control-plane/shared-context-profiles', payload);
    return res.data;
  },
  async updateSharedContextProfile(id: string, payload: AiSharedContextProfileInput): Promise<{ profile: AiSharedContextProfile }> {
    const res = await api.post(`/ai/admin/control-plane/shared-context-profiles/${id}`, payload);
    return res.data;
  },
  async archiveSharedContextProfile(id: string): Promise<{ profile: AiSharedContextProfile }> {
    const res = await api.post(`/ai/admin/control-plane/shared-context-profiles/${id}/archive`);
    return res.data;
  },
  async listKnowledgeLibraries(): Promise<AiKnowledgeLibrary[]> {
    const res = await api.get('/knowledge-libraries');
    return Array.isArray(res.data) ? res.data : (res.data?.items ?? []);
  },
  async getAgentAutonomy(id: string): Promise<AiAgentControlAutonomyResult> {
    const res = await api.get(`/ai/admin/control-plane/agents/${id}/autonomy`);
    return res.data;
  },
  async setAgentAutonomy(id: string, payload: {
    actionClass: string;
    mode: 'ask_first' | 'automatic';
    confirm?: boolean;
    overrideAcknowledged?: boolean;
    overrideReason?: string | null;
  }): Promise<AiAgentControlAutonomyResult> {
    const res = await api.post(`/ai/admin/control-plane/agents/${id}/autonomy`, payload);
    return res.data;
  },
  async listRuns(params?: { limit?: number; status?: string }): Promise<{ items: AiAgentControlRunItem[] }> {
    const res = await api.get('/ai/admin/control-plane/runs', { params });
    return res.data;
  },
  async getRun(id: string): Promise<AiAgentControlRunDetail> {
    const res = await api.get(`/ai/admin/control-plane/runs/${id}`);
    return res.data;
  },
  async listActions(params?: { limit?: number; status?: string }): Promise<{ items: AiAgentControlActionRequest[] }> {
    const res = await api.get('/ai/admin/control-plane/actions', { params });
    return res.data;
  },
  async getBadges(): Promise<AiAgentControlBadgeSummary> {
    const res = await api.get('/ai/admin/control-plane/badges');
    return res.data;
  },
  async listActivity(params?: {
    agentDefinitionId?: string | null;
    from?: string | null;
    to?: string | null;
    targetRef?: string | null;
    types?: AiAgentControlActivityType[] | null;
    actorUserId?: string | null;
    status?: string | null;
    limit?: number;
    cursor?: string | null;
  }): Promise<AiAgentControlActivityResult> {
    const res = await api.get('/ai/admin/control-plane/activity', {
      params: {
        ...params,
        types: params?.types?.join(','),
      },
    });
    return res.data;
  },
  async getHelpdeskEvaluationDaily(params?: { days?: number; agentDefinitionId?: string }): Promise<AiAgentControlEvaluationDailyResult> {
    const res = await api.get('/ai/admin/control-plane/helpdesk/evaluation/daily', { params });
    return res.data;
  },
  async getQueueOverview(params?: { limit?: number }): Promise<AiAgentControlQueueOverview> {
    const res = await api.get('/ai/admin/control-plane/queue', { params });
    return res.data;
  },
  async getHelpdeskWorkItemContext(id: string): Promise<AiAgentControlHelpdeskContextResult> {
    const res = await api.get(`/ai/admin/control-plane/queue/work-items/${id}/helpdesk-context`);
    return res.data;
  },
  async runMockTriage(payload?: {
    alert_id?: string;
    ticket_id?: string;
    include_directory?: boolean;
  }): Promise<AiAgentControlMockTriageResult> {
    const res = await api.post('/ai/admin/control-plane/uat/mock-triage', payload ?? {}, { timeout: 600_000 });
    return res.data;
  },
  async listTicketingReadTargets(providerKey: string): Promise<AiAgentControlTicketingReadTargetsResult> {
    const res = await api.get('/ai/admin/control-plane/uat/ticketing-read/targets', {
      params: { provider_key: providerKey },
    });
    return res.data;
  },
  async runTicketingRead(payload: { provider_key: string; target_key?: string }): Promise<AiAgentControlTicketingReadResult> {
    const res = await api.post('/ai/admin/control-plane/uat/ticketing-read', payload);
    return res.data;
  },
  async runTicketingTriage(payload: { work_item_id?: string; provider_key?: string; target_key?: string; agent_definition_id: string }): Promise<AiAgentControlTicketingTriageResult> {
    const res = await api.post('/ai/admin/control-plane/uat/ticketing-triage', payload, { timeout: 600_000 });
    return res.data;
  },
  async pollHelpdeskTicketingIngestion(): Promise<AiAgentControlHelpdeskIngestionPollResult> {
    const res = await api.post('/ai/admin/control-plane/helpdesk/ticketing-ingestion/poll', {}, { timeout: 600_000 });
    return res.data;
  },
  // Manual "check for new alerts" for every SRE agent of the tenant. Long
  // timeout: pass 2 may run diagnoses under the backend's ~210s cycle budget.
  async pollSreMonitoringIngestion(): Promise<AiAgentControlMonitoringIngestionPollResult> {
    const res = await api.post('/ai/admin/control-plane/sre/monitoring-ingestion/poll', {}, { timeout: 600_000 });
    return res.data;
  },
  // Manual "test on an alert" for one SRE agent: enqueues (or reuses) a work
  // item for the alert and runs the full diagnosis pipeline synchronously.
  async testAgentMonitoringDiagnosis(
    id: string,
    payload: { alert_id: string },
  ): Promise<AiAgentControlMonitoringDiagnosisResult> {
    const res = await api.post(`/ai/admin/control-plane/agents/${id}/monitoring-diagnosis/test`, payload, { timeout: 600_000 });
    return res.data;
  },
  // Stored diagnoses for one watched monitoring target (newest first) — the
  // alert dossier the Monitor tab expands.
  async listAgentMonitoringAlertDiagnoses(
    id: string,
    targetRef: string,
  ): Promise<{ diagnoses: AiAgentControlMonitoringAlertDiagnosis[] }> {
    const res = await api.get(`/ai/admin/control-plane/agents/${id}/monitoring-alerts/${encodeURIComponent(targetRef)}/diagnoses`);
    return res.data;
  },
  async createHelpdeskEmergencyPause(payload: { reason: string; expires_in_minutes?: number | null }): Promise<AiAgentControlEmergencyPause> {
    const res = await api.post('/ai/admin/control-plane/helpdesk/emergency-pause', payload);
    return res.data;
  },
  async revokeHelpdeskEmergencyPause(id: string): Promise<AiAgentControlEmergencyPause> {
    const res = await api.post(`/ai/admin/control-plane/helpdesk/emergency-pause/${id}/revoke`, {});
    return res.data;
  },
  async createEmergencyPause(payload: {
    scope: 'tenant' | 'agent';
    agent_definition_id?: string | null;
    reason: string;
    expires_in_minutes?: number | null;
  }): Promise<AiAgentControlEmergencyPause> {
    const res = await api.post('/ai/admin/control-plane/emergency-pause', payload);
    return res.data;
  },
  async revokeEmergencyPause(id: string): Promise<AiAgentControlEmergencyPause> {
    const res = await api.post(`/ai/admin/control-plane/emergency-pause/${id}/revoke`, {});
    return res.data;
  },
  async approveAction(id: string, payload?: { execute?: boolean; reason?: string | null }): Promise<{
    action: AiAgentControlActionRequest;
    approval: AiAgentControlApproval;
    execution: unknown;
    detail: AiAgentControlRunDetail | null;
    execution_mode?: AiAgentControlExecutionMode;
  }> {
    const res = await api.post(`/ai/admin/control-plane/actions/${id}/approve`, payload ?? { execute: true });
    return res.data;
  },
  async approveActionsBulk(payload: { action_request_ids: string[]; execute?: boolean; reason?: string | null }): Promise<AiAgentControlBulkApproveResult> {
    const res = await api.post('/ai/admin/control-plane/actions/approve', payload);
    return res.data;
  },
  async rejectAction(id: string, payload?: { reason?: string }): Promise<{
    action: AiAgentControlActionRequest;
    approval: AiAgentControlApproval;
    detail: AiAgentControlRunDetail | null;
  }> {
    const res = await api.post(`/ai/admin/control-plane/actions/${id}/reject`, payload ?? {});
    return res.data;
  },
  // Clear one "Needs attention" row for good. Idempotent server-side: a second
  // call keeps the first acknowledgement and reports `already: true`.
  async acknowledgeAttention(kind: 'action' | 'work-item', id: string): Promise<{
    kind: 'action' | 'work_item';
    id: string;
    already: boolean;
    acknowledged_at: string | null;
  }> {
    const res = await api.post(`/ai/admin/control-plane/queue/attention/${kind}/${id}/acknowledge`, {});
    return res.data;
  },
  // The whole "Needs attention" backlog, not just the page the client fetched.
  async getAttentionSummary(params?: { agent_definition_id?: string | null }): Promise<AiAgentControlAttentionSummary> {
    const res = await api.get('/ai/admin/control-plane/queue/attention/summary', {
      params: params?.agent_definition_id ? { agent_definition_id: params.agent_definition_id } : {},
    });
    return res.data;
  },
  // Server-side: stamps every row that needs attention (optionally one agent's).
  async acknowledgeAllAttention(body?: { agent_definition_id?: string | null }): Promise<{
    acknowledged_actions: number;
    acknowledged_work_items: number;
    total: number;
  }> {
    const res = await api.post('/ai/admin/control-plane/queue/attention/acknowledge-all', {
      agent_definition_id: body?.agent_definition_id ?? null,
    });
    return res.data;
  },
  async dismissAction(id: string, payload?: { reason?: string }): Promise<{
    action: AiAgentControlActionRequest;
    approval: AiAgentControlApproval;
    detail: AiAgentControlRunDetail | null;
  }> {
    const res = await api.post(`/ai/admin/control-plane/actions/${id}/dismiss`, payload ?? {});
    return res.data;
  },
};

export type EntitySearchResult = {
  entity_type: string;
  id: string;
  ref: string | null;
  label: string | null;
};

export const aiSearchApi = {
  async searchEntities(
    q: string,
    opts?: { entityTypes?: string[]; signal?: AbortSignal },
  ): Promise<EntitySearchResult[]> {
    const trimmed = q.trim();
    const entityTypes = opts?.entityTypes ?? [];
    const hasEntityTypeNarrow = entityTypes.length > 0;
    if (!trimmed && !hasEntityTypeNarrow) return [];
    const params: Record<string, string> = { q: trimmed };
    if (hasEntityTypeNarrow) {
      params.entity_types = entityTypes.join(',');
    }
    const res = await api.get('/ai/search/entities', { params, signal: opts?.signal });
    return Array.isArray(res.data?.items) ? res.data.items : [];
  },
};

export const aiKeysApi = {
  async create(params: { label: string; expires_at?: string }): Promise<{ key: string; record: AiApiKeyRecord }> {
    const res = await api.post('/ai/keys', params);
    return res.data;
  },
  async list(): Promise<AiApiKeyRecord[]> {
    const res = await api.get('/ai/keys');
    return res.data;
  },
  async revoke(id: string): Promise<AiApiKeyRecord> {
    const res = await api.delete(`/ai/keys/${id}`);
    return res.data;
  },
  async adminList(): Promise<AiApiKeyRecord[]> {
    const res = await api.get('/ai/admin/keys');
    return res.data;
  },
  async adminRevoke(id: string): Promise<AiApiKeyRecord> {
    const res = await api.delete(`/ai/admin/keys/${id}`);
    return res.data;
  },
};
