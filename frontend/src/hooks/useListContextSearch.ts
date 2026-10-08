import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListAmountColumns, ListFieldPredicate, settleListSearch } from '../components/finance/amountColumns';
import {
  cachedListContext,
  cachedListContextId,
  compactListSearch,
  compactListSearchCached,
  expandListSearch,
  filtersNeedContext,
  isListContextMissing,
  isListContextNotFound,
  ListFilters,
  listKeyOf,
  loadListContext,
  reportLostListFilters,
  saveListContext,
} from '../lib/listContext';
import { STATUS_SCOPE_PARAM } from '../utils/statusScopeParams';

/**
 * The address marker of a list opened from a report row (`?from=report`). Such a list is a one-off
 * view: it neither reads nor writes the tab's stored list context, so a later plain visit to the list
 * opens on the user's own state, not on the report's filters and Show scope. Its state lives in its
 * address only (filters, sort, search, `statusScope`), and the item links and back links it builds
 * carry the marker along.
 */
export const REPORT_VIEW_PARAM = 'from';
export const REPORT_VIEW_VALUE = 'report';

/** The address is a one-off view opened from a report (`REPORT_VIEW_PARAM`). */
export function isReportView(search: string | URLSearchParams): boolean {
  const sp = typeof search === 'string' ? new URLSearchParams(search) : search;
  return sp.get(REPORT_VIEW_PARAM) === REPORT_VIEW_VALUE;
}

/**
 * Marks an address built from a one-off view (an item link, the New button) with the view and its
 * Show scope, so the item page leaves the stored list context alone and walks the same lines.
 */
export function markReportView(sp: URLSearchParams, statusScope: string | null | undefined, defaultScope = 'enabled'): void {
  sp.set(REPORT_VIEW_PARAM, REPORT_VIEW_VALUE);
  if (statusScope && statusScope !== defaultScope) sp.set(STATUS_SCOPE_PARAM, statusScope);
  else sp.delete(STATUS_SCOPE_PARAM);
}

/** A stored list context (OPEX, CAPEX): its filters inline, or `ctx` for filters too long for a URL. */
export type ListSnapshot = { sort?: string; q?: string; filters?: string; ctx?: string; statusScope?: string };

/** The filters a stored list context stands for: its own, else those saved under its `ctx` when known in this tab. */
export function snapshotFilters(snapshot: ListSnapshot | null | undefined): string {
  if (!snapshot) return '';
  if (snapshot.filters) return snapshot.filters;
  const saved = cachedListContext(snapshot.ctx)?.filters;
  return saved ? JSON.stringify(saved) : '';
}

/**
 * Writes a stored list context: filters inline, or as `ctx` when too long for a URL. Filters not
 * saved yet are written inline at once, then as `ctx` once saved, unless another state was stored
 * meanwhile.
 */
export function writeListSnapshot<T extends ListSnapshot>(
  endpoint: string,
  snapshot: T,
  read: () => T | null,
  write: (next: T) => void,
): void {
  const filters = snapshot.filters || '';
  const { ctx: _ctx, ...rest } = snapshot;
  if (!filtersNeedContext(filters)) {
    write(rest as T);
    return;
  }
  const known = cachedListContextId(endpoint, filters);
  if (known) {
    write({ ...rest, filters: '', ctx: known } as T);
    return;
  }
  write(rest as T);
  saveListContext(endpoint, filters)
    .then((id) => {
      const current = read();
      if (current && current.filters === filters) write({ ...current, filters: '', ctx: id });
    })
    .catch(() => undefined);
}

/**
 * The filters a workspace URL or its stored list context stands for: the URL's `filters`, else
 * those saved under its `ctx`, else the stored context's. A saved context not known in this tab is
 * read first (a link opened in a new tab, a reload): `ready` is false meanwhile.
 */
export function useListFilters(searchParams: URLSearchParams, stored?: ListSnapshot | null): { ready: boolean; filters: string } {
  const inline = searchParams.get('filters') || '';
  const urlCtx = inline ? null : searchParams.get('ctx');
  const storedCtx = !inline && !urlCtx && !stored?.filters ? stored?.ctx ?? null : null;
  const ctx = urlCtx || storedCtx;
  const known = ctx ? cachedListContext(ctx) : undefined;
  const query = useQuery({
    queryKey: ['list-context', ctx],
    queryFn: () => loadListContext(ctx!),
    enabled: !!ctx && !known,
    staleTime: Infinity,
    retry: false,
  });
  if (inline) return { ready: true, filters: inline };
  if (ctx) {
    const entry = known ?? query.data;
    if (entry) return { ready: true, filters: entry.filters ? JSON.stringify(entry.filters) : '' };
    // Purged or foreign: the list state goes on without those filters.
    return { ready: query.isError, filters: '' };
  }
  return { ready: true, filters: stored?.filters || '' };
}

/**
 * The URL an OPEX or CAPEX list mounts on: the stored list context fills what the URL leaves out, a
 * sort or filter on a hidden column falls back (settleListSearch), and filters saved as a context
 * (`ctx`, in the URL or the stored context) are read first. Filters too long for a URL go back as
 * `ctx`. Null until the column settings and the dimensions are known (`ready`) and any saved
 * filters are read; synchronous when every context is known in this tab.
 *
 * Saved filters the server no longer has (a link's `ctx`, or the stored context's): the list opens
 * unfiltered, never with the stored filters instead of a link's, and its grid says so in one line
 * (`reportLostListFilters`). The stored context then forgets its filters (`dropStoredFilters`), so
 * the next settling of the address does not bring them back.
 */
export function useSettledListSearch(opts: {
  endpoint: string;
  search: string;
  /** The stored list context, read when the URL or the settings change (not a dependency). */
  readStored: () => ListSnapshot | null;
  ready: boolean;
  shown: ListAmountColumns['shown'];
  defaultSort: string;
  isListField: ListFieldPredicate;
  /** Clears the filters (and `ctx`) of the stored list context: the link's filters were lost. */
  dropStoredFilters: () => void;
}): string | null {
  const { endpoint, search, readStored, ready, shown, defaultSort, isListField, dropStoredFilters } = opts;
  const settle = (expanded: string, stored: ListSnapshot | null, storedFilters: string) =>
    settleListSearch(expanded, stored ? { ...stored, filters: storedFilters } : stored, shown, defaultSort, isListField);

  // Every context known in this tab (or none at all): settled at once.
  const synchronous = useMemo(() => {
    if (!ready) return null;
    const stored = readStored();
    const sp = new URLSearchParams(search);
    const ctx = sp.get('ctx');
    if (ctx) {
      const saved = cachedListContext(ctx);
      if (!saved) return undefined;
      sp.delete('ctx');
      if (!sp.get('filters') && saved.filters) sp.set('filters', JSON.stringify(saved.filters));
    }
    if (stored?.ctx && !stored.filters && !cachedListContext(stored.ctx)) return undefined;
    const settled = settle(sp.toString(), stored, snapshotFilters(stored));
    const filters = new URLSearchParams(settled).get('filters');
    if (filtersNeedContext(filters) && !cachedListContextId(endpoint, filters)) return undefined;
    return compactListSearchCached(settled, endpoint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, search, shown, defaultSort, isListField, endpoint]);

  const [asyncResult, setAsyncResult] = useState<{ key: string; settled: string } | null>(null);
  const asyncKey = JSON.stringify([search, defaultSort, shown.map((c) => c.measure)]);
  useEffect(() => {
    if (synchronous !== undefined) return;
    let cancelled = false;
    (async () => {
      const stored = readStored();
      const urlCtx = new URLSearchParams(search).get('ctx');
      const expanded = await expandListSearch(search);
      const lostLink = isListContextMissing(urlCtx);
      let storedFilters = stored?.filters || '';
      let lostStored = false;
      if (!storedFilters && stored?.ctx) {
        try {
          const saved = await loadListContext(stored.ctx);
          storedFilters = saved.filters ? JSON.stringify(saved.filters) : '';
        } catch (error) {
          storedFilters = '';
          lostStored = isListContextNotFound(error);
        }
      }
      if (cancelled) return;
      if (lostLink || lostStored) {
        reportLostListFilters(endpoint);
        dropStoredFilters();
      }
      // A link whose filters are gone opens the list unfiltered, not with the stored filters.
      const settled = await compactListSearch(settle(expanded, stored, lostLink ? '' : storedFilters), endpoint);
      if (!cancelled) setAsyncResult({ key: asyncKey, settled });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synchronous, asyncKey]);

  if (synchronous !== undefined) return synchronous;
  return asyncResult && asyncResult.key === asyncKey ? asyncResult.settled : null;
}

/**
 * The filter model a list page restores from its URL (back from a workspace, a reload, a link
 * opened in a new tab): its `filters`, or the saved filters its `ctx` stands for when saved for
 * this list. A context not known in this tab is read first: `ready` is false meanwhile, and the
 * page waits before it mounts its grid, so the list loads once, filtered. A context the server no
 * longer has gives no model: the grid, which reads the same `ctx`, shows the list unfiltered with
 * a one-line notice.
 */
export function useUrlFilterModel(search: string, endpoint: string): { ready: boolean; model: ListFilters | null } {
  const sp = useMemo(() => new URLSearchParams(search), [search]);
  const inline = sp.get('filters');
  const ctx = inline ? null : sp.get('ctx');
  const known = ctx ? cachedListContext(ctx) : undefined;
  const query = useQuery({
    queryKey: ['list-context', ctx],
    queryFn: () => loadListContext(ctx!),
    enabled: !!ctx && !known,
    staleTime: Infinity,
    retry: false,
  });
  const entry = known ?? query.data;
  const list = listKeyOf(endpoint);
  const text = inline ?? (entry && entry.list === list && entry.filters ? JSON.stringify(entry.filters) : null);
  const model = useMemo(() => {
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as ListFilters) : null;
    } catch {
      return null;
    }
  }, [text]);
  return { ready: !ctx || !!entry || query.isError, model };
}
