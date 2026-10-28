import { describe, expect, it } from 'vitest';
import type { AggregateResult, AggregateRow } from './reportAggregates';
import {
  analyticsTable,
  columnsCompareGrouped,
  columnsCompareTable,
  comparisonTable,
  consolidationTable,
  costPerFteTable,
  deltaTable,
  distinctColumns,
  shortMonthNames,
  sortColumnSelections,
  staffingTable,
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
  reference: 'Ref',
  shareOfTotal: 'Share of total',
  delta: 'Δ',
  pctIncrease: '% increase',
  consolidationAccount: 'Consolidation account',
  consolidationUnassigned: 'Unassigned',
  consolidationTotal: (metric) => `Total ${metric}`,
  analyticsUnassigned: 'No value',
  analyticsUnnamed: 'Unnamed value',
  analyticsTotal: (metric) => `All ${metric}`,
  analyticsLines: 'Lines',
  analyticsNature: 'Nature',
  natureOpex: 'OPEX',
  natureCapex: 'CAPEX',
  monthNames: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  average: 'Average',
  peak: 'Peak',
  fte: 'FTE',
  staffCost: 'Staff cost',
  costPerFte: 'Cost per FTE',
  days: 'Days',
  dayCost: 'Day cost',
  dailyRate: 'Daily rate',
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
      { key: 'reference', header: 'Ref', kind: 'text' },
      { key: 'name', header: 'Line', kind: 'text' },
      { key: 'value', header: 'Budget (2026)', kind: 'amount' },
      { key: 'pct_of_total', header: 'Share of total', kind: 'percent' },
    ]);
    expect(table.rows).toEqual([
      { id: 'a', itemNumber: 7, reference: 'BL-7', name: 'Alpha', value: 60, pct_of_total: 0.5 },
      { id: 'b', itemNumber: undefined, reference: null, name: 'Beta', value: 15, pct_of_total: 0.125 },
    ]);
  });

  it('leaves out the lines without declared FTE, and a share of nothing is 0', () => {
    const groups = [row({ value: 2 }, ['a', 'Alpha', '1']), row({ value: null }, ['b', 'Beta', '2'])];
    const table = topLinesTable({ year: 2026, metric: 'landing', measure: 'fte' }, answer({ value: null }, groups), labels);
    expect(table.columns[2]).toEqual({ key: 'value', header: 'Landing FTE (2026)', kind: 'number' });
    expect(table.rows).toEqual([{ id: 'a', itemNumber: 1, reference: 'BL-1', name: 'Alpha', value: 2, pct_of_total: 0 }]);
  });
});

describe('deltaTable', () => {
  const p = { source: { year: 2025, metric: 'budget' as const }, destination: { year: 2026, metric: 'landing' as const }, measure: 'amount' as const };

  it('lists the increases then the decreases, the change as a fraction of the source', () => {
    const up = answer({ delta: 30 }, [row({ prev: 80, curr: 100, delta: 20 }, ['a', 'Alpha', '3']), row({ prev: 0, curr: 10, delta: 10 }, ['b', 'Beta', null])]);
    const down = answer({ delta: 30 }, [row({ prev: 50, curr: 40, delta: -10 }, ['c', 'Gamma', '5'])]);
    const table = deltaTable({ ...p, modes: ['increase', 'decrease'] }, [up, down], labels);
    expect(table.columns).toEqual([
      { key: 'name', header: 'Line', kind: 'text' },
      { key: 'previous', header: 'Budget (2025)', kind: 'amount' },
      { key: 'current', header: 'Landing (2026)', kind: 'amount' },
      { key: 'delta', header: 'Δ', kind: 'amount' },
      { key: 'pct_increase', header: '% increase', kind: 'percent' },
    ]);
    expect(table.rows.map((r) => [r.name, r.previous, r.current, r.delta, r.pct_increase, r.direction])).toEqual([
      ['Alpha', 80, 100, 20, 0.25, 'increase'],
      ['Beta', 0, 10, 10, null, 'increase'],
      ['Gamma', 50, 40, -10, -0.2, 'decrease'],
    ]);
    expect(table.footer).toEqual([]);
  });

  it('keeps a side nobody declares FTE on blank, and its change without a share', () => {
    const up = answer({ delta: 1 }, [row({ prev: null, curr: 1.5, delta: 1.5 }, ['a', 'Alpha', '3'])]);
    const table = deltaTable({ ...p, measure: 'fte', modes: ['increase'] }, [up], labels);
    expect(table.columns[1]).toEqual({ key: 'previous', header: 'Budget FTE (2025)', kind: 'number' });
    expect(table.rows).toEqual([{ id: 'a', itemNumber: 3, name: 'Alpha', previous: null, current: 1.5, delta: 1.5, pct_increase: null, direction: 'increase' }]);
  });
});

describe('consolidationTable', () => {
  it('lists the consolidation lines by year and puts the total in the footer', () => {
    const groups = [row({ y2025: 40, y2026: null }, ['c_601', '601 Licences']), row({ y2025: 5, y2026: 7 }, [null, null])];
    const table = consolidationTable({ years: [2025, 2026], metric: 'budget', measure: 'amount' }, answer({ y2025: 45, y2026: 7 }, groups), labels);
    expect(table.columns).toEqual([
      { key: 'group', header: 'Consolidation account', kind: 'text' },
      { key: '2025', header: '2025', kind: 'amount' },
      { key: '2026', header: '2026', kind: 'amount' },
    ]);
    expect(table.rows).toEqual([
      { group: '601 Licences', groupKey: 'c_601', groupName: null, 2025: 40, 2026: 0 },
      { group: 'Unassigned', groupKey: 'unassigned', groupName: null, 2025: 5, 2026: 7 },
    ]);
    expect(table.footer).toEqual([{ group: 'Total Budget', 2025: 45, 2026: 7 }]);
  });

  it('keeps FTE nobody declares blank, in the rows and the total', () => {
    const groups = [row({ y2026: 1.5 }, ['c_601', '601 Licences']), row({ y2026: null }, ['c_602', '602 Services'])];
    const table = consolidationTable({ years: [2026], metric: 'landing', measure: 'fte' }, answer({ y2026: null }, groups), labels);
    expect(table.rows.map((r) => r.group)).toEqual(['601 Licences']);
    expect(table.footer).toEqual([{ group: 'Total Landing FTE', 2026: null }]);
  });
});

describe('analyticsTable', () => {
  it('names the group column after the dimension and words the values without a name', () => {
    const groups = [row({ y2026: 30 }, ['v1', ' Cloud ']), row({ y2026: 20 }, ['v2', '  ']), row({ y2026: 10 }, [null, null])];
    const table = analyticsTable({ scope: 'all', years: [2026], metric: 'budget', measure: 'amount', dimension: 'Domain' }, answer({ y2026: 60 }, groups), labels);
    expect(table.columns.slice(0, 2)).toEqual([
      { key: 'group', header: 'Domain', kind: 'text' },
      { key: 'count', header: 'Lines', kind: 'count' },
    ]);
    expect(table.rows).toEqual([
      { group: 'Cloud', groupKey: 'cat_v1', groupName: ' Cloud ', count: 1, level: 0, 2026: 30 },
      { group: 'Unnamed value', groupKey: 'cat_v2', groupName: '  ', count: 1, level: 0, 2026: 20 },
      { group: 'No value', groupKey: 'uncategorized', groupName: null, count: 1, level: 0, 2026: 10 },
    ]);
    expect(table.footer).toEqual([{ group: 'All Budget', count: 1, 2026: 60 }]);
  });

  it('lists the lines of each value, indented, with their reference, nature and share of the value', () => {
    const groups = [{ ...row({ y2026: 60 }, ['v1', 'Cloud']), count: 2 }, row({ y2026: 40 }, [null, null])];
    const lines = [
      row({ y2026: 40 }, ['v1', 'L1', 'Big line', '12', 'opex']),
      row({ y2026: 20 }, ['v1', 'L2', 'Small line', '13', 'capex']),
      row({ y2026: 40 }, [null, 'L3', 'No value line', '14', 'opex']),
    ];
    const table = analyticsTable(
      { scope: 'all', years: [2026], metric: 'budget', measure: 'amount', dimension: 'Domain', detail: true },
      answer({ y2026: 100 }, groups),
      labels,
      answer({ y2026: 100 }, lines),
    );
    expect(table.columns.map((column) => [column.key, column.header, column.kind])).toEqual([
      ['group', 'Domain', 'text'],
      ['count', 'Lines', 'count'],
      ['reference', 'Ref', 'text'],
      ['nature', 'Nature', 'text'],
      ['2026', '2026', 'amount'],
      ['share_2026', 'Share of total 2026', 'percent'],
    ]);
    expect(table.rows.map((rowData) => [rowData.group, rowData.level, rowData.count, rowData.reference, rowData.nature])).toEqual([
      ['Cloud', 0, 2, undefined, undefined],
      ['Big line', 1, undefined, 'BL-12', 'OPEX'],
      ['Small line', 1, undefined, 'BL-13', 'CAPEX'],
      ['No value', 0, 1, undefined, undefined],
      ['No value line', 1, undefined, 'BL-14', 'OPEX'],
    ]);
    expect(table.rows[1].share_2026).toBe(40 / 60);
    expect(table.rows[2].share_2026).toBe(20 / 60);
    expect(table.rows[4].share_2026).toBe(1);
  });
});

describe('shortMonthNames', () => {
  it('names the months in the language asked, whatever the default locale', () => {
    expect(shortMonthNames('en')).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
    expect(shortMonthNames('de')[2]).toBe(new Intl.DateTimeFormat('de', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 2, 1))));
  });
});

describe('staffingTable', () => {
  const months = (values: Array<number | null>) => Object.fromEntries(values.map((value, i) => [`m${String(i + 1).padStart(2, '0')}`, value]));
  const twelve = (value: number | null) => Array(12).fill(value) as Array<number | null>;
  const group = { groupHeader: 'Cost center', groupLabels: { none: 'No cost center', unnamed: 'Unnamed value' }, compare: new Intl.Collator('en').compare };

  it('lists the groups with a monthly FTE, largest average first then by label, the total as footer', () => {
    const table = staffingTable(group, answer(months([2, ...twelve(1).slice(1)]), [
      row(months(twelve(0.5)), ['b', 'Beta']),
      row(months(twelve(null)), ['c', 'Gamma']),
      row(months(twelve(0.5)), ['a', 'Alpha']),
      row(months([...twelve(null).slice(1), 1.2]), [null, null]),
    ]), labels);
    expect(table.columns.map((column) => [column.key, column.header, column.kind])).toEqual([
      ['group', 'Cost center', 'text'],
      ...labels.monthNames.map((name, i) => [`m${i + 1}`, name, 'number']),
      ['average', 'Average', 'number'],
      ['peak', 'Peak', 'number'],
    ]);
    expect(table.rows.map((r) => [r.group, r.groupKey, r.groupName, r.average, r.peak])).toEqual([
      ['Alpha', 'a', 'Alpha', 0.5, 0.5],
      ['Beta', 'b', 'Beta', 0.5, 0.5],
      ['No cost center', '', null, 1.2 / 12, 1.2],
    ]);
    expect(table.rows[2].m1).toBeNull();
    expect(table.footer).toEqual([{ group: 'Total', ...Object.fromEntries([2, ...twelve(1).slice(1)].map((value, i) => [`m${i + 1}`, value])), average: 13 / 12, peak: 2 }]);
  });
});

describe('costPerFteTable', () => {
  const group = { groupHeader: 'Supplier', groupLabels: { none: 'No supplier', unnamed: 'Unnamed value' }, compare: new Intl.Collator('en').compare };
  const columns = distinctColumns([{ year: 2026, metric: 'budget' }, { year: 2025, metric: 'landing' }, { year: 2025, metric: 'budget' }, { year: 2026, metric: 'budget' }]);

  it('sorts and dedupes the pairs, by year then in column order', () => {
    expect(columns).toEqual([{ year: 2025, metric: 'budget' }, { year: 2025, metric: 'landing' }, { year: 2026, metric: 'budget' }]);
  });

  it('flattens each pair into three headed columns, the ratio of the totals in the footer', () => {
    const pair = (fte: number | null, cost: number) => ({ fte, cost });
    const results = [
      answer(pair(3, 300), [row(pair(1, 100), ['a', 'Acme']), row(pair(2, 200), ['g', 'Globex'])]),
      answer(pair(null, 0), [row(pair(null, 0), ['a', 'Acme'])]),
      answer(pair(4, 500), [row(pair(4, 500), ['a', 'Acme'])]),
    ];
    const table = costPerFteTable({ ...group, view: 'fte', columns }, results, labels);
    expect(table.columns.map((column) => [column.key, column.header, column.kind])).toEqual([
      ['group', 'Supplier', 'text'],
      ['c0_fte', 'FTE (Budget 2025)', 'number'], ['c0_cost', 'Staff cost (Budget 2025)', 'amount'], ['c0_ratio', 'Cost per FTE (Budget 2025)', 'amount'],
      ['c1_fte', 'FTE (Landing 2025)', 'number'], ['c1_cost', 'Staff cost (Landing 2025)', 'amount'], ['c1_ratio', 'Cost per FTE (Landing 2025)', 'amount'],
      ['c2_fte', 'FTE (Budget 2026)', 'number'], ['c2_cost', 'Staff cost (Budget 2026)', 'amount'], ['c2_ratio', 'Cost per FTE (Budget 2026)', 'amount'],
    ]);
    expect(table.rows.map((r) => [r.group, r.c0_fte, r.c0_ratio, r.c1_fte, r.c2_ratio])).toEqual([['Globex', 2, 100, null, null], ['Acme', 1, 100, null, 125]]);
    expect(table.footer).toEqual([{ group: 'Total', c0_fte: 3, c0_cost: 300, c0_ratio: 100, c1_fte: null, c1_cost: null, c1_ratio: null, c2_fte: 4, c2_cost: 500, c2_ratio: 125 }]);
  });

  it('reads days, day cost and daily rate in the rate view', () => {
    const results = [answer({ days: 10, cost: 5000, staff: 5000 }, [row({ days: 10, cost: 5000 }, [null, null])])];
    const table = costPerFteTable({ ...group, view: 'rate', columns: [{ year: 2026, metric: 'budget' }] }, results, labels);
    expect(table.columns.map((column) => column.header)).toEqual(['Supplier', 'Days (Budget 2026)', 'Day cost (Budget 2026)', 'Daily rate (Budget 2026)']);
    expect(table.rows).toEqual([{ group: 'No supplier', groupKey: '', groupName: null, c0_days: 10, c0_cost: 5000, c0_rate: 500 }]);
  });
});
