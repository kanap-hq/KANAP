import React from 'react';
import '../../../i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NetboxSyncTile from './NetboxSyncTile';
import { createAppTheme } from '../../../config/ThemeContext';
import { api as apiClient } from '../../../api/client';

vi.mock('../../../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const BASE_STATUS = {
  configured: true,
  enabled: true,
  auto_sync: true,
  sync: {
    status: 'success',
    trigger: 'scheduled',
    started_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    finished_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    duration_ms: 4200,
    counts: { create: 0, update: 0, unchanged: 12, ambiguous: 0, skipped: 0, missing: 0, error: 0 },
    error: null,
  },
  records: { linked: 12, ambiguous: 0, missing: 0, ignored: 0, error: 0 },
};

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{`${pathname}${search}`}</div>;
}

function renderTile() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/']}>
          <Where />
          <Routes>
            <Route path="/" element={<NetboxSyncTile />} />
            <Route path="/it/settings" element={<div>settings</div>} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('NetboxSyncTile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers to connect Netbox when it is not configured', async () => {
    (apiClient.get as any).mockResolvedValue({ ...BASE_STATUS, configured: false });

    renderTile();

    expect(await screen.findByText('Netbox is not connected.')).toBeInTheDocument();
    expect(screen.getByText('Connect Netbox')).toBeInTheDocument();
  });

  it('shows a single line when nothing needs a decision', async () => {
    (apiClient.get as any).mockResolvedValue(BASE_STATUS);

    renderTile();

    expect(await screen.findByText(/Synchronisation up to date/)).toBeInTheDocument();
    expect(screen.queryByText(/to decide/)).not.toBeInTheDocument();
  });

  it('lists only the non-zero attention points', async () => {
    (apiClient.get as any).mockResolvedValue({
      ...BASE_STATUS,
      sync: { ...BASE_STATUS.sync, status: 'failure', error: 'Netbox did not answer.' },
      records: { linked: 12, ambiguous: 2, missing: 1, ignored: 3, error: 0 },
    });

    renderTile();

    expect(await screen.findByText('Last synchronisation failed')).toBeInTheDocument();
    expect(screen.getByText('2 objects to decide')).toBeInTheDocument();
    expect(screen.getByText('1 asset missing from Netbox')).toBeInTheDocument();
    expect(screen.queryByText(/error/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '2 objects to decide' }));
    const decided = new URLSearchParams(screen.getByTestId('where').textContent?.split('?')[1]);
    expect(screen.getByTestId('where').textContent?.startsWith('/it/settings?')).toBe(true);
    expect(decided.get('tab')).toBe('netbox');
    expect(decided.get('state')).toBe('ambiguous');
  });

  it('opens the Netbox tab from View all', async () => {
    (apiClient.get as any).mockResolvedValue(BASE_STATUS);
    renderTile();
    fireEvent.click(await screen.findByRole('button', { name: 'View all' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/it/settings?tab=netbox');
  });
});
