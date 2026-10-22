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
}: UseRelationsOptions) {
  const { t } = useTranslation('it');
  const queryClient = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);

  const { data } = useQuery({
    queryKey,
    queryFn: async () => (await api.get<TData>(path)).data,
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
      const rows = (prev as Record<string, unknown>)[kind] as AnyRow[] | null | undefined;
      return { ...prev, [kind]: rows ? rows.filter((row) => row.id !== targetId) : rows };
    });
    try {
      await api.delete(`${path}/${kind}/${targetId}`);
    } catch (e) {
      if (previous) queryClient.setQueryData(queryKey, previous);
      failed(e);
      return;
    }
    await refresh();
  }, [failed, path, queryClient, queryKey, refresh]);

  return { data, error, setError, link, unlink, refresh };
}
