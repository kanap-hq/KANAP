import React from 'react';
import { Box, Button, IconButton, Typography, useTheme } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { MONO_FONT_FAMILY } from '../../config/ThemeContext';
import InfoHint from './InfoHint';

/** One column of a relations table. */
export type RelationsColumn<T> = {
  key: string;
  header: React.ReactNode;
  /**
   * Width in px. The column without one is the name: on a wide frame it takes its content,
   * between 240 and 400px. In a narrow table the widths shrink, down to 96px (a date, an
   * amount), so that the name keeps at least 120px.
   */
  width?: number;
  /** The least width the column shrinks to in a narrow table, in place of the 96px floor (a label with long words). */
  minWidth?: number;
  align?: 'left' | 'right';
  /** The cells wrap on several lines instead of being cut by the ellipsis (a list of names, a long label). */
  wrap?: boolean;
  /**
   * The column hides in a table too narrow for it (1 first, then 2, ...), once the columns with a
   * width would otherwise lose more than a fifth of it or go below 96px. Without one, the column
   * always shows.
   */
  hideOrder?: number;
  /**
   * How many columns this cell covers for the row (1 by default). The following columns are
   * skipped, so their render is not called. The span stops at the last column still shown.
   */
  span?: (row: T) => number;
  render: (row: T) => React.ReactNode;
};

type TableProps<T> = {
  columns: Array<RelationsColumn<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  /** The page a row opens: the whole row is a link. */
  rowHref?: (row: T) => string | null;
  /**
   * Makes the name cell a real link to `rowHref` (middle click, Tab then Enter, copy the address),
   * the row keeping its click. Only for tables whose cells hold no link of their own.
   */
  linkRows?: boolean;
  /** What a click on a row does when it is not a page of the app (open a web link, download a file). */
  onRowOpen?: (row: T) => void;
  /** Shown faded (a disabled object stays listed). */
  rowMuted?: (row: T) => boolean;
  /** Hover-revealed unlink action, saved at once (no dialog: the row affects nothing else). */
  onRemove?: (row: T) => void;
  removeLabel?: (row: T) => string;
  /** Rows that can be unlinked (all by default); the others keep an empty trailing cell. */
  canRemove?: (row: T) => boolean;
  /**
   * A trailing action column (for example "Link" on a suggestion). `width` is its least width:
   * the column grows to its label, with no cap.
   */
  action?: { width: number; render: (row: T) => React.ReactNode };
  /** Total lines under the rows: a label in the first column, then cells by column key. */
  totals?: Array<{ key: string; label: React.ReactNode; cells: Record<string, React.ReactNode> }>;
  /**
   * Rows kept under one folded line at the end of the body, closed at first: `label` names them
   * with their count, a click opens them in this table. With no other row, the headers show once
   * the line is open.
   */
  folded?: { label: React.ReactNode; rows: T[] };
  ariaLabel?: string;
};

/** A business reference (`BL-12`, `PRJ-7`): mono, tertiary, tabular. */
export function RelationRef({ children }: { children: React.ReactNode }) {
  return (
    <Box component="span" sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: 12, color: 'kanap.text.tertiary', fontVariantNumeric: 'tabular-nums' }}>
      {children}
    </Box>
  );
}

/** The least width of the column without a width (the name). */
const FLEX_MIN_WIDTH = 120;
/** A column with a width shrinks no further than this, which holds a date (a narrower one keeps its own). */
const COLUMN_MIN_WIDTH = 96;
/** The share of their width the columns may lose before the next one with a `hideOrder` hides. */
const MAX_SHRINK = 0.2;
/** The least width of the name when the frame has room for the columns' targets. */
export const NAME_MIN_WIDE = 240;
/** The most the name grows to, whatever its content. */
export const NAME_MAX = 400;
/** The most a column with a declared width grows to (a wider declaration keeps its own). */
export const GROW_MAX = 360;

/** The width a column with a width shrinks to: its `minWidth`, or 96px (a narrower column keeps its own). */
function leastWidth(column: Pick<RelationsColumn<unknown>, 'width' | 'minWidth'>): number | undefined {
  if (column.width == null) return undefined;
  return Math.min(column.width, column.minWidth ?? COLUMN_MIN_WIDTH);
}

/**
 * Fits the column widths in `available` px (the trailing action columns excluded): the columns
 * with a width give up room in proportion to what they can spare, so that the column without
 * one keeps `FLEX_MIN_WIDTH`. When even their least widths do not fit, `minWidth` is the width
 * the table needs, and its frame scrolls.
 */
export function fitColumnWidths(
  columns: Array<Pick<RelationsColumn<unknown>, 'width' | 'minWidth'>>,
  available: number,
): { widths: Array<number | undefined>; minWidth?: number } {
  const widths = columns.map((column) => column.width);
  const flexMin = widths.some((width) => width == null) ? FLEX_MIN_WIDTH : 0;
  const room = available - flexMin;
  const total = widths.reduce<number>((sum, width) => sum + (width ?? 0), 0);
  if (total <= room) return { widths };
  const floors = columns.map((column) => leastWidth(column));
  const floorTotal = floors.reduce<number>((sum, width) => sum + (width ?? 0), 0);
  if (floorTotal >= room) return { widths: floors, minWidth: floorTotal + flexMin };
  const ratio = (total - room) / (total - floorTotal);
  return {
    widths: widths.map((width, index) => (width == null ? undefined : Math.floor(width - (width - floors[index]!) * ratio))),
  };
}

/** Hides the columns a narrow table cannot hold (by `hideOrder`), then fits the others' widths. */
export function fitColumns<C extends Pick<RelationsColumn<unknown>, 'width' | 'minWidth' | 'hideOrder'>>(
  columns: C[],
  available: number,
): { columns: C[]; widths: Array<number | undefined>; minWidth?: number } {
  const room = available - (columns.some((column) => column.width == null) ? FLEX_MIN_WIDTH : 0);
  const hidden = new Set<C>();
  const total = (least: boolean) => columns.reduce((sum, column) => {
    if (column.width == null || hidden.has(column)) return sum;
    return sum + (least ? leastWidth(column)! : column.width);
  }, 0);
  const hideable = columns
    .filter((column) => column.width != null && column.hideOrder != null)
    .sort((a, b) => a.hideOrder! - b.hideOrder!);
  for (const column of hideable) {
    if (total(false) * (1 - MAX_SHRINK) <= room && total(true) <= room) break;
    hidden.add(column);
  }
  const shown = columns.filter((column) => !hidden.has(column));
  return { columns: shown, ...fitColumnWidths(shown, available) };
}

function clamp(value: number, least: number, most: number): number {
  return Math.min(most, Math.max(least, value));
}

/** The width a column aims for when the frame has room: its content, inside its bounds. */
function targetWidth(column: Pick<RelationsColumn<unknown>, 'width' | 'wrap'>, content: number): number {
  if (column.width == null) return clamp(content, NAME_MIN_WIDE, NAME_MAX);
  // A wrapping column stays at its declaration: its text already breaks inside that width.
  if (column.wrap) return column.width;
  return clamp(content, column.width, Math.max(column.width, GROW_MAX));
}

/** The width a column keeps at the base: its declaration, or 120px for the name. */
function baseWidth(column: Pick<RelationsColumn<unknown>, 'width'>): number {
  return column.width ?? FLEX_MIN_WIDTH;
}

/**
 * Shares `extra` px above the base in proportion to what each column wants (its target minus its
 * base). The sum is `extra`, and both ends are exact: nothing at 0, the targets when `extra`
 * covers every want.
 */
function spreadWidths(bases: number[], targets: number[], extra: number): number[] {
  const wants = targets.map((target, index) => target - bases[index]);
  const wantSum = wants.reduce((sum, want) => sum + want, 0);
  if (extra <= 0 || wantSum <= 0) return bases;
  if (extra >= wantSum) return targets;
  const shares = wants.map((want) => (extra * want) / wantSum);
  const added = shares.map((share) => Math.floor(share));
  let left = extra - added.reduce((sum, share) => sum + share, 0);
  const order = shares
    .map((share, index) => ({ index, frac: share - Math.floor(share) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (let n = 0; left > 0 && order.length > 0; n += 1, left -= 1) added[order[n % order.length].index] += 1;
  return bases.map((base, index) => base + added[index]);
}

/**
 * Widths of the displayed columns for one frame (`available` excludes the trailing action
 * columns). `content` is the measured width of each column, padding included, 0 when nothing
 * was measured, aligned with `columns`.
 *
 * At or above the natural width (the sum of the targets) the columns take those targets and
 * `tableWidth` is that sum. Between the base (declared widths, 120px for the name) and the
 * natural width, the room above the base is shared in proportion to each column's want.
 * Below the base the result is `fitColumns`, unchanged. A `hideOrder` column only drops in
 * that last regime, so the base and the targets are the columns still shown.
 */
export function sizeRelationColumns<C extends Pick<RelationsColumn<unknown>, 'width' | 'minWidth' | 'hideOrder' | 'wrap'>>(
  columns: C[],
  content: readonly number[],
  available: number,
): { columns: C[]; widths: Array<number | undefined>; minWidth?: number; tableWidth?: number } {
  const targets = columns.map((column, index) => targetWidth(column, content[index] ?? 0));
  const bases = columns.map((column) => baseWidth(column));
  const base = bases.reduce((sum, width) => sum + width, 0);
  const natural = targets.reduce((sum, width) => sum + width, 0);
  if (available >= natural) return { columns, widths: targets, tableWidth: natural };
  if (available >= base) return { columns, widths: spreadWidths(bases, targets, available - base) };
  return fitColumns(columns, available);
}

/**
 * Width of the trailing action column. `declared` is a minimum: the column grows to its measured
 * content, with no cap. `room` is the frame minus the unlink column, and `dataBase` the columns'
 * base. The grown width belongs to that base. Below it the declaration is kept, so a narrow table
 * keeps the fit it has today.
 */
export function actionColumnWidth(declared: number, content: number, dataBase: number, room: number): number {
  const grown = Math.max(declared, content);
  if (room < dataBase + grown) return declared;
  return grown;
}

/** Measured content of the action column, stored beside the column keys. */
const ACTION_MEASURE_KEY = '\0action';

/**
 * The content width of each displayed column, padding included.
 * `data-measure` lays the table out at max-content with no `<col>` width, so a header cell is
 * as wide as the widest cell of its column (the body and the totals). A span is dropped from
 * the measure. The row link is block-level and would report the cell, so it is measured inline,
 * as is any other block that clips its text.
 */
function readMeasuredWidths(table: HTMLTableElement, count: number): number[] {
  table.setAttribute('data-measure', '');
  try {
    for (const el of table.querySelectorAll<HTMLElement>('td *, th *')) {
      if (el.closest('[colspan]')) continue;
      const style = getComputedStyle(el);
      if (style.position === 'absolute' || style.position === 'fixed') continue;
      if (style.display === 'block' && style.overflowX !== 'visible') el.setAttribute('data-shrink', '');
    }
    const head = table.tHead?.rows[0];
    const row = head && head.cells.length >= count
      ? head
      : Array.from(table.tBodies[0]?.rows ?? []).find((candidate) => (
        candidate.cells.length >= count
        && Array.from(candidate.cells).slice(0, count).every((cell) => cell.colSpan === 1)
      ));
    if (!row) return Array.from({ length: count }, () => 0);
    return Array.from({ length: count }, (_, index) => {
      const cell = row.cells[index];
      return cell ? Math.ceil(cell.getBoundingClientRect().width) : 0;
    });
  } finally {
    table.querySelectorAll('[data-shrink]').forEach((el) => el.removeAttribute('data-shrink'));
    table.removeAttribute('data-measure');
  }
}

/** The width of an element, followed as it changes (0 until it is laid out). */
function useElementWidth(element: HTMLElement | null) {
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    if (!element) return undefined;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width;
}

/** On hover, a cell whose text is cut by the ellipsis shows it whole (unless its content has its own). */
function titleCutCell(event: React.MouseEvent) {
  const cell = (event.target as HTMLElement).closest?.('td, th') as HTMLElement | null;
  if (!cell || cell.querySelector('[title]')) return;
  const text = cell.textContent?.trim() ?? '';
  if (text && cell.scrollWidth > cell.clientWidth) {
    cell.title = text;
    cell.dataset.cutTitle = 'true';
  } else if (cell.dataset.cutTitle) {
    cell.removeAttribute('title');
    delete cell.dataset.cutTitle;
  }
}

/**
 * Width a table publishes when the frame is wider than its columns. The section caps itself at
 * the largest one, so "Add" lines up with the table. A tighter frame publishes nothing.
 */
const RelationsWidthContext = React.createContext<((id: string, width: number | null) => void) | null>(null);

/**
 * The dense table of a Relations section (charter "Dense workspace tables"): 12/500 tertiary
 * headers, 13px cells, horizontal borders only, row hover, the whole row opens the object, and an
 * unlink icon revealed on hover. Shared by every object that shows its relations.
 */
export function RelationsTable<T>({ columns: allColumns, rows, rowKey, rowHref, linkRows, onRowOpen, rowMuted, onRemove, removeLabel, canRemove, action, totals, folded, ariaLabel }: TableProps<T>) {
  const theme = useTheme();
  const navigate = useNavigate();
  const [unfolded, setUnfolded] = React.useState(false);
  const [measured, setMeasured] = React.useState<Readonly<Record<string, number>>>({});
  const tableRef = React.useRef<HTMLTableElement | null>(null);
  const shownKeysRef = React.useRef<string[]>([]);
  const reportWidth = React.useContext(RelationsWidthContext);
  const tableId = React.useId();
  const foldedRows = folded?.rows ?? [];
  const hasAction = action != null;
  const removeWidth = onRemove ? 40 : 0;
  const [frame, setFrame] = React.useState<HTMLDivElement | null>(null);
  const frameWidth = useElementWidth(frame);
  const content = allColumns.map((column) => measured[column.key] ?? 0);
  // The action column's content joins the base. Under that base its declaration is kept.
  const dataBase = allColumns.reduce((sum, column) => sum + baseWidth(column), 0);
  const actionWidth = action
    ? actionColumnWidth(action.width, measured[ACTION_MEASURE_KEY] ?? 0, dataBase, frameWidth - removeWidth)
    : 0;
  const fitted = frameWidth > 0
    ? sizeRelationColumns(allColumns, content, frameWidth - actionWidth - removeWidth)
    : { columns: allColumns, widths: allColumns.map((column) => column.width), tableWidth: undefined };
  const { columns } = fitted;
  /** The table's own width when the frame is wider than the columns; the frame keeps the rest. */
  const naturalWidth = fitted.tableWidth != null ? fitted.tableWidth + actionWidth + removeWidth : null;
  shownKeysRef.current = columns.map((column) => column.key);
  const shownKey = shownKeysRef.current.join('\0');
  // The content does not depend on the frame, so a resize does not measure again. A column that
  // appears (a folded block, a column `hideOrder` brings back) does.
  React.useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return undefined;
    let cancelled = false;
    const measure = () => {
      if (cancelled || !table.isConnected) return;
      const keys = shownKeysRef.current;
      // The action column follows the data columns. The unlink icon keeps its fixed width.
      const widths = readMeasuredWidths(table, keys.length + (hasAction ? 1 : 0));
      setMeasured((prev) => {
        let changed = false;
        const next: Record<string, number> = { ...prev };
        keys.forEach((key, index) => {
          if (next[key] !== widths[index]) {
            next[key] = widths[index];
            changed = true;
          }
        });
        if (hasAction) {
          const width = widths[keys.length] ?? 0;
          if (next[ACTION_MEASURE_KEY] !== width) {
            next[ACTION_MEASURE_KEY] = width;
            changed = true;
          }
        } else if (ACTION_MEASURE_KEY in next) {
          delete next[ACTION_MEASURE_KEY];
          changed = true;
        }
        return changed ? next : prev;
      });
    };
    measure();
    const ready = document.fonts?.ready;
    if (ready) void ready.then(() => { if (!cancelled) measure(); }, () => undefined);
    return () => { cancelled = true; };
  }, [allColumns, rows, folded, totals, unfolded, shownKey, hasAction]);
  React.useLayoutEffect(() => {
    if (!reportWidth) return undefined;
    reportWidth(tableId, naturalWidth);
    return () => reportWidth(tableId, null);
  }, [reportWidth, tableId, naturalWidth]);
  const open = (row: T) => {
    const href = rowHref?.(row);
    if (href) navigate(href);
    else onRowOpen?.(row);
  };
  /** One row of the body, a main one or a folded one. */
  const renderRow = (row: T) => {
    const href = rowHref?.(row) ?? null;
    const opens = !!href || !!onRowOpen;
    const muted = rowMuted?.(row) ?? false;
    const nameIndex = columns.findIndex((column) => !column.width);
    const linkIndex = linkRows && href ? Math.max(nameIndex, 0) : -1;
    const cells: React.ReactNode[] = [];
    for (let index = 0; index < columns.length;) {
      const column = columns[index];
      const span = Math.max(1, Math.min(column.span?.(row) ?? 1, columns.length - index));
      cells.push(
        <Box
          component="td"
          key={column.key}
          colSpan={span > 1 ? span : undefined}
          className={[column.align === 'right' && span === 1 ? 'r' : null, column.wrap ? 'w' : null].filter(Boolean).join(' ') || undefined}
          sx={muted && index === nameIndex ? { '&&': { color: 'kanap.text.tertiary' } } : undefined}
        >
          {index === linkIndex ? (
            <RouterLink to={href!} className="relations-row-link">{column.render(row)}</RouterLink>
          ) : column.render(row)}
        </Box>,
      );
      index += span;
    }
    return (
      <tr
        key={rowKey(row)}
        data-href={href ?? (onRowOpen ? '' : undefined)}
        tabIndex={opens && linkIndex < 0 ? 0 : undefined}
        onClick={opens ? (event) => { if (!(event.target as HTMLElement).closest('a')) open(row); } : undefined}
        onKeyDown={opens && linkIndex < 0 ? (event) => { if (event.key === 'Enter') open(row); } : undefined}
      >
        {cells}
        {action ? (
          <td className="r" onClick={(event) => event.stopPropagation()}>{action.render(row)}</td>
        ) : null}
        {onRemove && canRemove && !canRemove(row) ? (
          <td />
        ) : onRemove ? (
          <td className="r" onClick={(event) => event.stopPropagation()}>
            <IconButton
              className="relations-remove"
              size="small"
              aria-label={removeLabel?.(row)}
              onClick={() => onRemove(row)}
              sx={{ p: '2px', color: 'kanap.text.tertiary' }}
            >
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </td>
        ) : null}
      </tr>
    );
  };
  return (
    <Box ref={setFrame} sx={{ width: '100%', overflowX: 'auto' }}>
      <Box
        component="table"
        ref={tableRef}
        aria-label={ariaLabel}
        onMouseOver={titleCutCell}
        style={naturalWidth != null ? { width: naturalWidth } : undefined}
        sx={{
          width: '100%',
          minWidth: fitted.minWidth != null ? fitted.minWidth + actionWidth + removeWidth : undefined,
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
          // One synchronous pass, before paint: columns size to their content, then the attribute goes.
          '&[data-measure]': { tableLayout: 'auto !important', width: 'max-content !important', minWidth: '0 !important' },
          '&[data-measure] col': { width: 'auto !important' },
          '&[data-measure] a.relations-row-link, &[data-measure] [data-shrink]': {
            display: 'inline !important',
            overflow: 'visible !important',
            textOverflow: 'clip !important',
            width: 'auto !important',
            maxWidth: 'none !important',
            whiteSpace: 'nowrap !important',
          },
          '&[data-measure] :is(td, th)[colspan]': {
            padding: '0 !important',
            border: '0 !important',
            fontSize: '0 !important',
            lineHeight: '0 !important',
          },
          '&[data-measure] :is(td, th)[colspan] > *': { display: 'none !important' },
          '& th': {
            fontSize: 12,
            fontWeight: 500,
            color: 'kanap.text.tertiary',
            textAlign: 'left',
            p: '0 8px 6px 0',
            borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          },
          '& td': {
            fontSize: 13,
            color: 'kanap.text.primary',
            p: '7px 8px 7px 0',
            borderBottom: `1px solid ${theme.palette.kanap.border.soft}`,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          },
          '& .r': { textAlign: 'right' },
          '& td.w': { whiteSpace: 'normal', overflow: 'visible', textOverflow: 'clip', overflowWrap: 'anywhere' },
          '& tfoot td': { fontWeight: 500, borderBottom: 'none', borderTop: `1px solid ${theme.palette.kanap.border.default}` },
          '& tbody tr:hover td': { backgroundColor: theme.palette.kanap.bg.hover },
          '& tbody tr[data-href]': { cursor: 'pointer' },
          '& tbody tr:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
          '& a.relations-row-link': {
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: 'inherit',
            textDecoration: 'none',
            '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2, borderRadius: '2px' },
          },
          '& .relations-remove': { opacity: 0, transition: 'opacity 120ms' },
          '& tbody tr:hover .relations-remove, & .relations-remove:focus-visible': { opacity: 1 },
        }}
      >
        <colgroup>
          {columns.map((column, index) => {
            const width = fitted.widths[index];
            return <col key={column.key} style={width ? { width } : undefined} />;
          })}
          {hasAction && <col style={{ width: actionWidth }} />}
          {removeWidth > 0 && <col style={{ width: removeWidth }} />}
        </colgroup>
        {(rows.length > 0 || unfolded || foldedRows.length === 0) && (
          <thead>
            <tr>
              {columns.map((column) => <th key={column.key} className={column.align === 'right' ? 'r' : undefined}>{column.header}</th>)}
              {hasAction && <th aria-hidden />}
              {removeWidth > 0 && <th aria-hidden />}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map(renderRow)}
          {foldedRows.length > 0 && (
            <tr data-folded="">
              <td colSpan={columns.length + (hasAction ? 1 : 0) + (removeWidth > 0 ? 1 : 0)}>
                <Box
                  component="button"
                  type="button"
                  aria-expanded={unfolded}
                  onClick={() => setUnfolded((value) => !value)}
                  sx={{
                    all: 'unset',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.5,
                    cursor: 'pointer',
                    color: 'kanap.text.secondary',
                    '&:hover': { color: 'kanap.text.primary' },
                    '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2, borderRadius: '2px' },
                  }}
                >
                  <KeyboardArrowRightIcon
                    aria-hidden
                    sx={{ fontSize: 16, transition: 'transform 120ms', transform: unfolded ? 'rotate(90deg)' : 'none' }}
                  />
                  {folded!.label}
                </Box>
              </td>
            </tr>
          )}
          {unfolded && foldedRows.map(renderRow)}
        </tbody>
        {totals && totals.length > 0 && (
          <tfoot>
            {totals.map((total) => (
              <tr key={total.key}>
                {columns.map((column, index) => (
                  <td key={column.key} className={column.align === 'right' ? 'r' : undefined}>
                    {index === 0 ? total.label : total.cells[column.key] ?? null}
                  </td>
                ))}
                {hasAction && <td />}
                {removeWidth > 0 && <td />}
              </tr>
            ))}
          </tfoot>
        )}
      </Box>
    </Box>
  );
}

type SectionProps = {
  title: string;
  /** The count after the title (tertiary); text such as "3 suggestions" is allowed. */
  count?: React.ReactNode;
  /** The "Add" text action, absent for readers; it receives the button, where the picker anchors. */
  onAdd?: (anchor: HTMLElement) => void;
  /** The picker of this section is open (the button stays highlighted). */
  adding?: boolean;
  addLabel?: string;
  /** The page's own section title, in place of the default one (the section keeps `title` as its name). */
  heading?: React.ReactNode;
  /** One sentence in a tooltip, on an information icon after the title. */
  hint?: string;
  /** Other actions on the right of the title, before "Add" (a refresh, its result line). */
  actions?: React.ReactNode;
  children: React.ReactNode;
};

/** A Relations section: title and count, an "Add" text action on the right, then its content. */
export function RelationsSection({ title, count, onAdd, adding, addLabel, heading, hint, actions, children }: SectionProps) {
  const widths = React.useRef(new Map<string, number>());
  const [maxWidth, setMaxWidth] = React.useState<number | undefined>(undefined);
  // The widest table in regime 1. maxWidth, so a narrower frame still gets the whole section.
  const report = React.useCallback((id: string, width: number | null) => {
    const map = widths.current;
    if (width == null) {
      if (!map.delete(id)) return;
    } else if (map.get(id) === width) {
      return;
    } else {
      map.set(id, width);
    }
    const next = map.size === 0 ? undefined : Math.max(...map.values());
    setMaxWidth((current) => (current === next ? current : next));
  }, []);
  return (
    <RelationsWidthContext.Provider value={report}>
      <Box component="section" aria-label={title} sx={maxWidth != null ? { maxWidth } : undefined}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.75, minHeight: 28 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
            {heading ?? (
              <Typography component="h2" sx={{ m: 0, fontSize: 14, fontWeight: 500, lineHeight: 1.4, color: 'kanap.text.primary' }}>
                {title}
              </Typography>
            )}
            {hint && <InfoHint text={hint} />}
            {count != null && <Typography component="span" sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{count}</Typography>}
          </Box>
          {actions}
          {onAdd && (
            <Button
              variant="text"
              size="small"
              aria-haspopup="listbox"
              aria-expanded={adding ? true : undefined}
              onClick={(event) => onAdd(event.currentTarget)}
              sx={(theme) => ({ fontSize: 12, minWidth: 0, px: 1, ...(adding ? { backgroundColor: theme.palette.kanap.bg.hover } : {}) })}
            >
              {addLabel}
            </Button>
          )}
        </Box>
        {children}
      </Box>
    </RelationsWidthContext.Provider>
  );
}

/** The one tertiary line of an empty section. */
export function RelationsEmpty({ children }: { children: React.ReactNode }) {
  return <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary', py: 0.5 }}>{children}</Typography>;
}
