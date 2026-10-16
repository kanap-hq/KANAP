import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Stack,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { contentToPlainText } from '../../../utils/contentToPlainText';
import { useLocale } from '../../../i18n/useLocale';
import { formatShortDate, formatShortDateTime } from '../../../lib/dateFormat';
import { useLocalizedTaskTypes } from '../../../hooks/useLocalizedTaskTypes';
import { getPriorityLabel, getTaskStatusLabel } from '../../../utils/portfolioI18n';
import { formatUserName } from '../../../utils/userDisplay';
import { buildCreatedEntry, isCreatedEntry } from '../../../utils/activityFeed';

interface Activity {
  id: string;
  type: 'comment' | 'change' | 'decision';
  content: string | null;
  context: string | null;
  author_id: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name?: string | null;
  email?: string | null;
  created_at: string;
  changed_fields?: Record<string, [unknown, unknown]>;
}

interface TaskHistoryProps {
  taskId: string;
  projectId?: string;
  /** Creation timestamp of the task, shown above the change feed. */
  createdAt?: string | null;
  /** Creation author (name, or email when the account has no name). */
  createdByName?: string | null;
}

const FIELD_LABEL_KEYS: Record<string, string> = {
  title: 'title',
  description: 'description',
  status: 'status',
  task_type_id: 'taskType',
  priority_level: 'priority',
  creator_id: 'requestor',
  assignee_user_id: 'assignee',
  due_date: 'dueDate',
  start_date: 'startDate',
  labels: 'labels',
  phase_id: 'phase',
  source_id: 'source',
  category_id: 'category',
  stream_id: 'stream',
  company_id: 'company',
  related_to: 'relatedTo',
  converted_to_request: 'convertedToRequest',
  time_hours: 'timeLogged',
};

const humanize = (field: string) =>
  field
    .replace(/\./g, ' ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (s) => s.toUpperCase());

const toCommentPreview = (value: string, maxLen = 150): string => {
  const text = contentToPlainText(value);
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.substring(0, maxLen)}...`;
};

export default function TaskHistory({ taskId, projectId, createdAt, createdByName }: TaskHistoryProps) {
  const { t } = useTranslation('portfolio');
  const locale = useLocale();
  // The history records type names; one still naming a shipped type the tenant kept is shown translated.
  const { labelByName: taskTypeLabels } = useLocalizedTaskTypes();
  const { data: activities = [], isLoading } = useQuery({
    queryKey: ['task-activities', taskId],
    queryFn: async () => {
      try {
        const endpoint = projectId
          ? `/portfolio/projects/${projectId}/tasks/${taskId}/activities`
          : `/tasks/${taskId}/activities`;
        const res = await api.get<Activity[]>(endpoint);
        return res.data;
      } catch {
        return [];
      }
    },
    enabled: !!taskId,
  });

  // Creation is appended last (the feed is newest first) and must stay above the
  // loading return: hooks cannot be called conditionally.
  const entries: Activity[] = React.useMemo(() => {
    const created = buildCreatedEntry(createdAt, createdByName);
    return created ? [...activities, created] : activities;
  }, [activities, createdAt, createdByName]);

  const formatTime = (dateStr: string) => formatShortDateTime(dateStr, locale);

  const formatFieldValue = (field: string, value: unknown): string => {
    if (value === null || value === undefined) return t('workspace.task.history.values.empty');
    if (field === 'status') return getTaskStatusLabel(t, String(value));
    if (field === 'priority_level') return getPriorityLabel(t, String(value));
    if (field === 'task_type_id') return taskTypeLabels[String(value)] ?? String(value);
    if (Array.isArray(value)) {
      if (value.length === 0) return t('workspace.task.history.values.empty');
      return value.map((entry) => String(entry)).join(', ');
    }
    if (field === 'due_date' || field === 'start_date') {
      return value
        ? formatShortDate(String(value), locale, { year: 'always', empty: t('workspace.task.history.values.none') })
        : t('workspace.task.history.values.none');
    }
    return String(value);
  };

  const formatFieldLabel = (field: string): string => {
    const key = FIELD_LABEL_KEYS[field];
    return key ? t(`workspace.task.history.fields.${key}`) : humanize(field);
  };

  const getActivityDescription = (activity: Activity): string => {
    if (activity.type === 'comment') {
      return t('activity.history.actions.addedComment');
    }
    if (activity.type === 'change' && activity.changed_fields) {
      const entries = Object.entries(activity.changed_fields);
      if (entries.length === 1) {
        const [field, [oldVal, newVal]] = entries[0];
        return t('workspace.task.history.actions.changedField', {
          field: formatFieldLabel(field),
          from: formatFieldValue(field, oldVal),
          to: formatFieldValue(field, newVal),
        });
      }
      return t('workspace.task.history.actions.changedMultiple', {
        changes: entries
          .map(([field, [oldVal, newVal]]) =>
            t('workspace.task.history.actions.changedField', {
              field: formatFieldLabel(field),
              from: formatFieldValue(field, oldVal),
              to: formatFieldValue(field, newVal),
            })
          )
          .join(' | '),
      });
    }
    return t('activity.history.actions.recorded');
  };

  const getActivityColor = (type: string): string => {
    switch (type) {
      case 'comment':
        return 'primary.main';
      case 'change':
        return 'grey.400';
      case 'decision':
        return 'warning.main';
      default:
        return 'grey.400';
    }
  };

  if (isLoading) {
    return <Typography color="text.secondary">{t('portfolio:activity.messages.loadingHistory')}</Typography>;
  }

  return (
    <Stack spacing={1}>
      {entries.length === 0 ? (
        <Typography color="text.secondary" variant="body2">
          {t('portfolio:activity.messages.noHistory')}
        </Typography>
      ) : (
        entries.map((activity) => (
        <Box
          key={activity.id}
          sx={{
            p: 1.5,
            bgcolor: 'action.hover',
            borderRadius: 1,
            borderLeft: 3,
            borderColor: getActivityColor(activity.type),
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>
              {isCreatedEntry(activity)
                ? t('portfolio:activity.labels.created')
                : activity.type === 'comment'
                ? t('activity.labels.comment')
                : activity.type === 'change'
                ? t('activity.labels.change')
                : t('activity.labels.decision')}
            </Box>
            {!isCreatedEntry(activity) && (
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {getActivityDescription(activity)}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
              {formatUserName(activity) || t('activity.authorUnknown')} • {formatTime(activity.created_at)}
            </Typography>
          </Stack>
          {activity.type === 'comment' && activity.content && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                mt: 0.5,
                pl: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {toCommentPreview(activity.content, 180)}
            </Typography>
          )}
        </Box>
        ))
      )}
    </Stack>
  );
}
