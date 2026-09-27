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
