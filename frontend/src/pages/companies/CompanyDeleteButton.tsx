import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useKanapDialogs } from '../../components/design';
import { useLocale } from '../../i18n/useLocale';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { recordRefusal } from '../../utils/deleteCheck';
import { deleteFailureReason, type DeleteFailure } from '../../utils/deleteRefusal';
import DeleteIconButton from '../../components/workspace/DeleteIconButton';

type Props = {
  companyId: string;
  companyName: string;
  onDeleted: () => void;
};

/**
 * Delete action of the company page. The check runs first: a company something still uses
 * cannot be deleted, and the dialog says what uses it and to disable it instead (Close only).
 * Otherwise it asks, deletes, and hands back so the page can return to the list without
 * loading the deleted company again.
 */
export default function CompanyDeleteButton({ companyId, companyName, onDeleted }: Props) {
  const { t } = useTranslation(['master-data', 'common', 'errors']);
  const locale = useLocale();
  const dialogs = useKanapDialogs();
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState(false);

  const handleClick = async () => {
    setBusy(true);
    const title = t('common:delete.recordTitle', { name: companyName });
    try {
      const refusal = await recordRefusal('/companies', companyId);
      if (refusal) {
        await dialogs.alert({ title, message: deleteFailureReason(refusal, t, locale) });
        setBusy(false);
        return;
      }
      const confirmed = await dialogs.confirm({
        title,
        message: t('common:delete.cannotUndo'),
        confirmLabel: t('common:buttons.delete'),
        intent: 'danger',
      });
      if (!confirmed) {
        setBusy(false);
        return;
      }
      await api.delete(`/companies/${companyId}`);
      onDeleted();
      queryClient.removeQueries({ queryKey: ['companies', companyId], exact: true });
      void queryClient.invalidateQueries({ queryKey: ['companies'], predicate: (q) => q.queryKey[1] !== companyId });
    } catch (err) {
      setBusy(false);
      const failure = (err as { response?: { data?: DeleteFailure } })?.response?.data;
      await dialogs.alert({
        title,
        message: failure?.code
          ? deleteFailureReason(failure, t, locale)
          : getApiErrorMessage(err, t, t('companies.messages.deleteFailed')),
      });
    }
  };

  return (
    <DeleteIconButton onClick={() => { void handleClick(); }} disabled={busy} />
  );
}
