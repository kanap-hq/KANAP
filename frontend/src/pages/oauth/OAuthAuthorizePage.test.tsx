import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api';
import OAuthAuthorizePage from './OAuthAuthorizePage';

const mocks = vi.hoisted(() => ({
  auth: {
    token: 'session-token' as string | null,
    isAuthenticating: false,
    profile: { id: 'u1', email: 'claude@fromage-co.com', first_name: 'Claude', last_name: 'Tester' },
    logout: vi.fn(),
  },
}));

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => mocks.auth,
}));

vi.mock('../../tenant/TenantContext', () => ({
  useTenant: () => ({ tenantName: 'Fromage & Co' }),
}));

vi.mock('../../components/AuthFrame', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const i18n = vi.hoisted(() => {
  // A stable t that shows its key and its values: a new function on each render would loop effects.
  const t = (key: string, options?: Record<string, unknown>) => {
    const values = options ? Object.values(options).join('|') : '';
    return values ? `${key}[${values}]` : key;
  };
  return { t };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: i18n.t }),
}));

const query = '?response_type=code&client_id=https%3A%2F%2Fclaude.ai%2Foauth%2Fmeta&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&state=st-1&code_challenge=abc&code_challenge_method=S256&resource=http%3A%2F%2Ffromage.lvh.me%2Fapi%2Fai%2Fmcp&scope=mcp%3Aread';

function describedRequest(overrides: Record<string, unknown> = {}) {
  return {
    client: { client_id: 'https://claude.ai/oauth/meta', client_name: 'Claude', client_uri: 'https://claude.ai', logo_uri: null },
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    redirect_host: 'claude.ai',
    loopback_redirect: false,
    scope: 'mcp:read',
    resource: 'http://fromage.lvh.me/api/ai/mcp',
    auto_approve: false,
    remembered: false,
    ...overrides,
  };
}

function LoginProbe() {
  const location = useLocation();
  return <span data-testid="login">{`${location.pathname}${location.search}`}</span>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/oauth/authorize${query}`]}>
      <Routes>
        <Route path="/oauth/authorize" element={<OAuthAuthorizePage />} />
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const originalLocation = window.location;
const assign = vi.fn();

describe('OAuthAuthorizePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.token = 'session-token';
    mocks.auth.isAuthenticating = false;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, origin: originalLocation.origin, assign },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('sends a visitor without a session to the login page, with the way back', () => {
    mocks.auth.token = null;
    renderPage();
    const login = screen.getByTestId('login').textContent ?? '';
    expect(login.startsWith('/login?returnTo=')).toBe(true);
    const returnTo = new URLSearchParams(login.slice('/login'.length)).get('returnTo');
    expect(returnTo).toBe(`/oauth/authorize${query}`);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('shows the full screen and posts an approval with the original request', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: describedRequest() } as any);
    vi.mocked(api.post).mockResolvedValue({ data: { redirect_to: 'https://claude.ai/api/mcp/auth_callback?code=c1&state=st-1' } } as any);
    renderPage();

    expect(await screen.findByText('auth:oauthConsent.title[Claude]')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(`/oauth/authorize/request${query}`);
    expect(screen.getByText('claude.ai')).toBeInTheDocument();
    expect(screen.getByText('auth:oauthConsent.userInTenant[Claude Tester|Fromage & Co]')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'auth:oauthConsent.allow' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?code=c1&state=st-1'));
    const [url, body] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/oauth/authorize/decision');
    expect(body).toMatchObject({
      client_id: 'https://claude.ai/oauth/meta',
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      state: 'st-1',
      code_challenge: 'abc',
      resource: 'http://fromage.lvh.me/api/ai/mcp',
      approve: true,
      remember: true,
    });
  });

  it('sends remember: false when the box is unticked', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: describedRequest() } as any);
    vi.mocked(api.post).mockResolvedValue({ data: { redirect_to: 'https://claude.ai/cb?code=c1' } } as any);
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'auth:oauthConsent.allow' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ approve: true, remember: false });
  });

  it('names a loopback return as an application on this computer', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: describedRequest({ redirect_uri: 'http://localhost:33418/callback', redirect_host: 'localhost:33418', loopback_redirect: true }),
    } as any);
    renderPage();
    expect(await screen.findByText('auth:oauthConsent.thisComputer[localhost:33418]')).toBeInTheDocument();
  });

  it('posts a refusal and follows the address the server gives', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: describedRequest() } as any);
    vi.mocked(api.post).mockResolvedValue({ data: { redirect_to: 'https://claude.ai/cb?error=access_denied&state=st-1' } } as any);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'auth:oauthConsent.deny' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://claude.ai/cb?error=access_denied&state=st-1'));
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ approve: false });
  });

  it('approves a remembered loopback client without showing any button', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: describedRequest({ redirect_host: 'localhost:40000', loopback_redirect: true, auto_approve: true, remembered: true }),
    } as any);
    vi.mocked(api.post).mockResolvedValue({ data: { redirect_to: 'http://localhost:40000/callback?code=c2' } } as any);
    renderPage();

    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://localhost:40000/callback?code=c2'));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ approve: true, remember: true });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('auth:oauthConsent.connecting[Claude]')).toBeInTheDocument();
  });

  it('shows the short continue screen to a remembered web client, never skipping it', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: describedRequest({ remembered: true, auto_approve: false }) } as any);
    vi.mocked(api.post).mockResolvedValue({ data: { redirect_to: 'https://claude.ai/cb?code=c3' } } as any);
    renderPage();

    expect(await screen.findByText('auth:oauthConsent.continueTitle[Claude]')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText('claude.ai')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'auth:oauthConsent.continue' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://claude.ai/cb?code=c3'));
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ approve: true, remember: true });
  });

  it('offers a way back on an error with a verified return address, without going there by itself', async () => {
    vi.mocked(api.get).mockRejectedValue({
      response: { status: 400, data: { error: 'invalid_scope', redirect_to: 'https://claude.ai/cb?error=invalid_scope&state=st-1' } },
    });
    renderPage();

    const back = await screen.findByRole('button', { name: 'auth:oauthConsent.error.backTo[claude.ai]' });
    expect(screen.getByText('auth:oauthConsent.error.title')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    fireEvent.click(back);
    expect(assign).toHaveBeenCalledWith('https://claude.ai/cb?error=invalid_scope&state=st-1');
  });

  it('shows only a message on an error without a verified return address', async () => {
    vi.mocked(api.get).mockRejectedValue({ response: { status: 400, data: { error: 'invalid_request', redirect_to: null } } });
    renderPage();
    expect(await screen.findByText('auth:oauthConsent.error.title')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it('says so when the account may not connect applications', async () => {
    vi.mocked(api.get).mockRejectedValue({ response: { status: 403, data: { error: 'access_denied', redirect_to: null } } });
    renderPage();
    expect(await screen.findByText('auth:oauthConsent.error.deniedTitle')).toBeInTheDocument();
  });

  it('shows a long or crafted client name as plain text, cut to 60 characters', async () => {
    const crafted = `<img src=x onerror="alert(1)"> ${'A'.repeat(100)}`;
    vi.mocked(api.get).mockResolvedValue({ data: describedRequest({ client: { client_id: 'https://evil.example/meta', client_name: crafted } }) } as any);
    const { container } = renderPage();

    const title = await screen.findByRole('heading', { level: 1 });
    const shown = (title.textContent ?? '').replace(/^auth:oauthConsent\.title\[/, '').replace(/\]$/, '');
    expect(shown).toHaveLength(60);
    expect(shown.endsWith('…')).toBe(true);
    expect(shown.startsWith('<img src=x')).toBe(true);
    expect(container.querySelector('img[src="x"]')).toBeNull();
  });
});
