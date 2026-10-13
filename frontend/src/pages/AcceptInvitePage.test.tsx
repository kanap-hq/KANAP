import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../api';
import AcceptInvitePage from './AcceptInvitePage';

vi.mock('../api', () => ({
  default: {
    post: vi.fn(),
  },
}));

vi.mock('../components/AuthFrame', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const i18n = vi.hoisted(() => {
  const labels: Record<string, string> = {
    'errors:rate_limited': 'Too many attempts. Wait a few minutes and try again.',
    'errors:INVALID_TOKEN': 'The link is invalid or has expired.',
  };
  // A stable t: a new function on each render would loop effects.
  const t = (key: string) => labels[key] ?? key;
  return { t };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: i18n.t }),
}));

async function submitRefused(error: unknown) {
  vi.mocked(api.post).mockRejectedValueOnce(error);
  render(
    <MemoryRouter initialEntries={[{ pathname: '/link', hash: '#token=link-token' }]}>
      <Routes>
        <Route path="/link" element={<AcceptInvitePage />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText(/auth:reset\.newPassword/), { target: { value: 'New-password-2026' } });
  fireEvent.change(screen.getByLabelText(/auth:reset\.confirmPassword/), { target: { value: 'New-password-2026' } });
  fireEvent.click(screen.getByRole('button', { name: 'auth:invite.submit' }));
  return screen.findByRole('alert');
}

describe('AcceptInvitePage errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the translated rate limit sentence on a 429, not the server text', async () => {
    const alert = await submitRefused({
      response: { status: 429, data: { statusCode: 429, message: 'ThrottlerException: Too Many Requests' } },
    });
    expect(alert).toHaveTextContent('Too many attempts. Wait a few minutes and try again.');
    expect(alert).not.toHaveTextContent('ThrottlerException');
    expect(api.post).toHaveBeenCalledWith('/auth/password-reset/complete', { token: 'link-token', password: 'New-password-2026' });
  });

  it('translates an answer that carries a code', async () => {
    const alert = await submitRefused({
      response: { status: 400, data: { code: 'INVALID_TOKEN', message: 'invalid or expired token' } },
    });
    expect(alert).toHaveTextContent('The link is invalid or has expired.');
    expect(alert).not.toHaveTextContent('invalid or expired token');
  });

  it('shows the page sentence for an answer without a message', async () => {
    const alert = await submitRefused({ response: { status: 500, data: {} } });
    expect(alert).toHaveTextContent('auth:invite.serverError');
  });
});
