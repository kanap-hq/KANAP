/**
 * The width of a dense report grid's value columns, computed from their values before the grid lays
 * out. AG Grid re-flexes only the flex columns right of a resized column, and `sizeColumnsToFit`
 * overshoots by the scrollbar gutter: a page sets fixed value widths, lets its first (group) column
 * flex into the room left, and keys the grid on the widths so a new width remounts it.
 */

/** A text's width in pixels, in the grid's cell font. */
export type TextMeasurer = (text: string) => number;
/** The narrowest value column holds `00.00`: small values do not make tiny columns. */
const MIN_VALUE_TEXT = '00.00';
/** A few pixels beyond the text and the cell padding, for rounding and font rendering. */
const VALUE_COLUMN_MARGIN = 6;
/** Without a canvas to measure with: an average character, a little wider than a digit. */
const FALLBACK_CHAR_EM = 0.65;

/**
 * The shared width of the value columns `ids`: the widest formatted value among the rows and the total
 * row, plus the cell padding on both sides and a small margin, never narrower than `00.00`.
 */
export function valueColumnWidth({ rows, total, ids, format, measure, cellPadding }: {
  rows: ReadonlyArray<Record<string, unknown>>;
  total: Record<string, unknown>;
  ids: readonly string[];
  format: (value: unknown) => string;
  measure: TextMeasurer;
  cellPadding: number;
}): number {
  const texts = new Set<string>([MIN_VALUE_TEXT]);
  for (const row of [...rows, total]) {
    for (const id of ids) texts.add(format(row[id]));
  }
  let widest = 0;
  for (const text of texts) if (text) widest = Math.max(widest, measure(text));
  return Math.ceil(widest + 2 * cellPadding + VALUE_COLUMN_MARGIN);
}

/** The grid's cell font (bold, as the total row) and its horizontal cell padding. */
export type GridTextMetrics = { font: string; fontSize: number; cellPadding: number };

/**
 * Reads the font and the cell padding of a dense report grid from the AG Grid theme variables, on a hidden
 * probe carrying the grid's classes (the variables live on the theme class, not on the document).
 * Falls back to 13 px sans-serif and 10 px when the theme is not loaded.
 */
export function readGridTextMetrics(doc: Document = document): GridTextMetrics {
  const probe = doc.createElement('div');
  probe.className = 'ag-theme-quartz kanap-dense-grid';
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
  doc.body.appendChild(probe);
  try {
    const style = doc.defaultView?.getComputedStyle(probe);
    const family = style?.getPropertyValue('--ag-font-family').trim() || style?.fontFamily || 'sans-serif';
    const fontSize = parseFloat(style?.getPropertyValue('--ag-font-size') ?? '') || 13;
    const padding = parseFloat(style?.getPropertyValue('--ag-cell-horizontal-padding') ?? '');
    return { font: `bold ${fontSize}px ${family}`, fontSize, cellPadding: Number.isFinite(padding) ? padding : 10 };
  } finally {
    probe.remove();
  }
}

const canvasContext = () => document.createElement('canvas').getContext('2d');

/**
 * Measures texts with a canvas in the given font. The cells show tabular figures, which a canvas cannot
 * set: every digit is measured as a `0`, as wide as a tabular figure. Without a canvas (jsdom, or no 2D
 * context), estimates from the character count.
 */
export function createTextMeasurer(
  font: string,
  fontSize: number,
  getContext: () => CanvasRenderingContext2D | null = canvasContext,
): TextMeasurer {
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = getContext();
  } catch {
    context = null;
  }
  if (context && typeof context.measureText === 'function') {
    const ctx = context;
    ctx.font = font;
    return (text) => ctx.measureText(text.replace(/\d/g, '0')).width;
  }
  return (text) => text.length * fontSize * FALLBACK_CHAR_EM;
}

/** The dense grid's text measurer and cell padding, read once per page. */
export function gridTextMeasure(): { measure: TextMeasurer; cellPadding: number } {
  const metrics = readGridTextMetrics();
  return { measure: createTextMeasurer(metrics.font, metrics.fontSize), cellPadding: metrics.cellPadding };
}
