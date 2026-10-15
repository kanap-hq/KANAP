/** Test helpers for the whole-cell link rule (`wholeCellLinkSx`): read the styles Emotion inserted. */

function insertedCss(): string {
  return Array.from(document.querySelectorAll('style')).map((style) => style.textContent ?? '').join('');
}

function emotionClasses(element: Element): string[] {
  return Array.from(element.classList).filter((name) => name.startsWith('css-'));
}

/** Whether the link covers its whole `.ag-cell` (its `::after` stretched over the cell). */
export function coversItsCell(link: Element): boolean {
  const css = insertedCss();
  return emotionClasses(link).some((name) => new RegExp(`\\.ag-cell \\.${name}::after\\{[^}]*position:absolute;[^}]*inset:0;`).test(css));
}

/** Whether an element of a cell stays above the cell link's area (its own clicks and tooltip). */
export function staysAboveCellLink(element: Element): boolean {
  const css = insertedCss();
  return emotionClasses(element).some((name) => new RegExp(`\\.ag-cell \\.${name}\\{[^}]*position:relative;[^}]*z-index:1;`).test(css));
}

/** Whether what follows the link in its cell (an end adornment) stays above the cell link's area. */
export function keepsFollowingContentAbove(link: Element): boolean {
  const css = insertedCss();
  return emotionClasses(link).some((name) => new RegExp(`\\.ag-cell \\.${name}~:not\\(svg\\)\\{[^}]*position:relative;[^}]*z-index:1;`).test(css));
}
