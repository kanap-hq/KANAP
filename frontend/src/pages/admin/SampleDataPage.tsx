import React from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { useTheme, type Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';
import { StatusDot } from '../../components/design';
import { formatShortDateTime } from '../../lib/dateFormat';
import { useLocale } from '../../i18n/useLocale';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { getDotColor } from '../../utils/statusColors';
import ForbiddenPage from '../ForbiddenPage';
import type { SampleDataOverview, SampleDataStatus } from '../../api/endpoints/sampleData';
import { LoadSampleDataDialog, ResetWorkspaceDialog, useStepLabel } from './sample-data/SampleDataDialogs';
import { useSampleData, useSampleDataAvailable } from './sample-data/useSampleData';

const STATUS_COLOR: Record<SampleDataStatus, string> = {
  idle: 'default',
  loading: 'info',
  loaded: 'success',
  failed: 'error',
  resetting: 'warning',
};

const pageSx = (theme: Theme) => ({
  '& .kanap-strip': {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start',
    gap: '40px', flexWrap: 'wrap', fontSize: 13, p: '14px 18px',
    bgcolor: theme.palette.kanap.bg.drawer,
    borderRadius: '8px',
    border: `1px solid ${theme.palette.kanap.border.soft}`,
    width: '100%', boxSizing: 'border-box',
  },
  '& .kanap-strip-group': { display: 'flex', flexDirection: 'column', gap: '2px' },
  '& .kanap-strip-label': { fontSize: 12, color: theme.palette.kanap.text.tertiary, whiteSpace: 'nowrap' },
  '& .kanap-strip-val': { fontWeight: 500, color: theme.palette.kanap.text.primary, display: 'flex', alignItems: 'center', gap: '6px' },
});

/** Status, and when and by whom the sample data was loaded or the load failed. */
function SampleDataStrip({ overview }: { overview: SampleDataOverview }) {
  const { t } = useTranslation('admin');
  const theme = useTheme();
  const locale = useLocale();
  const group = (label: string, value: React.ReactNode) => (
    <Box className="kanap-strip-group">
      <Box component="span" className="kanap-strip-label">{label}</Box>
      <Box component="span" className="kanap-strip-val">{value}</Box>
    </Box>
  );
  return (
    <Box className="kanap-strip">
      {group(t('sampleData.strip.status'), (
        <>
          <StatusDot color={getDotColor(STATUS_COLOR[overview.status], theme.palette.mode)} />
          {t(`sampleData.status.${overview.status}`)}
        </>
      ))}
      {overview.status === 'loaded' && overview.loaded_at
        ? group(t('sampleData.strip.loadedOn'), formatShortDateTime(overview.loaded_at, locale))
        : null}
      {overview.status === 'loading' && overview.started_at
        ? group(t('sampleData.strip.startedOn'), formatShortDateTime(overview.started_at, locale))
        : null}
      {overview.status === 'failed' && overview.failed_at
        ? group(t('sampleData.strip.failedOn'), formatShortDateTime(overview.failed_at, locale))
        : null}
      {(overview.status === 'loaded' || overview.status === 'loading') && overview.loaded_by_name
        ? group(t('sampleData.strip.by'), overview.loaded_by_name)
        : null}
    </Box>
  );
}

/**
 * Administration › Sample data: load the Fromage & Co set into an empty workspace, follow the
 * load, and erase everything to go back to the starting state. Administrator role only, cloud
 * workspaces only.
 */
export default function SampleDataPage() {
  const { t } = useTranslation(['admin', 'errors']);
  const available = useSampleDataAvailable();
  const stepLabel = useStepLabel();
  const { query, overview, load, reset } = useSampleData(available);
  const [loadOpen, setLoadOpen] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);

  if (!available) return <ForbiddenPage />;

  const openLoad = () => { load.reset(); setLoadOpen(true); };
  const openReset = () => { reset.reset(); setResetOpen(true); };
  const confirmLoad = () => load.mutate(undefined, { onSuccess: () => setLoadOpen(false) });
  const confirmReset = (typedName: string) => reset.mutate(typedName, { onSuccess: () => setResetOpen(false) });

  const eraseButton = (
    <Box>
      <Button variant="action-danger" onClick={openReset}>{t('sampleData.actions.eraseAndStartOver')}</Button>
    </Box>
  );

  const body = (() => {
    if (!overview) return null;
    switch (overview.status) {
      case 'loading':
        return (
          <Stack spacing={0.5}>
            <Typography variant="body2">{stepLabel(overview.step)}</Typography>
            <Typography variant="body2" color="text.secondary">{t('sampleData.loading.concurrentWrites')}</Typography>
          </Stack>
        );
      case 'resetting':
        return <Typography variant="body2">{t('sampleData.resetting')}</Typography>;
      case 'loaded':
        return (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">{t('sampleData.loadedHint')}</Typography>
            {eraseButton}
          </Stack>
        );
      case 'failed':
        return (
          <Stack spacing={1.5}>
            <Alert severity="error">
              {t(`sampleData.failure.${overview.error_code ?? 'load_failed'}`)}
              {overview.error_code !== 'reset_failed' ? ` ${t('sampleData.failure.backToStart')}` : null}
            </Alert>
            {overview.error_code === 'reset_failed' ? eraseButton : overview.can_load ? (
              <Box>
                <Button variant="contained" onClick={openLoad}>{t('sampleData.actions.retry')}</Button>
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">{t('sampleData.notEmpty')}</Typography>
            )}
          </Stack>
        );
      default:
        return overview.can_load ? (
          <Box>
            <Button variant="contained" onClick={openLoad}>{t('sampleData.actions.load')}</Button>
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">{t('sampleData.notEmpty')}</Typography>
        );
    }
  })();

  return (
    <Box sx={pageSx}>
      <PageHeader title={t('sampleData.title')} />
      <Stack spacing={2.5} sx={{ maxWidth: 880 }}>
        <Typography variant="body2" color="text.secondary">{t('sampleData.intro')}</Typography>
        {query.isError ? (
          <Alert severity="error">{getApiErrorMessage(query.error, t, t('sampleData.messages.statusFailed'))}</Alert>
        ) : null}
        {overview ? <SampleDataStrip overview={overview} /> : null}
        {body}
      </Stack>

      <LoadSampleDataDialog
        open={loadOpen}
        loading={load.isPending}
        error={load.error}
        onClose={() => setLoadOpen(false)}
        onConfirm={confirmLoad}
      />
      <ResetWorkspaceDialog
        open={resetOpen}
        workspaceName={overview?.workspace_name ?? ''}
        createdSinceLoad={overview?.created_since_load ?? null}
        resetting={reset.isPending}
        error={reset.error}
        onClose={() => setResetOpen(false)}
        onConfirm={confirmReset}
      />
    </Box>
  );
}
