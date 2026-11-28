import React from 'react';
import '../../i18n';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NetboxIntegrationCard from './NetboxIntegrationCard';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../design';
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
          <KanapDialogProvider>
            <NetboxIntegrationCard />
          </KanapDialogProvider>
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

  it('renders the connection fields and never reads the token back', async () => {
    renderCard();

    expect(await screen.findByText('Saved, not tested yet')).toBeInTheDocument();
    expect(screen.getByText('Netbox inventory')).toBeInTheDocument();
    expect(screen.getByLabelText('Netbox address')).toHaveValue('https://netbox.internal/');
    // The saved token shows as dots, greyed, with Replace beside it.
    expect(screen.getByLabelText('API token')).toBeDisabled();
    expect(screen.getByLabelText('API token')).not.toHaveValue('nbt');
    expect(screen.getByRole('button', { name: 'Replace API token' })).toBeInTheDocument();
    expect(screen.getByLabelText('Ignore certificate errors')).toBeInTheDocument();
    expect(screen.getByLabelText('Automatic synchronisation')).toBeInTheDocument();
    // Nothing changed: Save is off, Test is on.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Test' })).toBeEnabled();
  });

  it('sends only the fields that changed, plus the token when it was typed', async () => {
    renderCard();
    await screen.findByLabelText('Netbox address');

    fireEvent.click(screen.getByLabelText('Automatic synchronisation'));
    fireEvent.click(screen.getByRole('button', { name: 'Replace API token' }));
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: ' nbt_secret ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(1));
    // A typed token goes with the address on screen.
    expect(apiClient.put).toHaveBeenCalledWith('/netbox/integration', {
      base_url: 'https://netbox.internal/',
      auto_sync: true,
      api_token: 'nbt_secret',
    });
    expect(await screen.findByRole('link', { name: 'Set up the synchronisation' })).toHaveAttribute('href', '/it/settings?tab=netbox');
  });

  it('sends the token with the address on screen when only the token was typed', async () => {
    renderCard();
    await screen.findByLabelText('Netbox address');

    fireEvent.click(screen.getByRole('button', { name: 'Replace API token' }));
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(1));
    expect(apiClient.put).toHaveBeenCalledWith('/netbox/integration', {
      base_url: 'https://netbox.internal/',
      api_token: 'abc',
    });
  });

  it('says the cause of a failed test in the status line, then a refused save under the fields', async () => {
    (apiClient.post as any).mockResolvedValueOnce({
      ok: false,
      code: 'netbox_unreachable',
      message: 'connect ECONNREFUSED 172.18.0.9:8999',
    });
    renderCard();
    await screen.findByLabelText('Netbox address');

    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    // The same line as after a reload: the date, then the cause.
    const failed = await screen.findByText(/^Last test failed on /);
    expect(within(failed).getByText(/· The Netbox server could not be reached\.$/)).toBeInTheDocument();
    expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument();
    expect(screen.queryByText(/172\.18/)).not.toBeInTheDocument();

    // A change makes the result stale: the status line says so.
    fireEvent.change(screen.getByLabelText('Request timeout (seconds)'), { target: { value: '1' } });
    expect(screen.queryByText(/The Netbox server could not be reached/)).not.toBeInTheDocument();
    expect(screen.getByText('Changes not saved')).toBeInTheDocument();

    (apiClient.put as any).mockRejectedValueOnce({
      response: {
        status: 400,
        data: { code: 'netbox_timeout_invalid', message: 'raw timeout' },
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('The request timeout must be a whole number of seconds between 5 and 120, or empty to use the default.')).toBeInTheDocument();
    expect(screen.queryByText('raw timeout')).not.toBeInTheDocument();
    expect(screen.queryByText(/The Netbox server could not be reached/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('shows the stored last test after a reload', async () => {
    (apiClient.get as any).mockResolvedValue({
      ...INTEGRATION,
      last_test: { ok: false, tested_at: '2026-10-24T08:30:00.000Z', code: 'netbox_unreachable' },
    });
    renderCard();

    // The cause stays after a reload, from its code.
    const failed = await screen.findByText(/^Last test failed on 24 Oct( 2026)? at /);
    expect(within(failed).getByText(/The Netbox server could not be reached\./)).toBeInTheDocument();
  });

  it('says after a reload the Netbox version of the last test', async () => {
    (apiClient.get as any).mockResolvedValue({
      ...INTEGRATION,
      last_test: { ok: true, tested_at: '2026-10-24T08:30:00.000Z', version: '4.7.1' },
    });
    renderCard();
    const passed = await screen.findByText(/^Last test passed on 24 Oct/);
    expect(within(passed).getByText(/Netbox 4\.7\.1/)).toBeInTheDocument();
  });

  it('keeps Test off until the address and the token are there', async () => {
    (apiClient.get as any).mockResolvedValue({ ...INTEGRATION, configured: false, base_url: null, credential: { present: false }, last_test: null });
    renderCard();
    expect(await screen.findByText('Never tested')).toBeInTheDocument();
    const test = screen.getByRole('button', { name: 'Test' });
    expect(test).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Netbox address'), { target: { value: 'https://netbox.example.com' } });
    expect(test).toBeDisabled();
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'nbt_typed' } });
    expect(test).toBeEnabled();
  });

  it('shows a test of unsaved values with what Netbox answered, without reloading the form', async () => {
    (apiClient.get as any).mockResolvedValue({ ...INTEGRATION, configured: false, base_url: null, credential: { present: false }, last_test: null });
    (apiClient.post as any).mockResolvedValue({
      ok: true,
      netbox_version: '4.1.2',
      message: 'Connected to Netbox.',
      tested_at: '2026-10-24T08:30:00.000Z',
      persisted: false,
    });
    renderCard();
    expect(await screen.findByText('Never tested')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Netbox address'), { target: { value: 'https://netbox.example.com' } });
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'nbt_typed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    const status = await screen.findByText(/^Last test passed on /);
    expect(within(status).getByText(/Netbox 4\.1\.2/)).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Netbox address')).toHaveValue('https://netbox.example.com');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('empties the saved token when the address changes and asks for it again', async () => {
    renderCard();
    await screen.findByLabelText('Netbox address');
    const save = screen.getByRole('button', { name: 'Save' });
    const test = screen.getByRole('button', { name: 'Test' });

    // Another spelling of the saved address keeps the token.
    fireEvent.change(screen.getByLabelText('Netbox address'), { target: { value: 'https://NETBOX.internal' } });
    expect(screen.getByLabelText(/^API token/)).toBeDisabled();
    expect(screen.queryByText('The address changed: enter it again.')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Netbox address'), { target: { value: 'https://netbox2.internal' } });
    expect(screen.getByLabelText(/^API token/)).toBeRequired();
    expect(screen.getByText('The address changed: enter it again.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Replace API token' })).not.toBeInTheDocument();
    expect(save).toBeDisabled();
    expect(test).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^API token/), { target: { value: 'nbt_new' } });
    expect(save).toBeEnabled();
    expect(test).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(1));
    expect(apiClient.put).toHaveBeenCalledWith('/netbox/integration', {
      base_url: 'https://netbox2.internal',
      api_token: 'nbt_new',
    });
  });

  it('removes the connection when the address is emptied, after a confirmation', async () => {
    renderCard();
    await screen.findByLabelText('Netbox address');
    const save = screen.getByRole('button', { name: 'Save' });
    const test = screen.getByRole('button', { name: 'Test' });

    fireEvent.change(screen.getByLabelText('Netbox address'), { target: { value: '  ' } });
    expect(screen.getByLabelText(/^API token/)).not.toBeRequired();
    expect(screen.queryByText('The address changed: enter it again.')).not.toBeInTheDocument();
    expect(save).toBeEnabled();
    expect(test).toBeDisabled();

    // Cancelling keeps everything as it is.
    fireEvent.click(save);
    expect(await screen.findByText('Remove the Netbox connection?')).toBeInTheDocument();
    expect(screen.getByText('Its address and saved token are deleted, and the automatic synchronisation stops. What was already synchronised stays.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Remove the Netbox connection?')).not.toBeInTheDocument());
    expect(apiClient.put).not.toHaveBeenCalled();

    fireEvent.click(save);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(1));
    expect(apiClient.put).toHaveBeenCalledWith('/netbox/integration', { base_url: '' });
  });
});
