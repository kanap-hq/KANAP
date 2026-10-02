import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'crypto';

/**
 * A list context: the column filters of a list saved under a short id, so a
 * large filter state travels as `ctx=<id>` instead of tens of kilobytes of
 * query string. "Every supplier but one" on the OPEX list is 31 KB of
 * `filters`: past nginx's 8 KB request line, a page request, a reload of the
 * page or a link opened in a new tab answered 431.
 *
 * Only the filters are saved: the sort, the search and the status scope stay
 * readable in the request itself. A request carrying `ctx` gets the saved
 * filters as its `filters` parameter, nothing else, so a context can never set
 * a page size, a status scope or any other parameter of the endpoint it is
 * used with.
 *
 * The id is content-addressed: the same tenant, list and filters always give
 * the same id, so saving a state twice keeps one row. Set filter values are
 * sorted first: the same selection in another order is the same state.
 */

/** Length of a list context id: 22 base64url characters, 132 bits of the SHA-256. */
export const LIST_CONTEXT_ID_LENGTH = 22;
export const LIST_CONTEXT_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Largest state accepted, serialized: a selection of thousands of values. */
export const MAX_LIST_CONTEXT_STATE_BYTES = 256 * 1024;
/**
 * Deepest nesting accepted inside `filters`: a column's model, its conditions
 * and their values sit three to four levels down. Bounded so that a crafted
 * state cannot exhaust the stack of the canonical serialization (400, not 500).
 */
export const MAX_LIST_CONTEXT_FILTER_DEPTH = 8;
const LIST_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,127}$/;

/** Unused for this long (days), a list context is purged. */
export const LIST_CONTEXT_RETENTION_DAYS = 90;

export type ListContextFilters = Record<string, unknown>;
/** What a list context holds: the column filters of the list, nothing else. */
export type ListContextState = { filters?: ListContextFilters };

/** JSON with every object's keys sorted: two equal states serialize the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The id of a state: base64url of SHA-256 over tenant, list and canonical state, first 22 characters. */
export function listContextId(tenantId: string, listKey: string, state: ListContextState): string {
  return createHash('sha256')
    .update(`${tenantId}\n${listKey}\n${canonicalJson(state)}`, 'utf8')
    .digest('base64url')
    .slice(0, LIST_CONTEXT_ID_LENGTH);
}

export function isListContextId(value: unknown): value is string {
  return typeof value === 'string' && LIST_CONTEXT_ID_PATTERN.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** True when objects and arrays nest deeper than `max` levels (walked without recursion). */
function nestsDeeperThan(value: unknown, max: number): boolean {
  const stack: Array<[unknown, number]> = [[value, 1]];
  while (stack.length) {
    const [current, depth] = stack.pop()!;
    if (!current || typeof current !== 'object') continue;
    if (depth > max) return true;
    for (const child of Object.values(current as Record<string, unknown>)) {
      if (child && typeof child === 'object') stack.push([child, depth + 1]);
    }
  }
  return false;
}

/** Set filter values in one order (their canonical JSON), so a selection gives one state whatever its order. */
function sortedSetValues(values: unknown[]): unknown[] {
  const keyed = values.map((value) => [canonicalJson(value), value] as const);
  keyed.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return keyed.map(([, value]) => value);
}

/** The filters with each set filter's values sorted (the canonical form of a filter state). */
function canonicalFilters(filters: ListContextFilters): ListContextFilters {
  const out: ListContextFilters = {};
  for (const [column, model] of Object.entries(filters)) {
    out[column] = isPlainObject(model) && model.filterType === 'set' && Array.isArray(model.values)
      ? { ...model, values: sortedSetValues(model.values) }
      : model;
  }
  return out;
}

/** The list key a client names its context with (its endpoint, e.g. `spend-items`). */
export function normalizeListKey(raw: unknown): string {
  const key = typeof raw === 'string' ? raw.trim().replace(/^\/+/, '') : '';
  if (!LIST_KEY_PATTERN.test(key)) {
    throw new BadRequestException('A list context needs a list name: letters, digits, "/", "_", "." or "-", at most 128 characters.');
  }
  return key;
}

/**
 * Validates a state sent by a client: `{ filters }`, the column filters of the
 * list as an object (or its JSON text, read as the object, so the same filters
 * give the same id whatever their spelling). Any other parameter is refused:
 * the sort, the search and the status scope stay inline. Empty filters give an
 * empty state. Nested too deep: 400. Too large: 413.
 */
export function normalizeListContextState(raw: unknown): ListContextState {
  if (!isPlainObject(raw)) throw new BadRequestException('A list context state must be an object: { filters }.');
  for (const key of Object.keys(raw)) {
    if (key !== 'filters') {
      throw new BadRequestException(`"${key}" cannot be saved in a list context: it holds the column filters only.`);
    }
  }
  let filters: unknown = raw.filters;
  if (typeof filters === 'string') {
    if (!filters.trim()) return {};
    try {
      filters = JSON.parse(filters);
    } catch {
      throw new BadRequestException('The filters of a list context must be a JSON object.');
    }
  }
  if (filters === undefined || filters === null) return {};
  if (!isPlainObject(filters)) throw new BadRequestException('The filters of a list context must be a JSON object.');
  if (nestsDeeperThan(filters, MAX_LIST_CONTEXT_FILTER_DEPTH)) {
    throw new BadRequestException(`The filters of a list context nest at most ${MAX_LIST_CONTEXT_FILTER_DEPTH} levels deep.`);
  }
  if (!Object.keys(filters).length) return {};
  const state: ListContextState = { filters: canonicalFilters(filters) };
  if (Buffer.byteLength(canonicalJson(state), 'utf8') > MAX_LIST_CONTEXT_STATE_BYTES) {
    throw new PayloadTooLargeException(`A list context state is limited to ${MAX_LIST_CONTEXT_STATE_BYTES / 1024} KB.`);
  }
  return state;
}

/**
 * The request query once its list context is applied: the request's own
 * parameters without `ctx`, plus the saved filters as `filters` when the
 * request carries none (inline filters override the context). Nothing else of
 * a stored state is read, also from a row saved before contexts held filters
 * only. Every parser downstream (`parseListRequest`, `parsePagination`, a
 * service reading `query.filters`) then reads one plain query, as if the
 * client had sent the filters inline.
 */
export function mergeListContextQuery(state: Record<string, unknown> | null | undefined, query: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query ?? {})) {
    if (key === 'ctx' || value === undefined) continue;
    merged[key] = value;
  }
  const saved = state?.filters;
  if (merged.filters === undefined && isPlainObject(saved) && Object.keys(saved).length) {
    merged.filters = JSON.stringify(saved);
  }
  return merged;
}
