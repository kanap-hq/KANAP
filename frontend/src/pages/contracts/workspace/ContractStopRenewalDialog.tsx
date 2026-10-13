import React from 'react';
import { Alert, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { KanapDialog } from '../../../components/design';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { useContractRenewal, type ContractRenewal } from '../contractRenewal';
import ContractEndChoice, { isValidEnd } from './ContractEndChoice';

/**
 * Turning off the tacit renewal of a contract already renewed, or awaiting a renewal decision
 * (lot CR2). The term rule would give it its first term only, so the contract keeps its renewal
 * and ends on the day chosen (the proposed end by default, `ContractEndChoice`):
 * `POST /contracts/:id/renewal/stop` sets its end of validity, and records a termination when a
 * decision is awaited. Cancel changes nothing.
 */
export default function ContractStopRenewalDialog({
  open,
  contractId,
  startDate,
  renewals,
  fallbackEnd,
  beforeStop,
  onClose,
  onStopped,
}: {
  open: boolean;
  contractId: string;
  startDate: string | null | undefined;
  /** Times the contract has been renewed. */
  renewals: number;
  /** The current term's last day, while the proposed end loads. */
  fallbackEnd: string;
  /** Saves the edits still waiting, so the server reads the dates shown; false when they could not be saved. */
  beforeStop?: () => Promise<boolean>;
  onClose: () => void;
  onStopped: (renewal: ContractRenewal) => void;
}) {
  const { t } = useTranslation(['ops', 'common']);
  const { data } = useContractRenewal(contractId);
  const proposed = data?.proposed_end_date ?? fallbackEnd;
  const [endDate, setEndDate] = React.useState(proposed);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setEndDate(proposed);
    // Each opening starts from the proposed end.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const confirm = async () => {
    if (busy || !isValidEnd(endDate, startDate)) return;
    setBusy(true);
    setError(null);
    try {
      if (beforeStop && !(await beforeStop())) {
        setError(t('contracts.stopRenewal.failed'));
        return;
      }
      const res = await api.post<ContractRenewal>(`/contracts/${contractId}/renewal/stop`, { end_date: endDate });
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
      saveDisabled={!isValidEnd(endDate, startDate)}
    >
      <Stack spacing={1.5}>
        {renewals > 0 && (
          <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{t('contracts.stopRenewal.renewed', { count: renewals })}</Typography>
        )}
        {data?.state === 'pending' && (
          <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{t('contracts.stopRenewal.awaited')}</Typography>
        )}
        <ContractEndChoice
          contractId={contractId}
          startDate={startDate}
          proposed={proposed}
          noticeMonths={data?.notice_period_months ?? 0}
          value={endDate}
          onChange={setEndDate}
          proposedImpact={data?.state === 'pending' && data.proposed_end_date === proposed ? data.impact : undefined}
          disabled={busy}
        />
        {renewals > 0 && (
          <Typography sx={{ fontSize: 12, color: 'kanap.text.secondary' }}>{t('contracts.stopRenewal.hint')}</Typography>
        )}
        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </KanapDialog>
  );
}
