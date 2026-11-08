import { FormControlLabel, Radio, RadioGroup, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import InfoHint from '../../components/workspace/InfoHint';
import { useThemeMode } from '../../config/ThemeContext';

export default function AppearanceTab() {
  const { mode, resolvedMode, setMode } = useThemeMode();
  const { t } = useTranslation('settings');

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={0.75} alignItems="center">
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t('appearance.title')}
        </Typography>
        <InfoHint text={t('appearance.description')} />
      </Stack>
      <RadioGroup
        value={mode}
        onChange={(event) => setMode(event.target.value as 'light' | 'dark' | 'system')}
      >
        <FormControlLabel value="light" control={<Radio />} label={t('appearance.light')} />
        <FormControlLabel value="dark" control={<Radio />} label={t('appearance.dark')} />
        <FormControlLabel value="system" control={<Radio />} label={t('appearance.system')} />
      </RadioGroup>
      {mode === 'system' && (
        <Typography variant="caption" color="text.secondary">
          {t('appearance.activeMode', { mode: resolvedMode === 'dark' ? t('appearance.dark') : t('appearance.light') })}
        </Typography>
      )}
    </Stack>
  );
}
