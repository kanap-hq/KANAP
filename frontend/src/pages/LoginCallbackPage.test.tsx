import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../api';
import LoginCallbackPage from './LoginCallbackPage';

const mocks = vi.hoisted(() => ({ login: vi.fn() }));

vi.mock('../api', () => ({ default: { post: vi.fn() } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ login: mocks.login }) }));

function Probe() {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

function renderCallback() {
  return render(
    <MemoryRouter initialEntries={['/login/callback#handoff=h1']}>
      <Routes>
        <Route path="/login/callback" element={<LoginCallbackPage />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginCallbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('brings a Microsoft sign-in back to the consent page of an MCP connection, query intact', async () => {
    const consent = '/oauth/authorize?client_id=https%3A%2F%2Fclaude.ai%2Fmeta&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=s1&code_challenge=abc';
    vi.mocked(api.post).mockResolvedValue({ data: { access_token: 'a', expires_in: 900, redirectTo: consent } } as any);
    renderCallback();

    expect(await screen.findByTestId('location')).toHaveTextContent(consent);
    expect(api.post).toHaveBeenCalledWith('/auth/entra/session', { handoff: 'h1' });
    expect(mocks.login).toHaveBeenCalled();
  });
});
