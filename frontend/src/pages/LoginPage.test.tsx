import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../api';
import LoginPage from './LoginPage';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
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
        sso: false,
        email: false,
      },
    },
  }),
}));

vi.mock('../components/AuthFrame', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'auth:login.emailLabel': 'Username or email',
        'auth:login.passwordLabel': 'Password',
        'auth:login.submit': 'Sign in',
      };
      return labels[key] ?? key;
    },
  }),
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
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('translates a refusal that carries a code', async () => {
    const alert = await submitRefused({
      response: { status: 401, data: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } },
    });
    expect(alert).toHaveTextContent('errors:INVALID_CREDENTIALS');
  });

  it('shows the plain failure sentence for a validation error or no answer', async () => {
    const validation = await submitRefused({
      response: { status: 400, data: { statusCode: 400, message: ['email must be an email'], error: 'Bad Request' } },
    });
    expect(validation).toHaveTextContent('auth:login.failed');
    expect(validation).not.toHaveTextContent('email must be an email');
  });

  it('shows the plain failure sentence when the server does not answer', async () => {
    const alert = await submitRefused({ message: 'Network Error', code: 'ERR_NETWORK' });
    expect(alert).toHaveTextContent('auth:login.failed');
    expect(alert).not.toHaveTextContent('Network Error');
  });
});
