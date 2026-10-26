import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import { AuthProvider, useAuth } from './AuthContext';
import { getAccessToken, setAccessToken } from './accessTokenStore';
import { bumpSessionGeneration } from '../api';
import ProtectedRoute from '../components/ProtectedRoute';
import { cachedListContext, resetListContextCache, saveListContext } from '../lib/listContext';
import { readStoredBudgetListContext, writeStoredBudgetListContext } from '../pages/budget/listContextStorage';

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

const otherUser = {
  data: {
    profile: { id: 'user-2', email: 'other@example.com' },
    claims: { isGlobalAdmin: false, isBillingAdmin: false, permissions: { budget: 'reader' } },
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

function tooManyAttempts(retryAfter?: string) {
  return Object.assign(new Error('Request failed with status code 429'), {
    response: { status: 429, headers: retryAfter ? { 'retry-after': retryAfter } : {} },
  });
}

const rateLimitedLine = 'Too many attempts. Try again in a moment.';

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
  const { profile, claims, dataAccess, hasLevel } = useAuth();
  return (
    <div
      data-testid="identity"
      data-mode={dataAccess?.mode ?? 'none'}
      data-companies-admin={String(hasLevel('companies', 'admin'))}
      data-companies-reader={String(hasLevel('companies', 'reader'))}
      data-budget-admin={String(hasLevel('budget', 'admin'))}
      data-agents={String(hasLevel('ai_agents', 'reader'))}
    >
      {profile || claims ? `identity loaded ${profile?.id ?? ''}` : 'no identity'}
    </div>
  );
}

function LoginPageStub() {
  const { login } = useAuth();
  const navigate = useNavigate();
  return (
    <div>
      <div>Login Page</div>
      <button type="button" onClick={() => { login(freshTokens.data); navigate('/', { replace: true }); }}>Sign in</button>
    </div>
  );
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

let queryClient: QueryClient;

function renderApp() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/']}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <LocationProbe />
          <IdentityProbe />
          <Routes>
            <Route path="/login" element={<LoginPageStub />} />
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
    window.sessionStorage.clear();
    resetListContextCache();
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

  });

  describe('load without a session', () => {
    it('an anonymous visitor lands on the login page without a refresh request', async () => {
      http.refreshPost.mockRejectedValue(httpError(400));

      renderApp();
      await advance(12_100);

      expect(http.refreshPost).not.toHaveBeenCalled();
      expect(screen.getByText('Login Page')).toBeInTheDocument();
      expect(screen.queryByText(serverUnavailableLine)).not.toBeInTheDocument();
    });

    it('a legacy refresh token in storage is still exchanged', async () => {
      window.localStorage.setItem('refresh_token', 'legacy-refresh-token');
      http.refreshPost.mockResolvedValueOnce(freshTokens);

      renderApp();
      await advance();
      await advance();

      expect(http.refreshPost).toHaveBeenCalledTimes(1);
      expect(http.refreshPost.mock.calls[0][1]).toEqual({ refresh_token: 'legacy-refresh-token' });
      expect(getAccessToken()).toBe('fresh-access-token');
      expect(screen.getByText('Home Page')).toBeInTheDocument();
    });
  });

  describe('refresh rate limited at load', () => {
    it('says nothing about one short 429 when the next attempt goes through', async () => {
      storeSession();
      http.refreshPost.mockRejectedValueOnce(tooManyAttempts()).mockResolvedValueOnce(freshTokens);

      renderApp();
      await advance();
      expect(http.refreshPost).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(rateLimitedLine)).not.toBeInTheDocument();
      expect(screen.getByRole('progressbar')).toBeInTheDocument();

      await advance(1_000);
      await advance();
      expect(screen.getByText('Home Page')).toBeInTheDocument();
      expect(screen.queryByText(rateLimitedLine)).not.toBeInTheDocument();
    });

    it('says so after two 429 in a row, and gives way to the server line when the server goes down', async () => {
      storeSession();
      http.refreshPost
        .mockRejectedValueOnce(tooManyAttempts())
        .mockRejectedValueOnce(tooManyAttempts())
        .mockRejectedValueOnce(httpError(503))
        .mockRejectedValueOnce(networkError());

      renderApp();
      await advance();
      expect(screen.queryByText(rateLimitedLine)).not.toBeInTheDocument();

      // The second 429, one second later: the line and its button.
      await advance(1_000);
      expect(http.refreshPost).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('status')).toHaveTextContent(rateLimitedLine);
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();

      // A 503 next: no longer "too many attempts".
      await advance(3_000);
      expect(http.refreshPost).toHaveBeenCalledTimes(3);
      expect(screen.queryByText(rateLimitedLine)).not.toBeInTheDocument();

      // The round ends on a network error: the server line, never the rate limit.
      await advance(8_100);
      expect(http.refreshPost).toHaveBeenCalledTimes(4);
      expect(screen.getByRole('status')).toHaveTextContent(serverUnavailableLine);
      expect(screen.queryByText(rateLimitedLine)).not.toBeInTheDocument();
    });

    it('says so at once for a long wait, and Retry tries again in the page without reloading it', async () => {
      const reload = vi.fn();
      vi.stubGlobal('location', { ...window.location, pathname: '/', reload });
      storeSession();
      http.refreshPost.mockRejectedValueOnce(tooManyAttempts('30')).mockResolvedValueOnce(freshTokens);

      renderApp();
      await advance();
      expect(screen.getByRole('status')).toHaveTextContent(rateLimitedLine);

      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await advance();
      await advance();
      expect(http.refreshPost).toHaveBeenCalledTimes(2);
      expect(reload).not.toHaveBeenCalled();
      expect(screen.getByText('Home Page')).toBeInTheDocument();
      expect(screen.queryByText(rateLimitedLine)).not.toBeInTheDocument();
    });
  });

  it('reads the data access from /auth/me: a limited person keeps the reads of a reserved module, not its writes', async () => {
    const permissions = { companies: 'admin', budget: 'admin', ai_agents: 'admin' };
    const limitedMe = { data: { ...otherUser.data, claims: { ...otherUser.data.claims, permissions }, dataAccess: { available: true, mode: 'limited', nodes: [], modules: ['budget'] } } };
    http.instance.get.mockResolvedValue(limitedMe);
    await renderSignedIn();
    const identity = screen.getByTestId('identity');
    expect(identity).toHaveAttribute('data-mode', 'limited');
    expect(identity).toHaveAttribute('data-companies-admin', 'false');
    expect(identity).toHaveAttribute('data-companies-reader', 'true');
    expect(identity).toHaveAttribute('data-budget-admin', 'true');
    expect(identity).toHaveAttribute('data-agents', 'false');
  });

  it('an unscoped person keeps every right of their roles', async () => {
    const permissions = { companies: 'admin', ai_agents: 'admin' };
    http.instance.get.mockResolvedValue({ data: { ...otherUser.data, claims: { ...otherUser.data.claims, permissions }, dataAccess: { available: true, mode: 'all', nodes: [], modules: ['budget'] } } });
    await renderSignedIn();
    expect(screen.getByTestId('identity')).toHaveAttribute('data-companies-admin', 'true');
    expect(screen.getByTestId('identity')).toHaveAttribute('data-agents', 'true');
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
  describe('per-user state in the browser', () => {
    const BUDGET_ROWS = ['budget-lines', 'summary', 'user-1'];
    const BLANK_OWNER = JSON.stringify({ business_owner: { filterType: 'set', values: [null] } });

    // What user 1 leaves in this tab: a budget list filter, cached rows, a saved list context.
    async function leaveUserState() {
      writeStoredBudgetListContext({ sort: '', q: '', filters: BLANK_OWNER, statusScope: 'enabled' });
      queryClient.setQueryData(BUDGET_ROWS, { items: [{ id: 'line-1' }] });
      http.instance.post.mockResolvedValueOnce({ data: { id: 'ctx-user-1' } });
      await act(async () => {
        await saveListContext('/budget-lines/summary', BLANK_OWNER);
      });
      expect(readStoredBudgetListContext()?.filters).toBe(BLANK_OWNER);
      expect(queryClient.getQueryData(BUDGET_ROWS)).toBeDefined();
      expect(cachedListContext('ctx-user-1')).toBeDefined();
    }

    function expectNoUserState() {
      expect(readStoredBudgetListContext()).toBeNull();
      expect(queryClient.getQueryData(BUDGET_ROWS)).toBeUndefined();
      expect(cachedListContext('ctx-user-1')).toBeUndefined();
    }

    it('sign out then another user signs in: nothing of the first user is left in the tab', async () => {
      await renderSignedIn();
      await leaveUserState();

      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      await advance();
      expect(screen.getByText('Login Page')).toBeInTheDocument();
      expectNoUserState();

      http.instance.get.mockResolvedValue(otherUser);
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      await advance();
      await advance();
      expect(screen.getByText('Home Page')).toBeInTheDocument();
      expect(screen.getByTestId('identity')).toHaveTextContent('identity loaded user-2');
      expectNoUserState();
    });

    it('another user behind a new token (signed in from another tab): the first user\'s state is dropped', async () => {
      await renderSignedIn();
      await leaveUserState();

      http.instance.get.mockResolvedValue(otherUser);
      act(() => setAccessToken('other-user-token', Date.now() + 900_000));
      await advance();
      expect(screen.getByTestId('identity')).toHaveTextContent('identity loaded user-2');
      expectNoUserState();
    });

    it('a new token for the same user keeps the state of the tab', async () => {
      await renderSignedIn();
      await leaveUserState();

      act(() => setAccessToken('next-access-token', Date.now() + 900_000));
      await advance();
      expect(screen.getByTestId('identity')).toHaveTextContent('identity loaded user-1');
      expect(readStoredBudgetListContext()?.filters).toBe(BLANK_OWNER);
      expect(queryClient.getQueryData(BUDGET_ROWS)).toBeDefined();
      expect(cachedListContext('ctx-user-1')).toBeDefined();
    });
  });
});
