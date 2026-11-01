import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import PlaidConsent from './PlaidConsent';

const env = vi.hoisted(() => ({
  settingsAvailable: true,
  provider: { name: 'Anthropic', location: 'EU', key: 'k1' } as { name: string; location: string; key: string },
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock('../../ai/useAiCapabilities', () => ({
  useAiCapabilities: () => ({ data: { surfaces: { settings: { available: env.settingsAvailable } } } }),
}));
vi.mock('../../ai/aiApi', () => ({
  aiAdminApi: {
    getSettings: () => env.getSettings(),
    updateSettings: (body: unknown) => env.updateSettings(body),
  },
}));

function renderConsent() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter><PlaidConsent /></MemoryRouter>
        </ThemeProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const settingsWith = (provider: typeof env.provider) => ({
  settings: { builtin_provider: { ...provider, in_use: true, used_by_assistant: true, accepted: false, accepted_at: null, accepted_by_name: null } },
});

describe('PlaidConsent', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    env.settingsAvailable = true;
    env.provider = { name: 'Anthropic', location: 'EU', key: 'k1' };
    env.getSettings.mockReset().mockImplementation(async () => settingsWith(env.provider));
    env.updateSettings.mockReset().mockResolvedValue({});
  });

  it('turns Plaid on and accepts the declared provider in one tick', async () => {
    renderConsent();
    const box = await screen.findByRole('checkbox');
    expect(screen.getByText(/^I agree that Anthropic \(.+\) processes my questions/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Admin › Plaid' })).toHaveAttribute('href', '/admin/ai');
    fireEvent.click(box);
    await waitFor(() => expect(env.updateSettings).toHaveBeenCalledWith({ chat_enabled: true, accept_builtin_provider_key: 'k1' }));
  });

  it('shows the new provider, unticked, when the platform changed it meanwhile', async () => {
    env.updateSettings.mockRejectedValue(Object.assign(new Error('changed'), {
      response: { status: 409, data: { code: 'BUILTIN_PROVIDER_CHANGED' } },
    }));
    renderConsent();
    const box = await screen.findByRole('checkbox');
    env.provider = { name: 'Mistral', location: 'EU', key: 'k2' };
    fireEvent.click(box);
    expect(await screen.findByText(/^I agree that Mistral/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('tells anyone else that Plaid waits for an administrator', () => {
    env.settingsAvailable = false;
    renderConsent();
    expect(screen.getByText('Plaid is waiting for an administrator to turn it on.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(env.getSettings).not.toHaveBeenCalled();
  });
});
