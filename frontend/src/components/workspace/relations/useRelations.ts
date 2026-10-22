import React from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import type { AnyRow } from './types';

export type UseRelationsOptions = {
  /** `GET` reads the tab; `POST` and `DELETE` link under it (`${path}/${kind}`). */
  path: string;
  queryKey: QueryKey;
  /** Called after a link or unlink is saved (the tab badge counts some of them). */
  onChange?: () => void;
  /**
   * On link, drop that id from `suggestions` at once. The row appears in its section with the refetch.
   * Applications only.
   */
  dropLinkedSuggestion?: boolean;
  /**
   * The key of the object that holds this kind's rows, when they sit one level down
   * (an asset's `assets.contains`). Undefined: the rows are at the top (`data[kind]`).
   */
  groupOf?: (kind: string) => string | undefined;
  /** `GET` reads this route instead of `path`, when the tab's read has its own (`/assets/:id/relations-tab`). */
  readPath?: string;
};

type WithSuggestions = { suggestions?: Array<{ id: string }> };

/**
 * The read and the link/unlink of a Relations tab. Unlink removes the row at once and puts it back
 * when the server refuses. Link posts `{ id }` and refetches.
 */
export function useRelations<TData extends object>({
  path,
  queryKey,
  onChange,
  dropLinkedSuggestion = false,
  groupOf,
  readPath,
}: UseRelationsOptions) {
  const { t } = useTranslation('it');
  const queryClient = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);

  const { data } = useQuery({
    queryKey,
    queryFn: async () => (await api.get<TData>(readPath ?? path)).data,
  });

  const refresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
    onChange?.();
  }, [onChange, queryClient, queryKey]);

  const failed = React.useCallback((e: unknown) => {
    setError(getApiErrorMessage(e, t, t('messages.saveRelationsFailed')));
  }, [t]);

  const link = React.useCallback(async (kind: string, targetId: string) => {
    setError(null);
    if (dropLinkedSuggestion) {
      queryClient.setQueryData<TData>(queryKey, (prev) => {
        if (!prev) return prev;
        const suggestions = (prev as TData & WithSuggestions).suggestions;
        if (!suggestions) return prev;
        return { ...prev, suggestions: suggestions.filter((row) => row.id !== targetId) };
      });
    }
    try {
      await api.post(`${path}/${kind}`, { id: targetId });
    } catch (e) {
      failed(e);
    }
    await refresh();
  }, [dropLinkedSuggestion, failed, path, queryClient, queryKey, refresh]);

  const unlink = React.useCallback(async (kind: string, targetId: string) => {
    setError(null);
    const previous = queryClient.getQueryData<TData>(queryKey);
    queryClient.setQueryData<TData>(queryKey, (prev) => {
      if (!prev) return prev;
      const group = groupOf?.(kind);
      const holder = (group ? (prev as Record<string, unknown>)[group] : prev) as Record<string, unknown> | null | undefined;
      if (!holder) return prev;
      const rows = holder[kind] as AnyRow[] | null | undefined;
      const next = { ...holder, [kind]: rows ? rows.filter((row) => row.id !== targetId) : rows };
      return group ? { ...prev, [group]: next } : (next as TData);
    });
    try {
      await api.delete(`${path}/${kind}/${targetId}`);
    } catch (e) {
      if (previous) queryClient.setQueryData(queryKey, previous);
      failed(e);
      return;
    }
    await refresh();
  }, [failed, groupOf, path, queryClient, queryKey, refresh]);

  return { data, error, setError, link, unlink, refresh };
}
