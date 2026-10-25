import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ limited: false, get: vi.fn(), nodes: [] as any[] }));
vi.mock('../api', () => ({ default: { get: state.get } }));
// The contract filter also reads the edit nodes from the person's access (`GET /auth/me`).
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    dataAccess: state.limited ? { available: true, mode: 'limited', nodes: state.nodes, modules: ['budget', 'contracts'] } : null,
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
    state.nodes = [];
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
      data: { limited: true, all: false, companies: ['es'], costCenters: [{ id: 'inf-fr', companyId: 'fr' }] },
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
    state.nodes = [];
    state.get.mockReset();
  });

  it('filters nothing and asks nothing for an unscoped person', () => {
    const { result } = renderHook(() => useContractPlacementFilter('company-1', null), { wrapper });
    expect(result.current).toBeNull();
    expect(state.get).not.toHaveBeenCalled();
  });

  it('applies the contract rule: a company of the access, or a place of the edit nodes with its company', async () => {
    state.limited = true;
    // INF-FR (a centre) and GRP-ES (a group) are edit nodes; FR is an edit company too.
    state.nodes = [
      { type: 'cost_center', id: 'inf-fr', name: 'INF-FR', access: 'edit', kind: 'cost_center' },
      { type: 'cost_center', id: 'grp-es', name: 'GRP-ES', access: 'edit', kind: 'group' },
      { type: 'company', id: 'read-co', name: 'Read', access: 'read' },
    ];
    state.get.mockResolvedValue({
      data: {
        limited: true,
        all: false,
        companies: ['fr'],
        costCenters: [{ id: 'inf-fr', companyId: 'fr' }],
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
    // ES comes only from the edit node company: only the edit node itself.
    rerender({ company: 'es', place: 'grp-es' });
    expect([...result.current!.companyIds].sort()).toEqual(['es', 'fr']);
    expect(result.current!.isCostCenterAllowed(node('grp-es', null))).toBe(true);
    expect(result.current!.isCostCenterAllowed(node('inf-es', 'es'))).toBe(false);
    // A place outside the edit nodes works through an edit company alone.
    rerender({ company: 'es', place: 'elsewhere' });
    expect([...result.current!.companyIds]).toEqual(['fr']);
    expect(result.current!.isCostCenterAllowed(node('inf-es', 'es'))).toBe(false);
  });

  it('filters nothing for Edit on everything', async () => {
    state.limited = true;
    state.get.mockResolvedValue({ data: { limited: true, all: true, companies: [], costCenters: [] } });
    const { result } = renderHook(() => useContractPlacementFilter(null, null), { wrapper });
    await waitFor(() => expect(state.get).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
