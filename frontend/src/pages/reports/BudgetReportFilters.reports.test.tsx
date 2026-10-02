import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import type { TFunction } from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { AMOUNT_COLUMNS } from '../../components/finance/amountColumns';
import type { CostCenterNode } from '../../services/costCenters';
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
const tree = vi.hoisted(() => ({ nodes: [] as unknown[], ready: true }));
vi.mock('../../hooks/useCostCenterTree', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useCostCenterTree')>();
  return { ...actual, useCostCenterTree: () => actual.buildCostCenterTree(tree.nodes as CostCenterNode[], tree.ready) };
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
  default: ({ filters, children, busy }: { filters?: React.ReactNode; children?: React.ReactNode; busy?: boolean }) => (
    <div data-testid="layout" data-busy={busy ? 'true' : 'false'}>
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
const grid = vi.hoisted(() => ({ columns: [] as Array<{ headerName?: string }> }));
vi.mock('../../components/reports/ReportGrid', () => ({
  default: ({ rowData, columnDefs }: { rowData?: unknown[]; columnDefs?: Array<{ headerName?: string }> }) => {
    grid.columns = columnDefs ?? [];
    return <pre data-testid="grid">{JSON.stringify(rowData ?? [])}</pre>;
  },
}));

import api from '../../api';
import { fakeAggregate, fakeFilterValues } from '../../test/fakeBudgetAggregate';
import { setBudgetColumns } from './budgetColumnsTestState';
import TopOpexReport from './TopOpexReport';
import OpexDeltaReport from './OpexDeltaReport';
import ComparisonReport from './ComparisonReport';
import CapexBudgetTrendReport from './CapexBudgetTrendReport';
import BudgetColumnsCompareReport from './BudgetColumnsCompareReport';
import ConsolidationReport from './ConsolidationReport';
import AnalyticsCategoryReport from './AnalyticsCategoryReport';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;
const Y = new Date().getFullYear();

function node(id: string, patch: Partial<CostCenterNode>): CostCenterNode {
  return {
    id, code: id.toUpperCase(), name: id, kind: 'cost_center', parent_id: null, company_id: 'co-1', company_name: 'Company',
    owner_user_id: null, owner_name: null, status: 'enabled', disabled_at: null, sort_order: 0, depth: 0, path: id, path_ids: [id],
    ...patch,
  };
}

// grp › (cc1, cc2 disabled, sub › cc3); out stands alone.
const NODES = [
  node('grp', { kind: 'group', company_id: null }),
  node('cc1', { parent_id: 'grp', depth: 1, path_ids: ['grp', 'cc1'] }),
  node('cc2', { parent_id: 'grp', depth: 1, path_ids: ['grp', 'cc2'], status: 'disabled' }),
  node('sub', { kind: 'group', company_id: null, parent_id: 'grp', depth: 1, path_ids: ['grp', 'sub'] }),
  node('cc3', { parent_id: 'sub', depth: 2, path_ids: ['grp', 'sub', 'cc3'] }),
  node('out', {}),
];

/** The same amount in every budget column, so the tests hold whatever column a report starts on. */
function slot(year: number, amount: number) {
  const columns = Object.fromEntries(AMOUNT_COLUMNS.map((column) => [column.key, amount]));
  return { year, totals: columns, reporting: { ...columns, currency: 'X', reporting_currency: 'X' } };
}

function axis(id: string, patch: Partial<AnalyticsAxis>): AnalyticsAxis {
  return { id, code: id, name: null, description: null, sort_order: 0, is_default: false, status: 'enabled', disabled_at: null, ...patch };
}

// The default dimension has no name of its own and reads as the translated default label.
const DEFAULT_AXIS = axis('ax-def', { is_default: true });
const NATURE = axis('ax-nat', { name: 'Nature', sort_order: 1 });
const NATURE_VALUES: Record<string, [string, string]> = { a: ['n-hw', 'Hardware'], c: ['n-sw', 'Software'], d: ['n-hw', 'Hardware'] };

function line(id: string, costCenterId: string | null, runBuild: 'run' | 'build' | null, previous: number, current: number) {
  const nature = NATURE_VALUES[id];
  return {
    id,
    product_name: `Line ${id}`,
    description: `Line ${id}`,
    account_display: `Account ${id}`,
    analytics_category_id: `cat-${id}`,
    analytics_category_name: `Category ${id}`,
    analytics_value_ids: { 'ax-def': `cat-${id}`, ...(nature ? { 'ax-nat': nature[0] } : {}) } as Record<string, string>,
    'analytics_ax-def': `Category ${id}`,
    'analytics_ax-nat': nature ? nature[1] : null,
    cost_center_id: costCenterId,
    run_build: runBuild,
    versions: { yMinus1: slot(Y - 1, previous), y: slot(Y, current) } as Record<string, ReturnType<typeof slot>>,
  };
}

// Under grp: a, b (on a disabled cost center) and c (two levels down) = 123 in Y.
// Nature: a and d are Hardware (1 100 in Y), c is Software, b and e hold no Nature value.
const ROWS = [
  line('a', 'cc1', 'run', 10, 100),
  line('b', 'cc2', 'build', 5, 20),
  line('c', 'cc3', null, 1, 3),
  line('d', 'out', 'run', 0, 1000),
  line('e', null, 'build', 0, 7000),
];
// Only a line outside every filter below has a Y+1 amount: the Delta year pickers must still offer it.
ROWS[4].versions.yPlus1 = slot(Y + 1, 1);

function renderReport(element: React.ReactElement, path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const gridRows = (index = 0) => JSON.parse(screen.getAllByTestId('grid')[index].textContent || '[]') as Array<Record<string, any>>;

beforeEach(() => {
  setBudgetColumns();
  tree.nodes = NODES;
  tree.ready = true;
  axesState.list = [DEFAULT_AXIS, NATURE];
  chart.options = null;
  get.mockReset();
  get.mockImplementation(async (url: string, config?: { params?: Record<string, string> }) => {
    if (url.endsWith('/summary/filter-values')) return { data: fakeFilterValues(ROWS, String(config?.params?.fields ?? '').split(',')) };
    return { data: { items: [], total: 0 } };
  });
  // The server's aggregates, computed from the same lines.
  post.mockReset();
  post.mockImplementation(async (url: string, body: any) => {
    if (url.endsWith('/summary/aggregate')) return { data: fakeAggregate(ROWS, body) };
    throw new Error(`unexpected POST ${url}`);
  });
});

describe('Top items with a cost center group', () => {
  it('totals the lines of the group and every node below it, a disabled one included', async () => {
    renderReport(<TopOpexReport />, '/report?costCenter=grp');
    await waitFor(() => expect(gridRows().map((row) => [row.name, row.value])).toEqual([
      ['Line a', 100],
      ['Line b', 20],
      ['Line c', 3],
    ]));
    // The total the shares are taken on is the group's, 100 + 20 + 3.
    expect(chart.options.footnote.text).toMatch(/: 123$/);
    expect(gridRows()[0].pct_of_total).toBe(Math.round((100 / 123) * 100));
  });

  it('keeps every line when nothing is picked', async () => {
    renderReport(<TopOpexReport />, '/report');
    await waitFor(() => expect(gridRows()).toHaveLength(5));
    expect(chart.options.footnote.text).toMatch(/: 8 123$/);
  });
});

describe('Top increase / decrease with a cost center group', () => {
  it('ranks the increases of the group lines only', async () => {
    renderReport(<OpexDeltaReport />, '/report?costCenter=grp');
    await waitFor(() => expect(gridRows().map((row) => [row.name, row.delta])).toEqual([
      ['Line a', 90],
      ['Line b', 15],
      ['Line c', 2],
    ]));
  });
});

describe.each([
  ['OPEX trend', ComparisonReport],
  ['CAPEX trend', CapexBudgetTrendReport],
])('%s with run only', (_name, Report) => {
  it('sums the run lines per year', async () => {
    renderReport(<Report />, '/report?runBuild=run');
    await waitFor(() => expect(gridRows()[0]?.[String(Y)]).toBe(1100));
    expect(gridRows()[0][String(Y - 1)]).toBe(10);
  });
});

describe('Budget column comparison with a group and build only', () => {
  it('sums the build lines of the group', async () => {
    renderReport(<BudgetColumnsCompareReport />, '/report?costCenter=grp&runBuild=build');
    await waitFor(() => expect(gridRows()[0]?.total).toBe(20));
    expect(gridRows()[0].year).toBe(Y);
  });
});

describe.each([
  ['Consolidation', ConsolidationReport],
  ['Analytics', AnalyticsCategoryReport],
])('%s with lines that say neither run nor build', (_name, Report) => {
  it('groups those lines only', async () => {
    renderReport(<Report />, '/report?runBuild=none');
    await waitFor(() => expect(gridRows().map((row) => row[String(Y)])).toEqual([3]));
  });
});

/** The options an autocomplete or select offers, read and closed again. */
async function optionsOf(name: string, open: 'keyDown' | 'mouseDown') {
  const control = screen.getByRole('combobox', { name });
  if (open === 'keyDown') fireEvent.keyDown(control, { key: 'ArrowDown' });
  else fireEvent.mouseDown(control);
  const listbox = await screen.findByRole('listbox');
  const options = within(listbox).getAllByRole('option').map((option) => option.textContent);
  fireEvent.keyDown(open === 'keyDown' ? control : listbox, { key: 'Escape' });
  return options;
}

const EVERY_LINE = ['Line a', 'Line b', 'Line c', 'Line d', 'Line e'];
const EVERY_ACCOUNT = ['Account a', 'Account b', 'Account c', 'Account d', 'Account e'];

describe('Option lists under a filter', () => {
  // grp and run together keep line a only; every picker below must still list all five lines.
  const path = '/report?costCenter=grp&runBuild=run';

  it.each([
    ['Top items', TopOpexReport],
    ['Top increase / decrease', OpexDeltaReport],
  ])('%s: the item and account exclusions offer every line', async (_name, Report) => {
    renderReport(<Report />, path);
    await waitFor(() => expect(gridRows().map((row) => row.name)).toEqual(['Line a']));
    expect(await optionsOf('reports.filters.excludeItems', 'keyDown')).toEqual(EVERY_LINE);
    expect(await optionsOf('reports.filters.excludeAccounts', 'keyDown')).toEqual(EVERY_ACCOUNT);
  });

  it('Top increase / decrease: the year pickers offer the years of every line', async () => {
    renderReport(<OpexDeltaReport />, path);
    await waitFor(() => expect(gridRows().map((row) => row.name)).toEqual(['Line a']));
    const years = [String(Y - 1), String(Y), String(Y + 1)];
    expect(await optionsOf('reports.filters.sourceYear', 'mouseDown')).toEqual(years);
    expect(await optionsOf('reports.filters.destinationYear', 'mouseDown')).toEqual(years);
  });

  it('Analytics: the category exclusion offers the categories of every line', async () => {
    renderReport(<AnalyticsCategoryReport />, path);
    await waitFor(() => expect(gridRows().map((row) => row[String(Y)])).toEqual([100]));
    expect(await optionsOf('reports.filters.excludeCategories', 'keyDown')).toEqual([
      'Category a', 'Category b', 'Category c', 'Category d', 'Category e',
    ]);
  });
});

describe('Reports with a dimension value picked', () => {
  it('Top items: totals and shares read the lines holding the value only', async () => {
    renderReport(<TopOpexReport />, '/report?analytics=ax-nat:n-hw');
    await waitFor(() => expect(gridRows().map((row) => [row.name, row.value])).toEqual([
      ['Line d', 1000],
      ['Line a', 100],
    ]));
    // The total the shares are taken on is the kept lines', 1 000 + 100.
    expect(chart.options.footnote.text).toMatch(/: 1 100$/);
    expect(gridRows()[0].pct_of_total).toBe(Math.round((1000 / 1100) * 100));
  });

  it('CAPEX trend: sums the lines holding no value on the dimension', async () => {
    renderReport(<CapexBudgetTrendReport />, '/report?analytics=ax-nat:none');
    await waitFor(() => expect(gridRows()[0]?.[String(Y)]).toBe(7020));
    expect(gridRows()[0][String(Y - 1)]).toBe(5);
  });
});

describe('Analytics report dimensions', () => {
  const dimensionPicker = () => screen.queryByRole('combobox', { name: 'reports.filters.dimension' });
  const groups = () => gridRows().map((row) => [row.group, row[String(Y)]]);
  const valueCalls = () => get.mock.calls.filter(([url]) => url === '/analytics-categories').map(([, config]) => config?.params);

  async function exclude(option: string) {
    const input = screen.getByRole('combobox', { name: 'reports.filters.excludeCategories' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: option }));
    fireEvent.keyDown(input, { key: 'Escape' });
  }

  it('labels every filter above its field, none inside it', async () => {
    const { container } = renderReport(<AnalyticsCategoryReport />, '/report');
    await waitFor(() => expect(groups()).toHaveLength(5));
    for (const name of [
      'reports.filters.dimension',
      'reports.filters.startYear',
      'reports.filters.endYear',
      'reports.filters.metric',
      'reports.filters.chartType',
      'reports.filters.excludeCategories',
    ]) {
      expect(screen.getByRole('combobox', { name })).toBeInTheDocument();
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(container.querySelector('.MuiInputLabel-root')).toBeNull();
  });

  it('hides the picker with one enabled dimension and groups on the default one', async () => {
    axesState.list = [DEFAULT_AXIS, axis('ax-off', { name: 'Old split', sort_order: 2, status: 'disabled', disabled_at: '2020-01-01T00:00:00.000Z' })];
    renderReport(<AnalyticsCategoryReport />, '/report?axis=ax-off');
    await waitFor(() => expect(groups()).toHaveLength(5));
    expect(dimensionPicker()).toBeNull();
    expect(groups()[0]).toEqual(['Category e', 7000]);
    // The default without a name reads in lowercase inside a sentence; the grid header keeps the label.
    expect(chart.options.title.text).toContain('"dimension":"reports.analyticsCategory.defaultDimensionInSentence"');
    expect(grid.columns[0].headerName).toBe('Analytics dimension');
  });

  it('names the default dimension in titles by its own name once it has one', async () => {
    axesState.list = [axis('ax-def', { is_default: true, name: 'Cost type' }), NATURE];
    renderReport(<AnalyticsCategoryReport />, '/report');
    await waitFor(() => expect(groups()).toHaveLength(5));
    expect(chart.options.title.text).toContain('"dimension":"Cost type"');
    expect(grid.columns[0].headerName).toBe('Cost type');
    expect(await optionsOf('reports.filters.dimension', 'mouseDown')).toEqual(['Cost type', 'Nature']);
  });

  it('offers the enabled dimensions and groups on the picked one, lines without a value as unassigned', async () => {
    renderReport(<AnalyticsCategoryReport />, '/report');
    await waitFor(() => expect(groups()).toHaveLength(5));
    expect(await optionsOf('reports.filters.dimension', 'mouseDown')).toEqual(['Analytics dimension', 'Nature']);
    // The dimension's own values load with the exclusion picker, not with the report.
    expect(valueCalls()).toEqual([]);
    await optionsOf('reports.filters.excludeCategories', 'keyDown');
    expect(valueCalls()).toContainEqual({ axis_id: 'ax-def', limit: 1000, sort: 'name:ASC' });

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'reports.filters.dimension' }));
    fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'Nature' }));

    await waitFor(() => expect(groups()).toEqual([
      ['reports.analyticsCategory.unassigned', 7020],
      ['Hardware', 1100],
      ['Software', 3],
    ]));
    expect(chart.options.title.text).toContain('"dimension":"Nature"');
    await waitFor(() => expect(valueCalls()).toContainEqual({ axis_id: 'ax-nat', limit: 1000, sort: 'name:ASC' }));
  });

  it('opens on the dimension the address names', async () => {
    renderReport(<AnalyticsCategoryReport />, '/report?axis=ax-nat&costCenter=grp');
    // Under grp: a is Hardware (100), b has no Nature value (20), c is Software (3).
    await waitFor(() => expect(groups()).toEqual([
      ['Hardware', 100],
      ['reports.analyticsCategory.unassigned', 20],
      ['Software', 3],
    ]));
    expect(screen.getByRole('combobox', { name: 'reports.filters.dimension' }).textContent).toBe('Nature');
  });

  it('drops the value exclusions when the dimension or the item type changes', async () => {
    renderReport(<AnalyticsCategoryReport />, '/report');
    await waitFor(() => expect(groups()).toHaveLength(5));
    const filters = screen.getByTestId('filters');

    await exclude('Category e');
    await waitFor(() => expect(groups()).toHaveLength(4));
    expect(filters.textContent).toContain('reports.filters.categorySelected {"count":1}');

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'reports.filters.dimension' }));
    fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'Nature' }));
    await waitFor(() => expect(groups()).toHaveLength(3));
    expect(filters.textContent).not.toContain('reports.filters.categorySelected');

    await exclude('Hardware');
    await waitFor(() => expect(groups()).toHaveLength(2));
    expect(filters.textContent).toContain('reports.filters.categorySelected {"count":1}');

    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.capex' }));
    await waitFor(() => expect(filters.textContent).not.toContain('reports.filters.categorySelected'));
    await waitFor(() => expect(groups()).toHaveLength(3));
  });
});

describe('A report while new numbers load', () => {
  const busy = () => screen.getByTestId('layout').getAttribute('data-busy');
  /** Every later aggregate stays pending: the report shows what it shows while it loads. */
  const holdAnswers = () => post.mockImplementation(() => new Promise(() => undefined));

  it('keeps the last answer, dimmed and marked loading, when the measures are the same (top count)', async () => {
    renderReport(<TopOpexReport />, '/report');
    await waitFor(() => expect(gridRows()).toHaveLength(5));
    expect(busy()).toBe('false');
    holdAnswers();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'reports.filters.topCount' }), { target: { value: '2' } });
    await waitFor(() => expect(busy()).toBe('true'));
    expect(screen.getByText('ops:reports.shared.loadingData')).toBeInTheDocument();
    // The last answer stays on screen (same measure, same keys), dimmed by the layout.
    expect(gridRows()).toHaveLength(5);
  });

  it('shows no last answer under new columns when the measures change (a year added)', async () => {
    renderReport(<ConsolidationReport />, '/report');
    await waitFor(() => expect(gridRows().map((row) => row[String(Y)])).toEqual([8123]));
    holdAnswers();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'reports.filters.endYear' }));
    fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: String(Y + 1) }));
    await waitFor(() => expect(busy()).toBe('true'));
    expect(screen.getByText('ops:reports.shared.loadingData')).toBeInTheDocument();
    // No group of the former answer sits under the Y and Y+1 columns.
    expect(gridRows()).toEqual([]);
  });

  it('says it loads while the filter bar still reads its address (cost center tree not loaded)', async () => {
    tree.ready = false;
    renderReport(<TopOpexReport />, '/report?costCenter=grp');
    expect(busy()).toBe('true');
    expect(screen.getByText('ops:reports.shared.loadingData')).toBeInTheDocument();
    expect(post.mock.calls.some(([, body]) => body.spec.groupBy[0] === 'id' && body.spec.measures.length === 1)).toBe(false);
  });
});
