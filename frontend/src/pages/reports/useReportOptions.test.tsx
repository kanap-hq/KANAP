import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from '../../api';
import { fakeAggregate } from '../../test/fakeBudgetAggregate';
import { useAxisValueOptions } from './useReportOptions';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

// The lines hold High, Low and Archived (a disabled value the catalogue leaves out) on Priority.
const ROWS = [
  { id: 'a', analytics_value_ids: { 'ax-prio': 'v-high' }, 'analytics_ax-prio': 'High' },
  { id: 'b', analytics_value_ids: { 'ax-prio': 'v-low' }, 'analytics_ax-prio': 'Low' },
  { id: 'c', analytics_value_ids: { 'ax-prio': 'v-gone' }, 'analytics_ax-prio': 'Archived' },
];

// The catalogue as the server lists it with `sort=sort_order:ASC`: Mandatory, High, Medium, Low.
const CATALOGUE = [
  { id: 'v-mand', name: 'Mandatory' },
  { id: 'v-high', name: 'High' },
  { id: 'v-med', name: 'Medium' },
  { id: 'v-low', name: 'Low' },
];

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useAxisValueOptions', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockResolvedValue({ data: { items: CATALOGUE, total: CATALOGUE.length } });
    post.mockImplementation(async (_url: string, body: any) => ({ data: fakeAggregate(ROWS as any, body) }));
  });

  it('offers the dimension values in its order, then the ones only the lines hold', async () => {
    const { result } = renderHook(() => useAxisValueOptions('opex', 'ax-prio', true), { wrapper });
    await waitFor(() => expect(result.current.options).toBeDefined());
    expect(get).toHaveBeenCalledWith('/analytics-categories', {
      params: expect.objectContaining({ axis_id: 'ax-prio', sort: 'sort_order:ASC' }),
    });
    expect(result.current.options?.map((option) => option.label)).toEqual(['Mandatory', 'High', 'Medium', 'Low', 'Archived']);
  });
});
