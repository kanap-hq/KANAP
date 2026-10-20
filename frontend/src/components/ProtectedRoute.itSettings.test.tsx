import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProtectedRoute from './ProtectedRoute';

const rights = vi.hoisted(() => ({ settings: false, infrastructure: 0 }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    token: 'token',
    isAuthenticating: false,
    serverUnavailable: false,
    sessionExpired: false,
    profile: { role: 'Member', roles: [] },
    claims: { isGlobalAdmin: false, isPlatformAdmin: false, isBillingAdmin: false, permissions: {} },
    hasLevel: (resource: string, level: string) => {
      const rank: Record<string, number> = { reader: 1, admin: 4 };
      const granted = resource === 'settings'
        ? (rights.settings ? 1 : 0)
        : resource === 'infrastructure'
          ? rights.infrastructure
          : 0;
      return granted >= (rank[level] ?? 99);
    },
    hasAnyAccess: true,
    subscription: { status: 'active', is_subscription_healthy: true },
  }),
}));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ isPlatformHost: false }) }));
vi.mock('../config/FeaturesContext', () => ({
  useFeatures: () => ({ config: { deploymentMode: 'multi-tenant', features: { billing: false, aiChat: false, aiSettings: false } } }),
}));
vi.mock('../ai/useAiCapabilities', () => ({ useAiCapabilities: () => ({ isLoading: false, isFetching: false, data: undefined }) }));
vi.mock('../pages/PendingAccessPage', () => ({ default: () => null }));

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/it/settings" element={<div>settings page</div>} />
          <Route path="/403" element={<div>forbidden</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute for IT settings', () => {
  beforeEach(() => {
    rights.settings = false;
    rights.infrastructure = 0;
  });

  it('lets a settings reader and an infrastructure administrator in', () => {
    rights.settings = true;
    renderAt('/it/settings');
    expect(screen.getByText('settings page')).toBeInTheDocument();
  });

  it('lets an infrastructure administrator in without the settings right', () => {
    rights.infrastructure = 4;
    renderAt('/it/settings');
    expect(screen.getByText('settings page')).toBeInTheDocument();
  });

  it('refuses an infrastructure reader', () => {
    rights.infrastructure = 1;
    renderAt('/it/settings');
    expect(screen.getByText('forbidden')).toBeInTheDocument();
  });
});
