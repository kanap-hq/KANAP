import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, Button, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { MONO_FONT_FAMILY } from '../config/ThemeContext';
import { useAuth } from '../auth/AuthContext';
import { useLocale } from '../i18n/useLocale';
import { formatShortDate } from '../lib/dateFormat';
import { TASK_STATUS_COLORS, TASK_STATUS_LABELS } from '../pages/tasks/task.constants';
import { formatItemRef } from '../utils/item-ref';
import { getDotColor } from '../utils/statusColors';
import { formatUserName } from '../utils/userDisplay';
import { fetchLookupByIds, lookupIdsKey } from '../hooks/useLookupPicker';
import { USERS_LOOKUP_ENDPOINT, type UserOption } from './fields/userLookup';
import { StatusDot } from './design';
import { CLOSED_TASK_STATUSES, useEntityTasks, type EntityTask, type EntityType } from './entityTasks';
import RelationsSectionTitle from '../pages/portfolio/components/RelationsSectionTitle';

type Props = {
  entityType: EntityType;
  entityId: string;
  disabled?: boolean;
};

const STATUS_LABELS = TASK_STATUS_LABELS as Record<string, string>;
const STATUS_COLORS = TASK_STATUS_COLORS as Record<string, string>;

export const denseTableSx = {
  width: '100%',
  borderCollapse: 'collapse',
  '& th': {
    fontSize: 12,
    fontWeight: 500,
    color: 'kanap.text.tertiary',
    textAlign: 'left',
    py: '6px',
    px: '12px',
    borderBottom: '1px solid',
    borderColor: 'kanap.border.default',
    whiteSpace: 'nowrap',
  },
  '& td': {
    fontSize: 13,
    color: 'kanap.text.primary',
    py: '6px',
    px: '12px',
    borderBottom: '1px solid',
    borderColor: 'kanap.border.soft',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  },
  '& tbody tr.clickable': { cursor: 'pointer' },
  '& tbody tr.clickable:hover td': { bgcolor: 'kanap.bg.hover' },
  '& tbody tr:last-of-type td': { borderBottom: 0 },
} as const;

export const denseTableFrameSx = {
  overflowX: 'auto',
  border: '1px solid',
  borderColor: 'kanap.border.default',
  borderRadius: '8px',
  bgcolor: 'kanap.bg.primary',
} as const;

const linkButtonSx = { p: 0, minWidth: 0, fontSize: 12, alignSelf: 'flex-start' } as const;

/**
 * The open tasks of an entity, compact enough for a workspace overview: reference, title,
 * assignee, due date and status; "New task"; the tasks done or cancelled on demand.
 */
export default function EntityTasksSection({ entityType, entityId, disabled = false }: Props) {
  const { t } = useTranslation(['portfolio', 'common']);
  const { hasLevel } = useAuth();
  const theme = useTheme();
  const locale = useLocale();
  const { tasks, isLoading, openTask, createTask } = useEntityTasks(entityType, entityId);
  const canCreateTask = hasLevel('tasks', 'member');
  const [showClosed, setShowClosed] = React.useState(false);

  const open = tasks.filter((task) => !CLOSED_TASK_STATUSES.has(task.status));
  const closed = tasks.filter((task) => CLOSED_TASK_STATUSES.has(task.status));
  const shown = showClosed ? [...open, ...closed] : open;

  const assigneeIds = React.useMemo(
    () => Array.from(new Set(tasks.map((task) => task.assignee_user_id).filter((id): id is string => !!id))).sort(),
    [tasks],
  );
  const { data: assignees = [] } = useQuery({
    queryKey: lookupIdsKey(USERS_LOOKUP_ENDPOINT, assigneeIds),
    queryFn: ({ signal }) => fetchLookupByIds<UserOption>(USERS_LOOKUP_ENDPOINT, assigneeIds, signal),
    enabled: assigneeIds.length > 0,
    staleTime: 5 * 60_000,
  });
  const assigneeName = (task: EntityTask) => {
    if (!task.assignee_user_id) return '';
    const user = assignees.find((row) => row.id === task.assignee_user_id);
    return user ? formatUserName(user) || user.email || '' : '';
  };

  return (
    <Stack spacing={1.25}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
        <RelationsSectionTitle>{t('portfolio:shared.entityTasksSection.title')}</RelationsSectionTitle>
        {!disabled && canCreateTask && (
          <Button variant="action" onClick={() => createTask()}>
            {t('portfolio:shared.entityTasksSection.newTask')}
          </Button>
        )}
      </Stack>

      {!isLoading && shown.length === 0 && (
        <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>
          {tasks.length === 0 ? t('portfolio:shared.entityTasksSection.empty') : t('portfolio:shared.entityTasksSection.noOpenTasks')}
        </Typography>
      )}

      {shown.length > 0 && (
        <Box sx={denseTableFrameSx}>
          <Box component="table" sx={denseTableSx}>
            <thead>
              <tr>
                <th>{t('portfolio:shared.entityTasksSection.columns.ref')}</th>
                <th>{t('portfolio:shared.entityTasksSection.columns.task')}</th>
                <th>{t('portfolio:shared.entityTasksSection.columns.assignee')}</th>
                <th>{t('portfolio:shared.entityTasksSection.columns.dueDate')}</th>
                <th>{t('portfolio:shared.entityTasksSection.columns.status')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((task) => {
                const closedTask = CLOSED_TASK_STATUSES.has(task.status);
                const dot = getDotColor(STATUS_COLORS[task.status] || 'default', theme.palette.mode);
                return (
                  <tr
                    key={task.id}
                    className="clickable"
                    tabIndex={0}
                    onClick={() => openTask(task.id)}
                    onKeyDown={(event) => { if (event.key === 'Enter') openTask(task.id); }}
                  >
                    <Box component="td" sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: '12px !important', color: 'kanap.text.tertiary !important' }}>
                      {task.item_number ? formatItemRef('task', task.item_number) : ''}
                    </Box>
                    <Box component="td" sx={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', color: closedTask ? 'kanap.text.tertiary !important' : undefined }} title={task.title}>
                      {task.title}
                    </Box>
                    <td>{assigneeName(task)}</td>
                    <td>{formatShortDate(task.due_date, locale)}</td>
                    <td>
                      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <StatusDot color={dot} />
                        {t(`portfolio:statuses.task.${task.status}`, { defaultValue: STATUS_LABELS[task.status] || task.status })}
                      </Box>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Box>
        </Box>
      )}

      {closed.length > 0 && (
        <Button sx={linkButtonSx} onClick={() => setShowClosed((value) => !value)}>
          {showClosed
            ? t('portfolio:shared.entityTasksSection.hideClosed')
            : t('portfolio:shared.entityTasksSection.showClosed', { count: closed.length })}
        </Button>
      )}
    </Stack>
  );
}
