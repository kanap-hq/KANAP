import React from 'react';
import { Alert, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { KanapDialog } from '../../../components/design';
import { useLocale } from '../../../i18n/useLocale';
import { formatShortDate } from '../../../lib/dateFormat';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import type { ContractRenewal } from './ContractRenewalDecision';

/**
 * Turning off the tacit renewal of a contract already renewed (lot CR2). The term rule would give
 * it its first term only, so the contract keeps its renewal and ends with its current term:
 * `POST /contracts/:id/renewal/stop` sets its end of validity to that term's last day. Cancel
 * changes nothing.
 */
export default function ContractStopRenewalDialog({
  open,
  contractId,
  renewals,
  endDate,
  beforeStop,
  onClose,
  onStopped,
}: {
  open: boolean;
  contractId: string;
  /** Times the contract has been renewed. */
  renewals: number;
  /** Last day of the current term (`YYYY-MM-DD`). */
  endDate: string;
  /** Saves the edits still waiting, so the server reads the dates shown; false when they could not be saved. */
  beforeStop?: () => Promise<boolean>;
  onClose: () => void;
  onStopped: (renewal: ContractRenewal) => void;
}) {
  const { t } = useTranslation(['ops', 'common']);
  const locale = useLocale();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (beforeStop && !(await beforeStop())) {
        setError(t('contracts.stopRenewal.failed'));
        return;
      }
      const res = await api.post<ContractRenewal>(`/contracts/${contractId}/renewal/stop`);
      onStopped(res.data);
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('contracts.stopRenewal.failed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KanapDialog
      open={open}
      title={t('contracts.stopRenewal.title')}
      onClose={() => { if (!busy) onClose(); }}
      onSave={confirm}
      saveLabel={t('contracts.stopRenewal.confirm')}
      saveVariant="action-danger"
      saveLoading={busy}
    >
      <Stack spacing={1.5}>
        <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>
          {t('contracts.stopRenewal.body', { count: renewals, date: formatShortDate(endDate, locale, { year: 'always' }) })}
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'kanap.text.secondary' }}>{t('contracts.stopRenewal.hint')}</Typography>
        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </KanapDialog>
  );
}
