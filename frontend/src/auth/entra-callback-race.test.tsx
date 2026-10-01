import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, beforeEach, expect, it, vi } from 'vitest';
import { SessionManager } from './SessionManager';
import { AuthProvider } from './AuthContext';
import { getAccessToken, setAccessToken } from './accessTokenStore';
import LoginCallbackPage from '../pages/LoginCallbackPage';
import ProtectedRoute from '../components/ProtectedRoute';

vi.mock('../api', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
  requestTokenRefreshOutcome: vi.fn(),
  getSessionGeneration: () => 0,
  bumpSessionGeneration: vi.fn(),
  subscribeSessionEnded: () => () => {},
}));

vi.mock('../tenant/TenantContext', () => ({
  useTenant: () => ({
    isPlatformHost: false,
  }),
}));

vi.mock('../config/FeaturesContext', () => ({
  useFeatures: () => ({
      config: {
        features: {
          billing: true,
          sso: true,
          email: true,
          aiChat: false,
          aiMcp: false,
          aiSettings: false,
          aiWebSearch: false,
        },
      },
    }),
}));

vi.mock('../ai/useAiCapabilities', () => ({
  useAiCapabilities: () => ({
    isLoading: false,
    isFetching: false,
    isError: false,
    data: {
      surfaces: {
        chat: { available: true },
        settings: { available: true },
      },
    },
  }),
}));

import api, { requestTokenRefreshOutcome } from '../api';

function createStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, String(value));
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
}

function AppUnderTest() {
  return (
    <Routes>
      <Route path="/login" element={<div>Login Page</div>} />
      <Route path="/login/callback" element={<LoginCallbackPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<div>Home Page</div>} />
      </Route>
    </Routes>
  );
}

describe('Entra callback auth bootstrap race', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const storage = createStorageMock();
    vi.stubGlobal('localStorage', storage);
    Object.defineProperty(window, 'localStorage', {
      value: storage,
      configurable: true,
    });
    setAccessToken(null);
    window.history.replaceState(null, '', '/');
  });

  it('skips bootstrap refresh on the callback route and preserves callback auth state', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    vi.mocked(api.post).mockRejectedValue(new Error('Refresh should not run on the login callback route'));

    vi.mocked(api.get).mockResolvedValue({
      data: {
        profile: {
          id: 'user-1',
          email: 'user@example.com',
        },
        claims: {
          isGlobalAdmin: true,
          isBillingAdmin: true,
          permissions: {},
        },
        subscription: null,
        tenantAuth: {
          sso_provider: 'entra',
          sso_enabled: true,
        },
      },
    } as any);

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/login/callback',
            hash: '#token=callback-token-from-fragment&expiresIn=900&refreshExpiresIn=14400&redirectTo=%2F',
          },
        ]}
      >
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <SessionManager>
              <AppUnderTest />
            </SessionManager>
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(getAccessToken()).toBe('callback-token-from-fragment');
    });

    expect(api.get).toHaveBeenCalledWith('/auth/me');

    await waitFor(() => {
      expect(screen.getByText('Home Page')).toBeInTheDocument();
    });

    expect(api.post).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('callback-token-from-fragment');
  });

  it('redeems Entra handoff on the callback route before navigating home', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    // As with BrowserRouter, the window is on the callback route, so the bootstrap refresh is skipped.
    window.history.replaceState(null, '', '/login/callback');

    vi.mocked(api.post).mockResolvedValue({
      data: {
        access_token: 'redeemed-token',
        expires_in: 900,
        refresh_expires_in: 14_400,
        redirectTo: '/',
      },
    } as any);

    vi.mocked(api.get).mockResolvedValue({
      data: {
        profile: {
          id: 'user-1',
          email: 'user@example.com',
        },
        claims: {
          isGlobalAdmin: true,
          isBillingAdmin: true,
          permissions: {},
        },
        subscription: null,
        tenantAuth: {
          sso_provider: 'entra',
          sso_enabled: true,
        },
      },
    } as any);

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/login/callback',
            hash: '#handoff=handoff-token',
          },
        ]}
      >
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <SessionManager>
              <AppUnderTest />
            </SessionManager>
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/auth/entra/session', { handoff: 'handoff-token' });
    });

    await waitFor(() => {
      expect(getAccessToken()).toBe('redeemed-token');
    });

    await waitFor(() => {
      expect(screen.getByText('Home Page')).toBeInTheDocument();
    });
    expect(requestTokenRefreshOutcome).not.toHaveBeenCalled();
  });
});
