import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import api from '../../../api';
import { useKanapDialogs } from '../../design';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { ONBOARDING_QUERY_KEY } from '../../onboarding/useOnboarding';
import { armCreatedRecordFocus } from './creationFieldFocus';
import {
  cancelCreationClear,
  clearCreation,
  creationKey,
  getCreation,
  markRecordDeleted,
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
  time_entry: 'timeEntries',
  journal_entry: 'journalEntries',
  amounts: 'amounts',
  allocations: 'allocations',
  version: 'versions',
  contact: 'contacts',
  task: 'tasks',
  protocol: 'protocols',
  leg: 'hops',
  comment: 'comments',
  document_version: 'documentVersions',
  classification: 'classifications',
  contributor: 'contributors',
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

/**
 * The refusal of Cancel (`CREATION_CANCEL_EXPIRED`) for a family that has no delete: the record
 * stays, and the text says what to do instead of deleting it.
 */
const NO_DELETE_EXPIRED: Readonly<Record<string, string>> = {
  projects: 'errors:CREATION_CANCEL_EXPIRED_PROJECT',
};

export function creationChangeCount(changes: CreationChanges): number {
  return changes.fields + Object.values(changes.children || {}).reduce((sum, total) => sum + (total || 0), 0);
}

/**
 * The creation of a record just written, at its title (`useTitleCreation`, seven families) or from
 * its draft (`useDraftCreation`, every other family); leaving a new record's page never writes it. `startCreation` keeps the token of the create route and the
 * starting address; `beingCreated` holds while the person stays on that record, which then shows
 * Done and Cancel (`CreationActions`). `finishCreation` (Done) ends the creation and goes back where
 * it started, the record kept; `cancelCreation` (Cancel) deletes it, after a confirmation when more
 * than the title was given, and goes back there too, unless `{ leave: false }` (a leave already on
 * its way elsewhere). Leaving the record otherwise (another record on this page, or another page)
 * ends the creation: the record stays.
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

  /**
   * The record is written and the person is on it. `reference`: the record's business reference
   * (`COMP-5`), when its page may open by it. The page that shows the record puts the cursor in its
   * description, else its first field (`useCreationFieldFocus`).
   */
  const startCreation = React.useCallback((created: { recordId: string; token: string; returnTo: string; reference?: string | null }) => {
    armCreatedRecordFocus();
    setCreation(
      creationKey(family, created.recordId),
      { token: created.token, returnTo: created.returnTo },
      created.reference ? [creationKey(family, created.reference)] : [],
    );
  }, [family]);

  const finishCreation = React.useCallback(() => {
    const current = key ? getCreation(key) : undefined;
    if (key) clearCreation(key);
    navigate(current?.returnTo || listPath);
  }, [key, listPath, navigate]);

  /** True once the record is deleted; false when the person kept it, or the cancel was refused. */
  const cancelCreation = React.useCallback(async (options?: { leave?: boolean }): Promise<boolean> => {
    if (!key || !recordId || cancelling) return false;
    const current = getCreation(key);
    if (!current) return false;
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
        if (!confirmed) return false;
      }
      await api.delete(`${apiBase}/${recordId}/creation`, { data: { token: current.token } });
      // The description editor releases its lock as the page leaves. The record is already gone,
      // so the release would answer 404. Marked first, while the editor's address is still known.
      markRecordDeleted(recordId);
      clearCreation(key);
      if (options?.leave !== false) navigate(current.returnTo || listPath, { replace: true });
      // Marked stale, read again where shown: the page that showed the record has left it.
      await queryClient.invalidateQueries({
        predicate: (query) => queryKeyPrefixes.some((prefix) => String(query.queryKey[0]).startsWith(prefix)),
        refetchType: 'none',
      });
      // A first step done by this record is undone with it: its hint and the tile read it again.
      void queryClient.invalidateQueries({ queryKey: ONBOARDING_QUERY_KEY });
      return true;
    } catch (err) {
      // The creation is over (expired token): the action goes, the record is deleted as any other;
      // a family with no delete says what to do instead.
      if ((err as { response?: { data?: { code?: unknown } } })?.response?.data?.code === 'CREATION_CANCEL_EXPIRED') {
        clearCreation(key);
        const instead = NO_DELETE_EXPIRED[family];
        if (instead) {
          onError?.(t(instead));
          return false;
        }
      }
      onError?.(getApiErrorMessage(err, t, t('common:creation.cancelFailed')));
      return false;
    } finally {
      setCancelling(false);
    }
  }, [apiBase, cancelling, dialogs, family, key, listPath, navigate, onError, queryClient, queryKeyPrefixes, recordId, recordLabel, t]);

  return { beingCreated: !!entry, token: entry?.token ?? null, cancelling, startCreation, finishCreation, cancelCreation };
}
