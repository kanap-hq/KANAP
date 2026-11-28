import React from 'react';
import '../../i18n';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MonitoringIntegrationCard from './MonitoringIntegrationCard';
import api from '../../api';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../design';

vi.mock('../../api', () => ({
  default: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const PRTG = {
  provider_key: 'prtg',
  implementation: 'prtg',
  enabled: true,
  environment: 'production',
  base_url: 'https://prtg.example.com',
  server_timezone: 'Europe/Paris',
  request_timeout_seconds: null,
  credential: { present: true, shape: 'api_token' },
  last_test: null as null | { ok: boolean; tested_at: string; code?: string; version?: string; sensor_count?: number },
  updated_at: '2026-09-18T10:00:00.000Z',
};

function mockPrtg(prtg: Partial<typeof PRTG> | null = {}) {
  (api.get as any).mockResolvedValue({ data: { integrations: prtg ? [{ ...PRTG, ...prtg }] : [] } });
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <KanapDialogProvider>
            <MonitoringIntegrationCard />
          </KanapDialogProvider>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('MonitoringIntegrationCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrtg();
  });

  it('shows the stored last test after a reload, and its own fields', async () => {
    mockPrtg({ last_test: { ok: false, tested_at: '2026-10-16T09:00:00.000Z', code: 'prtg_auth' } });
    renderCard();

    // The cause stays after a reload, from its code.
    const failed = await screen.findByText(/^Last test failed on 16 Oct( 2026)? at /);
    expect(within(failed).getByText(/PRTG rejected the API key\./)).toBeInTheDocument();
    expect(screen.getByLabelText('Server address')).toHaveValue('https://prtg.example.com');
    expect(screen.getByLabelText('API key')).toBeDisabled();
    expect(screen.getByLabelText('Server time zone')).toHaveValue('Europe/Paris');
    // The default applies when the timeout is empty, and shows as its placeholder.
    expect(screen.getByLabelText('Request timeout (seconds)')).toHaveAttribute('placeholder', '30');
    for (const name of [/browser, for example https:\/\/prtg/, /under “Setup \| Account Settings \| API Keys”\./, /PRTG core server/, /^5 to 120 seconds/]) {
      expect(screen.getByRole('img', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('says after a reload what PRTG answered at the last test', async () => {
    mockPrtg({ last_test: { ok: true, tested_at: '2026-10-16T09:00:00.000Z', version: '24.1', sensor_count: 321 } });
    renderCard();
    const passed = await screen.findByText(/^Last test passed on 16 Oct/);
    expect(within(passed).getByText(/PRTG 24\.1, 321 sensors visible/)).toBeInTheDocument();
  });

  it('starts a new connection as never tested, Test off until the address and the key are there', async () => {
    mockPrtg(null);
    renderCard();
    expect(await screen.findByText('Never tested')).toBeInTheDocument();
    expect(screen.getByLabelText('API key')).toBeEnabled();
    const test = screen.getByRole('button', { name: 'Test' });
    expect(test).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: 'https://prtg.example.com' } });
    expect(test).toBeDisabled();
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'typed-key' } });
    expect(test).toBeEnabled();
  });

  it('says what removing the connection stops', async () => {
    renderCard();
    await screen.findByLabelText('Server address');
    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: ' ' } });
    expect(screen.getByRole('button', { name: 'Test' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Remove the PRTG connection?')).toBeInTheDocument();
    expect(screen.getByText('Its address and saved key are deleted. Monitoring agents can no longer read PRTG.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.put).not.toHaveBeenCalled();
  });

  it('shows what PRTG answered, then the cause of a failure in words, without its raw text', async () => {
    (api.post as any).mockResolvedValueOnce({
      data: { ok: true, prtg_version: '24.1', sensor_count: 321, message: 'ok', tested_at: '2026-11-20T09:00:00.000Z', persisted: true },
    });
    renderCard();
    await screen.findByLabelText('Server address');

    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    const passed = await screen.findByText(/^Last test passed on /);
    expect(within(passed).getByText(/PRTG 24\.1, 321 sensors visible/)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);

    (api.post as any).mockResolvedValueOnce({
      data: { ok: false, code: 'prtg_auth', message: 'HTTP 401 from upstream', tested_at: '2026-11-20T09:05:00.000Z', persisted: true },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    // The same line as after a reload: the date, then the cause.
    const failed = await screen.findByText(/^Last test failed on 20 Nov( 2026)? at /);
    expect(within(failed).getByText(/· PRTG rejected the API key\. Check that it was copied in full\.$/)).toBeInTheDocument();
    expect(screen.queryByText(/HTTP 401/)).toBeNull();
  });

  it('saves only after a change, then points to the agents page', async () => {
    (api.put as any).mockResolvedValue({ data: { ok: true } });
    renderCard();
    await screen.findByLabelText('Server address');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Request timeout (seconds)'), { target: { value: '60' } });
    expect(screen.getByText('Changes not saved')).toBeInTheDocument();
    fireEvent.click(save);
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect((api.put as any).mock.calls[0][1]).toEqual({
      base_url: 'https://prtg.example.com',
      enabled: true,
      server_timezone: 'Europe/Paris',
      request_timeout_seconds: 60,
    });
    expect(await screen.findByRole('link', { name: 'Open the agents page' })).toHaveAttribute('href', '/agents');
  });
});
