import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatStreamRequestError, streamChat, aiConversationsApi } from './aiApi';
import {
  AiMutationPreview,
  BuiltinUsage,
  ChatActivityEntry,
  ChatAttachment,
  ChatContextItem,
  ChatContextSummary,
  ChatDebugTraceEntry,
  ChatMessage,
  StoredChatMessage,
  TokenUsage,
} from './aiTypes';
import i18n from '../i18n';

let msgCounter = 0;
const CONTROL_MARKER_RE = /^\[(APPROVE|REJECT):[0-9a-f-]{36}\]$|^\[(APPROVE_SELECTED|REJECT_SELECTED):[0-9a-f,\s-]+\]$/i;
const ENTITY_TYPE_FROM_URL_PREFIX: Array<{ prefix: string; entityType: string }> = [
  { prefix: '/knowledge/', entityType: 'documents' },
  { prefix: '/portfolio/tasks/', entityType: 'tasks' },
  { prefix: '/portfolio/projects/', entityType: 'projects' },
  { prefix: '/portfolio/requests/', entityType: 'requests' },
  { prefix: '/it/applications/', entityType: 'applications' },
  { prefix: '/it/assets/', entityType: 'assets' },
  { prefix: '/it/technologies/', entityType: 'technologies' },
  { prefix: '/it/connections/', entityType: 'connections' },
  { prefix: '/it/interfaces/', entityType: 'interfaces' },
  { prefix: '/it/locations/', entityType: 'locations' },
  { prefix: '/ops/contracts/', entityType: 'contracts' },
  { prefix: '/it/incidents/', entityType: 'incidents' },
  { prefix: '/master-data/companies/', entityType: 'companies' },
  { prefix: '/master-data/contacts/', entityType: 'contacts' },
  { prefix: '/master-data/departments/', entityType: 'departments' },
  { prefix: '/master-data/suppliers/', entityType: 'suppliers' },
  { prefix: '/master-data/business-processes/', entityType: 'business_processes' },
];
/** Hard cap on attachments per message — matches multimodal model practical limit. */
export const MAX_PENDING_ATTACHMENTS = 8;

export type PendingAttachment = {
  /** Local-only id, used to remove the attachment before send. */
  localId: string;
  file: File;
  previewUrl: string;
};

function nextId() {
  return `local-${++msgCounter}-${Date.now()}`;
}

function isControlMarker(text: string): boolean {
  return CONTROL_MARKER_RE.test(String(text || '').trim());
}

function inferEntityTypeFromUrl(url: string): string | null {
  // Neutral budget links carry no nature. The server resolves their context before displaying it.
  if (url.startsWith('/ops/budget/')) return null;
  return ENTITY_TYPE_FROM_URL_PREFIX.find((entry) => url.startsWith(entry.prefix))?.entityType ?? null;
}

function contextItemKey(item: ChatContextItem): string {
  return [
    item.kind,
    item.entity_type || '',
    item.ref || '',
    item.label || '',
    item.detail || '',
    item.status || '',
  ].join('\u0000');
}

function mergeContextItems(
  current: ChatContextItem[] | undefined,
  incoming: ChatContextItem[] | undefined,
): ChatContextItem[] | undefined {
  if (!incoming || incoming.length === 0) {
    return current;
  }
  const items = [...(current || [])];
  const seen = new Set(items.map(contextItemKey));
  for (const item of incoming) {
    if (!item?.label) {
      continue;
    }
    const key = contextItemKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push(item);
  }
  return items;
}

function mergeChatContext(
  current: ChatContextSummary | undefined,
  incoming: ChatContextSummary | undefined,
): ChatContextSummary | undefined {
  if (!incoming) {
    return current;
  }
  return {
    ...current,
    ...incoming,
    mentions: mergeContextItems(current?.mentions, incoming.mentions),
    attachments: mergeContextItems(current?.attachments, incoming.attachments),
    injected: mergeContextItems(current?.injected, incoming.injected),
    previews: mergeContextItems(current?.previews, incoming.previews),
    artifacts: mergeContextItems(current?.artifacts, incoming.artifacts),
    history: incoming.history ?? current?.history,
    tools: incoming.tools ?? current?.tools,
    budget: incoming.budget === undefined ? current?.budget : incoming.budget,
    timings: incoming.timings === undefined ? current?.timings : incoming.timings,
  };
}

function appendActivity(
  current: ChatActivityEntry[] | undefined,
  incoming: Omit<ChatActivityEntry, 'created_at'>,
): ChatActivityEntry[] {
  const nextEntry: ChatActivityEntry = {
    ...incoming,
    created_at: new Date().toISOString(),
  };
  const previous = current || [];
  const last = previous[previous.length - 1];
  if (
    last
    && last.phase === nextEntry.phase
    && last.status === nextEntry.status
    && last.tool_name === nextEntry.tool_name
  ) {
    return previous;
  }
  return [...previous, nextEntry].slice(-24);
}

function appendDebugTrace(
  current: ChatDebugTraceEntry[] | undefined,
  incoming: Omit<ChatDebugTraceEntry, 'created_at'>,
): ChatDebugTraceEntry[] {
  return [
    ...(current || []),
    {
      ...incoming,
      created_at: new Date().toISOString(),
    },
  ].slice(-120);
}

function extractMentionContextItems(text: string): ChatContextItem[] {
  const items: ChatContextItem[] = [];
  const seen = new Set<string>();
  const linkRe = /\[([^\]]{1,160})\]\((\/[^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(text)) != null) {
    const label = String(match[1] || '').replace(/\s+/g, ' ').trim();
    const url = String(match[2] || '');
    const entityType = inferEntityTypeFromUrl(url);
    if (!label || !entityType) continue;
    const key = `${entityType}:${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      kind: 'mention',
      label,
      entity_type: entityType,
      ref: /^[A-Z]+-\d+$/.test(label) ? label : null,
    });
  }
  return items;
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size >= 1024 * 1024) return `${Math.round((size / (1024 * 1024)) * 10) / 10} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function attachmentContextItems(attachments: ChatAttachment[]): ChatContextItem[] {
  return attachments.map((attachment, index) => ({
    kind: 'attachment',
    label: attachment.kind === 'image' ? `Image ${index + 1}` : attachment.kind || `Attachment ${index + 1}`,
    detail: formatBytes(attachment.size) || attachment.mime_type,
  }));
}

function buildInitialContext(text: string, attachments: ChatAttachment[]): ChatContextSummary | undefined {
  const mentions = extractMentionContextItems(text);
  const attachmentItems = attachmentContextItems(attachments);
  if (!mentions.length && !attachmentItems.length) {
    return undefined;
  }
  return {
    ...(mentions.length ? { mentions } : {}),
    ...(attachmentItems.length ? { attachments: attachmentItems } : {}),
  };
}

function carryAssistantTransient(previous: ChatMessage[], rebuilt: ChatMessage[]): ChatMessage[] {
  const previousAssistant = previous.filter((message) => message.role === 'assistant');
  if (!previousAssistant.some((message) => message.activity?.length || message.context)) {
    return rebuilt;
  }

  let assistantIndex = 0;
  return rebuilt.map((message) => {
    if (message.role !== 'assistant') {
      return message;
    }
    const transient = previousAssistant[assistantIndex];
    assistantIndex += 1;
    if (!transient) {
      return message;
    }
    return {
      ...message,
      previewIds: message.previewIds ?? transient.previewIds,
      activity: transient.activity,
      context: mergeChatContext(message.context, transient.context),
      debugTrace: transient.debugTrace,
    };
  });
}

function upsertPreview(prev: AiMutationPreview[], next: AiMutationPreview): AiMutationPreview[] {
  const index = prev.findIndex((item) => item.preview_id === next.preview_id);
  if (index === -1) {
    return [...prev, next];
  }
  const copy = [...prev];
  copy[index] = next;
  return copy;
}

function isMutationPreview(value: unknown): value is AiMutationPreview {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.preview_id === 'string'
    && typeof candidate.status === 'string'
    && typeof candidate.tool_name === 'string'
    && candidate.target != null
    && candidate.changes != null;
}

function extractMutationPreviews(value: unknown): AiMutationPreview[] {
  if (isMutationPreview(value)) {
    return [value];
  }
  if (!value || typeof value !== 'object') {
    return [];
  }
  const previews = (value as Record<string, unknown>).previews;
  return Array.isArray(previews)
    ? previews.filter(isMutationPreview)
    : [];
}

function appendPreviewId(current: string[] | undefined, previewId: string): string[] {
  const values = current || [];
  return values.includes(previewId) ? values : [...values, previewId];
}

function previewIdsFromToolResults(toolResults: NonNullable<ChatMessage['toolResults']>): string[] {
  const ids: string[] = [];
  for (const toolResult of toolResults) {
    for (const preview of extractMutationPreviews(toolResult.result)) {
      if (!ids.includes(preview.preview_id)) {
        ids.push(preview.preview_id);
      }
    }
  }
  return ids;
}

function appendAssistantContent(current: string, incoming: string): string {
  const next = String(incoming || '');
  if (!next.trim()) {
    return current;
  }
  if (!String(current || '').trim()) {
    return next;
  }
  return `${current}\n\n${next}`;
}

function normalizeConversationUsage(usage?: TokenUsage | null): TokenUsage | null {
  if (!usage) {
    return null;
  }

  const inputTokens = Number(usage.input_tokens);
  const outputTokens = Number(usage.output_tokens);
  const normalized = {
    input_tokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    output_tokens: Number.isFinite(outputTokens) ? outputTokens : 0,
  };

  return normalized.input_tokens + normalized.output_tokens > 0 ? normalized : null;
}

function findLastUsage(messages: Array<Pick<StoredChatMessage, 'role' | 'usage_json'>>): TokenUsage | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'assistant') {
      continue;
    }
    const usage = normalizeConversationUsage(message.usage_json);
    if (usage) {
      return usage;
    }
  }
  return null;
}

/**
 * Reconstruct the UI-facing message timeline from the flat StoredChatMessage[] returned
 * by the backend. Coalesces consecutive assistant+tool message rows into a single
 * ChatMessage with toolCalls + toolResults populated, so the chat thread renders the
 * tool ribbon panel as one block per assistant turn (matching the streaming behavior).
 *
 * Used by both loadConversation (initial load) and the post-stream refresh that swaps
 * local-* ids for real DB UUIDs after a turn completes.
 */
function rebuildMessagesFromStored(rawMessages: StoredChatMessage[], conversationId: string): ChatMessage[] {
  const buildAttachments = (msg: StoredChatMessage): ChatAttachment[] | undefined => {
    if (!msg.attachments || !msg.attachments.length) return undefined;
    return msg.attachments.map((a) => ({
      id: a.id,
      mime_type: a.mime_type,
      size: a.size,
      kind: a.kind,
      preview_url: aiConversationsApi.buildAttachmentUrl(conversationId, a.id),
    }));
  };

  const loaded: ChatMessage[] = [];
  let i = 0;
  while (i < rawMessages.length) {
    const msg = rawMessages[i];

    if (msg.role === 'user') {
      loaded.push({
        id: msg.id,
        role: 'user',
        content: msg.content,
        hidden: isControlMarker(msg.content),
        attachments: buildAttachments(msg),
      });
      i++;
    } else if (msg.role === 'assistant' && msg.tool_calls?.length) {
      const merged: ChatMessage = {
        id: msg.id,
        role: 'assistant',
        content: msg.content || '',
        toolCalls: [...msg.tool_calls],
        toolResults: [],
        usage: msg.usage_json || undefined,
      };
      i++;
      while (i < rawMessages.length) {
        const next = rawMessages[i];
        if (next.role === 'tool') {
          try {
            const parsed = JSON.parse(next.content);
            merged.toolResults!.push({
              id: parsed.tool_call_id,
              name: parsed.tool_name,
              result: parsed.result,
            });
          } catch {
            // skip malformed tool messages
          }
          i++;
        } else if (next.role === 'assistant' && next.tool_calls?.length) {
          if (String(next.content || '').trim()) {
            break;
          }
          merged.toolCalls!.push(...next.tool_calls);
          if (next.usage_json) merged.usage = next.usage_json;
          i++;
        } else if (next.role === 'assistant' && !next.tool_calls?.length) {
          merged.content = appendAssistantContent(merged.content, next.content);
          if (next.usage_json) merged.usage = next.usage_json;
          i++;
          break;
        } else {
          break;
        }
      }
      const previewIds = previewIdsFromToolResults(merged.toolResults || []);
      if (previewIds.length > 0) {
        merged.previewIds = previewIds;
      }
      loaded.push(merged);
    } else if (msg.role === 'assistant') {
      loaded.push({
        id: msg.id,
        role: 'assistant',
        content: msg.content,
        usage: msg.usage_json || undefined,
      });
      i++;
    } else {
      i++;
    }
  }
  return loaded;
}

function normalizeBuiltinUsage(usage?: BuiltinUsage | null): BuiltinUsage | null {
  if (!usage) {
    return null;
  }

  const count = Number(usage.count);
  const limit = Number(usage.limit);

  return {
    count: Number.isFinite(count) ? count : 0,
    limit: Number.isFinite(limit) ? limit : 0,
    year_month: String(usage.year_month || ''),
    reset_date: String(usage.reset_date || ''),
  };
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [previews, setPreviews] = useState<AiMutationPreview[]>([]);
  const [conversationUsage, setConversationUsage] = useState<TokenUsage | null>(null);
  const [lastRequestUsage, setLastRequestUsage] = useState<TokenUsage | null>(null);
  const [builtinUsage, setBuiltinUsage] = useState<BuiltinUsage | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  // The id of the message currently being edited (a user message). When set, the next
  // sendMessage call truncates the conversation tail from that message before streaming.
  // Cleared on send completion or explicit cancel.
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const streamGenerationRef = useRef(0);

  const abortActiveStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    streamGenerationRef.current += 1;
  }, []);

  // Abort in-flight stream on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, [abortActiveStream]);

  // Revoke pending object URLs on unmount to avoid leaks
  useEffect(() => {
    return () => {
      for (const att of pendingAttachments) {
        try { URL.revokeObjectURL(att.previewUrl); } catch { /* ignore */ }
      }
    };
  }, [pendingAttachments]);

  const refreshConversationUsage = useCallback(async (id: string) => {
    try {
      const response = await aiConversationsApi.getMessages(id);
      if (conversationIdRef.current === id) {
        setConversationUsage(normalizeConversationUsage(response.conversation_usage));
        setLastRequestUsage(findLastUsage(response.messages));
      }
    } catch {
      // Ignore usage refresh failures after a terminal stream event.
    }
  }, []);

  const addPendingFiles = useCallback((files: File[]): { added: number; rejected: number } => {
    let added = 0;
    let rejected = 0;
    setPendingAttachments((prev) => {
      const remaining = MAX_PENDING_ATTACHMENTS - prev.length;
      if (remaining <= 0) {
        rejected = files.length;
        return prev;
      }
      const accepted = files.slice(0, remaining);
      rejected = files.length - accepted.length;
      const next = accepted.map((file) => ({
        localId: nextId(),
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      added = next.length;
      return [...prev, ...next];
    });
    return { added, rejected };
  }, []);

  const removePendingAttachment = useCallback((localId: string) => {
    setPendingAttachments((prev) => {
      const target = prev.find((p) => p.localId === localId);
      if (target) {
        try { URL.revokeObjectURL(target.previewUrl); } catch { /* ignore */ }
      }
      return prev.filter((p) => p.localId !== localId);
    });
  }, []);

  const clearPendingAttachments = useCallback(() => {
    setPendingAttachments((prev) => {
      for (const p of prev) {
        try { URL.revokeObjectURL(p.previewUrl); } catch { /* ignore */ }
      }
      return [];
    });
  }, []);

  /**
   * Internal sender shared by `sendMessage` and `regenerate`. Skipping the persist of a
   * new user message (regenerate flow) is opted in via `text === ''` + a non-null
   * truncateFromMessageId. The orchestrator on the backend mirrors that contract.
   */
  const runStream = useCallback(async (
    text: string,
    opts: { truncateFromMessageId?: string | null; isRegenerate?: boolean } = {},
  ) => {
    if (isStreaming) return;
    if (!opts.isRegenerate && !text.trim()) return;
    setError(null);
    setIsStreaming(true);

    const generation = ++streamGenerationRef.current;
    const controller = new AbortController();
    abortRef.current = controller;

    // Snapshot pending attachments so subsequent UI changes don't mutate the in-flight send.
    const attachmentsToSend = pendingAttachments;

    let activeConversationId = conversationId;
    const truncateFromMessageId = opts.truncateFromMessageId ?? null;

    // Local truncation for immediate UI feedback. Backend will mirror via the
    // truncate_from_message_id param on the stream call.
    if (truncateFromMessageId) {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === truncateFromMessageId);
        return idx >= 0 ? prev.slice(0, idx) : prev;
      });
    }

    // Skip the optimistic user message on regenerate — the previous user message is
    // already in the conversation tail and we're re-streaming against it unchanged.
    let userMsgId: string | null = null;
    if (!opts.isRegenerate) {
      userMsgId = nextId();
      const optimisticUserAttachments: ChatAttachment[] = attachmentsToSend.map((a) => ({
        id: a.localId,
        mime_type: a.file.type || 'image/png',
        size: a.file.size,
        kind: 'image',
        preview_url: a.previewUrl,
      }));
      const userMsg: ChatMessage = {
        id: userMsgId,
        role: 'user',
        content: text,
        hidden: isControlMarker(text),
        attachments: optimisticUserAttachments.length > 0 ? optimisticUserAttachments : undefined,
      };
      setMessages((prev) => [...prev, userMsg]);
    }

    const assistantId = nextId();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      toolCalls: [],
      toolResults: [],
      isStreaming: true,
      activity: [{ phase: 'analyzing', status: 'running', created_at: new Date().toISOString() }],
      context: buildInitialContext(
        text,
        attachmentsToSend.map((a) => ({
          id: a.localId,
          mime_type: a.file.type || 'image/png',
          size: a.file.size,
          kind: 'image',
          preview_url: a.previewUrl,
        })),
      ),
    };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      let attachmentIds: string[] | undefined;

      if (attachmentsToSend.length > 0) {
        // Need a conversation_id before we can upload (attachments are conv-scoped for tenant safety).
        if (!activeConversationId) {
          const conv = await aiConversationsApi.create();
          activeConversationId = conv.id;
          conversationIdRef.current = conv.id;
          setConversationId(conv.id);
        }
        const uploaded = await Promise.all(
          attachmentsToSend.map(async (att) => {
            const result = await aiConversationsApi.uploadInlineAttachment(activeConversationId!, att.file);
            return {
              localId: att.localId,
              serverId: result.id,
              mime_type: result.mime_type,
              size: result.size,
              kind: result.kind,
            };
          }),
        );
        attachmentIds = uploaded.map((u) => u.serverId);

        // Upgrade the optimistic user message to use server-side attachment URLs.
        const serverAttachments: ChatAttachment[] = uploaded.map((u) => ({
          id: u.serverId,
          mime_type: u.mime_type,
          size: u.size,
          kind: u.kind,
          preview_url: aiConversationsApi.buildAttachmentUrl(activeConversationId!, u.serverId),
        }));
        setMessages((prev) =>
          prev.map((m) => (m.id === userMsgId ? { ...m, attachments: serverAttachments } : m)),
        );
        // Pending attachments have been uploaded; clear them so the composer is reset.
        clearPendingAttachments();
      }

      const stream = streamChat({
        message: text,
        conversation_id: activeConversationId || undefined,
        attachment_ids: attachmentIds,
        truncate_from_message_id: truncateFromMessageId,
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        signal: controller.signal,
      });

      for await (const event of stream) {
        if (generation !== streamGenerationRef.current) {
          break;
        }

        switch (event.type) {
          case 'conversation':
            activeConversationId = event.id;
            conversationIdRef.current = event.id;
            setConversationId(event.id);
            break;

          case 'activity':
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      activity: appendActivity(m.activity, {
                        phase: event.phase,
                        status: event.status,
                        tool_name: event.tool_name,
                      }),
                    }
                  : m,
              ),
            );
            break;

          case 'context':
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, context: mergeChatContext(m.context, event.context) }
                  : m,
              ),
            );
            break;

          case 'debug_trace':
            if (!import.meta.env.DEV) {
              break;
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      debugTrace: appendDebugTrace(m.debugTrace, {
                        name: event.name,
                        elapsed_ms: event.elapsed_ms,
                        iteration: event.iteration ?? null,
                        tool_name: event.tool_name ?? null,
                      }),
                    }
                  : m,
              ),
            );
            break;

          case 'text_delta':
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + event.text }
                  : m,
              ),
            );
            break;

          case 'tool_call':
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      toolCalls: [
                        ...(m.toolCalls || []),
                        { id: event.id, name: event.name, arguments: event.arguments },
                      ],
                    }
                  : m,
              ),
            );
            break;

          case 'tool_result':
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      toolResults: [
                        ...(m.toolResults || []),
                        { id: event.id, name: event.name, result: event.result },
                      ],
                    }
                  : m,
              ),
            );
            break;

          case 'preview':
            setPreviews((prev) => upsertPreview(prev, event));
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      previewIds: appendPreviewId(m.previewIds, event.preview_id),
                      context: mergeChatContext(m.context, {
                        previews: [{
                          kind: 'artifact',
                          label: event.target?.ref || event.target?.title || event.summary || event.tool_name,
                          detail: event.tool_name.replace(/_/g, ' '),
                          entity_type: event.target?.entity_type ?? null,
                          ref: event.target?.ref ?? null,
                          status: event.status,
                        }],
                      }),
                    }
                  : m,
              ),
            );
            break;

          case 'preview_result':
            setPreviews((prev) => upsertPreview(prev, event));
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      context: mergeChatContext(m.context, {
                        previews: [{
                          kind: 'artifact',
                          label: event.target?.ref || event.target?.title || event.summary || event.tool_name,
                          detail: event.tool_name.replace(/_/g, ' '),
                          entity_type: event.target?.entity_type ?? null,
                          ref: event.target?.ref ?? null,
                          status: event.status,
                        }],
                      }),
                    }
                  : m,
              ),
            );
            break;

          case 'done':
            if (event.conversation_usage !== undefined) {
              setConversationUsage(normalizeConversationUsage(event.conversation_usage));
            }
            if (event.last_usage !== undefined) {
              setLastRequestUsage(normalizeConversationUsage(event.last_usage));
            }
            if (event.builtin_usage !== undefined) {
              setBuiltinUsage(normalizeBuiltinUsage(event.builtin_usage));
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      isStreaming: false,
                      usage: event.usage,
                      activity: appendActivity(m.activity, { phase: 'finalizing', status: 'completed' }),
                    }
                  : m,
              ),
            );
            break;

          case 'error':
            if (event.conversation_usage !== undefined) {
              setConversationUsage(normalizeConversationUsage(event.conversation_usage));
            } else if (activeConversationId) {
              void refreshConversationUsage(activeConversationId);
            }
            if (event.last_usage !== undefined) {
              setLastRequestUsage(normalizeConversationUsage(event.last_usage));
            }
            if (event.builtin_usage !== undefined) {
              setBuiltinUsage(normalizeBuiltinUsage(event.builtin_usage));
            }
            setError(event.message);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      isStreaming: false,
                      content: m.content || i18n.t('ai:errors.generic'),
                      activity: appendActivity(m.activity, { phase: 'finalizing', status: 'failed' }),
                    }
                  : m,
              ),
            );
            break;
        }
      }

      if (generation !== streamGenerationRef.current) {
        return;
      }
    } catch (err: any) {
      if (generation !== streamGenerationRef.current) {
        return;
      }
      if (err.name === 'AbortError') {
        // Navigation away or manual cancel — mark assistant as done, no error
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  isStreaming: false,
                  activity: appendActivity(m.activity, { phase: 'finalizing', status: 'completed' }),
                }
              : m,
          ),
        );
        if (activeConversationId) {
          void refreshConversationUsage(activeConversationId);
        }
      } else {
        setError(err.message || i18n.t('ai:errors.sendFailed'));
        if (err instanceof ChatStreamRequestError && err.builtin_usage !== undefined) {
          setBuiltinUsage(normalizeBuiltinUsage(err.builtin_usage));
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  isStreaming: false,
                  activity: appendActivity(m.activity, { phase: 'finalizing', status: 'failed' }),
                }
              : m,
          ),
        );
        if (activeConversationId) {
          void refreshConversationUsage(activeConversationId);
        }
      }
    } finally {
      if (generation === streamGenerationRef.current) {
        abortRef.current = null;
        setIsStreaming(false);
      }
      // Refresh messages from the server so optimistic local ids (`local-N-…`) get
      // swapped for real DB UUIDs. That way the next edit/regenerate click can target
      // the right message via truncate_from_message_id.
      const finalConvId = conversationIdRef.current;
      if (finalConvId && generation === streamGenerationRef.current) {
        try {
          const refreshed = await aiConversationsApi.getMessages(finalConvId);
          if (conversationIdRef.current === finalConvId) {
            const rebuilt = rebuildMessagesFromStored(refreshed.messages, finalConvId);
            setMessages((current) => carryAssistantTransient(current, rebuilt));
            setConversationUsage(normalizeConversationUsage(refreshed.conversation_usage));
            setLastRequestUsage(findLastUsage(refreshed.messages));
          }
        } catch {
          // Refresh failure is non-fatal — local state stays as-is, just edit/regen
          // on this just-streamed message will be unavailable until next reload.
        }
      }
    }
  }, [conversationId, isStreaming, pendingAttachments, refreshConversationUsage, clearPendingAttachments]);

  const sendMessage = useCallback(async (text: string) => {
    const truncateFromMessageId = editingMessageId;
    if (truncateFromMessageId) setEditingMessageId(null);
    await runStream(text, { truncateFromMessageId });
  }, [editingMessageId, runStream]);

  const startEdit = useCallback((messageId: string): string | null => {
    const target = messages.find((m) => m.id === messageId && m.role === 'user');
    if (!target) return null;
    setEditingMessageId(messageId);
    return target.content;
  }, [messages]);

  const cancelEdit = useCallback(() => {
    setEditingMessageId(null);
  }, []);

  const regenerate = useCallback(async (assistantMessageId: string) => {
    if (isStreaming) return;
    const idx = messages.findIndex((m) => m.id === assistantMessageId);
    if (idx <= 0) return;
    // Find the most recent user message before this assistant — that's the prompt
    // the LLM should re-answer. The orchestrator deletes the assistant + everything
    // after it, then re-streams against the existing history (no new user persist).
    const previousUser = [...messages].slice(0, idx).reverse().find((m) => m.role === 'user');
    if (!previousUser) return;
    setEditingMessageId(null);
    await runStream('', { truncateFromMessageId: assistantMessageId, isRegenerate: true });
  }, [isStreaming, messages, runStream]);

  const loadConversation = useCallback(async (id: string) => {
    abortActiveStream();
    setError(null);
    conversationIdRef.current = id;
    setConversationId(id);
    setIsStreaming(false);
    clearPendingAttachments();

    const [loadedConversation, loadedPreviews] = await Promise.all([
      aiConversationsApi.getMessages(id),
      aiConversationsApi.getPreviews(id),
    ]);
    const { messages: rawMessages, conversation_usage } = loadedConversation;
    setMessages(rebuildMessagesFromStored(rawMessages, id));
    setPreviews(loadedPreviews);
    setConversationUsage(normalizeConversationUsage(conversation_usage));
    setLastRequestUsage(findLastUsage(rawMessages));
  }, [abortActiveStream, clearPendingAttachments]);

  const newConversation = useCallback(() => {
    abortActiveStream();
    conversationIdRef.current = null;
    setMessages([]);
    setPreviews([]);
    setConversationUsage(null);
    setLastRequestUsage(null);
    setConversationId(null);
    setError(null);
    setIsStreaming(false);
    clearPendingAttachments();
  }, [abortActiveStream, clearPendingAttachments]);

  const cancelStream = useCallback(() => {
    const activeConversationId = conversationIdRef.current;
    abortActiveStream();
    setMessages((prev) =>
      prev.map((m) =>
        m.isStreaming
          ? {
              ...m,
              isStreaming: false,
              activity: appendActivity(m.activity, { phase: 'finalizing', status: 'completed' }),
            }
          : m,
      ),
    );
    setIsStreaming(false);
    if (activeConversationId) {
      void refreshConversationUsage(activeConversationId);
    }
  }, [abortActiveStream, refreshConversationUsage]);

  return useMemo(() => ({
    messages,
    previews,
    conversationUsage,
    lastRequestUsage,
    builtinUsage,
    isStreaming,
    error,
    conversationId,
    pendingAttachments,
    editingMessageId,
    sendMessage,
    loadConversation,
    newConversation,
    cancelStream,
    addPendingFiles,
    removePendingAttachment,
    clearPendingAttachments,
    startEdit,
    cancelEdit,
    regenerate,
  }), [
    messages,
    previews,
    conversationUsage,
    lastRequestUsage,
    builtinUsage,
    isStreaming,
    error,
    conversationId,
    pendingAttachments,
    editingMessageId,
    sendMessage,
    loadConversation,
    newConversation,
    cancelStream,
    addPendingFiles,
    removePendingAttachment,
    clearPendingAttachments,
    startEdit,
    cancelEdit,
    regenerate,
  ]);
}
