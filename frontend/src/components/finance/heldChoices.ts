import React from 'react';
import type { EditConflict } from '../../hooks/editConflicts';
import type { BudgetConflict } from './budgetConflicts';
import type { AmountMeasure, LinePayload, RoundInput } from './roundPeriod';

/**
 * Choices the Budget and Allocations tabs wait on (plan planning/perf-scale, lots 3D and 3E),
 * kept by the item page for its line while the user moves between the line's tabs: leaving the
 * Budget tab for the Overview unmounts it, coming back shows the same waiting columns, the same
 * typed values and the same banner, without asking (as the field choices of lot 3C). Leaving the
 * line drops them after the leave warning, which names what is lost (fried, 2026-10-02: no
 * session buffer for the budget).
 *
 * A tab writes its state here when it unmounts with a choice waiting, and takes it back when it
 * mounts for the same line and year. The page reads the names for its leave warning.
 */

/**
 * A budget column waiting for the user's choice. `cells`: only these months wait (a monthly entry);
 * null: the whole column. `source`: a monthly entry, a panel write, or a restore of the opening values.
 */
export type HeldWaitingColumn = BudgetConflict & { source: 'grid' | 'panel' | 'restore'; cells: string[] | null };

export type HeldBudgetChoices = {
  lineId: string;
  year: number;
  /** The waiting columns as the tenant names them, for the leave warning. */
  labels: string[];
  waiting: HeldWaitingColumn[];
  /** A refused panel write (an amount or lines), kept whole until each of its columns has a choice. */
  parkedPanel: { body: Record<string, unknown>; main: AmountMeasure; columns: AmountMeasure[] } | null;
  /** The values typed in the waiting months. */
  cells: Array<{ period: string; col: AmountMeasure; value: number }>;
  /** How each waiting column was shown when the user picked it (by month for refused months): it comes back the same. */
  modes: Partial<Record<AmountMeasure, 'amount' | 'lines' | 'monthly'>>;
  /** Restores of the opening values refused with a 409, one per column, kept until the choice is made. */
  parkedRestores?: Array<{ measure: AmountMeasure; body: Record<string, unknown> }>;
};

/** A column as the Budget tab first read it during the visit: its months in cents, January first, and its record as read (null: none). */
export type OpeningColumn = { months: number[]; record: RoundInput | null };

/** A column as this screen's last write of it left it: the twelve months in cents and its lines, as the write answered. */
export type WrittenColumn = { months: number[]; lines: LinePayload[] };

/**
 * The columns of a year as first read during the visit, and when (ms since the epoch). `written`:
 * the columns this screen wrote during the visit, as its last write of each left them. Only those
 * go back to the opening values, over that state: a change someone else made since is refused (409),
 * even once the screen shows it (fried: a column changed by someone else is never restored).
 */
export type OpeningYear = { at: number; columns: Record<AmountMeasure, OpeningColumn>; written: Partial<Record<AmountMeasure, WrittenColumn>> };

/**
 * The opening values of a line (plan planning/budget-tab-redesign, lot F2): for each year the
 * Budget tab read during the visit, every column as it was at the first read. Kept by the item page,
 * so a tab or year change keeps them; a reload of the page or another line starts again. Nothing
 * goes to the browser's storage.
 */
export type OpeningValues = { lineId: string; years: Map<number, OpeningYear> };

export type HeldAllocationChoice = {
  lineId: string;
  year: number;
  conflict: { entry: EditConflict; signature: string | null; error: unknown };
  /** The allocation the user was saving. */
  method: string;
  driver: string;
  rows: Array<{ company_id: string | null; department_id: string | null; allocation_pct: number; pinned?: boolean }>;
};

export type HeldChoices = {
  budget: React.MutableRefObject<HeldBudgetChoices | null>;
  allocation: React.MutableRefObject<HeldAllocationChoice | null>;
  /** The Budget tab's opening values for the line (`OpeningValues`). */
  openings: React.MutableRefObject<OpeningValues | null>;
};

/** The page's store for one line: emptied when the line changes. */
export function useHeldChoices(lineId: string | null | undefined): HeldChoices {
  const budget = React.useRef<HeldBudgetChoices | null>(null);
  const allocation = React.useRef<HeldAllocationChoice | null>(null);
  const openings = React.useRef<OpeningValues | null>(null);
  React.useEffect(() => {
    if (budget.current && budget.current.lineId !== lineId) budget.current = null;
    if (allocation.current && allocation.current.lineId !== lineId) allocation.current = null;
    if (openings.current && openings.current.lineId !== lineId) openings.current = null;
  }, [lineId]);
  return React.useMemo(() => ({ budget, allocation, openings }), []);
}

/** Names in a sentence: « Budget », « Budget et Prévision », « Budget, Révision et Prévision ». */
export function namesInSentence(locale: string, names: readonly string[]): string {
  // Intl.ListFormat is in every supported browser; this TypeScript lib predates it.
  type ListFormat = new (locale: string, options: { style: string; type: string }) => { format: (list: readonly string[]) => string };
  const ListFormat = (Intl as unknown as { ListFormat?: ListFormat }).ListFormat;
  try {
    return ListFormat ? new ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names) : names.join(', ');
  } catch {
    return names.join(', ');
  }
}
