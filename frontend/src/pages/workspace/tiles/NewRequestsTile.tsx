import { useNavigate } from 'react-router-dom';
import {
  List,
  ListItemButton,
  ListItemText,
  Typography,
  Box,
  Button,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import api from '../../../api';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../../i18n/useLocale';
import DashboardTile, { TileEmptyState } from './DashboardTile';

interface PortfolioRequest {
  id: string;
  name: string;
  requester_name?: string;
  created_at: string;
  priority_score: number | null;
}

interface NewRequestsTileProps {
  config: Record<string, unknown>;
}

export default function NewRequestsTile({ config }: NewRequestsTileProps) {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const locale = useLocale();
  const limit = Math.min((config.limit as number) || 5, 10);
  const days = (config.days as number) || 7;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  // AG Grid date filter model (date filters only know greaterThan, not greaterThanOrEqual): honored by
  // the list endpoint and by the requests page as a deep link.
  const recentFilters = JSON.stringify({
    created_at: { filterType: 'date', type: 'greaterThan', dateFrom: cutoffDate.toISOString().split('T')[0] },
  });
  const listPath = `/portfolio/requests?${new URLSearchParams({ requestScope: 'all', filters: recentFilters, sort: 'created_at:DESC' }).toString()}`;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['portfolio', 'requests', 'recent', limit, days],
    queryFn: async () => {
      const res = await api.get('/portfolio/requests', {
        params: {
          limit,
          sort: 'created_at:DESC',
          filters: recentFilters,
        },
      });
      return res.data.items as PortfolioRequest[];
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

  const requests = data || [];

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  };

  return (
    <DashboardTile
      title={t('dashboard.tiles.newRequests', { days })}
      icon="Inbox"
      isEmpty={requests.length === 0}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => { void refetch(); }}
      action={
        <Button size="small" onClick={() => navigate(listPath)}>
          {t('buttons.viewAll')}
        </Button>
      }
    >
      {requests.length === 0 ? (
        <TileEmptyState
          message={t('dashboard.tiles.noNewRequests')}
          action={
            <Button size="small" onClick={() => navigate('/portfolio/requests')}>
              {t('dashboard.tiles.browseRequests')}
            </Button>
          }
        />
      ) : (
        <List dense disablePadding>
          {requests.map((request) => (
            <ListItemButton
              key={request.id}
              onClick={() => navigate(`/portfolio/requests/${request.id}`)}
              sx={{ py: 0.5 }}
            >
              <ListItemText
                primary={request.name}
                secondary={
                  <Box component="span" sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    {request.requester_name && (
                      <Typography variant="caption" color="text.secondary">
                        {request.requester_name}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary">
                      {formatDate(request.created_at)}
                    </Typography>
                  </Box>
                }
                primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                secondaryTypographyProps={{ component: 'div' }}
              />
              {request.priority_score != null && request.priority_score > 80 && (
                <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.75rem', ml: 1 }}>
                  {t('dashboard.tiles.high')}
                </Box>
              )}
            </ListItemButton>
          ))}
        </List>
      )}
    </DashboardTile>
  );
}
