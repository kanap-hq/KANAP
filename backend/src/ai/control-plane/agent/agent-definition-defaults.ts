import {
  TICKETING_ASSIGNMENT_UPDATE_APPROVED_CAPABILITY,
  TICKETING_ASSIGNMENT_UPDATE_PREPARE_CAPABILITY,
  TICKETING_CLASSIFICATION_UPDATE_APPROVED_CAPABILITY,
  TICKETING_CLASSIFICATION_UPDATE_PREPARE_CAPABILITY,
  TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY,
  TICKETING_INTERNAL_NOTE_PREPARE_CAPABILITY,
  TICKETING_CLASSIFICATION_CONTEXT_CAPABILITY,
  TICKETING_LIFECYCLE_CONTEXT_CAPABILITY,
  TICKETING_PARTICIPANT_CONTEXT_CAPABILITY,
  TICKETING_PARTICIPANT_UPDATE_APPROVED_CAPABILITY,
  TICKETING_PARTICIPANT_UPDATE_PREPARE_CAPABILITY,
  TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY,
  TICKETING_PUBLIC_REPLY_PREPARE_CAPABILITY,
  TICKETING_ROUTING_CONTEXT_CAPABILITY,
  TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY,
  TICKETING_STATUS_UPDATE_PREPARE_CAPABILITY,
} from '../capability/capability-contract';
import { DEFAULT_TICKET_ACTOR_ROLE } from '../providers/provider.types';
import { normalizeServiceDeskScopePolicy } from './service-desk-targeting';

const DEFAULT_LEASE_TTL_SECONDS = 5 * 60;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_COOLDOWN_SECONDS = 60;
const DEFAULT_PER_RUN_TOKEN_CAP = 40_000;
const DEFAULT_PER_RUN_COST_CAP_EUR = 1;
const DEFAULT_DAILY_RUN_CAP = 25;
const DEFAULT_DAILY_TOKEN_CAP = 500_000;
const DEFAULT_DAILY_COST_CAP_EUR = 10;
const DEFAULT_REVIEW_COOLDOWN_SECONDS = 24 * 60 * 60;
const DEFAULT_APPROVAL_TTL_SECONDS = 24 * 60 * 60;

function defaultEconomicGuardrails(): Record<string, unknown> {
  return {
    configured: true,
    per_run: {
      max_estimated_tokens: DEFAULT_PER_RUN_TOKEN_CAP,
      max_estimated_cost_eur: DEFAULT_PER_RUN_COST_CAP_EUR,
    },
    daily: {
      max_agent_runs: DEFAULT_DAILY_RUN_CAP,
      max_estimated_tokens: DEFAULT_DAILY_TOKEN_CAP,
      max_estimated_cost_eur: DEFAULT_DAILY_COST_CAP_EUR,
    },
  };
}

export const HELP_DESK_ALLOWED_CAPABILITIES = [
  { name: 'ticketing.ticket.get', version: '1.0.0', effect: 'read', max_autonomy_level: 'A1' },
  { name: TICKETING_CLASSIFICATION_CONTEXT_CAPABILITY, version: '1.0.0', effect: 'read', max_autonomy_level: 'A1' },
  { name: TICKETING_LIFECYCLE_CONTEXT_CAPABILITY, version: '1.0.0', effect: 'read', max_autonomy_level: 'A1' },
  { name: TICKETING_ROUTING_CONTEXT_CAPABILITY, version: '1.0.0', effect: 'read', max_autonomy_level: 'A1' },
  { name: TICKETING_PARTICIPANT_CONTEXT_CAPABILITY, version: '1.0.0', effect: 'read', max_autonomy_level: 'A1' },
  { name: 'search_knowledge', version: '1.0.0', effect: 'read', max_autonomy_level: 'A1' },
  { name: 'get_document', version: '1.0.0', effect: 'read', max_autonomy_level: 'A1' },
  { name: 'web_search', version: '1.0.0', effect: 'read', max_autonomy_level: 'A1' },
  { name: TICKETING_INTERNAL_NOTE_PREPARE_CAPABILITY, version: '1.0.0', effect: 'propose', max_autonomy_level: 'A2' },
  { name: TICKETING_PUBLIC_REPLY_PREPARE_CAPABILITY, version: '1.0.0', effect: 'propose', max_autonomy_level: 'A2' },
  { name: TICKETING_CLASSIFICATION_UPDATE_PREPARE_CAPABILITY, version: '1.0.0', effect: 'propose', max_autonomy_level: 'A2' },
  { name: TICKETING_STATUS_UPDATE_PREPARE_CAPABILITY, version: '1.0.0', effect: 'propose', max_autonomy_level: 'A2' },
  { name: TICKETING_ASSIGNMENT_UPDATE_PREPARE_CAPABILITY, version: '1.0.0', effect: 'propose', max_autonomy_level: 'A2' },
  { name: TICKETING_PARTICIPANT_UPDATE_PREPARE_CAPABILITY, version: '1.0.0', effect: 'propose', max_autonomy_level: 'A2' },
  {
    name: TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY,
    version: '1.0.0',
    effect: 'write',
    max_autonomy_level: 'A3',
    approval: 'human',
  },
  {
    name: TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY,
    version: '1.0.0',
    effect: 'write',
    max_autonomy_level: 'A3',
    approval: 'human',
  },
  {
    name: TICKETING_CLASSIFICATION_UPDATE_APPROVED_CAPABILITY,
    version: '1.0.0',
    effect: 'write',
    max_autonomy_level: 'A3',
    approval: 'human',
  },
  {
    name: TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY,
    version: '1.0.0',
    effect: 'write',
    max_autonomy_level: 'A3',
    approval: 'human',
  },
  {
    name: TICKETING_ASSIGNMENT_UPDATE_APPROVED_CAPABILITY,
    version: '1.0.0',
    effect: 'write',
    max_autonomy_level: 'A3',
    approval: 'human',
  },
  {
    name: TICKETING_PARTICIPANT_UPDATE_APPROVED_CAPABILITY,
    version: '1.0.0',
    effect: 'write',
    max_autonomy_level: 'A3',
    approval: 'human',
  },
];

export const HELP_DESK_FORBIDDEN_CAPABILITIES = [
  'ticketing.ticket.close',
  'ticketing.ticket.delete',
  'ticketing.ticket.bulk_update',
  'ticketing.ticket.public_reply.auto_execute',
  'automation.job.launch_approved',
  'external_mcp.*',
  'production_a4',
];

// Read-only set for SRE agents: knowledge/web retrieval plus the monitoring
// provider reads the diagnosis runtime dispatches (WS-A6/WS-A8).
export const SRE_MONITORING_ALLOWED_CAPABILITIES = [
  { name: 'monitoring.alert.get', version: '1.0.0', effect: 'read', max_autonomy_level: 'A1' },
  { name: 'monitoring.sensor.history', version: '1.0.0', effect: 'read', max_autonomy_level: 'A1' },
  // WS-A8 evidence-chain reads: current check state + same-device related alerts,
  // dispatched by the diagnosis runtime so the whole chain is audited.
  { name: 'monitoring.state.get', version: '1.0.0', effect: 'read', max_autonomy_level: 'A1' },
  { name: 'monitoring.alert.related.list', version: '1.0.0', effect: 'read', max_autonomy_level: 'A1' },
  // Device context read (host address) so the KANAP asset correlation can apply
  // the documented IP-equality tiebreak on ambiguous device names (§4.5).
  { name: 'monitoring.object.get', version: '1.0.0', effect: 'read', max_autonomy_level: 'A1' },
  { name: 'search_knowledge', version: '1.0.0', effect: 'read', max_autonomy_level: 'A1' },
  { name: 'get_document', version: '1.0.0', effect: 'read', max_autonomy_level: 'A1' },
  { name: 'web_search', version: '1.0.0', effect: 'read', max_autonomy_level: 'A1' },
];

export const SRE_MONITORING_FORBIDDEN_CAPABILITIES = [
  'automation.job.launch_approved',
  'external_mcp.*',
  'production_a4',
];

export type HelpdeskAgentDefaults = {
  environment: 'sandbox';
  provider_bindings_json: Record<string, unknown>;
  allowed_capabilities_json: typeof HELP_DESK_ALLOWED_CAPABILITIES;
  forbidden_capabilities_json: typeof HELP_DESK_FORBIDDEN_CAPABILITIES;
  max_autonomy_level: 'A3';
  default_approval_requirement: 'human_for_writes';
  agent_priority: number;
  trigger_policy_json: Record<string, unknown>;
  scope_policy_json: Record<string, unknown>;
  queue_policy_json: Record<string, unknown>;
  response_policy_json: Record<string, unknown>;
  evaluation_policy_json: Record<string, unknown>;
};

export type SreAgentDefaults = {
  environment: 'sandbox';
  provider_bindings_json: Record<string, unknown>;
  allowed_capabilities_json: typeof SRE_MONITORING_ALLOWED_CAPABILITIES;
  forbidden_capabilities_json: typeof SRE_MONITORING_FORBIDDEN_CAPABILITIES;
  max_autonomy_level: 'A1';
  default_approval_requirement: 'human_for_writes';
  agent_priority: number;
  trigger_policy_json: Record<string, unknown>;
  scope_policy_json: Record<string, unknown>;
  queue_policy_json: Record<string, unknown>;
  response_policy_json: Record<string, unknown>;
  evaluation_policy_json: Record<string, unknown>;
};

export function helpdeskAgentDefaults(input: { ticketingProviderKey: string }): HelpdeskAgentDefaults {
  const ticketingProviderKey = input.ticketingProviderKey;
  return {
    environment: 'sandbox',
    provider_bindings_json: {
      ticketing: {
        provider_kind: 'ticketing',
        provider_key: ticketingProviderKey,
      },
    },
    allowed_capabilities_json: HELP_DESK_ALLOWED_CAPABILITIES,
    forbidden_capabilities_json: HELP_DESK_FORBIDDEN_CAPABILITIES,
    max_autonomy_level: 'A3',
    default_approval_requirement: 'human_for_writes',
    agent_priority: 100,
    trigger_policy_json: {
      manual_safe_target: { enabled: true },
      scheduled_poll: { enabled: false },
      saved_filter: { enabled: false },
      provider_webhook: { enabled: false },
      ticket_update: { enabled: false },
      production_polling_enabled: false,
      automatic_writes_enabled: false,
    },
    scope_policy_json: normalizeServiceDeskScopePolicy({
      mode: 'manual_safe_target',
      allowed_modes: ['manual_safe_target', 'new_tickets_only', 'new_plus_agent_touched', 'saved_filter'],
      provider_kind: 'ticketing',
      provider_key: ticketingProviderKey,
      target_kind: 'ticket',
      required_safe_target_effect: 'read',
      new_tickets_only: { enabled: false },
      new_plus_agent_touched: { enabled: false },
      saved_filter: { enabled: false },
      all_matching: { enabled: false },
      freeform_live_object_ids: false,
      knowledge_sources: {
        knowledge: { enabled: true, all_libraries: false, library_ids: [] },
        web: { enabled: false },
        precedence: 'knowledge_first',
      },
      // The helper only returns null for a null input; this literal is never null.
    }) ?? {},
    queue_policy_json: {
      enabled: true,
      dedup_mode: 'active_work_item',
      lease_ttl_seconds: DEFAULT_LEASE_TTL_SECONDS,
      max_attempts: DEFAULT_MAX_ATTEMPTS,
      cooldown_seconds: DEFAULT_COOLDOWN_SECONDS,
      review_cooldown_seconds: DEFAULT_REVIEW_COOLDOWN_SECONDS,
      on_conflict: 'defer',
      approval_ttl_seconds: DEFAULT_APPROVAL_TTL_SECONDS,
      on_stale_by_action_class: {
        public_reply: 're_review',
        internal_note: 're_review',
        classification: 're_review',
        status: 're_review',
      },
      retry_backoff_seconds: [60, 300, 900],
      terminal_statuses: ['completed', 'dead_letter'],
      economic_guardrails: defaultEconomicGuardrails(),
    },
    response_policy_json: {
      prepare_internal_note: true,
      prepare_public_reply: true,
      prepare_classification_update: true,
      prepare_status_update: true,
      prepare_assignment_update: true,
      prepare_participant_update: false,
      ticket_actor_role: DEFAULT_TICKET_ACTOR_ROLE,
      automatic_public_reply: false,
      automatic_ticket_updates: false,
      require_human_approval_for_writes: true,
    },
    evaluation_policy_json: {
      create_pending_evaluation: true,
      feedback_required_for_autonomy_promotion: true,
    },
  };
}

export function sreAgentDefaults(input: { monitoringProviderKey?: string | null }): SreAgentDefaults {
  const monitoringProviderKey = typeof input.monitoringProviderKey === 'string' && input.monitoringProviderKey.trim()
    ? input.monitoringProviderKey.trim()
    : null;
  return {
    environment: 'sandbox',
    provider_bindings_json: monitoringProviderKey
      ? {
        monitoring: {
          provider_kind: 'monitoring',
          provider_key: monitoringProviderKey,
        },
      }
      : {},
    allowed_capabilities_json: SRE_MONITORING_ALLOWED_CAPABILITIES,
    forbidden_capabilities_json: SRE_MONITORING_FORBIDDEN_CAPABILITIES,
    max_autonomy_level: 'A1',
    default_approval_requirement: 'human_for_writes',
    agent_priority: 100,
    trigger_policy_json: {
      scheduled_poll: { enabled: false },
      provider_webhook: { enabled: false },
      production_polling_enabled: false,
      automatic_writes_enabled: false,
    },
    scope_policy_json: {
      knowledge_sources: {
        knowledge: { enabled: true, all_libraries: false, library_ids: [] },
        web: { enabled: false },
        precedence: 'knowledge_first',
        kanap_data: {
          enabled: true,
          domains: {
            applications: true,
            assets: true,
            interfaces: true,
            connections: true,
            locations: true,
          },
        },
      },
      // Inert placeholder until targeting is configured: an empty predicate list
      // round-trips unchanged through the scope-policy normalizers used by the
      // agent update path.
      targeting: { schema_version: 1, combinator: 'and', predicates: [] },
    },
    queue_policy_json: {
      enabled: true,
      dedup_mode: 'active_work_item',
      lease_ttl_seconds: DEFAULT_LEASE_TTL_SECONDS,
      max_attempts: DEFAULT_MAX_ATTEMPTS,
      cooldown_seconds: DEFAULT_COOLDOWN_SECONDS,
      review_cooldown_seconds: DEFAULT_REVIEW_COOLDOWN_SECONDS,
      on_conflict: 'defer',
      approval_ttl_seconds: DEFAULT_APPROVAL_TTL_SECONDS,
      retry_backoff_seconds: [60, 300, 900],
      terminal_statuses: ['completed', 'dead_letter'],
      economic_guardrails: defaultEconomicGuardrails(),
    },
    response_policy_json: {
      require_human_approval_for_writes: true,
    },
    evaluation_policy_json: {
      create_pending_evaluation: true,
      feedback_required_for_autonomy_promotion: true,
    },
  };
}
