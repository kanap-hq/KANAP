import React from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import { AgGridReact } from 'ag-grid-react';
import { useAgGridLocaleText } from '../grid/useAgGridLocaleText';
import type { AgGridReactProps } from 'ag-grid-react';
import type { ColDef, ColGroupDef } from 'ag-grid-community';
import AgGridBox from '../AgGridBox';
import { useReportPrinting } from './reportPrint';

type ReportGridProps<TData> = AgGridReactProps<TData> & {
  /** Styles of the themed wrapper on screen (typically a fixed height). */
  wrapperSx?: SxProps<Theme>;
  /** Extra class of the themed wrapper on screen (`kanap-dense-grid`). */
  wrapperClassName?: string;
  /** Ref to the themed wrapper on screen (viewport-height measurement, PNG export). */
  wrapperRef?: React.Ref<HTMLDivElement>;
};

type Leaf = { col: ColDef; group?: ColGroupDef };

function isGroup(def: ColDef | ColGroupDef): def is ColGroupDef {
  return 'children' in def && Array.isArray((def as ColGroupDef).children);
}

/** Visible leaf columns in order, each remembering its (single-level) group. */
function leafColumns(defs: (ColDef | ColGroupDef)[] | null | undefined, group?: ColGroupDef): Leaf[] {
  const out: Leaf[] = [];
  for (const def of defs ?? []) {
    if (isGroup(def)) {
      out.push(...leafColumns(def.children, def));
    } else if (!def.hide) {
      out.push({ col: def, group });
    }
  }
  return out;
}

function readPath(row: any, path: string | undefined): unknown {
  if (!row || !path) return undefined;
  if (path in row) return row[path];
  return path.split('.').reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), row);
}

function humanize(field: string | undefined): string {
  if (!field) return '';
  const last = field.split('.').pop() ?? field;
  const spaced = last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isRightAligned(col: ColDef): boolean {
  const types = Array.isArray(col.type) ? col.type : col.type ? [col.type] : [];
  if (types.includes('rightAligned') || types.includes('numericColumn')) return true;
  const cls = col.cellClass;
  return typeof cls === 'string' && cls.includes('ag-right-aligned-cell');
}

function keyOf(col: ColDef, index: number) {
  return col.colId ?? col.field ?? `${col.headerName ?? ''}#${index}`;
}

/** The params a value getter, formatter, style or renderer receives on paper. */
function cellParams(col: ColDef, row: any, pinned: 'bottom' | null) {
  const node = { data: row, rowPinned: pinned, group: false } as any;
  const base = { data: row, colDef: col, node, column: null, api: null, columnApi: null, context: undefined } as any;
  const value = typeof col.valueGetter === 'function' ? col.valueGetter({ ...base, getValue: () => undefined }) : readPath(row, col.field);
  const valueFormatted = typeof col.valueFormatter === 'function' ? col.valueFormatter({ ...base, value }) : null;
  return { ...base, value, valueFormatted };
}

function cellStyle(col: ColDef, params: any): React.CSSProperties | undefined {
  const style = typeof col.cellStyle === 'function' ? col.cellStyle(params) : col.cellStyle;
  return (style ?? undefined) as React.CSSProperties | undefined;
}

/**
 * Cell content on paper: the column's own renderer when it is a component (links, status
 * chips, counts that open a list all keep their look; links print as plain text), else
 * the formatted value.
 */
function cellContent(col: ColDef, params: any): React.ReactNode {
  const Renderer = col.cellRenderer;
  if (typeof Renderer === 'function') {
    const props = { ...params, ...(col.cellRendererParams ?? {}) };
    if (Renderer.prototype && Renderer.prototype.isReactComponent) {
      const Cls = Renderer as React.ComponentClass<any>;
      return <Cls {...props} />;
    }
    const Fn = Renderer as React.FunctionComponent<any>;
    return <Fn {...props} />;
  }
  const text = params.valueFormatted ?? params.value;
  if (text == null || typeof text === 'object') return '';
  return String(text);
}

/**
 * Paper rendering of a grid: every row and column, no virtualisation, headers repeated
 * on each page by the print stylesheet. Values, formats, styles and renderers follow the
 * same column definitions as the screen grid so both read identically.
 */
function PrintTable<TData>({ rowData, columnDefs, pinnedBottomRowData, getRowStyle }: AgGridReactProps<TData>) {
  const leaves = leafColumns(columnDefs as (ColDef | ColGroupDef)[]);
  const grouped = leaves.some((leaf) => leaf.group);
  const rows = (rowData ?? []) as any[];
  const footer = (pinnedBottomRowData ?? []) as any[];

  const groupHeaders: { group?: ColGroupDef; span: number }[] = [];
  for (const leaf of leaves) {
    const last = groupHeaders[groupHeaders.length - 1];
    if (last && last.group === leaf.group && leaf.group) last.span += 1;
    else groupHeaders.push({ group: leaf.group, span: 1 });
  }

  const rowStyle = (row: any, pinned: 'bottom' | null) =>
    typeof getRowStyle === 'function'
      ? (getRowStyle({ data: row, node: { data: row, rowPinned: pinned } } as any) as React.CSSProperties | undefined)
      : undefined;

  const renderRow = (row: any, rowIndex: number, pinned: 'bottom' | null) => (
    <tr key={rowIndex} style={rowStyle(row, pinned)}>
      {leaves.map(({ col }, index) => {
        const params = cellParams(col, row, pinned);
        return (
          <td key={keyOf(col, index)} className={isRightAligned(col) ? 'num' : undefined} style={cellStyle(col, params)}>
            {cellContent(col, params)}
          </td>
        );
      })}
    </tr>
  );

  return (
    <table className="report-print-table">
      <thead>
        {grouped && (
          <tr className="group">
            {groupHeaders.map((header, index) => (
              <th key={index} colSpan={header.span}>{header.group?.headerName ?? ''}</th>
            ))}
          </tr>
        )}
        <tr>
          {leaves.map(({ col }, index) => (
            <th key={keyOf(col, index)} className={isRightAligned(col) ? 'num' : undefined}>
              {col.headerName ?? humanize(col.field)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{rows.map((row, index) => renderRow(row, index, null))}</tbody>
      {footer.length > 0 && <tfoot>{footer.map((row, index) => renderRow(row, index, 'bottom'))}</tfoot>}
    </table>
  );
}

/**
 * AG Grid for report pages. On screen it is the usual themed grid; while the report is
 * printed it renders as a static table, because a virtualised grid prints empty rows
 * and clipped columns.
 */
export default function ReportGrid<TData = any>({ wrapperSx, wrapperClassName, wrapperRef, ...gridProps }: ReportGridProps<TData>) {
  const printing = useReportPrinting();
  // Before the early return: the hook count stays the same when printing starts or ends.
  const localeText = useAgGridLocaleText();
  if (printing) {
    return <PrintTable<TData> {...gridProps} />;
  }
  return (
    <Box component={AgGridBox} ref={wrapperRef} className={wrapperClassName} sx={wrapperSx}>
      <AgGridReact<TData> localeText={localeText} {...gridProps} />
    </Box>
  );
}
