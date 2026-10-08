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
  ever_loaded_at: null,
  reset_failed_at: null,
  can_load: true,
  load_refusal: null,
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
    expect(within(dialog).getByText(/less than a minute\. You can erase everything later from Admin › Sample data\./)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Load sample data' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/admin/sample-data/load'));
  });

  it.each([
    ['SUBSCRIPTION_FROZEN', 'Sample data cannot be loaded while the subscription is frozen.'],
    ['TRIAL_EXPIRED', 'Sample data cannot be loaded once the trial has ended.'],
  ])('says why nothing can be loaded when the subscription refuses it (%s)', async (refusal, line) => {
    (apiClient.get as any).mockResolvedValue({ ...BASE, can_load: false, load_refusal: refusal });
    renderPage();

    expect(await screen.findByText(line)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load sample data' })).not.toBeInTheDocument();
  });

  it('says why nothing can be loaded into a workspace that holds data', async () => {
    (apiClient.get as any).mockResolvedValue({ ...BASE, can_load: false, load_refusal: 'tenant_not_empty' });
    renderPage();

    expect(await screen.findByText(/This workspace already holds data/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load sample data' })).not.toBeInTheDocument();
  });

  it('shows a generic line for a step this build does not know', async () => {
    (apiClient.get as any).mockResolvedValue({ ...BASE, status: 'loading', step: 'new-step', can_load: false });
    renderPage();

    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText(/new-step/)).not.toBeInTheDocument();
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

  it('says when and by whom the sample data was loaded', async () => {
    (apiClient.get as any).mockResolvedValue({
      ...BASE, status: 'loaded', can_load: false, loaded_at: '2026-10-07T10:00:00Z', loaded_by_name: 'Ada Admin', created_since_load: 0,
    });
    renderPage();

    expect(await screen.findByText(/^7 Oct 2026, .+ by Ada Admin$/)).toBeInTheDocument();
    expect(screen.getByText('Loaded on')).toBeInTheDocument();
  });

  it('asks for the workspace name before erasing everything, and sends it', async () => {
    (apiClient.get as any).mockResolvedValue({
      ...BASE, status: 'loaded', can_load: false, loaded_at: '2026-10-07T10:00:00Z', loaded_by_name: 'Ada Admin', created_since_load: 3,
      workspace_name: 'Fromage  <strong>{{x}}</strong> & Co',
    });
    (apiClient.post as any).mockResolvedValue({ ...BASE, status: 'resetting' });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Erase everything and start over' }));
    // The overview is read again when the dialog opens: the count is today's.
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));

    const dialog = await screen.findByRole('dialog');
    const warning = within(dialog).getByRole('alert');
    expect(warning).toHaveTextContent(/with no way back/);
    expect(warning.querySelector('svg')).not.toBeNull();
    // The name is shown as typed, never interpreted.
    expect(within(dialog).getByText((_content, element) => element?.tagName === 'SPAN'
      && element.textContent === 'Fromage  <strong>{{x}}</strong> & Co')).toBeInTheDocument();
    expect(within(dialog).getByText('Real user accounts and their roles')).toBeInTheDocument();
    expect(within(dialog).getByText('The audit log')).toBeInTheDocument();
    expect(within(dialog).getByText(/currencies, budget columns, classification catalog/)).toBeInTheDocument();
    expect(within(dialog).getByText('3 items created since the sample data was loaded will also be erased.')).toBeInTheDocument();
    expect(within(dialog).getByText(/receive an email once the content/)).toBeInTheDocument();

    const erase = within(dialog).getByRole('button', { name: 'Erase everything' });
    const field = within(dialog).getByRole('textbox', { name: 'Workspace name' });
    expect(erase).toBeDisabled();
    fireEvent.change(field, { target: { value: 'Fromage' } });
    expect(erase).toBeDisabled();
    fireEvent.click(erase);
    expect(apiClient.post).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: '  fromage <strong>{{x}}</strong>   & CO ' } });
    expect(erase).toBeEnabled();
    fireEvent.click(erase);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/admin/sample-data/reset', { confirm_name: '  fromage <strong>{{x}}</strong>   & CO ' },
    ));
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

  it('follows a reset and refreshes every other cached query and the profile once it ends', async () => {
    (apiClient.get as any)
      .mockResolvedValueOnce({ ...BASE, status: 'resetting', can_load: false })
      .mockResolvedValue(BASE);
    const client = renderPage();
    client.setQueryData(['other-page'], { stale: true });
    const reset = vi.spyOn(client, 'resetQueries');

    expect(await screen.findByText(/Erasing the content of the workspace/)).toBeInTheDocument();
    await client.refetchQueries({ queryKey: ['sample-data'] });
    expect(await screen.findByText('Not loaded')).toBeInTheDocument();
    await waitFor(() => expect(reset).toHaveBeenCalled());
    expect(env.refreshMe).toHaveBeenCalled();
    expect(client.getQueryData(['other-page'])).toBeUndefined();
    // The sample data answer is kept while it is read again (the strip does not flicker): only
    // the other queries are reset.
    const [filters] = reset.mock.calls[0] as [{ predicate?: (query: { queryKey: unknown[] }) => boolean } | undefined];
    expect(filters?.predicate?.({ queryKey: ['sample-data', 'page'] })).toBe(false);
    expect(filters?.predicate?.({ queryKey: ['other-page'] })).toBe(true);
    expect(client.getQueryData(['sample-data', 'page'])).toBeDefined();
  });

  it('says a failed reset changed nothing, and refreshes nothing', async () => {
    (apiClient.get as any)
      .mockResolvedValueOnce({ ...BASE, status: 'resetting', can_load: false })
      .mockResolvedValue({ ...BASE, status: 'loaded', can_load: false, loaded_at: '2026-10-07T10:00:00Z', reset_failed_at: '2026-10-07T11:00:00Z' });
    const client = renderPage();
    const reset = vi.spyOn(client, 'resetQueries');

    expect(await screen.findByText(/Erasing the content of the workspace/)).toBeInTheDocument();
    await client.refetchQueries({ queryKey: ['sample-data'] });
    expect(await screen.findByText('The content of the workspace could not be erased. Nothing was changed.')).toBeInTheDocument();
    expect(reset).not.toHaveBeenCalled();
    expect(env.refreshMe).not.toHaveBeenCalled();
  });

  it('reads the state again when the server answers 409, and translates a rate limit', async () => {
    (apiClient.get as any).mockResolvedValue(BASE);
    (apiClient.post as any)
      .mockRejectedValueOnce({ response: { status: 409, data: { code: 'demo_status_conflict', message: 'raw' } } })
      .mockRejectedValueOnce({ response: { status: 429, data: { statusCode: 429, message: 'ThrottlerException: Too Many Requests' } } });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Load sample data' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Load sample data' }));
    expect(await within(dialog).findByText(/status changed in the meantime/)).toBeInTheDocument();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Load sample data' }));
    expect(await within(dialog).findByText('Too many attempts. Wait a few minutes and try again.')).toBeInTheDocument();
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
