import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { useLocale } from '../../../i18n/useLocale';
import { formatShortDate } from '../../../lib/dateFormat';
import { formatLocaleFigure } from '../../portfolio/figures';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import TaskLogTimeDialog, { TaskTimeEntryData } from './TaskLogTimeDialog';
import { useKanapDialogs } from '../../../components/design';

type TimeEntryCategory = 'it' | 'business';

interface TimeEntry {
  id: string;
  user_id: string | null;
  user_name: string | null;
  hours: number;
  category: TimeEntryCategory;
  notes: string | null;
  logged_at: string;
  logged_by_id: string | null;
  logged_by_name: string | null;
  created_at: string;
}

interface TaskWorkLogProps {
  taskId: string;
  projectId?: string;
  readOnly?: boolean;
  relatedObjectType?: string;
}

// Task types that don't support time logging
const TIME_LOGGING_EXCLUDED_TYPES = ['contract', 'spend_item', 'capex_item'];

export default function TaskWorkLog({ taskId, projectId, readOnly = false, relatedObjectType }: TaskWorkLogProps) {
  const { t } = useTranslation(['portfolio', 'common', 'errors']);
  const dialogs = useKanapDialogs();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { hasLevel, profile } = useAuth();
  const canManageStandaloneEntries = hasLevel('tasks', 'member');
  const canManageProjectEntries = hasLevel('portfolio_projects', 'contributor');
  const isStandaloneAdmin = hasLevel('tasks', 'admin');
  const isProjectAdmin = hasLevel('portfolio_projects', 'admin');
  const canManageForContext = projectId ? canManageProjectEntries : canManageStandaloneEntries;

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editEntry, setEditEntry] = React.useState<TaskTimeEntryData | undefined>(undefined);
  const [error, setError] = React.useState<string | null>(null);

  const { data: entries = [], isLoading, refetch } = useQuery({
    queryKey: ['task-time-entries', taskId],
    queryFn: async () => {
      const endpoint = projectId
        ? `/portfolio/projects/${projectId}/tasks/${taskId}/time-entries`
        : `/tasks/${taskId}/time-entries`;
      const res = await api.get<TimeEntry[]>(endpoint);
      return res.data;
    },
    enabled: !!taskId,
  });

  const { data: totalHours = 0 } = useQuery({
    queryKey: ['task-time-entries-sum', taskId],
    queryFn: async () => {
      const endpoint = projectId
        ? `/portfolio/projects/${projectId}/tasks/${taskId}/time-entries/sum`
        : `/tasks/${taskId}/time-entries/sum`;
      const res = await api.get<{ total: number }>(endpoint);
      return res.data.total;
    },
    enabled: !!taskId,
  });

  const handleDelete = async (entryId: string) => {
    if (!(await dialogs.confirm({
      message: t('portfolio:dialogs.logTime.confirmDelete'),
      confirmLabel: t('common:buttons.delete'),
      intent: 'danger',
    }))) return;
    setError(null);
    try {
      const endpoint = projectId
        ? `/portfolio/projects/${projectId}/tasks/${taskId}/time-entries/${entryId}`
        : `/tasks/${taskId}/time-entries/${entryId}`;
      await api.delete(endpoint);
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['task-time-entries-sum', taskId] });
      queryClient.invalidateQueries({ queryKey: ['task-activities', taskId] });
      // Invalidate project queries so Progress tab updates with new actual effort
      if (projectId) {
        queryClient.invalidateQueries({ queryKey: ['project', projectId] });
        queryClient.invalidateQueries({ queryKey: ['project-tasks-time-summary', projectId] });
      }
    } catch (e: any) {
      setError(getApiErrorMessage(
        e,
        t,
        t('portfolio:workspace.task.workLog.messages.deleteFailed'),
      ));
    }
  };

  const handleEdit = (entry: TimeEntry) => {
    setEditEntry({
      id: entry.id,
      user_id: entry.user_id,
      hours: entry.hours,
      notes: entry.notes,
      logged_at: entry.logged_at,
      category: entry.category || 'it',
    });
    setDialogOpen(true);
  };

  const handleAdd = () => {
    setEditEntry(undefined);
    setDialogOpen(true);
  };

  const canEditEntry = React.useCallback((entry: TimeEntry) => {
    if (!canManageForContext) return false;
    if (projectId ? isProjectAdmin : isStandaloneAdmin) return true;
    return entry.user_id === profile?.id;
  }, [canManageForContext, isProjectAdmin, isStandaloneAdmin, profile?.id, projectId]);

  const handleSuccess = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ['task-time-entries-sum', taskId] });
    queryClient.invalidateQueries({ queryKey: ['tasks', taskId] });
    queryClient.invalidateQueries({ queryKey: ['task-activities', taskId] });
    // Invalidate project queries so Progress tab updates with new actual effort
    if (projectId) {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-tasks-time-summary', projectId] });
    }
  };

  const formatDate = (dateStr: string) => formatShortDate(dateStr, locale, { year: 'always' });

  const formatHours = (hours: number | string | null | undefined) => {
    const h = Number(hours) || 0;
    const days = Math.floor(h / 8);
    const remaining = h % 8;
    if (days > 0 && remaining > 0) {
      return t('portfolio:workspace.task.workLog.duration.daysHours', { days, hours: formatLocaleFigure(remaining, locale, 1) });
    } else if (days > 0) {
      return t('portfolio:workspace.task.workLog.duration.daysOnly', { days });
    }
    return t('portfolio:workspace.task.workLog.duration.hoursOnly', { hours: formatLocaleFigure(h, locale, 1) });
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="subtitle2" color="text.secondary">
          {t('portfolio:workspace.task.workLog.total', {
            time: formatHours(totalHours),
            md: formatLocaleFigure(Number(totalHours) / 8, locale, 1),
          })}
        </Typography>
        {canManageForContext && !readOnly && !TIME_LOGGING_EXCLUDED_TYPES.includes(relatedObjectType || '') && (
          <Button startIcon={<AddIcon />} size="small" onClick={handleAdd}>
            {t('portfolio:dialogs.logTime.actions.logTime')}
          </Button>
        )}
      </Stack>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {isLoading && <Typography color="text.secondary">{t('common:status.loading')}</Typography>}

      {!isLoading && entries.length === 0 && (
        <Typography color="text.secondary" variant="body2">
          {t('portfolio:workspace.task.workLog.messages.empty')}
        </Typography>
      )}

      {entries.length > 0 && (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('portfolio:workspace.task.workLog.columns.date')}</TableCell>
                <TableCell>{t('portfolio:workspace.task.workLog.columns.category')}</TableCell>
                <TableCell>{t('portfolio:workspace.task.workLog.columns.person')}</TableCell>
                <TableCell align="right">{t('portfolio:workspace.task.workLog.columns.time')}</TableCell>
                <TableCell>{t('portfolio:workspace.task.workLog.columns.notes')}</TableCell>
                {canManageForContext && !readOnly && (
                  <TableCell align="right">{t('portfolio:workspace.task.workLog.columns.actions')}</TableCell>
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id} hover>
                  <TableCell>{formatDate(entry.logged_at)}</TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {t(`portfolio:dialogs.logTime.categories.${entry.category}`)}
                    </Typography>
                  </TableCell>
                  <TableCell>{entry.user_name || t('portfolio:workspace.task.workLog.values.unknownPerson')}</TableCell>
                  <TableCell align="right">{formatHours(entry.hours)}</TableCell>
                  <TableCell>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        maxWidth: 200,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={entry.notes || ''}
                    >
                      {entry.notes || t('portfolio:workspace.task.workLog.values.emptyNotes')}
                    </Typography>
                  </TableCell>
                  {canManageForContext && !readOnly && (
                    <TableCell align="right">
                      {canEditEntry(entry) && (
                        <>
                          <IconButton
                            size="small"
                            onClick={() => handleEdit(entry)}
                            title={t('portfolio:workspace.task.workLog.actions.edit')}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            onClick={() => handleDelete(entry.id)}
                            title={t('portfolio:workspace.task.workLog.actions.delete')}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      <TaskLogTimeDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        taskId={taskId}
        projectId={projectId}
        onSuccess={handleSuccess}
        editEntry={editEntry}
      />
    </Stack>
  );
}
