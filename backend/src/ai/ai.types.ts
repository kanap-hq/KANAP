import { EntityManager } from 'typeorm';
import { z } from 'zod';

export type AiSurface = 'chat' | 'mcp';
export type AiAuthMethod = 'jwt' | 'api_key';
export type AiMutationWriteToolName =
  | 'import_ticket'
  | 'import_glpi_ticket'
  | 'create_task'
  | 'create_master_data_record'
  | 'create_business_record'
  | 'create_document'
  | 'write_financial_plan'
  | 'update_master_data_record'
  | 'update_business_record'
  | 'update_entity_relations'
  | 'update_document_content'
  | 'update_document_metadata'
  | 'update_document_relations'
  | 'update_task_fields'
  | 'update_task_status'
  | 'update_task_assignee'
  | 'add_task_comment';
export type AiToolCategory = 'discovery' | 'authoritative' | 'inspection' | 'mutation';
export type AiToolName =
  | 'search_all'
  | 'describe_entity_filters'
  | 'query_entities'
  | 'aggregate_entities'
  | 'get_filter_values'
  | 'get_application_classification_catalog'
  | 'get_entity_detail'
  | 'get_entity_context'
  | 'get_entity_comments'
  | 'search_knowledge'
  | 'get_document'
  | 'web_search'
  | AiMutationWriteToolName
  | 'update_task_assignees'
  | 'prepare_mutation_plan'
  | 'undo_preview';

export const AI_QUERY_ENTITY_TYPES = [
  'accounts',
  'analytics_categories',
  'applications',
  'assets',
  'business_processes',
  'capex_items',
  'chart_of_accounts',
  'companies',
  'connections',
  'contacts',
  'contracts',
  'departments',
  'documents',
  'incidents',
  'interfaces',
  'locations',
  'projects',
  'requests',
  'spend_items',
  'suppliers',
  'tasks',
  'users',
] as const;

/**
 * Types the search index covers but the query/aggregate registries do not: they
 * surface in search_all and the entity picker, and are not listable or
 * aggregatable from the chat.
 */
export const AI_SEARCH_ONLY_ENTITY_TYPES = [] as const;

export const AI_SEARCH_ENTITY_TYPES = [
  ...AI_QUERY_ENTITY_TYPES,
  ...AI_SEARCH_ONLY_ENTITY_TYPES,
] as const;

export const AI_CONTEXT_ENTITY_TYPES = [
  'applications',
  'assets',
  'projects',
  'requests',
  'tasks',
] as const;

export const AiSearchEntityTypeSchema = z.enum(AI_SEARCH_ENTITY_TYPES);

export const AiQueryEntityTypeSchema = z.enum(AI_QUERY_ENTITY_TYPES);
export const AiQueryScopeSchema = z.enum(['me', 'my_team']);

export const AiContextEntityTypeSchema = z.enum(AI_CONTEXT_ENTITY_TYPES);

export type AiSearchEntityType = z.infer<typeof AiSearchEntityTypeSchema>;
export type AiContextEntityType = z.infer<typeof AiContextEntityTypeSchema>;
export type AiQueryEntityType = z.infer<typeof AiQueryEntityTypeSchema>;
export type AiQueryScope = z.infer<typeof AiQueryScopeSchema>;

export type AiExecutionContext = {
  tenantId: string;
  userId: string;
  isPlatformHost: boolean;
  surface: AiSurface;
  authMethod: AiAuthMethod;
  conversationId?: string | null;
  requestId?: string | null;
  aiApiKeyId?: string | null;
  // Agent definition driving this execution, when the context belongs to an
  // agent run. Lets the LLM client resolve the agent's assigned registry model
  // without threading the definition through every stage service.
  agentId?: string | null;
};

export type AiExecutionContextWithManager = AiExecutionContext & {
  manager: EntityManager;
};

export type AiEntityMetadataScalar = string | number | boolean | null;
export type AiEntityMetadataObject = Record<string, AiEntityMetadataScalar>;
export type AiEntityMetadataValue =
  | AiEntityMetadataScalar
  | AiEntityMetadataObject
  | AiEntityMetadataObject[];
export type AiEntityMetadata = Record<string, AiEntityMetadataValue>;

export type AiEntitySummaryDto = {
  type: AiSearchEntityType | AiContextEntityType;
  id: string;
  ref: string | null;
  label: string;
  status: string | null;
  summary: string | null;
  updated_at: string | null;
  match_context?: string | null;
  metadata?: AiEntityMetadata | null;
};

export type AiEntityRelationshipGroupDto = {
  relation: string;
  label: string;
  items: AiEntitySummaryDto[];
};

export type AiKnowledgeContextSourceDto = {
  entity_type: string;
  entity_id: string;
  ref: string | null;
  label: string;
  status: string | null;
};

export type AiKnowledgeContextItemDto = {
  id: string;
  ref: string | null;
  title: string;
  summary: string | null;
  status: string;
  updated_at: string | null;
  created_at: string | null;
  provenance: AiKnowledgeContextSourceDto[];
};

export type AiKnowledgeContextGroupDto = {
  key: string;
  label: string;
  linked_via_label: string;
  total: number;
  items: AiKnowledgeContextItemDto[];
};

export type AiKnowledgeContextDto = {
  access: 'granted' | 'restricted';
  total: number;
  groups: AiKnowledgeContextGroupDto[];
};

export type AiEntityContextPayloadDto = {
  entity: Omit<AiEntitySummaryDto, 'metadata'> & {
    metadata: AiEntityMetadata;
  };
  related: AiEntityRelationshipGroupDto[];
  knowledge: AiKnowledgeContextDto | null;
};

export type AiEntityContextDto = AiEntityContextPayloadDto & {
  total: number;
  returned: number;
  truncated: boolean;
  complete: boolean;
};

export type AiEntityCommentDto = {
  author: string | null;
  content: string | null;
  created_at: string | null;
  updated_at: string | null;
  edited: boolean;
};

export type AiEntityCommentsDto = {
  entity: {
    type: Extract<AiContextEntityType, 'projects' | 'tasks'>;
    id: string;
    ref: string | null;
    label: string;
  };
  items: AiEntityCommentDto[];
  total: number;
  offset: number;
  limit: number;
  returned: number;
  truncated: boolean;
  complete: boolean;
};

export type AiEntityDetailDto = {
  entity: AiEntitySummaryDto;
  data: Record<string, unknown>;
  total: number;
  returned: number;
  truncated: boolean;
  complete: boolean;
};

export type AiKnowledgeSearchResultDto = {
  id: string;
  ref: string;
  title: string;
  summary: string | null;
  status: string;
  snippet: string | null;
  score: number | null;
  library: {
    id: string | null;
    name: string | null;
  };
  updated_at: string | null;
};

export type AiDocumentDto = {
  id: string;
  ref: string;
  title: string;
  summary: string | null;
  status: string;
  content_markdown: string;
  updated_at: string | null;
  library: {
    id: string | null;
    name: string | null;
    slug: string | null;
  };
  folder: {
    id: string | null;
    name: string | null;
  };
  document_type: {
    id: string | null;
    name: string | null;
  };
  relations: Record<string, AiEntitySummaryDto[]>;
  contributors: Array<{
    name: string;
    role: string;
    is_primary: boolean;
  }>;
  total: number;
  returned: number;
  truncated: boolean;
  complete: boolean;
};

export type AiToolDefinition<TInput = unknown, TResult = unknown> = {
  name: AiToolName;
  category: AiToolCategory;
  description: string;
  inputSchema: z.ZodType<TInput>;
  inputSummary: Record<string, string>;
  surfaces: AiSurface[];
  readOnly: boolean;
  writePreview?: AiWritePreviewCapabilityDto;
  execute: (
    context: AiExecutionContextWithManager,
    input: TInput,
  ) => Promise<TResult>;
};

export type AiWritePreviewCapabilityDto = {
  entity_type: string;
  fields: string[];
  reversible: boolean;
  prompt_hint: string;
};

export type AiToolListItemDto = {
  name: AiToolName;
  category: AiToolCategory;
  description: string;
  input_summary: Record<string, string>;
  read_only: boolean;
  surfaces: AiSurface[];
  write_preview?: AiWritePreviewCapabilityDto;
};

export type AiMutationPreviewStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'expired'
  | 'failed';

export type AiMutationPreviewChangeDto = {
  label?: string | null;
  from: string | null;
  to: string | null;
  format?: 'text' | 'markdown';
};

export type AiMutationPreviewDto = {
  preview_id: string;
  tool_name: AiMutationWriteToolName;
  status: AiMutationPreviewStatus;
  target: {
    entity_type: string;
    entity_id: string | null;
    ref: string | null;
    title: string | null;
  };
  changes: Record<string, AiMutationPreviewChangeDto>;
  requires_confirmation: boolean;
  actions: Array<'approve' | 'reject'>;
  summary: string;
  error_message: string | null;
  conversation_id: string | null;
  created_at: string;
  expires_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  executed_at: string | null;
};

export type AiMutationPlanStepDto = {
  id: string;
  step_key: string;
  label: string | null;
  tool_name: AiMutationWriteToolName;
  status: 'waiting_dependency' | 'preview_ready' | 'executed' | 'failed' | 'blocked';
  preview_id: string | null;
  depends_on: string[];
  error_message: string | null;
};

export type AiMutationPlanDto = {
  plan_id: string;
  summary: string | null;
  status: 'active' | 'completed' | 'failed';
  steps: AiMutationPlanStepDto[];
};

export type AiBulkMutationExclusionDto = {
  ref: string;
  reason: string;
};

export type AiMutationPlanPrepareResultDto = {
  plan: AiMutationPlanDto;
  previews: AiMutationPreviewDto[];
  errors: Array<{
    index: number;
    step_key: string;
    label: string | null;
    tool_name: string;
    message: string;
  }>;
  deferred: AiMutationPlanStepDto[];
  total: number;
  created: number;
  failed: number;
  deferred_count: number;
  target_set_label?: string | null;
  expected_count?: number | null;
  expected_refs?: string[];
  covered_refs?: string[];
  missing_refs?: string[];
  excluded?: AiBulkMutationExclusionDto[];
  complete: boolean;
};

export type AiTokenUsage = {
  input_tokens: number;
  output_tokens: number;
};

export type AiBuiltinUsageDto = {
  count: number;
  limit: number;
  year_month: string;
  reset_date: string;
};

export type AiChatActivityPhase =
  | 'analyzing'
  | 'preparing_context'
  | 'searching_entities'
  | 'reading_context'
  | 'searching_knowledge'
  | 'reading_document'
  | 'searching_web'
  | 'preparing_change'
  | 'using_tool'
  | 'generating_response'
  | 'finalizing';

export type AiChatActivityStatus = 'running' | 'completed' | 'failed';

export type AiChatContextItemDto = {
  kind: 'mention' | 'attachment' | 'entity' | 'document' | 'preview' | 'artifact' | 'tool';
  label: string;
  detail?: string | null;
  entity_type?: string | null;
  ref?: string | null;
  status?: string | null;
  count?: number | null;
};

export type AiChatContextBudgetDto = {
  estimated_request_size: number;
  budget: number | null;
  compacted: boolean;
  over_budget_after_compaction: boolean;
  breakdown?: {
    unit?: 'estimated_tokens';
    total: number;
    system_prompt: number;
    system_prompt_sections?: Array<{
      key: string;
      label: string;
      size: number;
    }>;
    messages: number;
    message_roles: {
      user: number;
      assistant: number;
      tool: number;
      other: number;
    };
    tool_call_metadata: number;
    protocol_overhead: number;
    tool_schemas?: {
      total: number;
      count: number;
      tools: Array<{
        name: string;
        size: number;
      }>;
    };
    total_with_tools?: number;
  } | null;
};

export type AiChatTimingDto = {
  started_at?: string;
  completed_at?: string;
  preparation_ms?: number;
  first_token_ms?: number;
  total_ms?: number;
  provider_stream_ms?: number;
  tool_execution_ms?: number;
  iterations?: number;
};

export type AiChatDebugTraceName =
  | 'context_prepared'
  | 'provider_request_started'
  | 'provider_stream_opened'
  | 'provider_first_raw_chunk'
  | 'provider_first_text_delta'
  | 'provider_first_tool_delta'
  | 'provider_tool_call_completed'
  | 'assistant_text_started'
  | 'tool_call_ready'
  | 'tool_execution_started'
  | 'tool_execution_completed'
  | 'turn_completed';

export type AiChatDebugTraceDto = {
  name: AiChatDebugTraceName;
  elapsed_ms: number;
  iteration?: number | null;
  tool_name?: string | null;
};

export type AiChatContextSummaryDto = {
  mentions?: AiChatContextItemDto[];
  attachments?: AiChatContextItemDto[];
  injected?: AiChatContextItemDto[];
  previews?: AiChatContextItemDto[];
  artifacts?: AiChatContextItemDto[];
  history?: {
    message_count: number;
    attachment_count: number;
    tool_result_count: number;
  };
  tools?: {
    available_count: number;
    selected_count?: number;
    writable_count: number;
    readable_entity_types: string[];
    context_profile?: string | null;
  };
  budget?: AiChatContextBudgetDto | null;
  timings?: AiChatTimingDto | null;
};

export type ChatStreamEvent =
  | { type: 'conversation'; id: string; title: string }
  | { type: 'activity'; phase: AiChatActivityPhase; status: AiChatActivityStatus; tool_name?: string | null }
  | { type: 'context'; context: AiChatContextSummaryDto }
  | ({ type: 'debug_trace' } & AiChatDebugTraceDto)
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; result: unknown }
  | ({ type: 'preview' } & AiMutationPreviewDto)
  | ({ type: 'preview_result' } & AiMutationPreviewDto)
  | { type: 'done'; usage?: AiTokenUsage; last_usage?: AiTokenUsage; conversation_usage?: AiTokenUsage; builtin_usage?: AiBuiltinUsageDto }
  | { type: 'error'; message: string; last_usage?: AiTokenUsage; conversation_usage?: AiTokenUsage; builtin_usage?: AiBuiltinUsageDto };

export type AiSurfaceCapabilityDto = {
  feature_enabled: boolean;
  tenant_enabled: boolean;
  permission_granted: boolean;
  provider_ready: boolean;
  available: boolean;
  reasons: string[];
};

export type AiSettingsCapabilityDto = {
  feature_enabled: boolean;
  permission_granted: boolean;
  available: boolean;
  reasons: string[];
};

export type AiCapabilitiesDto = {
  instance_features: {
    ai_chat: boolean;
    ai_mcp: boolean;
    ai_settings: boolean;
    ai_web_search: boolean;
  };
  surfaces: {
    chat: AiSurfaceCapabilityDto;
    mcp: AiSurfaceCapabilityDto;
    settings: AiSettingsCapabilityDto;
  };
  // The workspace's fallback model is the KANAP included model and no administrator
  // has confirmed it: agents without a model of their own are paused.
  builtin_confirmation_needed: boolean;
};
