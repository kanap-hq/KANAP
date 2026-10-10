import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../api', () => ({ default: { get: vi.fn() } }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../components/PageHeader', () => ({ default: () => null }));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({ default: () => null }));
const grid = vi.fn();
vi.mock('../components/ServerDataGrid', async (importOriginal) => {
  const { useEffect } = await import('react');
  const { useLocation } = await import('react-router-dom');
  return {
    ...(await importOriginal<typeof import('../components/ServerDataGrid')>()),
    default: function GridMock(props: any) {
      grid(props);
      const search = useLocation().search;
      // Like the real grid once it is ready: it hands its API over, then reports the query it starts with.
      useEffect(() => {
        const { field, direction } = props.defaultSort;
        props.onGridApiReady?.({ getColumnState: () => [] });
        props.onQueryStateChange?.({
          sort: new URLSearchParams(search).get('sort') || `${field}:${direction}`,
          filterModel: props.initialState?.filter?.filterModel ?? {},
          q: '',
          statusScope: 'enabled',
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return null;
    },
  };
});

// The tenant's dimensions, set per test; the hook's own core orders them and names the default.
// A small store, so a test can let the dimensions arrive after the first render.
const dimensions = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const store = {
    list: [] as unknown[],
    ready: true,
    set(next: { list?: unknown[]; ready?: boolean }) {
      Object.assign(store, next);
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  return store;
});
vi.mock('../hooks/useAnalyticsAxes', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../hooks/useAnalyticsAxes')>();
  const { useSyncExternalStore } = await import('react');
  const t = ((key: string) => key) as unknown as Parameters<typeof mod.buildAnalyticsAxes>[1];
  type Scope = 'opex' | 'capex' | null;
  let cache: { list: unknown[]; ready: boolean; scope: Scope; value: ReturnType<typeof mod.buildAnalyticsAxes> } | null = null;
  const snapshot = (scope: Scope) => {
    if (!cache || cache.list !== dimensions.list || cache.ready !== dimensions.ready || cache.scope !== scope) {
      cache = { list: dimensions.list, ready: dimensions.ready, scope, value: mod.buildAnalyticsAxes(dimensions.list as never, t, dimensions.ready, false, undefined, scope) };
    }
    return cache.value;
  };
  return {
    ...mod,
    useAnalyticsAxes: (options?: { scope?: Scope }) => useSyncExternalStore(dimensions.subscribe, () => snapshot(options?.scope ?? null)),
  };
});

import api from '../api';
import CheckboxSetFilter from '../components/CheckboxSetFilter';
import DateFloatingFilter from '../components/DateFloatingFilter';
import OpexListPage from './OpexListPage';
import { DEFAULT_BUDGET_COLUMNS, type BudgetColumnsSettings } from '../services/budgetColumns';

type Col = {
  colId?: string;
  field?: string;
  defaultHidden?: boolean;
  filter?: unknown;
  floatingFilterComponent?: unknown;
  headerName?: string;
  valueGetter?: (p: unknown) => unknown;
  valueFormatter?: (p: unknown) => unknown;
  tooltipValueGetter?: (p: unknown) => unknown;
  filterParams?: { getValues?: (p: unknown) => Promise<Array<{ value: string | null; label: string }>>; filterOptions?: string[] };
  cellRenderer?: (p: unknown) => React.ReactElement;
  cellRendererSelector?: (p: unknown) => { component: unknown };
};
type GridProps = {
  columns: Col[];
  pinnedBottomRowData: Array<{ versions?: Record<string, { totals?: Record<string, number> }> } & Record<string, unknown>>;
  defaultSort: { field: string; direction: string };
  onQueryStateChange: (state: { sort: string; filterModel: Record<string, unknown>; q: string; statusScope: string }) => void;
  onGridApiReady: (api: unknown) => void;
  onColumnStateChange: (state: Array<{ colId: string; hide?: boolean }>) => void;
};
const location = { search: '' };
function LocationProbe() {
  location.search = useLocation().search;
  return null;
}
let columnsSetting: BudgetColumnsSettings = DEFAULT_BUDGET_COLUMNS;

const dimension = (id: string, name: string | null, sort_order: number, extra: Record<string, unknown> = {}) => ({
  id, code: id, name, description: null, sort_order, is_default: false, status: 'enabled', disabled_at: null, ...extra,
});
const DEFAULT_DIMENSION = dimension('default', null, 0, { is_default: true });

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const lastProps = () => grid.mock.calls[grid.mock.calls.length - 1][0] as GridProps;
const column = (id: string) => lastProps().columns.find((c) => (c.colId ?? c.field) === id);

async function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OpexListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(lastProps().pinnedBottomRowData).toHaveLength(1));
}

describe('OpexListPage', () => {
  beforeEach(() => {
    grid.mockReset();
    get.mockReset();
    window.sessionStorage.clear();
    columnsSetting = DEFAULT_BUDGET_COLUMNS;
    dimensions.list = [DEFAULT_DIMENSION];
    dimensions.ready = true;
    get.mockImplementation(async (url: string) => {
      if (url === '/users') return { data: { items: [] } };
      if (url === '/budget-columns') return { data: columnsSetting };
      return { data: { yPlus2Budget: 80, yPlus2Landing: 60, yForecast: 5, reportingCurrency: 'X' } };
    });
  });

  it('shows project names, not an id', async () => {
    await renderPage();
    expect(column('project_id')).toBeUndefined();
    const project = column('project_name');
    expect(project?.headerName).toBe('opex.columns.project');
    expect(project?.defaultHidden).toBe(true);
    expect(project?.filter).toBeUndefined();
  });

  it('reads Y+2 amounts in the reporting currency like the other years', async () => {
    await renderPage();
    const getter = column('yPlus2Budget')!.valueGetter!;
    expect(getter({ data: { versions: { yPlus2: { totals: { budget: 100 }, reporting: { budget: 92 } } } } })).toBe(92);
  });

  it('offers every shown column of every list year and a supplier filter with the values the server lists', async () => {
    await renderPage();
    // Forecast is hidden by default. Four shown columns over four years: sixteen amounts, sixteen FTE.
    expect(lastProps().columns.filter((c) => c.filter === 'agNumberColumnFilter')).toHaveLength(32);
    expect(column('yForecast')).toBeUndefined();
    expect(column('fte_yForecast')).toBeUndefined();
    expect(column('supplier_name')?.filter).toBe(CheckboxSetFilter);
  });

  it('follows a change of the default column within the session, and keeps a sort the user picked', async () => {
    const openList = async () => {
      grid.mockReset();
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const view = render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/ops/opex']}>
            <LocationProbe />
            <OpexListPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      await waitFor(() => expect(lastProps().pinnedBottomRowData).toHaveLength(1));
      return view;
    };
    const stored = () => JSON.parse(window.sessionStorage.getItem('opex-list-context') ?? '{}');

    // The grid reports its sort on the default column: nothing is kept.
    let view = await openList();
    act(() => lastProps().onQueryStateChange({ sort: 'yBudget:DESC', filterModel: {}, q: '', statusScope: 'enabled' }));
    expect(stored().sort).toBe('');
    view.unmount();

    // The default moves: the list opens on the new default.
    columnsSetting = { ...DEFAULT_BUDGET_COLUMNS, default_column: 'expected_landing' };
    view = await openList();
    expect(lastProps().defaultSort).toEqual({ field: 'yLanding', direction: 'DESC' });
    expect(new URLSearchParams(location.search).get('sort')).toBeNull();

    // A sort the user picked is kept across a default change.
    act(() => lastProps().onQueryStateChange({ sort: 'yRevision:ASC', filterModel: {}, q: '', statusScope: 'enabled' }));
    expect(stored().sort).toBe('yRevision:ASC');
    view.unmount();
    columnsSetting = DEFAULT_BUDGET_COLUMNS;
    await openList();
    await waitFor(() => expect(new URLSearchParams(location.search).get('sort')).toBe('yRevision:ASC'));
  });

  it('shows one loading line until the setting arrives', async () => {
    let answer: (value: unknown) => void = () => undefined;
    get.mockImplementation(async (url: string) => {
      if (url === '/budget-columns') return new Promise((resolve) => { answer = resolve; });
      if (url === '/users') return { data: { items: [] } };
      return { data: {} };
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <OpexListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('common:status.loading')).toBeInTheDocument();
    expect(grid).not.toHaveBeenCalled();
    answer({ data: DEFAULT_BUDGET_COLUMNS });
    await waitFor(() => expect(grid).toHaveBeenCalled());
    expect(screen.queryByText('common:status.loading')).not.toBeInTheDocument();
  });

  it('waits for the setting, then sorts by the default column of Y', async () => {
    columnsSetting = { ...DEFAULT_BUDGET_COLUMNS, default_column: 'expected_landing' };
    await renderPage();
    // The grid never mounted on the product default.
    for (const [props] of grid.mock.calls) expect((props as GridProps).defaultSort).toEqual({ field: 'yLanding', direction: 'DESC' });
    expect(lastProps().columns.filter((c) => c.filter === 'agNumberColumnFilter' && !c.defaultHidden).map((c) => c.colId)).toEqual(['yLanding']);
  });

  it('offers the FTE of every shown column, hidden by default, right after the amount columns', async () => {
    await renderPage();
    const ids = lastProps().columns.map((c) => c.colId ?? c.field ?? '');
    const amounts = ids.filter((id) => /^y(Minus1|Plus1|Plus2)?[A-Z]/.test(id));
    const fte = ids.filter((id) => id.startsWith('fte_'));
    expect(fte).toEqual(amounts.map((id) => `fte_${id}`));
    expect(ids.indexOf(fte[0])).toBe(ids.indexOf(amounts[amounts.length - 1]) + 1);
    for (const id of fte) {
      expect(column(id)).toMatchObject({ defaultHidden: true, filter: 'agNumberColumnFilter', headerName: 'ops:shared.fteColumnHeader' });
      expect(column(id)!.filterParams!.filterOptions).toContain('blank');
    }
    // The cell opens the budget of its year.
    const Y = new Date().getFullYear();
    const data = { id: 'o-1', item_number: 3, fte_yPlus1Budget: 0.75 };
    const el = (column('fte_yPlus1Budget')!.cellRendererSelector!({ node: {} }).component as (p: unknown) => React.ReactElement)({ data, value: 0.75, colDef: {} });
    expect((el.props as { getHref: (row: unknown) => string | null }).getHref(data)).toMatch(new RegExp(`^/ops/opex/OPX-3/budget\\?.*year=${Y + 1}`));
  });

  it('asks the totals for the FTE columns shown only, and follows them when they are shown or hidden', async () => {
    get.mockImplementation(async (url: string, config?: { params?: { fte?: string } }) => {
      if (url === '/users') return { data: { items: [] } };
      if (url === '/budget-columns') return { data: columnsSetting };
      const fte = config?.params?.fte
        ? Object.fromEntries(config.params.fte.split(',').map((key) => [key, { total: 12.5, unknown: 3 }]))
        : undefined;
      return { data: { yBudget: 10, ...(fte ? { fte } : {}) } };
    });
    await renderPage();
    const totalsCalls = () => get.mock.calls.filter(([url]) => url === '/spend-items/summary/totals');
    // Nothing shown: no FTE asked.
    for (const [, config] of totalsCalls()) expect(config.params.fte).toBeUndefined();

    // The saved layout shows one FTE column: the first request from the grid asks for it.
    act(() => lastProps().onGridApiReady({ getColumnState: () => [{ colId: 'product_name', hide: false }, { colId: 'fte_yPlus1Budget', hide: false }, { colId: 'fte_yBudget', hide: true }] }));
    act(() => lastProps().onQueryStateChange({ sort: 'yBudget:DESC', filterModel: {}, q: '', statusScope: 'enabled' }));
    await waitFor(() => expect(lastProps().pinnedBottomRowData[0].fte_yPlus1Budget).toBe(12.5));
    expect(totalsCalls().slice(-1)[0][1].params.fte).toBe('fte_yPlus1Budget');

    // Showing another one refetches with both; the footer shows the sum and the unknown lines in a tooltip.
    let count = totalsCalls().length;
    act(() => lastProps().onColumnStateChange([{ colId: 'fte_yPlus1Budget', hide: false }, { colId: 'fte_yBudget', hide: false }]));
    await waitFor(() => expect(totalsCalls()).toHaveLength(count + 1));
    expect(totalsCalls().slice(-1)[0][1].params.fte).toBe('fte_yPlus1Budget,fte_yBudget');
    await waitFor(() => expect(lastProps().pinnedBottomRowData[0].fte_yBudget).toBe(12.5));
    const pinned = lastProps().pinnedBottomRowData[0];
    expect(column('fte_yBudget')!.valueFormatter!({ value: column('fte_yBudget')!.valueGetter!({ data: pinned }) })).toBe('12.50');
    expect(column('fte_yBudget')!.tooltipValueGetter!({ data: pinned, node: { rowPinned: 'bottom' } })).toBe('ops:shared.fteUnknownLines');

    // A resize or a move changes nothing shown: no request.
    count = totalsCalls().length;
    act(() => lastProps().onColumnStateChange([{ colId: 'fte_yPlus1Budget', hide: false }, { colId: 'fte_yBudget', hide: false }, { colId: 'status', hide: true }]));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(totalsCalls()).toHaveLength(count);

    // Hiding them all: back to the totals without FTE.
    act(() => lastProps().onColumnStateChange([{ colId: 'fte_yPlus1Budget', hide: true }, { colId: 'fte_yBudget', hide: true }]));
    await waitFor(() => expect(totalsCalls()).toHaveLength(count + 1));
    expect(totalsCalls().slice(-1)[0][1].params.fte).toBeUndefined();
    await waitFor(() => expect(lastProps().pinnedBottomRowData[0].fte_yBudget).toBeUndefined());
  });

  it('filters every date column with date models, from the menu and from the box under the header', async () => {
    await renderPage();
    for (const id of ['effective_start', 'disabled_at', 'created_at', 'updated_at']) {
      // The box under the header shows the filter in words and clears it in one click (DateFloatingFilter);
      // each date filter names a date operator as its default, never the text filters' `contains`.
      expect(column(id)).toMatchObject({ filter: 'agDateColumnFilter', floatingFilterComponent: DateFloatingFilter });
      expect((column(id)?.filterParams as { defaultOption?: string } | undefined)?.defaultOption).toBe('equals');
    }
  });

  it('fills the footer from the totals keys of the same name', async () => {
    await renderPage();
    const versions = lastProps().pinnedBottomRowData[0].versions!;
    expect(versions.yPlus2.totals?.budget).toBe(80);
    expect(versions.yPlus2.totals?.landing).toBe(60);
    expect(versions.y.totals?.forecast).toBe(5);
  });

  it('offers an "FTE declared" column right after the FTE columns, hidden by default, Yes or blank, filtered on Yes and No', async () => {
    await renderPage();
    const ids = lastProps().columns.map((c) => c.colId ?? c.field ?? '');
    const fte = ids.filter((id) => id.startsWith('fte_'));
    expect(ids.indexOf('has_fte')).toBe(ids.indexOf(fte[fte.length - 1]) + 1);
    const declared = column('has_fte');
    expect(declared).toMatchObject({ headerName: 'shared.fteDeclared', defaultHidden: true, filter: CheckboxSetFilter });
    expect(declared!.valueGetter!({ data: { has_fte: 'yes' } })).toBe('shared.fteDeclaredYes');
    expect(declared!.valueGetter!({ data: { has_fte: null } })).toBe('');
    expect(declared!.valueGetter!({ data: undefined })).toBe('');

    get.mockImplementation(async (url: string, config?: { params?: { fields?: string } }) => {
      if (url !== '/spend-items/summary/filter-values') return { data: {} };
      return { data: { [config?.params?.fields ?? '']: [null, 'yes'] } };
    });
    const options = await declared!.filterParams!.getValues!({ context: { getQueryState: () => ({}) } });
    expect(options).toEqual([
      { value: 'yes', label: 'shared.fteDeclaredYes' },
      { value: null, label: 'shared.fteDeclaredNo' },
    ]);
    const calls = get.mock.calls.filter(([url]) => url === '/spend-items/summary/filter-values');
    expect(calls.map(([, config]) => config.params.fields)).toEqual(['has_fte']);
  });

  it('offers cost center and run or build columns, hidden by default, filtered on the values the server lists', async () => {
    await renderPage();
    const costCenter = column('cost_center_label');
    const runBuild = column('run_build');
    expect(costCenter).toMatchObject({ headerName: 'opex.columns.costCenter', defaultHidden: true, filter: CheckboxSetFilter });
    expect(runBuild).toMatchObject({ headerName: 'opex.columns.runBuild', defaultHidden: true, filter: CheckboxSetFilter });
    // Declared right after the analytics column (the budget holder between them), so saved layouts place them next to it.
    const ids = lastProps().columns.map((c) => c.colId ?? c.field);
    expect(ids.indexOf('cost_center_label')).toBe(ids.indexOf('analytics_category_name') + 1);
    expect(ids.indexOf('run_build')).toBe(ids.indexOf('analytics_category_name') + 3);
    expect(runBuild?.valueFormatter?.({ value: 'run' })).toBe('opex.runBuild.run');

    get.mockImplementation(async (url: string, config?: { params?: { fields?: string } }) => {
      if (url !== '/spend-items/summary/filter-values') return { data: {} };
      const field = config?.params?.fields ?? '';
      return { data: { [field]: field === 'run_build' ? ['build', null, 'run'] : ['IT-200 · Applications'] } };
    });
    const context = { getQueryState: () => ({ filters: { run_build: { filterType: 'set', values: ['run'] } }, q: '' }) };
    const ccOptions = await costCenter!.filterParams!.getValues!({ context });
    expect(ccOptions).toEqual([{ value: 'IT-200 · Applications', label: 'IT-200 · Applications' }]);
    const rbOptions = await runBuild!.filterParams!.getValues!({ context: { getQueryState: () => ({}) } });
    expect(rbOptions).toEqual([
      { value: 'build', label: 'opex.runBuild.build' },
      { value: 'run', label: 'opex.runBuild.run' },
      { value: null, label: 'shared.blank' },
    ]);
    const calls = get.mock.calls.filter(([url]) => url === '/spend-items/summary/filter-values');
    expect(calls.map(([, config]) => config.params.fields)).toEqual(['cost_center_label', 'run_build']);
    // A column's own filter is left out of the request for its values.
    expect(JSON.parse(calls[0][1].params.filters)).toEqual({ run_build: { filterType: 'set', values: ['run'] } });
  });

  it('links the cost center cell to the cost center, and nowhere when the line has none', async () => {
    await renderPage();
    const hrefOf = (data: Record<string, unknown>) => {
      const el = column('cost_center_label')!.cellRenderer!({ data, value: '', colDef: {} });
      return (el.props as { getHref: (row: unknown) => string | null }).getHref(data);
    };
    expect(hrefOf({ id: 'o-1', item_number: 3, cost_center_id: 'cc-1' })).toBe('/master-data/cost-centers/cc-1/overview');
    expect(hrefOf({ id: 'o-1', item_number: 3, cost_center_id: null })).toBeNull();
  });

  it('offers a budget holder column after the cost center, hidden by default, filtered on the values the server lists', async () => {
    await renderPage();
    const holder = column('budget_holder_name');
    expect(holder).toMatchObject({ headerName: 'opex.columns.budgetHolder', defaultHidden: true, filter: CheckboxSetFilter });
    const ids = lastProps().columns.map((c) => c.colId ?? c.field);
    expect(ids.indexOf('budget_holder_name')).toBe(ids.indexOf('cost_center_label') + 1);

    get.mockImplementation(async (url: string, config?: { params?: { fields?: string } }) => {
      if (url !== '/spend-items/summary/filter-values') return { data: {} };
      return { data: { [config?.params?.fields ?? '']: ['Ada Holder', null] } };
    });
    const options = await holder!.filterParams!.getValues!({ context: { getQueryState: () => ({}) } });
    expect(options).toEqual([
      { value: 'Ada Holder', label: 'Ada Holder' },
      { value: null, label: 'shared.blank' },
    ]);
    const calls = get.mock.calls.filter(([url]) => url === '/spend-items/summary/filter-values');
    expect(calls.map(([, config]) => config.params.fields)).toEqual(['budget_holder_name']);

    // The cell opens the line, like the owner columns: the budget holder is read from the cost center.
    const data = { id: 'o-1', item_number: 3, cost_center_id: 'cc-1', budget_holder_name: 'Ada Holder' };
    const el = holder!.cellRenderer!({ data, value: 'Ada Holder', colDef: {} });
    const href = (el.props as { getHref: (row: unknown) => string | null }).getHref(data);
    expect(href).toMatch(/^\/ops\/opex\/OPX-3\/overview/);
  });

  it('names the default dimension column after the dimension, hidden by default as before', async () => {
    await renderPage();
    const ids = lastProps().columns.map((c) => c.colId ?? c.field);
    expect(ids.filter((id) => id?.startsWith('analytics_'))).toEqual(['analytics_category_name']);
    // No name yet: the translated default label.
    expect(column('analytics_category_name')).toMatchObject({
      headerName: 'master-data:analytics.analyticsCategoryFallback', defaultHidden: true, filter: CheckboxSetFilter,
    });
    expect(column('analytics_category_name')!.valueGetter!({ data: { analytics_category_name: 'Licences' } })).toBe('Licences');
  });

  it('adds one column per other enabled dimension, hidden, right after the default one, in dimension order', async () => {
    dimensions.list = [
      dimension('activity', 'Activity', 3),
      dimension('old', 'Old', 2, { status: 'disabled', disabled_at: '2020-01-01T00:00:00.000Z' }),
      dimension('nature', 'Nature', 1),
      dimension('default', 'Cost type', 0, { is_default: true }),
    ];
    await renderPage();
    const ids = lastProps().columns.map((c) => c.colId ?? c.field);
    const at = ids.indexOf('analytics_category_name');
    expect(ids.slice(at, at + 4)).toEqual(['analytics_category_name', 'analytics_nature', 'analytics_activity', 'cost_center_label']);
    expect(ids).not.toContain('analytics_old');
    expect(column('analytics_category_name')?.headerName).toBe('Cost type');
    expect(column('analytics_nature')).toMatchObject({
      headerName: 'Nature', defaultHidden: true, filter: CheckboxSetFilter,
    });
    expect(column('analytics_activity')).toMatchObject({ headerName: 'Activity', defaultHidden: true });
    expect(column('analytics_nature')!.valueGetter!({ data: { analytics_nature: 'Licences' } })).toBe('Licences');

    // The cell opens the line.
    const data = { id: 'o-1', item_number: 3, analytics_nature: 'Licences' };
    const el = column('analytics_nature')!.cellRenderer!({ data, value: 'Licences', colDef: {} });
    expect((el.props as { getHref: (row: unknown) => string | null }).getHref(data)).toMatch(/^\/ops\/opex\/OPX-3\/overview/);

    // A set filter on the values the server lists for that dimension, in the dimension's order
    // (the server's), blank last.
    get.mockImplementation(async (url: string, config?: { params?: { fields?: string } }) => {
      if (url !== '/spend-items/summary/filter-values') return { data: {} };
      return { data: { [config?.params?.fields ?? '']: [null, 'Services', 'Licences'] } };
    });
    const noState = { context: { getQueryState: () => ({}) } };
    const options = await column('analytics_nature')!.filterParams!.getValues!(noState);
    expect(options).toEqual([
      { value: 'Services', label: 'Services' },
      { value: 'Licences', label: 'Licences' },
      { value: null, label: 'shared.blank' },
    ]);
    // The default dimension too; other columns still list their values by name.
    expect((await column('analytics_category_name')!.filterParams!.getValues!(noState)).map((o: { value: string | null }) => o.value))
      .toEqual(['Services', 'Licences', null]);
    expect((await column('supplier_name')!.filterParams!.getValues!(noState)).map((o: { value: string | null }) => o.value))
      .toEqual(['Licences', 'Services', null]);
    const calls = get.mock.calls.filter(([url]) => url === '/spend-items/summary/filter-values');
    expect(calls.map(([, config]) => config.params.fields)).toEqual(['analytics_nature', 'analytics_category_name', 'supplier_name']);
  });

  it('adds no column for a dimension used for CAPEX lines only', async () => {
    dimensions.list = [
      DEFAULT_DIMENSION,
      dimension('mine', 'Mine', 1, { applies_to: 'opex' }),
      dimension('theirs', 'Theirs', 2, { applies_to: 'capex' }),
    ];
    await renderPage();
    const ids = lastProps().columns.map((c) => c.colId ?? c.field);
    expect(ids).toContain('analytics_mine');
    expect(ids).not.toContain('analytics_theirs');
  });

  it('mounts the grid only once the dimensions are known, so a saved layout finds their columns', async () => {
    dimensions.ready = false;
    dimensions.list = [];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <OpexListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // The budget columns setting has arrived; the grid and the footer totals still wait.
    await waitFor(() => expect(get).toHaveBeenCalledWith('/budget-columns'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.getByText('common:status.loading')).toBeInTheDocument();
    expect(grid).not.toHaveBeenCalled();
    expect(get.mock.calls.some(([url]) => url === '/spend-items/summary/totals')).toBe(false);

    act(() => dimensions.set({ ready: true, list: [DEFAULT_DIMENSION, dimension('nature', 'Nature', 1)] }));
    await waitFor(() => expect(grid).toHaveBeenCalled());
    // Never mounted without the dimension columns.
    for (const [props] of grid.mock.calls) {
      expect((props as GridProps).columns.map((c) => c.colId ?? c.field)).toContain('analytics_nature');
    }
  });

  it('drops a stored sort or filter on a dimension the list has no column for, and keeps an enabled one', async () => {
    const NATURE = '11111111-1111-4111-8111-111111111111';
    const OLD = '22222222-2222-4222-8222-222222222222';
    const GONE = '33333333-3333-4333-8333-333333333333';
    dimensions.list = [
      DEFAULT_DIMENSION,
      dimension(NATURE, 'Nature', 1),
      dimension(OLD, 'Old', 2, { status: 'disabled', disabled_at: '2020-01-01T00:00:00.000Z' }),
    ];
    const kept = { [`analytics_${NATURE}`]: { filterType: 'set', values: ['Licences'] } };
    const filters = {
      ...kept,
      [`analytics_${OLD}`]: { filterType: 'set', values: ['Hardware'] },
      [`analytics_${GONE}`]: { filterType: 'set', values: [null] },
    };
    window.sessionStorage.setItem('opex-list-context', JSON.stringify({
      sort: `analytics_${OLD}:ASC`, q: '', filters: JSON.stringify(filters), statusScope: 'enabled',
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/ops/opex']}>
          <LocationProbe />
          <OpexListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(lastProps().pinnedBottomRowData).toHaveLength(1));
    const params = new URLSearchParams(location.search);
    expect(params.get('sort')).toBeNull();
    expect(JSON.parse(params.get('filters') ?? '{}')).toEqual(kept);
    // The grid mounts with the kept filter only, and the footer totals use the same.
    const initial = (lastProps() as unknown as { initialState?: { filter?: { filterModel?: unknown } } }).initialState;
    expect(initial?.filter?.filterModel).toEqual(kept);
    const totals = get.mock.calls.filter(([url]) => url === '/spend-items/summary/totals');
    expect(totals.length).toBeGreaterThan(0);
    for (const [, config] of totals) expect(JSON.parse(config.params.filters)).toEqual(kept);
  });

  it('keeps a stored sort on an enabled dimension', async () => {
    const NATURE = '11111111-1111-4111-8111-111111111111';
    dimensions.list = [DEFAULT_DIMENSION, dimension(NATURE, 'Nature', 1)];
    window.sessionStorage.setItem('opex-list-context', JSON.stringify({
      sort: `analytics_${NATURE}:ASC`, q: '', filters: '', statusScope: 'enabled',
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/ops/opex']}>
          <LocationProbe />
          <OpexListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(lastProps().pinnedBottomRowData).toHaveLength(1));
    expect(new URLSearchParams(location.search).get('sort')).toBe(`analytics_${NATURE}:ASC`);
  });
});
