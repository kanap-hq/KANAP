import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';

vi.mock('react-i18next', () => {
  // The tile titles name the default column: show it next to the key.
  const t = (key: string, options?: Record<string, unknown>) => (options && 'column' in options ? `${key} (${options.column})` : key);
  const translation = { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../hooks/useBudgetColumns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useBudgetColumns')>();
  const state = await import('./reports/budgetColumnsTestState');
  return { ...actual, useBudgetColumns: () => state.mockedBudgetColumns(actual.resolveBudgetColumns) };
});
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
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
import { setBudgetColumns } from './reports/budgetColumnsTestState';
import { fakeAggregate } from '../test/fakeBudgetAggregate';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

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

const ALL_SHOWN = { planned: true, committed: true, forecast: true, actual: true, expected_landing: true };
const TENANT_NAMES = { planned: 'A0', committed: 'A1', forecast: 'A2', actual: 'A3', expected_landing: 'Réel' };

describe('DashboardPage budget snapshot', () => {
  beforeEach(() => {
    setBudgetColumns();
    post.mockReset();
    post.mockResolvedValue({ data: { groups: [], others: null, total: { keys: [], count: 0, values: {}, unknown: {} }, groupCount: 0, reportingCurrency: null } });
    get.mockReset();
    get.mockImplementation(async (url: string) => {
      if (url === '/spend-items/summary/totals') {
        return { data: { yBudget: 12000, yMinus1Revision: 3000, yForecast: 7000, yPlus1FollowUp: 9000, reportingCurrency: 'X' } };
      }
      if (url === '/capex-items/summary/totals') return { data: {} };
      return { data: { items: [], total: 0, page: 1, limit: 5 } };
    });
  });

  it('reads every shown column from the totals key of the same name, with the tenant names, and hides empty columns', async () => {
    setBudgetColumns({ labels: TENANT_NAMES, enabled: ALL_SHOWN });
    renderPage();
    const tile = await screen.findByRole('region', { name: 'dashboard.opexSnapshot' });
    await within(tile).findByText('A2');
    const headers = within(tile).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['labels.year', 'A0', 'A1', 'A2', 'A3']);
    const cells = within(tile).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').slice(1).map((c) => c.textContent));
    // Rows Y-1, Y, Y+1; columns 1 to 4 (column 5 is empty).
    expect(cells).toEqual([
      ['0k', '3k', '0k', '0k'],
      ['12k', '0k', '7k', '0k'],
      ['0k', '0k', '0k', '9k'],
    ]);
  });

  it('leaves hidden columns out, whatever they hold (Forecast is hidden by default)', async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: 'dashboard.opexSnapshot' });
    await within(tile).findByText('ops:operations.budgetColumns.budget');
    const headers = within(tile).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([
      'labels.year',
      'ops:operations.budgetColumns.budget',
      'ops:operations.budgetColumns.revision',
      'ops:operations.budgetColumns.followUp',
    ]);
  });
});

const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
/** Y-1 and Y slots; column 3 holds the same amounts the other way round, so a tile reading the wrong column shows. */
const budgetSlots = (previous: number, current: number) => ({
  yMinus1: { totals: { budget: previous, forecast: current } },
  y: { totals: { budget: current, forecast: previous } },
});

/** Answers the summary endpoints by the kind of request the dashboard makes. */
function mockBudgetEndpoints() {
  get.mockImplementation(async (url: string, config?: { params?: Record<string, any> }) => {
    const params = config?.params ?? {};
    if (url.endsWith('/summary/totals')) return { data: {} };
    const scope = url === '/spend-items/summary' ? 'opex' : url === '/capex-items/summary' ? 'capex' : null;
    if (!scope) return { data: { items: [], total: 0, page: 1, limit: 5 } };
    if (params.sort === 'updated_at:DESC') {
      const items = scope === 'opex'
        ? [{ id: 'o1', item_number: 1, product_name: 'Opex edited', updated_at: '2026-09-20T10:00:00Z' }]
        : [{ id: 'c2', item_number: 2, description: 'Capex edited', updated_at: '2026-09-25T10:00:00Z' }];
      return { data: { items, total: items.length } };
    }
    if (params.sort === 'yBudget:DESC' || params.sort === 'yForecast:DESC') {
      const items = scope === 'opex'
        ? [{ id: 'o1', product_name: 'Opex top', versions: budgetSlots(0, 5000) }]
        : [{ id: 'c1', description: 'Capex top', versions: budgetSlots(0, 9000) }];
      return { data: { items, total: items.length } };
    }
    return { data: { items: [], total: 0, page: 1, limit: 5 } };
  });
  // The server's aggregates: hygiene counts by check, top increases over every line of the type.
  post.mockImplementation(async (url: string, body: any) => {
    const scope = url === '/spend-items/summary/aggregate' ? 'opex' : url === '/capex-items/summary/aggregate' ? 'capex' : null;
    if (!scope) throw new Error(`unexpected POST ${url}`);
    const filters = Object.keys(body.query.filters ?? {});
    if (filters.length) {
      const counts: Record<string, number> = scope === 'opex'
        ? { owner_it_id: 1, owner_business_id: 2, paying_company_id: 0, account_warning: 0 }
        : { owner_it_id: 4, owner_business_id: 3, paying_company_id: 0, account_warning: 1 };
      const count = counts[filters[0]] ?? 0;
      return { data: { groups: [], others: null, total: { keys: [], count, values: {}, unknown: {} }, groupCount: count ? 1 : 0, reportingCurrency: null } };
    }
    const items = scope === 'opex'
      ? [
        { id: 'o1', product_name: 'Opex grows', versions: budgetSlots(1000, 3000) },
        { id: 'o2', product_name: 'Opex shrinks', versions: budgetSlots(8000, 1000) },
        { id: 'o3', product_name: 'Opex small rise', versions: budgetSlots(1000, 1300) },
      ]
      : [{ id: 'c1', description: 'Capex grows', versions: budgetSlots(0, 4000) }];
    return { data: fakeAggregate(items, body) };
  });
}

const aggregateCalls = (url: string) => post.mock.calls.filter(([called]) => called === url).map(([, body]) => body);

const summaryCalls = (url: string) => get.mock.calls.filter(([called]) => called === url).map(([, config]) => config?.params ?? {});

const TOP_ITEMS = 'dashboard.topItemsY (ops:operations.budgetColumns.budget)';
const TOP_INCREASES = 'dashboard.topIncreasesYvsYminus1 (ops:operations.budgetColumns.budget)';

describe('DashboardPage budget tiles', () => {
  beforeEach(() => {
    setBudgetColumns();
    get.mockReset();
    post.mockReset();
    readable.opex = true;
    readable.capex = true;
    try { window.localStorage.clear(); } catch { /* storage unavailable */ }
    mockBudgetEndpoints();
  });

  it('switches the top items tile to CAPEX and opens the report on that type', async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: TOP_ITEMS });
    expect(await within(tile).findByText('Opex top')).toBeInTheDocument();

    fireEvent.click(within(tile).getByRole('tab', { name: 'operations.scope.capex' }));

    expect(await within(tile).findByText('Capex top')).toBeInTheDocument();
    expect(summaryCalls('/capex-items/summary').some((p) => p.sort === 'yBudget:DESC')).toBe(true);
  });

  it('lists only increases, computed over every line of the type by one server aggregate', async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: TOP_INCREASES });
    expect(await within(tile).findByText('Opex grows')).toBeInTheDocument();
    expect(within(tile).getByText(`+${compact(2000)}`)).toBeInTheDocument();
    expect(within(tile).queryByText('Opex shrinks')).not.toBeInTheDocument();
    // A rise under a thousand keeps its value instead of reading "+0k".
    expect(within(tile).getByText(`+${compact(300)}`)).toBeInTheDocument();
    // One aggregate over the list's window (no years): Y minus Y-1 per line, the increases, the five largest.
    expect(aggregateCalls('/spend-items/summary/aggregate')).toContainEqual({
      query: {},
      spec: {
        groupBy: ['id', 'product_name'],
        measures: [{ id: 'delta', fn: 'sum', field: 'yBudget', minus: 'yMinus1Budget' }],
        having: [{ measure: 'delta', op: 'gt', value: 0 }],
        order: [{ by: 'measure', id: 'delta', dir: 'DESC' }],
        limit: 5,
      },
    });
    // No line is downloaded for it.
    expect(summaryCalls('/spend-items/summary').some((p) => p.limit === 500)).toBe(false);

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
    const top = screen.getByRole('region', { name: TOP_ITEMS });
    expect(within(top).getByRole('tab', { name: 'operations.scope.capex' })).toBeDisabled();
    await waitFor(() => expect(within(top).getByText('Opex top')).toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'dashboard.capexSnapshot' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'dashboard.opexSnapshot' })).toBeInTheDocument();
    expect([...get.mock.calls, ...post.mock.calls].some(([url]) => (url as string).startsWith('/capex-items/'))).toBe(false);
  });

  it('hides the OPEX snapshot and sends no OPEX request to a user who cannot read OPEX', async () => {
    readable.opex = false;
    renderPage();
    const top = await screen.findByRole('region', { name: TOP_ITEMS });
    await waitFor(() => expect(within(top).getByText('Capex top')).toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'dashboard.opexSnapshot' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'dashboard.capexSnapshot' })).toBeInTheDocument();
    expect([...get.mock.calls, ...post.mock.calls].some(([url]) => (url as string).startsWith('/spend-items/'))).toBe(false);
  });
  it('ranks the top items by the default column and names it in the title', async () => {
    setBudgetColumns({ labels: TENANT_NAMES, enabled: ALL_SHOWN, default_column: 'forecast' });
    renderPage();
    const tile = await screen.findByRole('region', { name: 'dashboard.topItemsY (A2)' });
    expect(await within(tile).findByText('Opex top')).toBeInTheDocument();
    // Column 3 of Y holds the Y-1 amount of column 1 (0): 0k, not the 5k of column 1.
    expect(within(tile).getByText('0k')).toBeInTheDocument();
    const topRequests = summaryCalls('/spend-items/summary').filter((p) => p.limit === 5 && p.sort !== 'updated_at:DESC' && !p.filters);
    expect(topRequests.map((p) => p.sort)).toEqual(['yForecast:DESC']);
  });

  it('computes the top increases on the default column and names it in the title', async () => {
    setBudgetColumns({ labels: TENANT_NAMES, enabled: ALL_SHOWN, default_column: 'forecast' });
    renderPage();
    const tile = await screen.findByRole('region', { name: 'dashboard.topIncreasesYvsYminus1 (A2)' });
    // Column 3 runs the other way: only the line that shrinks on column 1 grows on it.
    expect(await within(tile).findByText('Opex shrinks')).toBeInTheDocument();
    expect(within(tile).queryByText('Opex grows')).not.toBeInTheDocument();
  });

  it('asks for no top items before the setting is loaded', async () => {
    setBudgetColumns({}, false);
    renderPage();
    await screen.findByRole('region', { name: 'dashboard.dataHygiene' });
    await waitFor(() => expect(summaryCalls('/spend-items/summary').some((p) => p.sort === 'updated_at:DESC')).toBe(true));
    expect(summaryCalls('/spend-items/summary').some((p) => /^y[A-Z]/.test(String(p.sort)))).toBe(false);
  });
});
