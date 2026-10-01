import { parsePagination, Sort } from '../pagination';
import { extractStatusFilterFromAgModel } from '../status-filter';
import { LifecycleScope, StatusState } from '../status';

/**
 * The parts of a list request every list endpoint reads: paging, sort, quick
 * search, column filters and the lifecycle choice (status column filter,
 * `status`, `includeDisabled`). The endpoint then resolves the lifecycle
 * scope with its own default.
 */
export interface ParsedListRequest {
  page: number;
  limit: number;
  skip: number;
  sort: Sort;
  /** Trimmed; undefined when empty. */
  q?: string;
  /** Column filters without the status column filter. */
  filters: Record<string, any>;
  /** `status` wins over the status column filter. */
  explicitStatus?: StatusState;
  /** The status column filter ticks no value: the list holds no line. */
  matchNone: boolean;
  includeDisabled: boolean;
}

export function parseListRequest(query: any): ParsedListRequest {
  const { page, limit, skip, sort, status, q, filters } = parsePagination(query ?? {});
  const { status: statusFromAg, matchNone, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
  return {
    page,
    limit,
    skip,
    sort,
    q: q?.trim() || undefined,
    filters: (sanitizedFilters ?? filters ?? {}) as Record<string, any>,
    explicitStatus: status ?? statusFromAg,
    matchNone: matchNone === true,
    includeDisabled: ['1', 'true'].includes(String(query?.includeDisabled ?? '').toLowerCase()),
  };
}

/** No ticked status selects nothing; an explicit status wins over "all"; otherwise "all" or the endpoint's default. */
export function resolveLifecycleScope(request: ParsedListRequest, fallback: LifecycleScope): LifecycleScope {
  if (request.matchNone) return 'none';
  if (request.explicitStatus === StatusState.DISABLED) return 'inactive';
  if (request.explicitStatus === StatusState.ENABLED) return 'active';
  return request.includeDisabled ? null : fallback;
}
