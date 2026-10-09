import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The OPEX list with the real grid and set filter (lot 2B, PR B2):
// - a 31 KB "every supplier but one" state travels as ctx in the API calls, the page URL, the cell
//   links and the stored list context, survives a reload and a link opened in a new tab;
// - the page requests ask for the lean grid rows with the FTE columns shown; the footer totals for
//   the amount columns shown; showing or hiding a column asks again what depends on it.
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
import { DEFAULT_BUDGET_COLUMNS } from '../services/budgetColumns';
import { resetListContextCache } from '../lib/listContext';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const ROWS = '/spend-items/summary';
const TOTALS = '/spend-items/summary/totals';
const ID = 'Opx_allButOne_0123456';
// "Every supplier but one": 1,152 names, about 31 KB once in a URL.
const SUPPLIERS = Array.from({ length: 1153 }, (_, i) => `Fournisseur ${String(i).padStart(4, '0')} Société Générale`);
const ALL_BUT_ONE = { supplier_name: { filterType: 'set', values: SUPPLIERS.slice(1) } };
const ALL_BUT_ONE_TEXT = JSON.stringify(ALL_BUT_ONE);

const calls = (url: string) => mocked.get.mock.calls.filter(([u]) => u === url);
const paramsOf = (call: unknown[]) => (call[1] as { params: Record<string, string> }).params;
const location = vi.hoisted(() => ({ search: '' }));

function LocationProbe() {
  location.search = useLocation().search;
  return null;
}

function renderAt(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <OpexListPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OPEX list: list contexts, lean rows, footer amounts', () => {
  beforeEach(() => {
    grid.api = null;
    location.search = '';
    resetListContextCache();
    mocked.get.mockReset();
    mocked.post.mockReset();
    window.sessionStorage.clear();
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    });
    mocked.post.mockResolvedValue({ data: { id: ID } });
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/budget-columns') return { data: DEFAULT_BUDGET_COLUMNS };
      if (url === `/list-contexts/${ID}`) return { data: { id: ID, list: 'spend-items', state: { filters: ALL_BUT_ONE } } };
      if (url === ROWS) {
        return { data: { items: [{ id: 'o-1', item_number: 1, product_name: 'Cloud', supplier: { id: 's', name: 'Fournisseur 0002 Société Générale' } }], total: 1, page: 1, limit: 50 } };
      }
      if (url === TOTALS) return { data: { yBudget: 10, reportingCurrency: 'EUR' } };
      return { data: { items: [] } };
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a 31 KB filter in the stored list context: page URL, API calls, cell links and storage carry ctx', async () => {
    expect(encodeURIComponent(ALL_BUT_ONE_TEXT).length).toBeGreaterThan(30_000);
    window.sessionStorage.setItem('opex-list-context', JSON.stringify({ sort: '', q: '', filters: ALL_BUT_ONE_TEXT, statusScope: 'enabled' }));
    renderAt('/ops/opex');
    await waitFor(() => expect(calls(ROWS).length).toBeGreaterThan(0), { timeout: 10_000 });
    await waitFor(() => expect(calls(TOTALS).length).toBeGreaterThan(0), { timeout: 10_000 });

    // Saved once, for every place the state goes.
    expect(mocked.post).toHaveBeenCalledTimes(1);
    expect(mocked.post).toHaveBeenCalledWith('/list-contexts', { list: 'spend-items', state: { filters: ALL_BUT_ONE } });
    // The page URL.
    const url = new URLSearchParams(location.search);
    expect(url.get('ctx')).toBe(ID);
    expect(url.get('filters')).toBeNull();
    // The API calls.
    for (const call of [...calls(ROWS), ...calls(TOTALS)]) {
      expect(paramsOf(call).ctx).toBe(ID);
      expect(paramsOf(call).filters).toBeUndefined();
    }
    // The grid shows the filter.
    expect(grid.api.getFilterModel()).toEqual(ALL_BUT_ONE);
    // The cell links (open in a new tab).
    await waitFor(() => expect(document.querySelector('a[href^="/ops/opex/OPX-1"]')).not.toBeNull(), { timeout: 10_000 });
    const href = document.querySelector('a[href^="/ops/opex/OPX-1"]')!.getAttribute('href')!;
    expect(href).toContain(`ctx=${ID}`);
    expect(href).not.toContain('filters=');
    expect(href.length).toBeLessThan(120);
    // The stored list context.
    await waitFor(() => {
      const stored = JSON.parse(window.sessionStorage.getItem('opex-list-context') ?? '{}');
      expect(stored).toMatchObject({ filters: '', ctx: ID });
    });
    expect(mocked.post).toHaveBeenCalledTimes(1);
    // Request counts as before: one page, one totals.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(calls(ROWS)).toHaveLength(1);
    expect(calls(TOTALS)).toHaveLength(1);
  }, 30_000);

  it('a reload of the page URL: the context is read once, the list loads once, filtered', async () => {
    renderAt(`/ops/opex?ctx=${ID}`);
    await waitFor(() => expect(calls(ROWS).length).toBeGreaterThan(0), { timeout: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(calls(ROWS)).toHaveLength(1);
    expect(calls(`/list-contexts/${ID}`)).toHaveLength(1);
    expect(mocked.post).not.toHaveBeenCalled();
    expect(paramsOf(calls(ROWS)[0])).toMatchObject({ ctx: ID, shape: 'grid' });
    expect(paramsOf(calls(ROWS)[0]).filters).toBeUndefined();
    expect(grid.api.getFilterModel()).toEqual(ALL_BUT_ONE);
    expect(new URLSearchParams(location.search).get('ctx')).toBe(ID);
  }, 30_000);

  it('page requests ask for the lean rows and the FTE columns shown; the footer for the amount columns shown', async () => {
    renderAt('/ops/opex');
    await waitFor(() => expect(calls(TOTALS).length).toBeGreaterThan(0), { timeout: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(calls(ROWS)).toHaveLength(1);
    expect(calls(TOTALS)).toHaveLength(1);
    const first = paramsOf(calls(ROWS)[0]);
    expect(first.shape).toBe('grid');
    expect(first.fte).toBeUndefined();
    const shownAmounts = (grid.api.getColumnState() as Array<{ colId: string; hide?: boolean }>)
      .filter((c) => /^y(Minus1|Plus1|Plus2)?(Budget|Revision|Forecast|FollowUp|Landing)$/.test(c.colId) && !c.hide)
      .map((c) => c.colId);
    expect(shownAmounts.length).toBeGreaterThan(0);
    expect(paramsOf(calls(TOTALS)[0]).amounts).toBe(shownAmounts.join(','));

    // Showing an FTE column: one page and one totals request, both with it.
    await act(async () => { grid.api.setColumnsVisible(['fte_yBudget'], true); });
    await waitFor(() => expect(calls(ROWS)).toHaveLength(2), { timeout: 10_000 });
    await waitFor(() => expect(calls(TOTALS)).toHaveLength(2), { timeout: 10_000 });
    expect(paramsOf(calls(ROWS)[1])).toMatchObject({ shape: 'grid', fte: 'fte_yBudget' });
    expect(paramsOf(calls(TOTALS)[1]).fte).toBe('fte_yBudget');

    // Hiding an amount column: the footer asks again without it, the rows do not reload.
    const hidden = shownAmounts[0];
    await act(async () => { grid.api.setColumnsVisible([hidden], false); });
    await waitFor(() => expect(calls(TOTALS)).toHaveLength(3), { timeout: 10_000 });
    expect(paramsOf(calls(TOTALS)[2]).amounts.split(',')).not.toContain(hidden);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(calls(ROWS)).toHaveLength(2);
  }, 30_000);
  it('the address follows the filters: a link\'s filters, then two changes, a reload restores the second change', async () => {
    const linked = { product_name: { filterType: 'text', type: 'contains', filter: 'linked' } };
    const first = { product_name: { filterType: 'text', type: 'contains', filter: 'first' } };
    const second = { product_name: { filterType: 'text', type: 'contains', filter: 'second' } };
    const view = renderAt(`/ops/opex?filters=${encodeURIComponent(JSON.stringify(linked))}`);
    await waitFor(() => expect(calls(ROWS).length).toBeGreaterThan(0), { timeout: 10_000 });
    expect(JSON.parse(paramsOf(calls(ROWS)[0]).filters)).toEqual(linked);
    await act(async () => { grid.api.setFilterModel(first); });
    await waitFor(() => expect(JSON.parse(new URLSearchParams(location.search).get('filters') ?? '{}')).toEqual(first));
    await act(async () => { grid.api.setFilterModel(second); });
    await waitFor(() => expect(JSON.parse(new URLSearchParams(location.search).get('filters') ?? '{}')).toEqual(second));
    // A reload of that address (same tab: the stored list context stays).
    const reloaded = location.search;
    view.unmount();
    grid.api = null;
    mocked.get.mockClear();
    renderAt(`/ops/opex${reloaded}`);
    await waitFor(() => expect(calls(ROWS).length).toBeGreaterThan(0), { timeout: 10_000 });
    expect(JSON.parse(paramsOf(calls(ROWS)[0]).filters)).toEqual(second);
    expect(grid.api.getFilterModel()).toEqual(second);
  }, 30_000);

  it('a link whose saved filters are gone: one line says so, the list opens unfiltered, not with the stored filters', async () => {
    const DEAD = 'Gone_0123456789abcdefg';
    const storedFilters = JSON.stringify({ product_name: { filterType: 'text', type: 'contains', filter: 'stored' } });
    window.sessionStorage.setItem('opex-list-context', JSON.stringify({ sort: '', q: '', filters: storedFilters, statusScope: 'enabled' }));
    const base = mocked.get.getMockImplementation()! as (...args: any[]) => any;
    mocked.get.mockImplementation(async (url: string, config?: unknown) => {
      if (url === `/list-contexts/${DEAD}`) {
        throw Object.assign(new Error('Request failed with status code 404'), { response: { status: 404, data: { code: 'list_context_not_found' } } });
      }
      return base(url, config);
    });
    renderAt(`/ops/opex?ctx=${DEAD}`);
    await waitFor(() => expect(calls(ROWS).length).toBeGreaterThan(0), { timeout: 10_000 });
    expect(paramsOf(calls(ROWS)[0]).filters).toBeUndefined();
    expect(paramsOf(calls(ROWS)[0]).ctx).toBeUndefined();
    expect(await screen.findByText('common:filters.linkFiltersLost')).toBeInTheDocument();
    const url = new URLSearchParams(location.search);
    expect(url.get('ctx')).toBeNull();
    expect(url.get('filters')).toBeNull();
    expect(grid.api.getFilterModel()).toEqual({});
  }, 30_000);

  it('the footer of an amount column shown again keeps a placeholder until its total arrives, never 0', async () => {
    let release: () => void = () => undefined;
    let slow = false;
    const base = mocked.get.getMockImplementation()! as (...args: any[]) => any;
    mocked.get.mockImplementation(async (url: string, config?: { params?: Record<string, string> }) => {
      if (url === TOTALS) {
        if (slow) await new Promise<void>((resolve) => { release = resolve; });
        const amounts = String(config?.params?.amounts ?? '').split(',').filter(Boolean);
        return { data: { ...Object.fromEntries(amounts.map((key) => [key, 1234])), reportingCurrency: 'EUR' } };
      }
      return base(url, config);
    });
    renderAt('/ops/opex');
    await waitFor(() => expect(calls(TOTALS)).toHaveLength(1), { timeout: 10_000 });
    const footer = (colId: string) => document.querySelector(`.ag-floating-bottom [col-id="${colId}"]`)?.textContent ?? null;
    await waitFor(() => expect(footer('yBudget')).toBe('1 234'), { timeout: 10_000 });
    // A column shown whose total was never asked: the previous totals stay on screen meanwhile,
    // without it.
    slow = true;
    await act(async () => { grid.api.setColumnsVisible(['yRevision'], true); });
    await waitFor(() => expect(calls(TOTALS)).toHaveLength(2), { timeout: 10_000 });
    expect(paramsOf(calls(TOTALS)[1]).amounts.split(',')).toContain('yRevision');
    await waitFor(() => expect(footer('yRevision')).toBe('…'), { timeout: 10_000 });
    expect(footer('yBudget')).toBe('1 234');
    await act(async () => { release(); });
    await waitFor(() => expect(footer('yRevision')).toBe('1 234'), { timeout: 10_000 });
  }, 30_000);
});
