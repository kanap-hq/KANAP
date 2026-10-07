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

/**
 * One line on the home page for the workspace's administrators while it is still empty: load the
 * sample data (the same confirmation as Administration › Sample data) or hide the line for good.
 * While a load runs, the line follows it. Gone once the workspace holds data.
 */
export default function SampleDataBanner() {
  const { t } = useTranslation(['admin', 'errors']);
  const available = useSampleDataAvailable();
  const stepLabel = useStepLabel();
  const { overview, load, dismiss } = useSampleData(available);
  const [open, setOpen] = React.useState(false);

  if (!available || !overview) return null;
  const loading = overview.status === 'loading';
  if (!loading && !(overview.can_load && !overview.dismissed_at)) return null;

  return (
    <Box role="status" sx={bannerSx}>
      {loading ? (
        <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
          {t('sampleData.banner.loading', { step: stepLabel(overview.step) })}{' '}
          <Box component="span" sx={{ color: 'text.secondary' }}>{t('sampleData.loading.concurrentWrites')}</Box>
        </Typography>
      ) : (
        <>
          <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
            {t('sampleData.banner.text')}
            {dismiss.error ? (
              <Box component="span" sx={{ color: 'error.main', ml: 1 }}>
                {getApiErrorMessage(dismiss.error, t, t('sampleData.messages.dismissFailed'))}
              </Box>
            ) : null}
          </Typography>
          <Button size="small" variant="contained" onClick={() => { load.reset(); setOpen(true); }}>
            {t('sampleData.banner.load')}
          </Button>
          <Button size="small" variant="action" onClick={() => dismiss.mutate()} disabled={dismiss.isPending}>
            {t('sampleData.banner.hide')}
          </Button>
        </>
      )}
      <LoadSampleDataDialog
        open={open}
        loading={load.isPending}
        error={load.error}
        onClose={() => setOpen(false)}
        onConfirm={() => load.mutate(undefined, { onSuccess: () => setOpen(false) })}
      />
    </Box>
  );
}
