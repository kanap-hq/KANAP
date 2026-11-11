import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BillingCenter from './BillingCenter';
import api from '../../api';
import enAdmin from '../../locales/en/admin.json';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

// English strings from the admin namespace, with {{name}} interpolation and _one/_other
// plurals. One stable `t` for every render, so effects that depend on it do not loop.
const translation = vi.hoisted(() => ({ t: null as unknown as (key: string, options?: Record<string, unknown>) => string }));
translation.t = (key: string, options?: Record<string, unknown>) => {
  const path = key.replace(/^admin:/, '');
  const lookup = (p: string) => p.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    enAdmin,
  );
  let value = lookup(path);
  if (value === undefined && typeof options?.count === 'number') {
    value = lookup(`${path}_${options.count === 1 ? 'one' : 'other'}`);
  }
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

const LOCAL_TRIAL = { status: 'trialing', stripe_subscription_id: null, seat_limit: null, seats_used: 1, is_subscription_healthy: true };

const FRENCH_INVOICE = {
  ...EMPTY_CONTACT,
  company: 'Fromage SAS',
  email: 'billing@fromage-co.com',
  address: { ...EMPTY_CONTACT.address, line1: '1 rue de la Paix', postalCode: '75002', city: 'Paris', country: 'FR' },
};

function renderPage(
  subscription: Record<string, unknown>,
  profile: { invoice?: Record<string, unknown>; invoice_missing_fields?: string[]; invoices?: unknown[] } = {},
  path = '/admin/billing',
  /** The subscription the profile carries when read, when it changes during the test. */
  currentSubscription: () => Record<string, unknown> = () => subscription,
) {
  authState.subscription = subscription;
  (api.get as any).mockImplementation(async (url: string) => {
    if (url === '/billing/profile') {
      return {
        data: {
          subscription: currentSubscription(),
          customer: EMPTY_CONTACT,
          invoice: profile.invoice ?? EMPTY_CONTACT,
          invoice_missing_fields: profile.invoice_missing_fields ?? [],
          invoices: profile.invoices ?? [],
        },
      };
    }
    return { data: [] };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter initialEntries={[path]}>
        <QueryClientProvider client={client}>
          <BillingCenter />
        </QueryClientProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

/** The PATCH answer: the saved invoicing details and what is still missing. */
function answer(invoice: Record<string, unknown>, missing: string[] = []) {
  return { data: { customer: EMPTY_CONTACT, invoice, invoice_missing_fields: missing, invoices: [] } };
}

function field(name: string): HTMLInputElement {
  return document.querySelector(`input[data-invoice-field="${name}"]`) as HTMLInputElement;
}

async function loadedField(name: string): Promise<HTMLInputElement> {
  await waitFor(() => expect(field(name)).not.toBeNull());
  return field(name);
}

function editAndBlur(input: HTMLInputElement, value: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe('BillingCenter subscription summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows only the status and the trial end for an expired tenant', async () => {
    // A tenant created before the single plan, whose trial ended without a subscription:
    // the stored plan name and the estimate are leftovers.
    renderPage({
      plan_name: 'Starter',
      status: null,
      trial_end: '2026-01-15T00:00:00.000Z',
      stripe_subscription_id: null,
      subscription_type: 'monthly',
      payment_mode: 'card',
      amount: null,
      estimated_amount: 4990,
      estimated_currency: 'EUR',
      seat_limit: null,
      seats_used: 3,
      is_subscription_healthy: false,
    });
    expect(await screen.findByText('Not subscribed')).toBeInTheDocument();
    expect(screen.getByText(/trial ended 15 Jan/)).toBeInTheDocument();
    expect(screen.queryByText(/Starter/)).not.toBeInTheDocument();
    expect(screen.queryByText(/49[.,]90/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Monthly/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Card/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Choose plan' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Manage payment' })).not.toBeInTheDocument();
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
    expect(await screen.findByText('Canceled')).toBeInTheDocument();
    expect(screen.queryByText(/Starter/)).not.toBeInTheDocument();
    expect(screen.queryByText(/49[.,]90/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Monthly/)).not.toBeInTheDocument();
    expect(screen.queryByText(/renews/)).not.toBeInTheDocument();
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
      renewal_at: '2026-11-07T00:00:00.000Z',
      seat_limit: null,
      seats_used: 3,
      is_subscription_healthy: false,
    });
    expect(await screen.findByText('Past due')).toBeInTheDocument();
    expect(screen.queryByText(/Starter/)).not.toBeInTheDocument();
    expect(screen.queryByText(/49[.,]90/)).not.toBeInTheDocument();
    expect(screen.queryByText(/renews/)).not.toBeInTheDocument();
  });

  it('shows the status, trial end and days remaining of a local trial, without a plan name', async () => {
    renderPage({
      ...LOCAL_TRIAL,
      plan_name: 'Trial',
      trial_end: '2099-03-15T00:00:00.000Z',
      trial_days_remaining: 10,
    });
    expect(await screen.findByText('Trialing')).toBeInTheDocument();
    expect(screen.getByText('· ends 15 Mar 2099')).toBeInTheDocument();
    expect(screen.getByText('· 10 days remaining')).toBeInTheDocument();
    expect(screen.queryByText(/Trial ·/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose plan' })).toBeInTheDocument();
  });

  it('shows the plan, amount and payment details of a live subscription on two lines', async () => {
    renderPage({
      plan_name: 'Hosted KANAP',
      status: 'active',
      stripe_subscription_id: 'sub_1',
      subscription_type: 'annual',
      collection_method: 'charge_automatically',
      payment_mode: 'card',
      default_payment_method_id: 'pm_1',
      default_payment_method_brand: 'visa',
      default_payment_method_last4: '4242',
      amount: 249000,
      currency: 'EUR',
      renewal_at: '2099-10-07T00:00:00.000Z',
      last_synced_at: '2026-10-07T10:00:00.000Z',
      seat_limit: null,
      seats_used: 3,
      is_subscription_healthy: true,
    });
    expect(await screen.findByText(/^Hosted KANAP · Annual · €2,490\.00 \/ year$/)).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('· renews 7 Oct 2099')).toBeInTheDocument();
    expect(screen.getByText('· Visa •••• 4242')).toBeInTheDocument();
    expect(screen.queryByText(/sync/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change plan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage payment' })).toBeInTheDocument();
  });

  const CANCELLED = {
    plan_name: 'Hosted KANAP',
    status: 'active',
    stripe_subscription_id: 'sub_1',
    subscription_type: 'annual',
    collection_method: 'charge_automatically',
    payment_mode: 'card',
    amount: 249000,
    currency: 'EUR',
    renewal_at: null,
    current_period_end: '2099-10-07T00:00:00.000Z',
    next_payment_at: '2099-10-07T00:00:00.000Z',
    payment_due_at: '2099-10-07T00:00:00.000Z',
    cancel_at: '2099-10-04T00:00:00.000Z',
    canceled_at_effective: '2099-10-04T00:00:00.000Z',
    is_subscription_healthy: true,
  };

  it('shows the end date of a cancelled subscription and opens the portal to take it back', async () => {
    (api.post as any).mockResolvedValue({ data: {} });
    renderPage(CANCELLED);
    expect(await screen.findByText('· ends 4 Oct 2099')).toBeInTheDocument();
    expect(screen.queryByText(/renews/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: "Don't cancel" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/billing/portal', expect.anything()));
  });

  it('greys the plan change while the cancellation is set, saying to undo it first', async () => {
    renderPage(CANCELLED);
    expect(await screen.findByText('· ends 4 Oct 2099')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change plan' })).toBeDisabled();
    expect(screen.getByLabelText('Your subscription ends on 4 Oct 2099: undo the cancellation before changing plan.')).toBeInTheDocument();
  });

  it('shows the end date without the action to a user who cannot manage billing', async () => {
    authState.claims = { isBillingAdmin: false };
    try {
      renderPage(CANCELLED);
      expect(await screen.findByText('· ends 4 Oct 2099')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: "Don't cancel" })).not.toBeInTheDocument();
    } finally {
      authState.claims = { isBillingAdmin: true };
    }
  });
});

describe('BillingCenter unpaid invoice', () => {
  const PENDING_PAYMENT = 'Pay the pending invoice first, then change your plan.';
  const CARD_REFUSED = {
    plan_name: 'Hosted KANAP',
    status: 'past_due',
    stripe_subscription_id: 'sub_1',
    subscription_type: 'monthly',
    collection_method: 'charge_automatically',
    payment_mode: 'card',
    default_payment_method_id: 'pm_1',
    default_payment_method_brand: 'visa',
    default_payment_method_last4: '0341',
    amount: 24900,
    currency: 'EUR',
    renewal_at: '2099-12-10T00:00:00.000Z',
    latest_invoice_status: 'open',
    latest_invoice_number: 'KAN-0041',
    latest_invoice_amount: 24900,
    latest_invoice_currency: 'eur',
    latest_invoice_created: '2099-11-10T00:00:00.000Z',
    latest_invoice_url: 'https://invoice.stripe.test/kan-0041',
    last_payment_error_code: 'insufficient_funds',
    last_payment_error_message: 'Your card has insufficient funds.',
    is_subscription_healthy: false,
    access_allowed: true,
    freeze_effective_at: '2099-11-24T00:00:00.000Z',
  };
  const TRANSFER_OVERDUE = {
    ...CARD_REFUSED,
    subscription_type: 'annual',
    collection_method: 'send_invoice',
    payment_mode: 'bank_transfer',
    default_payment_method_id: null,
    default_payment_method_brand: null,
    default_payment_method_last4: null,
    amount: 249000,
    latest_invoice_amount: 249000,
    latest_invoice_created: '2099-10-04T00:00:00.000Z',
    payment_due_at: '2099-11-03T00:00:00.000Z',
    last_payment_error_code: null,
    last_payment_error_message: null,
    freeze_effective_at: '2099-11-17T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a refused card payment with its reason and the date access becomes limited', async () => {
    renderPage(CARD_REFUSED);
    expect(await screen.findByText('Payment refused on 10 Nov 2099: insufficient funds.')).toBeInTheDocument();
    expect(screen.getByText('Access will be limited on 24 Nov 2099.')).toBeInTheDocument();
    // Stripe's English message is not shown: the reason is translated from its code.
    expect(screen.queryByText(/Your card has insufficient funds/)).not.toBeInTheDocument();
    // The plan cannot change while the invoice is unpaid, and the plan dialog does not open by itself.
    expect(screen.getByRole('button', { name: 'Change plan' })).toBeDisabled();
    expect(screen.getByLabelText(PENDING_PAYMENT)).toBeInTheDocument();
    expect(screen.queryByText('Choose a plan')).not.toBeInTheDocument();
  });

  it('names an unknown refusal reason in plain words', async () => {
    renderPage({ ...CARD_REFUSED, last_payment_error_code: 'do_not_honor' });
    expect(await screen.findByText('Payment refused on 10 Nov 2099: card declined.')).toBeInTheDocument();
  });

  it('shows an overdue bank transfer invoice with its number, amount and due date', async () => {
    renderPage(TRANSFER_OVERDUE);
    expect(await screen.findByText('Invoice KAN-0041 of €2,490.00 was due on 3 Nov 2099.')).toBeInTheDocument();
    expect(screen.getByText('Access will be limited on 17 Nov 2099.')).toBeInTheDocument();
    expect(screen.queryByText(/Payment refused/)).not.toBeInTheDocument();
  });

  it('shows since when access is limited once the workspace is frozen', async () => {
    renderPage({ ...CARD_REFUSED, access_allowed: false, freeze_effective_at: '2026-11-01T00:00:00.000Z' });
    expect(await screen.findByText('Access limited since 1 Nov 2026.')).toBeInTheDocument();
    expect(screen.getByText('Payment refused on 10 Nov 2099: insufficient funds.')).toBeInTheDocument();
    expect(screen.queryByText(/will be limited/)).not.toBeInTheDocument();
  });

  it('sends a card subscription to the portal to update the card, marked to pay on the return', async () => {
    (api.post as any).mockResolvedValue({ data: {} });
    renderPage(CARD_REFUSED);
    fireEvent.click(await screen.findByRole('button', { name: 'Update card and pay' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/billing/portal', {
      returnUrl: expect.stringMatching(/\/admin\/billing\?pay_invoice=1$/),
    }));
  });

  it('opens the invoice page of a bank transfer subscription', async () => {
    renderPage(TRANSFER_OVERDUE);
    const link = await screen.findByRole('link', { name: 'Pay invoice' });
    expect(link).toHaveAttribute('href', 'https://invoice.stripe.test/kan-0041');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.queryByRole('button', { name: 'Update card and pay' })).not.toBeInTheDocument();
  });

  /** The page opened on the return from the portal, with the answer of `POST /billing/pay-invoice`. */
  async function returnFromPortal(answer: Record<string, unknown>) {
    const { payment: _payment, ...after } = answer;
    let paid = false;
    (api.post as any).mockImplementation(async (url: string) => {
      if (url !== '/billing/pay-invoice') return { data: {} };
      paid = true;
      return { data: answer };
    });
    // Read again after the payment, the profile carries the summary the payment answered.
    renderPage(CARD_REFUSED, {}, '/admin/billing?pay_invoice=1', () => (paid ? after : CARD_REFUSED));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/billing/pay-invoice'));
  }

  it('pays the open invoice once on the return from the portal', async () => {
    await returnFromPortal({
      ...CARD_REFUSED,
      status: 'active',
      latest_invoice_status: 'paid',
      last_payment_error_code: null,
      is_subscription_healthy: true,
      freeze_effective_at: null,
      payment: { status: 'paid' },
    });
    expect(await screen.findByText('Invoice paid.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Payment refused on/)).not.toBeInTheDocument());
    expect((api.post as any).mock.calls.filter(([url]: [string]) => url === '/billing/pay-invoice')).toHaveLength(1);
  });

  it('says the new card was refused, with its reason', async () => {
    await returnFromPortal({ ...CARD_REFUSED, last_payment_error_code: 'expired_card', payment: { status: 'payment_failed' } });
    expect(await screen.findByText('Payment refused: card expired.')).toBeInTheDocument();
  });

  it('says to update the card first when it has not changed', async () => {
    await returnFromPortal({ ...CARD_REFUSED, payment: { status: 'card_unchanged' } });
    expect(await screen.findByText('The card has not changed. Update it, then pay.')).toBeInTheDocument();
  });

  it('says a payment accepted but not settled yet is being processed', async () => {
    await returnFromPortal({ ...CARD_REFUSED, payment: { status: 'processing' } });
    expect(await screen.findByText('Payment is being processed.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Payment is being processed.');
  });

  it('opens the invoice page when the bank asks to confirm the payment', async () => {
    await returnFromPortal({ ...CARD_REFUSED, payment: { status: 'requires_action' } });
    expect(await screen.findByText('Your bank asks you to confirm the payment.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open invoice' })).toHaveAttribute('href', 'https://invoice.stripe.test/kan-0041');
  });

  it('pays nothing on the return for a user who cannot manage billing', async () => {
    authState.claims = { isBillingAdmin: false };
    try {
      renderPage(CARD_REFUSED, {}, '/admin/billing?pay_invoice=1');
      expect(await screen.findByRole('button', { name: 'Update card and pay' })).toBeDisabled();
      expect(api.post).not.toHaveBeenCalled();
    } finally {
      authState.claims = { isBillingAdmin: true };
    }
  });

  it('shows nothing of the kind once the invoice is paid', async () => {
    renderPage({ ...CARD_REFUSED, status: 'active', latest_invoice_status: 'paid', is_subscription_healthy: true, freeze_effective_at: null });
    expect(await screen.findByText('Active')).toBeInTheDocument();
    expect(screen.queryByText(/Payment refused/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Access/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change plan' })).toBeEnabled();
  });
});

describe('BillingCenter planned switch', () => {
  const ANNUAL_WITH_SWITCH = {
    plan_name: 'Hosted KANAP',
    status: 'active',
    stripe_subscription_id: 'sub_1',
    subscription_type: 'annual',
    collection_method: 'charge_automatically',
    payment_mode: 'card',
    amount: 249000,
    currency: 'EUR',
    renewal_at: '2027-10-14T10:00:00.000Z',
    is_subscription_healthy: true,
    scheduled_change: { interval: 'monthly', effective_at: '2027-10-14T10:00:00.000Z' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    authState.claims = { isBillingAdmin: true };
  });

  it('shows the switch to monthly under the subscription and keeps annual on demand', async () => {
    (api.post as any).mockResolvedValue({ data: { ...ANNUAL_WITH_SWITCH, scheduled_change: null } });
    renderPage(ANNUAL_WITH_SWITCH);

    expect(await screen.findByText('Switches to monthly on 14 Oct 2027.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep annual' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/billing/scheduled-change/cancel'));
    await waitFor(() => expect(screen.queryByText('Switches to monthly on 14 Oct 2027.')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Keep annual' })).not.toBeInTheDocument();
  });

  it('shows the switch without the action to a user who cannot manage billing', async () => {
    authState.claims = { isBillingAdmin: false };
    renderPage(ANNUAL_WITH_SWITCH);
    expect(await screen.findByText('Switches to monthly on 14 Oct 2027.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep annual' })).not.toBeInTheDocument();
  });

  it('reopens the plan dialog to confirm the switch once the card is saved', async () => {
    renderPage(
      { ...ANNUAL_WITH_SWITCH, collection_method: 'send_invoice', payment_mode: 'bank_transfer', scheduled_change: null },
      { invoice: FRENCH_INVOICE },
      '/admin/billing?card_saved=monthly',
    );
    expect(await screen.findByText('Card saved. Confirm the switch.')).toBeInTheDocument();
    expect(screen.getByText('Choose a plan')).toBeInTheDocument();
  });
});

describe('BillingCenter invoicing section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has one invoicing section and no save, reset or copy buttons', async () => {
    renderPage(LOCAL_TRIAL, { invoice: FRENCH_INVOICE });
    expect(await screen.findByDisplayValue('Fromage SAS')).toBeInTheDocument();
    expect(screen.getByText('Invoicing information')).toBeInTheDocument();
    expect(screen.queryByText('Customer information')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reset/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();
  });

  it('saves only the field that changed when it loses focus', async () => {
    (api.patch as any).mockResolvedValue(answer({ ...FRENCH_INVOICE, address: { ...FRENCH_INVOICE.address, city: 'Lyon' } }));
    renderPage(LOCAL_TRIAL, { invoice: FRENCH_INVOICE });
    const company = await loadedField('company');

    // A blur without a change sends nothing.
    fireEvent.focus(company);
    fireEvent.blur(company);
    expect(api.patch).not.toHaveBeenCalled();

    editAndBlur(field('city'), '  Lyon ');
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith('/billing/profile', { invoice: { address: { city: 'Lyon' } } });
    expect(await screen.findByText('Saved')).toBeInTheDocument();

    editAndBlur(field('phone'), '+33 1 00 00 00 00');
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2));
    expect((api.patch as any).mock.calls[1][1]).toEqual({ invoice: { phone: '+33 1 00 00 00 00' } });
  });

  it('sends an empty value when the email is cleared', async () => {
    (api.patch as any).mockResolvedValue(answer({ ...FRENCH_INVOICE, email: null }, ['email']));
    renderPage(LOCAL_TRIAL, { invoice: FRENCH_INVOICE });
    editAndBlur(await loadedField('email'), '');
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith('/billing/profile', { invoice: { email: null } });
    expect(await screen.findByText('Required before subscribing: email.')).toBeInTheDocument();
    expect(field('email').value).toBe('');
  });

  it('saves the country as soon as it is picked', async () => {
    (api.patch as any).mockResolvedValue(answer({ ...FRENCH_INVOICE, address: { ...FRENCH_INVOICE.address, country: 'DE' } }, ['vatNumber']));
    renderPage(LOCAL_TRIAL, { invoice: FRENCH_INVOICE });
    const country = await loadedField('country');
    // The input appears empty: Autocomplete writes the name of its value from an effect, in a later
    // render that a busy machine can run after the wait above has returned.
    await waitFor(() => expect(field('country').value).toBe('France'));
    act(() => { country.focus(); });
    fireEvent.mouseDown(country);
    fireEvent.change(country, { target: { value: 'Germany' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Germany' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith('/billing/profile', { invoice: { address: { country: 'DE' } } });
    await waitFor(() => expect(field('country').value).toBe('Germany'));
  });

  it('shows the missing fields the server reports, and follows its answers', async () => {
    let resolvePatch: (value: unknown) => void = () => undefined;
    (api.patch as any).mockImplementation(() => new Promise((resolve) => { resolvePatch = resolve; }));
    renderPage(LOCAL_TRIAL, {
      invoice: { ...FRENCH_INVOICE, email: null, address: { ...FRENCH_INVOICE.address, city: null } },
      invoice_missing_fields: ['email', 'city'],
    });
    expect(await screen.findByText('Required before subscribing: email, city.')).toBeInTheDocument();

    editAndBlur(field('email'), 'billing@fromage-co.com');
    expect(await screen.findByText('Saving…')).toBeInTheDocument();
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    // The line changes with the server's answer, not with the typing.
    expect(screen.getByText('Required before subscribing: email, city.')).toBeInTheDocument();
    await act(async () => {
      resolvePatch(answer({ ...FRENCH_INVOICE, address: { ...FRENCH_INVOICE.address, city: null } }, ['city']));
    });
    expect(await screen.findByText('Required before subscribing: city.')).toBeInTheDocument();

    editAndBlur(field('city'), 'Paris');
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolvePatch(answer(FRENCH_INVOICE, []));
    });
    await waitFor(() => expect(screen.queryByText(/Required before subscribing/)).not.toBeInTheDocument());
  });

  it('shows a refused email on the field', async () => {
    (api.patch as any).mockRejectedValue({ response: { status: 400, data: { message: ['invoice.email must be an email'] } } });
    renderPage(LOCAL_TRIAL, { invoice: FRENCH_INVOICE });
    editAndBlur(await loadedField('email'), 'not-an-email');
    expect(await screen.findByText('Check the format of this email address.')).toBeInTheDocument();
    expect(field('email').value).toBe('not-an-email');
  });

  it('moves to the first missing field from the plan dialog', async () => {
    renderPage(LOCAL_TRIAL, { invoice: { ...FRENCH_INVOICE, email: null }, invoice_missing_fields: ['email'] });
    await loadedField('email');
    fireEvent.click(screen.getByRole('button', { name: 'Choose plan' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Complete invoicing information' }));
    await waitFor(() => expect(document.activeElement).toBe(field('email')));
  });
});

describe('BillingCenter invoice VAT number', () => {
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
    const vat = field('vatNumber');
    expect(vat.value).toBe('FR12345');
    expect(vat).toHaveAttribute('aria-invalid', 'true');
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

describe('BillingCenter invoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const invoices = Array.from({ length: 7 }, (_, index) => ({
    id: `in_${index}`,
    number: `KAN-000${index + 1}`,
    status: index === 0 ? 'open' : 'paid',
    total: 24900,
    currency: 'EUR',
    hostedInvoiceUrl: `https://invoice.stripe.test/${index}`,
    invoicePdf: `https://invoice.stripe.test/${index}.pdf`,
    createdAt: '2026-03-01T00:00:00.000Z',
  }));

  it('lists the first five invoices with their number, and shows all on demand', async () => {
    renderPage(LOCAL_TRIAL, { invoice: FRENCH_INVOICE, invoices });
    expect(await screen.findByText('KAN-0001')).toBeInTheDocument();
    expect(screen.getByText('KAN-0005')).toBeInTheDocument();
    expect(screen.queryByText('KAN-0006')).not.toBeInTheDocument();
    expect(screen.queryByText('in_0')).not.toBeInTheDocument();
    expect(screen.getAllByText('€249.00')).toHaveLength(5);
    expect(screen.getAllByRole('link', { name: 'Download' })[0]).toHaveAttribute('href', 'https://invoice.stripe.test/0.pdf');

    fireEvent.click(screen.getByRole('button', { name: 'Show all (7)' }));
    expect(screen.getByText('KAN-0007')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show fewer invoices' })).toBeInTheDocument();
  });
});
