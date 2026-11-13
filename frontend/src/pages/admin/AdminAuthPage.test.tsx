import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import AdminAuthPage from './AdminAuthPage';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

// `t` names the key and the values it was given, so the test reads which sentence is shown.
const t = vi.hoisted(() => (key: string, options?: Record<string, unknown>) =>
  options?.name ? `${key} [${String(options.name)}]` : key);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ isPlatformHost: false }) }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../api', () => ({ default: api }));
vi.mock('../../components/PageHeader', () => ({ default: () => null }));

function settings(directorySync: Record<string, unknown>) {
  return {
    sso_provider: 'entra',
    entra_tenant_id: 'directory',
    sso_enabled: true,
    entra_metadata: null,
    directory_sync: {
      status: 'ok',
      message: null,
      last_attempt_at: '2026-11-12T03:00:00Z',
      last_success_at: '2026-11-12T03:00:00Z',
      synced: 4,
      disabled: 0,
      removed: 1,
      kept_administrator: null,
      consent_url: null,
      ...directorySync,
    },
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <MemoryRouter><AdminAuthPage /></MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('AdminAuthPage directory sync report', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
  });

  it('names the administrator the last sync kept active', async () => {
    api.get.mockResolvedValue({ data: settings({ kept_administrator: 'Alice Martin' }) });
    renderPage();
    expect(await screen.findByText('auth.sync.keptAdministrator [Alice Martin]')).toBeTruthy();
  });

  it('shows no such line when nobody was kept', async () => {
    api.get.mockResolvedValue({ data: settings({}) });
    renderPage();
    expect(await screen.findByText('auth.sync.lastSynced')).toBeTruthy();
    expect(screen.queryByText(/auth\.sync\.keptAdministrator/)).toBeNull();
  });

  it('says a sync is already running when Sync now finds one in progress', async () => {
    api.get.mockResolvedValue({ data: settings({}) });
    api.post.mockResolvedValue({
      data: { status: 'already_running', message: null, synced: 0, disabled: 0, removed: 0, kept_administrator: null },
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'auth.sync.syncNow' }));
    expect(await screen.findByText('auth.sync.alreadyRunning')).toBeTruthy();
    expect(screen.queryByText(/auth\.sync\.error/)).toBeNull();
  });
});
