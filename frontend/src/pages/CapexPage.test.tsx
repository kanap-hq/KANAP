import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  // The page title shows its currency: `key:currency`.
  const t = (key: string, options?: { currency?: string }) => (options?.currency ? `${key}:${options.currency}` : key);
  const translation = { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../api', () => ({ default: { get: vi.fn() } }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
const header = vi.hoisted(() => ({ title: '' }));
vi.mock('../components/PageHeader', () => ({ default: ({ title }: { title: string }) => { header.title = title; return null; } }));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({ default: () => null }));
const grid = vi.fn();
// The list URL at the time the grid renders, recorded by a probe rendered just before the page.
const seen = vi.hoisted(() => ({ search: '', searches: [] as string[] }));
vi.mock('../components/ServerDataGrid', async (importOriginal) => {
  const { useEffect } = await import('react');
  const { useLocation } = await import('react-router-dom');
  return {
    ...(await importOriginal<typeof import('../components/ServerDataGrid')>()),
    default: function GridMock(props: any) {
      grid(props);
      seen.searches.push(seen.search);
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
// The tenant's column settings, set per test.
const columnsSetting = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../hooks/useBudgetColumns', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../hooks/useBudgetColumns')>();
  let cache: { settings: unknown; value: ReturnType<typeof mod.resolveBudgetColumns> } | null = null;
  const t = ((key: string) => key) as unknown as Parameters<typeof mod.resolveBudgetColumns>[1];
  return {
    ...mod,
    useBudgetColumns: () => {
      if (!cache || cache.settings !== columnsSetting.current) {
        cache = { settings: columnsSetting.current, value: mod.resolveBudgetColumns(columnsSetting.current as never, t) };
      }
      return cache.value;
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
  let cache: { list: unknown[]; ready: boolean; value: ReturnType<typeof mod.buildAnalyticsAxes> } | null = null;
  const snapshot = () => {
    if (!cache || cache.list !== dimensions.list || cache.ready !== dimensions.ready) {
      cache = { list: dimensions.list, ready: dimensions.ready, value: mod.buildAnalyticsAxes(dimensions.list as never, t, dimensions.ready) };
    }
    return cache.value;
  };
  return { ...mod, useAnalyticsAxes: () => useSyncExternalStore(dimensions.subscribe, snapshot) };
});

import api from '../api';
import CheckboxSetFilter from '../components/CheckboxSetFilter';
import DateFloatingFilter from '../components/DateFloatingFilter';
import CheckboxSetFloatingFilter from '../components/CheckboxSetFloatingFilter';
import CapexPage from './CapexPage';
import { DEFAULT_BUDGET_COLUMNS } from '../services/budgetColumns';

type Col = {
  colId?: string;
  field?: string;
  defaultHidden?: boolean;
  filter?: unknown;
  floatingFilterComponent?: unknown;
  filterParams?: { getValues?: unknown };
  headerName?: string;
  valueGetter?: (p: unknown) => unknown;
  valueFormatter?: (p: unknown) => unknown;
  tooltipValueGetter?: (p: unknown) => unknown;
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
  pageParams?: (state: Array<{ colId: string; hide?: boolean }>) => Record<string, string | undefined>;
  setFilterExcludeMode?: boolean;
};

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const lastProps = () => grid.mock.calls[grid.mock.calls.length - 1][0] as GridProps;
const column = (id: string) => lastProps().columns.find((c) => (c.colId ?? c.field) === id);

function LocationProbe() {
  seen.search = useLocation().search;
  return null;
}

const dimension = (id: string, name: string | null, sort_order: number, extra: Record<string, unknown> = {}) => ({
  id, code: id, name, description: null, sort_order, is_default: false, status: 'enabled', disabled_at: null, ...extra,
});
const DEFAULT_DIMENSION = dimension('default', null, 0, { is_default: true });

/** Renders the page and waits for the totals footer, the last state update of the first load. */
async function renderPage(url = '/ops/capex') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <LocationProbe />
        <CapexPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(lastProps().pinnedBottomRowData).toHaveLength(1));
}

describe('CapexPage', () => {
  beforeEach(() => {
    grid.mockReset();
    seen.searches = [];
    columnsSetting.current = DEFAULT_BUDGET_COLUMNS;
    dimensions.list = [DEFAULT_DIMENSION];
    dimensions.ready = true;
    window.sessionStorage.clear();
    get.mockReset();
    get.mockResolvedValue({ data: { yBudget: 10, yPlus2Forecast: 4, yMinus1Revision: 3, reportingCurrency: 'X' } });
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
    columnsSetting.current = {
      ...DEFAULT_BUDGET_COLUMNS,
      enabled: { ...DEFAULT_BUDGET_COLUMNS.enabled, forecast: true },
      labels: { ...DEFAULT_BUDGET_COLUMNS.labels, forecast: 'A2' },
    };
    await renderPage();
    expect(lastProps().columns.filter((c) => c.filter === 'agNumberColumnFilter')).toHaveLength(40);
    expect(column('yPlus2Forecast')?.headerName).toBe('ops:shared.amountColumnHeader');
    expect(column('fte_yPlus2Forecast')?.headerName).toBe('ops:shared.fteColumnHeader');
  });

  it('sorts by the default column of Y by default', async () => {
    columnsSetting.current = { ...DEFAULT_BUDGET_COLUMNS, default_column: 'committed' };
    await renderPage();
    expect(lastProps().defaultSort).toEqual({ field: 'yRevision', direction: 'DESC' });
    // Visible by default: the default column and the last shown column of Y.
    expect(lastProps().columns.filter((c) => c.filter === 'agNumberColumnFilter' && !c.defaultHidden).map((c) => c.colId))
      .toEqual(['yRevision', 'yLanding']);
  });

  it('a stored sort on a hidden column falls back before the grid loads', async () => {
    window.sessionStorage.setItem('capex-list-context', JSON.stringify({ sort: 'yPlus1Forecast:ASC', q: '', filters: '', statusScope: 'enabled' }));
    await renderPage();
    expect(seen.searches.length).toBeGreaterThan(0);
    for (const search of seen.searches) expect(new URLSearchParams(search).get('sort')).toBeNull();
    expect(lastProps().defaultSort).toEqual({ field: 'yBudget', direction: 'DESC' });
  });

  it('a linked sort or filter on a hidden column falls back before the grid loads', async () => {
    const filters = JSON.stringify({ yForecast: { filterType: 'number', type: 'greaterThan', filter: 1 } });
    await renderPage(`/ops/capex?sort=yForecast:DESC&filters=${encodeURIComponent(filters)}`);
    expect(seen.searches.length).toBeGreaterThan(0);
    for (const search of seen.searches) {
      const params = new URLSearchParams(search);
      // No sort in the URL: the grid applies the default sort.
      expect(params.get('sort')).toBeNull();
      expect(params.get('filters')).toBeNull();
    }
    expect(lastProps().defaultSort).toEqual({ field: 'yBudget', direction: 'DESC' });
  });

  it('has a contract column, a project column hidden by default, and a visible task column', async () => {
    await renderPage();
    expect(column('contract_name')?.headerName).toBe('capex.columns.contract');
    expect(column('contract_name')?.valueGetter?.({ data: { latest_contract_name: 'Support' } })).toBe('Support');
    expect(column('project_name')?.headerName).toBe('capex.columns.project');
    expect(column('project_name')?.defaultHidden).toBe(true);
    expect(column('latest_task_text')?.defaultHidden).toBeFalsy();
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

  it('filters the allocation column with the values the server lists', async () => {
    await renderPage();
    const allocation = column('allocation_label');
    expect(allocation?.filter).toBe(CheckboxSetFilter);
    expect(allocation?.filterParams?.getValues).toBeTypeOf('function');
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
      const el = column(id)!.cellRenderer!({ data, value: '', colDef: {} });
      return (el.props as { getHref: (row: unknown) => string | null }).getHref(data);
    };
    const row = { id: 'c-1', item_number: 7, latest_contract_id: 'k-1' };
    expect(hrefOf('contract_name', row)).toBe('/ops/contracts/k-1/overview');
    const Y = new Date().getFullYear();
    expect(hrefOf('yPlus1Revision', row)).toMatch(new RegExp(`^/ops/capex/CPX-7/budget\\?.*year=${Y + 1}`));
  });

  it('offers the FTE of every shown column, hidden by default, right after the amount columns', async () => {
    await renderPage();
    const ids = lastProps().columns.map((c) => c.colId ?? c.field ?? '');
    const amounts = ids.filter((id) => /^y(Minus1|Plus1|Plus2)?[A-Z]/.test(id));
    const fte = ids.filter((id) => id.startsWith('fte_'));
    expect(fte).toEqual(amounts.map((id) => `fte_${id}`));
    expect(ids.indexOf(fte[0])).toBe(ids.indexOf(amounts[amounts.length - 1]) + 1);
    for (const id of fte) expect(column(id)).toMatchObject({ defaultHidden: true, filter: 'agNumberColumnFilter' });
    const Y = new Date().getFullYear();
    const data = { id: 'c-1', item_number: 7 };
    const el = (column('fte_yMinus1Budget')!.cellRendererSelector!({ node: {} }).component as (p: unknown) => React.ReactElement)({ data, value: null, colDef: {} });
    expect((el.props as { getHref: (row: unknown) => string | null }).getHref(data)).toMatch(new RegExp(`^/ops/capex/CPX-7/budget\\?.*year=${Y - 1}`));
  });

  it('asks the totals for the FTE columns shown only, and shows their sums in the footer', async () => {
    get.mockImplementation(async (_url: string, config?: { params?: { fte?: string } }) => {
      const fte = config?.params?.fte
        ? Object.fromEntries(config.params.fte.split(',').map((key) => [key, { total: 2, unknown: 1 }]))
        : undefined;
      return { data: { yBudget: 10, reportingCurrency: 'X', ...(fte ? { fte } : {}) } };
    });
    await renderPage();
    const totalsCalls = () => get.mock.calls.filter(([url]) => url === '/capex-items/summary/totals');
    for (const [, config] of totalsCalls()) expect(config.params.fte).toBeUndefined();

    act(() => lastProps().onGridApiReady({ getColumnState: () => [{ colId: 'fte_yLanding', hide: false }] }));
    act(() => lastProps().onQueryStateChange({ sort: 'yBudget:DESC', filterModel: {}, q: '', statusScope: 'enabled' }));
    await waitFor(() => expect(lastProps().pinnedBottomRowData[0].fte_yLanding).toBe(2));
    expect(totalsCalls().slice(-1)[0][1].params.fte).toBe('fte_yLanding');
    const pinned = lastProps().pinnedBottomRowData[0];
    expect(column('fte_yLanding')!.tooltipValueGetter!({ data: pinned, node: { rowPinned: 'bottom' } })).toBe('ops:shared.fteUnknownLines');

    const count = totalsCalls().length;
    act(() => lastProps().onColumnStateChange([{ colId: 'fte_yLanding', hide: true }]));
    await waitFor(() => expect(totalsCalls()).toHaveLength(count + 1));
    expect(totalsCalls().slice(-1)[0][1].params.fte).toBeUndefined();
    await waitFor(() => expect(lastProps().pinnedBottomRowData[0].fte_yLanding).toBeUndefined());
  });

  it('keeps the last known currency in the title while the totals reload or when they fail', async () => {
    await renderPage();
    expect(header.title).toBe('capex.titleWithCurrency:X');
    get.mockRejectedValue(new Error('down'));
    const totalsCalls = () => get.mock.calls.filter(([url]) => url === '/capex-items/summary/totals').length;
    const before = totalsCalls();
    act(() => lastProps().onQueryStateChange({ sort: 'yBudget:DESC', filterModel: {}, q: 'cloud', statusScope: 'enabled' }));
    await waitFor(() => expect(totalsCalls()).toBe(before + 1));
    await waitFor(() => expect(lastProps().pinnedBottomRowData).toHaveLength(0));
    expect(header.title).toBe('capex.titleWithCurrency:X');
  });

  it('fills the footer from the totals keys of the same name', async () => {
    await renderPage();
    const versions = lastProps().pinnedBottomRowData[0].versions!;
    expect(versions.yPlus2.totals?.forecast).toBe(4);
    expect(versions.yMinus1.totals?.revision).toBe(3);
    expect(versions.y.totals?.budget).toBe(10);
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
      if (url !== '/capex-items/summary/filter-values') return { data: {} };
      return { data: { [config?.params?.fields ?? '']: [null, 'yes'] } };
    });
    type GetValues = (p: unknown) => Promise<Array<{ value: string | null; label: string }>>;
    const options = await (declared!.filterParams!.getValues as GetValues)({ context: { getQueryState: () => ({}) } });
    expect(options).toEqual([
      { value: 'yes', label: 'shared.fteDeclaredYes' },
      { value: null, label: 'shared.fteDeclaredNo' },
    ]);
    const calls = get.mock.calls.filter(([url]) => url === '/capex-items/summary/filter-values');
    expect(calls.map(([, config]) => config.params.fields)).toEqual(['has_fte']);
  });

  it('offers cost center and run or build columns, hidden by default, filtered on the values the server lists', async () => {
    await renderPage();
    const costCenter = column('cost_center_label');
    const runBuild = column('run_build');
    expect(costCenter).toMatchObject({ headerName: 'capex.columns.costCenter', defaultHidden: true, filter: CheckboxSetFilter });
    expect(runBuild).toMatchObject({ headerName: 'capex.columns.runBuild', defaultHidden: true, filter: CheckboxSetFilter });
    // Declared right after the analytics column (the budget holder between them), so saved layouts place them next to it.
    const ids = lastProps().columns.map((c) => c.colId ?? c.field);
    expect(ids.indexOf('cost_center_label')).toBe(ids.indexOf('analytics_category_name') + 1);
    expect(ids.indexOf('run_build')).toBe(ids.indexOf('analytics_category_name') + 3);
    expect(runBuild?.valueFormatter?.({ value: 'build' })).toBe('capex.runBuild.build');

    get.mockImplementation(async (url: string, config?: { params?: { fields?: string } }) => {
      if (url !== '/capex-items/summary/filter-values') return { data: {} };
      const field = config?.params?.fields ?? '';
      return { data: { [field]: field === 'run_build' ? [null, 'run'] : ['IT-200 · Applications', null] } };
    });
    type GetValues = (p: unknown) => Promise<Array<{ value: string | null; label: string }>>;
    const noState = { context: { getQueryState: () => ({}) } };
    expect(await (costCenter!.filterParams!.getValues as GetValues)(noState)).toEqual([
      { value: 'IT-200 · Applications', label: 'IT-200 · Applications' },
      { value: null, label: 'shared.blank' },
    ]);
    expect(await (runBuild!.filterParams!.getValues as GetValues)(noState)).toEqual([
      { value: 'run', label: 'capex.runBuild.run' },
      { value: null, label: 'shared.blank' },
    ]);
    const calls = get.mock.calls.filter(([url]) => url === '/capex-items/summary/filter-values');
    expect(calls.map(([, config]) => config.params.fields)).toEqual(['cost_center_label', 'run_build']);
  });

  it('links the cost center cell to the cost center, and nowhere when the line has none', async () => {
    await renderPage();
    const hrefOf = (data: Record<string, unknown>) => {
      const el = column('cost_center_label')!.cellRenderer!({ data, value: '', colDef: {} });
      return (el.props as { getHref: (row: unknown) => string | null }).getHref(data);
    };
    expect(hrefOf({ id: 'c-1', item_number: 7, cost_center_id: 'cc-1' })).toBe('/master-data/cost-centers/cc-1/overview');
    expect(hrefOf({ id: 'c-1', item_number: 7 })).toBeNull();
  });

  it('offers a budget holder column after the cost center, hidden by default, filtered on the values the server lists', async () => {
    await renderPage();
    const holder = column('budget_holder_name');
    expect(holder).toMatchObject({ headerName: 'capex.columns.budgetHolder', defaultHidden: true, filter: CheckboxSetFilter });
    const ids = lastProps().columns.map((c) => c.colId ?? c.field);
    expect(ids.indexOf('budget_holder_name')).toBe(ids.indexOf('cost_center_label') + 1);

    get.mockImplementation(async (url: string, config?: { params?: { fields?: string } }) => {
      if (url !== '/capex-items/summary/filter-values') return { data: {} };
      return { data: { [config?.params?.fields ?? '']: ['Ada Holder', null] } };
    });
    type GetValues = (p: unknown) => Promise<Array<{ value: string | null; label: string }>>;
    const options = await (holder!.filterParams!.getValues as GetValues)({ context: { getQueryState: () => ({}) } });
    expect(options).toEqual([
      { value: 'Ada Holder', label: 'Ada Holder' },
      { value: null, label: 'shared.blank' },
    ]);
    const calls = get.mock.calls.filter(([url]) => url === '/capex-items/summary/filter-values');
    expect(calls.map(([, config]) => config.params.fields)).toEqual(['budget_holder_name']);

    // The cell opens the line, like the owner columns: the budget holder is read from the cost center.
    const data = { id: 'c-1', item_number: 7, cost_center_id: 'cc-1', budget_holder_name: 'Ada Holder' };
    const el = holder!.cellRenderer!({ data, value: 'Ada Holder', colDef: {} });
    const href = (el.props as { getHref: (row: unknown) => string | null }).getHref(data);
    expect(href).toMatch(/^\/ops\/capex\/CPX-7\/overview/);
  });

  it('names the default dimension column after the dimension, hidden by default as before', async () => {
    await renderPage();
    const ids = lastProps().columns.map((c) => c.colId ?? c.field);
    expect(ids.filter((id) => id?.startsWith('analytics_'))).toEqual(['analytics_category_name']);
    // No name yet: the translated default label.
    expect(column('analytics_category_name')).toMatchObject({
      headerName: 'master-data:analytics.analyticsCategoryFallback', defaultHidden: true, filter: CheckboxSetFilter,
    });
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
      headerName: 'Nature', defaultHidden: true, filter: CheckboxSetFilter, floatingFilterComponent: CheckboxSetFloatingFilter,
    });
    expect(column('analytics_activity')).toMatchObject({ headerName: 'Activity', defaultHidden: true });

    // The cell opens the line.
    const data = { id: 'c-1', item_number: 7, analytics_nature: 'Licences' };
    const el = column('analytics_nature')!.cellRenderer!({ data, value: 'Licences', colDef: {} });
    expect((el.props as { getHref: (row: unknown) => string | null }).getHref(data)).toMatch(/^\/ops\/capex\/CPX-7\/overview/);

    // A set filter on the values the server lists for that dimension.
    get.mockImplementation(async (url: string, config?: { params?: { fields?: string } }) => {
      if (url !== '/capex-items/summary/filter-values') return { data: {} };
      return { data: { [config?.params?.fields ?? '']: ['Licences', null] } };
    });
    type GetValues = (p: unknown) => Promise<Array<{ value: string | null; label: string }>>;
    const options = await (column('analytics_nature')!.filterParams!.getValues as GetValues)({ context: { getQueryState: () => ({}) } });
    expect(options).toEqual([
      { value: 'Licences', label: 'Licences' },
      { value: null, label: 'shared.blank' },
    ]);
    const calls = get.mock.calls.filter(([url]) => url === '/capex-items/summary/filter-values');
    expect(calls.map(([, config]) => config.params.fields)).toEqual(['analytics_nature']);
  });

  it('mounts the grid only once the dimensions are known, so a saved layout finds their columns', async () => {
    dimensions.ready = false;
    dimensions.list = [];
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/ops/capex']}>
          <LocationProbe />
          <CapexPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // The budget columns setting is known from the start (mocked); the grid and the footer totals still wait.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(grid).not.toHaveBeenCalled();
    expect(get.mock.calls.some(([url]) => url === '/capex-items/summary/totals')).toBe(false);

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
    window.sessionStorage.setItem('capex-list-context', JSON.stringify({
      sort: `analytics_${OLD}:ASC`, q: '', filters: JSON.stringify(filters), statusScope: 'enabled',
    }));
    await renderPage();
    // The grid only ever renders on the settled URL.
    expect(seen.searches.length).toBeGreaterThan(0);
    for (const search of seen.searches) {
      const params = new URLSearchParams(search);
      expect(params.get('sort')).toBeNull();
      expect(JSON.parse(params.get('filters') ?? '{}')).toEqual(kept);
    }
    const totals = get.mock.calls.filter(([url]) => url === '/capex-items/summary/totals');
    expect(totals.length).toBeGreaterThan(0);
    for (const [, config] of totals) expect(JSON.parse(config.params.filters)).toEqual(kept);
  });

  it('lean rows with the FTE columns shown, exclude mode, footer for the amount columns shown', async () => {
    await renderPage();
    expect(lastProps().setFilterExcludeMode).toBe(true);
    expect(lastProps().pageParams?.([{ colId: 'fte_yBudget', hide: false }, { colId: 'fte_yLanding', hide: true }, { colId: 'yBudget' }]))
      .toEqual({ shape: 'grid', fte: 'fte_yBudget' });
    act(() => lastProps().onGridApiReady({ getColumnState: () => [{ colId: 'yBudget', hide: false }, { colId: 'yRevision', hide: true }, { colId: 'yPlus1Forecast' }] }));
    act(() => lastProps().onQueryStateChange({ sort: 'yBudget:DESC', filterModel: {}, q: '', statusScope: 'enabled' }));
    await waitFor(() => {
      const totals = get.mock.calls.filter(([url]) => url === '/capex-items/summary/totals');
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

  it('offers the priority, investment type and PPE type values in their business order, blanks last', async () => {
    await renderPage();
    const listed: Record<string, Array<string | null>> = {
      priority: ['low', 'mandatory', null, 'medium', 'high'],
      investment_type: ['other', 'security', 'replacement', 'business_growth', 'capacity', 'conformity', 'productivity'],
      ppe_type: ['software', 'hardware'],
    };
    get.mockImplementation(async (url: string, config?: { params?: { fields?: string } }) => {
      if (url !== '/capex-items/summary/filter-values') return { data: {} };
      const field = config?.params?.fields ?? '';
      return { data: { [field]: listed[field] } };
    });
    type GetValues = (p: unknown) => Promise<Array<{ value: string | null; label: string }>>;
    const noState = { context: { getQueryState: () => ({}) } };
    const valuesOf = async (id: string) => (await (column(id)!.filterParams!.getValues as GetValues)(noState)).map((o) => o.value);
    expect(await valuesOf('priority')).toEqual(['mandatory', 'high', 'medium', 'low', null]);
    expect(await valuesOf('investment_type')).toEqual(['replacement', 'capacity', 'productivity', 'security', 'conformity', 'business_growth', 'other']);
    expect(await valuesOf('ppe_type')).toEqual(['hardware', 'software']);
    // Labels as translated, order kept.
    const priority = await (column('priority')!.filterParams!.getValues as GetValues)(noState);
    expect(priority[0]).toEqual({ value: 'mandatory', label: 'capex.priorityTypes.mandatory' });
  });

  it('keeps a linked sort on an enabled dimension', async () => {
    const NATURE = '11111111-1111-4111-8111-111111111111';
    dimensions.list = [DEFAULT_DIMENSION, dimension(NATURE, 'Nature', 1)];
    await renderPage(`/ops/capex?sort=analytics_${NATURE}:ASC`);
    for (const search of seen.searches) expect(new URLSearchParams(search).get('sort')).toBe(`analytics_${NATURE}:ASC`);
  });
});
