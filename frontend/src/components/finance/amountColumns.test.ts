import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import {
  AMOUNT_COLUMNS,
  amountColumnYear,
  buildAmountColumnDefs,
  slotAmount,
  totalsToVersions,
} from './amountColumns';

const t = ((key: string) => key) as unknown as TFunction;
const Y = 2026;

describe('buildAmountColumnDefs', () => {
  const defs = buildAmountColumnDefs({ t, currentYear: Y, cellRenderer: () => undefined });
  const ids = defs.map((d) => d.colId);

  it('offers five columns for each list year, Y-1 to Y+2, and keeps the existing column ids', () => {
    expect(defs).toHaveLength(20);
    for (const legacy of ['yMinus1Budget', 'yMinus1Landing', 'yBudget', 'yRevision', 'yFollowUp', 'yLanding', 'yPlus1Budget', 'yPlus1Revision', 'yPlus2Budget']) {
      expect(ids).toContain(legacy);
    }
    for (const added of ['yMinus1Revision', 'yForecast', 'yPlus1FollowUp', 'yPlus2Landing', 'yPlus2Forecast']) {
      expect(ids).toContain(added);
    }
    expect(ids.some((id) => id?.startsWith('yMinus2'))).toBe(false);
  });

  it('shows the same two columns by default as before', () => {
    expect(defs.filter((d) => !d.defaultHidden).map((d) => d.colId)).toEqual(['yBudget', 'yLanding']);
  });

  it('filters every amount with comparisons, "at least" by default, and no blank options', () => {
    for (const d of defs) {
      expect(d.filter).toBe('agNumberColumnFilter');
      expect(d.floatingFilterComponent).toBe('agNumberColumnFloatingFilter');
      expect(d.filterParams).toMatchObject({ maxNumConditions: 1, defaultOption: 'greaterThanOrEqual' });
      expect([...d.filterParams.filterOptions].sort()).toEqual(
        ['equals', 'greaterThan', 'greaterThanOrEqual', 'inRange', 'lessThan', 'lessThanOrEqual', 'notEqual'],
      );
    }
  });

  it('reads the reporting amount, then the item currency amount', () => {
    const plus2 = defs.find((d) => d.colId === 'yPlus2Budget')!;
    const getter = plus2.valueGetter as (p: unknown) => number;
    expect(getter({ data: { versions: { yPlus2: { totals: { budget: 100 }, reporting: { budget: 92 } } } } })).toBe(92);
    expect(getter({ data: { versions: { yPlus2: { totals: { budget: 100 } } } } })).toBe(100);
    expect(getter({ data: {} })).toBe(0);
  });
});

describe('amount helpers', () => {
  it('maps an amount column to its calendar year and ignores other columns', () => {
    expect(amountColumnYear('yMinus1Revision', Y)).toBe(2025);
    expect(amountColumnYear('yForecast', Y)).toBe(2026);
    expect(amountColumnYear('yPlus2Landing', Y)).toBe(2028);
    expect(amountColumnYear('allocation_label', Y)).toBeNull();
    expect(amountColumnYear(undefined, Y)).toBeNull();
  });

  it('builds a totals row from the totals keys of the same name', () => {
    const versions = totalsToVersions({ yPlus2Forecast: 5, yMinus1FollowUp: 7, yBudget: '12.5', reportingCurrency: 'X' });
    expect(slotAmount(versions.yPlus2, 'forecast')).toBe(5);
    expect(slotAmount(versions.yMinus1, 'follow_up')).toBe(7);
    expect(slotAmount(versions.y, 'budget')).toBe(12.5);
    expect(Object.keys(versions.y?.totals ?? {})).toEqual(AMOUNT_COLUMNS.map((c) => c.key));
    expect(versions.yMinus2).toBeUndefined();
  });
});
