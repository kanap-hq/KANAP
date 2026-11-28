import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The router matches an address whatever its case and after decoding each segment: the guard
// reads it the same way, so a spelling of an address never opens what its plain form refuses.

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

/** What the address shows: the page it opens, `refused`, `tenants` (platform host) or `other` (no route). */
function openAt(path: string): string {
  cleanup();
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/admin/users" element={<div>users</div>} />
          <Route path="/admin/data-access" element={<div>data-access</div>} />
          <Route path="/admin/installation/scheduled-tasks" element={<div>tasks</div>} />
          <Route path="/admin/tenants" element={<div>tenants</div>} />
          <Route path="/ops/opex" element={<div>opex</div>} />
          <Route path="/it/applications" element={<div>applications</div>} />
        </Route>
        <Route path="/403" element={<div>refused</div>} />
        <Route path="*" element={<div>other</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByText(/./).textContent ?? '';
}

const reset = () => Object.assign(state, {
  isGlobalAdmin: false, isPlatformAdmin: false, limited: false, grants: {}, isPlatformHost: false, singleTenant: false,
});
afterEach(reset);

const encode = (c: string) => `%${c.charCodeAt(0).toString(16)}`;
/** Spellings the router reads as the plain address. */
function spellings(path: string): string[] {
  const segments = path.split('/').slice(1);
  const last = segments.length - 1;
  return [
    path.toUpperCase(),
    `/${segments.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('/')}`,
    `/${segments.map((s, i) => (i === 0 ? encode(s[0]) + s.slice(1) : s)).join('/')}`,
    `/${segments.map((s, i) => (i === last ? encode(s[0]).toUpperCase() + s.slice(1) : s)).join('/')}`,
    `${path}/`,
  ];
}

const addresses = ['/admin/users', '/admin/data-access', '/admin/installation/scheduled-tasks', '/ops/opex', '/it/applications'] as const;
type Outcome = Record<(typeof addresses)[number], string>;

const profiles: Array<[string, () => void, Outcome]> = [
  ['a budget reader, cloud workspace', () => { state.grants = { budget: 'reader' }; }, {
    '/admin/users': 'refused', '/admin/data-access': 'refused', '/admin/installation/scheduled-tasks': 'refused', '/ops/opex': 'opex', '/it/applications': 'refused',
  }],
  ['a users reader, cloud workspace', () => { state.grants = { users: 'reader' }; }, {
    '/admin/users': 'refused', '/admin/data-access': 'refused', '/admin/installation/scheduled-tasks': 'refused', '/ops/opex': 'refused', '/it/applications': 'refused',
  }],
  ['a users administrator, cloud workspace', () => { state.grants = { users: 'admin' }; }, {
    '/admin/users': 'users', '/admin/data-access': 'data-access', '/admin/installation/scheduled-tasks': 'refused', '/ops/opex': 'refused', '/it/applications': 'refused',
  }],
  ['an Administrator with a limited access, on site', () => { state.isGlobalAdmin = true; state.limited = true; state.singleTenant = true; }, {
    '/admin/users': 'users', '/admin/data-access': 'refused', '/admin/installation/scheduled-tasks': 'refused', '/ops/opex': 'opex', '/it/applications': 'applications',
  }],
  ['the Administrator of a cloud workspace', () => { state.isGlobalAdmin = true; }, {
    '/admin/users': 'users', '/admin/data-access': 'data-access', '/admin/installation/scheduled-tasks': 'refused', '/ops/opex': 'opex', '/it/applications': 'applications',
  }],
  ['an Administrator of the platform workspace, platform host', () => { state.isGlobalAdmin = true; state.isPlatformHost = true; }, {
    '/admin/users': 'users', '/admin/data-access': 'data-access', '/admin/installation/scheduled-tasks': 'refused', '/ops/opex': 'tenants', '/it/applications': 'tenants',
  }],
  ['the platform administrator, platform host', () => { state.isGlobalAdmin = true; state.isPlatformAdmin = true; state.isPlatformHost = true; }, {
    '/admin/users': 'users', '/admin/data-access': 'data-access', '/admin/installation/scheduled-tasks': 'tasks', '/ops/opex': 'tenants', '/it/applications': 'tenants',
  }],
];

describe('ProtectedRoute: an address in another spelling', () => {
  for (const [name, setUp, expected] of profiles) {
    describe(name, () => {
      it.each(addresses.flatMap((address) => [address, ...spellings(address)].map((path) => [path, address] as const)))(
        '%s answers as %s',
        (path, address) => {
          setUp();
          expect(openAt(path)).toBe(expected[address]);
        },
      );
    });
  }
});

describe('ProtectedRoute: addresses that keep their answer', () => {
  it.each([
    // No route matches them: the guard lets them through to the catch-all, as before.
    ['//admin/users', 'other'],
    ['/admin//users', 'other'],
    ['/admin/installation%2Fscheduled-tasks', 'other'],
    ['/admin/%2569nstallation/scheduled-tasks', 'other'],
    ['/admin/%E0%A4%A', 'other'],
  ])('%s for the Administrator of a cloud workspace: %s', (path, expected) => {
    state.isGlobalAdmin = true;
    expect(openAt(path)).toBe(expected);
  });

  it.each([
    ['/admin/installation%2Fscheduled-tasks'],
    ['/admin/%E0%A4%A'],
  ])('%s never opens a page to a budget reader', (path) => {
    state.grants = { budget: 'reader' };
    expect(['refused', 'other']).toContain(openAt(path));
  });
});
