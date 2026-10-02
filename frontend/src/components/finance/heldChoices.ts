import React from 'react';
import type { EditConflict } from '../../hooks/editConflicts';
import type { BudgetConflict } from './budgetConflicts';
import type { AmountMeasure } from './roundPeriod';

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

/** A budget column waiting for the user's choice. `cells`: only these months wait (a monthly entry); null: the whole column. */
export type HeldWaitingColumn = BudgetConflict & { source: 'grid' | 'panel'; cells: string[] | null };

export type HeldBudgetChoices = {
  lineId: string;
  year: number;
  /** The waiting columns as the tenant names them, for the leave warning. */
  labels: string[];
  waiting: HeldWaitingColumn[];
  /** A refused panel write (spread or lines), kept whole until each of its columns has a choice. */
  parkedPanel: { body: Record<string, unknown>; main: AmountMeasure; columns: AmountMeasure[] } | null;
  /** The values typed in the waiting cells and totals. */
  cells: Array<{ period: string; col: AmountMeasure; value: number }>;
  totals: Array<{ col: AmountMeasure; value: number | '' }>;
};

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
};

/** The page's store for one line: emptied when the line changes. */
export function useHeldChoices(lineId: string | null | undefined): HeldChoices {
  const budget = React.useRef<HeldBudgetChoices | null>(null);
  const allocation = React.useRef<HeldAllocationChoice | null>(null);
  React.useEffect(() => {
    if (budget.current && budget.current.lineId !== lineId) budget.current = null;
    if (allocation.current && allocation.current.lineId !== lineId) allocation.current = null;
  }, [lineId]);
  return React.useMemo(() => ({ budget, allocation }), []);
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
