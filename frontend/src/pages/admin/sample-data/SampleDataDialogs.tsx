import React from 'react';
import { Alert, Box, Stack, TextField, Typography } from '@mui/material';
import { Trans, useTranslation } from 'react-i18next';
import { KanapDialog } from '../../../components/design';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { confirmationMatches, SAMPLE_DATA_STEPS } from './useSampleData';

const listSx = { m: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 0.5 } as const;

/** "Step 3 of 19: companies" for a running load; a known step only, never the technical name. */
export function useStepLabel() {
  const { t } = useTranslation('admin');
  return React.useCallback((step: string | null): string => {
    const index = step ? (SAMPLE_DATA_STEPS as readonly string[]).indexOf(step) : -1;
    if (index < 0) return t('sampleData.loading.preparing');
    return t('sampleData.loading.step', {
      current: index + 1,
      total: SAMPLE_DATA_STEPS.length,
      label: t(`sampleData.steps.${step}`),
    });
  }, [t]);
}

/** The confirmation of a load: what the data set holds. Opened by the page and the home banner. */
export function LoadSampleDataDialog({ open, loading, error, onClose, onConfirm }: {
  open: boolean;
  loading: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation(['admin', 'errors']);
  return (
    <KanapDialog
      open={open}
      title={t('sampleData.loadDialog.title')}
      onClose={onClose}
      onSave={onConfirm}
      saveLabel={t('sampleData.actions.load')}
      saveLoading={loading}
    >
      <Stack spacing={1.5}>
        {error ? <Alert severity="error">{getApiErrorMessage(error, t, t('sampleData.messages.loadFailed'))}</Alert> : null}
        <Typography variant="body2">{t('sampleData.loadDialog.intro')}</Typography>
        <Box component="ul" sx={listSx}>
          <Typography component="li" variant="body2">{t('sampleData.loadDialog.companies')}</Typography>
          <Typography component="li" variant="body2">{t('sampleData.loadDialog.users')}</Typography>
          <Typography component="li" variant="body2">{t('sampleData.loadDialog.landscape')}</Typography>
          <Typography component="li" variant="body2">{t('sampleData.loadDialog.business')}</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary">{t('sampleData.loadDialog.duration')}</Typography>
      </Stack>
    </KanapDialog>
  );
}

/**
 * The confirmation of a reset: everything is erased for good, what is kept, and the workspace
 * name to type. "Erase everything" stays disabled until the name matches.
 */
export function ResetWorkspaceDialog({ open, workspaceName, createdSinceLoad, resetting, error, onClose, onConfirm }: {
  open: boolean;
  workspaceName: string;
  createdSinceLoad: number | null;
  resetting: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (typedName: string) => void;
}) {
  const { t } = useTranslation(['admin', 'errors']);
  const [typed, setTyped] = React.useState('');
  const matches = confirmationMatches(typed, workspaceName);

  return (
    <KanapDialog
      open={open}
      title={t('sampleData.resetDialog.title')}
      onClose={onClose}
      onExited={() => setTyped('')}
      onSave={() => { if (matches) onConfirm(typed); }}
      saveLabel={t('sampleData.actions.eraseAll')}
      saveVariant="action-danger"
      saveDisabled={!matches}
      saveLoading={resetting}
    >
      <Stack spacing={1.5}>
        {error ? <Alert severity="error">{getApiErrorMessage(error, t, t('sampleData.messages.resetFailed'))}</Alert> : null}
        <Alert severity="warning" icon={false}>{t('sampleData.resetDialog.warning')}</Alert>
        <Box>
          <Typography variant="body2" sx={{ mb: 0.5 }}>{t('sampleData.resetDialog.keptTitle')}</Typography>
          <Box component="ul" sx={listSx}>
            {(['users', 'subscription', 'identity', 'microsoft', 'ai', 'audit'] as const).map((key) => (
              <Typography key={key} component="li" variant="body2">{t(`sampleData.resetDialog.kept.${key}`)}</Typography>
            ))}
          </Box>
        </Box>
        <Typography variant="body2">{t('sampleData.resetDialog.settingsDefaults')}</Typography>
        {createdSinceLoad && createdSinceLoad > 0 ? (
          <Typography variant="body2">{t('sampleData.resetDialog.createdSinceLoad', { count: createdSinceLoad })}</Typography>
        ) : null}
        <Typography variant="body2" color="text.secondary">{t('sampleData.resetDialog.email')}</Typography>
        <Box>
          <Typography variant="body2" sx={{ mb: 0.75 }}>
            <Trans
              t={t}
              i18nKey="sampleData.resetDialog.typeName"
              values={{ name: workspaceName }}
              components={{ strong: <Box component="span" sx={{ fontWeight: 500 }} /> }}
            />
          </Typography>
          <TextField
            variant="standard"
            fullWidth
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            inputProps={{ 'aria-label': t('sampleData.resetDialog.nameLabel'), autoComplete: 'off', spellCheck: false }}
          />
        </Box>
      </Stack>
    </KanapDialog>
  );
}
