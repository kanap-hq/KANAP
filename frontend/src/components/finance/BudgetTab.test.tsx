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
import type { ComputePreview, RoundInput } from './roundPeriod';
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

function renderTab(year = YEAR, dates: { effectiveStart?: string; endOfValidity?: string } = {}) {
  const ref = React.createRef<BudgetTabHandle>();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (y: number) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <BudgetTab
            ref={ref} id="item-1" year={y} currency="EUR" onYearChange={() => undefined} config={OPEX_FINANCE_CONFIG}
            effectiveStart={dates.effectiveStart} endOfValidity={dates.endOfValidity}
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

  it('spread Apply after a failed save keeps the edit and does not post the spread', async () => {
    setupApi({ grain: 'monthly' });
    mocked.post.mockRejectedValue(new Error('network down'));
    const { ref, container } = renderTab();
    await waitForAmounts();

    fireEvent.change(cell(monthCells(container), 1, 0), { target: { value: '1500' } });
    expect(await flush(ref)).toBe(false);
    expect(ref.current?.isDirty()).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('opex.budget.spreadPlaceholder'), { target: { value: '24000' } });
    fireEvent.click(screen.getByRole('button', { name: 'opex.budget.spreadApply' }));
    // Apply first retries the unsaved edit; it fails again, so Apply stops there.
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
  pricing_basis: null,
  quantity: null,
  unit_price: null,
  price_index_pct: null,
  working_day_profile_id: null,
  working_day_profile_code: null,
  working_day_profile_name: null,
  counts_as_fte: false,
  ...over,
});

const periodLine = (measure: string) => screen.getByTestId(`period-line-${measure}`);

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

    expect(periodLine('planned')).toHaveTextContent('Copied from Budget 2025 +2% · 9 months, April to December');
    expect(periodLine('committed')).toHaveTextContent('Edited by hand · 6 months, July to December');
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

    await waitFor(() => expect(periodLine('planned')).toHaveTextContent('Spread flat · 9 months, April to December'));
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

    // A period in which no month counts blocks Apply.
    fireEvent.focus(from);
    fireEvent.change(from, { target: { value: '20/12/2026' } });
    fireEvent.blur(from);
    fireEvent.change(screen.getByPlaceholderText('opex.budget.spreadPlaceholder'), { target: { value: '500' } });
    expect(await screen.findByText('No month counts in this period.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'opex.budget.spreadApply' })).toBeDisabled();
  });

  it('Apply sends the period and the distribution', async () => {
    setupApi({ grain: 'monthly', empty: true });
    renderTab(YEAR, { effectiveStart: '2026-04-01' });
    await waitForAmounts();

    fireEvent.change(screen.getByPlaceholderText('opex.budget.spreadPlaceholder'), { target: { value: '12000' } });
    const [, distribution] = screen.getAllByRole('combobox');
    fireEvent.mouseDown(distribution);
    fireEvent.click(await screen.findByRole('option', { name: 'opex.budget.profile445' }));
    fireEvent.click(screen.getByRole('button', { name: 'opex.budget.spreadApply' }));

    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    // "Apply to all columns" is on by default: the empty columns get the same period.
    expect(bulkCalls()[0][1]).toEqual({
      kind: 'annual',
      year: YEAR,
      totals: { planned: '12000.00', committed: '0.00', forecast: '0.00', expected_landing: '0.00', actual: '0.00' },
      spread_profile_name: '4-4-5',
      period_start: '2026-04-01',
      period_end: '2026-12-31',
    });
    await waitFor(() => expect(amountLoads()).toBe(2));
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
    fireEvent.click(screen.getByRole('button', { name: 'opex.budget.spreadApply' }));

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
  });

  it('the panel proposes the stored period cut at the end of validity, without saving it on open', async () => {
    setupApi({ grain: 'annual', roundInputs: [record({ period_start: '2026-01-01', period_end: '2026-12-31' })] });
    const { ref } = renderTab(YEAR, { endOfValidity: '2026-06-30' });
    await waitForAmounts();

    fireEvent.click(within(periodLine('planned').parentElement as HTMLElement).getByRole('button', { name: 'Change period' }));
    await screen.findByPlaceholderText('opex.budget.spreadPlaceholder');
    expect(screen.getByTestId('spread-notes')).toHaveTextContent(/^July to December will be set to zero\.$/);
    // The column still shows its stored period, and opening the panel wrote nothing.
    expect(periodLine('planned')).toHaveTextContent('Spread flat · 12 months, January to December');
    expect(ref.current!.isDirty()).toBe(false);
    expect(bulkCalls()).toHaveLength(0);
    expect(mocked.patch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'opex.budget.spreadApply' }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toMatchObject({ totals: { planned: '12000.00' }, period_start: '2026-01-01', period_end: '2026-06-30' });
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
    fireEvent.click(screen.getByRole('button', { name: 'opex.budget.spreadApply' }));

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

  it('Reset fills the whole year, flat, with the column total and writes nothing', async () => {
    setupApi({
      grain: 'annual',
      roundInputs: [record({ spread_profile_name: '4-4-5', last_calculation: { kind: 'annual', total: '12000.00', profile: '4-4-5', active_months: [4, 5, 6, 7, 8, 9, 10, 11, 12], weights: [] } })],
    });
    renderTab(YEAR, { effectiveStart: '2026-04-01' });
    await waitForAmounts();

    fireEvent.click(within(periodLine('planned').parentElement as HTMLElement).getByRole('button', { name: 'Change period' }));
    const amount = await screen.findByPlaceholderText('opex.budget.spreadPlaceholder');
    fireEvent.change(amount, { target: { value: '500' } });
    expect(screen.getAllByRole('combobox')[1]).toHaveTextContent('opex.budget.profile445');

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(amount).toHaveValue('12 000');
    expect(screen.getAllByRole('combobox')[1]).toHaveTextContent('opex.budget.profileFlat');
    // The dates now cover the whole year: nothing is zeroed; only the item-dates hint remains.
    expect(screen.getByTestId('spread-notes')).toHaveTextContent(/^The period goes beyond the item's dates\.$/);
    expect(bulkCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'opex.budget.spreadApply' }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toMatchObject({
      totals: { planned: '12000.00' }, spread_profile_name: 'flat', period_start: '2026-01-01', period_end: '2026-12-31',
    });
  });

  it('Apply to all columns sends every column total in exact cents, without a frozen column', async () => {
    // 333.33 twelve times: a float sum gives 3999.9599999999996, cents give 3999.96.
    setupApi({ grain: 'monthly', frozen: ['revision'], monthValues: { forecast: '333.33' } });
    renderTab();
    await waitForAmounts();

    // No list under the switch: the rule is in its tooltip.
    expect(screen.queryByText(/will also be spread/)).not.toBeInTheDocument();
    fireEvent.mouseOver(screen.getByText('Apply to all columns'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Budget, Revision, Forecast, Actuals and Expected landing follow the same period. Frozen columns never change.',
    );

    fireEvent.change(screen.getByPlaceholderText('opex.budget.spreadPlaceholder'), { target: { value: '24000' } });
    fireEvent.click(screen.getByRole('button', { name: 'opex.budget.spreadApply' }));
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

  it('with Apply to all columns off, only the selected column is sent', async () => {
    setupApi({ grain: 'monthly' });
    renderTab();
    await waitForAmounts();

    fireEvent.click(screen.getByLabelText('Apply to all columns'));
    expect(screen.getByLabelText('Apply to all columns')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'opex.budget.spreadApply' }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toMatchObject({ totals: { planned: '12000.00' } });
    expect(Object.keys(bulkCalls()[0][1].totals)).toEqual(['planned']);
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

    expect(periodLine('actual')).toHaveTextContent('Edited by hand · 6 months, July to December');

    // From Actuals, the switch spreads every column.
    fireEvent.click(within(periodLine('actual').parentElement as HTMLElement).getByRole('button', { name: 'Change period' }));
    expect(await screen.findByPlaceholderText('opex.budget.spreadPlaceholder')).toHaveValue('9 600');
    expect(screen.getByLabelText('Apply to all columns')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'opex.budget.spreadApply' }));

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
    fireEvent.click(screen.getByLabelText('Apply to all columns'));
    fireEvent.click(screen.getByRole('button', { name: 'opex.budget.spreadApply' }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1].totals).toEqual({ committed: '10800.00' });
  });

  it('by default every shown column follows, and a hidden column is never spread', async () => {
    columnsSetting.current = DEFAULT_BUDGET_COLUMNS;
    setupApi({ grain: 'monthly' });
    renderTab();
    await waitForAmounts();

    fireEvent.click(screen.getByRole('button', { name: 'opex.budget.spreadApply' }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1].totals).toEqual({
      planned: '12000.00', committed: '10800.00', actual: '9600.00', expected_landing: '8400.00',
    });
  });

  it('a column taken out of the group keeps its own period, the tooltip says so, and it spreads alone', async () => {
    columnsSetting.current = { ...ALL_SHOWN, group_spread: { ...ALL_SHOWN.group_spread, expected_landing: false } };
    setupApi({ grain: 'monthly' });
    renderTab();
    await waitForAmounts();

    fireEvent.mouseOver(screen.getByText('Apply to all columns'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Budget, Revision, Forecast and Actuals follow the same period. Expected landing keeps its own period. Frozen columns never change.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'opex.budget.spreadApply' }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(Object.keys(bulkCalls()[0][1].totals)).toEqual(['planned', 'committed', 'forecast', 'actual']);

    // Spreading the column outside the group: no switch, that column only.
    fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
    fireEvent.click(await screen.findByRole('option', { name: 'Expected landing' }));
    await waitFor(() => expect(screen.queryByText('Apply to all columns')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'opex.budget.spreadApply' }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(2));
    expect(bulkCalls()[1][1].totals).toEqual({ expected_landing: '8400.00' });
  });

  it('offers no switch when every other column of the group is frozen', async () => {
    columnsSetting.current = { ...DEFAULT_BUDGET_COLUMNS, enabled: { ...DEFAULT_BUDGET_COLUMNS.enabled, actual: false, expected_landing: false } };
    setupApi({ grain: 'monthly', frozen: ['revision'] });
    renderTab();
    await waitForAmounts();
    await waitFor(() => expect(freezeLoads()).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(screen.queryByText('Apply to all columns')).not.toBeInTheDocument());
  });
});

// The SFR example: France 218, February 1 to October 30 2026, 1 person at 400 a day.
const SFR_DAYS = ['18', '18', '20', '20', '15', '20', '15', '16', '20', '19', '18', '19'];
const SFR_MONTHS = ['0.00', '7200.00', '8000.00', '8000.00', '6000.00', '8000.00', '6000.00', '6400.00', '8000.00', '7600.00', '0.00', '0.00'];
const FEB_TO_OCT = [2, 3, 4, 5, 6, 7, 8, 9, 10];
const ZERO_MONTHS = Array.from({ length: 12 }, () => '0.00');
const FRANCE_218 = {
  id: 'cal-1', code: 'FR218', name: 'France 218', description: null,
  days_by_year: { 2026: SFR_DAYS }, status: 'enabled', disabled_at: null,
};
const PREVIEW = '/spend-versions/compute-preview';
const VERSIONS = '/spend-items/item-1/versions';

const sfrPreview = (over: Partial<ComputePreview> = {}): ComputePreview => ({
  active_months: FEB_TO_OCT,
  day_counts: SFR_DAYS,
  total_days: '163',
  month_amounts: SFR_MONTHS,
  total: '65200.00',
  fte: '0.75',
  calendar: { id: 'cal-1', code: 'FR218', name: 'France 218', disabled: false },
  stored: { month_amounts: ZERO_MONTHS, method: null, last_calculation: null },
  changed_months: FEB_TO_OCT,
  calendar_changed_months: [],
  warnings: [],
  ...over,
});

/** The preview route answers `preview` (or throws it); every other POST answers like bulk-upsert. */
function routePosts(preview: ComputePreview | Error, bulk: Record<string, unknown> = { updated: 12 }) {
  mocked.post.mockImplementation(async (url: string) => {
    if (url === VERSIONS) return { data: { id: 'v1', input_grain: 'monthly', budget_year: YEAR } };
    if (url === PREVIEW) {
      if (preview instanceof Error) throw preview;
      return { data: preview };
    }
    return { data: bulk };
  });
}
const previewCalls = () => mocked.post.mock.calls.filter(([url]) => url === PREVIEW);
const lastPreviewBody = () => { const calls = previewCalls(); return calls[calls.length - 1]?.[1]; };

const computedRecord = (over: Partial<RoundInput> = {}): RoundInput => record({
  method: 'computed',
  period_start: '2026-02-01',
  period_end: '2026-10-30',
  spread_profile_name: null,
  pricing_basis: 'per_day',
  quantity: '1',
  unit_price: '400',
  price_index_pct: '0',
  working_day_profile_id: 'cal-1',
  working_day_profile_code: 'FR218',
  working_day_profile_name: 'France 218',
  counts_as_fte: true,
  last_calculation: {
    kind: 'computed', pricing_basis: 'per_day', quantity: '1', unit_price: '400', price_index_pct: '0',
    working_day_profile_code: 'FR218', working_day_profile_name: 'France 218', active_months: FEB_TO_OCT,
    day_counts: SFR_DAYS, total_days: '163', month_amounts: SFR_MONTHS, total: '65200.00', counts_as_fte: true,
  },
  ...over,
});

/** Types a date in a DateEUField the way a user does. */
function typeDate(input: HTMLElement, ddmmyyyy: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: ddmmyyyy } });
  fireEvent.blur(input);
}

async function pick(combobox: HTMLElement, option: string) {
  fireEvent.mouseDown(combobox);
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

describe('BudgetTab compute from quantity and price', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
    calendarsState.list = [FRANCE_218];
  });

  it('the panel box switches between spreading an amount and computing', async () => {
    setupApi({ grain: 'monthly' });
    renderTab();
    await waitForAmounts();

    expect(screen.getByRole('tab', { name: 'Spread an amount' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Compute from quantity and price' }));
    expect(screen.queryByPlaceholderText('opex.budget.spreadPlaceholder')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Quantity')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compute' })).toBeDisabled();
    expect(screen.getByTestId('compute-notes')).toHaveTextContent('Enter a quantity and a unit price to see the result.');

    fireEvent.click(screen.getByRole('tab', { name: 'Spread an amount' }));
    expect(screen.getByPlaceholderText('opex.budget.spreadPlaceholder')).toHaveValue('12 000');
    expect(screen.queryByLabelText('Quantity')).not.toBeInTheDocument();
  });

  it('shows the live line from the server and posts the computation', async () => {
    setupApi({ grain: 'monthly', empty: true });
    routePosts(sfrPreview());
    renderTab();
    await waitForAmounts();

    fireEvent.click(screen.getByRole('tab', { name: 'Compute from quantity and price' }));
    // Column and basis; the calendar only comes with a price per day.
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    await pick(screen.getAllByRole('combobox')[1], 'Per day');
    expect(screen.getAllByRole('combobox')).toHaveLength(3);
    await pick(screen.getAllByRole('combobox')[2], 'France 218');
    const [from, to] = screen.getAllByPlaceholderText('labels.datePlaceholder');
    typeDate(from, '01/02/2026');
    typeDate(to, '30/10/2026');
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Unit price'), { target: { value: '400' } });
    fireEvent.click(screen.getByLabelText('Counts as FTE'));

    const expected = {
      kind: 'computed', year: YEAR, measure: 'planned', period_start: '2026-02-01', period_end: '2026-10-30',
      pricing_basis: 'per_day', quantity: '1', unit_price: '400', price_index_pct: '0',
      working_day_profile_id: 'cal-1', counts_as_fte: true,
    };
    await waitFor(() => expect(lastPreviewBody()).toEqual({ ...expected, item_id: 'item-1' }));
    await waitFor(() => expect(screen.getByTestId('compute-line')).toHaveTextContent(/^9 months · 163 days · 65 200 · 0\.75 FTE$/));
    // The preview writes nothing.
    expect(bulkCalls()).toHaveLength(0);

    const compute = screen.getByRole('button', { name: 'Compute' });
    await waitFor(() => expect(compute).not.toBeDisabled());
    fireEvent.click(compute);
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toEqual(expected);
    await waitFor(() => expect(amountLoads()).toBe(2));
  });

  it('previews a year without a version without creating one; Compute creates it', async () => {
    setupApi({ grain: 'annual', empty: true, noVersion: true });
    routePosts(sfrPreview({ day_counts: null, total_days: null, fte: null, calendar: null }));
    renderTab();
    // No version: nothing to fetch but the version list.
    await waitFor(() => expect(periodLine('planned')).toHaveTextContent('12 months, January to December'));
    const versionPosts = () => mocked.post.mock.calls.filter(([url]) => url === VERSIONS);

    fireEvent.click(within(periodLine('planned').parentElement as HTMLElement).getByRole('button', { name: 'Compute from quantity and price' }));
    fireEvent.change(await screen.findByLabelText('Quantity'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Unit price'), { target: { value: '200' } });
    await screen.findByTestId('compute-line');
    expect(lastPreviewBody()).toMatchObject({ item_id: 'item-1', year: YEAR, measure: 'planned', quantity: '10', unit_price: '200' });
    expect(versionPosts()).toHaveLength(0);
    expect(mocked.patch).not.toHaveBeenCalled();

    const compute = screen.getByRole('button', { name: 'Compute' });
    await waitFor(() => expect(compute).not.toBeDisabled());
    fireEvent.click(compute);
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(versionPosts()).toHaveLength(1);
    expect(bulkCalls()[0][1]).not.toHaveProperty('item_id');
  });

  it('sends decimals typed key by key, as typed', async () => {
    setupApi({ grain: 'monthly', empty: true });
    routePosts(sfrPreview({ day_counts: null, total_days: null, fte: null, calendar: null }));
    renderTab();
    await waitForAmounts();

    fireEvent.click(screen.getByRole('tab', { name: 'Compute from quantity and price' }));
    const typeKeys = (label: string, text: string) => {
      const input = screen.getByLabelText(label);
      for (let i = 1; i <= text.length; i++) fireEvent.change(input, { target: { value: text.slice(0, i) } });
      expect(input).toHaveValue(text);
    };
    typeKeys('Quantity', '1.5');
    typeKeys('Unit price', '400.25');
    typeKeys('Price index (%)', '2.5');

    await waitFor(() => expect(lastPreviewBody()).toMatchObject({ quantity: '1.5', unit_price: '400.25', price_index_pct: '2.5' }));
    expect(previewCalls()).toHaveLength(1);
  });

  it('shows a refusal from the server in place of the line and blocks Compute', async () => {
    setupApi({ grain: 'monthly', empty: true });
    const refusal = 'France 218 has no working days for 2026. Add them on the Working-day calendars page.';
    routePosts(Object.assign(new Error('Bad Request'), { response: { status: 400, data: { message: refusal } } }));
    renderTab();
    await waitForAmounts();

    fireEvent.click(screen.getByRole('tab', { name: 'Compute from quantity and price' }));
    await pick(screen.getAllByRole('combobox')[1], 'Per day');
    await pick(screen.getAllByRole('combobox')[2], 'France 218');
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Unit price'), { target: { value: '400' } });

    expect(await screen.findByText(refusal)).toBeInTheDocument();
    expect(screen.queryByTestId('compute-line')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compute' })).toBeDisabled();
  });

  it('offers the calendar for a price per day only, and a link when the tenant has none', async () => {
    calendarsState.list = [];
    setupApi({ grain: 'monthly' });
    renderTab();
    await waitForAmounts();

    fireEvent.click(screen.getByRole('tab', { name: 'Compute from quantity and price' }));
    expect(screen.queryByText('Add a calendar')).not.toBeInTheDocument();
    await pick(screen.getAllByRole('combobox')[1], 'Per day');
    expect(screen.getByRole('link', { name: 'Add a calendar' })).toHaveAttribute('href', '/master-data/working-day-calendars');
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Unit price'), { target: { value: '400' } });
    expect(screen.getByTestId('compute-notes')).toHaveTextContent('Choose a working-day calendar for a price per day.');

    await pick(screen.getAllByRole('combobox')[1], 'For the whole period');
    expect(screen.queryByText('Add a calendar')).not.toBeInTheDocument();
  });

  it('offers the link to the calendars page only to a member of the calendars', async () => {
    calendarsState.list = [];
    permissions.calendarsMember = false;
    setupApi({ grain: 'monthly' });
    renderTab();
    await waitForAmounts();

    fireEvent.click(screen.getByRole('tab', { name: 'Compute from quantity and price' }));
    await pick(screen.getAllByRole('combobox')[1], 'Per day');
    expect(screen.getByText('No working-day calendar yet.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add a calendar' })).not.toBeInTheDocument();
  });

  it('says so when the calendars cannot be loaded', async () => {
    calendarsState.list = [];
    calendarsState.failed = true;
    setupApi({ grain: 'monthly' });
    renderTab();
    await waitForAmounts();

    fireEvent.click(screen.getByRole('tab', { name: 'Compute from quantity and price' }));
    await pick(screen.getAllByRole('combobox')[1], 'Per day');
    expect(screen.getByText('The working-day calendars could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('No working-day calendar yet.')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add a calendar' })).not.toBeInTheDocument();
  });

  it('a frozen column cannot be picked or computed', async () => {
    setupApi({ grain: 'monthly', frozen: ['budget'] });
    routePosts(sfrPreview({ day_counts: null, total_days: null, fte: null, calendar: null }));
    renderTab();
    await waitForAmounts();
    await waitFor(() => expect(freezeLoads()).toBeGreaterThanOrEqual(1));

    fireEvent.click(screen.getByRole('tab', { name: 'Compute from quantity and price' }));
    fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
    expect(await screen.findByRole('option', { name: 'Budget' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('option', { name: 'Revision' })).not.toHaveAttribute('aria-disabled');
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });

    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Unit price'), { target: { value: '200' } });
    await screen.findByTestId('compute-line');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(screen.getByRole('button', { name: 'Compute' })).toBeDisabled();
    expect(screen.getByTestId('compute-notes')).toHaveTextContent('opex.budget.someColumnsFrozen');
  });

  it('a computed column says how, opens prefilled on Recompute and lists what changed', async () => {
    calendarsState.list = [{ ...FRANCE_218, status: 'disabled', disabled_at: '2026-06-01T00:00:00Z' }];
    setupApi({ grain: 'annual', roundInputs: [computedRecord()] });
    const warning = 'This calendar is disabled. The computation still uses it.';
    const days = [...SFR_DAYS]; days[2] = '19';
    const months = [...SFR_MONTHS]; months[2] = '7600.00';
    routePosts(sfrPreview({
      day_counts: days, total_days: '162', month_amounts: months, total: '64800.00',
      stored: { month_amounts: SFR_MONTHS, method: 'computed', last_calculation: computedRecord().last_calculation },
      changed_months: [3], calendar_changed_months: [3], warnings: [warning],
    }));
    renderTab();
    await waitForAmounts();

    expect(periodLine('planned')).toHaveTextContent('Computed per day, France 218 · 9 months, February to October');
    fireEvent.mouseOver(periodLine('planned'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Per day · Quantity 1 · Unit price 400 · Calendar France 218 · Counts as FTE');

    fireEvent.click(within(periodLine('planned').parentElement as HTMLElement).getByRole('button', { name: 'Compute from quantity and price' }));
    expect(await screen.findByLabelText('Quantity')).toHaveValue('1');
    expect(screen.getByLabelText('Unit price')).toHaveValue('400');
    // The column's own calendar was disabled since: still offered, and marked.
    expect(screen.getAllByRole('combobox')[2]).toHaveTextContent('France 218 (disabled)');
    expect(screen.getByLabelText('Counts as FTE')).toBeChecked();

    await waitFor(() => expect(screen.getByTestId('compute-notes')).toHaveTextContent('March: 20 days, now 19'));
    const notes = screen.getByTestId('compute-notes');
    expect(notes).toHaveTextContent('Working days changed since the last computation: March: 20 days, now 19');
    expect(notes).toHaveTextContent('Amounts that would change: March: 8 000, now 7 600');
    expect(notes).toHaveTextContent(warning);
    expect(screen.getByTestId('compute-line')).toHaveTextContent(/^9 months · 162 days · 64 800 · 0\.75 FTE$/);
    expect(lastPreviewBody()).toMatchObject({
      period_start: '2026-02-01', period_end: '2026-10-30', working_day_profile_id: 'cal-1', counts_as_fte: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Recompute' }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkCalls()[0][1]).toMatchObject({ kind: 'computed', measure: 'planned', pricing_basis: 'per_day', quantity: '1', unit_price: '400' });
    // From the yearly view the box closes and the view stays yearly.
    await waitFor(() => expect(screen.queryByLabelText('Quantity')).not.toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'opex.budget.flat' })).toHaveAttribute('aria-selected', 'true');
  });

  it('names the four ways a column is produced', async () => {
    setupApi({
      grain: 'monthly',
      roundInputs: [
        record({ period_start: '2026-01-01' }),
        record({ measure: 'committed', method: 'copied', period_start: '2026-01-01', last_calculation: { kind: 'copy', source_year: 2025, source_measure: 'planned', uplift_pct: '0', source_total: '1.00', total: '1.00', source_method: 'computed' } }),
        record({ measure: 'forecast', method: 'manual', period_start: '2026-01-01' }),
        computedRecord({ measure: 'actual', pricing_basis: 'per_month', working_day_profile_id: null, working_day_profile_code: null, working_day_profile_name: null, last_calculation: null }),
      ],
    });
    const { container } = renderTab();
    await waitForAmounts();

    const header = container.querySelector('thead') as HTMLElement;
    expect(within(header).getByText('Spread flat')).toBeInTheDocument();
    expect(within(header).getByText('Copied from Budget 2025')).toBeInTheDocument();
    expect(within(header).getByText('Edited by hand')).toBeInTheDocument();
    expect(within(header).getByText('Computed per month')).toBeInTheDocument();
  });
});
