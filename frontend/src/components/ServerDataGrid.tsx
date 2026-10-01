import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Alert,
  Stack,
  TextField,
  Button,
  Popover,
  FormControlLabel,
  Checkbox,
  Typography,
  Divider,
  IconButton,
  RadioGroup,
  Radio,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { AgGridReact } from 'ag-grid-react';
import type {
  ColDef,
  GridReadyEvent,
  IDatasource,
  IGetRowsParams,
  GetRowIdParams,
  SortModelItem,
  ColumnState,
} from 'ag-grid-community';
import { useTranslation } from 'react-i18next';
import api from '../api';
import useDebouncedValue from '../hooks/useDebouncedValue';
import ClearableColumnFloatingFilter from './ClearableColumnFloatingFilter';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useTenant } from '../tenant/TenantContext';
import { useThemeMode } from '../config/ThemeContext';
import { useLocale } from '../i18n/useLocale';
import { statusScopeParams } from '../utils/statusScopeParams';

const DATE_FILTER_PARAMS = {
  suppressAndOrCondition: true,
  maxNumConditions: 1,
  buttons: ['clear'],
  filterOptions: ['equals', 'notEqual', 'lessThan', 'greaterThan', 'inRange', 'blank', 'notBlank'],
};

const NUMBER_FILTER_PARAMS = {
  suppressAndOrCondition: true,
  maxNumConditions: 1,
  buttons: ['clear'],
  filterOptions: ['equals', 'notEqual', 'lessThan', 'lessThanOrEqual', 'greaterThan', 'greaterThanOrEqual', 'inRange', 'blank', 'notBlank'],
};

type ServerResponse<T> = { items: T[]; total: number; page: number; limit: number };

export type StatusScope = 'enabled' | 'disabled' | 'invited' | 'all';

export type EnhancedColDef<T> = ColDef<T> & {
  required?: boolean; // cannot be hidden
  defaultHidden?: boolean; // hidden by default
  category?: string; // for grouping in chooser
};

export type ServerDataGridProps<T> = {
  columns: EnhancedColDef<T>[];
  endpoint: string; // e.g., '/companies'
  queryKey: string; // kept for API parity with callers; not used internally now
  getRowId?: (row: T) => string | number;
  cacheBlockSize?: number; // how many rows per server request
  enableSearch?: boolean; // deprecated with floating filters; kept for compatibility
  defaultSort?: { field: string; direction: 'ASC' | 'DESC' };
  extraParams?: Record<string, any>;
  refreshKey?: number | string; // bump to refresh grid after mutations
  initialFilterModel?: any; // deprecated: prefer `initialState`
  initialState?: any; // AG Grid initialState, applied once at grid creation
  enableColumnChooser?: boolean; // default: true
  requiredColumns?: string[]; // columns that cannot be hidden
  defaultHiddenColumns?: string[]; // columns hidden by default
  columnPreferencesKey?: string; // localStorage key for persistence
  onColumnStateChange?: (columnState: ColumnState[]) => void; // callback for external state management
  onCellClicked?: (event: any) => void; // optional cell click handler
  onGridApiReady?: (gridApi: any) => void; // callback to provide grid API reference to parent
  onQueryStateChange?: (state: { sort: string; filterModel: any; q: string; statusScope?: StatusScope }) => void; // notify parent when sort/filter/search change
  pinnedBottomRowData?: any[]; // optional pinned totals row(s)
  enableRowSelection?: boolean; // enable multi-row selection with checkboxes (default: false)
  onSelectionChanged?: (selectedRows: T[]) => void; // callback when selection changes
  statusScopeConfig?: {
    columnField?: string;
    defaultScope?: StatusScope;
    scopes?: StatusScope[]; // radio options, in display order; default ['all', 'enabled', 'disabled']
  };
  enablePagination?: boolean;
  paginationPageSize?: number;
  toolbarExtras?: React.ReactNode;
  showRowCount?: boolean;
};

function parseSortParam(sortModel: SortModelItem[] | undefined, fallback: { field: string; direction: 'ASC' | 'DESC' }) {
  if (sortModel && sortModel.length > 0) {
    const s = sortModel[0];
    return `${s.colId}:${(s.sort || 'desc').toUpperCase()}`;
  }
  return `${fallback.field}:${fallback.direction}`;
}

function parseUrlSort(sortFromUrl: string | null | undefined, fallback: { field: string; direction: 'ASC' | 'DESC' }) {
  const raw = sortFromUrl || `${fallback.field}:${fallback.direction}`;
  const [field, dir] = String(raw).split(':');
  const sort = (dir ?? fallback.direction).toLowerCase() === 'asc' ? 'asc' : 'desc';
  return [{ colId: field, sort }] as SortModelItem[];
}

/**
 * Saved layout merged with the current columns: saved columns keep their saved order and settings,
 * columns the layout does not know yet go right after their nearest predecessor in the default
 * order (at the start when none precedes them), and columns that no longer exist are dropped.
 */
export function mergeSavedColumnState(savedState: ColumnState[], defaultState: ColumnState[]): ColumnState[] {
  const defaultById = new Map<string | null | undefined, ColumnState>();
  for (const d of defaultState) defaultById.set(d.colId, d);

  const merged: ColumnState[] = [];
  for (const s of savedState) {
    const d = defaultById.get(s.colId);
    if (d) merged.push({ ...d, ...s, hide: s.hide ?? d.hide });
  }

  const known = new Set(merged.map((c) => c.colId));
  let previous: string | null | undefined;
  for (const d of defaultState) {
    if (!known.has(d.colId)) {
      const at = previous === undefined ? 0 : merged.findIndex((c) => c.colId === previous) + 1;
      merged.splice(at, 0, d);
      known.add(d.colId);
    }
    previous = d.colId;
  }
  return merged;
}

/** Date columns: date models from both the filter menu and the box under the header. */
export const DATE_COLUMN_FILTER = {
  filter: 'agDateColumnFilter',
  floatingFilterComponent: 'agDateColumnFloatingFilter',
} as const;

// Column state management hook
function useColumnState(
  key: string | undefined,
  columns: EnhancedColDef<any>[],
  requiredColumns: string[] = [],
  defaultHiddenColumns: string[] = [],
  tenantSlug?: string,
  userId?: string,
) {
  const legacyKey = key ? `grid-columns-${key}` : null;
  const scopedKey = key && tenantSlug && userId
    ? `grid-columns:${tenantSlug}:${userId}:${key}`
    : null;

  // One-time migration: copy legacy key → scoped key, then delete legacy
  if (scopedKey && legacyKey) {
    try {
      if (!localStorage.getItem(scopedKey) && localStorage.getItem(legacyKey)) {
        localStorage.setItem(scopedKey, localStorage.getItem(legacyKey)!);
        localStorage.removeItem(legacyKey);
      }
    } catch { /* ignore */ }
  }

  const getStorageKey = () => scopedKey ?? legacyKey;

  const getDefaultColumnState = useCallback((): ColumnState[] => {
    return columns.map(col => {
      const field = col.field || col.colId || '';
      const isRequired = col.required || requiredColumns.includes(field);
      const isDefaultHidden = col.defaultHidden || defaultHiddenColumns.includes(field);
      
      return {
        colId: field,
        hide: isRequired ? false : isDefaultHidden,
        pinned: col.pinned || undefined,
        width: col.width || undefined,
      };
    });
  }, [columns, requiredColumns, defaultHiddenColumns]);

  const loadColumnState = useCallback((): ColumnState[] => {
    const storageKey = getStorageKey();
    if (!storageKey) return getDefaultColumnState();

    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return getDefaultColumnState();

      const savedState = JSON.parse(saved) as ColumnState[];
      const defaultState = getDefaultColumnState();

      // Helper to compute hide respecting required columns
      const applyRequired = (col: ColumnState): ColumnState => {
        const field = col.colId || '';
        const isRequired = columns.find(c => (c.field || c.colId) === field)?.required || requiredColumns.includes(field);
        return {
          ...col,
          hide: isRequired ? false : col.hide,
        };
      };

      return mergeSavedColumnState(savedState, defaultState).map(applyRequired);
    } catch (e) {
      console.warn('Failed to load column state from localStorage:', e);
      return getDefaultColumnState();
    }
  }, [getStorageKey, getDefaultColumnState, columns, requiredColumns]);

  const saveColumnState = useCallback((state: ColumnState[]) => {
    const storageKey = getStorageKey();
    if (!storageKey) return;
    
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch (e) {
      console.warn('Failed to save column state to localStorage:', e);
    }
  }, [getStorageKey]);

  const resetColumnState = useCallback(() => {
    const storageKey = getStorageKey();
    if (storageKey) {
      try {
        localStorage.removeItem(storageKey);
      } catch (e) {
        console.warn('Failed to remove column state from localStorage:', e);
      }
    }
    return getDefaultColumnState();
  }, [getStorageKey, getDefaultColumnState]);

  return {
    loadColumnState,
    saveColumnState,
    resetColumnState,
    getDefaultColumnState,
  };
}

export default function ServerDataGrid<T extends { id?: string | number }>({
  columns,
  endpoint,
  queryKey: _queryKey,
  getRowId,
  cacheBlockSize = 50,
  enableSearch = true,
  defaultSort = { field: 'created_at', direction: 'DESC' },
  extraParams = {},
  refreshKey,
  initialFilterModel,
  initialState,
  enableColumnChooser = true,
  requiredColumns = [],
  defaultHiddenColumns = [],
  columnPreferencesKey,
  onColumnStateChange,
  onCellClicked,
  onGridApiReady,
  onQueryStateChange,
  pinnedBottomRowData,
  enableRowSelection = false,
  onSelectionChanged,
  statusScopeConfig,
  enablePagination = false,
  paginationPageSize,
  toolbarExtras,
  showRowCount,
}: ServerDataGridProps<T>) {
  const { t, i18n } = useTranslation(['common', 'grid']);
  const { profile } = useAuth();
  const { tenantSlug } = useTenant();
  const { resolvedMode } = useThemeMode();
  const locale = useLocale();

  // Determine which column gets the row-count label (first column without a valueFormatter)
  const rowCountField = useMemo(() => {
    if (!showRowCount) return '';
    const col = columns.find(c => !c.valueFormatter) || columns[0];
    return col?.field || col?.colId || '';
  }, [showRowCount, columns]);

  const localeText = useMemo(() => {
    const bundle = i18n.getResourceBundle(locale, 'grid');
    if (!bundle || typeof bundle !== 'object') {
      return {};
    }
    return { ...(bundle as Record<string, string>) };
  }, [i18n, locale]);

  // Process columns to move custom properties to context to avoid AG Grid warnings
  const processedColumns = useMemo(() => {
    return columns.map(col => {
      const { required, defaultHidden, category, ...agGridCol } = col;

      const field = col.field || col.colId || '';

      // AG Grid replaces (does not merge) defaultColDef.filterParams with the column's own, so a date or
      // number column without filterParams would inherit the text options above ("contains"…): the
      // floating filter would offer nonsense operators and a deep-linked date model would be rewritten
      // to `contains` and silently ignored by the API. Give those columns their own operator set.
      if (!agGridCol.filterParams) {
        if (agGridCol.filter === 'agDateColumnFilter') agGridCol.filterParams = DATE_FILTER_PARAMS;
        else if (agGridCol.filter === 'agNumberColumnFilter') agGridCol.filterParams = NUMBER_FILTER_PARAMS;
      }

      // Pinned rows (totals) use the default renderer so numeric columns keep
      // AG Grid's right alignment. Custom React renderers wrap content in a
      // flex box that ignores text-align, which shifts totals vs body values.
      if (agGridCol.cellRenderer) {
        const orig = agGridCol.cellRenderer;
        agGridCol.cellRendererSelector = (params: any) => {
          if (params.node?.rowPinned) return undefined;
          return { component: orig };
        };
        delete agGridCol.cellRenderer;
      }

      // When showRowCount is enabled, suppress formatters for pinned
      // bottom rows on every column except the one carrying the label.
      if (showRowCount && field !== rowCountField && agGridCol.valueFormatter) {
        const origFmt = agGridCol.valueFormatter;
        agGridCol.valueFormatter = (params: any) => {
          if (params.node?.rowPinned) return '';
          return typeof origFmt === 'function' ? origFmt(params) : params.value;
        };
      }

      return {
        ...agGridCol,
        context: {
          ...agGridCol.context,
          required,
          defaultHidden,
          category,
        },
      };
    });
  }, [columns, showRowCount, rowCountField]);
  const navigate = useNavigate();
  const location = useLocation();
  const urlParams = new URLSearchParams(location.search);

  const sortFromUrl = urlParams.get('sort') || `${defaultSort.field}:${defaultSort.direction}`;
  const qFromUrl = urlParams.get('q') || '';

  const [search, setSearch] = useState(qFromUrl);
  const debouncedSearch = useDebouncedValue(search, 400);
  const [loadError, setLoadError] = useState<Error | undefined>();
  const [totalRowCount, setTotalRowCount] = useState<number | null>(null);

  const gridApiRef = useRef<any>(null);
  const columnApiRef = useRef<any>(null); // deprecated in AG Grid v32+, keep for backward compat (unused)
  const gridDivRef = useRef<HTMLDivElement | null>(null);
  const appliedInitialSortRef = useRef(false);
  const appliedInitialColumnStateRef = useRef(false);
  const [containerHeight, setContainerHeight] = useState<number>(480);

  const initialSortModel = useMemo(() => parseUrlSort(sortFromUrl, defaultSort), [sortFromUrl, defaultSort]);
  const [sortModel, setSortModel] = useState<SortModelItem[]>(initialSortModel);
  const filterModelRef = useRef<any>({});
  const appliedInitialFilterRef = useRef(false);

  const [statusScope, setStatusScope] = useState<StatusScope>(statusScopeConfig?.defaultScope ?? 'enabled');
  const statusScopeRef = useRef<StatusScope>(statusScope);
  useEffect(() => {
    statusScopeRef.current = statusScope;
  }, [statusScope]);

  // Column state management
  const columnStateManager = useColumnState(columnPreferencesKey, columns, requiredColumns, defaultHiddenColumns, tenantSlug ?? undefined, profile?.id);
  const [currentColumnState, setCurrentColumnState] = useState<ColumnState[]>(() => columnStateManager.loadColumnState());
  const initializedRef = useRef<boolean>(false);

  // Re-apply column state when tenant/user changes (scoped key changes)
  const scopedColumnKey = columnPreferencesKey && tenantSlug && profile?.id
    ? `grid-columns:${tenantSlug}:${profile.id}:${columnPreferencesKey}`
    : null;
  useEffect(() => {
    if (gridApiRef.current && scopedColumnKey) {
      const newState = columnStateManager.loadColumnState();
      (gridApiRef.current as any).applyColumnState?.({ state: newState, applyOrder: true });
      setCurrentColumnState(newState);
      appliedInitialColumnStateRef.current = false;
    }
  }, [scopedColumnKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Column state change handler
  const onColumnStateChanged = useCallback((e: any) => {
    const api = e?.api ?? gridApiRef.current;
    if (!api) return;
    
    try {
      const newColumnState = (api.getColumnState?.() ?? []) as ColumnState[];
      setCurrentColumnState(newColumnState);
      
      // Save to localStorage if enabled
      if (columnPreferencesKey) {
        columnStateManager.saveColumnState(newColumnState);
      }
      
      // Call external callback if provided
      if (onColumnStateChange) {
        onColumnStateChange(newColumnState);
      }
    } catch (e) {
      console.warn('Failed to handle column state change:', e);
    }
  }, [columnStateManager, columnPreferencesKey, onColumnStateChange]);

  // Custom column chooser state (Community Edition compatible)
  const [columnChooserAnchor, setColumnChooserAnchor] = useState<HTMLElement | null>(null);
  const columnChooserOpen = Boolean(columnChooserAnchor);

  // Column chooser handlers
  const handleShowColumnChooser = useCallback((event: React.MouseEvent<HTMLElement>) => {
    setColumnChooserAnchor(event.currentTarget);
  }, []);

  const handleCloseColumnChooser = useCallback(() => {
    setColumnChooserAnchor(null);
  }, []);

  const handleColumnToggle = useCallback((field: string, visible: boolean) => {
    const api = gridApiRef.current;
    if (!api) return;

    try {
      // Update column visibility
      (api as any).setColumnsVisible?.([field], visible);
      
      // Trigger column state change to save preferences
      const newColumnState = (api.getColumnState?.() ?? []) as ColumnState[];
      setCurrentColumnState(newColumnState);
      
      if (columnPreferencesKey) {
        columnStateManager.saveColumnState(newColumnState);
      }
      
      if (onColumnStateChange) {
        onColumnStateChange(newColumnState);
      }
    } catch (e) {
      console.warn('Failed to toggle column visibility:', e);
    }
  }, [columnStateManager, columnPreferencesKey, onColumnStateChange]);

  // Get visible columns for the chooser. A column the caller keeps out of the tool panel only
  // exists to carry a filter coming from a link, so it never shows up in the list either.
  const visibleColumns = useMemo(() => {
    return columns.filter(col => !col.suppressColumnsToolPanel).map(col => {
      const field = col.field || col.colId || '';
      const columnState = currentColumnState.find(state => state.colId === field);
      const isRequired = col.required || requiredColumns.includes(field);
      
      return {
        field,
        headerName: col.headerName || field,
        visible: columnState ? !columnState.hide : true,
        required: isRequired,
      };
    });
  }, [columns, currentColumnState, requiredColumns]);

  const handleResetColumns = useCallback(() => {
    const api = gridApiRef.current;
    if (!api) return;
    
    try {
      const defaultState = columnStateManager.resetColumnState();
      (api as any).applyColumnState?.({
        state: defaultState,
        applyOrder: true,
      });
      setCurrentColumnState(defaultState);
      
      // Call external callback if provided
      if (onColumnStateChange) {
        onColumnStateChange(defaultState);
      }
    } catch (e) {
      console.warn('Failed to reset columns:', e);
    }
  }, [columnStateManager, onColumnStateChange]);

  // Sync URL when sort/search change (no page/limit with infinite model)
  useEffect(() => {
    const sort = parseSortParam(sortModel, defaultSort);
    const next = new URLSearchParams(location.search);
    next.set('sort', sort);
    if (enableSearch) {
      if (debouncedSearch) next.set('q', debouncedSearch); else next.delete('q');
    }
    const current = new URLSearchParams(location.search).toString();
    const nextStr = next.toString();
    if (nextStr !== current) {
      navigate({ search: nextStr }, { replace: true });
    }
    // Inform parent of current query state
    try {
      if (onQueryStateChange) {
        onQueryStateChange({ sort, filterModel: filterModelRef.current, q: debouncedSearch, statusScope: statusScopeRef.current });
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortModel, debouncedSearch]);

  const sortParam = useMemo(() => parseSortParam(sortModel, defaultSort), [sortModel, defaultSort]);
  const sortParamRef = useRef(sortParam);
  useEffect(() => { sortParamRef.current = sortParam; }, [sortParam]);

  const searchRef = useRef(debouncedSearch);
  useEffect(() => { searchRef.current = debouncedSearch; }, [debouncedSearch]);

  // The Show scope changes the rows, so the parent hears about it like a sort, filter or
  // search change (the OPEX/CAPEX footers key their totals on it).
  const handleStatusScopeChange = useCallback((next: StatusScope) => {
    statusScopeRef.current = next;
    setStatusScope(next);
    try {
      onQueryStateChange?.({ sort: sortParamRef.current, filterModel: filterModelRef.current, q: searchRef.current, statusScope: next });
    } catch {}
  }, [onQueryStateChange]);

  const extraParamsRef = useRef(extraParams);
  const extraParamsKey = useMemo(() => JSON.stringify(extraParams ?? {}), [extraParams]);
  useEffect(() => { extraParamsRef.current = extraParams; }, [extraParamsKey]);

  // Keep endpoint current inside datasource without recreating it
  const endpointRef = useRef<string>(endpoint);
  useEffect(() => { endpointRef.current = endpoint; }, [endpoint]);

  const dataSourceRef = useRef<IDatasource>({
    getRows: async (params: IGetRowsParams) => {
      try {
        setLoadError(undefined);
        const startRow = params.startRow ?? 0;
        const limit = cacheBlockSize;
        const page = Math.floor(startRow / limit) + 1;
        const reqParams: any = {
          page,
          limit,
          // use AG's live sort model for accuracy
          sort: parseSortParam((params as any).sortModel, defaultSort),
          ...extraParamsRef.current,
        };
        // include AG filter model for server-side filtering
        const fmFromParams = (params as any).filterModel;
        const fm = fmFromParams && Object.keys(fmFromParams).length > 0 ? fmFromParams : filterModelRef.current;

        if (fm && Object.keys(fm).length > 0) reqParams.filters = JSON.stringify(fm);

        if (statusScopeConfig) {
          Object.assign(reqParams, statusScopeParams(statusScopeRef.current));
        }
        // include global quick search (server-side)
        const q = searchRef.current;
        if (enableSearch && q) reqParams.q = q;
        const res = await api.get<ServerResponse<T>>(endpointRef.current, { params: reqParams });
        const rows = (res.data?.items ?? []) as any[];
        const total = res.data?.total ?? rows.length;
        setTotalRowCount(total);
        params.successCallback(rows, total);
      } catch (e: any) {
        setLoadError(e instanceof Error ? e : new Error('Failed to load data'));
        params.failCallback();
      }
    },
  });


  const onGridReady = useCallback((event: GridReadyEvent) => {
    gridApiRef.current = event.api as any;
    
    // Apply initial column state if enabled and not already applied
    if (!appliedInitialColumnStateRef.current && columnPreferencesKey) {
      try {
        const initialColumnState = columnStateManager.loadColumnState();
        (event.api as any).applyColumnState?.({
          state: initialColumnState,
          applyOrder: true,
        });
        setCurrentColumnState(initialColumnState);
        appliedInitialColumnStateRef.current = true;
      } catch (e) {
        console.warn('Failed to apply initial column state:', e);
      }
    }
    
    // If initialState provided, apply the filter model
    if (!appliedInitialFilterRef.current && initialState?.filter?.filterModel) {
      try {
        const targetFilterModel = initialState.filter.filterModel;
        (event.api as any).setFilterModel?.(targetFilterModel);
        filterModelRef.current = targetFilterModel;
        appliedInitialFilterRef.current = true;
      } catch (e) {
        console.warn('Failed to apply initial filter model:', e);
      }
    }

    // Legacy path: apply explicit initialFilterModel BEFORE setting datasource
    if (!appliedInitialFilterRef.current && initialFilterModel && !initialState) {
      try {
        (event.api as any).setFilterModel?.(initialFilterModel);
        filterModelRef.current = initialFilterModel;
        appliedInitialFilterRef.current = true;
      } catch {}
    }
    
    // set initial sort so UI shows sort icons, only once to avoid loops
    if (!appliedInitialSortRef.current) {
      try {
        // v32+: use column state to set sort
        (event.api as any).applyColumnState?.({
          defaultState: { sort: null },
          state: sortModel.map(s => ({ colId: s.colId, sort: s.sort }))
        });
        appliedInitialSortRef.current = true;
      } catch {}
    }
    
    // finally, provide datasource once
    (event.api as any).setGridOption?.('datasource', dataSourceRef.current);

    // Call parent callback after initial state has been applied
    if (onGridApiReady) {
      onGridApiReady(event.api);
    }
    
    // Notify parent of initial state (no explicit filter-change trigger; datasource will load with current models)
    setTimeout(() => {
      try {
        if (onQueryStateChange) {
          const sort = parseSortParam(((event.api as any).getSortModel?.() ?? []) as SortModelItem[], defaultSort);
          const fm = (event.api as any).getFilterModel?.() ?? filterModelRef.current;
          onQueryStateChange({ sort, filterModel: fm, q: searchRef.current, statusScope: statusScopeRef.current });
        }
      } catch {}
    }, 0);
  }, [sortModel, initialState, initialFilterModel, columnStateManager, columnPreferencesKey, onGridApiReady, onQueryStateChange]);

  const onSortChanged = useCallback((e: any) => {
    const api = e?.api ?? gridApiRef.current;
    let model: SortModelItem[] = (api?.getSortModel?.() ?? []) as SortModelItem[];
    if ((!model || model.length === 0) && Array.isArray(e?.columns) && e.columns.length > 0) {
      const explicit = e.columns
        .map((col: any) => {
          const sort = col?.getSort?.();
          const colId = col?.getColId?.();
          return sort ? { colId, sort } : null;
        })
        .filter(Boolean) as SortModelItem[];
      if (explicit.length > 0) model = explicit;
    }
    if ((!model || model.length === 0) && e?.column) {
      const sort = e.column.getSort?.();
      const colId = e.column.getColId?.();
      if (sort && colId) {
        model = [{ colId, sort }];
      }
    }
    if ((!model || model.length === 0) && api?.getColumnState) {
      const state = (api.getColumnState?.() ?? []) as ColumnState[];
      const sorted = state.find((col) => col.sort && col.colId);
      if (sorted?.colId && sorted.sort) {
        model = [{ colId: sorted.colId, sort: sorted.sort as 'asc' | 'desc' }];
      }
    }
    if (!model || model.length === 0) {
      model = [];
    }
    // Deep-compare to avoid redundant state updates that would purge cache
    const sameLength = model.length === sortModel.length;
    const isSame = sameLength && model.every((m, i) => m.colId === sortModel[i].colId && m.sort === sortModel[i].sort);
    if (!isSame) setSortModel(model);
    try {
      if (onQueryStateChange) {
        const sort = parseSortParam(model, defaultSort);
        onQueryStateChange({ sort, filterModel: filterModelRef.current, q: searchRef.current, statusScope: statusScopeRef.current });
      }
    } catch {}
  }, [defaultSort, onQueryStateChange, sortModel]);

  const onFilterChanged = useCallback((e: any) => {
    const api = e?.api ?? gridApiRef.current;
    const fm = api?.getFilterModel?.() ?? {};
    filterModelRef.current = fm;
    try {
      if (enablePagination) {
        (api as any)?.paginationGoToFirstPage?.();
      }
      (api as any)?.purgeInfiniteCache?.();
      if (api?.ensureIndexVisible) api.ensureIndexVisible(0, 'top');
    } catch {}
    // Inform parent immediately
    try {
      if (onQueryStateChange) {
        const sort = parseSortParam((api?.getSortModel?.() ?? []) as SortModelItem[], defaultSort);
        onQueryStateChange({ sort, filterModel: fm, q: searchRef.current, statusScope: statusScopeRef.current });
      }
    } catch {}
  }, [defaultSort, enablePagination, onQueryStateChange]);


  // Reset data when sort/search, extra params, refreshKey, endpoint, or status scope change
  useEffect(() => {
    // Skip first run to avoid double-fetch on mount
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    const api = gridApiRef.current;
    // update URL handled in other effect; here we simply purge cache to refetch with new params
    try {
      if (enablePagination) {
        (api as any)?.paginationGoToFirstPage?.();
      }
      (api as any)?.purgeInfiniteCache?.();
      if (api?.ensureIndexVisible) api.ensureIndexVisible(0, 'top');
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortModel, debouncedSearch, extraParamsKey, refreshKey, endpoint, statusScope, enablePagination]);

  const agGetRowId = useCallback((params: GetRowIdParams<T>) => {
    if (getRowId) return String(getRowId(params.data));
    const row: any = params.data as any;
    return row?.id != null ? String(row.id) : String(params.data as any);
  }, [getRowId]);

  // Stabilize grid option objects to avoid unnecessary grid reconfigurations
  const defaultColDef = useMemo(() => ({
    sortable: true,
    filter: true,
    floatingFilter: true,
    floatingFilterComponent: ClearableColumnFloatingFilter,
    suppressMovable: false,
    resizable: true,
    filterParams: {
      suppressAndOrCondition: true,
      maxNumConditions: 1,
      filterOptions: [
        'contains',
        'notContains',
        'equals',
        'notEqual',
        'startsWith',
        'endsWith',
        'blank',
        'notBlank',
      ],
      defaultOption: 'contains',
    },
  }), []);

  const rowSelection = useMemo(() => {
    if (!enableRowSelection) {
      return {
        mode: 'singleRow' as const,
        enableClickSelection: false,
      };
    }
    return {
      mode: 'multiRow' as const,
      checkboxes: true,
      // headerCheckbox not supported with infinite row model
      enableClickSelection: false,
    };
  }, [enableRowSelection]);

  const gridContext = useMemo(() => ({
    getQueryState: () => ({
      q: searchRef.current || '',
      filters: filterModelRef.current || {},
      extraParams: extraParamsRef.current || {},
      statusScope: statusScopeRef.current,
    }),
  }), []);

  const handleSelectionChanged = useCallback((event: any) => {
    if (!enableRowSelection || !onSelectionChanged) return;
    const api = event?.api ?? gridApiRef.current;
    if (!api) return;

    try {
      const selectedNodes = api.getSelectedNodes?.() ?? [];
      const selectedRows = selectedNodes.map((node: any) => node.data).filter(Boolean);
      onSelectionChanged(selectedRows);
    } catch (e) {
      console.warn('Failed to get selected rows:', e);
    }
  }, [enableRowSelection, onSelectionChanged]);

  // Sticky top horizontal scrollbar synced with grid (for wide tables)
  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const [topScrollContentWidth, setTopScrollContentWidth] = useState<number>(0);
  const [showTopScroll, setShowTopScroll] = useState<boolean>(false);
  const syncingRef = useRef(false);
  const lastShowRef = useRef<boolean>(false);
  const measureRafRef = useRef<number | null>(null);

  const recalcTopScrollWidth = useCallback(() => {
    if (measureRafRef.current != null) return; // throttle to next animation frame
    measureRafRef.current = window.requestAnimationFrame(() => {
      measureRafRef.current = null;
      const gridDiv = gridDivRef.current;
      if (!gridDiv) return;
      // Prefer DOM measurement for center viewport scroll width
      const centerViewport = gridDiv.querySelector('.ag-center-cols-viewport') as HTMLDivElement | null;
      const containerWidth = gridDiv.clientWidth || 0;
      let contentWidth = 0;
      if (centerViewport) {
        contentWidth = centerViewport.scrollWidth || 0;
      } else if (gridApiRef.current?.getDisplayedCenterColumns) {
        try {
          const cols = gridApiRef.current.getDisplayedCenterColumns();
          contentWidth = cols.reduce((acc: number, c: any) => acc + (c.getActualWidth?.() ?? c.actualWidth ?? 0), 0);
        } catch {}
      }
      if (!contentWidth) contentWidth = containerWidth;

      // Update width only when it meaningfully changes
      setTopScrollContentWidth((prev) => Math.abs(prev - contentWidth) > 2 ? contentWidth : prev);

      // Hysteresis to avoid flicker around threshold
      const overflow = contentWidth - containerWidth;
      const shouldShow = overflow > 8; // show when > 8px overflow
      const shouldHide = overflow < -8; // hide when container much wider
      setShowTopScroll((prev) => {
        const curr = prev;
        let next = curr;
        if (!curr && shouldShow) next = true;
        else if (curr && shouldHide) next = false;
        lastShowRef.current = next;
        return next;
      });
    });
  }, []);

  // Measure available height so the grid fits within the viewport
  const measureContainerHeight = useCallback(() => {
    if (!gridDivRef.current) return;
    const rect = gridDivRef.current.getBoundingClientRect();
    // Leave a small bottom padding (matches main container padding ~16px)
    const bottomPad = 16;
    const next = Math.max(200, Math.floor(window.innerHeight - rect.top - bottomPad));
    setContainerHeight(next);
  }, []);

  useEffect(() => {
    // Initial measure and on resize/orientation changes
    const onResize = () => {
      measureContainerHeight();
      // recalc horizontal scrollbar width after height changes
      recalcTopScrollWidth();
    };
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize as any);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize as any);
    };
  }, [measureContainerHeight, recalcTopScrollWidth]);

  const syncTopToGrid = useCallback((left: number) => {
    const top = topScrollRef.current;
    if (!top) return;
    if (Math.abs((top.scrollLeft || 0) - left) < 1) return;
    syncingRef.current = true;
    top.scrollLeft = left;
    // release lock soon
    window.requestAnimationFrame(() => { syncingRef.current = false; });
  }, []);

  const syncGridToTop = useCallback(() => {
    if (!gridDivRef.current || !topScrollRef.current) return;
    const bottomViewport = gridDivRef.current.querySelector('.ag-body-horizontal-scroll-viewport') as HTMLDivElement | null;
    if (!bottomViewport) return;
    if (syncingRef.current) return;
    syncingRef.current = true;
    bottomViewport.scrollLeft = topScrollRef.current.scrollLeft;
    window.requestAnimationFrame(() => { syncingRef.current = false; });
  }, []);

  // Observe container size to recompute when window resizes
  useEffect(() => {
    if (!gridDivRef.current) return;
    const obs = new ResizeObserver(() => recalcTopScrollWidth());
    obs.observe(gridDivRef.current);
    return () => obs.disconnect();
  }, [recalcTopScrollWidth]);

  const mergedPinnedBottomRowData = useMemo(() => {
    const rows: any[] = [];
    if (showRowCount && totalRowCount !== null && rowCountField) {
      rows.push({ [rowCountField]: t('common:labels.totalWithCount', { count: totalRowCount }) });
    }
    if (pinnedBottomRowData) {
      rows.push(...pinnedBottomRowData);
    }
    return rows.length > 0 ? rows : undefined;
  }, [showRowCount, totalRowCount, rowCountField, pinnedBottomRowData, t]);

  const showAuxHorizontalScrollbar = showTopScroll && !enablePagination;

  return (
    // No percentage height: list pages render the grid as a direct child of the bounded page
    // scroller, where `height: 100%` would add the page header on top of a full viewport and
    // scroll the page. The grid div below sizes itself to the viewport instead.
    <Box sx={{ width: '100%', minWidth: 0, overflowX: 'hidden' }}>
      <Stack spacing={1} sx={{ mb: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
          {enableSearch && (
            <TextField
              size="small"
              placeholder={t('common:filters.quickFilter')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{
                endAdornment: search ? (
                  <IconButton
                    size="small"
                    aria-label={t('common:filters.clearQuickFilter')}
                    onClick={() => setSearch('')}
                    edge="end"
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                ) : undefined,
              }}
            />
          )}
          {statusScopeConfig && (
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Typography variant="body2">{t('common:labels.show')}:</Typography>
              <RadioGroup
                row
                value={statusScope}
                onChange={(event) => handleStatusScopeChange(event.target.value as StatusScope)}
                sx={{ '& .MuiFormControlLabel-root': { mr: 1 } }}
              >
                {(statusScopeConfig.scopes ?? ['all', 'enabled', 'disabled']).map((scope) => (
                  <FormControlLabel
                    key={scope}
                    value={scope}
                    control={<Radio size="small" />}
                    label={t(`common:labels.${scope}`)}
                  />
                ))}
              </RadioGroup>
            </Stack>
          )}
          {toolbarExtras}
        </Stack>
        {!!loadError && <Alert severity="error">{(loadError as any)?.message || t('common:messages.loadFailed')}</Alert>}
        {enableColumnChooser && (
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Button size="small" onClick={handleShowColumnChooser}>
              {t('common:buttons.chooseColumns')}
            </Button>
            <Button size="small" onClick={handleResetColumns}>
              {t('common:buttons.resetColumns')}
            </Button>
          </Stack>
        )}
      </Stack>
      <div
        style={{
          height: containerHeight,
          width: '100%',
          position: 'relative',
          overflow: 'hidden', // contain grid overflow; grid manages its own scrollbars
          paddingBottom: showAuxHorizontalScrollbar ? 14 : 0, // reserve space only when sticky aux scroller is shown
        }}
        className={resolvedMode === 'dark' ? 'ag-theme-quartz-dark' : 'ag-theme-quartz'}
        ref={gridDivRef}
      >
        <AgGridReact<T>
          columnDefs={processedColumns}
          rowModelType="infinite"
          pagination={enablePagination}
          paginationPageSize={paginationPageSize ?? cacheBlockSize}
          initialState={initialState}
          defaultColDef={defaultColDef}
          context={gridContext}
          localeText={localeText}
          pinnedBottomRowData={mergedPinnedBottomRowData}
          cacheBlockSize={cacheBlockSize}
          maxConcurrentDatasourceRequests={1}
          getRowId={agGetRowId}
          onGridReady={(e) => {
            onGridReady(e);
            gridApiRef.current = e.api;
            // Initial sizing after first render
            setTimeout(() => { measureContainerHeight(); recalcTopScrollWidth(); }, 0);
          }}
          onSortChanged={onSortChanged}
          onFilterChanged={onFilterChanged}
          onColumnVisible={(ev) => { onColumnStateChanged(ev); recalcTopScrollWidth(); }}
          onColumnPinned={(ev) => { onColumnStateChanged(ev); recalcTopScrollWidth(); }}
          onColumnResized={(ev) => { onColumnStateChanged(ev); recalcTopScrollWidth(); }}
          onColumnMoved={(ev) => { onColumnStateChanged(ev); recalcTopScrollWidth(); }}
          onDisplayedColumnsChanged={() => recalcTopScrollWidth()}
          onBodyScroll={(p: any) => {
            // Sync grid horizontal scroll to top scroller only; avoid layout thrash
            try {
              if (p?.direction === 'horizontal' || (typeof p?.left === 'number')) {
                syncTopToGrid(Number(p.left || 0));
              }
            } catch {}
          }}
          rowSelection={rowSelection}
        onSelectionChanged={handleSelectionChanged}
        onCellClicked={onCellClicked as any}
        // Explicitly allow column moving at the grid level
        suppressMovableColumns={false}
        // Preserve user order when column defs update between renders
        maintainColumnOrder
      />

        {/* Sticky bottom horizontal scrollbar for wide tables */}
        {showAuxHorizontalScrollbar && (
          <div
            ref={topScrollRef}
            onScroll={syncGridToTop}
            style={{
              position: 'sticky',
              bottom: 0,
              zIndex: 2,
              height: 14,
              overflowX: 'auto',
              overflowY: 'hidden',
              background: 'transparent',
            }}
          >
            <div style={{ width: Math.max(topScrollContentWidth, 0), height: 1 }} />
          </div>
        )}
      </div>

      {/* Custom Column Chooser Popover (Community Edition Compatible) */}
      <Popover
        open={columnChooserOpen}
        anchorEl={columnChooserAnchor}
        onClose={handleCloseColumnChooser}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'left',
        }}
      >
        <Box sx={{ p: 2, minWidth: 250, maxWidth: 350 }}>
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 500 }}>
            {t('common:buttons.chooseColumns')}
          </Typography>
          <Divider sx={{ mb: 1 }} />
          <Stack spacing={0.5} sx={{ maxHeight: 300, overflowY: 'auto' }}>
            {visibleColumns.map((col) => (
              <FormControlLabel
                key={col.field}
                control={
                  <Checkbox
                    size="small"
                    checked={col.visible}
                    disabled={col.required}
                    onChange={(e) => handleColumnToggle(col.field, e.target.checked)}
                  />
                }
                label={
                  <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>
                    {col.headerName}
                    {col.required && (
                      <Typography component="span" variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
                        {t('common:labels.requiredTag')}
                      </Typography>
                    )}
                  </Typography>
                }
                sx={{ 
                  ml: 0, 
                  mr: 0,
                  '& .MuiFormControlLabel-label': { 
                    flex: 1,
                    opacity: col.required ? 0.7 : 1,
                  }
                }}
              />
            ))}
          </Stack>
          <Divider sx={{ my: 1 }} />
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button size="small" onClick={handleResetColumns}>
              {t('common:buttons.reset')}
            </Button>
            <Button size="small" variant="contained" onClick={handleCloseColumnChooser}>
              {t('common:buttons.done')}
            </Button>
          </Stack>
        </Box>
      </Popover>
    </Box>
  );
}
