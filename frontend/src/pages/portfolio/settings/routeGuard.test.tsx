import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProtectedRoute from '../../../components/ProtectedRoute';

const rights = vi.hoisted(() => ({ grants: {} as Record<string, number> }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    token: 'token',
    isAuthenticating: false,
    serverUnavailable: false,
    sessionExpired: false,
    profile: { role: 'Member', roles: [] },
    claims: { isGlobalAdmin: false, isPlatformAdmin: false, isBillingAdmin: false, permissions: {} },
    hasLevel: (resource: string, level: string) => {
      const rank: Record<string, number> = { reader: 1, member: 3, admin: 4 };
      return (rights.grants[resource] ?? 0) >= (rank[level] ?? 99);
    },
    hasAnyAccess: true,
    subscription: { status: 'active', is_subscription_healthy: true },
  }),
}));
vi.mock('../../../tenant/TenantContext', () => ({ useTenant: () => ({ isPlatformHost: false }) }));
vi.mock('../../../config/FeaturesContext', () => ({
  useFeatures: () => ({ config: { deploymentMode: 'multi-tenant', features: { billing: false, aiChat: false, aiSettings: false } } }),
}));
vi.mock('../../../ai/useAiCapabilities', () => ({ useAiCapabilities: () => ({ isLoading: false, isFetching: false, data: undefined }) }));
vi.mock('../../../pages/PendingAccessPage', () => ({ default: () => null }));

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/portfolio/settings/:tab" element={<div>settings page</div>} />
          <Route path="/403" element={<div>forbidden</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('portfolio settings tab addresses behind the route guard', () => {
  beforeEach(() => {
    rights.grants = {};
  });

  it('lets a portfolio settings reader open a tab address', () => {
    rights.grants = { portfolio_settings: 1 };
    renderAt('/portfolio/settings/teams');
    expect(screen.getByText('settings page')).toBeInTheDocument();
  });

  it('refuses a tab address to a business contributor', () => {
    rights.grants = { portfolio_requests: 1, portfolio_projects: 1, tasks: 3 };
    renderAt('/portfolio/settings/teams');
    expect(screen.getByText('forbidden')).toBeInTheDocument();
  });
});
