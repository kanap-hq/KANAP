import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminMenuEntries, type AdminMenuContext } from '../pages/admin/adminMenu';

// Branding, Authentication and the Audit log follow the Organization right: their addresses open
// and close as the Administration menu shows them, in the cloud and on site, in every spelling the
// router reads as the plain address.

type Level = 'reader' | 'contributor' | 'member' | 'admin';
const state = vi.hoisted(() => ({
  isGlobalAdmin: false,
  limited: false,
  grants: {} as Record<string, 'reader' | 'member' | 'admin'>,
  singleTenant: false,
}));

const rank = { reader: 1, contributor: 2, member: 3, admin: 4 } as Record<string, number>;
/** As AuthContext: an Administrator passes every check; a limited person writes no reserved module. */
function hasLevel(resource: string, level: Level): boolean {
  if (state.isGlobalAdmin) return true;
  if (state.limited && (resource === 'users' || resource === 'organization') && level !== 'reader') return false;
  const granted = state.grants[resource];
  return !!granted && rank[granted] >= rank[level];
}

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    token: 'token',
    isAuthenticating: false,
    serverUnavailable: false,
    sessionExpired: false,
    profile: { role: state.isGlobalAdmin ? 'Administrator' : 'Custom', roles: [] },
    claims: { isGlobalAdmin: state.isGlobalAdmin, isPlatformAdmin: false, isBillingAdmin: false, permissions: state.grants },
    hasLevel,
    hasAnyAccess: true,
    dataAccess: state.limited ? { available: true, mode: 'limited', nodes: [], modules: [] } : null,
    subscription: null,
  }),
}));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ isPlatformHost: false }) }));
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

const addresses = ['/admin/branding', '/admin/auth', '/admin/audit-logs'] as const;

function openAt(path: string): 'opens' | 'refused' | 'other' {
  cleanup();
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          {addresses.map((address) => <Route key={address} path={address} element={<div>page</div>} />)}
        </Route>
        <Route path="/403" element={<div>refused</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.queryByText('page') ? 'opens' : screen.queryByText('refused') ? 'refused' : 'other';
}

/** The context Layout gives the menu. */
function menuContext(): AdminMenuContext {
  return {
    singleTenant: state.singleTenant,
    platformHost: false,
    claims: { isGlobalAdmin: state.isGlobalAdmin, isPlatformAdmin: false },
    hasLevel,
    dataAccessLimited: state.limited,
    features: { billing: !state.singleTenant, sso: true, sampleData: false },
    aiSettingsAvailable: false,
    canShowIntegrations: false,
  };
}

/** Spellings the router reads as the plain address. */
const spellings = (path: string) => [path, path.toUpperCase(), path.replace('/admin/', '/Admin/'), `${path}/`];

afterEach(() => Object.assign(state, { isGlobalAdmin: false, limited: false, grants: {}, singleTenant: false }));

const profiles: Array<[string, () => void, Record<(typeof addresses)[number], 'opens' | 'refused'>]> = [
  ['an organization reader alone', () => { state.grants = { organization: 'reader' }; },
    { '/admin/branding': 'opens', '/admin/auth': 'opens', '/admin/audit-logs': 'opens' }],
  ['an organization administrator alone', () => { state.grants = { organization: 'admin' }; },
    { '/admin/branding': 'opens', '/admin/auth': 'opens', '/admin/audit-logs': 'opens' }],
  ['a users administrator alone', () => { state.grants = { users: 'admin' }; },
    { '/admin/branding': 'refused', '/admin/auth': 'refused', '/admin/audit-logs': 'refused' }],
  ['an organization and users administrator', () => { state.grants = { organization: 'admin', users: 'admin' }; },
    { '/admin/branding': 'opens', '/admin/auth': 'opens', '/admin/audit-logs': 'opens' }],
  ['an organization reader with a limited access', () => { state.grants = { organization: 'reader' }; state.limited = true; },
    { '/admin/branding': 'opens', '/admin/auth': 'opens', '/admin/audit-logs': 'refused' }],
  ['the Administrator', () => { state.isGlobalAdmin = true; },
    { '/admin/branding': 'opens', '/admin/auth': 'opens', '/admin/audit-logs': 'opens' }],
];

for (const [place, singleTenant] of [['in the cloud', false], ['on site', true]] as const) {
  describe(`ProtectedRoute: the pages of the Organization right, ${place}`, () => {
    for (const [name, setUp, expected] of profiles) {
      it.each(addresses.flatMap((address) => spellings(address).map((path) => [path, address] as const)))(
        `${name}: %s answers as %s does in the menu`,
        (path, address) => {
          state.singleTenant = singleTenant;
          setUp();
          const shown = adminMenuEntries(menuContext()).some((entry) => entry.to === address);
          expect(openAt(path)).toBe(expected[address]);
          expect(expected[address] === 'opens').toBe(shown);
        },
      );
    }
  });
}
