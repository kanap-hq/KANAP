import React from 'react';
import { Alert, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { KanapDialog } from '../../../components/design';
import { useLocale } from '../../../i18n/useLocale';
import { formatShortDate } from '../../../lib/dateFormat';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import type { ContractRenewal } from '../contractRenewal';

/**
 * Turning the tacit renewal back on for a contract without renewal that has an end of validity
 * (lot CR2, round 3), whether that end came from turning the renewal off or from the lifecycle:
 * `POST /contracts/:id/renewal/resume` turns the renewal on and removes the end in one write.
 * Cancel changes nothing.
 */
export default function ContractResumeRenewalDialog({
  open,
  contractId,
  endOfValidity,
  beforeResume,
  onClose,
  onResumed,
}: {
  open: boolean;
  contractId: string;
  /** The end of validity removed (an ISO instant or a day). */
  endOfValidity: string;
  /** Saves the edits still waiting; false when they could not be saved. */
  beforeResume?: () => Promise<boolean>;
  onClose: () => void;
  onResumed: (renewal: ContractRenewal) => void;
}) {
  const { t } = useTranslation(['ops', 'common']);
  const locale = useLocale();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // The end of validity as the page shows it: its UTC day.
  const day = new Date(endOfValidity).toISOString().slice(0, 10);

  React.useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (beforeResume && !(await beforeResume())) {
        setError(t('contracts.resumeRenewal.failed'));
        return;
      }
      const res = await api.post<ContractRenewal>(`/contracts/${contractId}/renewal/resume`);
      onResumed(res.data);
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('contracts.resumeRenewal.failed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KanapDialog
      open={open}
      title={t('contracts.resumeRenewal.title')}
      onClose={() => { if (!busy) onClose(); }}
      onSave={confirm}
      saveLabel={t('contracts.resumeRenewal.confirm')}
      saveLoading={busy}
    >
      <Stack spacing={1.5}>
        <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>
          {t('contracts.resumeRenewal.body', { date: formatShortDate(day, locale, { year: 'always' }) })}
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </KanapDialog>
  );
}
