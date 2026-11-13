import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Checkbox } from '@mui/material';
import type { CellStyle, ICellRendererParams } from 'ag-grid-community';
import { useTranslation } from 'react-i18next';
import type { EnhancedColDef, ListRequest } from '../ServerDataGrid';

/**
 * The rows a list changes in bulk (lot F1 of 26.11.8, the model of the vulnerabilities list): the
 * ticked rows (`all` false, `ids` the ticked ones), or every row of the list's current filter,
 * loaded or not (`all` true, `ids` the rows unticked since). The ticked rows keep their data
 * (`rows`), for an action that names them (the delete of the selection).
 */
export type BulkSelection<T> = { all: boolean; ids: ReadonlySet<string>; rows: ReadonlyMap<string, T> };

/**
 * What a list's rows are, for the texts of the selection and of its dialog that name them: the
 * i18next context of their keys (`bulkEdit.willChange_applications_one`). None: rows.
 */
export type BulkEditFamily = 'applications';

type SelectionApi = {
  all: boolean;
  family?: BulkEditFamily;
  isSelected: (id: string) => boolean;
  /** Every row of the filter, none unticked. */
  whole: boolean;
  count: number;
  toggleRow: (row: { id: string }) => void;
  toggleAll: () => void;
  rowLabel: (row: any) => string;
};
/** Read by the selection column's cells and header, which the grid renders inside the page. */
const SelectionContext = createContext<SelectionApi | null>(null);

/** The column of the row boxes: its header takes every row of the filter. */
export const BULK_SELECTION_COLUMN = 'select';
/** The box alone, centred: the cell's padding would push it past 44 px and cut it ("…"). */
const SELECT_CELL_STYLE: CellStyle = { padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textOverflow: 'clip' };
const checkboxSx = { p: 0.25 } as const;

/** Around the grid: the header of the box column, the box alone and centred. */
export const bulkSelectionGridSx = {
  [`& .ag-header-cell[col-id="${BULK_SELECTION_COLUMN}"]`]: { px: 0 },
  [`& .ag-header-cell[col-id="${BULK_SELECTION_COLUMN}"] .ag-header-cell-comp-wrapper`]: { justifyContent: 'center' },
} as const;

/** A row's box in the selection column; none on a pinned row (a totals row). */
function SelectRowCell({ data, node }: ICellRendererParams<{ id: string }>) {
  const api = useContext(SelectionContext);
  if (!data?.id || node?.rowPinned || !api) return null;
  return (
    <Checkbox
      size="small"
      sx={checkboxSx}
      checked={api.isSelected(data.id)}
      onChange={() => api.toggleRow(data)}
      inputProps={{ 'aria-label': api.rowLabel(data) }}
    />
  );
}

/** The selection column's header: every row of the current filter, loaded or not; again to clear. */
function SelectAllHeader() {
  const { t } = useTranslation('common');
  const api = useContext(SelectionContext);
  if (!api) return null;
  return (
    <Checkbox
      size="small"
      sx={checkboxSx}
      checked={api.whole}
      indeterminate={!api.whole && api.count > 0}
      onChange={api.toggleAll}
      inputProps={{ 'aria-label': t('bulkEdit.selectAll', { context: api.family }) }}
    />
  );
}

const NO_IDS: ReadonlySet<string> = new Set();
const NO_ROWS: ReadonlyMap<string, any> = new Map();

/**
 * The selection of a `ServerDataGrid` list: put `column` first in its columns, wrap the page in
 * `Provider`, and hand `onListRequestChange` and `onCellClicked` to the grid. A change of the list's
 * scope (`scopeKey` of its parameters: by default all but the sort) clears the selection: a
 * selection made on other rows would not be the one on screen.
 */
export function useBulkSelection<T extends { id: string }>(options: {
  /** The accessible name of a row's box ("Select Servers"). */
  rowLabel: (row: T) => string;
  /** What the rows are, for the header box's name; none: rows. */
  family?: BulkEditFamily;
  /** The parameters that make the list's rows; the others (sort, columns shown) keep the selection. */
  scopeKey?: (params: Record<string, unknown>) => unknown;
}) {
  const [selection, setSelection] = useState<BulkSelection<T>>({ all: false, ids: NO_IDS, rows: NO_ROWS });
  const [request, setRequest] = useState<ListRequest | null>(null);
  const scopeKeyRef = useRef<string | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const clear = useCallback(() => setSelection({ all: false, ids: NO_IDS, rows: NO_ROWS }), []);
  const toggleRow = useCallback((row: T) => setSelection((current) => {
    const ids = new Set(current.ids);
    const rows = new Map(current.rows);
    if (ids.has(row.id)) {
      ids.delete(row.id);
      rows.delete(row.id);
    } else {
      ids.add(row.id);
      if (!current.all) rows.set(row.id, row);
    }
    return { all: current.all, ids, rows };
  }), []);
  const toggleAll = useCallback(() => setSelection((current) => (
    current.all && current.ids.size === 0
      ? { all: false, ids: NO_IDS, rows: NO_ROWS }
      : { all: true, ids: NO_IDS, rows: NO_ROWS }
  )), []);

  const onListRequestChange = useCallback((next: ListRequest) => {
    setRequest(next);
    const scopeKey = optionsRef.current.scopeKey ?? (({ sort: _sort, ...rest }) => rest);
    const key = JSON.stringify(scopeKey(next.params));
    if (scopeKeyRef.current !== null && scopeKeyRef.current !== key) clear();
    scopeKeyRef.current = key;
  }, [clear]);

  const count = selection.all ? Math.max((request?.total ?? 0) - selection.ids.size, 0) : selection.ids.size;

  const api = useMemo<SelectionApi>(() => ({
    all: selection.all,
    isSelected: (id) => (selection.all ? !selection.ids.has(id) : selection.ids.has(id)),
    whole: selection.all && selection.ids.size === 0,
    count,
    toggleRow: toggleRow as (row: { id: string }) => void,
    toggleAll,
    rowLabel: (row) => optionsRef.current.rowLabel(row),
    family: optionsRef.current.family,
  }), [count, selection, toggleAll, toggleRow]);

  // The column, stable: the page's columns are not rebuilt on each tick.
  const column = useMemo<EnhancedColDef<T>>(() => ({
    colId: BULK_SELECTION_COLUMN,
    headerName: '',
    width: 44,
    minWidth: 44,
    maxWidth: 44,
    lockPosition: 'left',
    suppressColumnsToolPanel: true,
    suppressMovable: true,
    resizable: false,
    sortable: false,
    filter: false,
    suppressHeaderMenuButton: true,
    cellStyle: SELECT_CELL_STYLE,
    headerComponent: SelectAllHeader,
    cellRenderer: SelectRowCell,
    // Space on the focused cell or header ticks, as the box would (AG Grid keeps the focus on the cell).
    suppressKeyboardEvent: (params: any) => {
      if (params.editing || params.event.key !== ' ') return false;
      if (params.event.type === 'keydown' && params.data?.id && !params.node?.rowPinned) {
        params.event.preventDefault();
        toggleRow(params.data);
      }
      return true;
    },
    suppressHeaderKeyboardEvent: (params: any) => {
      if (params.event.key !== ' ') return false;
      if (params.event.type === 'keydown') {
        params.event.preventDefault();
        toggleAll();
      }
      return true;
    },
  }), [toggleAll, toggleRow]);

  /** A click in the selection cell beside the box ticks it too; the box ticks itself. */
  const onCellClicked = useCallback((event: any) => {
    if (!event?.data?.id || event.node?.rowPinned || event.column?.getColId?.() !== BULK_SELECTION_COLUMN) return;
    const target = event.event?.target as HTMLElement | undefined;
    if (!target?.closest?.('input')) toggleRow(event.data);
  }, [toggleRow]);

  return {
    selection,
    /** The rows chosen: the ticked ones, or the filter's total less the unticked ones. */
    count,
    /** The ticked rows with their data; none while the whole filter is taken. */
    tickedRows: useMemo(() => (selection.all ? [] : Array.from(selection.rows.values())), [selection]),
    clear,
    toggleRow,
    toggleAll,
    column,
    onCellClicked,
    onListRequestChange,
    /** The body part naming the rows for a bulk route (`common/bulk-edit/bulk-edit.ts`). */
    body: useMemo(() => bulkSelectionBody(selection, request), [request, selection]),
    /** For `BulkSelectionScope`, around the grid. */
    scope: api,
  };
}

/** Gives the selection column's cells and header the page's selection (`useBulkSelection().scope`). */
export function BulkSelectionScope({ value, children }: { value: SelectionApi; children: React.ReactNode }) {
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/** The list's parameters without its paging and sort: the `filters` of a bulk route. */
export function listScopeParams(request: ListRequest | null): Record<string, unknown> {
  const { page: _page, limit: _limit, sort: _sort, ...rest } = (request?.params ?? {}) as Record<string, unknown>;
  return rest;
}

/** `{ ids }`, or `{ all: true, filters, exclude_ids }`: the rows of the common bulk contract. */
export function bulkSelectionBody(selection: BulkSelection<unknown>, request: ListRequest | null): Record<string, unknown> {
  const ids = Array.from(selection.ids);
  if (!selection.all) return { ids };
  return { all: true, filters: listScopeParams(request), ...(ids.length > 0 ? { exclude_ids: ids } : {}) };
}
