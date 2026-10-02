import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from '../api';
import { useModuleItemNav } from './useModuleItemNav';
import { resetListContextCache } from '../lib/listContext';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const ID = 'Sup_saved_filters_0001';
const BIG = { status: { filterType: 'text', type: 'notContains', filter: 'x'.repeat(4000) } };
const CONFIG = { endpoint: '/suppliers/ids', queryKey: 'suppliers-ids', defaultSort: 'name:ASC' };

const wrapperAt = (url: string) => ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  </QueryClientProvider>
);
const idCalls = () => mocked.get.mock.calls.filter(([url]) => url === '/suppliers/ids');

describe('useModuleItemNav and list contexts', () => {
  beforeEach(() => {
    resetListContextCache();
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.post.mockResolvedValue({ data: { id: ID } });
  });

  const answer = (list: string) => mocked.get.mockImplementation(async (url: string) => {
    if (url === `/list-contexts/${ID}`) return { data: { id: ID, list, state: { filters: BIG } } };
    return { data: { ids: ['a', 'b'], refs: ['S-1', 'S-2'] } };
  });

  it('a workspace URL with ctx (a link opened in a new tab): the id list gets the same saved filters', async () => {
    answer('suppliers');
    const { result } = renderHook(() => useModuleItemNav({ id: 'a', sort: 'name:ASC' }, CONFIG), { wrapper: wrapperAt(`/master-data/suppliers/a/overview?ctx=${ID}`) });
    await waitFor(() => expect(result.current.total).toBe(2));
    expect(idCalls()[0][1].params).toMatchObject({ ctx: ID, sort: 'name:ASC' });
    expect(idCalls()[0][1].params.filters).toBeUndefined();
  });

  it('ignores a ctx saved for another list', async () => {
    answer('applications');
    const { result } = renderHook(() => useModuleItemNav({ id: 'a', sort: 'name:ASC' }, CONFIG), { wrapper: wrapperAt(`/x?ctx=${ID}`) });
    await waitFor(() => expect(result.current.total).toBe(2));
    expect(idCalls()[0][1].params.ctx).toBeUndefined();
  });

  it('filters given inline win over the URL ctx, and long ones are saved and sent as ctx', async () => {
    answer('suppliers');
    const filters = JSON.stringify(BIG);
    const { result } = renderHook(() => useModuleItemNav({ id: 'a', sort: 'name:ASC', filters }, CONFIG), { wrapper: wrapperAt('/x?ctx=Other_context_00000001') });
    await waitFor(() => expect(result.current.total).toBe(2));
    expect(mocked.post).toHaveBeenCalledWith('/list-contexts', { list: 'suppliers', state: { filters: BIG } });
    expect(idCalls()[0][1].params).toMatchObject({ ctx: ID });
    expect(idCalls()[0][1].params.filters).toBeUndefined();
  });
});
