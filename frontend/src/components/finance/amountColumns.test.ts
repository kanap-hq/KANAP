import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import type { TFunction } from 'i18next';
import {
  AMOUNT_COLUMNS,
  amountFieldKey,
  explicitSort,
  amountColumnYear,
  buildAmountColumnDefs,
  buildFteColumnDefs,
  dimensionFieldPredicate,
  fteFieldKey,
  fteTotalsToRow,
  filtersOnShownColumns,
  filtersStringOnShownColumns,
  settleListSearch,
  slotAmount,
  sortOnShownColumn,
  totalsToVersions,
  visibleFteFields,
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

describe('saved sorts and filters on dimension columns', () => {
  const shown = columnsOf().shown;
  const NATURE = '11111111-1111-4111-8111-111111111111';
  const OLD = '22222222-2222-4222-8222-222222222222';
  const GONE = '33333333-3333-4333-8333-333333333333';
  // The list builds a column for Nature only; Old is disabled and Gone deleted.
  const isListField = dimensionFieldPredicate([NATURE]);

  it('knows the dimension columns the list builds and every other field', () => {
    expect(isListField(`analytics_${NATURE}`)).toBe(true);
    expect(isListField(`analytics_${NATURE.toUpperCase()}`)).toBe(true);
    expect(isListField(`analytics_${OLD}`)).toBe(false);
    expect(isListField(`analytics_${GONE}`)).toBe(false);
    // The default dimension's column and the other fields are not dimension keys.
    expect(isListField('analytics_category_name')).toBe(true);
    expect(isListField('product_name')).toBe(true);
    expect(isListField(amountFieldKey('y', AMOUNT_COLUMNS[0]))).toBe(true);
  });

  it('drops a sort or filter on a dimension the list does not build, and keeps an enabled one', () => {
    expect(explicitSort(`analytics_${OLD}:ASC`, shown, 'yBudget:DESC', isListField)).toBe('');
    expect(explicitSort(`analytics_${GONE}:DESC`, shown, 'yBudget:DESC', isListField)).toBe('');
    expect(explicitSort(`analytics_${NATURE}:ASC`, shown, 'yBudget:DESC', isListField)).toBe(`analytics_${NATURE}:ASC`);
    const model = {
      [`analytics_${NATURE}`]: { filterType: 'set', values: ['Licences'] },
      [`analytics_${OLD}`]: { filterType: 'set', values: ['Hardware'] },
      [`analytics_${GONE}`]: { filterType: 'set', values: [null] },
      yForecast: { type: 'greaterThan', filter: 1 },
    };
    expect(filtersOnShownColumns(model, shown, isListField)).toEqual({ [`analytics_${NATURE}`]: model[`analytics_${NATURE}`] });
    expect(JSON.parse(filtersStringOnShownColumns(JSON.stringify(model), shown, isListField))).toEqual({
      [`analytics_${NATURE}`]: model[`analytics_${NATURE}`],
    });

    const stored = { sort: `analytics_${OLD}:ASC`, filters: JSON.stringify(model) };
    const settled = new URLSearchParams(settleListSearch('', stored, shown, 'yBudget:DESC', isListField));
    expect(settled.get('sort')).toBeNull();
    expect(JSON.parse(settled.get('filters') ?? '{}')).toEqual({ [`analytics_${NATURE}`]: model[`analytics_${NATURE}`] });
  });

  it('keeps every dimension key without a predicate, as before', () => {
    const model = { [`analytics_${OLD}`]: { filterType: 'set', values: ['Hardware'] } };
    expect(filtersOnShownColumns(model, shown)).toBe(model);
    expect(explicitSort(`analytics_${OLD}:ASC`, shown, 'yBudget:DESC')).toBe(`analytics_${OLD}:ASC`);
  });
});

describe('buildFteColumnDefs', () => {
  const buildFte = (over: Partial<BudgetColumnsSettings> = {}) =>
    buildFteColumnDefs({ t, currentYear: Y, locale: 'en', cellRenderer: () => undefined, columns: columnsOf(over) });

  it('offers the FTE of every shown column of every list year, in the amount columns order, all hidden by default', () => {
    const amounts = build().map((d) => d.colId);
    const fte = buildFte();
    expect(fte.map((d) => d.colId)).toEqual(amounts.map((id) => `fte_${id}`));
    expect(fte).toHaveLength(16);
    expect(fte.every((d) => d.defaultHidden)).toBe(true);
    expect(fteFieldKey('yPlus1', AMOUNT_COLUMNS[1])).toBe(`fte_${amountFieldKey('yPlus1', AMOUNT_COLUMNS[1])}`);
    // A column the tenant hides has no FTE column either.
    const onlyFirst = buildFte({ enabled: { ...DEFAULT_BUDGET_COLUMNS.enabled, committed: false, actual: false, expected_landing: false } });
    expect(onlyFirst.map((d) => d.colId)).toEqual(
      ['yMinus1', 'y', 'yPlus1', 'yPlus2'].map((slot) => fteFieldKey(slot, AMOUNT_COLUMNS[0])),
    );
  });

  it('names the headers with the tenant names and the year', () => {
    const named = buildFte({ labels: { ...DEFAULT_BUDGET_COLUMNS.labels, planned: 'A0' } });
    const header = named.find((d) => d.colId === fteFieldKey('yPlus1', AMOUNT_COLUMNS[0]))?.headerName;
    expect(header).toBe('ops:shared.fteColumnHeader|A0');
  });

  it('filters with number models, blank meaning unknown', () => {
    for (const d of buildFte()) {
      expect(d.filter).toBe('agNumberColumnFilter');
      expect(d.floatingFilterComponent).toBe('agNumberColumnFloatingFilter');
      expect(d.filterParams).toMatchObject({ maxNumConditions: 1, defaultOption: 'greaterThanOrEqual' });
      expect(d.filterParams.filterOptions).toEqual(expect.arrayContaining(['blank', 'notBlank', 'equals', 'inRange']));
    }
  });

  it('reads the line FTE, blank when unknown, two decimals', () => {
    const key = fteFieldKey('y', AMOUNT_COLUMNS[0]);
    const def = buildFte().find((d) => d.colId === key)!;
    const getter = def.valueGetter as (p: unknown) => number | null;
    const format = def.valueFormatter as (p: unknown) => string;
    expect(getter({ data: { [key]: 0.75 } })).toBe(0.75);
    expect(getter({ data: { [key]: 0 } })).toBe(0);
    expect(getter({ data: { [key]: null } })).toBeNull();
    expect(getter({ data: {} })).toBeNull();
    expect(format({ value: 0.75 })).toBe('0.75');
    expect(format({ value: 0 })).toBe('0.00');
    expect(format({ value: null })).toBe('');
  });

  it('shows the sum in the totals row and the unknown lines in its tooltip', () => {
    const key = fteFieldKey('y', AMOUNT_COLUMNS[0]);
    const known = fteFieldKey('y', AMOUNT_COLUMNS[4]);
    const row = fteTotalsToRow({ [key]: { total: 12.5, unknown: 3 }, [known]: { total: 2, unknown: 0 }, other: { total: 9 } });
    expect(row[key]).toBe(12.5);
    expect(row[known]).toBe(2);
    expect(row.other).toBeUndefined();
    const defs = buildFte();
    const tooltip = (id: string, pinned: boolean) =>
      (defs.find((d) => d.colId === id)!.tooltipValueGetter as (p: unknown) => string | undefined)({ data: row, node: { rowPinned: pinned ? 'bottom' : undefined } });
    expect(tooltip(key, true)).toBe('ops:shared.fteUnknownLines');
    expect(tooltip(known, true)).toBeUndefined();
    // Lines carry no tooltip.
    expect(tooltip(key, false)).toBeUndefined();
    expect(fteTotalsToRow(undefined)).toEqual({ fteUnknown: {} });
  });

  it('shows the unknown lines next to the total without a hover, and a blank total when no line has an FTE', () => {
    const key = fteFieldKey('y', AMOUNT_COLUMNS[0]);
    const none = fteFieldKey('y', AMOUNT_COLUMNS[1]);
    const known = fteFieldKey('y', AMOUNT_COLUMNS[4]);
    const row = fteTotalsToRow({ [key]: { total: 1.38, unknown: 3 }, [none]: { total: null, unknown: 5 }, [known]: { total: 2, unknown: 0 } });
    expect(row[none]).toBeNull();
    const lineCell = () => 'line';
    const defs = buildFteColumnDefs({ t, currentYear: Y, locale: 'en', cellRenderer: () => lineCell, columns: columnsOf() });
    const def = (id: string) => defs.find((d) => d.colId === id)!;
    const shown = (id: string) => {
      const d = def(id);
      const value = (d.valueGetter as (p: unknown) => unknown)({ data: row });
      const valueFormatted = (d.valueFormatter as (p: unknown) => string)({ value });
      const { component } = (d.cellRendererSelector as (p: unknown) => { component: (p: unknown) => unknown })({ node: { rowPinned: 'bottom' } });
      const out = component({ data: row, value, valueFormatted });
      return typeof out === 'string' ? out : render(out as ReactElement).container.textContent;
    };
    expect(shown(key)).toBe('1.38 · ops:shared.fteUnknownCount');
    expect(shown(none)).toBe('ops:shared.fteUnknownCount');
    expect(shown(known)).toBe('2.00');
    // Too narrow a column (a long language, a resize) cuts the count with an ellipsis, never the total.
    const { component } = (def(key).cellRendererSelector as (p: unknown) => { component: (p: unknown) => unknown })({ node: { rowPinned: 'bottom' } });
    const { container } = render(component({ data: row, value: 1.38, valueFormatted: '1.38' }) as ReactElement);
    const [total, count] = Array.from(container.firstElementChild!.children) as HTMLElement[];
    expect(total).toHaveTextContent('1.38');
    expect(total).toHaveStyle({ flexShrink: '0' });
    expect(count).toHaveStyle({ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: '0' });
    // Room for the sum and the count in every language.
    expect(def(key).width).toBe(200);
    // Lines keep the list's own cell.
    expect((def(key).cellRendererSelector as (p: unknown) => { component: unknown })({ node: {} }).component).toBe(lineCell);
  });

  it('lists the FTE columns the grid shows, in grid order', () => {
    const state = [
      { colId: 'product_name', hide: false },
      { colId: fteFieldKey('yPlus1', AMOUNT_COLUMNS[0]), hide: false },
      { colId: fteFieldKey('y', AMOUNT_COLUMNS[0]), hide: true },
      { colId: fteFieldKey('y', AMOUNT_COLUMNS[4]), hide: null },
      { colId: 'fte_unknown', hide: false },
    ];
    expect(visibleFteFields(state)).toEqual([fteFieldKey('yPlus1', AMOUNT_COLUMNS[0]), fteFieldKey('y', AMOUNT_COLUMNS[4])]);
    expect(visibleFteFields(undefined)).toEqual([]);
  });
});

describe('saved sorts and filters on FTE columns', () => {
  const shown = columnsOf().shown;
  const hiddenColumn = AMOUNT_COLUMNS[2];
  const hiddenFte = fteFieldKey('yPlus1', hiddenColumn);
  const shownFte = fteFieldKey('y', AMOUNT_COLUMNS[1]);

  it('maps an FTE column to its calendar year', () => {
    expect(amountColumnYear(fteFieldKey('yPlus1', AMOUNT_COLUMNS[0]), Y)).toBe(2027);
    expect(amountColumnYear(fteFieldKey('yMinus1', AMOUNT_COLUMNS[4]), Y)).toBe(2025);
    expect(amountColumnYear('fte_unknown', Y)).toBeNull();
  });

  it('falls back like the amounts when the FTE column belongs to a column that is not shown', () => {
    expect(sortOnShownColumn(`${hiddenFte}:ASC`, shown, 'yBudget:DESC')).toBe('yBudget:DESC');
    expect(sortOnShownColumn(`${shownFte}:ASC`, shown, 'yBudget:DESC')).toBe(`${shownFte}:ASC`);
    const model = { [hiddenFte]: { type: 'blank' }, [shownFte]: { type: 'greaterThan', filter: 0.5 } };
    expect(filtersOnShownColumns(model, shown)).toEqual({ [shownFte]: model[shownFte] });
    const settled = new URLSearchParams(settleListSearch('', { sort: `${hiddenFte}:DESC`, filters: JSON.stringify(model) }, shown, 'yBudget:DESC'));
    expect(settled.get('sort')).toBeNull();
    expect(JSON.parse(settled.get('filters') ?? '{}')).toEqual({ [shownFte]: model[shownFte] });
  });
});
