const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Text for the `title` of a custom chart tooltip. AG Charts writes that title into the page as HTML,
 * so an item, company or category name must be escaped to show as typed.
 */
export function escapeTooltipText(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/**
 * HTML for the `content` of a custom chart tooltip, one line per label and value.
 * AG Charts 9 writes `content` into the tooltip body and ignores a `data` list.
 */
export function tooltipContent(rows: Array<{ label: string; value: string }>): string {
  return rows
    .map((row) => `<div>${escapeTooltipText(row.label)}: ${escapeTooltipText(row.value)}</div>`)
    .join('');
}
