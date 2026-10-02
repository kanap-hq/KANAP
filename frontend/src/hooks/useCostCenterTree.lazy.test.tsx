import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../api', () => ({ default: api }));

import { COST_CENTER_TREE_QUERY_KEY, useCostCenterCount, useCostCenterNode, useCostCenterTree } from './useCostCenterTree';
import type { CostCenterRef } from '../services/costCenters';

// The tree's answer: a group and one cost center with its company and budget holder.
const TREE = {
  items: [
    {
      id: 'grp', code: 'GRP', name: 'IT', kind: 'group', parent_id: null, company_id: null, company_name: null,
      owner_user_id: null, owner_name: null, status: 'enabled', disabled_at: null, sort_order: 0, depth: 0, path: 'IT', path_ids: ['grp'],
    },
    {
      id: 'cc1', code: 'CC-1', name: 'ERP', kind: 'cost_center', parent_id: 'grp', company_id: 'co-1', company_name: 'Paris SA',
      owner_user_id: 'u-1', owner_name: 'Ada Holder', status: 'enabled', disabled_at: null, sort_order: 0, depth: 1, path: 'IT › ERP', path_ids: ['grp', 'cc1'],
    },
  ],
};

const KNOWN: CostCenterRef = {
  id: 'cc1', code: 'CC-1', name: 'ERP', kind: 'cost_center', status: 'enabled',
  company_id: 'co-1', company_name: 'Paris SA', owner_user_id: 'u-1', owner_name: 'Ada Holder',
};

let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const treeCalls = () => api.get.mock.calls.filter(([url]) => url === '/cost-centers/tree').length;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/cost-centers/tree') return { data: TREE };
    if (url === '/cost-centers/tree/count') return { data: { count: 2 } };
    throw new Error(`unexpected ${url}`);
  });
});

describe('useCostCenterTree, loaded on demand', () => {
  it('sends nothing while disabled, then reads the tree another reader loaded', async () => {
    const lazy = renderHook(() => useCostCenterTree({ enabled: false }), { wrapper });
    await Promise.resolve();
    expect(api.get).not.toHaveBeenCalled();
    expect(lazy.result.current.ready).toBe(false);
    expect(lazy.result.current.hasAny).toBe(false);

    const eager = renderHook(() => useCostCenterTree(), { wrapper });
    await waitFor(() => expect(eager.result.current.ready).toBe(true));
    lazy.rerender();
    expect(lazy.result.current.ready).toBe(true);
    expect(lazy.result.current.nodes.map((n) => [n.id, n.depth, n.path])).toEqual([['grp', 0, 'IT'], ['cc1', 1, 'IT › ERP']]);
    expect(lazy.result.current.byId.get('cc1')?.owner_name).toBe('Ada Holder');
    expect(treeCalls()).toBe(1);
  });

  it("names a node from the line's detail without the tree, and from the tree otherwise", async () => {
    const known = renderHook(() => useCostCenterNode('cc1', KNOWN), { wrapper });
    expect(known.result.current).toBe(KNOWN);
    await Promise.resolve();
    expect(treeCalls()).toBe(0);

    const other = renderHook(() => useCostCenterNode('grp', KNOWN), { wrapper });
    await waitFor(() => expect(other.result.current?.code).toBe('GRP'));
    expect(treeCalls()).toBe(1);

    const none = renderHook(() => useCostCenterNode(null, KNOWN), { wrapper });
    expect(none.result.current).toBeNull();
  });

  it('counts the nodes without the tree, under the key that refreshes the tree', async () => {
    const count = renderHook(() => useCostCenterCount(), { wrapper });
    await waitFor(() => expect(count.result.current.count).toBe(2));
    expect(treeCalls()).toBe(0);
    // A write of the cost centers page refreshes everything under the tree's key: the count too.
    await client.invalidateQueries({ queryKey: COST_CENTER_TREE_QUERY_KEY });
    await waitFor(() => expect(api.get.mock.calls.filter(([url]) => url === '/cost-centers/tree/count')).toHaveLength(2));
  });
});
