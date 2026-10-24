import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ limited: false, get: vi.fn() }));
vi.mock('../api', () => ({ default: { get: state.get } }));
vi.mock('../auth/dataAccess', () => ({ useDataAccessLimited: () => state.limited }));

import { useLinePlacementFilter } from './usePlacementOptions';

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
