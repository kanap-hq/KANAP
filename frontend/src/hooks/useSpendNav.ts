import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api';
import { ModuleItemNavParams, ModuleItemNavResult } from './useModuleItemNav';
import { formatItemRef } from '../utils/item-ref';
import { statusScopeParams } from '../utils/statusScopeParams';
import { useBudgetColumns } from './useBudgetColumns';

export type SpendNavParams = ModuleItemNavParams;

/**
 * Spend/OPEX item navigation.
 *
 * Like the generic nav hook, but prevId/nextId are returned as OPX-N business
 * references (not UUIDs) so the workspace navigates straight to the friendly URL
 * — avoiding the UUID→OPX-N address-bar swap (and its flicker) on prev/next.
 * Indexing still uses the UUID list, matched against the resolved current id.
 */
export function useSpendNav(params: SpendNavParams): ModuleItemNavResult {
  const { id, sort, q, filters, year, statusScope, enabled = true } = params;
  const budgetColumns = useBudgetColumns();
  // Without a sort from the list, the default column's sort, once the setting is known.
  const effectiveSort = sort || budgetColumns.defaultSort;
  const effectiveQ = q || '';
  const effectiveFilters = filters || '';
  const effectiveYear = year ?? '';
  const effectiveStatusScope = statusScope ?? '';

  const { data } = useQuery({
    queryKey: ['spend-items-summary-ids', effectiveSort, effectiveQ, effectiveFilters, effectiveYear, effectiveStatusScope],
    queryFn: async () => {
      const apiParams: Record<string, string | number | undefined> = {
        sort: effectiveSort,
        q: effectiveQ || undefined,
        filters: effectiveFilters || undefined,
        // The list grid scopes by status; without the same scope here prev/next would walk a
        // different set from the one on screen (the endpoint otherwise defaults to enabled).
        ...statusScopeParams(statusScope),
      };
      if (year !== null && year !== undefined && year !== '') apiParams.year = year;
      const res = await api.get<{ ids: string[]; item_numbers: number[] }>('/spend-items/summary/ids', { params: apiParams });
      return { ids: res.data?.ids || [], itemNumbers: res.data?.item_numbers || [] };
    },
    enabled: enabled && (!!sort || budgetColumns.ready),
    staleTime: 30_000,
  });

  return useMemo(() => {
    const ids = data?.ids || [];
    const itemNumbers = data?.itemNumbers || [];
    // If the current item isn't in the list (e.g. excluded by the active filter, or the
    // list hasn't loaded), don't offer prev/next — never silently jump to the first row.
    const rawIdx = ids.indexOf(id);
    const found = rawIdx >= 0;
    const hasPrev = found && rawIdx > 0;
    const hasNext = found && rawIdx < ids.length - 1;
    const refAt = (i: number): string => {
      const n = itemNumbers[i];
      return n != null ? formatItemRef('opex', n) : ids[i];
    };
    return {
      ids,
      index: found ? rawIdx : 0,
      total: found ? ids.length : 0,
      hasPrev,
      hasNext,
      prevId: hasPrev ? refAt(rawIdx - 1) : null,
      nextId: hasNext ? refAt(rawIdx + 1) : null,
    };
  }, [data, id]);
}
