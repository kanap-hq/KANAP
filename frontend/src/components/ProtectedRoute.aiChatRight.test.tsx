import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ForbiddenPage from '../pages/ForbiddenPage';

// A refusal of the assistant for the missing AI chat permission names that permission on the
// 403 page; every other refusal keeps the generic text.

let chatReasons: string[] = [];
let grantedResources: string[] = [];

const stableT = (key: string) => key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: stableT, i18n: { language: 'en' } }) }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    token: 'token',
    isAuthenticating: false,
    serverUnavailable: false,
    sessionExpired: false,
    profile: { role: 'Member', roles: [] },
    claims: { isGlobalAdmin: false, isPlatformAdmin: false, isBillingAdmin: false, permissions: {} },
    hasLevel: (resource: string) => grantedResources.includes(resource),
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
          permission_granted: !chatReasons.includes('permission_denied'),
          provider_ready: !chatReasons.includes('provider_not_ready'),
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

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/ai" element={<div>assistant page</div>} />
          <Route path="/it/applications" element={<div>applications page</div>} />
          <Route path="/master-data" element={<div>master data page</div>} />
        </Route>
        <Route path="/403" element={<ForbiddenPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('403 page for the assistant', () => {
  beforeEach(() => {
    chatReasons = [];
    grantedResources = ['ai_chat'];
  });

  it('opens the assistant for a role with the AI chat permission', () => {
    renderAt('/ai');
    expect(screen.getByText('assistant page')).toBeInTheDocument();
  });

  it('names the AI chat permission when it is the only thing missing', () => {
    chatReasons = ['permission_denied'];
    grantedResources = [];
    renderAt('/ai');
    expect(screen.getByText('forbidden.aiChatRight')).toBeInTheDocument();
    expect(screen.queryByText('forbidden.message')).not.toBeInTheDocument();
  });

  it('names the AI chat permission when the role check refuses the route', () => {
    grantedResources = [];
    renderAt('/ai');
    expect(screen.getByText('forbidden.aiChatRight')).toBeInTheDocument();
  });

  it('opens the assistant when an administrator turned chat off', () => {
    chatReasons = ['tenant_disabled'];
    renderAt('/ai');
    expect(screen.getByText('assistant page')).toBeInTheDocument();
    expect(screen.queryByText('forbidden.message')).not.toBeInTheDocument();
  });

  it('names the AI chat permission when chat is turned off and the right is missing', () => {
    chatReasons = ['tenant_disabled', 'permission_denied'];
    grantedResources = [];
    renderAt('/ai');
    expect(screen.getByText('forbidden.aiChatRight')).toBeInTheDocument();
    expect(screen.queryByText('assistant page')).not.toBeInTheDocument();
  });

  it('keeps the generic text when the provider is not ready', () => {
    chatReasons = ['provider_not_ready'];
    renderAt('/ai');
    expect(screen.getByText('forbidden.message')).toBeInTheDocument();
    expect(screen.queryByText('forbidden.aiChatRight')).not.toBeInTheDocument();
  });

  it('keeps the generic text when the permission is not the only obstacle', () => {
    chatReasons = ['provider_not_ready', 'permission_denied'];
    grantedResources = [];
    renderAt('/ai');
    expect(screen.getByText('forbidden.message')).toBeInTheDocument();
  });

  it('keeps the generic text when no single right is known', () => {
    renderAt('/master-data');
    expect(screen.getByText('forbidden.message')).toBeInTheDocument();
  });
});
