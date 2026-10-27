import { describe, expect, it } from 'vitest';
import type { AggregateResult, AggregateRow } from './reportAggregates';
import {
  columnsCompareGrouped,
  columnsCompareTable,
  comparisonTable,
  sortColumnSelections,
  topLinesTable,
  type ReportTableLabels,
} from './reportTables';

const labels: ReportTableLabels = {
  columnNames: { budget: 'Budget', revision: 'Revision', forecast: 'Forecast', follow_up: 'Actuals', landing: 'Landing' },
  columnFte: (column) => `${column} FTE`,
  metric: 'Metric',
  year: 'Year',
  column: 'Column',
  selection: 'Selection',
  total: 'Total',
  totalFte: 'Total FTE',
  item: 'Line',
  shareOfTotal: 'Share of total',
};

const row = (values: Record<string, number | null>, keys: Array<string | null> = []): AggregateRow => ({ keys, count: 1, values, unknown: {} });
const answer = (total: Record<string, number | null>, groups: AggregateRow[] = []): AggregateResult => ({
  groups,
  others: null,
  total: row(total),
  groupCount: groups.length,
  reportingCurrency: 'EUR',
  fxMissing: [],
});

describe('comparisonTable', () => {
  it('lists one row per column and one column per year; a missing amount is 0', () => {
    const table = comparisonTable({ years: [2025, 2026], metrics: ['budget', 'landing'], measure: 'amount' }, answer({ budget_2025: 10.5, budget_2026: null, landing_2026: 3 }), labels);
    expect(table.columns).toEqual([
      { key: 'metric', header: 'Metric', kind: 'text' },
      { key: '2025', header: '2025', kind: 'amount' },
      { key: '2026', header: '2026', kind: 'amount' },
    ]);
    expect(table.rows).toEqual([
      { _key: 'budget', metric: 'Budget', 2025: 10.5, 2026: 0 },
      { _key: 'landing', metric: 'Landing', 2025: 0, 2026: 3 },
    ]);
    expect(table.footer).toEqual([]);
  });

  it('keeps FTE nobody declares blank and names the columns for the measure', () => {
    const table = comparisonTable({ years: [2026], metrics: ['budget'], measure: 'fte' }, answer({ budget_2026: null }), labels);
    expect(table.columns[1].kind).toBe('number');
    expect(table.rows).toEqual([{ _key: 'budget', metric: 'Budget FTE', 2026: null }]);
  });
});

describe('columnsCompareTable', () => {
  it('sorts the selections by year, then in column order', () => {
    expect(sortColumnSelections([{ year: 2027, metric: 'budget' }, { year: 2026, metric: 'landing' }, { year: 2026, metric: 'budget' }]))
      .toEqual([{ year: 2026, metric: 'budget' }, { year: 2026, metric: 'landing' }, { year: 2027, metric: 'budget' }]);
  });

  it('lists one row per selection in the flat table', () => {
    const selections = sortColumnSelections([{ year: 2026, metric: 'budget' }, { year: 2027, metric: 'revision' }]);
    const table = columnsCompareTable({ selections, measure: 'amount', yearGrouping: false }, answer({ budget_2026: 100, revision_2027: null }), labels);
    expect(table.grouped).toBe(false);
    expect(table.columns.map((column) => [column.key, column.header, column.kind])).toEqual([
      ['selection', 'Selection', 'text'],
      ['year', 'Year', 'number'],
      ['column', 'Column', 'text'],
      ['total', 'Total', 'amount'],
    ]);
    expect(table.rows).toEqual([
      { key: '2026-budget-0', selection: '2026 Budget', year: 2026, column: 'Budget', total: 100 },
      { key: '2027-revision-1', selection: '2027 Revision', year: 2027, column: 'Revision', total: 0 },
    ]);
  });

  it('heads the total for FTE and keeps an undeclared one blank', () => {
    const table = columnsCompareTable({ selections: [{ year: 2026, metric: 'budget' }], measure: 'fte', yearGrouping: false }, answer({ budget_2026: null }), labels);
    expect(table.columns[3]).toEqual({ key: 'total', header: 'Total FTE', kind: 'number' });
    expect(table.rows[0].total).toBeNull();
  });

  it('groups by year only when every column in use has two years or more', () => {
    const one = [{ year: 2026, metric: 'budget' as const }, { year: 2027, metric: 'budget' as const }, { year: 2026, metric: 'landing' as const }];
    expect(columnsCompareGrouped(one, true)).toBe(false);
    expect(columnsCompareGrouped(one.slice(0, 2), true)).toBe(true);
    expect(columnsCompareGrouped(one.slice(0, 2), false)).toBe(false);
  });

  it('adds up a year and column picked twice in the year-grouped table', () => {
    const selections = sortColumnSelections([
      { year: 2027, metric: 'budget' },
      { year: 2026, metric: 'budget' },
      { year: 2026, metric: 'budget' },
      { year: 2026, metric: 'landing' },
      { year: 2027, metric: 'landing' },
    ]);
    const table = columnsCompareTable({ selections, measure: 'amount', yearGrouping: true }, answer({ budget_2026: 5, budget_2027: 7, landing_2026: null, landing_2027: 2 }), labels);
    expect(table.grouped).toBe(true);
    expect(table.columns).toEqual([
      { key: 'year', header: 'Year', kind: 'number' },
      { key: 'budget', header: 'Budget', kind: 'amount' },
      { key: 'landing', header: 'Landing', kind: 'amount' },
    ]);
    expect(table.rows).toEqual([
      { year: 2026, budget: 10, landing: 0 },
      { year: 2027, budget: 7, landing: 2 },
    ]);
  });
});

describe('topLinesTable', () => {
  it('gives each line its share of the total as a fraction', () => {
    const groups = [row({ value: 60 }, ['a', 'Alpha', '7']), row({ value: 15 }, ['b', 'Beta', null])];
    const table = topLinesTable({ year: 2026, metric: 'budget', measure: 'amount' }, answer({ value: 120 }, groups), labels);
    expect(table.columns).toEqual([
      { key: 'name', header: 'Line', kind: 'text' },
      { key: 'value', header: 'Budget (2026)', kind: 'amount' },
      { key: 'pct_of_total', header: 'Share of total', kind: 'percent' },
    ]);
    expect(table.rows).toEqual([
      { id: 'a', itemNumber: 7, name: 'Alpha', value: 60, pct_of_total: 0.5 },
      { id: 'b', itemNumber: undefined, name: 'Beta', value: 15, pct_of_total: 0.125 },
    ]);
  });

  it('leaves out the lines without declared FTE, and a share of nothing is 0', () => {
    const groups = [row({ value: 2 }, ['a', 'Alpha', '1']), row({ value: null }, ['b', 'Beta', '2'])];
    const table = topLinesTable({ year: 2026, metric: 'landing', measure: 'fte' }, answer({ value: null }, groups), labels);
    expect(table.columns[1]).toEqual({ key: 'value', header: 'Landing FTE (2026)', kind: 'number' });
    expect(table.rows).toEqual([{ id: 'a', itemNumber: 1, name: 'Alpha', value: 2, pct_of_total: 0 }]);
  });
});
