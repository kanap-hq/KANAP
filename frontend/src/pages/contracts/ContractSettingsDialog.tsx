import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Stack, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { KanapDialog, PropertyRow } from '../../components/design';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

/** `GET /contract-settings` (`backend/src/contracts/contract-settings.service.ts`). */
export type ContractSettings = { decision_window_days: number };

export const CONTRACT_SETTINGS_KEY = ['contract-settings'] as const;
const WINDOW_MIN = 0;
const WINDOW_MAX = 365;

/** The tenant's contract settings, for contract administrators: the renewal decision window. */
export default function ContractSettingsDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation(['ops', 'common']);
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: CONTRACT_SETTINGS_KEY,
    queryFn: async () => (await api.get<ContractSettings>('/contract-settings')).data,
    enabled: open,
  });
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open && data) setValue(String(data.decision_window_days));
    if (open) setError(null);
  }, [open, data]);

  const parsed = /^\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : null;
  const valid = parsed !== null && parsed >= WINDOW_MIN && parsed <= WINDOW_MAX;

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.patch<ContractSettings>('/contract-settings', { decision_window_days: parsed });
      queryClient.setQueryData(CONTRACT_SETTINGS_KEY, res.data);
      // Every value the window drives: the list state and count, the contracts and their decision box.
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['contract-renewal'] });
      onSaved();
      onClose();
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('contracts.renewal.settings.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KanapDialog
      open={open}
      title={t('contracts.renewal.settings.title')}
      onClose={onClose}
      onSave={save}
      saveLabel={t('common:buttons.save')}
      saveDisabled={!data || !valid}
      saveLoading={saving}
    >
      <Stack spacing={2}>
        <PropertyRow
          label={t('contracts.renewal.settings.windowLabel')}
          helperText={value.trim() && !valid ? t('contracts.renewal.settings.invalid') : t('contracts.renewal.settings.windowHint')}
        >
          <TextField
            variant="standard"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="90"
            error={!!value.trim() && !valid}
            disabled={!data}
            inputProps={{ inputMode: 'numeric', 'aria-label': t('contracts.renewal.settings.windowLabel') }}
            sx={{ maxWidth: 120 }}
          />
        </PropertyRow>
        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </KanapDialog>
  );
}
