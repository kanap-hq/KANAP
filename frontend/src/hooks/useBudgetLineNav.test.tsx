import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from '../api';
import { useBudgetLineNav } from './useBudgetLineNav';
import { DEFAULT_BUDGET_COLUMNS, type BudgetColumnsSettings } from '../services/budgetColumns';
import { resetListContextCache } from '../lib/listContext';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
let setting: BudgetColumnsSettings = DEFAULT_BUDGET_COLUMNS;

// A list of five lines, OPX-1 to OPX-5, in this order.
const LINES = [1, 2, 3, 4, 5];
const neighborsOf = (at: string) => {
  const n = Number(String(at).replace(/^OPX-/i, ''));
  const index = LINES.indexOf(n);
  if (index < 0) return { index: null, total: LINES.length, prev: null, next: null };
  const line = (i: number) => (i >= 0 && i < LINES.length ? { id: `uuid-${LINES[i]}`, item_number: LINES[i] } : null);
  return { index, total: LINES.length, prev: line(index - 1), next: line(index + 1) };
};

let queryClient: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
);
const calls = (url: string) => mocked.get.mock.calls.filter(([u]) => u === url);
const neighborCalls = () => calls('/spend-items/summary/neighbors');
const idsCalls = () => calls('/spend-items/summary/ids');

describe('useBudgetLineNav (neighbours, lot 1C)', () => {
  beforeEach(() => {
    setting = DEFAULT_BUDGET_COLUMNS;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    resetListContextCache();
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.get.mockImplementation(async (url: string, config?: { params?: Record<string, string> }) => {
      if (url === '/budget-columns') return { data: setting };
      if (url === '/spend-items/summary/neighbors') return { data: neighborsOf(config!.params!.id) };
      if (url.startsWith('/budget-lines/')) return { data: { id: `uuid-${url.split('-').pop()}`, product_name: url } };
      return { data: {} };
    });
    mocked.post.mockImplementation(async () => ({ data: { id: 'Ctx_0123456789abcdefghi' } }));
  });

  it('without a sort, walks the current default column, once the setting is known', async () => {
    setting = { ...DEFAULT_BUDGET_COLUMNS, default_column: 'committed' };
    renderHook(() => useBudgetLineNav({ id: 'OPX-2', sort: null, statusScope: 'enabled' }, 'opex'), { wrapper });
    await waitFor(() => expect(neighborCalls().length).toBeGreaterThan(0));
    expect(neighborCalls()[0][1].params.sort).toBe('yRevision:DESC');
  });

  it('keeps a sort the user picked', async () => {
    setting = { ...DEFAULT_BUDGET_COLUMNS, default_column: 'committed' };
    renderHook(() => useBudgetLineNav({ id: 'OPX-2', sort: 'yBudget:ASC', statusScope: 'enabled' }, 'opex'), { wrapper });
    await waitFor(() => expect(neighborCalls().length).toBeGreaterThan(0));
    expect(neighborCalls()[0][1].params.sort).toBe('yBudget:ASC');
  });

  it('asks the server where the route line stands, never every id of the list', async () => {
    const { result } = renderHook(() => useBudgetLineNav({ id: 'OPX-3', sort: 'yBudget:DESC', q: 'cloud', statusScope: 'all' }, 'opex'), { wrapper });
    await waitFor(() => expect(result.current.total).toBe(5));
    expect(result.current).toMatchObject({ index: 2, total: 5, hasPrev: true, hasNext: true, prevId: 'OPX-2', nextId: 'OPX-4' });
    const params = neighborCalls()[0][1].params;
    expect(params).toMatchObject({ id: 'OPX-3', sort: 'yBudget:DESC', q: 'cloud', includeDisabled: '1' });
    expect(idsCalls()).toHaveLength(0);
  });

  it('gives no previous / next to a line the list does not hold', async () => {
    const { result } = renderHook(() => useBudgetLineNav({ id: 'OPX-9', sort: 'yBudget:DESC', statusScope: 'enabled' }, 'opex'), { wrapper });
    await waitFor(() => expect(neighborCalls().length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current).toMatchObject({ total: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null });
  });

  it('prefetches the details and the positions of the previous and next lines', async () => {
    renderHook(() => useBudgetLineNav({ id: 'OPX-3', sort: 'yBudget:DESC', statusScope: 'enabled' }, 'opex'), { wrapper });
    await waitFor(() => {
      expect(calls('/budget-lines/OPX-2')).toHaveLength(1);
      expect(calls('/budget-lines/OPX-4')).toHaveLength(1);
    });
    await waitFor(() => expect(neighborCalls().map((c) => c[1].params.id).sort()).toEqual(['OPX-2', 'OPX-3', 'OPX-4']));
    expect(queryClient.getQueryData(['budget-line', 'OPX-4'])).toEqual({ id: 'uuid-4', product_name: '/budget-lines/OPX-4' });
  });

  it('fast clicks keep moving: the next line\'s position is there at once, while its detail still loads', async () => {
    const { result, rerender } = renderHook(({ id }) => useBudgetLineNav({ id, sort: 'yBudget:DESC', statusScope: 'enabled' }, 'opex'), {
      wrapper,
      initialProps: { id: 'OPX-1' },
    });
    const prefetched = (ref: string) => queryClient.getQueryCache()
      .findAll({ queryKey: ['spend-items-summary-neighbors'] })
      .some((query) => query.queryKey[2] === ref && query.state.data != null);
    for (const next of ['OPX-2', 'OPX-3', 'OPX-4']) {
      await waitFor(() => expect(result.current.nextId).toBe(next));
      // The next line's position is prefetched; then "next" is clicked.
      await waitFor(() => expect(prefetched(next)).toBe(true));
      const before = neighborCalls().length;
      rerender({ id: next });
      // At once after the click: index and next of the new line, no request waited for.
      expect(result.current.index).toBe(LINES.indexOf(Number(next.slice(4))));
      expect(result.current.hasNext).toBe(true);
      expect(neighborCalls().length).toBe(before);
    }
  });

  it('a step to a line whose position is not loaded yet keeps the index and the way back', async () => {
    const { result, rerender } = renderHook(({ id }) => useBudgetLineNav({ id, sort: 'yBudget:DESC', statusScope: 'enabled' }, 'opex'), {
      wrapper,
      initialProps: { id: 'OPX-2' },
    });
    await waitFor(() => expect(result.current.nextId).toBe('OPX-3'));
    // The next line's position is slow to come.
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => { release = resolve; });
    mocked.get.mockImplementation(async (url: string, config?: { params?: Record<string, string> }) => {
      if (url === '/spend-items/summary/neighbors') {
        await slow;
        return { data: neighborsOf(config!.params!.id) };
      }
      return { data: {} };
    });
    queryClient.removeQueries({ queryKey: ['spend-items-summary-neighbors'], predicate: (q) => q.queryKey[2] === 'OPX-3' });
    rerender({ id: 'OPX-3' });
    expect(result.current).toMatchObject({ index: 2, total: 5, hasPrev: true, prevId: 'OPX-2', hasNext: false });
    release();
    await waitFor(() => expect(result.current.nextId).toBe('OPX-4'));
  });

  it('filters too long for a URL go as a saved list context', async () => {
    const values = Array.from({ length: 1500 }, (_, i) => `Supplier ${i}`);
    const filters = JSON.stringify({ supplier_name: { filterType: 'set', values } });
    expect(encodeURIComponent(filters).length).toBeGreaterThan(20_000);
    const { result } = renderHook(() => useBudgetLineNav({ id: 'OPX-3', sort: 'yBudget:DESC', filters, statusScope: 'enabled' }, 'opex'), { wrapper });
    await waitFor(() => expect(result.current.total).toBe(5));
    expect(mocked.post).toHaveBeenCalledWith('/list-contexts', { list: 'spend-items', state: { filters: { supplier_name: { filterType: 'set', values } } } });
    const params = neighborCalls()[0][1].params;
    expect(params.ctx).toBe('Ctx_0123456789abcdefghi');
    expect(params.filters).toBeUndefined();
    // Saved once for the tab: the prefetched positions reuse the id.
    await waitFor(() => expect(neighborCalls().length).toBe(3));
    expect(mocked.post).toHaveBeenCalledTimes(1);
  });

  it('CAPEX: same navigation on the CAPEX neighbours, CPX references', async () => {
    mocked.get.mockImplementation(async (url: string, config?: { params?: Record<string, string> }) => {
      if (url === '/budget-columns') return { data: setting };
      if (url === '/capex-items/summary/neighbors') {
        const n = neighborsOf(String(config!.params!.id).replace(/^CPX-/, 'OPX-'));
        return { data: n };
      }
      return { data: {} };
    });
    const { result } = renderHook(() => useBudgetLineNav({ id: 'CPX-1', sort: 'yBudget:DESC', statusScope: 'enabled' }, 'capex'), { wrapper });
    await waitFor(() => expect(result.current.nextId).toBe('CPX-2'));
    expect(result.current).toMatchObject({ index: 0, total: 5, hasPrev: false, hasNext: true });
    await waitFor(() => expect(calls('/budget-lines/CPX-2')).toHaveLength(1));
    expect(calls('/capex-items/summary/ids')).toHaveLength(0);
  });

  it('CAPEX: filters too long for a URL go as a saved list context of the CAPEX list', async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/budget-columns') return { data: setting };
      if (url === '/capex-items/summary/neighbors') return { data: { index: 0, total: 1, prev: null, next: null } };
      return { data: {} };
    });
    const values = Array.from({ length: 1500 }, (_, i) => `Supplier ${i}`);
    const filters = JSON.stringify({ supplier_name: { filterType: 'set', values } });
    const { result } = renderHook(() => useBudgetLineNav({ id: 'CPX-1', sort: 'yBudget:DESC', filters, statusScope: 'enabled' }, 'capex'), { wrapper });
    await waitFor(() => expect(result.current.total).toBe(1));
    expect(mocked.post).toHaveBeenCalledWith('/list-contexts', { list: 'capex-items', state: { filters: { supplier_name: { filterType: 'set', values } } } });
    const params = calls('/capex-items/summary/neighbors')[0][1].params;
    expect(params.ctx).toBe('Ctx_0123456789abcdefghi');
    expect(params.filters).toBeUndefined();
  });
  it.each(['opex', 'capex'] as const)('budget context from %s walks native BL neighbours and prefetches by nature', async (nature) => {
    mocked.get.mockImplementation(async (url: string, config?: { params?: Record<string, string> }) => {
      if (url === '/budget-columns') return { data: setting };
      if (url === '/budget-lines/summary/neighbors') {
        const response = neighborsOf(String(config!.params!.id).replace(/^BL-/, 'OPX-'));
        return { data: { ...response, prev: response.prev && { ...response.prev, nature: 'capex' }, next: response.next && { ...response.next, nature: 'opex' } } };
      }
      return { data: {} };
    });

    const filters = JSON.stringify({ nature: { filterType: 'set', values: ['opex', 'capex'] } });
    const { result } = renderHook(() => useBudgetLineNav({ id: 'BL-3', sort: 'product_name:ASC', filters, statusScope: 'all' }, nature, true), { wrapper });
    await waitFor(() => expect(result.current).toMatchObject({ index: 2, total: 5, prevId: 'BL-2', nextId: 'BL-4', prevPath: '/ops/capex/BL-2', nextPath: '/ops/opex/BL-4' }));
    expect(calls('/budget-lines/summary/neighbors')[0][1].params).toMatchObject({ id: 'BL-3', filters, sort: 'product_name:ASC', includeDisabled: '1' });
    await waitFor(() => expect(calls('/budget-lines/BL-2')).toHaveLength(1));
    await waitFor(() => expect(calls('/budget-lines/BL-4')).toHaveLength(1));
    expect(calls('/spend-items/summary/neighbors')).toHaveLength(0);
    expect(calls('/capex-items/summary/neighbors')).toHaveLength(0);
  });

  it('budget context uses the budget-lines key for filters too long for a URL', async () => {
    mocked.get.mockImplementation(async (url: string) => url === '/budget-columns' ? { data: setting } : { data: { index: 0, total: 1, prev: null, next: null } });
    const values = Array.from({ length: 1500 }, (_, i) => `Supplier ${i}`);
    const filters = JSON.stringify({ supplier_name: { filterType: 'set', values } });
    const { result } = renderHook(() => useBudgetLineNav({ id: 'BL-1', sort: 'yBudget:DESC', filters }, 'opex', true), { wrapper });
    await waitFor(() => expect(result.current.total).toBe(1));
    expect(mocked.post).toHaveBeenCalledWith('/list-contexts', { list: 'budget-lines', state: { filters: JSON.parse(filters) } });
    expect(calls('/budget-lines/summary/neighbors')[0][1].params.ctx).toBe('Ctx_0123456789abcdefghi');
  });

});
