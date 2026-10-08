import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let profile: { id: string } | null = { id: 'user-1' };
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ profile }) }));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'acme' }) }));

import { useGridScopePreference } from './useGridScopePreference';

// The page keys of the list pages with a "My / My team's / All" choice: tasks, requests, projects,
// knowledge documents, applications.
const PAGE_KEYS = ['tasks', 'requests', 'projects', 'knowledge', 'apps'];

let store: Record<string, string>;
const keyOf = (pageKey: string, userId = 'user-1') => `kanap-grid-scope:acme:${userId}:${pageKey}`;

beforeEach(() => {
  profile = { id: 'user-1' };
  store = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useGridScopePreference', () => {
  it.each(PAGE_KEYS)('opens %s on all items when the user has no stored choice', (pageKey) => {
    const { result } = renderHook(() => useGridScopePreference(pageKey, null));
    expect(result.current[0]).toBe('all');
    // Opening the page stores nothing: the default is not a choice.
    expect(store[keyOf(pageKey)]).toBeUndefined();
  });

  it.each(PAGE_KEYS)('keeps a stored "my" choice on %s', (pageKey) => {
    store[keyOf(pageKey)] = 'my';
    const { result } = renderHook(() => useGridScopePreference(pageKey, null));
    expect(result.current[0]).toBe('my');
  });

  it('keeps a stored "team" choice', () => {
    store[keyOf('tasks')] = 'team';
    const { result } = renderHook(() => useGridScopePreference('tasks', null));
    expect(result.current[0]).toBe('team');
  });

  it('ignores an unreadable stored value and falls back to all items', () => {
    store[keyOf('tasks')] = 'mine';
    const { result } = renderHook(() => useGridScopePreference('tasks', null));
    expect(result.current[0]).toBe('all');
  });

  it('follows a scope in the URL over the stored choice', () => {
    store[keyOf('tasks')] = 'all';
    const { result } = renderHook(() => useGridScopePreference('tasks', 'my'));
    expect(result.current[0]).toBe('my');
  });

  it('stores the choice the user makes', () => {
    const { result } = renderHook(() => useGridScopePreference('projects', null));
    act(() => result.current[1]('my'));
    expect(result.current[0]).toBe('my');
    expect(store[keyOf('projects')]).toBe('my');
  });

  it('applies the stored "my" choice once the profile loads', () => {
    store[keyOf('requests')] = 'my';
    profile = null;
    const { result, rerender } = renderHook(() => useGridScopePreference('requests', null));
    expect(result.current[0]).toBe('all');
    profile = { id: 'user-1' };
    rerender();
    expect(result.current[0]).toBe('my');
  });
});
