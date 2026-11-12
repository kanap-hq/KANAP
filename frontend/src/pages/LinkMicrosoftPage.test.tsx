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
  const t = (key: string) => key;
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
