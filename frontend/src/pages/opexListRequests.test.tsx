import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// These specs mount the real ServerDataGrid (and AG Grid), the real set filter and the real text
// filter box, and count the requests each user action sends.
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

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 700)); });
const calls = (url: string) => get.mock.calls.filter(([u]) => u === url);
const counts = () => ({ rows: calls(ROWS).length, totals: calls(TOTALS).length, values: calls(VALUES).length });
const paramsOf = (call: unknown[]) => (call[1] as { params: Record<string, string> }).params;

/** The cell under a column header (the filter box). */
function floatingFilterCell(colId: string): HTMLElement {
  const index = document.querySelector(`.ag-header-cell[col-id="${colId}"]`)!.getAttribute('aria-colindex');
  return document.querySelector(`.ag-floating-filter[aria-colindex="${index}"]`) as HTMLElement;
}

/** The text box under a column header. */
function floatingFilterInput(colId: string): HTMLInputElement {
  return floatingFilterCell(colId).querySelector('input') as HTMLInputElement;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ops/opex']}>
        <OpexListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openList() {
  const view = renderPage();
  await waitFor(() => expect(grid.api).not.toBeNull());
  await waitFor(() => expect(calls(ROWS).length).toBeGreaterThan(0));
  await settle();
  return view;
}

describe('OPEX list requests per action', () => {
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
    get.mockImplementation(async (url: string, config?: { params?: Record<string, string> }) => {
      if (url === '/budget-columns') return { data: DEFAULT_BUDGET_COLUMNS };
      if (url === ROWS) {
        return { data: { items: [{ id: 'o-1', item_number: 1, product_name: 'Cloud', supplier: { id: 's', name: 'Alpha' } }], total: 1, page: 1, limit: 50 } };
      }
      if (url === VALUES) return { data: { [config?.params?.fields ?? '']: SUPPLIERS } };
      if (url === TOTALS) return { data: { yBudget: 10 } };
      return { data: { items: [] } };
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('open: one page and one totals request, nothing else from the grid', async () => {
    await openList();
    expect(counts()).toEqual({ rows: 1, totals: 1, values: 0 });
    // No user list: the rows carry the owner names.
    expect(calls('/users')).toHaveLength(0);
    // The fixed year slots are enough: no `years` parameter.
    expect(paramsOf(calls(ROWS)[0]).years).toBeUndefined();
  }, 20_000);

  it('sort: one page request, no totals', async () => {
    await openList();
    const before = counts();
    await act(async () => {
      grid.api.applyColumnState({ state: [{ colId: 'product_name', sort: 'asc' }], defaultState: { sort: null } });
    });
    await settle();
    expect(counts()).toEqual({ ...before, rows: before.rows + 1 });
    expect(paramsOf(calls(ROWS).slice(-1)[0]).sort).toBe('product_name:ASC');
  }, 20_000);

  it('one set filter click: one page and one totals request after the quiet delay; the values load once, on open', async () => {
    await openList();
    expect(counts().values).toBe(0);
    // jsdom lays nothing out: AG Grid closes a popup whose anchor has an empty box.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 10, left: 10, right: 110, bottom: 30, width: 100, height: 20, x: 10, y: 10, toJSON: () => ({}) } as DOMRect);
    fireEvent.click(floatingFilterCell('supplier_name').querySelector('button')!);
    await waitFor(() => expect(document.body.textContent).toContain('Bravo'));
    expect(counts().values).toBe(1);
    const before = counts();
    const bravo = Array.from(document.querySelectorAll('label')).find((label) => label.textContent === 'Bravo')!;
    fireEvent.click(bravo.querySelector('input')!);
    await settle();
    expect(counts()).toEqual({ rows: before.rows + 1, totals: before.totals + 1, values: before.values });
    expect(JSON.parse(paramsOf(calls(ROWS).slice(-1)[0]).filters)).toEqual({ supplier_name: { filterType: 'set', values: ['Alpha', 'Charlie'] } });
  }, 20_000);

  it('typing five characters in a column text filter: one page and one totals request', async () => {
    await openList();
    const before = counts();
    const box = floatingFilterInput('product_name');
    for (const value of ['c', 'cl', 'clo', 'clou', 'cloud']) {
      fireEvent.change(box, { target: { value } });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
    }
    await settle();
    expect(counts()).toEqual({ ...before, rows: before.rows + 1, totals: before.totals + 1 });
    expect(JSON.parse(paramsOf(calls(ROWS).slice(-1)[0]).filters)).toEqual({ product_name: { filterType: 'text', type: 'contains', filter: 'cloud' } });
  }, 20_000);

  it('keeps the sort the user picked in the list context and the cell links after a filter change', async () => {
    await openList();
    await act(async () => {
      grid.api.applyColumnState({ state: [{ colId: 'product_name', sort: 'asc' }], defaultState: { sort: null } });
    });
    await settle();
    await act(async () => { grid.api.setFilterModel({ product_name: { filterType: 'text', type: 'contains', filter: 'cloud' } }); });
    await settle();
    const context = JSON.parse(window.sessionStorage.getItem('opex-list-context') ?? '{}');
    expect(context.sort).toBe('product_name:ASC');
    expect(paramsOf(calls(ROWS).slice(-1)[0]).sort).toBe('product_name:ASC');
    const link = document.querySelector('a[href^="/ops/opex/OPX-1"]') as HTMLAnchorElement | null;
    expect(link?.getAttribute('href')).toContain('sort=product_name%3AASC');
  }, 20_000);
});
