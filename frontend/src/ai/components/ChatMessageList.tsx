import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { fieldResetSx } from '../../theme/formSx';
import { useTheme } from '@mui/material/styles';
import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined';
import CheckIcon from '@mui/icons-material/Check';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import { useTranslation } from 'react-i18next';
import { MarkdownContent } from '../../components/MarkdownContent';
import { AiMutationPreview, ChatMessage } from '../aiTypes';
import { getPreviewLabel } from '../utils/previewClassification';
import { getPreviewStatusColorKey, getPreviewStatusDisplay, PreviewStatusDisplay } from '../utils/previewStatus';
import { getDotColor } from '../../utils/statusColors';
import ArtifactPreviewChip from './ArtifactPreviewChip';
import AttachmentImage from './AttachmentImage';
import PreviewCard from './PreviewCard';
import PlaidActivity from './PlaidActivity';

type ChatMessageListProps = {
  messages: ChatMessage[];
  previews: AiMutationPreview[];
  disabled?: boolean;
  onSend: (text: string) => void;
  /** When provided, previews are routed to the artifact panel via this callback. */
  onOpenArtifact?: (previewId: string) => void;
  /** Used to highlight the chip whose artifact is currently visible in the panel. */
  selectedArtifactId?: string | null;
  /** Called when the user clicks the Edit pencil on one of their own messages. */
  onEdit?: (messageId: string) => void;
  /** Submit the new text for the user message currently being edited. */
  onSubmitEdit?: (messageId: string, newText: string) => void;
  /** Called when the user clicks Cancel on an in-progress inline edit. */
  onCancelEdit?: () => void;
  /** Called when the user clicks the Regenerate icon on an assistant reply. */
  onRegenerate?: (messageId: string) => void;
  /** When this id matches a user message, render it inline as an editor. */
  editingMessageId?: string | null;
};

// A message id is editable/regenerable only once we have its DB id (not a local-* placeholder).
// The post-stream refresh in useChat swaps local ids for real UUIDs.
function isPersistedMessage(id: string): boolean {
  return !id.startsWith('local-');
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

function ActionIconButton({
  icon,
  label,
  onClick,
  disabled,
  iconColor,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  iconColor?: string;
}) {
  return (
    <Tooltip title={label} placement="bottom">
      <span>
        <IconButton
          size="small"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          sx={{
            color: iconColor || 'kanap.text.tertiary',
            '&:hover': { color: 'kanap.text.secondary', bgcolor: 'kanap.bg.hover' },
            width: 24,
            height: 24,
          }}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
}

function MessageActions({
  copyText,
  copyLabel,
  copiedLabel,
  onEdit,
  editLabel,
  onRegenerate,
  regenerateLabel,
}: {
  copyText?: string;
  copyLabel: string;
  copiedLabel: string;
  onEdit?: () => void;
  editLabel?: string;
  onRegenerate?: () => void;
  regenerateLabel?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — clipboard may be unavailable in non-secure contexts
    }
  }, [copyText]);

  const hasAnyAction = !!copyText || !!onEdit || !!onRegenerate;
  if (!hasAnyAction) return null;

  return (
    <Stack
      className="kanap-chat-message-actions"
      direction="row"
      spacing={0.25}
      sx={{
        mt: 0.5,
        opacity: 0,
        transition: 'opacity 120ms ease',
        '.kanap-chat-message-row:hover &, .kanap-chat-message-row:focus-within &': {
          opacity: 1,
        },
      }}
    >
      {copyText && (
        <ActionIconButton
          icon={copied
            ? <CheckIcon sx={{ fontSize: 14, color: 'success.main' }} />
            : <ContentCopyIcon sx={{ fontSize: 14 }} />}
          label={copied ? copiedLabel : copyLabel}
          onClick={handleCopy}
        />
      )}
      {onEdit && editLabel && (
        <ActionIconButton
          icon={<EditOutlinedIcon sx={{ fontSize: 14 }} />}
          label={editLabel}
          onClick={onEdit}
        />
      )}
      {onRegenerate && regenerateLabel && (
        <ActionIconButton
          icon={<RefreshOutlinedIcon sx={{ fontSize: 14 }} />}
          label={regenerateLabel}
          onClick={onRegenerate}
        />
      )}
    </Stack>
  );
}

function RoleHeader({ role }: { role: 'user' | 'assistant' }) {
  const { t } = useTranslation(['ai']);
  const label = role === 'user' ? t('messageList.userRole') : t('messageList.assistantRole');

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={0.75}
      sx={{ mb: 0.5, height: 18 }}
    >
      {role === 'assistant' && (
        <Box
          sx={(theme) => ({
            width: 16,
            height: 16,
            borderRadius: '50%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: theme.palette.primary.light,
            color: theme.palette.primary.main,
            flexShrink: 0,
          })}
        >
          <AutoAwesomeOutlinedIcon sx={{ fontSize: 10 }} />
        </Box>
      )}
      <Typography
        component="span"
        sx={{
          fontSize: 12,
          fontWeight: 500,
          color: 'kanap.text.secondary',
          letterSpacing: 0.1,
          lineHeight: 1,
        }}
      >
        {label}
      </Typography>
    </Stack>
  );
}

function MessageRow({
  role,
  children,
  copyText,
  onEdit,
  onRegenerate,
}: {
  role: 'user' | 'assistant';
  children: React.ReactNode;
  copyText?: string;
  onEdit?: () => void;
  onRegenerate?: () => void;
}) {
  const { t } = useTranslation(['ai']);

  return (
    <Box className="kanap-chat-message-row">
      <RoleHeader role={role} />
      <Box>{children}</Box>
      <MessageActions
        copyText={copyText}
        copyLabel={t('messageList.copy')}
        copiedLabel={t('messageList.copied')}
        onEdit={onEdit}
        editLabel={onEdit ? t('messageList.edit') : undefined}
        onRegenerate={onRegenerate}
        regenerateLabel={onRegenerate ? t('messageList.regenerate') : undefined}
      />
    </Box>
  );
}

function MessageAttachments({ message }: { message: ChatMessage }) {
  const attachments = message.attachments || [];
  if (!attachments.length) return null;
  return (
    <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.75 }}>
      {attachments.map((att) => {
        if (!att.preview_url) return null;
        const isLocalObjectUrl = att.preview_url.startsWith('blob:');
        return (
          <AttachmentImage
            key={att.id}
            fetchUrl={isLocalObjectUrl ? '' : att.preview_url}
            localObjectUrl={isLocalObjectUrl ? att.preview_url : null}
          />
        );
      })}
    </Stack>
  );
}

function InlineEditor({
  initialValue,
  onSubmit,
  onCancel,
  saveLabel,
  cancelLabel,
}: {
  initialValue: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  saveLabel: string;
  cancelLabel: string;
}) {
  const [value, setValue] = useState(initialValue);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Auto-focus + caret to end on mount.
    const el = taRef.current;
    if (!el) return;
    el.focus();
    try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* ignore */ }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSubmit(value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const canSave = value.trim().length > 0;

  return (
    <Stack spacing={1} sx={{ width: '100%' }}>
      <TextField
        fullWidth
        multiline
        minRows={2}
        maxRows={20}
        variant="standard"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        inputRef={taRef}
        sx={[
          fieldResetSx,
          (theme) => ({
            '& .MuiInputBase-root': {
              fontSize: 14,
              lineHeight: 1.6,
              color: theme.palette.kanap.text.primary,
            },
          }),
        ]}
      />
      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          onClick={onCancel}
          sx={{ textTransform: 'none', fontSize: 12 }}
        >
          {cancelLabel}
        </Button>
        <Button
          size="small"
          variant="contained"
          onClick={() => onSubmit(value)}
          disabled={!canSave}
          sx={{ textTransform: 'none', fontSize: 12 }}
        >
          {saveLabel}
        </Button>
      </Stack>
    </Stack>
  );
}

function UserMessage({
  message,
  onEdit,
  isEditing,
  onSubmitEdit,
  onCancelEdit,
}: {
  message: ChatMessage;
  onEdit?: () => void;
  isEditing?: boolean;
  onSubmitEdit?: (newText: string) => void;
  onCancelEdit?: () => void;
}) {
  const { t } = useTranslation(['ai']);
  return (
    <MessageRow
      role="user"
      copyText={isEditing ? undefined : message.content}
      onEdit={isEditing ? undefined : onEdit}
    >
      <Box
        sx={(theme) => ({
          bgcolor: theme.palette.mode === 'dark'
            ? 'rgba(255,255,255,0.06)'
            : 'rgba(15,17,23,0.05)',
          borderRadius: '10px',
          px: 1.75,
          py: 1.25,
          fontSize: 14,
          lineHeight: 1.6,
          color: theme.palette.kanap.text.primary,
          ...(isEditing
            ? {
                outline: (theme as any).palette.primary.main
                  ? `1px solid ${(theme as any).palette.primary.main}`
                  : undefined,
                outlineOffset: 0,
              }
            : {}),
          '& p:first-of-type': { mt: 0 },
          '& p:last-of-type': { mb: 0 },
        })}
      >
        {isEditing ? (
          <InlineEditor
            initialValue={message.content}
            onSubmit={(value) => onSubmitEdit?.(value)}
            onCancel={() => onCancelEdit?.()}
            saveLabel={t('messageList.save')}
            cancelLabel={t('messageList.cancel')}
          />
        ) : (
          <>
            {message.content && <MarkdownContent content={message.content} />}
            <MessageAttachments message={message} />
          </>
        )}
      </Box>
    </MessageRow>
  );
}

const PREVIEW_BATCH_BULK_MIN = 2;
const PREVIEW_STATUS_ORDER: PreviewStatusDisplay[] = [
  'pending',
  'approved',
  'rejected',
  'applied',
  'failed',
  'expired',
];

function PreviewStatusSummary({ previews }: { previews: AiMutationPreview[] }) {
  const { t } = useTranslation(['ai']);
  const mode = useTheme().palette.mode;
  const counts = previews.reduce<Record<PreviewStatusDisplay, number>>((acc, preview) => {
    const status = getPreviewStatusDisplay(preview);
    acc[status] += 1;
    return acc;
  }, {
    pending: 0,
    approved: 0,
    rejected: 0,
    applied: 0,
    failed: 0,
    expired: 0,
  });

  const visibleStatuses = PREVIEW_STATUS_ORDER.filter((status) => counts[status] > 0);
  if (visibleStatuses.length === 0) return null;

  return (
    <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
      {visibleStatuses.map((status) => {
        const colorKey = getPreviewStatusColorKey(status);
        return (
          <Stack key={status} direction="row" spacing={0.5} alignItems="center">
            <Box
              component="span"
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: getDotColor(colorKey, mode),
              }}
            />
            <Typography component="span" sx={{ fontSize: 11, color: 'kanap.text.tertiary' }}>
              {counts[status]} {t(`previewStatuses.${status}`)}
            </Typography>
          </Stack>
        );
      })}
    </Stack>
  );
}

function PreviewBatch({
  previews,
  disabled,
  onApprove,
  onReject,
  onApproveMany,
  onOpenArtifact,
  selectedArtifactId,
}: {
  previews: AiMutationPreview[];
  disabled?: boolean;
  onApprove: (previewId: string) => void;
  onReject: (previewId: string) => void;
  onApproveMany: (previewIds: string[]) => void;
  onOpenArtifact?: (previewId: string) => void;
  selectedArtifactId?: string | null;
}) {
  const { t } = useTranslation(['ai']);
  const mode = useTheme().palette.mode;
  const [selectedId, setSelectedId] = useState<string | null>(() => (
    previews.find((preview) => preview.status === 'pending')?.preview_id
    || previews[0]?.preview_id
    || null
  ));
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!selectedId || !previews.some((preview) => preview.preview_id === selectedId)) {
      setSelectedId(previews.find((preview) => preview.status === 'pending')?.preview_id || previews[0]?.preview_id || null);
    }
  }, [previews, selectedId]);

  const selected = previews.find((preview) => preview.preview_id === selectedId) || previews[0];
  const pendingPreviews = previews.filter((preview) => preview.status === 'pending');
  const showBulkAction = pendingPreviews.length >= PREVIEW_BATCH_BULK_MIN && !onOpenArtifact;
  const visibleConfirmPreviews = pendingPreviews.slice(0, 6);
  const remainingConfirmCount = Math.max(0, pendingPreviews.length - visibleConfirmPreviews.length);

  const handleApproveAll = useCallback(() => {
    setConfirmOpen(false);
    onApproveMany(pendingPreviews.map((preview) => preview.preview_id));
  }, [onApproveMany, pendingPreviews]);

  if (!selected) return null;

  return (
    <Box
      sx={(theme) => ({
        border: `1px solid ${theme.palette.kanap.border.default}`,
        borderRadius: 2,
        bgcolor: theme.palette.kanap.bg.drawer,
        overflow: 'hidden',
      })}
    >
      <Stack spacing={1.25} sx={{ p: 1.25 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.secondary' }}>
              {t('previewBatch.title', { count: previews.length })}
            </Typography>
            <PreviewStatusSummary previews={previews} />
          </Stack>
          {showBulkAction && (
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              disabled={disabled}
              onClick={() => setConfirmOpen(true)}
              sx={{ textTransform: 'none', fontSize: 12, flexShrink: 0 }}
            >
              {t('previewBatch.approveAll')}
            </Button>
          )}
        </Stack>

        <Stack
          direction="row"
          spacing={0}
          sx={(theme) => ({
            borderBottom: `1px solid ${theme.palette.kanap.border.soft}`,
            overflowX: 'auto',
            mx: -1.25,
            px: 1.25,
          })}
        >
          {previews.map((preview, index) => {
            const active = preview.preview_id === selected.preview_id;
            const statusDisplay = getPreviewStatusDisplay(preview);
            const colorKey = getPreviewStatusColorKey(statusDisplay);
            return (
              <Box
                key={preview.preview_id}
                component="button"
                type="button"
                onClick={() => setSelectedId(preview.preview_id)}
                sx={(theme) => ({
                  border: 'none',
                  bgcolor: 'transparent',
                  cursor: 'pointer',
                  fontFamily: theme.typography.fontFamily,
                  fontSize: 12,
                  fontWeight: active ? 500 : 400,
                  color: active ? theme.palette.kanap.text.primary : theme.palette.kanap.text.secondary,
                  px: 1,
                  py: 0.8,
                  borderBottom: `2px solid ${active ? theme.palette.primary.main : 'transparent'}`,
                  maxWidth: 180,
                  minWidth: 80,
                  transition: 'color 120ms ease, border-color 120ms ease',
                  '&:hover': { color: theme.palette.kanap.text.primary },
                  '&:focus-visible': {
                    outline: 'none',
                    boxShadow: `inset 0 0 0 2px ${theme.palette.primary.main}`,
                  },
                })}
              >
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                  <Box
                    component="span"
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      bgcolor: getDotColor(colorKey, mode),
                      flexShrink: 0,
                    }}
                  />
                  <Box
                    component="span"
                    sx={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      minWidth: 0,
                    }}
                  >
                    {getPreviewLabel(preview) || `${index + 1}`}
                  </Box>
                </Stack>
              </Box>
            );
          })}
        </Stack>

        {onOpenArtifact ? (
          <ArtifactPreviewChip
            preview={selected}
            active={selectedArtifactId === selected.preview_id}
            onOpen={onOpenArtifact}
          />
        ) : (
          <PreviewCard
            preview={selected}
            disabled={disabled}
            onApprove={onApprove}
            onReject={onReject}
          />
        )}
      </Stack>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontSize: 14, fontWeight: 500, color: 'kanap.text.primary' }}>
          {t('previewBatch.confirmTitle', { count: pendingPreviews.length })}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1}>
            <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary', lineHeight: 1.5 }}>
              {t('previewBatch.confirmBody', { count: pendingPreviews.length })}
            </Typography>
            <Stack spacing={0.5}>
              {visibleConfirmPreviews.map((preview) => (
                <Typography
                  key={preview.preview_id}
                  sx={{
                    fontSize: 12,
                    color: 'kanap.text.secondary',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {getPreviewLabel(preview)}
                </Typography>
              ))}
              {remainingConfirmCount > 0 && (
                <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
                  {t('previewBatch.more', { count: remainingConfirmCount })}
                </Typography>
              )}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            onClick={() => setConfirmOpen(false)}
            sx={{ textTransform: 'none', fontSize: 12 }}
          >
            {t('messageList.cancel')}
          </Button>
          <Button
            size="small"
            variant="contained"
            onClick={handleApproveAll}
            disabled={disabled || pendingPreviews.length === 0}
            sx={{ textTransform: 'none', fontSize: 12 }}
          >
            {t('previewBatch.approveAll')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function AssistantMessage({
  message,
  previousUserMessage,
  previews,
  disabled,
  onSend,
  onOpenArtifact,
  selectedArtifactId,
  onRegenerate,
}: {
  message: ChatMessage;
  previousUserMessage?: ChatMessage | null;
  previews: AiMutationPreview[];
  disabled?: boolean;
  onSend: (text: string) => void;
  onOpenArtifact?: (previewId: string) => void;
  selectedArtifactId?: string | null;
  onRegenerate?: () => void;
}) {
  const toolCalls = message.toolCalls || [];
  const toolResults = message.toolResults || [];

  const previewResults = useMemo(() => (
    Array.from(new Map([
      ...toolResults
      .filter((toolResult) => toolResult.name !== 'preview_execution_result')
      .flatMap((toolResult) => extractMutationPreviews(toolResult.result))
      .map((preview) => previews.find((item) => item.preview_id === preview.preview_id) || preview),
      ...(message.previewIds || [])
        .map((previewId) => previews.find((item) => item.preview_id === previewId))
        .filter((preview): preview is AiMutationPreview => preview != null),
    ].map((preview) => [preview.preview_id, preview])).values())
  ), [message.previewIds, toolResults, previews]);

  const handleApprove = useCallback((previewId: string) => {
    onSend(`[APPROVE:${previewId}]`);
  }, [onSend]);

  const handleReject = useCallback((previewId: string) => {
    onSend(`[REJECT:${previewId}]`);
  }, [onSend]);

  const handleApproveMany = useCallback((previewIds: string[]) => {
    if (previewIds.length === 0) return;
    onSend(`[APPROVE_SELECTED:${previewIds.join(',')}]`);
  }, [onSend]);

  return (
    <MessageRow role="assistant" copyText={message.content} onRegenerate={onRegenerate}>
      <Stack spacing={0.5}>
        <PlaidActivity
          message={message}
          previousUserMessage={previousUserMessage}
          previews={previewResults}
        />

        {message.content && (
          <Box
            sx={{
              fontSize: 14,
              lineHeight: 1.6,
              color: 'kanap.text.primary',
            }}
          >
            <MarkdownContent content={message.content} />
          </Box>
        )}

        {previewResults.length > 1 ? (
          <PreviewBatch
            previews={previewResults}
            disabled={disabled}
            onApprove={handleApprove}
            onReject={handleReject}
            onApproveMany={handleApproveMany}
            onOpenArtifact={onOpenArtifact}
            selectedArtifactId={selectedArtifactId}
          />
        ) : previewResults.map((preview) => {
            if (onOpenArtifact) {
              return (
                <ArtifactPreviewChip
                  key={preview.preview_id}
                  preview={preview}
                  active={selectedArtifactId === preview.preview_id}
                  onOpen={onOpenArtifact}
                />
              );
            }
            return (
              <PreviewCard
                key={preview.preview_id}
                preview={preview}
                disabled={disabled}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            );
          })}
      </Stack>
    </MessageRow>
  );
}

export default function ChatMessageList({
  messages,
  previews,
  disabled,
  onSend,
  onOpenArtifact,
  selectedArtifactId,
  onEdit,
  onSubmitEdit,
  onCancelEdit,
  onRegenerate,
  editingMessageId,
}: ChatMessageListProps) {
  if (!messages.length) return null;

  const rows: React.ReactNode[] = [];
  let previousUserMessage: ChatMessage | null = null;
  for (const msg of messages) {
    if (msg.hidden) {
      if (msg.role === 'user') previousUserMessage = msg;
      continue;
    }
    if (msg.role === 'user') {
      rows.push(
        <UserMessage
          key={msg.id}
          message={msg}
          onEdit={onEdit && isPersistedMessage(msg.id) && !disabled
            ? () => onEdit(msg.id)
            : undefined}
          isEditing={editingMessageId === msg.id}
          onSubmitEdit={onSubmitEdit ? (text) => onSubmitEdit(msg.id, text) : undefined}
          onCancelEdit={onCancelEdit}
        />,
      );
      previousUserMessage = msg;
      continue;
    }
    if (msg.role === 'assistant') {
      rows.push(
        <AssistantMessage
          key={msg.id}
          message={msg}
          previousUserMessage={previousUserMessage}
          previews={previews}
          disabled={disabled}
          onSend={onSend}
          onOpenArtifact={onOpenArtifact}
          selectedArtifactId={selectedArtifactId}
          onRegenerate={onRegenerate && isPersistedMessage(msg.id) && !disabled && !msg.isStreaming
            ? () => onRegenerate(msg.id)
            : undefined}
        />,
      );
    }
  }

  return (
    <Stack spacing={3} sx={{ py: 3, pb: 4 }}>
      {rows}
    </Stack>
  );
}
