import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// Billing administrators are sent to Billing only once the workspace is frozen (or the trial has
// ended): during the grace of an unpaid invoice the workspace stays usable.

const authState = vi.hoisted(() => ({ subscription: null as Record<string, unknown> | null }));

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
    subscription: authState.subscription,
  }),
}));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ isPlatformHost: false }) }));
vi.mock('../config/FeaturesContext', () => ({
  useFeatures: () => ({ config: { deploymentMode: 'multi-tenant', features: { billing: true, aiChat: false, aiSettings: false } } }),
}));
vi.mock('../ai/useAiCapabilities', () => ({ useAiCapabilities: () => ({ isLoading: false, isFetching: false, data: undefined }) }));
vi.mock('../pages/PendingAccessPage', () => ({ default: () => null }));

import ProtectedRoute from './ProtectedRoute';

function renderAt(path: string, subscription: Record<string, unknown>) {
  authState.subscription = subscription;
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/admin/users" element={<div>users page</div>} />
          <Route path="/admin/billing" element={<div>billing page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute and an unpaid subscription', () => {
  it('keeps a past due workspace usable during its grace', () => {
    renderAt('/admin/users', {
      status: 'past_due',
      is_subscription_healthy: false,
      access_allowed: true,
      freeze_effective_at: '2099-11-24T00:00:00.000Z',
    });
    expect(screen.getByText('users page')).toBeInTheDocument();
  });

  it('sends a frozen workspace to Billing', () => {
    renderAt('/admin/users', {
      status: 'past_due',
      is_subscription_healthy: false,
      access_allowed: false,
      freeze_effective_at: '2026-11-01T00:00:00.000Z',
    });
    expect(screen.getByText('billing page')).toBeInTheDocument();
  });

  it('sends a workspace whose trial has ended to Billing', () => {
    renderAt('/admin/users', { status: 'trialing', is_subscription_healthy: false, access_allowed: false });
    expect(screen.getByText('billing page')).toBeInTheDocument();
  });
});
