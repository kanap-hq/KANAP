import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PlanSelectionDialog from './PlanSelectionPage';
import api from '../../api';
import enAdmin from '../../locales/en/admin.json';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

// English strings from the admin namespace, with {{name}} interpolation and _one/_other
// plurals. One stable `t` for every render, so effects that depend on it do not loop.
const translation = vi.hoisted(() => ({ t: null as unknown as (key: string, options?: Record<string, unknown>) => string }));
const lookup = (path: string) => path.split('.').reduce<unknown>(
  (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
  enAdmin,
);
translation.t = (key: string, options?: Record<string, unknown>) => {
  const path = key.replace(/^admin:/, '');
  const count = options?.count;
  const value = typeof count === 'number'
    ? lookup(`${path}_${count === 1 ? 'one' : 'other'}`) ?? lookup(path)
    : lookup(path);
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

const localeState = vi.hoisted(() => ({ value: 'en' }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => localeState.value }));

const TRIAL = { status: 'trialing', trial_days_remaining: 10, stripe_subscription_id: null, is_subscription_healthy: true };
const authState = vi.hoisted(() => ({
  subscription: null as any,
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
    terms: { version: '2026-10-12', urls: { fr: 'https://kanap.net/fr/sales', en: 'https://kanap.net/sales' } },
  },
];

const TERMS = 'I accept the general terms of sale';

const theme = createAppTheme('light');

function renderDialog(props: Partial<React.ComponentProps<typeof PlanSelectionDialog>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={client}>
        <PlanSelectionDialog open onClose={vi.fn()} {...props} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

// The footer buttons exist before the plan loads (disabled): wait for the plan first.
async function planLoaded() {
  await screen.findByText('Hosted KANAP');
}

async function switchToAnnual() {
  await planLoaded();
  fireEvent.click(screen.getByRole('button', { name: 'Annual' }));
}

function acceptTerms() {
  fireEvent.click(screen.getByRole('checkbox', { name: TERMS }));
}

describe('PlanSelectionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as any).mockResolvedValue({ data: PLANS });
    authState.subscription = { ...TRIAL };
    localeState.value = 'en';
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
    acceptTerms();

    expect(screen.queryByText(/before subscribing/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay by card' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Pay by bank transfer' })).toBeEnabled();
  });

  it('shows the API refusal in plain words, without the raw code', async () => {
    (api.post as any).mockRejectedValue({
      response: { data: { message: 'BILLING_PROFILE_INCOMPLETE', missing: ['company', 'country'] } },
    });
    renderDialog({ invoiceMissingFields: [] });
    await planLoaded();
    acceptTerms();
    fireEvent.click(screen.getByRole('button', { name: 'Pay by card' }));

    expect(
      await screen.findByText('Complete the invoicing information before subscribing: company, country.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('BILLING_PROFILE_INCOMPLETE')).not.toBeInTheDocument();
  });

  it('clears the error of a refused attempt when the dialog opens again', async () => {
    (api.post as any).mockRejectedValue({ response: { data: { message: 'VAT_NUMBER_INVALID' } } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (open: boolean) => (
      <ThemeProvider theme={theme}>
        <QueryClientProvider client={client}>
          <PlanSelectionDialog open={open} onClose={vi.fn()} invoiceMissingFields={[]} />
        </QueryClientProvider>
      </ThemeProvider>
    );
    const { rerender } = render(view(true));
    await planLoaded();
    acceptTerms();
    fireEvent.click(screen.getByRole('button', { name: 'Pay by card' }));
    const refusal = 'The VAT number was not accepted. Check it in the invoicing information.';
    expect(await screen.findByText(refusal)).toBeInTheDocument();

    rerender(view(false));
    rerender(view(true));
    await planLoaded();
    // The terms are accepted again on each opening.
    expect(screen.getByRole('checkbox', { name: TERMS })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Pay by card' })).toBeDisabled();
    acceptTerms();
    expect(screen.getByRole('button', { name: 'Pay by card' })).toBeEnabled();
    expect(screen.queryByText(refusal)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('explains a refused VAT number', async () => {
    (api.post as any).mockRejectedValue({ response: { data: { message: 'VAT_NUMBER_INVALID' } } });
    renderDialog({ invoiceMissingFields: [] });
    await switchToAnnual();
    acceptTerms();
    fireEvent.click(screen.getByRole('button', { name: 'Pay by bank transfer' }));

    expect(
      await screen.findByText('The VAT number was not accepted. Check it in the invoicing information.'),
    ).toBeInTheDocument();
  });

  it('offers bank transfer only for an interval that allows it', async () => {
    renderDialog({ invoiceMissingFields: [] });
    await planLoaded();
    acceptTerms();

    expect(screen.getByRole('button', { name: 'Pay by card' })).toBeEnabled();
    expect(screen.getByText('€249.00')).toBeInTheDocument();
    expect(screen.getByText('per month')).toBeInTheDocument();
    expect(screen.getByText('2 months free')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pay by bank transfer' })).not.toBeInTheDocument();

    await switchToAnnual();
    expect(screen.getByRole('button', { name: 'Annual' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('€2,490.00')).toBeInTheDocument();
    expect(screen.getByText('per year')).toBeInTheDocument();
    expect(screen.getByText('€207.50 per month, billed annually')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay by bank transfer' })).toBeEnabled();
  });

  it('keeps both pay buttons disabled until the general terms of sale are accepted', async () => {
    renderDialog({ invoiceMissingFields: [] });
    await switchToAnnual();

    expect(screen.getByRole('checkbox', { name: TERMS })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Pay by card' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pay by bank transfer' })).toBeDisabled();

    acceptTerms();
    expect(screen.getByRole('button', { name: 'Pay by card' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Pay by bank transfer' })).toBeEnabled();
  });

  it('sends the accepted terms version with the card and the bank transfer requests', async () => {
    (api.post as any).mockResolvedValue({ data: {} });
    renderDialog({ invoiceMissingFields: [] });
    await switchToAnnual();
    acceptTerms();

    fireEvent.click(screen.getByRole('button', { name: 'Pay by card' }));
    expect(await screen.findByText('Checkout URL is unavailable.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pay by bank transfer' }));
    expect(await screen.findByText('Invoice created.')).toBeInTheDocument();

    expect(api.post).toHaveBeenCalledWith('/billing/checkout', expect.objectContaining({
      plan_key: 'max',
      interval: 'annual',
      terms_version: '2026-10-12',
    }));
    expect(api.post).toHaveBeenCalledWith('/billing/request-invoice', {
      plan_key: 'max',
      subscription_type: 'annual',
      terms_version: '2026-10-12',
    });
  });

  it('links to the terms in the reader\'s language, in a new tab', async () => {
    renderDialog();
    await planLoaded();
    const english = screen.getByRole('link', { name: 'general terms of sale' });
    expect(english).toHaveAttribute('href', 'https://kanap.net/sales');
    expect(english).toHaveAttribute('target', '_blank');
    cleanup();

    localeState.value = 'fr';
    renderDialog();
    await planLoaded();
    expect(screen.getByRole('link', { name: 'general terms of sale' })).toHaveAttribute('href', 'https://kanap.net/fr/sales');
  });

  it('explains a refusal for terms not accepted', async () => {
    (api.post as any).mockRejectedValue({ response: { data: { message: 'TERMS_NOT_ACCEPTED' } } });
    renderDialog({ invoiceMissingFields: [] });
    await planLoaded();
    acceptTerms();
    fireEvent.click(screen.getByRole('button', { name: 'Pay by card' }));

    expect(
      await screen.findByText('The general terms of sale could not be confirmed. Reload the page and accept them again.'),
    ).toBeInTheDocument();
  });

  it('shows the trial end and the days left under the title', async () => {
    const year = new Date().getFullYear();
    authState.subscription = { ...TRIAL, trial_end: `${year}-10-20`, trial_days_remaining: 14 };
    renderDialog();

    expect(await screen.findByText('Your trial ends 20 Oct · 14 days left')).toBeInTheDocument();
  });

  it('says when the trial has ended', async () => {
    authState.subscription = { ...TRIAL, trial_days_remaining: 0 };
    renderDialog();

    expect(await screen.findByText('Your trial has ended')).toBeInTheDocument();
  });

  it('shows no trial line and keeps the card plan change open for a running subscription', async () => {
    authState.subscription = {
      status: 'active',
      stripe_subscription_id: 'sub_1',
      is_subscription_healthy: true,
    };
    renderDialog({ invoiceMissingFields: ['email'] });
    await switchToAnnual();
    acceptTerms();

    expect(screen.queryByText(/trial/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change plan (card)' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Change plan (bank transfer)' })).toBeDisabled();
  });

  it('requires the terms for a plan change and sends their version', async () => {
    (api.post as any).mockResolvedValue({ data: {} });
    authState.subscription = { status: 'active', stripe_subscription_id: 'sub_1', is_subscription_healthy: true };
    renderDialog({ invoiceMissingFields: [] });
    await switchToAnnual();

    expect(screen.getByRole('button', { name: 'Change plan (card)' })).toBeDisabled();
    acceptTerms();
    fireEvent.click(screen.getByRole('button', { name: 'Change plan (card)' }));

    await vi.waitFor(() => expect(api.post).toHaveBeenCalledWith('/billing/change-plan', {
      plan_key: 'max',
      subscription_type: 'annual',
      terms_version: '2026-10-12',
    }));
  });
});
