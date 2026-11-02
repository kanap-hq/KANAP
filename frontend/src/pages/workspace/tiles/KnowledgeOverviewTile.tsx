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
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useLocale } from '../../../i18n/useLocale';
import { formatShortDate } from '../../../lib/dateFormat';
import DashboardTile, { TileEmptyState } from './DashboardTile';
import { useRelativeTime } from './useRelativeTime';

interface KnowledgeReviewItem {
  id: string;
  itemNumber: number;
  title: string;
  status: string;
  stage: 'reviewer' | 'approver';
  requestedAt: string;
  requestedByName: string | null;
}

interface KnowledgeOverviewTileProps {
  config: Record<string, unknown>;
}

/** Documents waiting for the current user's review or approval. Recently opened documents live in the "Recently viewed" tile. */
export default function KnowledgeOverviewTile({ config: _config }: KnowledgeOverviewTileProps) {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const locale = useLocale();
  const relativeTime = useRelativeTime();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard', 'knowledge-review-items'],
    queryFn: async () => {
      const res = await api.get<KnowledgeReviewItem[]>('/dashboard/knowledge-review-items', {
        params: { limit: 5 },
      });
      return res.data;
    },
    staleTime: 2 * 60 * 1000,
  });

  const reviewItems = data || [];

  return (
    <DashboardTile
      title={t('dashboard.tiles.knowledge')}
      icon="Description"
      isEmpty={reviewItems.length === 0}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => { void refetch(); }}
      action={(
        <Button size="small" onClick={() => navigate('/knowledge')}>
          {t('buttons.open')}
        </Button>
      )}
    >
      {reviewItems.length === 0 ? (
        <TileEmptyState message={t('dashboard.tiles.noActiveReviews')} />
      ) : (
        <Box>
          <Typography variant="caption" color="text.secondary" fontWeight={500} sx={{ px: 2 }}>
            {t('dashboard.tiles.toReview')}
          </Typography>
          <List dense disablePadding>
            {reviewItems.map((item) => (
              <ListItemButton
                key={item.id}
                onClick={() => navigate(`/knowledge/${item.id}`)}
                sx={{ py: 0.5, alignItems: 'flex-start' }}
              >
                <ListItemText
                  primary={`DOC-${item.itemNumber} - ${item.title}`}
                  secondary={(
                    <Box component="span" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Chip
                          label={item.stage === 'approver' ? t('dashboard.tiles.approval') : t('dashboard.tiles.review')}
                          size="small"
                          color={item.stage === 'approver' ? 'secondary' : 'warning'}
                          sx={{ height: 20, fontSize: '0.7rem' }}
                        />
                        <Typography variant="caption" color="text.secondary">
                          {t('dashboard.tiles.requestedAgo', { time: relativeTime(item.requestedAt, () => formatShortDate(item.requestedAt, locale)) })}
                        </Typography>
                      </Box>
                      {item.requestedByName && (
                        <Typography variant="caption" color="text.secondary">
                          {t('dashboard.tiles.requestedBy', { name: item.requestedByName })}
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
        </Box>
      )}
    </DashboardTile>
  );
}
