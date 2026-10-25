import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Box, Button, IconButton, MenuItem, Select, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ClearIcon from '@mui/icons-material/Clear';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import { useLocale } from '../i18n/useLocale';
import { TASK_STATUS_COLORS, TASK_STATUS_LABELS } from '../pages/tasks/task.constants';
import { getApiErrorMessage } from '../utils/apiErrorMessage';
import { getDotColor, PRIORITY_COLORS } from '../utils/statusColors';
import { StatusDot, useKanapDialogs } from './design';
import { useTheme } from '@mui/material/styles';
import {
  applyEntityTaskListFilters,
  filterEntityTasks,
  parseEntityTaskListFilters,
  type EntityTaskListFilters,
} from '../pages/tasks/entityTaskList';
import { drawerMenuItemSx, drawerSelectSx, inlineControlSx } from '../theme/formSx';
import { useEntityTasks, type EntityType } from './entityTasks';

export type { EntityType } from './entityTasks';

type Props = {
  entityType: EntityType;
  entityId: string;
  phases?: Array<{ id: string; name: string }>; // Only used for projects
  disabled?: boolean;
  onTasksChange?: () => void;
};

const STATUS_LABELS = TASK_STATUS_LABELS as Record<string, string>;
const STATUS_COLORS = TASK_STATUS_COLORS as Record<string, 'default' | 'warning' | 'info' | 'secondary' | 'success' | 'error'>;

const PRIORITY_LABELS: Record<string, string> = {
  blocker: 'Blocker',
  high: 'High',
  normal: 'Medium',
  low: 'Low',
  optional: 'Optional',
};

export default function EntityTasksPanel({ entityType, entityId, phases = [], disabled = false, onTasksChange }: Props) {
  const navigate = useNavigate();
  const theme = useTheme();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { t } = useTranslation(['portfolio', 'common', 'errors']);
  const dialogs = useKanapDialogs();
  const locale = useLocale();
  const isProject = entityType === 'project';
  const { tasks, isLoading, refetch, taskPath: buildTaskWorkspacePath, createTask: handleCreateTask } = useEntityTasks(entityType, entityId);

  const listFilters = React.useMemo(
    () => parseEntityTaskListFilters(new URLSearchParams(location.search)),
    [location.search],
  );
  const replaceListFilters = React.useCallback((next: EntityTaskListFilters) => {
    const sp = applyEntityTaskListFilters(new URLSearchParams(location.search), next);
    const qs = sp.toString();
    navigate({ pathname: location.pathname, search: qs ? `?${qs}` : '' }, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const handleDelete = async (taskId: string) => {
    if (!(await dialogs.confirm({
      message: t('portfolio:shared.entityTasksPanel.messages.confirmDelete'),
      confirmLabel: t('common:buttons.delete'),
      intent: 'danger',
    }))) return;
    try {
      await api.delete(`/tasks/bulk`, { data: { ids: [taskId] } });
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      onTasksChange?.();
    } catch (e: any) {
      await dialogs.alert({
        message: getApiErrorMessage(e, t, t('portfolio:shared.entityTasksPanel.messages.deleteFailed')),
        intent: 'danger',
      });
    }
  };

  const getPhaseLabel = (phaseId: string | null) => {
    if (!phaseId) return t('portfolio:shared.entityTasksPanel.phase.projectLevel');
    const phase = phases.find(p => p.id === phaseId);
    return phase?.name || t('portfolio:shared.entityTasksPanel.phase.unknown');
  };

  const filteredTasks = React.useMemo(
    () => filterEntityTasks(tasks, {
      status: listFilters.status,
      phase: isProject ? listFilters.phase : 'all',
    }),
    [isProject, listFilters.phase, listFilters.status, tasks],
  );

  const hasActiveFilters = listFilters.status !== 'all' || (isProject && listFilters.phase !== 'all');

  const clearFilters = () => {
    replaceListFilters({ status: 'all', phase: 'all' });
  };

  const filterSelectSx = [
    drawerSelectSx,
    inlineControlSx,
    { width: 'auto', minWidth: 128 },
  ] as const;

  const title = filteredTasks.length !== tasks.length
    ? t('portfolio:shared.entityTasksPanel.titleFiltered', { count: filteredTasks.length, total: tasks.length })
    : t('portfolio:shared.entityTasksPanel.title', { count: filteredTasks.length });

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
          {title}
        </Typography>
        {hasActiveFilters && (
          <IconButton size="small" onClick={clearFilters} title={t('portfolio:shared.entityTasksPanel.clearFilters')}>
            <ClearIcon fontSize="small" />
          </IconButton>
        )}
        {!disabled && (
          <Button startIcon={<AddIcon />} size="small" onClick={() => handleCreateTask()}>
            {t('portfolio:shared.entityTasksPanel.addTask')}
          </Button>
        )}
      </Stack>

      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ alignItems: 'center' }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <Box sx={(theme) => ({ fontSize: 11, color: theme.palette.kanap.text.tertiary, flexShrink: 0 })}>
            {t('portfolio:shared.entityTasksPanel.filters.status')}
          </Box>
          <Select
            variant="standard"
            value={listFilters.status}
            onChange={(e) => replaceListFilters({ ...listFilters, status: e.target.value as EntityTaskListFilters['status'] })}
            sx={filterSelectSx}
          >
            <MenuItem value="all" sx={drawerMenuItemSx}>{t('portfolio:shared.entityTasksPanel.filters.all')}</MenuItem>
            <MenuItem value="active" sx={drawerMenuItemSx}>{t('portfolio:shared.entityTasksPanel.filters.activeNotDone')}</MenuItem>
            <MenuItem value="open" sx={drawerMenuItemSx}>{t('portfolio:statuses.task.open')}</MenuItem>
            <MenuItem value="in_progress" sx={drawerMenuItemSx}>{t('portfolio:statuses.task.in_progress')}</MenuItem>
            <MenuItem value="pending" sx={drawerMenuItemSx}>{t('portfolio:statuses.task.pending')}</MenuItem>
            <MenuItem value="in_testing" sx={drawerMenuItemSx}>{t('portfolio:statuses.task.in_testing')}</MenuItem>
            <MenuItem value="done" sx={drawerMenuItemSx}>{t('portfolio:statuses.task.done')}</MenuItem>
            <MenuItem value="cancelled" sx={drawerMenuItemSx}>{t('portfolio:statuses.task.cancelled')}</MenuItem>
          </Select>
        </Box>
        {isProject && phases.length > 0 && (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <Box sx={(theme) => ({ fontSize: 11, color: theme.palette.kanap.text.tertiary, flexShrink: 0 })}>
              {t('portfolio:shared.entityTasksPanel.filters.phase')}
            </Box>
            <Select
              variant="standard"
              value={listFilters.phase}
              onChange={(e) => replaceListFilters({ ...listFilters, phase: e.target.value })}
              sx={filterSelectSx}
            >
              <MenuItem value="all" sx={drawerMenuItemSx}>{t('portfolio:shared.entityTasksPanel.filters.allPhases')}</MenuItem>
              <MenuItem value="project-level" sx={drawerMenuItemSx}>{t('portfolio:shared.entityTasksPanel.filters.projectLevel')}</MenuItem>
              {phases.map((p) => (
                <MenuItem key={p.id} value={p.id} sx={drawerMenuItemSx}>{p.name}</MenuItem>
              ))}
            </Select>
          </Box>
        )}
      </Stack>

      {isLoading && <Typography color="text.secondary">{t('portfolio:shared.entityTasksPanel.states.loading')}</Typography>}

      {!isLoading && tasks.length === 0 && (
        <Typography color="text.secondary">{t('portfolio:shared.entityTasksPanel.states.empty')}</Typography>
      )}

      {!isLoading && tasks.length > 0 && filteredTasks.length === 0 && (
        <Typography color="text.secondary">{t('portfolio:shared.entityTasksPanel.states.noMatches')}</Typography>
      )}

      {filteredTasks.length > 0 && (
        <Table size="small" sx={{ '& .MuiTableCell-root': { whiteSpace: 'nowrap' } }}>
          <TableHead>
            <TableRow>
              <TableCell>{t('portfolio:shared.entityTasksPanel.table.title')}</TableCell>
              <TableCell>{t('portfolio:shared.entityTasksPanel.table.status')}</TableCell>
              <TableCell>{t('portfolio:shared.entityTasksPanel.table.priority')}</TableCell>
              {isProject && <TableCell>{t('portfolio:shared.entityTasksPanel.table.phase')}</TableCell>}
              <TableCell>{t('portfolio:shared.entityTasksPanel.table.dueDate')}</TableCell>
              <TableCell align="right">{t('portfolio:shared.entityTasksPanel.table.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredTasks.map((task) => (
              <TableRow key={task.id} hover>
                <TableCell>
                  <Typography
                    variant="body2"
                    component="a"
                    noWrap
                    title={task.title}
                    onClick={() => navigate(buildTaskWorkspacePath(task.id))}
                    sx={{
                      display: 'block',
                      maxWidth: 360,
                      cursor: 'pointer',
                      color: 'text.primary',
                      textDecoration: 'none',
                      '&:hover': { textDecoration: 'underline' },
                    }}
                  >
                    {task.title}
                  </Typography>
                </TableCell>
                <TableCell>
                  {(() => {
                    const colorKey = STATUS_COLORS[task.status] || 'default';
                    return (
                      <Box component="span" sx={(theme) => ({
                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                        fontSize: '0.8125rem', fontWeight: 500,
                        color: getDotColor(colorKey, theme.palette.mode),
                      })}>
                        <StatusDot color={getDotColor(colorKey, theme.palette.mode)} />
                        {t(`portfolio:statuses.task.${task.status}`, { defaultValue: STATUS_LABELS[task.status] || task.status })}
                      </Box>
                    );
                  })()}
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    {t(`portfolio:priority.${task.priority_level}`, { defaultValue: PRIORITY_LABELS[task.priority_level] || task.priority_level })}
                  </Typography>
                </TableCell>
                {isProject && (
                  <TableCell>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      noWrap
                      title={getPhaseLabel(task.phase_id)}
                      sx={{ display: 'block', maxWidth: 260 }}
                    >
                      {getPhaseLabel(task.phase_id)}
                    </Typography>
                  </TableCell>
                )}
                <TableCell>
                  {task.due_date ? new Date(task.due_date).toLocaleDateString(locale) : '-'}
                </TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    title={t('portfolio:shared.entityTasksPanel.actions.openTask')}
                    onClick={() => navigate(buildTaskWorkspacePath(task.id))}
                  >
                    <OpenInNewIcon fontSize="small" />
                  </IconButton>
                  {!disabled && (
                    <IconButton
                      size="small"
                      title={t('portfolio:shared.entityTasksPanel.actions.deleteTask')}
                      onClick={() => handleDelete(task.id)}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Stack>
  );
}
