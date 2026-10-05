const LIGATURES: Record<string, string> = { 'œ': 'oe', 'æ': 'ae', 'ß': 'ss', 'ø': 'o', 'ł': 'l', 'đ': 'd' };

/**
 * The server's folding of a searched text (`lower(unaccent(x))`, list engine decision Q2):
 * accents, case and the common ligatures. "societe" finds "Société", "oeuvre" finds "Œuvre".
 *
 * Shared by everything that matches typed text against labels in the browser (the reference
 * pickers through `narrowToText`, the column chooser of the grids), so one search box never
 * folds text differently from another.
 */
export function foldText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[œæßøłđ]/g, (c) => LIGATURES[c] ?? c);
}
