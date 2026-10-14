import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../api';
import LoginPage from './LoginPage';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  sso: false,
}));

vi.mock('../api', () => ({
  default: {
    post: vi.fn(),
  },
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    login: mocks.login,
  }),
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
        sso: mocks.sso,
        email: false,
      },
    },
  }),
}));

vi.mock('../components/AuthFrame', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const i18n = vi.hoisted(() => {
  const labels: Record<string, string> = {
    'auth:login.emailLabel': 'Username or email',
    'auth:login.passwordLabel': 'Password',
    'auth:login.submit': 'Sign in',
    'auth:login.ssoMicrosoft': 'Sign in with Microsoft',
  };
  // A stable t: a new function on each render would loop effects.
  const t = (key: string, options?: { count?: number }) =>
    labels[key] ?? (options?.count !== undefined ? `${key}:${options.count}` : key);
  return { t };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: i18n.t }),
}));

function LocationProbe() {
  const location = useLocation();
  return (
    <div>
      <span>Destination page</span>
      <span data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</span>
    </div>
  );
}

type TestInitialEntry = string | {
  pathname: string;
  search?: string;
  hash?: string;
  state?: unknown;
};

function renderLogin(initialEntry: TestInitialEntry) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<LocationProbe />} />
        <Route path="/oauth/authorize" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sso = false;
    vi.mocked(api.post).mockResolvedValue({
      data: {
        access_token: 'access-token',
        expires_in: 900,
        refresh_expires_in: 14_400,
      },
    } as any);
  });

  it('always lands on the home page after email login, even when a previous page was requested', async () => {
    renderLogin({
      pathname: '/login',
      state: {
        from: {
          pathname: '/portfolio/tasks/42',
          search: '?focus=activity',
          hash: '#comments',
        },
      },
    });

    fireEvent.change(screen.getByLabelText('Username or email'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(mocks.login).toHaveBeenCalledWith({
        access_token: 'access-token',
        expires_in: 900,
        refresh_expires_in: 14_400,
      });
    });

    expect(await screen.findByText('Destination page')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });

  async function submitRefused(error: unknown) {
    vi.mocked(api.post).mockRejectedValueOnce(error);
    renderLogin('/login');
    fireEvent.change(screen.getByLabelText('Username or email'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'not the password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    return screen.findByRole('alert');
  }

  it('shows the translated rate limit sentence on a 429, not the server text', async () => {
    const alert = await submitRefused({
      response: { status: 429, data: { statusCode: 429, message: 'ThrottlerException: Too Many Requests' } },
    });
    expect(alert).toHaveTextContent('auth:login.tooManyAttempts');
    expect(alert).not.toHaveTextContent('ThrottlerException');
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('shows the wait the server gives on a 429, in whole minutes rounded up', async () => {
    const alert = await submitRefused({
      response: { status: 429, headers: { 'retry-after': '841' }, data: { statusCode: 429, message: 'ThrottlerException: Too Many Requests' } },
    });
    expect(alert).toHaveTextContent('auth:login.tooManyAttemptsWait:15');
    expect(alert).not.toHaveTextContent('ThrottlerException');
  });

  it('rounds a wait under a minute up to one minute', async () => {
    const alert = await submitRefused({ response: { status: 429, headers: { 'retry-after': '12' }, data: {} } });
    expect(alert).toHaveTextContent('auth:login.tooManyAttemptsWait:1');
  });

  it('keeps the general rate limit sentence when Retry-After is missing or unusable', async () => {
    const alert = await submitRefused({ response: { status: 429, headers: { 'retry-after': 'soon' }, data: {} } });
    expect(alert).toHaveTextContent('auth:login.tooManyAttempts');
    expect(alert).not.toHaveTextContent('tooManyAttemptsWait');
  });

  it('translates a refusal that carries a code', async () => {
    const alert = await submitRefused({
      response: { status: 401, data: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } },
    });
    expect(alert).toHaveTextContent('errors:INVALID_CREDENTIALS');
  });

  it('asks for a valid email address when the request check refuses the address typed', async () => {
    const validation = await submitRefused({
      response: { status: 400, data: { statusCode: 400, message: ['email must be an email'], error: 'Bad Request' } },
    });
    expect(validation).toHaveTextContent('auth:login.invalidEmail');
    expect(validation).not.toHaveTextContent('email must be an email');
    expect(screen.getByLabelText('Username or email')).toBeInTheDocument();
  });

  it('shows the plain failure sentence for another validation error', async () => {
    const validation = await submitRefused({
      response: { status: 400, data: { statusCode: 400, message: ['password must be longer than or equal to 1 characters'], error: 'Bad Request' } },
    });
    expect(validation).toHaveTextContent('auth:login.failed');
    expect(validation).not.toHaveTextContent('password must be');
  });

  it('shows the plain failure sentence when the server does not answer', async () => {
    const alert = await submitRefused({ message: 'Network Error', code: 'ERR_NETWORK' });
    expect(alert).toHaveTextContent('auth:login.failed');
    expect(alert).not.toHaveTextContent('Network Error');
  });

  const consentPath = '/oauth/authorize?client_id=https%3A%2F%2Fclaude.ai%2Fmeta&state=abc&code_challenge=x';

  async function signIn(search: string) {
    renderLogin(`/login${search}`);
    fireEvent.change(screen.getByLabelText('Username or email'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery staple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Destination page');
    return screen.getByTestId('location').textContent;
  }

  it('returns to the consent page of an MCP connection after a password sign-in', async () => {
    expect(await signIn(`?returnTo=${encodeURIComponent(consentPath)}`)).toBe(consentPath);
  });

  it.each([
    '/settings',
    '//evil.example/oauth/authorize?x=1',
    'https://evil.example/oauth/authorize?x=1',
    '/oauth/authorizeX?x=1',
  ])('ignores any other return path (%s) and lands on the home page', async (returnTo) => {
    expect(await signIn(`?returnTo=${encodeURIComponent(returnTo)}`)).toBe('/');
  });

  describe('Microsoft sign-in', () => {
    const originalLocation = window.location;
    let assigned = '';

    beforeEach(() => {
      mocks.sso = true;
      assigned = '';
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: {
          ...originalLocation,
          origin: originalLocation.origin,
          set href(value: string) {
            assigned = value;
          },
          get href() {
            return assigned || originalLocation.href;
          },
        },
      });
    });

    afterEach(() => {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    });

    function redirectToOf(url: string): string | null {
      return new URL(url, 'http://fromage.lvh.me').searchParams.get('redirectTo');
    }

    it('passes the consent page as the return path', () => {
      renderLogin(`/login?returnTo=${encodeURIComponent(consentPath)}`);
      fireEvent.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));
      expect(redirectToOf(assigned)).toBe(consentPath);
    });

    it('passes the home page for any other return path', () => {
      renderLogin(`/login?returnTo=${encodeURIComponent('/admin/users')}`);
      fireEvent.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));
      expect(redirectToOf(assigned)).toBe('/');
    });
  });
});
