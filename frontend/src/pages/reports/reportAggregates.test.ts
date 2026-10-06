import { describe, expect, it } from 'vitest';
import { AMOUNT_COLUMNS } from '../../components/finance/amountColumns';
import {
  accountLabelOptions,
  amountField,
  analyticsRequest,
  columnsCompareRequest,
  consolidationRequest,
  deltaRequests,
  dropValues,
  excludedAccountValues,
  keepValues,
  localAmountField,
  METRIC_SUFFIX,
  NO_ANALYTICS_VALUE,
  NO_LINE,
  readAccountIdOptions,
  readAnalytics,
  readColumnsCompare,
  readConsolidation,
  readDelta,
  readDeltaYears,
  readTopItems,
  topItemsRequest,
  topLimit,
  withFilter,
  type AggregateResult,
  type AggregateRow,
} from './reportAggregates';

const compare = (a: string, b: string) => a.localeCompare(b);
const row = (keys: Array<string | null>, values: Record<string, number>, count = 1): AggregateRow => ({ keys, count, values, unknown: {} });
const result = (groups: AggregateRow[], total: AggregateRow): AggregateResult => ({ groups, others: null, total, groupCount: groups.length, reportingCurrency: 'EUR' });

describe('fields', () => {
  it('name each budget column as the list does (AMOUNT_COLUMNS suffixes)', () => {
    expect(METRIC_SUFFIX).toEqual(Object.fromEntries(AMOUNT_COLUMNS.map((column) => [column.key, column.suffix])));
    expect(amountField(2027, 'follow_up')).toBe('y2027FollowUp');
    expect(localAmountField(2027, 'budget')).toBe('local_y2027Budget');
  });
});

describe('filters', () => {
  it('keeps both models on a key filtered twice, every condition applying', () => {
    const once = withFilter({}, 'analytics_id_a', keepValues(['v1']));
    expect(once).toEqual({ analytics_id_a: { filterType: 'set', values: ['v1'] } });
    const twice = withFilter(once, 'analytics_id_a', dropValues(['v2']));
    expect(twice.analytics_id_a).toEqual({ operator: 'AND', conditions: [keepValues(['v1']), dropValues(['v2'])] });
    const thrice = withFilter(twice, 'analytics_id_a', dropValues(['v3']));
    expect((thrice.analytics_id_a as any).conditions).toHaveLength(3);
  });

  it('keeps no line under NO_LINE, whatever is added', () => {
    expect(NO_LINE).toEqual({ id: { filterType: 'set', values: [] } });
    expect(withFilter(NO_LINE, 'id', dropValues(['x'])).id).toEqual({ operator: 'AND', conditions: [keepValues([]), dropValues(['x'])] });
  });
});

describe('top items', () => {
  it('asks the top lines by the column of the year, without the exclusions', () => {
    const request = topItemsRequest({
      scope: 'capex', year: 2026, metric: 'budget', topCount: 3.7, excludedIds: ['i1'], excludedAccounts: ['6100 - Software '], filters: { run_build: keepValues(['run']) },
    });
    expect(request).toEqual({
      query: { filters: { run_build: keepValues(['run']), id: dropValues(['i1']), account_display: dropValues(['6100 - Software ']) } },
      spec: { groupBy: ['id', 'description'], measures: [{ id: 'value', fn: 'sum', field: 'y2026Budget' }], order: [{ by: 'measure', id: 'value', dir: 'DESC' }], limit: 3 },
    });
    expect(topLimit(0)).toBe(1);
    expect(topLimit(1e9)).toBe(10_000);
  });

  it('reads the shares of the total, the top selection summed in cents', () => {
    const read = readTopItems(result([row(['a', 'A'], { value: 0.1 }), row(['b', null], { value: 0.2 })], row([], { value: 0.6 }, 5)));
    expect(read.processed).toEqual([
      { id: 'a', name: 'A', value: 0.1, pct_of_total: 17 },
      { id: 'b', name: '', value: 0.2, pct_of_total: 33 },
    ]);
    expect(read.totalMetric).toBe(0.6);
    expect(read.topSelectionTotal).toBe(0.3);
    expect(readTopItems(undefined)).toEqual({ processed: [], totalMetric: 0, topSelectionTotal: 0 });
  });
});

describe('increases and decreases', () => {
  const params = {
    scope: 'opex' as const,
    source: { year: 2025, metric: 'budget' as const },
    destination: { year: 2026, metric: 'landing' as const },
    modes: ['increase', 'decrease'] as const,
    topCount: 10,
    excludedIds: [],
    excludedAccounts: [],
    filters: {},
  };

  it('asks one aggregate per direction, gross parts and net over every line', () => {
    const [up, down] = deltaRequests(params);
    expect(up.spec.measures).toEqual([
      { id: 'prev', fn: 'sum', field: 'y2025Budget' },
      { id: 'curr', fn: 'sum', field: 'y2026Landing' },
      { id: 'delta', fn: 'sum', field: 'y2026Landing', minus: 'y2025Budget' },
      { id: 'up', fn: 'sum', field: 'y2026Landing', minus: 'y2025Budget', part: 'positive' },
      { id: 'down', fn: 'sum', field: 'y2026Landing', minus: 'y2025Budget', part: 'negative' },
    ]);
    expect(up.spec.having).toEqual([{ measure: 'delta', op: 'gt', value: 0 }]);
    expect(up.spec.order).toEqual([{ by: 'measure', id: 'delta', dir: 'DESC' }]);
    expect(down.spec.having).toEqual([{ measure: 'delta', op: 'lt', value: 0 }]);
    expect(down.spec.order).toEqual([{ by: 'measure', id: 'delta', dir: 'ASC' }]);
  });

  it('reads the lines of each direction with their share of change, and the totals', () => {
    const total = row([], { prev: 0, curr: 0, delta: 50, up: 150, down: -100 }, 9);
    const read = readDelta(['increase', 'decrease'], [
      result([row(['a', 'A'], { prev: 100, curr: 250, delta: 150 })], total),
      result([row(['b', 'B'], { prev: 0, curr: -100, delta: -100 })], total),
    ]);
    expect(read.processed).toEqual([
      { id: 'a', name: 'A', previous: 100, current: 250, delta: 150, pct_increase: 150, direction: 'increase' },
      { id: 'b', name: 'B', previous: 0, current: -100, delta: -100, pct_increase: null, direction: 'decrease' },
    ]);
    expect(read.allTotals).toEqual({ grossIncrease: 150, grossDecrease: 100, net: 50 });
  });

  it('offers Y-2 and Y+2 only when a line holds a version then, and no year without a line', () => {
    const Y = 2026;
    expect(readDeltaYears(result([], row([], {}, 0)), Y)).toEqual([]);
    expect(readDeltaYears(result([row([null, null], {})], row([], {}, 3)), Y)).toEqual([2025, 2026, 2027]);
    expect(readDeltaYears(result([row(['yes', null], {}), row([null, 'yes'], {})], row([], {}, 3)), Y)).toEqual([2024, 2025, 2026, 2027, 2028]);
  });
});

describe('per year groups', () => {
  it('Consolidation: by the server key and label, unassigned without one, the totals from the server', () => {
    const request = consolidationRequest({ years: [2026, 2027], metric: 'budget', excludedAccountIds: ['acc'], filters: {} });
    expect(request.query.filters).toEqual({ account_id: dropValues(['acc']) });
    expect(request.spec.groupBy).toEqual(['account_consolidation_key', 'account_consolidation_label']);
    expect(request.spec.order).toEqual([{ by: 'measure', id: 'y2026', dir: 'DESC' }]);
    const read = readConsolidation([2026, 2027], result([row(['c_600', '[600] IT'], { y2026: 5, y2027: 6 }), row([null, null], { y2026: 1, y2027: 0 })], row([], { y2026: 6, y2027: 6 })), 'Unassigned');
    expect(read).toEqual({
      groups: [
        { key: 'c_600', label: '[600] IT', values: { 2026: 5, 2027: 6 } },
        { key: 'unassigned', label: 'Unassigned', values: { 2026: 1, 2027: 0 } },
      ],
      totals: { 2026: 6, 2027: 6 },
    });
  });

  it('Analytics: by value, unnamed for a blank name, unassigned without a value', () => {
    const read = readAnalytics([2026], result([row(['v1', ' '], { y2026: 3 }), row([null, null], { y2026: 2 })], row([], { y2026: 5 })), { unassigned: 'U', unnamed: 'N' });
    expect(read.groups).toEqual([
      { key: 'cat_v1', label: 'N', values: { 2026: 3 } },
      { key: 'uncategorized', label: 'U', values: { 2026: 2 } },
    ]);
  });

  it('Analytics: an excluded "unassigned" leaves out the lines without a value', () => {
    const request = analyticsRequest({ axisId: 'a1', years: [2026], metric: 'budget' as any, excludedIds: ['v1', NO_ANALYTICS_VALUE], filters: {} });
    expect(request.query.filters).toEqual({ analytics_id_a1: dropValues(['v1', null]) });
    expect(analyticsRequest({ axisId: null, years: [2026], metric: 'budget' as any, excludedIds: [], filters: {} }).query.filters).toEqual({});
  });
});

describe('budget column comparison', () => {
  it('asks each year and column once and reads each selection, a repeat included', () => {
    const selections = [{ year: 2026, metric: 'budget' as const }, { year: 2026, metric: 'budget' as const }, { year: 2025, metric: 'landing' as const }];
    const request = columnsCompareRequest({ selections, filters: {} });
    expect(request.query.years).toBe('2025,2026');
    expect(request.spec.measures.map((m) => m.id)).toEqual(['budget_2026', 'landing_2025']);
    expect(readColumnsCompare(selections, result([], row([], { budget_2026: 7, landing_2025: 3 })))).toEqual([7, 7, 3]);
  });
});

describe('pickers', () => {
  it('one account label option per trimmed label, every label the lines hold left out with it', () => {
    const options = accountLabelOptions(['6100 - Software ', null, '6100 - Software', '5000 - Hardware', ''], compare);
    expect(options).toEqual([
      { id: '5000 - Hardware', name: '5000 - Hardware', values: ['5000 - Hardware'] },
      { id: '6100 - Software', name: '6100 - Software', values: ['6100 - Software ', '6100 - Software'] },
    ]);
    expect(excludedAccountValues(['6100 - Software'], options)).toEqual(['6100 - Software ', '6100 - Software']);
  });

  it('labels accounts by number and name', () => {
    const options = readAccountIdOptions(result([
      row(['a1', '6100', ' Software '], {}),
      row(['a2', '200', null], {}),
      row([null, null, null], {}),
    ], row([], {})), 'Unnamed', compare);
    expect(options).toEqual([{ id: 'a2', label: '[200]' }, { id: 'a1', label: '[6100] Software' }]);
  });
});
