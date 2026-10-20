import React from 'react';
import { Box, Button, IconButton, Typography, useTheme } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useNavigate } from 'react-router-dom';
import { MONO_FONT_FAMILY } from '../../config/ThemeContext';

/** One column of a relations table. */
export type RelationsColumn<T> = {
  key: string;
  header: React.ReactNode;
  /**
   * Width in px; the column without one takes the rest (the name). In a narrow table the widths
   * shrink, down to 96px (a date, an amount), so that the name keeps at least 120px.
   */
  width?: number;
  align?: 'left' | 'right';
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
  /** Shown faded (a disabled object stays listed). */
  rowMuted?: (row: T) => boolean;
  /** Hover-revealed unlink action, saved at once (no dialog: the row affects nothing else). */
  onRemove?: (row: T) => void;
  removeLabel?: (row: T) => string;
  /** Rows that can be unlinked (all by default); the others keep an empty trailing cell. */
  canRemove?: (row: T) => boolean;
  /** A trailing action column (for example "Link" on a suggestion). */
  action?: { width: number; render: (row: T) => React.ReactNode };
  /** Total lines under the rows: a label in the first column, then cells by column key. */
  totals?: Array<{ key: string; label: React.ReactNode; cells: Record<string, React.ReactNode> }>;
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

/**
 * Fits the column widths in `available` px (the trailing action columns excluded): the columns
 * with a width give up room in proportion to what they can spare, so that the column without
 * one keeps `FLEX_MIN_WIDTH`. When even their least widths do not fit, `minWidth` is the width
 * the table needs, and its frame scrolls.
 */
export function fitColumnWidths(
  columns: Array<Pick<RelationsColumn<unknown>, 'width'>>,
  available: number,
): { widths: Array<number | undefined>; minWidth?: number } {
  const widths = columns.map((column) => column.width);
  const flexMin = widths.some((width) => width == null) ? FLEX_MIN_WIDTH : 0;
  const room = available - flexMin;
  const total = widths.reduce<number>((sum, width) => sum + (width ?? 0), 0);
  if (total <= room) return { widths };
  const floors = widths.map((width) => (width == null ? undefined : Math.min(width, COLUMN_MIN_WIDTH)));
  const floorTotal = floors.reduce<number>((sum, width) => sum + (width ?? 0), 0);
  if (floorTotal >= room) return { widths: floors, minWidth: floorTotal + flexMin };
  const ratio = (total - room) / (total - floorTotal);
  return {
    widths: widths.map((width, index) => (width == null ? undefined : Math.floor(width - (width - floors[index]!) * ratio))),
  };
}

/** Hides the columns a narrow table cannot hold (by `hideOrder`), then fits the others' widths. */
export function fitColumns<C extends Pick<RelationsColumn<unknown>, 'width' | 'hideOrder'>>(
  columns: C[],
  available: number,
): { columns: C[]; widths: Array<number | undefined>; minWidth?: number } {
  const room = available - (columns.some((column) => column.width == null) ? FLEX_MIN_WIDTH : 0);
  const hidden = new Set<C>();
  const total = (least: boolean) => columns.reduce((sum, column) => {
    if (column.width == null || hidden.has(column)) return sum;
    return sum + (least ? Math.min(column.width, COLUMN_MIN_WIDTH) : column.width);
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
 * The dense table of a Relations section (charter "Dense workspace tables"): 12/500 tertiary
 * headers, 13px cells, horizontal borders only, row hover, the whole row opens the object, and an
 * unlink icon revealed on hover. Shared by every object that shows its relations.
 */
export function RelationsTable<T>({ columns: allColumns, rows, rowKey, rowHref, rowMuted, onRemove, removeLabel, canRemove, action, totals, ariaLabel }: TableProps<T>) {
  const theme = useTheme();
  const navigate = useNavigate();
  const open = (row: T) => {
    const href = rowHref?.(row);
    if (href) navigate(href);
  };
  const actionWidth = action ? action.width : 0;
  const removeWidth = onRemove ? 40 : 0;
  const [frame, setFrame] = React.useState<HTMLDivElement | null>(null);
  const frameWidth = useElementWidth(frame);
  const fitted = frameWidth > 0
    ? fitColumns(allColumns, frameWidth - actionWidth - removeWidth)
    : { columns: allColumns, widths: allColumns.map((column) => column.width) };
  const { columns } = fitted;
  return (
    <Box ref={setFrame} sx={{ width: '100%', overflowX: 'auto' }}>
      <Box
        component="table"
        aria-label={ariaLabel}
        onMouseOver={titleCutCell}
        sx={{
          width: '100%',
          minWidth: fitted.minWidth != null ? fitted.minWidth + actionWidth + removeWidth : undefined,
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
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
          '& tfoot td': { fontWeight: 500, borderBottom: 'none', borderTop: `1px solid ${theme.palette.kanap.border.default}` },
          '& tbody tr:hover td': { backgroundColor: theme.palette.kanap.bg.hover },
          '& tbody tr[data-href]': { cursor: 'pointer' },
          '& tbody tr:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
          '& .relations-remove': { opacity: 0, transition: 'opacity 120ms' },
          '& tbody tr:hover .relations-remove, & .relations-remove:focus-visible': { opacity: 1 },
        }}
      >
        <colgroup>
          {columns.map((column, index) => {
            const width = fitted.widths[index];
            return <col key={column.key} style={width ? { width } : undefined} />;
          })}
          {actionWidth > 0 && <col style={{ width: actionWidth }} />}
          {removeWidth > 0 && <col style={{ width: removeWidth }} />}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => <th key={column.key} className={column.align === 'right' ? 'r' : undefined}>{column.header}</th>)}
            {actionWidth > 0 && <th aria-hidden />}
            {removeWidth > 0 && <th aria-hidden />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref?.(row) ?? null;
            const muted = rowMuted?.(row) ?? false;
            const nameIndex = columns.findIndex((column) => !column.width);
            const cells: React.ReactNode[] = [];
            for (let index = 0; index < columns.length;) {
              const column = columns[index];
              const span = Math.max(1, Math.min(column.span?.(row) ?? 1, columns.length - index));
              cells.push(
                <Box
                  component="td"
                  key={column.key}
                  colSpan={span > 1 ? span : undefined}
                  className={column.align === 'right' && span === 1 ? 'r' : undefined}
                  sx={muted && index === nameIndex ? { '&&': { color: 'kanap.text.tertiary' } } : undefined}
                >
                  {column.render(row)}
                </Box>,
              );
              index += span;
            }
            return (
              <tr
                key={rowKey(row)}
                data-href={href ?? undefined}
                tabIndex={href ? 0 : undefined}
                onClick={href ? () => open(row) : undefined}
                onKeyDown={href ? (event) => { if (event.key === 'Enter') open(row); } : undefined}
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
          })}
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
                {actionWidth > 0 && <td />}
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
  children: React.ReactNode;
};

/** A Relations section: title and count, an "Add" text action on the right, then its content. */
export function RelationsSection({ title, count, onAdd, adding, addLabel, heading, children }: SectionProps) {
  return (
    <Box component="section" aria-label={title}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.75, minHeight: 28 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
          {heading ?? (
            <Typography component="h2" sx={{ m: 0, fontSize: 14, fontWeight: 500, lineHeight: 1.4, color: 'kanap.text.primary' }}>
              {title}
            </Typography>
          )}
          {count != null && <Typography component="span" sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{count}</Typography>}
        </Box>
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
  );
}

/** The one tertiary line of an empty section. */
export function RelationsEmpty({ children }: { children: React.ReactNode }) {
  return <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary', py: 0.5 }}>{children}</Typography>;
}
