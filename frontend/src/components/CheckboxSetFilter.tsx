import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Box, Button, Checkbox, CircularProgress, FormControlLabel, Stack, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useGridFilter } from 'ag-grid-react';
import type { IFilterParams } from 'ag-grid-community';

/** A heading above some values of a tree-shaped list (a cost center group). It is not a value itself. */
export type CheckboxSetFilterGroup = {
  key: string;
  label: string;
};

export type CheckboxSetFilterOption = {
  value: string | null;
  label?: string;
  /**
   * The groups the value sits under, root first. The list shows each group once as a heading row
   * above its values, indented by level; its box ticks or unticks every value listed below it, and a
   * search on its name lists them all. Values come in tree order: each one follows its groups.
   */
  groups?: CheckboxSetFilterGroup[];
};

type FilterRow =
  | { kind: 'value'; option: CheckboxSetFilterOption; depth: number }
  | { kind: 'group'; group: CheckboxSetFilterGroup; depth: number; members: Array<string | null> };

/**
 * The rows the list draws: each value, preceded by the headings of its groups not already open
 * above it. A group's members are the values listed under it (the matching ones during a search).
 */
function buildFilterRows(options: CheckboxSetFilterOption[]): FilterRow[] {
  const rows: FilterRow[] = [];
  const members = new Map<string, Array<string | null>>();
  let open: CheckboxSetFilterGroup[] = [];
  for (const option of options) {
    const groups = option.groups ?? [];
    let shared = 0;
    while (shared < groups.length && shared < open.length && groups[shared].key === open[shared].key) shared += 1;
    for (let depth = shared; depth < groups.length; depth += 1) {
      const group = groups[depth];
      let list = members.get(group.key);
      if (!list) {
        list = [];
        members.set(group.key, list);
      }
      rows.push({ kind: 'group', group, depth, members: list });
    }
    for (const group of groups) members.get(group.key)!.push(option.value ?? null);
    rows.push({ kind: 'value', option, depth: groups.length });
    open = groups;
  }
  return rows;
}

export type CheckboxSetFilterContext = {
  api: any;
  column: any;
  context: any;
  filterParams: CheckboxSetFilterParams;
};

export type CheckboxSetFilterParams = {
  values?: CheckboxSetFilterOption[];
  getValues?: (ctx: CheckboxSetFilterContext) => Promise<CheckboxSetFilterOption[]>;
  emptyLabel?: string;
  searchable?: boolean;
  labelFormatter?: (value: string | null) => string;
  sortComparator?: (a: CheckboxSetFilterOption, b: CheckboxSetFilterOption) => number;
  treatAllAsUnfiltered?: boolean;
  /**
   * Overrides the grid's `setFilterExcludeMode` for this column. In exclude mode, "All" then
   * untick stores the unticked values (`mode: 'exclude'`): values added later show. "Clear" then
   * tick stores the ticked values, as always.
   */
  excludeMode?: boolean;
};

type SetFilterModel = {
  filterType: 'set';
  /** Absent or 'include': `values` are the ticked values. 'exclude': the values unticked from "All". */
  mode?: 'include' | 'exclude';
  values: Array<string | null>;
};

const isExcludeModel = (model: SetFilterModel | null | undefined): boolean => model?.mode === 'exclude';

type CheckboxSetFilterProps = IFilterParams & CheckboxSetFilterParams;

// Delay before a typed search, or a run of checkbox clicks, is applied to the grid, so it does not
// refetch on every keystroke or click.
export const SEARCH_APPLY_DELAY_MS = 300;
// The search box shows from this many values, even on a column that does not ask for it.
export const SEARCH_MIN_OPTIONS = 20;
// The value list draws a window of rows of a fixed height, so a column with thousands of values
// stays fast: about eight rows visible, at most OPTION_WINDOW rows in the page.
export const OPTION_ROW_HEIGHT = 30;
export const OPTION_VISIBLE_ROWS = 8;
export const OPTION_WINDOW = 40;
// How long the values of a column stay fresh for the same list state.
const VALUES_STALE_MS = 30_000;
// The server filters the rows: every row the grid holds passes. Stable, so AG Grid does not take a
// new function for a filter change.
const passAll = () => true;

/** Same object, keys sorted: two equal list states give the same query key. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  }
  return value;
}

/**
 * Query key of a column's values: the list endpoint, the column and the list state without the
 * column's own filter (its values do not depend on it). The grid's refresh key is part of it: after
 * a delete or an import, the next opening asks again.
 */
function valuesQueryKey(context: any, colId: string, language: string | undefined) {
  const state = context?.getQueryState?.() ?? {};
  const filters = { ...(state.filters || {}) };
  delete filters[colId];
  return [
    'grid-filter-values',
    state.endpoint ?? null,
    state.refreshKey ?? null,
    colId,
    language ?? null,
    JSON.stringify(canonical({ q: state.q || '', filters, extraParams: state.extraParams || {}, statusScope: state.statusScope ?? null })),
  ];
}

const CheckboxSetFilter = React.forwardRef<any, CheckboxSetFilterProps>((props, ref) => {
  const { t, i18n } = useTranslation('common');
  const emptyLabel = props.emptyLabel ?? t('filters.blank');
  const searchable = props.searchable ?? true;
  const labelFormatter = props.labelFormatter;
  const treatAllAsUnfiltered = props.treatAllAsUnfiltered ?? true;
  // Exclude mode only on lists whose endpoints honour it (grid opt-in, or the column's own).
  const excludeAllowed = props.excludeMode ?? (props.context as { setFilterExcludeMode?: boolean } | undefined)?.setFilterExcludeMode === true;
  const excludeAllowedRef = useRef(excludeAllowed);
  excludeAllowedRef.current = excludeAllowed;
  // The selection starts from "All" (true: unticking excludes) or from "None" (false: ticking
  // includes). The values unticked from "All" are kept, also those the value list no longer shows.
  const fromAllRef = useRef(true);
  const excludedRef = useRef<Set<string | null>>(new Set());

  const [selectedValues, setSelectedValues] = useState<Set<string | null>>(new Set());
  const selectedRef = useRef<Set<string | null>>(new Set());
  const explicitEmptyRef = useRef(false);
  const implicitAllRef = useRef(true);
  const [search, setSearch] = useState('');
  // While a search is typed, the grid applies `snapshot ∩ matching values`. The snapshot is the
  // selection effective when the search started; it is restored when the search is cleared.
  // Not in exclude mode: there a search only narrows the values listed, and the filter stays
  // "every value but these" (see `excludeModeNow`).
  const [snapshot, setSnapshotState] = useState<Set<string | null> | null>(null);
  const snapshotRef = useRef<Set<string | null> | null>(null);
  const snapshotImplicitAllRef = useRef(false);
  // Checkbox clicks made outside a search and not applied yet: shown at once, applied to the grid
  // after SEARCH_APPLY_DELAY_MS of quiet.
  const [pending, setPendingState] = useState<Set<string | null> | null>(null);
  const pendingRef = useRef<Set<string | null> | null>(null);
  // Where the pending clicks start from ("All" or "None"), applied with them.
  const pendingFromAllRef = useRef(true);
  // One timer for every delayed apply (typed search, checkbox clicks): the latest one wins.
  const applyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while this filter pushes its own model to the grid, which calls setModel back on it.
  const applyingOwnModelRef = useRef(false);
  // The column's model this filter pushed last (serialised): AG Grid hands it back as the `model`
  // prop, which then is no outside change.
  const lastAppliedRef = useRef<string | undefined>(undefined);

  const setSnapshot = useCallback((next: Set<string | null> | null) => {
    snapshotRef.current = next;
    setSnapshotState(next);
  }, []);

  const setPending = useCallback((next: Set<string | null> | null) => {
    pendingRef.current = next;
    setPendingState(next);
  }, []);

  const cancelPendingApply = useCallback(() => {
    if (applyTimerRef.current != null) {
      clearTimeout(applyTimerRef.current);
      applyTimerRef.current = null;
    }
    if (pendingRef.current) setPending(null);
  }, [setPending]);

  const scheduleApply = useCallback((apply: () => void) => {
    if (applyTimerRef.current != null) clearTimeout(applyTimerRef.current);
    applyTimerRef.current = setTimeout(() => {
      applyTimerRef.current = null;
      apply();
    }, SEARCH_APPLY_DELAY_MS);
  }, []);

  useEffect(() => () => {
    if (applyTimerRef.current != null) clearTimeout(applyTimerRef.current);
  }, []);

  const buildLabel = useCallback((option: CheckboxSetFilterOption) => {
    if (option.label != null && option.label !== '') return option.label;
    if (labelFormatter) return labelFormatter(option.value ?? null);
    if (option.value == null) return emptyLabel;
    return String(option.value);
  }, [emptyLabel, labelFormatter]);

  const normalizeOptions = useCallback((incoming: CheckboxSetFilterOption[]) => {
    const map = new Map<string | null, CheckboxSetFilterOption>();
    for (const opt of incoming) {
      const normalized = { value: opt.value ?? null, label: buildLabel(opt), groups: opt.groups };
      if (!map.has(normalized.value)) map.set(normalized.value, normalized);
    }
    return Array.from(map.values());
  }, [buildLabel]);

  // The values load when the filter opens, not when AG Grid creates it (a filter in the URL or a
  // floating filter creates it with the grid), through the query cache: opening again within
  // VALUES_STALE_MS for the same list state asks nothing, and the previous values stay shown while
  // a new list state loads.
  const [open, setOpen] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const colId: string = props.column?.getColId?.() ?? props.colDef?.field ?? '';
  const propsRef = useRef(props);
  propsRef.current = props;
  const queryKey = useMemo(
    () => valuesQueryKey(props.context, colId, i18n?.language),
    // Read when the filter opens: the list state only matters for the values then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openCount, colId, i18n?.language],
  );
  const valuesQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const current = propsRef.current;
      return current.getValues!({
        api: current.api,
        column: current.column,
        context: current.context,
        filterParams: current,
      });
    },
    enabled: open && !!props.getValues,
    staleTime: VALUES_STALE_MS,
    placeholderData: keepPreviousData,
    // A refused request (431, 403) shows at once instead of after the retries.
    retry: false,
  });
  const incoming = props.getValues ? valuesQuery.data : props.values;
  const options = useMemo(() => normalizeOptions(incoming ?? []), [incoming, normalizeOptions]);
  const loading = !!props.getValues && valuesQuery.isLoading;

  const mergedOptions = useMemo(() => {
    const map = new Map<string | null, CheckboxSetFilterOption>();
    for (const opt of options) {
      map.set(opt.value ?? null, { value: opt.value ?? null, label: buildLabel(opt), groups: opt.groups });
    }
    for (const value of selectedValues) {
      if (!map.has(value)) {
        map.set(value, { value, label: buildLabel({ value }) });
      }
    }
    for (const value of snapshot ?? []) {
      if (!map.has(value)) {
        map.set(value, { value, label: buildLabel({ value }) });
      }
    }
    // Values unticked from "All" stay listed (unticked) even when the list no longer offers them.
    if (excludeAllowed && fromAllRef.current) {
      for (const value of excludedRef.current) {
        if (!map.has(value)) map.set(value, { value, label: buildLabel({ value }) });
      }
    }
    const merged = Array.from(map.values());
    if (props.sortComparator) {
      merged.sort(props.sortComparator);
    }
    return merged;
  }, [options, selectedValues, snapshot, buildLabel, props.sortComparator, excludeAllowed]);

  const optionValueSet = useMemo(() => {
    return new Set(options.map((opt) => opt.value ?? null));
  }, [options]);
  const optionValueSetRef = useRef(optionValueSet);
  optionValueSetRef.current = optionValueSet;

  /** The ticked values of a model: its values, or for an exclude model every listed value but those. */
  const ticked = useCallback((model: SetFilterModel): Set<string | null> => {
    const values = (model.values ?? []).map((value) => value ?? null);
    if (!isExcludeModel(model)) return new Set(values);
    excludedRef.current = new Set(values);
    const next = new Set<string | null>();
    optionValueSet.forEach((value) => { if (!excludedRef.current.has(value)) next.add(value); });
    return next;
  }, [optionValueSet]);

  const isAllSelected = useCallback((next: Set<string | null>) => {
    if (optionValueSet.size === 0) return false;
    for (const value of optionValueSet) {
      if (!next.has(value)) return false;
    }
    return true;
  }, [optionValueSet]);

  // From "All", a value unticked earlier that the list no longer offers (another filter hides it)
  // stays listed, unticked: ticking every offered value then still excludes it.
  const excludesHiddenValue = useCallback((next: Set<string | null>) => {
    if (!excludeAllowedRef.current || !fromAllRef.current) return false;
    for (const value of excludedRef.current) {
      if (!next.has(value) && !optionValueSetRef.current.has(value)) return true;
    }
    return false;
  }, []);

  // Exclude mode in effect: allowed on this list, and the selection (or the clicks not applied yet)
  // starts from "All". A search then never turns the filter into the ticked matching values: only
  // the values the user ticks or unticks move, so values added later keep showing.
  const excludeModeNow = useCallback(() => (
    excludeAllowedRef.current && (pendingRef.current ? pendingFromAllRef.current : fromAllRef.current)
  ), []);

  // A value under a group matches a search on the group's name too.
  const labelMatches = useCallback((option: CheckboxSetFilterOption, trimmed: string) => {
    if (buildLabel(option).toLowerCase().includes(trimmed)) return true;
    return (option.groups ?? []).some((group) => group.label.toLowerCase().includes(trimmed));
  }, [buildLabel]);

  const filteredOptions = useMemo(() => {
    const trimmed = search.trim().toLowerCase();
    if (!trimmed) return mergedOptions;
    return mergedOptions.filter((opt) => labelMatches(opt, trimmed));
  }, [mergedOptions, search, labelMatches]);

  const updateFilterModel = useCallback((next: Set<string | null> | null) => {
    const api = props.api;
    const colId = props.column?.getColId?.() ?? props.colDef?.field;
    if (!api || !colId) return;
    const current = api.getFilterModel?.() ?? {};
    const nextModel: any = { ...current };
    if (!next) {
      delete nextModel[colId];
      explicitEmptyRef.current = false;
      excludedRef.current = new Set();
    } else if (excludeAllowedRef.current && fromAllRef.current && !snapshotRef.current) {
      // From "All": the values not ticked, among those the list offers and those unticked before.
      const known = new Set<string | null>([...optionValueSetRef.current, ...excludedRef.current]);
      const excluded = Array.from(known).filter((value) => !next.has(value));
      excludedRef.current = new Set(excluded);
      nextModel[colId] = { filterType: 'set', mode: 'exclude', values: excluded };
      explicitEmptyRef.current = false;
    } else {
      // A search applies the ticked matching values: the values unticked from "All" are kept for
      // when it ends.
      if (!snapshotRef.current) excludedRef.current = new Set();
      if (next.size === 0) {
        nextModel[colId] = {
          filterType: 'set',
          values: [],
        };
        explicitEmptyRef.current = true;
      } else {
        nextModel[colId] = {
          filterType: 'set',
          values: Array.from(next),
        };
        explicitEmptyRef.current = false;
      }
    }
    lastAppliedRef.current = JSON.stringify(nextModel[colId] ?? null);
    if (typeof api.setFilterModel === 'function') {
      applyingOwnModelRef.current = true;
      try {
        api.setFilterModel(nextModel);
      } finally {
        applyingOwnModelRef.current = false;
      }
    } else {
      const fallback = (props as any).filterChangedCallback;
      if (typeof fallback === 'function') fallback();
    }
  }, [props.api, props.column, props.colDef]);

  const setSelection = useCallback((next: Set<string | null>, opts?: { skipModelUpdate?: boolean }) => {
    selectedRef.current = next;
    setSelectedValues(next);
    if (opts?.skipModelUpdate) return;
    if (next.size === 0) {
      implicitAllRef.current = false;
      updateFilterModel(next);
      return;
    }
    if (treatAllAsUnfiltered && isAllSelected(next) && !excludesHiddenValue(next)) {
      implicitAllRef.current = true;
      updateFilterModel(null);
      return;
    }
    implicitAllRef.current = false;
    updateFilterModel(next);
  }, [isAllSelected, excludesHiddenValue, updateFilterModel, treatAllAsUnfiltered]);

  const matchingSubset = useCallback((base: Set<string | null>, trimmed: string) => {
    const labels = new Map<string | null, CheckboxSetFilterOption>();
    mergedOptions.forEach((opt) => labels.set(opt.value ?? null, opt));
    const next = new Set<string | null>();
    for (const value of base) {
      if (labelMatches(labels.get(value) ?? { value }, trimmed)) next.add(value);
    }
    return next;
  }, [mergedOptions, labelMatches]);

  // Applies the snapshot as-is (search cleared) and ends the search session.
  const restoreSnapshot = useCallback((snap: Set<string | null>, wasImplicitAll: boolean) => {
    setSnapshot(null);
    snapshotImplicitAllRef.current = false;
    if (wasImplicitAll) {
      implicitAllRef.current = true;
      setSelection(snap, { skipModelUpdate: true });
      updateFilterModel(null);
      return;
    }
    setSelection(snap);
  }, [setSelection, setSnapshot, updateFilterModel]);

  // Records an explicit choice made while a search session is open: a checkbox click is applied
  // after the quiet delay, All and Clear at once while a search is typed. With the search box
  // emptied, every choice waits for the quiet delay, like the clicks outside a search.
  const commitSnapshot = useCallback((nextSnapshot: Set<string | null>, opts?: { immediate?: boolean }) => {
    cancelPendingApply();
    snapshotImplicitAllRef.current = false;
    const trimmed = search.trim().toLowerCase();
    if (!trimmed) {
      setSnapshot(null);
      setPending(nextSnapshot);
      scheduleApply(() => {
        setPending(null);
        setSelection(nextSnapshot);
      });
      return;
    }
    setSnapshot(nextSnapshot);
    const applied = matchingSubset(nextSnapshot, trimmed);
    if (opts?.immediate) setSelection(applied);
    else scheduleApply(() => setSelection(applied));
  }, [cancelPendingApply, search, setSnapshot, setSelection, matchingSubset, setPending, scheduleApply]);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    // Exclude mode: the search narrows the values listed, the filter does not change.
    if (!snapshotRef.current && excludeModeNow()) return;
    const trimmed = value.trim().toLowerCase();
    let snap = snapshotRef.current;
    if (!trimmed) {
      if (!snap) return;
      const restored = snap;
      const wasImplicitAll = snapshotImplicitAllRef.current;
      cancelPendingApply();
      scheduleApply(() => restoreSnapshot(restored, wasImplicitAll));
      return;
    }
    if (!snap) {
      // Clicks not applied yet are part of the selection the search starts from.
      const clicked = pendingRef.current;
      const everyValueExcluded = excludeAllowedRef.current && fromAllRef.current && excludedRef.current.size > 0;
      const inactive = !clicked && (implicitAllRef.current
        || (!explicitEmptyRef.current && selectedRef.current.size === 0 && !everyValueExcluded));
      snap = clicked
        ? new Set(clicked)
        : inactive
          ? new Set(mergedOptions.map((opt) => opt.value ?? null))
          : new Set(selectedRef.current);
      snapshotImplicitAllRef.current = inactive;
      setSnapshot(snap);
    }
    const applied = matchingSubset(snap, trimmed);
    cancelPendingApply();
    scheduleApply(() => setSelection(applied));
  }, [cancelPendingApply, scheduleApply, restoreSnapshot, mergedOptions, setSnapshot, matchingSubset, setSelection, excludeModeNow]);

  // Exclude mode with a search typed: "All" ticks and "Clear" unticks the values listed (the
  // matching ones) and leaves the others as they are; the filter stays an exclude one.
  const moveListedValues = useCallback((tick: boolean): boolean => {
    if (snapshotRef.current || !search.trim() || !excludeModeNow()) return false;
    const base = pendingRef.current
      ?? (implicitAllRef.current && selectedValues.size === 0 ? optionValueSet : selectedValues);
    const next = new Set(base);
    filteredOptions.forEach((opt) => (tick ? next.add(opt.value ?? null) : next.delete(opt.value ?? null)));
    pendingFromAllRef.current = true;
    setPending(next);
    scheduleApply(() => {
      setPending(null);
      fromAllRef.current = true;
      setSelection(next);
    });
    return true;
  }, [search, excludeModeNow, selectedValues, optionValueSet, filteredOptions, setPending, scheduleApply, setSelection]);

  // One value flips. A group's values all follow: ticked when one of them was not, unticked otherwise.
  const toggleValues = useCallback((values: Array<string | null>) => {
    const flip = (base: Set<string | null>) => {
      const tick = values.some((value) => !base.has(value));
      const next = new Set(base);
      values.forEach((value) => (tick ? next.add(value) : next.delete(value)));
      return next;
    };
    if (snapshotRef.current) {
      commitSnapshot(flip(snapshotRef.current));
      return;
    }
    const base = pendingRef.current
      ?? (implicitAllRef.current && selectedValues.size === 0 ? optionValueSet : selectedValues);
    // Clicks after "All" or "Clear" not applied yet start from that choice.
    const fromAll = pendingRef.current ? pendingFromAllRef.current : fromAllRef.current;
    const next = flip(base);
    pendingFromAllRef.current = fromAll;
    setPending(next);
    scheduleApply(() => {
      setPending(null);
      fromAllRef.current = fromAll;
      setSelection(next);
    });
  }, [selectedValues, setSelection, optionValueSet, commitSnapshot, setPending, scheduleApply]);

  const handleSelectAll = useCallback(() => {
    if (moveListedValues(true)) return;
    if (snapshotRef.current) {
      const next = new Set(snapshotRef.current);
      filteredOptions.forEach((opt) => next.add(opt.value ?? null));
      commitSnapshot(next, { immediate: true });
      return;
    }
    // Outside a search, All waits for the quiet delay like a click: "All, then untick one" reloads once.
    const next = new Set<string | null>();
    mergedOptions.forEach((opt) => next.add(opt.value ?? null));
    pendingFromAllRef.current = true;
    setPending(next);
    scheduleApply(() => {
      setPending(null);
      fromAllRef.current = true;
      excludedRef.current = new Set();
      if (treatAllAsUnfiltered) {
        implicitAllRef.current = true;
        setSelection(next, { skipModelUpdate: true });
        updateFilterModel(null);
        return;
      }
      implicitAllRef.current = false;
      setSelection(next);
    });
  }, [mergedOptions, filteredOptions, setSelection, updateFilterModel, treatAllAsUnfiltered, commitSnapshot, setPending, scheduleApply, moveListedValues]);

  const handleClear = useCallback(() => {
    if (moveListedValues(false)) return;
    if (snapshotRef.current) {
      const next = new Set(snapshotRef.current);
      filteredOptions.forEach((opt) => next.delete(opt.value ?? null));
      commitSnapshot(next, { immediate: true });
      return;
    }
    // Outside a search, Clear waits for the quiet delay like a click: "Clear, then tick one" reloads once.
    const next = new Set<string | null>();
    pendingFromAllRef.current = false;
    setPending(next);
    scheduleApply(() => {
      setPending(null);
      implicitAllRef.current = false;
      fromAllRef.current = false;
      excludedRef.current = new Set();
      setSelection(next);
    });
  }, [filteredOptions, setSelection, commitSnapshot, setPending, scheduleApply, moveListedValues]);

  useEffect(() => {
    const api = props.api;
    const colId = props.column?.getColId?.() ?? props.colDef?.field;
    if (api && colId) {
      const current = api.getFilterModel?.() ?? {};
      const model = current[colId] as SetFilterModel | undefined;
      if (model && Array.isArray(model.values)) {
        const next = ticked(model);
        if (!pendingRef.current && !snapshotRef.current) fromAllRef.current = isExcludeModel(model);
        explicitEmptyRef.current = !isExcludeModel(model) && model.values.length === 0;
        implicitAllRef.current = false;
        selectedRef.current = next;
        setSelectedValues(next);
        return;
      }
    }
    if (!implicitAllRef.current) return;
    const next = new Set<string | null>();
    options.forEach((opt) => next.add(opt.value ?? null));
    selectedRef.current = next;
    setSelectedValues(next);
  }, [options, props.api, props.column, props.colDef, ticked]);

  // A model set from outside (list context restore, Reset, the floating filter's clear, another
  // column) ends the search session and drops clicks not applied yet; this filter's own model, handed
  // back by the grid, changes nothing. No model (null) means every value: all boxes ticked.
  const applyModel = useCallback((model: SetFilterModel | null, own: boolean) => {
    if (!own) {
      cancelPendingApply();
      setSearch('');
      setSnapshot(null);
      snapshotImplicitAllRef.current = false;
    }
    if (!model || !Array.isArray(model.values)) {
      explicitEmptyRef.current = false;
      implicitAllRef.current = true;
      fromAllRef.current = true;
      excludedRef.current = new Set();
      const next = new Set<string | null>();
      options.forEach((opt) => next.add(opt.value ?? null));
      selectedRef.current = next;
      setSelectedValues(next);
      return;
    }
    explicitEmptyRef.current = !isExcludeModel(model) && model.values.length === 0;
    implicitAllRef.current = false;
    // A model applied from outside (or this filter's own) sets where the selection starts from.
    if (!snapshotRef.current) fromAllRef.current = isExcludeModel(model);
    const next = ticked(model);
    selectedRef.current = next;
    setSelectedValues(next);
  }, [options, cancelPendingApply, setSnapshot, ticked]);
  const applyModelRef = useRef(applyModel);
  applyModelRef.current = applyModel;

  // AG Grid 32 runs this component as a reactive filter: it passes `onModelChange`, and the column's
  // model as the `model` prop, left out (undefined) when the column has no filter, after the floating
  // filter's clear or a reset. Without `onModelChange` (legacy mode) the imperative `setModel` below
  // is used instead.
  const reactive = typeof (props as { onModelChange?: unknown }).onModelChange === 'function';
  const reactiveModel = (props as { model?: SetFilterModel | null }).model;
  useEffect(() => {
    if (!reactive) return;
    const key = JSON.stringify(reactiveModel ?? null);
    if (key === lastAppliedRef.current) return;
    lastAppliedRef.current = key;
    applyModelRef.current(reactiveModel ?? null, false);
  }, [reactive, reactiveModel]);

  // The values load when the filter opens (see `open` above). AG Grid announces an opening with
  // afterGuiAttached, except the first one when the opening itself creates the filter: it calls
  // afterGuiAttached before this component has rendered and handed over its methods. A filter
  // that first renders inside an open popup is therefore open already.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const markOpen = useCallback(() => {
    setOpen(true);
    setOpenCount((count) => count + 1);
  }, []);
  useEffect(() => {
    if (rootRef.current?.closest('.ag-popup')) markOpen();
  }, [markOpen]);
  useGridFilter({
    doesFilterPass: passAll,
    afterGuiAttached: markOpen,
    afterGuiDetached: () => setOpen(false),
  });

  useImperativeHandle(ref, () => ({
    isFilterActive() {
      if (implicitAllRef.current) return false;
      if (excludeAllowedRef.current && fromAllRef.current) return excludedRef.current.size > 0;
      return explicitEmptyRef.current || selectedRef.current.size > 0;
    },
    doesFilterPass() {
      return true;
    },
    getModel(): SetFilterModel | null {
      if (implicitAllRef.current) return null;
      if (excludeAllowedRef.current && fromAllRef.current) {
        return excludedRef.current.size > 0 ? { filterType: 'set', mode: 'exclude', values: Array.from(excludedRef.current) } : null;
      }
      if (!explicitEmptyRef.current && selectedRef.current.size === 0) return null;
      return {
        filterType: 'set',
        values: explicitEmptyRef.current ? [] : Array.from(selectedRef.current),
      };
    },
    setModel(model: SetFilterModel | null) {
      // Legacy (non-reactive) filters: AG Grid calls setModel back, synchronously, when this filter
      // applies its own model.
      applyModel(model, applyingOwnModelRef.current);
    },
    afterGuiAttached() {
      markOpen();
    },
    afterGuiDetached() {
      setOpen(false);
    },
  }), [applyModel, markOpen]);

  // Windowing: the list keeps its full height for the scrollbar and draws only the rows near the
  // scroll position.
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  useEffect(() => {
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [search]);
  const rows = useMemo(() => buildFilterRows(filteredOptions), [filteredOptions]);
  const rowCount = rows.length;
  const windowed = rowCount > OPTION_WINDOW;
  const firstRow = windowed
    ? Math.min(Math.max(0, Math.floor(scrollTop / OPTION_ROW_HEIGHT) - Math.floor((OPTION_WINDOW - OPTION_VISIBLE_ROWS) / 2)), rowCount - OPTION_WINDOW)
    : 0;
  const lastRow = windowed ? firstRow + OPTION_WINDOW : rowCount;
  const shownSelection = snapshot ?? pending ?? selectedValues;
  const showSearch = searchable || search !== '' || mergedOptions.length >= SEARCH_MIN_OPTIONS;
  // The width follows the column's values, not the search: the popup does not jump while typing.
  const wide = mergedOptions.length > OPTION_WINDOW;

  // Keyboard: Tab and Shift+Tab go from row to row, also to a row outside the drawn window. The
  // list scrolls that row into view and the focus moves to it once it is drawn.
  const focusRowRef = useRef<number | null>(null);
  const focusDrawnRow = useCallback(() => {
    const row = focusRowRef.current;
    if (row == null) return;
    const input = listRef.current?.querySelector<HTMLInputElement>(`input[data-option-index="${row}"]`);
    if (!input) return;
    focusRowRef.current = null;
    input.focus();
  }, []);
  useEffect(() => { focusDrawnRow(); });
  const handleListKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !windowed) return;
    const attr = (event.target as HTMLElement).getAttribute?.('data-option-index');
    if (attr == null) return;
    const row = Number(attr) + (event.shiftKey ? -1 : 1);
    // Past the first or the last value, the focus leaves the list as usual.
    if (row < 0 || row >= rowCount) return;
    event.preventDefault();
    const list = listRef.current;
    if (list) {
      const top = row * OPTION_ROW_HEIGHT;
      const viewHeight = OPTION_VISIBLE_ROWS * OPTION_ROW_HEIGHT;
      let next = list.scrollTop;
      if (top < next) next = top;
      else if (top + OPTION_ROW_HEIGHT > next + viewHeight) next = top + OPTION_ROW_HEIGHT - viewHeight;
      list.scrollTop = next;
      setScrollTop(next);
    }
    focusRowRef.current = row;
    focusDrawnRow();
  }, [windowed, rowCount, focusDrawnRow]);
  const countLabel = t('filters.valueCount', {
    count: rowCount,
    formatted: rowCount.toLocaleString(i18n?.language),
  });
  // On a list with exclude mode, one line says which values the list keeps: every value but the
  // unticked ones (values added later too), or only the ticked ones. Not during a search, which
  // keeps the ticked matching values.
  let modeHint: string | null = null;
  if (excludeAllowed && !snapshot && !loading) {
    const fromAll = pending ? pendingFromAllRef.current : fromAllRef.current;
    if (fromAll) {
      const unticked = mergedOptions.filter((opt) => !shownSelection.has(opt.value ?? null)).length;
      if (unticked > 0) modeHint = t('filters.excludeHint', { count: unticked });
    } else if (shownSelection.size > 0) {
      modeHint = t('filters.includeHint', { count: shownSelection.size });
    }
  }

  return (
    <Box ref={rootRef} sx={{ p: 1, minWidth: 220, maxWidth: 360, width: wide ? 300 : undefined }}>
      {showSearch && (
        <TextField
          size="small"
          fullWidth
          placeholder={t('filters.search')}
          value={search}
          onChange={(event) => handleSearchChange(event.target.value)}
          sx={{ mb: 1 }}
        />
      )}
      {loading && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 1 }}>
          <CircularProgress size={16} />
          <Typography sx={{ fontSize: 13 }}>{t('status.loading')}</Typography>
        </Stack>
      )}
      {!loading && rowCount === 0 && (
        <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary', py: 0.5 }}>{t('filters.noOptions')}</Typography>
      )}
      {!loading && rowCount > 0 && (
        <Box
          ref={listRef}
          data-testid="set-filter-options"
          onScroll={(event) => setScrollTop((event.currentTarget as HTMLDivElement).scrollTop)}
          onKeyDown={handleListKeyDown}
          sx={{ height: Math.min(rowCount, OPTION_VISIBLE_ROWS) * OPTION_ROW_HEIGHT, overflowY: 'auto', pr: 0.5 }}
        >
          {/* A list of every value, for screen readers: its size and each row's place in it, also
              for the rows not drawn. */}
          <Box
            role="list"
            aria-label={countLabel}
            sx={windowed ? { position: 'relative', height: rowCount * OPTION_ROW_HEIGHT } : undefined}
          >
            {rows.slice(firstRow, lastRow).map((item, index) => {
              const row = firstRow + index;
              let key: string;
              let label: string;
              let checked: boolean;
              let indeterminate = false;
              let onToggle: () => void;
              if (item.kind === 'group') {
                // A group reads ticked when every value under it is, partly ticked when some are.
                const tickedCount = item.members.filter((value) => shownSelection.has(value)).length;
                key = `group:${item.group.key}`;
                label = item.group.label;
                checked = tickedCount > 0 && tickedCount === item.members.length;
                indeterminate = tickedCount > 0 && !checked;
                onToggle = () => toggleValues(item.members);
              } else {
                const value = item.option.value ?? null;
                key = `${String(value)}-${buildLabel(item.option)}`;
                label = buildLabel(item.option);
                checked = shownSelection.has(value);
                onToggle = () => toggleValues([value]);
              }
              return (
                <Box
                  key={key}
                  role="listitem"
                  aria-setsize={rowCount}
                  aria-posinset={row + 1}
                  sx={{
                    ...(windowed ? { position: 'absolute', top: row * OPTION_ROW_HEIGHT, left: 0, right: 0 } : {}),
                    height: OPTION_ROW_HEIGHT,
                  }}
                >
                  <FormControlLabel
                    control={(
                      <Checkbox
                        size="small"
                        checked={checked}
                        indeterminate={indeterminate}
                        onChange={onToggle}
                        inputProps={{ 'data-option-index': row } as React.InputHTMLAttributes<HTMLInputElement>}
                        sx={{ p: 0.5 }}
                      />
                    )}
                    label={(
                      <Typography
                        noWrap
                        title={label}
                        sx={{ fontSize: 13, fontWeight: item.kind === 'group' ? 500 : undefined }}
                      >
                        {label}
                      </Typography>
                    )}
                    sx={{
                      height: '100%',
                      m: 0,
                      pl: item.depth * 1.5,
                      display: 'flex',
                      alignItems: 'center',
                      '& .MuiFormControlLabel-label': { minWidth: 0 },
                    }}
                  />
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
      {modeHint && (
        <Typography data-testid="set-filter-mode-hint" sx={{ fontSize: 12, color: 'kanap.text.tertiary', mt: 1, lineHeight: 1.4 }}>
          {modeHint}
        </Typography>
      )}
      <Stack direction="row" spacing={1} sx={{ mt: 1 }} justifyContent="space-between">
        <Button size="small" onClick={handleSelectAll}>
          {t('labels.all')}
        </Button>
        <Button size="small" onClick={handleClear}>
          {t('buttons.clear')}
        </Button>
      </Stack>
    </Box>
  );
});

CheckboxSetFilter.displayName = 'CheckboxSetFilter';

export default CheckboxSetFilter;
