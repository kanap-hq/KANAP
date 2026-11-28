import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_MENU, adminMenuEntries, type AdminMenuContext } from '../pages/admin/adminMenu';

// The pages of the Administration menu that a branch of ProtectedRoute guards (the AI settings and
// the integrations): each opens to the people the menu shows it to, and to them only.

type Level = 'reader' | 'member' | 'admin';
const state = vi.hoisted(() => ({
  isGlobalAdmin: false,
  grants: {} as Record<string, 'reader' | 'member' | 'admin'>,
  aiSettings: false,
}));

const rank: Record<string, number> = { reader: 1, member: 3, admin: 4 };
const hasLevel = (resource: string, level: Level | 'contributor') => {
  if (state.isGlobalAdmin) return true;
  const granted = state.grants[resource];
  return !!granted && rank[granted] >= (rank[level] ?? 2);
};
/** As the server: the settings surface is available to an AI settings administrator. */
const capabilities = () => ({ surfaces: { settings: { available: hasLevel('ai_settings', 'admin') } } });

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
    dataAccess: null,
    subscription: null,
  }),
}));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ isPlatformHost: false }) }));
vi.mock('../config/FeaturesContext', () => ({
  useFeatures: () => ({
    config: {
      deploymentMode: 'multi-tenant',
      features: { billing: true, sso: true, aiChat: false, aiSettings: state.aiSettings, sampleData: false },
    },
    isSingleTenant: false,
    isLoading: false,
  }),
}));
vi.mock('../ai/useAiCapabilities', () => ({
  useAiCapabilities: () => ({ isLoading: false, isFetching: false, isError: false, data: capabilities() }),
}));
vi.mock('../pages/PendingAccessPage', () => ({ default: () => null }));

import ProtectedRoute from './ProtectedRoute';

const branchPages = ADMIN_MENU.filter((entry) => entry.requires === 'aiSettings' || entry.requires === 'integrations');

function opens(path: string): boolean {
  cleanup();
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          {branchPages.map((entry) => <Route key={entry.to} path={entry.to} element={<div>page</div>} />)}
        </Route>
        <Route path="/403" element={<div>refused</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.queryByText('page') !== null;
}

/** The context Layout gives the menu. */
function menuContext(): AdminMenuContext {
  const aiSettingsAvailable = state.aiSettings && capabilities().surfaces.settings.available;
  return {
    singleTenant: false,
    platformHost: false,
    claims: { isGlobalAdmin: state.isGlobalAdmin, isPlatformAdmin: false },
    hasLevel,
    dataAccessLimited: false,
    features: { billing: true, sso: true, sampleData: false },
    aiSettingsAvailable,
    canShowIntegrations: aiSettingsAvailable || hasLevel('infrastructure', 'admin'),
  };
}

afterEach(() => Object.assign(state, { isGlobalAdmin: false, grants: {}, aiSettings: false }));

const profiles: Array<[string, () => void]> = [
  ['an AI settings administrator, AI settings on', () => { state.grants = { ai_settings: 'admin' }; state.aiSettings = true; }],
  ['an AI settings administrator, AI settings off', () => { state.grants = { ai_settings: 'admin' }; }],
  ['an infrastructure administrator alone, AI settings on', () => { state.grants = { infrastructure: 'admin' }; state.aiSettings = true; }],
  ['an infrastructure administrator alone, AI settings off', () => { state.grants = { infrastructure: 'admin' }; }],
  ['a users administrator, AI settings on', () => { state.grants = { users: 'admin' }; state.aiSettings = true; }],
  ['the Administrator, AI settings on', () => { state.isGlobalAdmin = true; state.aiSettings = true; }],
  ['the Administrator, AI settings off', () => { state.isGlobalAdmin = true; }],
];

describe('ProtectedRoute: the pages its branches guard open as the menu shows them', () => {
  it('covers the AI pages and the integrations page', () => {
    expect(branchPages.map((entry) => entry.to).sort()).toEqual(['/admin/ai', '/admin/ai-models', '/admin/ai-usage', '/admin/integrations']);
  });

  for (const [name, setUp] of profiles) {
    it.each(branchPages.map((entry) => entry.to))(`${name}: %s`, (to) => {
      setUp();
      const shown = adminMenuEntries(menuContext()).some((entry) => entry.to === to);
      expect(opens(to)).toBe(shown);
    });
  }
});
