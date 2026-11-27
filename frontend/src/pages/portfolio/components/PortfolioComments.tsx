import React from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import { useTranslation } from 'react-i18next';
import { MarkdownContent } from '../../../components/MarkdownContent';
import { useLocale } from '../../../i18n/useLocale';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { selectKeepsFocus } from '../../../theme/formSx';
import { formatUserName, getUserInitials } from '../../../utils/userDisplay';
import {
  formatRelativeTime,
  getDecisionOutcomeLabel,
  getDecisionOutcomeOptions,
} from '../../../utils/portfolioI18n';

const MarkdownEditor = React.lazy(() => import('../../../components/MarkdownEditor'));

const DECISION_OUTCOME_COLORS: Record<string, 'success' | 'error' | 'warning' | 'info'> = {
  go: 'success',
  no_go: 'error',
  defer: 'warning',
  need_info: 'info',
  analysis_complete: 'info',
};

interface Activity {
  id: string;
  type: 'comment' | 'change' | 'decision';
  content: string | null;
  context: string | null;
  decision_outcome: string | null;
  changed_fields?: Record<string, [unknown, unknown]>;
  author_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email?: string | null;
  created_at: string;
  updated_at?: string | null;
}

interface PortfolioCommentsProps {
  entityType: 'request' | 'project';
  entityId: string;
  activities: Activity[];
  currentStatus: string;
  allowedTransitions: string[];
  statusOptions: Array<{ value: string; label: string }>;
  onAddComment: (data: {
    content: string;
    context: string | null;
    is_decision: boolean;
    decision_outcome?: string;
    new_status?: string;
  }) => Promise<void>;
  onUpdateComment?: (activityId: string, content: string) => Promise<void>;
  currentUserId?: string | null;
  readOnly?: boolean;
  onImageUpload?: (file: File, sourceField: string) => Promise<string>;
  onImageUrlImport?: (sourceUrl: string, sourceField: string) => Promise<string>;
}

export default function PortfolioComments({
  entityType,
  entityId,
  activities,
  currentStatus,
  allowedTransitions,
  statusOptions,
  onAddComment,
  onUpdateComment,
  currentUserId,
  readOnly = false,
  onImageUpload,
  onImageUrlImport,
}: PortfolioCommentsProps) {
  const { t } = useTranslation(['portfolio', 'common', 'errors']);
  const locale = useLocale();
  const [commentContent, setCommentContent] = React.useState('');
  const [commentContext, setCommentContext] = React.useState('');
  const [isDecision, setIsDecision] = React.useState(false);
  const [decisionOutcome, setDecisionOutcome] = React.useState('');
  const [newStatus, setNewStatus] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [editorKey, setEditorKey] = React.useState(0);

  // Editing state
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editContent, setEditContent] = React.useState('');
  const [editSubmitting, setEditSubmitting] = React.useState(false);

  // Filter to only show comments and decisions
  const discussions = activities.filter(
    (a) => a.type === 'comment' || a.type === 'decision'
  );
  const decisionOutcomes = React.useMemo(() => getDecisionOutcomeOptions(t), [t]);

  const handleSubmit = async () => {
    // Validation
    if (isDecision) {
      if (!commentContext.trim()) return;
      if (!decisionOutcome) return;
    } else {
      if (!commentContent.trim()) return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onAddComment({
        content: commentContent.trim(),
        context: commentContext.trim() || null,
        is_decision: isDecision,
        decision_outcome: isDecision ? decisionOutcome : undefined,
        new_status: isDecision && newStatus ? newStatus : undefined,
      });
      // Reset form
      setCommentContent('');
      setCommentContext('');
      setIsDecision(false);
      setDecisionOutcome('');
      setNewStatus('');
      setEditorKey((k) => k + 1); // Force editor remount with empty content
    } catch (e: any) {
      setError(getApiErrorMessage(
        e,
        t,
        t('portfolio:activity.messages.addCommentFailed'),
      ));
    } finally {
      setSubmitting(false);
    }
  };

  const handleImageUpload = async (file: File): Promise<string> => {
    if (!onImageUpload) {
      throw new Error(t('portfolio:activity.messages.imageUploadNotConfigured'));
    }
    return onImageUpload(file, 'content');
  };

  const handleImageUrlImport = async (sourceUrl: string): Promise<string> => {
    if (!onImageUrlImport) {
      throw new Error(t('portfolio:activity.messages.imageImportNotConfigured'));
    }
    return onImageUrlImport(sourceUrl, 'content');
  };

  const handleStartEdit = (activity: Activity) => {
    setEditingId(activity.id);
    setEditContent(activity.content || '');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditContent('');
  };

  const handleSaveEdit = async () => {
    if (!editingId || !onUpdateComment) return;
    if (!editContent.trim()) return;

    setEditSubmitting(true);
    setError(null);
    try {
      await onUpdateComment(editingId, editContent.trim());
      setEditingId(null);
      setEditContent('');
    } catch (e: any) {
      setError(getApiErrorMessage(
        e,
        t,
        t('portfolio:activity.messages.updateCommentFailed'),
      ));
    } finally {
      setEditSubmitting(false);
    }
  };

  const canEditComment = (activity: Activity) => {
    return (
      activity.type === 'comment' &&
      currentUserId &&
      activity.author_id === currentUserId &&
      onUpdateComment
    );
  };

  const authorLabel = (activity: Activity) =>
    formatUserName(activity) || t('portfolio:activity.authorUnknown');

  return (
    <Stack spacing={3}>
      {/* Add Comment / Decision Form */}
      {!readOnly && (
        <Box
          sx={{
            p: 2,
            bgcolor: 'background.paper',
            border: 1,
            borderColor: isDecision ? 'warning.main' : 'divider',
            borderRadius: 1,
          }}
        >
          <Stack spacing={2}>
            {/* Row 1: Formal decision checkbox + Context field */}
            <Stack direction="row" spacing={2} alignItems="center">
              <FormControlLabel
                control={
                  <Checkbox
                    checked={isDecision}
                    onChange={(e) => {
                      setIsDecision(e.target.checked);
                      if (!e.target.checked) {
                        setDecisionOutcome('');
                        setNewStatus('');
                      }
                    }}
                  />
                }
                label={t('portfolio:activity.form.formalDecision')}
                sx={{ mr: 0, flexShrink: 0 }}
              />
              <TextField
                label={isDecision
                  ? t('portfolio:activity.form.fields.contextMeeting')
                  : t('portfolio:activity.form.fields.contextOptional')}
                value={commentContext}
                onChange={(e) => setCommentContext(e.target.value)}
                fullWidth
                size="small"
                required={isDecision}
                placeholder={
                  isDecision
                    ? t('portfolio:activity.form.placeholders.decisionContext')
                    : t('portfolio:activity.form.placeholders.commentContext')
                }
              />
            </Stack>

            {/* Row 2: Decision fields (only when Formal decision is checked) */}
            {isDecision && (
              <Stack direction="row" spacing={2}>
                <FormControl fullWidth size="small" required>
                  <InputLabel>{t('portfolio:activity.form.fields.decisionOutcome')}</InputLabel>
                  <Select
                    value={decisionOutcome}
                    label={t('portfolio:activity.form.fields.decisionOutcome')}
                    onChange={(e) => setDecisionOutcome(e.target.value)}
                  >
                    {decisionOutcomes.map((opt) => (
                      <MenuItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl fullWidth size="small">
                  <InputLabel>{t('portfolio:activity.form.fields.changeStatus')}</InputLabel>
                  <Select
                    value={newStatus}
                    label={t('portfolio:activity.form.fields.changeStatus')}
                    onChange={(e) => setNewStatus(e.target.value)}
                    MenuProps={selectKeepsFocus.MenuProps}
                  >
                    <MenuItem value="">{t('portfolio:activity.form.noChange')}</MenuItem>
                    {allowedTransitions.map((status) => {
                      const opt = statusOptions.find((s) => s.value === status);
                      return (
                        <MenuItem key={status} value={status}>
                          {opt?.label || status}
                        </MenuItem>
                      );
                    })}
                  </Select>
                </FormControl>
              </Stack>
            )}

            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                {isDecision
                  ? t('portfolio:activity.form.fields.rationaleNotes')
                  : t('portfolio:activity.form.fields.comment')}
              </Typography>
              <React.Suspense fallback={<Box sx={{ minHeight: 8 * 24, border: 1, borderColor: 'divider', borderRadius: 1 }} />}>
                <MarkdownEditor
                  key={editorKey}
                  value={commentContent}
                  onChange={setCommentContent}
                  placeholder={
                    isDecision
                      ? t('portfolio:activity.form.placeholders.decisionNotes')
                      : t('portfolio:activity.form.placeholders.comment')
                  }
                  minRows={8}
                  maxRows={14}
                  disabled={submitting}
                  hideToolbarUntilFocus
                  onModSave={() => { void handleSubmit(); }}
                  onImageUpload={onImageUpload ? handleImageUpload : undefined}
                  onImageUrlImport={onImageUrlImport ? handleImageUrlImport : undefined}
                />
              </React.Suspense>
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="contained"
                color={isDecision ? 'warning' : 'primary'}
                onClick={handleSubmit}
                disabled={
                  submitting ||
                  (isDecision
                    ? !commentContext.trim() || !decisionOutcome
                    : !commentContent.trim())
                }
                sx={(theme) => ({
                  bgcolor: isDecision ? theme.palette.kanap.orange : theme.palette.kanap.teal,
                  color: theme.palette.kanap.tealForeground,
                  borderRadius: '6px',
                  fontSize: 12,
                  fontWeight: 500,
                  px: '18px',
                  py: '7px',
                  minHeight: 0,
                  boxShadow: 'none',
                  '&:hover': {
                    bgcolor: isDecision ? theme.palette.warning.dark : theme.palette.kanap.teal,
                    boxShadow: 'none',
                  },
                  '&.Mui-disabled': {
                    pointerEvents: 'none',
                  },
                })}
              >
                {submitting
                  ? t('portfolio:activity.actions.adding')
                  : isDecision
                  ? t('portfolio:activity.actions.addDecision')
                  : t('portfolio:activity.actions.addComment')}
              </Button>
            </Box>
          </Stack>
        </Box>
      )}

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Comments and Decisions List */}
      {discussions.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('portfolio:activity.messages.noCommentsOrDecisions')}
          {!readOnly && ` ${t('portfolio:activity.messages.beFirstToAdd')}`}
        </Typography>
      ) : (
        <Stack spacing={2}>
          {discussions.map((a) => (
            <Box
              key={a.id}
              sx={{
                p: 2,
                bgcolor: 'background.paper',
                borderRadius: 1,
                borderLeft: 4,
                borderColor:
                  a.type === 'decision' ? 'warning.main' : 'primary.main',
                boxShadow: 1,
              }}
            >
              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                <Avatar
                  sx={{
                    width: 32,
                    height: 32,
                    fontSize: '0.875rem',
                    bgcolor:
                      a.type === 'decision' ? 'warning.main' : 'primary.main',
                  }}
                >
                  {getUserInitials(a)}
                </Avatar>
                <Box sx={{ flex: 1 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    sx={{ mb: 1 }}
                  >
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>
                      {a.type === 'decision'
                        ? t('portfolio:activity.labels.decision')
                        : t('portfolio:activity.labels.comment')}
                    </Typography>
                    {a.type === 'decision' && a.decision_outcome && (
                      <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>
                        {getDecisionOutcomeLabel(t, a.decision_outcome)}
                      </Typography>
                    )}
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {authorLabel(a)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatRelativeTime(t, a.created_at, locale)}
                    </Typography>
                    {a.updated_at && (
                      <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                        {t('portfolio:activity.labels.edited')}
                      </Typography>
                    )}
                    <Box sx={{ flex: 1 }} />
                    {canEditComment(a) && editingId !== a.id && (
                      <Tooltip title={t('portfolio:activity.actions.editComment')}>
                        <IconButton
                          size="small"
                          onClick={() => handleStartEdit(a)}
                          sx={{ ml: 'auto' }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                  {a.context && (
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 500,
                        color:
                          a.type === 'decision'
                            ? 'warning.dark'
                            : 'primary.dark',
                        mb: 0.5,
                      }}
                    >
                      {a.context}
                    </Typography>
                  )}
                  {editingId === a.id ? (
                    <Box sx={{ mt: 1 }}>
                      <React.Suspense fallback={<Box sx={{ minHeight: 6 * 24, border: 1, borderColor: 'divider', borderRadius: 1 }} />}>
                        <MarkdownEditor
                          value={editContent}
                          onChange={setEditContent}
                          placeholder={t('portfolio:activity.placeholders.editComment')}
                          minRows={6}
                          maxRows={12}
                          disabled={editSubmitting}
                          onModSave={() => { void handleSaveEdit(); }}
                          onImageUpload={onImageUpload ? handleImageUpload : undefined}
                          onImageUrlImport={onImageUrlImport ? handleImageUrlImport : undefined}
                        />
                      </React.Suspense>
                      <Stack direction="row" spacing={1} sx={{ mt: 1, justifyContent: 'flex-end' }}>
                        <Button
                          size="small"
                          onClick={handleCancelEdit}
                          disabled={editSubmitting}
                        >
                          {t('common:buttons.cancel')}
                        </Button>
                        <Button
                          size="small"
                          variant="contained"
                          onClick={handleSaveEdit}
                          disabled={editSubmitting || !editContent.trim()}
                        >
                          {editSubmitting ? t('common:status.saving') : t('common:buttons.save')}
                        </Button>
                      </Stack>
                    </Box>
                  ) : a.content ? (
                    <Box sx={{ mt: 0.5 }}>
                      <MarkdownContent content={a.content} variant="compact" />
                    </Box>
                  ) : null}
                  {a.type === 'decision' && a.changed_fields?.status && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 1 }}
                    >
                      {t('portfolio:activity.labels.statusChange', {
                        from: statusOptions.find((option) => option.value === String(a.changed_fields?.status?.[0]))?.label || String(a.changed_fields.status[0]),
                        to: statusOptions.find((option) => option.value === String(a.changed_fields?.status?.[1]))?.label || String(a.changed_fields.status[1]),
                      })}
                    </Typography>
                  )}
                </Box>
              </Stack>
            </Box>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
