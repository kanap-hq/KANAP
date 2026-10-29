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

export type AiMutationPreviewStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'expired'
  | 'failed';

/** The amounts of a budget line for one year, as the server sends them for a preview card. */
export type AiPreviewAmounts = {
  year: number | null;
  /** The line's currency code; null when unknown. */
  currency: string | null;
  /** The names the tenant gave its columns, by measure; the others keep the screens' names. */
  column_names: Partial<Record<string, string>>;
  /** A total per column, by measure. */
  totals?: Partial<Record<string, number>>;
  /** Quarterly amounts of one column. */
  quarters?: { measure: string; values: Record<'Q1' | 'Q2' | 'Q3' | 'Q4', number> };
  /** Monthly amounts: the number of months written. */
  months?: number;
};

/** One item of a relation on a preview card, its role by code in the catalog of its kind (`text`: typed by a person). */
export type AiPreviewRelationItem = {
  name: string;
  role: { kind: 'owner' | 'contact' | 'asset_relation' | 'server_role' | 'text'; code: string } | null;
  environment?: string | null;
  /** The cluster that contains the asset, for a host link a cluster's write replaces. */
  host?: string | null;
};

export type AiMutationPreview = {
  preview_id: string;
  tool_name: AiMutationWriteToolName;
  status: AiMutationPreviewStatus;
  target: {
    entity_type: string;
    entity_id: string | null;
    ref: string | null;
    title: string | null;
  };
  changes: Record<string, {
    label?: string | null;
    from: string | null;
    to: string | null;
    format?: 'text' | 'markdown';
    /** Budget amounts as numbers, written by the card; `from` and `to` hold an English text of them. */
    amounts?: { from: AiPreviewAmounts | null; to: AiPreviewAmounts | null };
    /** A classification level by its code in the tenant's catalog; `from` and `to` hold the catalog's base label. */
    classification?: {
      catalog: 'businessCriticalityLevels' | 'cyberCriticalityLevels' | 'dataClasses' | 'recoveryWaves';
      from: string | null;
      to: string | null;
    };
    /** The items of a relation with their role by code; `from` and `to` hold an English text of them. */
    relation_items?: { from: AiPreviewRelationItem[]; to: AiPreviewRelationItem[] };
  }>;
  requires_confirmation: boolean;
  actions: Array<'approve' | 'reject'>;
  summary: string;
  error_message: string | null;
  /** A failure of the service: the card says the change was not made, with `error_message` as its detail. */
  error_is_technical?: boolean;
  conversation_id: string | null;
  created_at: string;
  expires_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  executed_at: string | null;
};

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
};

export type BuiltinUsage = {
  count: number;
  limit: number;
  year_month: string;
  reset_date: string;
};

export type ChatActivityPhase =
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

export type ChatActivityStatus = 'running' | 'completed' | 'failed';

export type ChatActivityEntry = {
  phase: ChatActivityPhase;
  status: ChatActivityStatus;
  tool_name?: string | null;
  created_at?: string;
};

export type ChatContextItem = {
  kind: 'mention' | 'attachment' | 'entity' | 'document' | 'preview' | 'artifact' | 'tool';
  label: string;
  detail?: string | null;
  entity_type?: string | null;
  ref?: string | null;
  status?: string | null;
  count?: number | null;
};

export type ChatContextBudget = {
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

export type ChatTimings = {
  started_at?: string;
  completed_at?: string;
  preparation_ms?: number;
  first_token_ms?: number;
  total_ms?: number;
  provider_stream_ms?: number;
  tool_execution_ms?: number;
  iterations?: number;
};

export type ChatDebugTraceName =
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

export type ChatDebugTraceEntry = {
  name: ChatDebugTraceName;
  elapsed_ms: number;
  iteration?: number | null;
  tool_name?: string | null;
  created_at?: string;
};

export type ChatContextSummary = {
  mentions?: ChatContextItem[];
  attachments?: ChatContextItem[];
  injected?: ChatContextItem[];
  previews?: ChatContextItem[];
  artifacts?: ChatContextItem[];
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
  budget?: ChatContextBudget | null;
  timings?: ChatTimings | null;
};

export type ChatStreamEvent =
  | { type: 'conversation'; id: string; title: string }
  | { type: 'activity'; phase: ChatActivityPhase; status: ChatActivityStatus; tool_name?: string | null }
  | { type: 'context'; context: ChatContextSummary }
  | ({ type: 'debug_trace' } & Omit<ChatDebugTraceEntry, 'created_at'>)
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown> }
  /** `repairs`: the earlier failed calls of the same tool that this call repaired, as the server decides. */
  | { type: 'tool_result'; id: string; name: string; result: unknown; repairs?: string[] }
  | ({ type: 'preview' } & AiMutationPreview)
  | ({ type: 'preview_result' } & AiMutationPreview)
  | { type: 'done'; usage?: TokenUsage; last_usage?: TokenUsage; conversation_usage?: TokenUsage; builtin_usage?: BuiltinUsage }
  | { type: 'error'; message: string; last_usage?: TokenUsage; conversation_usage?: TokenUsage; builtin_usage?: BuiltinUsage };

export type ChatAttachment = {
  id: string;
  mime_type: string;
  size: number;
  kind: 'image' | string;
  /** Only present right after upload — used to render thumbnails before sending. */
  preview_url?: string | null;
};

export type StoredChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> | null;
  usage_json?: TokenUsage | null;
  created_at?: string;
  attachments?: ChatAttachment[];
};

export type ConversationMessagesResponse = {
  messages: StoredChatMessage[];
  conversation_usage: TokenUsage;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  toolResults?: Array<{ id: string; name: string; result: unknown; repairs?: string[] }>;
  usage?: TokenUsage;
  isStreaming?: boolean;
  hidden?: boolean;
  attachments?: ChatAttachment[];
  previewIds?: string[];
  activity?: ChatActivityEntry[];
  context?: ChatContextSummary;
  debugTrace?: ChatDebugTraceEntry[];
};

export type ChatConversation = {
  id: string;
  title: string | null;
  provider?: string | null;
  model?: string | null;
  created_at: string;
  updated_at: string;
};

export type AiApiKeyRecord = {
  id: string;
  tenant_id: string;
  user_id: string;
  key_prefix: string;
  label: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
  revocation_reason: string | null;
  created_at: string;
  created_by_user_id: string;
  /** `api_key` for a key made by hand, `oauth` for a connection approved on the consent page. */
  credential_kind?: 'api_key' | 'oauth' | string;
  oauth_client_id?: string | null;
  /** Chosen by the client itself: shown as text, next to the host it returns to. */
  oauth_client_name?: string | null;
  oauth_redirect_host?: string | null;
  /** The owner's name, in the administration list only. */
  user_name?: string | null;
};
