import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { AMOUNT_COLUMNS } from '../../components/finance/amountColumns';
import type { AnalyticsAxis } from '../../services/analytics';

vi.mock('react-i18next', () => {
  const t = (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key);
  const translation = { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../hooks/useBudgetColumns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useBudgetColumns')>();
  const state = await import('./budgetColumnsTestState');
  return { ...actual, useBudgetColumns: () => state.mockedBudgetColumns(actual.resolveBudgetColumns) };
});
vi.mock('../../hooks/useCostCenterTree', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useCostCenterTree')>();
  return { ...actual, useCostCenterTree: () => actual.buildCostCenterTree([], true) };
});
const axesState = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('../../hooks/useAnalyticsAxes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useAnalyticsAxes')>();
  const { useMemo } = await import('react');
  const t = ((key: string) => (key === 'master-data:analytics.analyticsCategoryFallback' ? 'Analytics dimension' : key)) as unknown as TFunction;
  return {
    ...actual,
    useAnalyticsAxes: () => {
      const list = axesState.list;
      return useMemo(() => actual.buildAnalyticsAxes(list as AnalyticsAxis[], t), [list]);
    },
  };
});
vi.mock('../../components/reports/ReportLayout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/reports/ReportLayout')>()),
  default: ({ filters, children, onExportTableCsv }: { filters?: React.ReactNode; children?: React.ReactNode; onExportTableCsv?: () => void }) => (
    <div>
      <button type="button" onClick={onExportTableCsv}>export-csv</button>
      <div data-testid="filters">{filters}</div>
      {children}
    </div>
  ),
}));
const chart = vi.hoisted(() => ({ options: null as any }));
vi.mock('../../components/reports/ChartCard', () => ({
  default: React.forwardRef(({ options }: { options: unknown }, _ref) => {
    chart.options = options;
    return null;
  }),
}));
const grid = vi.hoisted(() => ({ columns: [] as any[], pinned: [] as any[], api: null as null | { exportDataAsCsv: ReturnType<typeof vi.fn> } }));
vi.mock('../../components/reports/ReportGrid', () => ({
  default: (props: { rowData?: unknown[]; columnDefs?: any[]; pinnedBottomRowData?: any[]; onGridReady?: (e: { api: unknown }) => void }) => {
    grid.columns = props.columnDefs ?? [];
    grid.pinned = props.pinnedBottomRowData ?? [];
    React.useEffect(() => {
      const api = { exportDataAsCsv: vi.fn() };
      grid.api = api;
      props.onGridReady?.({ api });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <pre data-testid="grid">{JSON.stringify(props.rowData ?? [])}</pre>;
  },
}));

import api from '../../api';
import { fakeAggregate, fakeFilterValues } from '../../test/fakeBudgetAggregate';
import { setBudgetColumns } from './budgetColumnsTestState';
import CostPerFteReport, { MAX_COLUMNS } from './CostPerFteReport';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;
const Y = new Date().getFullYear();

/** The same value in every budget column, so the tests hold whatever column the report starts on. */
const everyColumn = <T,>(value: T) => Object.fromEntries(AMOUNT_COLUMNS.map((column) => [column.key, value]));
const flat = (value: number) => Array.from({ length: 12 }, () => value);

/**
 * One year of a line: its staff lines' FTE and cost, the declared FTE, how its amount was set, its monthly
 * detail; the days its per-day lines buy and their cost (none: no per-day line).
 */
type Staff = { staffFte: number | null; cost: number; fte: number; method?: string; detail?: boolean; days?: number; dayCost?: number };
function version(year: number, staff: Staff) {
  return {
    year,
    totals: everyColumn(0),
    staff_cost: everyColumn(staff.cost),
    day_cost: everyColumn(staff.dayCost ?? 0),
    ...(staff.staffFte != null ? { staff_fte: everyColumn(staff.staffFte) } : {}),
    ...(staff.days != null ? { days: everyColumn(staff.days) } : {}),
    fte: everyColumn(staff.fte),
    ...(staff.detail !== false ? { fte_months: everyColumn(flat(staff.fte)) } : {}),
    ...(staff.method ? { method: everyColumn(staff.method) } : {}),
  };
}
function line(id: string, costCenter: [string, string] | null, supplier: [string, string] | null, previous: Staff | null, current: Staff | null) {
  return {
    id,
    product_name: `Line ${id}`,
    description: `Line ${id}`,
    cost_center_id: costCenter?.[0] ?? null,
    cost_center_label: costCenter?.[1] ?? null,
    supplier_id: supplier?.[0] ?? null,
    supplier_name: supplier?.[1] ?? null,
    analytics_value_ids: {},
    versions: {
      ...(previous ? { yMinus1: version(Y - 1, previous) } : {}),
      ...(current ? { y: version(Y, current) } : {}),
    } as Record<string, any>,
  };
}

// Last year: CC2 2 FTE for 160 000, CC1 1 FTE for 90 000. This year: CC1 a (1 FTE, 100 000) and b, spread
// since (1.5 FTE, 165 000: detached, with its lines' detail); CC2 2 FTE for 180 000; CC3 a line of 0 FTE;
// CC4 declares 3 FTE without line detail (a copy: detached too, never in the figures); CC5 no FTE.
// Per day: a 200 days both years (rate 450, then 500); b priced per month only (no days); c 400 days
// last year (rate 400), this year 360 days for 144 000 (rate 400) and 36 000 priced per month; d 0 days.
const ROWS = [
  line('a', ['cc1', 'CC1 · Ops'], ['s1', 'Acme'], { staffFte: 1, cost: 90000, fte: 1, days: 200, dayCost: 90000 }, { staffFte: 1, cost: 100000, fte: 1, days: 200, dayCost: 100000 }),
  line('b', ['cc1', 'CC1 · Ops'], ['s2', 'Globex'], null, { staffFte: 1.5, cost: 165000, fte: 1.5, method: 'spread' }),
  line('c', ['cc2', 'CC2 · Dev'], ['s1', 'Acme'], { staffFte: 2, cost: 160000, fte: 2, days: 400, dayCost: 160000 }, { staffFte: 2, cost: 180000, fte: 2, days: 360, dayCost: 144000 }),
  line('d', ['cc3', 'CC3 · Data'], null, null, { staffFte: 0, cost: 0, fte: 0, days: 0, dayCost: 0 }),
  line('e', ['cc4', 'CC4 · Copy'], ['s3', 'Initech'], null, { staffFte: null, cost: 0, fte: 3, method: 'copied', detail: false }),
  line('f', ['cc5', 'CC5 · Empty'], null, null, null),
];

let serverRows: ReturnType<typeof line>[] = ROWS;
let restoreCanvas: (() => void) | null = null;

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderReport(path = '/report') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={[path]}>
          <CostPerFteReport />
          <LocationProbe />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const gridRows = () => JSON.parse(screen.getByTestId('grid').textContent || '[]') as Array<Record<string, any>>;
/** The years and group keys of the last cost per FTE requests, one per pair. */
const reportCalls = () => post.mock.calls.map(([, body]) => body).filter((body) => body.spec.measures[0]?.field?.startsWith('staff_cost_'));
const askedYears = () => {
  const calls = reportCalls();
  const lastWindow = calls[calls.length - 1]?.query.years;
  return calls.filter((body) => body.query.years === lastWindow).map((body) => Number(/staff_cost_y(\d{4})/.exec(body.spec.measures[0].field)![1]));
};
const pairYears = () => screen.getAllByRole('combobox', { name: /^reports\.filters\.year \d$/ }).map((box) => Number(box.textContent));
const pick = async (combobox: string, option: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: combobox }));
  fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: option }));
};
const valueColumns = () => grid.columns.slice(1).flatMap((group: any) => group.children);
/** The bodies of the last daily rate requests, one per pair. */
const rateCalls = () => post.mock.calls.map(([, body]) => body).filter((body) => body.spec.measures[0]?.field?.startsWith('day_cost_'));

beforeEach(() => {
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  restoreCanvas = () => getContext.mockRestore();
  serverRows = ROWS;
  setBudgetColumns();
  axesState.list = [];
  chart.options = null;
  grid.columns = [];
  grid.pinned = [];
  grid.api = null;
  get.mockReset();
  get.mockImplementation(async (url: string, config?: { params?: Record<string, string> }) => {
    if (url.endsWith('/summary/filter-values')) return { data: fakeFilterValues(serverRows, String(config?.params?.fields ?? '').split(',')) };
    return { data: { items: [], total: 0 } };
  });
  post.mockReset();
  post.mockImplementation(async (url: string, body: any) => {
    if (url.endsWith('/summary/aggregate')) return { data: fakeAggregate(serverRows, body) };
    throw new Error(`unexpected POST ${url}`);
  });
});

afterEach(() => {
  restoreCanvas?.();
  restoreCanvas = null;
});

describe('Cost per FTE', () => {
  it('compares last year and this year of the default column, by cost center, with the ratio of the totals', async () => {
    renderReport();
    await waitFor(() => expect(gridRows().map((row) => row.group)).toEqual(['CC2 · Dev', 'CC1 · Ops', 'CC3 · Data']));
    expect(pairYears()).toEqual([Y - 1, Y]);
    expect(askedYears()).toEqual([Y - 1, Y]);
    const request = reportCalls()[0];
    expect(request.spec.groupBy).toEqual(['cost_center_id', 'cost_center_label']);
    expect(request.query.years).toBe(`${Y - 1},${Y}`);
    expect(request.spec.measures.map((measure: any) => measure.id)).toEqual(['cost', 'fte', 'detached', 'nodetail']);

    const [cc2, cc1, cc3] = gridRows();
    expect(cc2).toMatchObject({ c0_fte: 2, c0_cost: 160000, c0_ratio: 80000, c1_fte: 2, c1_cost: 180000, c1_ratio: 90000 });
    // CC1 this year: a and b (b's amount was spread, its cost is its lines' cost).
    expect(cc1).toMatchObject({ c0_fte: 1, c0_cost: 90000, c0_ratio: 90000, c1_fte: 2.5, c1_cost: 265000, c1_ratio: 106000 });
    // No staff last year: blank; 0 FTE this year: a row with a blank ratio.
    expect(cc3).toMatchObject({ c0_fte: null, c0_cost: null, c0_ratio: null, c1_fte: 0, c1_cost: 0, c1_ratio: null });

    // The ratio of the totals, never the average of the ratios.
    expect(grid.pinned).toHaveLength(1);
    expect(grid.pinned[0]).toMatchObject({ group: 'reports.columns.total', c0_fte: 3, c0_cost: 250000, c1_fte: 4.5, c1_cost: 445000 });
    expect(grid.pinned[0].c0_ratio).toBeCloseTo(250000 / 3);
    expect(grid.pinned[0].c1_ratio).toBeCloseTo(445000 / 4.5);
  });

  it('heads each pair with its column and year over FTE, staff cost and cost per FTE', async () => {
    renderReport();
    await waitFor(() => expect(gridRows()).toHaveLength(3));
    expect(grid.columns[0]).toMatchObject({ field: 'group', headerName: 'reports.staffing.groups.costCenter', flex: 1, tooltipField: 'group' });
    expect(grid.columns.slice(1).map((group: any) => group.headerName)).toEqual([expect.stringMatching(new RegExp(` ${Y - 1}$`)), expect.stringMatching(new RegExp(` ${Y}$`))]);
    expect(valueColumns().map((column: any) => [column.colId, column.headerName])).toEqual([
      ['c0_fte', 'reports.measure.fte'], ['c0_cost', 'reports.costPerFte.staffCost'], ['c0_ratio', 'reports.costPerFte.costPerFte'],
      ['c1_fte', 'reports.measure.fte'], ['c1_cost', 'reports.costPerFte.staffCost'], ['c1_ratio', 'reports.costPerFte.costPerFte'],
    ]);
    const [fte, cost, ratio] = valueColumns();
    expect(fte.valueFormatter({ value: 2.5 })).toBe('2.50');
    expect(cost.valueFormatter({ value: 265000 })).toBe('265 000');
    expect(ratio.valueFormatter({ value: 83333.33 })).toBe('83 333');
    expect(ratio.valueFormatter({ value: null })).toBe('');
    // Each kind shares one width, known before the grid lays out.
    for (const column of valueColumns()) {
      expect(column.width).toBeGreaterThan(0);
      expect(column.flex).toBeUndefined();
      expect(column.type).toBe('rightAligned');
    }
    expect(new Set(valueColumns().filter((column: any) => column.colId.endsWith('_cost')).map((column: any) => column.width)).size).toBe(1);
  });

  it('adds pairs up to four, chronologically, and removes them down to one', async () => {
    renderReport();
    await waitFor(() => expect(gridRows()).toHaveLength(3));
    const add = screen.getByRole('button', { name: 'reports.budgetColumnsCompare.addSelection' });
    fireEvent.click(add);
    await waitFor(() => expect(askedYears()).toEqual([Y - 1, Y, Y + 1]));
    expect(pairYears()).toEqual([Y - 1, Y, Y + 1]);
    fireEvent.click(add);
    await waitFor(() => expect(pairYears()).toHaveLength(MAX_COLUMNS));
    expect(add).toBeDisabled();
    expect(grid.columns).toHaveLength(1 + MAX_COLUMNS);

    // A year picked before the others shows first: the table and the requests stay chronological.
    await pick('reports.filters.year 4', String(Y - 2));
    await waitFor(() => expect(askedYears()).toEqual([Y - 2, Y - 1, Y, Y + 1]));
    expect(reportCalls()[reportCalls().length - 1].query.years).toBe(`${Y - 2},${Y - 1},${Y},${Y + 1}`);

    for (const index of [4, 3, 2]) fireEvent.click(screen.getByRole('button', { name: `common:buttons.remove ${index}` }));
    await waitFor(() => expect(pairYears()).toEqual([Y - 1]));
    expect(screen.getByRole('button', { name: 'common:buttons.remove 1' })).toBeDisabled();
    await waitFor(() => expect(askedYears()).toEqual([Y - 1]));
    await waitFor(() => expect(gridRows().map((row) => row.group)).toEqual(['CC2 · Dev', 'CC1 · Ops']));
  });

  it('groups as the staffing report does and keeps the grouping in the address', async () => {
    renderReport('/report?group=supplier');
    await waitFor(() => expect(gridRows().map((row) => row.group)).toEqual(['Acme', 'Globex', 'reports.staffing.none.supplier']));
    expect(reportCalls()[0].spec.groupBy).toEqual(['supplier_id', 'supplier_name']);
    await pick('reports.staffing.groupBy', 'reports.staffing.groups.item');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('?group=item'));
    await waitFor(() => expect(gridRows().map((row) => row.group)).toEqual(['Line c', 'Line a', 'Line b', 'Line d']));
    expect(grid.columns[0].headerName).toBe('reports.staffing.groups.item');

    fireEvent.click(screen.getByRole('button', { name: 'export-csv' }));
    expect(grid.api!.exportDataAsCsv).toHaveBeenCalledWith({ fileName: expect.stringMatching(new RegExp(`^cost-per-fte-opex-item-${Y - 1}-[a-z0-9-]+\\.csv$`)) });
  });

  it('charts the cost per FTE of the total and the largest groups, one bar per pair', async () => {
    serverRows = Array.from({ length: 12 }, (_, i) => line(`l${i}`, [`cc${i}`, `CC${i}`], null, { staffFte: 12 - i, cost: (12 - i) * 1000, fte: 12 - i }, null));
    renderReport();
    await waitFor(() => expect(gridRows()).toHaveLength(12));
    await waitFor(() => expect(chart.options.data).toHaveLength(11));
    expect(chart.options.title.text).toContain('reports.costPerFte.chartTitle');
    expect(chart.options.title.text).toContain('"group":"reports.staffing.groupsInSentence.costCenter"');
    // The total first, then the ten groups with the most FTE in the first pair.
    const categories = chart.options.data.map((datum: any) => chart.options.axes[0].label.formatter({ value: datum.key }));
    expect(categories).toEqual(['reports.columns.total', 'CC0', 'CC1', 'CC2', 'CC3', 'CC4', 'CC5', 'CC6', 'CC7', 'CC8', 'CC9']);
    expect(chart.options.series).toHaveLength(2);
    expect(chart.options.series.every((series: any) => series.type === 'bar' && series.direction === 'horizontal')).toBe(true);
    expect(chart.options.series.map((series: any) => series.yKey)).toEqual(['c0_ratio', 'c1_ratio']);
    expect(chart.options.data[0]).toMatchObject({ c0_ratio: 1000, c0_fte: 78, c0_cost: 78000, c1_ratio: null });
    const tooltip = chart.options.series[0].tooltip.renderer({ datum: chart.options.data[1] });
    expect(tooltip.title).toBe('CC0');
    expect(tooltip.data.map((entry: any) => entry.label)).toEqual(['reports.filters.column', 'reports.costPerFte.costPerFte', 'reports.measure.fte', 'reports.costPerFte.staffCost']);
    expect(tooltip.data.slice(1).map((entry: any) => entry.value)).toEqual(['1 000', '12.00', '12 000']);
    expect(tooltip.data[0].value).toMatch(new RegExp(` ${Y - 1}$`));
  });

  it('sorts and charts on this year when no group has staff last year', async () => {
    // Twelve groups planning staff this year only, named in the order of their FTE, smallest first.
    serverRows = Array.from({ length: 12 }, (_, i) => line(`l${i}`, [`cc${i}`, `CC${String.fromCharCode(65 + i)}`], null, null, { staffFte: i + 1, cost: (i + 1) * 1000, fte: i + 1 }));
    renderReport();
    await waitFor(() => expect(gridRows()).toHaveLength(12));
    // CCL (12 FTE) down to CCA (1 FTE): by this year's FTE, never by name.
    expect(gridRows().map((row) => row.c1_fte)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(gridRows().every((row) => row.c0_fte == null)).toBe(true);
    await waitFor(() => expect(chart.options.data).toHaveLength(11));
    const categories = chart.options.data.map((datum: any) => chart.options.axes[0].label.formatter({ value: datum.key }));
    expect(categories).toEqual(['reports.columns.total', 'CCL', 'CCK', 'CCJ', 'CCI', 'CCH', 'CCG', 'CCF', 'CCE', 'CCD', 'CCC']);
  });

  it('flags per pair the FTE whose amount left its lines and the FTE without line detail', async () => {
    renderReport();
    await waitFor(() => expect(screen.getAllByRole('note')).toHaveLength(2));
    const [detached, noDetail] = screen.getAllByRole('note').map((note) => note.textContent ?? '');
    // e is detached too, but has no line detail: only b counts, with the sentence on the lines' cost.
    expect(detached).toContain('reports.measure.detachedList');
    expect(detached).toContain(`${Y}`);
    expect(detached).toContain('\\"count\\":1');
    expect(detached).toContain('\\"fte\\":\\"1.50\\"');
    expect(detached).not.toContain(`${Y - 1}`);
    expect(detached.endsWith('reports.costPerFte.detachedNote')).toBe(true);
    expect(noDetail).toContain('reports.costPerFte.noDetail');
    expect(noDetail).toContain('\\"fte\\":\\"3.00\\"');
  });

  it('shows no notice when every staff FTE follows its lines with detail', async () => {
    serverRows = ROWS.filter((row) => row.id !== 'b' && row.id !== 'e');
    renderReport();
    await waitFor(() => expect(gridRows()).toHaveLength(3));
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('Daily rate', () => {
  it('switches to the daily rate in the address, keeping the type, the grouping and the pairs', async () => {
    renderReport('/report?group=supplier');
    await waitFor(() => expect(gridRows()).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: 'reports.budgetColumnsCompare.addSelection' }));
    await waitFor(() => expect(pairYears()).toEqual([Y - 1, Y, Y + 1]));
    expect(rateCalls()).toHaveLength(0);

    await pick('reports.costPerFte.show', 'reports.costPerFte.dailyRate');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('?group=supplier&view=rate'));
    await waitFor(() => expect(gridRows().map((row) => row.group)).toEqual(['Acme', 'reports.staffing.none.supplier']));
    expect(pairYears()).toEqual([Y - 1, Y, Y + 1]);
    const request = rateCalls()[rateCalls().length - 1];
    expect(request.spec.groupBy).toEqual(['supplier_id', 'supplier_name']);
    expect(request.spec.measures.map((measure: any) => measure.id)).toEqual(['cost', 'days', 'staff', 'detached', 'nodetail']);
    expect(grid.columns).toHaveLength(4);

    // Back to the cost per FTE: the address drops the view only.
    await pick('reports.costPerFte.show', 'reports.costPerFte.costPerFte');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('?group=supplier'));
    await waitFor(() => expect(gridRows().map((row) => row.group)).toEqual(['Acme', 'Globex', 'reports.staffing.none.supplier']));
    expect(pairYears()).toEqual([Y - 1, Y, Y + 1]);
  });

  it('shows days, day cost and daily rate per pair, with the ratio of the totals', async () => {
    renderReport('/report?view=rate');
    await waitFor(() => expect(gridRows().map((row) => row.group)).toEqual(['CC2 · Dev', 'CC1 · Ops', 'CC3 · Data']));
    expect(valueColumns().map((column: any) => [column.colId, column.headerName])).toEqual([
      ['c0_days', 'reports.costPerFte.days'], ['c0_cost', 'reports.costPerFte.dayCost'], ['c0_rate', 'reports.costPerFte.dailyRate'],
      ['c1_days', 'reports.costPerFte.days'], ['c1_cost', 'reports.costPerFte.dayCost'], ['c1_rate', 'reports.costPerFte.dailyRate'],
    ]);
    const [cc2, cc1, cc3] = gridRows();
    expect(cc2).toMatchObject({ c0_days: 400, c0_cost: 160000, c0_rate: 400, c1_days: 360, c1_cost: 144000, c1_rate: 400 });
    // b is priced per month: CC1's rate is a's alone.
    expect(cc1).toMatchObject({ c0_days: 200, c0_cost: 90000, c0_rate: 450, c1_days: 200, c1_cost: 100000, c1_rate: 500 });
    expect(cc3).toMatchObject({ c0_days: null, c0_cost: null, c0_rate: null, c1_days: 0, c1_cost: 0, c1_rate: null });
    expect(grid.pinned[0]).toMatchObject({ group: 'reports.columns.total', c0_days: 600, c0_cost: 250000, c1_days: 560, c1_cost: 244000 });
    expect(grid.pinned[0].c0_rate).toBeCloseTo(250000 / 600);
    expect(grid.pinned[0].c1_rate).toBeCloseTo(244000 / 560);

    const [days, cost, rate] = valueColumns();
    // Grouped like the amounts, with only the decimals the value needs (two at most).
    expect(days.valueFormatter({ value: 1341.7 })).toBe('1 341.7');
    expect(days.valueFormatter({ value: 8948.5 })).toBe('8 948.5');
    expect(days.valueFormatter({ value: 1234567.456 })).toBe('1 234 567.46');
    expect(days.valueFormatter({ value: 2.5 })).toBe('2.5');
    expect(days.valueFormatter({ value: 360 })).toBe('360');
    expect(days.valueFormatter({ value: null })).toBe('');
    expect(cost.valueFormatter({ value: 144000 })).toBe('144 000');
    expect(rate.valueFormatter({ value: 416.67 })).toBe('417');
    expect(rate.valueFormatter({ value: null })).toBe('');
    for (const column of valueColumns()) {
      expect(column.width).toBeGreaterThan(0);
      expect(column.type).toBe('rightAligned');
    }

    fireEvent.click(screen.getByRole('button', { name: 'export-csv' }));
    expect(grid.api!.exportDataAsCsv).toHaveBeenCalledWith({ fileName: expect.stringMatching(new RegExp(`^daily-rate-opex-cost-center-${Y - 1}-[a-z0-9-]+\\.csv$`)) });
  });

  it('charts the daily rate of the total and the groups with the most days', async () => {
    renderReport('/report?view=rate');
    await waitFor(() => expect(chart.options?.data).toHaveLength(4));
    expect(chart.options.title.text).toContain('reports.costPerFte.rateChartTitle');
    expect(chart.options.title.text).toContain('"group":"reports.staffing.groupsInSentence.costCenter"');
    const categories = chart.options.data.map((datum: any) => chart.options.axes[0].label.formatter({ value: datum.key }));
    expect(categories).toEqual(['reports.columns.total', 'CC2 · Dev', 'CC1 · Ops', 'CC3 · Data']);
    expect(chart.options.axes[1].title.text).toBe('reports.costPerFte.dailyRate');
    expect(chart.options.series.map((series: any) => series.yKey)).toEqual(['c0_rate', 'c1_rate']);
    const tooltip = chart.options.series[1].tooltip.renderer({ datum: chart.options.data[2] });
    expect(tooltip.title).toBe('CC1 · Ops');
    expect(tooltip.data.map((entry: any) => entry.label)).toEqual(['reports.filters.column', 'reports.costPerFte.dailyRate', 'reports.costPerFte.days', 'reports.costPerFte.dayCost']);
    expect(tooltip.data.slice(1).map((entry: any) => entry.value)).toEqual(['500', '200', '100 000']);
    expect(tooltip.data[0].value).toMatch(new RegExp(` ${Y}$`));
  });

  it('flags the detached and undetailed FTE, and the staff cost priced per month, per pair', async () => {
    renderReport('/report?view=rate');
    await waitFor(() => expect(screen.getAllByRole('note')).toHaveLength(3));
    const [detached, noDetail, monthly] = screen.getAllByRole('note').map((note) => note.textContent ?? '');
    expect(detached).toContain('reports.measure.detachedList');
    expect(detached.endsWith('reports.costPerFte.detachedNote')).toBe(true);
    expect(noDetail).toContain('reports.costPerFte.noDetail');
    // This year: 445 000 of staff cost, 244 000 of it per day. Last year everything is per day: not named.
    expect(monthly).toContain('reports.costPerFte.monthlyLeftOut');
    expect(monthly).toContain('reports.costPerFte.monthlyEntry');
    expect(monthly).toContain('\\"amount\\":\\"201 000\\"');
    expect(monthly).toContain(` ${Y}`);
    expect(monthly).not.toContain(`${Y - 1}`);
  });

  it('names no per-month cost when every staff line is priced per day', async () => {
    serverRows = ROWS.filter((row) => row.id === 'a' || row.id === 'd');
    renderReport('/report?view=rate');
    await waitFor(() => expect(gridRows()).toHaveLength(2));
    expect(screen.queryByRole('note')).toBeNull();
  });
});
