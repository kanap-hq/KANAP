import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Box, IconButton, Link, Stack, Typography } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { useFeatures } from '../../config/FeaturesContext';
import { useChat, MAX_PENDING_ATTACHMENTS } from '../../ai/useChat';
import { useStickToBottom } from '../../ai/useStickToBottom';
import { aiConversationsApi } from '../../ai/aiApi';
import { AiMutationPreview, ChatConversation, ChatMessage } from '../../ai/aiTypes';
import ArtifactPanel from '../../ai/components/ArtifactPanel';
import BuiltinUsageIndicator from '../../ai/components/BuiltinUsageIndicator';
import ChatMessageList from '../../ai/components/ChatMessageList';
import ChatInput, { ChatInputHandle } from '../../ai/components/ChatInput';
import ChatConversationList from '../../ai/components/ChatConversationList';
import ChatEmptyState from '../../ai/components/ChatEmptyState';
import TokenUsageBar from '../../ai/components/TokenUsageBar';

const SIDEBAR_WIDTH = 260;
const CONTENT_MAX_WIDTH = 760;

const ARTIFACT_OPEN_STORAGE_KEY = 'kanap.ai.artifactPanelOpen';

type PreviewGroup = {
  messageId: string;
  previewIds: string[];
};

function uniquePreviewIds(ids: string[] | undefined): string[] {
  const result: string[] = [];
  for (const id of ids || []) {
    if (id && !result.includes(id)) {
      result.push(id);
    }
  }
  return result;
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

function previewIdsForMessage(message: ChatMessage): string[] {
  const ids: string[] = [];
  const append = (previewId: string | null | undefined) => {
    if (previewId && !ids.includes(previewId)) {
      ids.push(previewId);
    }
  };

  for (const toolResult of message.toolResults || []) {
    if (toolResult.name === 'preview_execution_result') {
      continue;
    }
    for (const preview of extractMutationPreviews(toolResult.result)) {
      append(preview.preview_id);
    }
  }
  for (const previewId of message.previewIds || []) {
    append(previewId);
  }
  return ids;
}

function buildPreviewGroups(messages: ChatMessage[]): PreviewGroup[] {
  return messages
    .filter((message) => message.role === 'assistant')
    .map((message) => ({
      messageId: message.id,
      previewIds: uniquePreviewIds(previewIdsForMessage(message)),
    }))
    .filter((group) => group.previewIds.length > 0);
}

function pickPreviewForGroup(previews: AiMutationPreview[], previewIds: string[]): AiMutationPreview | null {
  const idSet = new Set(previewIds);
  const groupPreviews = previews.filter((preview) => idSet.has(preview.preview_id));
  return groupPreviews.find((preview) => preview.status === 'pending') || groupPreviews[groupPreviews.length - 1] || null;
}

export default function AiWorkspacePage() {
  const { config } = useFeatures();
  const queryClient = useQueryClient();
  const { t } = useTranslation(['ai']);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const chat = useChat();
  const inputRef = useRef<ChatInputHandle>(null);
  const builtinLimitReached = (chat.builtinUsage?.limit ?? 0) > 0
    && (chat.builtinUsage?.count ?? 0) >= (chat.builtinUsage?.limit ?? 0);

  const isEmpty = chat.messages.length === 0;
  const userMessageCount = chat.messages.filter((message) => message.role === 'user').length;
  const { scrollRef, contentRef } = useStickToBottom(`${chat.conversationId ?? ''}:${userMessageCount}`);

  const allPreviews = chat.previews;
  const previewGroups = useMemo(() => buildPreviewGroups(chat.messages), [chat.messages]);
  const latestPreviewGroup = previewGroups[previewGroups.length - 1] ?? null;
  const [activeArtifactPreviewIds, setActiveArtifactPreviewIds] = useState<string[]>([]);
  const seenArtifactGroupKeyRef = useRef<string>('');
  const latestPreviewGroupKey = latestPreviewGroup?.previewIds.join('\u0000') ?? '';
  const hasUnseenLatestPreviewGroup = Boolean(
    latestPreviewGroup
      && latestPreviewGroupKey
      && seenArtifactGroupKeyRef.current !== latestPreviewGroupKey,
  );
  const artifactPreviewIds = hasUnseenLatestPreviewGroup && latestPreviewGroup
    ? latestPreviewGroup.previewIds
    : (activeArtifactPreviewIds.length > 0
      ? activeArtifactPreviewIds
      : latestPreviewGroup?.previewIds ?? []);
  const artifactPreviews = useMemo(() => {
    const idSet = new Set(artifactPreviewIds);
    return allPreviews.filter((preview) => idSet.has(preview.preview_id));
  }, [allPreviews, artifactPreviewIds]);

  const [artifactPanelOpen, setArtifactPanelOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(ARTIFACT_OPEN_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);

  useEffect(() => {
    setActiveArtifactPreviewIds([]);
    setSelectedArtifactId(null);
    seenArtifactGroupKeyRef.current = '';
  }, [chat.conversationId]);

  // Auto-open the latest preview group. The panel shows the active group instead
  // of accumulating every historical preview tab in the conversation.
  useEffect(() => {
    if (!latestPreviewGroup) return;
    if (!latestPreviewGroupKey || seenArtifactGroupKeyRef.current === latestPreviewGroupKey) return;
    seenArtifactGroupKeyRef.current = latestPreviewGroupKey;

    const trigger = pickPreviewForGroup(allPreviews, latestPreviewGroup.previewIds);
    setActiveArtifactPreviewIds(latestPreviewGroup.previewIds);
    if (trigger) {
      setSelectedArtifactId(trigger.preview_id);
    }
    setArtifactPanelOpen(true);
  }, [allPreviews, latestPreviewGroup, latestPreviewGroupKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ARTIFACT_OPEN_STORAGE_KEY, artifactPanelOpen ? '1' : '0');
    } catch {
      // ignore quota / privacy errors
    }
  }, [artifactPanelOpen]);

  const toggleArtifactPanel = useCallback(() => {
    setArtifactPanelOpen((prev) => !prev);
  }, []);

  const openArtifactPanel = useCallback((previewId: string) => {
    const group = previewGroups.find((item) => item.previewIds.includes(previewId));
    setActiveArtifactPreviewIds(group?.previewIds ?? [previewId]);
    setSelectedArtifactId(previewId);
    setArtifactPanelOpen(true);
  }, [previewGroups]);

  const handleArtifactApprove = useCallback((previewId: string) => {
    void chat.sendMessage(`[APPROVE:${previewId}]`);
  }, [chat.sendMessage]);

  const handleArtifactReject = useCallback((previewId: string) => {
    void chat.sendMessage(`[REJECT:${previewId}]`);
  }, [chat.sendMessage]);

  const handleArtifactApproveMany = useCallback((previewIds: string[]) => {
    if (previewIds.length === 0) return;
    void chat.sendMessage(`[APPROVE_SELECTED:${previewIds.join(',')}]`);
  }, [chat.sendMessage]);

  // Auto-focus input when AI finishes responding
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (wasStreamingRef.current && !chat.isStreaming) {
      inputRef.current?.focus();
    }
    wasStreamingRef.current = chat.isStreaming;
  }, [chat.isStreaming]);

  const handleSelect = useCallback(
    (id: string) => {
      chat.loadConversation(id);
    },
    [chat.loadConversation],
  );

  const handleNew = useCallback(() => {
    chat.newConversation();
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [chat.newConversation]);

  const handleSend = useCallback(
    async (text: string) => {
      await chat.sendMessage(text);
      queryClient.invalidateQueries({ queryKey: ['ai-conversations'] });
    },
    [chat.sendMessage, queryClient],
  );

  const handleSuggestion = useCallback(
    (text: string) => {
      if (text.includes('@')) {
        inputRef.current?.setText(text);
        return;
      }
      void handleSend(text);
    },
    [handleSend],
  );

  const handleArchive = useCallback(
    async (id: string) => {
      if (id === chat.conversationId) {
        chat.newConversation();
      }
      queryClient.setQueryData<ChatConversation[]>(
        ['ai-conversations'],
        (old) => old?.filter((c) => c.id !== id),
      );
      try {
        await aiConversationsApi.archive(id);
      } catch {
        queryClient.invalidateQueries({ queryKey: ['ai-conversations'] });
      }
    },
    [chat.conversationId, chat.newConversation, queryClient],
  );

  const handleEditMessage = useCallback((messageId: string) => {
    // Inline edit: just flip the message into edit mode. The bubble renders an inline
    // editor; we do NOT prefill the composer below (that flow surprised users in early
    // testing because the highlighted message looked editable even though it wasn't).
    chat.startEdit(messageId);
  }, [chat.startEdit]);

  const handleSubmitEdit = useCallback((_messageId: string, newText: string) => {
    // sendMessage reads chat.editingMessageId set by startEdit and forwards it to the
    // backend as truncate_from_message_id, so this single call covers the whole edit.
    void chat.sendMessage(newText);
  }, [chat.sendMessage]);

  const handleCancelEdit = useCallback(() => {
    chat.cancelEdit();
  }, [chat.cancelEdit]);

  const handleRegenerateMessage = useCallback((messageId: string) => {
    void chat.regenerate(messageId);
  }, [chat.regenerate]);

  if (!config.features.aiChat) {
    return (
      <>
        <PageHeader title={t('workspace.title')} />
        <Alert severity="warning" sx={{ maxWidth: 600 }}>
          {t('workspace.messages.disabled')}
        </Alert>
      </>
    );
  }

  const limitReachedHelper = builtinLimitReached ? (
    <Typography variant="body2" color="error.main" sx={{ fontSize: 12 }}>
      {t('usageIndicator.limitReachedCta')}{' '}
      {config.features.aiSettings ? (
        <Link component={RouterLink} to="/admin/ai" underline="hover">
          {t('usageIndicator.openSettings')}
        </Link>
      ) : null}
    </Typography>
  ) : null;

  const composer = (
    <ChatInput
      ref={inputRef}
      onSend={handleSend}
      disabled={chat.isStreaming || builtinLimitReached}
      autoFocus={isEmpty}
      helperText={limitReachedHelper}
      pendingAttachments={chat.pendingAttachments}
      onAddFiles={chat.addPendingFiles}
      onRemoveAttachment={chat.removePendingAttachment}
      attachmentLimit={MAX_PENDING_ATTACHMENTS}
      isStreaming={chat.isStreaming}
      onStop={chat.cancelStream}
    />
  );

  return (
    <Box sx={{ display: 'flex', height: 'calc(100vh - 96px)', overflow: 'hidden' }}>
      {/* Sidebar */}
      {sidebarOpen && (
        <Box
          sx={(theme) => ({
            width: SIDEBAR_WIDTH,
            minWidth: SIDEBAR_WIDTH,
            borderRight: `1px solid ${theme.palette.kanap.border.default}`,
            bgcolor: theme.palette.kanap.bg.page,
            display: 'flex',
            flexDirection: 'column',
          })}
        >
          <ChatConversationList
            activeId={chat.conversationId}
            onSelect={handleSelect}
            onNew={handleNew}
            onArchive={handleArchive}
          />
        </Box>
      )}

      {/* Main chat area */}
      <Stack sx={{ flex: 1, minWidth: 0, height: '100%', position: 'relative' }}>
        {/* Toolbar */}
        <Stack direction="row" alignItems="center" sx={{ px: 1, py: 0.5, flexShrink: 0 }}>
          <IconButton
            size="small"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            sx={{ color: 'kanap.text.secondary' }}
          >
            <MenuIcon />
          </IconButton>
        </Stack>

        {isEmpty ? (
          /* ── Welcome screen: centered empty state + input ── */
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'auto',
              px: 3,
              pb: 6,
            }}
          >
            <Box sx={{ width: '100%', maxWidth: CONTENT_MAX_WIDTH }}>
              <Stack spacing={4}>
                <ChatEmptyState
                  onSuggestion={handleSuggestion}
                  disabled={chat.isStreaming || builtinLimitReached}
                />
                <Stack spacing={1}>
                  <BuiltinUsageIndicator usage={chat.builtinUsage} />
                  {composer}
                </Stack>
              </Stack>
            </Box>
          </Box>
        ) : (
          /* ── Active conversation: messages + bottom input ── */
          <>
            <Box
              ref={scrollRef}
              sx={{
                flex: 1,
                overflow: 'auto',
                minHeight: 0,
                '&::-webkit-scrollbar': { width: 4 },
                '&::-webkit-scrollbar-thumb': { bgcolor: 'action.disabled', borderRadius: 2 },
                '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
                scrollbarWidth: 'thin',
                scrollbarColor: 'auto transparent',
              }}
            >
              <Box ref={contentRef} sx={{ width: '100%', maxWidth: CONTENT_MAX_WIDTH, mx: 'auto', px: 3 }}>
                <ChatMessageList
                  messages={chat.messages}
                  previews={chat.previews}
                  disabled={chat.isStreaming}
                  onSend={handleSend}
                  onOpenArtifact={openArtifactPanel}
                  selectedArtifactId={artifactPanelOpen ? selectedArtifactId : null}
                  onEdit={handleEditMessage}
                  onSubmitEdit={handleSubmitEdit}
                  onCancelEdit={handleCancelEdit}
                  onRegenerate={handleRegenerateMessage}
                  editingMessageId={chat.editingMessageId}
                />
              </Box>
            </Box>

            {chat.error && (
              <Box sx={{ width: '100%', maxWidth: CONTENT_MAX_WIDTH, mx: 'auto', px: 3, flexShrink: 0 }}>
                <Alert severity="error" sx={{ mb: 1 }} onClose={() => {}}>
                  {chat.error}
                </Alert>
              </Box>
            )}

            <Box
              sx={{
                flexShrink: 0,
                pt: 1,
                pb: 2,
              }}
            >
              <Box sx={{ width: '100%', maxWidth: CONTENT_MAX_WIDTH, mx: 'auto', px: 3 }}>
                <Stack spacing={0.75}>
                  <Stack direction="row" justifyContent="flex-end" alignItems="center" sx={{ minHeight: 18 }}>
                    <BuiltinUsageIndicator usage={chat.builtinUsage} />
                  </Stack>
                  {composer}
                  {chat.conversationUsage && (
                    <Box sx={{ pt: 0.25 }}>
                      <TokenUsageBar usage={chat.conversationUsage} lastRequestUsage={chat.lastRequestUsage} />
                    </Box>
                  )}
                </Stack>
              </Box>
            </Box>
          </>
        )}
      </Stack>

      <ArtifactPanel
        previews={artifactPreviews}
        selectedId={selectedArtifactId}
        open={artifactPanelOpen}
        disabled={chat.isStreaming || builtinLimitReached}
        onToggle={toggleArtifactPanel}
        onSelect={openArtifactPanel}
        onApprove={handleArtifactApprove}
        onReject={handleArtifactReject}
        onApproveMany={handleArtifactApproveMany}
      />
    </Box>
  );
}
