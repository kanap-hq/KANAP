import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { WorkingDayProfile } from '../services/workingDayProfiles';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../api', () => ({ default: api }));

import { buildWorkingDayProfiles, useWorkingDayProfiles } from './useWorkingDayProfiles';

function profile(partial: Partial<WorkingDayProfile> & Pick<WorkingDayProfile, 'id' | 'code' | 'name'>): WorkingDayProfile {
  return { description: null, days_by_year: {}, status: 'enabled', disabled_at: null, ...partial };
}

const STAFF = profile({ id: 'p-staff', code: 'STAFF', name: 'Staff' });
const CONTRACTORS = profile({ id: 'p-con', code: 'CON', name: 'contractors' });
const OLD = profile({ id: 'p-old', code: 'OLD', name: 'Old', status: 'disabled', disabled_at: '2026-01-01T00:00:00.000Z' });
const LATER = profile({ id: 'p-later', code: 'LATER', name: 'Later', disabled_at: '2999-01-01T00:00:00.000Z' });

describe('buildWorkingDayProfiles', () => {
  it('orders by name then code, whatever the response order', () => {
    const built = buildWorkingDayProfiles([STAFF, OLD, LATER, CONTRACTORS]);
    expect(built.profiles.map((p) => p.id)).toEqual(['p-con', 'p-later', 'p-old', 'p-staff']);
  });

  it('keeps the calendars enabled now, a future disable date included, and indexes every one', () => {
    const built = buildWorkingDayProfiles([STAFF, OLD, LATER, CONTRACTORS]);
    expect(built.enabled.map((p) => p.id)).toEqual(['p-con', 'p-later', 'p-staff']);
    expect(built.byId.get('p-old')).toBe(OLD);
  });

  it('carries the load state', () => {
    expect(buildWorkingDayProfiles([], false).ready).toBe(false);
    const failed = buildWorkingDayProfiles([], true, true);
    expect(failed.isError).toBe(true);
    expect(failed.profiles).toEqual([]);
  });
});

describe('useWorkingDayProfiles', () => {
  function wrapper({ children }: { children: React.ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  it('reads every calendar, disabled ones included, from the list endpoint', async () => {
    api.get.mockResolvedValue({ data: { items: [STAFF, OLD] } });
    const { result } = renderHook(() => useWorkingDayProfiles(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/working-day-profiles', {
      params: { page: 1, limit: 1000, sort: 'name:ASC', includeDisabled: true },
    });
    expect(result.current.profiles.map((p) => p.id)).toEqual(['p-old', 'p-staff']);
    expect(result.current.enabled.map((p) => p.id)).toEqual(['p-staff']);
  });

  it('stays idle while disabled', () => {
    api.get.mockClear();
    const { result } = renderHook(() => useWorkingDayProfiles({ enabled: false }), { wrapper });
    expect(result.current.ready).toBe(false);
    expect(api.get).not.toHaveBeenCalled();
  });
});
