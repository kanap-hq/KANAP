import React from 'react';
import { Button } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useKanapDialogs } from '../../../components/design';
import { useLocale } from '../../../i18n/useLocale';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { deleteFailureReason, type DeleteFailure } from '../../../utils/deleteRefusal';
import { contractDeleteImpactText, fetchContractDeleteImpact } from '../contractDelete';

type Props = {
  contractId: string;
  contractName: string;
  /** Saves the edits still pending, before the contract goes. */
  beforeDelete: () => Promise<unknown>;
  onDeleted: () => void;
  onError: (message: string) => void;
};

/**
 * Delete action of the contract page. It always asks first, with what loses its link and what
 * goes too ("Delete anyway" when something does). A contract with recorded compliance
 * requirements is refused up front: the dialog says how many and to disable it instead.
 */
export default function ContractDeleteButton({ contractId, contractName, beforeDelete, onDeleted, onError }: Props) {
  const { t } = useTranslation(['ops', 'common', 'errors']);
  const locale = useLocale();
  const dialogs = useKanapDialogs();
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState(false);

  const handleClick = async () => {
    setBusy(true);
    try {
      const impact = await fetchContractDeleteImpact([contractId]);
      const title = t('contracts.delete.title', { name: contractName });
      if (impact.blocked > 0) {
        // The refusal the server would give (`RecordInUseException`), worded the same way.
        const refusal = { code: 'CONTRACT_HAS_COMPLIANCE_RECORDS', usages: [{ type: 'compliance_requirements', total: impact.recorded_requirements }] };
        await dialogs.alert({ title, message: deleteFailureReason(refusal, t, locale) });
        setBusy(false);
        return;
      }
      const { text, dependants } = contractDeleteImpactText(t, locale, impact);
      const confirmed = await dialogs.confirm({
        title,
        message: text,
        confirmLabel: dependants ? t('contracts.delete.confirmAnyway') : t('common:buttons.delete'),
        intent: 'danger',
      });
      if (!confirmed) {
        setBusy(false);
        return;
      }
      await beforeDelete();
      await api.delete(`/contracts/${contractId}`);
      // The page leaves first: its own contract is gone, the lists read again.
      queryClient.removeQueries({ queryKey: ['contracts', contractId], exact: true });
      onDeleted();
      void queryClient.invalidateQueries({
        predicate: (query) => ['contracts', 'contracts-ids', 'contracts-totals'].includes(String(query.queryKey[0])),
      });
    } catch (err) {
      setBusy(false);
      // A refusal (a requirement recorded meanwhile) says why, with its counts.
      const refusal = (err as { response?: { data?: DeleteFailure } })?.response?.data;
      onError(refusal?.code ? deleteFailureReason(refusal, t, locale) : getApiErrorMessage(err, t, t('contracts.delete.failed')));
    }
  };

  return (
    <Button
      variant="action-danger"
      startIcon={<DeleteIcon sx={{ fontSize: '14px !important' }} />}
      size="small"
      onClick={() => { void handleClick(); }}
      disabled={busy}
    >
      {t('common:buttons.delete')}
    </Button>
  );
}
