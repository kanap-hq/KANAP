import React from 'react';
import '../../i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EnablePlaidCard from './EnablePlaidCard';
import { createAppTheme } from '../../config/ThemeContext';
import { aiAdminApi } from '../../ai/aiApi';

vi.mock('../../ai/aiApi', () => ({
  aiAdminApi: { getSettings: vi.fn(), updateSettings: vi.fn() },
}));

const env = vi.hoisted(() => ({
  subscription: { status: 'trialing', is_subscription_healthy: true, trial_days_remaining: 9 } as Record<string, unknown> | null,
  deploymentMode: 'multi-tenant' as 'multi-tenant' | 'single-tenant',
  settingsAvailable: true,
  chatEnabled: false,
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ subscription: env.subscription }),
}));
vi.mock('../../tenant/TenantContext', () => ({
  useTenant: () => ({ tenantSlug: 'fromage' }),
}));
vi.mock('../../config/FeaturesContext', () => ({
  useFeatures: () => ({ config: { deploymentMode: env.deploymentMode, features: {} }, isLoading: false }),
}));
vi.mock('../../ai/useAiCapabilities', () => ({
  useAiCapabilities: () => ({
    data: {
      surfaces: {
        settings: { available: env.settingsAvailable },
        chat: { tenant_enabled: env.chatEnabled },
      },
    },
  }),
}));

const KEY = 'kanap.enablePlaidCard.dismissed.fromage';
const SETTINGS = {
  settings: {
    chat_enabled: false,
    builtin_provider: {
      in_use: true, used_by_assistant: true, name: 'Mistral', location: 'EU', key: 'mistral-eu',
      accepted: false, accepted_at: null, accepted_by_name: null,
    },
  },
};

function makeStorage(failing = false) {
  const store = new Map<string, string>();
  return {
    store,
    getItem: vi.fn((k: string) => {
      if (failing) throw new Error('denied');
      return store.has(k) ? store.get(k)! : null;
    }),
    setItem: vi.fn((k: string, v: string) => {
      if (failing) throw new Error('denied');
      store.set(k, v);
    }),
    removeItem: vi.fn((k: string) => { store.delete(k); }),
  };
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter><EnablePlaidCard /></MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const TEXT = 'Plaid, the KANAP assistant, is turned off.';

describe('EnablePlaidCard', () => {
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    vi.clearAllMocks();
    env.subscription = { status: 'trialing', is_subscription_healthy: true, trial_days_remaining: 9 };
    env.deploymentMode = 'multi-tenant';
    env.settingsAvailable = true;
    env.chatEnabled = false;
    storage = makeStorage();
    vi.stubGlobal('localStorage', storage);
    vi.mocked(aiAdminApi.getSettings).mockResolvedValue(SETTINGS as never);
    vi.mocked(aiAdminApi.updateSettings).mockResolvedValue(SETTINGS as never);
  });

  it('shows during a trial to an AI settings administrator with the assistant off', async () => {
    renderCard();
    expect(await screen.findByText(TEXT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
  });

  it('does not show for a paid subscription, even with nothing stored', async () => {
    env.subscription = { status: 'active', is_subscription_healthy: true };
    renderCard();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(TEXT)).toBeNull();
    expect(aiAdminApi.getSettings).not.toHaveBeenCalled();
  });

  it('does not show for an expired trial', async () => {
    env.subscription = { status: 'trialing', is_subscription_healthy: false };
    renderCard();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(TEXT)).toBeNull();
  });

  it('does not show on-premise', async () => {
    env.deploymentMode = 'single-tenant';
    renderCard();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(TEXT)).toBeNull();
    expect(aiAdminApi.getSettings).not.toHaveBeenCalled();
  });

  it('does not show when the assistant is on', async () => {
    env.chatEnabled = true;
    renderCard();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(TEXT)).toBeNull();
  });

  it('does not show without access to the AI settings', async () => {
    env.settingsAvailable = false;
    renderCard();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(TEXT)).toBeNull();
    expect(aiAdminApi.getSettings).not.toHaveBeenCalled();
  });

  it('does not show when no included model is offered', async () => {
    vi.mocked(aiAdminApi.getSettings).mockResolvedValue({ settings: { chat_enabled: false, builtin_provider: undefined } } as never);
    renderCard();
    await waitFor(() => expect(aiAdminApi.getSettings).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(TEXT)).toBeNull();
  });

  it('opens the confirmation, and turning on sends the included model key', async () => {
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(aiAdminApi.updateSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /confirm and turn on/i }));
    await waitFor(() => expect(aiAdminApi.updateSettings).toHaveBeenCalledWith({
      chat_enabled: true,
      accept_builtin_provider_key: 'mistral-eu',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows the new provider when it changed meanwhile', async () => {
    vi.mocked(aiAdminApi.updateSettings).mockRejectedValueOnce({
      response: {
        status: 400,
        data: {
          code: 'BUILTIN_PROVIDER_CHANGED',
          message: 'changed',
          builtin_provider: { name: 'Other', location: 'US', key: 'other-us' },
        },
      },
    });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    fireEvent.click(await screen.findByRole('button', { name: /confirm and turn on/i }));
    expect(await screen.findByText(/changed\. Review it/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /confirm and turn on/i }));
    await waitFor(() => expect(aiAdminApi.updateSettings).toHaveBeenLastCalledWith({
      chat_enabled: true,
      accept_builtin_provider_key: 'other-us',
    }));
  });

  it('hides for good in this browser with the close button', async () => {
    renderCard();
    expect(await screen.findByText(TEXT)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText(TEXT)).toBeNull();
    expect(storage.store.get(KEY)).toBe('1');
  });

  it('stays hidden when the browser remembers the dismissal', async () => {
    storage.store.set(KEY, '1');
    renderCard();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(TEXT)).toBeNull();
  });

  it('still renders, and hides for the session, when the storage throws', async () => {
    vi.stubGlobal('localStorage', makeStorage(true));
    renderCard();
    expect(await screen.findByText(TEXT)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText(TEXT)).toBeNull();
  });
});
