import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ProtectedRoute from './ProtectedRoute';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    token: 'token',
    isAuthenticating: false,
    serverUnavailable: false,
    sessionExpired: false,
    profile: { role: 'Member', roles: [] },
    claims: { isGlobalAdmin: false, isPlatformAdmin: false, isBillingAdmin: false, permissions: {} },
    hasLevel: () => false,
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

function RefusalState() {
  return <div data-testid="refusal-state">{JSON.stringify(useLocation().state)}</div>;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/ops/budget" element={<div>budget page</div>} />
        </Route>
        <Route path="/403" element={<RefusalState />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute: the refusal state', () => {
  it('carries the address and the one missing right to a module screen', () => {
    renderAt('/ops/budget');

    expect(JSON.parse(screen.getByTestId('refusal-state').textContent || 'null')).toEqual({
      from: '/ops/budget',
      resource: 'budget',
      level: 'reader',
    });
  });
});
