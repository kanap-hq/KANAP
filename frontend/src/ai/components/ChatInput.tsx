import React, { useCallback, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { Box, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { fieldResetSx } from '../../theme/formSx';
import SendIcon from '@mui/icons-material/ArrowUpwardRounded';
import StopIcon from '@mui/icons-material/StopRounded';
import AttachFileIcon from '@mui/icons-material/AttachFileOutlined';
import CloseIcon from '@mui/icons-material/CloseRounded';
import { useTranslation } from 'react-i18next';
import { isTableFile, type PendingAttachment } from '../useChat';
import type { EntitySearchResult } from '../aiApi';
import { buildEntityUrl } from '../utils/entityUrls';
import MentionPopover, { MentionPopoverHandle } from './MentionPopover';
import AttachmentFileChip from './AttachmentFileChip';

const ACCEPTED_IMAGE_MIME_PREFIX = 'image/';
const ACCEPTED_IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)$/i;
const ACCEPTED_FILE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  '.xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv',
  'text/csv',
].join(',');

type ChatInputProps = {
  onSend: (text: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  helperText?: React.ReactNode;
  pendingAttachments?: PendingAttachment[];
  onAddFiles?: (files: File[]) => { added: number; rejected: number };
  onRemoveAttachment?: (localId: string) => void;
  attachmentLimit?: number;
  /**
   * When true, the send button morphs into a red Stop button. Clicking it triggers
   * onStop instead of onSend. The textarea remains usable so the user can prepare
   * the next message while cancelling.
   */
  isStreaming?: boolean;
  onStop?: () => void;
};

export type ChatInputHandle = {
  focus: () => void;
  setText: (value: string) => void;
};

function isAcceptableFile(file: File): boolean {
  if (isTableFile(file)) return true;
  if (file.type && file.type.toLowerCase().startsWith(ACCEPTED_IMAGE_MIME_PREFIX)) return true;
  return ACCEPTED_IMAGE_EXT_RE.test(file.name || '');
}

function RemoveAttachmentButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Tooltip title={label} placement="top">
      <IconButton
        size="small"
        aria-label={label}
        onClick={onClick}
        sx={(theme) => ({
          position: 'absolute',
          top: 2,
          right: 2,
          width: 18,
          height: 18,
          bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.55)',
          color: '#fff',
          '&:hover': {
            bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0.7)',
          },
        })}
      >
        <CloseIcon sx={{ fontSize: 12 }} />
      </IconButton>
    </Tooltip>
  );
}

function PendingThumbnail({
  attachment,
  onRemove,
  removeLabel,
}: {
  attachment: PendingAttachment;
  onRemove: (localId: string) => void;
  removeLabel: string;
}) {
  const remove = <RemoveAttachmentButton onClick={() => onRemove(attachment.localId)} label={removeLabel} />;
  if (attachment.kind === 'table') {
    return (
      <AttachmentFileChip name={attachment.file.name} size={attachment.file.size}>
        {remove}
      </AttachmentFileChip>
    );
  }
  return (
    <Box
      sx={(theme) => ({
        position: 'relative',
        width: 56,
        height: 56,
        borderRadius: '8px',
        overflow: 'hidden',
        flexShrink: 0,
        border: `1px solid ${theme.palette.kanap.border.default}`,
        bgcolor: theme.palette.kanap.bg.composer,
      })}
    >
      <Box
        component="img"
        src={attachment.previewUrl}
        alt={attachment.file.name}
        sx={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
      />
      {remove}
    </Box>
  );
}

const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput(
    {
      onSend,
      disabled,
      autoFocus,
      helperText,
      pendingAttachments,
      onAddFiles,
      onRemoveAttachment,
      attachmentLimit,
      isStreaming,
      onStop,
    },
    ref,
  ) {
    const { t } = useTranslation(['ai']);
    const [value, setValue] = useState('');
    const [dragOver, setDragOver] = useState(false);
    const [mentionState, setMentionState] = useState<{ start: number; query: string } | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const mentionPopoverRef = useRef<MentionPopoverHandle>(null);
    // Track entity type + id for every @-mention the user inserted via the picker.
    // The textarea stays readable (`@DOC-152`, `@SAP S/4HANA`, ...); each selected
    // mention is expanded into a markdown link only when the user sends the message.
    const mentionLookupRef = useRef<Map<string, { entity_type: string; id: string; label: string }>>(new Map());

    const updateMentionFromCaret = useCallback((nextValue: string, caret: number) => {
      // Look back from the caret for the most recent `@`. If we find one with no
      // whitespace between it and the caret, and it sits at a word boundary (start
      // of buffer or preceded by whitespace) so we don't snag email-style addresses,
      // promote it to an active mention.
      const before = nextValue.slice(0, caret);
      const atIdx = before.lastIndexOf('@');
      if (atIdx === -1) {
        setMentionState((prev) => (prev ? null : prev));
        return;
      }
      const between = before.slice(atIdx + 1);
      if (/[\s\n]/.test(between)) {
        setMentionState((prev) => (prev ? null : prev));
        return;
      }
      const charBefore = atIdx > 0 ? nextValue[atIdx - 1] : '';
      if (atIdx > 0 && !/\s/.test(charBefore)) {
        setMentionState((prev) => (prev ? null : prev));
        return;
      }
      setMentionState({ start: atIdx, query: between });
    }, []);

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      setText: (next: string) => {
        setValue(next);
        updateMentionFromCaret(next, next.length);
        // Defer focus + caret-to-end so React commits the new value first.
        setTimeout(() => {
          const el = inputRef.current as unknown as HTMLTextAreaElement | null;
          if (!el) return;
          el.focus();
          try { el.setSelectionRange(next.length, next.length); } catch { /* ignore */ }
        }, 0);
      },
    }));

    const hasPending = !!(pendingAttachments && pendingAttachments.length > 0);
    const attachmentsEnabled = !!onAddFiles;
    const attachmentSlotsRemaining = attachmentLimit
      ? attachmentLimit - (pendingAttachments?.length ?? 0)
      : Infinity;

    const expandMentions = useCallback((raw: string): string => {
      const lookup = mentionLookupRef.current;
      if (lookup.size === 0) return raw;
      let expanded = raw;
      const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const entries = Array.from(lookup.entries()).sort((a, b) => b[0].length - a[0].length);
      for (const [visible, meta] of entries) {
        const url = buildEntityUrl(meta.entity_type, meta.id);
        if (!url) continue;
        const pattern = new RegExp(`(?<![\\[\\w-])@${escapeRegExp(visible)}(?=$|\\s|[.,;:!?)]|\\n)`, 'g');
        expanded = expanded.replace(pattern, `[${meta.label}](${url})`);
      }
      return expanded;
    }, []);

    const handleSend = () => {
      const text = value.trim();
      // A file alone is not a message: the server treats an empty text as regenerate.
      if (!text || disabled) return;
      onSend(expandMentions(text));
      setValue('');
      setMentionState(null);
      mentionLookupRef.current.clear();
    };

    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = e.target.value;
      setValue(next);
      const caret = (e.target as HTMLTextAreaElement).selectionStart ?? next.length;
      updateMentionFromCaret(next, caret);
    }, [updateMentionFromCaret]);

    const handleSelectionChange = useCallback(() => {
      const el = inputRef.current as unknown as HTMLTextAreaElement | null;
      if (!el) return;
      const caret = el.selectionStart ?? value.length;
      updateMentionFromCaret(value, caret);
    }, [value, updateMentionFromCaret]);

    const handleMentionSelect = useCallback((item: EntitySearchResult) => {
      if (!mentionState) return;
      const url = buildEntityUrl(item.entity_type, item.id);
      if (!url) {
        setMentionState(null);
        return;
      }
      const visible = (item.ref || item.label || item.id).replace(/\s+/g, ' ').trim();
      const label = (item.ref || item.label || item.id).replace(/\s+/g, ' ').trim();
      const insertion = `@${visible} `;
      mentionLookupRef.current.set(visible, { entity_type: item.entity_type, id: item.id, label });
      const before = value.slice(0, mentionState.start);
      const after = value.slice(mentionState.start + 1 + mentionState.query.length);
      const next = before + insertion + after;
      setValue(next);
      setMentionState(null);
      // Restore caret immediately after the insertion.
      window.setTimeout(() => {
        const el = inputRef.current as unknown as HTMLTextAreaElement | null;
        if (!el) return;
        el.focus();
        const newCaret = before.length + insertion.length;
        try { el.setSelectionRange(newCaret, newCaret); } catch { /* ignore */ }
      }, 0);
    }, [mentionState, value]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (mentionState) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          mentionPopoverRef.current?.moveSelection(1);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          mentionPopoverRef.current?.moveSelection(-1);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          mentionPopoverRef.current?.confirmSelection();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setMentionState(null);
          return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    };

    const acceptFiles = useCallback(
      (files: File[]): boolean => {
        if (!onAddFiles || disabled) return false;
        const accepted = files.filter(isAcceptableFile);
        if (!accepted.length) return false;
        onAddFiles(accepted);
        return true;
      },
      [onAddFiles, disabled],
    );

    const handlePaste = useCallback(
      (e: React.ClipboardEvent) => {
        if (!attachmentsEnabled) return;
        const dt = e.clipboardData;
        if (!dt) return;
        const files: File[] = [];
        for (const item of Array.from(dt.items || [])) {
          if (item.kind === 'file') {
            const f = item.getAsFile();
            if (f) files.push(f);
          }
        }
        if (acceptFiles(files)) {
          e.preventDefault();
        }
      },
      [acceptFiles, attachmentsEnabled],
    );

    const handleDrop = useCallback(
      (e: React.DragEvent) => {
        if (!attachmentsEnabled) return;
        e.preventDefault();
        setDragOver(false);
        const files = Array.from(e.dataTransfer?.files || []);
        if (files.length) acceptFiles(files);
      },
      [acceptFiles, attachmentsEnabled],
    );

    const handleDragOver = useCallback(
      (e: React.DragEvent) => {
        if (!attachmentsEnabled) return;
        const types = Array.from(e.dataTransfer?.types || []);
        if (!types.includes('Files')) return;
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      },
      [attachmentsEnabled, dragOver],
    );

    const handleDragLeave = useCallback(() => {
      if (!attachmentsEnabled) return;
      setDragOver(false);
    }, [attachmentsEnabled]);

    const handleFilePick = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const list = e.target.files;
        if (list && list.length > 0) {
          acceptFiles(Array.from(list));
        }
        // Reset so the same file can be re-selected
        e.target.value = '';
      },
      [acceptFiles],
    );

    const canSend = !disabled && value.trim().length > 0;
    const canAddMore = attachmentsEnabled && !disabled && attachmentSlotsRemaining > 0;

    return (
      <Stack spacing={0.75}>
        <Box
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          sx={(theme) => ({
            border: `1px solid ${dragOver ? theme.palette.primary.main : theme.palette.kanap.border.default}`,
            borderRadius: '10px',
            bgcolor: theme.palette.kanap.bg.composer,
            transition: 'border-color 120ms ease, box-shadow 120ms ease',
            position: 'relative',
            '&:focus-within': {
              borderColor: theme.palette.primary.main,
              boxShadow: `0 0 0 1px ${theme.palette.primary.main}`,
            },
          })}
        >
          {mentionState && (
            <Box
              sx={{
                position: 'absolute',
                bottom: 'calc(100% + 8px)',
                left: 0,
                zIndex: 20,
              }}
            >
              <MentionPopover
                ref={mentionPopoverRef}
                query={mentionState.query}
                onSelect={handleMentionSelect}
                onCancel={() => setMentionState(null)}
              />
            </Box>
          )}
          {hasPending && (
            <Stack
              direction="row"
              spacing={0.75}
              sx={{
                px: 1.5,
                pt: 1.25,
                pb: 0.5,
                overflowX: 'auto',
                '&::-webkit-scrollbar': { height: 4 },
              }}
            >
              {pendingAttachments!.map((att) => (
                <PendingThumbnail
                  key={att.localId}
                  attachment={att}
                  onRemove={(id) => onRemoveAttachment?.(id)}
                  removeLabel={t('input.removeAttachment')}
                />
              ))}
            </Stack>
          )}

          <Box sx={{ px: 1.75, pt: hasPending ? 0.75 : 1.25, pb: 0.5 }}>
            <TextField
              fullWidth
              multiline
              minRows={1}
              maxRows={10}
              variant="standard"
              placeholder={t('input.placeholder')}
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onKeyUp={handleSelectionChange}
              onMouseUp={handleSelectionChange}
              onPaste={handlePaste}
              disabled={disabled}
              inputRef={inputRef}
              autoFocus={autoFocus}
              sx={[
                fieldResetSx,
                (theme) => ({
                  '& .MuiInputBase-root': {
                    fontSize: 14,
                    lineHeight: 1.55,
                    color: theme.palette.kanap.text.primary,
                  },
                  '& textarea::placeholder': {
                    color: theme.palette.kanap.text.tertiary,
                    opacity: 1,
                  },
                }),
              ]}
            />
          </Box>

          <Stack
            direction="row"
            alignItems="center"
            sx={{ px: 1.5, pb: 1, pt: 0.5, minHeight: 36 }}
          >
            {attachmentsEnabled && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  hidden
                  multiple
                  accept={ACCEPTED_FILE_TYPES}
                  onChange={handleFilePick}
                />
                <Tooltip title={t('input.attach')} placement="top">
                  <span>
                    <IconButton
                      size="small"
                      aria-label={t('input.attach')}
                      disabled={!canAddMore}
                      onClick={() => fileInputRef.current?.click()}
                      sx={{
                        width: 28,
                        height: 28,
                        color: 'kanap.text.tertiary',
                        '&:hover': { color: 'kanap.text.secondary', bgcolor: 'kanap.bg.hover' },
                      }}
                    >
                      <AttachFileIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              </>
            )}

            <Typography
              component="span"
              sx={{
                fontSize: 11,
                color: 'kanap.text.tertiary',
                flex: 1,
                ml: attachmentsEnabled ? 0.5 : 0,
                userSelect: 'none',
              }}
            >
              {t('input.hintEnter')} · {t('input.hintShiftEnter')}
            </Typography>

            {isStreaming && onStop ? (
              <IconButton
                onClick={onStop}
                aria-label={t('input.stop')}
                title={t('input.stop')}
                sx={(theme) => ({
                  width: 28,
                  height: 28,
                  borderRadius: '6px',
                  bgcolor: theme.palette.kanap.pill.bg,
                  border: `1px solid ${theme.palette.kanap.pill.border}`,
                  color: theme.palette.kanap.text.secondary,
                  transition: 'background-color 120ms ease, color 120ms ease',
                  '&:hover': {
                    bgcolor: theme.palette.kanap.pill.hoverBg,
                    color: theme.palette.kanap.text.primary,
                  },
                })}
              >
                <StopIcon sx={{ fontSize: 14 }} />
              </IconButton>
            ) : (
              <IconButton
                onClick={handleSend}
                disabled={!canSend}
                aria-label={t('input.send')}
                title={t('input.send')}
                sx={(theme) => ({
                  width: 28,
                  height: 28,
                  borderRadius: '6px',
                  bgcolor: canSend ? theme.palette.primary.main : theme.palette.kanap.pill.bg,
                  color: canSend ? theme.palette.primary.contrastText : theme.palette.kanap.text.tertiary,
                  transition: 'background-color 120ms ease, color 120ms ease',
                  '&:hover': {
                    bgcolor: canSend ? theme.palette.primary.dark : theme.palette.kanap.pill.hoverBg,
                  },
                  '&.Mui-disabled': {
                    bgcolor: theme.palette.kanap.pill.bg,
                    color: theme.palette.kanap.text.tertiary,
                  },
                })}
              >
                <SendIcon sx={{ fontSize: 18 }} />
              </IconButton>
            )}
          </Stack>

          {dragOver && (
            <Box
              sx={(theme) => ({
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                borderRadius: '10px',
                bgcolor: 'rgba(77,184,201,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: theme.palette.primary.main,
                fontSize: 13,
                fontWeight: 500,
              })}
            >
              {t('input.dropHint')}
            </Box>
          )}
        </Box>

        {helperText}
      </Stack>
    );
  },
);

export default ChatInput;
