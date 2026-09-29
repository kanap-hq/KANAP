import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { OPEX_FINANCE_CONFIG } from './config';

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
    return key.startsWith('budgetTab.') || key.startsWith('operations.')
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

// The viewer's permissions: member of the calendars unless a test says otherwise.
const permissions = vi.hoisted(() => ({ calendarsMember: true }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string) => resource !== 'working_day_profiles' || permissions.calendarsMember,
  }),
}));

import api from '../../api';
import BudgetTab, { BudgetTabHandle } from './BudgetTab';
import type { RoundInput, RoundLine } from './roundPeriod';
import { DEFAULT_BUDGET_COLUMNS, type BudgetColumnsSettings } from '../../services/budgetColumns';

const ALL_SHOWN: BudgetColumnsSettings = {
  ...DEFAULT_BUDGET_COLUMNS,
  enabled: { planned: true, committed: true, forecast: true, actual: true, expected_landing: true },
};
beforeEach(() => {
  columnsSetting.current = ALL_SHOWN;
  calendarsState.list = [];
  calendarsState.failed = false;
  permissions.calendarsMember = true;
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

/** Mocked API; `state.frozen` is read on every freeze-state fetch, so a test can freeze a column midway. */
function setupApi({ grain, frozen = [], empty = false, noVersion = false, roundInputs, monthValues = {} }: {
  grain: Grain;
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
  const state = { frozen: [...frozen] };
  const version = { id: 'v1', input_grain: grain, budget_year: YEAR };
  const items = empty ? [] : Array.from({ length: 12 }, (_, i) => ({
    period: period(i + 1),
    planned: '1000',
    committed: '900',
    actual: '800',
    expected_landing: '700',
    forecast: '600',
    ...monthValues,
  }));
  const totals = empty
    ? { planned: 0, committed: 0, actual: 0, expected_landing: 0, forecast: 0 }
    : { planned: 12000, committed: 10800, actual: 9600, expected_landing: 8400, forecast: 7200 };
  const slot = (col: FrozenColumn) => ({ frozen: state.frozen.includes(col), frozenAt: null, frozenBy: null });
  const scope = () => ({ budget: slot('budget'), revision: slot('revision'), forecast: slot('forecast'), actual: slot('actual'), landing: slot('landing') });
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/spend-items/item-1/versions') return { data: noVersion ? [] : [version] };
    if (url === '/spend-versions/v1/amounts') {
      return { data: { items, totals, year: YEAR, ...(roundInputs ? { round_inputs: roundInputs } : {}) } };
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

function renderTab(year = YEAR, dates: { effectiveStart?: string; endOfValidity?: string; payingCompanyCountry?: string } = {}) {
  const ref = React.createRef<BudgetTabHandle>();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (y: number) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <BudgetTab
            ref={ref} id="item-1" year={y} currency="EUR" onYearChange={() => undefined} config={OPEX_FINANCE_CONFIG}
            effectiveStart={dates.effectiveStart} endOfValidity={dates.endOfValidity} payingCompanyCountry={dates.payingCompanyCountry}
          />
        </ThemeProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  const view = render(ui(year));
  return { ...view, ref, rerenderYear: (y: number) => view.rerender(ui(y)) };
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
    expect(bulkCalls()[0][1]).toEqual({
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
    expect(bulkCalls()[0][1]).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(3), committed: 450 }] });
  });

  it('switching mode and reloading send no amounts', async () => {
    setupApi({ grain: 'annual' });
    const { ref, rerenderYear } = renderTab();
    await waitForAmounts();

    fireEvent.click(screen.getByRole('tab', { name: 'opex.budget.monthly' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/spend-items/item-1/versions', { id: 'v1', input_grain: 'monthly' }));
    fireEvent.click(screen.getByRole('tab', { name: 'opex.budget.flat' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/spend-items/item-1/versions', { id: 'v1', input_grain: 'annual' }));

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
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/spend-items/item-1/versions', { id: 'v1', input_grain: 'annual' }));
    await waitForAmounts(2);
    await flush(ref);

    expect(bulkCalls()).toHaveLength(1);
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
    expect(bulkCalls()[1][1]).toEqual({
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
    expect(bulkCalls()[1][1]).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(1), planned: 1500 }] });
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
    expect(bulkCalls()[2][1]).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(1), planned: 1500 }] });
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

  it('clearing a column sends that column only, for the twelve months', async () => {
    setupApi({ grain: 'monthly' });
    const { ref } = renderTab();
    await waitForAmounts();

    const clearButtons = screen.getAllByRole('button', { name: 'opex.budget.clearColumn' });
    fireEvent.click(clearButtons[1]); // Revision
    await flush(ref);

    expect(bulkCalls()).toHaveLength(1);
    expect(bulkCalls()[0][1]).toEqual({
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
    expect(bulkCalls()[0][1]).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(1), planned: 1500 }] });
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
    expect(bulkCalls()[0][1]).toEqual({
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

    expect(bulkCalls().map(([, body]) => body)).toEqual([
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
    setupApi({ grain: 'annual', empty: true });
    mocked.post.mockResolvedValue({ data: { updated: 9, round_inputs: [record({})] } });
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
    expect(bulkCalls()[0][1]).toEqual({
      kind: 'annual',
      year: YEAR,
      totals: { planned: '12000.00', committed: '0.00', forecast: '0.00', expected_landing: '0.00', actual: '0.00' },
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
    expect(bulkCalls()[0][1]).toEqual({
      kind: 'annual',
      year: YEAR,
      totals: { committed: '10800.00', planned: '12000.00', forecast: '7200.00', expected_landing: '8400.00', actual: '9600.00' },
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
    expect(bulkCalls().map(([, body]) => body)).toEqual([
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

  it('Apply the distribution to all columns sends every column total in exact cents, without a frozen column', async () => {
    // 333.33 twelve times: a float sum gives 3999.9599999999996, cents give 3999.96.
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
    expect(bulkCalls()[0][1]).toEqual({
      kind: 'annual',
      year: YEAR,
      totals: { planned: '24000.00', forecast: '3999.96', expected_landing: '8400.00', actual: '9600.00' },
      spread_profile_name: 'flat',
      period_start: '2026-01-01',
      period_end: '2026-12-31',
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
    expect(bulkCalls()[0][1].totals).toEqual({
      planned: '12000.00', committed: '10800.00', forecast: '7200.00', actual: '9600.00', expected_landing: '8400.00',
    });
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
    expect(bulkCalls()[0][1]).toEqual({
      kind: 'annual',
      year: YEAR,
      totals: { actual: '9600.00', planned: '12000.00', committed: '10800.00', forecast: '7200.00', expected_landing: '8400.00' },
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
    expect(fields[2]).toHaveValue('7 200');
    fireEvent.change(fields[2], { target: { value: '5000' } });
    await flush(ref);
    expect(bulkCalls()[0][1]).toEqual({
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

    expect(screen.getAllByRole('combobox')[0]).toHaveTextContent('Revision');
    expect(screen.getByPlaceholderText('opex.budget.spreadPlaceholder')).toHaveValue('10 800');
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
    expect(bulkCalls()[0][1].totals).toEqual({
      planned: '13000.00', committed: '10800.00', actual: '9600.00', expected_landing: '8400.00',
    });
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
    expect(Object.keys(bulkCalls()[0][1].totals)).toEqual(['planned', 'committed', 'forecast', 'actual']);

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
    expect(bulkCalls()[0][1]).toEqual({
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
    expect(monthly[0][1]).toEqual({ kind: 'monthly', year: YEAR, months: [{ period: period(3), committed: 450 }] });
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
    expect(amountField()).toHaveValue('12 000');

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
