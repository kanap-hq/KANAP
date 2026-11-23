import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ canReadSettings: true }));
const get = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({ default: { get } }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => (
      auth.canReadSettings && resource === 'settings' && level === 'reader'
    ),
  }),
}));

import { useItOpsSettings } from './useItOpsSettings';

const SETTINGS = { applicationCategories: [{ code: 'line_of_business', label: 'Line of business' }] };

function renderSettings(options?: { enabled?: boolean }, seed?: unknown) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  if (seed !== undefined) client.setQueryData(['it-ops-settings'], seed);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useItOpsSettings(options), { wrapper });
}

describe('useItOpsSettings', () => {
  beforeEach(() => {
    auth.canReadSettings = true;
    get.mockReset();
    get.mockResolvedValue({ data: SETTINGS });
  });

  it('does not call GET /it-ops/settings without the settings reader level', async () => {
    auth.canReadSettings = false;
    const { result } = renderSettings();
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(get).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it('calls GET /it-ops/settings once with the settings reader level', async () => {
    const { result } = renderSettings();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/it-ops/settings');
    expect(result.current.data).toEqual(SETTINGS);
  });

  it('does not fetch when enabled is false, and still returns the cached settings', async () => {
    const { result } = renderSettings({ enabled: false }, SETTINGS);
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(get).not.toHaveBeenCalled();
    expect(result.current.data).toEqual(SETTINGS);
  });
});
