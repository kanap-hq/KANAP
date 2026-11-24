import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../api';

/** Cache key for the ids of criteria that are enabled now. */
export const enabledCriterionIdsQueryKey = ['portfolio-criteria', 'enabled-ids'] as const;

export type EnabledCriteriaState = {
  /** Enabled criterion ids once the catalogue is known. Null while it loads or after a failed read. */
  ids: readonly string[] | null;
  /** The catalogue is still loading, so a score must not flash before the rule can apply. */
  pending: boolean;
  /** The catalogue could not be read. Callers keep the stored score. */
  unavailable: boolean;
};

type CriterionRow = { id?: string; enabled?: boolean };

/**
 * The criteria that count as answered. One read for the page, shared by the
 * request header and the requests list. The evaluation tab loads the same
 * catalogue for its form and applies the same display rule itself.
 */
export function useEnabledCriterionIds(): EnabledCriteriaState {
  const query = useQuery({
    queryKey: enabledCriterionIdsQueryKey,
    queryFn: async () => {
      const res = await api.get<CriterionRow[]>('/portfolio/criteria');
      const rows = Array.isArray(res.data) ? res.data : [];
      return rows.filter((row) => row.enabled === true && row.id).map((row) => String(row.id));
    },
  });

  return useMemo(() => ({
    ids: query.isSuccess ? (query.data ?? []) : null,
    pending: query.isLoading,
    unavailable: query.isError,
  }), [query.data, query.isError, query.isLoading, query.isSuccess]);
}
