import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { statusScopeParams } from '../utils/statusScopeParams';
import { listKeyOf, loadListContext, getWithListContext } from '../lib/listContext';

type ModuleItemNavData = {
  ids: string[];
  refs: Array<string | null | undefined>;
};

/**
 * Configuration for module item navigation (prev/next through list)
 */
export interface ModuleItemNavConfig {
  /** API endpoint to fetch IDs (e.g., '/spend-items/summary/ids') */
  endpoint: string;
  /** Query key prefix for caching (e.g., 'spend-items-summary-ids') */
  queryKey: string;
  /** Default sort order when none specified */
  defaultSort: string;
  /** Additional static params to include in API calls */
  extraParams?: Record<string, string | number | undefined>;
}

/**
 * Parameters for item navigation
 */
export interface ModuleItemNavParams {
  /** Current item ID */
  id: string;
  /** Sort order from URL */
  sort?: string | null;
  /** Search query from URL */
  q?: string | null;
  /** Filters JSON string from URL */
  filters?: string | null;
  /**
   * Saved list context (`ctx`) standing for filters too long for a URL. Read from the page URL
   * when not given and no `filters` are; the server applies it to the id list.
   */
  ctx?: string | null;
  /** Optional year parameter */
  year?: number | string | null;
  /**
   * Status scope of the list being navigated (the grid's scope: enabled / disabled /
   * invited / all). Omit only when the caller genuinely has no scope to mirror, in which
   * case the endpoint default applies — which may differ from what the user sees.
   */
  statusScope?: string | null;
  /** Additional dynamic params to include in API calls (e.g., assigneeUserId, teamId) */
  extraParams?: Record<string, string | number | undefined>;
  /** When false, skip the IDs request. Defaults to true. */
  enabled?: boolean;
}

/**
 * Return type for item navigation hook
 */
export interface ModuleItemNavResult {
  /** All IDs in the current list */
  ids: string[];
  /** Current item's index in the list */
  index: number;
  /** Total number of items */
  total: number;
  /** Whether there's a previous item */
  hasPrev: boolean;
  /** Whether there's a next item */
  hasNext: boolean;
  /** ID of previous item, or null */
  prevId: string | null;
  /** ID of next item, or null */
  nextId: string | null;
}

/**
 * Generic hook for item navigation (prev/next) within a module list.
 *
 * This hook fetches the list of IDs from the server and provides
 * prev/next navigation capabilities based on the current item's position.
 *
 * @example
 * ```typescript
 * // Create a module-specific hook
 * export function useOpexItemNav(params: ModuleItemNavParams) {
 *   return useModuleItemNav(params, {
 *     endpoint: '/spend-items/summary/ids',
 *     queryKey: 'spend-items-summary-ids',
 *     defaultSort: 'created_at:DESC',
 *   });
 * }
 *
 * // Use in a component
 * const { hasPrev, hasNext, prevId, nextId, total, index } = useOpexItemNav({
 *   id: currentItemId,
 *   sort: searchParams.get('sort'),
 *   q: searchParams.get('q'),
 *   filters: searchParams.get('filters'),
 * });
 * ```
 */
export function useModuleItemNav(
  params: ModuleItemNavParams,
  config: ModuleItemNavConfig
): ModuleItemNavResult {
  const { id, sort, q, filters, year, statusScope, extraParams: dynamicExtraParams, enabled = true } = params;
  const { endpoint, queryKey, defaultSort, extraParams: staticExtraParams } = config;
  const location = useLocation();
  const ctx = filters ? null : (params.ctx !== undefined ? params.ctx : new URLSearchParams(location.search).get('ctx'));

  const effectiveSort = sort || defaultSort;
  const effectiveQ = q || '';
  const effectiveFilters = filters || '';
  const effectiveYear = year ?? '';
  const effectiveStatusScope = statusScope ?? '';

  // Combine static config params with dynamic params from invocation
  const combinedExtraParams = { ...staticExtraParams, ...dynamicExtraParams };
  const extraParamsKey = JSON.stringify(combinedExtraParams);

  const { data } = useQuery({
    queryKey: [queryKey, effectiveSort, effectiveQ, effectiveFilters, ctx ?? '', effectiveYear, effectiveStatusScope, extraParamsKey],
    queryFn: async () => {
      const apiParams: Record<string, string | number | undefined> = {
        sort: effectiveSort,
        q: effectiveQ || undefined,
        filters: effectiveFilters || undefined,
        ctx: ctx || undefined,
        // Same scope mapping the grid uses, so the id list matches the visible rows.
        ...statusScopeParams(statusScope),
        ...combinedExtraParams,
      };

      // Only include year if it's provided
      if (year !== null && year !== undefined && year !== '') {
        apiParams.year = year;
      }

      // A saved list context applies when it is this list's (a link may carry another list's).
      if (apiParams.ctx) {
        const saved = await loadListContext(String(apiParams.ctx)).catch(() => null);
        if (!saved || saved.list !== listKeyOf(endpoint)) delete apiParams.ctx;
      }
      // Filters too long for a URL go as a saved list context (saved again if the server lost it).
      const res = await getWithListContext<{ ids?: string[]; refs?: Array<string | null | undefined> }>(endpoint, apiParams);
      return {
        ids: res.data?.ids || [],
        refs: res.data?.refs || [],
      } satisfies ModuleItemNavData;
    },
    enabled,
    staleTime: 30_000,
  });

  const { index, hasPrev, hasNext, total } = useMemo(() => {
    const ids = data?.ids || [];
    const rawIdx = id ? ids.indexOf(id) : -1;
    const found = rawIdx >= 0;
    return {
      index: found ? rawIdx : 0,
      hasPrev: found && rawIdx > 0,
      hasNext: found && rawIdx < ids.length - 1,
      total: found ? ids.length : 0,
    };
  }, [data, id]);

  const prevId = useMemo(() => {
    if (!data || !hasPrev) return null;
    const ref = data.refs[index - 1];
    if (typeof ref === 'string' && ref.trim()) return ref;
    return data.ids[index - 1] || null;
  }, [data, index, hasPrev]);

  const nextId = useMemo(() => {
    if (!data || !hasNext) return null;
    const ref = data.refs[index + 1];
    if (typeof ref === 'string' && ref.trim()) return ref;
    return data.ids[index + 1] || null;
  }, [data, index, hasNext]);

  return {
    ids: data?.ids || [],
    index,
    total,
    hasPrev,
    hasNext,
    prevId,
    nextId,
  };
}

// ============================================================================
// Pre-configured module-specific hooks
// ============================================================================

/**
 * Location item navigation
 */
export function useLocationItemNav(params: ModuleItemNavParams): ModuleItemNavResult {
  return useModuleItemNav(params, {
    endpoint: '/locations/ids',
    queryKey: 'locations-ids',
    defaultSort: 'location_reference:ASC',
  });
}

/**
 * Connection item navigation
 */
export function useConnectionItemNav(params: ModuleItemNavParams): ModuleItemNavResult {
  return useModuleItemNav(params, {
    endpoint: '/connections/ids',
    queryKey: 'connections-ids',
    defaultSort: 'connection_reference:ASC',
  });
}

/**
 * Interface item navigation
 */
export function useInterfaceItemNav(params: ModuleItemNavParams): ModuleItemNavResult {
  return useModuleItemNav(params, {
    endpoint: '/interfaces/ids',
    queryKey: 'interfaces-ids',
    defaultSort: 'interface_reference:ASC',
  });
}

/**
 * Incident item navigation
 */
export function useIncidentItemNav(params: ModuleItemNavParams): ModuleItemNavResult {
  return useModuleItemNav(params, {
    endpoint: '/incidents/ids',
    queryKey: 'incidents-ids',
    defaultSort: 'detected_at:DESC',
  });
}
