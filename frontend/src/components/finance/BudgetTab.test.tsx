import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { CAPEX_FINANCE_CONFIG, OPEX_FINANCE_CONFIG, type FinanceModuleConfig } from './config';
import { KanapDialogProvider } from '../design';

// A stable `t`: the component's loader depends on it, like react-i18next's own.
// Period, column and label texts come from the real English strings so the
// captions can be read; every other key comes back as itself.
vi.mock('react-i18next', async () => {
  const i18next = (await import('i18next')).default;
  const enOps = (await import('../../locales/en/ops.json')).default;
  const real = i18next.createInstance();
  await real.init({ lng: 'en', resources: { en: { ops: enOps } }, defaultNS: 'ops', interpolation: { escapeValue: false } });
  const t = (rawKey: string, options?: unknown) => {
    const key = rawKey.replace(/^ops:/, '');
    return key.startsWith('budgetTab.') || key.startsWith('operations.') || key.endsWith('.budget.clearColumnConfirm')
      ? real.t(key, options as Record<string, unknown>)
      : rawKey;
  };
  const translation = { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

vi.mock('../../i18n/useLocale', () => ({
  useLocale: () => 'en',
}));

vi.mock('./BudgetTrendChart', () => ({
  default: () => null,
}));

// The tenant's column settings, set per test (every column shown unless a test says otherwise).
const columnsSetting = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../../hooks/useBudgetColumns', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../hooks/useBudgetColumns')>();
  const { useTranslation } = await import('react-i18next');
  let cache: { settings: unknown; value: ReturnType<typeof mod.resolveBudgetColumns> } | null = null;
  return {
    ...mod,
    useBudgetColumns: () => {
      const { t } = useTranslation();
      if (!cache || cache.settings !== columnsSetting.current) {
        cache = { settings: columnsSetting.current, value: mod.resolveBudgetColumns(columnsSetting.current as never, t) };
      }
      return cache.value;
    },
  };
});

// The tenant's working-day calendars, set per test (`failed`: the list could not be loaded).
const calendarsState = vi.hoisted(() => ({ list: [] as unknown[], failed: false }));
vi.mock('../../hooks/useWorkingDayProfiles', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../hooks/useWorkingDayProfiles')>();
  return {
    ...mod,
    useWorkingDayProfiles: () => mod.buildWorkingDayProfiles(calendarsState.list as never, true, calendarsState.failed),
  };
});

// The viewer's permissions: member of the calendars unless a test says otherwise; signed in as
// `userId` when a test sets one.
const permissions = vi.hoisted(() => ({ calendarsMember: true, userId: null as string | null }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string) => resource !== 'working_day_profiles' || permissions.calendarsMember,
    profile: permissions.userId ? { id: permissions.userId } : null,
  }),
}));

import api from '../../api';
import BudgetTab, { BudgetTabHandle } from './BudgetTab';
import type { LinePayload, RoundInput, RoundLine } from './roundPeriod';
import { DEFAULT_BUDGET_COLUMNS, type BudgetColumnsSettings } from '../../services/budgetColumns';
import { allocationsSnapshotKey } from './allocationsCache';
import type { HeldBudgetChoices } from './heldChoices';

const ALL_SHOWN: BudgetColumnsSettings = {
  ...DEFAULT_BUDGET_COLUMNS,
  enabled: { planned: true, committed: true, forecast: true, actual: true, expected_landing: true },
};
beforeEach(() => {
  columnsSetting.current = ALL_SHOWN;
  calendarsState.list = [];
  calendarsState.failed = false;
  permissions.calendarsMember = true;
  permissions.userId = null;
  try { window.localStorage.clear(); } catch { /* none */ }
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
  mocked.get.mockReset();
  mocked.post.mockReset();
  mocked.patch.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// jsdom here ships without localStorage.
if (!window.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => { store.set(key, String(value)); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() { return store.size; },
    },
  });
}

const YEAR = 2026;
const BULK = '/spend-versions/v1/amounts/bulk-upsert';
const VERSIONS = '/spend-items/item-1/versions';
const theme = createAppTheme('light');
const mocked = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
};

type Grain = 'annual' | 'monthly';
type FrozenColumn = 'budget' | 'revision' | 'forecast' | 'actual' | 'landing';

function period(month: number) {
  return `${YEAR}-${String(month).padStart(2, '0')}-01`;
}

type ServedMonth = { period: string } & Record<string, string>;
const COLUMNS = ['planned', 'committed', 'forecast', 'actual', 'expected_landing'] as const;

/** Bodies the server refused (a 409 of a test): they changed nothing. */
const refusedBodies = new WeakSet<object>();
/** Served months a test changed in place (someone else's write): totals are summed again. */
const changedByOthers = new WeakSet<object>();

/** The monthly bodies posted to the bulk route so far (amounts and lines change what a test says). */
function savedAmountBodies(): Array<Record<string, any>> {
  return mocked.post.mock.calls
    .filter(([url, body]) => String(url).endsWith('/amounts/bulk-upsert') && !refusedBodies.has(body) && body?.kind === 'monthly')
    .map(([, body]) => body);
}

/** The months as the server holds them after the bodies: cells as sent. */
function replayWrites(initial: ServedMonth[], bodies: Array<Record<string, any>>): ServedMonth[] {
  const months: ServedMonth[] = Array.from({ length: 12 }, (_, i) => ({
    period: period(i + 1),
    ...Object.fromEntries(COLUMNS.map((c) => [c, '0'])),
    ...(initial.find((row) => row.period === period(i + 1)) ?? {}),
  }));
  for (const body of bodies) {
    for (const row of body.months) {
      const month = months.find((m) => m.period === row.period);
      if (!month) continue;
      for (const c of COLUMNS) if (row[c] !== undefined) month[c] = String(row[c]);
    }
  }
  return months;
}

/** Yearly totals summed in cents, as the server does. */
function totalsOf(months: ServedMonth[]) {
  return Object.fromEntries(COLUMNS.map((c) => [c, months.reduce((sum, m) => sum + Math.round(Number(m[c] || 0) * 100), 0) / 100]));
}

/** A posted body without the base it carries (what the edit started from, lot 3D): the tests of what is written. */
function written(body: Record<string, unknown>) {
  const { base: _base, ...rest } = body ?? {};
  return rest;
}

/** Mocked API; `state.frozen` is read on every freeze-state fetch, so a test can freeze a column midway. */
function setupApi({ grain = 'annual', frozen = [], empty = false, noVersion = false, roundInputs, monthValues = {}, budgetRev }: {
  grain?: Grain;
  /** The version's counter (lot 3G), when a test reads it. */
  budgetRev?: number;
  /** The item has no version for the year yet. */
  noVersion?: boolean;
  frozen?: FrozenColumn[];
  /** The version holds no amount at all. */
  empty?: boolean;
  /** Stored periods returned with the amounts (omitted: the field is absent). */
  roundInputs?: RoundInput[];
  /** Replaces the stored value of every month for these columns. */
  monthValues?: Partial<Record<'planned' | 'committed' | 'actual' | 'expected_landing' | 'forecast', string>>;
} = {}) {
  const version = { id: 'v1', input_grain: grain, budget_year: YEAR, ...(budgetRev !== undefined ? { budget_rev: budgetRev } : {}) };
  const items: ServedMonth[] = empty ? [] : Array.from({ length: 12 }, (_, i) => ({
    period: period(i + 1),
    planned: '1000',
    committed: '900',
    actual: '800',
    expected_landing: '700',
    forecast: '600',
    ...monthValues,
  }));
  // `roundInputs` and `items`: what the server holds now (a test changes them to model someone else's write).
  const state = { frozen: [...frozen], roundInputs, items };
  const slot = (col: FrozenColumn) => ({ frozen: state.frozen.includes(col), frozenAt: null, frozenBy: null });
  const scope = () => ({ budget: slot('budget'), revision: slot('revision'), forecast: slot('forecast'), actual: slot('actual'), landing: slot('landing') });
  mocked.get.mockImplementation(async (url: string) => {
    if (url === VERSIONS) return { data: noVersion ? [] : [version] };
    if (url === '/spend-versions/v1/amounts') {
      const served = state.roundInputs ? { round_inputs: state.roundInputs } : {};
      // Every save reloads the year (lot 3D): the server answers what the saves sent.
      const after = replayWrites(state.items, savedAmountBodies());
      return { data: { items: after, totals: totalsOf(after), year: YEAR, ...served } };
    }
    if (url === '/freeze-states') {
      return {
        data: {
          year: YEAR,
          entries: [],
          summary: {
            year: YEAR,
            scopes: {
              opex: scope(),
              capex: scope(),
              companies: { frozen: false, frozenAt: null, frozenBy: null },
              departments: { frozen: false, frozenAt: null, frozenBy: null },
            },
          },
        },
      };
    }
    throw new Error(`unexpected GET ${url}`);
  });
  mocked.post.mockImplementation(async (url: string) => (
    url === VERSIONS ? { data: { id: 'v1', input_grain: 'annual', budget_year: YEAR } } : { data: { updated: 12 } }
  ));
  return state;
}

function renderTab(
  year = YEAR,
  dates: { effectiveStart?: string; endOfValidity?: string; payingCompanyCountry?: string } = {},
  config: FinanceModuleConfig = OPEX_FINANCE_CONFIG,
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  extra: { held?: React.MutableRefObject<HeldBudgetChoices | null>; onYearChange?: (y: number) => void; availableYears?: number[]; onBudgetRev?: (year: number, rev: number | null) => void } = {},
) {
  const ref = React.createRef<BudgetTabHandle>();
  const ui = (y: number) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <KanapDialogProvider>
            <BudgetTab
              ref={ref} id="item-1" year={y} currency="EUR" onYearChange={extra.onYearChange ?? (() => undefined)} config={config}
              held={extra.held} availableYears={extra.availableYears} onBudgetRev={extra.onBudgetRev}
              effectiveStart={dates.effectiveStart} endOfValidity={dates.endOfValidity} payingCompanyCountry={dates.payingCompanyCountry}
            />
          </KanapDialogProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  const view = render(ui(year));
  return { ...view, ref, queryClient, rerenderYear: (y: number) => view.rerender(ui(y)) };
}

const bulkCalls = () => mocked.post.mock.calls.filter(([url]) => url === BULK);
const freezeLoads = () => mocked.get.mock.calls.filter(([url]) => url === '/freeze-states').length;
const amountLoads = () => mocked.get.mock.calls.filter(([url]) => url === '/spend-versions/v1/amounts').length;

const editor = () => screen.getByTestId('column-editor');
/** Wait until the amounts have been fetched `loads` times in all and the editor shows them. */
async function waitForAmounts(loads = 1) {
  await waitFor(() => {
    expect(amountLoads()).toBeGreaterThanOrEqual(loads);
    expect(editor()).toHaveAttribute('data-ready', 'true');
  });
}

const card = (measure: string) => screen.getByTestId(`budget-column-${measure}`);
/** A click on a column's card: it becomes the active column. */
const pick = (measure: string) => fireEvent.click(card(measure));
const activeColumn = () => COLUMNS.find((c) => screen.queryByTestId(`budget-column-${c}`)?.getAttribute('aria-pressed') === 'true');
const modeTab = (name: 'Amount' | 'Quantity and price' | 'By month') => within(editor()).getByRole('tab', { name });
const switchButton = () => screen.getByRole('button', { name: 'Switch' });

/** A month of a column in the result table. */
const tableCell = (measure: string, month: number) => screen.getByTestId(`cell-${measure}-${month}`);
/** The field of a month, when the column is typed by month and active; null otherwise. */
const monthInput = (measure: string, month: number) => tableCell(measure, month).querySelector('input');
/** A month as the table shows it: the field's value, else the text. */
const cellValue = (measure: string, month: number) => monthInput(measure, month)?.value ?? tableCell(measure, month).textContent;
/** Types a month: a click in its cell makes the column active and typed by month (confirmed when it holds amounts). */
function typeMonth(measure: string, month: number, value: string) {
  if (!monthInput(measure, month)) {
    fireEvent.click(tableCell(measure, month));
    const confirm = screen.queryByRole('button', { name: 'Switch' });
    if (confirm) fireEvent.click(confirm);
  }
  const input = monthInput(measure, month);
  if (!input) throw new Error(`${measure} is not typed by month`);
  fireEvent.change(input, { target: { value } });
}

const amountField = () => screen.getByPlaceholderText('opex.budget.spreadPlaceholder');
/** Types an amount in the amount editor and leaves the field, as a user does. */
function typeAmount(value: string) {
  fireEvent.change(amountField(), { target: { value } });
  fireEvent.blur(amountField());
}
/** Types a date in a DateEUField the way a user does. */
function typeDate(input: HTMLElement, ddmmyyyy: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: ddmmyyyy } });
  fireEvent.blur(input);
}
const dateFields = () => within(editor()).getAllByPlaceholderText('labels.datePlaceholder');
/** Lets queued writes and reloads run. */
async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(30); });
}

async function flush(ref: React.RefObject<BudgetTabHandle>) {
  let ok = true;
  await act(async () => { ok = (await ref.current?.flush()) ?? true; });
  return ok;
}

const record = (over: Partial<RoundInput>): RoundInput => ({
  measure: 'planned',
  period_start: '2026-04-01',
  period_end: '2026-12-31',
  method: 'spread',
  spread_profile_name: 'flat',
  last_calculation: null,
  updated_at: '2026-09-26T10:00:00Z',
  updated_by: null,
  fte: null,
  lines: [],
  ...over,
});

/** How a column is built, as its card says it: one text line each. */
const periodLine = (measure: string) => screen.getByTestId(`period-line-${measure}`);
const captionLines = (measure: string) => Array.from(periodLine(measure).children).map((line) => line.textContent);

const calendar = (id: string, name: string, country: string | null) => ({
  id, code: id.toUpperCase(), name, description: null, days_by_year: {}, status: 'enabled', disabled_at: null,
  country_iso: country, region_code: null, country_name: null, region_name: null,
});
const FRANCE = calendar('cal-fr', 'France', 'FR');
const UNITED_STATES = calendar('cal-us', 'United States', 'US');
const MARCH_TO_DECEMBER = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// fried's test line: a bundle of 100 days at 600 per day, March to December.
const storedLine = (over: Partial<RoundLine> = {}): RoundLine => ({
  id: 'line-1',
  sort: 0,
  label: 'US Managed IT Services',
  quantity_unit: 'days',
  quantity: '100.000',
  unit_price: '600.0000',
  price_basis: 'per_day',
  frequency: 'once',
  days_per_month: null,
  period_start: '2026-03-01',
  period_end: '2026-12-31',
  working_day_profile_id: 'cal-us',
  working_day_profile_code: 'CAL-US',
  working_day_profile_name: 'United States',
  ...over,
});

const linesRecord = (lines: RoundLine[] = [storedLine()], over: Partial<RoundInput> = {}): RoundInput => record({
  method: 'computed',
  period_start: '2026-03-01',
  period_end: '2026-12-31',
  spread_profile_name: null,
  fte: '0.40',
  lines,
  last_calculation: {
    kind: 'computed', total: '60000.00', fte: '0.40', fte_period: '0.48', month_amounts: [], fte_months: [], active_months: MARCH_TO_DECEMBER,
    lines: lines.map((line) => ({
      label: line.label, quantity_unit: line.quantity_unit, quantity: line.quantity, unit_price: line.unit_price,
      price_basis: line.price_basis, frequency: line.frequency, days_per_month: line.days_per_month,
      period_start: line.period_start, period_end: line.period_end,
      working_day_profile_id: line.working_day_profile_id, working_day_profile_code: line.working_day_profile_code,
      working_day_profile_name: line.working_day_profile_name, active_months: MARCH_TO_DECEMBER,
      day_counts: null, total_days: null, month_amounts: [], fte_months: [], fte: '0.40', fte_period: '0.48', total: '60000.00',
    })),
  },
  ...over,
});

/** Every POST answers like bulk-upsert, except the version creation. */
function routePosts(bulk: (body: Record<string, unknown>) => Promise<unknown> = async () => ({ updated: 12 })) {
  mocked.post.mockImplementation(async (url: string, body: Record<string, unknown>) => {
    if (url === VERSIONS) return { data: { id: 'v1', input_grain: 'annual', budget_year: YEAR } };
    return { data: await bulk(body) };
  });
}

const leave = (input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

/* ---- The structure: column, how it is built, result ---- */

describe('BudgetTab columns and cards', () => {
  it('one card per shown column, in the fixed order, under the tenant names; the same columns in the result', async () => {
    columnsSetting.current = { ...DEFAULT_BUDGET_COLUMNS, labels: { ...DEFAULT_BUDGET_COLUMNS.labels, committed: 'Révision 6+6', actual: 'Révision 9+3' } };
    setupApi();
    const { container } = renderTab();
    await waitForAmounts();

    expect(COLUMNS.filter((c) => screen.queryByTestId(`budget-column-${c}`))).toEqual(['planned', 'committed', 'actual', 'expected_landing']);
    expect(within(card('actual')).getByText('Révision 9+3')).toBeInTheDocument();
    expect(card('planned')).toHaveTextContent('12 000');
    const heads = Array.from(container.querySelectorAll('thead th')).slice(1).map((th) => th.textContent);
    expect(heads).toEqual(['Budget', 'Révision 6+6', 'Révision 9+3', 'Expected landing']);
    // The quarter and year totals follow the same columns.
    expect(container.querySelectorAll('tfoot td')).toHaveLength(1 + 4);
    expect(screen.getByTestId('total-committed')).toHaveTextContent('10 800');
    // A hidden column is drawn nowhere.
    expect(screen.queryByTestId('budget-column-forecast')).toBeNull();
    expect(screen.queryByTestId('cell-forecast-1')).toBeNull();
  });

  it('opens on the first column that is not frozen, whatever its name or rank, and focuses nothing', async () => {
    setupApi({ frozen: ['budget', 'revision'] });
    renderTab();
    await waitForAmounts();
    await waitFor(() => expect(activeColumn()).toBe('forecast'));
    expect(editor()).toHaveTextContent('Forecast 2026');
    // No focus at load (charter): the user orients first.
    expect(document.activeElement).toBe(document.body);
  });

  it('opens on the first column when every column is frozen', async () => {
    setupApi({ frozen: ['budget', 'revision', 'forecast', 'actual', 'landing'] });
    renderTab();
    await waitForAmounts();
    await waitFor(() => expect(freezeLoads()).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(editor()).toHaveAttribute('data-frozen', 'true'));
    expect(activeColumn()).toBe('planned');
    expect(within(card('planned')).getByTestId('LockOutlinedIcon')).toBeInTheDocument();
  });

  it('a click on a card makes the column active, shows its total and puts the cursor in its amount', async () => {
    setupApi();
    renderTab();
    await waitForAmounts();
    expect(amountField()).toHaveValue('12 000');

    pick('committed');
    expect(card('committed')).toHaveAttribute('aria-pressed', 'true');
    expect(card('planned')).toHaveAttribute('aria-pressed', 'false');
    expect(editor()).toHaveTextContent('Revision 2026');
    expect(amountField()).toHaveValue('10 800');
    expect(document.activeElement).toBe(amountField());
    pick('actual');
    expect(amountField()).toHaveValue('9 600');
    // Picking a column writes nothing.
    await settle();
    expect(bulkCalls()).toHaveLength(0);
  });

  it('with one column there are no cards: the editor shows it directly, with how it is built', async () => {
    columnsSetting.current = {
      ...DEFAULT_BUDGET_COLUMNS,
      labels: { ...DEFAULT_BUDGET_COLUMNS.labels, planned: 'Révision 9+3' },
      enabled: { planned: true, committed: false, forecast: false, actual: false, expected_landing: false },
    };
    setupApi({ roundInputs: [record({ period_start: '2026-01-01' })] });
    const { container } = renderTab();
    await waitForAmounts();

    expect(screen.queryByTestId('budget-column-planned')).toBeNull();
    expect(editor()).toHaveTextContent('Révision 9+3 2026');
    expect(within(editor()).getByTestId('period-line-planned')).toHaveTextContent('Spread flat');
    expect(Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual(['opex.budget.month', 'Révision 9+3']);
    // No other column to use the amount for.
    expect(screen.queryByRole('button', { name: 'Use for other columns too…' })).toBeNull();
    typeAmount('6000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(written(bulkCalls()[0][1])).toMatchObject({ kind: 'annual', totals: { planned: '6000.00' } });
    expect(bulkCalls()[0][1].also_measures).toBeUndefined();
  });

  it('every card says how its column is built: the four ways, a period, an empty column', async () => {
    setupApi({
      monthValues: { forecast: '0' },
      roundInputs: [
        record({ period_start: '2026-01-01' }),
        record({ measure: 'committed', method: 'copied', period_start: '2026-01-01', last_calculation: { kind: 'copy', source_year: 2025, source_measure: 'planned', uplift_pct: '2', source_total: '1.00', total: '1.00', source_method: 'computed' } }),
        record({ measure: 'actual', method: 'manual', period_start: '2026-07-01' }),
        linesRecord(undefined, { measure: 'expected_landing' }),
      ],
    });
    renderTab(YEAR, { effectiveStart: '2026-04-01' });
    await waitForAmounts();

    expect(captionLines('planned')).toEqual(['Spread flat', '12 months, January to December']);
    expect(captionLines('committed')).toEqual(['Copied from Budget 2025 +2%', '12 months, January to December']);
    expect(captionLines('actual')).toEqual(['Edited by hand', '6 months, July to December']);
    expect(captionLines('expected_landing')).toEqual(['Quantity and price · 1 line · 0.40 FTE', '10 months, March to December']);
    // Forecast holds nothing yet.
    expect(periodLine('forecast')).toHaveTextContent(/^Not entered yet$/);
  });

  it('a column computed from lines shows them in its card tooltip', async () => {
    setupApi({ roundInputs: [linesRecord()] });
    renderTab();
    await waitForAmounts();
    expect(captionLines('planned')).toEqual(['Quantity and price · 1 line · 0.40 FTE', '10 months, March to December']);
    fireEvent.mouseOver(periodLine('planned'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('US Managed IT Services: 100 days × 600 per day over the period, Mar to Dec');
  });

  it('a column that keeps its lines after a spread shows the lines, then the spread, then the period', async () => {
    setupApi({
      roundInputs: [linesRecord(undefined, {
        method: 'spread',
        spread_profile_name: '4-4-5',
        last_calculation: { kind: 'annual', total: '60000.00', profile: '4-4-5', active_months: MARCH_TO_DECEMBER, weights: [] },
      })],
    });
    renderTab();
    await waitForAmounts();
    expect(captionLines('planned')).toEqual(['Quantity and price · 1 line · 0.40 FTE ·', 'Spread 4-4-5', '10 months, March to December']);
  });

  it('the line dates leaving no month of the year say so on the card and in the editor; a period chosen then writes', async () => {
    setupApi({ empty: true });
    renderTab(YEAR, { effectiveStart: '2027-02-01' });
    await waitForAmounts();

    expect(periodLine('planned')).toHaveTextContent("No month of 2026 is within the line's dates.");
    expect(periodLine('actual')).toHaveTextContent("No month of 2026 is within the line's dates.");
    expect(within(editor()).getByTestId('spread-notes')).toHaveTextContent("No month of 2026 is within the line's dates.");
    typeAmount('5000');
    await settle();
    expect(bulkCalls()).toHaveLength(0);
    // The whole year, chosen by the user, takes the amount.
    fireEvent.click(screen.getByRole('radio', { name: 'Whole year' }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(written(bulkCalls()[0][1])).toMatchObject({ totals: { planned: '5000.00' }, period_start: '2026-01-01', period_end: '2026-12-31' });
  });

  it('the save response refreshes the card', async () => {
    const server = setupApi({ empty: true });
    routePosts(async () => {
      server.roundInputs = [record({})];
      return { updated: 9, round_inputs: [record({})] };
    });
    renderTab(YEAR, { effectiveStart: '2026-04-01' });
    await waitForAmounts();
    typeAmount('12000');
    await waitFor(() => expect(captionLines('planned')).toEqual(['Spread flat', '9 months, April to December']));
  });

  it('a year switch shows the new year once it is loaded, and forgets the modes picked', async () => {
    setupApi({ roundInputs: [record({})] });
    const { rerenderYear } = renderTab(YEAR, { effectiveStart: '2026-04-01' });
    await waitForAmounts();
    fireEvent.click(modeTab('By month'));
    fireEvent.click(switchButton());
    expect(modeTab('By month')).toHaveAttribute('aria-selected', 'true');

    rerenderYear(YEAR + 1);
    // The 2026 period is never read against 2027 (it would give "No month of 2027 ...").
    expect(screen.queryByText(/No month of 2027/)).not.toBeInTheDocument();
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/freeze-states', { params: { year: YEAR + 1 } }));
    // No version for 2027: nothing to read, an empty year.
    await waitForAmounts();
    expect(editor()).toHaveTextContent('Budget 2027');
    expect(modeTab('Amount')).toHaveAttribute('aria-selected', 'true');
    expect(card('planned')).toHaveTextContent('0');
  });
});

/* ---- Amount: one yearly amount, when, how it is spread ---- */

describe('BudgetTab amount', () => {
  it('writes the active column only: the amount on leaving the field, the distribution on change, each with the period', async () => {
    setupApi({ empty: true });
    renderTab(YEAR, { effectiveStart: '2026-04-01' });
    await waitForAmounts();

    // The period starts from the line's dates.
    expect(screen.getByTestId('spread-result')).toHaveTextContent('Enter an amount: it will be spread flat from April to December (9 months).');
    typeAmount('12000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(written(bulkCalls()[0][1])).toEqual({
      kind: 'annual', year: YEAR, totals: { planned: '12000.00' }, spread_profile_name: 'flat', period_start: '2026-04-01', period_end: '2026-12-31',
    });
    // Only the column typed says what it started from.
    expect(bulkCalls()[0][1].base).toEqual({ columns: { planned: { months: Array.from({ length: 12 }, () => '0.00') } } });
    expect(screen.getByTestId('spread-result')).toHaveTextContent('12 000 spread flat from April to December (9 months).');
    await waitFor(() => expect(amountLoads()).toBe(2));

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Distribution' }));
    fireEvent.click(await screen.findByRole('option', { name: 'opex.budget.profile445' }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(2));
    expect(bulkCalls()[1][1]).toMatchObject({ totals: { planned: '12000.00' }, spread_profile_name: '4-4-5', period_start: '2026-04-01' });
    expect(screen.getByTestId('spread-result')).toHaveTextContent('12 000 spread 4-4-5 from April to December (9 months).');
    // Leaving the amount unchanged writes nothing more; nothing is written on the shared version.
    fireEvent.blur(amountField());
    await settle();
    expect(bulkCalls()).toHaveLength(2);
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('a blank or zero amount writes nothing; Enter writes the amount shown', async () => {
    setupApi();
    renderTab();
    await waitForAmounts();
    typeAmount('');
    typeAmount('0');
    await settle();
    expect(bulkCalls()).toHaveLength(0);
    fireEvent.change(amountField(), { target: { value: '12000' } });
    fireEvent.keyDown(amountField(), { key: 'Enter' });
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toMatchObject({ kind: 'annual', totals: { planned: '12000.00' }, spread_profile_name: 'flat' });
  });

  it('When: the whole year, or a period with its dates; the zeroed months, the item dates and the 15th rule', async () => {
    setupApi({ empty: true });
    renderTab(YEAR, { effectiveStart: '2026-04-01' });
    await waitForAmounts();

    expect(screen.getByRole('radio', { name: 'A period' })).toBeChecked();
    expect(screen.getByTestId('spread-notes')).toHaveTextContent('January to March will be set to zero.');
    expect(screen.queryByText("The period goes beyond the line's dates.")).not.toBeInTheDocument();
    const rule = screen.getByLabelText('A month counts when the period covers its 15th.');
    fireEvent.mouseOver(rule);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('A month counts when the period covers its 15th.');

    const [from] = dateFields();
    typeDate(from, '01/02/2026');
    expect(await screen.findByText('January will be set to zero.')).toBeInTheDocument();
    expect(screen.getByText("The period goes beyond the line's dates.")).toBeInTheDocument();
    // No amount yet: the date changes wrote nothing.
    expect(bulkCalls()).toHaveLength(0);
    // A period in which no month counts writes nothing either.
    typeDate(dateFields()[0], '20/12/2026');
    typeAmount('500');
    expect(await screen.findByText('No month counts in this period.')).toBeInTheDocument();
    await settle();
    expect(bulkCalls()).toHaveLength(0);

    // The whole year: no date fields, the twelve months, written at once with the amount typed.
    fireEvent.click(screen.getByRole('radio', { name: 'Whole year' }));
    expect(within(editor()).queryAllByPlaceholderText('labels.datePlaceholder')).toHaveLength(0);
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(written(bulkCalls()[0][1])).toMatchObject({ totals: { planned: '500.00' }, period_start: '2026-01-01', period_end: '2026-12-31' });
    expect(screen.getByTestId('spread-result')).toHaveTextContent('500 spread flat from January to December (12 months).');
    expect(screen.getByText("The period goes beyond the line's dates.")).toBeInTheDocument();
    // A period again: From and To come back on the period shown, nothing is written.
    fireEvent.click(screen.getByRole('radio', { name: 'A period' }));
    expect(dateFields()).toHaveLength(2);
    await settle();
    expect(bulkCalls()).toHaveLength(1);
  });

  it('a column that already holds amounts keeps its stored period; a date change writes its total with the new period', async () => {
    setupApi();
    renderTab(YEAR, { effectiveStart: '2026-04-01' });
    await waitForAmounts();

    expect(periodLine('committed')).toHaveTextContent('12 months, January to December');
    pick('committed');
    expect(amountField()).toHaveValue('10 800');
    // The editor proposes the stored whole year within the line's dates (from April 1), and saves nothing yet.
    expect(screen.getByTestId('spread-notes')).toHaveTextContent('January to March will be set to zero.');
    expect(screen.getAllByText('12 months, January to December')).toHaveLength(5);
    expect(bulkCalls()).toHaveLength(0);

    typeDate(dateFields()[0], '01/07/2026');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(written(bulkCalls()[0][1])).toEqual({
      kind: 'annual', year: YEAR, totals: { committed: '10800.00' }, spread_profile_name: 'flat', period_start: '2026-07-01', period_end: '2026-12-31',
    });
  });

  it('proposes the stored period cut at the end of validity, without saving it on open', async () => {
    setupApi({ roundInputs: [record({ period_start: '2026-01-01', period_end: '2026-12-31' })] });
    const { ref } = renderTab(YEAR, { endOfValidity: '2026-06-30' });
    await waitForAmounts();

    expect(screen.getByTestId('spread-notes')).toHaveTextContent('July to December will be set to zero.');
    // The card still shows the stored period, and opening wrote nothing.
    expect(captionLines('planned')).toEqual(['Spread flat', '12 months, January to December']);
    expect(ref.current!.isDirty()).toBe(false);
    expect(ref.current!.hasPending()).toBe(false);
    typeAmount('6000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toMatchObject({ totals: { planned: '6000.00' }, period_start: '2026-01-01', period_end: '2026-06-30' });
  });

  it('a date change on a 4-4-5 column keeps 4-4-5', async () => {
    setupApi({
      roundInputs: [record({ spread_profile_name: '4-4-5', last_calculation: { kind: 'annual', total: '12000.00', profile: '4-4-5', active_months: [4, 5, 6, 7, 8, 9, 10, 11, 12], weights: [] } })],
    });
    renderTab(YEAR, { effectiveStart: '2026-04-01' });
    await waitForAmounts();
    typeDate(dateFields()[0], '01/05/2026');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toMatchObject({ totals: { planned: '12000.00' }, spread_profile_name: '4-4-5', period_start: '2026-05-01', period_end: '2026-12-31' });
  });

  it('every change saves at once: no Spread, Apply, Reset or Close button', async () => {
    setupApi();
    renderTab();
    await waitForAmounts();
    for (const name of ['Spread', 'Apply', 'Reset', 'common:buttons.close']) {
      expect(within(editor()).queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('the distribution keeps the focus after a choice made with the keyboard', async () => {
    setupApi();
    renderTab();
    await waitForAmounts();
    const distribution = screen.getByRole('combobox', { name: 'Distribution' });
    act(() => { distribution.focus(); });
    fireEvent.keyDown(distribution, { key: 'ArrowDown' });
    await screen.findByRole('listbox');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' });
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toMatchObject({ spread_profile_name: '4-4-5' });
    await settle();
    expect(document.activeElement).toBe(distribution);
  });

  it("a spread forgets the line's cached Allocations year, which shows the year's totals", async () => {
    setupApi();
    const first = renderTab();
    await waitForAmounts();
    const key = allocationsSnapshotKey(OPEX_FINANCE_CONFIG.itemsApi, 'item-1', YEAR);
    const otherYear = allocationsSnapshotKey(OPEX_FINANCE_CONFIG.itemsApi, 'item-1', YEAR + 1);
    first.queryClient.setQueryData(key, { version: null, computed: [], totals: { planned: 12000 } });
    first.queryClient.setQueryData(otherYear, { version: null, computed: [], totals: { planned: 1 } });
    typeAmount('6000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    await settle();
    expect(first.queryClient.getQueryData(key)).toBeUndefined();
    expect(first.queryClient.getQueryData(otherYear)).toBeDefined();
  });

  it('lines kept as a reference show under the amount, with their total, and can be used again', async () => {
    const reference = linesRecord(undefined, {
      method: 'spread',
      spread_profile_name: 'flat',
      last_calculation: {
        kind: 'annual', total: '12000.00', profile: 'flat', active_months: MARCH_TO_DECEMBER, weights: [],
        lines_result: { total: '60000.00', fte: '0.40', fte_period: '0.48', month_amounts: [], fte_months: [], active_months: MARCH_TO_DECEMBER, lines: [] },
      },
    });
    setupApi({ roundInputs: [reference] });
    routePosts();
    renderTab();
    await waitForAmounts();

    expect(modeTab('Amount')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('lines-reference')).toHaveTextContent('1 line kept as a reference (60 000). Use the lines again.');
    fireEvent.click(within(screen.getByTestId('lines-reference')).getByRole('button', { name: 'Use the lines again.' }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toMatchObject({ kind: 'lines', measure: 'planned', lines: [expect.objectContaining({ quantity: '100', unit_price: '600' })] });
    expect(modeTab('Quantity and price')).toHaveAttribute('aria-selected', 'true');
  });
});

/* ---- Modes: how the active column is built ---- */

describe('BudgetTab modes', () => {
  it('the three modes are always offered; on an empty column a mode is taken at once, writing nothing', async () => {
    calendarsState.list = [FRANCE, UNITED_STATES];
    setupApi({ empty: true });
    renderTab();
    await waitForAmounts();

    expect(modeTab('Amount')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(modeTab('Quantity and price'));
    expect(screen.queryByRole('button', { name: 'Switch' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add a line' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('opex.budget.spreadPlaceholder')).toBeNull();

    fireEvent.click(modeTab('By month'));
    expect(editor()).toHaveTextContent('Enter the amounts in the Budget column of the table below.');
    expect(monthInput('planned', 1)).not.toBeNull();
    expect(monthInput('committed', 1)).toBeNull();

    fireEvent.click(modeTab('Amount'));
    expect(amountField()).toBeInTheDocument();
    expect(document.activeElement).toBe(amountField());
    await settle();
    expect(bulkCalls()).toHaveLength(0);
  });

  it('on a column with amounts a mode change asks first and says what changes; Cancel changes nothing', async () => {
    setupApi();
    renderTab();
    await waitForAmounts();

    fireEvent.click(modeTab('By month'));
    expect(screen.getByTestId('mode-switch')).toHaveTextContent('Switch to entry by month? The current months are kept and become editable in the table.');
    expect(monthInput('planned', 1)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.cancel' }));
    expect(screen.queryByTestId('mode-switch')).toBeNull();
    expect(modeTab('Amount')).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(modeTab('Quantity and price'));
    expect(screen.getByTestId('mode-switch')).toHaveTextContent('Switch to quantity and price? The total will come from the lines. The current amount (12 000) will be replaced.');
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.cancel' }));
    await settle();
    expect(bulkCalls()).toHaveLength(0);
  });

  it('by month, confirmed, keeps the months and makes the column editable in the table', async () => {
    setupApi();
    const { ref } = renderTab();
    await waitForAmounts();

    fireEvent.click(modeTab('By month'));
    fireEvent.click(switchButton());
    expect(modeTab('By month')).toHaveAttribute('aria-selected', 'true');
    expect(monthInput('planned', 3)).toHaveValue('1 000');
    // Nothing is written until a month changes.
    await settle();
    expect(bulkCalls()).toHaveLength(0);
    fireEvent.change(monthInput('planned', 3)!, { target: { value: '1500' } });
    await flush(ref);
    expect(written(bulkCalls()[0][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(3), planned: 1500 }] });
  });

  it('back to an amount, confirmed, spreads the current total flat; the lines stay as a reference', async () => {
    setupApi({ roundInputs: [linesRecord(undefined, { method: 'manual' })] });
    routePosts();
    const { ref } = renderTab();
    await waitForAmounts();

    // Edited by hand: by month. March becomes 1 500, 12 500 in all.
    expect(modeTab('By month')).toHaveAttribute('aria-selected', 'true');
    fireEvent.change(monthInput('planned', 3)!, { target: { value: '1500' } });
    await flush(ref);
    expect(bulkCalls()).toHaveLength(1);

    fireEvent.click(modeTab('Amount'));
    expect(screen.getByTestId('mode-switch')).toHaveTextContent('Switch to an amount? The current total (12 500) becomes the amount, spread flat. The lines stay as a reference.');
    fireEvent.click(switchButton());
    await waitFor(() => expect(bulkCalls()).toHaveLength(2));
    expect(written(bulkCalls()[1][1])).toEqual({
      kind: 'annual', year: YEAR, totals: { planned: '12500.00' }, spread_profile_name: 'flat', period_start: '2026-03-01', period_end: '2026-12-31',
    });
    expect(modeTab('Amount')).toHaveAttribute('aria-selected', 'true');
    expect(amountField()).toHaveValue('12 500');
  });

  it('quantity and price, confirmed on lines kept as a reference, uses them again', async () => {
    setupApi({ roundInputs: [linesRecord(undefined, { method: 'manual', last_calculation: null })] });
    routePosts();
    renderTab();
    await waitForAmounts();

    expect(screen.getByTestId('lines-reference')).toHaveTextContent(/^1 line kept as a reference\. Use the lines again\.$/);
    fireEvent.click(modeTab('Quantity and price'));
    expect(screen.getByTestId('mode-switch')).toHaveTextContent('Switch to quantity and price? The total will come from the lines. The line kept as a reference is used again.');
    fireEvent.click(switchButton());
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toMatchObject({ kind: 'lines', measure: 'planned', lines: [expect.objectContaining({ quantity: '100', unit_price: '600' })] });
    expect(modeTab('Quantity and price')).toHaveAttribute('aria-selected', 'true');
  });

  it('the mode follows each column: lines for one computed from them, its own for the others; a pick stays through reloads', async () => {
    setupApi({ roundInputs: [linesRecord(undefined, { measure: 'committed' }), record({ measure: 'actual', method: 'manual', period_start: '2026-01-01' })] });
    routePosts();
    const { ref } = renderTab();
    await waitForAmounts();

    expect(modeTab('Amount')).toHaveAttribute('aria-selected', 'true');
    pick('committed');
    expect(modeTab('Quantity and price')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Description')).toHaveValue('US Managed IT Services');
    pick('actual');
    expect(modeTab('By month')).toHaveAttribute('aria-selected', 'true');

    // Budget by month, picked by the user: kept through a save, its reload and a reload for someone else's change.
    pick('planned');
    fireEvent.click(modeTab('By month'));
    fireEvent.click(switchButton());
    const loads = amountLoads();
    fireEvent.change(monthInput('planned', 3)!, { target: { value: '450' } });
    await flush(ref);
    await waitFor(() => expect(amountLoads()).toBe(loads + 1));
    await settle();
    expect(modeTab('By month')).toHaveAttribute('aria-selected', 'true');
    await act(async () => { await ref.current?.reloadFromServer(); });
    await settle();
    expect(modeTab('By month')).toHaveAttribute('aria-selected', 'true');
    // Back on Revision: its lines.
    pick('committed');
    expect(modeTab('Quantity and price')).toHaveAttribute('aria-selected', 'true');
  });

  it('a column that follows its lines asks before an amount replaces them; nothing is written until confirmed', async () => {
    setupApi({ roundInputs: [linesRecord(), linesRecord(undefined, { measure: 'forecast' })] });
    routePosts();
    renderTab();
    await waitForAmounts();

    expect(modeTab('Quantity and price')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(modeTab('Amount'));
    expect(screen.getByTestId('mode-switch')).toHaveTextContent('Switch to an amount? The current total (12 000) becomes the amount, spread flat. The lines stay as a reference.');
    expect(screen.queryByPlaceholderText('opex.budget.spreadPlaceholder')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.cancel' }));
    await settle();
    expect(bulkCalls()).toHaveLength(0);

    fireEvent.click(modeTab('Amount'));
    fireEvent.click(switchButton());
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(written(bulkCalls()[0][1])).toEqual({
      kind: 'annual', year: YEAR, totals: { planned: '12000.00' }, spread_profile_name: 'flat', period_start: '2026-03-01', period_end: '2026-12-31',
    });
    await settle();
    // Now an amount: a new one spreads at once, on this column only.
    typeAmount('20000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(2));
    expect(written(bulkCalls()[1][1])).toEqual({
      kind: 'annual', year: YEAR, totals: { planned: '20000.00' }, spread_profile_name: 'flat', period_start: '2026-03-01', period_end: '2026-12-31',
    });
  });
});

/* ---- The result month by month ---- */

describe('BudgetTab monthly result', () => {
  it('shows every month, the quarters and the year of each column, read only', async () => {
    setupApi({ monthValues: { forecast: '333.33' } });
    const { container } = renderTab();
    await waitForAmounts();
    expect(cellValue('forecast', 1)).toBe('333.33');
    expect(cellValue('planned', 12)).toBe('1 000');
    expect(screen.getByTestId('total-planned')).toHaveTextContent('12 000');
    expect(Array.from(container.querySelectorAll('tbody tr td:first-child')).map((td) => td.textContent).filter((text) => /^Q/.test(text ?? ''))).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    // No field in the table until a column is typed by month.
    expect(screen.getByTestId('monthly-result').querySelectorAll('input')).toHaveLength(0);
  });

  it('a click in a month of a column with amounts makes it active, asks, then puts the cursor in that month', async () => {
    setupApi();
    renderTab();
    await waitForAmounts();

    fireEvent.click(tableCell('committed', 5));
    expect(activeColumn()).toBe('committed');
    expect(screen.getByTestId('mode-switch')).toHaveTextContent('Switch to entry by month?');
    expect(monthInput('committed', 5)).toBeNull();
    fireEvent.click(switchButton());
    expect(monthInput('committed', 5)).not.toBeNull();
    expect(document.activeElement).toBe(monthInput('committed', 5));
    expect(modeTab('By month')).toHaveAttribute('aria-selected', 'true');
    await settle();
    expect(bulkCalls()).toHaveLength(0);
  });

  it('a click in a month of an empty column switches it to by month at once', async () => {
    setupApi({ monthValues: { actual: '0' } });
    renderTab();
    await waitForAmounts();

    fireEvent.click(tableCell('actual', 7));
    expect(screen.queryByTestId('mode-switch')).toBeNull();
    expect(activeColumn()).toBe('actual');
    expect(document.activeElement).toBe(monthInput('actual', 7));
  });

  it('a click in a month of a frozen column does nothing', async () => {
    setupApi({ frozen: ['forecast'] });
    renderTab();
    await waitForAmounts();
    await waitFor(() => expect(within(card('forecast')).getByTestId('LockOutlinedIcon')).toBeInTheDocument());

    fireEvent.click(tableCell('forecast', 2));
    expect(activeColumn()).toBe('planned');
    expect(screen.queryByTestId('mode-switch')).toBeNull();
    expect(monthInput('forecast', 2)).toBeNull();
  });

  it('only the months changed are saved, on the year shown', async () => {
    setupApi();
    // The tab opens on the next year (no version there), then the user goes to the line's year.
    const { ref, rerenderYear } = renderTab(YEAR + 1);
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/freeze-states', { params: { year: YEAR + 1 } }));
    rerenderYear(YEAR);
    await waitForAmounts();

    typeMonth('committed', 3, '450');
    await flush(ref);
    expect(bulkCalls()).toHaveLength(1);
    expect(written(bulkCalls()[0][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(3), committed: 450 }] });
  });

  it('a month saved is not sent again after a card or a year changes', async () => {
    setupApi();
    const { ref, rerenderYear } = renderTab();
    await waitForAmounts();
    typeMonth('planned', 1, '1500');
    await flush(ref);
    expect(bulkCalls()).toHaveLength(1);

    pick('committed');
    rerenderYear(YEAR + 1);
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/freeze-states', { params: { year: YEAR + 1 } }));
    rerenderYear(YEAR);
    await waitForAmounts(3);
    await flush(ref);
    expect(bulkCalls()).toHaveLength(1);
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('a failed save keeps its months for the next one; a flush retries them', async () => {
    setupApi();
    mocked.post.mockRejectedValueOnce(new Error('network down'));
    const { ref } = renderTab();
    await waitForAmounts();

    typeMonth('planned', 1, '1500');
    expect(await flush(ref)).toBe(false);
    expect(ref.current?.isDirty()).toBe(true);
    typeMonth('planned', 2, '950');
    expect(await flush(ref)).toBe(true);
    expect(ref.current?.isDirty()).toBe(false);
    expect(bulkCalls()).toHaveLength(2);
    expect(written(bulkCalls()[1][1])).toEqual({
      kind: 'monthly', year: YEAR, months: [{ period: period(1), planned: 1500 }, { period: period(2), planned: 950 }],
    });
  });

  it('a flush retries a month whose save failed', async () => {
    setupApi();
    mocked.post.mockRejectedValueOnce(new Error('network down'));
    const { ref } = renderTab();
    await waitForAmounts();
    typeMonth('planned', 1, '1500');
    expect(await flush(ref)).toBe(false);
    expect(await flush(ref)).toBe(true);
    expect(bulkCalls()).toHaveLength(2);
    expect(written(bulkCalls()[1][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(1), planned: 1500 }] });
    expect(ref.current?.isDirty()).toBe(false);
  });

  it('an amount after a failed save keeps the month and does not post the amount', async () => {
    setupApi();
    mocked.post.mockRejectedValue(new Error('network down'));
    const { ref } = renderTab();
    await waitForAmounts();

    typeMonth('planned', 1, '1500');
    expect(await flush(ref)).toBe(false);
    expect(ref.current?.isDirty()).toBe(true);
    pick('committed');
    typeAmount('24000');
    // The amount first retries the unsaved month; it fails again, so the amount stops there.
    await waitFor(() => expect(bulkCalls()).toHaveLength(2));
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(bulkCalls().every(([, body]) => body.kind === 'monthly')).toBe(true);
    expect(cellValue('planned', 1)).toBe('1 500');
    expect(ref.current?.isDirty()).toBe(true);

    mocked.post.mockResolvedValue({ data: { updated: 1 } });
    expect(await flush(ref)).toBe(true);
    expect(written(bulkCalls()[2][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(1), planned: 1500 }] });
  });

  it('an amount typed right after a month saves the month first, and keeps its amount in the field', async () => {
    setupApi();
    routePosts();
    renderTab();
    await waitForAmounts();
    typeMonth('committed', 3, '1500');
    pick('planned');
    typeAmount('20000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(2));
    expect(bulkCalls()[0][1]).toMatchObject({ kind: 'monthly' });
    expect(bulkCalls()[1][1]).toMatchObject({ kind: 'annual', totals: { planned: '20000.00' } });
    await settle();
    expect(amountField()).toHaveValue('20 000');
  });
});

/* ---- Clear column ---- */

describe('BudgetTab clear column', () => {
  it('asks first, then sends that column only, for the twelve months', async () => {
    setupApi();
    const { ref } = renderTab();
    await waitForAmounts();
    pick('committed');

    fireEvent.click(within(editor()).getByRole('button', { name: 'opex.budget.clearColumn' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Clear every month of Revision for 2026? The other columns stay as they are.');
    expect(cellValue('committed', 1)).toBe('900');
    fireEvent.click(within(dialog).getByRole('button', { name: 'opex.budget.clearColumn' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(cellValue('committed', 1)).toBe('0'));
    await flush(ref);
    expect(bulkCalls()).toHaveLength(1);
    expect(written(bulkCalls()[0][1])).toEqual({
      kind: 'monthly', year: YEAR, months: Array.from({ length: 12 }, (_, i) => ({ period: period(i + 1), committed: 0 })),
    });
  });

  it('on a CAPEX line the question names the column as the tenant calls it', async () => {
    columnsSetting.current = { ...ALL_SHOWN, labels: { ...ALL_SHOWN.labels, committed: 'Run cost' } };
    setupApi();
    // The same item, under the CAPEX routes.
    const spendGet = mocked.get.getMockImplementation()! as (...args: any[]) => any;
    mocked.get.mockImplementation((url: string, config?: unknown) => spendGet(
      url.replace('/capex-items/', '/spend-items/').replace('/capex-versions/', '/spend-versions/'), config,
    ));
    const { ref } = renderTab(YEAR, {}, CAPEX_FINANCE_CONFIG);
    await waitFor(() => expect(editor()).toHaveAttribute('data-ready', 'true'));
    pick('committed');

    fireEvent.click(within(editor()).getByRole('button', { name: 'capex.budget.clearColumn' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Clear every month of Run cost for 2026?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'capex.budget.clearColumn' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await flush(ref);
    const posts = mocked.post.mock.calls.filter(([url]) => url === '/capex-versions/v1/amounts/bulk-upsert');
    expect(posts).toHaveLength(1);
    expect(posts[0][1]).toMatchObject({ kind: 'monthly', months: Array.from({ length: 12 }, (_, i) => ({ period: period(i + 1), committed: 0 })) });
  });

  it('cancelling the question leaves the months as they are and saves nothing', async () => {
    setupApi();
    const { ref } = renderTab();
    await waitForAmounts();
    pick('committed');
    fireEvent.click(within(editor()).getByRole('button', { name: 'opex.budget.clearColumn' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'buttons.cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await flush(ref);
    for (let month = 1; month <= 12; month++) expect(cellValue('committed', month)).toBe('900');
    expect(bulkCalls()).toHaveLength(0);
    expect(ref.current?.isDirty()).toBe(false);
  });

  it('a column already at zero is cleared without a question', async () => {
    setupApi({ monthValues: { committed: '0' }, roundInputs: [record({ measure: 'committed', method: 'manual', period_start: '2026-01-01' })] });
    const { ref } = renderTab();
    await waitForAmounts();
    pick('committed');
    fireEvent.click(within(editor()).getByRole('button', { name: 'opex.budget.clearColumn' }));
    await flush(ref);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bulkCalls()).toHaveLength(1);
    expect(written(bulkCalls()[0][1])).toEqual({
      kind: 'monthly', year: YEAR, months: Array.from({ length: 12 }, (_, i) => ({ period: period(i + 1), committed: 0 })),
    });
  });
});

/* ---- Frozen columns ---- */

describe('BudgetTab frozen columns', () => {
  it('a frozen column is selectable and read only: no mode, no field, a sentence; nothing is ever sent (the Spread-an-amount bug)', async () => {
    setupApi({ frozen: ['budget'], roundInputs: [record({ period_start: '2026-01-01' })] });
    const { ref } = renderTab();
    await waitForAmounts();
    await waitFor(() => expect(activeColumn()).toBe('committed'));

    pick('planned');
    expect(activeColumn()).toBe('planned');
    const ed = editor();
    expect(ed).toHaveAttribute('data-frozen', 'true');
    expect(ed).toHaveTextContent('The Budget 2026 column is frozen');
    expect(ed).toHaveTextContent('Read only. An administrator can unfreeze it in Administration › Freeze / unfreeze data.');
    expect(ed).toHaveTextContent('12 000');
    expect(ed).toHaveTextContent('Spread flat');
    // No field at all: no amount, no mode, no date, no distribution, no clear.
    expect(within(ed).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(ed).queryAllByRole('tab')).toHaveLength(0);
    expect(within(ed).queryAllByRole('radio')).toHaveLength(0);
    expect(within(ed).queryAllByRole('combobox')).toHaveLength(0);
    expect(within(ed).queryAllByRole('button')).toHaveLength(0);
    expect(document.activeElement).toBe(document.body);
    // Nor its months.
    fireEvent.click(tableCell('planned', 3));
    expect(monthInput('planned', 3)).toBeNull();
    expect(screen.queryByTestId('mode-switch')).toBeNull();
    await flush(ref);
    await settle();
    expect(bulkCalls()).toHaveLength(0);
    expect(ref.current?.hasPending()).toBe(false);
  });

  it('a column frozen while its amount is typed turns read only and writes nothing', async () => {
    const state = setupApi();
    const { ref, queryClient } = renderTab();
    await waitForAmounts();
    fireEvent.change(amountField(), { target: { value: '15000' } });
    expect(ref.current?.hasPending()).toBe(true);

    state.frozen = ['budget'];
    await act(async () => { await queryClient.invalidateQueries({ queryKey: ['freeze-state', YEAR] }); });
    await waitFor(() => expect(editor()).toHaveAttribute('data-frozen', 'true'));
    expect(activeColumn()).toBe('planned');
    await settle();
    expect(bulkCalls()).toHaveLength(0);
    expect(ref.current?.hasPending()).toBe(false);
  });

  it('a frozen Forecast is locked on its card and in the table, never typed and never sent', async () => {
    setupApi({ frozen: ['forecast'] });
    const { ref } = renderTab();
    await waitForAmounts();
    await waitFor(() => expect(within(card('forecast')).getByTestId('LockOutlinedIcon')).toBeInTheDocument());
    expect(within(screen.getByTestId('budget-head-forecast')).getByTestId('LockOutlinedIcon')).toBeInTheDocument();
    expect(tableCell('forecast', 1)).not.toHaveAttribute('title');

    typeMonth('planned', 1, '1500');
    fireEvent.click(tableCell('forecast', 1));
    await flush(ref);
    expect(bulkCalls()).toHaveLength(1);
    expect(written(bulkCalls()[0][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(1), planned: 1500 }] });
    expect(screen.getByText('opex.budget.someColumnsFrozen')).toBeInTheDocument();
  });

  it('a save refused by a new freeze refreshes the freeze and drops the frozen months', async () => {
    const state = setupApi();
    const { ref } = renderTab();
    await waitForAmounts();
    await waitFor(() => expect(freezeLoads()).toBe(1));

    // Budget gets frozen by an administrator while the tab is open.
    state.frozen = ['budget'];
    mocked.post.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { response: { status: 403, data: { message: 'OPEX Budget for 2026 is frozen' } } }));
    typeMonth('planned', 1, '1500');
    expect(await flush(ref)).toBe(false);

    await waitFor(() => expect(freezeLoads()).toBe(2));
    await waitFor(() => expect(editor()).toHaveAttribute('data-frozen', 'true'));
    expect(monthInput('planned', 1)).toBeNull();
    expect(await flush(ref)).toBe(true);
    expect(bulkCalls()).toHaveLength(1);
    expect(ref.current?.isDirty()).toBe(false);
  });
});

/* ---- « Use for other columns too » ---- */

describe('BudgetTab use for other columns', () => {
  const openAlso = () => fireEvent.click(within(editor()).getByRole('button', { name: 'Use for other columns too…' }));
  const alsoBox = (name: string) => within(editor()).getByRole('checkbox', { name });

  it('an amount: the other columns, never a frozen one, the group ticked; Apply spreads them from their own totals', async () => {
    setupApi({ frozen: ['revision'], monthValues: { forecast: '333.33' } });
    renderTab();
    await waitForAmounts();
    await waitFor(() => expect(freezeLoads()).toBeGreaterThanOrEqual(1));

    openAlso();
    expect(within(editor()).getAllByRole('checkbox').map((box) => box.closest('label')?.textContent)).toEqual(['Forecast', 'Actuals', 'Expected landing']);
    expect(alsoBox('Forecast')).toBeChecked();
    expect(editor()).toHaveTextContent('They take this period and distribution, and keep their own total.');
    fireEvent.click(alsoBox('Actuals'));
    fireEvent.click(within(editor()).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    // The server spreads the other columns from the totals it holds (scenario 5, lot 3D): only the
    // active column says what it started from.
    expect(bulkCalls()[0][1]).toEqual({
      kind: 'annual',
      year: YEAR,
      totals: { planned: '12000.00' },
      also_measures: ['forecast', 'expected_landing'],
      spread_profile_name: 'flat',
      period_start: '2026-01-01',
      period_end: '2026-12-31',
      base: { columns: { planned: { months: Array.from({ length: 12 }, () => '1000.00') } } },
    });
  });

  it('by default an amount goes to the active column only; Cancel writes nothing', async () => {
    setupApi();
    renderTab();
    await waitForAmounts();
    openAlso();
    fireEvent.click(within(editor()).getByRole('button', { name: 'common:buttons.cancel' }));
    await settle();
    expect(bulkCalls()).toHaveLength(0);
    typeAmount('13000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1].totals).toEqual({ planned: '13000.00' });
    expect(bulkCalls()[0][1].also_measures).toBeUndefined();
  });

  it('a column out of the setting group is offered unticked; a hidden column is never offered', async () => {
    columnsSetting.current = { ...DEFAULT_BUDGET_COLUMNS, group_spread: { ...DEFAULT_BUDGET_COLUMNS.group_spread, expected_landing: false } };
    setupApi();
    renderTab();
    await waitForAmounts();
    pick('actual');
    openAlso();
    expect(within(editor()).getAllByRole('checkbox').map((box) => box.closest('label')?.textContent)).toEqual(['Budget', 'Revision', 'Expected landing']);
    expect(alsoBox('Expected landing')).not.toBeChecked();
    expect(alsoBox('Budget')).toBeChecked();
    fireEvent.click(within(editor()).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(written(bulkCalls()[0][1])).toEqual({
      kind: 'annual', year: YEAR, totals: { actual: '9600.00' }, also_measures: ['planned', 'committed'], spread_profile_name: 'flat', period_start: '2026-01-01', period_end: '2026-12-31',
    });
  });

  it('is not offered when every other column is frozen', async () => {
    columnsSetting.current = { ...DEFAULT_BUDGET_COLUMNS, enabled: { ...DEFAULT_BUDGET_COLUMNS.enabled, actual: false, expected_landing: false } };
    setupApi({ frozen: ['revision'] });
    renderTab();
    await waitForAmounts();
    await waitFor(() => expect(freezeLoads()).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(within(editor()).queryByRole('button', { name: 'Use for other columns too…' })).not.toBeInTheDocument());
    expect(within(editor()).getByRole('button', { name: 'opex.budget.clearColumn' })).toBeInTheDocument();
  });

  it('an amount leaves out the columns that follow their lines, and says so', async () => {
    setupApi({ roundInputs: [linesRecord(undefined, { measure: 'committed' }), linesRecord(undefined, { measure: 'forecast' })] });
    routePosts();
    renderTab();
    await waitForAmounts();
    openAlso();
    expect(within(editor()).getAllByRole('checkbox').map((box) => box.closest('label')?.textContent)).toEqual(['Actuals', 'Expected landing']);
    expect(editor()).toHaveTextContent('Revision and Forecast keep their lines.');
    fireEvent.click(within(editor()).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1].also_measures).toEqual(['actual', 'expected_landing']);
  });

  it('when every other column follows its lines, an amount offers nothing', async () => {
    columnsSetting.current = { ...DEFAULT_BUDGET_COLUMNS, enabled: { ...DEFAULT_BUDGET_COLUMNS.enabled, actual: false, expected_landing: false } };
    setupApi({ roundInputs: [linesRecord(undefined, { measure: 'committed' })] });
    renderTab();
    await waitForAmounts();
    expect(within(editor()).queryByRole('button', { name: 'Use for other columns too…' })).not.toBeInTheDocument();
    typeAmount('5000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1].also_measures).toBeUndefined();
  });

  it('quantity and price: the same lines to the columns ticked, never a frozen one', async () => {
    calendarsState.list = [FRANCE, UNITED_STATES];
    setupApi({ frozen: ['revision'], roundInputs: [linesRecord()] });
    routePosts();
    renderTab();
    await waitForAmounts();
    await waitFor(() => expect(freezeLoads()).toBeGreaterThanOrEqual(1));

    openAlso();
    expect(within(editor()).getAllByRole('checkbox', { name: /Forecast|Actuals|Expected landing|Revision/ }).map((box) => box.closest('label')?.textContent)).toEqual(['Forecast', 'Actuals', 'Expected landing']);
    expect(editor()).toHaveTextContent('These lines replace their amounts.');
    fireEvent.click(within(editor()).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    const body = bulkCalls()[0][1];
    expect(body).toMatchObject({ kind: 'lines', measure: 'planned', lines: [expect.objectContaining({ label: 'US Managed IT Services', quantity: '100' })] });
    expect(body.also_measures).toEqual(['forecast', 'actual', 'expected_landing']);
    // Each column the lines replace says what it started from, its lines included.
    expect(Object.keys(body.base.columns)).toEqual(['planned', 'forecast', 'actual', 'expected_landing']);
    // A one-shot: the next commit of the lines goes to this column only.
    leave(screen.getByLabelText('Description'), 'Managed services');
    await waitFor(() => expect(bulkCalls()).toHaveLength(2));
    expect(bulkCalls()[1][1].also_measures).toBeUndefined();
  });

  it('quantity and price without a line offers nothing to the other columns', async () => {
    calendarsState.list = [FRANCE, UNITED_STATES];
    setupApi({ empty: true, roundInputs: [linesRecord([storedLine()], { measure: 'forecast' })] });
    renderTab();
    await waitForAmounts();
    fireEvent.click(modeTab('Quantity and price'));
    expect(screen.getByText('No line yet. A line is a quantity times a unit price.')).toBeInTheDocument();
    expect(within(editor()).queryByRole('button', { name: 'Use for other columns too…' })).not.toBeInTheDocument();
  });
});

/* ---- Quantity and price ---- */

describe('BudgetTab quantity and price', () => {
  beforeEach(() => {
    calendarsState.list = [FRANCE, UNITED_STATES];
  });

  it('a complete line is written as the column lines, on the paying company calendar, and the year reloads', async () => {
    setupApi({ empty: true });
    routePosts(async () => ({ updated: 12, round_inputs: [linesRecord([storedLine({ label: '', quantity_unit: 'people', quantity: '1.000', frequency: 'per_month', period_start: '2026-01-01' })])] }));
    renderTab(YEAR, { payingCompanyCountry: 'US' });
    await waitForAmounts();

    fireEvent.click(modeTab('Quantity and price'));
    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Full time' }));
    leave(screen.getByLabelText('Unit price'), '600');

    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(written(bulkCalls()[0][1])).toEqual({
      kind: 'lines',
      year: YEAR,
      measure: 'planned',
      lines: [{
        label: '', quantity_unit: 'people', quantity: '1', unit_price: '600', price_basis: 'per_day', frequency: 'per_month',
        days_per_month: null, period_start: '2026-01-01', period_end: '2026-12-31', working_day_profile_id: 'cal-us',
      }],
    });
    await waitFor(() => expect(amountLoads()).toBe(2));
    expect(screen.getByLabelText('Unit price')).toHaveValue('600');
    expect(modeTab('Quantity and price')).toHaveAttribute('aria-selected', 'true');
    expect(mocked.patch).not.toHaveBeenCalled();
    expect(bulkCalls()).toHaveLength(1);
  });

  it('on a line without a version for the year, the first write creates it; adding a line writes nothing', async () => {
    setupApi({ empty: true, noVersion: true });
    routePosts();
    renderTab();
    await waitForAmounts(0);
    const versionPosts = () => mocked.post.mock.calls.filter(([url]) => url === VERSIONS);

    fireEvent.click(modeTab('Quantity and price'));
    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    expect(versionPosts()).toHaveLength(0);
    leave(screen.getByLabelText('Unit price'), '200');
    expect(versionPosts()).toHaveLength(0);
    leave(screen.getByLabelText('days per month'), '5');

    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(versionPosts()).toHaveLength(1);
    expect(versionPosts()[0][1]).toMatchObject({ budget_year: YEAR, input_grain: 'annual' });
    // No company country: the first calendar by name.
    expect(bulkCalls()[0][1]).toMatchObject({ kind: 'lines', measure: 'planned', lines: [expect.objectContaining({ unit_price: '200', price_basis: 'per_day', days_per_month: '5', working_day_profile_id: 'cal-fr' })] });
    expect(screen.getByRole('button', { name: 'Add a line' })).toBeInTheDocument();
  });

  it('opens on the stored lines with their amount and the FTE line', async () => {
    setupApi({ roundInputs: [linesRecord()] });
    renderTab();
    await waitForAmounts();
    expect(modeTab('Quantity and price')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Description')).toHaveValue('US Managed IT Services');
    expect(screen.getByLabelText('Quantity')).toHaveValue('100');
    expect(screen.getByTestId('line-amount')).toHaveTextContent('60 000');
    expect(screen.getByTestId('line-frequency')).toHaveTextContent('over the period');
    expect(screen.getByTestId('lines-fte')).toHaveTextContent('FTE over the period 0.48 · Full-year average 0.40');
    expect(screen.queryByTestId('lines-status')).not.toBeInTheDocument();
  });

  it('its months are read only in the table; a click there asks to type them by month instead', async () => {
    setupApi({ roundInputs: [linesRecord()] });
    renderTab();
    await waitForAmounts();
    expect(monthInput('planned', 3)).toBeNull();
    fireEvent.click(tableCell('planned', 3));
    expect(screen.getByTestId('mode-switch')).toHaveTextContent('Switch to entry by month? The current months are kept and become editable in the table. The lines stay as a reference.');
  });

  it('writes run one after the other, and the hint says so meanwhile', async () => {
    setupApi({ roundInputs: [linesRecord([storedLine(), storedLine({ id: 'line-2', sort: 1, label: 'Second' })])] });
    let release: () => void = () => undefined;
    let first = true;
    routePosts(() => {
      if (!first) return Promise.resolve({ updated: 12 });
      first = false;
      return new Promise((resolve) => { release = () => resolve({ updated: 12 }); });
    });
    renderTab();
    await waitForAmounts();

    leave(screen.getAllByLabelText('Description')[0], 'First');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(screen.getByText('common:status.saving')).toBeInTheDocument();
    leave(screen.getAllByLabelText('Description')[1], 'Second, renamed');
    await settle();
    // Nothing is disabled while saving, and the second write waits for the first.
    expect(screen.getAllByLabelText('Description')[1]).not.toBeDisabled();
    expect(bulkCalls()).toHaveLength(1);

    await act(async () => { release(); });
    await waitFor(() => expect(bulkCalls()).toHaveLength(2));
    expect(bulkCalls()[1][1].lines.map((line: { label: string }) => line.label)).toEqual(['First', 'Second, renamed']);
    await waitFor(() => expect(screen.queryByText('common:status.saving')).not.toBeInTheDocument());
  });

  it('a refusal from the server shows under the table and keeps the lines', async () => {
    setupApi({ roundInputs: [linesRecord()] });
    const refusal = 'Line 1: United States has no working days for 2026.';
    mocked.post.mockRejectedValue(Object.assign(new Error('Bad Request'), { response: { status: 400, data: { message: refusal } } }));
    renderTab();
    await waitForAmounts();
    leave(screen.getByLabelText('Unit price'), '650');
    await waitFor(() => expect(screen.getByTestId('lines-notes')).toHaveTextContent(refusal));
    expect(screen.getByLabelText('Unit price')).toHaveValue('650');
  });

  it('a column edited by hand keeps its lines as a reference and offers to use them again', async () => {
    setupApi({ roundInputs: [linesRecord(undefined, { method: 'manual', last_calculation: null })] });
    routePosts();
    renderTab();
    await waitForAmounts();
    expect(captionLines('planned')).toEqual(['Quantity and price · 1 line · 0.40 FTE ·', 'Edited by hand', '10 months, March to December']);
    expect(modeTab('By month')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(screen.getByTestId('lines-reference')).getByRole('button', { name: 'Use the lines again.' }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toMatchObject({ kind: 'lines', lines: [expect.objectContaining({ quantity: '100', unit_price: '600' })] });
  });

  it('a date typed in a line is written at once', async () => {
    setupApi({ roundInputs: [linesRecord()] });
    routePosts();
    renderTab();
    await waitForAmounts();
    const [from] = within(screen.getByTestId('lines-table')).getAllByPlaceholderText('labels.datePlaceholder');
    typeDate(from, '01/04/2026');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1].lines[0]).toMatchObject({ period_start: '2026-04-01', period_end: '2026-12-31' });
  });

  it('the working-days note follows a calendar edited since the tab loaded it', async () => {
    const US_DAYS = ['20', '19', '22', '22', '20', '21', '22', '21', '21', '21', '19', '22'];
    const rec = linesRecord();
    (rec.last_calculation as { lines: Array<{ day_counts: string[] | null }> }).lines[0].day_counts = US_DAYS;
    setupApi({ roundInputs: [rec] });
    const base = mocked.get.getMockImplementation()! as (...args: any[]) => any;
    let days = US_DAYS;
    let yearLoads = 0;
    mocked.get.mockImplementation(async (url: string, config?: unknown) => {
      if (url === '/working-day-profiles/cal-us/years/2026') {
        yearLoads += 1;
        return { data: { year: 2026, source: 'edited', days, standard_days: US_DAYS, holidays: [] } };
      }
      return base(url, config);
    });
    renderTab();
    await waitForAmounts();
    await waitFor(() => expect(yearLoads).toBe(1));
    expect(screen.queryByTestId('lines-days-changed')).not.toBeInTheDocument();

    // The calendar page changes March (22 to 21), then the user comes back to the lines.
    days = [...US_DAYS];
    days[2] = '21';
    pick('committed');
    pick('planned');
    await waitFor(() => expect(yearLoads).toBe(2));
    expect(await screen.findByTestId('lines-days-changed')).toHaveTextContent('March: 22 days, now 21.');
  });
});

/* ---- Edits while a panel write runs ---- */

/** Bulk writes that answer at once, except the first one, held until `release()`. */
function holdFirstWrite() {
  const held = { release: () => undefined as void };
  let first = true;
  routePosts(() => {
    if (!first) return Promise.resolve({ updated: 12 });
    first = false;
    return new Promise((resolve) => { held.release = () => resolve({ updated: 12 }); });
  });
  return held;
}

/** From now on the server holds `planned` in every month of Budget (the lines write changed it). */
function budgetBecomes(planned: string) {
  const base = mocked.get.getMockImplementation()! as (...args: any[]) => any;
  mocked.get.mockImplementation(async (url: string, config?: unknown) => {
    const res = await base(url, config);
    if (url !== '/spend-versions/v1/amounts') return res;
    return {
      data: {
        ...res.data,
        items: res.data.items.map((item: Record<string, string>) => ({ ...item, planned })),
        totals: { ...res.data.totals, planned: Number(planned) * 12 },
      },
    };
  });
}

describe('BudgetTab edits while a panel write runs', () => {
  beforeEach(() => {
    calendarsState.list = [FRANCE, UNITED_STATES];
  });

  it('a month typed while a lines write runs is kept by the reload, then saved', async () => {
    setupApi({ roundInputs: [linesRecord()] });
    const held = holdFirstWrite();
    const { ref } = renderTab();
    await waitForAmounts();
    leave(screen.getByLabelText('Description'), 'First');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    const loadsBefore = amountLoads();

    // March, Revision: typed while the write runs (nothing is read-only meanwhile).
    typeMonth('committed', 3, '450');
    budgetBecomes('600');
    await act(async () => { held.release(); });
    await waitFor(() => expect(amountLoads()).toBe(loadsBefore + 1));
    await settle();

    // The reload shows what the server holds, except the month typed since.
    expect(cellValue('planned', 3)).toBe('600');
    expect(cellValue('committed', 3)).toBe('450');
    expect(cellValue('committed', 4)).toBe('900');
    expect(ref.current?.isDirty()).toBe(true);

    await flush(ref);
    const monthly = bulkCalls().filter(([, body]) => body?.kind === 'monthly');
    expect(monthly).toHaveLength(1);
    expect(written(monthly[0][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(3), committed: 450 }] });
    expect(cellValue('committed', 3)).toBe('450');
    expect(ref.current?.isDirty()).toBe(false);
  });

  it('an amount typed while a lines write runs is kept, then written after it', async () => {
    setupApi({ roundInputs: [linesRecord()] });
    const held = holdFirstWrite();
    renderTab();
    await waitForAmounts();
    leave(screen.getByLabelText('Description'), 'First');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    const loadsBefore = amountLoads();

    pick('committed');
    typeAmount('500');
    budgetBecomes('50');
    await settle();
    expect(bulkCalls()).toHaveLength(1);
    await act(async () => { held.release(); });
    await waitFor(() => expect(amountLoads()).toBeGreaterThanOrEqual(loadsBefore + 1));
    await waitFor(() => expect(bulkCalls()).toHaveLength(2));
    expect(written(bulkCalls()[1][1])).toMatchObject({ kind: 'annual', totals: { committed: '500.00' } });
    expect(Object.keys(bulkCalls()[1][1].totals)).toEqual(['committed']);
    await settle();
    expect(amountField()).toHaveValue('500');
    expect(cellValue('planned', 1)).toBe('50');
  });
});

/* ---- Keyboard run through the lines ---- */

/** Every field Tab stops on, in page order (nothing on the page sets a positive tabindex). */
const tabStops = () => Array.from(document.body.querySelectorAll<HTMLElement>('input, button, select, textarea, a[href], [tabindex]'))
  .filter((el) => el.tabIndex >= 0 && !(el as HTMLInputElement).disabled);
/** Tab, as the browser walks it: the focus moves to the next stop. */
function tab() {
  const stops = tabStops();
  const next = stops[stops.indexOf(document.activeElement as HTMLElement) + 1];
  if (!next) throw new Error('no field after the focused one');
  act(() => { next.focus(); });
}
/** The focused field as a user reads it: its label, else its placeholder or text. */
function focusName(): string {
  const el = document.activeElement as HTMLElement;
  if (el instanceof HTMLInputElement && el.type === 'checkbox') return el.closest('label')?.textContent ?? 'checkbox';
  if (el instanceof HTMLInputElement && el.type === 'date') return 'hidden date input';
  return el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? el.textContent ?? el.tagName;
}
/** Chooses an option of the focused select with the keyboard: open, arrow down, Enter. */
async function chooseWithKeyboard(steps: number) {
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
  await screen.findByRole('listbox');
  for (let i = 0; i < steps; i++) fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' });
}

/** The server keeps the lines it is sent, with ids of its own, and the reload returns them. */
function serverKeepsLines(initial: RoundLine[]) {
  let lines = initial;
  let seq = 0;
  const base = mocked.get.getMockImplementation()! as (...args: any[]) => any;
  mocked.get.mockImplementation(async (url: string, config?: unknown) => {
    const res = await base(url, config);
    if (url !== '/spend-versions/v1/amounts') return res;
    return { data: { ...res.data, round_inputs: [linesRecord(lines)] } };
  });
  routePosts(async (body) => {
    lines = (body.lines as LinePayload[]).map((line, sort) => ({ ...storedLine(), ...line, id: `srv-${++seq}`, sort }));
    return { updated: 12, round_inputs: [linesRecord(lines)] };
  });
}

describe('BudgetTab keyboard run through the lines', () => {
  beforeEach(() => {
    calendarsState.list = [FRANCE, UNITED_STATES];
  });

  async function openLines() {
    setupApi();
    serverKeepsLines([storedLine()]);
    renderTab(YEAR, { payingCompanyCountry: 'US' });
    await waitForAmounts();
    await screen.findByLabelText('Description');
  }
  const dates = (row: number) => within(screen.getAllByTestId('line-row')[row]).getAllByPlaceholderText('labels.datePlaceholder');

  it('Add a line puts the focus in its Description; Tab then walks a person per day field by field, to Add a line', async () => {
    await openLines();
    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    expect(document.activeElement).toBe(screen.getAllByLabelText('Description')[1]);

    const walked = [focusName()];
    while (focusName() !== 'Add a line') { tab(); walked.push(focusName()); }
    expect(walked).toEqual([
      'Description', 'Quantity', 'Unit', 'Unit price', 'Price per', 'Full time', 'days per month',
      'labels.datePlaceholder', 'labels.datePlaceholder', 'Calendar', 'Remove the line', 'Add a line',
    ]);
    // Enter on Add a line: the next line, its Description focused.
    fireEvent.click(document.activeElement as HTMLElement);
    expect(document.activeElement).toBe(screen.getAllByLabelText('Description')[2]);
  });

  it('a line typed with the keyboard: the Unit chosen, the Unit price left, From set; every save and reload keeps the focus where Tab put it', async () => {
    await openLines();
    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    const row = screen.getAllByTestId('line-row')[1];
    fireEvent.change(document.activeElement as HTMLElement, { target: { value: 'Audit' } });
    tab();
    tab();
    const unit = within(row).getByRole('combobox', { name: 'Unit' });
    expect(document.activeElement).toBe(unit);

    // people, days, pieces: one step down is days. The select takes the focus back.
    await chooseWithKeyboard(1);
    await waitFor(() => expect(unit).toHaveTextContent('days'));
    expect(document.activeElement).toBe(unit);
    tab();
    expect(document.activeElement).toBe(within(row).getByLabelText('Unit price'));

    // Leaving the Unit price completes the line: it is written, the tab reloads, From keeps the focus.
    fireEvent.change(document.activeElement as HTMLElement, { target: { value: '1200' } });
    const loads = amountLoads();
    tab();
    const [from, to] = dates(1);
    expect(document.activeElement).toBe(from);
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    await waitFor(() => expect(amountLoads()).toBe(loads + 1));
    await settle();
    expect(bulkCalls()[0][1].lines[1]).toMatchObject({ label: 'Audit', quantity_unit: 'days', unit_price: '1200', working_day_profile_id: 'cal-us' });
    expect(document.activeElement).toBe(from);
    // The line kept its row: nothing was drawn again under the focus.
    expect(screen.getAllByTestId('line-row')[1]).toBe(row);

    // A date typed in From is written as soon as it is whole; the focus stays, Tab goes to To.
    fireEvent.change(from, { target: { value: '01/04/2026' } });
    await waitFor(() => expect(bulkCalls()).toHaveLength(2));
    await waitFor(() => expect(amountLoads()).toBe(loads + 2));
    await settle();
    expect(bulkCalls()[1][1].lines[1]).toMatchObject({ period_start: '2026-04-01' });
    expect(document.activeElement).toBe(from);
    tab();
    expect(document.activeElement).toBe(to);
    tab();
    expect(focusName()).toBe('Calendar');
    expect(screen.getAllByTestId('line-row')[1]).toBe(row);
  });

  it('a unit changed with the keyboard on a saved line is written, and the focus stays on Unit; from the last field, Tab reaches the next line', async () => {
    await openLines();
    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    const unit = screen.getAllByRole('combobox', { name: 'Unit' })[0];
    act(() => { unit.focus(); });
    // days, then pieces: one step down. Pieces are bought once, on the column start.
    await chooseWithKeyboard(1);
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1].lines[0]).toMatchObject({ quantity_unit: 'pieces', frequency: 'once' });
    await settle();
    expect(document.activeElement).toBe(unit);
    tab();
    expect(document.activeElement).toBe(screen.getAllByLabelText('Unit price')[0]);

    // How often, the one Date, then remove: Tab goes on to the next line's Description.
    while (focusName() !== 'Remove the line') tab();
    tab();
    expect(document.activeElement).toBe(screen.getAllByLabelText('Description')[1]);
  });

  it('removing a line with the mouse leaves the focus alone', async () => {
    await openLines();
    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    const remove = screen.getAllByRole('button', { name: 'Remove the line' })[0];
    act(() => { remove.focus(); });
    // A pointer click: `detail` counts the clicks.
    fireEvent.click(remove, { detail: 1 });
    await settle();
    expect(screen.getAllByLabelText('Description')).toHaveLength(2);
    expect(screen.getAllByLabelText('Description')).not.toContain(document.activeElement);
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Add a line' }));
  });

  it('removing a line puts the focus on the next line, else the previous one, else on Add a line; the column stays on its lines', async () => {
    await openLines();
    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    const [, second] = screen.getAllByLabelText('Description');

    // The first of three (the stored one): the next one, which is now first. The two left are not
    // complete yet, so nothing is written.
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove the line' })[0]);
    expect(document.activeElement).toBe(second);
    await settle();
    expect(document.activeElement).toBe(second);

    // The last of two: the previous one.
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove the line' })[1]);
    expect(screen.getAllByLabelText('Description')).toEqual([second]);
    expect(document.activeElement).toBe(second);

    // The only one: Add a line.
    fireEvent.click(screen.getByRole('button', { name: 'Remove the line' }));
    expect(screen.queryByLabelText('Description')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add a line' }));
    // No line left: the column's lines are cleared.
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    await settle();
    expect(bulkCalls()[0][1]).toMatchObject({ kind: 'lines', lines: [] });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add a line' }));
    expect(modeTab('Quantity and price')).toHaveAttribute('aria-selected', 'true');
  });
});

/* ---- Lot 3D: what each save started from, refused columns, the reload after each save ---- */

const twelve = (value: string) => Array.from({ length: 12 }, () => value);

/** A 409 edit_conflict on one column: the column as the server holds it now, who changed it and when. */
function columnConflict(field: string, current: string[], over: Record<string, unknown> = {}) {
  return {
    response: {
      status: 409,
      data: {
        code: 'edit_conflict',
        message: 'Someone else changed this column while you were editing it.',
        budget_rev: 7,
        conflicts: [{
          field, periods: [period(3)], base: null, current, mine: current,
          labels: { base: null, current: null, mine: null },
          changed_by: { id: 'u-marie', name: 'Marie Dupont' }, changed_at: '2026-09-30T12:02:00Z',
          ...over,
        }],
      },
    },
  };
}

/** Bulk writes answer at once, except the `refuse`d ones (409, the body changed nothing). */
function refuseBulk(refuse: (body: Record<string, any>, call: number) => unknown | null) {
  let call = 0;
  mocked.post.mockImplementation(async (url: string, body: Record<string, any>) => {
    if (url !== BULK) return { data: { id: 'v1', input_grain: 'monthly', budget_year: YEAR } };
    call += 1;
    const error = refuse(body, call);
    if (error) {
      refusedBodies.add(body);
      throw error;
    }
    return { data: { updated: 1 } };
  });
}

describe('BudgetTab edit conflicts (lot 3D)', () => {
  beforeEach(() => {
    calendarsState.list = [FRANCE, UNITED_STATES];
  });

  it('a monthly save says what each month started from; the next save starts from what it wrote', async () => {
    setupApi();
    const { ref } = renderTab();
    await waitForAmounts();
    typeMonth('committed', 3, '450');
    await flush(ref);
    expect(bulkCalls()[0][1].base).toEqual({ months: [{ period: period(3), committed: '900.00' }] });
    typeMonth('committed', 3, '460');
    await flush(ref);
    expect(bulkCalls()[1][1].base).toEqual({ months: [{ period: period(3), committed: '450.00' }] });
  });

  it('an amount says what its column held, month by month', async () => {
    setupApi();
    renderTab();
    await waitForAmounts();
    typeAmount('15000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1].base).toEqual({ columns: { planned: { months: twelve('1000.00') } } });
  });

  it("every save reloads the year: someone else's change shows, a month typed meanwhile stays", async () => {
    const server = setupApi();
    // The reload after the save is answered late: the user types meanwhile.
    const served = mocked.get.getMockImplementation()! as (...args: any[]) => any;
    let holdReload = false;
    let answer: () => void = () => undefined;
    mocked.get.mockImplementation(async (url: string, config?: unknown) => {
      if (url === '/spend-versions/v1/amounts' && holdReload) {
        holdReload = false;
        await new Promise<void>((resolve) => { answer = resolve; });
      }
      return served(url, config);
    });
    const { ref } = renderTab();
    await waitForAmounts();
    const loads = amountLoads();

    holdReload = true;
    typeMonth('planned', 3, '1500');
    await flush(ref);
    expect(bulkCalls()).toHaveLength(1);
    await waitFor(() => expect(amountLoads()).toBe(loads + 1));
    // Meanwhile Marie changes April's Forecast, and the user types February's Budget (not sent yet).
    server.items[3].forecast = '650';
    changedByOthers.add(server.items);
    fireEvent.change(monthInput('planned', 2)!, { target: { value: '450' } });
    await act(async () => { answer(); });
    await settle();

    // The reload after the save shows Marie's change; the month being typed keeps the user's value.
    expect(bulkCalls()).toHaveLength(1);
    expect(cellValue('forecast', 4)).toBe('650');
    expect(cellValue('planned', 2)).toBe('450');
    expect(cellValue('planned', 3)).toBe('1 500');
    expect(ref.current?.isDirty()).toBe(true);
    await flush(ref);
    expect(written(bulkCalls()[1][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(2), planned: 450 }] });
    expect(bulkCalls()[1][1].base).toEqual({ months: [{ period: period(2), planned: '1000.00' }] });
  });

  it('a refused column waits, tinted and read only, while the other columns go on their own; Overwrite sends it again over theirs', async () => {
    setupApi();
    const theirs = twelve('900.00');
    theirs[2] = '950.00';
    refuseBulk((body, call) => (call === 1 ? columnConflict('committed', theirs, { mine: theirs.map((v, i) => (i === 2 ? '450.00' : v)) }) : null));
    const { ref } = renderTab();
    await waitForAmounts();

    typeMonth('planned', 3, '1500');
    typeMonth('committed', 3, '450');
    expect(await flush(ref)).toBe(false);
    expect(ref.current?.isDirty()).toBe(true);

    // The whole request was refused; Budget went again alone.
    expect(written(bulkCalls()[0][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(3), planned: 1500, committed: 450 }] });
    expect(bulkCalls()).toHaveLength(2);
    expect(written(bulkCalls()[1][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(3), planned: 1500 }] });
    const banner = await screen.findByRole('region');
    expect(within(banner).getByText('editConflict.column.title')).toBeInTheDocument();
    expect(within(banner).getByText(/editConflict\.column\.changedBy(On|At)/)).toBeInTheDocument();
    expect(within(banner).getByText('Mar 950')).toBeInTheDocument();
    expect(within(banner).getByText('Mar 450')).toBeInTheDocument();
    expect(screen.getByTestId('budget-head-committed')).toHaveAttribute('data-waiting', 'true');
    expect(screen.getByTestId('budget-head-planned')).not.toHaveAttribute('data-waiting');
    expect(card('committed')).toHaveAttribute('data-waiting', 'true');
    expect(within(card('committed')).getByTitle('Waiting for your choice')).toBeInTheDocument();
    expect(tableCell('committed', 3)).toHaveAttribute('data-waiting', 'true');
    expect(monthInput('committed', 3)).toHaveAttribute('readonly');
    expect(monthInput('committed', 3)).toHaveValue('450');
    // The column's modes wait too.
    expect(modeTab('Amount')).toBeDisabled();
    expect(editor()).toHaveTextContent('Choose first, above, whether to reload this column or overwrite it.');

    fireEvent.click(within(banner).getByRole('button', { name: /editConflict\.column\.applyMine/ }));
    // Overwrite queues the save behind the autosave delay: a flush sends it now.
    expect(await flush(ref)).toBe(true);
    expect(bulkCalls()).toHaveLength(3);
    expect(written(bulkCalls()[2][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(3), committed: 450 }] });
    expect(bulkCalls()[2][1].base).toEqual({ months: [{ period: period(3), committed: '950.00' }] });
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
    expect(await flush(ref)).toBe(true);
    expect(monthInput('committed', 3)).not.toHaveAttribute('readonly');
  });

  it("Reload the column takes their values and drops the user's edits of that column", async () => {
    const server = setupApi();
    const theirs = twelve('900.00');
    theirs[2] = '950.00';
    refuseBulk((body, call) => (call === 1 ? columnConflict('committed', theirs) : null));
    const { ref } = renderTab();
    await waitForAmounts();

    typeMonth('committed', 3, '450');
    expect(await flush(ref)).toBe(false);
    // The server holds Marie's March.
    server.items[2].committed = '950';
    changedByOthers.add(server.items);
    const banner = await screen.findByRole('region');
    fireEvent.click(within(banner).getByRole('button', { name: /editConflict\.column\.keepTheirs/ }));

    await waitFor(() => expect(cellValue('committed', 3)).toBe('950'));
    expect(screen.queryByRole('region')).toBeNull();
    await settle();
    expect(ref.current?.isDirty()).toBe(false);
    expect(await flush(ref)).toBe(true);
    expect(bulkCalls()).toHaveLength(1);
    expect(cellValue('committed', 3)).toBe('950');
  });

  it('a refused lines write waits read only; Overwrite sends it again from the lines and months the server answered', async () => {
    setupApi({ roundInputs: [linesRecord()] });
    const theirLine = {
      label: 'Their services', quantity_unit: 'days', quantity: '100', unit_price: '650', price_basis: 'per_day', frequency: 'once',
      days_per_month: null, period_start: '2026-03-01', period_end: '2026-12-31', working_day_profile_id: 'cal-us',
    };
    refuseBulk((body, call) => (call === 1 ? columnConflict('planned', twelve('6500.00'), { periods: [], current_lines: [theirLine], mine: twelve('6000.00') }) : null));
    renderTab();
    await waitForAmounts();

    leave(screen.getByLabelText('Description'), 'My services');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    // What the drafts started from: the stored line and the column's months.
    expect(bulkCalls()[0][1].base).toEqual({
      columns: {
        planned: {
          months: twelve('1000.00'),
          lines: [{
            label: 'US Managed IT Services', quantity_unit: 'days', quantity: '100', unit_price: '600', price_basis: 'per_day', frequency: 'once',
            days_per_month: null, period_start: '2026-03-01', period_end: '2026-12-31', working_day_profile_id: 'cal-us',
          }],
        },
      },
    });
    const banner = await screen.findByRole('region');
    // Their column (the year and its lines) against the user's.
    expect(within(banner).getByText(/^78 000 for the year, 1 line$/)).toBeInTheDocument();
    expect(within(banner).getByText(/^72 000 for the year, 1 line$/)).toBeInTheDocument();
    // The panel keeps the user's line, read only, and says why.
    expect(screen.getByLabelText('Description')).toHaveValue('My services');
    expect(screen.getByLabelText('Description')).toBeDisabled();
    expect(screen.getByTestId('lines-notes')).toHaveTextContent('Choose first, above, whether to reload this column or overwrite it.');
    expect(within(editor()).queryByRole('button', { name: 'Use for other columns too…' })).toBeNull();

    fireEvent.click(within(banner).getByRole('button', { name: /editConflict\.column\.applyMine/ }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(2));
    expect(bulkCalls()[1][1]).toMatchObject({
      kind: 'lines',
      measure: 'planned',
      lines: [expect.objectContaining({ label: 'My services' })],
      base: { columns: { planned: { months: twelve('6500.00'), lines: [theirLine] } } },
    });
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
    await waitFor(() => expect(screen.getByLabelText('Description')).not.toBeDisabled());
  });

  it('a refused amount waits: its editor is read only and says why; Overwrite sends it again over their months', async () => {
    setupApi();
    refuseBulk((body, call) => (call === 1 ? columnConflict('planned', twelve('1100.00'), { periods: [] }) : null));
    renderTab();
    await waitForAmounts();
    expect(amountField()).not.toBeDisabled();

    typeAmount('24000');
    const banner = await screen.findByRole('region');
    expect(within(banner).getAllByText(/^13 200 for the year$/).length).toBeGreaterThan(0);
    expect(amountField()).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Distribution' })).toHaveAttribute('aria-disabled', 'true');
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(modeTab('By month')).toBeDisabled();
    expect(screen.queryByTestId('editor-footer')).toBeNull();
    expect(editor()).toHaveTextContent('Choose first, above, whether to reload this column or overwrite it.');
    expect(card('planned')).toHaveAttribute('data-waiting', 'true');

    fireEvent.click(within(banner).getByRole('button', { name: /editConflict\.column\.applyMine/ }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(2));
    expect(bulkCalls()[1][1]).toMatchObject({
      kind: 'annual', totals: { planned: '24000.00' }, base: { columns: { planned: { months: twelve('1100.00') } } },
    });
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
    await waitFor(() => expect(amountField()).not.toBeDisabled());
  });

  it('the tab keeps nothing in the browser and never writes the shared version', async () => {
    permissions.userId = 'u-1';
    setupApi();
    const { ref } = renderTab();
    await waitForAmounts();
    fireEvent.click(modeTab('By month'));
    fireEvent.click(switchButton());
    fireEvent.change(monthInput('planned', 1)!, { target: { value: '5' } });
    await flush(ref);
    expect(window.localStorage.length).toBe(0);
    expect(mocked.patch).not.toHaveBeenCalled();
  });
});

describe('BudgetTab edit conflicts, review round (lot 3D)', () => {
  /** Revision: March refused (Marie wrote 950 there). */
  const marchRefused = () => {
    const theirs = twelve('900.00');
    theirs[2] = '950.00';
    return columnConflict('committed', theirs, { periods: [period(3)] });
  };

  it('Reload the column takes their value for the refused month only; a month typed in the same request is saved', async () => {
    const server = setupApi();
    refuseBulk((body, call) => (call === 1 ? marchRefused() : null));
    const { ref } = renderTab();
    await waitForAmounts();

    typeMonth('committed', 1, '111');
    typeMonth('committed', 3, '450');
    expect(await flush(ref)).toBe(false);

    // One request with both months was refused; January, which did not conflict, went again alone.
    expect(written(bulkCalls()[0][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(1), committed: 111 }, { period: period(3), committed: 450 }] });
    await waitFor(() => expect(bulkCalls()).toHaveLength(2));
    expect(written(bulkCalls()[1][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(1), committed: 111 }] });
    // Only March waits: the banner shows it alone, January stays editable.
    const banner = await screen.findByRole('region');
    expect(within(banner).getByText('Mar 950')).toBeInTheDocument();
    expect(within(banner).getByText('Mar 450')).toBeInTheDocument();
    expect(within(banner).queryByText(/Jan/)).toBeNull();
    expect(monthInput('committed', 3)).toHaveAttribute('readonly');
    expect(monthInput('committed', 1)).not.toHaveAttribute('readonly');

    server.items[2].committed = '950';
    changedByOthers.add(server.items);
    fireEvent.click(within(banner).getByRole('button', { name: /editConflict\.column\.keepTheirs/ }));
    await waitFor(() => expect(cellValue('committed', 3)).toBe('950'));
    await settle();
    expect(cellValue('committed', 1)).toBe('111');
    expect(await flush(ref)).toBe(true);
    expect(bulkCalls()).toHaveLength(2);
  });

  it("a tab change keeps the waiting choice: the tab comes back with the banner and the user's value", async () => {
    setupApi();
    refuseBulk((body, call) => (call === 1 ? marchRefused() : null));
    const held = { current: null } as React.MutableRefObject<HeldBudgetChoices | null>;
    const first = renderTab(YEAR, {}, OPEX_FINANCE_CONFIG, undefined, { held });
    await waitForAmounts();
    typeMonth('committed', 3, '450');
    expect(await flush(first.ref)).toBe(false);
    await screen.findByRole('region');

    // A move that keeps the line (another tab) is not stopped by the choice.
    let moved = false;
    await act(async () => { moved = await first.ref.current!.flush({ ignoreHeld: true }); });
    expect(moved).toBe(true);
    expect(first.ref.current!.waitingColumns()).toEqual(['Revision']);
    first.unmount();
    expect(held.current?.labels).toEqual(['Revision']);

    const again = renderTab(YEAR, {}, OPEX_FINANCE_CONFIG, first.queryClient, { held });
    const banner = await screen.findByRole('region');
    expect(within(banner).getByText('Mar 950')).toBeInTheDocument();
    await waitFor(() => expect(cellValue('committed', 3)).toBe('450'));
    expect(tableCell('committed', 3)).toHaveAttribute('data-waiting', 'true');
    expect(card('committed')).toHaveAttribute('data-waiting', 'true');
    expect(again.ref.current!.waitingColumns()).toEqual(['Revision']);
    expect(await flush(again.ref)).toBe(false);

    fireEvent.click(within(banner).getByRole('button', { name: /editConflict\.column\.applyMine/ }));
    // Overwrite queues the save behind the autosave delay: a flush sends it now.
    expect(await flush(again.ref)).toBe(true);
    expect(bulkCalls()).toHaveLength(2);
    expect(written(bulkCalls()[1][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(3), committed: 450 }] });
    expect(bulkCalls()[1][1].base).toEqual({ months: [{ period: period(3), committed: '950.00' }] });
  });

  it('a year change with a choice waiting asks, naming the column, and drops it only when confirmed', async () => {
    setupApi();
    refuseBulk((body, call) => (call === 1 ? marchRefused() : null));
    const onYearChange = vi.fn();
    const { ref } = renderTab(YEAR, {}, OPEX_FINANCE_CONFIG, undefined, { onYearChange, availableYears: [YEAR, YEAR + 1] });
    await waitForAmounts();
    typeMonth('committed', 3, '450');
    expect(await flush(ref)).toBe(false);
    await screen.findByRole('region');

    fireEvent.click(screen.getByRole('tab', { name: String(YEAR + 1) }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Someone else changed the Revision column while you were editing it, and you have not chosen which values to keep. Change the year anyway and lose your values in Revision, or stay and choose.');
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onYearChange).not.toHaveBeenCalled();
    expect(screen.getByRole('region')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: String(YEAR + 1) }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Change the year' }));
    await waitFor(() => expect(onYearChange).toHaveBeenCalledWith(YEAR + 1));
    expect(bulkCalls()).toHaveLength(1);
  });

  it('a conflict answer the screen cannot read is an error the user sees; the edit stays, not saved', async () => {
    setupApi();
    refuseBulk((body, call) => (call === 1 ? { response: { status: 409, data: { code: 'edit_conflict', conflicts: [{ field: 'nonsense' }] } } } : null));
    const { ref } = renderTab();
    await waitForAmounts();
    typeMonth('committed', 3, '450');
    expect(await flush(ref)).toBe(false);

    expect(await screen.findByRole('alert')).toHaveTextContent('errors:edit_conflict_unreadable');
    expect(screen.queryByRole('region')).toBeNull();
    expect(cellValue('committed', 3)).toBe('450');
    expect(ref.current?.isDirty()).toBe(true);
    // The next flush sends it again.
    expect(await flush(ref)).toBe(true);
    expect(written(bulkCalls()[1][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(3), committed: 450 }] });
  });
});

describe("BudgetTab others' changes (lot 3G)", () => {
  it('gives the version counter it loaded and the one each of its saves left, not the reload after its own save', async () => {
    setupApi({ budgetRev: 7 });
    mocked.post.mockResolvedValue({ data: { updated: 1, budget_rev: 8 } });
    const onBudgetRev = vi.fn();
    const { ref } = renderTab(YEAR, {}, OPEX_FINANCE_CONFIG, undefined, { onBudgetRev });
    await waitForAmounts();
    expect(onBudgetRev.mock.calls).toEqual([[YEAR, 7]]);

    typeMonth('planned', 3, '1500');
    expect(ref.current?.isSaving()).toBe(true);
    await flush(ref);
    await settle();
    expect(onBudgetRev.mock.calls).toEqual([[YEAR, 7], [YEAR, 8]]);
    expect(ref.current?.isSaving()).toBe(false);
  });

  it('a year without a version is given as none', async () => {
    setupApi({ noVersion: true });
    const onBudgetRev = vi.fn();
    renderTab(YEAR, {}, OPEX_FINANCE_CONFIG, undefined, { onBudgetRev });
    await waitFor(() => expect(onBudgetRev).toHaveBeenCalledWith(YEAR, null));
  });

  it('pending: a month typed and not saved, an amount typed in the editor; nothing once saved', async () => {
    setupApi();
    const { ref } = renderTab();
    await waitForAmounts();
    expect(ref.current?.hasPending()).toBe(false);
    typeMonth('planned', 3, '1500');
    expect(ref.current?.hasPending()).toBe(true);
    await flush(ref);
    await settle();
    expect(ref.current?.hasPending()).toBe(false);
    pick('committed');
    expect(ref.current?.hasPending()).toBe(false);
    fireEvent.change(amountField(), { target: { value: '5000' } });
    expect(ref.current?.hasPending()).toBe(true);
  });

  it("a reload for someone else's change shows it; a month typed and not saved keeps its value and its base", async () => {
    const server = setupApi();
    const { ref } = renderTab();
    await waitForAmounts();
    // The user types March's Revision (not sent yet); Marie changes April's Forecast.
    typeMonth('committed', 3, '450');
    server.items[3].forecast = '650';
    changedByOthers.add(server.items);
    await act(async () => { await ref.current?.reloadFromServer(); });
    await settle();
    expect(cellValue('forecast', 4)).toBe('650');
    expect(cellValue('committed', 3)).toBe('450');
    expect(bulkCalls()).toHaveLength(0);
    // The typed month still goes from what the screen showed when it was typed.
    await flush(ref);
    expect(bulkCalls()[0][1].base).toEqual({ months: [{ period: period(3), committed: '900.00' }] });
  });

  it("a period and a distribution chosen before the amount are the user's: pending, kept by a reload, then written with the amount", async () => {
    const server = setupApi({ empty: true });
    const { ref } = renderTab(YEAR, { effectiveStart: '2026-04-01' });
    await waitForAmounts();
    expect(ref.current?.hasPending()).toBe(false);

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Distribution' }));
    fireEvent.click(await screen.findByRole('option', { name: 'opex.budget.profile445' }));
    typeDate(dateFields()[0], '01/07/2026');
    await settle();
    // No amount yet: nothing written, the choices wait in the editor.
    expect(bulkCalls()).toHaveLength(0);
    expect(ref.current?.hasPending()).toBe(true);

    // Someone else writes June's Forecast; the user reloads: the editor keeps the period and distribution chosen.
    server.items.push({ period: period(6), forecast: '300' } as ServedMonth);
    changedByOthers.add(server.items);
    await act(async () => { await ref.current?.reloadFromServer(); });
    await settle();
    typeAmount('12000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toMatchObject({ totals: { planned: '12000.00' }, spread_profile_name: '4-4-5', period_start: '2026-07-01' });
  });

  it('a reload that fails is not shown: it rejects, so the page does not count it as seen', async () => {
    setupApi();
    const { ref } = renderTab();
    await waitForAmounts();
    const served = mocked.get.getMockImplementation()! as (...args: any[]) => any;
    mocked.get.mockImplementation(async (url: string, config?: unknown) => {
      if (url === '/spend-versions/v1/amounts') throw new Error('offline');
      return served(url, config);
    });
    let failure: unknown = null;
    await act(async () => { await ref.current?.reloadFromServer().catch((error) => { failure = error; }); });
    expect(failure).toBeInstanceOf(Error);
  });

  it("nothing typed: the amount follows its column's new total; an amount being typed stays", async () => {
    const server = setupApi();
    const { ref } = renderTab();
    await waitForAmounts();
    await waitFor(() => expect(amountField()).toHaveValue('12 000'));
    server.items.forEach((month) => { month.planned = '1100'; });
    changedByOthers.add(server.items);
    await act(async () => { await ref.current?.reloadFromServer(); });
    await waitFor(() => expect(amountField()).toHaveValue('13 200'));

    fireEvent.change(amountField(), { target: { value: '9000' } });
    server.items.forEach((month) => { month.planned = '1200'; });
    await act(async () => { await ref.current?.reloadFromServer(); });
    await settle();
    expect(amountField()).toHaveValue('9 000');
    expect(card('planned')).toHaveTextContent('14 400');
  });
});

describe('BudgetTab on the query cache', () => {
  it('shows the year at once when the tab comes back, editable, then refreshes it in the background', async () => {
    setupApi();
    const first = renderTab();
    await waitForAmounts();
    // The field formats its value in an effect: wait for it, never read it right after the load.
    await waitFor(() => expect(amountField()).toHaveValue('12 000'));
    const loads = amountLoads();
    first.unmount();

    renderTab(YEAR, {}, OPEX_FINANCE_CONFIG, first.queryClient);
    // First render: the cached year, no blank editor and no disabled fields while it refreshes.
    expect(amountField()).toHaveValue('12 000');
    expect(amountField()).not.toBeDisabled();
    expect(card('planned')).toHaveTextContent('12 000');
    await waitFor(() => expect(amountLoads()).toBe(loads + 1));
  });

  it('never shows a cached year after a save: the tab loads it again', async () => {
    setupApi();
    const first = renderTab();
    await waitForAmounts();
    typeMonth('planned', 1, '2000');
    await flush(first.ref);
    expect(bulkCalls()).toHaveLength(1);
    await settle();
    first.unmount();

    // The server now holds the saved month; the next load answers it, a little later.
    let answer: () => void = () => undefined;
    const served = mocked.get.getMockImplementation()! as (...args: any[]) => any;
    mocked.get.mockImplementation(async (url: string, config?: unknown) => {
      if (url === '/spend-versions/v1/amounts') await new Promise<void>((resolve) => { answer = resolve; });
      return served(url, config);
    });
    renderTab(YEAR, {}, OPEX_FINANCE_CONFIG, first.queryClient);
    // The pre-save year is not shown meanwhile.
    expect(screen.queryByText('12 000')).toBeNull();
    await waitFor(() => expect(amountLoads()).toBeGreaterThan(2));
    await act(async () => { answer(); });
    await waitFor(() => expect(card('planned')).toHaveTextContent('13 000'));
  });

  it("a monthly save forgets the line's cached Allocations year, which shows the year's totals", async () => {
    setupApi();
    const first = renderTab();
    await waitForAmounts();
    const key = allocationsSnapshotKey(OPEX_FINANCE_CONFIG.itemsApi, 'item-1', YEAR);
    first.queryClient.setQueryData(key, { version: null, computed: [], totals: { planned: 12000 } });
    typeMonth('planned', 1, '2000');
    await flush(first.ref);
    expect(bulkCalls()).toHaveLength(1);
    expect(first.queryClient.getQueryData(key)).toBeUndefined();
  });
});
