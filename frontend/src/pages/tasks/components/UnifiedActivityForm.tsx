import React from 'react';
import { Alert, Box, Button, MenuItem, Select, Slider, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { hasRenderableContent } from '../../../utils/contentToPlainText';
import { getTaskStatusLabel, getTaskStatusOptions } from '../../../utils/portfolioI18n';
import { TASK_STATUS_OPTIONS } from '../task.constants';
import type { TaskStatus } from '../task.constants';
import { taskDetailTokens, taskDetailTypography, STATUS_DOT_COLORS } from '../theme/taskDetailTokens';
import { MONO_FONT_FAMILY } from '../../../config/ThemeContext';
import { StatusDot } from '../../../components/design';
import { inlineControlSx } from '../../../theme/formSx';
import { useTheme } from '@mui/material/styles';

const MarkdownEditor = React.lazy(() => import('../../../components/MarkdownEditor'));

const TIME_LOGGING_EXCLUDED_TYPES = ['contract', 'spend_item', 'capex_item'];

interface UnifiedActivityFormProps {
  taskId: string;
  projectId?: string;
  currentStatus: TaskStatus;
  readOnly?: boolean;
  relatedObjectType?: string;
  totalTimeHours?: number;
  onSuccess: () => void | Promise<void>;
  initialStatus?: TaskStatus | null;
  focusNonce?: number;
  onImageUpload?: (file: File) => Promise<string>;
  onImageUrlImport?: (sourceUrl: string) => Promise<string>;
}

export default function UnifiedActivityForm({
  taskId,
  projectId,
  currentStatus,
  readOnly = false,
  relatedObjectType,
  totalTimeHours = 0,
  onSuccess,
  initialStatus = null,
  focusNonce,
  onImageUpload,
  onImageUrlImport,
}: UnifiedActivityFormProps) {
  const { t } = useTranslation(['portfolio', 'common', 'errors']);
  const queryClient = useQueryClient();
  const [comment, setComment] = React.useState('');
  const [status, setStatus] = React.useState<string>('');
  const [timeHours, setTimeHours] = React.useState<number>(0);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [feedbackLabel, setFeedbackLabel] = React.useState<string | null>(null);
  const initialAppliedRef = React.useRef<string | null>(null);

  const supportsTimeLogging = !TIME_LOGGING_EXCLUDED_TYPES.includes(relatedObjectType || '');
  const isProjectTask = relatedObjectType === 'project';
  const theme = useTheme();
  const mode = theme.palette.mode;
  // Show current status as default (value=''), all others as change options
  const currentStatusLabel = getTaskStatusLabel(t, currentStatus);
  const statusOptions = React.useMemo(
    () => [
      { label: currentStatusLabel, value: '', statusKey: currentStatus },
      ...getTaskStatusOptions(t)
        .filter((option) => option.value !== currentStatus)
        .map((option) => ({ label: option.label, value: option.value, statusKey: option.value })),
    ],
    [currentStatus, currentStatusLabel, t],
  );

  React.useEffect(() => {
    if (!initialStatus) return;
    if (initialStatus === currentStatus) return;
    if (!TASK_STATUS_OPTIONS.some((option) => option.value === initialStatus)) return;
    if (initialAppliedRef.current === initialStatus) return;
    setStatus(initialStatus);
    initialAppliedRef.current = initialStatus;
  }, [initialStatus, currentStatus]);

  const hasComment = hasRenderableContent(comment);
  const hasStatusChange = !!status && status !== currentStatus;
  const hasTime = supportsTimeLogging && timeHours > 0;
  const hasAnyAction = hasComment || hasStatusChange || hasTime;

  const submitLabel = React.useMemo(() => {
    if (!hasAnyAction) return t('portfolio:workspace.task.activity.actions.submit');
    const actions: string[] = [];
    if (hasComment) actions.push(t('portfolio:workspace.task.activity.actions.comment'));
    if (hasStatusChange) {
      actions.push(t('portfolio:workspace.task.activity.actions.setStatus', {
        status: getTaskStatusLabel(t, status),
      }));
    }
    if (hasTime) actions.push(t('portfolio:workspace.task.activity.actions.logHours', { hours: timeHours }));
    if (actions.length === 1) return actions[0];
    if (actions.length === 2) {
      return t('portfolio:workspace.task.activity.actions.combineTwo', {
        first: actions[0],
        second: actions[1],
      });
    }
    return t('portfolio:workspace.task.activity.actions.combineThree', {
      first: actions[0],
      second: actions[1],
      third: actions[2],
    });
  }, [hasAnyAction, hasComment, hasStatusChange, hasTime, status, t, timeHours]);

  // Build success label based on what was submitted
  const getSuccessLabel = React.useCallback(() => {
    if (hasComment && hasTime) return `✓ Submitted & logged ${timeHours}h`;
    if (hasStatusChange && hasTime) return `✓ Updated & logged ${timeHours}h`;
    if (hasTime) return `✓ Logged ${timeHours}h`;
    if (hasStatusChange) return '✓ Updated';
    return '✓ Submitted';
  }, [hasComment, hasStatusChange, hasTime, timeHours]);

  const handleSubmit = async () => {
    if (readOnly || submitting || feedbackLabel) return;
    setError(null);

    if (!hasAnyAction) {
      setError(t('portfolio:workspace.task.activity.messages.emptySubmission'));
      return;
    }

    if (isProjectTask && status === 'done' && totalTimeHours + timeHours <= 0) {
      setError(t('portfolio:workspace.task.activity.messages.doneRequiresTime'));
      return;
    }

    const successLabel = getSuccessLabel();

    const payload: Record<string, unknown> = { type: 'unified' };
    if (hasComment) payload.content = comment.trim();
    if (hasStatusChange) payload.status = status;
    if (hasTime) {
      payload.time_hours = timeHours;
      payload.time_category = 'it';
    }

    const endpoint = projectId
      ? `/portfolio/projects/${projectId}/tasks/${taskId}/activities`
      : `/tasks/${taskId}/activities`;

    setSubmitting(true);
    try {
      await api.post(endpoint, payload);

      // Reflect the new status before the refetch lands so the sidebar/header update in
      // place (no redraw). The workspace task query is keyed by the URL ref (e.g. "T-42"),
      // not the task UUID, so patch every matching task cache entry by id rather than by key.
      if (hasStatusChange) {
        queryClient.setQueriesData({ queryKey: ['tasks'] }, (old: any) => (
          old && !Array.isArray(old) && old.id === taskId ? { ...old, status } : old
        ));
      }

      // Show success feedback
      setFeedbackLabel(successLabel);
      setSubmitting(false);

      // Reset after 1500ms
      setTimeout(() => {
        setComment('');
        setStatus('');
        setTimeHours(0);
        setFeedbackLabel(null);
      }, 1500);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['task-activities', taskId] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['task-time-entries', taskId] }),
        queryClient.invalidateQueries({ queryKey: ['task-time-entries-sum', taskId] }),
        ...(projectId
          ? [
            queryClient.invalidateQueries({ queryKey: ['project-tasks-time-summary', projectId] }),
            queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
          ]
          : []),
      ]);
      await onSuccess();
    } catch (e: any) {
      setError(getApiErrorMessage(
        e,
        t,
        t('portfolio:workspace.task.activity.messages.submitFailed'),
      ));
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ mb: taskDetailTokens.composer.mb }}>
      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 1.5 }}>{error}</Alert>}

      <Box
        sx={(theme) => ({
          bgcolor: theme.palette.kanap.bg.composer,
          border: `1px solid ${theme.palette.kanap.border.default}`,
          borderRadius: taskDetailTokens.composer.borderRadius,
        })}
      >
        {/* Comment input zone — ~5 visible lines */}
        <Box sx={{ p: taskDetailTokens.composer.inputPadding, minHeight: 130 }}>
          <React.Suspense fallback={<Box sx={{ minHeight: 130 }} />}>
            <MarkdownEditor
              value={comment}
              onChange={setComment}
              placeholder={t('portfolio:workspace.task.comments.placeholders.writeComment')}
              minRows={5}
              maxRows={14}
              disabled={submitting || readOnly}
              focusNonce={focusNonce}
              onImageUpload={onImageUpload}
              onImageUrlImport={onImageUrlImport}
              hideToolbarUntilFocus
              delegateWheelUntilFocus
              onModEnter={() => {
                void handleSubmit();
              }}
            />
          </React.Suspense>
        </Box>

        {/* Composer footer: Status (inline) | Time (flex) | Submit */}
        <Box
          sx={(theme) => ({
            display: 'flex',
            alignItems: 'center',
            gap: '20px',
            p: taskDetailTokens.composer.footPadding,
            borderTop: `1px solid ${theme.palette.kanap.border.soft}`,
          })}
        >
          {/* Status — inline label + naked Select, no FormControl */}
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <Typography
              component="span"
              sx={(theme) => ({ ...taskDetailTypography.composerCtrl, color: theme.palette.kanap.text.tertiary, whiteSpace: 'nowrap' })}
            >
              {t('portfolio:workspace.task.sidebar.fields.status')}
            </Typography>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              variant="standard"
              disabled={submitting || readOnly}
              displayEmpty
              renderValue={(val) => {
                const opt = statusOptions.find((o) => o.value === val) || statusOptions[0];
                const dotColor = STATUS_DOT_COLORS[opt.statusKey as keyof typeof STATUS_DOT_COLORS]?.[mode] ?? theme.palette.kanap.text.tertiary;
                return (
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <StatusDot size={7} color={dotColor} />
                    <span>{opt.label}</span>
                  </Box>
                );
              }}
              sx={[
                inlineControlSx,
                (theme) => ({
                  minWidth: 140,
                  fontSize: 12,
                  color: theme.palette.kanap.text.primary,
                  '& .MuiSelect-select': { display: 'flex', alignItems: 'center' },
                  '& .MuiSelect-icon': { color: theme.palette.kanap.text.tertiary, fontSize: 16 },
                }),
              ]}
            >
              {statusOptions.map((opt) => {
                const dotColor = STATUS_DOT_COLORS[opt.statusKey as keyof typeof STATUS_DOT_COLORS]?.[mode] ?? theme.palette.kanap.text.tertiary;
                return (
                  <MenuItem key={opt.value} value={opt.value} sx={{ fontSize: 13, gap: '8px' }}>
                    <StatusDot size={7} color={dotColor} />
                    {opt.label}
                  </MenuItem>
                );
              })}
            </Select>
          </Box>

          {/* Time — inline label + slider flex + value */}
          {supportsTimeLogging && (
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '16px' }}>
              <Typography
                component="span"
                sx={(theme) => ({ ...taskDetailTypography.composerCtrl, color: theme.palette.kanap.text.tertiary, flexShrink: 0, whiteSpace: 'nowrap' })}
              >
                {t('portfolio:workspace.task.sidebar.sections.time')}
              </Typography>
              <Slider
                min={0}
                max={8}
                step={1}
                value={timeHours}
                onChange={(_, value) => setTimeHours(Array.isArray(value) ? value[0] : value)}
                disabled={submitting || readOnly}
                sx={(theme) => ({
                  flex: 1,
                  height: 4,
                  '& .MuiSlider-rail': { bgcolor: theme.palette.kanap.sliderTrack, opacity: 1 },
                  '& .MuiSlider-track': { bgcolor: theme.palette.kanap.teal },
                  '& .MuiSlider-thumb': { bgcolor: theme.palette.kanap.teal, width: 14, height: 14 },
                  color: theme.palette.kanap.teal,
                })}
              />
              <Typography
                component="span"
                sx={{ fontFamily: MONO_FONT_FAMILY, ...taskDetailTypography.composerCtrl, minWidth: 24, flexShrink: 0 }}
              >
                {timeHours}h
              </Typography>
            </Box>
          )}

          {/* Submit */}
          <Button
            variant="contained"
            onMouseDown={(event) => {
              // Keep the focus-within editor toolbar mounted so the footer does not
              // shift before the click is dispatched.
              event.preventDefault();
            }}
            onClick={handleSubmit}
            title={t('portfolio:activity.actions.submitShortcut')}
            disabled={submitting || readOnly || (!hasAnyAction && !feedbackLabel)}
            sx={(theme) => ({
              flexShrink: 0,
              py: '7px',
              px: '18px',
              borderRadius: taskDetailTokens.borderRadius.submit,
              ...taskDetailTypography.composerSubmit,
              bgcolor: theme.palette.kanap.teal,
              color: theme.palette.kanap.tealForeground,
              textTransform: 'none',
              '&:hover': { bgcolor: theme.palette.primary.dark },
              '&.Mui-disabled': { opacity: 0.5 },
              ...(feedbackLabel && { pointerEvents: 'none' }),
            })}
          >
            {feedbackLabel || (submitting ? t('portfolio:workspace.task.activity.actions.submitting') : submitLabel)}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
