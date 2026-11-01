import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A full page load of a feature-gated route while /config/public fails (the API restarts): the
// route must wait for the configuration, then render, instead of falling to the catch-all.

vi.mock('./auth/AuthContext', () => ({ useAuth: () => ({ token: null }) }));
vi.mock('./components/ProtectedRoute', () => ({ default: () => <Outlet /> }));
vi.mock('./components/Layout', () => ({ default: () => <Outlet /> }));
vi.mock('./pages/it/VulnerabilitiesPage', () => ({ default: () => <div>vulnerabilities page</div> }));

import App from './App';

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

describe('App routes: configuration read that fails first', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps /it/vulnerabilities and renders it once the configuration arrives', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 502 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ deploymentMode: 'multi-tenant', features: { vulnerabilityFeed: true }, version: '1' }),
      });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={['/it/vulnerabilities']}>
        <App />
        <Where />
      </MemoryRouter>,
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('where')).toHaveTextContent('/it/vulnerabilities');
    expect(screen.queryByText('vulnerabilities page')).not.toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
    expect(await screen.findByText('vulnerabilities page')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/it/vulnerabilities');
  });
});
