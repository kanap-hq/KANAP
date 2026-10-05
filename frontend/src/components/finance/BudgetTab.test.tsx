import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
// `userId` when a test sets one (the view is each user's choice, lot 3D).
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

/** The monthly and yearly bodies posted to the bulk route so far (lines and spreads change what a test says). */
function savedAmountBodies(): Array<Record<string, any>> {
  return mocked.post.mock.calls
    .filter(([url, body]) => String(url).endsWith('/amounts/bulk-upsert') && !refusedBodies.has(body) && (body?.kind === 'monthly' || (body?.kind === 'annual' && !body?.spread_profile_name)))
    .map(([, body]) => body);
}

/** The months as the server holds them after the bodies: cells as sent, a yearly total split over the twelve months. */
function replayWrites(initial: ServedMonth[], bodies: Array<Record<string, any>>): ServedMonth[] {
  const months: ServedMonth[] = Array.from({ length: 12 }, (_, i) => ({
    period: period(i + 1),
    ...Object.fromEntries(COLUMNS.map((c) => [c, '0'])),
    ...(initial.find((row) => row.period === period(i + 1)) ?? {}),
  }));
  for (const body of bodies) {
    if (body.kind === 'monthly') {
      for (const row of body.months) {
        const month = months.find((m) => m.period === row.period);
        if (!month) continue;
        for (const c of COLUMNS) if (row[c] !== undefined) month[c] = String(row[c]);
      }
    } else {
      for (const [c, total] of Object.entries(body.totals ?? {})) {
        const cents = Math.round(Number(total) * 100);
        const each = Math.trunc(cents / 12);
        months.forEach((m, i) => { m[c] = String((i === 11 ? cents - each * 11 : each) / 100); });
      }
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
function setupApi({ grain, frozen = [], empty = false, noVersion = false, roundInputs, monthValues = {}, budgetRev }: {
  grain: Grain;
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
}) {
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
  const totals = empty
    ? { planned: 0, committed: 0, actual: 0, expected_landing: 0, forecast: 0 }
    : { planned: 12000, committed: 10800, actual: 9600, expected_landing: 8400, forecast: 7200 };
  const slot = (col: FrozenColumn) => ({ frozen: state.frozen.includes(col), frozenAt: null, frozenBy: null });
  const scope = () => ({ budget: slot('budget'), revision: slot('revision'), forecast: slot('forecast'), actual: slot('actual'), landing: slot('landing') });
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/spend-items/item-1/versions') return { data: noVersion ? [] : [version] };
    if (url === '/spend-versions/v1/amounts') {
      const served = state.roundInputs ? { round_inputs: state.roundInputs } : {};
      // Every save reloads the year (lot 3D): the server answers what the saves sent.
      const writes = savedAmountBodies();
      if (writes.length === 0 && state.items === items && !changedByOthers.has(items)) return { data: { items, totals, year: YEAR, ...served } };
      const after = replayWrites(state.items, writes);
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
  mocked.post.mockResolvedValue({ data: { updated: 12 } });
  // The version keeps the display grain the component stores on it.
  mocked.patch.mockImplementation(async (_url: string, body: { input_grain?: Grain }) => {
    if (body?.input_grain) version.input_grain = body.input_grain;
    return { data: version };
  });
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

/** Wait until the amounts have been fetched `loads` times in all and the fields are editable. */
async function waitForAmounts(loads = 1) {
  await waitFor(() => {
    expect(amountLoads()).toBeGreaterThanOrEqual(loads);
    expect(screen.queryAllByRole('textbox').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('textbox')[0]).not.toBeDisabled();
  });
}

/** The inputs of the monthly grid, row by row, in the fixed order: Budget, Revision, Forecast, Actuals, Expected landing. */
function monthCells(container: HTMLElement) {
  const table = container.querySelector('table');
  if (!table) throw new Error('monthly table not rendered');
  return within(table as HTMLElement).getAllByRole('textbox') as HTMLInputElement[];
}
const cell = (cells: HTMLInputElement[], month: number, column: number, columns = 5) => cells[(month - 1) * columns + column];

const amountField = () => screen.getByPlaceholderText('opex.budget.spreadPlaceholder');
/** Types an amount in the spread panel and leaves the field, as a user does. */
function typeAmount(value: string) {
  fireEvent.change(amountField(), { target: { value } });
  fireEvent.blur(amountField());
}
/** Lets queued writes and reloads run. */
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
}

async function flush(ref: React.RefObject<BudgetTabHandle>) {
  let ok = true;
  await act(async () => { ok = (await ref.current?.flush()) ?? true; });
  return ok;
}

describe('BudgetTab on the query cache', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
  });

  /** The flat view's Budget total field. */
  const budgetTotal = () => screen.getAllByRole('textbox')[0] as HTMLInputElement;

  it('shows the year at once when the tab comes back, editable, then refreshes it in the background', async () => {
    setupApi({ grain: 'annual' });
    const first = renderTab();
    await waitForAmounts();
    // The field formats its value in an effect: wait for it, never read it right after the load.
    await waitFor(() => expect(budgetTotal()).toHaveValue('12 000'));
    const loads = amountLoads();
    first.unmount();

    renderTab(YEAR, {}, OPEX_FINANCE_CONFIG, first.queryClient);
    // First render: the cached year, no blank grid and no disabled fields while it refreshes.
    expect(budgetTotal()).toHaveValue('12 000');
    expect(budgetTotal()).not.toBeDisabled();
    await waitFor(() => expect(amountLoads()).toBe(loads + 1));
  });

  it('never shows a cached year after a save: the tab loads it again', async () => {
    setupApi({ grain: 'annual' });
    const first = renderTab();
    await waitForAmounts();
    fireEvent.change(budgetTotal(), { target: { value: '15000' } });
    await flush(first.ref);
    expect(bulkCalls()).toHaveLength(1);
    first.unmount();

    // The server now holds the saved total; the next load answers it, a little later.
    let answer: () => void = () => undefined;
    const served = mocked.get.getMockImplementation()!;
    mocked.get.mockImplementation(async (url: string, config?: unknown) => {
      if (url === '/spend-versions/v1/amounts') {
        await new Promise<void>((resolve) => { answer = resolve; });
        const res = await served(url, config);
        return { data: { ...res.data, totals: { ...res.data.totals, planned: 15000 } } };
      }
      return served(url, config);
    });
    renderTab(YEAR, {}, OPEX_FINANCE_CONFIG, first.queryClient);
    // The pre-save year is not shown meanwhile.
    expect(screen.queryByDisplayValue('12 000')).toBeNull();
    await waitFor(() => expect(amountLoads()).toBeGreaterThan(1));
    await act(async () => { answer(); });
    await waitFor(() => expect(budgetTotal()).toHaveValue('15 000'));
  });

  it("a save forgets the line's cached Allocations year, which shows the year's totals", async () => {
    setupApi({ grain: 'annual' });
    const first = renderTab();
    await waitForAmounts();
    const key = allocationsSnapshotKey(OPEX_FINANCE_CONFIG.itemsApi, 'item-1', YEAR);
    const otherYear = allocationsSnapshotKey(OPEX_FINANCE_CONFIG.itemsApi, 'item-1', YEAR + 1);
    first.queryClient.setQueryData(key, { version: null, computed: [], totals: { planned: 12000 } });
    first.queryClient.setQueryData(otherYear, { version: null, computed: [], totals: { planned: 1 } });
    fireEvent.change(budgetTotal(), { target: { value: '15000' } });
    await flush(first.ref);
    expect(bulkCalls()).toHaveLength(1);
    expect(first.queryClient.getQueryData(key)).toBeUndefined();
    expect(first.queryClient.getQueryData(otherYear)).toBeDefined();
  });

  it("a spread from the panel forgets the line's cached Allocations year too", async () => {
    setupApi({ grain: 'monthly' });
    const first = renderTab();
    await waitForAmounts();
    const key = allocationsSnapshotKey(OPEX_FINANCE_CONFIG.itemsApi, 'item-1', YEAR);
    first.queryClient.setQueryData(key, { version: null, computed: [], totals: { planned: 12000 } });
    typeAmount('6000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    await settle();
    expect(first.queryClient.getQueryData(key)).toBeUndefined();
  });
});

describe('BudgetTab write safety', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
  });

  it('flat mode sends only the edited total', async () => {
    setupApi({ grain: 'annual' });
    const { ref } = renderTab();
    await waitForAmounts();

    const [budget] = screen.getAllByRole('textbox');
    fireEvent.change(budget, { target: { value: '15000' } });
    await flush(ref);

    expect(bulkCalls()).toHaveLength(1);
    // The column already holds amounts and has no stored period: the whole year.
    expect(written(bulkCalls()[0][1])).toEqual({
      kind: 'annual', year: YEAR, totals: { planned: 15000 }, period_start: '2026-01-01', period_end: '2026-12-31',
    });
  });

  it('monthly mode sends only the edited cell', async () => {
    setupApi({ grain: 'monthly' });
    const { ref, container } = renderTab();
    await waitForAmounts();

    fireEvent.change(cell(monthCells(container), 3, 1), { target: { value: '450' } });
    await flush(ref);

    expect(bulkCalls()).toHaveLength(1);
    expect(written(bulkCalls()[0][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(3), committed: 450 }] });
  });

  it('switching mode and reloading send no amounts, and write nothing on the shared version', async () => {
    setupApi({ grain: 'annual' });
    const { ref, rerenderYear, container } = renderTab();
    await waitForAmounts();

    fireEvent.click(screen.getByRole('tab', { name: 'opex.budget.monthly' }));
    await waitFor(() => expect(container.querySelector('table')).not.toBeNull());
    await waitForAmounts(2);
    fireEvent.click(screen.getByRole('tab', { name: 'opex.budget.flat' }));
    await waitFor(() => expect(container.querySelector('table')).toBeNull());
    await waitForAmounts(3);
    // The view is each user's choice (lot 3D): the version's input_grain is never written.
    expect(mocked.patch).not.toHaveBeenCalled();

    const loadsBefore = amountLoads();
    rerenderYear(YEAR + 1);
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/freeze-states', { params: { year: YEAR + 1 } }));
    rerenderYear(YEAR);
    await waitForAmounts(loadsBefore + 1);
    await flush(ref);

    expect(bulkCalls()).toHaveLength(0);
  });

  it('an edit is saved once, and not again after a mode switch', async () => {
    setupApi({ grain: 'monthly' });
    const { ref, container } = renderTab();
    await waitForAmounts();

    fireEvent.change(cell(monthCells(container), 1, 0), { target: { value: '1500' } });
    await flush(ref);
    expect(bulkCalls()).toHaveLength(1);

    fireEvent.click(screen.getByRole('tab', { name: 'opex.budget.flat' }));
    // Loaded: first, after the save, after the switch.
    await waitForAmounts(3);
    await flush(ref);

    expect(bulkCalls()).toHaveLength(1);
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('a failed save keeps its edits for the next one', async () => {
    setupApi({ grain: 'monthly' });
    mocked.post.mockRejectedValueOnce(new Error('network down'));
    const { ref, container } = renderTab();
    await waitForAmounts();

    fireEvent.change(cell(monthCells(container), 1, 0), { target: { value: '1500' } });
    expect(await flush(ref)).toBe(false);
    expect(ref.current?.isDirty()).toBe(true);

    fireEvent.change(cell(monthCells(container), 2, 1), { target: { value: '950' } });
    expect(await flush(ref)).toBe(true);
    expect(ref.current?.isDirty()).toBe(false);

    expect(bulkCalls()).toHaveLength(2);
    expect(written(bulkCalls()[1][1])).toEqual({
      kind: 'monthly',
      year: YEAR,
      months: [
        { period: period(1), planned: 1500 },
        { period: period(2), committed: 950 },
      ],
    });
  });

  it('a flush retries an edit whose save failed', async () => {
    setupApi({ grain: 'monthly' });
    mocked.post.mockRejectedValueOnce(new Error('network down'));
    const { ref, container } = renderTab();
    await waitForAmounts();

    fireEvent.change(cell(monthCells(container), 1, 0), { target: { value: '1500' } });
    expect(await flush(ref)).toBe(false);
    expect(await flush(ref)).toBe(true);

    expect(bulkCalls()).toHaveLength(2);
    expect(written(bulkCalls()[1][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(1), planned: 1500 }] });
    expect(ref.current?.isDirty()).toBe(false);
  });

  it('a spread after a failed save keeps the edit and does not post the spread', async () => {
    setupApi({ grain: 'monthly' });
    mocked.post.mockRejectedValue(new Error('network down'));
    const { ref, container } = renderTab();
    await waitForAmounts();

    fireEvent.change(cell(monthCells(container), 1, 0), { target: { value: '1500' } });
    expect(await flush(ref)).toBe(false);
    expect(ref.current?.isDirty()).toBe(true);

    typeAmount('24000');
    // The spread first retries the unsaved edit; it fails again, so the spread stops there.
    await waitFor(() => expect(bulkCalls()).toHaveLength(2));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

    expect(bulkCalls().every(([, body]) => body.kind === 'monthly')).toBe(true);
    expect(cell(monthCells(container), 1, 0).value).toBe('1 500');
    expect(ref.current?.isDirty()).toBe(true);

    mocked.post.mockResolvedValue({ data: { updated: 1 } });
    expect(await flush(ref)).toBe(true);
    expect(written(bulkCalls()[2][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(1), planned: 1500 }] });
  });

  it('a save refused by a new freeze refreshes the freeze and drops the frozen cells', async () => {
    const state = setupApi({ grain: 'monthly' });
    const { ref, container } = renderTab();
    await waitForAmounts();
    await waitFor(() => expect(freezeLoads()).toBe(1));

    // Budget gets frozen by an administrator while the tab is open.
    state.frozen = ['budget'];
    mocked.post.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { response: { status: 403, data: { message: 'OPEX Budget for 2026 is frozen' } } }));
    fireEvent.change(cell(monthCells(container), 1, 0), { target: { value: '1500' } });
    expect(await flush(ref)).toBe(false);

    await waitFor(() => expect(freezeLoads()).toBe(2));
    await waitFor(() => expect(cell(monthCells(container), 1, 0)).toHaveAttribute('readonly'));
    expect(await flush(ref)).toBe(true);

    expect(bulkCalls()).toHaveLength(1);
    expect(ref.current?.isDirty()).toBe(false);
  });

  it('clearing a column asks first, then sends that column only, for the twelve months', async () => {
    setupApi({ grain: 'monthly' });
    const { ref, container } = renderTab();
    await waitForAmounts();

    const clearButtons = screen.getAllByRole('button', { name: 'opex.budget.clearColumn' });
    fireEvent.click(clearButtons[1]); // Revision
    const dialog = await screen.findByRole('dialog');
    // The tenant's name of the column and the year.
    expect(dialog).toHaveTextContent('Clear every month of Revision for 2026? The other columns stay as they are.');
    // Nothing is cleared while the question is open (the grid is hidden from the accessibility tree meanwhile).
    expect(container.querySelector('table')!.querySelectorAll('input')[1]).toHaveValue('900');
    fireEvent.click(within(dialog).getByRole('button', { name: 'opex.budget.clearColumn' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(cell(monthCells(container), 1, 1)).toHaveValue('0'));
    await flush(ref);

    expect(bulkCalls()).toHaveLength(1);
    expect(written(bulkCalls()[0][1])).toEqual({
      kind: 'monthly',
      year: YEAR,
      months: Array.from({ length: 12 }, (_, i) => ({ period: period(i + 1), committed: 0 })),
    });
  });

  it('on a CAPEX item the question names the column as the tenant calls it', async () => {
    columnsSetting.current = { ...ALL_SHOWN, labels: { ...ALL_SHOWN.labels, committed: 'Run cost' } };
    setupApi({ grain: 'monthly' });
    // The same item, under the CAPEX routes.
    const spendGet = mocked.get.getMockImplementation()!;
    mocked.get.mockImplementation((url: string, config?: unknown) => spendGet(
      url.replace('/capex-items/', '/spend-items/').replace('/capex-versions/', '/spend-versions/'), config,
    ));
    const { ref } = renderTab(YEAR, {}, CAPEX_FINANCE_CONFIG);
    await waitFor(() => {
      expect(mocked.get.mock.calls.some(([url]) => url === '/capex-versions/v1/amounts')).toBe(true);
      expect(screen.getAllByRole('textbox')[0]).not.toBeDisabled();
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'capex.budget.clearColumn' })[1]);
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
    setupApi({ grain: 'monthly' });
    const { ref, container } = renderTab();
    await waitForAmounts();

    fireEvent.click(screen.getAllByRole('button', { name: 'opex.budget.clearColumn' })[1]); // Revision
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'buttons.cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await flush(ref);

    const cells = monthCells(container);
    for (let month = 1; month <= 12; month++) expect(cell(cells, month, 1)).toHaveValue('900');
    expect(bulkCalls()).toHaveLength(0);
    expect(ref.current?.isDirty()).toBe(false);
  });

  it('a column already at zero is cleared without a question', async () => {
    setupApi({ grain: 'monthly', monthValues: { committed: '0' } });
    const { ref } = renderTab();
    await waitForAmounts();

    fireEvent.click(screen.getAllByRole('button', { name: 'opex.budget.clearColumn' })[1]); // Revision
    await flush(ref);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bulkCalls()).toHaveLength(1);
    expect(written(bulkCalls()[0][1])).toEqual({
      kind: 'monthly',
      year: YEAR,
      months: Array.from({ length: 12 }, (_, i) => ({ period: period(i + 1), committed: 0 })),
    });
  });

  it('a frozen Forecast is read-only and never sent', async () => {
    setupApi({ grain: 'monthly', frozen: ['forecast'] });
    const { ref, container } = renderTab();
    await waitForAmounts();
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/freeze-states', { params: { year: YEAR } }));

    await waitFor(() => {
      const cells = monthCells(container);
      for (let month = 1; month <= 12; month++) {
        expect(cell(cells, month, 2)).toHaveAttribute('readonly');
      }
    });
    expect(screen.getAllByRole('button', { name: 'opex.budget.clearColumn' })).toHaveLength(4);

    const cells = monthCells(container);
    fireEvent.change(cell(cells, 1, 2), { target: { value: '5' } });
    fireEvent.change(cell(cells, 1, 0), { target: { value: '1500' } });
    await flush(ref);

    expect(bulkCalls()).toHaveLength(1);
    expect(written(bulkCalls()[0][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(1), planned: 1500 }] });
  });
});

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

const periodLine = (measure: string) => screen.getByTestId(`period-line-${measure}`);
// How the column was produced, then its period: one line each.
const captionLines = (measure: string) => Array.from(periodLine(measure).children).map((line) => line.textContent);

/** Wait until the amounts are loaded, without assuming the first field is editable. */
async function waitForLoad() {
  await waitFor(() => {
    expect(amountLoads()).toBeGreaterThanOrEqual(1);
    expect(screen.queryAllByRole('textbox').length).toBeGreaterThan(0);
  });
}

describe('BudgetTab periods', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
  });

  it('the yearly view suggests the item period for an empty column and sends it with the total', async () => {
    setupApi({ grain: 'annual', empty: true });
    const { ref } = renderTab(YEAR, { effectiveStart: '2026-04-01' });
    await waitForAmounts();

    expect(periodLine('planned')).toHaveTextContent('9 months, April to December');
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '12000' } });
    await flush(ref);

    expect(bulkCalls()).toHaveLength(1);
    expect(written(bulkCalls()[0][1])).toEqual({
      kind: 'annual', year: YEAR, totals: { planned: 12000 }, period_start: '2026-04-01', period_end: '2026-12-31',
    });
  });

  it('a column that already holds amounts keeps the whole year', async () => {
    setupApi({ grain: 'annual' });
    renderTab(YEAR, { effectiveStart: '2026-04-01' });
    await waitForAmounts();

    expect(periodLine('planned')).toHaveTextContent('12 months, January to December');
    expect(periodLine('committed')).toHaveTextContent('12 months, January to December');
  });

  it('a stored period wins, with its chip, and totals on different periods are sent apart', async () => {
    setupApi({
      grain: 'annual',
      roundInputs: [
        record({
          method: 'copied',
          last_calculation: { kind: 'copy', source_year: 2025, source_measure: 'planned', uplift_pct: '2', source_total: '12000.00', total: '12240.00', source_method: 'spread' },
        }),
        record({ measure: 'committed', method: 'manual', period_start: '2026-07-01', period_end: '2026-12-31' }),
      ],
    });
    const { ref } = renderTab(YEAR, { effectiveStart: '2026-04-01' });
    await waitForAmounts();

    expect(captionLines('planned')).toEqual(['Copied from Budget 2025 +2%', '9 months, April to December']);
    expect(captionLines('committed')).toEqual(['Edited by hand', '6 months, July to December']);
    // No stored period on Landing: it holds amounts, so the whole year and no chip.
    expect(periodLine('expected_landing')).toHaveTextContent(/^12 months, January to December$/);

    const [budget, revision] = screen.getAllByRole('textbox');
    fireEvent.change(budget, { target: { value: '6000' } });
    fireEvent.change(revision, { target: { value: '3000' } });
    await flush(ref);

    expect(bulkCalls().map(([, body]) => written(body))).toEqual([
      { kind: 'annual', year: YEAR, totals: { planned: 6000 }, period_start: '2026-04-01', period_end: '2026-12-31' },
      { kind: 'annual', year: YEAR, totals: { committed: 3000 }, period_start: '2026-07-01', period_end: '2026-12-31' },
    ]);
  });

  it('the total is disabled when the item dates leave no month of the year', async () => {
    setupApi({ grain: 'annual', empty: true });
    renderTab(YEAR, { effectiveStart: '2027-02-01' });
    await waitForLoad();

    await waitFor(() => expect(periodLine('planned')).toHaveTextContent("No month of 2026 is within the item's dates."));
    expect(screen.getAllByRole('textbox')[0]).toBeDisabled();
    // Every shown column, Forecast and Actuals included.
    expect(screen.getAllByRole('button', { name: 'Choose the period' })).toHaveLength(5);
    expect(periodLine('actual')).toHaveTextContent("No month of 2026 is within the item's dates.");
  });

  it('the save response refreshes the chip', async () => {
    const server = setupApi({ grain: 'annual', empty: true });
    // The server holds the record the save answers; the reload after the save reads it too.
    mocked.post.mockImplementation(async () => {
      server.roundInputs = [record({})];
      return { data: { updated: 9, round_inputs: [record({})] } };
    });
    const { ref } = renderTab(YEAR, { effectiveStart: '2026-04-01' });
    await waitForAmounts();

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '12000' } });
    await flush(ref);

    await waitFor(() => expect(captionLines('planned')).toEqual(['Spread flat', '9 months, April to December']));
  });

  it('the monthly grid shows how each column was produced', async () => {
    setupApi({
      grain: 'monthly',
      roundInputs: [
        record({ spread_profile_name: '4-4-5', last_calculation: { kind: 'annual', total: '12000.00', profile: '4-4-5', active_months: [4, 5, 6, 7, 8, 9, 10, 11, 12], weights: [] } }),
        record({ measure: 'forecast', method: 'manual', period_start: '2026-01-01' }),
        record({ measure: 'actual', method: 'copied', period_start: '2026-01-01', last_calculation: { kind: 'copy', source_year: 2025, source_measure: 'actual', uplift_pct: '0', source_total: '9600.00', total: '9600.00', source_method: null } }),
      ],
    });
    const { container } = renderTab();
    await waitForAmounts();

    const header = container.querySelector('thead') as HTMLElement;
    expect(within(header).getByText('Spread 4-4-5')).toBeInTheDocument();
    expect(within(header).getByText('Edited by hand')).toBeInTheDocument();
    // Actuals carry their label like any column.
    expect(within(header).getByText('Copied from Actuals 2025')).toBeInTheDocument();
  });

  it('the spread panel shows the zeroed months and the item-dates hint, and the 15th rule on hover', async () => {
    setupApi({ grain: 'monthly', empty: true });
    renderTab(YEAR, { effectiveStart: '2026-04-01' });
    await waitForAmounts();

    // The date fields show the period: the panel only says what falls outside it.
    expect(screen.getByTestId('spread-notes')).toHaveTextContent(/^January to March will be set to zero\.$/);
    expect(screen.queryByText(/9 months, April to December/)).not.toBeInTheDocument();
    expect(screen.queryByText("The period goes beyond the item's dates.")).not.toBeInTheDocument();

    const rule = screen.getByLabelText('A month counts when the period covers its 15th.');
    fireEvent.mouseOver(rule);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('A month counts when the period covers its 15th.');

    const [from] = screen.getAllByPlaceholderText('labels.datePlaceholder');
    fireEvent.focus(from);
    fireEvent.change(from, { target: { value: '01/02/2026' } });
    fireEvent.blur(from);

    expect(await screen.findByText('January will be set to zero.')).toBeInTheDocument();
    expect(screen.getByText("The period goes beyond the item's dates.")).toBeInTheDocument();

    // An empty column: no amount, so the date changes wrote nothing.
    expect(bulkCalls()).toHaveLength(0);
    // A period in which no month counts writes nothing either.
    fireEvent.focus(from);
    fireEvent.change(from, { target: { value: '20/12/2026' } });
    fireEvent.blur(from);
    typeAmount('500');
    expect(await screen.findByText('No month counts in this period.')).toBeInTheDocument();
    await settle();
    expect(bulkCalls()).toHaveLength(0);
  });

  it('the amount writes on leaving the field, the distribution on change, each with the period', async () => {
    setupApi({ grain: 'monthly', empty: true });
    renderTab(YEAR, { effectiveStart: '2026-04-01' });
    await waitForAmounts();

    typeAmount('12000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    // "Apply the distribution to all columns" is on by default: the empty columns get the same period.
    expect(written(bulkCalls()[0][1])).toEqual({
      kind: 'annual',
      year: YEAR,
      totals: { planned: '12000.00' },
      also_measures: ['committed', 'forecast', 'actual', 'expected_landing'],
      spread_profile_name: 'flat',
      period_start: '2026-04-01',
      period_end: '2026-12-31',
    });
    await waitFor(() => expect(amountLoads()).toBe(2));

    const [, distribution] = screen.getAllByRole('combobox');
    fireEvent.mouseDown(distribution);
    fireEvent.click(await screen.findByRole('option', { name: 'opex.budget.profile445' }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(2));
    expect(bulkCalls()[1][1]).toMatchObject({ totals: { planned: '12000.00' }, spread_profile_name: '4-4-5', period_start: '2026-04-01' });
    // Leaving the amount unchanged writes nothing more; the grid never turned read-only.
    fireEvent.blur(amountField());
    await settle();
    expect(bulkCalls()).toHaveLength(2);
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('a blank or zero amount writes nothing', async () => {
    setupApi({ grain: 'monthly' });
    renderTab();
    await waitForAmounts();

    typeAmount('');
    typeAmount('0');
    await settle();
    expect(bulkCalls()).toHaveLength(0);
  });

  it('Change period in the yearly view opens the panel on that column and stays in the yearly view', async () => {
    setupApi({ grain: 'annual' });
    renderTab(YEAR, { effectiveStart: '2026-04-01' });
    await waitForAmounts();

    fireEvent.click(within(periodLine('committed').parentElement as HTMLElement).getByRole('button', { name: 'Change period' }));
    const amount = await screen.findByPlaceholderText('opex.budget.spreadPlaceholder');
    expect(amount).toHaveValue('10 800');
    // The five period lines (Forecast and Actuals included) keep the stored whole year;
    // the panel proposes it within the item's dates (from April 1), and saves nothing yet.
    expect(screen.getAllByText('12 months, January to December')).toHaveLength(5);
    expect(screen.getByTestId('spread-notes')).toHaveTextContent(/^January to March will be set to zero\.$/);
    expect(bulkCalls()).toHaveLength(0);

    const [from] = screen.getAllByPlaceholderText('labels.datePlaceholder');
    fireEvent.focus(from);
    fireEvent.change(from, { target: { value: '01/07/2026' } });
    fireEvent.blur(from);

    // The date is written at once, with the column's total.
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(written(bulkCalls()[0][1])).toEqual({
      kind: 'annual',
      year: YEAR,
      totals: { committed: '10800.00' },
      also_measures: ['planned', 'forecast', 'actual', 'expected_landing'],
      spread_profile_name: 'flat',
      period_start: '2026-07-01',
      period_end: '2026-12-31',
    });
    await waitFor(() => expect(amountLoads()).toBe(2));
    expect(mocked.patch).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: 'opex.budget.flat' })).toHaveAttribute('aria-selected', 'true');
    // The box stays open for the next change.
    expect(amountField()).toBeInTheDocument();
  });

  it('the panel proposes the stored period cut at the end of validity, without saving it on open', async () => {
    setupApi({ grain: 'annual', roundInputs: [record({ period_start: '2026-01-01', period_end: '2026-12-31' })] });
    const { ref } = renderTab(YEAR, { endOfValidity: '2026-06-30' });
    await waitForAmounts();

    fireEvent.click(within(periodLine('planned').parentElement as HTMLElement).getByRole('button', { name: 'Change period' }));
    await screen.findByPlaceholderText('opex.budget.spreadPlaceholder');
    expect(screen.getByTestId('spread-notes')).toHaveTextContent(/^July to December will be set to zero\.$/);
    // The column still shows its stored period, and opening the panel wrote nothing.
    expect(captionLines('planned')).toEqual(['Spread flat', '12 months, January to December']);
    expect(ref.current!.isDirty()).toBe(false);
    expect(bulkCalls()).toHaveLength(0);
    expect(mocked.patch).not.toHaveBeenCalled();

    typeAmount('6000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toMatchObject({ totals: { planned: '6000.00' }, period_start: '2026-01-01', period_end: '2026-06-30' });
  });

  it('a typed yearly total keeps the stored period, even beyond the end of validity', async () => {
    setupApi({ grain: 'annual', roundInputs: [record({ period_start: '2026-01-01', period_end: '2026-12-31' })] });
    const { ref } = renderTab(YEAR, { endOfValidity: '2026-06-30' });
    await waitForAmounts();

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '6000' } });
    await flush(ref);
    expect(bulkCalls().map(([, body]) => written(body))).toEqual([
      { kind: 'annual', year: YEAR, totals: { planned: 6000 }, period_start: '2026-01-01', period_end: '2026-12-31' },
    ]);
  });

  it('Change period on a 4-4-5 column keeps 4-4-5', async () => {
    setupApi({
      grain: 'annual',
      roundInputs: [record({ spread_profile_name: '4-4-5', last_calculation: { kind: 'annual', total: '12000.00', profile: '4-4-5', active_months: [4, 5, 6, 7, 8, 9, 10, 11, 12], weights: [] } })],
    });
    renderTab(YEAR, { effectiveStart: '2026-04-01' });
    await waitForAmounts();

    fireEvent.click(within(periodLine('planned').parentElement as HTMLElement).getByRole('button', { name: 'Change period' }));
    const [from] = await screen.findAllByPlaceholderText('labels.datePlaceholder');
    fireEvent.focus(from);
    fireEvent.change(from, { target: { value: '01/05/2026' } });
    fireEvent.blur(from);

    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toMatchObject({ totals: { planned: '12000.00' }, spread_profile_name: '4-4-5', period_start: '2026-05-01', period_end: '2026-12-31' });
  });

  it('a year switch closes the yearly panel and hides the period lines until the new year is loaded', async () => {
    setupApi({ grain: 'annual', roundInputs: [record({})] });
    const { rerenderYear } = renderTab(YEAR, { effectiveStart: '2026-04-01' });
    await waitForAmounts();

    fireEvent.click(within(periodLine('planned').parentElement as HTMLElement).getByRole('button', { name: 'Change period' }));
    expect(await screen.findByPlaceholderText('opex.budget.spreadPlaceholder')).toHaveValue('12 000');

    rerenderYear(YEAR + 1);
    // The 2026 period is never read against 2027 (it would give "No month of 2027 ...").
    expect(screen.queryByText(/No month of 2027/)).not.toBeInTheDocument();
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/freeze-states', { params: { year: YEAR + 1 } }));
    await waitFor(() => expect(periodLine('planned')).toHaveTextContent('12 months, January to December'));
    expect(screen.queryByPlaceholderText('opex.budget.spreadPlaceholder')).not.toBeInTheDocument();
  });

  it('the yearly box has no Spread, Reset or Cancel button, only its close control', async () => {
    setupApi({ grain: 'annual' });
    renderTab();
    await waitForAmounts();

    fireEvent.click(within(periodLine('planned').parentElement as HTMLElement).getByRole('button', { name: 'Change period' }));
    await screen.findByPlaceholderText('opex.budget.spreadPlaceholder');
    for (const name of ['Spread', 'Apply', 'Reset', 'common:buttons.cancel']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.close' }));
    expect(screen.queryByPlaceholderText('opex.budget.spreadPlaceholder')).not.toBeInTheDocument();
    expect(bulkCalls()).toHaveLength(0);
  });

  it('the monthly box has no close control', async () => {
    setupApi({ grain: 'monthly' });
    renderTab();
    await waitForAmounts();
    expect(screen.queryByRole('button', { name: 'common:buttons.close' })).not.toBeInTheDocument();
  });

  it('Apply the distribution to all columns names the other columns, never a frozen one, and sends none of their totals', async () => {
    setupApi({ grain: 'monthly', frozen: ['revision'], monthValues: { forecast: '333.33' } });
    renderTab();
    await waitForAmounts();

    // No list under the switch: the rule is in its tooltip.
    expect(screen.queryByText(/will also be spread/)).not.toBeInTheDocument();
    fireEvent.mouseOver(screen.getByText('Apply the distribution to all columns'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Budget, Revision, Forecast, Actuals and Expected landing follow the same period. Frozen columns never change.',
    );

    typeAmount('24000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    // The server spreads the other columns from the totals it holds (scenario 5, lot 3D): a total the
    // screen shows may be older than someone else's change. Only the typed column says what it started from.
    expect(bulkCalls()[0][1]).toEqual({
      kind: 'annual',
      year: YEAR,
      totals: { planned: '24000.00' },
      also_measures: ['forecast', 'actual', 'expected_landing'],
      spread_profile_name: 'flat',
      period_start: '2026-01-01',
      period_end: '2026-12-31',
      base: { columns: { planned: { months: Array.from({ length: 12 }, () => '1000.00') } } },
    });
  });

  it('with Apply the distribution to all columns off, only the selected column is sent; turning it off writes nothing', async () => {
    setupApi({ grain: 'monthly' });
    renderTab();
    await waitForAmounts();

    fireEvent.click(screen.getByLabelText('Apply the distribution to all columns'));
    expect(screen.getByLabelText('Apply the distribution to all columns')).not.toBeChecked();
    await settle();
    expect(bulkCalls()).toHaveLength(0);
    typeAmount('13000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toMatchObject({ totals: { planned: '13000.00' } });
    expect(Object.keys(bulkCalls()[0][1].totals)).toEqual(['planned']);
  });

  it('turning Apply the distribution to all columns on writes the spread to the group at once', async () => {
    setupApi({ grain: 'monthly' });
    renderTab();
    await waitForAmounts();

    fireEvent.click(screen.getByLabelText('Apply the distribution to all columns'));
    fireEvent.click(screen.getByLabelText('Apply the distribution to all columns'));
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1].totals).toEqual({ planned: '12000.00' });
    expect(bulkCalls()[0][1].also_measures).toEqual(['committed', 'forecast', 'actual', 'expected_landing']);
  });

  it('the monthly panel starts with the column total and follows the column select', async () => {
    setupApi({ grain: 'monthly' });
    renderTab();
    await waitForAmounts();

    const amount = screen.getByPlaceholderText('opex.budget.spreadPlaceholder');
    expect(amount).toHaveValue('12 000');
    // A whole-year period within the item's dates: the panel shows no line at all.
    expect(screen.queryByTestId('spread-notes')).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
    fireEvent.click(await screen.findByRole('option', { name: 'Revision' }));
    expect(amount).toHaveValue('10 800');

    fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
    fireEvent.click(await screen.findByRole('option', { name: 'Actuals' }));
    expect(amount).toHaveValue('9 600');
  });

  it('Actuals is a column like the others: its period, its label and the switch', async () => {
    setupApi({
      grain: 'annual',
      roundInputs: [record({ measure: 'actual', method: 'manual', period_start: '2026-07-01' })],
    });
    renderTab(YEAR, { effectiveStart: '2026-04-01' });
    await waitForAmounts();

    expect(captionLines('actual')).toEqual(['Edited by hand', '6 months, July to December']);

    // From Actuals, the switch spreads every column.
    fireEvent.click(within(periodLine('actual').parentElement as HTMLElement).getByRole('button', { name: 'Change period' }));
    expect(await screen.findByPlaceholderText('opex.budget.spreadPlaceholder')).toHaveValue('9 600');
    expect(screen.getByLabelText('Apply the distribution to all columns')).toBeChecked();
    // Off then on: the spread goes to every column at once.
    fireEvent.click(screen.getByLabelText('Apply the distribution to all columns'));
    fireEvent.click(screen.getByLabelText('Apply the distribution to all columns'));

    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(written(bulkCalls()[0][1])).toEqual({
      kind: 'annual',
      year: YEAR,
      totals: { actual: '9600.00' },
      also_measures: ['planned', 'committed', 'forecast', 'expected_landing'],
      spread_profile_name: 'flat',
      period_start: '2026-07-01',
      period_end: '2026-12-31',
    });
  });
});

describe('BudgetTab columns from the setting', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
  });

  const headerLabels = (container: HTMLElement) =>
    Array.from((container.querySelector('thead') as HTMLElement).querySelectorAll('th')).slice(1).map((th) => th.firstElementChild?.textContent);

  it('shows the shown columns only, in the fixed order, in the grid and the yearly view', async () => {
    columnsSetting.current = DEFAULT_BUDGET_COLUMNS;
    setupApi({ grain: 'monthly' });
    const { container, unmount } = renderTab();
    await waitForAmounts();

    expect(headerLabels(container)).toEqual(['Budget', 'Revision', 'Actuals', 'Expected landing']);
    expect(monthCells(container)).toHaveLength(12 * 4);
    // The quarter and year totals follow the same columns.
    expect(container.querySelectorAll('tfoot td')).toHaveLength(1 + 4);
    unmount();

    setupApi({ grain: 'annual' });
    renderTab();
    await waitForAmounts(2);
    expect(screen.getByTestId('period-line-planned')).toBeInTheDocument();
    expect(screen.queryByTestId('period-line-forecast')).not.toBeInTheDocument();
  });

  it('shows Forecast in the yearly view when it is shown, and saves its total', async () => {
    setupApi({ grain: 'annual' });
    const { ref, container } = renderTab();
    await waitForAmounts();

    expect(periodLine('forecast')).toHaveTextContent('12 months, January to December');
    const fields = within(container).getAllByRole('textbox');
    // Budget, Revision, Forecast: the third field.
    await waitFor(() => expect(fields[2]).toHaveValue('7 200'));
    fireEvent.change(fields[2], { target: { value: '5000' } });
    await flush(ref);
    expect(written(bulkCalls()[0][1])).toEqual({
      kind: 'annual', year: YEAR, totals: { forecast: 5000 }, period_start: '2026-01-01', period_end: '2026-12-31',
    });
  });

  it('names the columns with the tenant names', async () => {
    columnsSetting.current = { ...ALL_SHOWN, labels: { planned: 'A0', committed: 'A1', forecast: 'A2', actual: 'A3', expected_landing: 'Real' } };
    setupApi({ grain: 'monthly' });
    const { container } = renderTab();
    await waitForAmounts();

    expect(headerLabels(container)).toEqual(['A0', 'A1', 'A2', 'A3', 'Real']);
    fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['A0', 'A1', 'A2', 'A3', 'Real']);
  });

  it('opens the spread panel on the default column', async () => {
    columnsSetting.current = { ...ALL_SHOWN, default_column: 'committed' };
    setupApi({ grain: 'monthly' });
    renderTab();
    await waitForAmounts();

    await waitFor(() => {
      expect(screen.getAllByRole('combobox')[0]).toHaveTextContent('Revision');
      expect(screen.getByPlaceholderText('opex.budget.spreadPlaceholder')).toHaveValue('10 800');
    });
    fireEvent.click(screen.getByLabelText('Apply the distribution to all columns'));
    typeAmount('5000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1].totals).toEqual({ committed: '5000.00' });
  });

  it('by default every shown column follows, and a hidden column is never spread', async () => {
    columnsSetting.current = DEFAULT_BUDGET_COLUMNS;
    setupApi({ grain: 'monthly' });
    renderTab();
    await waitForAmounts();

    typeAmount('13000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1].totals).toEqual({ planned: '13000.00' });
    expect(bulkCalls()[0][1].also_measures).toEqual(['committed', 'actual', 'expected_landing']);
  });

  it('a column taken out of the group keeps its own period, the tooltip says so, and it spreads alone', async () => {
    columnsSetting.current = { ...ALL_SHOWN, group_spread: { ...ALL_SHOWN.group_spread, expected_landing: false } };
    setupApi({ grain: 'monthly' });
    renderTab();
    await waitForAmounts();

    fireEvent.mouseOver(screen.getByText('Apply the distribution to all columns'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Budget, Revision, Forecast and Actuals follow the same period. Expected landing keeps its own period. Frozen columns never change.',
    );
    typeAmount('13000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(Object.keys(bulkCalls()[0][1].totals)).toEqual(['planned']);
    expect(bulkCalls()[0][1].also_measures).toEqual(['committed', 'forecast', 'actual']);

    // Spreading the column outside the group: no switch, that column only.
    fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
    fireEvent.click(await screen.findByRole('option', { name: 'Expected landing' }));
    await waitFor(() => expect(screen.queryByText('Apply the distribution to all columns')).not.toBeInTheDocument());
    typeAmount('9000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(2));
    expect(bulkCalls()[1][1].totals).toEqual({ expected_landing: '9000.00' });
  });

  it('offers no switch when every other column of the group is frozen', async () => {
    columnsSetting.current = { ...DEFAULT_BUDGET_COLUMNS, enabled: { ...DEFAULT_BUDGET_COLUMNS.enabled, actual: false, expected_landing: false } };
    setupApi({ grain: 'monthly', frozen: ['revision'] });
    renderTab();
    await waitForAmounts();
    await waitFor(() => expect(freezeLoads()).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(screen.queryByText('Apply the distribution to all columns')).not.toBeInTheDocument());
  });
});

const VERSIONS = '/spend-items/item-1/versions';
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

/** Types a date in a DateEUField the way a user does. */
function typeDate(input: HTMLElement, ddmmyyyy: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: ddmmyyyy } });
  fireEvent.blur(input);
}

/** Every POST answers like bulk-upsert, except the version creation. */
function routePosts(bulk: (body: Record<string, unknown>) => Promise<unknown> = async () => ({ updated: 12 })) {
  mocked.post.mockImplementation(async (url: string, body: Record<string, unknown>) => {
    if (url === VERSIONS) return { data: { id: 'v1', input_grain: 'annual', budget_year: YEAR } };
    return { data: await bulk(body) };
  });
}

const openLines = () => fireEvent.click(screen.getByRole('tab', { name: 'Quantity and price' }));
const leave = (input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe('BudgetTab quantity and price', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
    calendarsState.list = [FRANCE, UNITED_STATES];
  });

  it('the panel box switches between spreading an amount and quantity and price', async () => {
    setupApi({ grain: 'monthly' });
    renderTab();
    await waitForAmounts();

    expect(screen.getByRole('tab', { name: 'Spread an amount' })).toHaveAttribute('aria-selected', 'true');
    openLines();
    expect(screen.queryByPlaceholderText('opex.budget.spreadPlaceholder')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a line' })).toBeInTheDocument();
    // No button to compute or spread: every change is saved as it is made.
    expect(screen.queryByRole('button', { name: /compute|spread/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Spread an amount' }));
    expect(amountField()).toHaveValue('12 000');
    expect(screen.queryByRole('button', { name: 'Add a line' })).not.toBeInTheDocument();
  });

  it('a complete line is written as the column lines, on the paying company calendar, and the grid reloads', async () => {
    setupApi({ grain: 'monthly', empty: true });
    routePosts(async () => ({ updated: 12, round_inputs: [linesRecord([storedLine({ label: '', quantity_unit: 'people', quantity: '1.000', frequency: 'per_month', period_start: '2026-01-01' })])] }));
    renderTab(YEAR, { payingCompanyCountry: 'US' });
    await waitForAmounts();

    openLines();
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
    // The box stays as it is, the view stays monthly, nothing else was written.
    expect(screen.getByRole('button', { name: 'Add a line' })).toBeInTheDocument();
    expect(screen.getByLabelText('Unit price')).toHaveValue('600');
    expect(mocked.patch).not.toHaveBeenCalled();
    expect(bulkCalls()).toHaveLength(1);
  });

  it('from the yearly view the calculator opens the lines; a write creates the version, keeps the box open and the view yearly', async () => {
    setupApi({ grain: 'annual', empty: true, noVersion: true });
    routePosts();
    renderTab();
    await waitFor(() => expect(periodLine('planned')).toHaveTextContent('12 months, January to December'));
    const versionPosts = () => mocked.post.mock.calls.filter(([url]) => url === VERSIONS);

    // No company country: the first calendar by name.
    fireEvent.click(within(periodLine('planned').parentElement as HTMLElement).getByRole('button', { name: 'Quantity and price' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add a line' }));
    // Adding a line writes nothing: it has no unit price and no days yet.
    expect(versionPosts()).toHaveLength(0);
    leave(screen.getByLabelText('Unit price'), '200');
    expect(versionPosts()).toHaveLength(0);
    leave(screen.getByLabelText('days per month'), '5');

    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(versionPosts()).toHaveLength(1);
    expect(bulkCalls()[0][1]).toMatchObject({ kind: 'lines', measure: 'planned', lines: [expect.objectContaining({ unit_price: '200', price_basis: 'per_day', days_per_month: '5', working_day_profile_id: 'cal-fr' })] });
    expect(mocked.patch).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: 'opex.budget.flat' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Add a line' })).toBeInTheDocument();
  });

  it('Apply these lines to all columns sends the same lines to the group columns too, never a frozen one', async () => {
    setupApi({ grain: 'monthly', frozen: ['revision'], roundInputs: [linesRecord()] });
    routePosts();
    renderTab();
    await waitForAmounts();
    await waitFor(() => expect(freezeLoads()).toBeGreaterThanOrEqual(1));

    openLines();
    // Off by default: the other columns keep their amounts.
    const toAll = await screen.findByLabelText('Apply these lines to all columns');
    expect(toAll).not.toBeChecked();
    fireEvent.click(toAll);

    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    const body = bulkCalls()[0][1];
    expect(body).toMatchObject({ kind: 'lines', measure: 'planned', lines: [expect.objectContaining({ label: 'US Managed IT Services', quantity: '100' })] });
    expect([...body.also_measures].sort()).toEqual(['actual', 'expected_landing', 'forecast']);

    // It stays on for the next commits.
    leave(screen.getByLabelText('Description'), 'Managed services');
    await waitFor(() => expect(bulkCalls()).toHaveLength(2));
    expect(bulkCalls()[1][1].also_measures).toHaveLength(3);
  });

  it('writes run one after the other, and the hint says so meanwhile', async () => {
    setupApi({ grain: 'monthly', roundInputs: [linesRecord([storedLine(), storedLine({ id: 'line-2', sort: 1, label: 'Second' })])] });
    let release: () => void = () => undefined;
    let first = true;
    routePosts(() => {
      if (!first) return Promise.resolve({ updated: 12 });
      first = false;
      return new Promise((resolve) => { release = () => resolve({ updated: 12 }); });
    });
    renderTab();
    await waitForAmounts();

    openLines();
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
    setupApi({ grain: 'monthly', roundInputs: [linesRecord()] });
    const refusal = 'Line 1: United States has no working days for 2026.';
    mocked.post.mockRejectedValue(Object.assign(new Error('Bad Request'), { response: { status: 400, data: { message: refusal } } }));
    renderTab();
    await waitForAmounts();

    openLines();
    leave(screen.getByLabelText('Unit price'), '650');
    await waitFor(() => expect(screen.getByTestId('lines-notes')).toHaveTextContent(refusal));
    expect(screen.getByLabelText('Unit price')).toHaveValue('650');
  });

  it('opens on the stored lines with their amount and the FTE line', async () => {
    setupApi({ grain: 'monthly', roundInputs: [linesRecord()] });
    renderTab();
    await waitForAmounts();

    openLines();
    expect(screen.getByLabelText('Description')).toHaveValue('US Managed IT Services');
    expect(screen.getByLabelText('Quantity')).toHaveValue('100');
    expect(screen.getByTestId('line-amount')).toHaveTextContent('60 000');
    expect(screen.getByTestId('line-frequency')).toHaveTextContent('over the period');
    // No total and no sentence under the table: the column shows the amounts, the FTE line the rest.
    expect(screen.getByTestId('lines-fte')).toHaveTextContent('FTE over the period 0.48 · Full-year average 0.40');
    expect(screen.queryByTestId('lines-status')).not.toBeInTheDocument();
  });

  it('a column edited by hand keeps its lines and offers to use them again', async () => {
    setupApi({ grain: 'monthly', roundInputs: [linesRecord(undefined, { method: 'manual', last_calculation: null })] });
    routePosts();
    const { container } = renderTab();
    await waitForAmounts();

    const header = container.querySelector('thead') as HTMLElement;
    expect(within(header).getByText('Edited by hand')).toBeInTheDocument();
    openLines();
    expect(screen.getByTestId('lines-status')).toHaveTextContent('Amounts were entered by hand. Use the lines again.');
    fireEvent.click(screen.getByRole('button', { name: 'Use the lines again.' }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toMatchObject({ kind: 'lines', lines: [expect.objectContaining({ quantity: '100', unit_price: '600' })] });
  });

  it('a column computed from lines says so, with its lines in the tooltip', async () => {
    setupApi({ grain: 'annual', roundInputs: [linesRecord()] });
    renderTab();
    await waitForAmounts();

    expect(captionLines('planned')).toEqual(['Quantity and price · 1 line · 0.40 FTE', '10 months, March to December']);
    fireEvent.mouseOver(periodLine('planned'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('US Managed IT Services: 100 days × 600 per day over the period, Mar to Dec');
  });

  it('names the four ways a column is produced', async () => {
    setupApi({
      grain: 'monthly',
      roundInputs: [
        record({ period_start: '2026-01-01' }),
        record({ measure: 'committed', method: 'copied', period_start: '2026-01-01', last_calculation: { kind: 'copy', source_year: 2025, source_measure: 'planned', uplift_pct: '0', source_total: '1.00', total: '1.00', source_method: 'computed' } }),
        record({ measure: 'forecast', method: 'manual', period_start: '2026-01-01' }),
        linesRecord(undefined, { measure: 'actual' }),
      ],
    });
    const { container } = renderTab();
    await waitForAmounts();

    const header = container.querySelector('thead') as HTMLElement;
    expect(within(header).getByText('Spread flat')).toBeInTheDocument();
    expect(within(header).getByText('Copied from Budget 2025')).toBeInTheDocument();
    expect(within(header).getByText('Edited by hand')).toBeInTheDocument();
    expect(within(header).getByText('Quantity and price ·')).toBeInTheDocument();
    expect(within(header).getByText('1 line · 0.40 FTE')).toBeInTheDocument();
  });

  it('a date typed in a line is written at once', async () => {
    setupApi({ grain: 'monthly', roundInputs: [linesRecord()] });
    routePosts();
    renderTab();
    await waitForAmounts();

    openLines();
    const [from] = within(screen.getByTestId('lines-table')).getAllByPlaceholderText('labels.datePlaceholder');
    typeDate(from, '01/04/2026');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1].lines[0]).toMatchObject({ period_start: '2026-04-01', period_end: '2026-12-31' });
  });
});

/** The monthly grid's inputs (the lines table sits above it when the lines tab is open). */
function gridCells(container: HTMLElement) {
  const tables = Array.from(container.querySelectorAll('table')).filter((table) => table.getAttribute('data-testid') !== 'lines-table');
  return within(tables[tables.length - 1] as HTMLElement).getAllByRole('textbox') as HTMLInputElement[];
}

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
  const base = mocked.get.getMockImplementation()!;
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
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
    calendarsState.list = [FRANCE, UNITED_STATES];
  });

  it('a month typed while a lines write runs is kept by the reload, then saved', async () => {
    setupApi({ grain: 'monthly', roundInputs: [linesRecord()] });
    const held = holdFirstWrite();
    const { container, ref } = renderTab();
    await waitForAmounts();
    openLines();
    leave(screen.getByLabelText('Description'), 'First');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    const loadsBefore = amountLoads();

    // March, Revision: typed while the write runs (nothing is read-only meanwhile).
    fireEvent.change(cell(gridCells(container), 3, 1), { target: { value: '450' } });
    budgetBecomes('600');
    await act(async () => { held.release(); });
    await waitFor(() => expect(amountLoads()).toBe(loadsBefore + 1));
    await settle();

    // The reload shows what the server holds, except the cell typed since.
    expect(cell(gridCells(container), 3, 0)).toHaveValue('600');
    expect(cell(gridCells(container), 3, 1)).toHaveValue('450');
    expect(cell(gridCells(container), 4, 1)).toHaveValue('900');
    expect(ref.current?.isDirty()).toBe(true);

    await flush(ref);
    const monthly = bulkCalls().filter(([, body]) => body?.kind === 'monthly');
    expect(monthly).toHaveLength(1);
    expect(written(monthly[0][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(3), committed: 450 }] });
    expect(cell(gridCells(container), 3, 1)).toHaveValue('450');
    expect(ref.current?.isDirty()).toBe(false);
  });

  it('a yearly total typed while a lines write runs is kept by the reload, then saved', async () => {
    setupApi({ grain: 'annual', roundInputs: [linesRecord()] });
    const held = holdFirstWrite();
    const { ref } = renderTab();
    await waitForAmounts();
    fireEvent.click(within(periodLine('planned').parentElement as HTMLElement).getByRole('button', { name: 'Quantity and price' }));
    leave(await screen.findByLabelText('Description'), 'First');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    const loadsBefore = amountLoads();

    // The yearly totals come first, in the fixed order: Budget, then Revision.
    const total = (index: number) => screen.getAllByRole('textbox')[index];
    fireEvent.change(total(1), { target: { value: '500' } });
    budgetBecomes('50');
    await act(async () => { held.release(); });
    await waitFor(() => expect(amountLoads()).toBe(loadsBefore + 1));
    await settle();

    expect(total(0)).toHaveValue('600');
    expect(total(1)).toHaveValue('500');

    await flush(ref);
    const annual = bulkCalls().filter(([, body]) => body?.kind === 'annual');
    expect(annual).toHaveLength(1);
    expect(annual[0][1]).toMatchObject({ kind: 'annual', year: YEAR, totals: { committed: 500 } });
    expect(Object.keys(annual[0][1].totals)).toEqual(['committed']);
    expect(total(1)).toHaveValue('500');
  });

  it('turning Apply these lines to all columns on in an empty lines tab writes nothing, so the other columns keep their lines', async () => {
    setupApi({ grain: 'monthly', roundInputs: [linesRecord([storedLine()], { measure: 'forecast' })] });
    routePosts();
    renderTab();
    await waitForAmounts();
    await waitFor(() => expect(freezeLoads()).toBeGreaterThanOrEqual(1));

    openLines();
    // Budget has no line; Forecast has one.
    expect(screen.getByText('No line yet. A line is a quantity times a unit price.')).toBeInTheDocument();
    const toAll = await screen.findByLabelText('Apply these lines to all columns');
    fireEvent.click(toAll);
    expect(toAll).toBeChecked();
    await settle();
    expect(bulkCalls()).toHaveLength(0);

    // The first complete line goes to the group's columns.
    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Full time' }));
    leave(screen.getByLabelText('Unit price'), '600');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toMatchObject({ kind: 'lines', measure: 'planned', lines: [expect.objectContaining({ unit_price: '600' })] });
    expect(bulkCalls()[0][1].also_measures).toContain('forecast');
  });

  it('after a hand edit of its column the spread field shows the new total, and Enter spreads it again', async () => {
    setupApi({ grain: 'monthly' });
    routePosts();
    const { container, ref } = renderTab();
    await waitForAmounts();
    await waitFor(() => expect(amountField()).toHaveValue('12 000'));

    // March of Budget by hand: 12 500 in all.
    fireEvent.change(cell(gridCells(container), 3, 0), { target: { value: '1500' } });
    await flush(ref);
    expect(bulkCalls()).toHaveLength(1);
    expect(amountField()).toHaveValue('12 500');
    // Another column's hand edit leaves the field as it is.
    fireEvent.change(cell(gridCells(container), 3, 1), { target: { value: '100' } });
    await flush(ref);
    expect(bulkCalls()).toHaveLength(2);
    expect(amountField()).toHaveValue('12 500');

    // Leaving the field unchanged writes nothing; Enter writes the spread of the amount shown.
    fireEvent.blur(amountField());
    await settle();
    expect(bulkCalls()).toHaveLength(2);
    fireEvent.keyDown(amountField(), { key: 'Enter' });
    await waitFor(() => expect(bulkCalls()).toHaveLength(3));
    expect(bulkCalls()[2][1]).toMatchObject({ kind: 'annual', totals: { planned: '12500.00' }, spread_profile_name: 'flat' });
  });

  it('a spread typed right after a hand edit keeps its amount in the field', async () => {
    setupApi({ grain: 'monthly' });
    routePosts();
    const { container } = renderTab();
    await waitForAmounts();

    // The spread saves the hand edit first, then spreads 20 000 over the column.
    fireEvent.change(cell(gridCells(container), 3, 0), { target: { value: '1500' } });
    typeAmount('20000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(2));
    expect(bulkCalls()[0][1]).toMatchObject({ kind: 'monthly' });
    expect(bulkCalls()[1][1]).toMatchObject({ kind: 'annual', totals: { planned: '20000.00' } });
    await settle();
    expect(amountField()).toHaveValue('20 000');
  });

  it('an amount being typed in the spread field is not replaced by a grid save', async () => {
    setupApi({ grain: 'monthly' });
    routePosts();
    const { container, ref } = renderTab();
    await waitForAmounts();

    fireEvent.change(amountField(), { target: { value: '9000' } });
    fireEvent.change(cell(gridCells(container), 3, 0), { target: { value: '1500' } });
    await flush(ref);
    expect(bulkCalls()).toHaveLength(1);
    expect(amountField()).toHaveValue('9 000');
  });

  it('the working-days note follows a calendar edited since the tab loaded it', async () => {
    const US_DAYS = ['20', '19', '22', '22', '20', '21', '22', '21', '21', '21', '19', '22'];
    const rec = linesRecord();
    (rec.last_calculation as { lines: Array<{ day_counts: string[] | null }> }).lines[0].day_counts = US_DAYS;
    setupApi({ grain: 'monthly', roundInputs: [rec] });
    const base = mocked.get.getMockImplementation()!;
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
    openLines();
    await waitFor(() => expect(yearLoads).toBe(1));
    expect(screen.queryByTestId('lines-days-changed')).not.toBeInTheDocument();

    // The calendar page changes March (22 to 21), then the user comes back to the lines.
    days = [...US_DAYS];
    days[2] = '21';
    fireEvent.click(screen.getByRole('tab', { name: 'Spread an amount' }));
    openLines();
    await waitFor(() => expect(yearLoads).toBe(2));
    expect(await screen.findByTestId('lines-days-changed')).toHaveTextContent('March: 22 days, now 21.');
  });
});

describe('BudgetTab yearly cells', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
    calendarsState.list = [FRANCE, UNITED_STATES];
  });

  const spreadKeepingLines = () => linesRecord(undefined, {
    method: 'spread',
    spread_profile_name: '4-4-5',
    last_calculation: { kind: 'annual', total: '60000.00', profile: '4-4-5', active_months: MARCH_TO_DECEMBER, weights: [] },
  });

  it('the two panel buttons sit on the title row, right of the label and as wide as the field; the caption keeps its text', async () => {
    setupApi({ grain: 'annual', frozen: ['revision'], roundInputs: [linesRecord()] });
    renderTab();
    await waitForAmounts();

    const title = screen.getByTestId('column-title-planned');
    expect(within(title).getByText('Budget')).toBeInTheDocument();
    expect(within(title).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Change period', 'Quantity and price']);
    expect(title).toHaveStyle({ maxWidth: '220px', minHeight: '18px' });
    expect(within(periodLine('planned')).queryAllByRole('button')).toHaveLength(0);
    // A frozen column keeps its lock next to the label, and no button.
    await waitFor(() => expect(within(screen.getByTestId('column-title-committed')).queryAllByRole('button')).toHaveLength(0));
    expect(within(screen.getByTestId('column-title-committed')).getByTestId('LockOutlinedIcon')).toBeInTheDocument();

    fireEvent.click(within(title).getByRole('button', { name: 'Quantity and price' }));
    expect(await screen.findByLabelText('Description')).toHaveValue('US Managed IT Services');
  });

  it('a column that keeps its lines after a spread shows the lines, then the spread, then the period; the tooltip lists the lines', async () => {
    setupApi({ grain: 'annual', roundInputs: [spreadKeepingLines()] });
    renderTab();
    await waitForAmounts();

    expect(captionLines('planned')).toEqual(['Quantity and price · 1 line · 0.40 FTE ·', 'Spread 4-4-5', '10 months, March to December']);
    fireEvent.mouseOver(periodLine('planned'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('US Managed IT Services: 100 days × 600 per day over the period, Mar to Dec');
  });

  it('the monthly header says the same', async () => {
    setupApi({ grain: 'monthly', roundInputs: [spreadKeepingLines()] });
    const { container } = renderTab();
    await waitForAmounts();

    const header = container.querySelector('thead') as HTMLElement;
    expect(within(header).getByText('Quantity and price ·')).toBeInTheDocument();
    expect(within(header).getByText('1 line · 0.40 FTE ·')).toBeInTheDocument();
    expect(within(header).getByText('Spread 4-4-5')).toBeInTheDocument();
  });
});

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
  const base = mocked.get.getMockImplementation()!;
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
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
    calendarsState.list = [FRANCE, UNITED_STATES];
  });

  async function openYearlyLines() {
    setupApi({ grain: 'annual' });
    serverKeepsLines([storedLine()]);
    renderTab(YEAR, { payingCompanyCountry: 'US' });
    await waitForAmounts();
    fireEvent.click(within(screen.getByTestId('column-title-planned')).getByRole('button', { name: 'Quantity and price' }));
    await screen.findByLabelText('Description');
  }
  const dates = (row: number) => within(screen.getAllByTestId('line-row')[row]).getAllByPlaceholderText('labels.datePlaceholder');

  it('Add a line puts the focus in its Description; Tab then walks a person per day field by field, to Add a line', async () => {
    await openYearlyLines();
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
    await openYearlyLines();
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
    await openYearlyLines();
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

  it('the spread Column and Distribution keep the focus after a choice made with the keyboard', async () => {
    setupApi({ grain: 'monthly' });
    renderTab();
    await waitForAmounts();

    const column = screen.getByRole('combobox', { name: 'Column' });
    act(() => { column.focus(); });
    await chooseWithKeyboard(1);
    await waitFor(() => expect(column).toHaveTextContent('Revision'));
    expect(document.activeElement).toBe(column);

    const distribution = screen.getByRole('combobox', { name: 'Distribution' });
    act(() => { distribution.focus(); });
    await chooseWithKeyboard(1);
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toMatchObject({ spread_profile_name: '4-4-5' });
    await settle();
    expect(document.activeElement).toBe(distribution);
  });

  it('the lines Column keeps the focus after a choice made with the keyboard, while the lines of the new column are drawn', async () => {
    setupApi({ grain: 'monthly' });
    serverKeepsLines([storedLine()]);
    renderTab();
    await waitForAmounts();
    openLines();
    expect(await screen.findByLabelText('Description')).toHaveValue('US Managed IT Services');

    const column = screen.getByRole('combobox', { name: 'Column' });
    act(() => { column.focus(); });
    await chooseWithKeyboard(1);
    await waitFor(() => expect(column).toHaveTextContent('Revision'));
    // Revision has no lines: its own panel is drawn.
    expect(screen.queryByLabelText('Description')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(column);
  });

  it('removing a line with the mouse leaves the focus alone', async () => {
    await openYearlyLines();
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

  it('removing a line puts the focus on the next line, else the previous one, else on Add a line', async () => {
    await openYearlyLines();
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
  });
});

/* ---- Lot 3D: what each save started from, refused columns, the reload after each save, the view per user ---- */

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
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
    calendarsState.list = [FRANCE, UNITED_STATES];
  });

  it('a monthly save says what each cell started from; the next save starts from what it wrote', async () => {
    setupApi({ grain: 'monthly' });
    const { ref, container } = renderTab();
    await waitForAmounts();

    fireEvent.change(cell(monthCells(container), 3, 1), { target: { value: '450' } });
    await flush(ref);
    expect(bulkCalls()[0][1].base).toEqual({ months: [{ period: period(3), committed: '900.00' }] });

    fireEvent.change(cell(monthCells(container), 3, 1), { target: { value: '460' } });
    await flush(ref);
    expect(bulkCalls()[1][1].base).toEqual({ months: [{ period: period(3), committed: '450.00' }] });
  });

  it('a yearly total says what its column held, month by month', async () => {
    setupApi({ grain: 'annual' });
    const { ref } = renderTab();
    await waitForAmounts();

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '15000' } });
    await flush(ref);
    expect(bulkCalls()[0][1].base).toEqual({ columns: { planned: { months: twelve('1000.00') } } });
  });

  it('every save reloads the year: someone else\'s change shows, a cell typed meanwhile stays', async () => {
    const server = setupApi({ grain: 'monthly' });
    // The reload after the save is answered late: the user types meanwhile.
    const served = mocked.get.getMockImplementation()!;
    let holdReload = false;
    let answer: () => void = () => undefined;
    mocked.get.mockImplementation(async (url: string, config?: unknown) => {
      if (url === '/spend-versions/v1/amounts' && holdReload) {
        holdReload = false;
        await new Promise<void>((resolve) => { answer = resolve; });
      }
      return served(url, config);
    });
    const { ref, container } = renderTab();
    await waitForAmounts();
    const loads = amountLoads();

    holdReload = true;
    fireEvent.change(cell(monthCells(container), 3, 0), { target: { value: '1500' } });
    await flush(ref);
    expect(bulkCalls()).toHaveLength(1);
    await waitFor(() => expect(amountLoads()).toBe(loads + 1));
    // Meanwhile Marie changes April's Forecast, and the user types March's Revision (not sent yet).
    server.items[3].forecast = '650';
    changedByOthers.add(server.items);
    fireEvent.change(cell(monthCells(container), 3, 1), { target: { value: '450' } });
    await act(async () => { answer(); });
    await settle();

    // The reload after the save shows Marie's change; the cell being typed keeps the user's value.
    expect(bulkCalls()).toHaveLength(1);
    expect(cell(monthCells(container), 4, 2)).toHaveValue('650');
    expect(cell(monthCells(container), 3, 1)).toHaveValue('450');
    expect(cell(monthCells(container), 3, 0)).toHaveValue('1 500');
    expect(ref.current?.isDirty()).toBe(true);
    await flush(ref);
    expect(written(bulkCalls()[1][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(3), committed: 450 }] });
    expect(bulkCalls()[1][1].base).toEqual({ months: [{ period: period(3), committed: '900.00' }] });
  });

  it('a refused column waits, tinted and read-only, while the other columns go on their own; Overwrite sends it again over theirs', async () => {
    setupApi({ grain: 'monthly' });
    const theirs = twelve('900.00');
    theirs[2] = '950.00';
    refuseBulk((body, call) => (call === 1 ? columnConflict('committed', theirs, { mine: theirs.map((v, i) => (i === 2 ? '450.00' : v)) }) : null));
    const { ref, container } = renderTab();
    await waitForAmounts();

    fireEvent.change(cell(monthCells(container), 3, 1), { target: { value: '450' } });
    fireEvent.change(cell(monthCells(container), 3, 0), { target: { value: '1500' } });
    expect(await flush(ref)).toBe(false);
    expect(ref.current?.isDirty()).toBe(true);

    // The whole request was refused; Budget went again alone.
    expect(bulkCalls()).toHaveLength(2);
    expect(written(bulkCalls()[1][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(3), planned: 1500 }] });
    const banner = await screen.findByRole('region');
    expect(within(banner).getByText('editConflict.column.title')).toBeInTheDocument();
    expect(within(banner).getByText(/editConflict\.column\.changedBy(On|At)/)).toBeInTheDocument();
    expect(within(banner).getByText('Mar 950')).toBeInTheDocument();
    expect(within(banner).getByText('Mar 450')).toBeInTheDocument();
    expect(screen.getByTestId('budget-head-committed')).toHaveAttribute('data-waiting', 'true');
    expect(screen.getByTestId('budget-head-planned')).not.toHaveAttribute('data-waiting');
    expect(cell(monthCells(container), 3, 1)).toHaveAttribute('readonly');
    expect(cell(monthCells(container), 3, 1)).toHaveValue('450');

    fireEvent.click(within(banner).getByRole('button', { name: /editConflict\.column\.applyMine/ }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(3));
    expect(written(bulkCalls()[2][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(3), committed: 450 }] });
    expect(bulkCalls()[2][1].base).toEqual({ months: [{ period: period(3), committed: '950.00' }] });
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
    expect(await flush(ref)).toBe(true);
    expect(cell(monthCells(container), 3, 1)).not.toHaveAttribute('readonly');
  });

  it('Reload the column takes their values and drops the user\'s edits of that column', async () => {
    const server = setupApi({ grain: 'monthly' });
    const theirs = twelve('900.00');
    theirs[2] = '950.00';
    refuseBulk((body, call) => (call === 1 ? columnConflict('committed', theirs) : null));
    const { ref, container } = renderTab();
    await waitForAmounts();

    fireEvent.change(cell(monthCells(container), 3, 1), { target: { value: '450' } });
    expect(await flush(ref)).toBe(false);
    // The server holds Marie's March.
    server.items[2].committed = '950';
    changedByOthers.add(server.items);
    const banner = await screen.findByRole('region');
    fireEvent.click(within(banner).getByRole('button', { name: /editConflict\.column\.keepTheirs/ }));

    await waitFor(() => expect(cell(monthCells(container), 3, 1)).toHaveValue('950'));
    expect(screen.queryByRole('region')).toBeNull();
    await settle();
    expect(ref.current?.isDirty()).toBe(false);
    expect(await flush(ref)).toBe(true);
    expect(bulkCalls()).toHaveLength(1);
    expect(cell(monthCells(container), 3, 1)).toHaveValue('950');
  });

  it('a refused lines write waits read-only; Overwrite sends it again from the lines and months the server answered', async () => {
    setupApi({ grain: 'monthly', roundInputs: [linesRecord()] });
    const theirLine = {
      label: 'Their services', quantity_unit: 'days', quantity: '100', unit_price: '650', price_basis: 'per_day', frequency: 'once',
      days_per_month: null, period_start: '2026-03-01', period_end: '2026-12-31', working_day_profile_id: 'cal-us',
    };
    refuseBulk((body, call) => (call === 1 ? columnConflict('planned', twelve('6500.00'), { periods: [], current_lines: [theirLine], mine: twelve('6000.00') }) : null));
    renderTab();
    await waitForAmounts();

    openLines();
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
    // The panel keeps the user's line, read-only, and says why.
    expect(screen.getByLabelText('Description')).toHaveValue('My services');
    expect(screen.getByLabelText('Description')).toBeDisabled();
    expect(screen.getByTestId('lines-notes')).toHaveTextContent('Choose first, above, whether to reload this column or overwrite it.');

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

  it('the view is each user\'s choice, kept for them, never written on the shared version', async () => {
    permissions.userId = 'u-1';
    setupApi({ grain: 'annual' });
    const first = renderTab();
    await waitForAmounts();
    expect(first.container.querySelector('table')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'opex.budget.monthly' }));
    await waitFor(() => expect(first.container.querySelector('table')).not.toBeNull());
    expect(window.localStorage.getItem('budget-view:u-1')).toBe('monthly');
    expect(mocked.patch).not.toHaveBeenCalled();
    first.unmount();

    // The same user opens the line again: monthly, though the version says yearly.
    const again = renderTab();
    await waitForAmounts(2);
    await waitFor(() => expect(again.container.querySelector('table')).not.toBeNull());
    again.unmount();

    // Another user who never chose sees the version's own view.
    permissions.userId = 'u-2';
    const other = renderTab();
    await waitForAmounts(3);
    expect(other.container.querySelector('table')).toBeNull();
  });
});

describe('BudgetTab edit conflicts, review round (lot 3D)', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
  });

  /** Revision: March refused (Marie wrote 950 there). */
  const marchRefused = () => {
    const theirs = twelve('900.00');
    theirs[2] = '950.00';
    return columnConflict('committed', theirs, { periods: [period(3)] });
  };

  it('Reload the column takes their value for the refused month only; a month typed in the same request is saved', async () => {
    const server = setupApi({ grain: 'monthly' });
    refuseBulk((body, call) => (call === 1 ? marchRefused() : null));
    const { ref, container } = renderTab();
    await waitForAmounts();

    fireEvent.change(cell(monthCells(container), 1, 1), { target: { value: '111' } });
    fireEvent.change(cell(monthCells(container), 3, 1), { target: { value: '450' } });
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
    expect(cell(monthCells(container), 3, 1)).toHaveAttribute('readonly');
    expect(cell(monthCells(container), 1, 1)).not.toHaveAttribute('readonly');

    server.items[2].committed = '950';
    changedByOthers.add(server.items);
    fireEvent.click(within(banner).getByRole('button', { name: /editConflict\.column\.keepTheirs/ }));
    await waitFor(() => expect(cell(monthCells(container), 3, 1)).toHaveValue('950'));
    await settle();
    expect(cell(monthCells(container), 1, 1)).toHaveValue('111');
    expect(await flush(ref)).toBe(true);
    expect(bulkCalls()).toHaveLength(2);
  });

  it('a tab change keeps the waiting choice: the tab comes back with the banner and the user\'s value', async () => {
    setupApi({ grain: 'monthly' });
    refuseBulk((body, call) => (call === 1 ? marchRefused() : null));
    const held = { current: null } as React.MutableRefObject<HeldBudgetChoices | null>;
    const first = renderTab(YEAR, {}, OPEX_FINANCE_CONFIG, undefined, { held });
    await waitForAmounts();
    fireEvent.change(cell(monthCells(first.container), 3, 1), { target: { value: '450' } });
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
    await waitFor(() => expect(cell(monthCells(again.container), 3, 1)).toHaveValue('450'));
    expect(cell(monthCells(again.container), 3, 1)).toHaveAttribute('readonly');
    expect(again.ref.current!.waitingColumns()).toEqual(['Revision']);
    expect(await flush(again.ref)).toBe(false);

    fireEvent.click(within(banner).getByRole('button', { name: /editConflict\.column\.applyMine/ }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(2));
    expect(written(bulkCalls()[1][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(3), committed: 450 }] });
    expect(bulkCalls()[1][1].base).toEqual({ months: [{ period: period(3), committed: '950.00' }] });
  });

  it('the spread panel is read-only while its column waits for a choice', async () => {
    setupApi({ grain: 'monthly' });
    const theirs = twelve('1000.00');
    theirs[2] = '1100.00';
    refuseBulk((body, call) => (call === 1 ? columnConflict('planned', theirs, { periods: [period(3)] }) : null));
    const { ref, container } = renderTab();
    await waitForAmounts();
    expect(amountField()).not.toBeDisabled();

    fireEvent.change(cell(monthCells(container), 3, 0), { target: { value: '1500' } });
    expect(await flush(ref)).toBe(false);
    await screen.findByRole('region');
    expect(amountField()).toBeDisabled();
    for (const date of screen.getAllByPlaceholderText('labels.datePlaceholder')) expect(date).toBeDisabled();
    expect(screen.getByLabelText('Apply the distribution to all columns')).toBeDisabled();
    expect(screen.getByTestId('spread-notes')).toHaveTextContent('Choose first, above, whether to reload this column or overwrite it.');
  });

  it('a year change with a choice waiting asks, naming the column, and drops it only when confirmed', async () => {
    setupApi({ grain: 'monthly' });
    refuseBulk((body, call) => (call === 1 ? marchRefused() : null));
    const onYearChange = vi.fn();
    const { ref, container } = renderTab(YEAR, {}, OPEX_FINANCE_CONFIG, undefined, { onYearChange, availableYears: [YEAR, YEAR + 1] });
    await waitForAmounts();
    fireEvent.change(cell(monthCells(container), 3, 1), { target: { value: '450' } });
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
    setupApi({ grain: 'monthly' });
    refuseBulk((body, call) => (call === 1 ? { response: { status: 409, data: { code: 'edit_conflict', conflicts: [{ field: 'nonsense' }] } } } : null));
    const { ref, container } = renderTab();
    await waitForAmounts();
    fireEvent.change(cell(monthCells(container), 3, 1), { target: { value: '450' } });
    expect(await flush(ref)).toBe(false);

    expect(await screen.findByRole('alert')).toHaveTextContent('errors:edit_conflict_unreadable');
    expect(screen.queryByRole('region')).toBeNull();
    expect(cell(monthCells(container), 3, 1)).toHaveValue('450');
    expect(ref.current?.isDirty()).toBe(true);
    // The next flush sends it again.
    expect(await flush(ref)).toBe(true);
    expect(written(bulkCalls()[1][1])).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(3), committed: 450 }] });
  });
});

describe('BudgetTab others\' changes (lot 3G)', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
  });

  it('gives the version counter it loaded and the one each of its saves left, not the reload after its own save', async () => {
    setupApi({ grain: 'monthly', budgetRev: 7 });
    mocked.post.mockResolvedValue({ data: { updated: 1, budget_rev: 8 } });
    const onBudgetRev = vi.fn();
    const { ref, container } = renderTab(YEAR, {}, OPEX_FINANCE_CONFIG, undefined, { onBudgetRev });
    await waitForAmounts();
    expect(onBudgetRev.mock.calls).toEqual([[YEAR, 7]]);

    fireEvent.change(cell(monthCells(container), 3, 0), { target: { value: '1500' } });
    expect(ref.current?.isSaving()).toBe(true);
    await flush(ref);
    await settle();
    expect(onBudgetRev.mock.calls).toEqual([[YEAR, 7], [YEAR, 8]]);
    expect(ref.current?.isSaving()).toBe(false);
  });

  it('a year without a version is given as none', async () => {
    setupApi({ grain: 'monthly', noVersion: true });
    const onBudgetRev = vi.fn();
    renderTab(YEAR, {}, OPEX_FINANCE_CONFIG, undefined, { onBudgetRev });
    await waitFor(() => expect(onBudgetRev).toHaveBeenCalledWith(YEAR, null));
  });

  it('pending: a cell typed and not saved, an amount typed in the spread panel; nothing once saved', async () => {
    setupApi({ grain: 'monthly' });
    const { ref, container } = renderTab();
    await waitForAmounts();
    expect(ref.current?.hasPending()).toBe(false);
    fireEvent.change(cell(monthCells(container), 3, 0), { target: { value: '1500' } });
    expect(ref.current?.hasPending()).toBe(true);
    await flush(ref);
    await settle();
    expect(ref.current?.hasPending()).toBe(false);
    fireEvent.change(amountField(), { target: { value: '5000' } });
    expect(ref.current?.hasPending()).toBe(true);
  });

  it('a reload for someone else\'s change shows it; a cell typed and not saved keeps its value and its base', async () => {
    const server = setupApi({ grain: 'monthly' });
    const onBudgetRev = vi.fn();
    const { ref, container } = renderTab(YEAR, {}, OPEX_FINANCE_CONFIG, undefined, { onBudgetRev });
    await waitForAmounts();
    // The user types March's Revision (not sent yet); Marie changes April's Forecast.
    fireEvent.change(cell(monthCells(container), 3, 1), { target: { value: '450' } });
    server.items[3].forecast = '650';
    changedByOthers.add(server.items);
    await act(async () => { await ref.current?.reloadFromServer(); });
    await settle();
    expect(cell(monthCells(container), 4, 2)).toHaveValue('650');
    expect(cell(monthCells(container), 3, 1)).toHaveValue('450');
    expect(bulkCalls()).toHaveLength(0);
    // The typed cell still goes from what the screen showed when it was typed.
    await flush(ref);
    expect(bulkCalls()[0][1].base).toEqual({ months: [{ period: period(3), committed: '900.00' }] });
  });

  it('a period and a distribution chosen before the amount are the user\'s: pending, kept by a reload, then written with the amount', async () => {
    const server = setupApi({ grain: 'monthly', empty: true });
    const { ref } = renderTab(YEAR, { effectiveStart: '2026-04-01' });
    await waitForAmounts();
    expect(ref.current?.hasPending()).toBe(false);

    const [, distribution] = screen.getAllByRole('combobox');
    fireEvent.mouseDown(distribution);
    fireEvent.click(await screen.findByRole('option', { name: 'opex.budget.profile445' }));
    const [from] = screen.getAllByPlaceholderText('labels.datePlaceholder');
    typeDate(from, '01/07/2026');
    await settle();
    // No amount yet: nothing written, the choices wait in the panel.
    expect(bulkCalls()).toHaveLength(0);
    expect(ref.current?.hasPending()).toBe(true);

    // Someone else writes June's Forecast; the user reloads: the panel keeps the period and distribution chosen.
    server.items.push({ period: period(6), forecast: '300' } as ServedMonth);
    changedByOthers.add(server.items);
    await act(async () => { await ref.current?.reloadFromServer(); });
    await settle();
    typeAmount('12000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toMatchObject({ totals: { planned: '12000.00' }, spread_profile_name: '4-4-5', period_start: '2026-07-01' });
  });

  it('a reload that fails is not shown: it rejects, so the page does not count it as seen', async () => {
    setupApi({ grain: 'monthly' });
    const { ref } = renderTab();
    await waitForAmounts();
    const served = mocked.get.getMockImplementation()!;
    mocked.get.mockImplementation(async (url: string, config?: unknown) => {
      if (url === '/spend-versions/v1/amounts') throw new Error('offline');
      return served(url, config);
    });
    let failure: unknown = null;
    await act(async () => { await ref.current?.reloadFromServer().catch((error) => { failure = error; }); });
    expect(failure).toBeInstanceOf(Error);
  });

  it('nothing typed: the spread panel follows its column\'s new total too', async () => {
    const server = setupApi({ grain: 'monthly' });
    const { ref } = renderTab();
    await waitForAmounts();
    await waitFor(() => expect(amountField()).toHaveValue('12 000'));
    server.items.forEach((month) => { month.planned = '1100'; });
    changedByOthers.add(server.items);
    await act(async () => { await ref.current?.reloadFromServer(); });
    await waitFor(() => expect(amountField()).toHaveValue('13 200'));
  });
});

/* ---- Quantity and price take precedence over a spread ---- */

describe('BudgetTab quantity and price take precedence over a spread', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
    calendarsState.list = [FRANCE, UNITED_STATES];
  });

  const panelTab = (name: 'Spread an amount' | 'Quantity and price') => screen.getByRole('tab', { name });
  const pickColumn = async (name: string) => {
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Column' }));
    fireEvent.click(await screen.findByRole('option', { name }));
  };

  it('the yearly pencil opens a column that follows its lines on Quantity and price, another on Spread an amount', async () => {
    setupApi({ grain: 'annual', roundInputs: [linesRecord()] });
    renderTab();
    await waitForAmounts();

    fireEvent.click(within(screen.getByTestId('column-title-planned')).getByRole('button', { name: 'Change period' }));
    expect(await screen.findByLabelText('Description')).toHaveValue('US Managed IT Services');
    expect(panelTab('Quantity and price')).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(within(screen.getByTestId('column-title-committed')).getByRole('button', { name: 'Change period' }));
    await waitFor(() => expect(panelTab('Spread an amount')).toHaveAttribute('aria-selected', 'true'));
    expect(amountField()).not.toBeDisabled();
    expect(bulkCalls()).toHaveLength(0);
  });

  it('the monthly view opens on Quantity and price when its default column follows its lines', async () => {
    setupApi({ grain: 'monthly', roundInputs: [linesRecord()] });
    renderTab();
    await waitForAmounts();

    await waitFor(() => expect(panelTab('Quantity and price')).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByLabelText('Description')).toHaveValue('US Managed IT Services');
  });

  it('a column picked in either tab that follows its lines takes the panel to them; a column without lines leaves the tab as it is', async () => {
    setupApi({ grain: 'monthly', roundInputs: [linesRecord(undefined, { measure: 'committed' })] });
    renderTab();
    await waitForAmounts();
    expect(panelTab('Spread an amount')).toHaveAttribute('aria-selected', 'true');

    // The spread tab's picker: Revision follows its lines.
    await pickColumn('Revision');
    await waitFor(() => expect(panelTab('Quantity and price')).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByLabelText('Description')).toHaveValue('US Managed IT Services');
    // The lines tab's picker: Budget has no line, the tab stays.
    await pickColumn('Budget');
    await waitFor(() => expect(screen.getByText('No line yet. A line is a quantity times a unit price.')).toBeInTheDocument());
    expect(panelTab('Quantity and price')).toHaveAttribute('aria-selected', 'true');
    // Back on Spread an amount, Actuals has no line: the tab stays.
    fireEvent.click(panelTab('Spread an amount'));
    await pickColumn('Actuals');
    expect(panelTab('Spread an amount')).toHaveAttribute('aria-selected', 'true');
    expect(amountField()).not.toBeDisabled();
  });

  it('a default column changed by the setting while the tab is open takes the panel to its lines', async () => {
    setupApi({ grain: 'monthly', roundInputs: [linesRecord(undefined, { measure: 'committed' })] });
    const { rerenderYear } = renderTab();
    await waitForAmounts();
    expect(panelTab('Spread an amount')).toHaveAttribute('aria-selected', 'true');

    columnsSetting.current = { ...ALL_SHOWN, default_column: 'committed' };
    rerenderYear(YEAR);
    await waitFor(() => expect(panelTab('Quantity and price')).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByRole('combobox', { name: 'Column' })).toHaveTextContent('Revision');
  });

  it('a reload, after a save or for someone else\'s change, never switches the tab under the user', async () => {
    setupApi({ grain: 'monthly', roundInputs: [linesRecord()] });
    routePosts();
    const { ref, container } = renderTab();
    await waitForAmounts();
    await waitFor(() => expect(panelTab('Quantity and price')).toHaveAttribute('aria-selected', 'true'));

    fireEvent.click(panelTab('Spread an amount'));
    // A grid save reloads the year.
    const loads = amountLoads();
    fireEvent.change(cell(gridCells(container), 3, 1), { target: { value: '450' } });
    await flush(ref);
    await waitFor(() => expect(amountLoads()).toBe(loads + 1));
    await settle();
    expect(panelTab('Spread an amount')).toHaveAttribute('aria-selected', 'true');
    // Someone else's change.
    await act(async () => { await ref.current?.reloadFromServer(); });
    await settle();
    expect(panelTab('Spread an amount')).toHaveAttribute('aria-selected', 'true');
  });

  it('Spread an amount is locked on a column that follows its lines: its fields show the column, disabled, and nothing is written', async () => {
    setupApi({ grain: 'monthly', roundInputs: [linesRecord()] });
    routePosts();
    renderTab();
    await waitForAmounts();
    fireEvent.click(panelTab('Spread an amount'));

    expect(amountField()).toHaveValue('12 000');
    expect(amountField()).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Distribution' })).toHaveAttribute('aria-disabled', 'true');
    const [from, to] = screen.getAllByPlaceholderText('labels.datePlaceholder');
    expect(from).toBeDisabled();
    expect(to).toBeDisabled();
    expect(screen.getByLabelText('Apply the distribution to all columns')).toBeDisabled();
    expect(screen.getByTestId('spread-lock')).toHaveTextContent(/^The amounts come from the 1 line of Quantity and price\. Spread an amount instead$/);
    // The column picker stays.
    expect(screen.getByRole('combobox', { name: 'Column' })).not.toHaveAttribute('aria-disabled');

    // Whatever reaches the fields, the locked column is never spread: leaving, Enter, a date.
    fireEvent.change(amountField(), { target: { value: '20000' } });
    fireEvent.blur(amountField());
    fireEvent.keyDown(amountField(), { key: 'Enter' });
    typeDate(from, '01/07/2026');
    await settle();
    expect(bulkCalls()).toHaveLength(0);
  });

  it('Spread an amount instead unlocks the column, focuses the amount and spreads it; the lock comes back with the panel', async () => {
    setupApi({ grain: 'monthly', roundInputs: [linesRecord(), linesRecord(undefined, { measure: 'forecast' })] });
    routePosts();
    renderTab();
    await waitForAmounts();
    fireEvent.click(panelTab('Spread an amount'));

    fireEvent.click(screen.getByRole('button', { name: 'Spread an amount instead' }));
    await waitFor(() => expect(amountField()).not.toBeDisabled());
    expect(document.activeElement).toBe(amountField());
    expect(screen.getByTestId('spread-lock')).toHaveTextContent(/^A spread replaces the amounts of the lines\. The lines stay as a reference\.$/);
    expect(screen.getByRole('combobox', { name: 'Distribution' })).not.toHaveAttribute('aria-disabled');

    // Another panel and back: locked again.
    fireEvent.click(panelTab('Quantity and price'));
    fireEvent.click(panelTab('Spread an amount'));
    expect(amountField()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Spread an amount instead' }));
    await waitFor(() => expect(amountField()).not.toBeDisabled());

    typeAmount('20000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    // Forecast follows its lines too: it keeps them.
    expect(written(bulkCalls()[0][1])).toEqual({
      kind: 'annual',
      year: YEAR,
      totals: { planned: '20000.00' },
      also_measures: ['committed', 'actual', 'expected_landing'],
      spread_profile_name: 'flat',
      period_start: '2026-03-01',
      period_end: '2026-12-31',
    });
  });

  it('Apply the distribution to all columns leaves out the columns that follow their lines, and says so', async () => {
    setupApi({
      grain: 'monthly',
      roundInputs: [linesRecord(undefined, { measure: 'committed' }), linesRecord(undefined, { measure: 'forecast' })],
    });
    routePosts();
    renderTab();
    await waitForAmounts();

    expect(screen.getByTestId('spread-keep-lines')).toHaveTextContent(/^Revision, Forecast keep their lines\.$/);
    typeAmount('24000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1].also_measures).toEqual(['actual', 'expected_landing']);

    // Off, then on: the spread goes to the same columns at once.
    fireEvent.click(screen.getByLabelText('Apply the distribution to all columns'));
    fireEvent.click(screen.getByLabelText('Apply the distribution to all columns'));
    await waitFor(() => expect(bulkCalls()).toHaveLength(2));
    expect(bulkCalls()[1][1].also_measures).toEqual(['actual', 'expected_landing']);
  });

  it('one column that follows its lines is named alone; when every other column does, no switch is offered', async () => {
    setupApi({ grain: 'monthly', roundInputs: [linesRecord(undefined, { measure: 'committed' })] });
    const first = renderTab();
    await waitForAmounts();
    expect(screen.getByTestId('spread-keep-lines')).toHaveTextContent(/^Revision keeps its lines\.$/);
    first.unmount();

    columnsSetting.current = { ...DEFAULT_BUDGET_COLUMNS, enabled: { ...DEFAULT_BUDGET_COLUMNS.enabled, actual: false, expected_landing: false } };
    setupApi({ grain: 'monthly', roundInputs: [linesRecord(undefined, { measure: 'committed' })] });
    renderTab();
    await waitForAmounts(2);
    expect(screen.queryByText('Apply the distribution to all columns')).not.toBeInTheDocument();
    expect(screen.queryByTestId('spread-keep-lines')).not.toBeInTheDocument();
    typeAmount('5000');
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1].totals).toEqual({ planned: '5000.00' });
    expect(bulkCalls()[0][1].also_measures).toBeUndefined();
  });

  it('the yearly total of a column that follows its lines is read-only; a click or Enter opens its lines', async () => {
    setupApi({ grain: 'annual', roundInputs: [linesRecord()] });
    renderTab();
    await waitForAmounts();

    const [budget, revision] = screen.getAllByRole('textbox');
    expect(budget).toHaveAttribute('readonly');
    expect(revision).not.toHaveAttribute('readonly');
    fireEvent.mouseOver(budget);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Calculated from its lines. Open Quantity and price to change it.');

    fireEvent.click(budget);
    expect(await screen.findByLabelText('Description')).toHaveValue('US Managed IT Services');
    expect(panelTab('Quantity and price')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.close' }));
    await waitFor(() => expect(screen.queryByLabelText('Description')).not.toBeInTheDocument());

    fireEvent.keyDown(screen.getAllByRole('textbox')[0], { key: 'Enter' });
    expect(await screen.findByLabelText('Description')).toHaveValue('US Managed IT Services');
    // The pencil and the calculator stay.
    expect(within(screen.getByTestId('column-title-planned')).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Change period', 'Quantity and price']);
    // A click on another column's total opens nothing.
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.close' }));
    fireEvent.click(screen.getAllByRole('textbox')[1]);
    await settle();
    expect(screen.queryByRole('tab', { name: 'Quantity and price' })).not.toBeInTheDocument();
    expect(bulkCalls()).toHaveLength(0);
  });
});
