import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import api from '../../../api';
import { useTranslation } from 'react-i18next';
import DashboardTile, { TileEmptyState } from './DashboardTile';
import QuickLogTimeModal from '../actions/QuickLogTimeModal';

interface TimeSummary {
  totalHours: number;
  byProject: Array<{
    projectId: string;
    projectName: string;
    hours: number;
  }>;
  byCategory: {
    it: number;
    business: number;
  };
  nonProjectTaskHours: number;
}

interface MyTimeLastWeekTileProps {
  config: Record<string, unknown>;
}

export default function MyTimeLastWeekTile({ config }: MyTimeLastWeekTileProps) {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const days = (config.days as number) || 7;
  const [logTimeOpen, setLogTimeOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard', 'time-summary', days],
    queryFn: async () => {
      const res = await api.get<TimeSummary>('/dashboard/time-summary', {
        params: { days },
      });
      return res.data;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

  const summary = data || {
    totalHours: 0,
    byProject: [],
    byCategory: { it: 0, business: 0 },
    nonProjectTaskHours: 0,
  };

  const maxHours = Math.max(...summary.byProject.map((p) => p.hours), 1);

  return (
    <DashboardTile
      title={t('dashboard.tiles.myTime', { days })}
      icon="AccessTime"
      isEmpty={summary.totalHours === 0}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => { void refetch(); }}
      action={
        <Button size="small" onClick={() => navigate('/portfolio/contributors/me/time-logged')}>
          {t('buttons.viewAll')}
        </Button>
      }
    >
      <QuickLogTimeModal open={logTimeOpen} onClose={() => setLogTimeOpen(false)} />
      {summary.totalHours === 0 ? (
        <TileEmptyState
          message={t('dashboard.tiles.noTimeLogged', { days })}
          action={
            <Button size="small" onClick={() => setLogTimeOpen(true)}>
              {t('dashboard.logTime')}
            </Button>
          }
        />
      ) : (
        <Box>
          {/* Total hours - prominent display */}
          <Box sx={{ textAlign: 'center', mb: 2 }}>
            <Typography variant="h3" color="text.primary" fontWeight={500}>
              {summary.totalHours.toFixed(1)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('dashboard.tiles.hoursLogged')}
            </Typography>
          </Box>

          {/* Category breakdown */}
          <Box sx={{ display: 'flex', gap: 2, mb: 2, justifyContent: 'center' }}>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="subtitle2" color="text.primary">
                {summary.byCategory.it.toFixed(1)}h
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('dashboard.quickLogTime.it')}
              </Typography>
            </Box>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="subtitle2" color="secondary">
                {summary.byCategory.business.toFixed(1)}h
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('dashboard.quickLogTime.business')}
              </Typography>
            </Box>
            {summary.nonProjectTaskHours > 0 && (
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="subtitle2" color="text.primary">
                  {summary.nonProjectTaskHours.toFixed(1)}h
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('dashboard.tiles.otherTasks')}
                </Typography>
              </Box>
            )}
          </Box>

          {/* By project breakdown */}
          {summary.byProject.length > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary" fontWeight={500}>
                {t('dashboard.tiles.byProject')}
              </Typography>
              <List dense disablePadding>
                {summary.byProject.slice(0, 5).map((project) => (
                  <ListItem
                    key={project.projectId}
                    disablePadding
                    sx={{ flexDirection: 'column', alignItems: 'stretch', py: 0.5 }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="caption" noWrap sx={{ flex: 1, mr: 1 }}>
                        {project.projectName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {project.hours.toFixed(1)}h
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={(project.hours / maxHours) * 100}
                      sx={{ height: 4, borderRadius: 2 }}
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
        </Box>
      )}
    </DashboardTile>
  );
}
