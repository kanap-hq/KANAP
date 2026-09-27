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
});
