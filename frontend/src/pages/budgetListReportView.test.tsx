import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The OPEX and CAPEX lists opened from a report row, then used: these specs mount the real list, the
// real ServerDataGrid and AG Grid, and check what the tab remembers (sessionStorage), what the address
// says and what the server is asked.
// - A report link is a one-off view: it never becomes the tab's remembered list state.
// - A filter the user removes (its box's clear button, the menu's Clear, Reset columns) stays removed
//   in the address, in the remembered state and after a reload.
// - End of validity keeps both conditions of the report's window everywhere, and its box says so.
// - Without any filter, the Show scope alone decides which lines the server is asked for.
vi.mock('react-i18next', () => {
  const translation = {
    t: (key: string) => key,
    i18n: { language: 'en', resolvedLanguage: 'en', getResourceBundle: () => ({}) },
  };
  return { useTranslation: () => translation };
});
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
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
import CapexPage from './CapexPage';
import { DEFAULT_BUDGET_COLUMNS } from '../services/budgetColumns';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const paramsOf = (call: unknown[]) => (call[1] as { params: Record<string, string> }).params;
const QUIET_MS = 500;
const quiet = () => act(async () => { await vi.advanceTimersByTimeAsync(QUIET_MS); });

const LISTS = [
  { name: 'OPEX', Page: OpexListPage, path: '/ops/opex', rows: '/spend-items/summary', totals: '/spend-items/summary/totals', storage: 'opex-list-context' },
  { name: 'CAPEX', Page: CapexPage, path: '/ops/capex', rows: '/capex-items/summary', totals: '/capex-items/summary/totals', storage: 'capex-list-context' },
] as const;

const set = (values: Array<string | null>) => ({ filterType: 'set', values });
const WINDOW = {
  filterType: 'date',
  operator: 'OR',
  conditions: [
    { filterType: 'date', type: 'blank', dateFrom: null, dateTo: null },
    { filterType: 'date', type: 'greaterThan', dateFrom: '2024-12-31 00:00:00', dateTo: null },
  ],
};
const LINK_FILTERS = { disabled_at: WINDOW, has_fte: set(['yes']), cost_center_label: set(['CC1 · Ops']) };
/** The user's own list state, remembered in this tab before the report link. */
const OWN_FILTERS = { supplier_name: set(['Alpha']) };

/**
 * Timers run on virtual time: a wait for the grid to settle (its start-up notifications, the
 * debounced search) costs no real time. Testing Library's waitFor advances that time itself
 * when it sees Jest's timers, so `jest` points at Vitest's. Promises, React's scheduler
 * (setImmediate) and the mocked server stay real.
 */
function runOnVirtualTime() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
}

/** The address of the page now (the list rewrites it with history replaced). */
const loc = { search: '', navigate: null as NavigateFunction | null };
function LocationProbe() {
  loc.search = useLocation().search;
  loc.navigate = useNavigate();
  return null;
}

/** The cell under a column header (the filter box). */
function floatingFilterCell(colId: string): HTMLElement {
  const index = document.querySelector(`.ag-header-cell[col-id="${colId}"]`)!.getAttribute('aria-colindex');
  return document.querySelector(`.ag-floating-filter[aria-colindex="${index}"]`) as HTMLElement;
}
const clearButton = (colId: string) => floatingFilterCell(colId).querySelector('button[aria-label="filters.clearFilter"]') as HTMLButtonElement | null;
const addressFilters = () => {
  const text = new URLSearchParams(loc.search).get('filters');
  return text ? JSON.parse(text) : null;
};

describe.each(LISTS)('$name list: report links, removed filters, End of validity, Show scope', (list) => {
  const calls = (url: string) => get.mock.calls.filter(([u]) => u === url);
  const lastRows = () => paramsOf(calls(list.rows).slice(-1)[0]);
  const stored = () => {
    const raw = window.sessionStorage.getItem(list.storage);
    return raw ? JSON.parse(raw) : null;
  };
  const linkPath = (extra: Record<string, string> = { statusScope: 'all', from: 'report' }) =>
    `${list.path}?${new URLSearchParams({ filters: JSON.stringify(LINK_FILTERS), ...extra })}`;

  async function openList(path: string) {
    grid.api = null;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <list.Page />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(grid.api).not.toBeNull(), { timeout: 10_000 });
    await waitFor(() => expect(calls(list.rows).length).toBeGreaterThan(0), { timeout: 10_000 });
    await quiet();
    return view;
  }

  /** A reload: the page mounts again on the address it shows now. */
  async function reload() {
    const address = `${list.path}${loc.search}`;
    cleanup();
    get.mockClear();
    await openList(address);
  }

  let layouts = new Map<string, string>();
  beforeEach(() => {
    grid.api = null;
    get.mockReset();
    window.sessionStorage.clear();
    runOnVirtualTime();
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    layouts = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => layouts.get(key) ?? null,
      setItem: (key: string, value: string) => { layouts.set(key, value); },
      removeItem: (key: string) => { layouts.delete(key); },
    });
    get.mockImplementation(async (url: string) => {
      if (url === '/budget-columns') return { data: DEFAULT_BUDGET_COLUMNS };
      if (url === list.rows) return { data: { items: [{ id: 'i-1', item_number: 1, product_name: 'Cloud', description: 'Cloud' }], total: 1, page: 1, limit: 50 } };
      if (url === list.totals) return { data: { yBudget: 10 } };
      return { data: { items: [] } };
    });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('a report link is a one-off view', () => {
    it('leaves the remembered state alone, even when the user changes the view; a later plain visit opens on the user\'s own state', async () => {
      const own = { sort: '', q: '', filters: JSON.stringify(OWN_FILTERS), statusScope: 'enabled' };
      window.sessionStorage.setItem(list.storage, JSON.stringify(own));
      await openList(linkPath());
      // Exactly the report's lines: every status, the link's filters, not the remembered ones.
      expect(paramsOf(calls(list.rows)[0]).includeDisabled).toBe('1');
      expect(JSON.parse(paramsOf(calls(list.rows)[0]).filters)).toEqual(LINK_FILTERS);
      expect(stored()).toEqual(own);

      // A change in the view goes to its address (the view survives a reload), not to the tab's state.
      await act(async () => { clearButton('has_fte')!.click(); });
      await quiet();
      expect(grid.api.getFilterModel().has_fte).toBeUndefined();
      expect(addressFilters()).toEqual({ disabled_at: WINDOW, cost_center_label: LINK_FILTERS.cost_center_label });
      expect(new URLSearchParams(loc.search).get('from')).toBe('report');
      expect(stored()).toEqual(own);

      await reload();
      expect(JSON.parse(lastRows().filters)).toEqual({ disabled_at: WINDOW, cost_center_label: LINK_FILTERS.cost_center_label });
      expect(lastRows().includeDisabled).toBe('1');
      expect(stored()).toEqual(own);

      // A plain visit: the user's own state, Show on its default.
      cleanup();
      get.mockClear();
      await openList(list.path);
      expect(JSON.parse(paramsOf(calls(list.rows)[0]).filters)).toEqual(OWN_FILTERS);
      expect(paramsOf(calls(list.rows)[0]).status).toBe('enabled');
      expect(addressFilters()).toEqual(OWN_FILTERS);
    }, 60_000);

    it('the menu\'s link to the list, followed from the view, opens on the user\'s own state', async () => {
      const own = { sort: '', q: '', filters: JSON.stringify(OWN_FILTERS), statusScope: 'enabled' };
      window.sessionStorage.setItem(list.storage, JSON.stringify(own));
      await openList(linkPath());
      get.mockClear();
      grid.api = null;
      // Same route, no reload (the sidebar): the list starts again on the tab's state.
      await act(async () => { loc.navigate!(list.path); });
      await waitFor(() => expect(grid.api).not.toBeNull(), { timeout: 10_000 });
      await waitFor(() => expect(calls(list.rows).length).toBeGreaterThan(0), { timeout: 10_000 });
      await quiet();
      expect(JSON.parse(lastRows().filters)).toEqual(OWN_FILTERS);
      expect(lastRows().status).toBe('enabled');
      expect(grid.api.getFilterModel()).toEqual(OWN_FILTERS);
      expect((document.querySelector('input[type="radio"][value="enabled"]') as HTMLInputElement).checked).toBe(true);
      expect(addressFilters()).toEqual(OWN_FILTERS);
    }, 60_000);

    it('without a remembered state, a later plain visit opens unfiltered on Enabled', async () => {
      await openList(linkPath());
      expect(stored()).toBeNull();
      cleanup();
      get.mockClear();
      await openList(list.path);
      expect(paramsOf(calls(list.rows)[0]).filters).toBeUndefined();
      expect(paramsOf(calls(list.rows)[0]).status).toBe('enabled');
      expect(loc.search).not.toContain('filters');
      expect((document.querySelector('input[type="radio"][value="enabled"]') as HTMLInputElement).checked).toBe(true);
    }, 60_000);

    it('its item links keep the view and its Show scope, so the item page walks the same lines', async () => {
      await openList(linkPath());
      const link = document.querySelector(`.ag-cell a[href^="${list.path}/"]`) as HTMLAnchorElement;
      expect(link).not.toBeNull();
      const params = new URLSearchParams(link.getAttribute('href')!.split('?')[1]);
      expect(params.get('from')).toBe('report');
      expect(params.get('statusScope')).toBe('all');
      expect(JSON.parse(params.get('filters')!)).toEqual(LINK_FILTERS);
    }, 60_000);

    it('a shared link without the marker is remembered as before (filters and Show scope)', async () => {
      await openList(linkPath({ statusScope: 'all' }));
      expect(JSON.parse(stored().filters)).toEqual(LINK_FILTERS);
      expect(stored().statusScope).toBe('all');
      const link = document.querySelector(`.ag-cell a[href^="${list.path}/"]`) as HTMLAnchorElement;
      expect(new URLSearchParams(link.getAttribute('href')!.split('?')[1]).get('from')).toBeNull();
    }, 60_000);
  });

  describe('a removed End of validity filter stays removed', () => {
    it('with the clear button of its box: gone from the grid, the address, the remembered state and after a reload', async () => {
      await openList(linkPath({ statusScope: 'all' }));
      await waitFor(() => expect(clearButton('disabled_at')).not.toBeNull(), { timeout: 10_000 });
      await act(async () => { clearButton('disabled_at')!.click(); });
      await quiet();
      expect(grid.api.getFilterModel().disabled_at).toBeUndefined();
      expect(addressFilters().disabled_at).toBeUndefined();
      expect(JSON.parse(stored().filters).disabled_at).toBeUndefined();
      expect(JSON.parse(lastRows().filters).disabled_at).toBeUndefined();
      await reload();
      expect(JSON.parse(lastRows().filters).disabled_at).toBeUndefined();
      expect(grid.api.getFilterModel().disabled_at).toBeUndefined();
    }, 60_000);

    it('with the Clear of its menu (a filter reset): no "Blank" condition is left applied', async () => {
      await openList(linkPath({ statusScope: 'all' }));
      await act(async () => {
        await grid.api.setColumnFilterModel('disabled_at', null);
        grid.api.onFilterChanged();
      });
      await quiet();
      expect(grid.api.getFilterModel().disabled_at).toBeUndefined();
      expect(addressFilters().disabled_at).toBeUndefined();
      expect(JSON.parse(stored().filters).disabled_at).toBeUndefined();
      await reload();
      expect(JSON.parse(lastRows().filters).disabled_at).toBeUndefined();
    }, 60_000);

    it('with Reset columns: the column goes back to hidden and its filter is gone for good', async () => {
      await openList(linkPath({ statusScope: 'all' }));
      await waitFor(() => expect(grid.api.getColumn('disabled_at').isVisible()).toBe(true), { timeout: 10_000 });
      const reset = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'common:buttons.resetColumns')!;
      await act(async () => { fireEvent.click(reset); });
      await quiet();
      expect(grid.api.getColumn('disabled_at').isVisible()).toBe(false);
      expect(grid.api.getFilterModel().disabled_at).toBeUndefined();
      expect(addressFilters()?.disabled_at).toBeUndefined();
      expect(JSON.parse(stored().filters || '{}').disabled_at).toBeUndefined();
      await reload();
      expect(JSON.parse(lastRows().filters || '{}').disabled_at).toBeUndefined();
    }, 60_000);
  });

  describe('End of validity keeps both conditions of the report window', () => {
    it('in the grid, the address and the remembered state, after its menu opens and closes, and after a reload', async () => {
      await openList(linkPath({ statusScope: 'all' }));
      const filter = await grid.api.getColumnFilterInstance('disabled_at');
      await act(async () => {
        filter.afterGuiAttached?.({ container: 'columnMenu', suppressFocus: true });
        filter.afterGuiDetached?.();
      });
      await quiet();
      expect(grid.api.getFilterModel().disabled_at).toEqual(WINDOW);
      expect(addressFilters().disabled_at).toEqual(WINDOW);
      expect(JSON.parse(stored().filters).disabled_at).toEqual(WINDOW);
      await reload();
      expect(JSON.parse(lastRows().filters).disabled_at).toEqual(WINDOW);
      expect(grid.api.getFilterModel().disabled_at).toEqual(WINDOW);
    }, 60_000);

    it('its box names both conditions and offers a clear button', async () => {
      await openList(linkPath());
      await waitFor(() => expect(clearButton('disabled_at')).not.toBeNull(), { timeout: 10_000 });
      // The test's `t` answers keys (the words are checked in DateFloatingFilter.test.tsx); the box
      // capitalises the first one.
      const text = (floatingFilterCell('disabled_at').textContent ?? '').toLowerCase();
      expect(text).toContain('filters.date.blank');
      expect(text).toContain('filters.date.or');
      expect(text).toContain('filters.date.greaterthan');
    }, 60_000);
  });

  describe('without any filter, the Show scope alone decides', () => {
    it('Enabled, Disabled, then All with a quick search: no filter is sent, only the scope and the search', async () => {
      await openList(list.path);
      expect(lastRows().status).toBe('enabled');
      expect(lastRows().filters).toBeUndefined();

      await act(async () => { fireEvent.click(document.querySelector('input[type="radio"][value="disabled"]')!); });
      await waitFor(() => expect(lastRows().status).toBe('disabled'), { timeout: 10_000 });
      expect(lastRows().filters).toBeUndefined();
      expect(stored().statusScope).toBe('disabled');
      expect(new URLSearchParams(loc.search).get('statusScope')).toBe('disabled');

      await act(async () => { fireEvent.click(document.querySelector('input[type="radio"][value="all"]')!); });
      const search = document.querySelector('input[placeholder="common:filters.quickFilter"]') as HTMLInputElement;
      await act(async () => { fireEvent.change(search, { target: { value: 'OVH' } }); });
      await waitFor(() => expect(lastRows().q).toBe('OVH'), { timeout: 10_000 });
      expect(lastRows().includeDisabled).toBe('1');
      expect(lastRows().status).toBeUndefined();
      expect(lastRows().filters).toBeUndefined();
    }, 60_000);
  });
});
