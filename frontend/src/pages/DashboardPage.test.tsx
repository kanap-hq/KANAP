import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
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
const PROFILE = { id: 'user-1', email: 'thomas.berger@example.com', first_name: 'Thomas', last_name: 'Berger' };
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (resource: string) => readable[resource] ?? true, profile: PROFILE }),
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

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <DashboardPage />
          <LocationProbe />
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
    if (url === '/tasks') {
      // Seven open tasks; the five first by due date (one without, last).
      const items = [
        { id: 't4', item_number: 4, title: 'Renew licences', due_date: '2026-10-20' },
        { id: 't9', item_number: 9, title: 'Undated follow-up', due_date: null },
      ];
      return { data: { items, total: 7, page: 1, limit: 5 } };
    }
    if (url === '/contracts') {
      const items = [{ id: 'contract-1', name: 'Office suite', cancellation_deadline: `${new Date().getFullYear() + 1}-03-01` }];
      return { data: { items, total: items.length, page: 1, limit: 5 } };
    }
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
        ? [{ id: 'o1', item_number: 11, product_name: 'Opex top', versions: budgetSlots(0, 5000) }]
        : [{ id: 'c1', item_number: 12, description: 'Capex top', versions: budgetSlots(0, 9000) }];
      return { data: { items, total: items.length } };
    }
    return { data: { items: [], total: 0, page: 1, limit: 5 } };
  });
  // The server's aggregates: hygiene counts by check, top increases over every line of the type.
  post.mockImplementation(async (url: string, body: any) => {
    const scope = url === '/spend-items/summary/aggregate' ? 'opex' : url === '/capex-items/summary/aggregate' ? 'capex' : null;
    if (!scope) throw new Error(`unexpected POST ${url}`);
    const filters = Object.keys(body.query.filters ?? {});
    // A hygiene count: one filter, no group, no sum.
    if (filters.length && body.spec.groupBy.length === 0 && body.spec.measures.length === 0) {
      const counts: Record<string, number> = scope === 'opex'
        ? { owner_it_name: 1, owner_business_name: 2, paying_company_name: 0, cost_center_label: 3, yPlus1Budget: 5, yPlus1Forecast: 5, account_warning: 0 }
        : { owner_it_name: 4, owner_business_name: 3, paying_company_name: 0, cost_center_label: 0, yPlus1Budget: 2, yPlus1Forecast: 2, account_warning: 1 };
      const count = counts[filters[0]] ?? 0;
      return { data: { groups: [], others: null, total: { keys: [], count, values: {}, unknown: {} }, groupCount: count ? 1 : 0, reportingCurrency: null } };
    }
    // Names as the list shows them: Thomas Berger is IT owner of o1, business owner of o2 and holds
    // the cost center of o2; o3 has no cost center.
    const items = scope === 'opex'
      ? [
        { id: 'o1', item_number: 21, product_name: 'Opex grows', versions: budgetSlots(1000, 3000), owner_it_name: 'Thomas Berger', cost_center_label: 'IT-1 · Infrastructure' },
        { id: 'o2', product_name: 'Opex shrinks', versions: budgetSlots(8000, 1000), owner_business_name: 'Thomas Berger', budget_holder_name: 'Thomas Berger', cost_center_label: 'IT-2 · Workplace' },
        { id: 'o3', product_name: 'Opex small rise', versions: budgetSlots(1000, 1300), owner_it_name: 'Marie Fontaine' },
      ]
      : [{ id: 'c1', item_number: 22, description: 'Capex grows', versions: budgetSlots(0, 4000), owner_it_name: 'Marie Fontaine' }];
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
        groupBy: ['id', 'product_name', 'item_number'],
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

  it('opens each top increase on its line, by its reference', async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: TOP_INCREASES });
    expect(await within(tile).findByRole('link', { name: /Opex grows/ })).toHaveAttribute('href', '/ops/opex/OPX-21');
    fireEvent.click(within(tile).getByRole('tab', { name: 'operations.scope.capex' }));
    expect(await within(tile).findByRole('link', { name: /Capex grows/ })).toHaveAttribute('href', '/ops/capex/CPX-22');
  });

  it('opens each top item on its line, by its reference', async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: TOP_ITEMS });
    expect(await within(tile).findByRole('link', { name: /Opex top/ })).toHaveAttribute('href', '/ops/opex/OPX-11');
    fireEvent.click(within(tile).getByRole('tab', { name: 'operations.scope.capex' }));
    expect(await within(tile).findByRole('link', { name: /Capex top/ })).toHaveAttribute('href', '/ops/capex/CPX-12');
  });

  it("counts the user's open tasks only and opens each task by its reference", async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: 'dashboard.myTasks' });
    expect(await within(tile).findByText('7')).toBeInTheDocument();
    expect(within(tile).getByRole('link', { name: /Renew licences/ })).toHaveAttribute('href', '/portfolio/tasks/T-4');
    expect(within(tile).getByRole('link', { name: /Undated follow-up/ })).toHaveAttribute('href', '/portfolio/tasks/T-9');
    const params = summaryCalls('/tasks')[0];
    // The list scopes by the query parameter (a filter on the assignee id is ignored), open statuses only.
    expect(params.assigneeUserId).toBe('user-1');
    expect(params.sort).toBe('due_date:ASC');
    expect(JSON.parse(params.filters)).toEqual({ status: { filterType: 'set', values: ['open', 'in_progress', 'pending', 'in_testing'] } });
    // "View all" opens the task list on the user's tasks.
    fireEvent.click(within(tile).getByRole('button', { name: 'buttons.viewAll' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/portfolio/tasks?taskScope=my');
  });

  it('opens each renewal on its contract', async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: 'dashboard.nextRenewals' });
    expect(await within(tile).findByRole('link', { name: /Office suite/ })).toHaveAttribute('href', '/ops/contracts/contract-1/overview');
  });

  it('hides the tasks and renewals tiles from a user who cannot read them, and asks nothing', async () => {
    readable.tasks = false;
    readable.contracts = false;
    try {
      renderPage();
      await screen.findByRole('region', { name: 'dashboard.dataHygiene' });
      expect(screen.queryByRole('region', { name: 'dashboard.myTasks' })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'dashboard.nextRenewals' })).not.toBeInTheDocument();
      expect(get.mock.calls.some(([url]) => url === '/tasks' || url === '/contracts')).toBe(false);
    } finally {
      delete readable.tasks;
      delete readable.contracts;
    }
  });

  it('shows the hygiene counts of both types side by side', async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: 'dashboard.dataHygiene' });
    expect(within(tile).getByText('ops:operations.scope.opex')).toBeInTheDocument();
    expect(within(tile).getByText('ops:operations.scope.capex')).toBeInTheDocument();
    const filtersOf = (el: HTMLElement) => JSON.parse(new URLSearchParams(el.getAttribute('href')!.split('?')[1]).get('filters')!);
    const capexNoItOwner = await within(tile).findByLabelText('dashboard.hygiene.noItOwner, ops:operations.scope.capex: 4');
    expect(capexNoItOwner.getAttribute('href')!.split('?')[0]).toBe('/ops/capex');
    expect(filtersOf(capexNoItOwner)).toEqual({ owner_it_name: { filterType: 'set', values: [null] } });
    const opexNoBusinessOwner = within(tile).getByLabelText('dashboard.hygiene.noBusinessOwner, ops:operations.scope.opex: 2');
    expect(opexNoBusinessOwner.getAttribute('href')!.split('?')[0]).toBe('/ops/opex');
    expect(filtersOf(opexNoBusinessOwner)).toEqual({ owner_business_name: { filterType: 'set', values: [null] } });
    expect(filtersOf(within(tile).getByLabelText('dashboard.hygiene.accountOutsideChart, ops:operations.scope.capex: 1')))
      .toEqual({ account_warning: { filterType: 'set', values: ['coa_mismatch'] } });
    // A count of zero opens nothing.
    expect(within(tile).getByLabelText('dashboard.hygiene.noPayingCompany, ops:operations.scope.opex: 0')).not.toHaveAttribute('href');
    // The count and the link use the same filter, on the lines the list shows by default (enabled).
    const countQueries = aggregateCalls('/spend-items/summary/aggregate').filter((body) => body.query.filters).map((body) => body.query);
    expect(countQueries).toContainEqual({ filters: { owner_it_name: { filterType: 'set', values: [null] } }, status: 'enabled' });
    expect(countQueries).toContainEqual({ filters: { paying_company_name: { filterType: 'set', values: [null] } }, status: 'enabled' });
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

  const MY_BUDGET = 'dashboard.myBudget.title (ops:operations.budgetColumns.budget)';
  const BY_COST_CENTER = 'dashboard.byCostCenterY (ops:operations.budgetColumns.budget)';
  const filtersOf = (el: Element) => JSON.parse(new URLSearchParams(el.getAttribute('href')!.split('?')[1]).get('filters')!);

  it("shows the user's lines per role, each row opening the list on that role and name", async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: MY_BUDGET });
    const itOwner = await within(tile).findByRole('link', { name: /roles\.itOwner/ });
    expect(itOwner.getAttribute('href')!.split('?')[0]).toBe('/ops/opex');
    expect(filtersOf(itOwner)).toEqual({ owner_it_name: { filterType: 'set', values: ['Thomas Berger'] } });
    expect(itOwner).toHaveTextContent('3k');
    const business = within(tile).getByRole('link', { name: /roles\.businessOwner/ });
    expect(filtersOf(business)).toEqual({ owner_business_name: { filterType: 'set', values: ['Thomas Berger'] } });
    expect(business).toHaveTextContent('1k');
    expect(filtersOf(within(tile).getByRole('link', { name: /roles\.budgetHolder/ })))
      .toEqual({ budget_holder_name: { filterType: 'set', values: ['Thomas Berger'] } });
    // Each count and sum uses the link's filter, on the lines the list shows by default, this year's default column.
    expect(aggregateCalls('/spend-items/summary/aggregate')).toContainEqual({
      query: { filters: { owner_it_name: { filterType: 'set', values: ['Thomas Berger'] } }, status: 'enabled' },
      spec: { groupBy: [], measures: [{ id: 'value', fn: 'sum', field: 'yBudget' }] },
    });
  });

  it('shows a role without lines as plain text, and one line when the user has none', async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: MY_BUDGET });
    await within(tile).findByRole('link', { name: /roles\.itOwner/ });
    fireEvent.click(within(tile).getByRole('tab', { name: 'operations.scope.capex' }));
    // No CAPEX line in Thomas Berger's name.
    expect(await within(tile).findByText('dashboard.myBudget.none')).toBeInTheDocument();
    expect(within(tile).queryByRole('link')).not.toBeInTheDocument();
  });

  it('ranks this year by cost center, lines without one included, each row opening the list on it', async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: BY_COST_CENTER });
    const first = await within(tile).findByRole('link', { name: /IT-1 · Infrastructure/ });
    expect(first.getAttribute('href')!.split('?')[0]).toBe('/ops/opex');
    expect(filtersOf(first)).toEqual({ cost_center_label: { filterType: 'set', values: ['IT-1 · Infrastructure'] } });
    expect(first).toHaveTextContent('3k');
    const none = within(tile).getByRole('link', { name: /dashboard\.noCostCenter/ });
    expect(filtersOf(none)).toEqual({ cost_center_label: { filterType: 'set', values: [null] } });
    const rows = within(tile).getAllByRole('link').map((el) => el.textContent);
    expect(rows).toEqual(['IT-1 · Infrastructure3k', 'dashboard.noCostCenter1k', 'IT-2 · Workplace1k']);
    expect(aggregateCalls('/spend-items/summary/aggregate')).toContainEqual({
      query: { status: 'enabled' },
      spec: {
        groupBy: ['cost_center_label'],
        measures: [{ id: 'value', fn: 'sum', field: 'yBudget' }],
        having: [{ measure: 'value', op: 'gt', value: 0 }],
        order: [{ by: 'measure', id: 'value', dir: 'DESC' }],
        limit: 5,
      },
    });
  });

  it('counts the lines without a cost center and without next year on the default column, with links', async () => {
    setBudgetColumns({ labels: TENANT_NAMES, enabled: ALL_SHOWN, default_column: 'forecast' });
    renderPage();
    const tile = await screen.findByRole('region', { name: 'dashboard.dataHygiene' });
    const noCostCenter = await within(tile).findByLabelText('dashboard.hygiene.noCostCenter, ops:operations.scope.opex: 3');
    expect(filtersOf(noCostCenter)).toEqual({ cost_center_label: { filterType: 'set', values: [null] } });
    expect(within(tile).getByLabelText('dashboard.hygiene.noCostCenter, ops:operations.scope.capex: 0')).not.toHaveAttribute('href');
    // Next year's amount of the default column (column 3 here) is zero: no version that year reads zero.
    const noNextYear = await within(tile).findByLabelText('dashboard.hygiene.noBudgetNextYear (A2), ops:operations.scope.capex: 2');
    expect(noNextYear.getAttribute('href')!.split('?')[0]).toBe('/ops/capex');
    expect(filtersOf(noNextYear)).toEqual({ yPlus1Forecast: { filterType: 'number', type: 'equals', filter: 0 } });
    const countQueries = aggregateCalls('/capex-items/summary/aggregate').filter((body) => body.query.filters).map((body) => body.query);
    expect(countQueries).toContainEqual({ filters: { yPlus1Forecast: { filterType: 'number', type: 'equals', filter: 0 } }, status: 'enabled' });
  });

  it('asks the server for the next five renewals from today on', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'dashboard.nextRenewals' });
    await waitFor(() => expect(summaryCalls('/contracts')).toHaveLength(1));
    const params = summaryCalls('/contracts')[0];
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(params.limit).toBe(5);
    expect(params.sort).toBe('cancellation_deadline:ASC');
    expect(JSON.parse(params.filters)).toEqual({ cancellation_deadline: { filterType: 'date', type: 'greaterThanOrEqual', dateFrom: today } });
  });

  it('asks for no top items before the setting is loaded', async () => {
    setBudgetColumns({}, false);
    renderPage();
    await screen.findByRole('region', { name: 'dashboard.dataHygiene' });
    await waitFor(() => expect(summaryCalls('/spend-items/summary').some((p) => p.sort === 'updated_at:DESC')).toBe(true));
    expect(summaryCalls('/spend-items/summary').some((p) => /^y[A-Z]/.test(String(p.sort)))).toBe(false);
  });
});
