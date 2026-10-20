import React from 'react';
import '../../i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NetboxIntegrationCard from './NetboxIntegrationCard';
import { createAppTheme } from '../../config/ThemeContext';
import { api as apiClient } from '../../api/client';

vi.mock('../../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const INTEGRATION = {
  configured: true,
  enabled: true,
  base_url: 'https://netbox.internal/',
  credential: { present: true },
  request_timeout_seconds: 30,
  insecure_tls: false,
  auto_sync: false,
  default_environment: 'prod',
  secret_writable: true,
  updated_at: '2026-09-18T10:00:00.000Z',
};

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <NetboxIntegrationCard />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('NetboxIntegrationCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.get as any).mockResolvedValue(INTEGRATION);
    (apiClient.put as any).mockResolvedValue(INTEGRATION);
  });

  it('renders the connection fields and never prefills the token', async () => {
    renderCard();

    expect(await screen.findByText('Netbox inventory')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByLabelText('Netbox address')).toHaveValue('https://netbox.internal/');
    expect(screen.getByLabelText('API token')).toHaveValue('');
    expect(screen.getByPlaceholderText('Configured')).toBeInTheDocument();
    expect(screen.getByLabelText('Ignore certificate errors')).toBeInTheDocument();
    expect(screen.getByLabelText('Automatic synchronisation')).toBeInTheDocument();
  });

  it('sends only the fields that changed, plus the token when it was typed', async () => {
    renderCard();
    await screen.findByText('Netbox inventory');

    fireEvent.click(screen.getByLabelText('Automatic synchronisation'));
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: ' nbt_secret ' } });
    fireEvent.click(screen.getByText('Save settings'));

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(1));
    expect(apiClient.put).toHaveBeenCalledWith('/netbox/integration', {
      auto_sync: true,
      api_token: 'nbt_secret',
    });
    expect(await screen.findByRole('link', { name: 'Set up the synchronisation' })).toHaveAttribute('href', '/it/settings?tab=netbox');
  });

  it('sends nothing but the token when only the token was typed', async () => {
    renderCard();
    await screen.findByText('Netbox inventory');

    fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByText('Save settings'));

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(1));
    expect(apiClient.put).toHaveBeenCalledWith('/netbox/integration', { api_token: 'abc' });
  });
});
