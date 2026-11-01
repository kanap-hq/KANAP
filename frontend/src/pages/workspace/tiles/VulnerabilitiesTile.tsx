import { Box, Button, Stack, Typography, useTheme } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api/client';
import { useLocalizedItOpsSettings } from '../../../hooks/useLocalizedItOpsSettings';
import { getDotColor, VULNERABILITY_SEVERITY_COLORS } from '../../../utils/statusColors';
import DashboardTile from './DashboardTile';

const VULNERABILITIES_PAGE = '/it/vulnerabilities';

/** `GET /vulnerabilities/home-summary`. */
export type VulnerabilityHomeSummary = {
  /** Null without the applications read right; `criticality` null when the catalog has no active level. */
  top_criticality_applications: { criticality: string | null; count: number } | null;
  critical_published: { last_7_days: number; last_30_days: number };
  exploited: number;
  assets_with_severe: number;
  stale_sources: Array<{ source: 'nvd' | 'cve_org'; last_success_at: string; days: number }>;
};

const linkSx = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 1,
  textAlign: 'left',
  border: 0,
  bgcolor: 'transparent',
  p: 0,
  cursor: 'pointer',
  color: 'text.primary',
  font: 'inherit',
  '&:hover .vulnerabilities-tile-label': { textDecoration: 'underline' },
} as const;

/** The count of a line: tabular figures, right-aligned so the labels line up. */
const countSx = { minWidth: '3ch', textAlign: 'right', fontWeight: 500, fontVariantNumeric: 'tabular-nums', flexShrink: 0 } as const;

/**
 * Home tile of the vulnerabilities that touch the estate: only the points that need attention, each
 * linking to the filtered view, the count first (in the severity colour for the critical and exploited
 * lines, as on the Vulnerabilities page); one line when there are none. A source not read for more
 * than 3 days warns at the bottom, set apart. Shown with the vulnerability feed on and the
 * infrastructure read right.
 */
export default function VulnerabilitiesTile() {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const { data: settings } = useLocalizedItOpsSettings();
  const mode = useTheme().palette.mode;
  const severeColor = getDotColor(VULNERABILITY_SEVERITY_COLORS.critical, mode);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['vulnerabilities', 'home-summary'],
    queryFn: () => api.get<VulnerabilityHomeSummary>('/vulnerabilities/home-summary'),
    staleTime: 2 * 60 * 1000,
  });

  const top = data?.top_criticality_applications;
  const level = top?.criticality
    ? settings?.businessCriticalityLevels?.find((item: { code: string }) => item.code === top.criticality)?.label ?? top.criticality
    : null;
  const lines = data ? [
    {
      key: 'applications',
      count: top && top.criticality ? top.count : 0,
      label: t('dashboard.tiles.vulnerabilitiesLines.applications', { count: top?.count ?? 0, level }),
      attention: false,
      to: `/it/applications?vulnerabilities=severe&criticality=${encodeURIComponent(top?.criticality ?? '')}`,
    },
    {
      key: 'critical7',
      count: data.critical_published.last_7_days,
      label: t('dashboard.tiles.vulnerabilitiesLines.critical7', { count: data.critical_published.last_7_days }),
      attention: true,
      to: `${VULNERABILITIES_PAGE}?published=7d&severity=critical&estate=1`,
    },
    {
      key: 'critical30',
      count: data.critical_published.last_30_days,
      label: t('dashboard.tiles.vulnerabilitiesLines.critical30', { count: data.critical_published.last_30_days }),
      attention: true,
      to: `${VULNERABILITIES_PAGE}?published=30d&severity=critical&estate=1`,
    },
    {
      key: 'exploited',
      count: data.exploited,
      label: t('dashboard.tiles.vulnerabilitiesLines.exploited', { count: data.exploited }),
      attention: true,
      to: `${VULNERABILITIES_PAGE}?exploited=1&estate=1`,
    },
    {
      key: 'assets',
      count: data.assets_with_severe,
      label: t('dashboard.tiles.vulnerabilitiesLines.assets', { count: data.assets_with_severe }),
      attention: false,
      to: '/it/assets?vulnerabilities=severe',
    },
  ].filter((item) => item.count > 0) : [];
  const warnings = (data?.stale_sources ?? []).map((item) => ({
    key: item.source,
    label: t(item.source === 'nvd' ? 'dashboard.tiles.vulnerabilitiesStaleNvd' : 'dashboard.tiles.vulnerabilitiesStaleCveOrg', { count: item.days }),
  }));

  return (
    <DashboardTile
      title={t('dashboard.tiles.vulnerabilities')}
      subtitle={t('dashboard.tiles.vulnerabilitiesSubtitle')}
      icon="GppMaybe"
      isEmpty={lines.length === 0 && warnings.length === 0}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => { void refetch(); }}
      action={<Button size="small" onClick={() => navigate(VULNERABILITIES_PAGE)}>{t('buttons.viewAll')}</Button>}
    >
      <Stack spacing={0.75}>
        {lines.length === 0 ? (
          <Typography variant="body2" color="text.secondary">{t('dashboard.tiles.vulnerabilitiesNone')}</Typography>
        ) : lines.map((item) => (
          <Typography key={item.key} component="button" type="button" variant="body2" onClick={() => navigate(item.to)} sx={linkSx}>
            <Box component="span" data-count="" sx={{ ...countSx, color: item.attention ? severeColor : 'text.primary' }}>{item.count}</Box>
            {' '}
            <Box component="span" className="vulnerabilities-tile-label">{item.label}</Box>
          </Typography>
        ))}
      </Stack>
      {warnings.length > 0 && (
        <Box data-testid="vulnerabilities-tile-warnings" sx={{ mt: 1.5, pt: 1, borderTop: 1, borderColor: 'kanap.border.soft' }}>
          {warnings.map((item) => (
            <Typography key={item.key} variant="caption" component="p" sx={{ m: 0, color: 'kanap.orange' }}>
              {item.label}
            </Typography>
          ))}
        </Box>
      )}
    </DashboardTile>
  );
}
