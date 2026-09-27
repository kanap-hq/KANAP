import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../api', () => ({ default: { get: vi.fn() } }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: null }) }));
vi.mock('../components/PageHeader', () => ({ default: () => null }));
vi.mock('./workspace/tiles/DashboardTile', () => ({
  default: ({ title, children }: { title: string; children?: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

import api from '../api';
import DashboardPage from './DashboardPage';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('DashboardPage budget snapshot', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockImplementation(async (url: string) => {
      if (url === '/spend-items/summary/totals') {
        return { data: { yBudget: 12000, yMinus1Revision: 3000, yForecast: 7000, yPlus1FollowUp: 9000, reportingCurrency: 'X' } };
      }
      if (url === '/capex-items/summary/totals') return { data: {} };
      return { data: { items: [], total: 0, page: 1, limit: 5 } };
    });
  });

  it('reads every column from the totals key of the same name and hides empty columns', async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: 'dashboard.opexSnapshot' });
    await within(tile).findByText('ops:operations.budgetColumns.forecast');
    const headers = within(tile).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([
      'labels.year',
      'ops:operations.budgetColumns.budget',
      'ops:operations.budgetColumns.revision',
      'ops:operations.budgetColumns.forecast',
      'ops:operations.budgetColumns.followUp',
    ]);
    const cells = within(tile).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').slice(1).map((c) => c.textContent));
    // Rows Y-1, Y, Y+1; columns Budget, Revision, Forecast, Actuals.
    expect(cells).toEqual([
      ['0k', '3k', '0k', '0k'],
      ['12k', '0k', '7k', '0k'],
      ['0k', '0k', '0k', '9k'],
    ]);
  });
});
