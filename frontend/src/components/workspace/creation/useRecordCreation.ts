import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import api from '../../../api';
import { useKanapDialogs } from '../../design';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import {
  cancelCreationClear,
  clearCreation,
  creationKey,
  getCreation,
  scheduleCreationClear,
  setCreation,
  subscribeCreations,
} from './creationStore';

/** What was written since the creation (`GET <apiBase>/:id/creation`), children by kind. */
export type CreationChanges = { fields: number; children: Record<string, number> };

type Options = {
  /** The record family, as the API routes name it (`applications`). */
  family: string;
  /** The API base of the record (`/applications`): `GET|DELETE <apiBase>/:id/creation`. */
  apiBase: string;
  /** The record's uuid, null while nothing is created. */
  recordId: string | null;
  /** Where to go when no return address was kept. */
  listPath: string;
  /** The record as the confirmation names it ("The application"). */
  recordLabel: string;
  /** Query keys (first element prefixes) to mark stale once the record is gone (its lists). */
  queryKeyPrefixes?: string[];
  /** A refusal of the cancel (the record has interfaces, the creation is over), as for a delete. */
  onError?: (message: string) => void;
};

/** The words of the child kinds (`record-history.inventory.ts`); every other kind is a relation. */
const KIND_WORDS: Record<string, string> = {
  instance: 'deployments',
  link: 'links',
  attachment: 'attachments',
  document: 'documents',
  description: 'description',
};

/** "2 fields, 1 relation": what the person added since the creation, in a few words. */
export function describeCreationChanges(changes: CreationChanges, t: TFunction): string {
  const counts = new Map<string, number>();
  if (changes.fields > 0) counts.set('fields', changes.fields);
  for (const [kind, total] of Object.entries(changes.children || {})) {
    if (!total) continue;
    const word = KIND_WORDS[kind] ?? 'relations';
    counts.set(word, (counts.get(word) ?? 0) + total);
  }
  return Array.from(counts.entries())
    .map(([word, count]) => String(t(`common:creation.changes.${word}`, { count })))
    .join(', ');
}

export function creationChangeCount(changes: CreationChanges): number {
  return changes.fields + Object.values(changes.children || {}).reduce((sum, total) => sum + (total || 0), 0);
}

/**
 * The creation of a record created at its title (lot 1a): `startCreation` keeps the token of the
 * create route and the starting address; `beingCreated` holds while the person stays on that
 * record; `cancelCreation` deletes it (after a confirmation when more than the title was given)
 * and goes back where the creation started. Leaving the record (another record on this page, or
 * another page) ends the creation: the record stays.
 */
export default function useRecordCreation({
  family,
  apiBase,
  recordId,
  listPath,
  recordLabel,
  queryKeyPrefixes = [],
  onError,
}: Options) {
  const { t } = useTranslation('common');
  const dialogs = useKanapDialogs();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const key = recordId ? creationKey(family, recordId) : null;
  const entry = React.useSyncExternalStore(
    subscribeCreations,
    () => (key ? getCreation(key) : undefined),
    () => undefined,
  );
  const [cancelling, setCancelling] = React.useState(false);

  // Leaving the record ends its creation: the page goes, or shows another record.
  React.useEffect(() => {
    if (!key) return undefined;
    cancelCreationClear(key);
    return () => scheduleCreationClear(key);
  }, [key]);

  const startCreation = React.useCallback((created: { recordId: string; token: string; returnTo: string }) => {
    setCreation(creationKey(family, created.recordId), { token: created.token, returnTo: created.returnTo });
  }, [family]);

  const cancelCreation = React.useCallback(async () => {
    if (!key || !recordId || cancelling) return;
    const current = getCreation(key);
    if (!current) return;
    setCancelling(true);
    try {
      const preflight = await api.get<{ changes: CreationChanges }>(`${apiBase}/${recordId}/creation`, { params: { token: current.token } });
      const changes = preflight.data?.changes ?? { fields: 0, children: {} };
      if (creationChangeCount(changes) > 0) {
        const confirmed = await dialogs.confirm({
          title: t('common:creation.confirmTitle'),
          message: t('common:creation.confirmMessage', { record: recordLabel, changes: describeCreationChanges(changes, t) }),
          confirmLabel: t('common:buttons.delete'),
          cancelLabel: t('common:creation.keep'),
          intent: 'danger',
        });
        if (!confirmed) return;
      }
      await api.delete(`${apiBase}/${recordId}/creation`, { data: { token: current.token } });
      clearCreation(key);
      navigate(current.returnTo || listPath, { replace: true });
      // Marked stale, read again where shown: the page that showed the record has left it.
      await queryClient.invalidateQueries({
        predicate: (query) => queryKeyPrefixes.some((prefix) => String(query.queryKey[0]).startsWith(prefix)),
        refetchType: 'none',
      });
    } catch (err) {
      // The creation is over (expired token): the action goes, the record is deleted as any other.
      if ((err as { response?: { data?: { code?: unknown } } })?.response?.data?.code === 'CREATION_CANCEL_EXPIRED') clearCreation(key);
      onError?.(getApiErrorMessage(err, t, t('common:creation.cancelFailed')));
    } finally {
      setCancelling(false);
    }
  }, [apiBase, cancelling, dialogs, key, listPath, navigate, onError, queryClient, queryKeyPrefixes, recordId, recordLabel, t]);

  return { beingCreated: !!entry, cancelling, startCreation, cancelCreation };
}
