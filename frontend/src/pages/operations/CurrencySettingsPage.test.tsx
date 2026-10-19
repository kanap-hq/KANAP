import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

// Texts come from the real English strings; `t` is created once so effects do not loop.
vi.mock('react-i18next', async () => {
  const i18next = (await import('i18next')).default;
  const enOps = (await import('../../locales/en/ops.json')).default;
  const enCommon = (await import('../../locales/en/common.json')).default;
  const real = i18next.createInstance();
  await real.init({
    lng: 'en',
    resources: { en: { ops: enOps, common: enCommon } },
    ns: ['ops', 'common'], defaultNS: 'ops',
    interpolation: { escapeValue: false },
  });
  // One stable translation per first namespace: the shared dialog reads `common` keys without a prefix.
  const byNamespace = new Map<string, { t: (key: string, options?: unknown) => string; i18n: object }>();
  const useTranslation = (ns?: string | string[]) => {
    const first = (Array.isArray(ns) ? ns[0] : ns) ?? 'ops';
    let translation = byNamespace.get(first);
    if (!translation) {
      const fixed = real.getFixedT('en', first);
      translation = {
        t: (key: string, options?: unknown) => fixed(key, options as Record<string, unknown>),
        i18n: { language: 'en', resolvedLanguage: 'en' },
      };
      byNamespace.set(first, translation);
    }
    return translation;
  };
  return { useTranslation, initReactI18next: { type: '3rdParty', init: () => undefined } };
});
vi.mock('../../api', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
const auth = vi.hoisted(() => ({ budgetAdmin: true }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => resource === 'budget_ops' && (level === 'reader' || auth.budgetAdmin),
  }),
}));
vi.mock('../../components/PageHeader', () => ({ default: ({ title }: { title: string }) => <h1>{title}</h1> }));

import api from '../../api';
import CurrencySettingsPage from './CurrencySettingsPage';

type Mock = ReturnType<typeof vi.fn>;
const mocked = api as unknown as { get: Mock; patch: Mock; post: Mock; put: Mock; delete: Mock };

const SETTINGS = {
  reportingCurrency: 'CHF',
  defaultSpendCurrency: 'EUR',
  defaultCapexCurrency: 'USD',
  allowedCurrencies: ['GBP'],
};

/** 2025 in CHF: EUR entered by hand, USD estimated from the previous year, NOK missing. */
const RATES_2025 = {
  fiscalYear: 2025,
  baseCurrency: 'CHF',
  rates: { CHF: 1, EUR: 0.93, USD: 0.88 },
  rateSources: { CHF: 'identity', EUR: 'manual', USD: 'estimate' },
  capturedAt: '2026-10-19T10:00:00.000Z',
  source: 'world-bank',
};
const NOK_2025 = { currency: 'NOK', year: 2025 };

let rates: unknown[] = [];
let missing: unknown[] = [];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <CurrencySettingsPage />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const reportingField = () => screen.getByRole('textbox', { name: /reporting currency/i });

/** Waits until the stored settings are on screen. */
async function waitForSettings() {
  await waitFor(() => expect(reportingField()).toHaveValue('CHF'));
}

describe('CurrencySettingsPage', () => {
  beforeEach(() => {
    auth.budgetAdmin = true;
    rates = [];
    missing = [];
    for (const fn of Object.values(mocked)) fn.mockReset();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/currency/settings') return { data: SETTINGS };
      if (url === '/currency/rates') return { data: rates };
      if (url === '/currency/rates/missing') return { data: { items: missing } };
      throw new Error(`unexpected GET ${url}`);
    });
  });

  it('lets a budget administrator edit and save the currencies', async () => {
    renderPage();
    await waitForSettings();

    expect(screen.queryByText('You need budget administrator rights to use this page.')).not.toBeInTheDocument();
    for (const field of screen.getAllByRole('textbox')) {
      expect(field).not.toHaveAttribute('readonly');
    }
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Force FX rates sync' })).toBeInTheDocument();
    expect(await screen.findByText('No FX rate snapshots captured yet. Run "Force FX rates sync" to create one.')).toBeInTheDocument();
  });

  it('shows the currencies read-only to a budget reader, with nothing to save or sync', async () => {
    auth.budgetAdmin = false;
    renderPage();
    await waitForSettings();

    expect(screen.getByText('You need budget administrator rights to use this page.')).toBeInTheDocument();
    const fields = screen.getAllByRole('textbox');
    expect(fields).toHaveLength(4);
    for (const field of fields) {
      expect(field).toHaveAttribute('readonly');
    }
    expect(screen.getByRole('textbox', { name: /allowed currencies/i })).toHaveValue('GBP');
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Force FX rates sync' })).not.toBeInTheDocument();
    expect(await screen.findByText('No FX rate snapshots captured yet.')).toBeInTheDocument();
    expect(screen.queryByText(/Force FX rates sync/)).not.toBeInTheDocument();
    expect(mocked.patch).not.toHaveBeenCalled();
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('says every currency has a rate when none is missing', async () => {
    rates = [RATES_2025];
    renderPage();

    expect(await screen.findByText('Every currency in use has a rate.')).toBeInTheDocument();
    expect(screen.queryByText(/exchange rates? missing/)).not.toBeInTheDocument();
  });

  it('shows no manual footnote when no rate was entered by hand', async () => {
    rates = [{ ...RATES_2025, rateSources: { CHF: 'identity', EUR: 'world-bank-annual', USD: 'estimate' } }];
    renderPage();

    expect(await screen.findByText('0.930000')).toBeInTheDocument();
    expect(screen.queryByText('* Rate entered manually')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Rate entered manually')).not.toBeInTheDocument();
  });

  it('lists the missing pairs and marks manual and estimated rates', async () => {
    rates = [RATES_2025];
    missing = [NOK_2025];
    renderPage();

    expect(await screen.findByText('1 exchange rate missing')).toBeInTheDocument();
    expect(screen.getByText('NOK · 2025')).toBeInTheDocument();
    expect(screen.getByText(
      'No source publishes this rate yet; amounts in this currency are not converted correctly until it has one.',
    )).toBeInTheDocument();
    expect(screen.queryByText('Every currency in use has a rate.')).not.toBeInTheDocument();

    const table = screen.getByRole('table');
    expect(within(table).getByText('NOK')).toBeInTheDocument();
    expect(within(table).getByText('—')).toBeInTheDocument();
    expect(within(table).getByText('0.930000')).toBeInTheDocument();
    // A manual rate carries an asterisk, explained once under the table.
    expect(within(table).getByLabelText('Rate entered manually')).toHaveTextContent('*');
    expect(screen.getByText('* Rate entered manually')).toBeInTheDocument();
    // The tooltip text is the mark's accessible name.
    expect(within(table).getByLabelText(
      'The source has not published this year yet; the nearest published year is used until it does.',
    )).toHaveTextContent('estimate');
    // The reporting currency is 1 by definition: its cell is not editable.
    expect(screen.queryByRole('button', { name: 'Edit the rate for CHF in 2025' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit the rate for USD in 2025' })).toBeInTheDocument();
  });

  it('lets an editor enter a rate for a missing pair with a comma as decimal mark', async () => {
    const user = userEvent.setup();
    rates = [RATES_2025];
    missing = [NOK_2025];
    mocked.put.mockResolvedValue({ data: RATES_2025 });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Enter a rate for NOK in 2025' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Manual exchange rate')).toBeInTheDocument();
    expect(within(dialog).getByText('NOK · 2025')).toBeInTheDocument();
    expect(within(dialog).getByText('Use the average rate of the year published by your central bank or your treasury.')).toBeInTheDocument();
    expect(within(dialog).getByText('A manual rate replaces the automatic rate for this year until you remove it.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Remove manual rate' })).not.toBeInTheDocument();

    const field = within(dialog).getByRole('textbox', { name: 'Rate in CHF for 1 NOK' });
    expect(field).toHaveValue('');
    await user.type(field, '0,0852');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocked.put).toHaveBeenCalledWith('/currency/rates/manual', { currency: 'NOK', year: 2025, rate: 0.0852 }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('refuses a rate that is not greater than 0 and shows the API errors', async () => {
    const user = userEvent.setup();
    rates = [RATES_2025];
    missing = [NOK_2025];
    mocked.put.mockRejectedValue({ response: { data: { message: 'Rate must be a finite number greater than 0 and at most 1000000000.' } } });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Enter a rate for NOK in 2025' }));
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByRole('textbox', { name: 'Rate in CHF for 1 NOK' });
    await user.type(field, '0');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Enter a rate greater than 0.')).toBeInTheDocument();
    expect(mocked.put).not.toHaveBeenCalled();

    await user.clear(field);
    await user.type(field, '2000000000');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Rate must be a finite number greater than 0 and at most 1000000000.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('opens a manual rate from its cell, pre-filled, and removes it', async () => {
    const user = userEvent.setup();
    rates = [RATES_2025];
    mocked.delete.mockResolvedValue({ data: { ok: true, refreshQueued: false } });
    renderPage();

    const cell = await screen.findByRole('button', { name: 'Edit the rate for EUR in 2025' });
    cell.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('EUR · 2025')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Rate in CHF for 1 EUR' })).toHaveValue('0.93');

    await user.click(within(dialog).getByRole('button', { name: 'Remove manual rate' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/currency/rates/manual/2025/EUR'));
    expect(await screen.findByText('The automatic rate will be fetched again.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocked.put).not.toHaveBeenCalled();
  });

  it('shows the rates read-only to a budget reader', async () => {
    auth.budgetAdmin = false;
    rates = [RATES_2025];
    missing = [NOK_2025];
    renderPage();

    expect(await screen.findByText('NOK · 2025')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enter a rate/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit the rate/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole('table')).queryAllByRole('button')).toHaveLength(0);
  });
});
