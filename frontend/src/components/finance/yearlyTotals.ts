import type { QueryClient } from '@tanstack/react-query';
import type { FinanceModuleConfig } from './config';
import type { FreezeColumn } from '../../services/freeze';
import type { AmountMeasure } from './roundPeriod';
import { AMOUNT_COLUMNS } from './amountColumns';

/** One year of the yearly totals endpoint: every column, keyed like the freeze keys. */
export type YearTotals = { year: number } & Record<FreezeColumn, number>;

/** The budget tab's yearly totals, keyed by storage key. */
export type LiveBudgetTotals = Record<AmountMeasure, number>;

/** Multi-year vision window: N-3 … N+1 around the current calendar year. */
const N = new Date().getFullYear();
export const YEARLY_TOTALS_FROM = N - 3;
export const YEARLY_TOTALS_TO = N + 1;

export function yearlyTotalsQueryKey(config: FinanceModuleConfig, id: string) {
  return [`${config.queryKeyPrefix}-yearly-totals`, id, YEARLY_TOTALS_FROM, YEARLY_TOTALS_TO] as const;
}

export function toChartYearRow(year: number, live: LiveBudgetTotals): YearTotals {
  const row = { year } as YearTotals;
  for (const column of AMOUNT_COLUMNS) row[column.freezeKey] = Number(live[column.measure]) || 0;
  return row;
}

function sameRow(a: YearTotals, b: YearTotals): boolean {
  return a.year === b.year && AMOUNT_COLUMNS.every((column) => a[column.freezeKey] === b[column.freezeKey]);
}

/** Overlay live form totals onto the fetched multi-year series for `year`. */
export function overlayYear(
  items: YearTotals[] | undefined,
  year: number,
  live: LiveBudgetTotals | undefined,
): YearTotals[] {
  const base = items ?? [];
  if (!live) return base;
  const row = toChartYearRow(year, live);
  const idx = base.findIndex((entry) => entry.year === year);
  if (idx === -1) {
    return [...base, row].sort((a, b) => a.year - b.year);
  }
  if (sameRow(base[idx], row)) return base;
  const next = base.slice();
  next[idx] = row;
  return next;
}

export function patchYearlyTotalsCache(
  queryClient: QueryClient,
  config: FinanceModuleConfig,
  id: string,
  year: number,
  live: LiveBudgetTotals,
) {
  queryClient.setQueriesData<YearTotals[]>(
    { queryKey: [`${config.queryKeyPrefix}-yearly-totals`, id] },
    (old) => overlayYear(old, year, live),
  );
}
