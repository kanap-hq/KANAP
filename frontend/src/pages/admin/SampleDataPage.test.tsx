import React from 'react';
import '../../i18n';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SampleDataPage from './SampleDataPage';
import { createAppTheme } from '../../config/ThemeContext';
import { api as apiClient } from '../../api/client';

vi.mock('../../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const env = vi.hoisted(() => ({
  isGlobalAdmin: true,
  isPlatformHost: false,
  deploymentMode: 'multi-tenant' as 'multi-tenant' | 'single-tenant',
  sampleData: true,
  refreshMe: null as null | (() => Promise<void>),
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    claims: { isGlobalAdmin: env.isGlobalAdmin },
    refreshMe: env.refreshMe,
    hasLevel: () => true,
  }),
}));
vi.mock('../../tenant/TenantContext', () => ({
  useTenant: () => ({ isPlatformHost: env.isPlatformHost }),
}));
vi.mock('../../config/FeaturesContext', () => ({
  useFeatures: () => ({
    config: { deploymentMode: env.deploymentMode, features: { sampleData: env.sampleData } },
    isLoading: false,
  }),
}));
vi.mock('../../components/PageHeader', () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

const BASE = {
  status: 'idle',
  step: null,
  started_at: null,
  heartbeat_at: null,
  loaded_at: null,
  loaded_by: null,
  failed_at: null,
  error_code: null,
  dismissed_at: null,
  can_load: true,
  created_since_load: null,
  workspace_name: 'Fromage & Co',
  loaded_by_name: null,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/admin/sample-data']}>
          <SampleDataPage />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return client;
}

describe('SampleDataPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.isGlobalAdmin = true;
    env.isPlatformHost = false;
    env.deploymentMode = 'multi-tenant';
    env.sampleData = true;
    env.refreshMe = vi.fn().mockResolvedValue(undefined);
  });

  it('offers the load in an empty workspace and describes the data set before loading', async () => {
    (apiClient.get as any).mockResolvedValue(BASE);
    (apiClient.post as any).mockResolvedValue({ ...BASE, status: 'loading' });
    renderPage();

    expect(await screen.findByText('Not loaded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load sample data' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Fromage & Co, a fictional cheese maker/)).toBeInTheDocument();
    expect(within(dialog).getByText('4 companies in France, the Netherlands, Italy and the United States')).toBeInTheDocument();
    expect(within(dialog).getByText('18 fictional users, who cannot sign in')).toBeInTheDocument();
    expect(within(dialog).getByText(/instances, interfaces and connections/)).toBeInTheDocument();
    expect(within(dialog).getByText(/budget of the current year/)).toBeInTheDocument();
    expect(within(dialog).getByText(/less than a minute/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Load sample data' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/admin/sample-data/load'));
  });

  it('says why nothing can be loaded into a workspace that holds data', async () => {
    (apiClient.get as any).mockResolvedValue({ ...BASE, can_load: false });
    renderPage();

    expect(await screen.findByText(/This workspace already holds data/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load sample data' })).not.toBeInTheDocument();
  });

  it('shows the running step in plain words, never its technical name', async () => {
    (apiClient.get as any).mockResolvedValue({
      ...BASE, status: 'loading', step: 'charts-of-accounts', can_load: false, started_at: '2026-10-07T10:00:00Z',
    });
    renderPage();

    expect(await screen.findByText('Step 4 of 19: charts of accounts')).toBeInTheDocument();
    expect(screen.getByText(/erased if the load fails/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('asks for the workspace name before erasing everything, and sends it', async () => {
    (apiClient.get as any).mockResolvedValue({
      ...BASE, status: 'loaded', can_load: false, loaded_at: '2026-10-07T10:00:00Z', loaded_by_name: 'Ada Admin', created_since_load: 3,
    });
    (apiClient.post as any).mockResolvedValue({ ...BASE, status: 'resetting' });
    renderPage();

    expect(await screen.findByText('Ada Admin')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Erase everything and start over' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/with no way back/)).toBeInTheDocument();
    expect(within(dialog).getByText('Real user accounts and their roles')).toBeInTheDocument();
    expect(within(dialog).getByText('The audit log')).toBeInTheDocument();
    expect(within(dialog).getByText(/currencies, budget columns, classification catalog/)).toBeInTheDocument();
    expect(within(dialog).getByText('3 items created since the sample data was loaded will also be erased.')).toBeInTheDocument();
    expect(within(dialog).getByText(/receive an e-mail/)).toBeInTheDocument();

    const erase = within(dialog).getByRole('button', { name: 'Erase everything' });
    const field = within(dialog).getByRole('textbox', { name: 'Workspace name' });
    expect(erase).toBeDisabled();
    fireEvent.change(field, { target: { value: 'Fromage' } });
    expect(erase).toBeDisabled();
    fireEvent.click(erase);
    expect(apiClient.post).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: '  fromage & CO ' } });
    expect(erase).toBeEnabled();
    fireEvent.click(erase);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/admin/sample-data/reset', { confirm_name: '  fromage & CO ' }));
  });

  it('gives the reason of a failed load and offers to try again', async () => {
    (apiClient.get as any).mockResolvedValue({
      ...BASE, status: 'failed', error_code: 'load_timeout', failed_at: '2026-10-07T10:00:00Z',
    });
    renderPage();

    expect(await screen.findByText(/Loading took too long and was stopped\. The workspace was put back in its starting state\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('offers to erase everything when the reset after a failed load failed too', async () => {
    (apiClient.get as any).mockResolvedValue({
      ...BASE, status: 'failed', error_code: 'reset_failed', can_load: false, failed_at: '2026-10-07T10:00:00Z',
    });
    renderPage();

    expect(await screen.findByText(/could not be put back in its starting state/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erase everything and start over' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('follows a reset and refreshes every cached query and the profile once it ends', async () => {
    (apiClient.get as any)
      .mockResolvedValueOnce({ ...BASE, status: 'resetting', can_load: false })
      .mockResolvedValue(BASE);
    const client = renderPage();
    const reset = vi.spyOn(client, 'resetQueries');

    expect(await screen.findByText(/Erasing the content of the workspace/)).toBeInTheDocument();
    await client.refetchQueries({ queryKey: ['sample-data'] });
    expect(await screen.findByText('Not loaded')).toBeInTheDocument();
    await waitFor(() => expect(reset).toHaveBeenCalled());
    expect(env.refreshMe).toHaveBeenCalled();
  });

  it('shows a translated message when the server refuses', async () => {
    (apiClient.get as any).mockResolvedValue(BASE);
    (apiClient.post as any).mockRejectedValue({ response: { status: 409, data: { code: 'tenant_not_empty', message: 'raw' } } });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Load sample data' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Load sample data' }));
    expect(await within(dialog).findByText(/This workspace already holds data/)).toBeInTheDocument();
  });

  it.each([
    ['a user without the Administrator role', () => { env.isGlobalAdmin = false; }],
    ['the platform host', () => { env.isPlatformHost = true; }],
    ['an on-premise installation', () => { env.deploymentMode = 'single-tenant'; }],
    ['a server without the feature', () => { env.sampleData = false; }],
  ])('is forbidden to %s and reads nothing', async (_label, arrange) => {
    arrange();
    renderPage();

    expect(await screen.findByText('Access denied')).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });
});
