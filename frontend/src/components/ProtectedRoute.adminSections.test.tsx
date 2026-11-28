import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Who opens the data access administration and the Installation section of the Administration
// menu, on site, on a workspace host of the cloud and on its platform host.

type Level = 'reader' | 'member' | 'admin';
const state = vi.hoisted(() => ({
  isGlobalAdmin: false,
  isPlatformAdmin: false,
  limited: false,
  grants: {} as Record<string, 'reader' | 'member' | 'admin'>,
  isPlatformHost: false,
  singleTenant: false,
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    token: 'token',
    isAuthenticating: false,
    serverUnavailable: false,
    sessionExpired: false,
    profile: { role: state.isGlobalAdmin ? 'Administrator' : 'Custom', roles: [] },
    claims: { isGlobalAdmin: state.isGlobalAdmin, isPlatformAdmin: state.isPlatformAdmin, isBillingAdmin: false, permissions: state.grants },
    // As AuthContext: an Administrator passes every check, even with a limited access.
    hasLevel: (resource: string, level: Level) => {
      if (state.isGlobalAdmin || state.isPlatformAdmin) return true;
      if (state.limited && resource === 'users' && level !== 'reader') return false;
      const rank = { reader: 1, member: 3, admin: 4 } as Record<string, number>;
      const granted = state.grants[resource];
      return !!granted && rank[granted] >= rank[level];
    },
    hasAnyAccess: true,
    dataAccess: state.limited ? { available: true, mode: 'limited', nodes: [], modules: [] } : null,
    subscription: null,
  }),
}));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ isPlatformHost: state.isPlatformHost }) }));
vi.mock('../config/FeaturesContext', () => ({
  useFeatures: () => ({
    config: {
      deploymentMode: state.singleTenant ? 'single-tenant' : 'multi-tenant',
      features: { billing: !state.singleTenant, sso: true, aiChat: false, aiSettings: false, sampleData: false },
    },
    isSingleTenant: state.singleTenant,
    isLoading: false,
  }),
}));
vi.mock('../ai/useAiCapabilities', () => ({ useAiCapabilities: () => ({ isLoading: false, isFetching: false, data: undefined }) }));
vi.mock('../pages/PendingAccessPage', () => ({ default: () => null }));

import ProtectedRoute from './ProtectedRoute';

function openAt(path: string): string {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/admin/data-access" element={<div>page</div>} />
          <Route path="/admin/installation" element={<div>page</div>} />
          <Route path="/admin/installation/scheduled-tasks" element={<div>page</div>} />
          <Route path="/admin/scheduled-tasks" element={<div>page</div>} />
          <Route path="/admin/users" element={<div>page</div>} />
        </Route>
        <Route path="/403" element={<div>refused</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.queryByText('page') ? 'opens' : screen.queryByText('refused') ? 'refused' : 'other';
}

const installationPaths = ['/admin/installation', '/admin/installation/scheduled-tasks', '/admin/scheduled-tasks'];
// The router matches these to the same pages: the guard holds on them too.
const spelledPaths = ['/admin/Installation/scheduled-tasks', '/admin/%69nstallation/scheduled-tasks', '/Admin/Scheduled-Tasks'];

afterEach(() => {
  Object.assign(state, {
    isGlobalAdmin: false, isPlatformAdmin: false, limited: false, grants: {}, isPlatformHost: false, singleTenant: false,
  });
});

describe('ProtectedRoute: data access administration', () => {
  it('opens to a person who administers users without the Administrator role', () => {
    state.grants = { users: 'admin' };
    expect(openAt('/admin/data-access')).toBe('opens');
  });

  it('is refused to a person who administers users with a limited access', () => {
    state.grants = { users: 'admin' };
    state.limited = true;
    expect(openAt('/admin/data-access')).toBe('refused');
  });

  it('is refused to an Administrator with a limited access, who still opens the users', () => {
    state.isGlobalAdmin = true;
    state.limited = true;
    state.singleTenant = true;
    expect(openAt('/admin/data-access')).toBe('refused');
    expect(openAt('/admin/users')).toBe('opens');
  });

  it('is refused to a person who only reads users', () => {
    state.grants = { users: 'reader' };
    expect(openAt('/admin/data-access')).toBe('refused');
  });
});

describe('ProtectedRoute: Installation section, on site', () => {
  it.each(installationPaths)('opens %s to the Administrator', (path) => {
    state.singleTenant = true;
    state.isGlobalAdmin = true;
    expect(openAt(path)).toBe('opens');
  });

  it.each(installationPaths)('refuses %s to an Administrator with a limited access, as the server does', (path) => {
    state.singleTenant = true;
    state.isGlobalAdmin = true;
    state.limited = true;
    expect(openAt(path)).toBe('refused');
  });

  it.each(installationPaths)('refuses %s to a person who administers users without the Administrator role', (path) => {
    state.singleTenant = true;
    state.grants = { users: 'admin' };
    expect(openAt(path)).toBe('refused');
  });
});

describe('ProtectedRoute: Installation section, in the cloud', () => {
  it.each(installationPaths)('refuses %s to the Administrator of a workspace', (path) => {
    state.isGlobalAdmin = true;
    expect(openAt(path)).toBe('refused');
  });

  it.each(spelledPaths)('refuses %s to the Administrator of a workspace', (path) => {
    state.isGlobalAdmin = true;
    expect(openAt(path)).not.toBe('opens');
  });

  it.each(installationPaths)('opens %s to the platform administrator on the platform host', (path) => {
    state.isPlatformHost = true;
    state.isPlatformAdmin = true;
    expect(openAt(path)).toBe('opens');
  });

  it.each(installationPaths)('refuses %s on the platform host to an Administrator who is not a platform administrator', (path) => {
    state.isPlatformHost = true;
    state.isGlobalAdmin = true;
    expect(openAt(path)).toBe('refused');
  });
});
