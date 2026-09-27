import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import {
  AMOUNT_COLUMNS,
  explicitSort,
  amountColumnYear,
  buildAmountColumnDefs,
  filtersOnShownColumns,
  settleListSearch,
  slotAmount,
  sortOnShownColumn,
  totalsToVersions,
} from './amountColumns';
import { resolveBudgetColumns } from '../../hooks/useBudgetColumns';
import { DEFAULT_BUDGET_COLUMNS, type BudgetColumnsSettings } from '../../services/budgetColumns';

// Header texts come back as "key|column" so the column name can be read.
const t = ((key: string, options?: { column?: string }) => (options?.column ? `${key}|${options.column}` : key)) as unknown as TFunction;
const Y = 2026;

const ALL_ON = { planned: true, committed: true, forecast: true, actual: true, expected_landing: true };
const setting = (over: Partial<BudgetColumnsSettings> = {}): BudgetColumnsSettings => ({ ...DEFAULT_BUDGET_COLUMNS, ...over });
const columnsOf = (over: Partial<BudgetColumnsSettings> = {}) => resolveBudgetColumns(setting(over), t);
const build = (over: Partial<BudgetColumnsSettings> = {}) =>
  buildAmountColumnDefs({ t, currentYear: Y, cellRenderer: () => undefined, columns: columnsOf(over) });

describe('buildAmountColumnDefs', () => {
  const defs = build({ enabled: ALL_ON });
  const ids = defs.map((d) => d.colId);

  it('with every column shown, offers five columns for each list year, Y-1 to Y+2, and keeps the existing column ids', () => {
    expect(defs).toHaveLength(20);
    for (const legacy of ['yMinus1Budget', 'yMinus1Landing', 'yBudget', 'yRevision', 'yFollowUp', 'yLanding', 'yPlus1Budget', 'yPlus1Revision', 'yPlus2Budget']) {
      expect(ids).toContain(legacy);
    }
    for (const added of ['yMinus1Revision', 'yForecast', 'yPlus1FollowUp', 'yPlus2Landing', 'yPlus2Forecast']) {
      expect(ids).toContain(added);
    }
    expect(ids.some((id) => id?.startsWith('yMinus2'))).toBe(false);
    // Year by year, in the fixed column order.
    expect(ids.slice(5, 10)).toEqual(['yBudget', 'yRevision', 'yForecast', 'yFollowUp', 'yLanding']);
  });

  it('builds only the shown columns: a hidden column is not in the chooser, sort or filters', () => {
    const defaults = build();
    expect(defaults).toHaveLength(16);
    expect(defaults.some((d) => d.colId?.endsWith('Forecast'))).toBe(false);
    const onlyFirst = build({ enabled: { ...DEFAULT_BUDGET_COLUMNS.enabled, committed: false, actual: false, expected_landing: false } });
    expect(onlyFirst.map((d) => d.colId)).toEqual(['yMinus1Budget', 'yBudget', 'yPlus1Budget', 'yPlus2Budget']);
  });

  it('shows the default column of Y and the last shown column of Y by default', () => {
    expect(build().filter((d) => !d.defaultHidden).map((d) => d.colId)).toEqual(['yBudget', 'yLanding']);
    expect(build({ default_column: 'forecast', enabled: ALL_ON }).filter((d) => !d.defaultHidden).map((d) => d.colId))
      .toEqual(['yForecast', 'yLanding']);
    // The default column is the last shown one: a single column.
    const two = { ...DEFAULT_BUDGET_COLUMNS.enabled, actual: false, expected_landing: false };
    expect(build({ enabled: two, default_column: 'committed' }).filter((d) => !d.defaultHidden).map((d) => d.colId)).toEqual(['yRevision']);
  });

  it('names the headers with the tenant names', () => {
    const named = build({ labels: { ...DEFAULT_BUDGET_COLUMNS.labels, planned: 'A0' } });
    expect(named.find((d) => d.colId === 'yPlus1Budget')?.headerName).toBe('ops:shared.amountColumnHeader|A0');
    expect(named.find((d) => d.colId === 'yRevision')?.headerName).toBe('ops:shared.amountColumnHeader|ops:operations.budgetColumns.revision');
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

describe('saved sorts and filters on hidden columns', () => {
  const shown = columnsOf().shown;

  it('falls back to the default sort for a hidden column only', () => {
    expect(sortOnShownColumn('yPlus1Forecast:ASC', shown, 'yBudget:DESC')).toBe('yBudget:DESC');
    expect(sortOnShownColumn('yRevision:ASC', shown, 'yBudget:DESC')).toBe('yRevision:ASC');
    expect(sortOnShownColumn('product_name:ASC', shown, 'yBudget:DESC')).toBe('product_name:ASC');
    expect(sortOnShownColumn(null, shown, 'yRevision:DESC')).toBe('yRevision:DESC');
  });

  it('drops the filters on hidden columns and keeps the others', () => {
    const model = { yForecast: { type: 'greaterThan', filter: 1 }, yBudget: { type: 'greaterThan', filter: 2 }, status: { values: ['enabled'] } };
    expect(filtersOnShownColumns(model, shown)).toEqual({ yBudget: model.yBudget, status: model.status });
    const clean = { yBudget: model.yBudget };
    expect(filtersOnShownColumns(clean, shown)).toBe(clean);
  });

  it('settles the list URL from the stored context and the setting', () => {
    const stored = { sort: 'yForecast:DESC', q: 'cloud', filters: JSON.stringify({ yForecast: { filter: 1 } }) };
    const settled = new URLSearchParams(settleListSearch('', stored, shown, 'yBudget:DESC'));
    // Back on the default sort, which is left out: the grid applies the current default.
    expect(settled.get('sort')).toBeNull();
    expect(settled.get('q')).toBe('cloud');
    expect(settled.get('filters')).toBeNull();
    // A URL that is already usable stays as it is.
    const url = new URLSearchParams({ sort: 'yRevision:ASC', q: 'x' }).toString();
    expect(settleListSearch(url, stored, shown, 'yBudget:DESC')).toBe(new URLSearchParams({ sort: 'yRevision:ASC', q: 'x' }).toString());
    // Nothing to settle: no sort param, the grid uses its default sort.
    expect(settleListSearch('', null, shown, 'yBudget:DESC')).toBe('');
    // A sort equal to the default, stored or linked, is dropped; another one is kept.
    expect(settleListSearch('sort=yBudget%3ADESC', null, shown, 'yBudget:DESC')).toBe('');
    expect(new URLSearchParams(settleListSearch('', { sort: 'yBudget:DESC' }, shown, 'yRevision:DESC')).get('sort')).toBe('yBudget:DESC');
  });

  it('keeps a sort only when it is not the default', () => {
    expect(explicitSort('yBudget:DESC', shown, 'yBudget:DESC')).toBe('');
    expect(explicitSort(undefined, shown, 'yBudget:DESC')).toBe('');
    expect(explicitSort('yForecast:ASC', shown, 'yBudget:DESC')).toBe('');
    expect(explicitSort('yBudget:ASC', shown, 'yBudget:DESC')).toBe('yBudget:ASC');
    expect(explicitSort('product_name:ASC', shown, 'yBudget:DESC')).toBe('product_name:ASC');
  });
});
