import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import type { TFunction } from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  default: ({ filters, children }: { filters?: React.ReactNode; children?: React.ReactNode }) => (
    <div>
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
const grid = vi.hoisted(() => ({ columns: [] as any[], pinned: [] as any[], props: {} as Record<string, any> }));
vi.mock('../../components/reports/ReportGrid', () => ({
  default: (props: { rowData?: unknown[]; columnDefs?: any[]; pinnedBottomRowData?: any[] }) => {
    const { rowData, columnDefs, pinnedBottomRowData } = props;
    grid.columns = columnDefs ?? [];
    grid.pinned = pinnedBottomRowData ?? [];
    grid.props = props;
    return <pre data-testid="grid">{JSON.stringify(rowData ?? [])}</pre>;
  },
}));

import api from '../../api';
import { fakeAggregate, fakeFilterValues } from '../../test/fakeBudgetAggregate';
import { setBudgetColumns } from './budgetColumnsTestState';
import StaffingByMonthReport from './StaffingByMonthReport';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;
const Y = new Date().getFullYear();

/** The same value in every budget column, so the tests hold whatever column the report starts on. */
const everyColumn = <T,>(value: T) => Object.fromEntries(AMOUNT_COLUMNS.map((column) => [column.key, value]));
const flat = (value: number) => Array.from({ length: 12 }, () => value);

function axis(id: string, patch: Partial<AnalyticsAxis>): AnalyticsAxis {
  return { id, code: id, name: null, description: null, sort_order: 0, is_default: false, status: 'enabled', disabled_at: null, ...patch };
}
const DEFAULT_AXIS = axis('ax-def', { is_default: true });
const NATURE = axis('ax-nat', { name: 'Nature', sort_order: 1 });

type Staff = { fte: number; months?: number[]; method?: string };
function line(id: string, costCenter: [string, string] | null, supplier: [string, string] | null, staff: Staff | null, nature?: [string, string]) {
  return {
    id,
    product_name: `Line ${id}`,
    description: `Line ${id}`,
    cost_center_id: costCenter?.[0] ?? null,
    cost_center_label: costCenter?.[1] ?? null,
    supplier_id: supplier?.[0] ?? null,
    supplier_name: supplier?.[1] ?? null,
    analytics_value_ids: nature ? { 'ax-nat': nature[0] } : {},
    'analytics_ax-nat': nature?.[1] ?? null,
    versions: {
      y: {
        year: Y,
        totals: everyColumn(0),
        ...(staff ? {
          fte: everyColumn(staff.fte),
          ...(staff.months ? { fte_months: everyColumn(staff.months) } : {}),
          ...(staff.method ? { method: everyColumn(staff.method) } : {}),
        } : {}),
      },
    } as Record<string, any>,
  };
}

const RAMP = [0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2];
// a and b on CC1 (2 FTE all year), c on CC2 ramping up from July (1 FTE on average), d without a cost
// center (0.5), e declares 3 FTE without monthly detail (a copy, so detached too), f's amount was spread since
// (detached, in the months), g has no FTE.
const ROWS = [
  line('a', ['cc1', 'CC1 · Ops'], ['s1', 'Acme'], { fte: 1, months: flat(1) }, ['n-hw', 'Hardware']),
  line('b', ['cc1', 'CC1 · Ops'], ['s2', 'Globex'], { fte: 1, months: flat(1) }),
  line('c', ['cc2', 'CC2 · Dev'], ['s1', 'Acme'], { fte: 1, months: RAMP }, ['n-sw', 'Software']),
  line('d', null, null, { fte: 0.5, months: flat(0.5) }),
  line('e', ['cc3', 'CC3 · Data'], ['s3', 'Initech'], { fte: 3, method: 'copied' }),
  line('f', ['cc2', 'CC2 · Dev'], ['s2', 'Globex'], { fte: 0.25, months: flat(0.25), method: 'spread' }),
  line('g', ['cc4', 'CC4 · Empty'], ['s4', 'Umbrella'], null),
];

let serverRows: ReturnType<typeof line>[] = ROWS;

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderReport(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={[path]}>
          <StaffingByMonthReport />
          <LocationProbe />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const gridRows = () => JSON.parse(screen.getByTestId('grid').textContent || '[]') as Array<Record<string, any>>;
const groupOf = (body: any) => body.spec.groupBy as string[];
const lastRequest = () => {
  const calls = post.mock.calls.filter(([, body]) => body.spec.measures.length === 14);
  return calls[calls.length - 1]?.[1];
};
const pick = async (combobox: string, option: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: combobox }));
  fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: option }));
};

beforeEach(() => {
  serverRows = ROWS;
  setBudgetColumns();
  axesState.list = [DEFAULT_AXIS, NATURE];
  chart.options = null;
  grid.columns = [];
  grid.pinned = [];
  grid.props = {};
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

describe('Staffing by month', () => {
  it('groups by cost center by default: twelve months, average and peak, largest average first, a pinned total', async () => {
    renderReport('/report');
    await waitFor(() => expect(gridRows().map((row) => [row.group, row.average, row.peak])).toEqual([
      ['CC1 · Ops', 2, 2],
      ['CC2 · Dev', 1.25, 2.25],
      ['reports.staffing.none.costCenter', 0.5, 0.5],
    ]));
    expect(groupOf(lastRequest())).toEqual(['cost_center_id', 'cost_center_label']);
    expect(screen.getByTestId('location').textContent).toBe('');
    // CC2: c's ramp plus f's 0.25 every month.
    const cc2 = gridRows()[1];
    expect([cc2.m1, cc2.m6, cc2.m7, cc2.m12]).toEqual([0.25, 0.25, 2.25, 2.25]);
    // Month headers from the locale, then Average and Peak; FTE with two decimals.
    expect(grid.columns.map((column) => column.headerName)).toEqual([
      'reports.staffing.groups.costCenter', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
      'reports.staffing.average', 'reports.staffing.peak',
    ]);
    expect(grid.columns[1].valueFormatter({ value: 1.5 })).toBe('1.50');
    expect(grid.columns[1].valueFormatter({ value: null })).toBe('');
    // The group takes the rest with its full name on hover; the fourteen value columns have no fixed
    // width: the grid fits them to their header and values, right-aligned.
    expect(grid.columns[0]).toMatchObject({ flex: 1, minWidth: 180, tooltipField: 'group' });
    const values = grid.columns.slice(1);
    expect(values.map((column) => column.colId)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12', 'average', 'peak']);
    for (const column of values) {
      expect(column.width).toBeUndefined();
      expect(column.flex).toBeUndefined();
      expect(column.type).toBe('rightAligned');
    }
    expect(grid.props.autoSizeStrategy).toEqual({ type: 'fitCellContents', colIds: values.map((column) => column.colId) });
    // The total: 2.75 FTE each month from January to June, 4.75 from July.
    expect(grid.pinned).toHaveLength(1);
    expect(grid.pinned[0]).toMatchObject({ group: 'reports.columns.total', m1: 2.75, m7: 4.75, peak: 4.75 });
    expect(grid.pinned[0].average).toBeCloseTo(3.75);
    expect(chart.options.title.text).toContain('reports.staffing.chartTitle');
    expect(chart.options.title.text).toContain('"group":"reports.staffing.groupsInSentence.costCenter"');
    expect(chart.options.axes[1].title.text).toBe('reports.measure.fte');
  });

  it('fits the value columns again, and only them, when the rows, the total or the headers change', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      renderReport('/report');
      await vi.waitFor(() => expect(grid.props.onRowDataUpdated).toBeTypeOf('function'));
      for (const handler of ['onRowDataUpdated', 'onPinnedRowDataChanged', 'onNewColumnsLoaded']) {
        const autoSizeColumns = vi.fn();
        grid.props[handler]({ api: { isDestroyed: () => false, autoSizeColumns } });
        expect(autoSizeColumns).not.toHaveBeenCalled();
        vi.runOnlyPendingTimers();
        expect(autoSizeColumns).toHaveBeenCalledWith(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12', 'average', 'peak']);
      }
      // A grid gone in the meantime is left alone.
      const autoSizeColumns = vi.fn();
      grid.props.onRowDataUpdated({ api: { isDestroyed: () => true, autoSizeColumns } });
      vi.runOnlyPendingTimers();
      expect(autoSizeColumns).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('switches the grouping and keeps it in the address', async () => {
    renderReport('/report?group=supplier');
    await waitFor(() => expect(gridRows().map((row) => row.group)).toEqual(['Acme', 'Globex', 'reports.staffing.none.supplier']));
    expect(groupOf(lastRequest())).toEqual(['supplier_id', 'supplier_name']);

    await pick('reports.staffing.groupBy', 'reports.staffing.groups.item');
    await waitFor(() => expect(groupOf(lastRequest())).toEqual(['id', 'product_name']));
    expect(screen.getByTestId('location').textContent).toBe('?group=item');
    await waitFor(() => expect(gridRows().map((row) => row.group)).toEqual(['Line a', 'Line b', 'Line c', 'Line d', 'Line f']));

    // An analytics dimension: the default one first, then the Dimension select picks another.
    await pick('reports.staffing.groupBy', 'reports.staffing.groups.axis');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('?group=axis%3Aax-def'));
    await pick('reports.filters.dimension', 'Nature');
    await waitFor(() => expect(groupOf(lastRequest())).toEqual(['analytics_id_ax-nat', 'analytics_ax-nat']));
    expect(screen.getByTestId('location').textContent).toBe('?group=axis%3Aax-nat');
    await waitFor(() => expect(gridRows().map((row) => row.group)).toEqual(['reports.staffing.none.axis', 'Hardware', 'Software']));
    expect(grid.columns[0].headerName).toBe('Nature');

    await pick('reports.staffing.groupBy', 'reports.staffing.groups.costCenter');
    await waitFor(() => expect(groupOf(lastRequest())).toEqual(['cost_center_id', 'cost_center_label']));
    expect(screen.getByTestId('location').textContent).toBe('');
  });

  it('reads a dimension that is no longer enabled as the default one', async () => {
    renderReport('/report?group=axis:gone');
    await waitFor(() => expect(groupOf(lastRequest())).toEqual(['analytics_id_ax-def', 'analytics_ax-def']));
  });

  it('stacks the eight largest groups and the rest as others', async () => {
    serverRows = Array.from({ length: 10 }, (_, i) => line(`l${i}`, [`cc${i}`, `CC${i}`], null, { fte: 10 - i, months: flat(10 - i) }));
    renderReport('/report');
    await waitFor(() => expect(gridRows()).toHaveLength(10));
    await waitFor(() => expect(chart.options.series).toHaveLength(9));
    expect(chart.options.series.map((series: any) => series.yName)).toEqual(['CC0', 'CC1', 'CC2', 'CC3', 'CC4', 'CC5', 'CC6', 'CC7', 'reports.staffing.others']);
    expect(chart.options.series.every((series: any) => series.type === 'area' && series.stacked)).toBe(true);
    // CC8 (2) + CC9 (1).
    expect(chart.options.data[0].s8).toBe(3);
    const tooltip = chart.options.series[0].tooltip.renderer({ datum: chart.options.data[0], yKey: 's0' });
    expect(tooltip).toEqual({ title: 'CC0', data: [{ label: 'Jan', value: '10.00' }] });
  });

  it('draws no others area when eight groups or fewer', async () => {
    renderReport('/report');
    await waitFor(() => expect(gridRows()).toHaveLength(3));
    expect(chart.options.series.map((series: any) => series.yName)).not.toContain('reports.staffing.others');
  });

  it('flags, one line each, the FTE whose amount left its lines and the FTE without monthly detail', async () => {
    renderReport('/report');
    await waitFor(() => expect(screen.getAllByRole('note')).toHaveLength(2));
    const [detached, noDetail] = screen.getAllByRole('note').map((note) => note.textContent ?? '');
    // e is detached too, but has no monthly detail: only f counts in the detached notice.
    expect(detached).toContain('reports.measure.detachedSingle');
    expect(detached).toContain('"count":1');
    expect(detached).toContain('"fte":"0.25"');
    expect(noDetail).toContain('reports.staffing.noDetail');
    expect(noDetail).toContain('"count":1');
    expect(noDetail).toContain('"fte":"3.00"');
  });

  it('shows no notice when every declared FTE has its monthly detail and follows its lines', async () => {
    serverRows = ROWS.filter((row) => row.id !== 'e' && row.id !== 'f');
    renderReport('/report');
    await waitFor(() => expect(gridRows()).toHaveLength(3));
    expect(screen.queryByRole('note')).toBeNull();
  });
});
