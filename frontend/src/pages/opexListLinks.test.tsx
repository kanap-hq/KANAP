import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A report row opens the OPEX list in a new tab on its filters and Show scope: these specs mount the
// real list, the real ServerDataGrid and AG Grid on such an address, and check that the list shows
// why it is narrowed (the filtered hidden columns appear, with their filters) and asks the server for
// exactly the report's lines (every status, the window on End of validity).
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
vi.mock('../components/PageHeader', () => ({ default: () => null }));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({ default: () => null }));
vi.mock('../hooks/useAnalyticsAxes', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../hooks/useAnalyticsAxes')>();
  const t = ((key: string) => key) as unknown as Parameters<typeof mod.buildAnalyticsAxes>[1];
  const axes = mod.buildAnalyticsAxes([
    { id: 'default', code: 'default', name: null, description: null, sort_order: 0, is_default: true, status: 'enabled', disabled_at: null },
  ] as never, t, true);
  return { ...mod, useAnalyticsAxes: () => axes };
});
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
import { DEFAULT_BUDGET_COLUMNS } from '../services/budgetColumns';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const ROWS = '/spend-items/summary';
const TOTALS = '/spend-items/summary/totals';
const VALUES = '/spend-items/summary/filter-values';
const SUPPLIERS = ['Alpha', 'Bravo', 'Charlie'];

const calls = (url: string) => get.mock.calls.filter(([u]) => u === url);
const counts = () => ({ rows: calls(ROWS).length, totals: calls(TOTALS).length, values: calls(VALUES).length });
// After the counts are reached: longer than the grid's block delay (150 ms) and the filters' quiet
// delay (300 ms), so a request sent twice would show.
const QUIET_MS = 500;
const quiet = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, QUIET_MS)); });

/** Waits for the expected request counts (slow CI included), then checks nothing more arrives. */
async function expectCounts(expected: ReturnType<typeof counts>) {
  await waitFor(() => expect(counts()).toEqual(expected), { timeout: 10_000 });
  await quiet();
  expect(counts()).toEqual(expected);
}
const paramsOf = (call: unknown[]) => (call[1] as { params: Record<string, string> }).params;

/** The cell under a column header (the filter box). */
function floatingFilterCell(colId: string): HTMLElement {
  const index = document.querySelector(`.ag-header-cell[col-id="${colId}"]`)!.getAttribute('aria-colindex');
  return document.querySelector(`.ag-floating-filter[aria-colindex="${index}"]`) as HTMLElement;
}

function renderPage(path = '/ops/opex') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <OpexListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Opens the list and waits for its first page and totals, then for the requests to stop. */
async function openList(path?: string) {
  const view = renderPage(path);
  await waitFor(() => expect(grid.api).not.toBeNull(), { timeout: 10_000 });
  await waitFor(() => {
    expect(calls(ROWS).length).toBeGreaterThan(0);
    expect(calls(TOTALS).length).toBeGreaterThan(0);
  }, { timeout: 10_000 });
  await quiet();
  return view;
}


const set = (values: Array<string | null>) => ({ filterType: 'set', values });
const WINDOW = {
  filterType: 'date',
  operator: 'OR',
  conditions: [
    { filterType: 'date', type: 'blank', dateFrom: null, dateTo: null },
    { filterType: 'date', type: 'greaterThan', dateFrom: '2024-12-31 00:00:00', dateTo: null },
  ],
};
const LINK_FILTERS = {
  disabled_at: WINDOW,
  has_fte: set(['yes']),
  cost_center_label: set(['CC1 · Ops']),
  account_id: set(['acc-1']),
};
const linkPath = (filters: Record<string, unknown> = LINK_FILTERS) => `/ops/opex?${new URLSearchParams({ filters: JSON.stringify(filters), statusScope: 'all', from: 'report' })}`;
const visible = (colId: string) => grid.api.getColumn(colId)?.isVisible();
const savedLayout = (stored: Map<string, string>) => JSON.parse(stored.get('grid-columns:test:u-1:opex-summary') ?? '[]') as Array<{ colId: string; hide?: boolean }>;

describe('OPEX list opened from a report link', () => {
  let stored = new Map<string, string>();
  beforeEach(() => {
    grid.api = null;
    get.mockReset();
    window.sessionStorage.clear();
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    });
    get.mockImplementation(async (url: string) => {
      if (url === '/budget-columns') return { data: DEFAULT_BUDGET_COLUMNS };
      if (url === ROWS) return { data: { items: [{ id: 'o-1', item_number: 1, product_name: 'Cloud' }], total: 1, page: 1, limit: 50 } };
      if (url === TOTALS) return { data: { yBudget: 10 } };
      return { data: { items: [] } };
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the filtered hidden columns (cost center, End of validity, FTE declared) for this visit, not the link-only account column', async () => {
    await openList(linkPath());
    await waitFor(() => expect(visible('cost_center_label')).toBe(true), { timeout: 10_000 });
    expect(visible('disabled_at')).toBe(true);
    expect(visible('has_fte')).toBe(true);
    // The account id only carries the link's filter: never shown, never in the chooser.
    expect(visible('account_id')).toBe(false);
    // Their filters show in the boxes under the headers (the reason the list is narrowed).
    await waitFor(() => expect(floatingFilterCell('cost_center_label').querySelector('button[aria-label="filters.clearFilter"]')).not.toBeNull());
    expect(floatingFilterCell('has_fte').querySelector('button[aria-label="filters.clearFilter"]')).not.toBeNull();
    expect(floatingFilterCell('disabled_at').querySelector('button[aria-label="filters.clearFilter"]')).not.toBeNull();
    expect(floatingFilterCell('disabled_at').textContent?.toLowerCase()).toContain('filters.date.greaterthan');
    // On screen: right after the name, not at their place far right in the layout (where they opened
    // off screen and the list looked narrowed for no reason).
    const order = grid.api.getAllGridColumns().filter((column: any) => column.isVisible()).map((column: any) => column.getColId());
    const name = order.indexOf('product_name');
    expect(order.slice(name + 1, name + 4).sort()).toEqual(['cost_center_label', 'disabled_at', 'has_fte']);
    // Shown for this visit only: the saved layout keeps them hidden, at their former place.
    const saved = savedLayout(stored);
    for (const colId of ['cost_center_label', 'disabled_at', 'has_fte']) {
      expect(saved.find((state) => state.colId === colId)?.hide).not.toBe(false);
    }
    const savedIds = saved.map((state) => state.colId);
    if (savedIds.length) {
      expect(savedIds.indexOf('cost_center_label')).toBeGreaterThan(savedIds.indexOf('analytics_category_name'));
      expect(savedIds.indexOf('disabled_at')).toBeGreaterThan(savedIds.indexOf('effective_start'));
    }
  }, 30_000);

  it('a user layout change during the visit is saved without the columns shown for it', async () => {
    await openList(linkPath());
    await waitFor(() => expect(visible('cost_center_label')).toBe(true), { timeout: 10_000 });
    await act(async () => { grid.api.setColumnsVisible(['supplier_name'], false); });
    await quiet();
    const saved = savedLayout(stored);
    expect(saved.find((state) => state.colId === 'supplier_name')?.hide).toBe(true);
    expect(saved.find((state) => state.colId === 'cost_center_label')?.hide).toBe(true);
    const savedIds = saved.map((state) => state.colId);
    expect(savedIds.indexOf('cost_center_label')).toBeGreaterThan(savedIds.indexOf('analytics_category_name'));
  }, 30_000);

  it('asks for every status and the report window, exactly as the link says', async () => {
    await openList(linkPath());
    const params = paramsOf(calls(ROWS)[0]);
    expect(params.includeDisabled).toBe('1');
    expect(params.status).toBeUndefined();
    expect(JSON.parse(params.filters)).toEqual(LINK_FILTERS);
    // Totals follow the same scope.
    expect(paramsOf(calls(TOTALS).slice(-1)[0]).includeDisabled).toBe('1');
    // The Show switch says All.
    expect((document.querySelector('input[type="radio"][value="all"]') as HTMLInputElement).checked).toBe(true);
  }, 30_000);

  it('without a scope in the address: the list default (enabled)', async () => {
    await openList('/ops/opex');
    expect(paramsOf(calls(ROWS)[0]).status).toBe('enabled');
    expect((document.querySelector('input[type="radio"][value="enabled"]') as HTMLInputElement).checked).toBe(true);
  }, 30_000);
});
