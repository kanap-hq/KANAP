import { useQuery } from '@tanstack/react-query';
import api from '../../api';

/** The route that counts, per dimension value, the budget lines a limited person cannot read. */
export const HIDDEN_COUNTS_ENDPOINT = '/budget-lines/summary/hidden-by-value';

type Answer = { counts: Record<string, number> };

/**
 * Data-scoped access (spec §6.6): the lines the person cannot read on each value of the analytics
 * report, keyed by value id (lower case). Asked only when the aggregate says the person is limited
 * and at least one value is displayed; an unscoped person sends nothing. `from` is the report's
 * lifecycle window (`YYYY-MM-DD`), so the count covers the same lines as the visible totals.
 */
export function useHiddenCategoryCounts(opts: {
  axisId: string | null;
  valueIds: readonly string[];
  from: string;
  enabled: boolean;
}): Record<string, number> {
  const { axisId, valueIds, from, enabled } = opts;
  const query = useQuery({
    queryKey: ['budget-lines-hidden-by-value', axisId, from, valueIds],
    queryFn: async () => {
      const response = await api.get<Answer>(HIDDEN_COUNTS_ENDPOINT, {
        params: { axis: axisId, values: valueIds.join(','), from },
      });
      return response.data.counts;
    },
    enabled: enabled && Boolean(axisId) && valueIds.length > 0,
  });
  return query.data ?? {};
}
