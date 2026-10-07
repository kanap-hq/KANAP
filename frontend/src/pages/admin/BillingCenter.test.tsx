import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
          invoices: profile.invoices ?? [],
        },
      };
    }
    return { data: [] };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter initialEntries={['/admin/billing']}>
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
    expect(country.value).toBe('France');
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
