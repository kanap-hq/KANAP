import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BillingCenter from './BillingCenter';
import api from '../../api';
import enAdmin from '../../locales/en/admin.json';

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

// English strings from the admin namespace, with {{name}} interpolation. One stable
// `t` for every render, so effects that depend on it do not loop.
const translation = vi.hoisted(() => ({ t: null as unknown as (key: string, options?: Record<string, unknown>) => string }));
translation.t = (key: string, options?: Record<string, unknown>) => {
  const path = key.replace(/^admin:/, '');
  const value = path.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    enAdmin,
  );
  const template = typeof value === 'string' ? value : String(options?.defaultValue ?? key);
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translation.t,
    i18n: { language: 'en', resolvedLanguage: 'en' },
    ready: true,
  }),
}));

vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));

const authState = vi.hoisted(() => ({
  subscription: null as any,
  claims: { isBillingAdmin: true },
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => authState,
}));

const EMPTY_CONTACT = {
  name: null,
  company: null,
  email: null,
  phone: null,
  vatNumber: null,
  address: { line1: null, line2: null, city: null, state: null, postalCode: null, country: null },
};

function renderPage(
  subscription: Record<string, unknown>,
  profile: { invoice?: Record<string, unknown>; invoice_missing_fields?: string[] } = {},
) {
  authState.subscription = subscription;
  (api.get as any).mockImplementation(async (url: string) => {
    if (url === '/billing/profile') {
      return {
        data: {
          subscription,
          customer: EMPTY_CONTACT,
          invoice: profile.invoice ?? EMPTY_CONTACT,
          invoice_missing_fields: profile.invoice_missing_fields ?? [],
          invoices: [],
        },
      };
    }
    return { data: [] };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/admin/billing']}>
      <QueryClientProvider client={client}>
        <BillingCenter />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('BillingCenter subscription card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows no plan, amount or payment details for an expired tenant', async () => {
    // A tenant created before the single plan, whose trial ended without a subscription:
    // the stored plan name and the estimate are leftovers.
    renderPage({
      plan_name: 'Starter',
      status: null,
      trial_end: '2026-01-15T00:00:00.000Z',
      stripe_subscription_id: null,
      subscription_type: 'monthly',
      amount: null,
      estimated_amount: 4990,
      estimated_currency: 'EUR',
      seat_limit: null,
      seats_used: 3,
      is_subscription_healthy: false,
    });
    expect(await screen.findByText('Plan')).toBeInTheDocument();
    expect(screen.queryByText('Starter')).not.toBeInTheDocument();
    expect(screen.queryByText('Amount per period')).not.toBeInTheDocument();
    expect(screen.queryByText(/49[.,]90/)).not.toBeInTheDocument();
    expect(screen.queryByText('Billing frequency')).not.toBeInTheDocument();
    expect(screen.queryByText('Collection method')).not.toBeInTheDocument();
    expect(screen.queryByText('Payment method')).not.toBeInTheDocument();
    expect(screen.queryByText('Last stripe sync')).not.toBeInTheDocument();
    expect(screen.getByText('Trial ends')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose plan' })).toBeInTheDocument();
  });

  it('hides the stored plan and amount once the subscription has ended', async () => {
    renderPage({
      plan_name: 'Starter',
      status: 'canceled',
      trial_end: '2026-01-15T00:00:00.000Z',
      stripe_subscription_id: 'sub_old',
      subscription_type: 'monthly',
      amount: null,
      estimated_amount: 4990,
      estimated_currency: 'EUR',
      seat_limit: null,
      seats_used: 3,
      is_subscription_healthy: false,
    });
    expect(await screen.findByText('Plan')).toBeInTheDocument();
    expect(screen.queryByText('Starter')).not.toBeInTheDocument();
    expect(screen.queryByText('Amount per period')).not.toBeInTheDocument();
    expect(screen.queryByText('Billing frequency')).not.toBeInTheDocument();
    expect(screen.queryByText('Collection method')).not.toBeInTheDocument();
    expect(screen.queryByText('Payment method')).not.toBeInTheDocument();
    expect(screen.queryByText('Last stripe sync')).not.toBeInTheDocument();
    expect(screen.queryByText(/49[.,]90/)).not.toBeInTheDocument();
    expect(screen.getByText('Trial ends')).toBeInTheDocument();
  });

  it('hides the stored plan and amount for a tenant that never subscribed', async () => {
    renderPage({
      plan_name: 'Starter',
      status: 'past_due',
      stripe_subscription_id: null,
      subscription_type: 'monthly',
      amount: null,
      estimated_amount: 4990,
      estimated_currency: 'EUR',
      seat_limit: null,
      seats_used: 3,
      is_subscription_healthy: false,
    });
    expect(await screen.findByText('Plan')).toBeInTheDocument();
    expect(screen.queryByText('Starter')).not.toBeInTheDocument();
    expect(screen.queryByText('Amount per period')).not.toBeInTheDocument();
    expect(screen.queryByText('Payment method')).not.toBeInTheDocument();
    expect(screen.queryByText('Renewal date')).not.toBeInTheDocument();
  });

  it('shows the plan, amount and payment details of a live subscription', async () => {
    renderPage({
      plan_name: 'Hosted KANAP',
      status: 'active',
      stripe_subscription_id: 'sub_1',
      subscription_type: 'monthly',
      collection_method: 'charge_automatically',
      payment_mode: 'card',
      amount: 24900,
      currency: 'EUR',
      renewal_at: '2026-11-07T00:00:00.000Z',
      last_synced_at: '2026-10-07T10:00:00.000Z',
      seat_limit: null,
      seats_used: 3,
      is_subscription_healthy: true,
    });
    expect(await screen.findByText('Hosted KANAP')).toBeInTheDocument();
    expect(screen.getByText('Amount per period')).toBeInTheDocument();
    expect(screen.getByText(/249\.00/)).toBeInTheDocument();
    expect(screen.getByText('Billing frequency')).toBeInTheDocument();
    expect(screen.getByText('Payment method')).toBeInTheDocument();
    expect(screen.getByText('Renewal date')).toBeInTheDocument();
  });
});

describe('BillingCenter invoice VAT number', () => {
  const LOCAL_TRIAL = { status: 'trialing', stripe_subscription_id: null, seat_limit: null, seats_used: 1 };
  const FRENCH_INVOICE = {
    ...EMPTY_CONTACT,
    company: 'Fromage SAS',
    email: 'billing@fromage-co.com',
    address: { ...EMPTY_CONTACT.address, line1: '1 rue de la Paix', postalCode: '75002', city: 'Paris', country: 'FR' },
  };
  const FORMAT_HELP = 'Check the format of this VAT number.';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flags a saved VAT number the server does not accept', async () => {
    renderPage(LOCAL_TRIAL, {
      invoice: { ...FRENCH_INVOICE, vatNumber: 'FR12345' },
      invoice_missing_fields: ['vatNumber'],
    });
    expect(await screen.findByText(FORMAT_HELP)).toBeInTheDocument();
    const field = document.querySelector('input[data-invoice-field="vatNumber"]') as HTMLInputElement;
    expect(field.value).toBe('FR12345');
    expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not flag an empty VAT number', async () => {
    renderPage(LOCAL_TRIAL, {
      invoice: { ...FRENCH_INVOICE, vatNumber: null },
      invoice_missing_fields: ['vatNumber'],
    });
    expect(await screen.findByDisplayValue('Fromage SAS')).toBeInTheDocument();
    expect(screen.queryByText(FORMAT_HELP)).not.toBeInTheDocument();
  });

  it('does not flag a valid VAT number', async () => {
    renderPage(LOCAL_TRIAL, {
      invoice: { ...FRENCH_INVOICE, vatNumber: 'FR12345678901' },
      invoice_missing_fields: [],
    });
    expect(await screen.findByDisplayValue('FR12345678901')).toBeInTheDocument();
    expect(screen.queryByText(FORMAT_HELP)).not.toBeInTheDocument();
  });
});
