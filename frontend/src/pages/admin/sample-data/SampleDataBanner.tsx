import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { LoadSampleDataDialog, useStepLabel } from './SampleDataDialogs';
import { useSampleData, useSampleDataAvailable } from './useSampleData';

const bannerSx = {
  mb: 2,
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 1.5,
  px: '14px',
  py: '8px',
  borderRadius: '8px',
  border: 1,
  borderColor: 'kanap.border.soft',
  bgcolor: 'kanap.bg.drawer',
} as const;

const textSx = { flex: 1, minWidth: 0 } as const;

/**
 * One line on the home page for the workspace's administrators while it is empty and sample data
 * was never loaded: load it (the same confirmation as Administration › Sample data) or hide the
 * line for good. While a load runs, the line follows it; after a failed load, it gives the reason
 * and offers to try again. Gone once sample data was loaded, even after a reset.
 */
export default function SampleDataBanner() {
  const { t } = useTranslation(['admin', 'errors']);
  const available = useSampleDataAvailable();
  const stepLabel = useStepLabel();
  const { overview, load, dismiss } = useSampleData(available, 'banner');
  const [open, setOpen] = React.useState(false);

  if (!available || !overview || overview.dismissed_at || overview.ever_loaded_at) return null;
  const loading = overview.status === 'loading';
  const failed = overview.status === 'failed' && overview.error_code !== null;
  if (!loading && !failed && !(overview.status === 'idle' && overview.can_load)) return null;

  const openLoad = () => { load.reset(); setOpen(true); };
  const dialog = (
    <LoadSampleDataDialog
      open={open}
      loading={load.isPending}
      error={load.error}
      onClose={() => setOpen(false)}
      onConfirm={() => load.mutate(undefined, { onSuccess: () => setOpen(false) })}
    />
  );

  if (loading) {
    const step = stepLabel(overview.step);
    return (
      <Box sx={bannerSx}>
        <Typography role="status" variant="body2" sx={textSx}>
          {step ? t('sampleData.banner.loading', { step }) : t('sampleData.banner.loadingNoStep')}{' '}
          <Box component="span" sx={{ color: 'text.secondary' }}>{t('sampleData.loading.concurrentWrites')}</Box>
        </Typography>
        {dialog}
      </Box>
    );
  }

  if (failed) {
    return (
      <Box sx={bannerSx}>
        <Typography role="status" variant="body2" sx={textSx}>
          {t(`sampleData.failure.${overview.error_code}`)}
          {overview.error_code !== 'reset_failed' ? ` ${t('sampleData.failure.backToStart')}` : null}
        </Typography>
        {overview.can_load ? (
          <Button size="small" variant="contained" onClick={openLoad}>{t('sampleData.actions.retry')}</Button>
        ) : null}
        {dialog}
      </Box>
    );
  }

  return (
    <Box sx={bannerSx}>
      <Typography role="status" variant="body2" sx={textSx}>
        {t('sampleData.banner.text')}
        {dismiss.error ? (
          <Box component="span" sx={{ color: 'error.main', ml: 1 }}>
            {getApiErrorMessage(dismiss.error, t, t('sampleData.messages.dismissFailed'))}
          </Box>
        ) : null}
      </Typography>
      <Button size="small" variant="contained" onClick={openLoad}>{t('sampleData.banner.load')}</Button>
      <Button size="small" variant="action" onClick={() => dismiss.mutate()} disabled={dismiss.isPending}>
        {t('sampleData.banner.hide')}
      </Button>
      {dialog}
    </Box>
  );
}
