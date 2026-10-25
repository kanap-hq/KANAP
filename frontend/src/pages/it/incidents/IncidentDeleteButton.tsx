import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useKanapDialogs } from '../../../components/design';
import { useLocale } from '../../../i18n/useLocale';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { deleteFailureReason, type DeleteFailure } from '../../../utils/deleteRefusal';
import { fetchIncidentDeleteImpact, incidentDeleteImpactText } from './incidentDelete';
import DeleteIconButton from '../../../components/workspace/DeleteIconButton';

type Props = {
  incidentId: string;
  incidentName: string;
  disabled?: boolean;
  /** Saves the edits still pending, before the incident goes. */
  beforeDelete: () => Promise<unknown>;
  onDeleted: () => void;
  onError: (message: string) => void;
};

/**
 * Delete action of the incident page (incident administrators). It always asks first, with what
 * goes too and what loses its link ("Delete anyway" when something does). An incident holding
 * regulatory reporting data, or closed/cancelled, is refused up front: the dialog says why it
 * stays in the register.
 */
export default function IncidentDeleteButton({ incidentId, incidentName, disabled, beforeDelete, onDeleted, onError }: Props) {
  const { t } = useTranslation(['it', 'common', 'errors']);
  const locale = useLocale();
  const dialogs = useKanapDialogs();
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState(false);

  const handleClick = async () => {
    setBusy(true);
    try {
      const impact = await fetchIncidentDeleteImpact([incidentId]);
      const title = t('it:pages.incidents.delete.title', { name: incidentName });
      if (impact.refused.length > 0) {
        // The refusal the server would give (`RecordInUseException`), worded the same way.
        await dialogs.alert({ title, message: deleteFailureReason(impact.refused[0], t, locale) });
        setBusy(false);
        return;
      }
      const { text, dependants } = incidentDeleteImpactText(t, locale, impact);
      const confirmed = await dialogs.confirm({
        title,
        message: text,
        confirmLabel: dependants ? t('it:pages.incidents.delete.confirmAnyway') : t('common:buttons.delete'),
        intent: 'danger',
      });
      if (!confirmed) {
        setBusy(false);
        return;
      }
      await beforeDelete();
      await api.delete(`/incidents/${incidentId}`);
      onDeleted();
      void queryClient.invalidateQueries({
        predicate: (query) => ['incidents', 'incidents-ids', 'incident'].includes(String(query.queryKey[0])),
      });
    } catch (err) {
      setBusy(false);
      const refusal = (err as { response?: { data?: DeleteFailure } })?.response?.data;
      onError(refusal?.code ? deleteFailureReason(refusal, t, locale) : getApiErrorMessage(err, t, t('it:pages.incidents.delete.failed')));
    }
  };

  return (
    <DeleteIconButton onClick={() => { void handleClick(); }} disabled={busy || disabled} />
  );
}
