import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// The refusal page belongs to the app frame: the menu and the bar stay around it.
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('./auth/AuthContext', () => ({
  useAuth: () => ({
    token: 'token',
    isAuthenticating: false,
    serverUnavailable: false,
    sessionExpired: false,
    profile: { role: 'Member', roles: [] },
    claims: { isGlobalAdmin: false, isPlatformAdmin: false, isBillingAdmin: false, permissions: {} },
    hasLevel: () => true,
    hasAnyAccess: true,
    subscription: null,
  }),
}));
vi.mock('./tenant/TenantContext', () => ({ useTenant: () => ({ isPlatformHost: false }) }));
vi.mock('./config/FeaturesContext', () => ({
  FeaturesProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useFeatures: () => ({
    isLoading: false,
    config: { deploymentMode: 'multi-tenant', features: { billing: false, email: false, sso: false, aiChat: false, aiSettings: false } },
  }),
}));
vi.mock('./ai/useAiCapabilities', () => ({ useAiCapabilities: () => ({ isLoading: false, isFetching: false, data: undefined }) }));
vi.mock('./pages/PendingAccessPage', () => ({ default: () => null }));
vi.mock('./components/Layout', () => ({
  default: () => <div data-testid="layout"><Outlet /></div>,
}));
vi.mock('./pages/workspace', () => ({ WorkspaceDashboardPage: () => <div>home page</div> }));
vi.mock('./pages/LoginPage', () => ({ default: () => <div>login page</div> }));

import App from './App';

function tree(entry: string | { pathname: string; state: unknown }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <App />
    </MemoryRouter>
  );
}

describe('App routes: the refusal page sits in the app frame', () => {
  it('shows the refusal inside the layout, with the missing right of the state', async () => {
    render(tree({ pathname: '/403', state: { resource: 'budget', level: 'reader' } }));

    const layout = await screen.findByTestId('layout');
    const sentence = await screen.findByText('errors:MODULE_RIGHT_REQUIRED');
    expect(layout).toContainElement(sentence);
  });

  it('shows the refusal inside the layout without a module in the state', async () => {
    render(tree('/403'));

    const layout = await screen.findByTestId('layout');
    const sentence = await screen.findByText('forbidden.message');
    expect(layout).toContainElement(sentence);
  });
});
