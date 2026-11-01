import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Alert,
  ToggleButtonGroup,
  ToggleButton,
  Typography,
} from '@mui/material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { localTodayYmd } from '../../../lib/datetime';
import { ACTIVE_TASK_STATUSES } from '../../tasks/task.constants';
import { useNotify } from '../../../components/notify/NotifyProvider';

interface QuickLogTimeModalProps {
  open: boolean;
  onClose: () => void;
}

interface Project {
  id: string;
  name: string;
}

interface Task {
  id: string;
  title: string;
  related_object_type: string | null;
  related_object_id: string | null;
  related_object_name: string | null;
}

type LogTarget = 'project' | 'task';

export default function QuickLogTimeModal({
  open,
  onClose,
}: QuickLogTimeModalProps) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('common');
  const notify = useNotify();
  const { profile, hasLevel } = useAuth();
  // Same rules as the server: project time and project task time need portfolio_projects:contributor
  // on that project, standalone task time needs tasks:member.
  const canLogProject = hasLevel('portfolio_projects', 'contributor');
  const canLogStandaloneTask = hasLevel('tasks', 'member');
  const canLogTask = hasLevel('tasks', 'reader') && (canLogProject || canLogStandaloneTask);
  const defaultTarget: LogTarget = canLogProject ? 'project' : 'task';
  const [target, setTarget] = useState<LogTarget>(defaultTarget);
  const [projectId, setProjectId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [hours, setHours] = useState('');
  const [category, setCategory] = useState<'it' | 'business'>('it');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Projects the user may log time on
  const { data: projectsData } = useQuery({
    queryKey: ['portfolio', 'projects', 'list-simple', 'contributor'],
    queryFn: async () => {
      const res = await api.get('/portfolio/projects', {
        params: { limit: 100, sort: 'name:ASC', status: 'all', access: 'contributor' },
      });
      return res.data.items as Project[];
    },
    enabled: open && canLogProject && target === 'project',
    staleTime: 5 * 60 * 1000,
  });

  // Ids of those projects, to keep only the project tasks the user may log time on
  const { data: writableProjectIds } = useQuery({
    queryKey: ['portfolio', 'projects', 'ids', 'contributor'],
    queryFn: async () => {
      const res = await api.get('/portfolio/projects/ids', {
        params: { status: 'all', access: 'contributor' },
      });
      return new Set<string>(res.data.ids as string[]);
    },
    enabled: open && canLogProject && target === 'task',
    staleTime: 5 * 60 * 1000,
  });

  // Fetch user's active tasks for dropdown
  const { data: tasksData } = useQuery({
    queryKey: ['tasks', 'list-simple', profile?.id],
    queryFn: async () => {
      const res = await api.get('/tasks', {
        params: {
          limit: 200,
          sort: 'title:ASC',
          assigneeUserId: profile?.id,
          filters: JSON.stringify({ status: { filterType: 'set', values: ACTIVE_TASK_STATUSES } }),
        },
      });
      return res.data.items as Task[];
    },
    enabled: open && canLogTask && target === 'task' && !!profile?.id,
    staleTime: 5 * 60 * 1000,
  });

  // Only project and standalone tasks (not OPEX, CAPEX or contract tasks), where the user may log time
  const loggableTasks = (tasksData ?? []).filter((task) => {
    if (!task.related_object_type) return canLogStandaloneTask;
    if (task.related_object_type !== 'project') return false;
    return canLogProject && !!task.related_object_id && !!writableProjectIds?.has(task.related_object_id);
  });

  const selectedTask = loggableTasks.find((t) => t.id === taskId);

  const logTimeMutation = useMutation({
    mutationFn: async () => {
      const hoursNum = Number(hours);
      if (target === 'project') {
        await api.post(`/portfolio/projects/${projectId}/time-entries`, {
          category,
          user_id: profile?.id,
          hours: hoursNum,
          notes: notes || undefined,
          logged_at: localTodayYmd(),
        });
      } else {
        const projectIdForTask = selectedTask?.related_object_type === 'project' ? selectedTask.related_object_id : null;
        const endpoint = projectIdForTask
          ? `/portfolio/projects/${projectIdForTask}/tasks/${taskId}/time-entries`
          : `/tasks/${taskId}/time-entries`;
        await api.post(endpoint, {
          category,
          user_id: profile?.id,
          hours: hoursNum,
          notes: notes.trim() || null,
          logged_at: localTodayYmd(),
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'time-summary'] });
      if (target === 'project') {
        queryClient.invalidateQueries({ queryKey: ['portfolio', 'projects', projectId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
      }
      handleClose();
      // The dialog has closed. The home page does not show the entry that was just logged.
      notify({ message: t('messages.timeLogged') });
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message || err.message || t('messages.failedToLogTime'));
    },
  });

  const handleClose = () => {
    setTarget(defaultTarget);
    setProjectId('');
    setTaskId('');
    setHours('');
    setCategory('it');
    setNotes('');
    setError(null);
    onClose();
  };

  const handleSubmit = () => {
    if (target === 'project' && !projectId) {
      setError(t('messages.projectRequired'));
      return;
    }
    if (target === 'task' && !taskId) {
      setError(t('messages.taskRequired'));
      return;
    }
    const hoursNum = Number(hours);
    if (!Number.isInteger(hoursNum) || hoursNum <= 0) {
      setError(t('messages.validHoursRequired'));
      return;
    }
    logTimeMutation.mutate();
  };

  const formatTaskLabel = (task: Task) => {
    if (task.related_object_name) return `${task.title} (${task.related_object_name})`;
    return task.title;
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('dashboard.quickLogTime.logTime')}</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {canLogProject && canLogTask && (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t('dashboard.quickLogTime.logOn')}
              </Typography>
              <ToggleButtonGroup
                value={target}
                exclusive
                onChange={(_, val) => {
                  if (val) {
                    setTarget(val);
                    setProjectId('');
                    setTaskId('');
                    setError(null);
                  }
                }}
                size="small"
                fullWidth
              >
                <ToggleButton value="project">{t('labels.project')}</ToggleButton>
                <ToggleButton value="task">{t('labels.task')}</ToggleButton>
              </ToggleButtonGroup>
            </Box>
          )}

          {target === 'project' ? (
            <FormControl fullWidth required>
              <InputLabel>{t('labels.project')}</InputLabel>
              <Select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                label={t('labels.project')}
              >
                {projectsData?.map((project) => (
                  <MenuItem key={project.id} value={project.id}>
                    {project.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : (
            <FormControl fullWidth required>
              <InputLabel>{t('labels.task')}</InputLabel>
              <Select
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
                label={t('labels.task')}
              >
                {loggableTasks.map((task) => (
                  <MenuItem key={task.id} value={task.id}>
                    {formatTaskLabel(task)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <TextField
            label={t('labels.hours')}
            type="number"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            fullWidth
            required
            inputProps={{ min: 1, step: 1 }}
            placeholder={t('dashboard.quickLogTime.hoursPlaceholder')}
          />

          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t('labels.category')}
            </Typography>
            <ToggleButtonGroup
              value={category}
              exclusive
              onChange={(_, val) => val && setCategory(val)}
              size="small"
              fullWidth
            >
              <ToggleButton value="it">{t('dashboard.quickLogTime.it')}</ToggleButton>
              <ToggleButton value="business">{t('dashboard.quickLogTime.business')}</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          <TextField
            label={t('dashboard.quickLogTime.notesOptional')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            fullWidth
            multiline
            rows={2}
            placeholder={t('dashboard.quickLogTime.whatDidYouWorkOn')}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="action" onClick={handleClose}>{t('buttons.cancel')}</Button>
        <Button
          variant="action-primary"
          onClick={handleSubmit}
          disabled={logTimeMutation.isPending}
        >
          {t('dashboard.quickLogTime.logTime')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
