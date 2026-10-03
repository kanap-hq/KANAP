import { EDIT_CONFLICT_CODE, authorOf, type EditConflictAuthor } from '../../hooks/editConflicts';
import { centsToDecimal, linePayloadOf, toCents, type AmountMeasure, type LinePayload } from './roundPeriod';

/**
 * Edit conflicts of the budget tab (plan planning/perf-scale, lot 3D), the
 * client side of `backend/src/spend/budget-edit-conflicts.ts`:
 * - every save says what the user's edit started from (`base`): per cell
 *   for a monthly entry (`base.months`), per column its twelve months, and
 *   its lines for costed lines, for a yearly total, a spread or lines
 *   (`base.columns`);
 * - a cell or column someone else changed meanwhile answers 409
 *   `edit_conflict`, the whole request refused, one entry per column;
 * - the tab parks the refused edit and asks per column: « Reload the column »
 *   (their values) or « Overwrite » (the edit goes again with the column as
 *   the server answered it as its base).
 */

const AMOUNT_MEASURES: readonly AmountMeasure[] = ['planned', 'committed', 'forecast', 'actual', 'expected_landing'];

export type BudgetConflict = {
  measure: AmountMeasure;
  /** The months that moved (`YYYY-MM-01`); for a monthly entry, the refused cells. */
  periods: string[];
  /** The column now, in cents, January first. */
  current: number[];
  /** What the refused request would have left, in cents. */
  mine: number[];
  /** The column's stored lines, when the request compared lines. */
  currentLines: LinePayload[] | null;
  changed_by: EditConflictAuthor | null;
  changed_at: string | null;
};

const textOrNull = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value : null);
const twelve = (value: unknown): number[] | null => (Array.isArray(value) && value.length === 12 ? value.map((v) => toCents(v as string)) : null);

/** The column conflicts of a 409 `edit_conflict` answer to a budget save, or null for any other error. */
export function budgetConflictsOf(error: unknown): BudgetConflict[] | null {
  const response = (error as { response?: { status?: number; data?: { code?: unknown; conflicts?: unknown } } } | null)?.response;
  if (response?.status !== 409 || response.data?.code !== EDIT_CONFLICT_CODE || !Array.isArray(response.data.conflicts)) return null;
  const conflicts: BudgetConflict[] = [];
  for (const entry of response.data.conflicts as Array<Record<string, any>>) {
    const measure = entry?.field;
    const current = twelve(entry?.current);
    if (!AMOUNT_MEASURES.includes(measure) || !current) continue;
    conflicts.push({
      measure,
      periods: Array.isArray(entry.periods) ? entry.periods.filter((p: unknown): p is string => typeof p === 'string') : [],
      current,
      mine: twelve(entry.mine) ?? current,
      currentLines: Array.isArray(entry.current_lines) ? entry.current_lines.map((line: LinePayload) => linePayloadOf(line)) : null,
      changed_by: authorOf(entry.changed_by),
      changed_at: textOrNull(entry.changed_at),
    });
  }
  return conflicts.length > 0 ? conflicts : null;
}

/** Twelve months in cents as the server reads a base (two-decimal strings). */
export function monthsBase(cents: readonly number[]): string[] {
  return cents.map(centsToDecimal);
}

/** The months of a year in cents, from stored rows (`items` of the amounts answers); a missing month is zero. */
export function centsByColumn(
  year: number,
  items: ReadonlyArray<Partial<Record<AmountMeasure, number | string | null>> & { period: string }>,
): Record<AmountMeasure, number[]> {
  const result = Object.fromEntries(AMOUNT_MEASURES.map((m) => [m, Array.from({ length: 12 }, () => 0)])) as Record<AmountMeasure, number[]>;
  for (const row of items) {
    const period = String(row.period ?? '').slice(0, 10);
    if (Number(period.slice(0, 4)) !== year) continue;
    const index = Number(period.slice(5, 7)) - 1;
    if (index < 0 || index > 11) continue;
    for (const measure of AMOUNT_MEASURES) result[measure][index] = toCents(row[measure] ?? 0);
  }
  return result;
}

/** The code of a 409 `edit_conflict` answer whose details could not be read: an error the user sees. */
export const UNREADABLE_CONFLICT_CODE = 'edit_conflict_unreadable';

/**
 * A 409 `edit_conflict` answer the screen cannot read (no column, no allocation it knows) becomes a
 * plain error: the autosave reports it and the edits stay on screen, not saved, instead of waiting
 * silently for a choice nobody can make. Null for any other error.
 */
export function unreadableConflict(error: unknown): Error | null {
  const response = (error as { response?: { status?: number; data?: { code?: unknown } } } | null)?.response;
  if (response?.status !== 409 || response.data?.code !== EDIT_CONFLICT_CODE) return null;
  return Object.assign(new Error('The answer to the save could not be read.'), {
    response: { status: 409, data: { code: UNREADABLE_CONFLICT_CODE } },
  });
}
