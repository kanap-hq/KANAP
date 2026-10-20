import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('../../api', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));

import api from '../../api';
import AllocationDefaultPage from './AllocationDefaultPage';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn> };
const YEAR = new Date().getFullYear();

// The default split by turnover is computed in the reporting currency: the preview names each
// company's base currency next to its turnover, and names each company left out for lack of a rate.
function serve(previewWarning: unknown) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/allocation-rules/active') {
      return { data: {
        fiscal_year: YEAR, mode: 'manual_company', method: 'turnover', source: 'tenant',
        standard_mode: 'auto', standard_method: 'headcount', tenant_mode: 'manual_company', tenant_method: 'turnover',
        company_ids: ['paris', 'ny'],
        shares: [{ company_id: 'paris', allocation_pct: 66.6667 }, { company_id: 'ny', allocation_pct: 33.3333 }],
        preview_error: null,
        preview_warning: previewWarning,
      } };
    }
    if (url === '/companies') {
      return { data: { items: [
        { id: 'paris', name: 'Paris', base_currency: 'EUR', turnover_year: 70 },
        { id: 'ny', name: 'New York', base_currency: 'USD', turnover_year: 35 },
      ] } };
    }
    throw new Error(`unexpected GET ${url}`);
  });
}

async function renderPage() {
  await i18n.changeLanguage('en');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ThemeProvider theme={createAppTheme('light')}>
            <AllocationDefaultPage />
          </ThemeProvider>
        </QueryClientProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('AllocationDefaultPage by turnover', () => {
  beforeEach(() => { mocked.get.mockReset(); });

  it("names each company's base currency next to its turnover", async () => {
    serve(null);
    await renderPage();
    expect(await screen.findByText('35 M USD')).toBeInTheDocument();
    expect(screen.getByText('70 M EUR')).toBeInTheDocument();
    expect(screen.queryByText(/exchange rate/)).toBeNull();
  });

  it('says which company is left out when its turnover has no rate', async () => {
    serve({
      code: 'turnover_fx_missing',
      items: [{ companyId: 'ny', companyName: 'New York', currency: 'USD', year: YEAR }],
      reportingCurrency: 'EUR',
    });
    await renderPage();
    expect(await screen.findByText(
      `New York is left out of the allocation: no exchange rate from USD to EUR for ${YEAR}.`,
      { exact: false },
    )).toBeInTheDocument();
  });
});
