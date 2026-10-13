import { Box, Link, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useFeatures } from '../../config/FeaturesContext';
import { useLocale } from '../../i18n/useLocale';
import { getDocPageUrl, RELEASES_URL } from '../../utils/docUrls';

export default function AboutTab() {
  const { t } = useTranslation('settings');
  const { config } = useFeatures();
  const locale = useLocale();
  const isOnPremise = config.deploymentMode === 'single-tenant';

  return (
    <Stack spacing={0.5}>
      <Typography variant="subtitle1" sx={{ fontWeight: 500, mb: 0.5 }}>
        {t('about.title')}
      </Typography>
      {config.version !== 'unknown' && (
        <Typography variant="body2">{t('about.version', { version: config.version })}</Typography>
      )}
      <Typography variant="body2">
        {isOnPremise ? t('about.deploymentOnPremise') : t('about.deploymentCloud')}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, pt: 1 }}>
        <Link variant="body2" href={RELEASES_URL} target="_blank" rel="noopener">
          {t('about.releaseNotes')}
        </Link>
        {isOnPremise && (
          <Link variant="body2" href={getDocPageUrl('on-premise/operations', locale)} target="_blank" rel="noopener">
            {t('about.upgradeGuide')}
          </Link>
        )}
      </Box>
    </Stack>
  );
}
