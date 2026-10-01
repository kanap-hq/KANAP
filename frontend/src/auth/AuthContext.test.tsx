import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import { AuthProvider, useAuth } from './AuthContext';
import { getAccessToken, setAccessToken } from './accessTokenStore';
import { bumpSessionGeneration } from '../api';
import ProtectedRoute from '../components/ProtectedRoute';

// The real api.ts runs on a mocked axios: `refreshPost` is the /auth/refresh call, `instance`
// serves every other request, `errorHandlers[0]` is the response interceptor of api.ts.
const http = vi.hoisted(() => {
  const errorHandlers: Array<(error: unknown) => Promise<unknown>> = [];
  const instance = {
    interceptors: {
      request: { use: vi.fn() },
      response: {
        use: vi.fn((_onSuccess: unknown, onError: (error: unknown) => Promise<unknown>) => {
          errorHandlers.push(onError);
        }),
      },
    },
    get: vi.fn(),
    post: vi.fn(),
    request: vi.fn(),
  };
  return { instance, errorHandlers, refreshPost: vi.fn() };
});

vi.mock('axios', () => ({
  __esModule: true,
  default: { create: () => http.instance, post: http.refreshPost },
}));

vi.mock('../tenant/TenantContext', () => ({
  useTenant: () => ({ isPlatformHost: false }),
}));

vi.mock('../config/FeaturesContext', () => ({
  useFeatures: () => ({
    config: {
      features: { billing: true, sso: true, email: true, aiChat: false, aiMcp: false, aiSettings: false, aiWebSearch: false },
    },
  }),
}));

vi.mock('../ai/useAiCapabilities', () => ({
  useAiCapabilities: () => ({ isLoading: false, isFetching: false, isError: false, data: null }),
}));

const freshTokens = {
  data: { access_token: 'fresh-access-token', expires_in: 900, refresh_expires_in: 14_400 },
};

const me = {
  data: {
    profile: { id: 'user-1', email: 'user@example.com' },
    claims: { isGlobalAdmin: true, isBillingAdmin: false, permissions: {} },
    subscription: null,
    tenantAuth: null,
  },
};

const serverUnavailableLine = 'Cannot reach the server. Retrying.';

function networkError() {
  return new Error('Network Error');
}

function httpError(status: number) {
  return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });
}

function unauthorized(url: string) {
  return { response: { status: 401 }, config: { url, headers: {} } };
}

function createStorageMock() {
  const store = new Map<string, string>();
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

// The markers a signed-in browser keeps across reloads.
function storeSession() {
  window.localStorage.setItem('last_activity_at', String(Date.now()));
  window.localStorage.setItem('refresh_ttl_ms', String(4 * 60 * 60 * 1000));
}

async function advance(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function IdentityProbe() {
  const { profile, claims } = useAuth();
  return <div data-testid="identity">{profile || claims ? 'identity loaded' : 'no identity'}</div>;
}

function HomePage() {
  const { logout } = useAuth();
  return (
    <div>
      <div>Home Page</div>
      <button type="button" onClick={() => void logout()}>Sign out</button>
    </div>
  );
}

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/']}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <LocationProbe />
          <IdentityProbe />
          <Routes>
            <Route path="/login" element={<div>Login Page</div>} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<HomePage />} />
            </Route>
          </Routes>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function renderSignedIn() {
  storeSession();
  http.refreshPost.mockResolvedValueOnce(freshTokens);
  renderApp();
  await advance();
  await advance();
  expect(screen.getByText('Home Page')).toBeInTheDocument();
}

describe('AuthProvider and ProtectedRoute', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
    const storage = createStorageMock();
    vi.stubGlobal('localStorage', storage);
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });

    setAccessToken(null);
    // No flight left over from a previous test is joined.
    bumpSessionGeneration();
    http.refreshPost.mockReset();
    http.instance.get.mockReset();
    http.instance.get.mockResolvedValue(me);
    // The api is down for /auth/logout unless a test says otherwise.
    http.instance.post.mockReset();
    http.instance.post.mockRejectedValue(networkError());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('server unreachable at load', () => {
    it('shows one line instead of the login page while it retries, then lands in the app', async () => {
      storeSession();
      http.refreshPost
        .mockRejectedValueOnce(networkError())
        .mockRejectedValueOnce(networkError())
        .mockRejectedValueOnce(networkError())
        .mockRejectedValueOnce(networkError())
        .mockResolvedValueOnce(freshTokens);

      renderApp();
      expect(screen.getByRole('progressbar')).toBeInTheDocument();

      // One flight: 4 attempts over 1 s + 3 s + 8 s.
      await advance(12_100);
      expect(http.refreshPost).toHaveBeenCalledTimes(4);
      expect(screen.getByRole('status')).toHaveTextContent(serverUnavailableLine);
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
      expect(screen.queryByText('Login Page')).not.toBeInTheDocument();

      // The next round, a few seconds later, gets through.
      await advance(5_000);
      await advance();
      expect(http.refreshPost).toHaveBeenCalledTimes(5);
      expect(getAccessToken()).toBe('fresh-access-token');
      expect(screen.getByText('Home Page')).toBeInTheDocument();
      expect(screen.queryByText(serverUnavailableLine)).not.toBeInTheDocument();
    });

    it('goes to the login page when the retried refresh is refused', async () => {
      storeSession();
      http.refreshPost
        .mockRejectedValueOnce(networkError())
        .mockRejectedValueOnce(networkError())
        .mockRejectedValueOnce(networkError())
        .mockRejectedValueOnce(networkError())
        .mockRejectedValueOnce(httpError(401));

      renderApp();
      await advance(12_100);
      expect(screen.getByRole('status')).toHaveTextContent(serverUnavailableLine);

      await advance(5_000);
      await advance();
      expect(http.refreshPost).toHaveBeenCalledTimes(5);
      expect(screen.getByText('Login Page')).toBeInTheDocument();
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/login$/);
    });

    it('goes to the login page without a stored session', async () => {
      http.refreshPost.mockRejectedValue(networkError());

      renderApp();
      await advance(12_100);

      expect(http.refreshPost).toHaveBeenCalledTimes(4);
      expect(screen.getByText('Login Page')).toBeInTheDocument();
      expect(screen.queryByText(serverUnavailableLine)).not.toBeInTheDocument();
    });
  });

  it('logout while a refresh waits to retry: the server coming back does not sign the user in again', async () => {
    await renderSignedIn();

    // A request gets a 401; its refresh hits the restarting api and waits to retry.
    http.refreshPost.mockRejectedValueOnce(httpError(502)).mockResolvedValue(freshTokens);
    const original = unauthorized('/master-data/companies');
    const request = http.errorHandlers[0](original).catch((error) => error);
    await advance();
    expect(http.refreshPost).toHaveBeenCalledTimes(2);

    // The user signs out while the api is still down.
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await advance();
    expect(screen.getByText('Login Page')).toBeInTheDocument();

    // The api is back and would answer 200.
    await advance(20_000);
    expect(await request).toBe(original);
    expect(http.refreshPost).toHaveBeenCalledTimes(2);
    expect(getAccessToken()).toBeNull();
    expect(screen.getByText('Login Page')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/login$/);
  });

  it('a refresh refused behind a request interceptor clears the identity and shows the expired notice', async () => {
    await renderSignedIn();
    expect(screen.getByTestId('identity')).toHaveTextContent('identity loaded');

    http.refreshPost.mockRejectedValueOnce(httpError(401));
    const original = unauthorized('/it/assets');
    await act(async () => {
      await expect(http.errorHandlers[0](original)).rejects.toBe(original);
    });
    await advance();

    expect(getAccessToken()).toBeNull();
    expect(screen.getByTestId('identity')).toHaveTextContent('no identity');
    expect(screen.getByText('Login Page')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/login?sessionExpired=true');
  });
});
