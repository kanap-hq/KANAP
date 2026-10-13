import React from 'react';
import { Alert, Box, Button, Link, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Trans, useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { KanapDialog, StatusDot } from '../../components/design';
import { useLocale } from '../../i18n/useLocale';
import { getDotColor } from '../../utils/statusColors';
import type { AiBuiltinProvider, IncludedModelIdentity } from '../../ai/includedModel';
import { useRegionName } from '../../ai/useRegionName';

type StatusProps = {
  provider: AiBuiltinProvider;
  disabled?: boolean;
  onConfirm: () => void;
  onWithdraw: () => void;
};

/** The included model's provider and location, whether an administrator confirmed it, and the action that applies. */
export function IncludedModelStatus({ provider, disabled, onConfirm, onWithdraw }: StatusProps) {
  const { t } = useTranslation(['admin']);
  const locale = useLocale();
  const regionName = useRegionName();
  const { mode } = useTheme().palette;
  const color = getDotColor(provider.accepted ? 'success' : 'warning', mode);
  const date = provider.accepted_at ? new Date(provider.accepted_at).toLocaleDateString(locale) : '';

  let detail: string;
  if (!provider.accepted) {
    detail = t('aiAdmin.includedModel.needed');
  } else if (provider.accepted_by_name) {
    detail = t('aiAdmin.includedModel.confirmedBy', { name: provider.accepted_by_name, date });
  } else {
    detail = t('aiAdmin.includedModel.confirmedOn', { date });
  }

  return (
    <Stack spacing={0.5} data-testid="included-model-status">
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="body2">
          {t('aiAdmin.includedModel.status', { name: provider.name, place: regionName(provider.location) })}
        </Typography>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
          <StatusDot color={color} />
          <Typography variant="body2" sx={{ color, fontWeight: 500, fontSize: '0.8125rem' }}>
            {provider.accepted ? t('aiAdmin.includedModel.confirmed') : t('aiAdmin.includedModel.needsConfirmation')}
          </Typography>
        </Box>
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="caption" color="text.secondary">{detail}</Typography>
        {provider.accepted ? (
          <Link component="button" type="button" variant="caption" underline="hover" onClick={onWithdraw} disabled={disabled}>
            {t('aiAdmin.includedModel.withdraw')}
          </Link>
        ) : (
          <Button size="small" variant="contained" onClick={onConfirm} disabled={disabled}>
            {t('aiAdmin.includedModel.confirm')}
          </Button>
        )}
      </Stack>
    </Stack>
  );
}

type DialogProps = {
  open: boolean;
  identity: IncludedModelIdentity | null;
  /** True when the confirmation also turns the assistant on. */
  activating: boolean;
  loading?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

/** What the included model receives and where it is processed, before an administrator confirms it. */
export function IncludedModelDialog({ open, identity, activating, loading, error, onCancel, onConfirm }: DialogProps) {
  const { t } = useTranslation(['admin', 'common']);
  const regionName = useRegionName();
  return (
    <KanapDialog
      open={open}
      title={t('aiAdmin.includedModel.dialog.title')}
      onClose={onCancel}
      onSave={onConfirm}
      saveLabel={activating ? t('aiAdmin.includedModel.dialog.confirmAndTurnOn') : t('aiAdmin.includedModel.confirm')}
      saveLoading={loading}
      saveDisabled={!identity}
    >
      <Stack spacing={1.5}>
        <Typography variant="body2">
          {t('aiAdmin.includedModel.dialog.body', { name: identity?.name ?? '', place: regionName(identity?.location) })}
        </Typography>
        <Typography variant="body2">
          <Trans
            t={t}
            i18nKey="aiAdmin.includedModel.dialog.ownModel"
            components={{
              link: (
                <Link component={RouterLink} to="/admin/ai-models" underline="hover">
                  {t('aiAdmin.includedModel.dialog.ownModelLink')}
                </Link>
              ),
            }}
          />
        </Typography>
        {error ? <Alert severity="warning">{error}</Alert> : null}
      </Stack>
    </KanapDialog>
  );
}

type WithdrawProps = {
  open: boolean;
  loading?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function WithdrawIncludedModelDialog({ open, loading, error, onCancel, onConfirm }: WithdrawProps) {
  const { t } = useTranslation(['admin', 'common']);
  return (
    <KanapDialog
      open={open}
      title={t('aiAdmin.includedModel.withdrawDialog.title')}
      onClose={onCancel}
      onSave={onConfirm}
      saveLabel={t('aiAdmin.includedModel.withdraw')}
      saveVariant="action-danger"
      saveLoading={loading}
    >
      <Stack spacing={1.5}>
        <Typography variant="body2">{t('aiAdmin.includedModel.withdrawDialog.body')}</Typography>
        {error ? <Alert severity="error">{error}</Alert> : null}
      </Stack>
    </KanapDialog>
  );
}
