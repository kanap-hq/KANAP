import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PlanSelectionDialog from './PlanSelectionPage';
import api from '../../api';
import enAdmin from '../../locales/en/admin.json';

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
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
  subscription: { status: 'trialing', trial_days_remaining: 10, stripe_subscription_id: null, is_subscription_healthy: true } as any,
  claims: { isBillingAdmin: true },
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => authState,
}));

const PLANS = [
  {
    plan_key: 'max',
    display_name: 'Hosted KANAP',
    invoice_eligible: true,
    payment_options: {
      monthly: { card: true, bank_transfer: false },
      annual: { card: true, bank_transfer: true },
    },
    prices: { monthly: 24900, annual: 249000 },
  },
];

function renderDialog(props: Partial<React.ComponentProps<typeof PlanSelectionDialog>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PlanSelectionDialog open onClose={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

async function switchToAnnual() {
  fireEvent.click(await screen.findByRole('button', { name: 'Annual' }));
}

describe('PlanSelectionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as any).mockResolvedValue({ data: PLANS });
  });

  it('lists the missing invoice fields and disables both pay buttons', async () => {
    const onComplete = vi.fn();
    renderDialog({ invoiceMissingFields: ['email', 'addressLine1', 'vatNumber'], onCompleteInvoiceDetails: onComplete });
    await switchToAnnual();

    expect(
      screen.getByText('Complete the invoicing information before subscribing: email, address line 1, VAT number.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay by card' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pay by bank transfer' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Complete invoicing information' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('enables both pay buttons when the invoice details are complete', async () => {
    renderDialog({ invoiceMissingFields: [] });
    await switchToAnnual();

    expect(screen.queryByText(/before subscribing/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay by card' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Pay by bank transfer' })).toBeEnabled();
  });

  it('shows the API refusal in plain words, without the raw code', async () => {
    (api.post as any).mockRejectedValue({
      response: { data: { message: 'BILLING_PROFILE_INCOMPLETE', missing: ['company', 'country'] } },
    });
    renderDialog({ invoiceMissingFields: [] });
    fireEvent.click(await screen.findByRole('button', { name: 'Pay by card' }));

    expect(
      await screen.findByText('Complete the invoicing information before subscribing: company, country.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('BILLING_PROFILE_INCOMPLETE')).not.toBeInTheDocument();
  });

  it('clears the error of a refused attempt when the dialog opens again', async () => {
    (api.post as any).mockRejectedValue({ response: { data: { message: 'VAT_NUMBER_INVALID' } } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (open: boolean) => (
      <QueryClientProvider client={client}>
        <PlanSelectionDialog open={open} onClose={vi.fn()} invoiceMissingFields={[]} />
      </QueryClientProvider>
    );
    const { rerender } = render(view(true));
    fireEvent.click(await screen.findByRole('button', { name: 'Pay by card' }));
    const refusal = 'The VAT number was not accepted. Check it in the invoicing information.';
    expect(await screen.findByText(refusal)).toBeInTheDocument();

    rerender(view(false));
    rerender(view(true));
    expect(await screen.findByRole('button', { name: 'Pay by card' })).toBeEnabled();
    expect(screen.queryByText(refusal)).not.toBeInTheDocument();
    expect(document.querySelector('.MuiAlert-standardError')).toBeNull();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('explains a refused VAT number', async () => {
    (api.post as any).mockRejectedValue({ response: { data: { message: 'VAT_NUMBER_INVALID' } } });
    renderDialog({ invoiceMissingFields: [] });
    await switchToAnnual();
    fireEvent.click(screen.getByRole('button', { name: 'Pay by bank transfer' }));

    expect(
      await screen.findByText('The VAT number was not accepted. Check it in the invoicing information.'),
    ).toBeInTheDocument();
  });
});
