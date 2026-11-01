import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTilePermissions } from './useTilePermissions';

const state = vi.hoisted(() => ({
  levels: {} as Record<string, string>,
  features: { vulnerabilityFeed: true } as Record<string, boolean>,
}));
const RANK = { reader: 1, contributor: 2, member: 3, admin: 4 } as const;
// `hasLevel` stable across renders, as the real context's.
const hasLevel = (resource: string, level: keyof typeof RANK) => {
  const held = state.levels[resource] as keyof typeof RANK | undefined;
  return !!held && RANK[held] >= RANK[level];
};
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel }) }));
vi.mock('../../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features: state.features }, isLoading: false }) }));

describe('canViewTile with a required feature', () => {
  beforeEach(() => {
    state.levels = { infrastructure: 'reader', tasks: 'reader' };
    state.features = { vulnerabilityFeed: true };
  });

  it('shows the vulnerabilities tile to an infrastructure reader with the feed on', () => {
    const { result } = renderHook(() => useTilePermissions());
    expect(result.current.canViewTile('vulnerabilities')).toBe(true);
  });

  it('hides it with the feed off, whatever the rights', () => {
    state.features = { vulnerabilityFeed: false };
    state.levels = { infrastructure: 'admin' };
    const { result } = renderHook(() => useTilePermissions());
    expect(result.current.canViewTile('vulnerabilities')).toBe(false);
    expect(result.current.availableTileIds).not.toContain('vulnerabilities');
  });

  it('hides it without the infrastructure read right', () => {
    state.levels = { tasks: 'reader' };
    const { result } = renderHook(() => useTilePermissions());
    expect(result.current.canViewTile('vulnerabilities')).toBe(false);
    expect(result.current.canViewTile('my-tasks')).toBe(true);
  });
});
