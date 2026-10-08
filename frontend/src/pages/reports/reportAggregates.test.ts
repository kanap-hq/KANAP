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
  fteNoticeRequest,
  ftePresenceRequest,
  keepValues,
  localAmountField,
  METRIC_SUFFIX,
  NO_ANALYTICS_VALUE,
  NO_CONSOLIDATION_LINE,
  NO_LINE,
  readAccountIdOptions,
  readAnalytics,
  readColumnsCompare,
  readConsolidation,
  readDelta,
  readDeltaYears,
  readStaffing,
  readFteNotice,
  readFtePresence,
  readTopItems,
  readTrend,
  reportFilterModels,
  staffingChartSeries,
  staffingRequest,
  sumDeclared,
  topItemsRequest,
  topLimit,
  trendRequest,
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

  it('Consolidation: an excluded "unassigned" leaves out the lines without a consolidation line', () => {
    const request = consolidationRequest({ years: [2026], metric: 'budget' as any, excludedAccountIds: ['a1', NO_CONSOLIDATION_LINE], filters: {} });
    expect(request.query.filters).toEqual({ account_id: dropValues(['a1']), account_consolidation_key: dropValues([null]) });
    expect(consolidationRequest({ years: [2026], metric: 'budget' as any, excludedAccountIds: [NO_CONSOLIDATION_LINE], filters: {} }).query.filters)
      .toEqual({ account_consolidation_key: dropValues([null]) });
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

describe('the FTE measure', () => {
  const fteRow = (keys: Array<string | null>, values: Record<string, number | null>, count = 1, unknown: Record<string, number> = {}): AggregateRow => ({ keys, count, values, unknown });

  it('asks the same amounts as before without a measure, or with the amount measure', () => {
    const params = { scope: 'opex' as const, year: 2026, metric: 'budget' as const, topCount: 5, excludedIds: [], excludedAccounts: [], filters: {} };
    expect(topItemsRequest({ ...params, measure: 'amount' })).toEqual(topItemsRequest(params));
    expect(JSON.stringify(topItemsRequest(params).spec.measures)).toBe('[{"id":"value","fn":"sum","field":"y2026Budget"}]');
    const trend = { years: [2025, 2026], metrics: ['budget' as const], windowYears: [2025, 2026], filters: {} };
    expect(trendRequest({ ...trend, measure: 'amount' })).toEqual(trendRequest(trend));
    expect(fteNoticeRequest(topItemsRequest(params))).toBeNull();
  });

  it('Top items: sums the declared FTE and reads the detached FTE on the same request', () => {
    const request = topItemsRequest({
      scope: 'opex', year: 2026, metric: 'revision', topCount: 10, excludedIds: [], excludedAccounts: [], filters: {}, measure: 'fte',
    });
    expect(request.spec.measures).toEqual([
      { id: 'value', fn: 'sum', field: 'fte_y2026Revision' },
      { id: 'detached_revision_2026', fn: 'sum', field: 'fte_detached_y2026Revision' },
    ]);
    expect(request.spec.order).toEqual([{ by: 'measure', id: 'value', dir: 'DESC' }]);
    // The notice rides on the report's own answer: no second request.
    expect(fteNoticeRequest(request)).toBeNull();
  });

  it('Top items: leaves out the lines without a declared FTE, and a total nobody declares is blank', () => {
    const read = readTopItems(result([fteRow(['a', 'A'], { value: 2.5 }), fteRow(['b', 'B'], { value: null })], fteRow([], { value: 2.5 }, 4, { value: 3 })), 'fte');
    expect(read.processed).toEqual([{ id: 'a', name: 'A', value: 2.5, pct_of_total: 100 }]);
    expect(read.totalMetric).toBe(2.5);
    expect(readTopItems(result([], fteRow([], { value: null }, 4, { value: 4 })), 'fte').totalMetric).toBeNull();
    // The top's sum: blank when no shown line declares FTE, like the total; amounts still read 0.
    expect(read.topSelectionTotal).toBe(2.5);
    expect(readTopItems(result([fteRow(['b', 'B'], { value: null })], fteRow([], { value: null }, 1, { value: 1 })), 'fte').topSelectionTotal).toBeNull();
    expect(readTopItems(result([], row([], { value: 0 }))).topSelectionTotal).toBe(0);
  });

  it('sums declared values only, blank when none is declared', () => {
    expect(sumDeclared([null, 0.1, undefined, 0.2])).toBe(0.3);
    expect(sumDeclared([null, undefined])).toBeNull();
    expect(sumDeclared([])).toBeNull();
    expect(sumDeclared([0])).toBe(0);
  });

  it('Top increase / decrease: FTE minus FTE, with the detached FTE of both columns', () => {
    const [up] = deltaRequests({
      scope: 'capex',
      source: { year: 2025, metric: 'budget' },
      destination: { year: 2026, metric: 'budget' },
      modes: ['increase'],
      topCount: 10,
      excludedIds: [],
      excludedAccounts: [],
      filters: {},
      measure: 'fte',
    });
    expect(up.spec.measures).toEqual([
      { id: 'prev', fn: 'sum', field: 'fte_y2025Budget' },
      { id: 'curr', fn: 'sum', field: 'fte_y2026Budget' },
      { id: 'delta', fn: 'sum', field: 'fte_y2026Budget', minus: 'fte_y2025Budget' },
      { id: 'up', fn: 'sum', field: 'fte_y2026Budget', minus: 'fte_y2025Budget', part: 'positive' },
      { id: 'down', fn: 'sum', field: 'fte_y2026Budget', minus: 'fte_y2025Budget', part: 'negative' },
      { id: 'detached_budget_2025', fn: 'sum', field: 'fte_detached_y2025Budget' },
      { id: 'detached_budget_2026', fn: 'sum', field: 'fte_detached_y2026Budget' },
    ]);
    expect(up.spec.having).toEqual([{ measure: 'delta', op: 'gt', value: 0 }]);
  });

  it('Top increase / decrease: a side without a declared FTE stays blank, and so do totals nobody declares', () => {
    const read = readDelta(['increase'], [result([fteRow(['b', 'B'], { prev: null, curr: 1.25, delta: 1.25 })], fteRow([], { prev: null, curr: 1.25, delta: 1.25, up: 1.25, down: 0 }, 3))], 'fte');
    expect(read.processed).toEqual([{ id: 'b', name: 'B', previous: null, current: 1.25, delta: 1.25, pct_increase: null, direction: 'increase' }]);
    expect(read.allTotals).toEqual({ grossIncrease: 1.25, grossDecrease: 0, net: 1.25 });
    const none = readDelta(['increase'], [result([], fteRow([], { prev: null, curr: null, delta: null, up: null, down: null }, 3))], 'fte');
    expect(none.allTotals).toEqual({ grossIncrease: null, grossDecrease: null, net: null });
  });

  it('per year groups: keep the groups that declare FTE in one of the years, a year nobody declares blank', () => {
    const request = analyticsRequest({ axisId: null, years: [2026, 2027], metric: 'budget', excludedIds: [], filters: {}, measure: 'fte' });
    expect(request.spec.measures.map((m) => [m.id, m.field])).toEqual([
      ['y2026', 'fte_y2026Budget'],
      ['y2027', 'fte_y2027Budget'],
      ['detached_budget_2026', 'fte_detached_y2026Budget'],
      ['detached_budget_2027', 'fte_detached_y2027Budget'],
    ]);
    const read = readConsolidation([2026, 2027], result([
      fteRow(['c_600', 'IT'], { y2026: 3, y2027: null }),
      fteRow(['c_700', 'HR'], { y2026: null, y2027: null }),
      fteRow([null, null], { y2026: null, y2027: 0.5 }),
    ], fteRow([], { y2026: 3, y2027: 0.5 })), 'Unassigned', 'fte');
    expect(read.groups).toEqual([
      { key: 'c_600', label: 'IT', values: { 2026: 3, 2027: null } },
      { key: 'unassigned', label: 'Unassigned', values: { 2026: null, 2027: 0.5 } },
    ]);
    expect(read.totals).toEqual({ 2026: 3, 2027: 0.5 });
    expect(readAnalytics([2026], result([fteRow(['v', 'V'], { y2026: null })], fteRow([], { y2026: null })), { unassigned: 'U', unnamed: 'N' }, 'fte'))
      .toEqual({ groups: [], totals: { 2026: null } });
  });

  it('asks the notice on its own, over the same lines, when it does not fit in a grouped request', () => {
    const years = [2024, 2025, 2026, 2027, 2028];
    const request = consolidationRequest({ years, metric: 'landing', excludedAccountIds: [], filters: { run_build: keepValues(['run']) }, measure: 'fte' });
    // Five years and five notice measures would pass the 8 measures of a grouped request.
    expect(request.spec.measures.map((m) => m.id)).toEqual(['y2024', 'y2025', 'y2026', 'y2027', 'y2028']);
    const notice = fteNoticeRequest(request);
    expect(notice).toEqual({
      query: request.query,
      spec: { groupBy: [], measures: years.map((year) => ({ id: `detached_landing_${year}`, fn: 'sum', field: `fte_detached_y${year}Landing` })) },
    });
  });

  it('Trends and columns: blank for a year and column nobody declares; the notice in the same total', () => {
    const request = trendRequest({ years: [2026, 2027], metrics: ['budget', 'landing'], windowYears: [2024, 2025, 2026, 2027, 2028], filters: {}, measure: 'fte' });
    expect(request.spec.measures).toHaveLength(8);
    expect(request.spec.measures[0]).toEqual({ id: 'budget_2026', fn: 'sum', field: 'fte_y2026Budget' });
    expect(fteNoticeRequest(request)).toBeNull();
    const total = fteRow([], { budget_2026: 4, budget_2027: null, landing_2026: 1, landing_2027: null });
    expect(readTrend({ years: [2026, 2027], metrics: ['budget', 'landing'] }, result([], total), 'fte')).toEqual({
      budget: { 2026: 4, 2027: null },
      landing: { 2026: 1, 2027: null },
    });
    const selections = [{ year: 2026, metric: 'budget' as const }, { year: 2027, metric: 'budget' as const }];
    const compare = columnsCompareRequest({ selections, filters: {}, measure: 'fte' });
    expect(compare.spec.measures.map((m) => m.field)).toEqual(['fte_y2026Budget', 'fte_y2027Budget', 'fte_detached_y2026Budget', 'fte_detached_y2027Budget']);
    expect(readColumnsCompare(selections, result([], total), 'fte')).toEqual([4, null]);
  });

  it('reads the notice: the detached FTE and the lines declaring it, only for the columns concerned', () => {
    const request = trendRequest({ years: [2026, 2027], metrics: ['budget', 'revision'], windowYears: [2026, 2027], filters: {}, measure: 'fte' });
    const total = fteRow([], {
      detached_budget_2026: 3.5, detached_budget_2027: null, detached_revision_2026: 0, detached_revision_2027: 0.5,
    }, 10, { detached_budget_2026: 6, detached_budget_2027: 10, detached_revision_2026: 9, detached_revision_2027: 9 });
    expect(readFteNotice(request, result([], total))).toEqual([
      { year: 2026, metric: 'budget', fte: 3.5, items: 4 },
      { year: 2027, metric: 'revision', fte: 0.5, items: 1 },
    ]);
    expect(readFteNotice(request, undefined)).toEqual([]);
    expect(readFteNotice(topItemsRequest({ scope: 'opex', year: 2026, metric: 'budget', topCount: 1, excludedIds: [], excludedAccounts: [], filters: {} }), result([], total))).toEqual([]);
  });

  it('"Items with FTE": keeps the lines that declare FTE, and tells whether the window holds one', () => {
    expect(reportFilterModels({ costCenterIds: null, runBuild: 'run', analytics: [], withFte: true })).toEqual({
      run_build: keepValues(['run']),
      has_fte: keepValues(['yes']),
    });
    expect(reportFilterModels({ costCenterIds: null, runBuild: null, analytics: [], withFte: false })).toEqual({});
    expect(ftePresenceRequest([2025, 2026])).toEqual({ query: { years: '2025,2026' }, spec: { groupBy: ['has_fte'], measures: [] } });
    expect(readFtePresence(result([row([null], {})], row([], {})))).toBe(false);
    expect(readFtePresence(result([row([null], {}), row(['yes'], {})], row([], {})))).toBe(true);
    expect(readFtePresence(undefined)).toBe(false);
  });
});

describe('staffing by month', () => {
  const months = (values: Array<number | null>) => Object.fromEntries(values.map((value, i) => [`m${String(i + 1).padStart(2, '0')}`, value]));
  const staffRow = (keys: Array<string | null>, values: Record<string, number | null>, count = 1, unknown: Record<string, number> = {}): AggregateRow => ({ keys, count, values, unknown });
  const labels = { none: 'No cost center', unnamed: 'Unnamed value' };
  const flat = (value: number | null) => Array.from({ length: 12 }, () => value);

  it('groups by cost center, item, supplier or a dimension, with the twelve months and the two notices', () => {
    const base = { year: 2026, metric: 'revision' as const, filters: { run_build: keepValues(['run']) } };
    const request = staffingRequest({ ...base, scope: 'opex', group: { kind: 'costCenter' } });
    expect(request.query).toEqual({ filters: { run_build: keepValues(['run']) } });
    expect(request.spec.groupBy).toEqual(['cost_center_id', 'cost_center_label']);
    expect(request.spec.measures).toHaveLength(14);
    expect(request.spec.measures[0]).toEqual({ id: 'm01', fn: 'sum', field: 'fte_month_01_y2026Revision' });
    expect(request.spec.measures[11]).toEqual({ id: 'm12', fn: 'sum', field: 'fte_month_12_y2026Revision' });
    expect(request.spec.measures.slice(12)).toEqual([
      { id: 'detached', fn: 'sum', field: 'fte_detached_y2026Revision' },
      { id: 'nodetail', fn: 'sum', field: 'fte_nodetail_y2026Revision' },
    ]);
    // Every group comes back: the reader drops the ones without monthly FTE.
    expect(request.spec.having).toBeUndefined();
    expect(staffingRequest({ ...base, scope: 'opex', group: { kind: 'item' } }).spec.groupBy).toEqual(['id', 'product_name']);
    expect(staffingRequest({ ...base, scope: 'capex', group: { kind: 'item' } }).spec.groupBy).toEqual(['id', 'description']);
    expect(staffingRequest({ ...base, scope: 'opex', group: { kind: 'supplier' } }).spec.groupBy).toEqual(['supplier_id', 'supplier_name']);
    expect(staffingRequest({ ...base, scope: 'opex', group: { kind: 'axis', axisId: 'ax-1' } }).spec.groupBy).toEqual(['analytics_id_ax-1', 'analytics_ax-1']);
  });

  it('drops the groups without a monthly FTE, sorts by average, and reads average, peak, total and notices', () => {
    const read = readStaffing(result([
      staffRow(['cc-1', 'CC1 · Small'], months([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])),
      staffRow(['cc-2', 'CC2 · Ramp'], months([0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2])),
      staffRow(['cc-3', 'CC3 · None'], months(flat(null))),
      staffRow([null, null], months([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 3.5])),
    ], staffRow([], { ...months([1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 3.5, 3.5, 3.5, 3.5, 3.5, 6.5]), detached: 1.25, nodetail: 0.75 }, 9, { detached: 7, nodetail: 8 })), labels, compare);
    expect(read.rows.map((r) => [r.label, r.average, r.peak])).toEqual([
      ['CC1 · Small', 1, 1],
      ['CC2 · Ramp', 1, 2],
      ['No cost center', 0.75, 3.5],
    ]);
    expect(read.rows[0].months).toEqual(flat(1));
    // The average of the totals is the sum of the groups' averages: 1 + 1 + 0.75.
    expect(read.total.average).toBeCloseTo(2.75);
    expect(read.total.peak).toBe(6.5);
    // The line without monthly detail (0.75) is detached too: the detached notice keeps the other one.
    expect(read.detached).toEqual({ fte: 0.5, items: 1 });
    expect(read.noDetail).toEqual({ fte: 0.75, items: 1 });
  });

  it('shows no notice at zero or blank, and a blank total without any monthly FTE', () => {
    const read = readStaffing(result([], staffRow([], { ...months(flat(null)), detached: 0, nodetail: null }, 3, { detached: 2, nodetail: 3 })), labels, compare);
    expect(read.rows).toEqual([]);
    expect(read.total).toEqual({ months: flat(null), average: null, peak: null });
    expect(read.detached).toBeNull();
    expect(read.noDetail).toBeNull();
    expect(readStaffing(undefined, labels, compare).total.average).toBeNull();
  });

  it('shows no detached notice when every detached line is one without monthly detail', () => {
    const notices = (detached: number, nodetail: number, unknown: Record<string, number>) => {
      const read = readStaffing(result([], staffRow([], { ...months(flat(null)), detached, nodetail }, 5, unknown)), labels, compare);
      return [read.detached, read.noDetail];
    };
    expect(notices(0.75, 0.75, { detached: 3, nodetail: 3 })).toEqual([null, { fte: 0.75, items: 2 }]);
    // A rounding below zero reads as none, never as a negative notice.
    expect(notices(0.3, 0.30000000000000004, { detached: 3, nodetail: 3 })).toEqual([null, { fte: 0.30000000000000004, items: 2 }]);
    // Without any line lacking monthly detail, the detached notice is the whole detached sum.
    expect(notices(1.5, 0, { detached: 2, nodetail: 5 })).toEqual([{ fte: 1.5, items: 3 }, null]);
  });

  it('names a dimension value without a name, and charts the eight largest groups and the rest as others', () => {
    const groups = Array.from({ length: 10 }, (_, i) => staffRow([`v${i}`, i === 0 ? ' ' : `V${i}`], months(flat(10 - i))));
    const read = readStaffing(result(groups, staffRow([], {})), labels, compare);
    expect(read.rows[0].label).toBe('Unnamed value');
    const chart = staffingChartSeries(read.rows);
    expect(chart.series.map((r) => r.label)).toEqual(['Unnamed value', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7']);
    // V8 (2) + V9 (1) each month.
    expect(chart.others).toEqual(flat(3));
    expect(staffingChartSeries(read.rows.slice(0, 8)).others).toBeNull();
  });
});
