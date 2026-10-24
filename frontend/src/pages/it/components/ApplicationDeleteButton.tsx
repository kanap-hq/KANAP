import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useKanapDialogs } from '../../../components/design';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { deleteFailureReason, removedWithLinks } from '../../../utils/deleteRefusal';
import { useLocale } from '../../../i18n/useLocale';
import { applicationDeleteCheck } from '../applicationDeleteCheck';
import DeleteIconButton from '../../../components/workspace/DeleteIconButton';

type Props = {
  applicationId: string;
  applicationName: string;
  onDeleted: () => void;
  onError: (message: string) => void;
};

/**
 * Delete action of the application workspace: ask the check, then either the refusal (it has
 * interfaces) with Close only, or the confirmation counting the deployments that go; delete,
 * refresh the applications list, then hand control back so the page can leave.
 */
export default function ApplicationDeleteButton({ applicationId, applicationName, onDeleted, onError }: Props) {
  const { t } = useTranslation(['it', 'common']);
  const dialogs = useKanapDialogs();
  const queryClient = useQueryClient();
  const locale = useLocale();
  const [deleting, setDeleting] = React.useState(false);

  const handleClick = async () => {
    const title = t('common:delete.recordTitle', { name: applicationName });
    // A failed check leaves the usual confirmation: the delete still refuses what it must.
    const check = await applicationDeleteCheck([applicationId]).catch(() => null);
    const refusal = check?.refused.find((item) => item.id === applicationId);
    if (refusal) {
      await dialogs.alert({ title, message: deleteFailureReason(refusal, t, locale) });
      return;
    }
    const confirmed = await dialogs.confirm({
      title,
      message: check?.removes.length
        ? t('workspace.application.deleteMessageWithRemoved', { name: applicationName, removed: removedWithLinks(check.removes, t('pages.applications.delete.links', { count: 1 }), t, locale) })
        : t('workspace.application.deleteMessage', { name: applicationName }),
      confirmLabel: t('common:buttons.delete'),
      intent: 'danger',
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      await api.delete(`/applications/${applicationId}`);
      await queryClient.invalidateQueries({
        predicate: (query) => ['applications', 'app-filter-values'].some((key) => String(query.queryKey[0]).startsWith(key)),
      });
      onDeleted();
    } catch (err: any) {
      setDeleting(false);
      onError(getApiErrorMessage(err, t, t('messages.deleteApplicationFailed')));
    }
  };

  return (
    <DeleteIconButton onClick={() => { void handleClick(); }} disabled={deleting} />
  );
}
