import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { recordRefusal } from '../../../utils/deleteCheck';
import { deleteFailureReason } from '../../../utils/deleteRefusal';
import { useKanapDialogs } from '../../../components/design';

export type SettingsDeleteItem = {
  id: string;
  name: string;
  /** The list's address: the item is deleted at `<base>/<id>`. */
  base: string;
  /** The delete can be refused: `<base>/delete-check` is asked first. */
  check?: boolean;
  /** The confirmation's sentence, when the delete does more than remove the item. */
  message?: string;
  /** The error shown when the delete fails. */
  failed: string;
};

/**
 * The delete of a settings item (`<base>/<id>`). Where the delete can be refused (`check`), it is
 * asked first: a refused item gets the refusal and why, with Close only. Otherwise the item is
 * confirmed by its name, then deleted, and `onDeleted` runs; a failed delete goes to `onError`.
 */
export function useSettingsDelete({ canEdit, onDeleted, onError }: {
  canEdit: boolean;
  onDeleted: () => void;
  onError: (message: string) => void;
}): (item: SettingsDeleteItem) => Promise<void> {
  const { t, i18n } = useTranslation(['portfolio', 'common']);
  const language = i18n?.resolvedLanguage || i18n?.language || 'en';
  const dialogs = useKanapDialogs();

  return useCallback(async (item: SettingsDeleteItem) => {
    if (!canEdit) return;
    const title = t('common:delete.recordTitle', { name: item.name });
    if (item.check) {
      const refusal = await recordRefusal(item.base, item.id);
      if (refusal) {
        await dialogs.alert({ title, message: deleteFailureReason(refusal, t, language) });
        return;
      }
    }
    if (!await dialogs.confirm({
      title,
      message: item.message ?? t('common:delete.cannotUndo'),
      confirmLabel: t('common:buttons.delete'),
      intent: 'danger',
    })) return;
    try {
      await api.delete(`${item.base}/${item.id}`);
      onDeleted();
    } catch (e: any) {
      onError(getApiErrorMessage(e, t, item.failed));
    }
  }, [canEdit, dialogs, language, onDeleted, onError, t]);
}
