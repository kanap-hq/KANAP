import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A full page load of an unknown path (/ai-agents typed in the address bar): the access token is
// restored from the refresh cookie after the first render. The catch-all must wait for that
// restore instead of reading the empty token and sending a signed-in user to /login.

const auth = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
}));

function restoring() {
  return { token: null, isAuthenticating: true, serverUnavailable: false, sessionExpired: false };
}
function signedIn() {
  return {
    token: 'token',
    isAuthenticating: false,
    serverUnavailable: false,
    sessionExpired: false,
    profile: { role: 'Administrator', roles: [] },
    claims: { isGlobalAdmin: true, isPlatformAdmin: false, isBillingAdmin: false, permissions: {} },
    hasLevel: () => true,
    hasAnyAccess: true,
    subscription: null,
  };
}
function signedOut() {
  return { token: null, isAuthenticating: false, serverUnavailable: false, sessionExpired: false };
}

const t = (key: string) => key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'en' } }) }));
vi.mock('./auth/AuthContext', () => ({ useAuth: () => auth.state }));
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
vi.mock('./components/Layout', () => ({ default: () => <Outlet /> }));
vi.mock('./pages/workspace', () => ({ WorkspaceDashboardPage: () => <div>home page</div> }));
vi.mock('./pages/LoginPage', () => ({ default: () => <div>login page</div> }));

import App from './App';

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function tree(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Where />
    </MemoryRouter>
  );
}

describe('App routes: unknown path on a full page load', () => {
  beforeEach(() => {
    auth.state = restoring();
  });

  it('keeps a restored session and opens the home page', async () => {
    const view = render(tree('/ai-agents'));
    expect(screen.getByTestId('where')).not.toHaveTextContent('/login');

    auth.state = signedIn();
    view.rerender(tree('/ai-agents'));

    expect(await screen.findByText('home page')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
  });

  it('sends a visitor without a session to /login', async () => {
    const view = render(tree('/does-not-exist'));

    auth.state = signedOut();
    view.rerender(tree('/does-not-exist'));

    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/login');
  });
});
