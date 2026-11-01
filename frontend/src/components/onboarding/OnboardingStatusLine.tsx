import { Box, CircularProgress, Typography } from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { useStepLabel } from '../../pages/admin/sample-data/SampleDataDialogs';
import { useSampleData, useSampleDataAvailable } from '../../pages/admin/sample-data/useSampleData';
import { useOnboarding } from './useOnboarding';

/** Same one-line tint as the sample data line of the administrators. */
const lineSx = (theme: Theme) => ({
  mb: 2,
  display: 'flex',
  alignItems: 'center',
  gap: 1.5,
  px: '14px',
  py: '8px',
  borderRadius: '8px',
  border: '1px solid',
  borderColor: alpha(theme.palette.info.main, theme.palette.mode === 'dark' ? 0.35 : 0.25),
  bgcolor: theme.palette.info.light,
  color: theme.palette.kanap.text.primary,
});

/**
 * One line on the home page while the sample data loads or the workspace is being reset, so the
 * home page never looks empty meanwhile. The administrators' sample data line already says it for
 * a first load; this one covers everyone else and the reset of "start with my own data".
 */
export default function OnboardingStatusLine() {
  const { t } = useTranslation('admin');
  const stepLabel = useStepLabel();
  const sampleDataAvailable = useSampleDataAvailable();
  // The same query as the administrators' line (shared cache), to say a load only once.
  const { overview } = useSampleData(sampleDataAvailable, 'banner');
  const { state } = useOnboarding();
  if (!state) return null;

  const resetting = state.reset_in_progress || state.sample_data.status === 'resetting';
  const loading = state.sample_data.status === 'loading';
  if (!resetting && !loading) return null;
  const sampleDataLineShowsLoad = !!overview && !overview.dismissed_at && !overview.ever_loaded_at && overview.status === 'loading';
  if (loading && sampleDataLineShowsLoad) return null;

  const step = loading ? stepLabel(state.sample_data.step) : null;
  const text = resetting
    ? t('sampleData.resetting')
    : step ? t('sampleData.banner.loading', { step }) : t('sampleData.banner.loadingNoStep');

  return (
    <Box sx={lineSx}>
      <CircularProgress size={16} thickness={5} sx={{ color: 'info.main', flexShrink: 0 }} />
      <Typography role="status" variant="body2" sx={{ flex: 1, minWidth: 0 }}>
        {text}
      </Typography>
    </Box>
  );
}
