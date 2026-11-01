import React, { useState } from 'react';
import {
  Alert,
  Box,
  CircularProgress,
  Drawer,
  IconButton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  Pagination,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { getDotColor } from '../../utils/statusColors';
import { StatusDot as StatusDotCircle } from '../../components/design';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import HistoryIcon from '@mui/icons-material/History';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNotify } from '../../components/notify/NotifyProvider';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';
import { useAuth } from '../../auth/AuthContext';
import { useFeatures } from '../../config/FeaturesContext';
import { useLocale } from '../../i18n/useLocale';
import ForbiddenPage from '../ForbiddenPage';
import {
  fetchScheduledTasks,
  updateScheduledTask,
  triggerTask,
  fetchTaskRuns,
  type ScheduledTask,
  type ScheduledTaskRun,
} from '../../services/adminScheduledTasks';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

// Human-readable cron descriptions for common patterns
const CRON_LABELS: Record<string, string> = {
  '0 * * * *': 'scheduledTasks.cronLabels.everyHour',
  '*/5 * * * *': 'scheduledTasks.cronLabels.everyFiveMinutes',
  '*/15 * * * *': 'scheduledTasks.cronLabels.everyFifteenMinutes',
  '*/30 * * * *': 'scheduledTasks.cronLabels.everyThirtyMinutes',
  '0 0 * * *': 'scheduledTasks.cronLabels.dailyMidnight',
  '0 3 * * *': 'scheduledTasks.cronLabels.daily3am',
  '0 8 * * *': 'scheduledTasks.cronLabels.daily8am',
  '0 4 * * 0': 'scheduledTasks.cronLabels.sundays4am',
  '0 0 * * 0': 'scheduledTasks.cronLabels.sundaysMidnight',
  '0 0 1 * *': 'scheduledTasks.cronLabels.firstOfMonthMidnight',
};

function humanCron(expr: string, t: (key: string) => string): string {
  const labelKey = CRON_LABELS[expr];
  return labelKey ? t(labelKey) : expr;
}

function StatusDot({ status, t, mode }: { status: string | null; t: (key: string, options?: Record<string, unknown>) => string; mode: 'light' | 'dark' }) {
  const colorKey = !status ? 'default' : status === 'success' ? 'success' : status === 'failure' ? 'error' : status === 'running' ? 'info' : 'default';
  const label = !status ? t('scheduledTasks.statuses.neverRun') : status === 'success' ? t('scheduledTasks.statuses.success') : status === 'failure' ? t('scheduledTasks.statuses.failure') : status === 'running' ? t('scheduledTasks.statuses.running') : status;
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      <StatusDotCircle color={getDotColor(colorKey, mode)} />
      <Typography variant="body2" sx={{ color: getDotColor(colorKey, mode), fontWeight: 500, fontSize: '0.8125rem' }}>{label}</Typography>
    </Box>
  );
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatDate(locale: string, iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString(locale);
}

export default function ScheduledTasksPage() {
  const { claims } = useAuth();
  const { config } = useFeatures();
  const isSingleTenant = config.deploymentMode === 'single-tenant';

  const canAccess = claims?.isPlatformAdmin || (isSingleTenant && claims?.isGlobalAdmin);
  if (!canAccess) return <ForbiddenPage />;

  return <ScheduledTasksContent />;
}

function ScheduledTasksContent() {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale();
  const { mode } = useTheme().palette;
  const queryClient = useQueryClient();
  const notify = useNotify();
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [editingCron, setEditingCron] = useState<string | null>(null);
  const [cronDraft, setCronDraft] = useState('');
  const [drawerTask, setDrawerTask] = useState<string | null>(null);
  const [runsPage, setRunsPage] = useState(1);

  const tasksQuery = useQuery({ queryKey: ['scheduled-tasks'], queryFn: fetchScheduledTasks, refetchInterval: 15_000 });

  const runsQuery = useQuery({
    queryKey: ['scheduled-task-runs', drawerTask, runsPage],
    queryFn: () => fetchTaskRuns(drawerTask!, runsPage),
    enabled: !!drawerTask,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) => updateScheduledTask(name, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] }),
  });

  const cronMutation = useMutation({
    mutationFn: ({ name, cron_expression }: { name: string; cron_expression: string }) =>
      updateScheduledTask(name, { cron_expression }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] });
      setEditingCron(null);
      setScheduleError(null);
    },
    onError: (err: any) => setScheduleError(getApiErrorMessage(err, t, t('scheduledTasks.messages.invalidCronExpression'))),
  });

  const triggerMutation = useMutation({
    mutationFn: (name: string) => triggerTask(name),
    onSuccess: (_, name) => {
      notify({ message: t('scheduledTasks.messages.taskTriggered', { name }) });
      queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] });
    },
  });

  if (tasksQuery.isLoading) {
    return (
      <Box>
        <PageHeader title={t('scheduledTasks.title')} />
        <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
      </Box>
    );
  }

  if (tasksQuery.isError) {
    return (
      <Box>
        <PageHeader title={t('scheduledTasks.title')} />
        <Alert severity="error" sx={{ m: 2 }}>{t('scheduledTasks.messages.loadFailed')}</Alert>
      </Box>
    );
  }

  const tasks = tasksQuery.data ?? [];

  return (
    <Box>
      <PageHeader title={t('scheduledTasks.title')} />
      {scheduleError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setScheduleError(null)}>{scheduleError}</Alert>
      )}
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('scheduledTasks.columns.name')}</TableCell>
              <TableCell>{t('scheduledTasks.columns.description')}</TableCell>
              <TableCell>{t('scheduledTasks.columns.schedule')}</TableCell>
              <TableCell align="center">{t('scheduledTasks.columns.enabled')}</TableCell>
              <TableCell>{t('scheduledTasks.columns.lastRun')}</TableCell>
              <TableCell>{t('scheduledTasks.columns.duration')}</TableCell>
              <TableCell>{t('scheduledTasks.columns.status')}</TableCell>
              <TableCell align="right">{t('scheduledTasks.columns.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {tasks.map((task: ScheduledTask) => (
              <TableRow key={task.name}>
                <TableCell>
                  <Typography variant="body2" fontWeight={500}>{task.name}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 300 }}>
                    {task.description || t('scheduledTasks.shared.empty')}
                  </Typography>
                </TableCell>
                <TableCell>
                  {editingCron === task.name ? (
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <TextField
                        size="small"
                        value={cronDraft}
                        onChange={(e) => setCronDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') cronMutation.mutate({ name: task.name, cron_expression: cronDraft });
                          if (e.key === 'Escape') setEditingCron(null);
                        }}
                        sx={{ width: 150 }}
                        autoFocus
                      />
                      <IconButton
                        size="small"
                        onClick={() => cronMutation.mutate({ name: task.name, cron_expression: cronDraft })}
                        disabled={cronMutation.isPending}
                      >
                        <CheckIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => setEditingCron(null)}>
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  ) : (
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <Tooltip title={task.cron_expression}>
                        <Typography variant="body2">{humanCron(task.cron_expression, t)}</Typography>
                      </Tooltip>
                      <IconButton
                        size="small"
                        onClick={() => { setEditingCron(task.name); setCronDraft(task.cron_expression); }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  )}
                </TableCell>
                <TableCell align="center">
                  <Switch
                    checked={task.enabled}
                    size="small"
                    onChange={() => toggleMutation.mutate({ name: task.name, enabled: !task.enabled })}
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{formatDate(locale, task.last_run_at)}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{formatDuration(task.last_duration_ms)}</Typography>
                </TableCell>
                <TableCell><StatusDot status={task.last_status} t={t} mode={mode} /></TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                    <Tooltip title={t('scheduledTasks.actions.runNow')}>
                      <IconButton
                        size="small"
                        onClick={() => triggerMutation.mutate(task.name)}
                        disabled={triggerMutation.isPending}
                      >
                        <PlayArrowIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('scheduledTasks.actions.viewHistory')}>
                      <IconButton
                        size="small"
                        onClick={() => { setDrawerTask(task.name); setRunsPage(1); }}
                      >
                        <HistoryIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
            {tasks.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Typography color="text.secondary" py={4}>{t('scheduledTasks.empty')}</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Run History Drawer */}
      <Drawer anchor="right" open={!!drawerTask} onClose={() => setDrawerTask(null)} PaperProps={{ sx: { width: 600, maxWidth: '90vw' } }}>
        <Box p={2}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6">{t('scheduledTasks.runHistory.title', { name: drawerTask })}</Typography>
            <IconButton onClick={() => setDrawerTask(null)}><CloseIcon /></IconButton>
          </Stack>

          {runsQuery.isLoading ? (
            <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>
          ) : runsQuery.isError ? (
            <Alert severity="error">{t('scheduledTasks.messages.loadRunsFailed')}</Alert>
          ) : (
            <>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('scheduledTasks.runHistory.columns.started')}</TableCell>
                    <TableCell>{t('scheduledTasks.runHistory.columns.status')}</TableCell>
                    <TableCell>{t('scheduledTasks.runHistory.columns.duration')}</TableCell>
                    <TableCell>{t('scheduledTasks.runHistory.columns.details')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(runsQuery.data?.runs ?? []).map((run: ScheduledTaskRun) => (
                    <TableRow key={run.id}>
                      <TableCell><Typography variant="body2">{formatDate(locale, run.started_at)}</Typography></TableCell>
                      <TableCell><StatusDot status={run.status} t={t} mode={mode} /></TableCell>
                      <TableCell><Typography variant="body2">{formatDuration(run.duration_ms)}</Typography></TableCell>
                      <TableCell>
                        {run.error ? (
                          <Typography variant="body2" color="error.main" sx={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {run.error}
                          </Typography>
                        ) : run.summary ? (
                          <Stack spacing={0.25}>
                            {Object.entries(run.summary).map(([k, v]) => (
                              <Typography key={k} variant="caption" color="text.secondary">
                                {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                              </Typography>
                            ))}
                          </Stack>
                        ) : (
                          <Typography variant="body2" color="text.secondary">{t('scheduledTasks.shared.empty')}</Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(runsQuery.data?.runs ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} align="center">
                        <Typography color="text.secondary" py={2}>{t('scheduledTasks.runHistory.empty')}</Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {(runsQuery.data?.total ?? 0) > 20 && (
                <Box display="flex" justifyContent="center" mt={2}>
                  <Pagination
                    count={Math.ceil((runsQuery.data?.total ?? 0) / 20)}
                    page={runsPage}
                    onChange={(_, p) => setRunsPage(p)}
                    size="small"
                  />
                </Box>
              )}
            </>
          )}
        </Box>
      </Drawer>
    </Box>
  );
}
