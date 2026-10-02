import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import api from '../api';

/**
 * Large list filters travel as a short saved id (`ctx=<id>`), everywhere a list state goes: API
 * calls, the page URL, cell links and the stored list context. "Every supplier but one" on the
 * OPEX list is 31 KB of `filters`: past the 8 KB request line of the web server, a page request, a
 * reload or a link opened in a new tab answered 431.
 *
 * Only the column filters are saved; the sort, the search and the status scope stay readable in
 * the URL. Filters up to LIST_CONTEXT_INLINE_LIMIT characters (URL-encoded) stay inline too, so
 * short states keep readable links. The server merges a context into the request it comes with,
 * explicit parameters first (`POST /list-contexts`, backend `ListContextInterceptor`).
 *
 * The id is content-addressed on the server: the same filters of the same list always give the
 * same id. This module keeps both directions in memory (filters to id, id to filters), so a state
 * saved once is never saved again in the tab, and links are built synchronously.
 */

export const LIST_CONTEXT_INLINE_LIMIT = 1500;

export type ListFilters = Record<string, unknown>;

// Endpoint segments a list's requests add to its path (`/spend-items/summary/totals`).
const LIST_ENDPOINT_SUFFIXES = new Set(['summary', 'ids', 'totals', 'filter-values', 'neighbors']);

/**
 * The list a request belongs to: its endpoint without the segments its requests add, so the page,
 * totals, filter values, ids and neighbours of one list share their contexts
 * (`/spend-items/summary/ids` gives `spend-items`, `/portfolio/projects/ids` gives `portfolio/projects`).
 */
export function listKeyOf(endpoint: string): string {
  const segments = String(endpoint ?? '').split('?')[0].split('/').filter(Boolean);
  while (segments.length > 1 && LIST_ENDPOINT_SUFFIXES.has(segments[segments.length - 1])) segments.pop();
  return segments.join('/') || 'list';
}

/** JSON with every object's keys sorted: two equal filter models give the same text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** A filter model from its URL text or object; null when empty or unreadable. */
export function parseListFilters(filters: string | ListFilters | null | undefined): ListFilters | null {
  if (!filters) return null;
  let model: unknown = filters;
  if (typeof filters === 'string') {
    try {
      model = JSON.parse(filters);
    } catch {
      return null;
    }
  }
  if (!model || typeof model !== 'object' || Array.isArray(model) || Object.keys(model).length === 0) return null;
  return model as ListFilters;
}

function filtersText(filters: string | ListFilters | null | undefined): string {
  if (!filters) return '';
  return typeof filters === 'string' ? filters : (Object.keys(filters).length ? JSON.stringify(filters) : '');
}

/** True when these filters are too long for a URL and travel as a saved context. */
export function filtersNeedContext(filters: string | ListFilters | null | undefined): boolean {
  const text = filtersText(filters);
  return !!text && encodeURIComponent(text).length > LIST_CONTEXT_INLINE_LIMIT;
}

const idByState = new Map<string, string>();
const filtersById = new Map<string, { list: string; filters: ListFilters | null }>();
const saving = new Map<string, Promise<string>>();
const loading = new Map<string, Promise<{ list: string; filters: ListFilters | null }>>();
// Ids the server no longer knows (purged after 90 days unused, evicted past the tenant's cap, or
// another tenant's): not asked again in this tab.
const missingIds = new Set<string>();
// Lists whose link filters could not be read, until the list's grid shows the notice.
const lostLists = new Set<string>();

/** True for the server's answer to a context it does not know (400 or 404 `list_context_not_found`). */
export function isListContextNotFound(error: unknown): boolean {
  return (error as { response?: { data?: { code?: unknown } } } | null)?.response?.data?.code === 'list_context_not_found';
}

/** True when the server answered that it does not know this id (see `loadListContext`). */
export function isListContextMissing(id: string | null | undefined): boolean {
  return !!id && missingIds.has(id);
}

/**
 * Forgets an id this tab knew (the server answered it no longer has it): the next request with
 * the same filters saves them again.
 */
export function forgetListContext(id: string): void {
  filtersById.delete(id);
  for (const [key, known] of idByState) if (known === id) idByState.delete(key);
  if (lastLookup?.id === id) lastLookup = null;
}

/**
 * The filters of a link could not be read (the saved filters are gone): the list's grid shows a
 * one-line notice the next time it mounts (`takeLostListFilters`), then the list unfiltered.
 */
export function reportLostListFilters(endpoint: string): void {
  lostLists.add(listKeyOf(endpoint));
}

/** Whether filters of this list were lost since its grid last looked; forgets it. */
export function takeLostListFilters(endpoint: string): boolean {
  return lostLists.delete(listKeyOf(endpoint));
}

function stateKey(list: string, filters: ListFilters): string {
  return `${list}\n${canonicalJson(filters)}`;
}

/** Forgets every saved context (specs). */
export function resetListContextCache(): void {
  lastLookup = null;
  idByState.clear();
  filtersById.clear();
  saving.clear();
  loading.clear();
  missingIds.clear();
  lostLists.clear();
}

// The last text looked up: the cell links of one list state all ask for the same filters.
let lastLookup: { key: string; id: string } | null = null;

/** The id of these filters when already saved (or read) in this tab. */
export function cachedListContextId(endpoint: string, filters: string | ListFilters | null | undefined): string | undefined {
  const list = listKeyOf(endpoint);
  const text = typeof filters === 'string' ? `${list}\n${filters}` : null;
  if (text && lastLookup?.key === text) return lastLookup.id;
  const model = parseListFilters(filters);
  const id = model ? idByState.get(stateKey(list, model)) : undefined;
  if (text && id) lastLookup = { key: text, id };
  return id;
}

/** Copies a URL's list filters (`filters`, or the `ctx` standing for them) onto another URL. */
export function carryListFilters(target: URLSearchParams, source: URLSearchParams): void {
  const filters = source.get('filters');
  const ctx = source.get('ctx');
  if (filters) target.set('filters', filters);
  else if (ctx) target.set('ctx', ctx);
}

/** Saves the filters of a list (once per tab) and answers their id. */
export function saveListContext(endpoint: string, filters: string | ListFilters): Promise<string> {
  const list = listKeyOf(endpoint);
  const model = parseListFilters(filters) ?? {};
  const key = stateKey(list, model);
  const known = idByState.get(key);
  if (known) return Promise.resolve(known);
  const inFlight = saving.get(key);
  if (inFlight) return inFlight;
  const request = api.post<{ id: string }>('/list-contexts', { list, state: { filters: model } })
    .then((res) => {
      const id = String(res.data?.id ?? '');
      if (!id) throw new Error('The list filters could not be saved');
      missingIds.delete(id);
      idByState.set(key, id);
      filtersById.set(id, { list, filters: model });
      return id;
    })
    .finally(() => saving.delete(key));
  saving.set(key, request);
  return request;
}

/** The filters saved under an id, when known in this tab. */
export function cachedListContext(id: string | null | undefined): { list: string; filters: ListFilters | null } | undefined {
  return id ? filtersById.get(id) : undefined;
}

/**
 * Reads the filters saved under an id (once per tab). Rejects when the id is unknown (purged after
 * 90 days unused, evicted, another tenant's); such an id is not asked again in the tab.
 */
export function loadListContext(id: string): Promise<{ list: string; filters: ListFilters | null }> {
  const known = filtersById.get(id);
  if (known) return Promise.resolve(known);
  if (missingIds.has(id)) return Promise.reject(Object.assign(new Error('list_context_not_found'), { response: { status: 404, data: { code: 'list_context_not_found' } } }));
  const inFlight = loading.get(id);
  if (inFlight) return inFlight;
  const request = api.get<{ id: string; list: string; state?: { filters?: unknown } }>(`/list-contexts/${encodeURIComponent(id)}`)
    .then((res) => {
      const list = String(res.data?.list ?? '');
      const filters = parseListFilters(res.data?.state?.filters as ListFilters | undefined);
      const entry = { list, filters };
      filtersById.set(id, entry);
      if (filters) idByState.set(stateKey(list, filters), id);
      return entry;
    }, (error: unknown) => {
      if (isListContextNotFound(error)) missingIds.add(id);
      throw error;
    })
    .finally(() => loading.delete(id));
  loading.set(id, request);
  return request;
}

/**
 * The parameters of an API call with filters too long for a URL sent as `ctx` (saved first when
 * needed). Shorter filters, and calls without filters, go as they are.
 */
export async function withListContext<T extends Record<string, unknown>>(endpoint: string, params: T): Promise<Record<string, unknown>> {
  const filters = params?.filters as string | ListFilters | undefined;
  if (!filtersNeedContext(filters)) return params;
  const ctx = await saveListContext(endpoint, filters!);
  const { filters: _inline, ...rest } = params;
  return { ...rest, ctx };
}

/**
 * GET of a list endpoint with its filters as `ctx` when too long for a URL (`withListContext`). A
 * context this tab saved earlier may be gone on the server since (purged, evicted past the
 * tenant's cap): on `list_context_not_found` the tab forgets it, saves the filters again and asks
 * once more. A `ctx` the caller passes itself (from a link) is sent as it is.
 */
export async function getWithListContext<T = any>(
  endpoint: string,
  params: Record<string, unknown>,
  config?: Omit<AxiosRequestConfig, 'params'>,
): Promise<AxiosResponse<T>> {
  const sent = await withListContext(endpoint, params);
  try {
    return await api.get<T>(endpoint, { ...config, params: sent });
  } catch (error) {
    const savedHere = typeof sent.ctx === 'string' && sent.ctx !== params.ctx;
    if (!savedHere || !isListContextNotFound(error)) throw error;
    forgetListContext(sent.ctx as string);
    return api.get<T>(endpoint, { ...config, params: await withListContext(endpoint, params) });
  }
}

/**
 * Sets the list filters of a URL: inline up to the limit, else `ctx` when the filters are saved in
 * this tab (the list's page requests save them before any row shows). Unsaved long filters stay
 * inline: the link still works in this tab.
 */
export function setListFiltersParam(sp: URLSearchParams, endpoint: string, filters: string | ListFilters | null | undefined): void {
  const text = filtersText(filters);
  sp.delete('ctx');
  if (!text || !parseListFilters(text)) {
    sp.delete('filters');
    return;
  }
  const id = filtersNeedContext(text) ? cachedListContextId(endpoint, text) : undefined;
  if (id) {
    sp.delete('filters');
    sp.set('ctx', id);
  } else {
    sp.set('filters', text);
  }
}

/** The list filters a URL carries: its `filters`, else the filters saved under its `ctx` when known in this tab. */
export function listFiltersOf(sp: URLSearchParams): string {
  const inline = sp.get('filters');
  if (inline) return inline;
  const saved = cachedListContext(sp.get('ctx'))?.filters;
  return saved ? JSON.stringify(saved) : '';
}

/** A search string with `ctx` replaced by its filters (read from the server when needed; dropped when unknown). */
export async function expandListSearch(search: string): Promise<string> {
  const sp = new URLSearchParams(search);
  const ctx = sp.get('ctx');
  if (!ctx) return sp.toString();
  sp.delete('ctx');
  if (!sp.get('filters')) {
    try {
      const { filters } = await loadListContext(ctx);
      if (filters) sp.set('filters', JSON.stringify(filters));
    } catch {
      // Purged or foreign: the list opens without those filters.
    }
  }
  return sp.toString();
}

/** A search string whose filters past the limit go as `ctx` (saved first when needed). */
export async function compactListSearch(search: string, endpoint: string): Promise<string> {
  const sp = new URLSearchParams(search);
  const filters = sp.get('filters');
  if (!filtersNeedContext(filters)) return sp.toString();
  try {
    await saveListContext(endpoint, filters!);
  } catch {
    return sp.toString();
  }
  setListFiltersParam(sp, endpoint, filters);
  return sp.toString();
}

/** Same, with the contexts known in this tab only (synchronous, for links). */
export function compactListSearchCached(search: string, endpoint: string): string {
  const sp = new URLSearchParams(search);
  const filters = sp.get('filters');
  if (!filtersNeedContext(filters)) return sp.toString();
  setListFiltersParam(sp, endpoint, filters);
  return sp.toString();
}
