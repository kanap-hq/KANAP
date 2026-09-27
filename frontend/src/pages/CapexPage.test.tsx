import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
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
// The list URL at the time the grid renders, recorded by a probe rendered just before the page.
const seen = vi.hoisted(() => ({ search: '', searches: [] as string[] }));
vi.mock('../components/ServerDataGrid', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/ServerDataGrid')>()),
  default: (props: unknown) => {
    grid(props);
    seen.searches.push(seen.search);
    return null;
  },
}));
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

import api from '../api';
import CheckboxSetFilter from '../components/CheckboxSetFilter';
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
  cellRenderer?: (p: unknown) => React.ReactElement;
};
type GridProps = {
  columns: Col[];
  pinnedBottomRowData: Array<{ versions?: Record<string, { totals?: Record<string, number> }> }>;
  defaultSort: { field: string; direction: string };
};

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const lastProps = () => grid.mock.calls[grid.mock.calls.length - 1][0] as GridProps;
const column = (id: string) => lastProps().columns.find((c) => (c.colId ?? c.field) === id);

function LocationProbe() {
  seen.search = useLocation().search;
  return null;
}

/** Renders the page and waits for the totals footer, the last state update of the first load. */
async function renderPage(url = '/ops/capex') {
  render(
    <MemoryRouter initialEntries={[url]}>
      <LocationProbe />
      <CapexPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(lastProps().pinnedBottomRowData).toHaveLength(1));
}

describe('CapexPage', () => {
  beforeEach(() => {
    grid.mockReset();
    seen.searches = [];
    columnsSetting.current = DEFAULT_BUDGET_COLUMNS;
    window.sessionStorage.clear();
    get.mockReset();
    get.mockResolvedValue({ data: { yBudget: 10, yPlus2Forecast: 4, yMinus1Revision: 3, reportingCurrency: 'X' } });
  });

  it('offers every shown column of every list year, filtered with number models', async () => {
    await renderPage();
    const amounts = lastProps().columns.filter((c) => c.filter === 'agNumberColumnFilter');
    // Forecast is hidden by default: not in the chooser, sort or filters.
    expect(amounts).toHaveLength(16);
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
    expect(lastProps().columns.filter((c) => c.filter === 'agNumberColumnFilter')).toHaveLength(20);
    expect(column('yPlus2Forecast')?.headerName).toBe('ops:shared.amountColumnHeader');
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
      expect(column(id)).toMatchObject({ filter: 'agDateColumnFilter', floatingFilterComponent: 'agDateColumnFloatingFilter' });
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

  it('fills the footer from the totals keys of the same name', async () => {
    await renderPage();
    const versions = lastProps().pinnedBottomRowData[0].versions!;
    expect(versions.yPlus2.totals?.forecast).toBe(4);
    expect(versions.yMinus1.totals?.revision).toBe(3);
    expect(versions.y.totals?.budget).toBe(10);
  });
});
