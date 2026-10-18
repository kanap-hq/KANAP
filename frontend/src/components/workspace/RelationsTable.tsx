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
   * shrink, down to 64px, so that the name keeps at least 128px.
   */
  width?: number;
  align?: 'left' | 'right';
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
const FLEX_MIN_WIDTH = 128;
/** A column with a width shrinks no further than this (a narrower one keeps its own). */
const COLUMN_MIN_WIDTH = 64;

/**
 * Fits the column widths in `available` px (the trailing action columns excluded): the columns
 * with a width give up room in proportion to what they can spare, so that the column without
 * one keeps `FLEX_MIN_WIDTH`. When even their least widths do not fit, `minWidth` is the width
 * the table needs, and its frame scrolls.
 */
export function fitColumnWidths(widths: Array<number | undefined>, available: number): { widths: Array<number | undefined>; minWidth?: number } {
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
export function RelationsTable<T>({ columns, rows, rowKey, rowHref, rowMuted, onRemove, removeLabel, canRemove, action, totals, ariaLabel }: TableProps<T>) {
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
  const declared = columns.map((column) => column.width);
  const fitted = frameWidth > 0 ? fitColumnWidths(declared, frameWidth - actionWidth - removeWidth) : { widths: declared };
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
            return (
              <tr
                key={rowKey(row)}
                data-href={href ?? undefined}
                tabIndex={href ? 0 : undefined}
                onClick={href ? () => open(row) : undefined}
                onKeyDown={href ? (event) => { if (event.key === 'Enter') open(row); } : undefined}
              >
                {columns.map((column, index) => (
                  <Box
                    component="td"
                    key={column.key}
                    className={column.align === 'right' ? 'r' : undefined}
                    sx={muted && index === columns.findIndex((c) => !c.width) ? { color: 'kanap.text.tertiary' } : undefined}
                  >
                    {column.render(row)}
                  </Box>
                ))}
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
