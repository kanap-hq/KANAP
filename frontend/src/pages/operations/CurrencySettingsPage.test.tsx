import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

// Texts come from the real English strings; `t` is created once so effects do not loop.
vi.mock('react-i18next', async () => {
  const i18next = (await import('i18next')).default;
  const enOps = (await import('../../locales/en/ops.json')).default;
  const real = i18next.createInstance();
  await real.init({
    lng: 'en',
    resources: { en: { ops: enOps } },
    ns: ['ops'], defaultNS: 'ops',
    interpolation: { escapeValue: false },
  });
  const fixed = real.getFixedT('en');
  const translation = {
    t: (key: string, options?: unknown) => fixed(key, options as Record<string, unknown>),
    i18n: { language: 'en', resolvedLanguage: 'en' },
  };
  return { useTranslation: () => translation };
});
vi.mock('../../api', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
const auth = vi.hoisted(() => ({ budgetAdmin: true }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => resource === 'budget_ops' && (level === 'reader' || auth.budgetAdmin),
  }),
}));
vi.mock('../../components/PageHeader', () => ({ default: ({ title }: { title: string }) => <h1>{title}</h1> }));

import api from '../../api';
import CurrencySettingsPage from './CurrencySettingsPage';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

const SETTINGS = {
  reportingCurrency: 'CHF',
  defaultSpendCurrency: 'EUR',
  defaultCapexCurrency: 'USD',
  allowedCurrencies: ['GBP'],
};

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
    mocked.get.mockReset();
    mocked.patch.mockReset();
    mocked.post.mockReset();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/currency/settings') return { data: SETTINGS };
      if (url === '/currency/rates') return { data: [] };
      throw new Error(`unexpected GET ${url}`);
    });
  });

  it('lets a budget administrator edit and save the currencies', async () => {
    renderPage();
    await waitForSettings();

    expect(screen.queryByText('Only budget administrators can change this page.')).not.toBeInTheDocument();
    for (const field of screen.getAllByRole('textbox')) {
      expect(field).not.toHaveAttribute('readonly');
    }
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Force FX rates sync' })).toBeInTheDocument();
  });

  it('shows the currencies read-only to a budget reader, with nothing to save or sync', async () => {
    auth.budgetAdmin = false;
    renderPage();
    await waitForSettings();

    expect(screen.getByText('Only budget administrators can change this page.')).toBeInTheDocument();
    const fields = screen.getAllByRole('textbox');
    expect(fields).toHaveLength(4);
    for (const field of fields) {
      expect(field).toHaveAttribute('readonly');
    }
    expect(screen.getByRole('textbox', { name: /allowed currencies/i })).toHaveValue('GBP');
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Force FX rates sync' })).not.toBeInTheDocument();
    expect(mocked.patch).not.toHaveBeenCalled();
    expect(mocked.post).not.toHaveBeenCalled();
  });
});
