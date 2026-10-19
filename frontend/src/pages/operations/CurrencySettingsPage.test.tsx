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
        i18n: {
          get language() { return i18nState.language; },
          get resolvedLanguage() { return i18nState.language; },
        },
      };
      byNamespace.set(first, translation);
    }
    return translation;
  };
  return { useTranslation, initReactI18next: { type: '3rdParty', init: () => undefined } };
});
vi.mock('../../api', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
const auth = vi.hoisted(() => ({ budgetAdmin: true }));
const i18nState = vi.hoisted(() => ({ language: 'en' }));
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

let matrix: { currencies: string[]; rates: unknown[] } = { currencies: [], rates: [] };
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
    i18nState.language = 'en';
    matrix = { currencies: [], rates: [] };
    missing = [];
    for (const fn of Object.values(mocked)) fn.mockReset();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/currency/settings') return { data: SETTINGS };
      if (url === '/currency/rates') return { data: matrix };
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
    matrix = { currencies: ['CHF', 'EUR', 'USD'], rates: [RATES_2025] };
    renderPage();

    expect(await screen.findByText('Every currency in use has a rate.')).toBeInTheDocument();
    expect(screen.queryByText(/exchange rates? missing/)).not.toBeInTheDocument();
  });

  it('shows no manual footnote when no rate was entered by hand', async () => {
    matrix = {
      currencies: ['CHF', 'EUR', 'USD'],
      rates: [{ ...RATES_2025, rateSources: { CHF: 'identity', EUR: 'world-bank-annual', USD: 'estimate' } }],
    };
    renderPage();

    expect(await screen.findByText('0.93')).toBeInTheDocument();
    expect(screen.queryByText('* Rate entered manually')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Rate entered manually')).not.toBeInTheDocument();
  });

  it('lists the missing pairs and marks manual and estimated rates', async () => {
    matrix = { currencies: ['CHF', 'EUR', 'USD', 'NOK'], rates: [RATES_2025] };
    missing = [NOK_2025];
    renderPage();

    expect(await screen.findByText('1 exchange rate missing')).toBeInTheDocument();
    expect(screen.getByText('NOK · 2025')).toBeInTheDocument();
    expect(screen.getByText(
      'No source publishes this rate yet; amounts in this currency are left out of totals until it has one.',
    )).toBeInTheDocument();
    expect(screen.queryByText('Every currency in use has a rate.')).not.toBeInTheDocument();

    const table = screen.getByRole('table');
    expect(within(table).getByText('NOK')).toBeInTheDocument();
    expect(within(table).getByText('—')).toBeInTheDocument();
    expect(within(table).getByText('0.93')).toBeInTheDocument();
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
    matrix = { currencies: ['CHF', 'EUR', 'USD', 'NOK'], rates: [RATES_2025] };
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

  it('focuses the rate field, saves with Enter and closes with Escape', async () => {
    const user = userEvent.setup();
    matrix = { currencies: ['CHF', 'EUR', 'USD'], rates: [RATES_2025] };
    mocked.put.mockResolvedValue({ data: { ...RATES_2025, frozenVersions: 0 } });
    renderPage();

    const cell = await screen.findByRole('button', { name: 'Edit the rate for EUR in 2025' });
    await user.click(cell);
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByRole('textbox', { name: 'Rate in CHF for 1 EUR' });
    await waitFor(() => expect(field).toHaveFocus());
    expect(field).not.toHaveAttribute('placeholder');

    await user.keyboard('{Enter}');
    await waitFor(() => expect(mocked.put).toHaveBeenCalledWith('/currency/rates/manual', { currency: 'EUR', year: 2025, rate: 0.93 }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Edit the rate for USD in 2025' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocked.put).toHaveBeenCalledTimes(1);
  });

  it('explains a neighbouring automatic rate and validates before sending', async () => {
    const user = userEvent.setup();
    matrix = {
      currencies: ['CHF', 'USD', 'NOK'],
      rates: [
        {
          ...RATES_2025,
          fiscalYear: 2024,
          rates: { CHF: 1, USD: 0.0858 },
          rateSources: { CHF: 'identity', USD: 'world-bank-annual' },
        },
        RATES_2025,
      ],
    };
    missing = [NOK_2025];
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Edit the rate for USD in 2025' }));
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Automatic rate for 2024: 0.0858')).toBeInTheDocument();
    expect(within(dialog).queryByText('Use the average rate of the year published by your central bank or your treasury.')).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(await screen.findByRole('button', { name: 'Enter a rate for NOK in 2025' }));
    dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByRole('textbox', { name: 'Rate in CHF for 1 NOK' });
    expect(within(dialog).getByText('Use the average rate of the year published by your central bank or your treasury.')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Enter a rate.')).toBeInTheDocument();

    await user.type(field, 'abc');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Enter a number.')).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, '0');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Enter a rate greater than 0.')).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, '1000000001');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('The rate cannot be greater than 1,000,000,000.')).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, '0.0000004');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Rounded to 6 decimal places, this rate is 0.')).toBeInTheDocument();
    expect(mocked.put).not.toHaveBeenCalled();
  });

  it('maps a server code under the field and keeps an unknown code generic', async () => {
    const user = userEvent.setup();
    matrix = { currencies: ['CHF', 'NOK'], rates: [RATES_2025] };
    missing = [NOK_2025];
    mocked.put.mockRejectedValueOnce({
      response: { data: { code: 'rate_too_small', message: 'Rate rounds to 0 at 6 decimal places and cannot be stored.' } },
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Enter a rate for NOK in 2025' }));
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByRole('textbox', { name: 'Rate in CHF for 1 NOK' });
    await user.type(field, '0.5');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('This rate is too small: rounded to 6 decimal places, it is 0.')).toBeInTheDocument();
    expect(within(dialog).queryByText('Rate rounds to 0 at 6 decimal places and cannot be stored.')).not.toBeInTheDocument();

    mocked.put.mockRejectedValueOnce({ response: { data: { code: 'nope', message: 'English boom' } } });
    await user.clear(field);
    await user.type(field, '0.5');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('The rate could not be saved.')).toBeInTheDocument();
    expect(within(dialog).queryByText('English boom')).not.toBeInTheDocument();
  });

  it('tells how many frozen versions keep their rate after a save or a removal', async () => {
    const user = userEvent.setup();
    matrix = { currencies: ['CHF', 'EUR', 'NOK'], rates: [RATES_2025] };
    missing = [NOK_2025];
    mocked.put.mockResolvedValue({ data: { ...RATES_2025, frozenVersions: 2 } });
    mocked.delete.mockResolvedValue({ data: { ok: true, refreshQueued: false, frozenVersions: 1 } });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Enter a rate for NOK in 2025' }));
    let dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Rate in CHF for 1 NOK' }), '0,0852');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('The 2 frozen versions of 2025 keep the rate from when they were frozen.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit the rate for EUR in 2025' }));
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove manual rate' }));
    expect(await screen.findByText('The frozen version of 2025 keeps the rate from when it was frozen.')).toBeInTheDocument();
    expect(screen.getByText('The automatic rate will be fetched again.')).toBeInTheDocument();
  });

  it('explains the manual marker from the keyboard', async () => {
    const user = userEvent.setup();
    matrix = { currencies: ['CHF', 'EUR', 'USD'], rates: [RATES_2025] };
    renderPage();
    const cell = await screen.findByRole('button', { name: 'Edit the rate for EUR in 2025' });
    const marker = screen.getByLabelText('Rate entered manually');
    expect(marker).toHaveTextContent('*');
    expect(marker).toHaveAttribute('tabindex', '0');
    // Tab from the cell. A programmatic focus() does not match :focus-visible after a click,
    // and that is the only signal MUI uses to open the tooltip.
    cell.focus();
    await user.tab();
    expect(marker).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Rate entered manually');
  });

  it('opens a manual rate from its cell, pre-filled, and removes it', async () => {
    const user = userEvent.setup();
    matrix = { currencies: ['CHF', 'EUR', 'USD'], rates: [RATES_2025] };
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

  it('builds matrix rows from currencies, in that order, and trims trailing zeros', async () => {
    matrix = {
      currencies: ['CHF', 'USD', 'EUR'],
      rates: [{
        ...RATES_2025,
        rates: { CHF: 1, EUR: 0.93, USD: 1.080803, GBP: 1.1 },
        rateSources: { CHF: 'identity', EUR: 'manual', USD: 'world-bank-annual', GBP: 'world-bank-annual' },
      }],
    };
    renderPage();

    const table = await screen.findByRole('table');
    const codes = within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent);
    expect(codes).toEqual(['CHF', 'USD', 'EUR']);
    expect(within(table).queryByText('GBP')).not.toBeInTheDocument();
    expect(within(table).getByText('1.080803')).toBeInTheDocument();
    expect(within(table).getByText('0.93')).toBeInTheDocument();
    expect(within(table).queryByText('0.930000')).not.toBeInTheDocument();
  });

  it('writes rates in the French number format, including the prefilled manual rate', async () => {
    const user = userEvent.setup();
    i18nState.language = 'fr';
    matrix = {
      currencies: ['CHF', 'USD', 'EUR'],
      rates: [{
        ...RATES_2025,
        rates: { CHF: 1, EUR: 0.93, USD: 1.080803 },
        rateSources: { CHF: 'identity', EUR: 'manual', USD: 'world-bank-annual' },
      }],
    };
    renderPage();

    const table = await screen.findByRole('table');
    expect(within(table).getByText('1,080803')).toBeInTheDocument();
    expect(within(table).getByText('0,93')).toBeInTheDocument();

    await user.click(within(table).getByRole('button', { name: 'Edit the rate for USD in 2025' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('textbox', { name: 'Rate in CHF for 1 USD' })).toHaveValue('1,080803');
  });

  it('shows the rates read-only to a budget reader', async () => {
    auth.budgetAdmin = false;
    matrix = { currencies: ['CHF', 'EUR', 'USD', 'NOK'], rates: [RATES_2025] };
    missing = [NOK_2025];
    renderPage();

    expect(await screen.findByText('NOK · 2025')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enter a rate/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit the rate/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole('table')).queryAllByRole('button')).toHaveLength(0);
  });
});
