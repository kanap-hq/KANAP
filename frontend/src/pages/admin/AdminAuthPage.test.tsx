import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import AdminAuthPage from './AdminAuthPage';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

// `t` names the key and the values it was given, so the test reads which sentence is shown.
const t = vi.hoisted(() => (key: string, options?: Record<string, unknown>) =>
  options?.name ? `${key} [${String(options.name)}]` : options?.count !== undefined ? `${key} (${String(options.count)})` : key);
const features = vi.hoisted(() => ({ email: true }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ isPlatformHost: false }) }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../api', () => ({ default: api }));
vi.mock('../../components/PageHeader', () => ({ default: () => null }));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features: features } }) }));

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

describe('AdminAuthPage disconnect', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    features.email = true;
  });

  function connected(disconnect: Record<string, unknown>) {
    return { ...settings({}), disconnect };
  }

  it('gives the two numbers from the server and asks nothing more of an administrator with a password', async () => {
    api.get.mockResolvedValue({ data: connected({ keep_password: 3, need_password: 2, password_required: false }) });
    api.post.mockResolvedValue({ data: { ok: true } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'auth.actions.disconnect' }));
    expect(await screen.findByText('auth.disconnect.keepPassword (3)')).toBeTruthy();
    expect(screen.getByText('auth.disconnect.needPassword (2)')).toBeTruthy();
    expect(screen.queryByLabelText('auth.disconnect.ownPassword')).toBeNull();
    const buttons = screen.getAllByRole('button', { name: 'auth.actions.disconnect' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/auth/disconnect', {}));
  });

  it('asks an administrator without a password for one of at least 8 characters', async () => {
    api.get.mockResolvedValue({ data: connected({ keep_password: 1, need_password: 0, password_required: true }) });
    api.post.mockResolvedValue({ data: { ok: true } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'auth.actions.disconnect' }));
    const field = await screen.findByLabelText('auth.disconnect.ownPassword');
    const confirm = () => {
      const buttons = screen.getAllByRole('button', { name: 'auth.actions.disconnect' });
      return buttons[buttons.length - 1] as HTMLButtonElement;
    };
    fireEvent.change(field, { target: { value: 'short' } });
    expect(confirm().disabled).toBe(true);
    fireEvent.change(field, { target: { value: 'Long-enough-1' } });
    expect(confirm().disabled).toBe(false);
    fireEvent.click(confirm());
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/auth/disconnect', { password: 'Long-enough-1' }));
  });

  it('points to the administrator reset when the installation sends no e-mail', async () => {
    features.email = false;
    api.get.mockResolvedValue({ data: connected({ keep_password: 0, need_password: 4, password_required: false }) });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'auth.actions.disconnect' }));
    expect(await screen.findByText('auth.disconnect.needPasswordNoEmail (4)')).toBeTruthy();
    expect(screen.queryByText(/auth\.disconnect\.needPassword \(/)).toBeNull();
  });
});
