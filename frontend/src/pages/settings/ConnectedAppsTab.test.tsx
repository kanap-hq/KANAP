import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aiKeysApi } from '../../ai/aiApi';
import ConnectedAppsTab from './ConnectedAppsTab';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
}));

vi.mock('../../ai/aiApi', () => ({
  aiKeysApi: {
    list: vi.fn(),
    revoke: vi.fn(),
  },
}));

vi.mock('../../components/design/KanapDialogProvider', () => ({
  useKanapDialogs: () => ({ confirm: mocks.confirm }),
}));

vi.mock('../../i18n/useLocale', () => ({
  useLocale: () => 'en',
}));

const i18n = vi.hoisted(() => {
  // A stable t: a new function on each render would loop effects.
  const t = (key: string, options?: Record<string, unknown>) => {
    const values = options ? Object.values(options).join('|') : '';
    return values ? `${key}[${values}]` : key;
  };
  return { t };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: i18n.t }),
}));

function record(overrides: Record<string, unknown>) {
  return {
    id: 'k1',
    tenant_id: 't1',
    user_id: 'u1',
    key_prefix: 'abcd1234',
    label: 'Claude',
    expires_at: null,
    last_used_at: '2026-10-14T09:00:00.000Z',
    revoked_at: null,
    revoked_by_user_id: null,
    revocation_reason: null,
    created_at: '2026-10-12T09:00:00.000Z',
    created_by_user_id: 'u1',
    credential_kind: 'oauth',
    oauth_client_id: 'https://claude.ai/oauth/meta',
    oauth_client_name: 'Claude',
    oauth_redirect_host: 'claude.ai',
    ...overrides,
  };
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConnectedAppsTab />
    </QueryClientProvider>,
  );
}

describe('ConnectedAppsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists the active connections with their return host, and the API keys read only', async () => {
    vi.mocked(aiKeysApi.list).mockResolvedValue([
      record({}),
      record({ id: 'k2', oauth_client_name: 'Claude Code', oauth_redirect_host: 'localhost', last_used_at: null }),
      record({ id: 'k3', revoked_at: '2026-10-13T09:00:00.000Z', oauth_client_name: 'Old client' }),
      record({ id: 'k4', credential_kind: 'api_key', label: 'My script', oauth_client_name: null, oauth_redirect_host: null }),
    ] as any);
    renderTab();

    const rows = await screen.findAllByTestId('connected-app-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('claude.ai', { exact: false })).toBeInTheDocument();
    expect(within(rows[1]).getByText('Claude Code', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Old client')).not.toBeInTheDocument();
    expect(screen.getByText('connectedApps.apiKeys')).toBeInTheDocument();
    expect(screen.getByText('My script', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'connectedApps.disconnect' })).toHaveLength(2);
  });

  it('disconnects an application after confirmation', async () => {
    vi.mocked(aiKeysApi.list).mockResolvedValue([record({})] as any);
    vi.mocked(aiKeysApi.revoke).mockResolvedValue(record({ revoked_at: '2026-10-14T10:00:00.000Z' }) as any);
    mocks.confirm.mockResolvedValue(true);
    renderTab();

    fireEvent.click(await screen.findByRole('button', { name: 'connectedApps.disconnect' }));
    await waitFor(() => expect(aiKeysApi.revoke).toHaveBeenCalledWith('k1'));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ intent: 'danger', title: 'connectedApps.confirm.title[Claude]' }));
    await waitFor(() => expect(aiKeysApi.list).toHaveBeenCalledTimes(2));
  });

  it('keeps the connection when the confirmation is cancelled', async () => {
    vi.mocked(aiKeysApi.list).mockResolvedValue([record({})] as any);
    mocks.confirm.mockResolvedValue(false);
    renderTab();

    fireEvent.click(await screen.findByRole('button', { name: 'connectedApps.disconnect' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(aiKeysApi.revoke).not.toHaveBeenCalled();
  });

  it('shows one line with a link to the manual when nothing is connected', async () => {
    vi.mocked(aiKeysApi.list).mockResolvedValue([] as any);
    renderTab();

    expect(await screen.findByText('connectedApps.empty', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'connectedApps.howTo' })).toHaveAttribute('href', expect.stringContaining('ai-settings'));
    expect(screen.queryByText('connectedApps.apiKeys')).not.toBeInTheDocument();
  });
});
