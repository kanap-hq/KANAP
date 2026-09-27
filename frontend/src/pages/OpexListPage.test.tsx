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
vi.mock('../components/ServerDataGrid', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/ServerDataGrid')>()),
  default: (props: unknown) => {
    grid(props);
    return null;
  },
}));

import api from '../api';
import CheckboxSetFilter from '../components/CheckboxSetFilter';
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
  filterParams?: { getValues?: (p: unknown) => Promise<Array<{ value: string | null; label: string }>> };
  cellRenderer?: (p: unknown) => React.ReactElement;
};
type GridProps = {
  columns: Col[];
  pinnedBottomRowData: Array<{ versions?: Record<string, { totals?: Record<string, number> }> }>;
  defaultSort: { field: string; direction: string };
  onQueryStateChange: (state: { sort: string; filterModel: Record<string, unknown>; q: string; statusScope: string }) => void;
};
const location = { search: '' };
function LocationProbe() {
  location.search = useLocation().search;
  return null;
}
let columnsSetting: BudgetColumnsSettings = DEFAULT_BUDGET_COLUMNS;

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
    // Forecast is hidden by default.
    expect(lastProps().columns.filter((c) => c.filter === 'agNumberColumnFilter')).toHaveLength(16);
    expect(column('yForecast')).toBeUndefined();
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

  it('filters every date column with date models, from the menu and from the box under the header', async () => {
    await renderPage();
    for (const id of ['effective_start', 'disabled_at', 'created_at', 'updated_at']) {
      expect(column(id)).toMatchObject({ filter: 'agDateColumnFilter', floatingFilterComponent: 'agDateColumnFloatingFilter' });
    }
  });

  it('fills the footer from the totals keys of the same name', async () => {
    await renderPage();
    const versions = lastProps().pinnedBottomRowData[0].versions!;
    expect(versions.yPlus2.totals?.budget).toBe(80);
    expect(versions.yPlus2.totals?.landing).toBe(60);
    expect(versions.y.totals?.forecast).toBe(5);
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
});
