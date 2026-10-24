import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A refresh answered 429 at load (too many attempts): one line that says so and a retry button
// that tries again in the page, instead of a spinner that never ends.

const auth = vi.hoisted(() => ({ refreshRateLimited: true, serverUnavailable: false, retryRefresh: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    token: null,
    isAuthenticating: true,
    serverUnavailable: auth.serverUnavailable,
    refreshRateLimited: auth.refreshRateLimited,
    retryRefresh: auth.retryRefresh,
    sessionExpired: false,
    profile: null,
    claims: null,
    hasLevel: () => false,
    hasAnyAccess: true,
    subscription: null,
  }),
}));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ isPlatformHost: false }) }));
vi.mock('../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features: {} } }) }));
vi.mock('../ai/useAiCapabilities', () => ({ useAiCapabilities: () => ({ isLoading: false, isFetching: false, data: undefined }) }));
vi.mock('../pages/PendingAccessPage', () => ({ default: () => null }));

import ProtectedRoute from './ProtectedRoute';

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<div>home</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute while the refresh is rate limited', () => {
  beforeEach(() => {
    auth.refreshRateLimited = true;
    auth.serverUnavailable = false;
    auth.retryRefresh.mockReset();
  });

  it('says there were too many attempts and tries again in the page on retry', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('session.rateLimited');
    expect(screen.queryByRole('progressbar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'session.retry' }));
    expect(auth.retryRefresh).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('keeps the server line when the server cannot be reached', () => {
    auth.refreshRateLimited = false;
    auth.serverUnavailable = true;
    renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('session.serverUnavailable');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
