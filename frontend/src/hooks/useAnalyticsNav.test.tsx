import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from '../api';
import { useAnalyticsNav } from './useAnalyticsNav';
import { resetListContextCache } from '../lib/listContext';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const idsParams = () => get.mock.calls.filter(([url]) => url === '/analytics-categories/ids').map(([, config]) => config?.params);

describe('useAnalyticsNav', () => {
  beforeEach(() => {
    resetListContextCache();
    get.mockReset();
    get.mockResolvedValue({ data: { ids: ['v-mand', 'v-high', 'v-low'] } });
  });

  it('walks the values in the dimension order when the address names no sort', async () => {
    const { result } = renderHook(
      () => useAnalyticsNav({ id: 'v-high', sort: null, statusScope: 'enabled', extraParams: { axis_id: 'ax-prio' } }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.total).toBe(3));
    expect(idsParams()).toEqual([expect.objectContaining({ sort: 'sort_order:ASC', axis_id: 'ax-prio', status: 'enabled' })]);
    expect(result.current.prevId).toBe('v-mand');
    expect(result.current.nextId).toBe('v-low');
  });

  it('keeps the sort the address names', async () => {
    renderHook(() => useAnalyticsNav({ id: 'v-high', sort: 'name:DESC', extraParams: { axis_id: 'ax-prio' } }), { wrapper });
    await waitFor(() => expect(idsParams()).toHaveLength(1));
    expect(idsParams()[0]).toEqual(expect.objectContaining({ sort: 'name:DESC' }));
  });
});
