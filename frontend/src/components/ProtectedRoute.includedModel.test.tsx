import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The assistant page opens while it only waits for an administrator to confirm the KANAP
// included model (the page then says so); any other reason still leads to the 403 page.

let chatReasons: string[] = [];

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    token: 'token',
    isAuthenticating: false,
    serverUnavailable: false,
    sessionExpired: false,
    profile: { role: 'Member', roles: [] },
    claims: { isGlobalAdmin: false, isPlatformAdmin: false, isBillingAdmin: false, permissions: {} },
    hasLevel: () => true,
    hasAnyAccess: true,
    subscription: { status: 'active', is_subscription_healthy: true },
  }),
}));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ isPlatformHost: false }) }));
vi.mock('../config/FeaturesContext', () => ({
  useFeatures: () => ({ config: { deploymentMode: 'multi-tenant', features: { billing: true, aiChat: true, aiSettings: true } } }),
}));
vi.mock('../ai/useAiCapabilities', () => ({
  useAiCapabilities: () => ({
    isLoading: false,
    isFetching: false,
    isError: false,
    data: {
      instance_features: { ai_chat: true, ai_mcp: false, ai_settings: true, ai_web_search: false },
      surfaces: {
        chat: {
          feature_enabled: true,
          tenant_enabled: !chatReasons.includes('tenant_disabled'),
          permission_granted: true,
          provider_ready: chatReasons.length === 0,
          available: chatReasons.length === 0,
          reasons: chatReasons,
        },
        mcp: { feature_enabled: false, tenant_enabled: false, permission_granted: false, provider_ready: false, available: false, reasons: [] },
        settings: { feature_enabled: true, permission_granted: false, available: false, reasons: [] },
      },
    },
  }),
}));
vi.mock('../pages/PendingAccessPage', () => ({ default: () => null }));

import ProtectedRoute from './ProtectedRoute';

function renderAssistant() {
  render(
    <MemoryRouter initialEntries={['/ai']}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/ai" element={<div>assistant page</div>} />
        </Route>
        <Route path="/403" element={<div>forbidden page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute for the assistant', () => {
  beforeEach(() => {
    chatReasons = [];
  });

  it('opens the assistant when it is available', () => {
    renderAssistant();
    expect(screen.getByText('assistant page')).toBeInTheDocument();
  });

  it('opens the assistant page when it only waits for the included model confirmation', () => {
    chatReasons = ['builtin_not_accepted'];
    renderAssistant();
    expect(screen.getByText('assistant page')).toBeInTheDocument();
  });

  it('keeps the 403 page for any other reason', () => {
    chatReasons = ['tenant_disabled', 'builtin_not_accepted'];
    renderAssistant();
    expect(screen.getByText('forbidden page')).toBeInTheDocument();
  });
});
