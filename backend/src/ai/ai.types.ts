import { EntityManager } from 'typeorm';
import { z } from 'zod';

export type AiSurface = 'chat' | 'mcp';
export type AiAuthMethod = 'jwt' | 'api_key' | 'oauth';
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
  | 'update_incident_links'
  | 'update_technology_links'
  | 'update_technology_versions'
  | 'update_technology_people'
  | 'update_technology_web_links'
  | 'set_technology_vulnerability_alerts'
  | 'change_vulnerability_state'
  | 'update_entity_relations'
  | 'update_document_content'
  | 'update_document_metadata'
  | 'update_document_relations'
  | 'update_task_fields'
  | 'update_task_status'
  | 'update_task_assignee'
  | 'add_incident_note'
  | 'change_incident_state'
  | 'set_incident_confidentiality'
  | 'add_task_comment'
  | 'delete_record';
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

/** The families the search index covers (`search_index_refresh_<type>`), which `search_all` searches. */
export const AI_SEARCH_ENTITY_TYPES = [
  'accounts',
  'analytics_categories',
  'applications',
  'assets',
  'budget_lines',
  'business_processes',
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
  'suppliers',
  'tasks',
  'technologies',
  'users',
] as const;

/**
 * The families query_entities, aggregate_entities and get_filter_values read: every searched
 * family, and the ones with no search index. `vulnerabilities` (the CVE rows of the technologies,
 * `query/ai-vulnerabilities.query.ts`) is listed only: `search_all` does not search it.
 * `technology_versions` (the versions of the technologies, `query/ai-technologies.query.ts`),
 * `support_gaps` and `support_deadlines` (the End of support report, `query/ai-support.query.ts`)
 * are listed only too: they have no record detail of their own. `roles` and `role_permissions`
 * (Admin › Roles, `query/ai-roles.query.ts`) are not searched either; a role has a detail (its
 * rights), a row of `role_permissions` none.
 */
export const AI_QUERY_ENTITY_TYPES = [
  ...AI_SEARCH_ENTITY_TYPES, 'vulnerabilities', 'technology_versions', 'support_gaps', 'support_deadlines', 'roles', 'role_permissions',
] as const;

/**
 * The families get_entity_detail reads: every queried family but the ones with no record detail.
 * A version is a row of its technology's detail; the two report families are computed rows with
 * no page of their own.
 */
export const AI_DETAIL_ENTITY_TYPES = AI_QUERY_ENTITY_TYPES.filter(
  (type) => type !== 'technology_versions' && type !== 'support_gaps' && type !== 'support_deadlines' && type !== 'role_permissions',
) as [
  Exclude<(typeof AI_QUERY_ENTITY_TYPES)[number], 'technology_versions' | 'support_gaps' | 'support_deadlines' | 'role_permissions'>,
  ...Array<Exclude<(typeof AI_QUERY_ENTITY_TYPES)[number], 'technology_versions' | 'support_gaps' | 'support_deadlines' | 'role_permissions'>>,
];

export const AI_CONTEXT_ENTITY_TYPES = [
  'applications',
  'assets',
  'projects',
  'requests',
  'tasks',
  'technologies',
  'contracts',
] as const;

/**
 * The `search_index.entity_type` values of the budget lines: the index keeps one type per nature
 * (they are baked into SQL functions, triggers and a RLS policy, `search_index`), and the AI
 * surface exposes the family `budget_lines` only. No migration.
 */
export const BUDGET_LINE_INDEX_ENTITY_TYPES = ['spend_items', 'capex_items'] as const;

/**
 * The index types a searched family reads on `search_index`: the budget lines read both natures,
 * every other family its own type.
 */
export function searchIndexEntityTypesFor(entityType: AiSearchEntityType): readonly string[] {
  return entityType === 'budget_lines' ? BUDGET_LINE_INDEX_ENTITY_TYPES : [entityType];
}

/** The AI family of an index row: a budget line of either nature reads `budget_lines`. */
export function aiSearchEntityTypeOfIndexRow(indexEntityType: string): AiSearchEntityType | null {
  if (indexEntityType === 'spend_items' || indexEntityType === 'capex_items') return 'budget_lines';
  return (AI_SEARCH_ENTITY_TYPES as readonly string[]).includes(indexEntityType)
    ? indexEntityType as AiSearchEntityType
    : null;
}

export const AiSearchEntityTypeSchema = z.enum(AI_SEARCH_ENTITY_TYPES);

export const AiQueryEntityTypeSchema = z.enum(AI_QUERY_ENTITY_TYPES);
export const AiDetailEntityTypeSchema = z.enum(AI_DETAIL_ENTITY_TYPES);
export const AiQueryScopeSchema = z.enum(['me', 'my_team']);

export const AiContextEntityTypeSchema = z.enum(AI_CONTEXT_ENTITY_TYPES);

export type AiSearchEntityType = z.infer<typeof AiSearchEntityTypeSchema>;
export type AiContextEntityType = z.infer<typeof AiContextEntityTypeSchema>;
export type AiQueryEntityType = z.infer<typeof AiQueryEntityTypeSchema>;
export type AiDetailEntityType = z.infer<typeof AiDetailEntityTypeSchema>;
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
  type: AiQueryEntityType | AiContextEntityType;
  id: string;
  ref: string | null;
  label: string;
  status: string | null;
  summary: string | null;
  created_at?: string | null;
  updated_at: string | null;
  match_context?: string | null;
  metadata?: AiEntityMetadata | null;
  /** The record's page, for a family without a business reference the user may open (`ai-page-urls.ts`). */
  page_url?: string;
};

export type AiEntityRelationshipGroupDto = {
  relation: string;
  label: string;
  items: AiEntitySummaryDto[];
  /** Bounded groups (`AI_CONTEXT_GROUP_ITEM_LIMIT`): every linked record, and whether `items` holds fewer. */
  total?: number;
  truncated?: boolean;
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
  /** The entity carries an extract of its fields: get_entity_detail gives them all. */
  fields_note?: string;
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
  /** The currency of the amounts, on the families that carry some (`ai-amounts-currency.util.ts`). */
  amounts_currency?: string | null;
  amounts_currency_note?: string;
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

/** A budget column, by the measure it stores (`spend/amounts-write.util.ts`). */
type AiPreviewAmountMeasure = 'planned' | 'committed' | 'forecast' | 'actual' | 'expected_landing';

/**
 * The amounts of a budget line for one year, as numbers: the card writes them in the person's
 * language and the line's currency, under the column names of the budget screens.
 */
export type AiPreviewAmounts = {
  year: number | null;
  /** The line's currency code; null when unknown. */
  currency: string | null;
  /** The names the tenant gave its columns; a column missing here keeps the screens' name. */
  column_names: Partial<Record<AiPreviewAmountMeasure, string>>;
  /** A total per column, in the fixed column order. */
  totals?: Partial<Record<AiPreviewAmountMeasure, number>>;
  /** Quarterly amounts of one column. */
  quarters?: { measure: AiPreviewAmountMeasure; values: Record<'Q1' | 'Q2' | 'Q3' | 'Q4', number> };
  /** Monthly amounts: the number of months written. */
  months?: number;
};

export type AiMutationPreviewChangeDto = {
  label?: string | null;
  from: string | null;
  to: string | null;
  format?: 'text' | 'markdown';
  /** Budget amounts, formatted by the card; `from` and `to` keep an English text of them. */
  amounts?: { from: AiPreviewAmounts | null; to: AiPreviewAmounts | null };
  /** A classification level by its code in the tenant's catalog, named by the card as the screens name it; `from` and `to` keep the catalog's base label. */
  classification?: { catalog: AiPreviewClassificationCatalog; from: string | null; to: string | null };
  /** The items of a relation with their role by code, named by the card as the screens name them; `from` and `to` keep an English text of them. */
  relation_items?: { from: AiPreviewRelationItem[]; to: AiPreviewRelationItem[] };
};

/**
 * The catalog of a relation item's role: an application owner (`business`, `it`), a supplier contact
 * role (`commercial`, `technical`, `support`, `other`), an asset relation (`contains`, `depends_on`),
 * a server role of an asset assignment, or a role typed by a person (`text`, shown as typed).
 */
export type AiPreviewRelationRoleKind = 'owner' | 'contact' | 'asset_relation' | 'server_role' | 'text';

/** One item of a relation on a preview card. */
export type AiPreviewRelationItem = {
  name: string;
  role: { kind: AiPreviewRelationRoleKind; code: string } | null;
  /** The environment of an asset assignment, by code. */
  environment?: string | null;
  /** The cluster that contains the asset, for a host link a cluster's write replaces. */
  host?: string | null;
};

/** The list of the application classification catalog a level belongs to. */
export type AiPreviewClassificationCatalog = 'businessCriticalityLevels' | 'cyberCriticalityLevels' | 'dataClasses' | 'recoveryWaves';

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
  /** A failure of the service (not a refused right): the card says the change was not made, with `error_message` as its detail. */
  error_is_technical?: boolean;
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
    /** The ref the failed step targets: a handled target, which the bulk completeness guard counts. */
    ref: string | null;
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
  /** `repairs`: the ids of the earlier failed calls of the same tool this call repaired (`ai-tool-repairs.ts`). */
  | { type: 'tool_result'; id: string; name: string; result: unknown; repairs?: string[] }
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
  // At least one enabled agent runs on the workspace's fallback model, the KANAP included
  // model, and no administrator has confirmed it: those agents are paused.
  builtin_confirmation_needed: boolean;
};
