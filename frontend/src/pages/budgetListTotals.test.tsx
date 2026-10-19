import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const frozen = vi.hoisted(() => ({ opex: false, capex: false }));
vi.mock('../hooks/useFreezeState', () => ({ useFreezeState: () => ({ data: { summary: { scopes: { opex: { budget: { frozen: frozen.opex } }, capex: { budget: { frozen: frozen.capex } } } } } }) }));
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
import BudgetListPage from './budget/BudgetListPage';
import { DEFAULT_BUDGET_COLUMNS } from '../services/budgetColumns';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;

const textFilter = (col: string, filter: string) => ({ [col]: { filterType: 'text', type: 'contains', filter } });
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(700); });

/**
 * Timers run on virtual time: a wait for the grid to settle (its start-up notifications) costs no
 * real time. Testing Library's waitFor advances that time itself when it sees Jest's timers, so
 * `jest` points at Vitest's. Promises, React's scheduler (setImmediate) and the mocked server stay
 * real.
 */
function runOnVirtualTime() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
}

describe.each([
  { name: 'OPEX list', Page: BudgetListPage, totals: '/budget-lines/summary/totals', rows: '/budget-lines/summary', col: 'product_name', search: '' },
  { name: 'OPEX list with a filter in the URL', Page: BudgetListPage, totals: '/budget-lines/summary/totals', rows: '/budget-lines/summary', col: 'product_name', search: '?filters=' + encodeURIComponent(JSON.stringify(textFilter('product_name', 'cloud'))) },
])('$name footer totals', ({ Page, totals, rows, col, search }) => {
  let stored = new Map<string, string>();
  beforeEach(() => {
    grid.api = null;
    frozen.opex = frozen.capex = false;
    get.mockReset();
    window.sessionStorage.clear();
    runOnVirtualTime();
    // jsdom has no ResizeObserver (the grid only uses it to size itself) and no localStorage
    // (the grid keeps the column layout there).
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    stored = new Map<string, string>();
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
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const totalsCalls = () => get.mock.calls.filter(([url]) => url === totals);
  const filtersOf = (call: unknown[]) => {
    const raw = (call[1] as { params: { filters?: string } }).params.filters;
    return raw ? JSON.parse(raw) : {};
  };

  const renderPage = () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/list${search}`]}>
          <Page />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };

  it('asks once on load when the saved layout shows an FTE column, with the filter and the FTE column', async () => {
    const key = 'budget-summary';
    stored.set(`grid-columns:test:u-1:${key}`, JSON.stringify([{ colId: 'fte_yBudget', hide: false }]));
    renderPage();
    await waitFor(() => expect(grid.api).not.toBeNull());
    await waitFor(() => expect(get.mock.calls.some(([url]) => url === rows)).toBe(true));
    await settle();
    expect(totalsCalls()).toHaveLength(1);
    expect(filtersOf(totalsCalls()[0])).toEqual(search ? textFilter(col, 'cloud') : {});
    expect((totalsCalls()[0][1] as { params: { fte?: string } }).params.fte).toBe('fte_yBudget');
  }, 20_000);

  it('asks the totals once per query: on load and filter changes, none on a sort', async () => {
    renderPage();
    await waitFor(() => expect(grid.api).not.toBeNull());
    await waitFor(() => expect(get.mock.calls.some(([url]) => url === rows)).toBe(true));
    await settle();
    // The grid reports its query several times while it starts; the totals are asked once, with
    // the filter the grid applied.
    expect(totalsCalls()).toHaveLength(1);
    expect(filtersOf(totalsCalls()[0])).toEqual(search ? textFilter(col, 'cloud') : {});

    // A sort changes no total.
    await act(async () => {
      grid.api.applyColumnState({ state: [{ colId: col, sort: 'asc' }], defaultState: { sort: null } });
    });
    await settle();
    expect(get.mock.calls.some(([url, config]) => url === rows && config?.params?.sort === `${col}:ASC`)).toBe(true);
    expect(totalsCalls()).toHaveLength(1);

    // A filter change reloads the totals with the new filter.
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
    expect((totalsCalls()[2][1] as { params: unknown }).params).toEqual((totalsCalls()[1][1] as { params: unknown }).params);
  }, 20_000);
  const totalRow = () => document.querySelector('.ag-floating-bottom .ag-row');
  const locks = () => Array.from(document.querySelectorAll('.ag-floating-bottom [aria-label="operations.freeze.frozen"]'));

  it('the real grid shows no lock on Total when only OPEX is frozen', async () => {
    frozen.opex = true;
    renderPage();
    await waitFor(() => expect(grid.api).not.toBeNull());
    await settle();
    await waitFor(() => expect(totalRow()?.querySelector('[col-id="yBudget"]')?.textContent).toMatch(/10/));
    expect(document.querySelectorAll('.ag-floating-bottom .ag-row')).toHaveLength(1);
    expect(locks()).toHaveLength(0);
  }, 20_000);

  it('the real grid shows a lock on Total when OPEX and CAPEX are both frozen', async () => {
    frozen.opex = frozen.capex = true;
    renderPage();
    await waitFor(() => expect(grid.api).not.toBeNull());
    await settle();
    await waitFor(() => expect(locks()).toHaveLength(1));
    expect(document.querySelectorAll('.ag-floating-bottom .ag-row')).toHaveLength(1);
    expect(locks()[0].closest('.ag-row')).toBe(totalRow());
  }, 20_000);

  it('marks a line amount without an exchange rate and names what the totals leave out under the grid', async () => {
    const line = {
      id: 'l-1', item_number: 7, nature: 'opex', product_name: 'Cloud', currency: 'USD', status: 'enabled', created_at: '2026-01-01',
      versions: { y: {
        year: new Date().getFullYear(),
        reporting: { budget: null, revision: null, forecast: null, follow_up: null, landing: null },
        fx_missing: { currency: 'USD', amounts: { budget: 12000, revision: 0, forecast: 0, follow_up: 0, landing: 0 } },
      } },
    };
    const base = get.getMockImplementation() as (url: string, config?: unknown) => Promise<unknown>;
    get.mockImplementation(async (url: string, config?: unknown) => {
      if (url === rows) return { data: { items: [line], total: 1, page: 1, limit: 50 } };
      if (url === totals) return { data: { yBudget: 0, reportingCurrency: 'EUR', fxMissing: [{ currency: 'USD', year: 2026, lines: 1 }] } };
      return base(url, config);
    });
    renderPage();
    await waitFor(() => expect(grid.api).not.toBeNull());
    await settle();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('shared.fxMissing.excluding'));
    const cell = await waitFor(() => {
      const found = document.querySelector('.ag-center-cols-container [row-id="l-1"] [col-id="yBudget"]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(cell.textContent).toBe('ops:shared.fxMissing.localAmount');
    expect(cell.querySelector('[aria-label="shared.fxMissing.lineTooltip"]')).not.toBeNull();
  }, 20_000);

});
