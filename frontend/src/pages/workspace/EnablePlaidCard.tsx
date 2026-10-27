import React from 'react';
import { Box, Button, IconButton, Typography } from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import CloseIcon from '@mui/icons-material/Close';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { aiAdminApi, type AiSettingsPayload } from '../../ai/aiApi';
import { BUILTIN_PROVIDER_CHANGED, identityOf, includedModelError, type IncludedModelIdentity } from '../../ai/includedModel';
import { useAiCapabilities } from '../../ai/useAiCapabilities';
import { useAuth } from '../../auth/AuthContext';
import { useFeatures } from '../../config/FeaturesContext';
import { useTenant } from '../../tenant/TenantContext';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { IncludedModelDialog } from '../admin/IncludedModelConfirmation';

const DISMISS_KEY_PREFIX = 'kanap.enablePlaidCard.dismissed';

const dismissKey = (tenantSlug: string | null) => `${DISMISS_KEY_PREFIX}.${tenantSlug ?? 'default'}`;

function readDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function storeDismissed(key: string): void {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    // Without storage the card simply shows again next time.
  }
}

/** Same one-line tint as the sample data line above it. */
const cardSx = (theme: Theme) => ({
  mb: 2,
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
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
 * One line on the home page during the trial, for an administrator of the AI settings while the
 * assistant is off and the KANAP included model is offered: turn it on after the usual
 * confirmation of the included model, or hide the line for good in this browser.
 */
export default function EnablePlaidCard() {
  const { t } = useTranslation('ai');
  const { t: tAdmin } = useTranslation(['admin', 'errors']);
  const queryClient = useQueryClient();
  const { subscription } = useAuth();
  const { config } = useFeatures();
  const { tenantSlug } = useTenant();
  const capabilities = useAiCapabilities();

  const key = dismissKey(tenantSlug);
  const [dismissed, setDismissed] = React.useState(() => readDismissed(key));
  const [dialog, setDialog] = React.useState<IncludedModelIdentity | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const runningTrial = config.deploymentMode !== 'single-tenant'
    && subscription?.status === 'trialing'
    && subscription.is_subscription_healthy === true;
  const eligible = runningTrial
    && !dismissed
    && capabilities.data?.surfaces.settings.available === true
    && capabilities.data.surfaces.chat.tenant_enabled === false;

  const settingsQuery = useQuery<AiSettingsPayload>({
    queryKey: ['admin-ai-settings'],
    queryFn: () => aiAdminApi.getSettings(),
    enabled: eligible,
  });

  const turnOn = useMutation({
    mutationFn: (identity: IncludedModelIdentity) =>
      aiAdminApi.updateSettings({ chat_enabled: true, accept_builtin_provider_key: identity.key }),
    onMutate: () => setError(null),
    onSuccess: async () => {
      setDialog(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-ai-settings'] });
      await queryClient.invalidateQueries({ queryKey: ['ai-capabilities'] });
    },
    onError: async (err) => {
      const included = includedModelError(err);
      if (included?.code === BUILTIN_PROVIDER_CHANGED) {
        // The platform changed the provider or its location meanwhile: show the new one.
        const refreshed = await settingsQuery.refetch();
        const identity = included.identity ?? identityOf(refreshed.data?.settings.builtin_provider);
        if (identity) {
          setDialog(identity);
          setError(tAdmin('aiAdmin.includedModel.changed'));
          return;
        }
      } else if (included?.identity) {
        setDialog(included.identity);
      }
      setError(getApiErrorMessage(err, tAdmin, tAdmin('aiAdmin.messages.saveFailed')));
    },
  });

  const identity = identityOf(settingsQuery.data?.settings.builtin_provider);
  if (!eligible || !identity) return null;

  const dismiss = () => {
    storeDismissed(key);
    setDismissed(true);
  };

  return (
    <Box sx={cardSx}>
      <AutoAwesomeOutlinedIcon aria-hidden sx={{ fontSize: 18, color: 'info.main', flexShrink: 0 }} />
      <Typography variant="body2" sx={{ flex: 1, minWidth: 0, fontWeight: 500 }}>
        {t('enablePlaid.text')}
      </Typography>
      <Button
        size="small"
        variant="contained"
        onClick={() => { turnOn.reset(); setError(null); setDialog(identity); }}
      >
        {t('enablePlaid.action')}
      </Button>
      <IconButton size="small" aria-label={t('enablePlaid.dismiss')} onClick={dismiss}>
        <CloseIcon fontSize="small" />
      </IconButton>
      <IncludedModelDialog
        open={!!dialog}
        identity={dialog}
        activating
        loading={turnOn.isPending}
        error={error}
        onCancel={() => setDialog(null)}
        onConfirm={() => { if (dialog) turnOn.mutate(dialog); }}
      />
    </Box>
  );
}
