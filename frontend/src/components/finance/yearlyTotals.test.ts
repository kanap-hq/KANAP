import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { OPEX_FINANCE_CONFIG } from './config';
import {
  overlayYear,
  patchYearlyTotalsCache,
  toChartYearRow,
  yearlyTotalsQueryKey,
  type LiveBudgetTotals,
  type YearTotals,
} from './yearlyTotals';

const live = (overrides: Partial<LiveBudgetTotals> = {}): LiveBudgetTotals => ({
  planned: 10,
  committed: 20,
  forecast: 25,
  actual: 30,
  expected_landing: 40,
  ...overrides,
});

const series = (): YearTotals[] => [
  { year: 2023, budget: 1, revision: 2, forecast: 0, actual: 3, landing: 4 },
  { year: 2024, budget: 5, revision: 6, forecast: 0, actual: 7, landing: 8 },
  { year: 2025, budget: 9, revision: 10, forecast: 0, actual: 11, landing: 12 },
];

describe('toChartYearRow', () => {
  it('maps budget-tab measures onto chart series keys, Forecast included', () => {
    expect(toChartYearRow(2026, live())).toEqual({
      year: 2026,
      budget: 10,
      revision: 20,
      forecast: 25,
      actual: 30,
      landing: 40,
    });
  });
});

describe('overlayYear', () => {
  it('replaces the matching year and leaves the others unchanged', () => {
    const next = overlayYear(series(), 2024, live());
    expect(next).toEqual([
      { year: 2023, budget: 1, revision: 2, forecast: 0, actual: 3, landing: 4 },
      { year: 2024, budget: 10, revision: 20, forecast: 25, actual: 30, landing: 40 },
      { year: 2025, budget: 9, revision: 10, forecast: 0, actual: 11, landing: 12 },
    ]);
  });

  it('inserts a missing year in chronological order', () => {
    const next = overlayYear(series(), 2026, live({ planned: 100 }));
    expect(next.map((row) => row.year)).toEqual([2023, 2024, 2025, 2026]);
    expect(next[3]).toEqual({ year: 2026, budget: 100, revision: 20, forecast: 25, actual: 30, landing: 40 });
  });

  it('returns the same array instance when the overlaid year is unchanged', () => {
    const items = [{ year: 2024, budget: 10, revision: 20, forecast: 25, actual: 30, landing: 40 }];
    expect(overlayYear(items, 2024, live())).toBe(items);
  });

  it('returns the base series when there are no live totals', () => {
    const items = series();
    expect(overlayYear(items, 2024, undefined)).toBe(items);
    expect(overlayYear(undefined, 2024, undefined)).toEqual([]);
  });
});

describe('patchYearlyTotalsCache', () => {
  it('patches every yearly-totals query for the item', () => {
    const client = new QueryClient();
    const key = yearlyTotalsQueryKey(OPEX_FINANCE_CONFIG, 'item-1');
    client.setQueryData(key, series());

    patchYearlyTotalsCache(client, OPEX_FINANCE_CONFIG, 'item-1', 2024, live());

    expect(client.getQueryData<YearTotals[]>(key)?.find((row) => row.year === 2024)).toEqual({
      year: 2024,
      budget: 10,
      revision: 20,
      forecast: 25,
      actual: 30,
      landing: 40,
    });
  });
});
