import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn(async () => ({ data: { applicationCategories: [] } })));
vi.mock('../api', () => ({ default: { get } }));

import { useItOpsSettings } from './useItOpsSettings';

// Component tests render this hook with no AuthProvider. That absence is not a missing right:
// the app always mounts the provider, and these tests keep receiving the catalog.
describe('useItOpsSettings outside AuthProvider', () => {
  it('still fetches the settings once', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    const { result } = renderHook(() => useItOpsSettings(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/it-ops/settings');
  });
});
