import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecentlyViewed } from './useRecentlyViewed';

vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'user-1' } }) }));
vi.mock('../../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'tenant-1' }) }));
const KEY = 'kanap-recent-views:tenant-1:user-1';
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
});

describe('recent budget lines', () => {
  it('keeps one entry after a type change, with its BL reference and new type', () => {
    const { result } = renderHook(useRecentlyViewed);
    act(() => result.current.addToRecent('spend_item', 'line-1', 'Software', 'BL-12'));
    act(() => result.current.addToRecent('capex_item', 'line-1', 'Software updated', 'BL-12'));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({ id: 'line-1', type: 'capex_item', ref: 'BL-12', label: 'Software updated' });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(1);
  });

  it('deduplicates stored budget entries by id and retains other entity types', () => {
    localStorage.setItem(KEY, JSON.stringify([
      { type: 'capex_item', id: 'same', label: 'New', ref: 'BL-12', viewedAt: 3 },
      { type: 'spend_item', id: 'same', label: 'Old', ref: 'OPX-12', viewedAt: 2 },
      { type: 'project', id: 'same', label: 'Project', ref: 'PRJ-4', viewedAt: 1 },
    ]));
    const { result } = renderHook(useRecentlyViewed);
    expect(result.current.items.map((item) => item.ref)).toEqual(['BL-12', 'PRJ-4']);
  });
});
