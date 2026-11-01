import { useNavigate } from 'react-router-dom';
import {
  List,
  ListItemButton,
  ListItemText,
  Typography,
  Box,
  Divider,
  Button,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../../i18n/useLocale';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import DashboardTile, { TileEmptyState } from './DashboardTile';
import { taskPriorityLabel } from './tileLabels';
import { ACTIVE_TASK_STATUSES } from '../../tasks/task.constants';

interface Task {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  priority_level: string;
  related_object_type: string | null;
  related_object_id: string | null;
  project_name?: string;
}

interface MyTasksTileProps {
  config: Record<string, unknown>;
}

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
}

function isDueThisWeek(dueDate: string | null): boolean {
  if (!dueDate) return false;
  const due = new Date(dueDate);
  const now = new Date();
  const weekFromNow = new Date();
  weekFromNow.setDate(weekFromNow.getDate() + 7);
  return due >= now && due <= weekFromNow;
}

export default function MyTasksTile({ config }: MyTasksTileProps) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { t } = useTranslation('common');
  const locale = useLocale();
  const limit = Math.min((config.limit as number) || 5, 10);
  const showOverdue = config.showOverdue !== false;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['tasks', 'my-tasks', profile?.id, limit],
    queryFn: async () => {
      const res = await api.get('/tasks', {
        params: {
          assigneeUserId: profile?.id,
          limit,
          sort: 'due_date:ASC',
          include: 'project',
          filters: JSON.stringify({
            status: { filterType: 'set', values: ACTIVE_TASK_STATUSES },
          }),
        },
      });
      return res.data.items as Task[];
    },
    enabled: !!profile?.id,
    staleTime: 60 * 1000, // 1 minute
  });

  const tasks = data || [];

  // Group tasks
  const overdueSource = showOverdue ? tasks.filter((t) => isOverdue(t.due_date)) : [];
  const dueThisWeekSource = tasks.filter((t) => !isOverdue(t.due_date) && isDueThisWeek(t.due_date));
  const laterSource = tasks.filter((t) => !isOverdue(t.due_date) && !isDueThisWeek(t.due_date));

  let remaining = limit;
  const overdueTasks = overdueSource.slice(0, remaining);
  remaining -= overdueTasks.length;
  const dueThisWeek = dueThisWeekSource.slice(0, remaining);
  remaining -= dueThisWeek.length;
  const laterTasks = laterSource.slice(0, remaining);

  const formatDueDate = (date: string | null) => {
    if (!date) return t('dashboard.tiles.noDueDate');
    const d = new Date(date);
    return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  };

  const renderTaskList = (items: Task[], emptyMessage: string) => {
    if (items.length === 0) {
      return (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1, pl: 2 }}>
          {emptyMessage}
        </Typography>
      );
    }
    return (
      <List dense disablePadding>
        {items.map((task) => (
          <ListItemButton
            key={task.id}
            onClick={() => navigate(`/portfolio/tasks/${task.id}`)}
            sx={{ py: 0.5 }}
          >
            <ListItemText
              primary={task.title}
              secondary={
                <Box component="span" sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  {task.project_name && (
                    <Typography variant="caption" color="text.secondary">
                      {task.project_name}
                    </Typography>
                  )}
                  <Typography variant="caption" color="text.secondary">
                    {formatDueDate(task.due_date)}
                  </Typography>
                </Box>
              }
              primaryTypographyProps={{ variant: 'body2', noWrap: true }}
              secondaryTypographyProps={{ component: 'div' }}
            />
            {task.priority_level !== 'normal' && (
              <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.75rem', ml: 1 }}>
                {taskPriorityLabel(t, task.priority_level)}
              </Box>
            )}
          </ListItemButton>
        ))}
      </List>
    );
  };

  return (
    <DashboardTile
      title={t('dashboard.myTasks')}
      icon="Task"
      isEmpty={tasks.length === 0}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => { void refetch(); }}
      action={
        <Button size="small" onClick={() => navigate('/portfolio/tasks?taskScope=my')}>
          {t('buttons.viewAll')}
        </Button>
      }
    >
      {tasks.length === 0 ? (
        <TileEmptyState
          message={t('dashboard.tiles.noTasksAssigned')}
          action={
            <Button size="small" onClick={() => navigate('/portfolio/tasks')}>
              {t('dashboard.tiles.browseTasks')}
            </Button>
          }
        />
      ) : (
        <Box>
          {showOverdue && overdueTasks.length > 0 && (
            <>
              <Typography variant="caption" color="error" fontWeight={500} sx={{ pl: 2 }}>
                {t('dashboard.tiles.overdue')}
              </Typography>
              {renderTaskList(overdueTasks, '')}
              <Divider sx={{ my: 1 }} />
            </>
          )}
          {dueThisWeek.length > 0 && (
            <>
              <Typography variant="caption" color="text.secondary" fontWeight={500} sx={{ pl: 2 }}>
                {t('dashboard.tiles.dueThisWeek')}
              </Typography>
              {renderTaskList(dueThisWeek, '')}
              {laterTasks.length > 0 && <Divider sx={{ my: 1 }} />}
            </>
          )}
          {laterTasks.length > 0 && (
            <>
              <Typography variant="caption" color="text.secondary" fontWeight={500} sx={{ pl: 2 }}>
                {t('dashboard.tiles.later')}
              </Typography>
              {renderTaskList(laterTasks, '')}
            </>
          )}
        </Box>
      )}
    </DashboardTile>
  );
}
