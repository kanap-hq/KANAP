import { Button, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { netboxApi, type NetboxRecordState } from '../../../api/endpoints/netbox';
import { formatShortDateTime } from '../../../lib/dateFormat';
import { useLocale } from '../../../i18n/useLocale';
import DashboardTile, { TileEmptyState } from './DashboardTile';
import { useRelativeTime } from './useRelativeTime';

const NETBOX_PAGE = '/it/settings?tab=netbox';

/** Deep link into the Netbox tab with the records filter already applied. */
function recordsPath(state: NetboxRecordState): string {
  return `${NETBOX_PAGE}&state=${state}`;
}

/**
 * Home tile for the Netbox inventory: one line when nothing needs a decision,
 * otherwise only the points that do, each linking to the filtered list.
 */
export default function NetboxSyncTile() {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const locale = useLocale();
  const relativeTime = useRelativeTime();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['netbox-status', 'dashboard'],
    queryFn: () => netboxApi.getStatus(),
    staleTime: 2 * 60 * 1000,
  });

  const lastAt = data?.sync.finished_at || data?.sync.started_at || null;
  const attention = data ? [
    {
      key: 'failed',
      count: data.sync.status === 'failure' ? 1 : 0,
      label: t('dashboard.tiles.netboxLastRunFailed'),
      to: NETBOX_PAGE,
    },
    {
      key: 'ambiguous',
      count: data.records.ambiguous || 0,
      label: t('dashboard.tiles.netboxToDecide', { count: data.records.ambiguous || 0 }),
      to: recordsPath('ambiguous'),
    },
    {
      key: 'missing',
      count: data.records.missing || 0,
      label: t('dashboard.tiles.netboxMissing', { count: data.records.missing || 0 }),
      to: recordsPath('missing'),
    },
    {
      key: 'error',
      count: data.records.error || 0,
      label: t('dashboard.tiles.netboxErrors', { count: data.records.error || 0 }),
      to: recordsPath('error'),
    },
  ].filter((item) => item.count > 0) : [];

  return (
    <DashboardTile
      title={t('dashboard.tiles.netboxSync')}
      icon="Dns"
      isEmpty={!data || !data.configured || attention.length === 0}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => { void refetch(); }}
      action={<Button size="small" onClick={() => navigate(NETBOX_PAGE)}>{t('buttons.viewAll')}</Button>}
    >
      {!data || !data.configured ? (
        <TileEmptyState
          message={t('dashboard.tiles.netboxNotConfigured')}
          action={(
            <Button size="small" variant="outlined" onClick={() => navigate('/admin/integrations')}>
              {t('dashboard.tiles.netboxConnect')}
            </Button>
          )}
        />
      ) : attention.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {lastAt
            ? t('dashboard.tiles.netboxUpToDate', {
              when: relativeTime(lastAt, () => formatShortDateTime(lastAt, locale)),
            })
            : t('dashboard.tiles.netboxNeverRun')}
        </Typography>
      ) : (
        <Stack spacing={0.5}>
          {attention.map((item) => (
            <Typography
              key={item.key}
              component="button"
              type="button"
              variant="body2"
              onClick={() => navigate(item.to)}
              sx={{
                textAlign: 'left',
                border: 0,
                bgcolor: 'transparent',
                p: 0,
                cursor: 'pointer',
                color: 'text.primary',
                font: 'inherit',
                '&:hover': { textDecoration: 'underline' },
              }}
            >
              {item.label}
            </Typography>
          ))}
        </Stack>
      )}
    </DashboardTile>
  );
}
