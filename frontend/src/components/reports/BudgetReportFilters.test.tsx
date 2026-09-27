import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import type { TFunction } from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import type { CostCenterNode } from '../../services/costCenters';
import type { AnalyticsAxis } from '../../services/analytics';

vi.mock('../../api', () => ({ default: { get: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => false }) }));
const treeState = vi.hoisted(() => ({ nodes: [] as unknown[], ready: true, isError: false }));
vi.mock('../../hooks/useCostCenterTree', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useCostCenterTree')>();
  return {
    ...actual,
    useCostCenterTree: () => ({
      ...actual.buildCostCenterTree(treeState.nodes as CostCenterNode[], treeState.ready),
      isError: treeState.isError,
    }),
  };
});

const axesState = vi.hoisted(() => ({ list: [] as unknown[], ready: true, isError: false }));
vi.mock('../../hooks/useAnalyticsAxes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useAnalyticsAxes')>();
  const { useMemo } = await import('react');
  const t = ((key: string) => (key === 'master-data:analytics.analyticsCategoryFallback' ? 'Analytics dimension' : key)) as unknown as TFunction;
  return {
    ...actual,
    useAnalyticsAxes: () => {
      const { list, ready, isError } = axesState;
      return useMemo(() => actual.buildAnalyticsAxes(list as AnalyticsAxis[], t, ready, isError), [list, ready, isError]);
    },
  };
});

import api from '../../api';
import {
  BudgetReportFilters,
  type BudgetReportFilterRow,
  filterBudgetRows,
  parseAnalyticsParam,
  useBudgetReportFilters,
} from './BudgetReportFilters';
import { buildCostCenterTree } from '../../hooks/useCostCenterTree';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;

function node(id: string, patch: Partial<CostCenterNode>): CostCenterNode {
  return {
    id,
    code: id.toUpperCase(),
    name: `Node ${id}`,
    kind: 'cost_center',
    parent_id: null,
    company_id: 'co-1',
    company_name: 'Company',
    owner_user_id: null,
    owner_name: null,
    status: 'enabled',
    disabled_at: null,
    sort_order: 0,
    depth: 0,
    path: `Node ${id}`,
    path_ids: [id],
    ...patch,
  };
}

// grp › (cc1, cc2 disabled, sub › cc3); out stands alone.
const NODES: CostCenterNode[] = [
  node('grp', { kind: 'group', company_id: null, name: 'IT department' }),
  node('cc1', { parent_id: 'grp', depth: 1, path_ids: ['grp', 'cc1'] }),
  node('cc2', { parent_id: 'grp', depth: 1, path_ids: ['grp', 'cc2'], status: 'disabled' }),
  node('sub', { kind: 'group', company_id: null, parent_id: 'grp', depth: 1, path_ids: ['grp', 'sub'] }),
  node('cc3', { parent_id: 'sub', depth: 2, path_ids: ['grp', 'sub', 'cc3'] }),
  node('out', {}),
];

function axis(id: string, patch: Partial<AnalyticsAxis>): AnalyticsAxis {
  return { id, code: id, name: null, description: null, sort_order: 0, is_default: false, status: 'enabled', disabled_at: null, ...patch };
}

// The default dimension has no name of its own; Activity is enabled but no line holds a value on it.
const AXES: AnalyticsAxis[] = [
  axis('ax-nat', { name: 'Nature', sort_order: 1 }),
  axis('ax-def', { is_default: true, sort_order: 0 }),
  axis('ax-off', { name: 'Old split', sort_order: 2, status: 'disabled', disabled_at: '2020-01-01T00:00:00.000Z' }),
  axis('ax-idle', { name: 'Activity', sort_order: 3 }),
];

type Row = BudgetReportFilterRow & { id: string } & Record<string, unknown>;

/** A line's values as the summary sends them: ids by dimension, and each value's name under its field. */
function values(pairs: Record<string, [string, string]>) {
  const out: Record<string, unknown> = { analytics_value_ids: {} };
  for (const [axisId, [id, name]] of Object.entries(pairs)) {
    (out.analytics_value_ids as Record<string, string>)[axisId] = id;
    out[`analytics_${axisId}`] = name;
  }
  return out;
}

const ROWS: Row[] = [
  { id: 'a', cost_center_id: 'cc1', run_build: 'run', ...values({ 'ax-def': ['v-lic', 'Licences'], 'ax-nat': ['n-hw', 'Hardware'], 'ax-off': ['o-1', 'Old'] }) },
  { id: 'b', cost_center_id: 'cc2', run_build: 'build', ...values({ 'ax-def': ['v-lic', 'Licences'] }) },
  { id: 'c', cost_center_id: 'cc3', run_build: null, ...values({ 'ax-def': ['v-srv', 'Services'], 'ax-nat': ['n-sw', 'Software'] }) },
  { id: 'd', cost_center_id: 'out', run_build: 'run', analytics_value_ids: {} },
  { id: 'e', cost_center_id: null, run_build: 'build', ...values({ 'ax-nat': ['n-hw', 'Hardware'] }) },
  { id: 'f' },
];

const ids = (rows: Row[] | undefined) => (rows ?? []).map((row) => row.id);

describe('filterBudgetRows', () => {
  const tree = buildCostCenterTree(NODES);

  it('keeps the lines of a group and of every node below it, disabled ones included', () => {
    expect(ids(filterBudgetRows(ROWS, { costCenterIds: tree.descendantIds('grp'), runBuild: null }))).toEqual(['a', 'b', 'c']);
    expect(ids(filterBudgetRows(ROWS, { costCenterIds: tree.descendantIds('sub'), runBuild: null }))).toEqual(['c']);
    expect(ids(filterBudgetRows(ROWS, { costCenterIds: tree.descendantIds('cc2'), runBuild: null }))).toEqual(['b']);
  });

  it('reads run, build and not set, alone or with a node', () => {
    expect(ids(filterBudgetRows(ROWS, { costCenterIds: null, runBuild: 'run' }))).toEqual(['a', 'd']);
    expect(ids(filterBudgetRows(ROWS, { costCenterIds: null, runBuild: 'build' }))).toEqual(['b', 'e']);
    expect(ids(filterBudgetRows(ROWS, { costCenterIds: null, runBuild: 'none' }))).toEqual(['c', 'f']);
    expect(ids(filterBudgetRows(ROWS, { costCenterIds: tree.descendantIds('grp'), runBuild: 'none' }))).toEqual(['c']);
  });

  it('returns the same lines when nothing is picked', () => {
    expect(filterBudgetRows(ROWS, { costCenterIds: null, runBuild: null })).toBe(ROWS);
    expect(filterBudgetRows(ROWS, { costCenterIds: null, runBuild: null, analytics: new Map() })).toBe(ROWS);
  });

  it('keeps the lines holding the picked value, or no value, on each picked dimension', () => {
    const pick = (entries: Array<[string, string]>) => new Map(entries);
    expect(ids(filterBudgetRows(ROWS, { costCenterIds: null, runBuild: null, analytics: pick([['ax-nat', 'n-hw']]) }))).toEqual(['a', 'e']);
    expect(ids(filterBudgetRows(ROWS, { costCenterIds: null, runBuild: null, analytics: pick([['ax-nat', 'none']]) }))).toEqual(['b', 'd', 'f']);
    expect(ids(filterBudgetRows(ROWS, {
      costCenterIds: null, runBuild: null, analytics: pick([['ax-def', 'v-lic'], ['ax-nat', 'none']]),
    }))).toEqual(['b']);
    expect(ids(filterBudgetRows(ROWS, { costCenterIds: null, runBuild: 'run', analytics: pick([['ax-def', 'v-lic']]) }))).toEqual(['a']);
  });
});

describe('parseAnalyticsParam', () => {
  it('reads dimension and value pairs, skips malformed ones and keeps the first pair of a dimension', () => {
    expect(Array.from(parseAnalyticsParam('a:v1,b:none,:x,c:,d,a:v2'))).toEqual([['a', 'v1'], ['b', 'none']]);
    expect(parseAnalyticsParam(null).size).toBe(0);
  });
});

const seen = vi.hoisted(() => ({ search: '', kept: [] as string[], navigation: '' }));

function Harness({ rows }: { rows: Row[] }) {
  const filters = useBudgetReportFilters();
  const location = useLocation();
  seen.search = location.search;
  seen.navigation = useNavigationType();
  seen.kept = ids(filters.filterRows(rows));
  return (
    <div data-testid="bar">
      <BudgetReportFilters filters={filters} rows={rows} />
    </div>
  );
}

function renderBar(path: string, rows: Row[] = ROWS) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={[path]}>
          <Harness rows={rows} />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const costCenterInput = () => within(screen.getByTestId('bar')).queryByPlaceholderText('All cost centers') as HTMLInputElement | null;
const runBuildSelect = () => screen.queryByRole('combobox', { name: 'Run or build' });
const DIMENSION_NAMES = /^(Analytics dimension|Nature|Old split|Activity)$/;
const dimensionSelects = () => screen.queryAllByRole('combobox', { name: DIMENSION_NAMES }).map((el) => el.getAttribute('aria-label'));
const dimensionSelect = (name: string) => screen.getByRole('combobox', { name });
const analyticsParam = () => new URLSearchParams(seen.search).get('analytics');

beforeEach(() => {
  treeState.nodes = NODES;
  treeState.ready = true;
  treeState.isError = false;
  axesState.list = AXES;
  axesState.ready = true;
  axesState.isError = false;
  get.mockReset();
  seen.search = '';
  seen.kept = [];
  seen.navigation = '';
});

describe('BudgetReportFilters', () => {
  it('renders nothing when the tenant has no node and no line says run or build', () => {
    treeState.nodes = [];
    renderBar('/report', [{ id: 'x', cost_center_id: null, run_build: null }]);
    expect(screen.getByTestId('bar')).toBeEmptyDOMElement();
    expect(seen.kept).toEqual(['x']);
  });

  it('shows the run or build picker without nodes when a line has a value, or when the address asks', () => {
    treeState.nodes = [];
    const view = renderBar('/report', [{ id: 'x', run_build: 'build' }]);
    expect(runBuildSelect()).toBeInTheDocument();
    expect(costCenterInput()).toBeNull();
    view.unmount();

    renderBar('/report?runBuild=none', [{ id: 'x', run_build: null }]);
    expect(runBuildSelect()?.textContent).toBe('Not set');
  });

  it('shows the node picker, and not the run or build one, when no line has a value', () => {
    renderBar('/report', [{ id: 'x', cost_center_id: 'cc1', run_build: null }]);
    expect(costCenterInput()).toBeInTheDocument();
    expect(runBuildSelect()).toBeNull();
  });

  it('reads a group from the address and keeps the lines below it', () => {
    renderBar('/report?costCenter=grp');
    expect(costCenterInput()?.value).toBe('GRP · IT department');
    expect(seen.kept).toEqual(['a', 'b', 'c']);
  });

  it('shows no line until the tree is loaded', () => {
    treeState.ready = false;
    renderBar('/report?costCenter=grp');
    expect(seen.kept).toEqual([]);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows no line and says why for a node the tree does not hold, and clears it', async () => {
    renderBar('/report?costCenter=gone&scope=capex');
    expect(costCenterInput()?.value).toBe('');
    expect(seen.kept).toEqual([]);
    expect(screen.getByRole('status').textContent).toContain('This cost center no longer exists or could not be loaded.');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear filter' })); });
    expect(new URLSearchParams(seen.search).has('costCenter')).toBe(false);
    expect(new URLSearchParams(seen.search).get('scope')).toBe('capex');
    expect(seen.navigation).toBe('REPLACE');
    expect(seen.kept).toEqual(ids(ROWS));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows no line and says why when the tree failed to load, even with nothing else to show', () => {
    treeState.nodes = [];
    treeState.isError = true;
    renderBar('/report?costCenter=grp', [{ id: 'x', cost_center_id: 'cc1', run_build: null }]);
    expect(seen.kept).toEqual([]);
    expect(costCenterInput()).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('This cost center no longer exists or could not be loaded.');
  });

  it('does not filter or complain about a failed tree when the address names no node', () => {
    treeState.nodes = [];
    treeState.isError = true;
    renderBar('/report', [{ id: 'x', cost_center_id: 'cc1', run_build: null }]);
    expect(seen.kept).toEqual(['x']);
    expect(screen.getByTestId('bar')).toBeEmptyDOMElement();
  });

  it('writes both picks to the address and clears them', async () => {
    renderBar('/report?scope=capex');

    const input = costCenterInput() as HTMLInputElement;
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'sub' } });
    // A group is a pick in a report; the search keeps its ancestors so the list still reads as a tree.
    const option = await screen.findByTestId('cost-center-option-sub');
    fireEvent.click(option);
    expect(new URLSearchParams(seen.search).get('costCenter')).toBe('sub');
    // Filter changes replace the entry: Back leaves the report instead of stepping through picks.
    expect(seen.navigation).toBe('REPLACE');
    expect(new URLSearchParams(seen.search).get('scope')).toBe('capex');
    expect(seen.kept).toEqual(['c']);

    const select = runBuildSelect() as HTMLElement;
    fireEvent.mouseDown(select);
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getAllByRole('option').map((o) => o.textContent)).toEqual(['All', 'Run', 'Build', 'Not set']);
    fireEvent.click(within(listbox).getByRole('option', { name: 'Not set' }));
    expect(new URLSearchParams(seen.search).get('runBuild')).toBe('none');
    expect(seen.navigation).toBe('REPLACE');
    expect(seen.kept).toEqual(['c']);

    fireEvent.mouseDown(runBuildSelect() as HTMLElement);
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Build' }));
    expect(new URLSearchParams(seen.search).get('runBuild')).toBe('build');
    expect(seen.kept).toEqual([]);

    fireEvent.mouseDown(runBuildSelect() as HTMLElement);
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'All' }));
    expect(new URLSearchParams(seen.search).has('runBuild')).toBe(false);

    const clear = within(screen.getByTestId('bar')).getByTitle('Clear');
    await act(async () => { fireEvent.click(clear); });
    expect(new URLSearchParams(seen.search).has('costCenter')).toBe(false);
    expect(seen.kept).toEqual(ids(ROWS));
  });

  it('lists a disabled node and lets a report pick it', async () => {
    renderBar('/report');
    const input = costCenterInput() as HTMLInputElement;
    fireEvent.mouseDown(input);
    const option = await screen.findByTestId('cost-center-option-cc2');
    expect(option.closest('li')).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(option);
    expect(new URLSearchParams(seen.search).get('costCenter')).toBe('cc2');
    expect(seen.kept).toEqual(['b']);
  });
});

describe('BudgetReportFilters dimensions', () => {
  it('shows one select per enabled dimension a line holds a value on, in dimension order, named after it', () => {
    renderBar('/report');
    // The default dimension has no name: it reads as the translated default label. Old split is
    // disabled, and no line holds an Activity value.
    expect(dimensionSelects()).toEqual(['Analytics dimension', 'Nature']);
    expect(dimensionSelect('Nature').textContent).toBe('All');
  });

  it('offers the values the lines hold, by name, then no value', async () => {
    renderBar('/report', ROWS.filter((row) => row.id !== 'e'));
    fireEvent.mouseDown(dimensionSelect('Nature'));
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getAllByRole('option').map((o) => o.textContent)).toEqual(['All', 'Hardware', 'Software', 'No value']);
  });

  it('shows a dimension the address names although no line holds a value on it', () => {
    renderBar('/report?analytics=ax-idle:none');
    expect(dimensionSelects()).toEqual(['Analytics dimension', 'Nature', 'Activity']);
    expect(dimensionSelect('Activity').textContent).toBe('No value');
    expect(seen.kept).toEqual(ids(ROWS));
  });

  it('writes each pick to the address, replacing the entry, and clears them', () => {
    renderBar('/report?scope=capex');

    fireEvent.mouseDown(dimensionSelect('Nature'));
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Hardware' }));
    expect(analyticsParam()).toBe('ax-nat:n-hw');
    expect(seen.navigation).toBe('REPLACE');
    expect(new URLSearchParams(seen.search).get('scope')).toBe('capex');
    expect(seen.kept).toEqual(['a', 'e']);

    fireEvent.mouseDown(dimensionSelect('Analytics dimension'));
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Licences' }));
    expect(analyticsParam()).toBe('ax-nat:n-hw,ax-def:v-lic');
    expect(seen.kept).toEqual(['a']);

    fireEvent.mouseDown(dimensionSelect('Nature'));
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'No value' }));
    expect(analyticsParam()).toBe('ax-nat:none,ax-def:v-lic');
    expect(seen.kept).toEqual(['b']);

    fireEvent.mouseDown(dimensionSelect('Nature'));
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'All' }));
    expect(analyticsParam()).toBe('ax-def:v-lic');
    expect(seen.kept).toEqual(['a', 'b']);

    fireEvent.mouseDown(dimensionSelect('Analytics dimension'));
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'All' }));
    expect(new URLSearchParams(seen.search).has('analytics')).toBe(false);
    expect(seen.navigation).toBe('REPLACE');
    expect(seen.kept).toEqual(ids(ROWS));
  });

  it('reads the picks from the address and ignores a pair naming an unknown or disabled dimension', () => {
    // No line holds x1 on Old split: applied, the pair would keep nothing.
    renderBar('/report?analytics=ax-off:x1,gone:v-1,ax-nat:none');
    expect(seen.kept).toEqual(['b', 'd', 'f']);
    expect(dimensionSelects()).toEqual(['Analytics dimension', 'Nature']);
    expect(dimensionSelect('Nature').textContent).toBe('No value');
  });

  it('shows no line until the dimensions are loaded when the address names one', () => {
    axesState.ready = false;
    axesState.list = [];
    const view = renderBar('/report?analytics=ax-nat:n-hw');
    expect(seen.kept).toEqual([]);
    expect(dimensionSelects()).toEqual([]);
    view.unmount();

    renderBar('/report');
    expect(seen.kept).toEqual(ids(ROWS));
  });

  it('shows no line and says why when the dimensions failed to load, and clears the picks', async () => {
    axesState.list = [];
    axesState.isError = true;
    renderBar('/report?analytics=ax-nat:n-hw,ax-def:none&scope=capex');
    expect(seen.kept).toEqual([]);
    expect(dimensionSelects()).toEqual([]);
    expect(screen.getByRole('status').textContent).toContain('The analytics filter could not be applied. Clear it or try again.');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear filter' })); });
    expect(new URLSearchParams(seen.search).has('analytics')).toBe(false);
    expect(new URLSearchParams(seen.search).get('scope')).toBe('capex');
    expect(seen.navigation).toBe('REPLACE');
    expect(seen.kept).toEqual(ids(ROWS));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says why even with nothing else to show, and stays quiet when the address names no value', () => {
    treeState.nodes = [];
    axesState.list = [];
    axesState.isError = true;
    const plain = [{ id: 'x', cost_center_id: null, run_build: null }];
    const view = renderBar('/report?analytics=ax-nat:n-hw', plain);
    expect(seen.kept).toEqual([]);
    expect(screen.getByRole('status').textContent).toContain('The analytics filter could not be applied.');
    view.unmount();

    renderBar('/report', plain);
    expect(seen.kept).toEqual(['x']);
    expect(screen.getByTestId('bar')).toBeEmptyDOMElement();
  });

  it('names a picked value that no line holds from the value itself', async () => {
    get.mockResolvedValue({ data: { id: 'n-gone', axis_id: 'ax-nat', name: 'Travel' } });
    renderBar('/report?analytics=ax-nat:n-gone');
    expect(seen.kept).toEqual([]);
    expect(await within(dimensionSelect('Nature')).findByText('Travel')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/analytics-categories/n-gone');
  });
});
