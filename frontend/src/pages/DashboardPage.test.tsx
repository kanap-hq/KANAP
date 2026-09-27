import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const readable: Record<string, boolean> = { opex: true, capex: true };
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (resource: string) => readable[resource] ?? true, profile: null }),
}));
vi.mock('../components/PageHeader', () => ({ default: () => null }));
vi.mock('./workspace/tiles/DashboardTile', () => ({
  default: ({ title, action, children }: { title: string; action?: React.ReactNode; children?: React.ReactNode }) => (
    <section aria-label={title}>{action}{children}</section>
  ),
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

const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const budgetSlots = (previous: number, current: number) => ({
  yMinus1: { totals: { budget: previous } },
  y: { totals: { budget: current } },
});

/** Answers the summary endpoints by the kind of request the dashboard makes. */
function mockBudgetEndpoints() {
  get.mockImplementation(async (url: string, config?: { params?: Record<string, any> }) => {
    const params = config?.params ?? {};
    if (url.endsWith('/summary/totals')) return { data: {} };
    const scope = url === '/spend-items/summary' ? 'opex' : url === '/capex-items/summary' ? 'capex' : null;
    if (!scope) return { data: { items: [], total: 0, page: 1, limit: 5 } };
    if (params.filters) {
      const filters = JSON.parse(params.filters);
      const counts: Record<string, number> = scope === 'opex'
        ? { owner_it_id: 1, owner_business_id: 2, paying_company_id: 0, account_warning: 0 }
        : { owner_it_id: 4, owner_business_id: 3, paying_company_id: 0, account_warning: 1 };
      return { data: { items: [], total: counts[Object.keys(filters)[0]] ?? 0 } };
    }
    if (params.sort === 'updated_at:DESC') {
      const items = scope === 'opex'
        ? [{ id: 'o1', item_number: 1, product_name: 'Opex edited', updated_at: '2026-09-20T10:00:00Z' }]
        : [{ id: 'c2', item_number: 2, description: 'Capex edited', updated_at: '2026-09-25T10:00:00Z' }];
      return { data: { items, total: items.length } };
    }
    if (params.sort === 'yBudget:DESC') {
      const items = scope === 'opex'
        ? [{ id: 'o1', product_name: 'Opex top', versions: budgetSlots(0, 5000) }]
        : [{ id: 'c1', description: 'Capex top', versions: budgetSlots(0, 9000) }];
      return { data: { items, total: items.length } };
    }
    // Every line of the type (top increases).
    const items = scope === 'opex'
      ? [
        { id: 'o1', product_name: 'Opex grows', versions: budgetSlots(1000, 3000) },
        { id: 'o2', product_name: 'Opex shrinks', versions: budgetSlots(8000, 1000) },
        { id: 'o3', product_name: 'Opex small rise', versions: budgetSlots(1000, 1300) },
      ]
      : [{ id: 'c1', description: 'Capex grows', versions: budgetSlots(0, 4000) }];
    return { data: { items, total: items.length, page: 1, limit: 500 } };
  });
}

const summaryCalls = (url: string) => get.mock.calls.filter(([called]) => called === url).map(([, config]) => config?.params ?? {});

describe('DashboardPage budget tiles', () => {
  beforeEach(() => {
    get.mockReset();
    readable.opex = true;
    readable.capex = true;
    try { window.localStorage.clear(); } catch { /* storage unavailable */ }
    mockBudgetEndpoints();
  });

  it('switches the top items tile to CAPEX and opens the report on that type', async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: 'dashboard.topItemsY' });
    expect(await within(tile).findByText('Opex top')).toBeInTheDocument();

    fireEvent.click(within(tile).getByRole('tab', { name: 'operations.scope.capex' }));

    expect(await within(tile).findByText('Capex top')).toBeInTheDocument();
    expect(summaryCalls('/capex-items/summary').some((p) => p.sort === 'yBudget:DESC')).toBe(true);
  });

  it('lists only increases, computed over every line of the type from the reports cache entry', async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: 'dashboard.topIncreasesYvsYminus1' });
    expect(await within(tile).findByText('Opex grows')).toBeInTheDocument();
    expect(within(tile).getByText(`+${compact(2000)}`)).toBeInTheDocument();
    expect(within(tile).queryByText('Opex shrinks')).not.toBeInTheDocument();
    // A rise under a thousand keeps its value instead of reading "+0k".
    expect(within(tile).getByText(`+${compact(300)}`)).toBeInTheDocument();
    // Same request as the reports' all-lines hook (no years), so both share one cache entry.
    expect(summaryCalls('/spend-items/summary').some((p) => p.limit === 500 && p.sort === 'created_at:DESC' && p.years === undefined)).toBe(true);

    fireEvent.click(within(tile).getByRole('tab', { name: 'operations.scope.capex' }));
    expect(await within(tile).findByText('Capex grows')).toBeInTheDocument();
  });

  it('shows the hygiene counts of both types side by side', async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: 'dashboard.dataHygiene' });
    expect(within(tile).getByText('ops:operations.scope.opex')).toBeInTheDocument();
    expect(within(tile).getByText('ops:operations.scope.capex')).toBeInTheDocument();
    expect(await within(tile).findByLabelText('dashboard.hygiene.noItOwner, ops:operations.scope.capex: 4')).toHaveAttribute('href', '/ops/capex');
    expect(within(tile).getByLabelText('dashboard.hygiene.noItOwner, ops:operations.scope.opex: 1')).toHaveAttribute('href', '/ops/opex');
    expect(within(tile).getByLabelText('dashboard.hygiene.accountOutsideChart, ops:operations.scope.capex: 1')).toBeInTheDocument();
    // Long labels (German) wrap instead of being cut.
    expect(within(tile).getByText('dashboard.hygiene.accountOutsideChart')).not.toHaveClass('MuiTypography-noWrap');
  });

  it('mixes the recent updates of both types, newest first, each row opening its line', async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: 'dashboard.quickActions' });
    const capexRow = await within(tile).findByRole('link', { name: /Capex edited/ });
    const opexRow = await within(tile).findByRole('link', { name: /Opex edited/ });
    expect(capexRow).toHaveAttribute('href', '/ops/capex/CPX-2');
    expect(opexRow).toHaveAttribute('href', '/ops/opex/OPX-1');
    expect(capexRow.compareDocumentPosition(opexRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no CAPEX column or tab to a user who cannot read CAPEX', async () => {
    readable.capex = false;
    renderPage();
    const hygiene = await screen.findByRole('region', { name: 'dashboard.dataHygiene' });
    expect(within(hygiene).queryByText('ops:operations.scope.capex')).not.toBeInTheDocument();
    const top = screen.getByRole('region', { name: 'dashboard.topItemsY' });
    expect(within(top).getByRole('tab', { name: 'operations.scope.capex' })).toBeDisabled();
    await waitFor(() => expect(within(top).getByText('Opex top')).toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'dashboard.capexSnapshot' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'dashboard.opexSnapshot' })).toBeInTheDocument();
    expect(get.mock.calls.some(([url]) => (url as string).startsWith('/capex-items/'))).toBe(false);
  });

  it('hides the OPEX snapshot and sends no OPEX request to a user who cannot read OPEX', async () => {
    readable.opex = false;
    renderPage();
    const top = await screen.findByRole('region', { name: 'dashboard.topItemsY' });
    await waitFor(() => expect(within(top).getByText('Capex top')).toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'dashboard.opexSnapshot' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'dashboard.capexSnapshot' })).toBeInTheDocument();
    expect(get.mock.calls.some(([url]) => (url as string).startsWith('/spend-items/'))).toBe(false);
  });
});
