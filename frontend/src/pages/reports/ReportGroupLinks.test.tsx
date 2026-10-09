import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ColDef } from 'ag-grid-community';
import { createAppTheme } from '../../config/ThemeContext';
import { AMOUNT_COLUMNS } from '../../components/finance/amountColumns';
import type { AnalyticsAxis } from '../../services/analytics';
import type { CostCenterNode } from '../../services/costCenters';

// The group names of the Staffing by month, Cost per FTE (both views) and Analytics dimensions reports:
// an item opens its page, a cost center, supplier or dimension value opens the OPEX or CAPEX list
// filtered on it and on the filter bar, in a new tab; the total row stays plain text.

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
const treeState = vi.hoisted(() => ({ nodes: [] as unknown[] }));
vi.mock('../../hooks/useCostCenterTree', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useCostCenterTree')>();
  const { useMemo } = await import('react');
  return {
    ...actual,
    useCostCenterTree: () => useMemo(() => actual.buildCostCenterTree(treeState.nodes as CostCenterNode[], true), []),
    useCostCenterCount: () => ({ count: treeState.nodes.length, isError: false }),
  };
});
const axesState = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('../../hooks/useAnalyticsAxes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useAnalyticsAxes')>();
  const { useMemo } = await import('react');
  const t = ((key: string) => key) as unknown as TFunction;
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
vi.mock('../../components/reports/ChartCard', () => ({ default: React.forwardRef(() => null) }));
// The grid's first column, drawn through its own renderer, for the data rows and the pinned rows.
vi.mock('../../components/reports/ReportGrid', () => ({
  default: ({ rowData, pinnedBottomRowData, columnDefs }: { rowData?: any[]; pinnedBottomRowData?: any[]; columnDefs?: ColDef[] }) => {
    const col = (columnDefs ?? [])[0] as ColDef;
    const cell = (row: any, i: number) => {
      const value = row[col.field as string];
      const Renderer = col.cellRenderer as React.FC<any> | undefined;
      return (
        <li key={i} data-testid={i >= 1000 ? 'pinned' : 'row'}>
          {Renderer ? <Renderer value={value} data={row} colDef={col} {...(col.cellRendererParams ?? {})} /> : String(value ?? '')}
        </li>
      );
    };
    return (
      <ul data-testid="grid">
        {(rowData ?? []).map(cell)}
        {(pinnedBottomRowData ?? []).map((row, i) => cell(row, 1000 + i))}
      </ul>
    );
  },
}));

import api from '../../api';
import { fakeAggregate, fakeFilterValues } from '../../test/fakeBudgetAggregate';
import { setBudgetColumns } from './budgetColumnsTestState';
import StaffingByMonthReport from './StaffingByMonthReport';
import CostPerFteReport from './CostPerFteReport';
import AnalyticsCategoryReport from './AnalyticsCategoryReport';
import ConsolidationReport from './ConsolidationReport';
import ReportGroupLinkCell from './ReportGroupLinkCell';
import { NO_LIST_PICKS, reportListLink, windowFilter } from './reportListLink';
import { resetListContextCache } from '../../lib/listContext';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;
const Y = new Date().getFullYear();

const everyColumn = <T,>(value: T) => Object.fromEntries(AMOUNT_COLUMNS.map((column) => [column.key, value]));
const flat = (value: number) => Array.from({ length: 12 }, () => value);

function axis(id: string, patch: Partial<AnalyticsAxis>): AnalyticsAxis {
  return { id, code: id, name: null, description: null, sort_order: 0, is_default: false, applies_to: null, status: 'enabled', disabled_at: null, ...patch };
}
const DEFAULT_AXIS = axis('ax-def', { is_default: true });
const NATURE = axis('ax-nat', { name: 'Nature', sort_order: 1 });

function node(id: string, code: string, name: string, kind: CostCenterNode['kind'], parent: string | null): CostCenterNode {
  return {
    id, code, name, kind, parent_id: parent, company_id: null, company_name: null, owner_user_id: null, owner_name: null,
    status: 'enabled', disabled_at: null, sort_order: 0, depth: parent ? 1 : 0, path: name, path_ids: [id],
  };
}
// IT holds CC1 and CC2; CC3 is outside it.
const NODES = [
  node('it', 'IT', 'Information', 'group', null),
  node('cc1', 'CC1', 'Ops', 'cost_center', 'it'),
  node('cc2', 'CC2', 'Dev', 'cost_center', 'it'),
  node('cc3', 'CC3', 'Data', 'cost_center', null),
];

/** A line of the current year: its FTE every month, its staff lines' cost and FTE, the days they buy. */
function line(
  id: string,
  costCenter: [string, string] | null,
  supplier: [string, string] | null,
  fte: number,
  extra: { runBuild?: 'run' | 'build' | null; area?: [string, string]; nature?: [string, string]; account?: [string, string] } = {},
) {
  return {
    id,
    product_name: `Line ${id}`,
    description: `Line ${id}`,
    cost_center_id: costCenter?.[0] ?? null,
    cost_center_label: costCenter?.[1] ?? null,
    supplier_id: supplier?.[0] ?? null,
    supplier_name: supplier?.[1] ?? null,
    run_build: extra.runBuild ?? null,
    account_id: extra.account?.[0] ?? null,
    account_display: extra.account?.[1] ?? null,
    analytics_value_ids: {
      ...(extra.area ? { 'ax-def': extra.area[0] } : {}),
      ...(extra.nature ? { 'ax-nat': extra.nature[0] } : {}),
    },
    'analytics_ax-def': extra.area?.[1] ?? null,
    analytics_category_name: extra.area?.[1] ?? null,
    'analytics_ax-nat': extra.nature?.[1] ?? null,
    versions: {
      y: {
        year: Y,
        totals: everyColumn(1000),
        fte: everyColumn(fte),
        fte_months: everyColumn(flat(fte)),
        staff_cost: everyColumn(fte * 100000),
        staff_fte: everyColumn(fte),
        day_cost: everyColumn(fte * 100000),
        days: everyColumn(fte * 200),
      },
      yMinus1: { year: Y - 1, totals: everyColumn(0) },
    } as Record<string, any>,
  };
}

// a and b on two accounts of the consolidation line [600] IT; d on an account without one; c without an account.
const ROWS = [
  line('a', ['cc1', 'CC1 · Ops'], ['s1', 'Acme'], 2, { runBuild: 'run', area: ['v-cloud', 'Cloud'], nature: ['n-hw', 'Hardware'], account: ['acc1', '6110 - Software'] }),
  line('b', ['cc2', 'CC2 · Dev'], ['s2', 'Globex'], 1, { runBuild: 'build', area: ['v-apps', 'Apps'], account: ['acc2', '6120 - Cloud'] }),
  line('c', null, null, 0.5, { runBuild: 'run' }),
  line('d', ['cc3', 'CC3 · Data'], ['s1', 'Acme'], 0.25, { runBuild: 'run', area: ['v-cloud', 'Cloud'], account: ['acc3', '6300 - Other'] }),
];
const ACCOUNTS = [
  { id: 'acc1', consolidation_account_number: 600, consolidation_account_name: 'IT' },
  { id: 'acc2', consolidation_account_number: 600, consolidation_account_name: 'IT' },
  { id: 'acc3' },
];
/** The accounts the fake server reads: none for a caller who cannot read them (every line unassigned). */
let serverAccounts: typeof ACCOUNTS | undefined = ACCOUNTS;

let restoreCanvas: (() => void) | null = null;

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

beforeEach(() => {
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  restoreCanvas = () => getContext.mockRestore();
  setBudgetColumns();
  treeState.nodes = NODES;
  serverAccounts = ACCOUNTS;
  axesState.list = [DEFAULT_AXIS, NATURE];
  get.mockReset();
  get.mockImplementation(async (url: string, config?: { params?: Record<string, string> }) => {
    if (url.endsWith('/summary/filter-values')) return { data: fakeFilterValues(ROWS, String(config?.params?.fields ?? '').split(',')) };
    return { data: { items: [], total: 0 } };
  });
  post.mockReset();
  post.mockImplementation(async (url: string, body: any) => {
    if (url.endsWith('/summary/aggregate')) return { data: fakeAggregate(ROWS, body, { accounts: serverAccounts }) };
    throw new Error(`unexpected POST ${url}`);
  });
});

afterEach(() => {
  restoreCanvas?.();
  restoreCanvas = null;
});

const set = (values: Array<string | null>) => ({ filterType: 'set', values });
/**
 * The filters of every link: the report's window (no `years`, or last year as the first pair: the
 * lines still active on 1 January of last year), then the row's own.
 */
const listed = (filters: Record<string, unknown>) => ({ disabled_at: windowFilter(Y - 1), ...filters });
/** The same for a row that counts only the lines declaring FTE. */
const staffed = (filters: Record<string, unknown>) => listed({ has_fte: set(['yes']), ...filters });

/** The link of a row, in a new tab, the list filters its address carries and its Show scope. */
async function linkOf(name: string) {
  // The grid may remount (a new value width): read it afresh each time.
  const link = await waitFor(() => within(screen.getByTestId('grid')).getByRole('link', { name }));
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  const href = link.getAttribute('href') ?? '';
  const [path, search] = href.split('?');
  const params = new URLSearchParams(search ?? '');
  const filters = search ? JSON.parse(params.get('filters') ?? 'null') : null;
  if (filters) {
    expect(params.get('statusScope')).toBe('all');
    // A one-off view: the list leaves the tab's remembered state alone.
    expect(params.get('from')).toBe('report');
  }
  return { href, path, filters };
}

async function expectPlainTotal() {
  const pinned = await screen.findByTestId('pinned');
  expect(within(pinned).queryByRole('link')).toBeNull();
  expect(pinned.textContent).toBe('reports.columns.total');
}

describe('Staffing by month group links', () => {
  it('a cost center opens the OPEX list on every status, its window, FTE declared and the cost center; No cost center on blank', async () => {
    renderReport(<StaffingByMonthReport />, '/report');
    const filters = staffed({ cost_center_label: set(['CC1 · Ops']) });
    expect(await linkOf('CC1 · Ops')).toEqual({
      href: `/ops/opex?${new URLSearchParams({ filters: JSON.stringify(filters), statusScope: 'all', from: 'report' })}`,
      path: '/ops/opex',
      filters,
    });
    expect((await linkOf('reports.staffing.none.costCenter')).filters).toEqual(staffed({ cost_center_label: set([null]) }));
    await expectPlainTotal();
  });

  it("the bar's picks follow: the cost center node's cost centers, run or build, a dimension value, Items with FTE", async () => {
    renderReport(<StaffingByMonthReport />, '/report?group=supplier&costCenter=it&runBuild=run&fte=with&analytics=ax-nat:n-hw');
    expect((await linkOf('Acme')).filters).toEqual(listed({
      cost_center_label: set(['CC1 · Ops', 'CC2 · Dev']),
      run_build: set(['run']),
      'analytics_ax-nat': set(['Hardware']),
      has_fte: set(['yes']),
      supplier_name: set(['Acme']),
    }));
  });

  it('a supplier row and No supplier, on the CAPEX list', async () => {
    renderReport(<StaffingByMonthReport />, '/report?scope=capex&group=supplier');
    const acme = await linkOf('Acme');
    expect(acme.path).toBe('/ops/capex');
    expect(acme.filters).toEqual(staffed({ supplier_name: set(['Acme']) }));
    expect((await linkOf('reports.staffing.none.supplier')).filters).toEqual(staffed({ supplier_name: set([null]) }));
  });

  it('a dimension value filters its dimension column: the default one, and a value picked as none', async () => {
    renderReport(<StaffingByMonthReport />, '/report?group=axis:ax-def&analytics=ax-nat:none');
    expect((await linkOf('Apps')).filters).toEqual(staffed({ 'analytics_ax-nat': set([null]), analytics_category_name: set(['Apps']) }));
    expect((await linkOf('reports.staffing.none.axis')).filters).toEqual(staffed({ 'analytics_ax-nat': set([null]), analytics_category_name: set([null]) }));
  });

  it('a cost center row under the picked node keeps its own cost center only', async () => {
    renderReport(<StaffingByMonthReport />, '/report?costCenter=it');
    expect((await linkOf('CC2 · Dev')).filters).toEqual(staffed({ cost_center_label: set(['CC2 · Dev']) }));
  });

  it('an item opens its page', async () => {
    renderReport(<StaffingByMonthReport />, '/report?group=item');
    expect((await linkOf('Line a')).href).toBe('/ops/opex/a');
    await expectPlainTotal();
  });
});

describe('Cost per FTE group links', () => {
  it('cost per FTE view: a cost center opens the list of its FTE lines in the window, the total stays plain', async () => {
    renderReport(<CostPerFteReport />, '/report?runBuild=build');
    expect((await linkOf('CC2 · Dev')).filters).toEqual(staffed({ run_build: set(['build']), cost_center_label: set(['CC2 · Dev']) }));
    await expectPlainTotal();
  });

  it('daily rate view: a dimension value and an item', async () => {
    const view = renderReport(<CostPerFteReport />, '/report?view=rate&group=axis:ax-nat');
    expect((await linkOf('Hardware')).filters).toEqual(staffed({ 'analytics_ax-nat': set(['Hardware']) }));
    view.unmount();
    renderReport(<CostPerFteReport />, '/report?view=rate&group=item&scope=capex');
    expect((await linkOf('Line b')).href).toBe('/ops/capex/b');
    await expectPlainTotal();
  });
});

describe('Analytics dimensions report value links', () => {
  it('each value opens the list filtered on it, the bar and the window; the unassigned row on blank; totals plain', async () => {
    renderReport(<AnalyticsCategoryReport />, '/report?fte=with');
    expect((await linkOf('Cloud')).filters).toEqual(listed({ has_fte: set(['yes']), analytics_category_name: set(['Cloud']) }));
    expect((await linkOf('reports.analyticsCategory.unassigned')).filters).toEqual(listed({ has_fte: set(['yes']), analytics_category_name: set([null]) }));
    const pinned = await screen.findByTestId('pinned');
    expect(within(pinned).queryByRole('link')).toBeNull();
  });

  it('on another dimension, its own column; an amount measure keeps every line', async () => {
    renderReport(<AnalyticsCategoryReport />, '/report?axis=ax-nat');
    expect((await linkOf('Hardware')).filters).toEqual(listed({ 'analytics_ax-nat': set(['Hardware']) }));
  });

  it('the FTE measure adds FTE declared', async () => {
    renderReport(<AnalyticsCategoryReport />, '/report?measure=fte');
    expect((await linkOf('Cloud')).filters).toEqual(staffed({ analytics_category_name: set(['Cloud']) }));
  });
});

describe('Consolidation accounts report line links', () => {
  const accountRequests = () => post.mock.calls.filter(([, body]) => body.spec.groupBy.includes('account_id'));
  const reportRequests = () => post.mock.calls.filter(([, body]) => body.spec.groupBy[1] === 'account_consolidation_label');

  it('a consolidation line opens the list on the ids of its accounts and the bar; totals plain', async () => {
    renderReport(<ConsolidationReport />, '/report?runBuild=build');
    expect((await linkOf('[600] IT')).filters).toEqual(listed({ run_build: set(['build']), account_id: set(['acc2']) }));
    const pinned = await screen.findByTestId('pinned');
    expect(within(pinned).queryByRole('link')).toBeNull();
    // The second request reads the same filters as the report's own, grouped by consolidation line and account.
    const accounts = accountRequests()[accountRequests().length - 1][1];
    expect(accounts.query).toEqual(reportRequests()[reportRequests().length - 1][1].query);
    expect(accounts.spec).toEqual({ groupBy: ['account_consolidation_key', 'account_id'], measures: [] });
  });

  it('every account of a line, the unassigned row with blank, and FTE declared with the FTE measure', async () => {
    const view = renderReport(<ConsolidationReport />, '/report');
    const it600 = await linkOf('[600] IT');
    expect(it600.filters.account_id.values.slice().sort()).toEqual(['acc1', 'acc2']);
    expect(it600.filters).not.toHaveProperty('has_fte');
    const unassigned = await linkOf('reports.consolidation.unassigned');
    expect(Object.keys(unassigned.filters).sort()).toEqual(['account_id', 'disabled_at']);
    expect(unassigned.filters.account_id.values).toHaveLength(2);
    expect(unassigned.filters.account_id.values).toEqual(expect.arrayContaining(['acc3', null]));
    view.unmount();
    renderReport(<ConsolidationReport />, '/report?measure=fte');
    expect((await linkOf('[600] IT')).filters.has_fte).toEqual(set(['yes']));
  });

  it('a caller who cannot read accounts: the one unassigned row opens the list on every account and blank', async () => {
    serverAccounts = undefined;
    renderReport(<ConsolidationReport />, '/report');
    const unassigned = await linkOf('reports.consolidation.unassigned');
    expect(unassigned.filters.account_id.values.slice().sort((a: string | null, b: string | null) => String(a).localeCompare(String(b))))
      .toEqual(['acc1', 'acc2', 'acc3', null].sort((a, b) => String(a).localeCompare(String(b))));
  });

  it('asks the accounts only once the report has rows', async () => {
    renderReport(<ConsolidationReport />, '/report?runBuild=none');
    await waitFor(() => expect(reportRequests().length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(accountRequests()).toHaveLength(0);
  });
});

describe('a group link whose filters are too long for a URL', () => {
  const labels = Array.from({ length: 80 }, (_, i) => `CC${100 + i} · Cost center number ${i}`);
  const getLink = () => reportListLink('opex', { kind: 'supplier', name: 'Acme' }, { ...NO_LIST_PICKS, costCenterLabels: labels }, { firstYear: Y - 1, fteOnly: false });
  let tab: { opener: unknown; location: { href: string } };
  let open: MockInstance<typeof window.open>;

  beforeEach(() => {
    resetListContextCache();
    post.mockImplementation(async (url: string) => {
      if (url === '/list-contexts') return { data: { id: 'ctx-42' } };
      throw new Error(`unexpected POST ${url}`);
    });
    tab = { opener: window, location: { href: '' } };
    open = vi.spyOn(window, 'open').mockImplementation(() => tab as unknown as Window);
  });
  afterEach(() => open.mockRestore());

  const saves = () => post.mock.calls.filter(([url]) => url === '/list-contexts');
  const renderCell = () => render(<ReportGroupLinkCell {...({ value: 'Acme', data: { groupName: 'Acme' }, colDef: {} } as any)} getLink={getLink} />);

  it('carries them inline (a copyable link) and saves nothing on hover or focus', async () => {
    renderCell();
    const link = screen.getByRole('link', { name: 'Acme' });
    expect(link.getAttribute('href')).toMatch(/^\/ops\/opex\?filters=.*statusScope=all&from=report$/);
    expect(link).toHaveAttribute('target', '_blank');
    fireEvent.mouseEnter(link);
    fireEvent.mouseOver(link);
    fireEvent.focus(link);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(saves()).toHaveLength(0);
    expect(open).not.toHaveBeenCalled();
  });

  it('a click (or Enter, which clicks) opens a tab at once, saves, then sends the tab to the ctx address', async () => {
    renderCell();
    const link = screen.getByRole('link', { name: 'Acme' });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    await act(async () => { link.dispatchEvent(click); });
    expect(click.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(tab.opener).toBeNull();
    await waitFor(() => expect(tab.location.href).toBe('/ops/opex?statusScope=all&from=report&ctx=ctx-42'));
    expect(saves()).toHaveLength(1);
    // Saved: the link itself now carries the short address.
    await waitFor(() => expect(screen.getByRole('link', { name: 'Acme' })).toHaveAttribute('href', '/ops/opex?statusScope=all&from=report&ctx=ctx-42'));
  });

  it('a middle click does the same; a right click (copy link) does nothing', async () => {
    renderCell();
    const link = screen.getByRole('link', { name: 'Acme' });
    const right = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 2 });
    await act(async () => { link.dispatchEvent(right); });
    expect(right.defaultPrevented).toBe(false);
    expect(saves()).toHaveLength(0);
    const middle = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });
    await act(async () => { link.dispatchEvent(middle); });
    expect(middle.defaultPrevented).toBe(true);
    await waitFor(() => expect(tab.location.href).toBe('/ops/opex?statusScope=all&from=report&ctx=ctx-42'));
  });

  it('a failed save sends the tab to the inline address', async () => {
    post.mockImplementation(async () => { throw new Error('429'); });
    renderCell();
    const link = screen.getByRole('link', { name: 'Acme' });
    const inline = link.getAttribute('href');
    await act(async () => { fireEvent.click(link); });
    await waitFor(() => expect(tab.location.href).toBe(inline));
  });

  it('short filters: a plain link, no handler, no save', async () => {
    const short = () => reportListLink('opex', { kind: 'supplier', name: 'Acme' }, NO_LIST_PICKS, { firstYear: Y - 1, fteOnly: false });
    render(<ReportGroupLinkCell {...({ value: 'Acme', data: { groupName: 'Acme' }, colDef: {} } as any)} getLink={short} />);
    const link = screen.getByRole('link', { name: 'Acme' });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    await act(async () => { link.dispatchEvent(click); });
    expect(click.defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(saves()).toHaveLength(0);
  });
});
