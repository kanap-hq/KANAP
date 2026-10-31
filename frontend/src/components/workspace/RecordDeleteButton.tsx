import React from 'react';
import { Box, Checkbox, FormControlLabel, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { KanapDialog, useKanapDialogs } from '../design';
import { useLocale } from '../../i18n/useLocale';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { recordRefusal } from '../../utils/deleteCheck';
import { deleteFailureReason, type DeleteFailure } from '../../utils/deleteRefusal';
import DeleteIconButton from './DeleteIconButton';

/** A refusal the confirmation can lift (an interface's bindings). Checked, the delete body sends `apiKey: true`. */
export type DeleteRelatedOption = {
  /** Refusal codes this choice lifts, for example `INTERFACE_HAS_BINDINGS`. */
  lifts: string[];
  label: string;
  description?: string;
  /** Body key sent `true` when the choice is checked. */
  apiKey: string;
};

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
  /**
   * Delete through the list's bulk route (`DELETE ${base}/bulk` with `{ ids: [id] }`) instead of
   * `DELETE ${base}/${id}`. A record the server still refuses stays, with the reason.
   */
  bulk?: boolean;
  /**
   * When the check refuses with one of `lifts`, the confirmation explains why and offers this
   * choice instead of the refusal. Other callers leave it unset: a refusal stays a refusal.
   */
  deleteRelated?: DeleteRelatedOption;
  onDeleted: () => void;
};

type RelatedPrompt = { title: string; message: string };

function liftsRefusal(option: DeleteRelatedOption | undefined, refusal: DeleteFailure): option is DeleteRelatedOption {
  return !!option && !!refusal.code && option.lifts.includes(refusal.code);
}

/**
 * Delete action of a record page. The check runs first: a record something still uses cannot be
 * deleted, and the dialog says what uses it and to disable it instead (Close only). A refusal the
 * optional `deleteRelated` choice lifts (an interface's bindings) is a confirmation instead: it
 * explains the refusal and the delete stays unavailable until the choice is checked. Otherwise it
 * asks, deletes, and hands back so the page can return to the list without loading the deleted
 * record again.
 */
export default function RecordDeleteButton({ base, id, name, deleteFailed, confirmMessage, checkUsages = true, bulk = false, deleteRelated, onDeleted }: Props) {
  const { t } = useTranslation(['master-data', 'common', 'errors']);
  const locale = useLocale();
  const dialogs = useKanapDialogs();
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const [related, setRelated] = React.useState<RelatedPrompt | null>(null);
  const [checked, setChecked] = React.useState(false);
  const resource = base.replace(/^\//, '');

  const forgetRecord = () => {
    queryClient.removeQueries({ queryKey: [resource, id], exact: true });
    void queryClient.invalidateQueries({ queryKey: [resource], predicate: (q) => q.queryKey[1] !== id });
  };

  const reportFailure = async (err: unknown, title: string) => {
    const failure = (err as { response?: { data?: DeleteFailure } })?.response?.data;
    await dialogs.alert({
      title,
      message: failure?.code
        ? deleteFailureReason(failure, t, locale)
        : getApiErrorMessage(err, t, t(deleteFailed)),
    });
  };

  /**
   * Removes the record. With `bulk`, the list's route and one id; a refusal in the answer (a line
   * frozen between the check and the delete) is returned and nothing is treated as deleted.
   */
  const removeRecord = async (extra?: Record<string, true>): Promise<DeleteFailure | null> => {
    if (!bulk) {
      // No second argument when the body is empty: the call stays `delete(url)`.
      if (extra) await api.delete(`${base}/${id}`, { data: extra });
      else await api.delete(`${base}/${id}`);
      return null;
    }
    const res = await api.delete<{ deleted?: unknown; failed?: Array<DeleteFailure & { id?: string }> }>(
      `${base}/bulk`,
      { data: { ids: [id], ...extra } },
    );
    const deleted = new Set(Array.isArray(res.data?.deleted) ? res.data.deleted.map(String) : []);
    if (deleted.has(id)) return null;
    const failed = Array.isArray(res.data?.failed) ? res.data.failed : [];
    return failed.find((item) => !item.id || item.id === id) ?? failed[0] ?? null;
  };

  const finishDeleted = () => {
    onDeleted();
    forgetRecord();
  };

  const handleClick = async () => {
    setBusy(true);
    const title = t('common:delete.recordTitle', { name });
    try {
      const refusal = checkUsages ? await recordRefusal(base, id) : null;
      if (refusal && liftsRefusal(deleteRelated, refusal)) {
        setChecked(false);
        setRelated({ title, message: deleteFailureReason(refusal, t, locale) });
        setBusy(false);
        return;
      }
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
      const refused = await removeRecord();
      if (refused) {
        setBusy(false);
        await dialogs.alert({ title, message: refused.code ? deleteFailureReason(refused, t, locale) : (refused.reason || t(deleteFailed)) });
        return;
      }
      finishDeleted();
    } catch (err) {
      setBusy(false);
      await reportFailure(err, title);
    }
  };

  const closeRelated = () => {
    if (busy) return;
    setRelated(null);
    setChecked(false);
  };

  const confirmRelated = async () => {
    if (!deleteRelated || !checked || busy || !related) return;
    setBusy(true);
    try {
      const refused = await removeRecord({ [deleteRelated.apiKey]: true });
      if (refused) {
        setBusy(false);
        setRelated(null);
        await dialogs.alert({ title: related.title, message: refused.code ? deleteFailureReason(refused, t, locale) : (refused.reason || t(deleteFailed)) });
        return;
      }
      setRelated(null);
      finishDeleted();
    } catch (err) {
      setBusy(false);
      setRelated(null);
      await reportFailure(err, related.title);
    }
  };

  return (
    <>
      <DeleteIconButton onClick={() => { void handleClick(); }} disabled={busy} />
      {deleteRelated && (
        <KanapDialog
          open={related != null}
          title={related?.title ?? ''}
          onClose={closeRelated}
          onSave={() => { void confirmRelated(); }}
          saveLabel={t('common:buttons.delete')}
          saveVariant="action-danger"
          saveDisabled={!checked}
          saveLoading={busy}
        >
          <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary', whiteSpace: 'pre-line' }}>
            {related?.message}
          </Typography>
          <Typography sx={{ mt: 1, fontSize: 13, color: 'kanap.text.secondary' }}>
            {t('common:delete.cannotUndo')}
          </Typography>
          <Box sx={{ mt: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: '6px' }}>
            <FormControlLabel
              control={(
                <Checkbox
                  checked={checked}
                  onChange={(event) => setChecked(event.target.checked)}
                  disabled={busy}
                />
              )}
              label={deleteRelated.label}
            />
            {deleteRelated.description && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4 }}>
                {deleteRelated.description}
              </Typography>
            )}
          </Box>
        </KanapDialog>
      )}
    </>
  );
}
