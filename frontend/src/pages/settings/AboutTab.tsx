import { Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import AboutContent from '../../components/about/AboutContent';

export default function AboutTab() {
  const { t } = useTranslation('settings');

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
        {t('about.title')}
      </Typography>
      <AboutContent />
    </Stack>
  );
}
