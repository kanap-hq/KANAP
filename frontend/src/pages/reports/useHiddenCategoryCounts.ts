import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import api from '../../api';

/** The route that counts, per dimension value, the budget lines a limited person cannot read. */
export const HIDDEN_COUNTS_ENDPOINT = '/budget-lines/summary/hidden-by-value';

/** The most values one call names: the route refuses more with a 400. */
const MAX_VALUES_PER_CALL = 500;

type Answer = { counts: Record<string, number> };

/**
 * Data-scoped access (spec §6.6): the lines the person cannot read on each value of the analytics
 * report, keyed by value id (lower case). Asked only when the aggregate says the person is limited
 * and at least one value is displayed; an unscoped person sends nothing. `from` is the report's
 * lifecycle window (`YYYY-MM-DD`), so the count covers the same lines as the visible totals. More
 * than 500 values are asked in several calls, the route's own bound.
 */
export function useHiddenCategoryCounts(opts: {
  axisId: string | null;
  valueIds: readonly string[];
  from: string;
  enabled: boolean;
}): Record<string, number> {
  const { axisId, valueIds, from, enabled } = opts;
  const chunks = useMemo(() => {
    const out: string[][] = [];
    for (let at = 0; at < valueIds.length; at += MAX_VALUES_PER_CALL) out.push(valueIds.slice(at, at + MAX_VALUES_PER_CALL));
    return out;
  }, [valueIds]);
  const results = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: ['budget-lines-hidden-by-value', axisId, from, chunk],
      queryFn: async () => {
        const response = await api.get<Answer>(HIDDEN_COUNTS_ENDPOINT, {
          params: { axis: axisId, values: chunk.join(','), from },
        });
        return response.data.counts;
      },
      enabled: enabled && Boolean(axisId) && chunk.length > 0,
    })),
  });
  return useMemo(() => {
    const counts: Record<string, number> = {};
    for (const result of results) Object.assign(counts, result.data ?? {});
    return counts;
  }, [results]);
}
