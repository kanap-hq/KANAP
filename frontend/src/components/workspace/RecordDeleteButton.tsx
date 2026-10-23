import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useKanapDialogs } from '../design';
import { useLocale } from '../../i18n/useLocale';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { recordRefusal } from '../../utils/deleteCheck';
import { deleteFailureReason, type DeleteFailure } from '../../utils/deleteRefusal';
import DeleteIconButton from './DeleteIconButton';

type Props = {
  /** API base of the record, also the first part of its query keys: `/companies`. */
  base: string;
  id: string;
  name: string;
  /** Message key shown when the delete fails without a known refusal code. */
  deleteFailed: string;
  /** What the confirmation says the delete does, when more than "This cannot be undone.": the links it removes. */
  confirmMessage?: string;
  /** False for a record whose delete nothing refuses (no `delete-check` route): the confirmation comes first. */
  checkUsages?: boolean;
  onDeleted: () => void;
};

/**
 * Delete action of a record page. The check runs first: a record something still uses cannot be
 * deleted, and the dialog says what uses it and to disable it instead (Close only). Otherwise it
 * asks, deletes, and hands back so the page can return to the list without loading the deleted
 * record again.
 */
export default function RecordDeleteButton({ base, id, name, deleteFailed, confirmMessage, checkUsages = true, onDeleted }: Props) {
  const { t } = useTranslation(['master-data', 'common', 'errors']);
  const locale = useLocale();
  const dialogs = useKanapDialogs();
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const resource = base.replace(/^\//, '');

  const handleClick = async () => {
    setBusy(true);
    const title = t('common:delete.recordTitle', { name });
    try {
      const refusal = checkUsages ? await recordRefusal(base, id) : null;
      if (refusal) {
        await dialogs.alert({ title, message: deleteFailureReason(refusal, t, locale) });
        setBusy(false);
        return;
      }
      const confirmed = await dialogs.confirm({
        title,
        message: confirmMessage ?? t('common:delete.cannotUndo'),
        confirmLabel: t('common:buttons.delete'),
        intent: 'danger',
      });
      if (!confirmed) {
        setBusy(false);
        return;
      }
      await api.delete(`${base}/${id}`);
      onDeleted();
      queryClient.removeQueries({ queryKey: [resource, id], exact: true });
      void queryClient.invalidateQueries({ queryKey: [resource], predicate: (q) => q.queryKey[1] !== id });
    } catch (err) {
      setBusy(false);
      const failure = (err as { response?: { data?: DeleteFailure } })?.response?.data;
      await dialogs.alert({
        title,
        message: failure?.code
          ? deleteFailureReason(failure, t, locale)
          : getApiErrorMessage(err, t, t(deleteFailed)),
      });
    }
  };

  return (
    <DeleteIconButton onClick={() => { void handleClick(); }} disabled={busy} />
  );
}
