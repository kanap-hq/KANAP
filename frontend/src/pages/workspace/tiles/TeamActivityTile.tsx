import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Chip,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import api from '../../../api';
import { useTranslation } from 'react-i18next';
import DashboardTile, { TileEmptyState } from './DashboardTile';
import { useRelativeTime } from './useRelativeTime';
import { useLocale } from '../../../i18n/useLocale';
import { formatShortDate } from '../../../lib/dateFormat';

interface TeamActivityItem {
  id: string;
  projectId: string;
  projectName: string;
  type: 'change' | 'comment' | 'decision';
  content: string | null;
  authorName: string;
  createdAt: string;
  changedFields: Record<string, [unknown, unknown]> | null;
}

interface TeamActivityTileProps {
  config: Record<string, unknown>;
}

function summaryKey(item: TeamActivityItem): string {
  if (item.type === 'comment') return 'dashboard.tiles.addedComment';
  if (item.type === 'decision') return 'dashboard.tiles.recordedDecision';
  if (item.changedFields?.status) return 'dashboard.tiles.changedStatus';
  if (item.changedFields?.task_created) return 'dashboard.tiles.createdTask';
  if (item.changedFields?.execution_progress) return 'dashboard.tiles.updatedProgress';
  if (item.changedFields?.phase_id) return 'dashboard.tiles.updatedPhase';
  return 'dashboard.tiles.updatedProject';
}

export default function TeamActivityTile({ config }: TeamActivityTileProps) {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const locale = useLocale();
  const relativeTime = useRelativeTime();
  const limit = Math.min((config.limit as number) || 5, 10);
  const days = Math.max(1, Math.min((config.days as number) || 7, 30));

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard', 'team-activity', limit, days],
    queryFn: async () => {
      const res = await api.get<TeamActivityItem[]>('/dashboard/team-activity', {
        params: { limit, days },
      });
      return res.data;
    },
    staleTime: 2 * 60 * 1000,
  });

  const items = data || [];

  return (
    <DashboardTile
      title={t('dashboard.tiles.teamActivityDays', { days })}
      icon="Update"
      isEmpty={items.length === 0}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => { void refetch(); }}
      action={(
        <Button size="small" onClick={() => navigate('/portfolio/projects?projectScope=my')}>
          {t('buttons.viewAll')}
        </Button>
      )}
    >
      {items.length === 0 ? (
        <TileEmptyState message={t('dashboard.tiles.noRecentTeamActivity')} />
      ) : (
        <List dense disablePadding>
          {items.map((item) => (
            <ListItemButton
              key={item.id}
              onClick={() => navigate(`/portfolio/projects/${item.projectId}/activity`)}
              sx={{ py: 0.5, alignItems: 'flex-start' }}
            >
              <ListItemText
                primary={item.projectName}
                secondary={(
                  <Box component="span" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Chip
                        label={item.type === 'comment' ? t('dashboard.tiles.comment') : item.type === 'decision' ? t('dashboard.tiles.decision') : t('dashboard.tiles.change')}
                        size="small"
                        variant="outlined"
                        sx={{ height: 20, fontSize: '0.7rem' }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {relativeTime(item.createdAt, () => formatShortDate(item.createdAt, locale))}
                      </Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      {t(summaryKey(item), { author: item.authorName })}
                    </Typography>
                    {item.type === 'comment' && item.content && (
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {item.content.replace(/\s+/g, ' ').trim()}
                      </Typography>
                    )}
                  </Box>
                )}
                primaryTypographyProps={{ variant: 'body2', fontWeight: 500, noWrap: true }}
                secondaryTypographyProps={{ component: 'div' }}
              />
            </ListItemButton>
          ))}
        </List>
      )}
    </DashboardTile>
  );
}
