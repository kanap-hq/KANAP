import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ limited: false, get: vi.fn() }));
vi.mock('../api', () => ({ default: { get: state.get } }));
// Both filters read whether the person's access is limited; the nodes come from the endpoint.
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    dataAccess: state.limited ? { available: true, mode: 'limited', nodes: [], modules: ['budget', 'contracts'] } : null,
  }),
}));

import { useContractPlacementFilter, useLinePlacementFilter } from './usePlacementOptions';

const node = (id: string, company_id: string | null) => ({ id, company_id }) as any;

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useLinePlacementFilter', () => {
  beforeEach(() => {
    state.limited = false;
    state.get.mockReset();
  });

  it('filters nothing and asks nothing for an unscoped person', () => {
    const { result } = renderHook(() => useLinePlacementFilter('company-1'), { wrapper });
    expect(result.current).toBeNull();
    expect(state.get).not.toHaveBeenCalled();
  });

  it('offers the companies and cost centers of a limited access', async () => {
    state.limited = true;
    state.get.mockResolvedValue({
      data: {
        limited: true,
        all: false,
        companies: ['es'],
        costCenters: [{ id: 'inf-fr', companyId: 'fr' }],
        // The endpoint unfolds the edit nodes too; the line picker still takes cost centers only.
        editNodes: [{ id: 'grp-es', companyId: null }],
      },
    });
    const { result, rerender } = renderHook(({ company }) => useLinePlacementFilter(company), {
      wrapper,
      initialProps: { company: 'fr' as string | null },
    });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(state.get).toHaveBeenCalledWith('/data-access/placement-options');
    expect([...result.current!.companyIds].sort()).toEqual(['es', 'fr']);
    // On FR (reached through its cost center only): that cost center alone, and one is required.
    expect(result.current!.isCostCenterAllowed(node('inf-fr', 'fr'))).toBe(true);
    expect(result.current!.isCostCenterAllowed(node('fin-fr', 'fr'))).toBe(false);
    expect(result.current!.isCostCenterAllowed(node('inf-es', 'es'))).toBe(false);
    expect(result.current!.isCostCenterAllowed(node('grp-es', null))).toBe(false);
    expect(result.current!.costCenterRequired).toBe(true);
    // On ES (a company of the access): its own cost centers, or none.
    rerender({ company: 'es' });
    expect(result.current!.isCostCenterAllowed(node('inf-es', 'es'))).toBe(true);
    expect(result.current!.isCostCenterAllowed(node('fin-es', 'es'))).toBe(true);
    expect(result.current!.isCostCenterAllowed(node('inf-fr', 'fr'))).toBe(false);
    expect(result.current!.isCostCenterAllowed(node('fin-fr', 'fr'))).toBe(false);
    expect(result.current!.costCenterRequired).toBe(false);
    // No paying company yet (it follows the cost center): every cost center the access places.
    rerender({ company: null });
    expect(result.current!.isCostCenterAllowed(node('inf-fr', 'fr'))).toBe(true);
    expect(result.current!.isCostCenterAllowed(node('inf-es', 'es'))).toBe(true);
    expect(result.current!.isCostCenterAllowed(node('fin-fr', 'fr'))).toBe(false);
    expect(result.current!.costCenterRequired).toBe(false);
  });

  it('filters nothing for Edit on everything', async () => {
    state.limited = true;
    state.get.mockResolvedValue({ data: { limited: true, all: true, companies: [], costCenters: [] } });
    const { result } = renderHook(() => useLinePlacementFilter(null), { wrapper });
    await waitFor(() => expect(state.get).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});

describe('useContractPlacementFilter', () => {
  beforeEach(() => {
    state.limited = false;
    state.get.mockReset();
  });

  it('filters nothing and asks nothing for an unscoped person', () => {
    const { result } = renderHook(() => useContractPlacementFilter('company-1', null), { wrapper });
    expect(result.current).toBeNull();
    expect(state.get).not.toHaveBeenCalled();
  });

  it('applies the contract rule: a company of the access, or a place of the edit nodes with its company', async () => {
    state.limited = true;
    // The endpoint unfolds a group in edit (GRP-ES) into its sub-group and its centre (INF-ES), as
    // `data_access_apply` does; FR is an edit company too.
    state.get.mockResolvedValue({
      data: {
        limited: true,
        all: false,
        companies: ['fr'],
        costCenters: [{ id: 'inf-fr', companyId: 'fr' }],
        editNodes: [
          { id: 'inf-fr', companyId: 'fr' },
          { id: 'grp-es', companyId: null },
          { id: 'sub-es', companyId: null },
          { id: 'inf-es', companyId: 'es' },
        ],
        editNodeCompanies: ['fr', 'es'],
      },
    });
    const { result, rerender } = renderHook(({ company, place }) => useContractPlacementFilter(company, place), {
      wrapper,
      initialProps: { company: 'fr' as string | null, place: null as string | null },
    });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(state.get).toHaveBeenCalledWith('/data-access/placement-options');
    // Both a company of the edit companies and the companies of the edit nodes are offered.
    expect([...result.current!.companyIds].sort()).toEqual(['es', 'fr']);
    // FR is an edit company: any group or centre, even another company's.
    expect(result.current!.isCostCenterAllowed(node('inf-fr', 'fr'))).toBe(true);
    expect(result.current!.isCostCenterAllowed(node('grp-es', null))).toBe(true);
    // ES comes only from the edit node company: the unfolded edit nodes of the group, sub-group included.
    rerender({ company: 'es', place: 'grp-es' });
    expect([...result.current!.companyIds].sort()).toEqual(['es', 'fr']);
    expect(result.current!.isCostCenterAllowed(node('grp-es', null))).toBe(true);
    expect(result.current!.isCostCenterAllowed(node('sub-es', null))).toBe(true);
    expect(result.current!.isCostCenterAllowed(node('inf-es', 'es'))).toBe(true);
    expect(result.current!.isCostCenterAllowed(node('fin-es', 'es'))).toBe(false);
    // A place outside the edit nodes leaves only the edit companies offered; a company of the edit
    // nodes keeps its unfolded places (the server accepts that pair), other places are refused.
    rerender({ company: 'es', place: 'elsewhere' });
    expect([...result.current!.companyIds]).toEqual(['fr']);
    expect(result.current!.isCostCenterAllowed(node('inf-es', 'es'))).toBe(true);
    expect(result.current!.isCostCenterAllowed(node('fin-es', 'es'))).toBe(false);
  });

  it('filters nothing for Edit on everything', async () => {
    state.limited = true;
    state.get.mockResolvedValue({ data: { limited: true, all: true, companies: [], costCenters: [] } });
    const { result } = renderHook(() => useContractPlacementFilter(null, null), { wrapper });
    await waitFor(() => expect(state.get).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
