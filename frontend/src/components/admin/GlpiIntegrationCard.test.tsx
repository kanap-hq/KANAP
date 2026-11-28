import React from 'react';
import i18n from '../../i18n';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GlpiIntegrationCard from './GlpiIntegrationCard';
import api from '../../api';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../design';

vi.mock('../../api', () => ({
  default: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const SETTINGS = {
  chat_enabled: true,
  mcp_enabled: true,
  provider_source: 'builtin',
  glpi_enabled: true,
  glpi_url: 'https://glpi.example.com/',
  has_glpi_user_token: true,
  has_glpi_app_token: false,
  glpi_last_test: null as null | { ok: boolean; tested_at: string },
  has_llm_api_key: false,
  provider_secret_writable: true,
  provider_validation_errors: [],
  chat_ready: true,
  created_at: '2026-03-21T10:00:00.000Z',
  updated_at: '2026-03-21T10:00:00.000Z',
};

function mockSettings(settings: Partial<typeof SETTINGS> = {}) {
  (api.get as any).mockResolvedValue({
    data: { instance_features: {}, settings: { ...SETTINGS, ...settings }, available_providers: [] },
  });
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <KanapDialogProvider>
            <GlpiIntegrationCard />
          </KanapDialogProvider>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('GlpiIntegrationCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings();
  });

  it('shows the saved connection: last test, tokens as dots, where to find each value', async () => {
    mockSettings({ glpi_last_test: { ok: true, tested_at: '2026-10-15T10:42:00.000Z' } });
    renderCard();

    expect(await screen.findByText(/^Last test passed on 15 Oct( 2026)? at /)).toBeInTheDocument();
    expect(screen.getByLabelText('GLPI URL')).toHaveValue('https://glpi.example.com/');
    expect(screen.getByLabelText('User token')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Replace User token' })).toBeInTheDocument();
    // No app token saved: an open field.
    expect(screen.getByLabelText('App token')).toBeEnabled();
    for (const name of [/Setup > General > API, Enable Rest API/, /Remote access keys/, /open the API client/]) {
      expect(screen.getByRole('img', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('says the cause of a failed test in the language of the screen, and keeps the values typed', async () => {
    (api.post as any).mockResolvedValue({
      data: {
        ok: false,
        code: 'glpi_user_token_invalid',
        message: 'GLPI rejected the user token.',
        latency_ms: null,
        tested_at: '2026-10-16T09:00:00.000Z',
        persisted: false,
      },
    });
    renderCard();
    await screen.findByLabelText('GLPI URL');
    fireEvent.click(screen.getByRole('button', { name: 'Replace User token' }));
    fireEvent.change(screen.getByLabelText('User token'), { target: { value: 'typed-token' } });
    try {
      await act(async () => { await i18n.changeLanguage('fr'); });
      fireEvent.click(screen.getByRole('button', { name: 'Tester' }));
      expect(await screen.findByText(/^GLPI a refusé le jeton utilisateur\./)).toBeInTheDocument();
      expect(screen.queryByText('GLPI rejected the user token.')).toBeNull();
      expect((api.post as any).mock.calls[0][1]).toEqual({ glpi_url: 'https://glpi.example.com/', glpi_user_token: 'typed-token' });
      expect(screen.getByLabelText('Jeton utilisateur')).toHaveValue('typed-token');
      expect(api.get).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => { await i18n.changeLanguage('en'); });
    }
  });

  it('removes the connection when the address is emptied, after the same confirmation as the others', async () => {
    (api.patch as any).mockResolvedValue({ data: { settings: { ...SETTINGS, glpi_enabled: false, glpi_url: null, has_glpi_user_token: false } } });
    renderCard();
    await screen.findByLabelText('GLPI URL');
    fireEvent.change(screen.getByLabelText('GLPI URL'), { target: { value: ' ' } });
    expect(screen.getByRole('button', { name: 'Test' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Remove the GLPI connection?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Remove the GLPI connection?')).not.toBeInTheDocument());
    expect(api.patch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect((api.patch as any).mock.calls[0][1]).toEqual({ glpi_url: null });
  });

  it('tells a secret storage that cannot write', async () => {
    mockSettings({ provider_secret_writable: false });
    renderCard();
    expect(await screen.findByText('Secret storage is not configured on this instance.')).toBeInTheDocument();
  });
});
