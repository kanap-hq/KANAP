import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// These specs mount the real ServerDataGrid (and AG Grid) so the grid's own start-up
// notifications (URL sync, initial sort, grid ready) reach the page as they do in the browser.
vi.mock('react-i18next', () => {
  const translation = {
    t: (key: string) => key,
    i18n: { language: 'en', resolvedLanguage: 'en', getResourceBundle: () => ({}) },
  };
  return { useTranslation: () => translation };
});
vi.mock('../api', () => ({ default: { get: vi.fn() } }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'u-1' } }) }));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'test' }) }));
vi.mock('../config/ThemeContext', () => ({ useThemeMode: () => ({ resolvedMode: 'light' }) }));
vi.mock('../components/PageHeader', async () => {
  const { createElement, Fragment } = await import('react');
  return { default: ({ actions }: { actions?: React.ReactNode }) => createElement(Fragment, null, actions) };
});
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({ default: () => null }));
// A delete button that reports a delete, as the real one does once the server confirms it.
vi.mock('../components/DeleteSelectedButton', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ onDeleteSuccess }: { onDeleteSuccess: () => void }) =>
      createElement('button', { type: 'button', onClick: onDeleteSuccess }, 'delete-selected'),
  };
});
vi.mock('../hooks/useAnalyticsAxes', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../hooks/useAnalyticsAxes')>();
  const t = ((key: string) => key) as unknown as Parameters<typeof mod.buildAnalyticsAxes>[1];
  const axes = mod.buildAnalyticsAxes([
    { id: 'default', code: 'default', name: null, description: null, sort_order: 0, is_default: true, status: 'enabled', disabled_at: null },
  ] as never, t, true);
  return { ...mod, useAnalyticsAxes: () => axes };
});
// The real grid, with its API handed to the test so it can change a filter the way a user does.
const grid = vi.hoisted(() => ({ api: null as any }));
vi.mock('../components/ServerDataGrid', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../components/ServerDataGrid')>();
  const Real = mod.default as React.ComponentType<any>;
  const { createElement } = await import('react');
  return {
    ...mod,
    default: (props: any) => createElement(Real, {
      ...props,
      onGridApiReady: (api: unknown) => {
        grid.api = api;
        props.onGridApiReady?.(api);
      },
    }),
  };
});

import api from '../api';
import OpexListPage from './OpexListPage';
import CapexPage from './CapexPage';
import { DEFAULT_BUDGET_COLUMNS } from '../services/budgetColumns';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;

const textFilter = (col: string, filter: string) => ({ [col]: { filterType: 'text', type: 'contains', filter } });
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 700)); });

describe.each([
  { name: 'OPEX list', Page: OpexListPage, totals: '/spend-items/summary/totals', rows: '/spend-items/summary', col: 'product_name', search: '' },
  { name: 'OPEX list with a filter in the URL', Page: OpexListPage, totals: '/spend-items/summary/totals', rows: '/spend-items/summary', col: 'product_name', search: '?filters=' + encodeURIComponent(JSON.stringify(textFilter('product_name', 'cloud'))) },
  { name: 'CAPEX list', Page: CapexPage, totals: '/capex-items/summary/totals', rows: '/capex-items/summary', col: 'description', search: '' },
  { name: 'CAPEX list with a filter in the URL', Page: CapexPage, totals: '/capex-items/summary/totals', rows: '/capex-items/summary', col: 'description', search: '?filters=' + encodeURIComponent(JSON.stringify(textFilter('description', 'cloud'))) },
])('$name footer totals', ({ Page, totals, rows, col, search }) => {
  beforeEach(() => {
    grid.api = null;
    get.mockReset();
    window.sessionStorage.clear();
    // jsdom has no ResizeObserver (the grid only uses it to size itself) and no localStorage
    // (the grid keeps the column layout there).
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    });
    get.mockImplementation(async (url: string) => {
      if (url === '/users') return { data: { items: [] } };
      if (url === '/budget-columns') return { data: DEFAULT_BUDGET_COLUMNS };
      if (url === rows) return { data: { items: [], total: 0, page: 1, limit: 50 } };
      return { data: { yBudget: 10, reportingCurrency: 'EUR' } };
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const totalsCalls = () => get.mock.calls.filter(([url]) => url === totals);
  const filtersOf = (call: unknown[]) => {
    const raw = (call[1] as { params: { filters?: string } }).params.filters;
    return raw ? JSON.parse(raw) : {};
  };

  it('asks the totals once per distinct query: once on load, once more on a filter change, none on a sort', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/list${search}`]}>
          <Page />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(grid.api).not.toBeNull());
    await waitFor(() => expect(get.mock.calls.some(([url]) => url === rows)).toBe(true));
    await settle();
    // The grid reports its query several times while it starts; the footer asks once, with the
    // filter the grid applied (never a first request without it).
    expect(totalsCalls()).toHaveLength(1);
    expect(filtersOf(totalsCalls()[0])).toEqual(search ? textFilter(col, 'cloud') : {});

    // A sort changes no total.
    await act(async () => {
      grid.api.applyColumnState({ state: [{ colId: col, sort: 'asc' }], defaultState: { sort: null } });
    });
    await settle();
    expect(get.mock.calls.some(([url, config]) => url === rows && config?.params?.sort === `${col}:ASC`)).toBe(true);
    expect(totalsCalls()).toHaveLength(1);

    // A filter change asks once more, with the new filter.
    await act(async () => {
      grid.api.setFilterModel(textFilter(col, 'licence'));
    });
    await settle();
    expect(totalsCalls()).toHaveLength(2);
    expect(filtersOf(totalsCalls()[1])).toEqual(textFilter(col, 'licence'));

    // A delete changes the lines, not the query: the same query is asked again.
    fireEvent.click(screen.getByRole('button', { name: 'delete-selected' }));
    await settle();
    expect(totalsCalls()).toHaveLength(3);
    expect(totalsCalls()[2][1]).toEqual(totalsCalls()[1][1]);
    // The real grid mounts four times here: 3 to 4 s alone, more under the full suite's load.
  }, 20_000);
});
