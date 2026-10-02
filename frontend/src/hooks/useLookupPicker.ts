import React from 'react';
import { useQuery, type QueryKey } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { PaperProps } from '@mui/material';
import api from '../api';
import useDebouncedValue from './useDebouncedValue';
import LookupListPaper, { type LookupListPaperProps } from '../components/fields/LookupListPaper';

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
 *   the next ones load, narrowed to the typed text, so a row that does not
 *   match it can never be picked; a request superseded by a newer text is
 *   cancelled (the query function hands its `signal` to axios, and React Query
 *   aborts a query nobody observes any more).
 * - A page that does not hold every match ends on a quiet "type to narrow
 *   down" line.
 * - The chosen values keep their labels without any list: the caller gives
 *   the labels it already holds (the detail's `references`), the options
 *   picked are remembered, and any other chosen id is read once, in batches
 *   (`?ids=`). A chosen id the server no longer returns reads "Value no longer
 *   available", never a label that loads forever.
 */

export type LookupOption = { id: string };
export type LookupPage<T> = { items: T[]; has_more: boolean };
export type LookupScope = Record<string, string | number | boolean | null | undefined>;

export const LOOKUP_DEBOUNCE_MS = 250;
export const LOOKUP_PAGE_SIZE = 30;
/** The server's limit of ids per request (`LOOKUP_MAX_IDS`). */
export const LOOKUP_IDS_PER_REQUEST = 100;
/** Chosen labels change rarely: read once per session window. */
const LABELS_STALE_MS = 5 * 60_000;
const SEARCH_STALE_MS = 30_000;
/** The label shown while a chosen value's label loads. */
const PENDING_LABEL = '…';

const LIGATURES: Record<string, string> = { 'œ': 'oe', 'æ': 'ae', 'ß': 'ss', 'ø': 'o', 'ł': 'l', 'đ': 'd' };

/**
 * The server's folding of a searched text (`lower(unaccent(x))`, list engine decision Q2):
 * accents, case and the common ligatures. "societe" finds "Société".
 */
function foldLookupText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[œæßøłđ]/g, (c) => LIGATURES[c] ?? c);
}

/** The rows whose label holds the text (folded): the rows a pending search can still show. */
export function narrowToText<T>(options: T[], text: string | null | undefined, label: (option: T) => string): T[] {
  const needle = foldLookupText((text ?? '').trim());
  if (!needle) return options;
  return options.filter((option) => foldLookupText(label(option) ?? '').includes(needle));
}

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

/** The rows of these ids, in requests of at most 100 ids (the server refuses more). */
export async function fetchLookupByIds<T>(endpoint: string, ids: string[], signal?: AbortSignal): Promise<T[]> {
  if (ids.length === 0) return [];
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += LOOKUP_IDS_PER_REQUEST) batches.push(ids.slice(i, i + LOOKUP_IDS_PER_REQUEST));
  const pages = await Promise.all(batches.map(async (batch) => {
    const res = await api.get<LookupPage<T>>(endpoint, { params: { ids: batch.join(',') }, signal });
    return res.data?.items ?? [];
  }));
  return pages.flat();
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
  // The rows shown were searched with another text than the one typed (debounce, or a previous page).
  const pending = trimmed !== q || query.isPlaceholderData;
  return {
    items: query.data?.items ?? [],
    /** The server holds more matches than this page, for the text typed. */
    hasMore: !pending && !!query.data?.has_more,
    isFetching: query.isFetching || q !== trimmed,
    /** The text the page shown was searched with. */
    searchedText: q,
    /** While pending: the typed text the rows shown must still match (`narrowToText`); null otherwise. */
    pendingText: pending ? trimmed : null,
  };
}

type HydrationOptions<T extends LookupOption> = {
  endpoint: string;
  ids: string[];
  known: ReadonlyMap<string, T>;
  enabled?: boolean;
};

/**
 * The chosen ids whose labels are not known yet, read in one go. An id the server does not
 * return (the row is gone, or out of the user's reach), or whose read failed after one retry,
 * is `unavailable` from then on and never read again.
 */
export function useLookupHydration<T extends LookupOption>({ endpoint, ids, known, enabled = true }: HydrationOptions<T>) {
  const unavailableRef = React.useRef(new Set<string>());
  // `known` may be updated in place by the caller: read on every render (a few ids).
  const missing = Array.from(new Set(ids.filter((id) => !!id && !known.has(id) && !unavailableRef.current.has(id)))).sort();
  const query = useQuery({
    queryKey: lookupIdsKey(endpoint, missing),
    queryFn: ({ signal }) => fetchLookupByIds<T>(endpoint, missing, signal),
    enabled: enabled && missing.length > 0,
    staleTime: LABELS_STALE_MS,
    retry: 1,
  });
  if (enabled && missing.length > 0 && !query.isFetching && (query.isError || query.isSuccess)) {
    const returned = new Set((query.data ?? []).map((option) => option.id));
    for (const id of missing) if (!returned.has(id)) unavailableRef.current.add(id);
  }
  return {
    items: query.data ?? [],
    isLoading: missing.length > 0 && query.isLoading,
    /** Chosen ids whose label cannot be read. */
    unavailable: unavailableRef.current as ReadonlySet<string>,
  };
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
 * spread `autocomplete` on it, keep the picker's own rendering, and pass its
 * own label through `label` (`getOptionLabel={(o) => picker.label(o, own)}`).
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
  const { t } = useTranslation('common');
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

  // One bare `{ id }` per chosen id whose label is not known: the same object on every render, so
  // a value still loading never changes identity (which would clear what the user is typing).
  const placeholdersRef = React.useRef(new Map<string, T>());
  const placeholder = (id: string): T => {
    let option = placeholdersRef.current.get(id);
    if (!option) {
      option = { id } as T;
      placeholdersRef.current.set(id, option);
    }
    return option;
  };
  /** The chosen options in value order; an id without a label is its placeholder. */
  const selected = useShallowStable(ids.map((id) => labels.get(id) ?? placeholder(id))) as T[];
  const unavailableIds = new Set(ids.filter((id) => !labels.has(id) && hydration.unavailable.has(id)));
  const pendingIds = new Set(ids.filter((id) => !labels.has(id) && !unavailableIds.has(id)));
  // Keyed by content, so the callbacks below keep their identity while nothing changes.
  const pendingKey = Array.from(pendingIds).join(',');
  const unavailableKey = Array.from(unavailableIds).join(',');
  const pendingSet = React.useMemo(() => new Set(pendingKey ? pendingKey.split(',') : []), [pendingKey]);
  const unavailableSet = React.useMemo(() => new Set(unavailableKey ? unavailableKey.split(',') : []), [unavailableKey]);

  const searching = search.searchedText !== '';
  const resultIds = React.useMemo(() => new Set(search.items.map((item) => item.id)), [search.items]);
  // The chosen options lead a blank search; a search shows its matches only (they stay in
  // `options` so the Autocomplete always finds its value among them).
  const options = React.useMemo(() => {
    const chosen = selected.filter((option) => !pendingSet.has(option.id));
    const chosenIds = new Set(chosen.map((option) => option.id));
    return [...chosen, ...search.items.filter((item) => !chosenIds.has(item.id))];
  }, [selected, pendingSet, search.items]);

  const remember = React.useCallback((picked: Array<T | null | undefined>) => {
    const real = picked.filter((option): option is T => !!option?.id && Object.keys(option).length > 1);
    if (real.length === 0) return;
    setRemembered((prev) => {
      const next = new Map(prev);
      for (const option of real) next.set(option.id, option);
      return next;
    });
  }, []);

  // A search shows its own matches; while the next one loads, the rows shown are narrowed to the
  // typed text (as the server folds it), so a row that does not match can never be picked. A chosen
  // value whose label cannot be read is never offered.
  const pendingText = search.pendingText;
  const filterOptions = React.useCallback(
    (list: T[], state: { getOptionLabel: (option: T) => string }) => {
      const shown = list.filter((option) => !unavailableSet.has(option.id) && (!searching || resultIds.has(option.id)));
      return narrowToText(shown, pendingText, state.getOptionLabel);
    },
    [searching, resultIds, pendingText, unavailableSet],
  );

  /** The label of an option: the picker's own, `…` while it loads, "Value no longer available" when it cannot. */
  const label = React.useCallback((option: T | null | undefined, own: (option: T) => string): string => {
    if (!option?.id) return '';
    if (unavailableSet.has(option.id)) return t('selects.valueUnavailable');
    if (pendingSet.has(option.id)) return PENDING_LABEL;
    return own(option) ?? '';
  }, [pendingSet, unavailableSet, t]);

  const loading = (open && search.isFetching) || hydration.isLoading;

  // Stable handlers: the Autocomplete resets its text whenever onInputChange changes while unfocused.
  const onOpen = React.useCallback(() => setOpen(true), []);
  const onClose = React.useCallback(() => { setOpen(false); setText(''); }, []);
  const onInputChange = React.useCallback((_event: React.SyntheticEvent | null, next: string, reason: string) => {
    if (reason === 'input') setText(next);
    else setText('');
  }, []);
  const isOptionEqualToValue = React.useCallback((option: T, chosen: T) => option.id === chosen.id, []);
  const slotProps = React.useMemo(
    () => ({ paper: { moreResults: open && search.hasMore } as LookupListPaperProps as PaperProps }),
    [open, search.hasMore],
  );
  const autocomplete = React.useMemo(
    () => ({
      open, onOpen, onClose, onInputChange, filterOptions, loading, isOptionEqualToValue,
      PaperComponent: LookupListPaper as React.JSXElementConstructor<React.HTMLAttributes<HTMLElement>>,
      slotProps,
    }),
    [open, onOpen, onClose, onInputChange, filterOptions, loading, isOptionEqualToValue, slotProps],
  );

  return {
    open,
    text,
    selected,
    label,
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
