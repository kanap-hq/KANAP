import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('react-i18next', () => {
  // The tile titles name the default column: show it next to the key.
  const t = (key: string, options?: Record<string, unknown>) => (options && 'column' in options ? `${key} (${options.column})` : key);
  const translation = { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../hooks/useBudgetColumns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useBudgetColumns')>();
  const state = await import('../reports/budgetColumnsTestState');
  return { ...actual, useBudgetColumns: () => state.mockedBudgetColumns(actual.resolveBudgetColumns) };
});
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
let interfaceLocale = 'en';
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => interfaceLocale }));
const readable: Record<string, boolean> = { budget: true };
let budgetWriter = true;
let contractsWriter = true;
const PROFILE = { id: 'user-1', email: 'thomas.berger@example.com', first_name: 'Thomas', last_name: 'Berger' };
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => (readable[resource] ?? true)
      && (level !== 'manager' || (resource === 'budget' ? budgetWriter : resource === 'contracts' ? contractsWriter : true)),
    profile: PROFILE,
  }),
}));
vi.mock('./tiles/DashboardTile', async () => {
  const { useReportEmpty } = await import('./tiles/emptyTiles');
  return {
    default: function Tile({ title, subtitle, currency, action, isLoading, isEmpty, children }: { title: string; subtitle?: string; currency?: string; action?: React.ReactNode; isLoading?: boolean; isEmpty?: boolean; children?: React.ReactNode }) {
      useReportEmpty(!!isEmpty && !isLoading);
      return <section aria-label={title}>{(subtitle || currency) && <p data-testid="tile-subtitle">{[subtitle, currency].filter(Boolean).join(' · ')}</p>}{action}{children}</section>;
    },
  };
});

import api from '../../api';
import { formatCompactAmount, formatThousandsAmount } from '../../i18n/formatters';
import BudgetSection from './BudgetSection';
import { DEFAULT_BUDGET_TILES, useBudgetDashboardConfig } from './hooks/useBudgetDashboardConfig';
// Every tile on (My tasks is the home page's), so that each test reads the tile it is about; the defaults have their own test.
const ALL_TILES = DEFAULT_BUDGET_TILES.map((tile) => ({ ...tile, enabled: tile.id !== 'my-tasks' }));
let savedDashboard = { tiles: ALL_TILES };
beforeEach(() => { savedDashboard = { tiles: ALL_TILES }; });
import { setBudgetColumns } from '../reports/budgetColumnsTestState';
import { fakeAggregate } from '../../test/fakeBudgetAggregate';

const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  clear: () => storage.clear(),
});

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

/** The section as the home page gives it: the person's budget tiles, four columns. */
function Harness({ hideEmpty }: { hideEmpty: boolean }) {
  const settings = useBudgetDashboardConfig();
  return <BudgetSection tiles={settings.config.tiles} loading={settings.isLoading} hideEmpty={hideEmpty} perRow={4} />;
}

function renderPage(mode: 'light' | 'dark' = 'light', hideEmpty = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme(mode)}>
        <MemoryRouter>
          <Harness hideEmpty={hideEmpty} />
          <LocationProbe />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const ALL_SHOWN = { planned: true, committed: true, forecast: true, actual: true, expected_landing: true };
const TENANT_NAMES = { planned: 'A0', committed: 'A1', forecast: 'A2', actual: 'A3', expected_landing: 'Réel' };



describe('BudgetSection budget snapshot', () => {
  beforeEach(() => {
    setBudgetColumns();
    readable.budget = true;
    budgetWriter = true;
    contractsWriter = true;
    interfaceLocale = 'en';
    storage.clear();
    post.mockReset();
    post.mockResolvedValue({ data: fakeAggregate([], { query: {}, spec: { groupBy: [], measures: [] } }) });
    get.mockReset();
    get.mockImplementation(async (url: string) => {
      if (url === '/dashboard/budget-config') return { data: savedDashboard };
      if (url === '/spend-items/summary/totals') return { data: { yBudget: 12000, yMinus1Revision: 3000, yForecast: 7000, yPlus1FollowUp: 9000 } };
      if (url === '/capex-items/summary/totals') return { data: { yBudget: 4000, yMinus1Revision: 2000, yForecast: 1000, yPlus1FollowUp: 6000 } };
      // Deliberately different from the sum: the Total row must use this response directly.
      if (url === '/budget-lines/summary/totals') return { data: { yBudget: 21000, yMinus1Revision: 8000, yForecast: 11000, yPlus1FollowUp: 18000 } };
      return { data: { items: [], total: 0, page: 1, limit: 5 } };
    });
  });

  it.each(['light', 'dark'] as const)('renders one budget tile with three rows per year, each read from its own totals response in %s mode', async (mode) => {
    setBudgetColumns({ labels: TENANT_NAMES, enabled: ALL_SHOWN });
    renderPage(mode);
    const tile = await screen.findByRole('region', { name: 'dashboard.budgetSnapshot' });
    await within(tile).findByText('A2');
    expect(screen.queryByRole('region', { name: 'dashboard.opexSnapshot' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'dashboard.capexSnapshot' })).not.toBeInTheDocument();
    // No reporting currency in these totals: the tile does not invent one.
    expect(within(tile).queryByTestId('tile-subtitle')).not.toBeInTheDocument();
    const headers = within(tile).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['labels.year', 'ops:budget.type', 'A0', 'A1', 'A2', 'A3']);
    const rows = within(tile).getAllByRole('row').slice(1);
    const amounts = rows.map((row) => within(row).getAllByRole('link').map((link) => link.textContent));
    expect(amounts).toEqual([
      ['0k', '3k', '0k', '0k'], ['0k', '2k', '0k', '0k'], ['0k', '8k', '0k', '0k'],
      ['12k', '0k', '7k', '0k'], ['4k', '0k', '1k', '0k'], ['21k', '0k', '11k', '0k'],
      ['0k', '0k', '0k', '9k'], ['0k', '0k', '0k', '6k'], ['0k', '0k', '0k', '18k'],
    ]);
    rows.forEach((row, index) => {
      const scope = ['opex', 'capex', 'all'][index % 3];
      expect(within(row).getByText(scope === 'all' ? 'ops:shared.total' : `ops:operations.scope.${scope}`)).toBeInTheDocument();
      within(row).getAllByRole('link').forEach((link) => {
        const url = new URL(link.getAttribute('href')!, 'http://localhost');
        expect(url.pathname).toBe('/ops/budget');
        expect(JSON.parse(url.searchParams.get('filters')!)).toEqual(scope === 'all' ? {} : { nature: { filterType: 'set', values: [scope] } });
      });
    });
    const requests = get.mock.calls.filter(([url, config]) => String(url).endsWith('/summary/totals') && !config?.params);
    expect(requests.map(([url]) => url)).toEqual([
      '/spend-items/summary/totals', '/capex-items/summary/totals', '/budget-lines/summary/totals',
    ]);
    // Each request reads every year and column; no narrowed amount or year selection.
    requests.forEach(([, config]) => expect(config).not.toHaveProperty('params'));
  });

  it('leaves hidden columns out, whatever they hold (Forecast is hidden by default)', async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: 'dashboard.budgetSnapshot' });
    await within(tile).findByText('ops:operations.budgetColumns.budget');
    const headers = within(tile).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([
      'labels.year', 'ops:budget.type',
      'ops:operations.budgetColumns.budget',
      'ops:operations.budgetColumns.revision',
      'ops:operations.budgetColumns.followUp',
    ]);
  });

  it('keeps a column when the two natures cancel each other out', async () => {
    get.mockImplementation(async (url) => {
      if (url === '/dashboard/budget-config') return { data: savedDashboard };
      if (url === '/spend-items/summary/totals') return { data: { yBudget: 4000 } };
      if (url === '/capex-items/summary/totals') return { data: { yBudget: -4000 } };
      if (url === '/budget-lines/summary/totals') return { data: { yBudget: 0 } };
      return { data: { items: [], total: 0 } };
    });
    renderPage();
    const tile = await screen.findByRole('region', { name: 'dashboard.budgetSnapshot' });
    expect(await within(tile).findByText('-4k')).toBeInTheDocument();
    expect(within(tile).getAllByRole('row')).toHaveLength(10);
  });

  it('shows zero for missing amounts in the CAPEX totals response', async () => {
    get.mockImplementation(async (url) => {
      if (url === '/dashboard/budget-config') return { data: savedDashboard };
      if (url === '/spend-items/summary/totals') return { data: { yBudget: 4000 } };
      if (url === '/capex-items/summary/totals') return { data: {} };
      if (url === '/budget-lines/summary/totals') return { data: { yBudget: 6000 } };
      return { data: { items: [], total: 0 } };
    });
    renderPage();
    const tile = await screen.findByRole('region', { name: 'dashboard.budgetSnapshot' });
    await within(tile).findAllByText('4k');
    const rows = within(tile).getAllByRole('row').slice(4, 7);
    expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual(['4k', '0k', '6k']);
  });

  it('names the amounts the snapshot leaves out without an exchange rate, for the years it shows', async () => {
    const Y = new Date().getFullYear();
    get.mockImplementation(async (url: string) => {
      if (url === '/dashboard/budget-config') return { data: savedDashboard };
      if (url === '/spend-items/summary/totals') return { data: { yBudget: 4000, fxMissing: [{ currency: 'USD', year: Y, lines: 1 }] } };
      if (url === '/capex-items/summary/totals') return { data: { yBudget: 0, fxMissing: [] } };
      // Y+2 is not on the tile: left out of its notice.
      if (url === '/budget-lines/summary/totals') return { data: { yBudget: 4000, fxMissing: [{ currency: 'USD', year: Y, lines: 1 }, { currency: 'JPY', year: Y + 2, lines: 4 }] } };
      return { data: { items: [], total: 0 } };
    });
    renderPage();
    const tile = await screen.findByRole('region', { name: 'dashboard.budgetSnapshot' });
    // One currency and year once the three answers are merged: the singular wording.
    expect(await within(tile).findByRole('status')).toHaveTextContent('shared.fxMissing.excluding');
    expect(within(tile).getByRole('status')).not.toHaveTextContent('excludingSeveral');
  });

  it('names the reporting currency once on the budget tile, from the combined totals', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/dashboard/budget-config') return { data: savedDashboard };
      // Only the combined total names it. The two natures omit it: the tile still uses that one code.
      if (url === '/budget-lines/summary/totals') return { data: { yBudget: 5000, reportingCurrency: 'SEK' } };
      if (url.endsWith('/summary/totals')) return { data: { yBudget: 1000 } };
      return { data: { items: [], total: 0 } };
    });
    renderPage();
    const tile = await screen.findByRole('region', { name: 'dashboard.budgetSnapshot' });
    await waitFor(() => expect(subtitleOf(tile)).toBe('SEK'));
    expect(tile.textContent?.match(/SEK/g)).toHaveLength(1);
    expect(within(tile).getAllByRole('link').every((link) => !link.textContent?.includes('SEK'))).toBe(true);
    expect(within(tile).getByText('5k')).toBeInTheDocument();
  });

  it('shows a top item without an exchange rate in its own currency, marked, never as a reporting amount', async () => {
    const Y = new Date().getFullYear();
    const item = {
      id: 'l-1', item_number: 5, nature: 'opex', product_name: 'Tokyo hosting', currency: 'JPY',
      versions: { y: { year: Y, totals: { budget: 900000 }, reporting: { budget: null, currency: 'JPY', fx_source: 'missing' } } },
    };
    get.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
      if (url === '/dashboard/budget-config') return { data: savedDashboard };
      if (url.endsWith('/summary/totals')) return { data: { reportingCurrency: 'EUR' } };
      if (url === '/budget-lines/summary' && config?.params?.sort !== 'updated_at:DESC') return { data: { items: [item], total: 1, page: 1, limit: 5 } };
      return { data: { items: [], total: 0 } };
    });
    renderPage();
    const tile = await screen.findByRole('region', { name: TOP_ITEMS });
    const link = await within(tile).findByRole('link', { name: /Tokyo hosting/ });
    expect(link).toHaveTextContent('ops:shared.fxMissing.localAmount');
    expect(within(link).getByRole('img', { name: 'shared.fxMissing.lineTooltip' })).toBeInTheDocument();
    // The tile names the reporting currency once. The row keeps its own marked amount, without that code.
    expect(subtitleOf(tile)).toBe('dashboard.columnY (ops:operations.budgetColumns.budget) · EUR');
    expect(link.textContent).not.toContain('EUR');
    expect(tile.textContent?.match(/EUR/g)).toHaveLength(1);
  });

  it('names a line the top list leaves out when its year has no exchange rate', async () => {
    const Y = new Date().getFullYear();
    const ranked = {
      id: 'l-1', item_number: 1, nature: 'opex', product_name: 'Ranked line', currency: 'EUR',
      versions: { y: { year: Y, totals: { budget: 5000 }, reporting: { budget: 5000, currency: 'EUR', fx_source: 'set' } } },
    };
    get.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
      if (url === '/dashboard/budget-config') return { data: savedDashboard };
      if (url === '/budget-lines/summary/totals' && config?.params?.amounts) {
        return { data: { reportingCurrency: 'EUR', fxMissing: [{ currency: 'ZAR', year: Y, lines: 1 }, { currency: 'JPY', year: Y + 2, lines: 3 }] } };
      }
      if (url.endsWith('/summary/totals')) return { data: {} };
      if (url === '/budget-lines/summary' && config?.params?.sort !== 'updated_at:DESC') {
        return { data: { items: [ranked], total: 1, page: 1, limit: 5 } };
      }
      return { data: { items: [], total: 0 } };
    });
    renderPage();
    const tile = await screen.findByRole('region', { name: TOP_ITEMS });
    expect(await within(tile).findByText('Ranked line')).toBeInTheDocument();
    expect(subtitleOf(tile)).toBe('dashboard.columnY (ops:operations.budgetColumns.budget) · EUR');
    expect(within(tile).getByRole('link', { name: /Ranked line/ }).textContent).not.toContain('EUR');
    const notice = await within(tile).findByRole('status');
    // One pair of this year: the other year on the totals answer stays off this tile.
    expect(notice).toHaveTextContent('shared.fxMissing.excluding');
    expect(notice).not.toHaveTextContent('excludingSeveral');
    expect(get.mock.calls.some(([url, config]) => url === '/budget-lines/summary/totals' && config?.params?.amounts === 'yBudget')).toBe(true);
  });

  it('fetches the snapshot without calling any summary/aggregate endpoint', async () => {
    // Other tiles wait for the column setting. Snapshot totals need no setting or aggregate.
    setBudgetColumns({}, false);
    renderPage();
    const tile = await screen.findByRole('region', { name: 'dashboard.budgetSnapshot' });
    await within(tile).findByText('21k');
    expect(get.mock.calls.filter(([url]) => String(url).endsWith('/summary/totals'))).toHaveLength(3);
    expect(post.mock.calls.filter(([url]) => String(url).endsWith('/summary/aggregate'))).toHaveLength(0);
  });

  it('leaves out an empty tile with the option on, then the whole section when none has anything to show', async () => {
    renderPage('light', true);
    const renewals = await screen.findByRole('region', { name: 'dashboard.nextRenewals', hidden: true });
    // No contract to renew, no line updated: nothing to show; the budget has amounts.
    await waitFor(() => expect(renewals.parentElement).not.toBeVisible());
    expect(screen.getByRole('region', { name: 'dashboard.recentUpdates', hidden: true }).parentElement).not.toBeVisible();
    expect(screen.getByRole('region', { name: 'dashboard.budgetSnapshot' }).parentElement).toBeVisible();
    expect(screen.getByRole('heading', { name: 'nav:workspaces.budgetManagement' })).toBeVisible();
  });

  it('keeps the empty tiles with the option off', async () => {
    renderPage('light', false);
    const renewals = await screen.findByRole('region', { name: 'dashboard.nextRenewals', hidden: true });
    await screen.findByText('dashboard.noUpcomingRenewals');
    expect(renewals.parentElement).toBeVisible();
  });

  it('leaves out the section, its title included, when every tile shown is empty', async () => {
    savedDashboard = { tiles: ALL_TILES.map((tile) => ({ ...tile, enabled: ['renewals', 'recent-updates'].includes(tile.id) })) };
    renderPage('light', true);
    await screen.findByRole('region', { name: 'dashboard.nextRenewals', hidden: true });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'nav:workspaces.budgetManagement', hidden: true })).not.toBeVisible());
  });
});

const compact = (n: number) => formatCompactAmount(n, 'en');
/** Y-1 and Y slots; column 3 holds the same amounts the other way round, so a tile reading the wrong column shows. */
const budgetSlots = (previous: number, current: number) => ({
  yMinus1: { totals: { budget: previous, forecast: current } },
  y: { totals: { budget: current, forecast: previous } },
});

/** Answers the summary endpoints by the kind of request the dashboard makes. */
function mockBudgetEndpoints() {
  get.mockImplementation(async (url: string, config?: { params?: Record<string, any> }) => {
    if (url === '/dashboard/budget-config') return { data: savedDashboard };
    const params = config?.params ?? {};
    if (url.endsWith('/summary/totals')) return { data: { reportingCurrency: 'CHF' } };
    if (url === '/tasks') {
      // Seven open tasks; the five first by due date (one without, last).
      const items = [
        { id: 't4', item_number: 4, title: 'Renew licences', due_date: '2026-10-20' },
        { id: 't9', item_number: 9, title: 'Undated follow-up', due_date: null },
      ];
      return { data: { items, total: 7, page: 1, limit: 5 } };
    }
    if (url === '/contracts') {
      const items = [{ id: 'contract-1', name: 'Office suite', next_due_date: `${new Date().getFullYear() + 1}-03-01` }];
      return { data: { items, total: items.length, page: 1, limit: 5 } };
    }
    const scope = url === '/budget-lines/summary' ? (params.filters ? JSON.parse(params.filters).nature.values[0] : 'all') : null;
    if (!scope) return { data: { items: [], total: 0, page: 1, limit: 5 } };
    if (params.sort === 'updated_at:DESC') {
      const items = [
        { id: 'c2', nature: 'capex', item_number: 2, product_name: 'Capex edited', updated_at: '2026-09-25T10:00:00Z' },
        { id: 'o1', nature: 'opex', item_number: 1, product_name: 'Opex edited', updated_at: '2026-09-20T10:00:00Z' },
      ];
      return { data: { items, total: items.length } };
    }
    if (params.sort === 'yBudget:DESC' || params.sort === 'yForecast:DESC') {
      const items = [
        { id: 'c1', nature: 'capex', item_number: 12, product_name: 'Capex top', versions: budgetSlots(0, 9000) },
        { id: 'o1', nature: 'opex', item_number: 11, product_name: 'Opex top', versions: budgetSlots(0, 5000) },
      ].filter((row) => scope === 'all' || row.nature === scope);
      return { data: { items, total: items.length } };
    }
    return { data: { items: [], total: 0, page: 1, limit: 5 } };
  });
  // The server's aggregates: hygiene counts by check, top increases over every line of the type.
  post.mockImplementation(async (url: string, body: any) => {
    const scope = url === '/budget-lines/summary/aggregate' ? 'all' : url === '/spend-items/summary/aggregate' ? 'opex' : url === '/capex-items/summary/aggregate' ? 'capex' : null;
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
    const items = [
      { nature: 'opex', id: 'o1', item_number: 21, product_name: 'Opex grows', versions: budgetSlots(1000, 3000), owner_it_name: 'Thomas Berger', cost_center_label: 'IT-1 · Infrastructure' },
      { nature: 'opex', id: 'o2', item_number: 23, product_name: 'Opex shrinks', versions: budgetSlots(8000, 1000), owner_business_name: 'Thomas Berger', budget_holder_name: 'Thomas Berger', cost_center_label: 'IT-2 · Workplace' },
      { nature: 'opex', id: 'o3', item_number: 24, product_name: 'Opex small rise', versions: budgetSlots(1000, 1300), owner_it_name: 'Marie Fontaine' },
      // Two more lines in his name, smaller this year: the fourth largest stays out of his top three.
      { nature: 'opex', id: 'o4', item_number: 25, product_name: 'Opex cut', versions: budgetSlots(5000, 400), owner_it_name: 'Thomas Berger', cost_center_label: 'IT-1 · Infrastructure' },
      { nature: 'opex', id: 'o5', item_number: 26, product_name: 'Opex trimmed', versions: budgetSlots(2000, 200), owner_business_name: 'Thomas Berger', cost_center_label: 'IT-2 · Workplace' },
      { nature: 'capex', id: 'c1', item_number: 22, product_name: 'Capex grows', description: 'Capex grows', versions: budgetSlots(0, 4000), owner_it_name: 'Marie Fontaine' },
    ].filter((row) => scope === 'all' || row.nature === scope);
    const data = fakeAggregate(items, body);
    // One code for every amount tile, distinct from a hardcoded euro, so the subtitle proves it reads the answer.
    if (data.reportingCurrency) data.reportingCurrency = 'CHF';
    return { data };
  });
}

const aggregateCalls = (url: string) => post.mock.calls.filter(([called]) => called === url).map(([, body]) => body);

const summaryCalls = (url: string) => get.mock.calls.filter(([called]) => called === url).map(([, config]) => config?.params ?? {});

const TOP_ITEMS = 'dashboard.topItems';
// The top increases are the Top lines tile ranked by increase.
const TOP_INCREASES = TOP_ITEMS;
const rankByIncrease = () => storage.set('kanap.dashboard.topLines.mode', 'increase');
const MY_BUDGET = 'dashboard.myBudget.title';
const BY_COST_CENTER = 'dashboard.byCostCenter';
const subtitleOf = (tile: HTMLElement) => within(tile).getByTestId('tile-subtitle').textContent;

describe('BudgetSection budget tiles', () => {
  beforeEach(() => {
    interfaceLocale = 'en';
    setBudgetColumns();
    get.mockReset();
    post.mockReset();
    readable.budget = true;
    budgetWriter = true;
    contractsWriter = true;
    try { window.localStorage.clear(); } catch { /* storage unavailable */ }
    mockBudgetEndpoints();
  });

  it('defaults all three tile tabs to All and remembers each choice independently', async () => {
    const titles = [TOP_ITEMS, MY_BUDGET, BY_COST_CENTER];
    const keys = ['topItems', 'myBudget', 'byCostCenter'];
    const view = renderPage();
    for (let i = 0; i < titles.length; i++) {
      const tile = await screen.findByRole('region', { name: titles[i] });
      expect(within(tile).getByRole('tab', { name: 'operations.scope.all' })).toHaveAttribute('aria-selected', 'true');
      fireEvent.click(within(tile).getByRole('tab', { name: 'operations.scope.capex' }));
      expect(storage.get(`kanap.dashboard.${keys[i]}.scope`)).toBe('capex');
      fireEvent.click(within(tile).getByRole('tab', { name: 'operations.scope.all' }));
      expect(storage.get(`kanap.dashboard.${keys[i]}.scope`)).toBe('all');
    }
    view.unmount();
    renderPage();
    await screen.findByRole('region', { name: titles[0] });
    titles.forEach((title) => expect(within(screen.getByRole('region', { name: title })).getByRole('tab', { name: 'operations.scope.all' })).toHaveAttribute('aria-selected', 'true'));
  });

  it('restores OPEX and CAPEX choices and defaults an invalid stored value to All', async () => {
    storage.set('kanap.dashboard.topItems.scope', 'opex');
    storage.set('kanap.dashboard.myBudget.scope', 'invalid');
    renderPage();
    const top = await screen.findByRole('region', { name: TOP_ITEMS });
    expect(within(top).getByRole('tab', { name: 'operations.scope.opex' })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('region', { name: MY_BUDGET })).getByRole('tab', { name: 'operations.scope.all' })).toHaveAttribute('aria-selected', 'true');
  });

  it('names the tab tiles in one line and what they read on a second one, with the reporting currency once', async () => {
    renderPage();
    const column = 'ops:operations.budgetColumns.budget';
    const withCurrency = (key: string) => `${key} (${column}) · CHF`;
    await waitFor(() => {
      expect(subtitleOf(screen.getByRole('region', { name: MY_BUDGET }))).toBe(withCurrency('dashboard.columnY'));
      expect(subtitleOf(screen.getByRole('region', { name: TOP_ITEMS }))).toBe(withCurrency('dashboard.columnY'));
      expect(subtitleOf(screen.getByRole('region', { name: BY_COST_CENTER }))).toBe(withCurrency('dashboard.columnY'));
      expect(subtitleOf(screen.getByRole('region', { name: 'dashboard.budgetSnapshot' }))).toBe('CHF');
    });
    // The code is the subtitle only: no row repeats it.
    for (const name of [MY_BUDGET, TOP_ITEMS, BY_COST_CENTER, 'dashboard.budgetSnapshot']) {
      expect(screen.getByRole('region', { name }).textContent?.match(/CHF/g)).toHaveLength(1);
    }
    // Counts, tasks, renewals and recent updates are not amounts.
    for (const name of ['dashboard.dataHygiene', 'dashboard.nextRenewals', 'dashboard.recentUpdates']) {
      expect(within(screen.getByRole('region', { name })).queryByTestId('tile-subtitle')).not.toBeInTheDocument();
    }
  });

  it('keeps only its title in its title row: the creation actions and the settings are the home page\'s', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'dashboard.budgetSnapshot' });
    expect(screen.getByRole('heading', { name: 'nav:workspaces.budgetManagement' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /newOpexLine|newCapexLine|newContract|customize/ })).not.toBeInTheDocument();
  });

  it('orders the tiles: the overview, the top lines and the recent updates, then hygiene, the user\'s tiles and the cost centers', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'dashboard.budgetSnapshot' });
    expect(screen.getAllByRole('region').map((tile) => tile.getAttribute('aria-label'))).toEqual([
      'dashboard.budgetSnapshot', TOP_ITEMS, 'dashboard.recentUpdates',
      'dashboard.dataHygiene', MY_BUDGET, 'dashboard.nextRenewals', BY_COST_CENTER,
    ]);
  });

  it('shows the overview, the top lines and the recent updates only, by default', async () => {
    savedDashboard = { tiles: DEFAULT_BUDGET_TILES };
    renderPage();
    await screen.findByRole('region', { name: 'dashboard.budgetSnapshot' });
    await waitFor(() => expect(screen.getAllByRole('region').map((tile) => tile.getAttribute('aria-label'))).toEqual([
      'dashboard.budgetSnapshot', TOP_ITEMS, 'dashboard.recentUpdates',
    ]));
  });

  it('ranks the top lines by amount or by increase, remembers the choice and opens the matching report', async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: TOP_ITEMS });
    expect(await within(tile).findByText('Capex top')).toBeInTheDocument();
    fireEvent.click(within(tile).getByRole('button', { name: 'buttons.open' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/ops/reports/top-opex?scope=all');
    fireEvent.click(within(tile).getByRole('tab', { name: 'dashboard.topLinesMode.increase' }));
    expect(storage.get('kanap.dashboard.topLines.mode')).toBe('increase');
    expect(await within(tile).findByText('Opex grows')).toBeInTheDocument();
    expect(within(tile).queryByText('Capex top')).not.toBeInTheDocument();
    await waitFor(() => expect(subtitleOf(tile)).toBe('dashboard.columnYvsYminus1 (ops:operations.budgetColumns.budget) · CHF'));
    fireEvent.click(within(tile).getByRole('button', { name: 'buttons.open' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/ops/reports/opex-delta?scope=all');
  });

  it('lets the person hide a budget tile, add one back and choose the Budget tile columns while customizing', async () => {
    const onChange = vi.fn();
    const tiles = ALL_TILES.map((tile) => (tile.id === 'cost-centers' ? { ...tile, enabled: false } : tile));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter>
            <BudgetSection tiles={tiles} perRow={4} editing={{ section: { hidden: false, onToggleHidden: vi.fn() }, onChange }} />
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    const hygiene = await screen.findByRole('region', { name: 'dashboard.dataHygiene' });
    fireEvent.click(within(hygiene.parentElement!.parentElement!).getByRole('button', { name: 'dashboard.customize.hideTile' }));
    expect(onChange.mock.calls[0][0].find((tile: { id: string }) => tile.id === 'hygiene').enabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'dashboard.customize.addTile' }));
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['dashboard.byCostCenter']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'dashboard.byCostCenter' }));
    expect(onChange.mock.calls[1][0].find((tile: { id: string }) => tile.id === 'cost-centers').enabled).toBe(true);
    const budget = screen.getByRole('region', { name: 'dashboard.budgetSnapshot' }).parentElement!.parentElement!;
    fireEvent.click(within(budget).getByRole('button', { name: 'dashboard.customize.tileOptions' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'dashboard.budgetSettings.tenantColumns' }));
    expect(onChange.mock.calls[2][0].find((tile: { id: string }) => tile.id === 'budget').config.columns).toEqual(['budget', 'revision', 'follow_up', 'landing']);
  });

  it('takes two columns for the Budget tile from three amount columns on, one below', async () => {
    const spanOf = () => (screen.getByRole('region', { name: 'dashboard.budgetSnapshot' }).parentElement!.parentElement as HTMLElement);
    const view = renderPage();
    await screen.findByRole('region', { name: 'dashboard.budgetSnapshot' });
    expect(getComputedStyle(spanOf()).gridColumn).toContain('span 2');
    view.unmount();
    savedDashboard = { tiles: ALL_TILES.map((tile) => (tile.id === 'budget' ? { ...tile, config: { columns: ['budget', 'forecast'] } } : tile)) };
    renderPage();
    await screen.findByRole('region', { name: 'dashboard.budgetSnapshot' });
    await waitFor(() => expect(getComputedStyle(spanOf()).gridColumn).toContain('span 1'));
  });

  it('switches the top items tile to CAPEX and opens the report on that type', async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: TOP_ITEMS });
    expect(await within(tile).findByText('Opex top')).toBeInTheDocument();

    fireEvent.click(within(tile).getByRole('tab', { name: 'operations.scope.capex' }));

    expect(await within(tile).findByText('Capex top')).toBeInTheDocument();
    expect(summaryCalls('/budget-lines/summary').some((p) => p.sort === 'yBudget:DESC')).toBe(true);
  });

  it('lists only increases, computed over every line of the type by one server aggregate', async () => {
    rankByIncrease();
    renderPage();
    const tile = await screen.findByRole('region', { name: TOP_INCREASES });
    expect(await within(tile).findByText('Opex grows')).toBeInTheDocument();
    expect(compact(2000)).toBe('2k');
    expect(compact(300)).toBe('300');
    expect(within(tile).getByText(`+${compact(2000)}`)).toBeInTheDocument();
    expect(within(tile).queryByText('Opex shrinks')).not.toBeInTheDocument();
    expect(within(tile).getByText('Capex grows')).toBeInTheDocument();
    // A rise under a thousand keeps its value (300).
    expect(within(tile).getByText(`+${compact(300)}`)).toBeInTheDocument();
    // One aggregate over the list's window (no years): Y minus Y-1 per line, the increases, the five largest.
    expect(aggregateCalls('/budget-lines/summary/aggregate')).toContainEqual({
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
    expect(summaryCalls('/budget-lines/summary').some((p) => p.limit === 500)).toBe(false);

    fireEvent.click(within(tile).getByRole('tab', { name: 'operations.scope.capex' }));
    expect(await within(tile).findByText('Capex grows')).toBeInTheDocument();
  });

  it('formats the amounts in the interface language', async () => {
    rankByIncrease();
    interfaceLocale = 'fr';
    renderPage();
    const increases = await screen.findByRole('region', { name: TOP_INCREASES });
    expect(await within(increases).findByText('Opex grows')).toBeInTheDocument();
    const increaseText = increases.textContent ?? '';
    // French compact: a no-break space before k. The English forms stay absent.
    expect(increaseText).toContain(`+${formatCompactAmount(2000, 'fr')}`);
    expect(increaseText).toContain(`+${formatCompactAmount(300, 'fr')}`);
    expect(increaseText).not.toContain('+2K');
    expect(increaseText).not.toContain('+2k');
    const mine = await screen.findByRole('region', { name: MY_BUDGET });
    const itOwner = await within(mine).findByRole('link', { name: /roles\.itOwner/ });
    // 3 400 rounds to 3 thousand. French writes a space before k.
    const ownerText = itOwner.textContent ?? '';
    expect(ownerText).toContain(formatThousandsAmount(3400, 'fr'));
    expect(ownerText).not.toContain('3k');
  });

  it('opens each top increase on its line, by its reference', async () => {
    rankByIncrease();
    renderPage();
    const tile = await screen.findByRole('region', { name: TOP_INCREASES });
    expect(await within(tile).findByRole('link', { name: /Opex grows/ })).toHaveAttribute('href', '/ops/budget/BL-21');
    fireEvent.click(within(tile).getByRole('tab', { name: 'operations.scope.capex' }));
    expect(await within(tile).findByRole('link', { name: /Capex grows/ })).toHaveAttribute('href', '/ops/budget/BL-22');
  });

  it('opens each top item on its line, by its reference', async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: TOP_ITEMS });
    expect(await within(tile).findByRole('link', { name: /Opex top/ })).toHaveAttribute('href', '/ops/budget/BL-11');
    fireEvent.click(within(tile).getByRole('tab', { name: 'operations.scope.capex' }));
    expect(await within(tile).findByRole('link', { name: /Capex top/ })).toHaveAttribute('href', '/ops/budget/BL-12');
  });

  it("leaves the user's tasks to the home page's My tasks tile, and asks nothing for them", async () => {
    renderPage();
    await screen.findByRole('region', { name: 'dashboard.nextRenewals' });
    expect(screen.queryByRole('region', { name: 'dashboard.myTasks' })).not.toBeInTheDocument();
    expect(summaryCalls('/tasks')).toEqual([]);
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
    expect(capexNoItOwner.getAttribute('href')!.split('?')[0]).toBe('/ops/budget');
    expect(filtersOf(capexNoItOwner)).toEqual({ owner_it_name: { filterType: 'set', values: [null] } , nature: { filterType: 'set', values: ['capex'] } });
    const opexNoBusinessOwner = within(tile).getByLabelText('dashboard.hygiene.noBusinessOwner, ops:operations.scope.opex: 2');
    expect(opexNoBusinessOwner.getAttribute('href')!.split('?')[0]).toBe('/ops/budget');
    expect(filtersOf(opexNoBusinessOwner)).toEqual({ owner_business_name: { filterType: 'set', values: [null] } , nature: { filterType: 'set', values: ['opex'] } });
    expect(filtersOf(within(tile).getByLabelText('dashboard.hygiene.accountOutsideChart, ops:operations.scope.capex: 1')))
      .toEqual({ account_warning: { filterType: 'set', values: ['coa_mismatch'] }, nature: { filterType: 'set', values: ['capex'] } });
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
    const tile = await screen.findByRole('region', { name: 'dashboard.recentUpdates' });
    // Recent updates only: the creation buttons live in the page header.
    expect(within(tile).queryByRole('button')).not.toBeInTheDocument();
    const capexRow = await within(tile).findByRole('link', { name: /Capex edited/ });
    const opexRow = await within(tile).findByRole('link', { name: /Opex edited/ });
    expect(capexRow).toHaveAttribute('href', '/ops/budget/BL-2');
    expect(opexRow).toHaveAttribute('href', '/ops/budget/BL-1');
    expect(capexRow).toHaveTextContent('BL-2');
    expect(opexRow).toHaveTextContent('BL-1');
    expect(summaryCalls('/budget-lines/summary').filter((params) => params.sort === 'updated_at:DESC')).toEqual([{ limit: 5, sort: 'updated_at:DESC' }]);
    expect(summaryCalls('/spend-items/summary')).toHaveLength(0);
    expect(summaryCalls('/capex-items/summary')).toHaveLength(0);
    expect(capexRow.compareDocumentPosition(opexRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows both types to a budget reader: one right covers OPEX and CAPEX lines', async () => {
    renderPage();
    const hygiene = await screen.findByRole('region', { name: 'dashboard.dataHygiene' });
    expect(within(hygiene).getByText('ops:operations.scope.opex')).toBeInTheDocument();
    expect(within(hygiene).getByText('ops:operations.scope.capex')).toBeInTheDocument();
    const top = screen.getByRole('region', { name: TOP_ITEMS });
    expect(within(top).getByRole('tab', { name: 'operations.scope.capex' })).not.toBeDisabled();
    expect(screen.getByRole('region', { name: 'dashboard.budgetSnapshot' })).toBeInTheDocument();
  });

  it('hides every budget tile and sends no budget request without the budget right', async () => {
    readable.budget = false;
    renderPage();
    await screen.findByRole('region', { name: 'dashboard.nextRenewals' });
    for (const name of ['dashboard.budgetSnapshot', 'dashboard.dataHygiene', TOP_ITEMS, TOP_INCREASES, MY_BUDGET, BY_COST_CENTER, 'dashboard.recentUpdates']) {
      expect(screen.queryByRole('region', { name })).not.toBeInTheDocument();
    }
    expect([...get.mock.calls, ...post.mock.calls].some(([url]) => /^\/(budget-lines|spend-items|capex-items)\//.test(url as string))).toBe(false);
  });

  it('ranks the top items by the default column and names it in the subtitle', async () => {
    setBudgetColumns({ labels: TENANT_NAMES, enabled: ALL_SHOWN, default_column: 'forecast' });
    renderPage();
    const tile = await screen.findByRole('region', { name: TOP_ITEMS });
    await waitFor(() => expect(subtitleOf(tile)).toBe('dashboard.columnY (A2) · CHF'));
    expect(await within(tile).findByText('Opex top')).toBeInTheDocument();
    // Column 3 of Y holds the Y-1 amount of column 1 (0): 0k, not the 5k of column 1.
    expect(within(tile).getAllByText('0k')).toHaveLength(2);
    const topRequests = summaryCalls('/budget-lines/summary').filter((p) => p.limit === 5 && p.sort !== 'updated_at:DESC' && !p.filters);
    expect(topRequests.map((p) => p.sort)).toEqual(['yForecast:DESC']);
  });

  it('computes the top increases on the default column and names it in the subtitle', async () => {
    rankByIncrease();
    setBudgetColumns({ labels: TENANT_NAMES, enabled: ALL_SHOWN, default_column: 'forecast' });
    renderPage();
    const tile = await screen.findByRole('region', { name: TOP_INCREASES });
    await waitFor(() => expect(subtitleOf(tile)).toBe('dashboard.columnYvsYminus1 (A2) · CHF'));
    // Column 3 runs the other way: only the line that shrinks on column 1 grows on it.
    expect(await within(tile).findByText('Opex shrinks')).toBeInTheDocument();
    expect(within(tile).queryByText('Opex grows')).not.toBeInTheDocument();
  });

  const filtersOf = (el: Element) => JSON.parse(new URLSearchParams(el.getAttribute('href')!.split('?')[1]).get('filters')!);

  it("shows the user's lines per role, each row opening the list on that role and name", async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: MY_BUDGET });
    const itOwner = await within(tile).findByRole('link', { name: /roles\.itOwner/ });
    expect(itOwner.getAttribute('href')!.split('?')[0]).toBe('/ops/budget');
    expect(filtersOf(itOwner)).toEqual({ owner_it_name: { filterType: 'set', values: ['Thomas Berger'] } });
    expect(itOwner).toHaveTextContent('3k');
    const business = within(tile).getByRole('link', { name: /roles\.businessOwner/ });
    expect(filtersOf(business)).toEqual({ owner_business_name: { filterType: 'set', values: ['Thomas Berger'] } });
    expect(business).toHaveTextContent('1k');
    expect(filtersOf(within(tile).getByRole('link', { name: /roles\.budgetHolder/ })))
      .toEqual({ budget_holder_name: { filterType: 'set', values: ['Thomas Berger'] } });
    // Each count and sum uses the link's filter, on the lines the list shows by default, this year's
    // default column; the same request ranks the role's three largest lines.
    expect(aggregateCalls('/budget-lines/summary/aggregate')).toContainEqual({
      query: { filters: { owner_it_name: { filterType: 'set', values: ['Thomas Berger'] } }, status: 'enabled' },
      spec: {
        groupBy: ['id', 'product_name', 'item_number'],
        measures: [{ id: 'value', fn: 'sum', field: 'yBudget' }],
        order: [{ by: 'measure', id: 'value', dir: 'DESC' }],
        limit: 3,
      },
    });
  });

  it("lists the user's three largest lines under the roles, each opening its line, with no request of its own", async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: MY_BUDGET });
    await within(tile).findByText('dashboard.myBudget.myLines');
    const lines = within(tile).getAllByRole('link').filter((link) => link.getAttribute('href')!.startsWith('/ops/budget/BL-'));
    // BL-21 (IT owner, 3k), BL-23 (business owner and budget holder, once), BL-25 (IT owner, 0.4k); BL-26 (0.2k) stays out.
    expect(lines.map((link) => link.getAttribute('href'))).toEqual(['/ops/budget/BL-21', '/ops/budget/BL-23', '/ops/budget/BL-25']);
    expect(lines.map((link) => link.textContent)).toEqual(['BL-21Opex grows3k', 'BL-23Opex shrinks1k', 'BL-25Opex cut0k']);
    // BL-26 is outside the three. A rate it lacks is still named: the notice reads the whole role, not the slice.
    expect(lines.map((link) => link.getAttribute('href'))).not.toContain('/ops/budget/BL-26');
    // The three role requests only: one per role.
    const roleRequests = aggregateCalls('/budget-lines/summary/aggregate').filter((body) => body.query.filters && body.spec.measures.length);
    expect(roleRequests).toHaveLength(3);
    expect(summaryCalls('/budget-lines/summary').some((p) => p.limit === 3)).toBe(false);
  });

  it('names under my lines a line the three largest leave out when it has no rate', async () => {
    const Y = new Date().getFullYear();
    const base = post.getMockImplementation() as (url: string, body: any) => Promise<{ data: Record<string, unknown> }>;
    post.mockImplementation(async (url: string, body: any) => {
      const answer = await base(url, body);
      const roleSum = body.spec?.measures?.length > 0 && body.spec?.limit === 3;
      if (roleSum) return { data: { ...answer.data, fxMissing: [{ currency: 'ZAR', year: Y, lines: 1 }] } };
      return answer;
    });
    renderPage();
    const tile = await screen.findByRole('region', { name: MY_BUDGET });
    await within(tile).findByText('dashboard.myBudget.myLines');
    const lines = within(tile).getAllByRole('link').filter((link) => link.getAttribute('href')!.startsWith('/ops/budget/BL-'));
    expect(lines.map((link) => link.getAttribute('href'))).toEqual(['/ops/budget/BL-21', '/ops/budget/BL-23', '/ops/budget/BL-25']);
    expect(await within(tile).findByRole('status')).toHaveTextContent('shared.fxMissing.excluding');
  });

  it('shows a role without lines as plain text, and one line when the user has none', async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: MY_BUDGET });
    await within(tile).findByRole('link', { name: /roles\.itOwner/ });
    fireEvent.click(within(tile).getByRole('tab', { name: 'operations.scope.capex' }));
    // No CAPEX line in Thomas Berger's name.
    expect(await within(tile).findByText('dashboard.myBudget.none')).toBeInTheDocument();
    expect(within(tile).queryByRole('link')).not.toBeInTheDocument();
    expect(within(tile).queryByText('dashboard.myBudget.myLines')).not.toBeInTheDocument();
    // A type goes as a filter of the unified list, whose numbers are the BL references.
    expect(aggregateCalls('/budget-lines/summary/aggregate').map((body) => body.query)).toContainEqual({
      filters: { owner_it_name: { filterType: 'set', values: ['Thomas Berger'] }, nature: { filterType: 'set', values: ['capex'] } },
      status: 'enabled',
    });
    expect(aggregateCalls('/capex-items/summary/aggregate').some((body) => body.spec.measures.length > 0)).toBe(false);
  });

  it('ranks this year by cost center, lines without one included, each row opening the list on it', async () => {
    renderPage();
    const tile = await screen.findByRole('region', { name: BY_COST_CENTER });
    const first = await within(tile).findByRole('link', { name: /IT-1 · Infrastructure/ });
    expect(first.getAttribute('href')!.split('?')[0]).toBe('/ops/budget');
    expect(filtersOf(first)).toEqual({ cost_center_label: { filterType: 'set', values: ['IT-1 · Infrastructure'] } });
    expect(first).toHaveTextContent('3k');
    const none = within(tile).getByRole('link', { name: /dashboard\.noCostCenter/ });
    expect(filtersOf(none)).toEqual({ cost_center_label: { filterType: 'set', values: [null] } });
    const rows = within(tile).getAllByRole('link').map((el) => el.textContent);
    expect(rows).toEqual(['dashboard.noCostCenter5k', 'IT-1 · Infrastructure3k', 'IT-2 · Workplace1k']);
    // Every line has a rate: no notice.
    expect(within(tile).queryByRole('status')).toBeNull();
    expect(aggregateCalls('/budget-lines/summary/aggregate')).toContainEqual({
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

  it('names under my budget and the cost centers the lines they leave out without an exchange rate', async () => {
    const Y = new Date().getFullYear();
    const base = post.getMockImplementation() as (url: string, body: any) => Promise<{ data: Record<string, unknown> }>;
    post.mockImplementation(async (url: string, body: any) => {
      const answer = await base(url, body);
      const roleSum = body.spec.measures.length > 0 && 'owner_it_name' in (body.query.filters ?? {});
      const byCostCenter = body.spec.groupBy[0] === 'cost_center_label';
      if (roleSum) return { data: { ...answer.data, fxMissing: [{ currency: 'GBP', year: Y, lines: 1 }] } };
      if (byCostCenter) return { data: { ...answer.data, fxMissing: [{ currency: 'JPY', year: Y, lines: 2 }] } };
      return answer;
    });
    renderPage();
    const mine = await screen.findByRole('region', { name: MY_BUDGET });
    await within(mine).findByRole('link', { name: /roles\.itOwner/ });
    expect(await within(mine).findByRole('status')).toHaveTextContent('shared.fxMissing.excluding');
    const costCenters = screen.getByRole('region', { name: BY_COST_CENTER });
    expect(await within(costCenters).findByRole('status')).toHaveTextContent('shared.fxMissing.excluding');
  });

  it('counts the lines without a cost center and without next year on the default column, with links', async () => {
    setBudgetColumns({ labels: TENANT_NAMES, enabled: ALL_SHOWN, default_column: 'forecast' });
    renderPage();
    const tile = await screen.findByRole('region', { name: 'dashboard.dataHygiene' });
    const noCostCenter = await within(tile).findByLabelText('dashboard.hygiene.noCostCenter, ops:operations.scope.opex: 3');
    expect(filtersOf(noCostCenter)).toEqual({ cost_center_label: { filterType: 'set', values: [null] } , nature: { filterType: 'set', values: ['opex'] } });
    expect(within(tile).getByLabelText('dashboard.hygiene.noCostCenter, ops:operations.scope.capex: 0')).not.toHaveAttribute('href');
    // Next year's amount of the default column (column 3 here) is zero: no version that year reads zero.
    const noNextYear = await within(tile).findByLabelText('dashboard.hygiene.noBudgetNextYear (A2), ops:operations.scope.capex: 2');
    expect(noNextYear.getAttribute('href')!.split('?')[0]).toBe('/ops/budget');
    expect(filtersOf(noNextYear)).toEqual({ yPlus1Forecast: { filterType: 'number', type: 'equals', filter: 0 } , nature: { filterType: 'set', values: ['capex'] } });
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
    expect(params.sort).toBe('next_due_date:ASC');
    expect(JSON.parse(params.filters)).toEqual({ next_due_date: { filterType: 'date', type: 'greaterThanOrEqual', dateFrom: today } });
  });

  it('asks for no top items before the setting is loaded', async () => {
    setBudgetColumns({}, false);
    renderPage();
    await screen.findByRole('region', { name: 'dashboard.dataHygiene' });
    await waitFor(() => expect(summaryCalls('/budget-lines/summary').some((p) => p.sort === 'updated_at:DESC')).toBe(true));
    expect(summaryCalls('/budget-lines/summary').some((p) => /^y[A-Z]/.test(String(p.sort)))).toBe(false);
  });
  it('uses the saved order and omits a hidden tile after loading the server settings', async () => {
    savedDashboard = { tiles: ALL_TILES.map((tile) => ({ ...tile, enabled: tile.id !== 'hygiene', order: 10 - tile.order })) };
    renderPage();
    await screen.findByRole('region', { name: 'dashboard.budgetSnapshot' });
    expect(screen.queryByRole('region', { name: 'dashboard.dataHygiene' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('region').map((tile) => tile.getAttribute('aria-label'))).toEqual([
      BY_COST_CENTER, 'dashboard.nextRenewals', MY_BUDGET,
      'dashboard.recentUpdates', TOP_ITEMS, 'dashboard.budgetSnapshot',
    ]);
  });

  it('keeps only the selected amount column and drops it when the tenant disables it', async () => {
    savedDashboard = { tiles: DEFAULT_BUDGET_TILES.map((tile) => ({ ...tile, config: tile.id === 'budget' ? { columns: ['budget', 'forecast'] } : tile.config })) };
    setBudgetColumns({ labels: TENANT_NAMES, enabled: { ...ALL_SHOWN, forecast: false } });
    const original = get.getMockImplementation()! as (...args: any[]) => any;
    get.mockImplementation((url: string, options?: any) => url.endsWith('/summary/totals') ? Promise.resolve({ data: { yBudget: 9000, yForecast: 5000 } }) : original(url, options));
    renderPage();
    const tile = await screen.findByRole('region', { name: 'dashboard.budgetSnapshot' });
    await within(tile).findByText('A0');
    expect(within(tile).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['labels.year', 'ops:budget.type', 'A0']);
  });

});
