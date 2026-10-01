import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import AdminTenantsPage from './AdminTenantsPage';
import api from '../../api';

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ claims: { isPlatformAdmin: true } }),
}));

vi.mock('../../components/PageHeader', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

const TENANT_ID = 'tenant-1';

function tenant(plan: Record<string, unknown>) {
  return {
    id: TENANT_ID,
    slug: 'demo',
    name: 'Demo company',
    status: 'active',
    is_system_tenant: false,
    created_at: '2026-09-01T10:00:00.000Z',
    updated_at: '2026-09-20T10:00:00.000Z',
    stats: {
      companies: 1, headcount: 10, departments: 2, suppliers: 3, opexEntries: 4, capexEntries: 5,
      users: { total: 2, enabled: 2 },
    },
    plan: {
      plan_name: 'Trial',
      seat_limit: null,
      seats_used: 2,
      active_seats: 0,
      subscription_type: 'monthly',
      payment_mode: 'card',
      next_payment_at: null,
      status: 'trialing',
      trial_end: '2026-09-15T08:30:00.000Z',
      stripe_subscription_id: null,
      ...plan,
    },
  };
}

const expiredTrial = tenant({});
const internal = tenant({
  plan_name: 'Internal',
  status: 'active',
  trial_end: null,
  payment_mode: 'bank_transfer',
});

let current: ReturnType<typeof tenant>;

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <AdminTenantsPage />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return { invalidate };
}

async function openDetail() {
  fireEvent.click(await screen.findByRole('button', { name: 'View' }));
  await screen.findByText('Tenant detail');
  await screen.findByRole('button', { name: 'Save plan' });
}

describe('AdminTenantsPage internal tenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    current = expiredTrial;
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/admin/tenants') return Promise.resolve({ data: { items: [current], total: 1, page: 1, limit: 10 } });
      if (url === `/admin/tenants/${TENANT_ID}`) return Promise.resolve({ data: current });
      throw new Error(`Unexpected GET ${url}`);
    });
  });

  it('marks the tenant as internal after confirmation and refreshes it', async () => {
    (api.post as any).mockImplementation((url: string) => {
      current = internal;
      return Promise.resolve({ data: internal, url });
    });
    const { invalidate } = renderPage();
    await openDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Mark as internal tenant' }));
    const title = await screen.findByText('Mark as internal tenant?');
    const confirm = within(title.closest('[role="dialog"]') as HTMLElement);
    expect(confirm.getByText(/Nothing is sent to Stripe/)).toBeInTheDocument();
    fireEvent.click(confirm.getByRole('button', { name: 'Mark as internal' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`/admin/tenants/${TENANT_ID}/mark-internal`));
    expect(await screen.findByText('Tenant marked as internal.')).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin-tenants'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin-tenant', TENANT_ID] });
    expect(await screen.findByText('This tenant is already internal.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as internal tenant' })).not.toBeInTheDocument();
  });

  it('does not call the API when the confirmation is cancelled', async () => {
    renderPage();
    await openDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Mark as internal tenant' }));
    const title = await screen.findByText('Mark as internal tenant?');
    fireEvent.click(within(title.closest('[role="dialog"]') as HTMLElement).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByText('Mark as internal tenant?')).not.toBeInTheDocument());
    expect(api.post).not.toHaveBeenCalled();
  });

  it('offers no action on a tenant that is already internal', async () => {
    current = internal;
    renderPage();
    await openDetail();
    expect(await screen.findByText('This tenant is already internal.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as internal tenant' })).not.toBeInTheDocument();
  });

  it('hides the action on a tenant with a Stripe subscription', async () => {
    current = tenant({ plan_name: 'Hosted KANAP', status: 'active', stripe_subscription_id: 'sub_123' });
    renderPage();
    await openDetail();
    expect(await screen.findByText('This tenant has a Stripe subscription, so it cannot become internal.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as internal tenant' })).not.toBeInTheDocument();
  });

  it('keeps unlimited seats and leaves status and trial end alone when they are not edited', async () => {
    (api.patch as any).mockResolvedValue({ data: expiredTrial });
    renderPage();
    await openDetail();

    expect(screen.getByLabelText('Subscription status')).toHaveTextContent('Trial');
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    const [url, payload] = (api.patch as any).mock.calls[0];
    expect(url).toBe(`/admin/tenants/${TENANT_ID}/plan`);
    expect(payload.seat_limit).toBeNull();
    expect(payload).not.toHaveProperty('status');
    expect(payload).not.toHaveProperty('trial_end');
  });

  it('sends the edited status', async () => {
    (api.patch as any).mockResolvedValue({ data: expiredTrial });
    renderPage();
    await openDetail();

    fireEvent.mouseDown(screen.getByLabelText('Subscription status'));
    fireEvent.click(await screen.findByRole('option', { name: 'Active' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    const [, payload] = (api.patch as any).mock.calls[0];
    expect(payload.status).toBe('active');
    expect(payload).not.toHaveProperty('trial_end');
  });
});
