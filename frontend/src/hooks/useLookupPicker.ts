import React from 'react';
import { useQuery, type QueryKey } from '@tanstack/react-query';
import api from '../api';
import useDebouncedValue from './useDebouncedValue';

/**
 * Reference pickers that search on the server as the user types (backend
 * `common/lookup`: `GET /<resource>/lookup?q=&limit=&ids=`). Shared by every
 * picker of a reference table (suppliers, accounts, companies, people,
 * dimension values, contracts...), so none loads a whole table any more: the
 * old pickers read the first 1,000 rows and filtered them in the browser, so
 * the 1,001st supplier could never be picked.
 *
 * - Nothing loads on mount: the first page loads when the list opens.
 * - The text is debounced (250 ms); the previous results stay on screen while
 *   the next ones load; a request superseded by a newer text is cancelled
 *   (the query function hands its `signal` to axios, and React Query aborts a
 *   query nobody observes any more).
 * - The chosen values keep their labels without any list: the caller gives
 *   the labels it already holds (the detail's `references`), the options
 *   picked are remembered, and any other chosen id is read once, in one batch
 *   (`?ids=`).
 */

export type LookupOption = { id: string };
export type LookupPage<T> = { items: T[]; has_more: boolean };
export type LookupScope = Record<string, string | number | boolean | null | undefined>;

export const LOOKUP_DEBOUNCE_MS = 250;
export const LOOKUP_PAGE_SIZE = 30;
/** Chosen labels change rarely: read once per session window. */
const LABELS_STALE_MS = 5 * 60_000;
const SEARCH_STALE_MS = 30_000;

/**
 * The same array while its items are the same (shallow): callers pass fresh arrays on every
 * render (`value ? [value] : []`), and the Autocomplete resets the typed text whenever its value
 * changes identity.
 */
function useShallowStable<T>(items: readonly T[]): readonly T[] {
  const ref = React.useRef(items);
  const prev = ref.current;
  if (prev !== items && (prev.length !== items.length || prev.some((item, i) => item !== items[i]))) ref.current = items;
  return ref.current;
}

/** The scope without blank entries, keys sorted: a stable part of the query key. */
function cleanScope(scope?: LookupScope): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(scope ?? {}).sort()) {
    const value = scope![key];
    if (value === null || value === undefined || value === '') continue;
    out[key] = value;
  }
  return out;
}

export function lookupSearchKey(endpoint: string, scope: LookupScope | undefined, q: string, limit: number): QueryKey {
  return ['lookup', endpoint, 'search', cleanScope(scope), q, limit];
}

export function lookupIdsKey(endpoint: string, ids: string[]): QueryKey {
  return ['lookup', endpoint, 'ids', ids];
}

export async function fetchLookupPage<T>(
  endpoint: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<LookupPage<T>> {
  const res = await api.get<LookupPage<T>>(endpoint, { params, signal });
  return { items: res.data?.items ?? [], has_more: !!res.data?.has_more };
}

export async function fetchLookupByIds<T>(endpoint: string, ids: string[], signal?: AbortSignal): Promise<T[]> {
  if (ids.length === 0) return [];
  const res = await api.get<LookupPage<T>>(endpoint, { params: { ids: ids.join(',') }, signal });
  return res.data?.items ?? [];
}

type SearchOptions = {
  endpoint: string;
  scope?: LookupScope;
  /** The list is open: nothing is read before. */
  open: boolean;
  /** What the user typed. */
  text: string;
  /** False: no request at all (e.g. no company chosen yet for its accounts). */
  enabled?: boolean;
  limit?: number;
  debounceMs?: number;
};

/** One page of matches for the typed text, read while the list is open. */
export function useLookupSearch<T>({
  endpoint,
  scope,
  open,
  text,
  enabled = true,
  limit = LOOKUP_PAGE_SIZE,
  debounceMs = LOOKUP_DEBOUNCE_MS,
}: SearchOptions) {
  const trimmed = text.trim();
  const q = useDebouncedValue(trimmed, debounceMs);
  const scopeKey = JSON.stringify(cleanScope(scope));
  const query = useQuery({
    queryKey: lookupSearchKey(endpoint, scope, q, limit),
    queryFn: ({ signal }) => fetchLookupPage<T>(endpoint, { ...cleanScope(scope), ...(q ? { q } : {}), limit }, signal),
    enabled: enabled && open,
    // The previous results stay while the next text loads, never across another scope (another company's accounts).
    placeholderData: (previous, previousQuery) => (
      previousQuery && JSON.stringify(previousQuery.queryKey[3]) === scopeKey ? previous : undefined
    ),
    staleTime: SEARCH_STALE_MS,
  });
  return {
    items: query.data?.items ?? [],
    hasMore: !!query.data?.has_more,
    isFetching: query.isFetching || q !== trimmed,
    /** The text the page shown was searched with. */
    searchedText: q,
  };
}

type HydrationOptions<T extends LookupOption> = {
  endpoint: string;
  ids: string[];
  known: ReadonlyMap<string, T>;
  enabled?: boolean;
};

/** The chosen ids whose labels are not known yet, read in one batch. */
export function useLookupHydration<T extends LookupOption>({ endpoint, ids, known, enabled = true }: HydrationOptions<T>) {
  // `known` may be updated in place by the caller: read on every render (a few ids).
  const missing = Array.from(new Set(ids.filter((id) => !!id && !known.has(id)))).sort();
  const query = useQuery({
    queryKey: lookupIdsKey(endpoint, missing),
    queryFn: ({ signal }) => fetchLookupByIds<T>(endpoint, missing, signal),
    enabled: enabled && missing.length > 0,
    staleTime: LABELS_STALE_MS,
  });
  return { items: query.data ?? [], isLoading: missing.length > 0 && query.isLoading };
}

type PickerOptions<T extends LookupOption> = {
  endpoint: string;
  scope?: LookupScope;
  enabled?: boolean;
  /** The chosen ids (one for a single picker). */
  value: string[];
  /** Labels the caller already holds for chosen ids (the detail's `references`). */
  given?: Array<T | null | undefined>;
  limit?: number;
  debounceMs?: number;
};

/**
 * Everything an MUI Autocomplete needs to pick from a reference lookup:
 * spread `autocomplete` on it and keep the picker's own rendering.
 */
export function useLookupPicker<T extends LookupOption>({
  endpoint,
  scope,
  enabled = true,
  value,
  given,
  limit,
  debounceMs,
}: PickerOptions<T>) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState('');
  const [remembered, setRemembered] = React.useState<ReadonlyMap<string, T>>(() => new Map());

  const search = useLookupSearch<T>({ endpoint, scope, open, text, enabled, limit, debounceMs });
  const ids = useShallowStable(value.filter(Boolean)) as string[];
  const givenStable = useShallowStable(given ?? []);

  // The label shown for each chosen id. The first one seen stays (the same object, so the
  // Autocomplete never sees its value change and never clears the typed text); the caller's labels
  // and the user's picks replace it when they differ.
  const labelsRef = React.useRef(new Map<string, T>());
  const labels = labelsRef.current;
  for (const option of givenStable) {
    if (!option?.id) continue;
    const current = labels.get(option.id);
    if (current !== option && (!current || JSON.stringify(current) !== JSON.stringify(option))) labels.set(option.id, option);
  }
  for (const [id, option] of remembered) if (labels.get(id) !== option) labels.set(id, option);
  for (const option of search.items) if (!labels.has(option.id)) labels.set(option.id, option);

  const hydration = useLookupHydration<T>({ endpoint, ids, known: labels });
  for (const option of hydration.items) if (!labels.has(option.id)) labels.set(option.id, option);

  /** The chosen options in value order; an id still loading is a bare `{ id }`. */
  const selected = useShallowStable(ids.map((id) => labels.get(id) ?? ({ id } as T))) as T[];
  const pendingIds = React.useMemo(() => new Set(ids.filter((id) => !labels.has(id))), [ids, labels, selected]);

  const searching = search.searchedText !== '';
  const resultIds = React.useMemo(() => new Set(search.items.map((item) => item.id)), [search.items]);
  // The chosen options lead a blank search; a search shows its matches only (they stay in
  // `options` so the Autocomplete always finds its value among them).
  const options = React.useMemo(() => {
    const chosen = selected.filter((option) => !pendingIds.has(option.id));
    const chosenIds = new Set(chosen.map((option) => option.id));
    return [...chosen, ...search.items.filter((item) => !chosenIds.has(item.id))];
  }, [selected, pendingIds, search.items]);

  const remember = React.useCallback((picked: Array<T | null | undefined>) => {
    const real = picked.filter((option): option is T => !!option?.id && Object.keys(option).length > 1);
    if (real.length === 0) return;
    setRemembered((prev) => {
      const next = new Map(prev);
      for (const option of real) next.set(option.id, option);
      return next;
    });
  }, []);

  const filterOptions = React.useCallback(
    (list: T[]) => (searching ? list.filter((option) => resultIds.has(option.id)) : list),
    [searching, resultIds],
  );

  const loading = (open && search.isFetching) || hydration.isLoading;

  // Stable handlers: the Autocomplete resets its text whenever onInputChange changes while unfocused.
  const onOpen = React.useCallback(() => setOpen(true), []);
  const onClose = React.useCallback(() => { setOpen(false); setText(''); }, []);
  const onInputChange = React.useCallback((_event: React.SyntheticEvent | null, next: string, reason: string) => {
    if (reason === 'input') setText(next);
    else setText('');
  }, []);
  const isOptionEqualToValue = React.useCallback((option: T, chosen: T) => option.id === chosen.id, []);
  const autocomplete = React.useMemo(
    () => ({ open, onOpen, onClose, onInputChange, filterOptions, loading, isOptionEqualToValue }),
    [open, onOpen, onClose, onInputChange, filterOptions, loading, isOptionEqualToValue],
  );

  return {
    open,
    text,
    selected,
    /** True while a chosen id's label is being read. */
    isPending: (id: string | null | undefined) => !!id && pendingIds.has(id),
    hydrating: hydration.isLoading,
    options,
    results: search.items,
    hasMore: search.hasMore,
    searching,
    loading,
    remember,
    autocomplete,
  };
}
