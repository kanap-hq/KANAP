import { Box, Button, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import api from '../../../api';
import DashboardTile, { TileEmptyState } from './DashboardTile';
import { getDotColor } from '../../../utils/statusColors';
import { useTheme } from '@mui/material/styles';

export type ApplicationComplianceSummary = {
  total: number; reviewed: number; stale: number; incomplete: number;
  attention: { critical_without_recent_test: number; critical_without_wave: number; restricted_data_low_cyber: number };
  levels: { critical: string[]; restricted_data: string[]; low_cyber: string[] };
};

type FilterModel = Record<string, { filterType: 'set'; values: Array<string | null> }>;

/** Deep link to the applications list, all apps, with an AG Grid set-filter model (values are catalog codes). */
export function applicationsListPath(filters: FilterModel, sort?: string): string {
  const params = new URLSearchParams({ filters: JSON.stringify(filters), appScope: 'all' });
  if (sort) params.set('sort', sort);
  return `/it/applications?${params.toString()}`;
}

/** Segmented review-state bar: reviewed, to review, to complete. Widths follow the counts; nothing is drawn on an empty scope. */
export function ReviewStateBar({ summary }: { summary: ApplicationComplianceSummary }) {
  const { t } = useTranslation('common');
  const theme = useTheme();
  const segments = [
    { key: 'reviewed', count: summary.reviewed, color: getDotColor('success', theme.palette.mode) },
    { key: 'stale', count: summary.stale, color: getDotColor('warning', theme.palette.mode) },
    { key: 'incomplete', count: summary.incomplete, color: getDotColor('default', theme.palette.mode) },
  ];
  if (!summary.total) return null;
  return (
    <Box sx={{ display: 'flex', height: 6, borderRadius: '3px', overflow: 'hidden', bgcolor: 'kanap.border.soft' }} role="img" aria-label={t('labels.reviewStates')}>
      {segments.filter((segment) => segment.count > 0).map((segment) => (
        <Box key={segment.key} sx={{ width: `${(segment.count / summary.total) * 100}%`, bgcolor: segment.color }} />
      ))}
    </Box>
  );
}

/**
 * Home tile for the classification campaign: review progress over the applications the user can see,
 * then the points a compliance owner acts on, each linking to the filtered applications list.
 */
export default function ApplicationComplianceTile() {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const theme = useTheme();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['applications-classification-summary', 'dashboard'],
    queryFn: async () => (await api.get<ApplicationComplianceSummary>('/applications/classification-summary')).data,
    staleTime: 2 * 60 * 1000,
  });

  const reviewFilter = (values: string[]) => applicationsListPath({ classification_review_state: { filterType: 'set', values } });
  const metrics = data ? [
    { key: 'reviewed', label: t('dashboard.tiles.complianceReviewed'), count: data.reviewed, color: getDotColor('success', theme.palette.mode), to: reviewFilter(['reviewed']) },
    { key: 'stale', label: t('dashboard.tiles.complianceStale'), count: data.stale, color: getDotColor('warning', theme.palette.mode), to: reviewFilter(['stale']) },
    { key: 'incomplete', label: t('dashboard.tiles.complianceIncomplete'), count: data.incomplete, color: getDotColor('default', theme.palette.mode), to: reviewFilter(['incomplete']) },
  ] : [];
  const attention = data ? [
    { key: 'test', count: data.attention.critical_without_recent_test, label: t('dashboard.tiles.complianceCriticalWithoutTest', { count: data.attention.critical_without_recent_test }), to: applicationsListPath({ criticality: { filterType: 'set', values: data.levels.critical } }, 'last_dr_test:ASC') },
    { key: 'wave', count: data.attention.critical_without_wave, label: t('dashboard.tiles.complianceCriticalWithoutWave', { count: data.attention.critical_without_wave }), to: applicationsListPath({ criticality: { filterType: 'set', values: data.levels.critical }, recovery_wave: { filterType: 'set', values: [null] } }) },
    { key: 'cyber', count: data.attention.restricted_data_low_cyber, label: t('dashboard.tiles.complianceRestrictedLowCyber', { count: data.attention.restricted_data_low_cyber }), to: applicationsListPath({ data_class: { filterType: 'set', values: data.levels.restricted_data }, cyber_criticality: { filterType: 'set', values: data.levels.low_cyber } }) },
  ].filter((item) => item.count > 0) : [];

  return (
    <DashboardTile
      title={t('dashboard.tiles.compliance')}
      icon="VerifiedUser"
      isEmpty={!data || data.total === 0}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => { void refetch(); }}
      action={<Button size="small" onClick={() => navigate(reviewFilter(['stale', 'incomplete']))}>{t('buttons.viewAll')}</Button>}
    >
      {!data || data.total === 0 ? (
        <TileEmptyState message={t('dashboard.tiles.complianceEmpty')} action={<Button size="small" variant="outlined" onClick={() => navigate('/it/applications')}>{t('dashboard.tiles.browseApplications')}</Button>} />
      ) : (
        <Stack spacing={2}>
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t('dashboard.tiles.complianceProgress', { reviewed: data.reviewed, total: data.total })}</Typography>
            <ReviewStateBar summary={data} />
          </Box>
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'space-between' }}>
            {metrics.map((metric) => (
              <Box key={metric.key} component="button" type="button" onClick={() => navigate(metric.to)} sx={{ flex: 1, border: 0, bgcolor: 'transparent', cursor: 'pointer', textAlign: 'left', p: 0, font: 'inherit', color: 'inherit' }}>
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: metric.color, flexShrink: 0 }} />
                  <Typography variant="subtitle2" color="text.primary">{metric.count}</Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary">{metric.label}</Typography>
              </Box>
            ))}
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>{t('dashboard.tiles.complianceAttention')}</Typography>
            {attention.length === 0 ? (
              <Typography variant="body2" color="text.secondary">{t('dashboard.tiles.complianceNoAttention')}</Typography>
            ) : (
              <Stack spacing={0.5}>
                {attention.map((item) => (
                  <Typography key={item.key} component="button" type="button" variant="body2" onClick={() => navigate(item.to)} sx={{ textAlign: 'left', border: 0, bgcolor: 'transparent', p: 0, cursor: 'pointer', color: 'text.primary', font: 'inherit', '&:hover': { textDecoration: 'underline' } }}>
                    {item.label}
                  </Typography>
                ))}
              </Stack>
            )}
          </Box>
        </Stack>
      )}
    </DashboardTile>
  );
}
