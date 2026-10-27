import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { useLocale } from '../../../i18n/useLocale';
import { formatShortDate } from '../../../lib/dateFormat';
import LogTimeDialog, { TimeEntryData } from './LogTimeDialog';
import TaskLogTimeDialog, { TaskTimeEntryData } from '../../tasks/components/TaskLogTimeDialog';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { useKanapDialogs } from '../../../components/design';

type TimeSourceType = 'task' | 'project';
type TimeEntryCategory = 'it' | 'business';

interface ContributorTimeEntry {
  id: string;
  source_type: TimeSourceType;
  task_id: string | null;
  project_id: string | null;
  source_label: string;
  category: TimeEntryCategory;
  hours: number;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  logged_by_id: string | null;
  notes: string | null;
  logged_at: string;
}

interface ContributorTimeLogProps {
  contributorId: string;
}

const formatHours = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0h';
  if (!Number.isInteger(value)) return `${value.toFixed(1)}h`;
  const days = Math.floor(value / 8);
  const remainder = value % 8;
  if (days > 0 && remainder > 0) return `${days}d ${remainder}h`;
  if (days > 0) return `${days}d`;
  return `${value}h`;
};

export default function ContributorTimeLog({ contributorId }: ContributorTimeLogProps) {
  const { t } = useTranslation(['portfolio', 'common', 'errors']);
  const dialogs = useKanapDialogs();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { hasLevel, profile } = useAuth();
  const canManageStandaloneTaskEntries = hasLevel('tasks', 'member');
  const canManageProjectTaskEntries = hasLevel('portfolio_projects', 'contributor');
  const canManageProjectEntries = hasLevel('portfolio_projects', 'contributor');
  const isStandaloneTaskAdmin = hasLevel('tasks', 'admin');
  const isProjectTaskAdmin = hasLevel('portfolio_projects', 'admin');
  const isProjectEntryAdmin = hasLevel('portfolio_projects', 'admin');
  const canSeeActions = canManageStandaloneTaskEntries || canManageProjectEntries;

  const [error, setError] = React.useState<string | null>(null);
  const [editingTaskEntry, setEditingTaskEntry] = React.useState<ContributorTimeEntry | null>(null);
  const [editingProjectEntry, setEditingProjectEntry] = React.useState<ContributorTimeEntry | null>(null);

  const { data: entries = [], isLoading, refetch } = useQuery({
    queryKey: ['contributor-time-entries', contributorId],
    queryFn: async () => {
      const res = await api.get(`/portfolio/team-members/${contributorId}/time-entries`);
      return (res.data || []) as ContributorTimeEntry[];
    },
    enabled: !!contributorId,
  });

  const invalidateAfterMutation = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['contributor-time-entries', contributorId] });
    await queryClient.invalidateQueries({ queryKey: ['contributor-time-stats', contributorId] });
    await queryClient.invalidateQueries({ queryKey: ['portfolio-contributors-time-stats'] });
    await queryClient.invalidateQueries({ queryKey: ['portfolio-contributors'] });
  }, [contributorId, queryClient]);

  const canEditEntry = React.useCallback((entry: ContributorTimeEntry): boolean => {
    if (entry.source_type === 'task') {
      if (!entry.task_id) return false;
      const canUseEndpoint = entry.project_id
        ? canManageProjectTaskEntries
        : canManageStandaloneTaskEntries;
      if (!canUseEndpoint) return false;

      const isAdmin = entry.project_id ? isProjectTaskAdmin : isStandaloneTaskAdmin;
      if (isAdmin) return true;

      return entry.user_id === profile?.id;
    }

    if (!entry.project_id || !canManageProjectEntries) return false;
    if (isProjectEntryAdmin) return true;
    return entry.logged_by_id === profile?.id || entry.user_id === profile?.id;
  }, [
    canManageProjectEntries,
    canManageProjectTaskEntries,
    canManageStandaloneTaskEntries,
    isProjectEntryAdmin,
    isProjectTaskAdmin,
    isStandaloneTaskAdmin,
    profile?.id,
  ]);

  const handleDelete = React.useCallback(async (entry: ContributorTimeEntry) => {
    if (!(await dialogs.confirm({
      message: t('portfolio:dialogs.logTime.confirmDelete'),
      confirmLabel: t('common:buttons.delete'),
      intent: 'danger',
    }))) return;

    let endpoint: string | null = null;
    if (entry.source_type === 'task' && entry.task_id) {
      endpoint = entry.project_id
        ? `/portfolio/projects/${entry.project_id}/tasks/${entry.task_id}/time-entries/${entry.id}`
        : `/tasks/${entry.task_id}/time-entries/${entry.id}`;
    } else if (entry.source_type === 'project' && entry.project_id) {
      endpoint = `/portfolio/projects/${entry.project_id}/time-entries/${entry.id}`;
    }

    if (!endpoint) {
      setError(t('portfolio:dialogs.contributorDrilldown.messages.missingIdentifiers'));
      return;
    }

    setError(null);
    try {
      await api.delete(endpoint);
      await refetch();
      await invalidateAfterMutation();
    } catch (e: any) {
      setError(getApiErrorMessage(
        e,
        t,
        t('portfolio:workspace.task.workLog.messages.deleteFailed'),
      ));
    }
  }, [dialogs, invalidateAfterMutation, refetch, t]);

  const openTaskEdit = (entry: ContributorTimeEntry) => {
    if (!entry.task_id) {
      setError(t('portfolio:dialogs.contributorDrilldown.messages.missingTaskId'));
      return;
    }
    setError(null);
    setEditingProjectEntry(null);
    setEditingTaskEntry(entry);
  };

  const openProjectEdit = (entry: ContributorTimeEntry) => {
    if (!entry.project_id) {
      setError(t('portfolio:dialogs.contributorDrilldown.messages.missingProjectId'));
      return;
    }
    setError(null);
    setEditingTaskEntry(null);
    setEditingProjectEntry(entry);
  };

  const taskEditEntry: TaskTimeEntryData | undefined = editingTaskEntry
    ? {
      id: editingTaskEntry.id,
      user_id: editingTaskEntry.user_id,
      hours: Number(editingTaskEntry.hours) || 0,
      notes: editingTaskEntry.notes,
      logged_at: editingTaskEntry.logged_at,
      category: editingTaskEntry.category,
    }
    : undefined;

  const projectEditEntry: TimeEntryData | undefined = editingProjectEntry
    ? {
      id: editingProjectEntry.id,
      category: editingProjectEntry.category,
      user_id: editingProjectEntry.user_id,
      hours: Number(editingProjectEntry.hours) || 0,
      notes: editingProjectEntry.notes,
      logged_at: editingProjectEntry.logged_at,
    }
    : undefined;

  return (
    <Stack spacing={2}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {isLoading && <Typography color="text.secondary">{t('common:status.loading')}</Typography>}

      {!isLoading && entries.length === 0 && (
        <Typography color="text.secondary" variant="body2">
          {t('portfolio:dialogs.contributorDrilldown.states.noTimeEntries')}
        </Typography>
      )}

      {entries.length > 0 && (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('portfolio:dialogs.contributorDrilldown.columns.date')}</TableCell>
                <TableCell>{t('portfolio:dialogs.contributorDrilldown.columns.source')}</TableCell>
                <TableCell>{t('portfolio:dialogs.contributorDrilldown.columns.category')}</TableCell>
                <TableCell align="right">{t('portfolio:dialogs.contributorDrilldown.columns.time')}</TableCell>
                <TableCell>{t('portfolio:dialogs.contributorDrilldown.columns.notes')}</TableCell>
                {canSeeActions && (
                  <TableCell align="right">{t('portfolio:dialogs.contributorDrilldown.columns.actions')}</TableCell>
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry) => {
                const editable = canEditEntry(entry);
                return (
                  <TableRow key={`${entry.source_type}-${entry.id}`} hover>
                    <TableCell>{formatShortDate(entry.logged_at, locale, { year: 'always', empty: '-' })}</TableCell>
                    <TableCell>
                      <Typography
                        variant="body2"
                        sx={{
                          maxWidth: 260,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={entry.source_label}
                      >
                        {entry.source_label}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {t(`portfolio:dialogs.logTime.categories.${entry.category}`)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{formatHours(Number(entry.hours) || 0)}</TableCell>
                    <TableCell>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          maxWidth: 320,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={entry.notes || ''}
                      >
                        {entry.notes || t('portfolio:dialogs.contributorDrilldown.values.emptyNotes')}
                      </Typography>
                    </TableCell>
                    {canSeeActions && (
                      <TableCell align="right">
                        {editable && (
                          <Stack direction="row" justifyContent="flex-end" spacing={0}>
                            <IconButton
                              size="small"
                              onClick={() => (entry.source_type === 'task' ? openTaskEdit(entry) : openProjectEdit(entry))}
                              title={t('portfolio:dialogs.contributorDrilldown.actions.edit')}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={() => handleDelete(entry)}
                              title={t('portfolio:dialogs.contributorDrilldown.actions.delete')}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Stack>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      )}

      <TaskLogTimeDialog
        open={!!editingTaskEntry}
        onClose={() => setEditingTaskEntry(null)}
        taskId={editingTaskEntry?.task_id || ''}
        projectId={editingTaskEntry?.project_id || undefined}
        onSuccess={() => {
          void invalidateAfterMutation();
          void refetch();
        }}
        editEntry={taskEditEntry}
      />

      <LogTimeDialog
        open={!!editingProjectEntry}
        onClose={() => setEditingProjectEntry(null)}
        projectId={editingProjectEntry?.project_id || ''}
        onSuccess={() => {
          void invalidateAfterMutation();
          void refetch();
        }}
        editEntry={projectEditEntry}
      />
    </Stack>
  );
}
