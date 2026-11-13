import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../api';
import LinkMicrosoftPage from './LinkMicrosoftPage';

vi.mock('../api', () => ({ default: { post: vi.fn() } }));

vi.mock('../components/AuthFrame', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const i18n = vi.hoisted(() => {
  // A stable t: a new function on each render would loop effects.
  const t = (key: string, options?: { account?: string }) => (options?.account ? `${key}:${options.account}` : key);
  return { t };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: i18n.t }),
}));

function LoginProbe() {
  const location = useLocation();
  return (
    <span data-testid="login">
      {`${location.pathname}${location.search}|${JSON.stringify(location.state ?? null)}`}
    </span>
  );
}

function renderLanding(hash: string) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/login/link-microsoft', hash }]}>
      <Routes>
        <Route path="/login/link-microsoft" element={<LinkMicrosoftPage />} />
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** A link token as the server signs it: only its readable middle part matters here. */
function linkToken(payload: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const middle = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${middle}.signature`;
}

const confirmButton = () => screen.getByRole('button', { name: 'auth:linkMicrosoft.confirm' });

describe('LinkMicrosoftPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confirms only on a click, then returns to the sign-in page', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { linked: true } } as any);
    renderLanding('#token=abc.def');
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.click(confirmButton());
    await waitFor(() => expect(screen.getByTestId('login').textContent).toBe('/login|{"microsoftLinked":true}'));
    expect(api.post).toHaveBeenCalledWith('/auth/entra/link', { token: 'abc.def' });
  });

  it('names the Microsoft account that asked for the link, before the button', () => {
    const token = linkToken({ name: 'Zoé <b>Martin</b>', username: 'zoe.martin@contoso.test' });
    renderLanding(`#token=${token}`);
    const line = screen.getByText('auth:linkMicrosoft.account:Zoé <b>Martin</b> (zoe.martin@contoso.test)');
    expect(line.querySelector('b')).toBeNull();
    expect(line.compareDocumentPosition(confirmButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the sign-in name alone when the link has no display name', () => {
    renderLanding(`#token=${linkToken({ username: 'zoe.martin@contoso.test' })}`);
    expect(screen.getByText('auth:linkMicrosoft.account:zoe.martin@contoso.test')).toBeTruthy();
  });

  it.each([
    ['ENTRA_LINK_INVALID', 'ENTRA_LINK_INVALID'],
    ['ENTRA_ACCOUNT_LINKED', 'ENTRA_ACCOUNT_LINKED'],
    ['Bad Request', 'ENTRA_LINK_INVALID'],
  ])('returns to the sign-in page with the refusal %s', async (message, code) => {
    vi.mocked(api.post).mockRejectedValue({ response: { status: 400, data: { message } } });
    renderLanding('#token=abc.def');
    fireEvent.click(confirmButton());
    await waitFor(() => expect(screen.getByTestId('login').textContent).toBe(`/login?ssoError=${code}|null`));
  });

  it('stays on the page when the server does not answer', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { status: 503, data: {} } });
    renderLanding('#token=abc.def');
    fireEvent.click(confirmButton());
    await screen.findByRole('alert');
    expect(confirmButton()).not.toBeDisabled();
  });

  it('sends a link without a token to the sign-in page', async () => {
    renderLanding('');
    await waitFor(() => expect(screen.getByTestId('login').textContent).toBe('/login?ssoError=ENTRA_LINK_INVALID|null'));
  });
});
