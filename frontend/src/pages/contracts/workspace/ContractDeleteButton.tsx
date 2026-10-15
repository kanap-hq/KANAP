import React from 'react';
import { Button } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useKanapDialogs } from '../../../components/design';
import { useLocale } from '../../../i18n/useLocale';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
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
 * Delete action of the contract page. A contract with links or with its own website links,
 * attachments or recorded requirements asks first, with the counts; one with nothing goes at once.
 */
export default function ContractDeleteButton({ contractId, contractName, beforeDelete, onDeleted, onError }: Props) {
  const { t } = useTranslation(['ops', 'common']);
  const locale = useLocale();
  const dialogs = useKanapDialogs();
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState(false);

  const handleClick = async () => {
    setBusy(true);
    try {
      const text = contractDeleteImpactText(t, locale, await fetchContractDeleteImpact([contractId]));
      if (text) {
        const confirmed = await dialogs.confirm({
          title: t('contracts.delete.title', { name: contractName }),
          message: text,
          confirmLabel: t('contracts.delete.confirmAnyway'),
          intent: 'danger',
        });
        if (!confirmed) {
          setBusy(false);
          return;
        }
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
      onError(getApiErrorMessage(err, t, t('contracts.delete.failed')));
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
