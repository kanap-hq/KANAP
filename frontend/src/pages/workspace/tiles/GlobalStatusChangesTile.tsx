import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../../i18n/useLocale';
import { formatShortDate } from '../../../lib/dateFormat';
import api from '../../../api';
import DashboardTile, { TileEmptyState } from './DashboardTile';
import { projectStatusLabel } from './tileLabels';
import { getDotColor, getPillBg, PROJECT_STATUS_COLORS } from '../../../utils/statusColors';

interface ProjectStatusChangeItem {
  id: string;
  projectId: string;
  projectName: string;
  previousStatus: string | null;
  nextStatus: string | null;
  authorName: string;
  createdAt: string;
}

interface GlobalStatusChangesTileProps {
  config: Record<string, unknown>;
}

export default function GlobalStatusChangesTile({ config }: GlobalStatusChangesTileProps) {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const locale = useLocale();
  const days = Math.max(1, Math.min((config.days as number) || 5, 14));

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard', 'project-status-changes', days],
    queryFn: async () => {
      const res = await api.get<ProjectStatusChangeItem[]>('/dashboard/project-status-changes', {
        params: { days, limit: 5 },
      });
      return res.data;
    },
    staleTime: 2 * 60 * 1000,
  });

  const items = data || [];

  return (
    <DashboardTile
      title={t('dashboard.tiles.statusChanges', { days })}
      icon="SwapHoriz"
      isEmpty={items.length === 0}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => { void refetch(); }}
      action={(
        <Button size="small" onClick={() => navigate('/portfolio/projects')}>
          {t('buttons.viewAll')}
        </Button>
      )}
    >
      {items.length === 0 ? (
        <TileEmptyState message={t('dashboard.tiles.noRecentStatusChanges')} />
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
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Box component="span" sx={(theme) => {
                        const muiColor = PROJECT_STATUS_COLORS[item.previousStatus || ''] || 'default';
                        const textColor = getDotColor(muiColor, theme.palette.mode);
                        const bgColor = getPillBg(muiColor, theme.palette.mode);
                        return { display: 'inline-flex', alignItems: 'center', px: 1, py: 0.25, borderRadius: 9999, fontSize: '0.75rem', fontWeight: 500, color: textColor, bgcolor: bgColor };
                      }}>
                        {projectStatusLabel(t, item.previousStatus)}
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {t('dashboard.tiles.to')}
                      </Typography>
                      <Box component="span" sx={(theme) => {
                        const muiColor = PROJECT_STATUS_COLORS[item.nextStatus || ''] || 'default';
                        const textColor = getDotColor(muiColor, theme.palette.mode);
                        const bgColor = getPillBg(muiColor, theme.palette.mode);
                        return { display: 'inline-flex', alignItems: 'center', px: 1, py: 0.25, borderRadius: 9999, fontSize: '0.75rem', fontWeight: 500, color: textColor, bgcolor: bgColor };
                      }}>
                        {projectStatusLabel(t, item.nextStatus)}
                      </Box>
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      {t('dashboard.tiles.authorOnDate', { author: item.authorName, date: formatShortDate(item.createdAt, locale) })}
                    </Typography>
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
