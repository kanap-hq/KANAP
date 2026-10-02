import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ModuleItemNavParams, ModuleItemNavResult } from './useModuleItemNav';
import { formatItemRef } from '../utils/item-ref';
import { statusScopeParams } from '../utils/statusScopeParams';
import { useBudgetColumns } from './useBudgetColumns';
import { getWithListContext } from '../lib/listContext';

type Neighbor = { id: string; item_number: number | null } | null;
type NeighborsResponse = { index: number | null; total: number; prev: Neighbor; next: Neighbor };

/** Where a line stands in its list: `at` is the id or reference it was asked for. */
type Neighbors = { at: string; index: number | null; total: number; prevRef: string | null; nextRef: string | null };

export type BudgetItemNavConfig = {
  kind: 'opex' | 'capex';
  /** `/spend-items/summary/neighbors` */
  endpoint: string;
  queryKey: string;
  /** The workspace's detail query of a line, by the id or reference in its route. */
  detailQuery: (ref: string) => { queryKey: unknown[]; queryFn: () => Promise<unknown> };
};

/** How long a neighbour answer or a prefetched detail is reused without asking again. */
const NAV_STALE_MS = 30_000;

/**
 * Previous / next of an OPEX or CAPEX workspace (lot 1C). The server answers where the line stands
 * in the list (`summary/neighbors`: index, total, previous and next) instead of every id of the
 * list. The line is the one of the route (`OPX-12` or a uuid), not the loaded detail: the position
 * follows a click at once, while the next detail still loads, so fast clicks keep moving. The
 * previous and next lines' details and positions are prefetched, so the next click shows its line
 * and its own previous / next at once. Until a position arrives, a step from the line before or
 * after gives it (index ± 1, same total).
 */
export function useBudgetItemNav(params: ModuleItemNavParams, config: BudgetItemNavConfig): ModuleItemNavResult {
  const { id, sort, q, filters, statusScope, enabled = true } = params;
  const { kind, endpoint, queryKey, detailQuery } = config;
  const budgetColumns = useBudgetColumns();
  const queryClient = useQueryClient();
  // Without a sort from the list, the default column's sort, once the setting is known.
  const effectiveSort = sort || budgetColumns.defaultSort;
  const listParams = useMemo(() => ({
    sort: effectiveSort,
    ...(q ? { q } : {}),
    ...(filters ? { filters } : {}),
    // The list grid scopes by status; without the same scope here prev/next would walk a
    // different set from the one on screen (the endpoint otherwise defaults to enabled).
    ...statusScopeParams(statusScope),
  }), [effectiveSort, q, filters, statusScope]);
  const listKey = JSON.stringify(listParams);

  const neighborsQuery = useMemo(() => (at: string) => ({
    queryKey: [queryKey, listKey, at],
    queryFn: async ({ signal }: { signal?: AbortSignal }): Promise<Neighbors> => {
      const res = await getWithListContext<NeighborsResponse>(endpoint, { ...listParams, id: at }, { signal });
      const ref = (n: Neighbor) => (n ? (n.item_number != null ? formatItemRef(kind, n.item_number) : n.id) : null);
      return { at, index: res.data?.index ?? null, total: res.data?.total ?? 0, prevRef: ref(res.data?.prev ?? null), nextRef: ref(res.data?.next ?? null) };
    },
    staleTime: NAV_STALE_MS,
  }), [endpoint, kind, listKey, listParams, queryKey]);

  const ready = enabled && !!id && (!!sort || budgetColumns.ready);
  const { data, isPlaceholderData } = useQuery({
    ...neighborsQuery(id),
    enabled: ready,
    // One step from a known line: its index and total follow, the far neighbour is not known yet.
    placeholderData: (previous: Neighbors | undefined) => {
      if (!previous || previous.index == null || previous.at === id) return undefined;
      if (previous.nextRef === id) return { at: id, index: previous.index + 1, total: previous.total, prevRef: previous.at, nextRef: null };
      if (previous.prevRef === id) return { at: id, index: previous.index - 1, total: previous.total, prevRef: null, nextRef: previous.at };
      return undefined;
    },
  });

  // The lines next door: their details (the workspace shows them at once) and their own positions.
  const prevRef = data && !isPlaceholderData ? data.prevRef : null;
  const nextRef = data && !isPlaceholderData ? data.nextRef : null;
  useEffect(() => {
    if (!ready) return;
    for (const ref of [nextRef, prevRef]) {
      if (!ref) continue;
      void queryClient.prefetchQuery({ ...detailQuery(ref), staleTime: NAV_STALE_MS });
      void queryClient.prefetchQuery(neighborsQuery(ref));
    }
  }, [ready, prevRef, nextRef, queryClient, detailQuery, neighborsQuery]);

  return useMemo(() => {
    // A line the list does not hold (filtered out, or not loaded yet) gets no previous / next:
    // never a silent jump to the first row.
    const found = !!data && data.at === id && data.index != null;
    return {
      ids: [],
      index: found ? data!.index! : 0,
      total: found ? data!.total : 0,
      hasPrev: found && !!data!.prevRef,
      hasNext: found && !!data!.nextRef,
      prevId: found ? data!.prevRef : null,
      nextId: found ? data!.nextRef : null,
    };
  }, [data, id]);
}
