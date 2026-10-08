import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// A frozen workspace sends its billing administrators to Billing from every page, except the
// sample data page: an Administrator may still erase the content of a frozen workspace.

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    token: 'token',
    isAuthenticating: false,
    serverUnavailable: false,
    sessionExpired: false,
    profile: { role: 'Administrator', roles: [] },
    claims: { isGlobalAdmin: true, isPlatformAdmin: false, isBillingAdmin: true, permissions: {} },
    hasLevel: () => true,
    hasAnyAccess: true,
    subscription: { status: 'past_due', is_subscription_healthy: false },
  }),
}));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ isPlatformHost: false }) }));
vi.mock('../config/FeaturesContext', () => ({
  useFeatures: () => ({ config: { deploymentMode: 'multi-tenant', features: { billing: true, aiChat: false, aiSettings: false, sampleData: true } } }),
}));
vi.mock('../ai/useAiCapabilities', () => ({ useAiCapabilities: () => ({ isLoading: false, isFetching: false, data: undefined }) }));
vi.mock('../pages/PendingAccessPage', () => ({ default: () => null }));

import ProtectedRoute from './ProtectedRoute';

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/admin/sample-data" element={<div>sample data page</div>} />
          <Route path="/admin/users" element={<div>users page</div>} />
          <Route path="/admin/billing" element={<div>billing page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute on a frozen workspace', () => {
  it('lets an Administrator reach the sample data page', () => {
    renderAt('/admin/sample-data');
    expect(screen.getByText('sample data page')).toBeInTheDocument();
  });

  it('still sends the other pages to Billing', () => {
    renderAt('/admin/users');
    expect(screen.getByText('billing page')).toBeInTheDocument();
  });
});
