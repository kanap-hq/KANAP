import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import AdminTrialsPage from './AdminTrialsPage';
import api from '../../api';

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

let platformAdmin = true;
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ claims: { isPlatformAdmin: platformAdmin } }),
}));

vi.mock('../../components/PageHeader', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('../ForbiddenPage', () => ({
  default: () => <div>forbidden</div>,
}));

function row(overrides: Record<string, unknown>) {
  return {
    signup_id: 'signup-1',
    tenant_id: 'tenant-1',
    slug: 'acme',
    name: 'Acme',
    contact_name: 'Ada Lovelace',
    state: 'trialing',
    needs_attention: false,
    created_at: '2026-10-20T09:00:00.000Z',
    activated_at: '2026-10-20T09:01:00.000Z',
    first_sign_in_at: '2026-10-20T09:05:00.000Z',
    last_sign_in_at: '2026-10-28T14:30:00.000Z',
    angle: 'budget',
    mode: 'example',
    steps_done: 3,
    steps_total: 5,
    sample_data_loaded_at: '2026-10-20T09:10:00.000Z',
    first_record_at: '2026-10-21T10:00:00.000Z',
    first_plaid_question_at: null,
    first_import_at: null,
    first_invitation_at: null,
    back_after_1_day_at: '2026-10-21T10:00:00.000Z',
    back_after_7_days_at: null,
    trial_end: '2026-11-19T09:01:00.000Z',
    converted_at: null,
    discovery_call_first_click: { at: '2026-10-22T08:00:00.000Z', placement: 'last_step' },
    discovery_call: null,
    ...overrides,
  };
}

const silent = row({
  signup_id: 'signup-2',
  tenant_id: 'tenant-2',
  slug: 'quiet',
  name: 'Quiet corp',
  contact_name: null,
  needs_attention: true,
  first_sign_in_at: null,
  last_sign_in_at: null,
  angle: null,
  mode: null,
  steps_done: null,
  steps_total: null,
  sample_data_loaded_at: null,
  first_record_at: null,
  back_after_1_day_at: null,
  discovery_call_first_click: null,
});

const funnel = {
  items: [silent, row({})],
  attention: 1,
  weeks: [
    { week: '2026-10-19', created: 2, activated: 2, signed_in: 1, converted: 0 },
    { week: '2026-10-12', created: 0, activated: 0, signed_in: 0, converted: 0 },
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <AdminTrialsPage />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('AdminTrialsPage', () => {
  beforeEach(() => {
    platformAdmin = true;
    vi.mocked(api.get).mockReset().mockResolvedValue({ data: funnel });
    vi.mocked(api.put).mockReset().mockResolvedValue({ data: {} });
    vi.mocked(api.delete).mockReset().mockResolvedValue({ data: null });
  });

  it('lists the trials, the workspaces without a sign-in first, with the weekly counts', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Trials' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Quiet corp');
    expect(rows[1]).toHaveTextContent('No sign-in after 24 h');
    expect(rows[2]).toHaveTextContent('Acme');
    expect(rows[2]).toHaveTextContent('acme · Ada Lovelace');
    expect(rows[2]).toHaveTextContent('In trial');
    expect(rows[2]).toHaveTextContent('IT budget · example');
    expect(rows[2]).toHaveTextContent('3/5');
    expect(screen.getByText('1 workspace without a sign-in 24 hours after activation')).toBeInTheDocument();

    const weeks = screen.getByRole('table', { name: 'Sign-ups by week' });
    const signups = within(weeks).getByText('Sign-ups').closest('tr')!;
    expect(signups).toHaveTextContent(/Sign-ups\s*02/);
    expect(api.get).toHaveBeenCalledWith('/admin/trials', { params: {} });
  });

  it('filters on the state', async () => {
    renderPage();
    await screen.findByRole('table', { name: 'Trials' });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'State' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Converted' }));
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/admin/trials', { params: { state: 'converted' } }));
  });

  it('sets the discovery call by hand', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Discovery call of Acme' }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Note' }), { target: { value: 'Teams' } });
    expect(within(dialog).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('removes a call set before', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        ...funnel,
        items: [row({ discovery_call: { scheduled_at: '2026-11-05T09:00:00.000Z', status: 'booked', source: 'manual', note: null, external_id: null, updated_at: '2026-11-01T09:00:00.000Z' } })],
      },
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Discovery call of Acme' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Note' }), { target: { value: ' Teams ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/admin/trials/tenant-1/discovery-call', {
      scheduled_at: '2026-11-05T09:00:00.000Z',
      status: 'booked',
      note: 'Teams',
    }));

    fireEvent.click(await screen.findByRole('button', { name: 'Discovery call of Acme' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/admin/trials/tenant-1/discovery-call'));
  });

  it('refuses a person who is not a platform administrator', () => {
    platformAdmin = false;
    renderPage();
    expect(screen.getByText('forbidden')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});
