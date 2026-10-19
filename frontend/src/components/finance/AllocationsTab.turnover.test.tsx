import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import { OPEX_FINANCE_CONFIG } from './config';
import { KanapDialogProvider } from '../design';

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'me' } }) }));

import api from '../../api';
import AllocationsTab from './AllocationsTab';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn> };
const YEAR = 2026;

// The turnover split is computed in the reporting currency: the tab names each company's base
// currency next to its turnover, and says when a currency had no rate yet (counted unconverted).
function serve(warning: unknown) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/spend-items/item-1/versions') {
      return { data: [{ id: 'v-1', budget_year: YEAR, allocation_method: 'turnover', allocation_driver: 'turnover' }] };
    }
    if (url === '/spend-versions/v-1/allocations') {
      return { data: {
        items: [
          { company_id: 'paris', department_id: null, allocation_pct: 66.6667 },
          { company_id: 'ny', department_id: null, allocation_pct: 33.3333 },
        ],
        method: 'turnover', driver: 'turnover', base_signature: 'sig', totals: { planned: 1000 }, warning,
      } };
    }
    if (url === '/companies') {
      return { data: { items: [
        { id: 'paris', name: 'Paris', base_currency: 'EUR', turnover_year: 70 },
        { id: 'ny', name: 'New York', base_currency: 'usd', turnover_year: 35 },
      ] } };
    }
    if (url === '/departments') return { data: { items: [] } };
    if (url === '/allocation-rules/active') return { data: { mode: 'auto', method: 'headcount' } };
    throw new Error(`unexpected GET ${url}`);
  });
}

async function renderTab() {
  await i18n.changeLanguage('en');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>
          <KanapDialogProvider>
            <AllocationsTab id="item-1" year={YEAR} onYearChange={() => undefined} config={OPEX_FINANCE_CONFIG} />
          </KanapDialogProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

describe('AllocationsTab by turnover', () => {
  beforeEach(() => { mocked.get.mockReset(); });

  it("names each company's base currency next to its turnover", async () => {
    serve(null);
    await renderTab();
    expect(await screen.findByText('35 M USD')).toBeInTheDocument();
    expect(screen.getByText('70 M EUR')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says when a turnover was counted without a rate', async () => {
    serve({ code: 'turnover_fx_missing', currencies: ['USD'], year: YEAR, reportingCurrency: 'EUR' });
    await renderTab();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No EUR exchange rate for USD in 2026 yet');
  });
});
