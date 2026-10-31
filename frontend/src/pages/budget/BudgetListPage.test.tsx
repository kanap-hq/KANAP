import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string, opts?: any) => key === 'budget.titleWithCurrency' ? `${key}:${opts.currency}` : key === 'budget.totalWithCount' ? `${key}:${opts.count}` : key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'test' }) }));
const auth = vi.hoisted(() => ({ level: 'admin', limited: false }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({
  profile: { id: 'u-1' },
  hasLevel: (_resource: string, level: string) => ['reader', 'member', 'manager', 'admin'].indexOf(level) <= ['reader', 'member', 'manager', 'admin'].indexOf(auth.level),
  dataAccess: auth.limited ? { available: true, mode: 'limited', nodes: [], modules: ['budget'] } : null,
}) }));
const header = vi.hoisted(() => ({ props: null as any }));
vi.mock('../../components/PageHeader', () => ({ default: (props: any) => { header.props = props; return props.actions ?? null; } }));
vi.mock('../../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../../components/csv/CsvImportDialog', () => ({ default: () => null }));
const dialogs = vi.hoisted(() => ({ export: null as any, import: null as any, bulk: null as any }));
vi.mock('../../components/finance/BudgetFileExportDialog', () => ({ default: (props: any) => { dialogs.export = props; return null; } }));
vi.mock('../../components/finance/BudgetFileImportDialog', () => ({ default: (props: any) => { dialogs.import = props; return null; } }));
vi.mock('../../components/DeleteSelectedButton', () => ({ default: (props: any) => { dialogs.bulk = props; return null; } }));
const grid = vi.fn();
vi.mock('../../components/ServerDataGrid', async (importOriginal) => {
  const { useEffect } = await import('react');
  const { useLocation } = await import('react-router-dom');
  return {
    ...(await importOriginal<typeof import('../../components/ServerDataGrid')>()),
    default: function GridMock(props: any) {
      grid({ ...props, testSearch: useLocation().search });
      const search = useLocation().search;
      // Like the real grid once it is ready: it hands its API over, then reports the query it starts with.
      useEffect(() => {
        const { field, direction } = props.defaultSort;
        let model = props.initialState?.filter?.filterModel ?? {};
        props.onGridApiReady?.({
          getColumnState: () => [],
          getFilterModel: () => model,
          setFilterModel: (next: any) => {
            model = next;
            props.onQueryStateChange?.({ sort: `${field}:${direction}`, filterModel: model, q: '', statusScope: 'enabled' });
          },
        });
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
vi.mock('../../hooks/useAnalyticsAxes', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../hooks/useAnalyticsAxes')>();
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

import api from '../../api';
import CheckboxSetFilter from '../../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../../components/CheckboxSetFloatingFilter';
import DateFloatingFilter from '../../components/DateFloatingFilter';
import BudgetListPage from './BudgetListPage';
import { DEFAULT_BUDGET_COLUMNS, type BudgetColumnsSettings } from '../../services/budgetColumns';

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
  filterParams?: {
    getValues?: (p: unknown) => Promise<Array<{ value: string | null; label?: string }>>;
    filterOptions?: string[];
    labelFormatter?: (value: string | null) => string;
    sortComparator?: (a: { value: string | null; label?: string }, b: { value: string | null; label?: string }) => number;
  };
  cellRenderer?: (p: unknown) => React.ReactElement;
  cellRendererSelector?: (p: unknown) => { component: unknown };
};
type GridProps = {
  columns: Col[];
  pinnedBottomRowData: Array<{ versions?: Record<string, { totals?: Record<string, number> }> } & Record<string, unknown>>;
  defaultSort: { field: string; direction: string };
  onQueryStateChange: (state: { sort: string; filterModel: Record<string, unknown>; q: string; statusScope: string }) => void;
  onGridApiReady: (api: unknown) => void;
  setFilterExcludeMode: boolean;
  enableRowSelection?: boolean;
  footer?: React.ReactNode;
  pageParams: (state: any) => any;
  endpoint: string;
  queryKey: string;
  columnPreferencesKey: string;
  initialState?: { filter?: { filterModel?: any } };
  onSelectionChanged: (rows: any[]) => void;
  onColumnStateChange: (state: Array<{ colId: string; hide?: boolean }>) => void;
};
const location = { search: '', pathname: '' };
function LocationProbe() {
  location.search = useLocation().search;
  location.pathname = useLocation().pathname;
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

async function renderPage(path = '/ops/budget') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <BudgetListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(lastProps().pinnedBottomRowData).toHaveLength(1));
}

describe('BudgetListPage', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() });
    auth.level = 'admin';
    auth.limited = false;
    dialogs.bulk = dialogs.import = dialogs.export = null;
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
          <MemoryRouter initialEntries={['/ops/budget']}>
            <LocationProbe />
            <BudgetListPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      await waitFor(() => expect(lastProps().pinnedBottomRowData).toHaveLength(1));
      return view;
    };
    const stored = () => JSON.parse(window.sessionStorage.getItem('budget-list-context') ?? '{}');

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
          <BudgetListPage />
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
    const data = { id: 'o-1', nature: 'opex', item_number: 3, fte_yPlus1Budget: 0.75 };
    const el = (column('fte_yPlus1Budget')!.cellRendererSelector!({ node: {} }).component as (p: unknown) => React.ReactElement)({ data, value: 0.75, colDef: {} });
    expect((el.props as { getHref: (row: unknown) => string | null }).getHref(data)).toMatch(new RegExp(`^/ops/budget/BL-3/budget\\?.*year=${Y + 1}`));
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
    const totalsCalls = () => get.mock.calls.filter(([url]) => url === '/budget-lines/summary/totals');
    // Nothing shown: no FTE asked.
    for (const [, config] of totalsCalls()) expect(config.params.fte).toBeUndefined();

    // The saved layout shows one FTE column: the first request from the grid asks for it.
    act(() => lastProps().onGridApiReady({ getColumnState: () => [{ colId: 'product_name', hide: false }, { colId: 'fte_yPlus1Budget', hide: false }, { colId: 'fte_yBudget', hide: true }] }));
    act(() => lastProps().onQueryStateChange({ sort: 'yBudget:DESC', filterModel: {}, q: '', statusScope: 'enabled' }));
    await waitFor(() => expect(lastProps().pinnedBottomRowData.slice(-1)[0].fte_yPlus1Budget).toBe(12.5));
    expect(totalsCalls().slice(-1)[0][1].params.fte).toBe('fte_yPlus1Budget');

    // Showing another one refetches with both; the footer shows the sum and the unknown lines in a tooltip.
    let count = totalsCalls().length;
    act(() => lastProps().onColumnStateChange([{ colId: 'fte_yPlus1Budget', hide: false }, { colId: 'fte_yBudget', hide: false }]));
    await waitFor(() => expect(totalsCalls()).toHaveLength(count + 1));
    expect(totalsCalls().slice(-1)[0][1].params.fte).toBe('fte_yPlus1Budget,fte_yBudget');
    await waitFor(() => expect(lastProps().pinnedBottomRowData.slice(-1)[0].fte_yBudget).toBe(12.5));
    const pinned = lastProps().pinnedBottomRowData.slice(-1)[0];
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
    await waitFor(() => expect(lastProps().pinnedBottomRowData.slice(-1)[0].fte_yBudget).toBeUndefined());
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
    const versions = lastProps().pinnedBottomRowData.slice(-1)[0].versions!;
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
      if (url !== '/budget-lines/summary/filter-values') return { data: {} };
      return { data: { [config?.params?.fields ?? '']: [null, 'yes'] } };
    });
    const options = await declared!.filterParams!.getValues!({ context: { getQueryState: () => ({}) } });
    expect(options).toEqual([
      { value: 'yes', label: 'shared.fteDeclaredYes' },
      { value: null, label: 'shared.fteDeclaredNo' },
    ]);
    const calls = get.mock.calls.filter(([url]) => url === '/budget-lines/summary/filter-values');
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
      if (url !== '/budget-lines/summary/filter-values') return { data: {} };
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
    const calls = get.mock.calls.filter(([url]) => url === '/budget-lines/summary/filter-values');
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
    expect(hrefOf({ id: 'o-1', nature: 'opex', item_number: 3, cost_center_id: 'cc-1' })).toBe('/master-data/cost-centers/cc-1/overview');
    expect(hrefOf({ id: 'o-1', nature: 'opex', item_number: 3, cost_center_id: null })).toBeNull();
  });

  it('offers a budget holder column after the cost center, hidden by default, filtered on the values the server lists', async () => {
    await renderPage();
    const holder = column('budget_holder_name');
    expect(holder).toMatchObject({ headerName: 'opex.columns.budgetHolder', defaultHidden: true, filter: CheckboxSetFilter });
    const ids = lastProps().columns.map((c) => c.colId ?? c.field);
    expect(ids.indexOf('budget_holder_name')).toBe(ids.indexOf('cost_center_label') + 1);

    get.mockImplementation(async (url: string, config?: { params?: { fields?: string } }) => {
      if (url !== '/budget-lines/summary/filter-values') return { data: {} };
      return { data: { [config?.params?.fields ?? '']: ['Ada Holder', null] } };
    });
    const options = await holder!.filterParams!.getValues!({ context: { getQueryState: () => ({}) } });
    expect(options).toEqual([
      { value: 'Ada Holder', label: 'Ada Holder' },
      { value: null, label: 'shared.blank' },
    ]);
    const calls = get.mock.calls.filter(([url]) => url === '/budget-lines/summary/filter-values');
    expect(calls.map(([, config]) => config.params.fields)).toEqual(['budget_holder_name']);

    // The cell opens the line, like the owner columns: the budget holder is read from the cost center.
    const data = { id: 'o-1', nature: 'opex', item_number: 3, cost_center_id: 'cc-1', budget_holder_name: 'Ada Holder' };
    const el = holder!.cellRenderer!({ data, value: 'Ada Holder', colDef: {} });
    const href = (el.props as { getHref: (row: unknown) => string | null }).getHref(data);
    expect(href).toMatch(/^\/ops\/budget\/BL-3\/overview/);
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

  it('adds one column per enabled dimension, hidden, in dimension order', async () => {
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
    const data = { id: 'o-1', nature: 'opex', item_number: 3, analytics_nature: 'Licences' };
    const el = column('analytics_nature')!.cellRenderer!({ data, value: 'Licences', colDef: {} });
    expect((el.props as { getHref: (row: unknown) => string | null }).getHref(data)).toMatch(/^\/ops\/budget\/BL-3\/overview/);

    // A set filter on the values the server lists for that dimension, in the dimension's order
    // (the server's), blank last.
    get.mockImplementation(async (url: string, config?: { params?: { fields?: string } }) => {
      if (url !== '/budget-lines/summary/filter-values') return { data: {} };
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
    const calls = get.mock.calls.filter(([url]) => url === '/budget-lines/summary/filter-values');
    expect(calls.map(([, config]) => config.params.fields)).toEqual(['analytics_nature', 'analytics_category_name', 'supplier_name']);
  });

  it('includes dimensions of both natures', async () => {
    dimensions.list = [
      DEFAULT_DIMENSION,
      dimension('mine', 'Mine', 1, { applies_to: 'opex' }),
      dimension('theirs', 'Theirs', 2, { applies_to: 'capex' }),
    ];
    await renderPage();
    const ids = lastProps().columns.map((c) => c.colId ?? c.field);
    expect(ids).toContain('analytics_mine');
    expect(ids).toContain('analytics_theirs');
  });

  it('places the default dimension where the dimension order puts it, and a stored filter and sort on it still apply', async () => {
    dimensions.list = [
      dimension('activity', 'Activity', 1),
      dimension('nature', 'Nature', 2),
      dimension('default', 'Cost type', 3, { is_default: true }),
      dimension('site', 'Site', 4),
    ];
    const kept = { analytics_category_name: { filterType: 'set', values: ['Licences'] } };
    window.sessionStorage.setItem('budget-list-context', JSON.stringify({
      sort: 'analytics_category_name:ASC', q: '', filters: JSON.stringify(kept), statusScope: 'enabled',
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/ops/budget']}>
          <LocationProbe />
          <BudgetListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(lastProps().pinnedBottomRowData).toHaveLength(1));
    const ids = lastProps().columns.map((c) => c.colId ?? c.field);
    const at = ids.indexOf('analytics_activity');
    // The default dimension's column keeps its id, third in the block as the dimension is third.
    expect(ids.slice(at, at + 5)).toEqual(['analytics_activity', 'analytics_nature', 'analytics_category_name', 'analytics_site', 'cost_center_label']);
    expect(column('analytics_category_name')?.headerName).toBe('Cost type');
    const params = new URLSearchParams(location.search);
    expect(params.get('sort')).toBe('analytics_category_name:ASC');
    expect(JSON.parse(params.get('filters') ?? '{}')).toEqual(kept);
    const initial = (lastProps() as unknown as { initialState?: { filter?: { filterModel?: unknown } } }).initialState;
    expect(initial?.filter?.filterModel).toEqual(kept);
  });

  it('mounts the grid only once the dimensions are known, so a saved layout finds their columns', async () => {
    dimensions.ready = false;
    dimensions.list = [];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <BudgetListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // The budget columns setting has arrived; the grid and the footer totals still wait.
    await waitFor(() => expect(get).toHaveBeenCalledWith('/budget-columns'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.getByText('common:status.loading')).toBeInTheDocument();
    expect(grid).not.toHaveBeenCalled();
    expect(get.mock.calls.some(([url]) => url === '/budget-lines/summary/totals')).toBe(false);

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
    window.sessionStorage.setItem('budget-list-context', JSON.stringify({
      sort: `analytics_${OLD}:ASC`, q: '', filters: JSON.stringify(filters), statusScope: 'enabled',
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/ops/budget']}>
          <LocationProbe />
          <BudgetListPage />
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
    const totals = get.mock.calls.filter(([url]) => url === '/budget-lines/summary/totals');
    expect(totals.length).toBeGreaterThan(0);
    expect(JSON.parse(totals[0][1].params.filters)).toEqual(kept);
    for (const [, config] of totals.slice(1)) expect(JSON.parse(config.params.filters)).toMatchObject(kept);
  });

  it('keeps a stored sort on an enabled dimension', async () => {
    const NATURE = '11111111-1111-4111-8111-111111111111';
    dimensions.list = [DEFAULT_DIMENSION, dimension(NATURE, 'Nature', 1)];
    window.sessionStorage.setItem('budget-list-context', JSON.stringify({
      sort: `analytics_${NATURE}:ASC`, q: '', filters: '', statusScope: 'enabled',
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/ops/budget']}>
          <LocationProbe />
          <BudgetListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(lastProps().pinnedBottomRowData).toHaveLength(1));
    expect(new URLSearchParams(location.search).get('sort')).toBe(`analytics_${NATURE}:ASC`);
  });
  it('offers every shown column of every list year, filtered with number models', async () => {
    await renderPage();
    const amounts = lastProps().columns.filter((c) => c.filter === 'agNumberColumnFilter');
    // Forecast is hidden by default: not in the chooser, sort or filters. Sixteen amounts, sixteen FTE.
    expect(amounts).toHaveLength(32);
    expect(column('fte_yPlus2Forecast')).toBeUndefined();
    expect(amounts.filter((c) => !c.defaultHidden).map((c) => c.colId)).toEqual(['yBudget', 'yLanding']);
    expect(column('yPlus2Forecast')).toBeUndefined();
    expect(column('yMinus1Revision')).toBeDefined();
  });

  it('shows a column once the tenant shows it, named with its name', async () => {
    columnsSetting = {
      ...DEFAULT_BUDGET_COLUMNS,
      enabled: { ...DEFAULT_BUDGET_COLUMNS.enabled, forecast: true },
      labels: { ...DEFAULT_BUDGET_COLUMNS.labels, forecast: 'A2' },
    };
    await renderPage();
    expect(lastProps().columns.filter((c) => c.filter === 'agNumberColumnFilter')).toHaveLength(40);
    expect(column('yPlus2Forecast')?.headerName).toBe('ops:shared.amountColumnHeader');
    expect(column('fte_yPlus2Forecast')?.headerName).toBe('ops:shared.fteColumnHeader');
  });

  it('a stored sort on a hidden column falls back before the grid loads', async () => {
    window.sessionStorage.setItem('budget-list-context', JSON.stringify({ sort: 'yPlus1Forecast:ASC', q: '', filters: '', statusScope: 'enabled' }));
    await renderPage();
    expect(grid.mock.calls.map(([props]) => props.testSearch).length).toBeGreaterThan(0);
    for (const search of grid.mock.calls.map(([props]) => props.testSearch)) expect(new URLSearchParams(search).get('sort')).toBeNull();
    expect(lastProps().defaultSort).toEqual({ field: 'yBudget', direction: 'DESC' });
  });

  it('a linked sort or filter on a hidden column falls back before the grid loads', async () => {
    const filters = JSON.stringify({ yForecast: { filterType: 'number', type: 'greaterThan', filter: 1 } });
    await renderPage(`/ops/budget?sort=yForecast:DESC&filters=${encodeURIComponent(filters)}`);
    expect(grid.mock.calls.map(([props]) => props.testSearch).length).toBeGreaterThan(0);
    for (const search of grid.mock.calls.map(([props]) => props.testSearch)) {
      const params = new URLSearchParams(search);
      // No sort in the URL: the grid applies the default sort.
      expect(params.get('sort')).toBeNull();
      expect(params.get('filters')).toBeNull();
    }
    expect(lastProps().defaultSort).toEqual({ field: 'yBudget', direction: 'DESC' });
  });

  it('has a contract column, a project column hidden by default, and a visible task column', async () => {
    await renderPage();
    expect(column('contract_name')?.headerName).toBe('opex.columns.contract');
    expect(column('contract_name')?.valueGetter?.({ data: { latest_contract_name: 'Support' } })).toBe('Support');
    expect(column('project_name')?.headerName).toBe('opex.columns.project');
    expect(column('project_name')?.defaultHidden).toBe(true);
    expect(column('latest_task_text')?.defaultHidden).toBeFalsy();
  });

  it('shows a contract outside the access by its label alone, without a link', async () => {
    await renderPage();
    const contract = column('contract_name')!;
    expect(contract.valueGetter?.({ data: { contract_hidden: true, latest_contract_name: null, latest_contract_id: null } }))
      .toBe('contracts.outsideYourAccess');
    const { container } = render(
      <MemoryRouter>
        {contract.cellRenderer!({ data: { id: 'b-1', contract_hidden: true }, value: 'contracts.outsideYourAccess' })}
      </MemoryRouter>,
    );
    expect(screen.getByText('contracts.outsideYourAccess')).toBeInTheDocument();
    expect(container.querySelector('a')).toBeNull();
  });

  it('translates the allocation column and its filter, and keeps the server values', async () => {
    await renderPage();
    const allocation = column('allocation_label')!;
    expect(allocation.filter).toBe(CheckboxSetFilter);
    const format = allocation.valueFormatter!;
    const label = allocation.filterParams!.labelFormatter!;
    // The cell value stays the English constant the API filters and sorts on.
    expect(allocation.valueGetter?.({ data: { allocation_method_label: 'Company' } })).toBe('Company');
    expect(format({ value: 'Company' })).toBe('ops:opex.allocations.manualByCompany');
    expect(format({ value: 'Headcount' })).toBe('ops:opex.allocations.headcount');
    expect(format({ value: 'IT users' })).toBe('ops:opex.allocations.itUsers');
    expect(format({ value: 'Turnover' })).toBe('ops:opex.allocations.turnover');
    expect(format({ value: 'Department' })).toBe('ops:opex.allocations.manualByDepartment');
    expect(format({ value: 'Manual %' })).toBe('ops:opex.allocations.manualByPct');
    expect(format({ value: 'Default' })).toBe('ops:reports.shared.allocationMethodDefault');
    expect(format({ value: '' })).toBe('');
    expect(format({ value: 'Custom' })).toBe('Custom');
    expect(allocation.tooltipValueGetter?.({ data: { allocation_method_label: 'IT users' } })).toBe('ops:opex.allocations.itUsers');
    for (const raw of ['Company', 'Headcount', 'IT users', 'Turnover', 'Department', 'Manual %', 'Default']) {
      expect(label(raw)).toBe(format({ value: raw }));
    }
    expect(label(null)).toBe('shared.blank');
    expect(allocation.filterParams!.sortComparator!({ value: null, label: 'shared.blank' }, { value: 'Company', label: 'x' })).toBeGreaterThan(0);

    get.mockImplementation(async (url: string, config?: { params?: { fields?: string } }) => {
      if (url !== '/budget-lines/summary/filter-values') return { data: {} };
      expect(config?.params?.fields).toBe('allocation_label');
      return { data: { allocation_label: ['Headcount', null, 'Company'] } };
    });
    const options = await allocation.filterParams!.getValues!({ context: { getQueryState: () => ({}) } });
    // Labels are left off so the filter's labelFormatter translates them. The values stay English.
    expect(options).toEqual([{ value: 'Company' }, { value: 'Headcount' }, { value: null }]);
  });

  it('filters the status column with a checkbox list of the two statuses', async () => {
    await renderPage();
    const status = column('status') as Col & { filterParams?: { values?: unknown; searchable?: boolean } };
    expect(status.filter).toBe(CheckboxSetFilter);
    expect(status.floatingFilterComponent).toBe(CheckboxSetFloatingFilter);
    expect(status.filterParams).toMatchObject({
      values: [
        { value: 'enabled', label: 'common:statuses.enabled' },
        { value: 'disabled', label: 'common:statuses.disabled' },
      ],
      searchable: false,
    });
  });

  it('links the contract cell to the contract and an amount cell to the budget of its year', async () => {
    await renderPage();
    const hrefOf = (id: string, data: Record<string, unknown>) => {
      const col = column(id)!;
      const renderer = col.cellRenderer ?? col.cellRendererSelector!({ node: {} }).component as (p: any) => React.ReactElement;
      const el = renderer({ data, value: '', colDef: {} });
      return (el.props as { getHref: (row: unknown) => string | null }).getHref(data);
    };
    const row = { id: 'c-1', nature: 'capex', item_number: 7, latest_contract_id: 'k-1' };
    expect(hrefOf('contract_name', row)).toBe('/ops/contracts/k-1/overview');
    const Y = new Date().getFullYear();
    expect(hrefOf('yPlus1Revision', row)).toMatch(new RegExp(`^/ops/budget/BL-7/budget\\?.*year=${Y + 1}`));
  });

  it('keeps the last known currency in the title while the totals reload or when they fail', async () => {
    await renderPage();
    expect(header.props.title).toBe('budget.titleWithCurrency:X');
    get.mockRejectedValue(new Error('down'));
    const totalsCalls = () => get.mock.calls.filter(([url]) => url === '/budget-lines/summary/totals').length;
    const before = totalsCalls();
    act(() => lastProps().onQueryStateChange({ sort: 'yBudget:DESC', filterModel: {}, q: 'cloud', statusScope: 'enabled' }));
    await waitFor(() => expect(totalsCalls()).toBe(before + 1));
    await waitFor(() => expect(lastProps().pinnedBottomRowData).toHaveLength(0));
    expect(header.props.title).toBe('budget.titleWithCurrency:X');
  });

  it('lean rows with the FTE columns shown, exclude mode, footer for the amount columns shown', async () => {
    await renderPage();
    expect(lastProps().setFilterExcludeMode).toBe(true);
    expect(lastProps().pageParams?.([{ colId: 'fte_yBudget', hide: false }, { colId: 'fte_yLanding', hide: true }, { colId: 'yBudget' }]))
      .toEqual({ shape: 'grid', fte: 'fte_yBudget' });
    act(() => lastProps().onGridApiReady({ getColumnState: () => [{ colId: 'yBudget', hide: false }, { colId: 'yRevision', hide: true }, { colId: 'yPlus1Forecast' }] }));
    act(() => lastProps().onQueryStateChange({ sort: 'yBudget:DESC', filterModel: {}, q: '', statusScope: 'enabled' }));
    await waitFor(() => {
      const totals = get.mock.calls.filter(([url]) => url === '/budget-lines/summary/totals');
      expect(totals.slice(-1)[0][1].params.amounts).toBe('yBudget,yPlus1Forecast');
    });
  });

  it('reads the supplier and the account from the grid rows (names, not objects)', async () => {
    await renderPage();
    expect(column('supplier_name')?.valueGetter?.({ data: { supplier_name: 'Acme' } })).toBe('Acme');
    expect(column('supplier_name')?.valueGetter?.({ data: {} })).toBe('');
    // The server's text: "6110 - Software", or the number alone for an account without a name.
    expect(column('account_display')?.valueGetter?.({ data: { account_display: '6110 - Software' } })).toBe('6110 - Software');
    expect(column('account_display')?.valueGetter?.({ data: { account_display: '6110' } })).toBe('6110');
    expect(column('account_display')?.valueGetter?.({ data: {} })).toBe('');
  });

  it('has no PP&E type, investment type or priority column: they are dimension columns, shown when required', async () => {
    const PPE = '44444444-4444-4444-8444-444444444444';
    const PRIORITY = '55555555-5555-4555-8555-555555555555';
    const SITE = '66666666-6666-4666-8666-666666666666';
    const RECURRENCE = '77777777-7777-4777-8777-777777777777';
    dimensions.list = [
      DEFAULT_DIMENSION,
      dimension(SITE, 'Site', 1),
      dimension(RECURRENCE, 'Recurrence', 2, { applies_to: 'opex', required: true }),
      dimension(PPE, 'PP&E type', 3, { applies_to: 'capex', required: true }),
      dimension(PRIORITY, 'Priority', 4, { applies_to: 'capex', required: true, status: 'disabled', disabled_at: '2020-01-01T00:00:00.000Z' }),
    ];
    await renderPage();
    const ids = lastProps().columns.map((c) => c.colId ?? c.field);
    for (const former of ['ppe_type', 'investment_type', 'priority']) expect(ids).not.toContain(former);
    // Required dimensions of either nature are shown; optional ones are hidden, disabled ones omitted.
    expect(column(`analytics_${PPE}`)).toMatchObject({ headerName: 'PP&E type', defaultHidden: false });
    expect(column(`analytics_${SITE}`)?.defaultHidden).toBe(true);
    expect(column('analytics_category_name')?.defaultHidden).toBe(true);
    expect(ids).not.toContain(`analytics_${PRIORITY}`);
    expect(column(`analytics_${RECURRENCE}`)).toMatchObject({ defaultHidden: false });
  });

  it('drops a stored sort or filter on the former PP&E type, investment type or priority fields', async () => {
    const PRIORITY = '55555555-5555-4555-8555-555555555555';
    dimensions.list = [DEFAULT_DIMENSION, dimension(PRIORITY, 'Priority', 1, { applies_to: 'capex', required: true })];
    const kept = { [`analytics_${PRIORITY}`]: { filterType: 'set', values: ['High'] } };
    window.sessionStorage.setItem('budget-list-context', JSON.stringify({
      sort: 'priority:ASC',
      q: '',
      filters: JSON.stringify({
        ...kept,
        priority: { filterType: 'set', values: ['high'] },
        ppe_type: { filterType: 'set', values: ['hardware'] },
        investment_type: { filterType: 'set', values: ['replacement'] },
      }),
      statusScope: 'enabled',
    }));
    await renderPage();
    expect(grid.mock.calls.map(([props]) => props.testSearch).length).toBeGreaterThan(0);
    for (const search of grid.mock.calls.map(([props]) => props.testSearch)) {
      const params = new URLSearchParams(search);
      expect(params.get('sort')).toBeNull();
      expect(JSON.parse(params.get('filters') ?? '{}')).toEqual(kept);
    }
  });

  it('keeps a linked sort on an enabled dimension', async () => {
    const NATURE = '11111111-1111-4111-8111-111111111111';
    dimensions.list = [DEFAULT_DIMENSION, dimension(NATURE, 'Nature', 1)];
    await renderPage(`/ops/budget?sort=analytics_${NATURE}:ASC`);
    for (const search of grid.mock.calls.map(([props]) => props.testSearch)) expect(new URLSearchParams(search).get('sort')).toBe(`analytics_${NATURE}:ASC`);
  });

  it('shows native BL references and a filterable Type column after the reference', async () => {
    await renderPage();
    expect(lastProps()).toMatchObject({ endpoint: '/budget-lines/summary', queryKey: 'budget-lines-summary', columnPreferencesKey: 'budget-summary' });
    expect(lastProps().columns.slice(0, 3).map((c) => c.colId ?? c.field)).toEqual(['item_number', 'nature', 'product_name']);
    expect(column('item_number')!.valueGetter!({ data: { item_number: 37 } })).toBe('BL-37');
    expect(column('nature')).toMatchObject({ headerName: 'budget.type', filter: CheckboxSetFilter });
    expect(column('description')).toMatchObject({ defaultHidden: true });
    const chip = column('nature')!.cellRenderer!({ value: 'capex', node: {} });
    expect(chip.props.label).toBe('budget.capex');
    get.mockResolvedValue({ data: { nature: ['capex', 'opex'] } });
    expect(await column('nature')!.filterParams!.getValues!({ context: { getQueryState: () => ({}) } })).toEqual([
      { value: 'capex', label: 'budget.capex' }, { value: 'opex', label: 'budget.opex' },
    ]);
  });

  it('has no nature toggles: an address nature filter opens the grid on that column filter', async () => {
    const capex = { nature: { filterType: 'set', values: ['capex'] } };
    await renderPage('/ops/budget?filters=' + encodeURIComponent(JSON.stringify(capex)));
    expect(screen.queryByRole('button', { name: 'budget.capex' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'budget.opex' })).toBeNull();
    expect(lastProps().initialState?.filter?.filterModel).toEqual(capex);
    await waitFor(() => expect(get.mock.calls.filter(([u]) => u === '/budget-lines/summary/totals').slice(-1)[0][1].params.filters).toBe(JSON.stringify(capex)));
  });

  it('opens the list unfiltered by nature when the address has no nature filter', async () => {
    await renderPage();
    expect(lastProps().initialState?.filter?.filterModel?.nature).toBeUndefined();
  });

  it('puts the actions in the page header', async () => {
    await renderPage();
    expect(header.props.actions).toBeTruthy();
    expect(screen.getByRole('button', { name: 'budget.newLine' })).toBeInTheDocument();
  });

  it('New line defaults to OPEX without a single nature filter', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'budget.newLine' }));
    await waitFor(() => expect(location.pathname).toBe('/ops/budget/new'));
    expect(new URLSearchParams(location.search).get('list')).toBe('budget');
  });

  it('New line opens the nature kept by the Type filter directly', async () => {
    await renderPage();
    act(() => lastProps().onQueryStateChange({ sort: 'yBudget:DESC', q: '', statusScope: 'enabled', filterModel: { nature: { filterType: 'set', values: ['opex'] } } }));
    fireEvent.click(screen.getByRole('button', { name: 'budget.newLine' }));
    expect(screen.queryByRole('menuitem')).toBeNull();
    await waitFor(() => expect(location.pathname).toBe('/ops/budget/new'));
  });

  it('New line opens the nature of an address filter directly', async () => {
    await renderPage('/ops/budget?filters=' + encodeURIComponent(JSON.stringify({ nature: { filterType: 'set', values: ['capex'] } })));
    fireEvent.click(screen.getByRole('button', { name: 'budget.newLine' }));
    expect(screen.queryByRole('menuitem')).toBeNull();
    await waitFor(() => expect(location.pathname).toBe('/ops/budget/new'));
  });

  it('shows the filtered line count in the total row', async () => {
    await renderPage();
    expect(lastProps().pinnedBottomRowData.slice(-1)[0].product_name).toBe('shared.total');
    act(() => (lastProps() as any).onTotalChange(135));
    expect(lastProps().pinnedBottomRowData.slice(-1)[0].product_name).toBe('budget.totalWithCount:135');
    act(() => (lastProps() as any).onTotalChange(1));
    expect(lastProps().pinnedBottomRowData.slice(-1)[0].product_name).toBe('budget.totalWithCount:1');
  });

  it('copies the OPEX grid layout once for this tenant and user', async () => {
    localStorage.setItem('grid-columns:test:u-1:opex-summary', '[{"colId":"notes","hide":false}]');
    await renderPage();
    expect(localStorage.getItem('grid-columns:test:u-1:budget-summary')).toBe('[{"colId":"notes","hide":false}]');
    expect(localStorage.getItem('grid-columns:test:u-1:opex-summary')).toBe('[{"colId":"notes","hide":false}]');
  });

  it('asks which selected lines a frozen column keeps before the delete confirmation', async () => {
    await renderPage();
    act(() => lastProps().onSelectionChanged([{ id: 'line-1', product_name: 'Servers' }]));
    const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;
    post.mockResolvedValueOnce({ data: { refused: [{ id: 'line-1', name: 'Servers', code: 'BUDGET_LINE_FROZEN', usages: [] }] } });
    expect(await dialogs.bulk.checkDelete(['line-1'])).toEqual({ refused: [{ id: 'line-1', name: 'Servers', code: 'BUDGET_LINE_FROZEN', usages: [] }] });
    expect(post).toHaveBeenCalledWith('/budget-lines/delete-check', { ids: ['line-1'] });
    expect(String(dialogs.bulk.itemLabels.toDelete(2))).toContain('budget.delete.toDelete');
    expect(String(dialogs.bulk.itemLabels.kept(1))).toContain('budget.delete.kept');
  });

  it('opens export and import with the unified filters and the CAPEX fallback, and bulk deletes on the neutral route', async () => {
    await renderPage();
    act(() => lastProps().onQueryStateChange({ sort: 'yBudget:DESC', q: '', statusScope: 'enabled', filterModel: { nature: { filterType: 'set', values: ['capex'] } } }));
    fireEvent.click(screen.getByRole('button', { name: 'common:export.button' }));
    expect(dialogs.export).toMatchObject({ open: true, scope: 'all', list: { filters: JSON.stringify({ nature: { filterType: 'set', values: ['capex'] } }) } });
    fireEvent.click(screen.getByRole('button', { name: 'opex.importCsv' }));
    expect(dialogs.import).toMatchObject({ open: true, scope: 'capex' });
    act(() => lastProps().onSelectionChanged([{ id: 'capex-id', product_name: 'Servers' }]));
    expect(dialogs.bulk).toMatchObject({ endpoint: '/budget-lines/bulk', selectedRows: [{ id: 'capex-id', product_name: 'Servers' }] });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const before = get.mock.calls.filter(([u]) => u === '/budget-lines/summary/totals').length;
    act(() => dialogs.import.onImported());
    await waitFor(() => expect(get.mock.calls.filter(([u]) => u === '/budget-lines/summary/totals').length).toBe(before + 1));
    act(() => lastProps().onQueryStateChange({ sort: 'yBudget:DESC', q: '', statusScope: 'enabled', filterModel: {} }));
    expect(dialogs.import.scope).toBe('opex');
  });

  it('a limited person: no bulk delete or selection, file actions kept', async () => {
    auth.limited = true;
    get.mockImplementation(async (url: string) => {
      if (url === '/users') return { data: { items: [] } };
      if (url === '/budget-columns') return { data: columnsSetting };
      return { data: { yPlus2Budget: 80, reportingCurrency: 'X', dataAccessLimited: true } };
    });
    await renderPage();
    expect(dialogs.bulk).toBeNull();
    expect(lastProps().enableRowSelection).toBe(false);
    expect(screen.getByRole('button', { name: 'opex.importCsv' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common:export.button' })).toBeInTheDocument();
  });

  it('an unscoped administrator keeps bulk delete', async () => {
    await renderPage();
    expect(dialogs.bulk).not.toBeNull();
    expect(lastProps().enableRowSelection).toBe(true);
    expect(lastProps().footer).toBeUndefined();
  });

  it('keeps create, file actions and selection behind their existing budget permissions', async () => {
    auth.level = 'reader';
    await renderPage();
    expect(screen.queryByRole('button', { name: 'budget.newLine' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'opex.importCsv' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'common:export.button' })).toBeNull();
    expect(dialogs.bulk).toBeNull();
    auth.level = 'manager';
    act(() => lastProps().onQueryStateChange({ sort: '', filterModel: {}, q: 'refresh', statusScope: 'enabled' }));
    expect(screen.getByRole('button', { name: 'budget.newLine' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'common:export.button' })).toBeNull();
  });

  it('shows one Total row from one totals GET, with no nature filter added, when the list holds both types', async () => {
    get.mockImplementation(async (url) => {
      if (url === '/budget-columns') return { data: columnsSetting };
      if (url !== '/budget-lines/summary/totals') return { data: { items: [] } };
      return { data: { yBudget: 300, fte: { fte_yBudget: { total: 3, unknown: 0 } }, reportingCurrency: 'EUR' } };
    });
    await renderPage();
    expect(lastProps().pinnedBottomRowData.map((row) => row.product_name)).toEqual(['shared.total']);
    expect(lastProps().pinnedBottomRowData[0].nature).toBeUndefined();
    expect(lastProps().pinnedBottomRowData[0].versions?.y.totals?.budget).toBe(300);
    expect(lastProps().pinnedBottomRowData[0].fte_yBudget).toBe(3);
    const totals = get.mock.calls.filter(([url]) => url === '/budget-lines/summary/totals');
    expect(totals).toHaveLength(1);
    expect(JSON.parse(totals[0][1].params.filters || '{}').nature).toBeUndefined();
    const cell = (column('yBudget')!.cellRendererSelector!({ node: { rowPinned: 'bottom' } }).component as (p: any) => React.ReactElement)({ data: lastProps().pinnedBottomRowData[0], valueFormatted: '300' });
    expect(cell.props).toMatchObject({ colId: 'yBudget', nature: undefined, children: '300' });
  });

  it.each(['opex', 'capex'])('shows one footer row and sends one request for a single %s Type filter', async (nature) => {
    await renderPage('/ops/budget?filters=' + encodeURIComponent(JSON.stringify({ nature: { filterType: 'set', values: [nature] } })));
    expect(lastProps().pinnedBottomRowData).toHaveLength(1);
    expect(lastProps().pinnedBottomRowData[0]).toMatchObject({ product_name: 'shared.total', nature });
    expect(get.mock.calls.filter(([url]) => url === '/budget-lines/summary/totals')).toHaveLength(1);
  });

  it('preserves both Type values, list filters, search, lifecycle and more than eight measures in the totals request', async () => {
    await renderPage();
    const filters = { nature: { filterType: 'set', values: ['opex', 'capex'] }, supplier_name: { filterType: 'set', mode: 'exclude', values: ['Vendor'] } };
    const amounts = lastProps().columns.filter((col) => col.filter === 'agNumberColumnFilter' && !col.colId?.startsWith('fte_')).map((col) => col.colId!);
    const fte = amounts.map((colId) => 'fte_' + colId);
    act(() => lastProps().onColumnStateChange([...amounts, ...fte].map((colId) => ({ colId }))));
    act(() => lastProps().onQueryStateChange({ sort: 'yBudget:ASC', q: 'cloud', statusScope: 'all', filterModel: filters }));
    await waitFor(() => {
      const calls = get.mock.calls.filter(([url, config]) => url === '/budget-lines/summary/totals' && config.params.q === 'cloud');
      expect(calls).toHaveLength(1);
      expect(calls[0][1].params).toMatchObject({ q: 'cloud', includeDisabled: '1', amounts: amounts.join(','), fte: fte.join(',') });
      expect(JSON.parse(calls[0][1].params.filters)).toEqual(filters);
    });
    expect(amounts.length + fte.length).toBeGreaterThan(8);
    expect(lastProps().pinnedBottomRowData).toHaveLength(1);
    expect((api as any).post).not.toHaveBeenCalled();
  });

});
