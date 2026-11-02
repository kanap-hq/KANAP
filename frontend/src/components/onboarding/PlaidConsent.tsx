import React from 'react';
import { Alert, Box, Checkbox, CircularProgress, FormControlLabel, Link, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { aiAdminApi, type AiSettingsPayload } from '../../ai/aiApi';
import { BUILTIN_PROVIDER_CHANGED, identityOf, includedModelError } from '../../ai/includedModel';
import { useAiCapabilities } from '../../ai/useAiCapabilities';
import { useRegionName } from '../../ai/useRegionName';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

/** The surface of the composer it stands in for. */
const surfaceSx = {
  px: 1.75,
  py: 1.25,
  borderRadius: '8px',
  border: '1px solid',
  borderColor: 'kanap.border.default',
  bgcolor: 'kanap.bg.composer',
} as const;

/**
 * In place of Plaid's composer while the included model waits for its acceptance. An
 * administrator of the AI settings ticks one box naming the provider and its processing location
 * the platform declares: that turns the assistant on and records the acceptance (the call of the
 * former "Turn on Plaid" card), and the composer comes. Anyone else reads that Plaid waits for an
 * administrator.
 */
export default function PlaidConsent() {
  const { t } = useTranslation(['ai', 'admin', 'errors']);
  const queryClient = useQueryClient();
  const regionName = useRegionName();
  const capabilities = useAiCapabilities();
  const canAccept = capabilities.data?.surfaces.settings.available === true;
  const [error, setError] = React.useState<string | null>(null);

  const settings = useQuery<AiSettingsPayload>({
    queryKey: ['admin-ai-settings'],
    queryFn: () => aiAdminApi.getSettings(),
    enabled: canAccept,
  });
  const identity = identityOf(settings.data?.settings.builtin_provider);

  const accept = useMutation({
    mutationFn: (key: string) => aiAdminApi.updateSettings({ chat_enabled: true, accept_builtin_provider_key: key }),
    onMutate: () => setError(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-ai-settings'] });
      await queryClient.invalidateQueries({ queryKey: ['ai-capabilities'] });
    },
    onError: async (err) => {
      // The platform changed the provider or its location meanwhile: show the new one, unticked.
      if (includedModelError(err)?.code === BUILTIN_PROVIDER_CHANGED) {
        await settings.refetch();
        setError(t('admin:aiAdmin.includedModel.changed'));
        return;
      }
      setError(getApiErrorMessage(err, t, t('admin:aiAdmin.messages.saveFailed')));
    },
  });

  if (!canAccept) {
    return (
      <Box sx={surfaceSx} data-plaid-composer>
        <Typography variant="body2" color="text.secondary">{t('workspace.messages.builtinNotAccepted')}</Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={1} sx={surfaceSx} data-plaid-composer>
      {error ? <Alert severity="warning">{error}</Alert> : null}
      {identity ? (
        <FormControlLabel
          sx={{ alignItems: 'flex-start', m: 0, gap: 1 }}
          control={(
            <Checkbox
              size="small"
              checked={accept.isPending}
              disabled={accept.isPending}
              onChange={(event) => { if (event.target.checked) accept.mutate(identity.key); }}
              sx={{ p: 0, mt: '2px' }}
            />
          )}
          label={(
            <Typography variant="body2">
              {t('consent.accept', { name: identity.name, place: regionName(identity.location) })}
            </Typography>
          )}
        />
      ) : (
        <CircularProgress size={16} thickness={5} aria-label={t('consent.loading')} />
      )}
      <Typography variant="body2" color="text.secondary" sx={{ pl: '28px' }}>
        {t('consent.otherModel')}{' '}
        <Link component={RouterLink} to="/admin/ai" underline="hover">{t('consent.otherModelLink')}</Link>
      </Typography>
    </Stack>
  );
}
