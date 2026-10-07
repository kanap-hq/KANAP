import React from 'react';
import '../../../i18n';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SampleDataBanner from './SampleDataBanner';
import { createAppTheme } from '../../../config/ThemeContext';
import { api as apiClient } from '../../../api/client';

vi.mock('../../../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const env = vi.hoisted(() => ({
  isGlobalAdmin: true,
  isPlatformHost: false,
  deploymentMode: 'multi-tenant' as 'multi-tenant' | 'single-tenant',
  sampleData: true as boolean | undefined,
}));
const refreshMe = vi.hoisted(() => async () => undefined);

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ claims: { isGlobalAdmin: env.isGlobalAdmin }, refreshMe }),
}));
vi.mock('../../../tenant/TenantContext', () => ({
  useTenant: () => ({ isPlatformHost: env.isPlatformHost }),
}));
vi.mock('../../../config/FeaturesContext', () => ({
  useFeatures: () => ({
    config: { deploymentMode: env.deploymentMode, features: { sampleData: env.sampleData } },
    isLoading: false,
  }),
}));

const EMPTY = {
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

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <div data-testid="home"><SampleDataBanner /></div>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const TEXT = 'Discover KANAP with sample data.';

describe('SampleDataBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.isGlobalAdmin = true;
    env.isPlatformHost = false;
    env.deploymentMode = 'multi-tenant';
    env.sampleData = true;
  });

  it('shows one line to an administrator of an empty workspace, and loads through the same dialog', async () => {
    (apiClient.get as any).mockResolvedValue(EMPTY);
    (apiClient.post as any).mockResolvedValue({ ...EMPTY, status: 'loading' });
    renderBanner();

    // The light answer of the banner.
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/admin/sample-data', { params: { view: 'banner' } }));
    const text = await screen.findByRole('status');
    expect(text).toHaveTextContent(TEXT);
    expect(within(text).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Fromage & Co, a fictional cheese maker/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Load sample data' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/admin/sample-data/load'));
  });

  it('hides itself for good with "Hide"', async () => {
    const dismissed = { ...EMPTY, dismissed_at: '2026-10-07T10:00:00Z' };
    (apiClient.get as any).mockResolvedValueOnce(EMPTY).mockResolvedValue(dismissed);
    (apiClient.post as any).mockResolvedValue(dismissed);
    renderBanner();

    fireEvent.click(await screen.findByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/admin/sample-data/dismiss'));
    // Only the text is announced, not the buttons.

    await waitFor(() => expect(screen.queryByText(TEXT)).not.toBeInTheDocument());
  });

  it('follows a running load on the same line', async () => {
    (apiClient.get as any).mockResolvedValue({ ...EMPTY, status: 'loading', step: 'landscape', can_load: false });
    renderBanner();

    expect(await screen.findByText(/Loading sample data\. Step 15 of 19: instances, interfaces and connections\./)).toBeInTheDocument();
    expect(screen.getByText(/erased if the load fails/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hide' })).not.toBeInTheDocument();
  });

  it('gives the reason of a failed load and offers to try again', async () => {
    (apiClient.get as any).mockResolvedValue({ ...EMPTY, status: 'failed', error_code: 'load_timeout' });
    (apiClient.post as any).mockResolvedValue({ ...EMPTY, status: 'loading' });
    renderBanner();

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Loading took too long and was stopped. The workspace was put back in its starting state.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Load sample data' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/admin/sample-data/load'));
  });

  it('stops asking after a refusal that will not change', async () => {
    (apiClient.get as any).mockRejectedValue({ response: { status: 403, data: { code: 'administrator_required' } } });
    renderBanner();

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('home')).toBeEmptyDOMElement();
  });

  it.each([
    ['hidden before', { dismissed_at: '2026-10-07T10:00:00Z' }],
    ['a workspace that holds data', { can_load: false, load_refusal: 'tenant_not_empty' }],
    ['a frozen subscription', { can_load: false, load_refusal: 'SUBSCRIPTION_FROZEN' }],
    ['loaded sample data', { status: 'loaded', can_load: false, ever_loaded_at: '2026-10-07T10:00:00Z' }],
    ['a workspace reset after a load', { ever_loaded_at: '2026-10-07T10:00:00Z' }],
    ['a load started again after a reset', { status: 'loading', can_load: false, ever_loaded_at: '2026-10-07T10:00:00Z' }],
  ])('shows nothing for %s', async (_label, overrides) => {
    (apiClient.get as any).mockResolvedValue({ ...EMPTY, ...overrides });
    renderBanner();

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/admin/sample-data', { params: { view: 'banner' } }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId('home')).toBeEmptyDOMElement();
  });

  it.each([
    ['a user without the Administrator role', () => { env.isGlobalAdmin = false; }],
    ['the platform host', () => { env.isPlatformHost = true; }],
    ['an on-premise installation', () => { env.deploymentMode = 'single-tenant'; }],
    ['a server that does not announce the feature', () => { env.sampleData = undefined; }],
  ])('shows nothing to %s and reads nothing', async (_label, arrange) => {
    arrange();
    (apiClient.get as any).mockResolvedValue(EMPTY);
    renderBanner();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId('home')).toBeEmptyDOMElement();
    expect(apiClient.get).not.toHaveBeenCalled();
  });
});
