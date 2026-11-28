import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn(async (url: string) => (
  url === '/applications/classification-catalog'
    ? { data: {
      businessCriticalityLevels: [
        { code: 'high', label: 'Shop floor', description: 'Renamed by the workspace.', rank: 3, maxMtdMinutes: 1440 },
      ],
      cyberCriticalityLevels: [],
      dataClasses: [],
      recoveryWaves: [],
    } }
    : { data: {} }
)));
vi.mock('../../../api', () => ({ default: { get } }));

import { useRelationLabels } from './labels';

// Component tests render this hook with no AuthProvider. That absence is not a missing right:
// the app always mounts the provider, and these tests keep receiving the catalog.
describe('useRelationLabels outside AuthProvider', () => {
  it('still requests the catalog and uses its label', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    const { result } = renderHook(() => useRelationLabels(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.criticality('high')).toBe('Shop floor'));
    expect(get).toHaveBeenCalledWith('/applications/classification-catalog');
  });
});
