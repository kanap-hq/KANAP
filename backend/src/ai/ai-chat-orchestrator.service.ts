import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { assertPublicHttpTarget } from '../common/ssrf-guard';
import { getEnvMode, isDevelopmentEnv } from '../common/env';
import { AiAttachmentService } from './ai-attachment.service';
import { AiConversationService } from './ai-conversation.service';
import { AiModelResolverService } from './ai-model-resolver.service';
import { AiMutationPreviewService } from './ai-mutation-preview.service';
import { AiPolicyService } from './ai-policy.service';
import { AiSecretCipherService } from './ai-secret-cipher.service';
import { AiSettingsService } from './ai-settings.service';
import { AiSystemPromptService } from './ai-system-prompt.service';
import {
  AiContextBudgetSectionBreakdown,
  estimateToolSchemaBreakdown,
  prepareAiProviderMessages,
  withToolSchemaBreakdown,
} from './ai-context-budget.helper';
import {
  filterToolListForProfile,
  selectAiContextProfileForTurn,
} from './ai-context-profile';
import { AiTenantExecutionService } from './execution/ai-tenant-execution.service';
import { AiProviderRegistry } from './providers/ai-provider-registry.service';
import {
  AiProviderAdapter,
  AiProviderImageAttachment,
  AiProviderMessage,
  AiProviderToolDef,
  AiProviderToolCall,
  AiStreamEvent,
} from './providers/ai-provider.types';
import { addUsage, cloneUsage, isAbortError, tryParseToolCallArguments } from './providers/streaming.util';
import { isOpenAiReasoningModel } from './providers/openai-stream.util';
import {
  AI_QUERY_ENTITY_TYPES,
  AiChatActivityPhase,
  AiChatContextItemDto,
  AiChatContextSummaryDto,
  AiChatDebugTraceName,
  AiBuiltinUsageDto,
  AiExecutionContext,
  AiExecutionContextWithManager,
  AiMutationPreviewDto,
  AiTokenUsage,
  ChatStreamEvent,
} from './ai.types';
import { buildStructuredToolResultValidation } from './ai-tool-result-validation.util';
import { BUILTIN_REASONING_EFFORT, PlatformAiConfigService } from './platform/platform-ai-config.service';
import { AiBuiltinUsageService } from './platform/ai-builtin-usage.service';
import { AiApprovalService } from './control-plane/approval/ai-approval.service';
import { AiCapabilityRegistry, EXECUTE_APPROVED_PREVIEW_CAPABILITY } from './control-plane/capability/ai-capability.registry';
import { AiCapabilityDispatcherService } from './control-plane/dispatcher/ai-capability-dispatcher.service';
import { budgetColumnsAiContext, readBudgetColumns } from '../budget-columns/budget-columns.util';

const MAX_TOOL_ITERATIONS = parsePositiveIntEnv(process.env.AI_CHAT_MAX_TOOL_ITERATIONS, 40);
/**
 * Per-turn output cap. The previous 4096 was too tight: when a write tool such as
 * create_document or update_document_content streams its arguments (the document
 * body lives inside the tool_call JSON), the model would hit finish_reason='length'
 * mid-arguments and the orchestrator would surface "Model output was truncated
 * before the tool call completed.". 16K covers ~12k words of markdown, which is
 * enough for the documents Plaid produces in practice. Modern providers (Anthropic
 * Claude 3.5+, GPT-4o, qwen3-* with vLLM) all support at least this much output.
 * Operators can override via env if their model needs more or less.
 */
const DEFAULT_MAX_TOKENS = parsePositiveIntEnv(process.env.AI_CHAT_MAX_TOKENS, 16384);
const OPENAI_REASONING_MAX_TOKENS = parsePositiveIntEnv(
  process.env.AI_CHAT_REASONING_MAX_TOKENS,
  Math.max(DEFAULT_MAX_TOKENS, 16384),
);

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return fallback;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
const DEFAULT_CHAT_PROVIDER_TIMEOUT_MS = 300_000;
const AI_CHAT_DEBUG_TRACE_ENABLED = isAiChatDebugTraceEnabled();
const MAX_UNSAFE_WRITE_RESPONSE_RETRIES = 2;
const MAX_REPEATED_TOOL_CALL_REPAIR_RETRIES = 2;
const SEARCH_ALL_NO_PROGRESS_CALL_THRESHOLD = parsePositiveIntEnv(process.env.AI_CHAT_SEARCH_ALL_NO_PROGRESS_CALL_THRESHOLD, 4);
const MAX_SEARCH_ALL_NO_PROGRESS_REPAIR_RETRIES = 1;
const APPROVE_MARKER_RE = /^\[APPROVE:([0-9a-f-]{36})\]$/i;
const REJECT_MARKER_RE = /^\[REJECT:([0-9a-f-]{36})\]$/i;
const APPROVE_SELECTED_MARKER_RE = /^\[APPROVE_SELECTED:([0-9a-f,\s-]+)\]$/i;
const REJECT_SELECTED_MARKER_RE = /^\[REJECT_SELECTED:([0-9a-f,\s-]+)\]$/i;
const TEXTUAL_CONFIRMATION_RE = /^(oui|yes|ok|okay|d'accord|daccord|vas-y|go ahead|procede|procède|confirm|confirme|approuve|approve)[\s!.?]*$/i;
/** Strip base64 data-URI images from text to avoid blowing up the LLM context. */
function stripBase64Images(text: string): string {
  // Markdown: ![alt](data:image/...;base64,...)
  text = text.replace(/!\[(?:\\.|[^\]\\])*\]\(data:image\/[^;]*;base64,[^)]+\)/gi, '[image removed]');
  // HTML: <img ... src="data:image/...;base64,..." ...>
  text = text.replace(/<img\b[^>]*\bsrc=(['"])data:image\/[^;]*;base64,[^'"]*\1[^>]*>/gi, '[image removed]');
  return text;
}

function isOfficialDeepSeekEndpoint(endpointUrl: string | null): boolean {
  if (!endpointUrl) {
    return false;
  }
  try {
    const parsed = new URL(endpointUrl);
    return parsed.hostname.toLowerCase() === 'api.deepseek.com';
  } catch {
    return false;
  }
}

function extractDeepSeekReasoningContent(providerMetadata: unknown): string | null {
  if (!providerMetadata || typeof providerMetadata !== 'object') {
    return null;
  }
  const deepseek = (providerMetadata as Record<string, unknown>).deepseek;
  if (!deepseek || typeof deepseek !== 'object') {
    return null;
  }
  const value = (deepseek as Record<string, unknown>).reasoning_content;
  return typeof value === 'string' && value.trim() ? value : null;
}

function deepSeekReasoningMetadata(reasoningContent: string): Record<string, unknown> | null {
  return reasoningContent.trim()
    ? { deepseek: { reasoning_content: reasoningContent } }
    : null;
}

function normalizePlainText(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isAssistantContinuationPromptText(content: string): boolean {
  const text = normalizePlainText(content);
  return content.includes('?') || /\b(souhaitez|souhaites|voulez|veux|procede|confirm|confirme|approve|approuver|approval|go ahead)\b/.test(text);
}

function containsRawToolMarkup(content: string): boolean {
  return /<\s*tool_call\b|<\s*\/\s*tool_call\s*>|<\s*function\s*=|<\s*parameter\s*=/i.test(content);
}

function asksForWriteExecutionWithoutPreview(content: string): boolean {
  const text = normalizePlainText(content);
  const asksForConfirmation = /[?]/.test(content)
    || /\b(souhaitez|souhaites|voulez|veux|do you want|would you like|shall i|should i|confirm|confirme|approve|approuver)\b/.test(text);
  const mentionsWriteExecution = /\b(execute|executer|execution|procede|proceder|applique|appliquer|apply|modification|modifications|changement|changements|reassign|assign|assigne|assignee|tache|taches|task|tasks)\b/.test(text);
  return asksForConfirmation && mentionsWriteExecution;
}

function hasMultiStepWriteSignals(content: string): boolean {
  const text = normalizePlainText(content);
  return /\b(etape|step|plan|depend|dependent|dependance|associe|associee|associees|associated|lie|lies|liees|linked|plusieurs|multiple|batch|groupe|group|ensuite|puis|apres|after)\b/.test(text)
    || /\b(projet|project)\b[\s\S]{0,160}\b(tache|taches|task|tasks)\b/.test(text)
    || /\b(tache|taches|task|tasks)\b[\s\S]{0,160}\b(projet|project)\b/.test(text)
    || /\b\d+\s+(tache|taches|task|tasks|modification|modifications|changes)\b/.test(text);
}

function isAiChatDebugTraceEnabled(): boolean {
  if (process.env.AI_CHAT_DEBUG_TRACE === '1') {
    return true;
  }
  if (process.env.AI_CHAT_DEBUG_TRACE === '0') {
    return false;
  }
  // Timing traces are a workstation aid: development mode only, never under test.
  return isDevelopmentEnv() && getEnvMode() !== 'test';
}

type ChatStreamParams = {
  context: AiExecutionContext;
  conversationId?: string | null;
  userMessage: string;
  /** Attachment ids that have already been uploaded for the current user message (multimodal). */
  attachmentIds?: string[] | null;
  /**
   * Edit/regenerate support: when set, the orchestrator deletes this message and every
   * message persisted after it in the same conversation BEFORE running the new turn.
   * - Edit  flow: client passes the user message id + a non-empty userMessage. The old
   *   user msg + all following are wiped, then the new userMessage is persisted as the
   *   replacement, then we stream a fresh assistant reply.
   * - Regen flow: client passes the assistant message id + an empty userMessage. The
   *   old assistant (and anything after) is wiped; no new user msg is persisted (the
   *   prior user msg already sits at the tail of the history); the LLM re-runs against
   *   that history.
   */
  truncateFromMessageId?: string | null;
  signal?: AbortSignal | null;
};

type CurrentUserPromptContext = {
  displayName: string;
  email: string | null;
  roleNames: string[];
  teamName: string | null;
};

type StreamUsage = {
  input_tokens: number;
  output_tokens: number;
};

type ApprovalAction =
  | { action: 'approve'; previewIds: string[] }
  | { action: 'reject'; previewIds: string[] };

type PreparedChatRequest = {
  context: AiExecutionContext;
  inputConversationId?: string | null;
  userMessage: string;
  attachmentIds?: string[] | null;
  truncateFromMessageId?: string | null;
  approvalAction: ApprovalAction | null;
  providerSource: 'builtin' | 'custom';
  provider: AiProviderAdapter;
  model: string;
  apiKey: string | null;
  endpointUrl: string | null;
  // Per-model timeout from the registry; null falls back to AI_CHAT_PROVIDER_TIMEOUT_MS.
  modelTimeoutMs: number | null;
  tenantName: string;
  builtinRateLimits?: {
    tenantPerMinute: number;
    userPerHour: number;
  };
};

type StreamPreparationResult = {
  conversationId: string;
  title: string;
  providerMessages: AiProviderMessage[];
  tools: AiProviderToolDef[];
  systemPromptText: string;
  systemPromptSections: AiContextBudgetSectionBreakdown[];
  preStreamEvents: ChatStreamEvent[];
  approvalAssistantText: string | null;
  contextSummary: AiChatContextSummaryDto;
  requiresWritePreviewGuard: boolean;
  writePreviewToolNames: string[];
};

function buildToolCallSignature(toolCalls: Array<{ name: string; arguments: string }>): string {
  return toolCalls
    .map((toolCall) => `${toolCall.name}\u0000${toolCall.arguments}`)
    .join('\u0001');
}

type SearchAllProgressState = {
  calls: number;
  noProgressCalls: number;
  repairRetries: number;
  seenItemKeys: Set<string>;
};

type SearchAllNoProgressIntervention = {
  action: 'repair' | 'fail';
  calls: number;
  noProgressCalls: number;
  query: string | null;
  failedEntityTypes: string[];
  complete: boolean | null;
  truncated: boolean | null;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringArrayField(value: unknown, field: string): string[] {
  if (!isPlainRecord(value) || !Array.isArray(value[field])) {
    return [];
  }
  return value[field].filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function stringToolArg(args: unknown, field: string): string | null {
  if (!isPlainRecord(args)) {
    return null;
  }
  const value = args[field];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function searchResultItemKey(item: unknown): string | null {
  if (!isPlainRecord(item)) {
    return null;
  }
  const type = typeof item.type === 'string'
    ? item.type
    : typeof item.entity_type === 'string'
      ? item.entity_type
      : 'item';
  const id = typeof item.id === 'string' && item.id.trim().length > 0
    ? item.id
    : typeof item.ref === 'string' && item.ref.trim().length > 0
      ? item.ref
      : null;
  return id ? `${type}:${id}` : null;
}

function recordSearchAllProgress(params: {
  state: SearchAllProgressState;
  toolName: string;
  parsedArgs: unknown;
  result: unknown;
}): SearchAllNoProgressIntervention | null {
  if (params.toolName !== 'search_all') {
    return null;
  }

  const result = isPlainRecord(params.result) ? params.result : {};
  const items = Array.isArray(result.items) ? result.items : [];
  const itemKeys = items.map(searchResultItemKey).filter((key): key is string => !!key);
  const newKeys = itemKeys.filter((key) => !params.state.seenItemKeys.has(key));
  for (const key of itemKeys) {
    params.state.seenItemKeys.add(key);
  }

  params.state.calls++;
  if (newKeys.length === 0) {
    params.state.noProgressCalls++;
  } else {
    params.state.noProgressCalls = 0;
  }

  if (params.state.noProgressCalls < SEARCH_ALL_NO_PROGRESS_CALL_THRESHOLD) {
    return null;
  }

  const intervention: SearchAllNoProgressIntervention = {
    action: params.state.repairRetries < MAX_SEARCH_ALL_NO_PROGRESS_REPAIR_RETRIES ? 'repair' : 'fail',
    calls: params.state.calls,
    noProgressCalls: params.state.noProgressCalls,
    query: stringToolArg(params.parsedArgs, 'query'),
    failedEntityTypes: stringArrayField(result, 'failed_entity_types'),
    complete: typeof result.complete === 'boolean' ? result.complete : null,
    truncated: typeof result.truncated === 'boolean' ? result.truncated : null,
  };

  if (intervention.action === 'repair') {
    params.state.repairRetries++;
    params.state.noProgressCalls = 0;
  }

  return intervention;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Frontend deep-link patterns keyed by the entity_type stored on a mutation preview's
 * target. When the user approves a mutation, the executed-state summary contains the
 * entity ref (e.g. "Created DOC-152.") and we rewrite that ref into a markdown link so
 * the assistant's confirmation is one click away from the artifact.
 *
 * Keep this in sync with frontend/src/App.tsx routes. Sub-entities of master-data
 * such as accounts/chart_of_accounts/analytics_categories don't have workspace pages
 * yet — leave them out so we don't surface dead links.
 */
const ENTITY_URL_BUILDERS: Record<string, (id: string) => string> = {
  documents: (id) => `/knowledge/${id}`,
  tasks: (id) => `/portfolio/tasks/${id}`,
  projects: (id) => `/portfolio/projects/${id}`,
  requests: (id) => `/portfolio/requests/${id}`,
  applications: (id) => `/it/applications/${id}`,
  assets: (id) => `/it/assets/${id}`,
  incidents: (id) => `/it/incidents/${id}`,
  connections: (id) => `/it/connections/${id}`,
  interfaces: (id) => `/it/interfaces/${id}`,
  locations: (id) => `/it/locations/${id}`,
  contracts: (id) => `/ops/contracts/${id}`,
  capex_items: (id) => `/ops/capex/${id}`,
  companies: (id) => `/master-data/companies/${id}`,
  contacts: (id) => `/master-data/contacts/${id}`,
  departments: (id) => `/master-data/departments/${id}`,
  suppliers: (id) => `/master-data/suppliers/${id}`,
  business_processes: (id) => `/master-data/business-processes/${id}`,
};

const ENTITY_TYPE_FROM_URL_PREFIX: Array<{ prefix: string; entityType: string }> = [
  { prefix: '/knowledge/', entityType: 'documents' },
  { prefix: '/portfolio/tasks/', entityType: 'tasks' },
  { prefix: '/portfolio/projects/', entityType: 'projects' },
  { prefix: '/portfolio/requests/', entityType: 'requests' },
  { prefix: '/it/applications/', entityType: 'applications' },
  { prefix: '/it/assets/', entityType: 'assets' },
  { prefix: '/it/incidents/', entityType: 'incidents' },
  { prefix: '/it/connections/', entityType: 'connections' },
  { prefix: '/it/interfaces/', entityType: 'interfaces' },
  { prefix: '/it/locations/', entityType: 'locations' },
  { prefix: '/ops/contracts/', entityType: 'contracts' },
  { prefix: '/ops/capex/', entityType: 'capex_items' },
  { prefix: '/master-data/companies/', entityType: 'companies' },
  { prefix: '/master-data/contacts/', entityType: 'contacts' },
  { prefix: '/master-data/departments/', entityType: 'departments' },
  { prefix: '/master-data/suppliers/', entityType: 'suppliers' },
  { prefix: '/master-data/business-processes/', entityType: 'business_processes' },
];

function normalizeContextLabel(value: unknown, fallback = 'Item'): string {
  const normalized = String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.slice(0, 120) || fallback;
}

function inferEntityTypeFromUrl(url: string): string | null {
  const match = ENTITY_TYPE_FROM_URL_PREFIX.find((entry) => url.startsWith(entry.prefix));
  return match?.entityType ?? null;
}

function extractMentionContextItems(text: string): AiChatContextItemDto[] {
  const items: AiChatContextItemDto[] = [];
  const seen = new Set<string>();
  const markdownLinkRe = /\[([^\]]{1,160})\]\((\/[^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = markdownLinkRe.exec(text)) != null) {
    const [, rawLabel, rawUrl] = match;
    const entityType = inferEntityTypeFromUrl(rawUrl);
    if (!entityType) {
      continue;
    }
    const label = normalizeContextLabel(rawLabel);
    const key = `${entityType}:${label}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push({
      kind: 'mention',
      label,
      entity_type: entityType,
      ref: label.match(/^[A-Z]+-\d+$/) ? label : null,
    });
  }
  return items.slice(0, 12);
}

function formatAttachmentDetail(attachment: {
  kind?: string | null;
  mime_type?: string | null;
  size?: number | null;
}): string {
  const kind = normalizeContextLabel(attachment.kind || attachment.mime_type || 'attachment', 'attachment');
  const size = Number(attachment.size ?? 0);
  if (!Number.isFinite(size) || size <= 0) {
    return kind;
  }
  if (size >= 1024 * 1024) {
    return `${kind}, ${Math.round((size / (1024 * 1024)) * 10) / 10} MB`;
  }
  if (size >= 1024) {
    return `${kind}, ${Math.round(size / 1024)} KB`;
  }
  return `${kind}, ${size} B`;
}

function attachmentContextItems(attachments: Array<{
  original_filename?: string | null;
  kind?: string | null;
  mime_type?: string | null;
  size?: number | null;
}>): AiChatContextItemDto[] {
  return attachments.slice(0, 8).map((attachment) => ({
    kind: 'attachment',
    label: normalizeContextLabel(attachment.original_filename, 'Image'),
    detail: formatAttachmentDetail(attachment),
  }));
}

function previewContextItems(previews: AiMutationPreviewDto[]): AiChatContextItemDto[] {
  return previews.slice(-8).map((preview) => {
    const label = normalizeContextLabel(
      preview.target?.ref || preview.target?.title || preview.summary || preview.tool_name,
      preview.tool_name,
    );
    return {
      kind: 'preview',
      label,
      detail: normalizeContextLabel(preview.tool_name.replace(/_/g, ' '), 'preview'),
      entity_type: preview.target?.entity_type ?? null,
      ref: preview.target?.ref ?? null,
      status: preview.status,
    };
  });
}

function isMutationPreviewDto(value: unknown): value is AiMutationPreviewDto {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.preview_id === 'string'
    && typeof candidate.tool_name === 'string'
    && typeof candidate.status === 'string'
    && candidate.target != null
    && candidate.changes != null;
}

function mutationPreviewDtosFromResult(result: unknown): AiMutationPreviewDto[] {
  if (isMutationPreviewDto(result)) {
    return [result];
  }
  if (!result || typeof result !== 'object') {
    return [];
  }
  const previews = (result as Record<string, unknown>).previews;
  return Array.isArray(previews)
    ? previews.filter(isMutationPreviewDto)
    : [];
}

type BulkTargetSet = {
  source: string;
  label: string | null;
  entityType: string | null;
  refs: string[];
  expectedCount: number | null;
  explicit: boolean;
};

type BulkCoverageIssue = {
  source: string;
  label: string | null;
  entityType: string | null;
  expectedCount: number | null;
  expectedRefs: string[];
  coveredRefs: string[];
  failedRefs: string[];
  excludedRefs: string[];
  missingRefs: string[];
};

function normalizeBulkRef(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.toUpperCase() : null;
}

function normalizeBulkRefs(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const ref = normalizeBulkRef(value);
    if (!ref || seen.has(ref)) {
      continue;
    }
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}

function stableJson(value: unknown): string {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) =>
    `${JSON.stringify(key)}:${stableJson(object[key])}`,
  ).join(',')}}`;
}

function extractBulkExcludedRefs(result: unknown): string[] {
  if (!result || typeof result !== 'object') {
    return [];
  }
  const excluded = (result as Record<string, unknown>).excluded;
  if (!Array.isArray(excluded)) {
    return [];
  }
  return normalizeBulkRefs(excluded.map((item) =>
    item && typeof item === 'object' ? (item as Record<string, unknown>).ref : null,
  ));
}

function extractBulkFailedRefs(result: unknown): string[] {
  if (!result || typeof result !== 'object') {
    return [];
  }
  const errors = (result as Record<string, unknown>).errors;
  if (!Array.isArray(errors)) {
    return [];
  }
  return normalizeBulkRefs(errors.map((item) => {
    if (!item || typeof item !== 'object') {
      return null;
    }
    const candidate = item as Record<string, unknown>;
    return candidate.ref ?? candidate.target_ref;
  }));
}

function extractExplicitBulkTargetSet(toolName: string, result: unknown): BulkTargetSet | null {
  if (!result || typeof result !== 'object') {
    return null;
  }
  const data = result as Record<string, unknown>;
  const refs = normalizeBulkRefs(data.expected_refs);
  const expectedCount = numberOrNull(data.expected_count);
  if (refs.length === 0 && (expectedCount == null || expectedCount <= 1)) {
    return null;
  }
  const previews = mutationPreviewDtosFromResult(result);
  const entityTypes = Array.from(new Set(previews
    .map((preview) => preview.target?.entity_type)
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
  return {
    source: toolName,
    label: typeof data.target_set_label === 'string' && data.target_set_label.trim()
      ? data.target_set_label.trim()
      : null,
    entityType: entityTypes.length === 1 ? entityTypes[0] : null,
    refs,
    expectedCount,
    explicit: true,
  };
}

function extractQueryBulkTargetSet(toolName: string, args: Record<string, unknown>, result: unknown): BulkTargetSet | null {
  if (toolName !== 'query_entities' || !result || typeof result !== 'object') {
    return null;
  }
  const data = result as Record<string, unknown>;
  if (data.complete !== true || data.truncated === true) {
    return null;
  }
  const refs = normalizeBulkRefs(Array.isArray(data.items)
    ? data.items.map((item) => item && typeof item === 'object' ? (item as Record<string, unknown>).ref : null)
    : []);
  if (refs.length <= 1) {
    return null;
  }
  const expectedCount = numberOrNull(data.total) ?? refs.length;
  const entityType = typeof args.entity_type === 'string' && args.entity_type.trim()
    ? args.entity_type.trim()
    : null;
  return {
    source: 'query_entities',
    label: entityType ? `${entityType} query result` : 'query result',
    entityType,
    refs,
    expectedCount: Math.max(expectedCount, refs.length),
    explicit: false,
  };
}

function addRefs(target: Set<string>, refs: string[]): void {
  for (const ref of refs) {
    target.add(ref);
  }
}

function findBulkCoverageIssue(params: {
  targetSets: BulkTargetSet[];
  coveredRefs: Set<string>;
  coveredRefsByEntityType: Map<string, Set<string>>;
  failedRefs: Set<string>;
  excludedRefs: Set<string>;
  requireExistingCoverage?: boolean;
}): BulkCoverageIssue | null {
  for (const targetSet of [...params.targetSets].reverse()) {
    if (targetSet.refs.length === 0 && (targetSet.expectedCount == null || targetSet.expectedCount <= 1)) {
      continue;
    }
    const coverageSet = targetSet.entityType
      ? params.coveredRefsByEntityType.get(targetSet.entityType) ?? new Set<string>()
      : params.coveredRefs;
    const coveredRefs = targetSet.refs.filter((ref) => coverageSet.has(ref) || params.coveredRefs.has(ref));
    const failedRefs = targetSet.refs.filter((ref) => params.failedRefs.has(ref));
    const excludedRefs = targetSet.refs.filter((ref) => params.excludedRefs.has(ref));
    if (!targetSet.explicit && params.requireExistingCoverage !== false && coveredRefs.length === 0) {
      continue;
    }

    const missingRefs = targetSet.refs.filter((ref) =>
      !coverageSet.has(ref)
      && !params.coveredRefs.has(ref)
      && !params.failedRefs.has(ref)
      && !params.excludedRefs.has(ref),
    );
    const handledCount = coveredRefs.length + failedRefs.length + excludedRefs.length;
    const countIncomplete = targetSet.expectedCount != null && handledCount < targetSet.expectedCount;
    if (missingRefs.length === 0 && !countIncomplete) {
      continue;
    }

    return {
      source: targetSet.source,
      label: targetSet.label,
      entityType: targetSet.entityType,
      expectedCount: targetSet.expectedCount,
      expectedRefs: targetSet.refs,
      coveredRefs,
      failedRefs,
      excludedRefs,
      missingRefs,
    };
  }
  return null;
}

function isRefBasedSingleMutationTool(toolName: string, writePreviewToolNames: string[]): boolean {
  return writePreviewToolNames.includes(toolName)
    && toolName !== 'prepare_mutation_plan'
    && toolName !== 'update_task_assignees'
    && toolName !== 'undo_preview';
}

function buildBulkAutoplanInput(params: {
  issue: BulkCoverageIssue;
  toolName: string;
  input: Record<string, unknown>;
}): Record<string, unknown> | null {
  if (params.issue.missingRefs.length <= 1) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(params.input, 'ref')) {
    return null;
  }
  const requestedRef = normalizeBulkRef(params.input.ref);
  if (
    requestedRef
    && params.issue.expectedRefs.length > 0
    && !params.issue.expectedRefs.includes(requestedRef)
  ) {
    return null;
  }
  const baseInput = { ...params.input };
  const targetLabel = params.issue.label || params.issue.entityType || 'bulk target set';
  return {
    summary: `Prepare missing ${params.toolName} previews for ${targetLabel}.`,
    target_set_label: targetLabel,
    expected_target_refs: params.issue.missingRefs,
    expected_target_count: params.issue.missingRefs.length,
    operations: params.issue.missingRefs.map((ref, index) => ({
      operation_id: `${params.toolName}_${ref.toLowerCase().replace(/[^a-z0-9_-]+/g, '_')}_${index + 1}`.slice(0, 80),
      tool_name: params.toolName,
      input: {
        ...baseInput,
        ref,
      },
    })),
  };
}

function buildAugmentedBulkMutationPlanInput(params: {
  issue: BulkCoverageIssue;
  input: Record<string, unknown>;
}): Record<string, unknown> | null {
  const operations = Array.isArray(params.input.operations)
    ? params.input.operations as Array<Record<string, unknown>>
    : [];
  if (params.issue.missingRefs.length <= operations.length || operations.length === 0) {
    return null;
  }

  const normalizedOperations = operations.map((operation) => {
    const toolName = typeof operation.tool_name === 'string' ? operation.tool_name.trim() : '';
    const input = operation.input && typeof operation.input === 'object' && !Array.isArray(operation.input)
      ? operation.input as Record<string, unknown>
      : null;
    const ref = input ? normalizeBulkRef(input.ref) : null;
    const dependsOn = Array.isArray(operation.depends_on) ? operation.depends_on : [];
    return { toolName, input, ref, dependsOn };
  });

  if (
    normalizedOperations.some((operation) =>
      !operation.toolName
      || !operation.input
      || !operation.ref
      || operation.dependsOn.length > 0
      || !params.issue.expectedRefs.includes(operation.ref),
    )
  ) {
    return null;
  }

  const [first] = normalizedOperations;
  const inputShape = stableJson({ ...first.input, ref: '__REF__' });
  if (normalizedOperations.some((operation) =>
    operation.toolName !== first.toolName
    || stableJson({ ...operation.input!, ref: '__REF__' }) !== inputShape,
  )) {
    return null;
  }

  const targetLabel = params.issue.label || params.issue.entityType || 'bulk target set';
  return {
    ...params.input,
    summary: params.input.summary || `Prepare missing ${first.toolName} previews for ${targetLabel}.`,
    target_set_label: params.input.target_set_label || targetLabel,
    expected_target_refs: params.issue.missingRefs,
    expected_target_count: params.issue.missingRefs.length,
    operations: params.issue.missingRefs.map((ref, index) => ({
      operation_id: `${first.toolName}_${ref.toLowerCase().replace(/[^a-z0-9_-]+/g, '_')}_${index + 1}`.slice(0, 80),
      tool_name: first.toolName,
      input: {
        ...first.input!,
        ref,
      },
    })),
  };
}

const ENTITY_REF_MENTION_RE = /\b[A-Z]{1,8}-\d+\b/gi;

function extractEntityRefsFromText(text: string): string[] {
  return normalizeBulkRefs(Array.from(String(text || '').matchAll(ENTITY_REF_MENTION_RE), (match) => match[0]));
}

function inferEntityTypeFromRefs(refs: string[]): string | null {
  const prefixes = Array.from(new Set(refs.map((ref) => ref.split('-')[0])));
  if (prefixes.length !== 1) {
    return null;
  }
  switch (prefixes[0]) {
    case 'T':
      return 'tasks';
    case 'PRJ':
      return 'projects';
    case 'REQ':
      return 'requests';
    case 'APP':
      return 'applications';
    case 'AST':
      return 'assets';
    case 'DOC':
      return 'documents';
    default:
      return null;
  }
}

function lineLooksExplicitlyExcluded(line: string): boolean {
  const text = normalizePlainText(line);
  return /\b(exclu|exclus|exclues|excluded|ignore|ignored|hors scope|rejeter|rejet|done|termine|terminee|terminees|completed|cancelled|canceled|annule|annulee|annulees)\b/.test(text);
}

function lineLooksIncludedTargetHeading(line: string): boolean {
  const text = normalizePlainText(line);
  return /\b(actif|active|actives|restant|restants|restantes|relancer|inclu|inclus|included|cibles?|ciblee|ciblees|targets?)\b/.test(text)
    && !lineLooksExplicitlyExcluded(line);
}

function extractExpectedBulkCounts(text: string): number[] {
  const normalized = normalizePlainText(text);
  const counts: number[] = [];
  const pattern = /\b(\d{1,3})\s+(?:previews?|taches?|tasks?|modifications?|changements?|cibles?|targets?)\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized)) != null) {
    const count = Number(match[1]);
    if (Number.isFinite(count) && count > 1 && !counts.includes(count)) {
      counts.push(count);
    }
  }
  return counts;
}

function hasBulkContinuationSignal(text: string): boolean {
  const normalized = normalizePlainText(text);
  return hasMultiStepWriteSignals(text)
    || /\b(restant|restants|restante|restantes|reste|restent|manquant|manquants|manquantes|missing|remaining|continue|continuer|suite|toutes|tous|all|chaque|each|lot|batch|groupe|group|une seule|only one|just one|pas toutes|pas tous)\b/.test(normalized)
    || /\bqu['’ ]?une\b/.test(normalized);
}

function extractTextualBulkTargetSet(content: string): BulkTargetSet | null {
  const refs: string[] = [];
  let inExcludedSection = false;
  for (const line of String(content || '').split(/\r?\n/)) {
    if (lineLooksIncludedTargetHeading(line)) {
      inExcludedSection = false;
    } else if (lineLooksExplicitlyExcluded(line)) {
      inExcludedSection = true;
    }
    const lineRefs = extractEntityRefsFromText(line);
    if (lineRefs.length === 0 || inExcludedSection || lineLooksExplicitlyExcluded(line)) {
      continue;
    }
    for (const ref of lineRefs) {
      if (!refs.includes(ref)) {
        refs.push(ref);
      }
    }
  }
  if (refs.length <= 1) {
    return null;
  }
  return {
    source: 'assistant_text',
    label: 'assistant stated target set',
    entityType: inferEntityTypeFromRefs(refs),
    refs,
    expectedCount: refs.length,
    explicit: true,
  };
}

function latestUserText(messages: AiProviderMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === 'user') {
      return message.content;
    }
  }
  return '';
}

function selectTextualBulkTargetSet(params: {
  messages: AiProviderMessage[];
  currentAssistantText: string;
  requestedRef: unknown;
}): BulkTargetSet | null {
  const userText = latestUserText(params.messages);
  if (!hasBulkContinuationSignal(params.currentAssistantText) && !hasBulkContinuationSignal(userText)) {
    return null;
  }

  const requestedRef = normalizeBulkRef(params.requestedRef);
  const expectedCounts = [
    ...extractExpectedBulkCounts(params.currentAssistantText),
    ...extractExpectedBulkCounts(userText),
  ];
  const currentTargetSet = extractTextualBulkTargetSet(params.currentAssistantText);
  const candidates = [
    ...params.messages
    .filter((message) => message.role === 'assistant' && String(message.content || '').trim())
    .map((message) => extractTextualBulkTargetSet(message.content))
    .filter((targetSet): targetSet is BulkTargetSet => targetSet != null),
    ...(currentTargetSet ? [currentTargetSet] : []),
  ].filter((targetSet) => !requestedRef || targetSet.refs.includes(requestedRef));

  if (candidates.length === 0) {
    return null;
  }
  for (const expectedCount of expectedCounts) {
    const matching = [...candidates].reverse().find((targetSet) => targetSet.refs.length === expectedCount);
    if (matching) {
      return matching;
    }
  }
  return candidates[candidates.length - 1];
}

function textExplicitlyAddressesMissingRefs(text: string, refs: string[]): boolean {
  const normalized = normalizePlainText(text);
  if (!/\b(assumption|assume|hypothese|suppose|exclu|exclus|excluded|ignore|ignored|hors scope|not included|pas inclus|non inclus)\b/.test(normalized)) {
    return false;
  }
  const upperText = String(text || '').toUpperCase();
  return refs.every((ref) => upperText.includes(ref.toUpperCase()));
}

function toolActivityPhase(toolName: string): AiChatActivityPhase {
  if ([
    'search_all',
    'query_entities',
    'aggregate_entities',
    'describe_entity_filters',
    'get_filter_values',
  ].includes(toolName)) {
    return 'searching_entities';
  }
  if (['get_entity_detail', 'get_entity_context', 'get_entity_comments'].includes(toolName)) {
    return 'reading_context';
  }
  if (toolName === 'search_knowledge') {
    return 'searching_knowledge';
  }
  if (toolName === 'get_document') {
    return 'reading_document';
  }
  if (toolName === 'web_search') {
    return 'searching_web';
  }
  if (toolName === 'undo_preview' || toolName === 'prepare_mutation_plan' || toolName.startsWith('create_') || toolName.startsWith('update_') || toolName.startsWith('add_') || toolName.startsWith('import_') || toolName.startsWith('write_')) {
    return 'preparing_change';
  }
  return 'using_tool';
}

function resultEntityItem(item: any, fallbackKind: AiChatContextItemDto['kind']): AiChatContextItemDto | null {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const entityType = typeof item.type === 'string'
    ? item.type
    : typeof item.entity_type === 'string'
      ? item.entity_type
      : null;
  const label = normalizeContextLabel(item.ref || item.title || item.label || item.name || item.id, 'Item');
  const rawDetail = item.title || item.label || item.summary || entityType || fallbackKind;
  return {
    kind: entityType === 'documents' ? 'document' : fallbackKind,
    label,
    detail: rawDetail ? normalizeContextLabel(rawDetail) : null,
    entity_type: entityType,
    ref: typeof item.ref === 'string' ? item.ref : null,
    status: typeof item.status === 'string' ? item.status : null,
  };
}

function toolResultContextItems(toolName: string, result: unknown): AiChatContextItemDto[] {
  if (!result || typeof result !== 'object') {
    return [];
  }
  const data = result as Record<string, unknown>;
  const previews = mutationPreviewDtosFromResult(result);
  if (previews.length > 0) {
    return previewContextItems(previews);
  }

  if (toolName === 'get_document') {
    const label = normalizeContextLabel((data.ref as string) || (data.title as string), 'Document');
    return [{
      kind: 'document',
      label,
      detail: typeof data.title === 'string' ? normalizeContextLabel(data.title) : null,
      entity_type: 'documents',
      ref: typeof data.ref === 'string' ? data.ref : null,
      status: typeof data.status === 'string' ? data.status : null,
    }];
  }

  const leadingItems = data.entity && typeof data.entity === 'object' ? [data.entity] : [];
  const rawItems = Array.isArray(data.items)
    ? data.items
    : Array.isArray(data.groups)
      ? []
      : Array.isArray(data.related)
        ? (data.related as any[]).flatMap((group) => Array.isArray(group?.items) ? group.items : [])
        : [];

  const kind: AiChatContextItemDto['kind'] = toolName === 'search_knowledge' ? 'document' : 'entity';
  const items = [...leadingItems, ...rawItems]
    .map((item) => resultEntityItem(item, kind))
    .filter((item): item is AiChatContextItemDto => item != null)
    .slice(0, 8);

  const total = typeof data.total === 'number'
    ? data.total
    : rawItems.length;
  if (items.length > 0 && total > items.length) {
    items.push({
      kind,
      label: `${total - items.length} more`,
      count: total - items.length,
    });
  }

  return items;
}

export function resolveProviderMaxTokens(providerId: string, model: string): number {
  if (providerId === 'openai' && isOpenAiReasoningModel(model)) {
    return OPENAI_REASONING_MAX_TOKENS;
  }
  return DEFAULT_MAX_TOKENS;
}

export function resolveChatProviderTimeoutMs(rawValue = process.env.AI_CHAT_PROVIDER_TIMEOUT_MS): number {
  const normalized = String(rawValue ?? '').trim();
  if (!normalized) {
    return DEFAULT_CHAT_PROVIDER_TIMEOUT_MS;
  }
  if (!/^\d+$/.test(normalized)) {
    return DEFAULT_CHAT_PROVIDER_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(normalized, 10);
  return parsed > 0 ? parsed : DEFAULT_CHAT_PROVIDER_TIMEOUT_MS;
}

@Injectable()
export class AiChatOrchestratorService {
  private readonly logger = new Logger(AiChatOrchestratorService.name);

  constructor(
    private readonly tenantExecutor: AiTenantExecutionService,
    private readonly policy: AiPolicyService,
    private readonly settings: AiSettingsService,
    private readonly cipher: AiSecretCipherService,
    private readonly modelResolver: AiModelResolverService,
    private readonly providerRegistry: AiProviderRegistry,
    private readonly platformAiConfig: PlatformAiConfigService,
    private readonly builtinUsage: AiBuiltinUsageService,
    private readonly conversations: AiConversationService,
    private readonly previews: AiMutationPreviewService,
    private readonly capabilityRegistry: AiCapabilityRegistry,
    private readonly dispatcher: AiCapabilityDispatcherService,
    private readonly approvals: AiApprovalService,
    private readonly systemPrompt: AiSystemPromptService,
    private readonly attachments: AiAttachmentService,
  ) {}

  private parseApprovalAction(userMessage: string): ApprovalAction | null {
    const normalized = String(userMessage || '').trim();
    const approveMatch = normalized.match(APPROVE_MARKER_RE);
    if (approveMatch) {
      return { action: 'approve', previewIds: [approveMatch[1]] };
    }
    const rejectMatch = normalized.match(REJECT_MARKER_RE);
    if (rejectMatch) {
      return { action: 'reject', previewIds: [rejectMatch[1]] };
    }
    const approveSelectedMatch = normalized.match(APPROVE_SELECTED_MARKER_RE);
    if (approveSelectedMatch) {
      const previewIds = this.parsePreviewIdList(approveSelectedMatch[1]);
      return previewIds.length > 0 ? { action: 'approve', previewIds } : null;
    }
    const rejectSelectedMatch = normalized.match(REJECT_SELECTED_MARKER_RE);
    if (rejectSelectedMatch) {
      const previewIds = this.parsePreviewIdList(rejectSelectedMatch[1]);
      return previewIds.length > 0 ? { action: 'reject', previewIds } : null;
    }
    return null;
  }

  private parsePreviewIdList(rawValue: string): string[] {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = String(rawValue || '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => uuidRe.test(value));
    return Array.from(new Set(ids));
  }

  private toProviderUserContent(userMessage: string): string {
    const approvalAction = this.parseApprovalAction(userMessage);
    if (!approvalAction) {
      return stripBase64Images(userMessage);
    }
    if (approvalAction.action === 'approve') {
      return approvalAction.previewIds.length === 1
        ? 'The user explicitly approved the pending AI preview.'
        : 'The user explicitly approved multiple pending AI previews.';
    }
    return approvalAction.previewIds.length === 1
      ? 'The user explicitly rejected the pending AI preview.'
      : 'The user explicitly rejected multiple pending AI previews.';
  }

  private isTextualConfirmationMessage(userMessage: string): boolean {
    return TEXTUAL_CONFIRMATION_RE.test(String(userMessage || '').trim());
  }

  private shouldRewriteTextualWriteConfirmation(params: {
    history: Array<{ role: string; content: string }>;
    existingPreviews: AiMutationPreviewDto[];
  }): boolean {
    if (params.existingPreviews.some((preview) => preview.status === 'pending')) {
      return false;
    }

    const latestUserIndex = [...params.history].reverse().findIndex((message) => message.role === 'user');
    if (latestUserIndex < 0) {
      return false;
    }
    const latestIndex = params.history.length - 1 - latestUserIndex;
    const latestUser = params.history[latestIndex];
    if (!this.isTextualConfirmationMessage(latestUser.content)) {
      return false;
    }

    const contextProfile = selectAiContextProfileForTurn(
      params.history
        .filter((message) => message.role === 'user' || message.role === 'assistant' || message.role === 'tool')
        .map((message) => ({
          role: message.role as 'user' | 'assistant' | 'tool',
          content: message.content,
        })),
    );
    if (contextProfile.promptMode !== 'write') {
      return false;
    }

    for (let index = latestIndex - 1; index >= 0; index--) {
      const message = params.history[index];
      if (message.role === 'user') {
        return false;
      }
      if (message.role === 'assistant' && message.content.trim()) {
        return isAssistantContinuationPromptText(message.content);
      }
    }

    return false;
  }

  private buildTextualWriteConfirmationInstruction(userMessage: string): string {
    return [
      `The user replied "${String(userMessage || '').trim()}" to your previous write proposal.`,
      'No pending backend mutation preview exists in this conversation, so this is not executable approval.',
      'Create the required backend mutation previews now using the available write-preview tools.',
      'For multiple related changes, mixed object changes, or dependencies between changes, prefer prepare_mutation_plan when available.',
      'For dependent steps, use stable operation_id values, depends_on, and placeholders such as {{create_project.ref}}, {{create_project.id}}, or {{create_project.title}}.',
      'For bulk task assignee changes, prefer update_task_assignees with all task references and the assignee email when available; otherwise use update_task_assignee once per task.',
      'If you only have the assignee name, resolve the user email first with query_entities on users.',
      'Do not execute changes, do not claim success, and do not write raw pseudo tool-call markup such as <tool_call> in assistant text.',
    ].join(' ');
  }

  private isUnsafeWritePreviewAssistantText(content: string): boolean {
    const normalized = String(content || '').trim();
    if (!normalized) {
      return false;
    }
    return containsRawToolMarkup(normalized) || asksForWriteExecutionWithoutPreview(normalized);
  }

  private buildUnsafeWritePreviewResponseRepairInstruction(params: {
    assistantText: string;
    writePreviewToolNames: string[];
  }): string {
    const toolList = params.writePreviewToolNames.length > 0
      ? params.writePreviewToolNames.join(', ')
      : 'the available write-preview tools';
    const hasBulkAssigneeTool = params.writePreviewToolNames.includes('update_task_assignees');
    const hasMutationPlanTool = params.writePreviewToolNames.includes('prepare_mutation_plan');
    return [
      'Your previous assistant response was blocked because it proposed or simulated a write without backend mutation previews.',
      containsRawToolMarkup(params.assistantText)
        ? 'It also contained raw pseudo tool-call markup; never write raw <tool_call> text.'
        : 'Do not ask the user for textual confirmation before backend preview cards exist.',
      `Use the provider tool-calling API now with one of: ${toolList}.`,
      hasMutationPlanTool
        ? 'For multiple related changes, mixed object changes, or dependencies between changes, call prepare_mutation_plan with stable operation_id values, depends_on, and placeholders such as {{create_project.ref}}.'
        : null,
      hasBulkAssigneeTool
        ? 'For bulk task reassignment, call update_task_assignees once with every resolved task ref and the assignee email.'
        : 'For bulk task reassignment, call update_task_assignee once per task ref with the assignee email.',
      'If you only have the assignee name, resolve the user email first with query_entities on users.',
      'Do not execute changes and do not claim success; create backend previews only.',
    ].filter(Boolean).join(' ');
  }

  private shouldContinueAfterPreviewAction(params: {
    history: Array<{ role: string; content: string }>;
    existingPreviews: AiMutationPreviewDto[];
    previewResults: AiMutationPreviewDto[];
    followUpPreviews: AiMutationPreviewDto[];
  }): boolean {
    if (params.followUpPreviews.length > 0) {
      return false;
    }
    if (params.existingPreviews.some((preview) => preview.status === 'pending')) {
      return false;
    }
    if (params.previewResults.length === 0) {
      return false;
    }

    const contextualHistory = params.history.filter((message) => (
      message.role !== 'user' || !this.parseApprovalAction(message.content)
    ));
    const contextProfile = selectAiContextProfileForTurn(
      contextualHistory
        .filter((message) => message.role === 'user' || message.role === 'assistant' || message.role === 'tool')
        .map((message) => ({
          role: message.role as 'user' | 'assistant' | 'tool',
          content: message.content,
        })),
    );
    if (contextProfile.promptMode !== 'write') {
      return false;
    }

    const recentText = contextualHistory
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .slice(-8)
      .map((message) => message.content)
      .join('\n\n');
    return hasMultiStepWriteSignals(recentText);
  }

  private buildPostApprovalContinuationInstruction(params: {
    action: ApprovalAction['action'];
    previewResults: AiMutationPreviewDto[];
    history: Array<{ role: string; content: string }>;
  }): string {
    const resultLines = params.previewResults.map((preview) => {
      const label = this.previewResultLabel(preview);
      const summary = String(preview.summary || '').trim();
      const error = String(preview.error_message || '').trim();
      return `- ${label}: status=${preview.status}${summary ? `; summary=${summary}` : ''}${error ? `; error=${error}` : ''}`;
    });
    const recentContext = params.history
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .slice(-6)
      .map((message) => `${message.role}: ${message.content}`)
      .join('\n');
    return [
      `The user just explicitly ${params.action === 'approve' ? 'approved' : 'rejected'} backend mutation preview(s) in an ongoing write workflow.`,
      'Execution results:',
      ...resultLines,
      '',
      'Recent workflow context:',
      recentContext || '(none)',
      '',
      'Continue from this exact state. If the original user request or the previous assistant plan implies remaining changes, prepare the remaining backend previews now without asking the user to type continue.',
      'For multiple remaining related changes, mixed object changes, or dependency chains, use prepare_mutation_plan. If there are no remaining changes, answer concisely with the final state.',
      'Do not re-create previews for changes already executed or rejected. Do not claim execution for any remaining change until its backend preview is explicitly approved and executed.',
    ].join('\n');
  }

  private shouldRepairUnstructuredPlanPreview(params: {
    assistantText: string;
    mutationPreviewCountThisTurn: number;
    usedMutationPlanToolThisTurn: boolean;
    repairAttempts: number;
  }): boolean {
    if (params.repairAttempts > 0) {
      return false;
    }
    if (params.usedMutationPlanToolThisTurn) {
      return false;
    }
    if (params.mutationPreviewCountThisTurn !== 1) {
      return false;
    }
    return hasMultiStepWriteSignals(params.assistantText);
  }

  private buildUnstructuredPlanRepairInstruction(params: {
    assistantText: string;
    writePreviewToolNames: string[];
  }): string {
    const toolList = params.writePreviewToolNames.length > 0
      ? params.writePreviewToolNames.join(', ')
      : 'the available write-preview tools';
    return [
      'Your previous assistant response described a multi-step or multi-record write workflow, but only one backend preview was created and no durable mutation plan was prepared.',
      `Use the provider tool-calling API now with one of: ${toolList}.`,
      'If remaining changes are clear, create backend previews for every remaining target now. For dependencies or mixed object types, use prepare_mutation_plan with stable operation_id values, depends_on, and placeholders such as {{create_project.ref}}.',
      'Do not ask the user to type continue between previews. Do not claim execution; create backend previews only.',
      'Previous assistant text for reference:',
      params.assistantText,
    ].join('\n');
  }

  private buildBulkCompletenessRepairInstruction(params: {
    issue: BulkCoverageIssue;
    writePreviewToolNames: string[];
  }): string {
    const toolList = params.writePreviewToolNames.length > 0
      ? params.writePreviewToolNames.join(', ')
      : 'the available write-preview tools';
    const missingRefs = params.issue.missingRefs.length > 0
      ? params.issue.missingRefs.join(', ')
      : '(unknown refs; expected count was not fully covered)';
    return [
      'Your previous tool calls did not cover the complete resolved bulk target set.',
      `Target set: ${params.issue.label || params.issue.entityType || params.issue.source}.`,
      params.issue.expectedCount != null ? `Expected targets: ${params.issue.expectedCount}.` : null,
      params.issue.expectedRefs.length > 0 ? `Expected refs: ${params.issue.expectedRefs.join(', ')}.` : null,
      params.issue.coveredRefs.length > 0 ? `Refs with created previews: ${params.issue.coveredRefs.join(', ')}.` : 'No matching refs have created previews yet.',
      params.issue.failedRefs.length > 0 ? `Refs with preview errors: ${params.issue.failedRefs.join(', ')}.` : null,
      params.issue.excludedRefs.length > 0 ? `Refs explicitly excluded: ${params.issue.excludedRefs.join(', ')}.` : null,
      `Missing refs: ${missingRefs}.`,
      `Use the provider tool-calling API now with one of: ${toolList}.`,
      'Create backend previews for every missing in-scope target now. If you intentionally narrowed an ambiguous user request, state the assumption clearly and explicitly name every excluded ref with a reason.',
      'For bulk target-set tracking, prefer prepare_mutation_plan with expected_target_refs/expected_target_count and explicit_exclusions when available.',
      'Do not execute changes and do not claim success; create backend previews only or explain the explicit exclusions.',
    ].filter(Boolean).join('\n');
  }

  private buildEmptyWriteAfterToolRepairInstruction(params: {
    writePreviewToolNames: string[];
  }): string {
    const toolList = params.writePreviewToolNames.length > 0
      ? params.writePreviewToolNames.join(', ')
      : 'the available write-preview tools';
    return [
      'Your previous iteration used tools in a write workflow, but then ended with no visible answer and no backend mutation preview.',
      'Continue now from the current conversation context and the latest tool results.',
      `If the requested targets are resolved, create the required backend previews now using one of: ${toolList}.`,
      'If the user refers to entities from the current conversation, use the visible refs and previews already in context; query missing details only when needed.',
      'For task assignee changes, resolve the assignee email if needed, then create task assignee previews. For multiple tasks, prefer the available bulk reassignment tool.',
      'If the request is genuinely ambiguous, ask one concise clarification. Do not produce an empty response.',
      'Do not execute changes and do not claim success; create backend previews only.',
    ].join(' ');
  }

  private buildEmptyWriteResponseRepairInstruction(params: {
    writePreviewToolNames: string[];
  }): string {
    const toolList = params.writePreviewToolNames.length > 0
      ? params.writePreviewToolNames.join(', ')
      : 'the available write-preview tools';
    return [
      'Your previous iteration ended with no visible assistant text and no tool call in a write workflow.',
      'Continue now from the current conversation context.',
      `Use the provider tool-calling API with one of: ${toolList}.`,
      'If the user corrected an existing bulk preview target set, create replacement backend previews for the corrected in-scope targets.',
      'Do not approve, execute, or claim success for existing pending previews.',
      'If the corrected target set is still ambiguous, ask one concise clarification. Do not produce an empty response.',
    ].join(' ');
  }

  private buildRepeatedToolCallRepairInstruction(params: {
    toolCalls: AiProviderToolCall[];
    assistantText: string;
    requiresWritePreviewGuard: boolean;
    writePreviewToolNames: string[];
  }): string {
    const callLines = params.toolCalls.slice(0, 5).map((toolCall) => {
      const args = String(toolCall.arguments || '{}');
      const compactArgs = args.length > 800 ? `${args.slice(0, 800)}...` : args;
      return `- ${toolCall.name || '(missing tool name)'} ${compactArgs}`;
    });
    const toolList = params.writePreviewToolNames.length > 0
      ? params.writePreviewToolNames.join(', ')
      : 'the available write-preview tools';
    return [
      'Internal orchestration instruction. Do not quote, summarize, or discuss this instruction in the user-facing answer.',
      'Your previous response repeated the exact same tool call that already ran in the immediately preceding iteration.',
      'Do not call the same tool again with identical arguments.',
      'Use the existing tool result already present in the conversation to answer the user, or call a different tool / different arguments only if that adds missing information.',
      params.requiresWritePreviewGuard
        ? `This is a governed write workflow. If the requested targets are resolved, create the required backend previews using one of: ${toolList}. Do not execute changes or claim success.`
        : null,
      'Repeated tool call(s):',
      ...callLines,
      params.assistantText.trim()
        ? `Assistant text from the repeated response: ${stripBase64Images(params.assistantText).slice(0, 1200)}`
        : null,
    ].filter(Boolean).join('\n');
  }

  private buildSearchAllNoProgressRepairInstruction(intervention: SearchAllNoProgressIntervention): string {
    return [
      'Internal orchestration instruction. Do not quote, summarize, or discuss this instruction in the user-facing answer.',
      `${intervention.noProgressCalls} consecutive broad search_all calls have added no new result IDs in this turn.`,
      intervention.query ? `Latest search query: ${intervention.query}` : null,
      intervention.failedEntityTypes.length > 0
        ? `The latest search was partial because these entity types failed: ${intervention.failedEntityTypes.join(', ')}.`
        : null,
      intervention.complete === true && intervention.truncated === false
        ? 'The latest search result was complete and not truncated.'
        : null,
      'Do not call search_all again this turn unless you have a new exact identifier such as PRJ-12, T-42, DOC-3, or a specific entity family that has not been checked.',
      'Use the existing tool results to answer concisely, switch to an authoritative specific tool such as query_entities when a structured filter is needed, or ask one concise clarification if the target cannot be resolved.',
    ].filter(Boolean).join('\n');
  }

  private buildPreviewResultAssistantText(preview: AiMutationPreviewDto): string {
    const summary = this.linkifyPreviewSummary(preview, String(preview.summary || '').trim());
    const errorMessage = String(preview.error_message || '').trim();

    switch (preview.status) {
      case 'executed':
        return summary || 'The approved change has been executed.';
      case 'rejected':
        return summary || 'The preview was rejected.';
      case 'failed':
        if (errorMessage) {
          return summary ? `${summary}\n\nError: ${errorMessage}` : `The approved change failed. Error: ${errorMessage}`;
        }
        return summary || 'The approved change failed.';
      case 'expired':
        return summary || 'The preview expired before approval.';
      default:
        if (errorMessage) {
          return summary ? `${summary}\n\nError: ${errorMessage}` : errorMessage;
        }
        return summary || 'The backend processed the preview action.';
    }
  }

  private previewResultLabel(preview: AiMutationPreviewDto): string {
    return String(preview.target?.ref || preview.target?.title || preview.summary || preview.preview_id).trim();
  }

  private buildFollowUpPreviewAssistantText(previews: AiMutationPreviewDto[]): string {
    if (previews.length === 0) {
      return '';
    }
    const labels = previews
      .slice(0, 6)
      .map((preview) => this.previewResultLabel(preview));
    const lines = [
      `${previews.length} dependent preview${previews.length > 1 ? 's are' : ' is'} now prepared and waiting for explicit approval.`,
      ...labels.map((label) => `- ${label}`),
    ];
    if (previews.length > labels.length) {
      lines.push(`- ${previews.length - labels.length} more.`);
    }
    return lines.join('\n');
  }

  private buildPreviewResultsAssistantText(
    previews: AiMutationPreviewDto[],
    followUpPreviews: AiMutationPreviewDto[] = [],
  ): string {
    const followUpText = this.buildFollowUpPreviewAssistantText(followUpPreviews);
    if (previews.length === 1) {
      const base = this.buildPreviewResultAssistantText(previews[0]);
      return followUpText ? `${base}\n\n${followUpText}` : base;
    }

    const applied = previews.filter((preview) => preview.status === 'executed').length;
    const rejected = previews.filter((preview) => preview.status === 'rejected').length;
    const failed = previews.filter((preview) => preview.status === 'failed').length;
    const expired = previews.filter((preview) => preview.status === 'expired').length;
    const unchanged = previews.length - applied - rejected - failed - expired;

    const parts: string[] = [];
    if (applied > 0) parts.push(`${applied} applied`);
    if (rejected > 0) parts.push(`${rejected} rejected`);
    if (failed > 0) parts.push(`${failed} failed`);
    if (expired > 0) parts.push(`${expired} expired`);
    if (unchanged > 0) parts.push(`${unchanged} unchanged`);

    const lines = [
      parts.length > 0
        ? `Preview batch completed: ${parts.join(', ')}.`
        : 'Preview batch completed.',
    ];

    const failedPreviews = previews.filter((preview) => preview.status === 'failed' || preview.status === 'expired');
    if (failedPreviews.length > 0) {
      lines.push('');
      lines.push('Failures:');
      for (const preview of failedPreviews.slice(0, 10)) {
        const label = this.previewResultLabel(preview);
        const message = String(preview.error_message || preview.summary || 'No error detail was returned.').trim();
        lines.push(`- ${label}: ${message}`);
      }
      if (failedPreviews.length > 10) {
        lines.push(`- ${failedPreviews.length - 10} more failed previews.`);
      }
    }

    const base = lines.join('\n');
    return followUpText ? `${base}\n\n${followUpText}` : base;
  }

  private linkifyPreviewSummary(preview: AiMutationPreviewDto, summary: string): string {
    const text = String(summary || '').trim();
    if (!text) return text;

    const targetEntityType = String(preview.target?.entity_type || '').trim().toLowerCase();
    const targetEntityId = String(preview.target?.entity_id || '').trim();
    const targetRef = String(preview.target?.ref || '').trim();
    if (!targetEntityType || !targetEntityId || !targetRef) return text;

    const builder = ENTITY_URL_BUILDERS[targetEntityType];
    if (!builder) return text;

    const url = builder(targetEntityId);
    // Replace every standalone occurrence of the ref with a markdown link, but skip refs
    // already inside `[ ]( )`. A negative lookbehind for `[`/`-`/word and a negative
    // lookahead for word/dash prevents partial matches like T-87 inside T-879 or
    // already-linked refs from being clobbered.
    const refPattern = new RegExp(
      `(?<![\\[\\w-])${escapeRegExp(targetRef)}(?![\\w-])`,
      'g',
    );
    return text.replace(refPattern, `[${targetRef}](${url})`);
  }

  private sanitizeReplayToolCalls(toolCalls: unknown): AiProviderToolCall[] | null {
    if (!Array.isArray(toolCalls)) {
      return null;
    }

    const sanitized: AiProviderToolCall[] = [];
    for (const rawToolCall of toolCalls) {
      if (!rawToolCall || typeof rawToolCall !== 'object') {
        continue;
      }
      const candidate = rawToolCall as Record<string, unknown>;
      const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
      const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
      const args = typeof candidate.arguments === 'string' ? candidate.arguments : '';
      const parsed = tryParseToolCallArguments(args || '{}');

      if (!id || !name || !parsed.ok) {
        this.logger.warn(
          `Skipping malformed persisted assistant tool call during replay: id=${id || 'missing'} tool=${name || 'missing'}.`,
        );
        continue;
      }

      sanitized.push({ id, name, arguments: args });
    }

    return sanitized.length > 0 ? sanitized : null;
  }

  private parsePersistedToolMessageId(content: string): string | null {
    try {
      const parsed = JSON.parse(content);
      return typeof parsed?.tool_call_id === 'string' && parsed.tool_call_id.trim()
        ? parsed.tool_call_id.trim()
        : null;
    } catch {
      return null;
    }
  }

  private buildSkippedToolCallAssistantText(
    assistantContent: string,
    toolCall: AiProviderToolCall,
    reason: string,
  ): string {
    const text = String(assistantContent || '').trim();
    const toolName = String(toolCall.name || '').trim() || 'unknown';
    const note = `Tool call ${toolName} was not executed because ${reason}`;
    return text ? `${text}\n\n${note}` : note;
  }

  private buildDisplayName(row: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  }): string {
    const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
    return name || row.email || 'Current user';
  }

  async prepareRequest(params: ChatStreamParams): Promise<PreparedChatRequest> {
    const approvalAction = this.parseApprovalAction(params.userMessage);
    this.logger.log(
      `prepareRequest: conversation_id=${params.conversationId || 'NONE'} `
      + `userMessage_len=${params.userMessage?.length ?? 0} `
      + `attachment_ids=${(params.attachmentIds || []).length} `
      + `truncate_from_message_id=${params.truncateFromMessageId || 'NONE'}`,
    );
    return this.tenantExecutor.runWithContext(params.context, async (ctx) => {
      await this.policy.assertSurfaceAccess(ctx, ctx.manager);

      if (approvalAction && !params.conversationId) {
        throw new BadRequestException('Preview approvals require an existing conversation.');
      }

      if (params.conversationId) {
        await this.conversations.getConversationForUser(
          params.conversationId,
          ctx.tenantId,
          ctx.userId,
          { manager: ctx.manager },
        );
      }

      const tenant = await ctx.manager.query(
        `SELECT name FROM tenants WHERE id = $1`,
        [ctx.tenantId],
      );
      const tenantName = tenant?.[0]?.name || 'KANAP';
      const resolved = await this.modelResolver.resolve(ctx.tenantId, { type: 'chat' }, ctx.manager);

      if (resolved.source === 'builtin') {
        const runtime = await this.platformAiConfig.getRuntimeConfig();
        const adapter = this.providerRegistry.get(runtime.provider);
        if (!adapter) {
          throw new Error('Provider not configured.');
        }
        return {
          context: params.context,
          inputConversationId: params.conversationId ?? null,
          userMessage: params.userMessage,
          attachmentIds: params.attachmentIds ?? null,
          truncateFromMessageId: params.truncateFromMessageId ?? null,
          approvalAction,
          providerSource: 'builtin',
          provider: adapter,
          model: runtime.model,
          apiKey: runtime.apiKey,
          endpointUrl: runtime.endpoint_url,
          modelTimeoutMs: null,
          tenantName,
          builtinRateLimits: {
            tenantPerMinute: runtime.rate_limit_tenant_per_minute,
            userPerHour: runtime.rate_limit_user_per_hour,
          },
        };
      }

      const adapter = this.providerRegistry.get(resolved.provider);
      if (!adapter) {
        throw new Error('Provider not configured.');
      }

      if (resolved.endpointUrl) {
        await assertPublicHttpTarget(resolved.endpointUrl);
      }

      return {
        context: params.context,
        inputConversationId: params.conversationId ?? null,
        userMessage: params.userMessage,
        attachmentIds: params.attachmentIds ?? null,
        truncateFromMessageId: params.truncateFromMessageId ?? null,
        approvalAction,
        providerSource: 'custom',
        provider: adapter,
        model: resolved.model,
        apiKey: resolved.apiKey,
        endpointUrl: resolved.endpointUrl,
        modelTimeoutMs: resolved.timeoutMs,
        tenantName,
      };
    });
  }

  private async loadBuiltinUsage(prepared: PreparedChatRequest): Promise<AiBuiltinUsageDto | undefined> {
    if (prepared.providerSource !== 'builtin') {
      return undefined;
    }
    return this.tenantExecutor.runWithContext(prepared.context, async (ctx) => {
      return this.builtinUsage.getCurrentUsage(ctx.tenantId, ctx.manager);
    });
  }

  /** The tenant's budget column names for users who can read OPEX or CAPEX items; none otherwise. */
  private async loadBudgetColumnsPromptContext(
    ctx: AiExecutionContext & { manager: any },
    readableTypes: readonly string[],
  ): Promise<ReturnType<typeof budgetColumnsAiContext> | undefined> {
    if (!readableTypes.includes('spend_items') && !readableTypes.includes('capex_items')) return undefined;
    return budgetColumnsAiContext(await readBudgetColumns(ctx.manager, ctx.tenantId));
  }

  private async loadCurrentUserPromptContext(ctx: AiExecutionContext & { manager: any }): Promise<CurrentUserPromptContext> {
    const userRows = await ctx.manager.query(
      `SELECT u.email,
              u.first_name,
              u.last_name,
              r.role_name AS primary_role_name
       FROM users u
       LEFT JOIN roles r
         ON r.id = u.role_id
        AND r.tenant_id = u.tenant_id
       WHERE u.id = $1
         AND u.tenant_id = $2
       LIMIT 1`,
      [ctx.userId, ctx.tenantId],
    );
    const roleRows = await ctx.manager.query(
      `SELECT DISTINCT r.role_name
       FROM user_roles ur
       JOIN roles r
         ON r.id = ur.role_id
        AND r.tenant_id = ur.tenant_id
       WHERE ur.user_id = $1
         AND ur.tenant_id = $2
       ORDER BY r.role_name ASC`,
      [ctx.userId, ctx.tenantId],
    );
    const teamRows = await ctx.manager.query(
      `SELECT pt.name AS team_name
       FROM portfolio_team_member_configs tmc
       LEFT JOIN portfolio_teams pt
         ON pt.id = tmc.team_id
        AND pt.tenant_id = tmc.tenant_id
       WHERE tmc.user_id = $1
         AND tmc.tenant_id = $2
       LIMIT 1`,
      [ctx.userId, ctx.tenantId],
    );

    const user = userRows[0] ?? {};
    const roleNames = Array.from(new Set([
      user.primary_role_name,
      ...roleRows.map((row: any) => row.role_name),
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));

    return {
      displayName: this.buildDisplayName(user),
      email: typeof user.email === 'string' && user.email.trim() ? user.email.trim() : null,
      roleNames,
      teamName: teamRows[0]?.team_name ?? null,
    };
  }

  async *stream(params: ChatStreamParams): AsyncGenerator<ChatStreamEvent> {
    const requestStartedAt = Date.now();
    const prepared = await this.prepareRequest(params);
    yield* this.streamPrepared(prepared, { signal: params.signal ?? null, requestStartedAt });
  }

  async *streamPrepared(
    prepared: PreparedChatRequest,
    opts?: { signal?: AbortSignal | null; requestStartedAt?: number },
  ): AsyncGenerator<ChatStreamEvent> {
    const { context, userMessage, provider, model, apiKey, endpointUrl, modelTimeoutMs, tenantName, providerSource } = prepared;
    const replayDeepSeekReasoning = isOfficialDeepSeekEndpoint(endpointUrl);
    const abortSignal = opts?.signal ?? null;
    const requestStartedAt = opts?.requestStartedAt ?? Date.now();
    const requestStartedIso = new Date(requestStartedAt).toISOString();
    let preparationMs: number | undefined;
    let firstTokenMs: number | undefined;
    let providerStreamMs = 0;
    let toolExecutionMs = 0;
    let completedIterations = 0;
    const buildTimings = (completed = false) => {
      const now = Date.now();
      return {
        started_at: requestStartedIso,
        ...(completed ? { completed_at: new Date(now).toISOString() } : {}),
        preparation_ms: preparationMs ?? Math.max(0, now - requestStartedAt),
        ...(firstTokenMs != null ? { first_token_ms: firstTokenMs } : {}),
        ...(completed ? { total_ms: Math.max(0, now - requestStartedAt) } : {}),
        provider_stream_ms: providerStreamMs,
        tool_execution_ms: toolExecutionMs,
        iterations: completedIterations,
      };
    };
    const buildDebugTrace = (
      name: AiChatDebugTraceName,
      opts: { iteration?: number | null; toolName?: string | null } = {},
    ): ChatStreamEvent | null => {
      if (!AI_CHAT_DEBUG_TRACE_ENABLED) {
        return null;
      }
      return {
        type: 'debug_trace',
        name,
        elapsed_ms: Math.max(0, Date.now() - requestStartedAt),
        ...(opts.iteration != null ? { iteration: opts.iteration } : {}),
        ...(opts.toolName != null ? { tool_name: opts.toolName } : {}),
      };
    };

    if (abortSignal?.aborted) {
      return;
    }

    // Step 2: Load/create conversation, persist user message, build system prompt
    const approvalAction = prepared.approvalAction;
    const {
      conversationId,
      title,
      providerMessages,
      tools,
      systemPromptText,
      systemPromptSections,
      preStreamEvents,
      approvalAssistantText,
      contextSummary,
      requiresWritePreviewGuard,
      writePreviewToolNames,
    } =
      await this.tenantExecutor.runWithContext(context, async (ctx) => {
        let convId = prepared.inputConversationId;
        let convTitle: string;

        if (convId) {
          const conv = await this.conversations.getConversationForUser(
            convId,
            ctx.tenantId,
            ctx.userId,
            { manager: ctx.manager },
          );
          convTitle = conv.title || userMessage.slice(0, 100);
          // Auto-title pre-created conversations (e.g. created empty for an attachment-first
          // upload). Approval/rejection markers don't deserve to become titles.
          if (!conv.title && userMessage.trim() && !approvalAction) {
            await this.conversations.setTitleIfMissing(
              convId,
              ctx.tenantId,
              userMessage.slice(0, 100),
              { manager: ctx.manager },
            );
          }
        } else {
          convTitle = userMessage.slice(0, 100);
          const conv = await this.conversations.createConversation(
            {
              tenantId: ctx.tenantId,
              userId: ctx.userId,
              title: convTitle,
              provider: provider.descriptor.id,
              model,
              providerSource,
            },
            { manager: ctx.manager },
          );
          convId = conv.id;
        }

        // Edit/regen: wipe the conversation tail before we persist anything new, so the
        // history replay below sees only the pre-edit prefix.
        if (prepared.truncateFromMessageId && convId) {
          await this.conversations.deleteMessagesFromInclusive(
            convId,
            ctx.tenantId,
            prepared.truncateFromMessageId,
            { manager: ctx.manager },
          );
        }

        // Validate attachment ownership BEFORE persisting (fail fast)
        const requestedAttachmentIds = Array.isArray(prepared.attachmentIds) ? prepared.attachmentIds : [];
        let requestedAttachments: Array<{
          original_filename?: string | null;
          kind?: string | null;
          mime_type?: string | null;
          size?: number | null;
        }> = [];
        if (requestedAttachmentIds.length > 0) {
          requestedAttachments = await this.attachments.assertAndLoadAttachments(
            requestedAttachmentIds,
            { conversationId: convId!, tenantId: ctx.tenantId, userId: ctx.userId },
            ctx.manager,
          );
        }

        // Persist user message — skipped on regenerate (empty userMessage). In that case
        // the conversation already ends with the user msg the regen targets and we just
        // re-stream against the existing history.
        let persistedUserMessage: { id: string } | null = null;
        if (userMessage.trim().length > 0) {
          persistedUserMessage = await this.conversations.appendMessage(
            {
              conversationId: convId!,
              tenantId: ctx.tenantId,
              conversationUserId: ctx.userId,
              userId: ctx.userId,
              role: 'user',
              content: userMessage,
            },
            { manager: ctx.manager },
          );
        }

        // Link attachments to the persisted user message (idempotent — safe to retry).
        if (requestedAttachmentIds.length > 0 && persistedUserMessage) {
          await this.attachments.linkAttachmentsToMessage(
            requestedAttachmentIds,
            persistedUserMessage.id,
            ctx.tenantId,
            ctx.manager,
          );
        }

        const streamEvents: ChatStreamEvent[] = [];

        if (approvalAction) {
          let previewResults: AiMutationPreviewDto[] = [];
          let followUpPreviews: AiMutationPreviewDto[] = [];
          if (approvalAction.action === 'approve') {
            await this.approvals.approvePreviewsFromChat(
              { ...ctx, conversationId: convId! },
              approvalAction.previewIds,
            );
            const dispatched = await this.dispatcher.execute<{ results: AiMutationPreviewDto[]; followUpPreviews: AiMutationPreviewDto[] }>(
              { ...ctx, conversationId: convId! },
              {
                capabilityName: EXECUTE_APPROVED_PREVIEW_CAPABILITY,
                input: { preview_ids: approvalAction.previewIds },
                execution: {
                  surface: 'internal',
                  trigger_kind: 'human_user',
                  metadata: { transport: 'chat_approval_marker' },
                },
              },
            );
            const execution = dispatched.output;
            previewResults = execution.results;
            followUpPreviews = execution.followUpPreviews;
          } else {
            await this.approvals.rejectPreviewsFromChat(
              { ...ctx, conversationId: convId! },
              approvalAction.previewIds,
            );
            previewResults = await this.previews.rejectPreviews(
              { ...ctx, conversationId: convId! },
              approvalAction.previewIds,
            );
          }

          for (const previewResult of previewResults) streamEvents.push({
            type: 'preview_result',
            ...previewResult,
          });
          if (followUpPreviews.length > 0) {
            streamEvents.push({
              type: 'tool_result',
              id: `mutation-plan-followups-${Date.now()}`,
              name: 'prepare_mutation_plan',
              result: {
                previews: followUpPreviews,
                total: followUpPreviews.length,
                created: followUpPreviews.length,
                failed: 0,
                complete: false,
              },
            });
            for (const preview of followUpPreviews) streamEvents.push({
              type: 'preview',
              ...preview,
            });
          }
          const allPreviewResults = [...previewResults, ...followUpPreviews];

          const historyAfterApproval = await this.conversations.listMessagesForUser(
            convId!,
            ctx.tenantId,
            ctx.userId,
            { manager: ctx.manager },
          );
          const existingPreviewsAfterApproval = await this.previews.listConversationPreviews(ctx, convId!);
          if (this.shouldContinueAfterPreviewAction({
            history: historyAfterApproval.map((msg) => ({ role: msg.role, content: msg.content })),
            existingPreviews: existingPreviewsAfterApproval,
            previewResults,
            followUpPreviews,
          })) {
            const msgs: AiProviderMessage[] = [];
            let replayableToolCallIds = new Set<string>();
            for (const msg of historyAfterApproval) {
              if (msg.role === 'user') {
                msgs.push({
                  role: 'user',
                  content: this.toProviderUserContent(msg.content),
                });
                replayableToolCallIds = new Set<string>();
              } else if (msg.role === 'assistant') {
                const toolCalls = this.sanitizeReplayToolCalls(msg.tool_calls);
                const reasoningContent = replayDeepSeekReasoning && toolCalls
                  ? extractDeepSeekReasoningContent(msg.provider_metadata_json)
                  : null;
                if (replayDeepSeekReasoning && toolCalls && !reasoningContent) {
                  this.logger.warn(
                    'Skipping persisted DeepSeek assistant tool calls during approval continuation replay because reasoning_content metadata is unavailable.',
                  );
                  if (msg.content.trim()) {
                    msgs.push({
                      role: 'assistant',
                      content: stripBase64Images(msg.content),
                    });
                  }
                  replayableToolCallIds = new Set<string>();
                  continue;
                }
                msgs.push({
                  role: 'assistant',
                  content: stripBase64Images(msg.content),
                  ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
                  ...(toolCalls ? { tool_calls: toolCalls } : {}),
                });
                replayableToolCallIds = new Set((toolCalls ?? []).map((toolCall) => toolCall.id));
              } else if (msg.role === 'tool') {
                const toolCallId = this.parsePersistedToolMessageId(msg.content);
                if (!toolCallId || !replayableToolCallIds.has(toolCallId)) {
                  this.logger.warn(
                    `Skipping persisted tool message during approval continuation replay because its assistant tool call is unavailable: id=${toolCallId || 'missing'}.`,
                  );
                  continue;
                }
                msgs.push({
                  role: 'tool',
                  content: msg.content,
                  tool_call_id: toolCallId,
                });
                replayableToolCallIds.delete(toolCallId);
              }
            }
            msgs.push({
              role: 'user',
              content: this.buildPostApprovalContinuationInstruction({
                action: approvalAction.action,
                previewResults,
                history: historyAfterApproval.map((msg) => ({ role: msg.role, content: msg.content })),
              }),
            });

            const toolContext: AiExecutionContextWithManager = {
              ...ctx,
              conversationId: convId!,
            };
            const contextProfile = selectAiContextProfileForTurn(
              historyAfterApproval
                .filter((msg) => msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool')
                .map((msg) => ({
                  role: msg.role as 'user' | 'assistant' | 'tool',
                  content: msg.content,
                })),
            );
            const allAvailableTools = await this.capabilityRegistry.listAvailableToolItems(toolContext);
            const availableTools = filterToolListForProfile(allAvailableTools, contextProfile);
            const writePreviewToolNames = availableTools
              .filter((tool) => tool.write_preview != null)
              .map((tool) => tool.name);
            const toolSchemas = this.capabilityRegistry.toToolJsonSchemas(availableTools);
            const readableTypes = contextProfile.includeReadableEntityTypes
              ? await this.policy.listReadableEntityTypes(
                ctx,
                [...AI_QUERY_ENTITY_TYPES],
                ctx.manager,
              )
              : [];
            const currentUser = await this.loadCurrentUserPromptContext(ctx);
            const budgetColumns = await this.loadBudgetColumnsPromptContext(ctx, readableTypes);
            const builtSystemPrompt = this.systemPrompt.buildWithMetadata({
              tenantName,
              availableTools,
              readableEntityTypes: readableTypes,
              currentUser,
              contextProfile,
              budgetColumns,
            });
            const latestUserMessageRow = [...historyAfterApproval]
              .reverse()
              .find((msg) => msg.role === 'user' && !this.parseApprovalAction(msg.content)) ?? null;

            return {
              conversationId: convId!,
              title: convTitle,
              providerMessages: msgs,
              tools: toolSchemas,
              systemPromptText: builtSystemPrompt.text,
              systemPromptSections: builtSystemPrompt.sections,
              preStreamEvents: streamEvents,
              approvalAssistantText: null,
              contextSummary: {
                mentions: extractMentionContextItems(latestUserMessageRow?.content ?? ''),
                previews: previewContextItems([...existingPreviewsAfterApproval, ...allPreviewResults]),
                artifacts: previewContextItems(allPreviewResults),
                history: {
                  message_count: historyAfterApproval.length,
                  attachment_count: 0,
                  tool_result_count: historyAfterApproval.filter((msg) => msg.role === 'tool').length,
                },
                tools: {
                  available_count: allAvailableTools.length,
                  selected_count: availableTools.length,
                  writable_count: availableTools.filter((tool) => tool.write_preview != null).length,
                  readable_entity_types: readableTypes,
                  context_profile: contextProfile.name,
                },
              },
              requiresWritePreviewGuard: contextProfile.promptMode === 'write' && writePreviewToolNames.length > 0,
              writePreviewToolNames,
            } satisfies StreamPreparationResult;
          }

          return {
            conversationId: convId!,
            title: convTitle,
            providerMessages: [],
            tools: [],
            systemPromptText: '',
            systemPromptSections: [],
            preStreamEvents: streamEvents,
            approvalAssistantText: this.buildPreviewResultsAssistantText(previewResults, followUpPreviews),
            contextSummary: {
              previews: previewContextItems(allPreviewResults),
              artifacts: previewContextItems(allPreviewResults),
              history: {
                message_count: 1,
                attachment_count: 0,
                tool_result_count: 0,
              },
            },
            requiresWritePreviewGuard: false,
            writePreviewToolNames: [],
          } satisfies StreamPreparationResult;
        }

        // Load history
        const history = await this.conversations.listMessagesForUser(
          convId!,
          ctx.tenantId,
          ctx.userId,
          { manager: ctx.manager },
        );
        const existingPreviews = await this.previews.listConversationPreviews(ctx, convId!);
        const latestUserMessageRow = [...history].reverse().find((msg) => msg.role === 'user') ?? null;
        const rewriteLatestTextualWriteConfirmation = this.shouldRewriteTextualWriteConfirmation({
          history: history.map((msg) => ({ role: msg.role, content: msg.content })),
          existingPreviews,
        });

        // Pre-load image attachments for user messages so we can inject them into multimodal
        // content blocks. Only Anthropic currently honors images; other providers ignore them.
        // Performance: at most ~20MB per image x typically <10 attachments per conversation.
        const userMessageIds = history
          .filter((msg) => msg.role === 'user')
          .map((msg) => msg.id);
        const attachmentImagesByMessage = new Map<string, AiProviderImageAttachment[]>();
        if (userMessageIds.length > 0) {
          const attachmentRows = await this.attachments.listAttachmentsForMessages(
            userMessageIds,
            ctx.tenantId,
            ctx.manager,
          );
          await Promise.all(attachmentRows.map(async (row) => {
            if (!row.message_id) return;
            try {
              const { buffer } = await this.attachments.loadAttachmentBuffer(
                row.id,
                ctx.tenantId,
                ctx.manager,
              );
              const list = attachmentImagesByMessage.get(row.message_id) || [];
              list.push({
                mime_type: row.mime_type,
                base64_data: buffer.toString('base64'),
              });
              attachmentImagesByMessage.set(row.message_id, list);
            } catch (err) {
              this.logger.warn(`Failed to load attachment ${row.id} for replay: ${(err as Error).message}`);
            }
          }));
        }

        // Build provider messages from history (excluding the just-persisted user msg for reconstruction)
        const msgs: AiProviderMessage[] = [];
        let replayableToolCallIds = new Set<string>();
        for (const msg of history) {
          if (msg.role === 'user') {
            const images = attachmentImagesByMessage.get(msg.id);
            const content = rewriteLatestTextualWriteConfirmation && latestUserMessageRow === msg
              ? this.buildTextualWriteConfirmationInstruction(msg.content)
              : this.toProviderUserContent(msg.content);
            msgs.push({
              role: 'user',
              content,
              ...(images && images.length > 0 ? { images } : {}),
            });
            replayableToolCallIds = new Set<string>();
          } else if (msg.role === 'assistant') {
            const toolCalls = this.sanitizeReplayToolCalls(msg.tool_calls);
            const reasoningContent = replayDeepSeekReasoning && toolCalls
              ? extractDeepSeekReasoningContent(msg.provider_metadata_json)
              : null;
            if (replayDeepSeekReasoning && toolCalls && !reasoningContent) {
              this.logger.warn(
                'Skipping persisted DeepSeek assistant tool calls during replay because reasoning_content metadata is unavailable.',
              );
              if (msg.content.trim()) {
                msgs.push({
                  role: 'assistant',
                  content: stripBase64Images(msg.content),
                });
              }
              replayableToolCallIds = new Set<string>();
              continue;
            }
            msgs.push({
              role: 'assistant',
              content: stripBase64Images(msg.content),
              ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
              ...(toolCalls ? { tool_calls: toolCalls } : {}),
            });
            replayableToolCallIds = new Set((toolCalls ?? []).map((toolCall) => toolCall.id));
          } else if (msg.role === 'tool') {
            const toolCallId = this.parsePersistedToolMessageId(msg.content);
            if (!toolCallId || !replayableToolCallIds.has(toolCallId)) {
              this.logger.warn(
                `Skipping persisted tool message during replay because its assistant tool call is unavailable: id=${toolCallId || 'missing'}.`,
              );
              continue;
            }
            msgs.push({
              role: 'tool',
              content: msg.content,
              tool_call_id: toolCallId,
            });
            replayableToolCallIds.delete(toolCallId);
          }
        }
        // Get tools and system prompt
        const toolContext: AiExecutionContextWithManager = {
          ...ctx,
          conversationId: convId!,
        };
        const latestUserMessage = latestUserMessageRow?.content ?? userMessage;
        const contextProfile = selectAiContextProfileForTurn(
          history
            .filter((msg) => msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool')
            .map((msg) => ({
              role: msg.role as 'user' | 'assistant' | 'tool',
              content: msg.content,
            })),
        );
        const allAvailableTools = await this.capabilityRegistry.listAvailableToolItems(toolContext);
        const availableTools = filterToolListForProfile(allAvailableTools, contextProfile);
        const writePreviewToolNames = availableTools
          .filter((tool) => tool.write_preview != null)
          .map((tool) => tool.name);
        const toolSchemas = this.capabilityRegistry.toToolJsonSchemas(availableTools);
        const readableTypes = contextProfile.includeReadableEntityTypes
          ? await this.policy.listReadableEntityTypes(
            ctx,
            [...AI_QUERY_ENTITY_TYPES],
            ctx.manager,
          )
          : [];
        const currentUser = await this.loadCurrentUserPromptContext(ctx);
        const budgetColumns = await this.loadBudgetColumnsPromptContext(ctx, readableTypes);

        const builtSystemPrompt = this.systemPrompt.buildWithMetadata({
          tenantName,
          availableTools,
          readableEntityTypes: readableTypes,
          currentUser,
          contextProfile,
          budgetColumns,
        });
        const sysPrompt = builtSystemPrompt.text;

        return {
          conversationId: convId!,
          title: convTitle,
          providerMessages: msgs,
          tools: toolSchemas,
          systemPromptText: sysPrompt,
          systemPromptSections: builtSystemPrompt.sections,
          preStreamEvents: streamEvents,
          approvalAssistantText: null,
          contextSummary: {
            mentions: extractMentionContextItems(latestUserMessage),
            attachments: attachmentContextItems(requestedAttachments.length > 0
              ? requestedAttachments
              : Array.from(attachmentImagesByMessage.values()).flatMap((images) =>
                images.map((image) => ({
                  original_filename: 'Image',
                  kind: 'image',
                  mime_type: image.mime_type,
                  size: null,
                })),
              )),
            previews: previewContextItems(existingPreviews),
            artifacts: previewContextItems(existingPreviews.filter((preview) => preview.status === 'pending')),
            history: {
              message_count: history.length,
              attachment_count: Array.from(attachmentImagesByMessage.values()).reduce((count, images) => count + images.length, 0),
              tool_result_count: history.filter((msg) => msg.role === 'tool').length,
            },
            tools: {
              available_count: allAvailableTools.length,
              selected_count: availableTools.length,
              writable_count: availableTools.filter((tool) => tool.write_preview != null).length,
              readable_entity_types: readableTypes,
              context_profile: contextProfile.name,
            },
          },
          requiresWritePreviewGuard: contextProfile.promptMode === 'write' && writePreviewToolNames.length > 0,
          writePreviewToolNames,
        } satisfies StreamPreparationResult;
      });

    // Emit conversation event
    preparationMs = Math.max(0, Date.now() - requestStartedAt);
    yield { type: 'conversation', id: conversationId, title };
    yield { type: 'activity', phase: 'preparing_context', status: 'completed' };
    {
      const trace = buildDebugTrace('context_prepared');
      if (trace) yield trace;
    }
    yield { type: 'context', context: { ...contextSummary, timings: buildTimings(false) } };
    for (const event of preStreamEvents) {
      yield event;
    }

    if (approvalAssistantText != null) {
      const conversationUsage = await this.tenantExecutor.runWithContext(context, async (ctx) => {
        await this.conversations.appendMessage(
          {
            conversationId,
            tenantId: ctx.tenantId,
            conversationUserId: ctx.userId,
            userId: null,
            role: 'assistant',
            content: approvalAssistantText,
            usage: null,
          },
          { manager: ctx.manager },
        );
        return this.conversations.getConversationUsage(conversationId, ctx.tenantId, {
          manager: ctx.manager,
        });
      });

      yield { type: 'text_delta', text: approvalAssistantText };
      yield { type: 'activity', phase: 'finalizing', status: 'completed' };
      yield { type: 'context', context: { timings: buildTimings(true) } };
      {
        const trace = buildDebugTrace('turn_completed');
        if (trace) yield trace;
      }
      yield {
        type: 'done',
        usage: undefined,
        last_usage: undefined,
        conversation_usage: conversationUsage,
        builtin_usage: await this.loadBuiltinUsage(prepared),
      };
      return;
    }

    // Step 3: Provider streaming loop (NO DB transaction open)
    yield { type: 'activity', phase: 'analyzing', status: 'running' };
    let messages = [...providerMessages];
    let totalUsage: StreamUsage | undefined;
    let lastUsage: StreamUsage | undefined;
    let previousToolCallSignature: string | null = null;
    let unsafeWriteResponseRetries = 0;
    let unstructuredPlanRepairRetries = 0;
    let emptyWriteResponseRetries = 0;
    let emptyWriteAfterToolRepairRetries = 0;
    let bulkCompletenessRepairRetries = 0;
    let repeatedToolCallRepairRetries = 0;
    let mutationPreviewCountThisTurn = 0;
    let toolCallCountThisTurn = 0;
    let controlPlaneRunId: string | null = null;
    const searchAllProgress: SearchAllProgressState = {
      calls: 0,
      noProgressCalls: 0,
      repairRetries: 0,
      seenItemKeys: new Set<string>(),
    };
    let usedMutationPlanToolThisTurn = false;
    const bulkTargetSetsThisTurn: BulkTargetSet[] = [];
    const coveredBulkRefsThisTurn = new Set<string>();
    const failedBulkRefsThisTurn = new Set<string>();
    const excludedBulkRefsThisTurn = new Set<string>();
    const coveredBulkRefsByEntityTypeThisTurn = new Map<string, Set<string>>();
    const toolSchemaBudget = estimateToolSchemaBreakdown(tools);
    const loadConversationUsage = async (): Promise<AiTokenUsage> => {
      return this.tenantExecutor.runWithContext(context, async (ctx) => {
        return this.conversations.getConversationUsage(conversationId, ctx.tenantId, {
          manager: ctx.manager,
        });
      });
    };

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      if (abortSignal?.aborted) {
        return;
      }
      completedIterations = iteration + 1;

      const requestMaxTokens = resolveProviderMaxTokens(provider.descriptor.id, model);

      const budgetedMessages = prepareAiProviderMessages({
        systemPrompt: systemPromptText,
        systemPromptSections,
        messages,
        contextWindow: provider.descriptor.capabilities.contextWindow ?? null,
      });
      messages = budgetedMessages.messages;
      const requestBreakdown = withToolSchemaBreakdown(budgetedMessages.breakdown, toolSchemaBudget);
      const estimatedRequestSize = requestBreakdown.total_with_tools ?? budgetedMessages.estimatedRequestSize;
      yield {
        type: 'context',
        context: {
          budget: {
            estimated_request_size: estimatedRequestSize,
            budget: budgetedMessages.budget,
            compacted: budgetedMessages.compacted,
            over_budget_after_compaction: budgetedMessages.overBudgetAfterCompaction,
            breakdown: requestBreakdown,
          },
        },
      };

      this.logger.log(
        [
          `provider=${provider.descriptor.id}`,
          `model=${model}`,
          `estimated_request_size=${estimatedRequestSize}`,
          `max_tokens=${requestMaxTokens}`,
          `budget=${budgetedMessages.budget ?? 'none'}`,
          `compacted=${budgetedMessages.compacted}`,
          `tool_results_compacted=${budgetedMessages.compactedToolResults}`,
          `assistant_messages_compacted=${budgetedMessages.compactedAssistantMessages}`,
          `over_budget_after_compaction=${budgetedMessages.overBudgetAfterCompaction}`,
        ].join(' '),
      );

      let accumulatedText = '';
      let accumulatedReasoningContent = '';
      const pendingToolCalls: Array<{ id: string; name: string; arguments: string }> = [];
      let iterationUsage: StreamUsage | undefined;
      let responseActivityEmitted = false;

      const providerCallStartedAt = Date.now();
      {
        const trace = buildDebugTrace('provider_request_started', { iteration: iteration + 1 });
        if (trace) yield trace;
      }
      const providerStream = provider.createStream({
        model,
        apiKey,
        endpointUrl,
        endpointSource: providerSource === 'builtin' ? 'platform' : 'tenant',
        systemPrompt: systemPromptText,
        messages,
        tools,
        maxTokens: requestMaxTokens,
        signal: abortSignal,
        timeoutMs: modelTimeoutMs ?? resolveChatProviderTimeoutMs(),
        debugTrace: AI_CHAT_DEBUG_TRACE_ENABLED,
        reasoningEffort: providerSource === 'builtin' ? BUILTIN_REASONING_EFFORT : null,
      });

      try {
        for await (const event of providerStream) {
          switch (event.type) {
            case 'debug_trace': {
              const trace = buildDebugTrace(event.name, {
                iteration: iteration + 1,
                toolName: event.tool_name ?? null,
              });
              if (trace) yield trace;
              break;
            }

            case 'text_delta':
              if (firstTokenMs == null) {
                firstTokenMs = Math.max(0, Date.now() - requestStartedAt);
                {
                  const trace = buildDebugTrace('assistant_text_started', { iteration: iteration + 1 });
                  if (trace) yield trace;
                }
                yield { type: 'context', context: { timings: buildTimings(false) } };
              }
              if (!responseActivityEmitted) {
                yield { type: 'activity', phase: 'generating_response', status: 'running' };
                responseActivityEmitted = true;
              }
              accumulatedText += event.text;
              if (!requiresWritePreviewGuard) {
                yield { type: 'text_delta', text: event.text };
              }
              break;

            case 'reasoning_delta':
              accumulatedReasoningContent += event.text;
              break;

            case 'tool_call_start':
              pendingToolCalls.push({ id: event.id, name: event.name, arguments: '' });
              break;

            case 'tool_call_delta': {
              const tc = pendingToolCalls.find((t) => t.id === event.id);
              if (tc) tc.arguments += event.arguments;
              break;
            }

            case 'tool_call_end':
              break;

            case 'done':
              iterationUsage = cloneUsage(event.usage);
              totalUsage = addUsage(totalUsage, iterationUsage);
              lastUsage = iterationUsage;
              break;

            case 'error': {
              providerStreamMs += Math.max(0, Date.now() - providerCallStartedAt);
              const conversationUsage = await loadConversationUsage();
              yield { type: 'activity', phase: 'finalizing', status: 'failed' };
              yield { type: 'context', context: { timings: buildTimings(true) } };
              yield {
                type: 'error',
                message: event.message,
                last_usage: iterationUsage,
                conversation_usage: conversationUsage,
                builtin_usage: await this.loadBuiltinUsage(prepared),
              };
              return;
            }
          }
        }
        providerStreamMs += Math.max(0, Date.now() - providerCallStartedAt);
      } catch (error) {
        providerStreamMs += Math.max(0, Date.now() - providerCallStartedAt);
        if (abortSignal?.aborted || isAbortError(error)) {
          return;
        }
        const conversationUsage = await loadConversationUsage();
        yield { type: 'activity', phase: 'finalizing', status: 'failed' };
        yield { type: 'context', context: { timings: buildTimings(true) } };
        yield {
          type: 'error',
          message: error instanceof Error && error.message.trim() ? error.message : 'Stream failed.',
          last_usage: iterationUsage,
          conversation_usage: conversationUsage,
          builtin_usage: await this.loadBuiltinUsage(prepared),
        };
        return;
      }

      if (abortSignal?.aborted) {
        return;
      }

      this.logger.log(
        `Iteration ${iteration + 1}: text=${accumulatedText.length} chars, tool_calls=${pendingToolCalls.length}`,
      );

      // If there are tool calls, execute them
      if (pendingToolCalls.length > 0) {
        const assistantToolCalls: AiProviderToolCall[] = pendingToolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        }));
        const toolCallSignature = buildToolCallSignature(assistantToolCalls);

        if (previousToolCallSignature === toolCallSignature) {
          if (repeatedToolCallRepairRetries < MAX_REPEATED_TOOL_CALL_REPAIR_RETRIES) {
            repeatedToolCallRepairRetries++;
            this.logger.warn(
              `Repeated identical tool call signature detected; issuing repair instruction attempt ${repeatedToolCallRepairRetries}/${MAX_REPEATED_TOOL_CALL_REPAIR_RETRIES}.`,
            );
            messages.push({
              role: 'user',
              content: this.buildRepeatedToolCallRepairInstruction({
                toolCalls: assistantToolCalls,
                assistantText: accumulatedText,
                requiresWritePreviewGuard,
                writePreviewToolNames,
              }),
            });
            continue;
          }
          const conversationUsage = await loadConversationUsage();
          yield { type: 'activity', phase: 'finalizing', status: 'failed' };
          yield { type: 'context', context: { timings: buildTimings(true) } };
          yield {
            type: 'error',
            message: 'Maximum tool call iterations reached without progress.',
            last_usage: lastUsage,
            conversation_usage: conversationUsage,
            builtin_usage: await this.loadBuiltinUsage(prepared),
          };
          return;
        }
        repeatedToolCallRepairRetries = 0;
        previousToolCallSignature = toolCallSignature;

        const assistantTextForToolTurn = requiresWritePreviewGuard && containsRawToolMarkup(accumulatedText)
          ? ''
          : accumulatedText;

        if (requiresWritePreviewGuard && assistantTextForToolTurn.length > 0) {
          yield { type: 'text_delta', text: assistantTextForToolTurn };
        }

        let searchAllNoProgressIntervention: SearchAllNoProgressIntervention | null = null;

        // Execute each tool call
        for (let toolCallIndex = 0; toolCallIndex < assistantToolCalls.length; toolCallIndex++) {
          const tc = assistantToolCalls[toolCallIndex];
          const assistantContent = toolCallIndex === 0 ? assistantTextForToolTurn : '';
          const assistantReasoningContent = replayDeepSeekReasoning
            ? accumulatedReasoningContent
            : '';
          const assistantUsage = toolCallIndex === 0 ? (iterationUsage ?? null) : null;
          const parsedArgsResult = tryParseToolCallArguments(tc.arguments || '{}');
          const parseErrorMessage = 'message' in parsedArgsResult ? parsedArgsResult.message : null;
          const parsedArgs = 'value' in parsedArgsResult ? parsedArgsResult.value : {};
          const activityPhase = toolActivityPhase(tc.name);
          {
            const trace = buildDebugTrace('tool_call_ready', {
              iteration: iteration + 1,
              toolName: tc.name || null,
            });
            if (trace) yield trace;
          }

          yield {
            type: 'activity',
            phase: activityPhase,
            status: 'running',
            tool_name: tc.name,
          };
          yield {
            type: 'tool_call',
            id: tc.id,
            name: tc.name,
            arguments: parsedArgs,
          };

          let result: unknown;
          if (!tc.name?.trim()) {
            this.logger.warn(`Skipping tool execution for tool_call_id=${tc.id} because the tool name was empty.`);
            result = { error: 'Tool call was missing a tool name. Ask the model to retry.' };
            const skippedAssistantText = this.buildSkippedToolCallAssistantText(
              assistantContent,
              tc,
              'the tool name was missing.',
            );
            messages.push({ role: 'assistant', content: skippedAssistantText });
	            await this.tenantExecutor.runWithContext(context, async (ctx) => {
	              await this.conversations.appendMessage(
                {
                  conversationId,
                  tenantId: ctx.tenantId,
                  conversationUserId: ctx.userId,
                  userId: null,
                  role: 'assistant',
                  content: skippedAssistantText,
                  usage: assistantUsage,
                },
                { manager: ctx.manager },
              );
            });
          } else if (parseErrorMessage) {
            this.logger.warn(
              `Skipping tool execution for tool_call_id=${tc.id} tool=${tc.name} because arguments were invalid JSON.`,
            );
            result = { error: `${parseErrorMessage} Ask the model to retry with valid JSON arguments.` };
            const skippedAssistantText = this.buildSkippedToolCallAssistantText(
              assistantContent,
              tc,
              'the arguments were invalid JSON.',
            );
            messages.push({ role: 'assistant', content: skippedAssistantText });
            await this.tenantExecutor.runWithContext(context, async (ctx) => {
              await this.conversations.appendMessage(
                {
                  conversationId,
                  tenantId: ctx.tenantId,
                  conversationUserId: ctx.userId,
                  userId: null,
                  role: 'assistant',
                  content: skippedAssistantText,
                  usage: assistantUsage,
                },
                { manager: ctx.manager },
              );
            });
          } else {
            messages.push({
              role: 'assistant',
              content: assistantContent,
              ...(assistantReasoningContent.trim() ? { reasoning_content: assistantReasoningContent } : {}),
              tool_calls: [tc],
            });

            // Persist the assistant turn before tool execution so usage survives interrupted loops.
            // Multiple parallel tool calls are stored as sequential one-call turns for stricter
            // OpenAI-compatible backends such as Qwen tool parsers.
            await this.tenantExecutor.runWithContext(context, async (ctx) => {
              await this.conversations.appendMessage(
                {
                  conversationId,
                  tenantId: ctx.tenantId,
                  conversationUserId: ctx.userId,
                  userId: null,
                  role: 'assistant',
                  content: assistantContent,
                  toolCalls: [tc],
                  usage: assistantUsage,
                  providerMetadata: deepSeekReasoningMetadata(assistantReasoningContent),
                },
                { manager: ctx.manager },
              );
            });

            let executionToolName = tc.name;
            let executionArgs: Record<string, unknown> = parsedArgs;
            let bulkAutoplan: { originalToolName: string; missingRefs: string[] } | null = null;
            if (
              requiresWritePreviewGuard
              && writePreviewToolNames.includes('prepare_mutation_plan')
              && parsedArgs
              && typeof parsedArgs === 'object'
              && !Array.isArray(parsedArgs)
            ) {
              const textualTargetSet = (
                tc.name === 'prepare_mutation_plan'
                || isRefBasedSingleMutationTool(tc.name, writePreviewToolNames)
              )
                ? selectTextualBulkTargetSet({
                  messages,
                  currentAssistantText: assistantTextForToolTurn,
                  requestedRef: parsedArgs.ref,
                })
                : null;
              const currentBulkIssue = findBulkCoverageIssue({
                targetSets: textualTargetSet
                  ? [...bulkTargetSetsThisTurn, textualTargetSet]
                  : bulkTargetSetsThisTurn,
                coveredRefs: coveredBulkRefsThisTurn,
                coveredRefsByEntityType: coveredBulkRefsByEntityTypeThisTurn,
                failedRefs: failedBulkRefsThisTurn,
                excludedRefs: excludedBulkRefsThisTurn,
                requireExistingCoverage: false,
              });
              const autoplanInput = currentBulkIssue && tc.name === 'prepare_mutation_plan'
                ? buildAugmentedBulkMutationPlanInput({
                  issue: currentBulkIssue,
                  input: parsedArgs,
                })
                : currentBulkIssue && isRefBasedSingleMutationTool(tc.name, writePreviewToolNames)
                  ? buildBulkAutoplanInput({
                    issue: currentBulkIssue,
                    toolName: tc.name,
                    input: parsedArgs,
                  })
                  : null;
              if (autoplanInput) {
                executionToolName = 'prepare_mutation_plan';
                executionArgs = autoplanInput;
                bulkAutoplan = {
                  originalToolName: tc.name,
                  missingRefs: currentBulkIssue!.missingRefs,
                };
              }
            }

            const toolStartedAt = Date.now();
            {
              const trace = buildDebugTrace('tool_execution_started', {
                iteration: iteration + 1,
                toolName: executionToolName,
              });
              if (trace) yield trace;
            }
            try {
              result = await this.tenantExecutor.runWithContext({ ...context, conversationId }, async (ctx) => {
                const dispatched = await this.dispatcher.execute(ctx, {
                  capabilityName: executionToolName,
                  input: executionArgs,
                  execution: {
                    runId: controlPlaneRunId,
                    stepIndex: toolCallCountThisTurn + 1,
                    surface: 'chat',
                    trigger_kind: 'human_user',
                    metadata: {
                      provider_tool_call_id: tc.id,
                      requested_tool_name: tc.name,
                    },
                  },
                });
                controlPlaneRunId = dispatched.run_id;
                return dispatched.output;
              });
              if (bulkAutoplan && result && typeof result === 'object') {
                result = {
                  ...(result as Record<string, unknown>),
                  bulk_autoplan: {
                    from_tool_name: bulkAutoplan.originalToolName,
                    executed_tool_name: executionToolName,
                    missing_refs: bulkAutoplan.missingRefs,
                  },
                };
              }
            } catch (err: any) {
              result = { error: err.message || 'Tool execution failed.' };
            } finally {
              toolExecutionMs += Math.max(0, Date.now() - toolStartedAt);
              const trace = buildDebugTrace('tool_execution_completed', {
                iteration: iteration + 1,
                toolName: executionToolName,
              });
              if (trace) yield trace;
            }
            toolCallCountThisTurn++;

            yield {
              type: 'tool_result',
              id: tc.id,
              name: tc.name,
              result,
            };
            yield {
              type: 'activity',
              phase: activityPhase,
              status: 'completed',
              tool_name: tc.name,
            };
            const injectedContext = toolResultContextItems(tc.name, result);
            if (injectedContext.length > 0) {
              yield {
                type: 'context',
                context: {
                  injected: injectedContext,
                },
              };
            }

            const mutationPreviews = mutationPreviewDtosFromResult(result);
            mutationPreviewCountThisTurn += mutationPreviews.length;
            const queryTargetSet = extractQueryBulkTargetSet(tc.name, parsedArgs, result);
            if (queryTargetSet) {
              bulkTargetSetsThisTurn.push(queryTargetSet);
            }
            const explicitTargetSet = extractExplicitBulkTargetSet(tc.name, result);
            if (explicitTargetSet) {
              bulkTargetSetsThisTurn.push(explicitTargetSet);
            }
            addRefs(failedBulkRefsThisTurn, extractBulkFailedRefs(result));
            addRefs(excludedBulkRefsThisTurn, extractBulkExcludedRefs(result));
            if (tc.name === 'prepare_mutation_plan' || bulkAutoplan) {
              usedMutationPlanToolThisTurn = true;
            }
            for (const mutationPreview of mutationPreviews) {
              const ref = normalizeBulkRef(mutationPreview.target?.ref);
              if (ref) {
                coveredBulkRefsThisTurn.add(ref);
                const entityType = mutationPreview.target?.entity_type;
                if (entityType) {
                  const refsForEntity = coveredBulkRefsByEntityTypeThisTurn.get(entityType) ?? new Set<string>();
                  refsForEntity.add(ref);
                  coveredBulkRefsByEntityTypeThisTurn.set(entityType, refsForEntity);
                }
              }
              yield {
                type: 'preview',
                ...mutationPreview,
              };
            }

            const validation = buildStructuredToolResultValidation(tc.name, result);
            const toolContent = JSON.stringify({
              tool_call_id: tc.id,
              tool_name: tc.name,
              result,
              ...(validation ? { validation } : {}),
            });

            messages.push({
              role: 'tool',
              content: toolContent,
              tool_call_id: tc.id,
            });

            await this.tenantExecutor.runWithContext(context, async (ctx) => {
              await this.conversations.appendMessage(
                {
                  conversationId,
                  tenantId: ctx.tenantId,
                  conversationUserId: ctx.userId,
                  userId: null,
                  role: 'tool',
                  content: toolContent,
                },
                { manager: ctx.manager },
              );
            });

            searchAllNoProgressIntervention ??= recordSearchAllProgress({
              state: searchAllProgress,
              toolName: tc.name,
              parsedArgs,
              result,
            });
            continue;
          }

          yield {
            type: 'tool_result',
            id: tc.id,
            name: tc.name,
            result,
          };
          yield {
            type: 'activity',
            phase: activityPhase,
            status: 'completed',
            tool_name: tc.name,
          };
        }

        if (searchAllNoProgressIntervention) {
          if (searchAllNoProgressIntervention.action === 'fail') {
            this.logger.warn(
              `search_all no-progress threshold reached after ${searchAllNoProgressIntervention.calls} calls; failing turn.`,
            );
            const conversationUsage = await loadConversationUsage();
            yield { type: 'activity', phase: 'finalizing', status: 'failed' };
            yield { type: 'context', context: { timings: buildTimings(true) } };
            yield {
              type: 'error',
              message: 'Maximum tool call iterations reached without progress.',
              last_usage: lastUsage,
              conversation_usage: conversationUsage,
              builtin_usage: await this.loadBuiltinUsage(prepared),
            };
            return;
          }

          this.logger.warn(
            `search_all no-progress threshold reached after ${searchAllNoProgressIntervention.calls} calls; issuing repair instruction.`,
          );
          messages.push({
            role: 'user',
            content: this.buildSearchAllNoProgressRepairInstruction(searchAllNoProgressIntervention),
          });
          previousToolCallSignature = null;
        }

        // Continue loop for next iteration
        continue;
      }

      // No tool calls - this is the final assistant response
      const bulkCoverageIssue = requiresWritePreviewGuard
        ? findBulkCoverageIssue({
          targetSets: bulkTargetSetsThisTurn,
          coveredRefs: coveredBulkRefsThisTurn,
          coveredRefsByEntityType: coveredBulkRefsByEntityTypeThisTurn,
          failedRefs: failedBulkRefsThisTurn,
          excludedRefs: excludedBulkRefsThisTurn,
        })
        : null;
      if (
        bulkCoverageIssue
        && !textExplicitlyAddressesMissingRefs(accumulatedText, bulkCoverageIssue.missingRefs)
      ) {
        if (bulkCompletenessRepairRetries < MAX_UNSAFE_WRITE_RESPONSE_RETRIES) {
          bulkCompletenessRepairRetries++;
          if (accumulatedText.trim()) {
            messages.push({
              role: 'assistant',
              content: stripBase64Images(accumulatedText),
            });
          }
          messages.push({
            role: 'user',
            content: this.buildBulkCompletenessRepairInstruction({
              issue: bulkCoverageIssue,
              writePreviewToolNames,
            }),
          });
          previousToolCallSignature = null;
          continue;
        }
        accumulatedText = `Je n'ai pas pu verifier la completude des previews de masse. Aucune modification n'a ete executee. Cibles manquantes: ${bulkCoverageIssue.missingRefs.join(', ') || 'inconnues'}.`;
      }

      if (
        requiresWritePreviewGuard
        && mutationPreviewCountThisTurn === 0
        && toolCallCountThisTurn === 0
        && accumulatedText.trim().length === 0
        && emptyWriteResponseRetries < MAX_UNSAFE_WRITE_RESPONSE_RETRIES
      ) {
        emptyWriteResponseRetries++;
        messages.push({
          role: 'user',
          content: this.buildEmptyWriteResponseRepairInstruction({
            writePreviewToolNames,
          }),
        });
        previousToolCallSignature = null;
        continue;
      }

      if (
        requiresWritePreviewGuard
        && mutationPreviewCountThisTurn === 0
        && toolCallCountThisTurn > 0
        && accumulatedText.trim().length === 0
        && emptyWriteAfterToolRepairRetries < MAX_UNSAFE_WRITE_RESPONSE_RETRIES
      ) {
        emptyWriteAfterToolRepairRetries++;
        messages.push({
          role: 'user',
          content: this.buildEmptyWriteAfterToolRepairInstruction({
            writePreviewToolNames,
          }),
        });
        previousToolCallSignature = null;
        continue;
      }

      if (
        requiresWritePreviewGuard
        && this.shouldRepairUnstructuredPlanPreview({
          assistantText: accumulatedText,
          mutationPreviewCountThisTurn,
          usedMutationPlanToolThisTurn,
          repairAttempts: unstructuredPlanRepairRetries,
        })
      ) {
        unstructuredPlanRepairRetries++;
        messages.push({
          role: 'assistant',
          content: stripBase64Images(accumulatedText),
        });
        messages.push({
          role: 'user',
          content: this.buildUnstructuredPlanRepairInstruction({
            assistantText: accumulatedText,
            writePreviewToolNames,
          }),
        });
        previousToolCallSignature = null;
        continue;
      }

      if (
        requiresWritePreviewGuard
        && mutationPreviewCountThisTurn === 0
        && this.isUnsafeWritePreviewAssistantText(accumulatedText)
      ) {
        if (unsafeWriteResponseRetries < MAX_UNSAFE_WRITE_RESPONSE_RETRIES) {
          unsafeWriteResponseRetries++;
          messages.push({
            role: 'assistant',
            content: stripBase64Images(accumulatedText),
          });
          messages.push({
            role: 'user',
            content: this.buildUnsafeWritePreviewResponseRepairInstruction({
              assistantText: accumulatedText,
              writePreviewToolNames,
            }),
          });
          previousToolCallSignature = null;
          continue;
        }
        accumulatedText = "Je n'ai pas pu creer les previews backend necessaires. Aucune modification n'a ete executee.";
      }

      if (requiresWritePreviewGuard && accumulatedText.length > 0) {
        yield { type: 'text_delta', text: accumulatedText };
      }

      const conversationUsage = await this.tenantExecutor.runWithContext(context, async (ctx) => {
        await this.conversations.appendMessage(
          {
            conversationId,
            tenantId: ctx.tenantId,
            conversationUserId: ctx.userId,
            userId: null,
            role: 'assistant',
            content: accumulatedText,
            usage: iterationUsage ?? null,
          },
          { manager: ctx.manager },
        );
        return this.conversations.getConversationUsage(conversationId, ctx.tenantId, {
          manager: ctx.manager,
        });
      });

      yield { type: 'activity', phase: 'finalizing', status: 'completed' };
      yield { type: 'context', context: { timings: buildTimings(true) } };
      {
        const trace = buildDebugTrace('turn_completed');
        if (trace) yield trace;
      }
      yield {
        type: 'done',
        usage: totalUsage,
        last_usage: lastUsage,
        conversation_usage: conversationUsage,
        builtin_usage: await this.loadBuiltinUsage(prepared),
      };
      return;
    }

    // Max iterations reached
    const conversationUsage = await loadConversationUsage();
    yield { type: 'activity', phase: 'finalizing', status: 'failed' };
    yield { type: 'context', context: { timings: buildTimings(true) } };
    yield {
      type: 'error',
      message: 'Maximum tool call iterations reached.',
      last_usage: lastUsage,
      conversation_usage: conversationUsage,
      builtin_usage: await this.loadBuiltinUsage(prepared),
    };
  }
}
