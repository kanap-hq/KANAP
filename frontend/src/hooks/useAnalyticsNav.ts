import { useMemo } from 'react';
import { useModuleItemNav, ModuleItemNavParams, ModuleItemNavResult } from './useModuleItemNav';
import { useAnalyticsAxes } from './useAnalyticsAxes';

export type AnalyticsNavParams = ModuleItemNavParams;

/**
 * Prev/next through an analytics dimension's values, in the list's sort, filters and status scope.
 * Pass the dimension as `extraParams: { axis_id }` so the walk stays inside it.
 */
export function useAnalyticsNav(params: AnalyticsNavParams): ModuleItemNavResult {
  return useModuleItemNav(params, {
    endpoint: '/analytics-categories/ids',
    queryKey: 'analytics-ids',
    defaultSort: 'name:ASC',
  });
}

/** Pure core of `useAnalyticsDimensionNav`: the position of `id` in `ids`. */
export function navInIds(ids: string[], id: string): ModuleItemNavResult {
  const index = ids.indexOf(id);
  if (index < 0) return { ids, index: 0, total: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null };
  return {
    ids,
    index,
    total: ids.length,
    hasPrev: index > 0,
    hasNext: index < ids.length - 1,
    prevId: index > 0 ? ids[index - 1] : null,
    nextId: index < ids.length - 1 ? ids[index + 1] : null,
  };
}

/** Prev/next through the dimensions, in their order, disabled ones included (the page lists them all). */
export function useAnalyticsDimensionNav(id: string, options?: { enabled?: boolean }): ModuleItemNavResult {
  const { axes } = useAnalyticsAxes({ enabled: options?.enabled });
  return useMemo(() => navInIds(axes.map((axis) => axis.id), id), [axes, id]);
}
