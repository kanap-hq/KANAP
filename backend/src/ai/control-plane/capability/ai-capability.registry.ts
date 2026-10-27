import { classificationDriftSnapshot } from '../providers/ticket-classification';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { In } from 'typeorm';
import { z } from 'zod';
import { legacyFlattenError } from '../../../common/zod-error';
import { KnowledgeService } from '../../../knowledge/knowledge.service';
import { BraveSearchResult, BraveSearchService } from '../../web-search/brave-search.service';
import { AiEntityService } from '../../ai-entity.service';
import { AiMutationPreviewService } from '../../ai-mutation-preview.service';
import { AiPolicyService } from '../../ai-policy.service';
import { AiQueryExecutor } from '../../query/ai-query.executor';
import { AiToolRegistry } from '../../ai-tool.registry';
import {
  AiDocumentDto,
  AiExecutionContextWithManager,
  AiKnowledgeSearchResultDto,
  AiToolListItemDto,
} from '../../ai.types';
import { AiProviderToolDef } from '../../providers/ai-provider.types';
import { AiActionRequestService } from '../action-request/ai-action-request.service';
import {
  AiAgentWorkQueueService,
  DEFAULT_APPROVAL_TTL_SECONDS,
  MAX_APPROVAL_TTL_SECONDS,
  MIN_APPROVAL_TTL_SECONDS,
} from '../agent/ai-agent-work-queue.service';
import { AiApprovalService } from '../approval/ai-approval.service';
import { AiAutomationJobCatalogService } from '../automation/ai-automation-job-catalog.service';
import { AiActionRequest } from '../entities/ai-action-request.entity';
import { AiAgentDefinition } from '../entities/ai-agent-definition.entity';
import { AiExternalMcpBridgeService } from '../mcp/ai-external-mcp-bridge.service';
import { AiProviderRegistryService } from '../providers/provider-registry.service';
import { MAX_INTERNAL_NOTE_CHARS, MAX_PUBLIC_REPLY_CHARS, noteBodyIsUnsafe } from '../providers/ticket-safety';
import {
  AUTOMATION_JOB_ALLOWED_LIST_CAPABILITY,
  AUTOMATION_JOB_DRY_RUN_CAPABILITY,
  AUTOMATION_JOB_LAUNCH_APPROVED_CAPABILITY,
  AUTOMATION_JOB_LAUNCH_PREPARE_CAPABILITY,
  AUTOMATION_JOB_OUTPUT_GET_CAPABILITY,
  AUTOMATION_JOB_SCHEMA_GET_CAPABILITY,
  AUTOMATION_JOB_STATUS_GET_CAPABILITY,
  AUTOMATION_PROVIDER_CAPABILITY_VERSION,
  CapabilityContract,
  CapabilityContractSchema,
  CapabilityExecutionContext,
  CapabilityProviderKind,
  CapabilitySurface,
  EXECUTE_APPROVED_PREVIEW_CAPABILITY,
  TICKETING_CLASSIFICATION_CONTEXT_CAPABILITY,
  TICKETING_CLASSIFICATION_UPDATE_APPROVED_CAPABILITY,
  TICKETING_CLASSIFICATION_UPDATE_PREPARE_CAPABILITY,
  TICKETING_ASSIGNMENT_UPDATE_APPROVED_CAPABILITY,
  TICKETING_ASSIGNMENT_UPDATE_PREPARE_CAPABILITY,
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
} from './capability-contract';
import {
  AdapterResult,
  AutomationLaunchActionPayload,
  DEFAULT_TICKET_ACTOR_ROLE,
  TicketActorRole,
  ticketActorRoleFromResponsePolicy,
  TicketAssignmentUpdateActionPayload,
  TicketClassificationUpdateActionPayload,
  TicketInternalNoteActionPayload,
  TicketInternalNoteWriteResult,
  TicketNote,
  TicketParticipantUpdateActionPayload,
  TicketPublicReplyActionPayload,
  TicketPublicReplyWriteResult,
  TicketRecord,
  TicketProviderActionWriteResult,
  TicketRoutingTarget,
  TicketStatusUpdateActionPayload,
  TicketingProvider,
} from '../providers/provider.types';
import { isRecord } from '../../../common/object-guards';

const COMPATIBILITY_CAPABILITY_VERSION = '1.0.0';
const PROVIDER_CAPABILITY_VERSION = '1.0.0';
export { EXECUTE_APPROVED_PREVIEW_CAPABILITY } from './capability-contract';

const ExecuteApprovedPreviewInputSchema = z.object({
  preview_ids: z.array(z.string().trim().uuid()).min(1).max(50),
});

const InternalKnowledgeSearchInputSchema = z.object({
  query: z.string().trim().min(1),
  offset: z.number().int().min(0).max(5000).default(0),
  limit: z.number().int().min(1).max(200).default(100),
  // Optional allow-list of library ids; intersected with the caller's accessible libraries.
  library_ids: z.array(z.string().trim().uuid()).max(50).optional(),
}).strict();

const InternalKnowledgeDocumentInputSchema = z.object({
  document_id: z.string().trim().min(1),
}).strict();

const InternalWebSearchInputSchema = z.object({
  query: z.string().trim().min(1),
  count: z.number().int().min(1).max(10).default(5),
}).strict();

// The five KANAP entity families the agent runtime may read for context enrichment
// (plan 37 §4.5). Mirrored one-to-one by the kanap_data domain toggles in the per-agent
// retrieval-source policy (scope_policy_json.knowledge_sources.kanap_data.domains).
export const KANAP_ENTITY_FAMILIES = ['applications', 'assets', 'interfaces', 'connections', 'locations'] as const;
export type KanapEntityFamily = (typeof KANAP_ENTITY_FAMILIES)[number];

// Context lookups are restricted to AI_CONTEXT_ENTITY_TYPES ∩ KANAP_ENTITY_FAMILIES:
// AiEntityService.getEntityContext does not support interfaces/connections/locations.
export const KANAP_CONTEXT_ENTITY_FAMILIES = ['applications', 'assets'] as const;

export const KANAP_ENTITY_SEARCH_CAPABILITY = 'kanap.entity.search';
export const KANAP_ENTITY_DETAIL_CAPABILITY = 'kanap.entity.detail';
export const KANAP_ENTITY_CONTEXT_CAPABILITY = 'kanap.entity.context';

const InternalEntitySearchInputSchema = z.object({
  entity_type: z.enum(KANAP_ENTITY_FAMILIES),
  q: z.string().trim().min(1),
  limit: z.number().int().min(1).max(10).default(5),
}).strict();

const InternalEntityDetailInputSchema = z.object({
  entity_type: z.enum(KANAP_ENTITY_FAMILIES),
  // Accepts a UUID, a short ref or an entity name; AiQueryExecutor.executeDetail
  // resolves non-UUID values via resolveDetailEntityId.
  entity_id: z.string().trim().min(1),
}).strict();

const InternalEntityContextInputSchema = z.object({
  entity_type: z.enum(KANAP_CONTEXT_ENTITY_FAMILIES),
  entity_id: z.string().trim().min(1),
}).strict();

// Bounds for the field-projected entity detail payload (see compactEntityDetailData).
const MAX_ENTITY_DETAIL_FIELDS = 80;
const MAX_ENTITY_DETAIL_STRING_CHARS = 600;
const MAX_ENTITY_DETAIL_LIST_ITEMS = 20;
const MAX_ENTITY_CONTEXT_GROUPS = 12;
const MAX_ENTITY_CONTEXT_GROUP_ITEMS = 25;

const TICKETING_EXECUTION_PHASES = {
  classification: 10,
  internal_note: 20,
  public_reply: 30,
  assignment: 40,
  participant: 50,
  status: 60,
} as const;
const TICKETING_TERMINAL_TRANSITIONS = new Set(['solved', 'closed']);
const HELPDESK_TRIAGE_RETRY_AFTER_STATUSES = ['expired', 'failed', 'rejected', 'executed'];
type ProviderActionForExecution = Awaited<ReturnType<AiActionRequestService['findProviderActionForExecution']>>;

const PrepareInternalNoteInputSchema = z.object({
  ticket_id: z.string().trim().min(1).max(128),
  note_body: z.string().trim().min(1).max(MAX_INTERNAL_NOTE_CHARS),
  provider_key: z.string().trim().min(1).max(128).optional(),
  evidence_ids: z.array(z.string().trim().min(1)).max(100).optional(),
  observation_id: z.string().trim().min(1).optional(),
  recommendation_id: z.string().trim().min(1).optional(),
  decision_id: z.string().trim().min(1).optional(),
  evaluation_id: z.string().trim().min(1).optional(),
}).strict();

const AddApprovedInternalNoteInputSchema = z.object({
  action_request_id: z.string().trim().uuid(),
}).strict();

const PreparePublicReplyInputSchema = z.object({
  ticket_id: z.string().trim().min(1).max(128),
  reply_body: z.string().trim().min(1).max(MAX_PUBLIC_REPLY_CHARS),
  provider_key: z.string().trim().min(1).max(128).optional(),
  evidence_ids: z.array(z.string().trim().min(1)).max(100).optional(),
  observation_id: z.string().trim().min(1).optional(),
  recommendation_id: z.string().trim().min(1).optional(),
  decision_id: z.string().trim().min(1).optional(),
  evaluation_id: z.string().trim().min(1).optional(),
}).strict();

const AddApprovedPublicReplyInputSchema = z.object({
  action_request_id: z.string().trim().uuid(),
}).strict();

const TicketClassificationProposalSchema = z.object({
  type: z.enum(['incident', 'request']).optional(),
  priority: z.enum(['very_low', 'low', 'medium', 'high', 'very_high', 'major']).optional(),
  urgency: z.enum(['very_low', 'low', 'medium', 'high', 'very_high', 'major']).optional(),
  impact: z.string().trim().min(1).max(128).optional(),
  category: z.string().trim().min(1).max(256).optional(),
  service: z.string().trim().min(1).max(256).optional(),
}).strict();

const PrepareClassificationUpdateInputSchema = z.object({
  ticket_id: z.string().trim().min(1).max(128),
  proposed: TicketClassificationProposalSchema,
  reason: z.string().trim().min(1).max(1000),
  provider_key: z.string().trim().min(1).max(128).optional(),
  evidence_ids: z.array(z.string().trim().min(1)).max(100).optional(),
  observation_id: z.string().trim().min(1).optional(),
  recommendation_id: z.string().trim().min(1).optional(),
  decision_id: z.string().trim().min(1).optional(),
  evaluation_id: z.string().trim().min(1).optional(),
}).strict();

const AddApprovedClassificationUpdateInputSchema = z.object({
  action_request_id: z.string().trim().uuid(),
}).strict();

const PrepareStatusUpdateInputSchema = z.object({
  ticket_id: z.string().trim().min(1).max(128),
  transition_key: z.enum(['processing_assigned', 'processing_planned', 'pending', 'escalated_l2', 'pending_user', 'solved', 'closed']),
  reason: z.string().trim().min(1).max(1000),
  provider_key: z.string().trim().min(1).max(128).optional(),
  evidence_ids: z.array(z.string().trim().min(1)).max(100).optional(),
  observation_id: z.string().trim().min(1).optional(),
  recommendation_id: z.string().trim().min(1).optional(),
  decision_id: z.string().trim().min(1).optional(),
  evaluation_id: z.string().trim().min(1).optional(),
}).strict();

const AddApprovedStatusUpdateInputSchema = z.object({
  action_request_id: z.string().trim().uuid(),
}).strict();

const TicketRoutingTargetInputSchema = z.object({
  kind: z.enum(['user', 'group']),
  key: z.string().trim().min(1).max(256),
  label: z.string().trim().min(1).max(256),
}).strict();

const PrepareAssignmentUpdateInputSchema = z.object({
  ticket_id: z.string().trim().min(1).max(128),
  target: TicketRoutingTargetInputSchema,
  reason: z.string().trim().min(1).max(1000),
  provider_key: z.string().trim().min(1).max(128).optional(),
  evidence_ids: z.array(z.string().trim().min(1)).max(100).optional(),
  observation_id: z.string().trim().min(1).optional(),
  recommendation_id: z.string().trim().min(1).optional(),
  decision_id: z.string().trim().min(1).optional(),
  evaluation_id: z.string().trim().min(1).optional(),
}).strict();

const AddApprovedAssignmentUpdateInputSchema = z.object({
  action_request_id: z.string().trim().uuid(),
}).strict();

const PrepareParticipantUpdateInputSchema = z.object({
  ticket_id: z.string().trim().min(1).max(128),
  operation: z.enum(['add_observer', 'remove_observer', 'set_observers']),
  participants: z.array(TicketRoutingTargetInputSchema).min(1).max(20),
  reason: z.string().trim().min(1).max(1000),
  provider_key: z.string().trim().min(1).max(128).optional(),
  evidence_ids: z.array(z.string().trim().min(1)).max(100).optional(),
  observation_id: z.string().trim().min(1).optional(),
  recommendation_id: z.string().trim().min(1).optional(),
  decision_id: z.string().trim().min(1).optional(),
  evaluation_id: z.string().trim().min(1).optional(),
}).strict();

const AddApprovedParticipantUpdateInputSchema = z.object({
  action_request_id: z.string().trim().uuid(),
}).strict();

const AutomationProviderKeySchema = z.string().trim().min(1).max(128).optional();
const AutomationTargetInputSchema = z.object({
  type: z.string().trim().min(1).max(64),
  values: z.array(z.string().trim().min(1).max(256)).min(1).max(50),
}).strict();
const AutomationListInputSchema = z.object({
  provider_key: AutomationProviderKeySchema,
}).strict();
const AutomationJobInputSchema = z.object({
  provider_key: AutomationProviderKeySchema,
  job_key: z.string().trim().min(1).max(128),
}).strict();
const AutomationDryRunInputSchema = z.object({
  provider_key: AutomationProviderKeySchema,
  job_key: z.string().trim().min(1).max(128),
  target: AutomationTargetInputSchema,
  variables: z.record(z.string(), z.unknown()).default({}),
}).strict();
const AutomationLaunchPrepareInputSchema = z.object({
  provider_key: AutomationProviderKeySchema,
  job_key: z.string().trim().min(1).max(128),
  target: AutomationTargetInputSchema,
  variables: z.record(z.string(), z.unknown()).default({}),
  evidence_ids: z.array(z.string().trim().min(1)).max(100).optional(),
  recommendation_id: z.string().trim().min(1).optional(),
  decision_id: z.string().trim().min(1).optional(),
  evaluation_id: z.string().trim().min(1).optional(),
}).strict();
const AutomationLaunchApprovedInputSchema = z.object({
  action_request_id: z.string().trim().uuid(),
}).strict();
const AutomationJobRunInputSchema = z.object({
  action_request_id: z.string().trim().uuid(),
  job_run_id: z.string().trim().min(1).max(256).optional(),
}).strict();

type CapabilityHandler = (
  context: AiExecutionContextWithManager,
  input: unknown,
  execution: CapabilityExecutionContext,
) => Promise<unknown>;

export type ResolvedCapability = {
  contract: CapabilityContract;
  handler: CapabilityHandler;
};

function toCapabilitySurface(surface: string): CapabilitySurface {
  if (surface === 'chat' || surface === 'mcp' || surface === 'scheduler' || surface === 'alert' || surface === 'internal') {
    return surface;
  }
  throw new BadRequestException(`Unsupported capability surface: ${surface}`);
}

function compatibilityContract(
  tool: AiToolListItemDto,
  inputSchema: Record<string, unknown>,
): CapabilityContract {
  const effect = tool.read_only ? 'read' : 'propose';
  const riskLevel = tool.read_only ? 'low' : 'medium';
  const mcpEnabled = tool.read_only && tool.surfaces.includes('mcp');
  return CapabilityContractSchema.parse({
    name: tool.name,
    version: COMPATIBILITY_CAPABILITY_VERSION,
    description: tool.description,
    category: tool.category,
    provider_kind: 'kanap_domain' satisfies CapabilityProviderKind,
    supported_surfaces: tool.surfaces.map(toCapabilitySurface),
    input_schema: inputSchema,
    output_schema: { type: 'object' },
    effect,
    risk_level: riskLevel,
    max_autonomy_level: tool.read_only ? 'A1' : 'A2',
    default_approval: 'none',
    approval_strategy: { mode: 'none' },
    evidence: {
      persist_input: false,
      persist_output: tool.read_only,
      redact_fields: [],
      retention: tool.read_only ? 'standard' : 'audit',
    },
    tenant_permissions: ['ai.surface'],
    business_resources: tool.write_preview?.entity_type ? [tool.write_preview.entity_type] : [],
    timeout_seconds: tool.read_only ? 30 : 60,
    retry_policy: { automatic_retry: false, max_attempts: 1 },
    idempotency: { mode: tool.read_only ? 'idempotent' : 'non_idempotent', key_fields: tool.read_only ? ['input'] : undefined },
    rollback: { supported: tool.write_preview?.reversible === true },
    cost: { estimated_unit_cost: null, metered: false },
    redaction_policy: { fields: [] },
    mcp_exposure: { enabled: mcpEnabled, read_only: mcpEnabled },
    live_test_safety: tool.read_only ? 'live_read' : 'live_write_gated',
    compatibility: { ai_tool_name: tool.name },
  });
}

function internalExecuteApprovedPreviewContract(): CapabilityContract {
  return CapabilityContractSchema.parse({
    name: EXECUTE_APPROVED_PREVIEW_CAPABILITY,
    version: '1.0.0',
    description: 'Execute one or more approved KANAP mutation previews.',
    category: 'mutation',
    provider_kind: 'kanap_domain',
    supported_surfaces: ['internal'],
    input_schema: {
      type: 'object',
      properties: {
        preview_ids: {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
          minItems: 1,
          maxItems: 50,
        },
      },
      required: ['preview_ids'],
      additionalProperties: false,
    },
    output_schema: { type: 'object' },
    effect: 'write',
    risk_level: 'medium',
    max_autonomy_level: 'A3',
    default_approval: 'human',
    approval_strategy: { mode: 'mutation_preview' },
    evidence: {
      persist_input: true,
      persist_output: true,
      redact_fields: [],
      retention: 'audit',
    },
    tenant_permissions: ['ai.write'],
    business_resources: ['mutation_previews'],
    timeout_seconds: 120,
    retry_policy: { automatic_retry: false, max_attempts: 1 },
    idempotency: { mode: 'idempotent', key_fields: ['preview_ids'] },
    rollback: { supported: false },
    cost: { estimated_unit_cost: null, metered: false },
    redaction_policy: { fields: [] },
    mcp_exposure: { enabled: false, read_only: false },
    live_test_safety: 'live_write_gated',
    compatibility: { ai_tool_name: null },
  });
}

function internalKnowledgeSearchContract(): CapabilityContract {
  return CapabilityContractSchema.parse({
    name: 'search_knowledge',
    version: COMPATIBILITY_CAPABILITY_VERSION,
    description: 'Search KANAP knowledge documents through the governed internal control-plane surface.',
    category: 'knowledge',
    provider_kind: 'kanap_domain',
    supported_surfaces: ['internal'],
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        offset: { type: 'number', minimum: 0, maximum: 5000, default: 0 },
        limit: { type: 'number', minimum: 1, maximum: 200, default: 100 },
        library_ids: { type: 'array', items: { type: 'string' }, maxItems: 50 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output_schema: { type: 'object' },
    effect: 'read',
    risk_level: 'low',
    max_autonomy_level: 'A1',
    default_approval: 'none',
    approval_strategy: { mode: 'none' },
    evidence: {
      persist_input: false,
      persist_output: true,
      redact_fields: [],
      retention: 'standard',
    },
    tenant_permissions: ['knowledge'],
    business_resources: ['knowledge'],
    timeout_seconds: 30,
    retry_policy: { automatic_retry: false, max_attempts: 1 },
    idempotency: { mode: 'idempotent', key_fields: ['query', 'offset', 'limit', 'library_ids'] },
    rollback: { supported: false },
    cost: { estimated_unit_cost: null, metered: false },
    redaction_policy: { fields: [] },
    mcp_exposure: { enabled: false, read_only: false },
    live_test_safety: 'live_read',
    compatibility: { ai_tool_name: null },
  });
}

function internalKnowledgeDocumentContract(): CapabilityContract {
  return CapabilityContractSchema.parse({
    name: 'get_document',
    version: COMPATIBILITY_CAPABILITY_VERSION,
    description: 'Read one KANAP knowledge document through the governed internal control-plane surface.',
    category: 'knowledge',
    provider_kind: 'kanap_domain',
    supported_surfaces: ['internal'],
    input_schema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', minLength: 1 },
      },
      required: ['document_id'],
      additionalProperties: false,
    },
    output_schema: { type: 'object' },
    effect: 'read',
    risk_level: 'low',
    max_autonomy_level: 'A1',
    default_approval: 'none',
    approval_strategy: { mode: 'none' },
    evidence: {
      persist_input: false,
      persist_output: true,
      redact_fields: [],
      retention: 'standard',
    },
    tenant_permissions: ['knowledge'],
    business_resources: ['knowledge'],
    timeout_seconds: 30,
    retry_policy: { automatic_retry: false, max_attempts: 1 },
    idempotency: { mode: 'idempotent', key_fields: ['document_id'] },
    rollback: { supported: false },
    cost: { estimated_unit_cost: null, metered: false },
    redaction_policy: { fields: [] },
    mcp_exposure: { enabled: false, read_only: false },
    live_test_safety: 'live_read',
    compatibility: { ai_tool_name: null },
  });
}

function internalWebSearchContract(): CapabilityContract {
  return CapabilityContractSchema.parse({
    name: 'web_search',
    version: COMPATIBILITY_CAPABILITY_VERSION,
    description: 'Search the public web for current information through the governed internal control-plane surface.',
    category: 'discovery',
    // 'web' provider kind => the dispatcher records evidence as external (lower) trust, so web
    // findings never outrank KANAP knowledge in synthesis.
    provider_kind: 'web',
    supported_surfaces: ['internal'],
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        count: { type: 'number', minimum: 1, maximum: 10, default: 5 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output_schema: { type: 'object' },
    effect: 'read',
    risk_level: 'low',
    max_autonomy_level: 'A1',
    default_approval: 'none',
    approval_strategy: { mode: 'none' },
    evidence: {
      // The query is sanitised to public-only terms before the call, but we still avoid
      // persisting the raw input; the public results are kept as evidence.
      persist_input: false,
      persist_output: true,
      redact_fields: [],
      retention: 'standard',
    },
    tenant_permissions: [],
    business_resources: ['web_search'],
    timeout_seconds: 30,
    retry_policy: { automatic_retry: false, max_attempts: 1 },
    idempotency: { mode: 'idempotent', key_fields: ['query', 'count'] },
    rollback: { supported: false },
    cost: { estimated_unit_cost: null, metered: false },
    redaction_policy: { fields: [] },
    mcp_exposure: { enabled: false, read_only: false },
    live_test_safety: 'live_read',
    compatibility: { ai_tool_name: null },
  });
}

// Shared shape for the three read-only KANAP entity contracts (plan 37 §4.5): internal
// surface only (chat/MCP entity tools stay untouched), provider_kind 'kanap_domain' so the
// dispatcher records evidence with 'system' trust, MCP-hidden, schema-strict five-family
// whitelist. tenant_permissions/business_resources are declarative; the real per-family
// permission (applications/infrastructure/locations) is enforced in the handlers via
// AiPolicyService.assertEntityTypeReadAccess.
function internalEntityContract(input: {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  tenant_permissions: string[];
  key_fields: string[];
}): CapabilityContract {
  return CapabilityContractSchema.parse({
    name: input.name,
    version: COMPATIBILITY_CAPABILITY_VERSION,
    description: input.description,
    category: 'kanap_data',
    provider_kind: 'kanap_domain',
    supported_surfaces: ['internal'],
    input_schema: input.input_schema,
    output_schema: { type: 'object' },
    effect: 'read',
    risk_level: 'low',
    max_autonomy_level: 'A1',
    default_approval: 'none',
    approval_strategy: { mode: 'none' },
    evidence: {
      persist_input: false,
      persist_output: true,
      redact_fields: [],
      retention: 'standard',
    },
    tenant_permissions: input.tenant_permissions,
    business_resources: ['kanap_entities'],
    timeout_seconds: 30,
    retry_policy: { automatic_retry: false, max_attempts: 1 },
    idempotency: { mode: 'idempotent', key_fields: input.key_fields },
    rollback: { supported: false },
    cost: { estimated_unit_cost: null, metered: false },
    redaction_policy: { fields: [] },
    mcp_exposure: { enabled: false, read_only: false },
    live_test_safety: 'live_read',
    compatibility: { ai_tool_name: null },
  });
}

function internalEntitySearchContract(): CapabilityContract {
  return internalEntityContract({
    name: KANAP_ENTITY_SEARCH_CAPABILITY,
    description: 'Search KANAP applications, assets, interfaces, connections or locations through the governed internal control-plane surface.',
    input_schema: {
      type: 'object',
      properties: {
        entity_type: { type: 'string', enum: [...KANAP_ENTITY_FAMILIES] },
        q: { type: 'string', minLength: 1 },
        limit: { type: 'number', minimum: 1, maximum: 10, default: 5 },
      },
      required: ['entity_type', 'q'],
      additionalProperties: false,
    },
    tenant_permissions: ['applications', 'infrastructure', 'locations'],
    key_fields: ['entity_type', 'q', 'limit'],
  });
}

function internalEntityDetailContract(): CapabilityContract {
  return internalEntityContract({
    name: KANAP_ENTITY_DETAIL_CAPABILITY,
    description: 'Read one KANAP entity as a compact field projection (scalars, short lists and IP addresses; heavy linked payloads omitted) through the governed internal control-plane surface.',
    input_schema: {
      type: 'object',
      properties: {
        entity_type: { type: 'string', enum: [...KANAP_ENTITY_FAMILIES] },
        entity_id: { type: 'string', minLength: 1 },
      },
      required: ['entity_type', 'entity_id'],
      additionalProperties: false,
    },
    tenant_permissions: ['applications', 'infrastructure', 'locations'],
    key_fields: ['entity_type', 'entity_id'],
  });
}

function internalEntityContextContract(): CapabilityContract {
  return internalEntityContract({
    name: KANAP_ENTITY_CONTEXT_CAPABILITY,
    description: 'Read the relationship context (linked applications/assets, owners, knowledge) of one KANAP application or asset through the governed internal control-plane surface.',
    input_schema: {
      type: 'object',
      properties: {
        entity_type: { type: 'string', enum: [...KANAP_CONTEXT_ENTITY_FAMILIES] },
        entity_id: { type: 'string', minLength: 1 },
      },
      required: ['entity_type', 'entity_id'],
      additionalProperties: false,
    },
    tenant_permissions: ['applications', 'infrastructure'],
    key_fields: ['entity_type', 'entity_id'],
  });
}

function providerReadContract(input: {
  name: string;
  description: string;
  category: string;
  provider_kind: CapabilityProviderKind;
  input_schema: Record<string, unknown>;
  business_resources: string[];
  redaction_policy?: { fields: string[] };
}): CapabilityContract {
  return CapabilityContractSchema.parse({
    name: input.name,
    version: PROVIDER_CAPABILITY_VERSION,
    description: input.description,
    category: input.category,
    provider_kind: input.provider_kind,
    supported_surfaces: ['internal', 'scheduler', 'alert'],
    input_schema: input.input_schema,
    output_schema: { type: 'object' },
    effect: 'read',
    risk_level: 'low',
    max_autonomy_level: 'A1',
    default_approval: 'none',
    approval_strategy: { mode: 'none' },
    evidence: {
      persist_input: false,
      persist_output: true,
      redact_fields: [],
      retention: 'standard',
    },
    tenant_permissions: ['ai.surface'],
    business_resources: input.business_resources,
    timeout_seconds: 30,
    retry_policy: { automatic_retry: false, max_attempts: 1 },
    idempotency: { mode: 'idempotent', key_fields: ['provider_key'] },
    rollback: { supported: false },
    cost: { estimated_unit_cost: null, metered: false },
    redaction_policy: input.redaction_policy ?? { fields: [] },
    mcp_exposure: { enabled: false, read_only: false },
    live_test_safety: 'live_read',
    compatibility: { ai_tool_name: null },
  });
}

function ticketingInternalNotePrepareContract(): CapabilityContract {
  return CapabilityContractSchema.parse({
    name: TICKETING_INTERNAL_NOTE_PREPARE_CAPABILITY,
    version: PROVIDER_CAPABILITY_VERSION,
    description: 'Prepare an approval-gated internal ticket note action request.',
    category: 'provider_ticketing',
    provider_kind: 'ticketing',
    supported_surfaces: ['internal', 'scheduler', 'alert'],
    input_schema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string', minLength: 1, maxLength: 128 },
        note_body: { type: 'string', minLength: 1, maxLength: MAX_INTERNAL_NOTE_CHARS },
        provider_key: { type: 'string', minLength: 1, maxLength: 128 },
        evidence_ids: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          maxItems: 100,
        },
        observation_id: { type: 'string', minLength: 1 },
        recommendation_id: { type: 'string', minLength: 1 },
        decision_id: { type: 'string', minLength: 1 },
        evaluation_id: { type: 'string', minLength: 1 },
      },
      required: ['ticket_id', 'note_body'],
      additionalProperties: false,
    },
    output_schema: { type: 'object' },
    effect: 'propose',
    risk_level: 'low',
    max_autonomy_level: 'A2',
    default_approval: 'none',
    approval_strategy: { mode: 'none' },
    evidence: {
      persist_input: true,
      persist_output: true,
      redact_fields: [],
      retention: 'audit',
    },
    tenant_permissions: ['ai.surface'],
    business_resources: ['tickets'],
    timeout_seconds: 30,
    retry_policy: { automatic_retry: false, max_attempts: 1 },
    execution_phase: TICKETING_EXECUTION_PHASES.internal_note,
    idempotency: { mode: 'idempotent', key_fields: ['provider_key', 'ticket_id', 'note_body'] },
    rollback: { supported: false },
    cost: { estimated_unit_cost: null, metered: false },
    redaction_policy: { fields: [] },
    mcp_exposure: { enabled: false, read_only: false },
    live_test_safety: 'mock_only',
    compatibility: { ai_tool_name: null },
  });
}

function ticketingInternalNoteAddApprovedContract(): CapabilityContract {
  return CapabilityContractSchema.parse({
    name: TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY,
    version: PROVIDER_CAPABILITY_VERSION,
    description: 'Add an internal/private ticket note after a durable approval.',
    category: 'provider_ticketing',
    provider_kind: 'ticketing',
    supported_surfaces: ['internal', 'scheduler', 'alert'],
    input_schema: {
      type: 'object',
      properties: {
        action_request_id: { type: 'string', format: 'uuid' },
      },
      required: ['action_request_id'],
      additionalProperties: false,
    },
    output_schema: { type: 'object' },
    effect: 'write',
    risk_level: 'medium',
    max_autonomy_level: 'A3',
    default_approval: 'human',
    approval_strategy: { mode: 'action_request' },
    evidence: {
      persist_input: true,
      persist_output: true,
      redact_fields: [],
      retention: 'audit',
    },
    tenant_permissions: ['ai.write'],
    business_resources: ['tickets'],
    timeout_seconds: 60,
    retry_policy: { automatic_retry: false, max_attempts: 1 },
    execution_phase: TICKETING_EXECUTION_PHASES.internal_note,
    idempotency: { mode: 'idempotent', key_fields: ['action_request_id'] },
    rollback: { supported: false },
    cost: { estimated_unit_cost: null, metered: false },
    redaction_policy: { fields: [] },
    mcp_exposure: { enabled: false, read_only: false },
    live_test_safety: 'live_write_gated',
    compatibility: { ai_tool_name: null },
  });
}

function ticketingPublicReplyPrepareContract(): CapabilityContract {
  return CapabilityContractSchema.parse({
    name: TICKETING_PUBLIC_REPLY_PREPARE_CAPABILITY,
    version: PROVIDER_CAPABILITY_VERSION,
    description: 'Prepare an approval-gated public ticket reply action request.',
    category: 'provider_ticketing',
    provider_kind: 'ticketing',
    supported_surfaces: ['internal', 'scheduler', 'alert'],
    input_schema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string', minLength: 1, maxLength: 128 },
        reply_body: { type: 'string', minLength: 1, maxLength: MAX_PUBLIC_REPLY_CHARS },
        provider_key: { type: 'string', minLength: 1, maxLength: 128 },
        evidence_ids: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          maxItems: 100,
        },
        observation_id: { type: 'string', minLength: 1 },
        recommendation_id: { type: 'string', minLength: 1 },
        decision_id: { type: 'string', minLength: 1 },
        evaluation_id: { type: 'string', minLength: 1 },
      },
      required: ['ticket_id', 'reply_body'],
      additionalProperties: false,
    },
    output_schema: { type: 'object' },
    effect: 'propose',
    risk_level: 'medium',
    max_autonomy_level: 'A2',
    default_approval: 'none',
    approval_strategy: { mode: 'none' },
    evidence: {
      persist_input: true,
      persist_output: true,
      redact_fields: [],
      retention: 'audit',
    },
    tenant_permissions: ['ai.surface'],
    business_resources: ['tickets'],
    timeout_seconds: 30,
    retry_policy: { automatic_retry: false, max_attempts: 1 },
    execution_phase: TICKETING_EXECUTION_PHASES.public_reply,
    idempotency: { mode: 'idempotent', key_fields: ['provider_key', 'ticket_id', 'reply_body'] },
    rollback: { supported: false },
    cost: { estimated_unit_cost: null, metered: false },
    redaction_policy: { fields: [] },
    mcp_exposure: { enabled: false, read_only: false },
    live_test_safety: 'mock_only',
    compatibility: { ai_tool_name: null },
  });
}

function ticketingPublicReplyAddApprovedContract(): CapabilityContract {
  return CapabilityContractSchema.parse({
    name: TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY,
    version: PROVIDER_CAPABILITY_VERSION,
    description: 'Add a public ticket reply after a durable approval.',
    category: 'provider_ticketing',
    provider_kind: 'ticketing',
    supported_surfaces: ['internal', 'scheduler', 'alert'],
    input_schema: {
      type: 'object',
      properties: {
        action_request_id: { type: 'string', format: 'uuid' },
      },
      required: ['action_request_id'],
      additionalProperties: false,
    },
    output_schema: { type: 'object' },
    effect: 'write',
    risk_level: 'high',
    max_autonomy_level: 'A3',
    default_approval: 'human',
    approval_strategy: { mode: 'action_request' },
    evidence: {
      persist_input: true,
      persist_output: true,
      redact_fields: [],
      retention: 'audit',
    },
    tenant_permissions: ['ai.write'],
    business_resources: ['tickets'],
    timeout_seconds: 60,
    retry_policy: { automatic_retry: false, max_attempts: 1 },
    execution_phase: TICKETING_EXECUTION_PHASES.public_reply,
    idempotency: { mode: 'idempotent', key_fields: ['action_request_id'] },
    rollback: { supported: false },
    cost: { estimated_unit_cost: null, metered: false },
    redaction_policy: { fields: [] },
    mcp_exposure: { enabled: false, read_only: false },
    live_test_safety: 'live_write_gated',
    compatibility: { ai_tool_name: null },
  });
}

function ticketingProviderUpdatePrepareContract(input: {
  name: string;
  description: string;
  riskLevel: 'low' | 'medium';
  input_schema: Record<string, unknown>;
  executionPhase: number;
}): CapabilityContract {
  return CapabilityContractSchema.parse({
    name: input.name,
    version: PROVIDER_CAPABILITY_VERSION,
    description: input.description,
    category: 'provider_ticketing',
    provider_kind: 'ticketing',
    supported_surfaces: ['internal', 'scheduler', 'alert'],
    input_schema: input.input_schema,
    output_schema: { type: 'object' },
    effect: 'propose',
    risk_level: input.riskLevel,
    max_autonomy_level: 'A2',
    default_approval: 'none',
    approval_strategy: { mode: 'none' },
    evidence: {
      persist_input: true,
      persist_output: true,
      redact_fields: [],
      retention: 'audit',
    },
    tenant_permissions: ['ai.surface'],
    business_resources: ['tickets'],
    timeout_seconds: 30,
    retry_policy: { automatic_retry: false, max_attempts: 1 },
    execution_phase: input.executionPhase,
    idempotency: { mode: 'idempotent', key_fields: ['provider_key', 'ticket_id'] },
    rollback: { supported: false },
    cost: { estimated_unit_cost: null, metered: false },
    redaction_policy: { fields: [] },
    mcp_exposure: { enabled: false, read_only: false },
    live_test_safety: 'mock_only',
    compatibility: { ai_tool_name: null },
  });
}

function ticketingProviderUpdateApprovedContract(input: {
  name: string;
  description: string;
  riskLevel: 'medium' | 'high';
  executionPhase: number;
}): CapabilityContract {
  return CapabilityContractSchema.parse({
    name: input.name,
    version: PROVIDER_CAPABILITY_VERSION,
    description: input.description,
    category: 'provider_ticketing',
    provider_kind: 'ticketing',
    supported_surfaces: ['internal', 'scheduler', 'alert'],
    input_schema: {
      type: 'object',
      properties: {
        action_request_id: { type: 'string', format: 'uuid' },
      },
      required: ['action_request_id'],
      additionalProperties: false,
    },
    output_schema: { type: 'object' },
    effect: 'write',
    risk_level: input.riskLevel,
    max_autonomy_level: 'A3',
    default_approval: 'human',
    approval_strategy: { mode: 'action_request' },
    evidence: {
      persist_input: true,
      persist_output: true,
      redact_fields: [],
      retention: 'audit',
    },
    tenant_permissions: ['ai.write'],
    business_resources: ['tickets'],
    timeout_seconds: 60,
    retry_policy: { automatic_retry: false, max_attempts: 1 },
    execution_phase: input.executionPhase,
    idempotency: { mode: 'idempotent', key_fields: ['action_request_id'] },
    rollback: { supported: false },
    cost: { estimated_unit_cost: null, metered: false },
    redaction_policy: { fields: [] },
    mcp_exposure: { enabled: false, read_only: false },
    live_test_safety: 'live_write_gated',
    compatibility: { ai_tool_name: null },
  });
}

function automationReadContract(input: {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  timeout_seconds?: number;
}): CapabilityContract {
  return CapabilityContractSchema.parse({
    name: input.name,
    version: AUTOMATION_PROVIDER_CAPABILITY_VERSION,
    description: input.description,
    category: 'provider_automation',
    provider_kind: 'automation',
    supported_surfaces: ['internal', 'scheduler', 'alert'],
    input_schema: input.input_schema,
    output_schema: { type: 'object' },
    effect: 'read',
    risk_level: 'low',
    max_autonomy_level: 'A1',
    default_approval: 'none',
    approval_strategy: { mode: 'none' },
    evidence: {
      persist_input: false,
      persist_output: true,
      redact_fields: [],
      retention: 'standard',
    },
    tenant_permissions: ['ai.surface'],
    business_resources: ['automation'],
    timeout_seconds: input.timeout_seconds ?? 30,
    retry_policy: { automatic_retry: false, max_attempts: 1 },
    idempotency: { mode: 'idempotent', key_fields: ['provider_key', 'job_key', 'job_run_id'] },
    rollback: { supported: false },
    cost: { estimated_unit_cost: null, metered: false },
    redaction_policy: { fields: [] },
    mcp_exposure: { enabled: false, read_only: false },
    live_test_safety: 'mock_only',
    compatibility: { ai_tool_name: null },
  });
}

function automationDryRunContract(): CapabilityContract {
  return CapabilityContractSchema.parse({
    name: AUTOMATION_JOB_DRY_RUN_CAPABILITY,
    version: AUTOMATION_PROVIDER_CAPABILITY_VERSION,
    description: 'Run a catalog-approved AWX automation job in check/dry-run mode.',
    category: 'provider_automation',
    provider_kind: 'automation',
    supported_surfaces: ['internal', 'scheduler', 'alert'],
    input_schema: {
      type: 'object',
      properties: {
        provider_key: { type: 'string', minLength: 1, maxLength: 128 },
        job_key: { type: 'string', minLength: 1, maxLength: 128 },
        target: {
          type: 'object',
          properties: {
            type: { type: 'string', minLength: 1, maxLength: 64 },
            values: {
              type: 'array',
              items: { type: 'string', minLength: 1, maxLength: 256 },
              minItems: 1,
              maxItems: 50,
            },
          },
          required: ['type', 'values'],
          additionalProperties: false,
        },
        variables: { type: 'object', additionalProperties: true },
      },
      required: ['job_key', 'target'],
      additionalProperties: false,
    },
    output_schema: { type: 'object' },
    effect: 'propose',
    risk_level: 'low',
    max_autonomy_level: 'A2',
    default_approval: 'none',
    approval_strategy: { mode: 'none' },
    evidence: {
      persist_input: true,
      persist_output: true,
      redact_fields: [],
      retention: 'audit',
    },
    tenant_permissions: ['ai.surface'],
    business_resources: ['automation'],
    timeout_seconds: 300,
    retry_policy: { automatic_retry: false, max_attempts: 1 },
    idempotency: { mode: 'idempotent', key_fields: ['provider_key', 'job_key', 'target', 'variables'] },
    rollback: { supported: false },
    cost: { estimated_unit_cost: null, metered: false },
    redaction_policy: { fields: [] },
    mcp_exposure: { enabled: false, read_only: false },
    live_test_safety: 'mock_only',
    compatibility: { ai_tool_name: null },
  });
}

function automationLaunchPrepareContract(): CapabilityContract {
  return CapabilityContractSchema.parse({
    name: AUTOMATION_JOB_LAUNCH_PREPARE_CAPABILITY,
    version: AUTOMATION_PROVIDER_CAPABILITY_VERSION,
    description: 'Prepare an approval-gated AWX automation launch action request.',
    category: 'provider_automation',
    provider_kind: 'automation',
    supported_surfaces: ['internal', 'scheduler', 'alert'],
    input_schema: {
      type: 'object',
      properties: {
        provider_key: { type: 'string', minLength: 1, maxLength: 128 },
        job_key: { type: 'string', minLength: 1, maxLength: 128 },
        target: {
          type: 'object',
          properties: {
            type: { type: 'string', minLength: 1, maxLength: 64 },
            values: {
              type: 'array',
              items: { type: 'string', minLength: 1, maxLength: 256 },
              minItems: 1,
              maxItems: 50,
            },
          },
          required: ['type', 'values'],
          additionalProperties: false,
        },
        variables: { type: 'object', additionalProperties: true },
        evidence_ids: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          maxItems: 100,
        },
        recommendation_id: { type: 'string', minLength: 1 },
        decision_id: { type: 'string', minLength: 1 },
        evaluation_id: { type: 'string', minLength: 1 },
      },
      required: ['job_key', 'target'],
      additionalProperties: false,
    },
    output_schema: { type: 'object' },
    effect: 'propose',
    risk_level: 'medium',
    max_autonomy_level: 'A2',
    default_approval: 'none',
    approval_strategy: { mode: 'none' },
    evidence: {
      persist_input: true,
      persist_output: true,
      redact_fields: [],
      retention: 'audit',
    },
    tenant_permissions: ['ai.surface'],
    business_resources: ['automation'],
    timeout_seconds: 30,
    retry_policy: { automatic_retry: false, max_attempts: 1 },
    idempotency: { mode: 'idempotent', key_fields: ['provider_key', 'job_key', 'target', 'variables'] },
    rollback: { supported: false },
    cost: { estimated_unit_cost: null, metered: false },
    redaction_policy: { fields: [] },
    mcp_exposure: { enabled: false, read_only: false },
    live_test_safety: 'mock_only',
    compatibility: { ai_tool_name: null },
  });
}

function automationLaunchApprovedContract(): CapabilityContract {
  return CapabilityContractSchema.parse({
    name: AUTOMATION_JOB_LAUNCH_APPROVED_CAPABILITY,
    version: AUTOMATION_PROVIDER_CAPABILITY_VERSION,
    description: 'Launch an AWX automation job after durable human approval.',
    category: 'provider_automation',
    provider_kind: 'automation',
    supported_surfaces: ['internal', 'scheduler', 'alert'],
    input_schema: {
      type: 'object',
      properties: {
        action_request_id: { type: 'string', format: 'uuid' },
      },
      required: ['action_request_id'],
      additionalProperties: false,
    },
    output_schema: { type: 'object' },
    effect: 'remediate',
    risk_level: 'high',
    max_autonomy_level: 'A3',
    default_approval: 'human',
    approval_strategy: { mode: 'action_request' },
    evidence: {
      persist_input: true,
      persist_output: true,
      redact_fields: [],
      retention: 'audit',
    },
    tenant_permissions: ['ai.write'],
    business_resources: ['automation'],
    timeout_seconds: 600,
    retry_policy: { automatic_retry: false, max_attempts: 1 },
    idempotency: { mode: 'idempotent', key_fields: ['action_request_id'] },
    rollback: { supported: false },
    cost: { estimated_unit_cost: null, metered: false },
    redaction_policy: { fields: [] },
    mcp_exposure: { enabled: false, read_only: false },
    live_test_safety: 'destructive_gated',
    compatibility: { ai_tool_name: null },
  });
}

export function providerCapabilityContracts(): CapabilityContract[] {
  return [
    providerReadContract({
      name: 'monitoring.alert.get',
      description: 'Read a tenant-configured monitoring alert through a provider adapter.',
      category: 'provider_monitoring',
      provider_kind: 'monitoring',
      business_resources: ['infrastructure'],
      input_schema: {
        type: 'object',
        properties: {
          alert_id: { type: 'string', minLength: 1 },
          provider_key: { type: 'string', minLength: 1 },
        },
        required: ['alert_id'],
        additionalProperties: false,
      },
    }),
    providerReadContract({
      name: 'monitoring.sensor.history',
      description: 'Read a bounded monitoring sensor history window through a provider adapter.',
      category: 'provider_monitoring',
      provider_kind: 'monitoring',
      business_resources: ['infrastructure'],
      input_schema: {
        type: 'object',
        properties: {
          sensor_id: { type: 'string', minLength: 1 },
          window_minutes: { type: 'integer', minimum: 5, maximum: 1440 },
          provider_key: { type: 'string', minLength: 1 },
        },
        required: ['sensor_id'],
        additionalProperties: false,
      },
    }),
    providerReadContract({
      name: 'monitoring.state.get',
      description: 'Read the current state of a monitoring check through a provider adapter.',
      category: 'provider_monitoring',
      provider_kind: 'monitoring',
      business_resources: ['infrastructure'],
      input_schema: {
        type: 'object',
        properties: {
          sensor_id: { type: 'string', minLength: 1 },
          provider_key: { type: 'string', minLength: 1 },
        },
        required: ['sensor_id'],
        additionalProperties: false,
      },
    }),
    providerReadContract({
      name: 'monitoring.alert.related.list',
      description: 'List alerts related to a monitoring check (same device or group) through a provider adapter.',
      category: 'provider_monitoring',
      provider_kind: 'monitoring',
      business_resources: ['infrastructure'],
      input_schema: {
        type: 'object',
        properties: {
          sensor_id: { type: 'string', minLength: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 10 },
          provider_key: { type: 'string', minLength: 1 },
        },
        required: ['sensor_id'],
        additionalProperties: false,
      },
    }),
    providerReadContract({
      name: 'monitoring.object.get',
      description: 'Read a monitored object (device/group context, including its host address) through a provider adapter.',
      category: 'provider_monitoring',
      provider_kind: 'monitoring',
      business_resources: ['infrastructure'],
      input_schema: {
        type: 'object',
        properties: {
          object_id: { type: 'string', minLength: 1 },
          provider_key: { type: 'string', minLength: 1 },
        },
        required: ['object_id'],
        additionalProperties: false,
      },
    }),
    providerReadContract({
      name: 'virtualization.vm.health',
      description: 'Read virtual machine health through a virtualization provider adapter.',
      category: 'provider_virtualization',
      provider_kind: 'virtualization',
      business_resources: ['infrastructure'],
      input_schema: {
        type: 'object',
        properties: {
          vm_id: { type: 'string', minLength: 1 },
          provider_key: { type: 'string', minLength: 1 },
        },
        required: ['vm_id'],
        additionalProperties: false,
      },
    }),
    providerReadContract({
      name: 'ticketing.ticket.get',
      description: 'Read a ticket through a ticketing provider adapter.',
      category: 'provider_ticketing',
      provider_kind: 'ticketing',
      business_resources: ['tickets'],
      input_schema: {
        type: 'object',
        properties: {
          ticket_id: { type: 'string', minLength: 1 },
          provider_key: { type: 'string', minLength: 1 },
        },
        required: ['ticket_id'],
        additionalProperties: false,
      },
    }),
    providerReadContract({
      name: 'ticketing.ticket.search_similar',
      description: 'Search for similar tickets through a ticketing provider adapter.',
      category: 'provider_ticketing',
      provider_kind: 'ticketing',
      business_resources: ['tickets'],
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1 },
          ticket_id: { type: 'string', minLength: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 10 },
          provider_key: { type: 'string', minLength: 1 },
        },
        required: ['query'],
        additionalProperties: false,
      },
    }),
    providerReadContract({
      name: TICKETING_TICKET_NOTES_LIST_CAPABILITY,
      description: 'Read normalized ticket conversation notes through a ticketing provider adapter.',
      category: 'provider_ticketing',
      provider_kind: 'ticketing',
      business_resources: ['tickets'],
      input_schema: {
        type: 'object',
        properties: {
          ticket_id: { type: 'string', minLength: 1 },
          provider_key: { type: 'string', minLength: 1 },
        },
        required: ['ticket_id'],
        additionalProperties: false,
      },
    }),
    providerReadContract({
      name: TICKETING_TICKET_ATTACHMENT_READ_CAPABILITY,
      description: 'Read one ticket attachment through a ticketing provider adapter.',
      category: 'provider_ticketing',
      provider_kind: 'ticketing',
      business_resources: ['tickets', 'attachments'],
      input_schema: {
        type: 'object',
        properties: {
          ticket_id: { type: 'string', minLength: 1 },
          target: { type: 'string', minLength: 1 },
          source: { type: 'string', enum: ['ticket_description', 'ticket_note'] },
          source_note_id: { type: 'string', minLength: 1 },
          provider_key: { type: 'string', minLength: 1 },
        },
        required: ['ticket_id', 'target'],
        additionalProperties: false,
      },
      // No redaction_policy on base64Data: this read capability MUST return the image bytes to the
      // caller (the vision extractor needs them), and the dispatcher returns the redacted output.
      // Persisted evidence stays byte-free because the TicketingProvider.readTicketAttachment
      // contract requires metadata-only adapter evidence seeds. The previous
      // `{ fields: ['base64Data'] }` was a no-op (nested path `data.base64Data` never matched the
      // leaf field) and is intentionally removed.
    }),
    providerReadContract({
      name: TICKETING_CLASSIFICATION_CONTEXT_CAPABILITY,
      description: 'Read normalized ticket classification context through a ticketing provider adapter.',
      category: 'provider_ticketing',
      provider_kind: 'ticketing',
      business_resources: ['tickets'],
      input_schema: {
        type: 'object',
        properties: {
          ticket_id: { type: 'string', minLength: 1 },
          category_scope_keys: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 200 },
          provider_key: { type: 'string', minLength: 1 },
        },
        required: ['ticket_id'],
        additionalProperties: false,
      },
    }),
    providerReadContract({
      name: TICKETING_LIFECYCLE_CONTEXT_CAPABILITY,
      description: 'Read normalized ticket status and lifecycle context through a ticketing provider adapter.',
      category: 'provider_ticketing',
      provider_kind: 'ticketing',
      business_resources: ['tickets'],
      input_schema: {
        type: 'object',
        properties: {
          ticket_id: { type: 'string', minLength: 1 },
          provider_key: { type: 'string', minLength: 1 },
        },
        required: ['ticket_id'],
        additionalProperties: false,
      },
    }),
    providerReadContract({
      name: TICKETING_ROUTING_CONTEXT_CAPABILITY,
      description: 'Read normalized ticket assignment and routing context through a ticketing provider adapter.',
      category: 'provider_ticketing',
      provider_kind: 'ticketing',
      business_resources: ['tickets'],
      input_schema: {
        type: 'object',
        properties: {
          ticket_id: { type: 'string', minLength: 1 },
          provider_key: { type: 'string', minLength: 1 },
        },
        required: ['ticket_id'],
        additionalProperties: false,
      },
    }),
    providerReadContract({
      name: TICKETING_PARTICIPANT_CONTEXT_CAPABILITY,
      description: 'Read normalized ticket requester, watcher, observer, and viewer context through a ticketing provider adapter.',
      category: 'provider_ticketing',
      provider_kind: 'ticketing',
      business_resources: ['tickets'],
      input_schema: {
        type: 'object',
        properties: {
          ticket_id: { type: 'string', minLength: 1 },
          provider_key: { type: 'string', minLength: 1 },
        },
        required: ['ticket_id'],
        additionalProperties: false,
      },
    }),
    ticketingProviderUpdatePrepareContract({
      name: TICKETING_CLASSIFICATION_UPDATE_PREPARE_CAPABILITY,
      description: 'Prepare an approval-gated ticket classification update action request.',
      riskLevel: 'low',
      executionPhase: TICKETING_EXECUTION_PHASES.classification,
      input_schema: {
        type: 'object',
        properties: {
          ticket_id: { type: 'string', minLength: 1, maxLength: 128 },
          provider_key: { type: 'string', minLength: 1, maxLength: 128 },
          proposed: {
            type: 'object',
            properties: {
              type: { enum: ['incident', 'request'] },
              priority: { enum: ['very_low', 'low', 'medium', 'high', 'very_high', 'major'] },
              urgency: { enum: ['very_low', 'low', 'medium', 'high', 'very_high', 'major'] },
              impact: { type: 'string', minLength: 1, maxLength: 128 },
              category: { type: 'string', minLength: 1, maxLength: 256 },
              service: { type: 'string', minLength: 1, maxLength: 256 },
            },
            additionalProperties: false,
          },
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
          evidence_ids: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 100 },
          observation_id: { type: 'string', minLength: 1 },
          recommendation_id: { type: 'string', minLength: 1 },
          decision_id: { type: 'string', minLength: 1 },
          evaluation_id: { type: 'string', minLength: 1 },
        },
        required: ['ticket_id', 'proposed', 'reason'],
        additionalProperties: false,
      },
    }),
    ticketingProviderUpdateApprovedContract({
      name: TICKETING_CLASSIFICATION_UPDATE_APPROVED_CAPABILITY,
      description: 'Update ticket classification after a durable approval.',
      riskLevel: 'medium',
      executionPhase: TICKETING_EXECUTION_PHASES.classification,
    }),
    ticketingProviderUpdatePrepareContract({
      name: TICKETING_STATUS_UPDATE_PREPARE_CAPABILITY,
      description: 'Prepare an approval-gated ticket lifecycle/status update action request.',
      riskLevel: 'medium',
      executionPhase: TICKETING_EXECUTION_PHASES.status,
      input_schema: {
        type: 'object',
        properties: {
          ticket_id: { type: 'string', minLength: 1, maxLength: 128 },
          provider_key: { type: 'string', minLength: 1, maxLength: 128 },
          transition_key: { enum: ['processing_assigned', 'processing_planned', 'pending', 'escalated_l2', 'pending_user', 'solved', 'closed'] },
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
          evidence_ids: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 100 },
          observation_id: { type: 'string', minLength: 1 },
          recommendation_id: { type: 'string', minLength: 1 },
          decision_id: { type: 'string', minLength: 1 },
          evaluation_id: { type: 'string', minLength: 1 },
        },
        required: ['ticket_id', 'transition_key', 'reason'],
        additionalProperties: false,
      },
    }),
    ticketingProviderUpdateApprovedContract({
      name: TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY,
      description: 'Update ticket status after a durable approval.',
      riskLevel: 'high',
      executionPhase: TICKETING_EXECUTION_PHASES.status,
    }),
    ticketingProviderUpdatePrepareContract({
      name: TICKETING_ASSIGNMENT_UPDATE_PREPARE_CAPABILITY,
      description: 'Prepare an approval-gated ticket assignment/routing update action request.',
      riskLevel: 'medium',
      executionPhase: TICKETING_EXECUTION_PHASES.assignment,
      input_schema: {
        type: 'object',
        properties: {
          ticket_id: { type: 'string', minLength: 1, maxLength: 128 },
          provider_key: { type: 'string', minLength: 1, maxLength: 128 },
          target: {
            type: 'object',
            properties: {
              kind: { enum: ['user', 'group'] },
              key: { type: 'string', minLength: 1, maxLength: 256 },
              label: { type: 'string', minLength: 1, maxLength: 256 },
            },
            required: ['kind', 'key', 'label'],
            additionalProperties: false,
          },
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
          evidence_ids: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 100 },
          observation_id: { type: 'string', minLength: 1 },
          recommendation_id: { type: 'string', minLength: 1 },
          decision_id: { type: 'string', minLength: 1 },
          evaluation_id: { type: 'string', minLength: 1 },
        },
        required: ['ticket_id', 'target', 'reason'],
        additionalProperties: false,
      },
    }),
    ticketingProviderUpdateApprovedContract({
      name: TICKETING_ASSIGNMENT_UPDATE_APPROVED_CAPABILITY,
      description: 'Update ticket assignment after a durable approval.',
      riskLevel: 'high',
      executionPhase: TICKETING_EXECUTION_PHASES.assignment,
    }),
    ticketingProviderUpdatePrepareContract({
      name: TICKETING_PARTICIPANT_UPDATE_PREPARE_CAPABILITY,
      description: 'Prepare an approval-gated ticket participant update action request.',
      riskLevel: 'medium',
      executionPhase: TICKETING_EXECUTION_PHASES.participant,
      input_schema: {
        type: 'object',
        properties: {
          ticket_id: { type: 'string', minLength: 1, maxLength: 128 },
          provider_key: { type: 'string', minLength: 1, maxLength: 128 },
          operation: { enum: ['add_observer', 'remove_observer', 'set_observers'] },
          participants: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: {
              type: 'object',
              properties: {
                kind: { enum: ['user', 'group'] },
                key: { type: 'string', minLength: 1, maxLength: 256 },
                label: { type: 'string', minLength: 1, maxLength: 256 },
              },
              required: ['kind', 'key', 'label'],
              additionalProperties: false,
            },
          },
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
          evidence_ids: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 100 },
          observation_id: { type: 'string', minLength: 1 },
          recommendation_id: { type: 'string', minLength: 1 },
          decision_id: { type: 'string', minLength: 1 },
          evaluation_id: { type: 'string', minLength: 1 },
        },
        required: ['ticket_id', 'operation', 'participants', 'reason'],
        additionalProperties: false,
      },
    }),
    ticketingProviderUpdateApprovedContract({
      name: TICKETING_PARTICIPANT_UPDATE_APPROVED_CAPABILITY,
      description: 'Update ticket participants after a durable approval.',
      riskLevel: 'high',
      executionPhase: TICKETING_EXECUTION_PHASES.participant,
    }),
    providerReadContract({
      name: 'directory.user.context',
      description: 'Read user context through a directory provider adapter.',
      category: 'provider_directory',
      provider_kind: 'directory',
      business_resources: ['directory'],
      input_schema: {
        type: 'object',
        properties: {
          user_id_or_email: { type: 'string', minLength: 1 },
          provider_key: { type: 'string', minLength: 1 },
        },
        required: ['user_id_or_email'],
        additionalProperties: false,
      },
    }),
    ticketingInternalNotePrepareContract(),
    ticketingInternalNoteAddApprovedContract(),
    ticketingPublicReplyPrepareContract(),
    ticketingPublicReplyAddApprovedContract(),
    automationReadContract({
      name: AUTOMATION_JOB_ALLOWED_LIST_CAPABILITY,
      description: 'List tenant allowlisted automation jobs.',
      input_schema: {
        type: 'object',
        properties: {
          provider_key: { type: 'string', minLength: 1, maxLength: 128 },
        },
        additionalProperties: false,
      },
    }),
    automationReadContract({
      name: AUTOMATION_JOB_SCHEMA_GET_CAPABILITY,
      description: 'Read the catalog-controlled variable schema for an automation job.',
      input_schema: {
        type: 'object',
        properties: {
          provider_key: { type: 'string', minLength: 1, maxLength: 128 },
          job_key: { type: 'string', minLength: 1, maxLength: 128 },
        },
        required: ['job_key'],
        additionalProperties: false,
      },
    }),
    automationDryRunContract(),
    automationLaunchPrepareContract(),
    automationLaunchApprovedContract(),
    automationReadContract({
      name: AUTOMATION_JOB_STATUS_GET_CAPABILITY,
      description: 'Read the status of a launched automation job run.',
      input_schema: {
        type: 'object',
        properties: {
          action_request_id: { type: 'string', format: 'uuid' },
          job_run_id: { type: 'string', minLength: 1, maxLength: 256 },
        },
        required: ['action_request_id'],
        additionalProperties: false,
      },
    }),
    automationReadContract({
      name: AUTOMATION_JOB_OUTPUT_GET_CAPABILITY,
      description: 'Read bounded, redacted, untrusted output for a launched automation job run.',
      input_schema: {
        type: 'object',
        properties: {
          action_request_id: { type: 'string', format: 'uuid' },
          job_run_id: { type: 'string', minLength: 1, maxLength: 256 },
        },
        required: ['action_request_id'],
        additionalProperties: false,
      },
      timeout_seconds: 60,
    }),
  ];
}

function inputField(input: unknown, field: string): unknown {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)[field]
    : undefined;
}

function stringField(input: unknown, field: string): string {
  const value = inputField(input, field);
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`Missing provider capability input field: ${field}`);
  }
  return value.trim();
}

function optionalStringField(input: unknown, field: string): string | null {
  const value = inputField(input, field);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function optionalNumberField(input: unknown, field: string): number | null {
  const value = inputField(input, field);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function providerKey(input: unknown): string {
  return optionalStringField(input, 'provider_key') ?? 'mock';
}

function normalizeInternalNoteBody(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    throw new BadRequestException('Internal note body is required.');
  }
  if (normalized.length > MAX_INTERNAL_NOTE_CHARS) {
    throw new BadRequestException('Internal note body exceeds the allowed length.');
  }
  if (noteBodyIsUnsafe(normalized)) {
    throw new BadRequestException('Internal notes must be plain text and cannot contain HTML or scripts.');
  }
  return normalized;
}

function normalizePublicReplyBody(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    throw new BadRequestException('Public reply body is required.');
  }
  if (normalized.length > MAX_PUBLIC_REPLY_CHARS) {
    throw new BadRequestException('Public reply body exceeds the allowed length.');
  }
  if (noteBodyIsUnsafe(normalized)) {
    throw new BadRequestException('Public replies must be plain text and cannot contain HTML or scripts.');
  }
  return normalized;
}

function isTicketInternalNotePayload(value: unknown): value is TicketInternalNoteActionPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.ticketId === 'string'
    && record.visibility === 'internal'
    && typeof record.body === 'string'
    && record.bodyFormat === 'plain_text';
}

function isTicketPublicReplyPayload(value: unknown): value is TicketPublicReplyActionPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.ticketId === 'string'
    && record.visibility === 'public'
    && typeof record.body === 'string'
    && record.bodyFormat === 'plain_text';
}

function isTicketClassificationUpdatePayload(value: unknown): value is TicketClassificationUpdateActionPayload {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.ticketId === 'string'
    && value.action === 'classification_update'
    && isRecord(value.current)
    && isRecord(value.proposed)
    && typeof value.reason === 'string';
}

function isTicketStatusUpdatePayload(value: unknown): value is TicketStatusUpdateActionPayload {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.ticketId === 'string'
    && value.action === 'status_update'
    && isRecord(value.current)
    && typeof value.transitionKey === 'string'
    && typeof value.targetStatus === 'string'
    && typeof value.reason === 'string';
}

function isTicketAssignmentUpdatePayload(value: unknown): value is TicketAssignmentUpdateActionPayload {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.ticketId === 'string'
    && value.action === 'assignment_update'
    && isRecord(value.current)
    && isRecord(value.target)
    && typeof (value.target as Record<string, unknown>).kind === 'string'
    && typeof (value.target as Record<string, unknown>).key === 'string'
    && typeof (value.target as Record<string, unknown>).label === 'string'
    && typeof value.reason === 'string';
}

function isTicketParticipantUpdatePayload(value: unknown): value is TicketParticipantUpdateActionPayload {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.ticketId === 'string'
    && value.action === 'participant_update'
    && isRecord(value.current)
    && typeof value.operation === 'string'
    && Array.isArray(value.participants)
    && value.participants.every(isRecord)
    && typeof value.reason === 'string';
}

function isAutomationTargetPayload(value: unknown): value is { type: string; values: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.type === 'string'
    && Array.isArray(record.values)
    && record.values.every((entry) => typeof entry === 'string');
}

// Field-projected detail payload: scalars and short string lists only, plus normalized
// ip_addresses (KANAP asset correlation needs them for the alert→asset matching rule).
// The nested linked_* payloads AiQueryExecutor.executeDetail bolts onto detail rows are
// deliberately dropped — full detail dumps burned the per-run token cap during helpdesk
// calibration (PR #95 lesson).
function compactEntityDetailData(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let fields = 0;
  for (const [key, value] of Object.entries(data)) {
    if (fields >= MAX_ENTITY_DETAIL_FIELDS) {
      break;
    }
    if (key === 'ip_addresses' && Array.isArray(value)) {
      result.ip_addresses = value
        .map((entry) => {
          if (typeof entry === 'string') return entry.trim();
          return isRecord(entry) && typeof entry.ip === 'string' ? entry.ip.trim() : '';
        })
        .filter(Boolean)
        .slice(0, MAX_ENTITY_DETAIL_LIST_ITEMS);
      fields += 1;
      continue;
    }
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
      result[key] = value;
      fields += 1;
      continue;
    }
    if (typeof value === 'string') {
      result[key] = value.length > MAX_ENTITY_DETAIL_STRING_CHARS
        ? `${value.slice(0, MAX_ENTITY_DETAIL_STRING_CHARS)}…`
        : value;
      fields += 1;
      continue;
    }
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      result[key] = value
        .slice(0, MAX_ENTITY_DETAIL_LIST_ITEMS)
        .map((item: string) => (item.length > MAX_ENTITY_DETAIL_STRING_CHARS
          ? `${item.slice(0, MAX_ENTITY_DETAIL_STRING_CHARS)}…`
          : item));
      fields += 1;
      continue;
    }
    // Nested objects/arrays (hardware_info, relations, linked_* bundles) deliberately omitted.
  }
  return result;
}

const HELP_DESK_TRIAGE_FRESH_PROPOSAL_WORKFLOWS = new Set([
  'agent_control_center_glpi_triage',
  'agent_control_center_ticketing_triage',
]);

function shouldCreateFreshHelpdeskTriageProposal(execution: CapabilityExecutionContext): boolean {
  const metadata = isRecord(execution.metadata) ? execution.metadata : null;
  return typeof metadata?.uat_workflow === 'string'
    && HELP_DESK_TRIAGE_FRESH_PROPOSAL_WORKFLOWS.has(metadata.uat_workflow)
    && typeof metadata.agent_work_item_id === 'string'
    && metadata.agent_work_item_id.trim().length > 0;
}

// Every proposal an agent prepares shares one approval window. A triage run computes a single
// expiry anchor (proposal_expires_at) and stamps it on all of its proposals, so they become
// applicable together and expire together — no action class expires sooner than another. Non-run
// callers (chat/scheduler/alert) fall back to the agent's single approval_ttl_seconds.
function serviceDeskProposalExpiry(execution: CapabilityExecutionContext): Date | null {
  const metadata = isRecord(execution.metadata) ? execution.metadata : null;
  const anchor = stringMetadataField(execution.metadata, 'proposal_expires_at');
  if (anchor) {
    const parsed = new Date(anchor);
    if (Number.isFinite(parsed.getTime())) {
      return parsed;
    }
  }
  const configuredTtl = metadata?.approval_ttl_seconds;
  const configuredSeconds = typeof configuredTtl === 'number' ? configuredTtl : Number(configuredTtl);
  const ttlSeconds = Number.isFinite(configuredSeconds) && configuredSeconds > 0
    ? Math.max(MIN_APPROVAL_TTL_SECONDS, Math.min(MAX_APPROVAL_TTL_SECONDS, Math.floor(configuredSeconds)))
    : DEFAULT_APPROVAL_TTL_SECONDS;
  return new Date(Date.now() + ttlSeconds * 1000);
}

function approvedActionClass(capabilityName: string): string {
  if (capabilityName === TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY) return 'public_reply';
  if (capabilityName === TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY) return 'internal_note';
  if (capabilityName === TICKETING_CLASSIFICATION_UPDATE_APPROVED_CAPABILITY) return 'classification';
  if (capabilityName === TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY) return 'status';
  if (capabilityName === TICKETING_ASSIGNMENT_UPDATE_APPROVED_CAPABILITY) return 'assignment';
  if (capabilityName === TICKETING_PARTICIPANT_UPDATE_APPROVED_CAPABILITY) return 'participant';
  return capabilityName;
}

const APPLY_ANYWAY_ACTION_CLASSES = new Set(['internal_note', 'classification']);

function serviceDeskOnStalePolicy(action: AiActionRequest, actionClass: string): 're_review' | 'cancel' | 'apply_anyway' {
  const metadata = isRecord(action.metadata_json) ? action.metadata_json : null;
  const policyMap = isRecord(metadata?.on_stale_by_action_class) ? metadata.on_stale_by_action_class : null;
  const raw = typeof policyMap?.[actionClass] === 'string' ? policyMap[actionClass] : null;
  return raw === 'cancel' || raw === 'apply_anyway' || raw === 're_review' ? raw : 're_review';
}

function ticketFreshnessUpdatedAt(ticket: TicketRecord): string | null {
  return typeof ticket.updatedAt === 'string' && ticket.updatedAt.trim().length > 0
    ? ticket.updatedAt
    : typeof (ticket as unknown as Record<string, unknown>).updated_at === 'string'
      ? String((ticket as unknown as Record<string, unknown>).updated_at)
      : null;
}

function ticketFreshnessHash(ticket: TicketRecord): string {
  return stableJson({
    id: ticket.id,
    title: ticket.title,
    status: ticket.status ?? null,
    priority: ticket.priority ?? null,
    updated_at: ticketFreshnessUpdatedAt(ticket),
    created_at: ticket.createdAt ?? null,
    scope: ticket.scope ?? null,
    requester_id: ticket.requesterId ?? null,
  });
}

function ticketFreshnessChanged(action: AiActionRequest, ticket: TicketRecord): boolean {
  const metadata = isRecord(action.metadata_json) ? action.metadata_json : null;
  const preparedHash = typeof metadata?.proposal_ticket_hash === 'string' ? metadata.proposal_ticket_hash : null;
  const preparedUpdatedAt = typeof metadata?.proposal_ticket_updated_at === 'string' ? metadata.proposal_ticket_updated_at : null;
  if (!preparedHash && !preparedUpdatedAt) {
    return false;
  }
  const currentUpdatedAt = ticketFreshnessUpdatedAt(ticket);
  const preparedMs = preparedUpdatedAt ? Date.parse(preparedUpdatedAt) : Number.NaN;
  const currentMs = currentUpdatedAt ? Date.parse(currentUpdatedAt) : Number.NaN;
  const dateMoved = Number.isFinite(preparedMs) && Number.isFinite(currentMs) && currentMs > preparedMs;
  const hashMoved = preparedHash != null && ticketFreshnessHash(ticket) !== preparedHash;
  return dateMoved || hashMoved;
}

// Ticketing providers do not agree on a timestamp frame: GLPI hands back `date_mod` as a
// naive local-time string in the GLPI server timezone ("2026-09-12 16:07:23") while the api
// runs in UTC, so parsing it yields a wall-clock value that is offset from our own UTC
// timestamps by the GLPI server offset. Only a timestamp carrying an explicit zone can be
// compared to one of our own.
const ABSOLUTE_TIMESTAMP_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function absoluteTimestampMs(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const text = value.trim();
  if (!ABSOLUTE_TIMESTAMP_PATTERN.test(text)) {
    return null;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

type PostWriteTicketBaseline = {
  updatedAt: string | null;
  hash: string | null;
};

// Baseline recorded on the action right after one of our own ticket writes succeeded
// (see recordPostWriteTargetBaseline). It identifies the ticket state we left behind by
// value, so a later sibling can tell "only KANAP touched this ticket" without any clock.
function actionPostWriteTicketBaseline(action: AiActionRequest): PostWriteTicketBaseline | null {
  const metadata = isRecord(action.metadata_json) ? action.metadata_json : null;
  const baseline = isRecord(metadata?.post_write_ticket_baseline) ? metadata.post_write_ticket_baseline : null;
  if (!baseline) {
    return null;
  }
  const hash = typeof baseline.ticket_hash === 'string' ? baseline.ticket_hash : null;
  const updatedAt = typeof baseline.ticket_updated_at === 'string' ? baseline.ticket_updated_at : null;
  if (!hash && !updatedAt) {
    return null;
  }
  return { hash, updatedAt };
}

function ticketMatchesPostWriteBaseline(baseline: PostWriteTicketBaseline, ticket: TicketRecord): boolean {
  if (baseline.hash != null) {
    // The hash already embeds updated_at, so hash equality is the strongest identity check.
    return baseline.hash === ticketFreshnessHash(ticket);
  }
  return baseline.updatedAt != null && baseline.updatedAt === ticketFreshnessUpdatedAt(ticket);
}

function actionHasApplyAnywayOverride(action: AiActionRequest): boolean {
  const metadata = isRecord(action.metadata_json) ? action.metadata_json : null;
  const override = isRecord(metadata?.stale_policy_override) ? metadata.stale_policy_override : null;
  return override?.mode === 'apply_anyway';
}

function isAutomationLaunchPayload(value: unknown): value is AutomationLaunchActionPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.providerKey === 'string'
    && typeof record.jobKey === 'string'
    && typeof record.catalogVersion === 'string'
    && typeof record.environment === 'string'
    && typeof record.externalJobTemplateRef === 'string'
    && record.variables != null
    && typeof record.variables === 'object'
    && !Array.isArray(record.variables)
    && isAutomationTargetPayload(record.target)
    && typeof record.dryRunRequired === 'boolean'
    && typeof record.blastRadius === 'number'
    && typeof record.timeoutSeconds === 'number';
}

function stringMetadataField(value: unknown, field: string): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const raw = value[field];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

function numberMetadataField(value: unknown, field: string): number | null {
  if (!isRecord(value)) {
    return null;
  }
  const raw = value[field];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function metadataProviderResultNoteId(value: unknown): string | null {
  const metadata = isRecord(value) ? value : null;
  const providerResult = isRecord(metadata?.provider_result) ? metadata.provider_result : null;
  return stringMetadataField(providerResult, 'note_id');
}

function approvedBatchActionRequestIds(value: unknown): string[] {
  const metadata = isRecord(value) ? value : null;
  const batch = isRecord(metadata?.approved_batch_context) ? metadata.approved_batch_context : null;
  const rawIds = Array.isArray(batch?.action_request_ids) ? batch.action_request_ids : [];
  return rawIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
}

function ticketNoteTime(note: TicketNote): number | null {
  const value = note.updatedAt ?? note.createdAt;
  if (!value) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function ticketNoteFingerprint(note: TicketNote): string {
  if (typeof note.updateFingerprint === 'string' && note.updateFingerprint.trim().length > 0) {
    return note.updateFingerprint.trim();
  }
  return JSON.stringify({
    id: note.id,
    visibility: note.visibility,
    author_id: note.authorId ?? null,
    author_role: note.authorRole ?? 'unknown',
    created_at: note.createdAt || null,
    updated_at: note.updatedAt ?? null,
    body: String(note.body || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim(),
  });
}

function latestTicketNote(notes: TicketNote[]): TicketNote | null {
  return [...notes]
    .sort((left, right) => {
      const rightTime = ticketNoteTime(right) ?? 0;
      const leftTime = ticketNoteTime(left) ?? 0;
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }
      return String(right.id).localeCompare(String(left.id));
    })[0] ?? null;
}

function ticketWriteGuardError<T>(message: string): AdapterResult<T> {
  return {
    ok: false,
    errorCode: 'unsafe_operation',
    message,
    retryable: false,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function sameSnapshot(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

// Pre-write drift check for assignment updates, scoped to the kind being written.
//
// A group write only cares about the assigned groups: it is unaffected by technicians
// joining, by requester changes, or by the routing catalogue moving.
//
// A technician write compares the assigned users, MINUS the agent's own account. The
// public-reply phase of the same approved batch self-registers the agent as an assignee
// (addTicketUser, own-user only) before the assignment phase runs; that is the agent's own
// doing, never a routing decision, and it must not block the write. A human assigning a
// different technician in the meantime still fails the check, which is the point.
//
// Both branches fall back to the flat label for providers that do not expose keyed
// assignments.
export function routingDriftSnapshot(value: unknown, kind: 'group' | 'user'): unknown {
  if (!isRecord(value)) return value;
  if (kind === 'user') {
    const agentUserKey = typeof value.agentUserKey === 'string' ? value.agentUserKey : null;
    const assignedUsers = Array.isArray(value.assignedUsers) ? value.assignedUsers.filter(isRecord) : null;
    return {
      ticketId: value.ticketId ?? null,
      users: assignedUsers
        ? assignedUsers
          .map((user) => String(user.key ?? ''))
          .filter((key) => key !== agentUserKey)
          .sort()
        : [typeof value.assignee === 'string' ? value.assignee : null],
    };
  }
  const assignedGroups = Array.isArray(value.assignedGroups) ? value.assignedGroups.filter(isRecord) : null;
  return {
    ticketId: value.ticketId ?? null,
    groups: assignedGroups
      ? assignedGroups.map((group) => String(group.key ?? '')).sort()
      : [typeof value.group === 'string' ? value.group : null],
  };
}

// Drop fields that move for reasons unrelated to the safety of the write before the
// pre-write stale recheck. `updatedAt` is bumped by the agent's own internal note / public
// reply (posted earlier in the same approved batch) and `warnings` is advisory — neither
// indicates the ticket state we are about to change moved. Status, terminal, allowed
// transitions, and classification fields are kept, so a real change still blocks the write.
function freshnessRecheckSnapshot(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const next: Record<string, unknown> = { ...value };
  delete next.updatedAt;
  delete next.warnings;
  return next;
}

function withActionRequestData<T extends Record<string, unknown>>(
  result: AdapterResult<T>,
  data: Record<string, unknown>,
): AdapterResult<T & Record<string, unknown>> {
  if (!result.ok) {
    return result;
  }
  return {
    ...result,
    data: {
      ...result.data,
      ...data,
    },
  };
}

@Injectable()
export class AiCapabilityRegistry {
  private readonly internalContracts = new Map<string, CapabilityContract>([
    [EXECUTE_APPROVED_PREVIEW_CAPABILITY, internalExecuteApprovedPreviewContract()],
    ['search_knowledge', internalKnowledgeSearchContract()],
    ['get_document', internalKnowledgeDocumentContract()],
    ['web_search', internalWebSearchContract()],
    [KANAP_ENTITY_SEARCH_CAPABILITY, internalEntitySearchContract()],
    [KANAP_ENTITY_DETAIL_CAPABILITY, internalEntityDetailContract()],
    [KANAP_ENTITY_CONTEXT_CAPABILITY, internalEntityContextContract()],
  ]);
  private readonly providerContracts = new Map<string, CapabilityContract>(
    providerCapabilityContracts().map((contract) => [contract.name, contract]),
  );

  constructor(
    private readonly tools: AiToolRegistry,
    private readonly previews: AiMutationPreviewService,
    private readonly actions: AiActionRequestService,
    private readonly approvals: AiApprovalService,
    private readonly providers: AiProviderRegistryService,
    private readonly automationCatalog: AiAutomationJobCatalogService,
    private readonly externalMcpBridge?: AiExternalMcpBridgeService,
    @Optional() private readonly policy?: AiPolicyService,
    @Optional() private readonly knowledge?: KnowledgeService,
    @Optional() private readonly braveSearch?: BraveSearchService,
    @Optional() private readonly agentQueue?: AiAgentWorkQueueService,
    @Optional() private readonly queryExecutor?: AiQueryExecutor,
    @Optional() private readonly entityService?: AiEntityService,
  ) {}

  validateContract(contract: CapabilityContract): CapabilityContract {
    return CapabilityContractSchema.parse(contract);
  }

  async listAvailableToolItems(context: AiExecutionContextWithManager): Promise<AiToolListItemDto[]> {
    return this.tools.listAvailableTools(context);
  }

  async listAvailableCapabilities(context: AiExecutionContextWithManager): Promise<CapabilityContract[]> {
    const tools = await this.listAvailableToolItems(context);
    const schemas = new Map(this.tools.toToolJsonSchemas(tools).map((schema) => [schema.name, schema.parameters]));
    return [
      ...tools.map((tool) => compatibilityContract(tool, schemas.get(tool.name) as Record<string, unknown>)),
      ...Array.from(this.providerContracts.values()),
      ...(this.externalMcpBridge ? await this.externalMcpBridge.listCapabilityContracts(context) : []),
    ];
  }

  async getToolJsonSchemas(context: AiExecutionContextWithManager): Promise<AiProviderToolDef[]> {
    const capabilities = await this.listAvailableCapabilities(context);
    return capabilities
      .filter((capability) => capability.supported_surfaces.includes(toCapabilitySurface(context.surface)))
      .filter((capability) => context.surface !== 'mcp' || (
        capability.effect === 'read'
        && capability.default_approval === 'none'
        && capability.mcp_exposure.enabled
        && capability.mcp_exposure.read_only
      ))
      .map((capability) => ({
        name: capability.name,
        description: capability.description,
        parameters: capability.input_schema,
      }));
  }

  toToolJsonSchemas(tools: Array<Pick<AiToolListItemDto, 'name'>>): AiProviderToolDef[] {
    return this.tools.toToolJsonSchemas(tools);
  }

  /**
   * A capability KANAP declares under this name, whatever the person, the settings or the key:
   * whether it only reads and whether MCP may offer it. Null for a name KANAP does not know.
   * The MCP server uses it to say why a call is refused (ai-mcp-exposure.service.ts).
   */
  describeRegisteredCapability(name: string): { reads: boolean; mcpReadable: boolean } | null {
    const tool = this.tools.listRegisteredTools().find((candidate) => candidate.name === name);
    if (tool) {
      return { reads: tool.readOnly, mcpReadable: tool.readOnly && tool.surfaces.includes('mcp') };
    }
    const contract = this.providerContracts.get(name) ?? this.internalContracts.get(name);
    if (!contract) {
      return null;
    }
    const reads = contract.effect === 'read';
    return {
      reads,
      mcpReadable: reads
        && contract.default_approval === 'none'
        && contract.supported_surfaces.includes('mcp')
        && contract.mcp_exposure.enabled
        && contract.mcp_exposure.read_only,
    };
  }

  async resolve(
    context: AiExecutionContextWithManager,
    capabilityName: string,
    version = COMPATIBILITY_CAPABILITY_VERSION,
    surface?: CapabilitySurface,
  ): Promise<ResolvedCapability> {
    const effectiveSurface = surface ?? toCapabilitySurface(context.surface);
    // An internal contract shares its name with the chat/MCP tool it wraps
    // (search_knowledge, get_document): it is only selected when the effective
    // surface is one it declares, otherwise resolution falls through to the
    // tool compatibility contract so chat and MCP keep their tool surfaces.
    const internal = this.internalContracts.get(capabilityName);
    if (internal && internal.supported_surfaces.includes(effectiveSurface)) {
      if (version !== internal.version) {
        throw new NotFoundException('Unknown capability version.');
      }
      return {
        contract: internal,
        handler: async (ctx, input) => this.executeInternalCapability(ctx, internal.name, input),
      };
    }

    const providerContract = this.providerContracts.get(capabilityName);
    if (providerContract) {
      if (version !== providerContract.version) {
        throw new NotFoundException('Unknown capability version.');
      }
      return {
        contract: providerContract,
        handler: (ctx, input, execution) => this.executeProviderCapability(ctx, providerContract.name, input, execution),
      };
    }

    const externalMcpContract = this.externalMcpBridge
      ? await this.externalMcpBridge.resolveCapabilityContract(context, capabilityName, version)
      : null;
    if (externalMcpContract) {
      return {
        contract: externalMcpContract,
        handler: (ctx, input, execution) => this.externalMcpBridge!.executeTool(ctx, externalMcpContract, input, execution),
      };
    }

    const available = await this.listAvailableCapabilities(context);
    const contract = available.find((capability) =>
      capability.name === capabilityName && capability.version === version,
    );
    if (!contract) {
      throw new NotFoundException('Unknown or unavailable capability.');
    }
    const toolName = contract.compatibility.ai_tool_name;
    if (!toolName) {
      throw new NotFoundException('Capability has no executable handler.');
    }
    return {
      contract,
      handler: async (ctx, input) => this.tools.execute(ctx, toolName, input),
    };
  }

  private async executeInternalCapability(
    context: AiExecutionContextWithManager,
    capabilityName: string,
    rawInput: unknown,
  ): Promise<unknown> {
    switch (capabilityName) {
      case EXECUTE_APPROVED_PREVIEW_CAPABILITY:
        return this.executeApprovedPreview(context, rawInput);
      case 'search_knowledge':
        return this.searchKnowledgeInternal(context, rawInput);
      case 'get_document':
        return this.getDocumentInternal(context, rawInput);
      case 'web_search':
        return this.webSearchInternal(context, rawInput);
      case KANAP_ENTITY_SEARCH_CAPABILITY:
        return this.searchEntitiesInternal(context, rawInput);
      case KANAP_ENTITY_DETAIL_CAPABILITY:
        return this.getEntityDetailInternal(context, rawInput);
      case KANAP_ENTITY_CONTEXT_CAPABILITY:
        return this.getEntityContextInternal(context, rawInput);
      default:
        throw new NotFoundException('Unknown internal capability.');
    }
  }

  private knowledgeServices(): { policy: AiPolicyService; knowledge: KnowledgeService } {
    if (!this.policy || !this.knowledge) {
      throw new BadRequestException('Internal knowledge capabilities are not configured.');
    }
    return { policy: this.policy, knowledge: this.knowledge };
  }

  private async searchKnowledgeInternal(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
  ): Promise<unknown> {
    const { policy, knowledge } = this.knowledgeServices();
    const parsed = InternalKnowledgeSearchInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    await policy.assertKnowledgeReadAccess(context, context.manager);
    const result = await knowledge.search(
      {
        q: parsed.data.query,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
        matchMode: 'any',
        ...(parsed.data.library_ids && parsed.data.library_ids.length > 0 ? { library_ids: parsed.data.library_ids } : {}),
      },
      { manager: context.manager, userId: context.userId },
    );
    return {
      items: (result.items || []).map((item: any): AiKnowledgeSearchResultDto => ({
        id: item.id,
        ref: `DOC-${item.item_number}`,
        title: item.title,
        summary: item.summary ?? null,
        status: item.status,
        snippet: item.snippet ?? null,
        score: Number.isFinite(Number(item.score ?? item.rank))
          ? Number(item.score ?? item.rank)
          : null,
        library: {
          id: item.library_id ?? null,
          name: item.library_name ?? null,
        },
        updated_at: item.updated_at ? new Date(item.updated_at).toISOString() : null,
      })),
      total: result.total ?? 0,
      offset: result.offset ?? parsed.data.offset,
      limit: result.limit ?? parsed.data.limit,
      returned: Array.isArray(result.items) ? result.items.length : 0,
      truncated: result.truncated === true,
      complete: result.truncated !== true,
    };
  }

  private async webSearchInternal(
    _context: AiExecutionContextWithManager,
    rawInput: unknown,
  ): Promise<unknown> {
    if (!this.braveSearch) {
      throw new BadRequestException('Web search capability is not configured.');
    }
    const parsed = InternalWebSearchInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    // BraveSearchService.search() sanitises the query to public-only terms (stripping UUIDs,
    // PRJ/REQ/DOC/T-N refs, emails, internal hostnames) and throws if nothing public-meaningful
    // remains, so no tenant-internal data leaves the control plane.
    const results: BraveSearchResult[] = await this.braveSearch.search(parsed.data.query, { count: parsed.data.count });
    return {
      items: results.map((result) => ({
        title: result.title ?? '',
        url: result.url ?? '',
        description: result.description ?? '',
      })),
      total: null,
      returned: results.length,
      truncated: false,
      complete: false,
    };
  }

  private async getDocumentInternal(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
  ): Promise<unknown> {
    const { policy, knowledge } = this.knowledgeServices();
    const parsed = InternalKnowledgeDocumentInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    await policy.assertKnowledgeReadAccess(context, context.manager);
    const document = await knowledge.get(parsed.data.document_id, { manager: context.manager, userId: context.userId });
    if (!document) {
      throw new NotFoundException('Document not found.');
    }
    const result: AiDocumentDto = {
      id: document.id,
      ref: document.item_ref ?? `DOC-${document.item_number}`,
      title: document.title,
      summary: document.summary ?? null,
      content_markdown: document.content_markdown ?? '',
      status: document.status,
      library: {
        id: document.library_id ?? document.library?.id ?? null,
        name: document.library_name ?? document.library?.name ?? null,
        slug: document.library_slug ?? document.library?.slug ?? null,
      },
      folder: {
        id: document.folder_id ?? document.folder?.id ?? null,
        name: document.folder_name ?? document.folder?.name ?? null,
      },
      document_type: {
        id: document.document_type_id ?? document.document_type?.id ?? null,
        name: document.document_type_name ?? document.document_type?.name ?? null,
      },
      contributors: (document.contributors || []).map((contributor: any) => ({
        name: contributor.user_name ?? contributor.name ?? 'Unknown user',
        role: contributor.role,
        is_primary: contributor.is_primary === true,
      })),
      relations: document.relations ?? {},
      updated_at: document.updated_at ? new Date(document.updated_at).toISOString() : null,
      total: 1,
      returned: 1,
      truncated: false,
      complete: true,
    };
    return result;
  }

  // Absent optional deps (registry constructed without the entity read layer, e.g. in
  // isolated specs or a module that does not provide AiQueryExecutor/AiEntityService)
  // surface as a structured CapabilityApplicability-style result instead of a throw, so
  // callers degrade to "source unavailable" like any other skipped enrichment domain.
  private entityCapabilityUnavailable(): Record<string, unknown> {
    return {
      available: false,
      reasonCode: 'provider_not_configured',
      message: 'KANAP entity data access is not configured.',
    };
  }

  private async searchEntitiesInternal(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
  ): Promise<unknown> {
    if (!this.policy || !this.queryExecutor) {
      return this.entityCapabilityUnavailable();
    }
    const parsed = InternalEntitySearchInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    await this.policy.assertEntityTypeReadAccess(context, parsed.data.entity_type, context.manager);
    const result = await this.queryExecutor.execute(context, {
      entity_type: parsed.data.entity_type,
      q: parsed.data.q,
      page: 1,
      limit: parsed.data.limit,
    });
    const allItems = Array.isArray(result.items) ? result.items : [];
    const items = allItems.slice(0, parsed.data.limit);
    return {
      items,
      total: result.total ?? 0,
      returned: items.length,
      truncated: result.truncated === true || items.length < allItems.length,
      complete: result.complete === true && items.length === allItems.length,
    };
  }

  private async getEntityDetailInternal(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
  ): Promise<unknown> {
    if (!this.policy || !this.queryExecutor) {
      return this.entityCapabilityUnavailable();
    }
    const parsed = InternalEntityDetailInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    await this.policy.assertEntityTypeReadAccess(context, parsed.data.entity_type, context.manager);
    const result = await this.queryExecutor.executeDetail(context, {
      entity_type: parsed.data.entity_type,
      entity_id: parsed.data.entity_id,
    });
    const data = compactEntityDetailData(result.data);
    const truncated = Object.keys(data).length < Object.keys(result.data).length;
    return {
      entity: result.entity,
      data,
      total: 1,
      returned: 1,
      truncated,
      complete: !truncated && result.complete !== false,
    };
  }

  private async getEntityContextInternal(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
  ): Promise<unknown> {
    if (!this.policy || !this.entityService) {
      return this.entityCapabilityUnavailable();
    }
    const parsed = InternalEntityContextInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    // getEntityContext asserts the same permission internally; asserting here first keeps
    // the handler pattern uniform with the other internal capabilities.
    await this.policy.assertEntityTypeReadAccess(context, parsed.data.entity_type, context.manager);
    const result = await this.entityService.getEntityContext(context, {
      entity_type: parsed.data.entity_type,
      entity_id: parsed.data.entity_id,
    });
    return {
      ...result,
      related: (result.related ?? []).slice(0, MAX_ENTITY_CONTEXT_GROUPS).map((group) => ({
        ...group,
        items: (group.items ?? []).slice(0, MAX_ENTITY_CONTEXT_GROUP_ITEMS),
      })),
    };
  }

  private async executeApprovedPreview(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
  ): Promise<unknown> {
    const parsed = ExecuteApprovedPreviewInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }

    const actions = [];
    for (const previewId of parsed.data.preview_ids) {
      const action = await this.actions.ensureForPreview(context, previewId, {
        capabilityName: EXECUTE_APPROVED_PREVIEW_CAPABILITY,
        capabilityVersion: '1.0.0',
        effect: 'write',
      });
      await this.approvals.resolveApprovedAction(context, action);
      actions.push(action);
    }

    const execution = await this.previews.executePreviewsWithFollowUps(
      context,
      parsed.data.preview_ids,
    );

    for (const result of execution.results) {
      const action = actions.find((candidate) => candidate.preview_id === result.preview_id);
      if (!action) {
        continue;
      }
      const status = result.status === 'executed'
        ? 'executed'
        : result.status === 'expired'
          ? 'expired'
          : result.status === 'rejected'
            ? 'rejected'
            : result.status === 'failed'
              ? 'failed'
              : action.status;
      await this.actions.markExecuted(context, action, status, result.error_message ?? null);
    }

    return execution;
  }

  private async executeProviderCapability(
    context: AiExecutionContextWithManager,
    capabilityName: string,
    rawInput: unknown,
    execution: CapabilityExecutionContext,
  ): Promise<unknown> {
    switch (capabilityName) {
      case 'monitoring.alert.get': {
        const provider = await this.providers.monitoring(context, providerKey(rawInput));
        return provider.getAlert(context, { alertId: stringField(rawInput, 'alert_id') });
      }
      case 'monitoring.sensor.history': {
        const provider = await this.providers.monitoring(context, providerKey(rawInput));
        return provider.getSensorHistory(context, {
          sensorId: stringField(rawInput, 'sensor_id'),
          windowMinutes: optionalNumberField(rawInput, 'window_minutes'),
        });
      }
      case 'monitoring.state.get': {
        const provider = await this.providers.monitoring(context, providerKey(rawInput));
        return provider.getCurrentState(context, { sensorId: stringField(rawInput, 'sensor_id') });
      }
      case 'monitoring.alert.related.list': {
        const provider = await this.providers.monitoring(context, providerKey(rawInput));
        return provider.listRelatedAlerts(context, {
          sensorId: stringField(rawInput, 'sensor_id'),
          limit: optionalNumberField(rawInput, 'limit'),
        });
      }
      case 'monitoring.object.get': {
        const provider = await this.providers.monitoring(context, providerKey(rawInput));
        return provider.getMonitoredObject(context, { objectId: stringField(rawInput, 'object_id') });
      }
      case 'virtualization.vm.health': {
        const provider = await this.providers.virtualization(context, providerKey(rawInput));
        return provider.getVmHealth(context, { vmId: stringField(rawInput, 'vm_id') });
      }
      case 'ticketing.ticket.get': {
        const provider = await this.providers.ticketing(context, providerKey(rawInput));
        return provider.getTicket(context, { ticketId: stringField(rawInput, 'ticket_id') });
      }
      case 'ticketing.ticket.search_similar': {
        const provider = await this.providers.ticketing(context, providerKey(rawInput));
        return provider.searchSimilarTickets(context, {
          query: stringField(rawInput, 'query'),
          ticketId: optionalStringField(rawInput, 'ticket_id'),
          limit: optionalNumberField(rawInput, 'limit'),
        });
      }
      case TICKETING_TICKET_NOTES_LIST_CAPABILITY: {
        const provider = await this.providers.ticketing(context, providerKey(rawInput));
        return provider.listTicketNotes(context, { ticketId: stringField(rawInput, 'ticket_id') });
      }
      case TICKETING_TICKET_ATTACHMENT_READ_CAPABILITY: {
        const provider = await this.providers.ticketing(context, providerKey(rawInput));
        return provider.readTicketAttachment(context, {
          ticketId: stringField(rawInput, 'ticket_id'),
          target: stringField(rawInput, 'target'),
          source: optionalStringField(rawInput, 'source') as any,
          sourceNoteId: optionalStringField(rawInput, 'source_note_id'),
        });
      }
      case TICKETING_CLASSIFICATION_CONTEXT_CAPABILITY: {
        const provider = await this.providers.ticketing(context, providerKey(rawInput));
        return provider.getTicketClassificationContext(context, {
          ticketId: stringField(rawInput, 'ticket_id'),
          categoryScopeKeys: isRecord(rawInput) && Array.isArray(rawInput.category_scope_keys) ? rawInput.category_scope_keys.map(String) : undefined,
        });
      }
      case TICKETING_LIFECYCLE_CONTEXT_CAPABILITY: {
        const provider = await this.providers.ticketing(context, providerKey(rawInput));
        return provider.getTicketLifecycleContext(context, { ticketId: stringField(rawInput, 'ticket_id') });
      }
      case TICKETING_ROUTING_CONTEXT_CAPABILITY: {
        const provider = await this.providers.ticketing(context, providerKey(rawInput));
        return provider.getTicketRoutingContext(context, { ticketId: stringField(rawInput, 'ticket_id') });
      }
      case TICKETING_PARTICIPANT_CONTEXT_CAPABILITY: {
        const provider = await this.providers.ticketing(context, providerKey(rawInput));
        return provider.getTicketParticipantContext(context, { ticketId: stringField(rawInput, 'ticket_id') });
      }
      case TICKETING_CLASSIFICATION_UPDATE_PREPARE_CAPABILITY:
        return this.prepareTicketClassificationUpdate(context, rawInput, execution);
      case TICKETING_CLASSIFICATION_UPDATE_APPROVED_CAPABILITY:
        return this.updateApprovedTicketClassification(context, rawInput);
      case TICKETING_STATUS_UPDATE_PREPARE_CAPABILITY:
        return this.prepareTicketStatusUpdate(context, rawInput, execution);
      case TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY:
        return this.updateApprovedTicketStatus(context, rawInput);
      case TICKETING_ASSIGNMENT_UPDATE_PREPARE_CAPABILITY:
        return this.prepareTicketAssignmentUpdate(context, rawInput, execution);
      case TICKETING_ASSIGNMENT_UPDATE_APPROVED_CAPABILITY:
        return this.updateApprovedTicketAssignment(context, rawInput);
      case TICKETING_PARTICIPANT_UPDATE_PREPARE_CAPABILITY:
        return this.prepareTicketParticipantUpdate(context, rawInput, execution);
      case TICKETING_PARTICIPANT_UPDATE_APPROVED_CAPABILITY:
        return this.updateApprovedTicketParticipants(context, rawInput);
      case TICKETING_INTERNAL_NOTE_PREPARE_CAPABILITY:
        return this.prepareInternalNoteAction(context, rawInput, execution);
      case TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY:
        return this.addApprovedInternalNote(context, rawInput);
      case TICKETING_PUBLIC_REPLY_PREPARE_CAPABILITY:
        return this.preparePublicReplyAction(context, rawInput, execution);
      case TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY:
        return this.addApprovedPublicReply(context, rawInput);
      case AUTOMATION_JOB_ALLOWED_LIST_CAPABILITY:
        return this.listAllowedAutomationJobs(context, rawInput);
      case AUTOMATION_JOB_SCHEMA_GET_CAPABILITY:
        return this.getAutomationJobSchema(context, rawInput);
      case AUTOMATION_JOB_DRY_RUN_CAPABILITY:
        return this.dryRunAutomationJob(context, rawInput);
      case AUTOMATION_JOB_LAUNCH_PREPARE_CAPABILITY:
        return this.prepareAutomationLaunch(context, rawInput, execution);
      case AUTOMATION_JOB_LAUNCH_APPROVED_CAPABILITY:
        return this.launchApprovedAutomationJob(context, rawInput);
      case AUTOMATION_JOB_STATUS_GET_CAPABILITY:
        return this.getAutomationJobStatus(context, rawInput);
      case AUTOMATION_JOB_OUTPUT_GET_CAPABILITY:
        return this.getAutomationJobOutput(context, rawInput);
      case 'directory.user.context': {
        const provider = await this.providers.directory(context, providerKey(rawInput));
        return provider.getUserContext(context, { userIdOrEmail: stringField(rawInput, 'user_id_or_email') });
      }
      default:
        throw new NotFoundException('Unknown provider capability.');
    }
  }

  private async ticketFreshnessMetadata(
    context: AiExecutionContextWithManager,
    provider: TicketingProvider,
    ticketId: string,
  ): Promise<Record<string, unknown>> {
    const ticket = await provider.getTicket(context, { ticketId });
    if (ticket.ok === false) {
      return {};
    }
    return {
      proposal_ticket_updated_at: ticketFreshnessUpdatedAt(ticket.data),
      proposal_ticket_hash: ticketFreshnessHash(ticket.data),
    };
  }

  private async enqueueFreshReviewAfterStaleAction(
    context: AiExecutionContextWithManager,
    action: AiActionRequest,
    ticket: TicketRecord,
    reason: string,
  ): Promise<void> {
    if (!this.agentQueue || !action.target_ref || !action.provider_kind || !action.provider_key || !action.target_type) {
      return;
    }
    const metadata = isRecord(action.metadata_json) ? action.metadata_json : null;
    const definitionId = typeof metadata?.agent_definition_id === 'string' ? metadata.agent_definition_id : null;
    if (!definitionId) {
      return;
    }
    const definition = await context.manager.getRepository(AiAgentDefinition).findOne({
      where: {
        id: definitionId,
        tenant_id: context.tenantId,
      },
    });
    if (!definition) {
      return;
    }
    await this.agentQueue.resolveWaitingApprovalForActionRequest(context, action.id);
    await this.agentQueue.releaseTargetClaim(context, {
      agentDefinitionId: definition.id,
      providerKind: action.provider_kind,
      providerKey: action.provider_key,
      targetType: action.target_type,
      targetRef: action.target_ref,
      reason,
    });
    if (action.provider_kind !== 'ticketing' || action.target_type !== 'ticket') {
      return;
    }
    await this.agentQueue.enqueueTicketingScopedTicket(context, {
      definition,
      ticket,
      // Follow-up of a human-approved write, not a cron cycle: it must still
      // re-queue when the agent runs in Manual mode (watching off).
      trigger: 'manual',
      providerKind: action.provider_kind,
      providerKey: action.provider_key,
      metadata: {
        source: 'execute_time_stale_re_review',
        stale_action_request_id: action.id,
        stale_reason: reason,
      },
    });
  }

  private async verifyTicketFreshnessPolicy<T>(
    context: AiExecutionContextWithManager,
    provider: TicketingProvider,
    action: AiActionRequest,
    options: { terminal?: boolean } = {},
  ): Promise<AdapterResult<T> | null> {
    if (!action.target_ref) {
      const message = 'Cannot verify ticket freshness because the action target is missing.';
      await this.actions.markExecuted(context, action, 'failed', message);
      return ticketWriteGuardError<T>(message);
    }
    const current = await provider.getTicket(context, { ticketId: action.target_ref });
    if (current.ok === false) {
      const message = `Cannot verify ticket freshness before the ticketing write: ${current.message}`;
      await this.actions.markExecuted(context, action, 'failed', message);
      return ticketWriteGuardError<T>(message);
    }
    if (!ticketFreshnessChanged(action, current.data)) {
      return null;
    }

    const ownWrites = await this.ticketFreshnessChangeIsOnlyKanapWrites(
      context,
      action,
      current.data,
    );
    if (ownWrites) {
      action.metadata_json = {
        ...(isRecord(action.metadata_json) ? action.metadata_json : {}),
        same_run_freshness_override: {
          mode: ownWrites.mode,
          checked_at: new Date().toISOString(),
          current_ticket_updated_at: ticketFreshnessUpdatedAt(current.data),
          sibling_action_request_ids: ownWrites.actions.map((sibling) => sibling.id),
        },
      };
      action.updated_at = new Date();
      await context.manager.getRepository(AiActionRequest).save(action);
      return null;
    }

    const actionClass = approvedActionClass(action.capability_name);
    const configuredPolicy = serviceDeskOnStalePolicy(action, actionClass);
    const canApplyAnyway = configuredPolicy === 'apply_anyway'
      && APPLY_ANYWAY_ACTION_CLASSES.has(actionClass)
      && options.terminal !== true;
    if (canApplyAnyway) {
      action.metadata_json = {
        ...(isRecord(action.metadata_json) ? action.metadata_json : {}),
        stale_policy_override: {
          mode: 'apply_anyway',
          checked_at: new Date().toISOString(),
          current_ticket_updated_at: ticketFreshnessUpdatedAt(current.data),
          current_ticket_hash: ticketFreshnessHash(current.data),
        },
      };
      action.updated_at = new Date();
      await context.manager.getRepository(AiActionRequest).save(action);
      return null;
    }

    if (configuredPolicy === 'cancel') {
      const message = options.terminal === true
        ? 'Terminal ticket update blocked because the ticket changed after proposal.'
        : 'Ticket changed after this action was prepared; action was canceled.';
      await this.actions.markExpired(context, action, message);
      return ticketWriteGuardError<T>(message);
    }

    const message = options.terminal === true
      ? 'Terminal ticket update blocked because the ticket changed after proposal; a fresh review was queued.'
      : 'Ticket changed after this action was prepared; a fresh review was queued.';
    await this.actions.markExpired(context, action, message);
    await this.enqueueFreshReviewAfterStaleAction(context, action, current.data, 'stale_at_execute_re_review');
    return ticketWriteGuardError<T>(message);
  }

  private async sameRunExecutedSiblingActions(
    context: AiExecutionContextWithManager,
    action: ProviderActionForExecution,
  ): Promise<AiActionRequest[]> {
    if (!action.run_id || !action.target_ref) {
      return [];
    }
    const actionMetadata = isRecord(action.metadata_json) ? action.metadata_json : null;
    const actionWorkItemId = stringMetadataField(actionMetadata, 'agent_work_item_id');
    const siblings = await context.manager.getRepository(AiActionRequest).find({
      where: {
        tenant_id: context.tenantId,
        run_id: action.run_id,
        target_ref: action.target_ref,
        status: 'executed',
        // TypeORM skips null/undefined where values, so a null column simply adds no predicate.
        ...(action.target_type != null ? { target_type: action.target_type } : {}),
        ...(action.provider_kind != null ? { provider_kind: action.provider_kind } : {}),
        ...(action.provider_key != null ? { provider_key: action.provider_key } : {}),
      },
    });
    return siblings.filter((sibling) => {
      if (sibling.id === action.id) {
        return false;
      }
      const siblingMetadata = isRecord(sibling.metadata_json) ? sibling.metadata_json : null;
      const siblingWorkItemId = stringMetadataField(siblingMetadata, 'agent_work_item_id');
      return !actionWorkItemId || siblingWorkItemId === actionWorkItemId;
    });
  }

  // The most recent KANAP write on this ticket, when the ticket is still exactly in the
  // state that write left behind. Identity by value: no clock, no timezone, and a human
  // edit landing after our write changes the hash, so the match simply fails.
  private async latestKanapWriteMatchingTicketState(
    context: AiExecutionContextWithManager,
    action: AiActionRequest,
    ticket: TicketRecord,
  ): Promise<AiActionRequest | null> {
    if (!action.target_ref || !action.target_type || !action.provider_kind || !action.provider_key) {
      return null;
    }
    const executed = await context.manager.getRepository(AiActionRequest).find({
      where: {
        tenant_id: context.tenantId,
        target_type: action.target_type,
        target_ref: action.target_ref,
        provider_kind: action.provider_kind,
        provider_key: action.provider_key,
        status: 'executed',
      },
      order: { executed_at: 'DESC' },
      take: 25,
    });
    const latest = executed.find((candidate) => candidate.id !== action.id
      && actionPostWriteTicketBaseline(candidate) != null);
    if (!latest) {
      return null;
    }
    const baseline = actionPostWriteTicketBaseline(latest);
    return baseline && ticketMatchesPostWriteBaseline(baseline, ticket) ? latest : null;
  }

  private async ticketFreshnessChangeIsOnlyKanapWrites(
    context: AiExecutionContextWithManager,
    action: AiActionRequest,
    ticket: TicketRecord,
  ): Promise<{ mode: string; actions: AiActionRequest[] } | null> {
    const ownWrite = await this.latestKanapWriteMatchingTicketState(context, action, ticket);
    const siblings = await this.sameRunExecutedSiblingActions(context, action);
    if (ownWrite) {
      const actions = siblings.some((sibling) => sibling.id === ownWrite.id)
        ? siblings
        : [ownWrite, ...siblings];
      return { mode: 'allow_after_kanap_write_baseline_match', actions };
    }

    if (siblings.length === 0) {
      return null;
    }

    // Secondary path for actions with no recorded post-write baseline (older rows, or a
    // ticket re-read that failed right after the write). It is clock-based, so it only
    // applies when the provider reports an unambiguous, zone-carrying timestamp.
    const currentUpdatedAtMs = absoluteTimestampMs(ticketFreshnessUpdatedAt(ticket));
    if (currentUpdatedAtMs == null) {
      return null;
    }
    const siblingTimestamps = siblings.map((sibling) => {
      const value = sibling.executed_at ?? sibling.updated_at ?? sibling.approved_at ?? sibling.created_at;
      return value instanceof Date ? value.getTime() : Date.parse(String(value));
    }).filter((value) => Number.isFinite(value));
    if (siblingTimestamps.length === 0) {
      return null;
    }
    const latestSiblingMs = Math.max(...siblingTimestamps);
    if (currentUpdatedAtMs > latestSiblingMs + 5 * 60 * 1000) {
      return null;
    }

    return { mode: 'allow_after_same_run_sibling_writes', actions: siblings };
  }

  private async refreshApprovedBatchSiblingBaselines(
    context: AiExecutionContextWithManager,
    action: AiActionRequest,
    ticket: TicketRecord,
  ): Promise<void> {
    const batchIds = approvedBatchActionRequestIds(action.metadata_json)
      .filter((id) => id !== action.id);
    if (batchIds.length === 0) {
      return;
    }
    const repo = context.manager.getRepository(AiActionRequest);
    const siblings = await repo.find({
      where: {
        tenant_id: context.tenantId,
        id: In(batchIds),
        status: In(['pending', 'approved']),
      },
    });
    if (siblings.length === 0) {
      return;
    }
    const updatedAt = ticketFreshnessUpdatedAt(ticket);
    const hash = ticketFreshnessHash(ticket);
    const now = new Date();
    for (const sibling of siblings) {
      sibling.metadata_json = {
        ...(isRecord(sibling.metadata_json) ? sibling.metadata_json : {}),
        proposal_ticket_updated_at: updatedAt,
        proposal_ticket_hash: hash,
        approved_batch_baseline_refresh: {
          source_action_request_id: action.id,
          refreshed_at: now.toISOString(),
          ticket_updated_at: updatedAt,
        },
      };
      sibling.updated_at = now;
      await repo.save(sibling);
    }
  }

  private async recordPostWriteTargetBaseline(
    context: AiExecutionContextWithManager,
    provider: TicketingProvider,
    action: AiActionRequest,
  ): Promise<void> {
    if (!action.target_ref || !action.provider_kind || !action.provider_key || !action.target_type) {
      return;
    }
    const ticket = await provider.getTicket(context, { ticketId: action.target_ref });
    if (ticket.ok === false) {
      return;
    }
    // Record the state this write left behind on the action itself. Sibling actions on the
    // same ticket compare the live ticket to this baseline by value, which is what makes the
    // "only our own writes changed it" tolerance independent of the ticketing server clock.
    const recordedAt = new Date();
    action.metadata_json = {
      ...(isRecord(action.metadata_json) ? action.metadata_json : {}),
      post_write_ticket_baseline: {
        ticket_updated_at: ticketFreshnessUpdatedAt(ticket.data),
        ticket_hash: ticketFreshnessHash(ticket.data),
        recorded_at: recordedAt.toISOString(),
      },
    };
    action.updated_at = recordedAt;
    await context.manager.getRepository(AiActionRequest).save(action);

    await this.refreshApprovedBatchSiblingBaselines(context, action, ticket.data);
    if (!this.agentQueue) {
      return;
    }
    const metadata = isRecord(action.metadata_json) ? action.metadata_json : null;
    const definitionId = typeof metadata?.agent_definition_id === 'string' ? metadata.agent_definition_id : null;
    if (!definitionId) {
      return;
    }
    const definition = await context.manager.getRepository(AiAgentDefinition).findOne({
      where: {
        id: definitionId,
        tenant_id: context.tenantId,
      },
    });
    if (!definition) {
      return;
    }
    await this.agentQueue.upsertTargetState(context, {
      agentDefinitionId: definition.id,
      providerKind: action.provider_kind,
      providerKey: action.provider_key,
      targetType: action.target_type,
      targetRef: action.target_ref,
      lastSeenExternalUpdatedAt: ticketFreshnessUpdatedAt(ticket.data),
      lastProcessedExternalUpdatedAt: ticketFreshnessUpdatedAt(ticket.data),
      nextReviewAt: this.agentQueue.scheduleNextReviewAt(definition),
      lastRunId: action.run_id ?? null,
      agentTouched: true,
      state: {
        post_write_ticket_hash: ticketFreshnessHash(ticket.data),
        post_write_recorded_at: new Date().toISOString(),
        post_write_action_request_id: action.id,
      },
    });
  }

  private async prepareTicketClassificationUpdate(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
    execution: CapabilityExecutionContext,
  ): Promise<unknown> {
    const parsed = PrepareClassificationUpdateInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    const providerKeyValue = parsed.data.provider_key ?? 'mock';
    const provider = await this.providers.ticketing(context, providerKeyValue);
    const prepared = await provider.prepareTicketClassificationUpdate(context, {
      ticketId: parsed.data.ticket_id,
      proposed: parsed.data.proposed,
      reason: parsed.data.reason,
    });
    if (!prepared.ok) {
      return prepared;
    }
    const actionPayload = prepared.data.actionPayload;
    const freshnessMetadata = await this.ticketFreshnessMetadata(context, provider, actionPayload.ticketId);
    const idempotencyKey = this.actions.providerActionIdempotencyKey({
      tenantId: context.tenantId,
      providerKey: providerKeyValue,
      ticketId: actionPayload.ticketId,
      // The whole payload, not a projection of it: the action request's input_hash covers
      // the whole payload, so a key built from a subset can collide with a pending row whose
      // hash differs (same target, LLM reworded `reason`, or a moved `current` snapshot) and
      // createOrEnsureProviderAction would then throw and abort the run instead of superseding.
      noteBody: stableJson(actionPayload),
      capabilityVersion: PROVIDER_CAPABILITY_VERSION,
    });
    const action = await this.actions.createOrEnsureProviderAction(context, {
      runId: execution.runId ?? null,
      toolExecutionId: execution.toolExecutionId ?? null,
      capabilityName: TICKETING_CLASSIFICATION_UPDATE_APPROVED_CAPABILITY,
      capabilityVersion: PROVIDER_CAPABILITY_VERSION,
      effect: 'write',
      providerKind: 'ticketing',
      providerKey: providerKeyValue,
      targetType: 'ticket',
      targetRef: actionPayload.ticketId,
      actionPayload: actionPayload as unknown as Record<string, unknown>,
      idempotencyKey,
      evidenceIds: parsed.data.evidence_ids ?? null,
      inputSummary: {
        provider_kind: 'ticketing',
        provider_key: providerKeyValue,
        target_type: 'ticket',
        target_ref: actionPayload.ticketId,
        action: 'classification_update',
        proposed: actionPayload.proposed,
      },
      metadata: {
        ...(isRecord(execution.metadata) ? execution.metadata : {}),
        ...freshnessMetadata,
        observation_id: parsed.data.observation_id ?? null,
        recommendation_id: parsed.data.recommendation_id ?? null,
        decision_id: parsed.data.decision_id ?? null,
        evaluation_id: parsed.data.evaluation_id ?? null,
        update_kind: 'classification',
      },
      expiresAt: serviceDeskProposalExpiry(execution),
      retryAfterStatuses: shouldCreateFreshHelpdeskTriageProposal(execution)
        ? HELPDESK_TRIAGE_RETRY_AFTER_STATUSES
        : null,
    });
    return withActionRequestData(prepared, {
      action_request_id: action.id,
      action_request_status: action.status,
      capability_name: action.capability_name,
      capability_version: action.capability_version,
      idempotency_key: action.idempotency_key,
      target: { type: action.target_type, ref: action.target_ref },
    });
  }

  private async updateApprovedTicketClassification(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
  ): Promise<unknown> {
    const parsed = AddApprovedClassificationUpdateInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    const action = await this.actions.findProviderActionForExecution(context, parsed.data.action_request_id);
    this.actions.verifyProviderActionIntegrity(action);
    if (!isTicketClassificationUpdatePayload(action.action_payload_json)) {
      throw new BadRequestException('Action request does not contain a valid classification update payload.');
    }
    const provider = await this.providers.ticketing(context, action.provider_key ?? 'mock');
    const freshnessGuard = await this.verifyTicketFreshnessPolicy<TicketProviderActionWriteResult>(context, provider, action);
    if (freshnessGuard) {
      return freshnessGuard;
    }
    const current = await provider.getTicketClassificationContext(context, { ticketId: action.action_payload_json.ticketId });
    if (current.ok === false) {
      const message = `Cannot verify ticket classification freshness before write: ${current.message}`;
      await this.actions.markExecuted(context, action, 'failed', message);
      return ticketWriteGuardError<TicketProviderActionWriteResult>(message);
    }
    if (!actionHasApplyAnywayOverride(action) && !sameSnapshot(classificationDriftSnapshot(action.action_payload_json.current), classificationDriftSnapshot(current.data))) {
      const message = 'Ticket classification changed after this action was prepared. Rerun triage before approving this write.';
      await this.actions.markExecuted(context, action, 'failed', message);
      return ticketWriteGuardError<TicketProviderActionWriteResult>(message);
    }
    const result = await provider.updateTicketClassification(context, {
      actionPayload: action.action_payload_json,
      idempotencyKey: action.idempotency_key ?? '',
    });
    if (result.ok === false) {
      await this.actions.markExecuted(context, action, 'failed', result.message);
      return result;
    }
    action.metadata_json = {
      ...(isRecord(action.metadata_json) ? action.metadata_json : {}),
      provider_result: {
        ticket_id: result.data.ticketId,
        summary: result.data.summary,
        updated_fields: result.data.updatedFields,
        idempotency_key: result.data.idempotencyKey,
        update_kind: 'classification',
        already_applied: result.data.alreadyApplied ?? false,
      },
    };
    await this.actions.markExecuted(context, action, 'executed', null);
    await this.recordPostWriteTargetBaseline(context, provider, action);
    return withActionRequestData(result, { action_request_id: action.id });
  }

  private async prepareTicketStatusUpdate(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
    execution: CapabilityExecutionContext,
  ): Promise<unknown> {
    const parsed = PrepareStatusUpdateInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    const providerKeyValue = parsed.data.provider_key ?? 'mock';
    const provider = await this.providers.ticketing(context, providerKeyValue);
    const prepared = await provider.prepareTicketStatusUpdate(context, {
      ticketId: parsed.data.ticket_id,
      transitionKey: parsed.data.transition_key,
      reason: parsed.data.reason,
    });
    if (!prepared.ok) {
      return prepared;
    }
    const actionPayload = prepared.data.actionPayload;
    const freshnessMetadata = await this.ticketFreshnessMetadata(context, provider, actionPayload.ticketId);
    const idempotencyKey = this.actions.providerActionIdempotencyKey({
      tenantId: context.tenantId,
      providerKey: providerKeyValue,
      ticketId: actionPayload.ticketId,
      // The whole payload, not a projection of it: the action request's input_hash covers
      // the whole payload, so a key built from a subset can collide with a pending row whose
      // hash differs (same target, LLM reworded `reason`, or a moved `current` snapshot) and
      // createOrEnsureProviderAction would then throw and abort the run instead of superseding.
      noteBody: stableJson(actionPayload),
      capabilityVersion: PROVIDER_CAPABILITY_VERSION,
    });
    const action = await this.actions.createOrEnsureProviderAction(context, {
      runId: execution.runId ?? null,
      toolExecutionId: execution.toolExecutionId ?? null,
      capabilityName: TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY,
      capabilityVersion: PROVIDER_CAPABILITY_VERSION,
      effect: 'write',
      providerKind: 'ticketing',
      providerKey: providerKeyValue,
      targetType: 'ticket',
      targetRef: actionPayload.ticketId,
      actionPayload: actionPayload as unknown as Record<string, unknown>,
      idempotencyKey,
      evidenceIds: parsed.data.evidence_ids ?? null,
      inputSummary: {
        provider_kind: 'ticketing',
        provider_key: providerKeyValue,
        target_type: 'ticket',
        target_ref: actionPayload.ticketId,
        action: 'status_update',
        transition_key: actionPayload.transitionKey,
        target_status: actionPayload.targetStatus,
      },
      metadata: {
        ...(isRecord(execution.metadata) ? execution.metadata : {}),
        ...freshnessMetadata,
        observation_id: parsed.data.observation_id ?? null,
        recommendation_id: parsed.data.recommendation_id ?? null,
        decision_id: parsed.data.decision_id ?? null,
        evaluation_id: parsed.data.evaluation_id ?? null,
        update_kind: 'status',
      },
      expiresAt: serviceDeskProposalExpiry(execution),
      retryAfterStatuses: shouldCreateFreshHelpdeskTriageProposal(execution)
        ? HELPDESK_TRIAGE_RETRY_AFTER_STATUSES
        : null,
    });
    return withActionRequestData(prepared, {
      action_request_id: action.id,
      action_request_status: action.status,
      capability_name: action.capability_name,
      capability_version: action.capability_version,
      idempotency_key: action.idempotency_key,
      target: { type: action.target_type, ref: action.target_ref },
    });
  }

  private async updateApprovedTicketStatus(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
  ): Promise<unknown> {
    const parsed = AddApprovedStatusUpdateInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    const action = await this.actions.findProviderActionForExecution(context, parsed.data.action_request_id);
    this.actions.verifyProviderActionIntegrity(action);
    if (!isTicketStatusUpdatePayload(action.action_payload_json)) {
      throw new BadRequestException('Action request does not contain a valid status update payload.');
    }
    const provider = await this.providers.ticketing(context, action.provider_key ?? 'mock');
    const freshnessGuard = await this.verifyTicketFreshnessPolicy<TicketProviderActionWriteResult>(context, provider, action, {
      terminal: action.action_payload_json.terminal === true
        || TICKETING_TERMINAL_TRANSITIONS.has(action.action_payload_json.transitionKey),
    });
    if (freshnessGuard) {
      return freshnessGuard;
    }
    const current = await provider.getTicketLifecycleContext(context, { ticketId: action.action_payload_json.ticketId });
    if (current.ok === false) {
      const message = `Cannot verify ticket lifecycle freshness before write: ${current.message}`;
      await this.actions.markExecuted(context, action, 'failed', message);
      return ticketWriteGuardError<TicketProviderActionWriteResult>(message);
    }
    if (!actionHasApplyAnywayOverride(action) && !sameSnapshot(freshnessRecheckSnapshot(action.action_payload_json.current), freshnessRecheckSnapshot(current.data))) {
      const message = 'Ticket lifecycle changed after this action was prepared. Rerun triage before approving this write.';
      await this.actions.markExecuted(context, action, 'failed', message);
      return ticketWriteGuardError<TicketProviderActionWriteResult>(message);
    }
    const result = await provider.updateTicketStatus(context, {
      actionPayload: action.action_payload_json,
      idempotencyKey: action.idempotency_key ?? '',
    });
    if (result.ok === false) {
      await this.actions.markExecuted(context, action, 'failed', result.message);
      return result;
    }
    action.metadata_json = {
      ...(isRecord(action.metadata_json) ? action.metadata_json : {}),
      provider_result: {
        ticket_id: result.data.ticketId,
        summary: result.data.summary,
        updated_fields: result.data.updatedFields,
        idempotency_key: result.data.idempotencyKey,
        update_kind: 'status',
        already_applied: result.data.alreadyApplied ?? false,
      },
    };
    await this.actions.markExecuted(context, action, 'executed', null);
    await this.recordPostWriteTargetBaseline(context, provider, action);
    return withActionRequestData(result, { action_request_id: action.id });
  }

  private async prepareTicketAssignmentUpdate(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
    execution: CapabilityExecutionContext,
  ): Promise<unknown> {
    const parsed = PrepareAssignmentUpdateInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    const providerKeyValue = parsed.data.provider_key ?? 'mock';
    const provider = await this.providers.ticketing(context, providerKeyValue);
    const prepared = await provider.prepareTicketAssignmentUpdate(context, {
      ticketId: parsed.data.ticket_id,
      target: parsed.data.target as TicketRoutingTarget,
      reason: parsed.data.reason,
    });
    if (!prepared.ok) {
      return prepared;
    }
    const actionPayload = prepared.data.actionPayload;
    const freshnessMetadata = await this.ticketFreshnessMetadata(context, provider, actionPayload.ticketId);
    const idempotencyKey = this.actions.providerActionIdempotencyKey({
      tenantId: context.tenantId,
      providerKey: providerKeyValue,
      ticketId: actionPayload.ticketId,
      // The whole payload, not a projection of it: the action request's input_hash covers
      // the whole payload, so a key built from a subset can collide with a pending row whose
      // hash differs (same target, LLM reworded `reason`, or a moved `current` snapshot) and
      // createOrEnsureProviderAction would then throw and abort the run instead of superseding.
      noteBody: stableJson(actionPayload),
      capabilityVersion: PROVIDER_CAPABILITY_VERSION,
    });
    const action = await this.actions.createOrEnsureProviderAction(context, {
      runId: execution.runId ?? null,
      toolExecutionId: execution.toolExecutionId ?? null,
      capabilityName: TICKETING_ASSIGNMENT_UPDATE_APPROVED_CAPABILITY,
      capabilityVersion: PROVIDER_CAPABILITY_VERSION,
      effect: 'write',
      providerKind: 'ticketing',
      providerKey: providerKeyValue,
      targetType: 'ticket',
      targetRef: actionPayload.ticketId,
      actionPayload: actionPayload as unknown as Record<string, unknown>,
      idempotencyKey,
      evidenceIds: parsed.data.evidence_ids ?? null,
      inputSummary: {
        provider_kind: 'ticketing',
        provider_key: providerKeyValue,
        target_type: 'ticket',
        target_ref: actionPayload.ticketId,
        action: 'assignment_update',
        target: actionPayload.target,
      },
      metadata: {
        ...(isRecord(execution.metadata) ? execution.metadata : {}),
        ...freshnessMetadata,
        observation_id: parsed.data.observation_id ?? null,
        recommendation_id: parsed.data.recommendation_id ?? null,
        decision_id: parsed.data.decision_id ?? null,
        evaluation_id: parsed.data.evaluation_id ?? null,
        update_kind: 'assignment',
      },
      expiresAt: serviceDeskProposalExpiry(execution),
      retryAfterStatuses: shouldCreateFreshHelpdeskTriageProposal(execution)
        ? HELPDESK_TRIAGE_RETRY_AFTER_STATUSES
        : null,
    });
    return withActionRequestData(prepared, {
      action_request_id: action.id,
      action_request_status: action.status,
      capability_name: action.capability_name,
      capability_version: action.capability_version,
      idempotency_key: action.idempotency_key,
      target: { type: action.target_type, ref: action.target_ref },
    });
  }

  private async updateApprovedTicketAssignment(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
  ): Promise<unknown> {
    const parsed = AddApprovedAssignmentUpdateInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    const action = await this.actions.findProviderActionForExecution(context, parsed.data.action_request_id);
    this.actions.verifyProviderActionIntegrity(action);
    if (!isTicketAssignmentUpdatePayload(action.action_payload_json)) {
      throw new BadRequestException('Action request does not contain a valid assignment update payload.');
    }
    const provider = await this.providers.ticketing(context, action.provider_key ?? 'mock');
    const freshnessGuard = await this.verifyTicketFreshnessPolicy<TicketProviderActionWriteResult>(context, provider, action);
    if (freshnessGuard) {
      return freshnessGuard;
    }
    const current = await provider.getTicketRoutingContext(context, { ticketId: action.action_payload_json.ticketId });
    if (current.ok === false) {
      const message = `Cannot verify ticket routing freshness before write: ${current.message}`;
      await this.actions.markExecuted(context, action, 'failed', message);
      return ticketWriteGuardError<TicketProviderActionWriteResult>(message);
    }
    const driftKind = action.action_payload_json.target?.kind === 'user' ? 'user' : 'group';
    if (
      !actionHasApplyAnywayOverride(action)
      && !sameSnapshot(
        routingDriftSnapshot(action.action_payload_json.current, driftKind),
        routingDriftSnapshot(current.data, driftKind),
      )
    ) {
      const message = 'Ticket routing changed after this action was prepared. Rerun triage before approving this write.';
      await this.actions.markExecuted(context, action, 'failed', message);
      return ticketWriteGuardError<TicketProviderActionWriteResult>(message);
    }
    const result = await provider.updateTicketAssignment(context, {
      actionPayload: action.action_payload_json,
      idempotencyKey: action.idempotency_key ?? '',
    });
    if (result.ok === false) {
      await this.actions.markExecuted(context, action, 'failed', result.message);
      return result;
    }
    action.metadata_json = {
      ...(isRecord(action.metadata_json) ? action.metadata_json : {}),
      provider_result: {
        ticket_id: result.data.ticketId,
        summary: result.data.summary,
        updated_fields: result.data.updatedFields,
        idempotency_key: result.data.idempotencyKey,
        update_kind: 'assignment',
        already_applied: result.data.alreadyApplied ?? false,
      },
    };
    await this.actions.markExecuted(context, action, 'executed', null);
    await this.recordPostWriteTargetBaseline(context, provider, action);
    return withActionRequestData(result, { action_request_id: action.id });
  }

  private async prepareTicketParticipantUpdate(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
    execution: CapabilityExecutionContext,
  ): Promise<unknown> {
    const parsed = PrepareParticipantUpdateInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    const providerKeyValue = parsed.data.provider_key ?? 'mock';
    const provider = await this.providers.ticketing(context, providerKeyValue);
    const prepared = await provider.prepareTicketParticipantUpdate(context, {
      ticketId: parsed.data.ticket_id,
      operation: parsed.data.operation,
      participants: parsed.data.participants as TicketRoutingTarget[],
      reason: parsed.data.reason,
    });
    if (!prepared.ok) {
      return prepared;
    }
    const actionPayload = prepared.data.actionPayload;
    const freshnessMetadata = await this.ticketFreshnessMetadata(context, provider, actionPayload.ticketId);
    const idempotencyKey = this.actions.providerActionIdempotencyKey({
      tenantId: context.tenantId,
      providerKey: providerKeyValue,
      ticketId: actionPayload.ticketId,
      // The whole payload, not a projection of it: the action request's input_hash covers
      // the whole payload, so a key built from a subset can collide with a pending row whose
      // hash differs (same target, LLM reworded `reason`, or a moved `current` snapshot) and
      // createOrEnsureProviderAction would then throw and abort the run instead of superseding.
      noteBody: stableJson(actionPayload),
      capabilityVersion: PROVIDER_CAPABILITY_VERSION,
    });
    const action = await this.actions.createOrEnsureProviderAction(context, {
      runId: execution.runId ?? null,
      toolExecutionId: execution.toolExecutionId ?? null,
      capabilityName: TICKETING_PARTICIPANT_UPDATE_APPROVED_CAPABILITY,
      capabilityVersion: PROVIDER_CAPABILITY_VERSION,
      effect: 'write',
      providerKind: 'ticketing',
      providerKey: providerKeyValue,
      targetType: 'ticket',
      targetRef: actionPayload.ticketId,
      actionPayload: actionPayload as unknown as Record<string, unknown>,
      idempotencyKey,
      evidenceIds: parsed.data.evidence_ids ?? null,
      inputSummary: {
        provider_kind: 'ticketing',
        provider_key: providerKeyValue,
        target_type: 'ticket',
        target_ref: actionPayload.ticketId,
        action: 'participant_update',
        operation: actionPayload.operation,
        participants: actionPayload.participants,
      },
      metadata: {
        ...(isRecord(execution.metadata) ? execution.metadata : {}),
        ...freshnessMetadata,
        observation_id: parsed.data.observation_id ?? null,
        recommendation_id: parsed.data.recommendation_id ?? null,
        decision_id: parsed.data.decision_id ?? null,
        evaluation_id: parsed.data.evaluation_id ?? null,
        update_kind: 'participants',
      },
      expiresAt: serviceDeskProposalExpiry(execution),
      retryAfterStatuses: shouldCreateFreshHelpdeskTriageProposal(execution)
        ? HELPDESK_TRIAGE_RETRY_AFTER_STATUSES
        : null,
    });
    return withActionRequestData(prepared, {
      action_request_id: action.id,
      action_request_status: action.status,
      capability_name: action.capability_name,
      capability_version: action.capability_version,
      idempotency_key: action.idempotency_key,
      target: { type: action.target_type, ref: action.target_ref },
    });
  }

  private async updateApprovedTicketParticipants(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
  ): Promise<unknown> {
    const parsed = AddApprovedParticipantUpdateInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    const action = await this.actions.findProviderActionForExecution(context, parsed.data.action_request_id);
    this.actions.verifyProviderActionIntegrity(action);
    if (!isTicketParticipantUpdatePayload(action.action_payload_json)) {
      throw new BadRequestException('Action request does not contain a valid participant update payload.');
    }
    const provider = await this.providers.ticketing(context, action.provider_key ?? 'mock');
    const freshnessGuard = await this.verifyTicketFreshnessPolicy<TicketProviderActionWriteResult>(context, provider, action);
    if (freshnessGuard) {
      return freshnessGuard;
    }
    const current = await provider.getTicketParticipantContext(context, { ticketId: action.action_payload_json.ticketId });
    if (current.ok === false) {
      const message = `Cannot verify ticket participant freshness before write: ${current.message}`;
      await this.actions.markExecuted(context, action, 'failed', message);
      return ticketWriteGuardError<TicketProviderActionWriteResult>(message);
    }
    if (!actionHasApplyAnywayOverride(action) && !sameSnapshot(action.action_payload_json.current, current.data)) {
      const message = 'Ticket participants changed after this action was prepared. Rerun triage before approving this write.';
      await this.actions.markExecuted(context, action, 'failed', message);
      return ticketWriteGuardError<TicketProviderActionWriteResult>(message);
    }
    const result = await provider.updateTicketParticipants(context, {
      actionPayload: action.action_payload_json,
      idempotencyKey: action.idempotency_key ?? '',
    });
    if (result.ok === false) {
      await this.actions.markExecuted(context, action, 'failed', result.message);
      return result;
    }
    action.metadata_json = {
      ...(isRecord(action.metadata_json) ? action.metadata_json : {}),
      provider_result: {
        ticket_id: result.data.ticketId,
        summary: result.data.summary,
        updated_fields: result.data.updatedFields,
        idempotency_key: result.data.idempotencyKey,
        update_kind: 'participants',
        already_applied: result.data.alreadyApplied ?? false,
      },
    };
    await this.actions.markExecuted(context, action, 'executed', null);
    await this.recordPostWriteTargetBaseline(context, provider, action);
    return withActionRequestData(result, { action_request_id: action.id });
  }

  private async prepareInternalNoteAction(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
    execution: CapabilityExecutionContext,
  ): Promise<unknown> {
    const parsed = PrepareInternalNoteInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    const providerKeyValue = parsed.data.provider_key ?? 'mock';
    const ticketId = parsed.data.ticket_id;
    const noteBody = normalizeInternalNoteBody(parsed.data.note_body);
    const provider = await this.providers.ticketing(context, providerKeyValue);
    const prepared = await provider.prepareInternalNote(context, { ticketId, noteBody });
    if (!prepared.ok) {
      return prepared;
    }

    const actionPayload = prepared.data.actionPayload;
    const freshnessMetadata = await this.ticketFreshnessMetadata(context, provider, actionPayload.ticketId);
    const idempotencyKey = this.actions.providerActionIdempotencyKey({
      tenantId: context.tenantId,
      providerKey: providerKeyValue,
      ticketId: actionPayload.ticketId,
      noteBody: actionPayload.body,
      capabilityVersion: PROVIDER_CAPABILITY_VERSION,
    });
    const action = await this.actions.createOrEnsureProviderAction(context, {
      runId: execution.runId ?? null,
      toolExecutionId: execution.toolExecutionId ?? null,
      capabilityName: TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY,
      capabilityVersion: PROVIDER_CAPABILITY_VERSION,
      effect: 'write',
      providerKind: 'ticketing',
      providerKey: providerKeyValue,
      targetType: 'ticket',
      targetRef: actionPayload.ticketId,
      actionPayload: actionPayload as unknown as Record<string, unknown>,
      idempotencyKey,
      evidenceIds: parsed.data.evidence_ids ?? null,
      inputSummary: {
        provider_kind: 'ticketing',
        provider_key: providerKeyValue,
        target_type: 'ticket',
        target_ref: actionPayload.ticketId,
        action: 'add_internal_note',
        note_preview: actionPayload.body.slice(0, 240),
      },
      metadata: {
        ...(isRecord(execution.metadata) ? execution.metadata : {}),
        ...freshnessMetadata,
        observation_id: parsed.data.observation_id ?? null,
        recommendation_id: parsed.data.recommendation_id ?? null,
        decision_id: parsed.data.decision_id ?? null,
        evaluation_id: parsed.data.evaluation_id ?? null,
        visibility: 'internal',
      },
      expiresAt: serviceDeskProposalExpiry(execution),
      retryAfterStatuses: shouldCreateFreshHelpdeskTriageProposal(execution)
        ? HELPDESK_TRIAGE_RETRY_AFTER_STATUSES
        : null,
    });

    return withActionRequestData(prepared, {
      action_request_id: action.id,
      action_request_status: action.status,
      capability_name: action.capability_name,
      capability_version: action.capability_version,
      idempotency_key: action.idempotency_key,
      target: {
        type: action.target_type,
        ref: action.target_ref,
      },
    });
  }

  // Resolves how the agent registers itself on the ticket it writes to (assignee / observer /
  // none) from the owning agent definition's response policy. Kept OUT of the action payload so
  // the integrity hash of already-prepared actions stays valid and a policy change applies to
  // pending approvals immediately.
  private async agentActorRoleForAction(
    context: AiExecutionContextWithManager,
    action: AiActionRequest,
  ): Promise<TicketActorRole> {
    const metadata = isRecord(action.metadata_json) ? action.metadata_json : null;
    const definitionId = typeof metadata?.agent_definition_id === 'string' ? metadata.agent_definition_id : null;
    if (!definitionId) {
      return DEFAULT_TICKET_ACTOR_ROLE;
    }
    const definition = await context.manager.getRepository(AiAgentDefinition).findOne({
      where: { id: definitionId, tenant_id: context.tenantId },
    });
    return ticketActorRoleFromResponsePolicy(definition?.response_policy_json);
  }

  private async addApprovedInternalNote(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
  ): Promise<unknown> {
    const parsed = AddApprovedInternalNoteInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    const action = await this.actions.findProviderActionForExecution(context, parsed.data.action_request_id);
    this.actions.verifyProviderActionIntegrity(action);
    if (!isTicketInternalNotePayload(action.action_payload_json)) {
      throw new BadRequestException('Action request does not contain a valid internal-note payload.');
    }
    const provider = await this.providers.ticketing(context, action.provider_key ?? 'mock');
    const freshnessGuard = await this.verifyTicketFreshnessPolicy<TicketInternalNoteWriteResult>(context, provider, action);
    if (freshnessGuard) {
      return freshnessGuard;
    }
    const staleGuard = actionHasApplyAnywayOverride(action)
      ? null
      : await this.verifyTicketHistoryStaleGuard<TicketInternalNoteWriteResult>(context, provider, action);
    if (staleGuard) {
      return staleGuard;
    }
    const result = await provider.addInternalNote(context, {
      actionPayload: action.action_payload_json,
      idempotencyKey: action.idempotency_key ?? '',
      agentActorRole: await this.agentActorRoleForAction(context, action),
    });
    if (result.ok === false) {
      await this.actions.markExecuted(context, action, 'failed', result.message);
      return result;
    }
    action.metadata_json = {
      ...(isRecord(action.metadata_json) ? action.metadata_json : {}),
      provider_result: {
        note_id: result.data.noteId,
        ticket_id: result.data.ticketId,
        summary: result.data.summary,
        idempotency_key: result.data.idempotencyKey,
        visibility: 'internal',
        already_applied: result.data.alreadyApplied ?? false,
      },
    };
    await this.actions.markExecuted(context, action, 'executed', null);
    await this.recordPostWriteTargetBaseline(context, provider, action);
    return result;
  }

  private async preparePublicReplyAction(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
    execution: CapabilityExecutionContext,
  ): Promise<unknown> {
    const parsed = PreparePublicReplyInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    const providerKeyValue = parsed.data.provider_key ?? 'mock';
    const ticketId = parsed.data.ticket_id;
    const replyBody = normalizePublicReplyBody(parsed.data.reply_body);
    const provider = await this.providers.ticketing(context, providerKeyValue);
    const prepared = await provider.preparePublicReply(context, { ticketId, replyBody });
    if (!prepared.ok) {
      return prepared;
    }

    const actionPayload = prepared.data.actionPayload;
    const freshnessMetadata = await this.ticketFreshnessMetadata(context, provider, actionPayload.ticketId);
    const idempotencyKey = this.actions.providerActionIdempotencyKey({
      tenantId: context.tenantId,
      providerKey: providerKeyValue,
      ticketId: actionPayload.ticketId,
      noteBody: actionPayload.body,
      capabilityVersion: PROVIDER_CAPABILITY_VERSION,
    });
    const action = await this.actions.createOrEnsureProviderAction(context, {
      runId: execution.runId ?? null,
      toolExecutionId: execution.toolExecutionId ?? null,
      capabilityName: TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY,
      capabilityVersion: PROVIDER_CAPABILITY_VERSION,
      effect: 'write',
      providerKind: 'ticketing',
      providerKey: providerKeyValue,
      targetType: 'ticket',
      targetRef: actionPayload.ticketId,
      actionPayload: actionPayload as unknown as Record<string, unknown>,
      idempotencyKey,
      evidenceIds: parsed.data.evidence_ids ?? null,
      inputSummary: {
        provider_kind: 'ticketing',
        provider_key: providerKeyValue,
        target_type: 'ticket',
        target_ref: actionPayload.ticketId,
        action: 'add_public_reply',
        reply_preview: actionPayload.body.slice(0, 240),
      },
      metadata: {
        ...(isRecord(execution.metadata) ? execution.metadata : {}),
        ...freshnessMetadata,
        observation_id: parsed.data.observation_id ?? null,
        recommendation_id: parsed.data.recommendation_id ?? null,
        decision_id: parsed.data.decision_id ?? null,
        evaluation_id: parsed.data.evaluation_id ?? null,
        visibility: 'public',
      },
      expiresAt: serviceDeskProposalExpiry(execution),
      retryAfterStatuses: shouldCreateFreshHelpdeskTriageProposal(execution)
        ? HELPDESK_TRIAGE_RETRY_AFTER_STATUSES
        : null,
    });

    return withActionRequestData(prepared, {
      action_request_id: action.id,
      action_request_status: action.status,
      capability_name: action.capability_name,
      capability_version: action.capability_version,
      idempotency_key: action.idempotency_key,
      target: {
        type: action.target_type,
        ref: action.target_ref,
      },
    });
  }

  private async addApprovedPublicReply(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
  ): Promise<unknown> {
    const parsed = AddApprovedPublicReplyInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    const action = await this.actions.findProviderActionForExecution(context, parsed.data.action_request_id);
    this.actions.verifyProviderActionIntegrity(action);
    if (!isTicketPublicReplyPayload(action.action_payload_json)) {
      throw new BadRequestException('Action request does not contain a valid public-reply payload.');
    }
    const provider = await this.providers.ticketing(context, action.provider_key ?? 'mock');
    const freshnessGuard = await this.verifyTicketFreshnessPolicy<TicketPublicReplyWriteResult>(context, provider, action);
    if (freshnessGuard) {
      return freshnessGuard;
    }
    const staleGuard = await this.verifyTicketHistoryStaleGuard<TicketPublicReplyWriteResult>(context, provider, action);
    if (staleGuard) {
      return staleGuard;
    }
    const result = await provider.addPublicReply(context, {
      actionPayload: action.action_payload_json,
      idempotencyKey: action.idempotency_key ?? '',
      agentActorRole: await this.agentActorRoleForAction(context, action),
    });
    if (result.ok === false) {
      await this.actions.markExecuted(context, action, 'failed', result.message);
      return result;
    }
    action.metadata_json = {
      ...(isRecord(action.metadata_json) ? action.metadata_json : {}),
      provider_result: {
        note_id: result.data.noteId,
        ticket_id: result.data.ticketId,
        summary: result.data.summary,
        idempotency_key: result.data.idempotencyKey,
        visibility: 'public',
        already_applied: result.data.alreadyApplied ?? false,
      },
    };
    await this.actions.markExecuted(context, action, 'executed', null);
    await this.recordPostWriteTargetBaseline(context, provider, action);
    return result;
  }

  private async verifyTicketHistoryStaleGuard<T>(
    context: AiExecutionContextWithManager,
    provider: TicketingProvider,
    action: ProviderActionForExecution,
  ): Promise<AdapterResult<T> | null> {
    const metadata = isRecord(action.metadata_json) ? action.metadata_json : null;
    const gate = isRecord(metadata?.conversation_gate) ? metadata.conversation_gate : null;
    const preparedCount = numberMetadataField(gate, 'ticket_history_entry_count');
    const preparedLatestFingerprint = stringMetadataField(gate, 'latest_ticket_note_fingerprint');
    const preparedLatestId = stringMetadataField(gate, 'latest_ticket_note_id');
    const preparedAt = stringMetadataField(gate, 'prepared_at');
    if (preparedCount == null && !preparedLatestFingerprint && !preparedLatestId) {
      return null;
    }

    const ticketId = action.target_ref;
    if (!ticketId) {
      const message = 'Cannot verify ticket freshness because the action target is missing.';
      await this.actions.markExecuted(context, action, 'failed', message);
      return ticketWriteGuardError<T>(message);
    }

    const current = await provider.listTicketNotes(context, { ticketId });
    if (current.ok === false) {
      const message = `Cannot verify ticket freshness before the ticketing write: ${current.message}`;
      await this.actions.markExecuted(context, action, 'failed', message);
      return ticketWriteGuardError<T>(message);
    }

    const currentNotes = current.data.notes;
    const currentLatest = latestTicketNote(currentNotes);
    const currentLatestFingerprint = currentLatest ? ticketNoteFingerprint(currentLatest) : null;
    const countChanged = preparedCount != null && currentNotes.length !== preparedCount;
    const latestIdChanged = preparedLatestId != null && (currentLatest?.id ?? null) !== preparedLatestId;
    const latestFingerprintChanged = preparedLatestFingerprint != null && currentLatestFingerprint !== preparedLatestFingerprint;
    if (!countChanged && !latestIdChanged && !latestFingerprintChanged) {
      return null;
    }

    const onlySameRunKanapWrites = await this.ticketHistoryChangeIsOnlySameRunKanapWrites(context, action, currentNotes, {
      preparedCount,
      preparedLatestId,
      preparedLatestFingerprint,
      currentLatest,
      currentLatestFingerprint,
    });
    if (onlySameRunKanapWrites) {
      return null;
    }

    const message = [
      'Ticket history changed after this action was prepared.',
      preparedAt ? `Prepared at ${preparedAt}.` : null,
      'Rerun triage before approving the ticketing write.',
    ].filter((part): part is string => !!part).join(' ');
    await this.actions.markExecuted(context, action, 'failed', message);
    return ticketWriteGuardError<T>(message);
  }

  private async ticketHistoryChangeIsOnlySameRunKanapWrites(
    context: AiExecutionContextWithManager,
    action: ProviderActionForExecution,
    currentNotes: TicketNote[],
    snapshot: {
      preparedCount: number | null;
      preparedLatestId: string | null;
      preparedLatestFingerprint: string | null;
      currentLatest: TicketNote | null;
      currentLatestFingerprint: string | null;
    },
  ): Promise<boolean> {
    const siblingActions = await this.sameRunExecutedSiblingActions(context, action);
    const allowedSiblingNoteIds = new Set<string>();
    for (const sibling of siblingActions) {
      if (
        sibling.capability_name !== TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY
        && sibling.capability_name !== TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY
      ) {
        continue;
      }
      const siblingMetadata = isRecord(sibling.metadata_json) ? sibling.metadata_json : null;
      const siblingNoteId = metadataProviderResultNoteId(siblingMetadata);
      if (siblingNoteId) {
        allowedSiblingNoteIds.add(siblingNoteId);
      }
    }
    if (allowedSiblingNoteIds.size === 0) {
      return false;
    }

    const currentNoteIds = new Set(currentNotes.map((note) => String(note.id)));
    const visibleAllowedSiblingNoteIds = [...allowedSiblingNoteIds].filter((noteId) => currentNoteIds.has(noteId));
    if (visibleAllowedSiblingNoteIds.length === 0) {
      return false;
    }

    if (snapshot.preparedCount != null) {
      const maxAllowedCount = snapshot.preparedCount + visibleAllowedSiblingNoteIds.length;
      if (currentNotes.length < snapshot.preparedCount || currentNotes.length > maxAllowedCount) {
        return false;
      }
    }

    if (snapshot.preparedLatestId) {
      const preparedLatestStillPresent = currentNotes.find((note) => String(note.id) === snapshot.preparedLatestId);
      if (!preparedLatestStillPresent) {
        return false;
      }
      if (
        snapshot.preparedLatestFingerprint
        && ticketNoteFingerprint(preparedLatestStillPresent) !== snapshot.preparedLatestFingerprint
      ) {
        return false;
      }
    } else if (snapshot.preparedLatestFingerprint) {
      const preparedLatestStillPresent = currentNotes.some((note) => ticketNoteFingerprint(note) === snapshot.preparedLatestFingerprint);
      if (!preparedLatestStillPresent) {
        return false;
      }
    }

    if (snapshot.currentLatest) {
      const currentLatestId = String(snapshot.currentLatest.id);
      const latestIsPreparedLatest = snapshot.preparedLatestId != null && currentLatestId === snapshot.preparedLatestId;
      const latestIsAllowedSibling = allowedSiblingNoteIds.has(currentLatestId);
      if (!latestIsPreparedLatest && !latestIsAllowedSibling) {
        return false;
      }
      if (
        snapshot.currentLatestFingerprint
        && snapshot.preparedLatestFingerprint
        && snapshot.currentLatestFingerprint !== snapshot.preparedLatestFingerprint
        && !latestIsAllowedSibling
      ) {
        return false;
      }
    }

    return true;
  }

  private async listAllowedAutomationJobs(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
  ): Promise<unknown> {
    const parsed = AutomationListInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    const providerKeyValue = parsed.data.provider_key ?? 'mock';
    const jobs = await this.automationCatalog.listAllowedJobs(context, providerKeyValue);
    const provider = await this.providers.automation(context, providerKeyValue);
    return provider.listAllowedJobs(context, { jobs });
  }

  private async getAutomationJobSchema(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
  ): Promise<unknown> {
    const parsed = AutomationJobInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    const providerKeyValue = parsed.data.provider_key ?? 'mock';
    const job = await this.automationCatalog.getCatalogJob(context, providerKeyValue, parsed.data.job_key);
    const provider = await this.providers.automation(context, providerKeyValue);
    return provider.getJobSchema(context, { job });
  }

  private async dryRunAutomationJob(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
  ): Promise<unknown> {
    const parsed = AutomationDryRunInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    const providerKeyValue = parsed.data.provider_key ?? 'mock';
    const job = await this.automationCatalog.getCatalogJob(context, providerKeyValue, parsed.data.job_key);
    this.automationCatalog.assertDryRunEligible(job);
    const variables = this.automationCatalog.validateVariables(job, parsed.data.variables ?? {});
    const target = this.automationCatalog.validateTarget(job, parsed.data.target);
    const provider = await this.providers.automation(context, providerKeyValue);
    return provider.dryRunJob(context, {
      job,
      target: { type: target.type, values: target.values },
      variables,
      dryRunFingerprint: this.automationCatalog.dryRunFingerprint({
        job,
        target: { type: target.type, values: target.values },
        variables,
      }),
    });
  }

  private async prepareAutomationLaunch(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
    execution: CapabilityExecutionContext,
  ): Promise<unknown> {
    const parsed = AutomationLaunchPrepareInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    const providerKeyValue = parsed.data.provider_key ?? 'mock';
    const job = await this.automationCatalog.getCatalogJob(context, providerKeyValue, parsed.data.job_key);
    this.automationCatalog.assertLaunchEligible(job);
    const variables = this.automationCatalog.validateVariables(job, parsed.data.variables ?? {});
    const target = this.automationCatalog.validateTarget(job, parsed.data.target);
    const dryRunMatch = job.dryRunRequired
      ? await this.automationCatalog.findMatchingDryRunEvidence(context, job, { type: target.type, values: target.values }, variables)
      : null;
    const idempotencyKey = this.automationCatalog.launchIdempotencyKey({
      tenantId: context.tenantId,
      job,
      target: { type: target.type, values: target.values },
      variables,
      dryRunResultHash: dryRunMatch?.dryRunResultHash ?? null,
    });
    await this.automationCatalog.assertCooldownAllowsPreparation(context, {
      job,
      targetRef: target.targetRef,
      idempotencyKey,
    });
    const actionPayload = this.automationCatalog.buildLaunchPayload({
      job,
      target,
      variables,
      dryRunEvidenceId: dryRunMatch?.evidence.id ?? null,
      dryRunResultHash: dryRunMatch?.dryRunResultHash ?? null,
    });
    const evidenceIds = Array.from(new Set([
      ...(parsed.data.evidence_ids ?? []),
      ...(dryRunMatch ? [dryRunMatch.evidence.id] : []),
    ]));
    const action = await this.actions.createOrEnsureProviderAction(context, {
      runId: execution.runId ?? null,
      toolExecutionId: execution.toolExecutionId ?? null,
      capabilityName: AUTOMATION_JOB_LAUNCH_APPROVED_CAPABILITY,
      capabilityVersion: AUTOMATION_PROVIDER_CAPABILITY_VERSION,
      effect: 'remediate',
      providerKind: 'automation',
      providerKey: providerKeyValue,
      targetType: 'automation_target',
      targetRef: target.targetRef,
      actionPayload: actionPayload as unknown as Record<string, unknown>,
      idempotencyKey,
      evidenceIds,
      inputSummary: {
        provider_kind: 'automation',
        provider_key: providerKeyValue,
        job_key: job.jobKey,
        environment: job.environment,
        target_ref: target.targetRef,
        blast_radius: target.blastRadius,
        dry_run_required: job.dryRunRequired,
      },
      metadata: {
        recommendation_id: parsed.data.recommendation_id ?? null,
        decision_id: parsed.data.decision_id ?? null,
        evaluation_id: parsed.data.evaluation_id ?? null,
        automation: {
          provider_key: providerKeyValue,
          job_key: job.jobKey,
          catalog_version: job.catalogVersion,
          environment: job.environment,
          target_ref: target.targetRef,
          dry_run_evidence_id: dryRunMatch?.evidence.id ?? null,
          dry_run_result_hash: dryRunMatch?.dryRunResultHash ?? null,
          blast_radius: target.blastRadius,
        },
      },
    });

    return {
      ok: true,
      data: {
        action_request_id: action.id,
        action_request_status: action.status,
        capability_name: action.capability_name,
        capability_version: action.capability_version,
        provider_key: providerKeyValue,
        job_key: job.jobKey,
        environment: job.environment,
        target: {
          type: target.type,
          values: target.values,
          ref: target.targetRef,
          blast_radius: target.blastRadius,
        },
        idempotency_key: action.idempotency_key,
        dry_run_required: job.dryRunRequired,
        dry_run_evidence_id: dryRunMatch?.evidence.id ?? null,
      },
      evidence: [],
    };
  }

  private async launchApprovedAutomationJob(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
  ): Promise<unknown> {
    const parsed = AutomationLaunchApprovedInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    const action = await this.actions.findProviderActionForExecution(context, parsed.data.action_request_id);
    this.actions.verifyProviderActionIntegrity(action);
    if (!isAutomationLaunchPayload(action.action_payload_json)) {
      throw new BadRequestException('Action request does not contain a valid automation launch payload.');
    }
    const providerKeyValue = action.action_payload_json.providerKey;
    const job = await this.automationCatalog.getCatalogJob(context, providerKeyValue, action.action_payload_json.jobKey);
    this.automationCatalog.assertLaunchEligible(job);
    if (
      job.catalogVersion !== action.action_payload_json.catalogVersion
      || job.environment !== action.action_payload_json.environment
      || job.externalJobTemplateRef !== action.action_payload_json.externalJobTemplateRef
    ) {
      throw new ForbiddenException('Automation catalog entry changed since launch preparation.');
    }
    const variables = this.automationCatalog.validateVariables(job, action.action_payload_json.variables);
    const target = this.automationCatalog.validateTarget(job, action.action_payload_json.target);
    const dryRunMatch = job.dryRunRequired
      ? await this.automationCatalog.findMatchingDryRunEvidence(context, job, { type: target.type, values: target.values }, variables)
      : null;
    if (job.dryRunRequired && dryRunMatch?.dryRunResultHash !== action.action_payload_json.dryRunResultHash) {
      throw new ForbiddenException('Automation dry-run evidence no longer matches the approved launch payload.');
    }
    await this.automationCatalog.assertCooldownAllowsExecution(context, {
      job,
      targetRef: target.targetRef,
      idempotencyKey: action.idempotency_key ?? '',
      currentActionId: action.id,
    });
    const provider = await this.providers.automation(context, providerKeyValue);
    const approval = await this.approvals.resolveApprovedAction(context, action);
    const result = await provider.launchApprovedJob(context, {
      actionPayload: action.action_payload_json,
      approvalId: approval.id,
      idempotencyKey: action.idempotency_key ?? '',
    });
    if (result.ok === false) {
      action.metadata_json = {
        ...(action.metadata_json ?? {}),
        provider_result: {
          status: 'failed',
          error_code: result.errorCode,
          message: result.message,
        },
      };
      await this.actions.markExecuted(context, action, 'failed', result.message);
      return result;
    }
    action.metadata_json = {
      ...(action.metadata_json ?? {}),
      provider_result: {
        job_run_id: result.data.jobRunId,
        status: result.data.status,
        outcome: result.data.alreadyStarted ? 'provider_job_already_started' : 'provider_job_started',
      },
    };
    await this.actions.markExecuted(context, action, 'executed', null);
    return withActionRequestData(result, {
      action_request_id: action.id,
      approval_id: approval.id,
    });
  }

  private async resolveExecutedAutomationLaunch(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
  ): Promise<{
    action: Awaited<ReturnType<AiActionRequestService['findProviderActionForExecution']>>;
    actionPayload: AutomationLaunchActionPayload;
    jobRunId: string;
  }> {
    const parsed = AutomationJobRunInputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException(legacyFlattenError(parsed.error));
    }
    const action = await this.actions.findProviderActionForExecution(context, parsed.data.action_request_id);
    this.actions.verifyProviderActionIntegrity(action);
    if (
      action.capability_name !== AUTOMATION_JOB_LAUNCH_APPROVED_CAPABILITY
      || action.capability_version !== AUTOMATION_PROVIDER_CAPABILITY_VERSION
      || action.effect !== 'remediate'
      || action.provider_kind !== 'automation'
    ) {
      throw new ForbiddenException('Automation job run reads must reference an approved automation launch action.');
    }
    if (action.status !== 'executed') {
      throw new ForbiddenException('Automation job run reads require an executed launch action.');
    }
    if (!isAutomationLaunchPayload(action.action_payload_json)) {
      throw new BadRequestException('Action request does not contain a valid automation launch payload.');
    }
    if (action.provider_key !== action.action_payload_json.providerKey) {
      throw new ForbiddenException('Automation launch action provider scope does not match its payload.');
    }
    await this.automationCatalog.getCatalogJob(context, action.action_payload_json.providerKey, action.action_payload_json.jobKey);
    const providerResult = isRecord(action.metadata_json?.provider_result)
      ? action.metadata_json.provider_result
      : null;
    const jobRunId = stringMetadataField(providerResult, 'job_run_id');
    if (!jobRunId) {
      throw new ForbiddenException('Automation launch action has no recorded provider job run id.');
    }
    if (parsed.data.job_run_id && parsed.data.job_run_id !== jobRunId) {
      throw new ForbiddenException('Requested automation job run id does not match the executed action.');
    }
    return {
      action,
      actionPayload: action.action_payload_json,
      jobRunId,
    };
  }

  private async getAutomationJobStatus(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
  ): Promise<unknown> {
    const resolved = await this.resolveExecutedAutomationLaunch(context, rawInput);
    const provider = await this.providers.automation(context, resolved.actionPayload.providerKey);
    return withActionRequestData(await provider.getJobStatus(context, {
      jobRunId: resolved.jobRunId,
      providerKey: resolved.actionPayload.providerKey,
      jobKey: resolved.actionPayload.jobKey,
    }), {
      action_request_id: resolved.action.id,
    });
  }

  private async getAutomationJobOutput(
    context: AiExecutionContextWithManager,
    rawInput: unknown,
  ): Promise<unknown> {
    const resolved = await this.resolveExecutedAutomationLaunch(context, rawInput);
    const provider = await this.providers.automation(context, resolved.actionPayload.providerKey);
    return withActionRequestData(await provider.getJobOutput(context, {
      jobRunId: resolved.jobRunId,
      providerKey: resolved.actionPayload.providerKey,
      jobKey: resolved.actionPayload.jobKey,
    }), {
      action_request_id: resolved.action.id,
    });
  }
}
