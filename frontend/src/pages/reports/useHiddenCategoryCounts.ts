import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import api from '../../api';

/** The route that counts, per dimension value, the budget lines a limited person cannot read. */
export const HIDDEN_COUNTS_ENDPOINT = '/budget-lines/summary/hidden-by-value';

/** The most values one call names: the route refuses more with a 400. */
const MAX_VALUES_PER_CALL = 500;

type Answer = { counts: Record<string, number> };
export type HiddenCountScope = 'all' | 'opex' | 'capex';

/**
 * Data-scoped access (spec §6.6): the lines the person cannot read on each value of the analytics
 * report, keyed by value id (lower case). Asked only when the aggregate says the person is limited
 * and at least one value is displayed; an unscoped person sends nothing. `year` is the report's
 * first year and `scope` its tab; the server computes the lifecycle window from them, in UTC. More
 * than 500 values are asked in several calls, the route's own bound.
 *
 * A failed call contributes no count: the value shows no mention, never an invented one. The
 * mention is a secondary disclosure, so the screen does not turn it into an error.
 */
export function useHiddenCategoryCounts(opts: {
  axisId: string | null;
  valueIds: readonly string[];
  year: number;
  scope: HiddenCountScope;
  enabled: boolean;
}): Record<string, number> {
  const { axisId, valueIds, year, scope, enabled } = opts;
  const chunks = useMemo(() => {
    const out: string[][] = [];
    for (let at = 0; at < valueIds.length; at += MAX_VALUES_PER_CALL) out.push(valueIds.slice(at, at + MAX_VALUES_PER_CALL));
    return out;
  }, [valueIds]);
  const results = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: ['budget-lines-hidden-by-value', axisId, year, scope, chunk],
      queryFn: async () => {
        const response = await api.post<Answer>(HIDDEN_COUNTS_ENDPOINT, {
          axis: axisId,
          values: chunk,
          year,
          scope,
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
