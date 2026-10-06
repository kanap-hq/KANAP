import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

// Real English for the budget tab strings, every other key comes back as itself.
vi.mock('react-i18next', async () => {
  const i18next = (await import('i18next')).default;
  const enOps = (await import('../../locales/en/ops.json')).default;
  const real = i18next.createInstance();
  await real.init({ lng: 'en', resources: { en: { ops: enOps } }, defaultNS: 'ops', interpolation: { escapeValue: false } });
  const t = (rawKey: string, options?: unknown) => {
    const key = rawKey.replace(/^ops:/, '');
    return key.startsWith('budgetTab.') ? real.t(key, options as Record<string, unknown>) : rawKey;
  };
  const translation = { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});

vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));

// The tenant's calendars, set per test.
const calendarsState = vi.hoisted(() => ({ list: [] as unknown[], ready: true }));
vi.mock('../../hooks/useWorkingDayProfiles', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../hooks/useWorkingDayProfiles')>();
  return { ...mod, useWorkingDayProfiles: () => mod.buildWorkingDayProfiles(calendarsState.list as never, calendarsState.ready) };
});

// The working days of a calendar's year, now.
const yearDays = vi.hoisted(() => ({ byId: {} as Record<string, string[]> }));
vi.mock('../../services/workingDayProfiles', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../services/workingDayProfiles')>();
  return {
    ...mod,
    getWorkingDayProfileYear: vi.fn(async (id: string, year: number) => ({
      year, source: 'standard', days: yearDays.byId[id] ?? null, standard_days: null, holidays: [],
    })),
  };
});

vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));

import LinesPanel, {
  LINE_COLUMN_GAP, LINE_COLUMN_WIDTHS, LINE_MUL_WIDTH, LINE_SECOND_ROW_WIDTHS, LINE_TIMING_ROW_WIDTHS, LINES_OFTEN_FIRST_MIN_WIDTH, LINES_TABLE_MIN_WIDTH, LINES_TWO_ROWS_MIN_WIDTH, LinesPanelProps, UNIT_PRICE_NUMBER_WIDTH, defaultCalendarId, tableLineMessage,
} from './LinesPanel';
import type { LineCalculation, RoundInput, RoundLine } from './roundPeriod';
import { buildWorkingDayProfiles } from '../../hooks/useWorkingDayProfiles';

const theme = createAppTheme('light');

const calendar = (id: string, name: string, country: string | null, region: string | null = null, status = 'enabled') => ({
  id, code: id.toUpperCase(), name, description: null, days_by_year: {}, status, disabled_at: null,
  country_iso: country, region_code: region, country_name: null, region_name: null,
});
const FRANCE = calendar('fr', 'France', 'FR');
const MOSELLE = calendar('fr-57', 'France (Moselle)', 'FR', '57');
const US = calendar('us', 'United States', 'US');
const CUSTOM = calendar('cu', 'Agency', null);

const DAYS_2026 = ['21', '20', '22', '21', '17', '22', '22', '21', '22', '22', '20', '22'];

const PIECES = { quantity_unit: 'pieces', price_basis: 'per_piece', days_per_month: null, working_day_profile_id: null, working_day_profile_code: null, working_day_profile_name: null } as const;

const storedLine = (over: Partial<RoundLine> = {}): RoundLine => ({
  id: 'l1',
  sort: 0,
  label: 'Project manager',
  quantity_unit: 'people',
  quantity: '1.000',
  unit_price: '900.0000',
  price_basis: 'per_day',
  frequency: 'per_month',
  days_per_month: '5.000',
  period_start: '2026-01-01',
  period_end: '2026-06-30',
  working_day_profile_id: 'fr',
  working_day_profile_code: 'FR',
  working_day_profile_name: 'France',
  ...over,
});

const explained = (line: RoundLine, over: Partial<LineCalculation> = {}): LineCalculation => ({
  label: line.label,
  quantity_unit: line.quantity_unit,
  quantity: line.quantity,
  unit_price: line.unit_price,
  price_basis: line.price_basis,
  frequency: line.frequency,
  days_per_month: line.days_per_month,
  period_start: line.period_start,
  period_end: line.period_end,
  working_day_profile_id: line.working_day_profile_id,
  working_day_profile_code: line.working_day_profile_code,
  working_day_profile_name: line.working_day_profile_name,
  active_months: [1, 2, 3, 4, 5, 6],
  day_counts: line.price_basis === 'per_day' ? DAYS_2026 : null,
  total_days: null,
  month_amounts: [],
  fte_months: [],
  fte: '0.12',
  fte_period: '0.24',
  total: '27000.00',
  ...over,
});

const roundWith = (lines: RoundLine[], over: Partial<RoundInput> = {}, calcLines?: LineCalculation[]): RoundInput => ({
  measure: 'planned',
  period_start: '2026-01-01',
  period_end: '2026-06-30',
  method: 'computed',
  spread_profile_name: null,
  updated_at: '2026-09-28T10:00:00Z',
  updated_by: null,
  fte: '0.12',
  lines,
  last_calculation: {
    kind: 'computed', total: '27000.00', fte: '0.12', fte_period: '0.24', month_amounts: [], fte_months: [], active_months: [1, 2, 3, 4, 5, 6],
    lines: calcLines ?? lines.map((line) => explained(line)),
  },
  ...over,
});

type Options = Partial<LinesPanelProps> & { onSave?: LinesPanelProps['onSave'] };

function renderPanel(options: Options = {}) {
  const onSave = options.onSave ?? vi.fn(async () => ({ ok: true as const }));
  const onApplyToAll = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: LinesPanelProps = {
    year: 2026,
    record: undefined,
    period: { start: '2026-04-01', end: '2026-12-31' },
    frozen: false,
    frozenHint: 'frozen',
    columnName: (m) => (m === 'planned' ? 'Budget' : 'Revision'),
    applyToAll: { offered: false, on: false, hint: '', onChange: onApplyToAll },
    ...options,
    onSave,
  };
  const ui = (next: LinesPanelProps) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <LinesPanel {...next} />
        </ThemeProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  const view = render(ui(props));
  return {
    onSave: onSave as ReturnType<typeof vi.fn>,
    onApplyToAll,
    unmount: view.unmount,
    /** The same panel drawn again with other props (a reload brought another record). */
    rerender: (change: Partial<LinesPanelProps>) => view.rerender(ui({ ...props, ...change })),
  };
}

const rows = () => screen.getAllByTestId('line-row');
/** A select of a line by its name: Unit, Price per (people), How often (pieces), Calendar (per day). */
const combo = (row: number, name: string) => within(rows()[row]).getByRole('combobox', { name });
const noCombo = (row: number, name: string) => within(rows()[row]).queryByRole('combobox', { name });
/** The date fields of a line: From and To, or the one Date of pieces bought once. */
const dates = (row: number) => within(rows()[row]).queryAllByPlaceholderText('labels.datePlaceholder');
const heads = () => within(screen.getByTestId('lines-table')).getAllByRole('columnheader').map((th) => th.textContent);
/** The From and To heads of the one-row table: the line number gutter comes first. */
const dateHeads = () => heads().slice(6, 8);
const numbers = () => screen.getAllByTestId('line-number').map((cell) => cell.textContent);
/** Two rows per line: the first, what is priced; the second, the sentence of when and how. */
const priced = (row: number) => within(within(rows()[row]).getByTestId('line-priced'));
const timing = (row: number) => within(within(rows()[row]).getByTestId('line-timing'));
/** The cells of the single header row of the narrow layout. */
const pricedHeads = () => within(screen.getByTestId('lines-head')).getAllByRole('columnheader');
/** The grid of a line's second row: the same tracks for every line. */
const secondRowGrid = (row: number) => within(rows()[row]).getByTestId('line-sentence');
async function pick(combobox: HTMLElement, option: string) {
  fireEvent.mouseDown(combobox);
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
const typeAndLeave = (input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};
const notes = () => screen.getByTestId('lines-notes');
/** Types a date in a DateEUField the way a user does. */
function typeDate(input: HTMLElement, ddmmyyyy: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: ddmmyyyy } });
  fireEvent.blur(input);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const options = async () => (await screen.findAllByRole('option')).map((o) => o.textContent);

beforeEach(() => {
  calendarsState.list = [FRANCE, MOSELLE, US, CUSTOM];
  calendarsState.ready = true;
  yearDays.byId = {};
});

describe('LinesPanel', () => {
  it('keeps every column at its least width: a narrow panel scrolls the table instead of squeezing the fields', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    expect(LINES_TABLE_MIN_WIDTH).toBe(1467);
    const table = screen.getByTestId('lines-table');
    expect(table).toHaveStyle({ tableLayout: 'fixed', minWidth: '1467px' });
    const ths = within(table).getAllByRole('columnheader');
    // The line number gutter, then the description at its fixed width: the fields stay next to it.
    expect(ths[0]).toHaveStyle({ width: `${LINE_COLUMN_WIDTHS.number}px` });
    expect(ths[1]).toHaveStyle({ width: `${LINE_COLUMN_WIDTHS.description}px` });
    const { quantity, unit, unitPrice, often, from, to, calendar, amount, remove } = LINE_COLUMN_WIDTHS;
    [quantity, unit, unitPrice, often, from, to, calendar].forEach((width, i) => expect(ths[i + 2]).toHaveStyle({ width: `${width}px` }));
    // The filler column (no width of its own) takes the free width before Amount.
    expect(ths[9]).toBeEmptyDOMElement();
    [amount, remove].forEach((width, i) => expect(ths[i + 10]).toHaveStyle({ width: `${width}px` }));
    expect(heads()).toEqual(['', 'Description', 'Quantity', 'Unit', 'Unit price', 'How often', 'From', 'To', 'Calendar', '', 'Amount', '']);
    // Unit price sits over the number field, right-aligned, not over what the price is for.
    expect(screen.getByTestId('lines-head-unit-price')).toHaveStyle({ width: `${UNIT_PRICE_NUMBER_WIDTH}px`, textAlign: 'right' });
  });

  it('a new line is one person per day on the paying company calendar, over the column period, and waits for its days', async () => {
    const { onSave } = renderPanel({ payingCompanyCountry: 'us' });
    expect(screen.getByText('No line yet. A line is a quantity times a unit price.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    expect(combo(0, 'Unit')).toHaveTextContent('people');
    expect(combo(0, 'Price per')).toHaveTextContent('per day');
    expect(combo(0, 'Calendar')).toHaveTextContent('United States');
    expect(screen.getByLabelText('Quantity')).toHaveValue('1');
    expect(screen.getByRole('checkbox', { name: 'Full time' })).not.toBeChecked();
    const days = screen.getByLabelText('days per month');
    expect(days).toHaveValue('');
    expect(days).toHaveAttribute('placeholder', 'e.g., 5');
    const [from, to] = dates(0);
    fireEvent.focus(from);
    expect(from).toHaveValue('01/04/2026');
    fireEvent.blur(from);
    fireEvent.focus(to);
    expect(to).toHaveValue('31/12/2026');
    fireEvent.blur(to);

    // No unit price yet: the line is kept here, with the reason.
    fireEvent.blur(screen.getByLabelText('Unit price'));
    expect(notes()).toHaveTextContent('Enter a quantity and a unit price to save this line.');
    // A price, but neither days nor Full time.
    typeAndLeave(screen.getByLabelText('Unit price'), '1200');
    expect(notes()).toHaveTextContent('Enter the days per month, or tick Full time.');
    expect(onSave).not.toHaveBeenCalled();

    typeAndLeave(days, '5');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith([{
      label: '', quantity_unit: 'people', quantity: '1', unit_price: '1200', price_basis: 'per_day', frequency: 'per_month',
      days_per_month: '5', period_start: '2026-04-01', period_end: '2026-12-31', working_day_profile_id: 'us',
    }], false, []);
  });

  it('without an enabled calendar, a new line is one person per month and saves with its price alone', async () => {
    calendarsState.list = [calendar('old', 'Old', 'FR', null, 'disabled')];
    const { onSave } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    expect(combo(0, 'Unit')).toHaveTextContent('people');
    expect(combo(0, 'Price per')).toHaveTextContent('per month');
    expect(within(rows()[0]).getByTestId('line-frequency')).toHaveTextContent('per month');
    expect(screen.queryByRole('checkbox', { name: 'Full time' })).not.toBeInTheDocument();
    expect(noCombo(0, 'Calendar')).not.toBeInTheDocument();

    typeAndLeave(screen.getByLabelText('Unit price'), '8000');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith([{
      label: '', quantity_unit: 'people', quantity: '1', unit_price: '8000', price_basis: 'per_month', frequency: 'per_month',
      days_per_month: null, period_start: '2026-04-01', period_end: '2026-12-31', working_day_profile_id: null,
    }], false, []);
  });

  it('while the calendars are loading, a new line keeps the price per day', () => {
    calendarsState.list = [];
    calendarsState.ready = false;
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    expect(combo(0, 'Price per')).toHaveTextContent('per day');
    expect(screen.getByRole('checkbox', { name: 'Full time' })).not.toBeChecked();
  });

  it('Full time needs no days: the line is sent without them, and unticked it asks for them again', async () => {
    const { onSave } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    typeAndLeave(screen.getByLabelText('Unit price'), '400');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Full time' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0][0]).toMatchObject({ quantity_unit: 'people', price_basis: 'per_day', frequency: 'per_month', days_per_month: null });
    expect(screen.queryByLabelText('days per month')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Full time' }));
    expect(screen.getByLabelText('days per month')).toHaveValue('');
    expect(notes()).toHaveTextContent('Enter the days per month, or tick Full time.');
    await settle();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('a stored line opens ticked when full time, with its days otherwise', () => {
    renderPanel({ record: roundWith([storedLine({ days_per_month: null }), storedLine({ id: 'l2', sort: 1, label: 'Second' })]) });
    const boxes = screen.getAllByRole('checkbox', { name: 'Full time' });
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).not.toBeChecked();
    expect(screen.getAllByLabelText('days per month')).toHaveLength(1);
    expect(screen.getByLabelText('days per month')).toHaveValue('5');
  });

  it('picks the standard calendar of the country, else the first enabled one, else none', () => {
    const enabled = buildWorkingDayProfiles([CUSTOM, MOSELLE, FRANCE, US] as never).enabled;
    // The whole country, not a region.
    expect(defaultCalendarId(enabled, 'FR')).toBe('fr');
    // No company country, or none of its own: the first by name.
    expect(defaultCalendarId(enabled, null)).toBe('cu');
    expect(defaultCalendarId(enabled, 'DE')).toBe('cu');
    expect(defaultCalendarId([], 'FR')).toBe('');
  });

  it('people are priced per day or per month in the price cell; per month counts every month without a calendar', async () => {
    const { onSave } = renderPanel({ record: roundWith([storedLine()]) });

    fireEvent.mouseDown(combo(0, 'Price per'));
    expect(await options()).toEqual(['per day', 'per month']);
    fireEvent.click(screen.getByRole('option', { name: 'per month' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0][0]).toMatchObject({
      quantity_unit: 'people', price_basis: 'per_month', frequency: 'per_month', days_per_month: null, working_day_profile_id: null,
    });
    expect(within(rows()[0]).getByTestId('line-frequency')).toHaveTextContent('per month');
    expect(noCombo(0, 'Calendar')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Full time' })).not.toBeInTheDocument();

    // Back to per day: the days typed before and the calendar come back.
    await pick(combo(0, 'Price per'), 'per day');
    expect(screen.getByLabelText('days per month')).toHaveValue('5');
    expect(combo(0, 'Calendar')).toHaveTextContent('France');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][0][0]).toMatchObject({ price_basis: 'per_day', days_per_month: '5', working_day_profile_id: 'fr' });
  });

  it('a unit change sets its price and how often: days over the period, pieces once on the column start', async () => {
    const person = storedLine({ price_basis: 'per_month', days_per_month: null, working_day_profile_id: null, working_day_profile_code: null, working_day_profile_name: null });
    const { onSave } = renderPanel({ record: roundWith([person]), payingCompanyCountry: 'FR' });

    fireEvent.mouseDown(combo(0, 'Unit'));
    expect(await options()).toEqual(['people', 'days', 'pieces']);
    fireEvent.click(screen.getByRole('option', { name: 'days' }));
    expect(within(rows()[0]).getByTestId('line-basis')).toHaveTextContent('per day');
    expect(within(rows()[0]).getByTestId('line-frequency')).toHaveTextContent('over the period');
    expect(combo(0, 'Calendar')).toHaveTextContent('France');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0][0]).toMatchObject({
      quantity_unit: 'days', price_basis: 'per_day', frequency: 'once', days_per_month: null, working_day_profile_id: 'fr',
      period_start: '2026-01-01', period_end: '2026-06-30',
    });

    // Pieces: per piece, once, on one date: the column's period start.
    await pick(combo(0, 'Unit'), 'pieces');
    expect(within(rows()[0]).getByTestId('line-basis')).toHaveTextContent('per piece');
    expect(combo(0, 'How often')).toHaveTextContent('once');
    expect(noCombo(0, 'Calendar')).not.toBeInTheDocument();
    expect(dates(0)).toHaveLength(1);
    expect(dateHeads()).toEqual(['Date', '']);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][0][0]).toMatchObject({
      quantity_unit: 'pieces', price_basis: 'per_piece', frequency: 'once', working_day_profile_id: null,
      period_start: '2026-04-01', period_end: '2026-04-01',
    });

    // Pieces each month take From and To again, over the column's period.
    fireEvent.mouseDown(combo(0, 'How often'));
    expect(await options()).toEqual(['per month', 'once']);
    fireEvent.click(screen.getByRole('option', { name: 'per month' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(3));
    expect(onSave.mock.calls[2][0][0]).toMatchObject({ frequency: 'per_month', period_start: '2026-04-01', period_end: '2026-12-31' });
    expect(dates(0)).toHaveLength(2);
    expect(dateHeads()).toEqual(['From', 'To']);

    // Back to people: per day each month, and the days are asked for.
    await pick(combo(0, 'Unit'), 'people');
    expect(combo(0, 'Price per')).toHaveTextContent('per day');
    expect(combo(0, 'Calendar')).toHaveTextContent('France');
    expect(notes()).toHaveTextContent('Enter the days per month, or tick Full time.');
    await settle();
    expect(onSave).toHaveBeenCalledTimes(3);
  });

  it('pieces bought once take one date, written as both From and To', async () => {
    const laptop = storedLine({ ...PIECES, label: 'Laptop', unit_price: '2000.0000', frequency: 'once', period_start: '2026-03-15', period_end: '2026-03-15' });
    const { onSave } = renderPanel({ record: roundWith([laptop]) });
    expect(dateHeads()).toEqual(['Date', '']);
    expect(dates(0)).toHaveLength(1);
    const [date] = dates(0);
    fireEvent.focus(date);
    expect(date).toHaveValue('15/03/2026');
    fireEvent.blur(date);

    typeDate(dates(0)[0], '20/05/2026');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0][0]).toMatchObject({ frequency: 'once', period_start: '2026-05-20', period_end: '2026-05-20' });

    // A date of another year stays here, with the reason.
    typeDate(dates(0)[0], '20/05/2027');
    expect(notes()).toHaveTextContent('Choose a date in 2026.');
    await settle();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('every commit sends all complete lines; an incomplete one stays here', async () => {
    const first = storedLine();
    const second = storedLine({ ...PIECES, id: 'l2', sort: 1, label: 'Licences', quantity: '3.000', unit_price: '10.0000' });
    const { onSave } = renderPanel({ record: roundWith([first, second]) });

    // Leaving a field without a change writes nothing.
    fireEvent.blur(screen.getAllByLabelText('Description')[0]);
    expect(onSave).not.toHaveBeenCalled();

    typeAndLeave(screen.getAllByLabelText('Description')[1], 'Licences, yearly');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual([
      {
        label: 'Project manager', quantity_unit: 'people', quantity: '1', unit_price: '900', price_basis: 'per_day', frequency: 'per_month',
        days_per_month: '5', period_start: '2026-01-01', period_end: '2026-06-30', working_day_profile_id: 'fr',
      },
      {
        label: 'Licences, yearly', quantity_unit: 'pieces', quantity: '3', unit_price: '10', price_basis: 'per_piece', frequency: 'per_month',
        days_per_month: null, period_start: '2026-01-01', period_end: '2026-06-30', working_day_profile_id: null,
      },
    ]);

    // Line 1 loses its quantity: the other line is sent alone, line 1 stays here with the reason.
    typeAndLeave(screen.getAllByLabelText('Quantity')[0], '');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][0]).toHaveLength(1);
    expect(onSave.mock.calls[1][0][0]).toMatchObject({ label: 'Licences, yearly' });
    expect(notes()).toHaveTextContent('Line 1: Enter a quantity and a unit price to save this line.');
    expect(rows()).toHaveLength(2);

    // Enter commits like leaving the field.
    const price = screen.getAllByLabelText('Unit price')[1];
    fireEvent.change(price, { target: { value: '12' } });
    fireEvent.keyDown(price, { key: 'Enter' });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(3));
    expect(onSave.mock.calls[2][0][0]).toMatchObject({ unit_price: '12' });
  });

  it('tells the budget tab what is pending: a line changed and not sent, a line not complete; nothing once sent (lot 3G)', async () => {
    const first = storedLine();
    const second = storedLine({ ...PIECES, id: 'l2', sort: 1, label: 'Licences', quantity: '3.000', unit_price: '10.0000' });
    const pendingRef: { current: (() => boolean) | null } = { current: null };
    const { onSave } = renderPanel({ record: roundWith([first, second]), pendingRef });
    expect(pendingRef.current?.()).toBe(false);

    fireEvent.change(screen.getAllByLabelText('Description')[1], { target: { value: 'Licences, yearly' } });
    expect(pendingRef.current?.()).toBe(true);
    fireEvent.blur(screen.getAllByLabelText('Description')[1]);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(pendingRef.current?.()).toBe(false));

    typeAndLeave(screen.getAllByLabelText('Quantity')[0], '');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(pendingRef.current?.()).toBe(true);
  });

  it('a line priced per day waits for a calendar', async () => {
    calendarsState.list = [];
    const { onSave } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    // No calendar: the line starts per month; priced per day by hand, it needs one.
    await pick(combo(0, 'Price per'), 'per day');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Full time' }));
    typeAndLeave(screen.getByLabelText('Unit price'), '400');
    expect(notes()).toHaveTextContent('Choose a calendar for a price per day.');
    expect(notes()).toHaveTextContent('No working-day calendar yet.');
    expect(screen.getByRole('link', { name: 'Add a calendar' })).toHaveAttribute('href', '/master-data/working-day-calendars');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('removing a line sends the others; removing the last one sends none', async () => {
    const first = storedLine();
    const second = storedLine({ id: 'l2', sort: 1, label: 'Second' });
    const { onSave } = renderPanel({ record: roundWith([first, second]) });

    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Remove the line' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual([expect.objectContaining({ label: 'Second' })]);

    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Remove the line' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][0]).toEqual([]);
    expect(screen.queryAllByTestId('line-row')).toHaveLength(0);
  });

  it('shows each line amount and, under the table, the FTE over the period and the full-year average, no total', () => {
    const analyst = storedLine({ id: 'l2', sort: 1, label: 'Analyst', unit_price: '8000.0000', price_basis: 'per_month', days_per_month: null, working_day_profile_id: null, working_day_profile_code: null, working_day_profile_name: null });
    const first = storedLine();
    renderPanel({ record: roundWith([first, analyst], {}, [explained(first), explained(analyst, { total: '48000.00' })]) });
    expect(screen.getAllByTestId('line-amount').map((cell) => cell.textContent)).toEqual(['27 000', '48 000']);
    expect(screen.getByTestId('lines-fte')).toHaveTextContent(/^FTE over the period 0\.24 · Full-year average 0\.12$/);
    // The column shows the total, and its amounts say they come from the lines.
    expect(screen.queryByTestId('lines-status')).not.toBeInTheDocument();
    expect(notes()).not.toHaveTextContent('Amounts are computed');
    expect(notes()).not.toHaveTextContent('75 000');
  });

  it('shows no FTE line when every line counts pieces', () => {
    const laptop = storedLine({ ...PIECES, frequency: 'once', period_start: '2026-03-15', period_end: '2026-03-15' });
    renderPanel({ record: roundWith([laptop], { fte: '0.00' }) });
    expect(screen.getByTestId('line-amount')).toHaveTextContent('27 000');
    expect(screen.queryByTestId('lines-fte')).not.toBeInTheDocument();
  });

  it('a changed line shows no amount until it is saved again', () => {
    renderPanel({ record: roundWith([storedLine()]) });
    fireEvent.change(screen.getByLabelText('Unit price'), { target: { value: '950' } });
    expect(screen.getByTestId('line-amount')).toHaveTextContent(/^$/);
  });

  it('says where the amounts come from, and offers to use the lines again', async () => {
    const line = storedLine();
    const cases: Array<[Partial<RoundInput>, string]> = [
      [{ method: 'manual', last_calculation: null }, 'Amounts were entered by hand.'],
      [{ method: 'spread', last_calculation: { kind: 'annual', total: '1.00', profile: 'flat', active_months: [1], weights: [] } }, 'Amounts come from a spread.'],
      [{
        method: 'copied',
        last_calculation: { kind: 'copy', source_year: 2025, source_measure: 'planned', uplift_pct: '2', source_total: '1.00', total: '1.02', source_method: 'computed' },
      }, 'Amounts were copied from Budget 2025.'],
    ];
    for (const [over, text] of cases) {
      const { onSave, unmount } = renderPanel({ record: roundWith([line], over) });
      expect(screen.getByTestId('lines-status')).toHaveTextContent(`${text} Use the lines again.`);
      // The lines have no explanation of their own here: no amount per line, no FTE line.
      expect(screen.getByTestId('line-amount')).toHaveTextContent(/^$/);
      expect(screen.queryByTestId('lines-fte')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Use the lines again.' }));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave.mock.calls[0][0]).toEqual([expect.objectContaining({ label: 'Project manager', quantity: '1', days_per_month: '5' })]);
      unmount();
    }
  });

  it('lines kept as a reference are read-only, without amounts or FTE; Use the lines again stays active', async () => {
    const line = storedLine();
    const computed = roundWith([line]).last_calculation;
    const cases: Array<[Partial<RoundInput>, string]> = [
      // A hand edit keeps the explanation of the last computation: its amounts no longer hold.
      [{ method: 'manual', last_calculation: computed }, 'Amounts were entered by hand.'],
      [{ method: 'spread', last_calculation: { kind: 'annual', total: '1.00', profile: 'flat', active_months: [1], weights: [] } }, 'Amounts come from a spread.'],
      [{
        method: 'copied',
        last_calculation: { kind: 'copy', source_year: 2025, source_measure: 'planned', uplift_pct: '0', source_total: '1.00', total: '1.00', source_method: 'computed' },
      }, 'Amounts were copied from Budget 2025.'],
    ];
    for (const [over, text] of cases) {
      const { onSave, unmount } = renderPanel({
        record: roundWith([line], over),
        applyToAll: { offered: true, on: false, hint: 'hint', onChange: vi.fn() },
      });
      // Read-only: no field, no remove, no Add a line, no Apply these lines to all columns.
      expect(screen.getByLabelText('Description')).toBeDisabled();
      expect(screen.getByLabelText('Unit price')).toBeDisabled();
      expect(screen.getByLabelText('days per month')).toBeDisabled();
      expect(screen.getByRole('checkbox', { name: 'Full time' })).toBeDisabled();
      for (const date of dates(0)) expect(date).toBeDisabled();
      expect(combo(0, 'Unit')).toHaveAttribute('aria-disabled', 'true');
      expect(screen.queryByRole('button', { name: 'Remove the line' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add a line' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Apply these lines to all columns')).not.toBeInTheDocument();
      // The Amount column keeps its place, blank; no FTE line.
      expect(heads()).toEqual(['', 'Description', 'Quantity', 'Unit', 'Unit price', 'How often', 'From', 'To', 'Calendar', '', '', '']);
      expect(screen.getByTestId('line-amount')).toHaveTextContent(/^$/);
      expect(screen.queryByTestId('lines-fte')).not.toBeInTheDocument();
      // A field left without a change sends nothing.
      fireEvent.blur(screen.getByLabelText('Unit price'));
      expect(onSave).not.toHaveBeenCalled();

      expect(screen.getByTestId('lines-status')).toHaveTextContent(`${text} Use the lines again.`);
      fireEvent.click(screen.getByRole('button', { name: 'Use the lines again.' }));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave.mock.calls[0][0]).toEqual([expect.objectContaining({ label: 'Project manager', unit_price: '900' })]);
      unmount();
    }
  });

  it('once computed from its lines again, the table is editable and shows the amounts', async () => {
    const line = storedLine();
    const { rerender } = renderPanel({
      record: roundWith([line], { method: 'spread', last_calculation: { kind: 'annual', total: '1.00', profile: 'flat', active_months: [1], weights: [] } }),
      applyToAll: { offered: true, on: false, hint: 'hint', onChange: vi.fn() },
    });
    expect(screen.getByLabelText('Unit price')).toBeDisabled();

    rerender({ record: roundWith([line]) });
    await waitFor(() => expect(screen.getByLabelText('Unit price')).not.toBeDisabled());
    expect(heads()).toContain('Amount');
    expect(screen.getByTestId('line-amount')).toHaveTextContent('27 000');
    expect(screen.getByTestId('lines-fte')).toBeInTheDocument();
    expect(screen.queryByTestId('lines-status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove the line' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a line' })).toBeInTheDocument();
    expect(screen.getByLabelText('Apply these lines to all columns')).toBeInTheDocument();
  });

  it('lines typed and not saved yet on a column without stored lines are editable', () => {
    // A spread column with no stored line: nothing is kept as a reference.
    renderPanel({ record: roundWith([], { method: 'spread', last_calculation: null }) });
    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    expect(screen.getByLabelText('Unit price')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove the line' })).toBeInTheDocument();
    expect(heads()).toContain('Amount');
  });

  it('names the working days that changed since the last computation', async () => {
    const now = [...DAYS_2026]; now[2] = '21';
    yearDays.byId = { fr: now };
    const { onSave } = renderPanel({ record: roundWith([storedLine()]) });

    await waitFor(() => expect(screen.getByTestId('lines-days-changed')).toHaveTextContent(
      'Working days changed since the last computation: March: 22 days, now 21. Use the lines again.',
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Use the lines again.' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it('says nothing when the working days are unchanged', async () => {
    yearDays.byId = { fr: DAYS_2026 };
    renderPanel({ record: roundWith([storedLine()]) });
    await settle();
    expect(screen.queryByTestId('lines-days-changed')).not.toBeInTheDocument();
  });

  it('keeps a disabled calendar a stored line uses, and says so', () => {
    calendarsState.list = [{ ...FRANCE, status: 'disabled', disabled_at: '2026-06-01T00:00:00Z' }, US];
    renderPanel({ record: roundWith([storedLine()]) });
    expect(combo(0, 'Calendar')).toHaveTextContent('France (disabled)');
    expect(notes()).toHaveTextContent('France is disabled. The lines still use it.');
  });

  it('turning Apply these lines to all columns on writes the lines at once', async () => {
    const onChange = vi.fn();
    const { onSave } = renderPanel({
      record: roundWith([storedLine()]),
      applyToAll: { offered: true, on: false, hint: 'hint', onChange },
    });
    fireEvent.click(screen.getByLabelText('Apply these lines to all columns'));
    expect(onChange).toHaveBeenCalledWith(true);
    // The same lines as stored: sent anyway, to the group's columns too.
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][1]).toBe(true);
    expect(onSave.mock.calls[0][0]).toHaveLength(1);
  });

  it('turning Apply these lines to all columns on without a complete line writes nothing', async () => {
    const onChange = vi.fn();
    const { onSave } = renderPanel({ applyToAll: { offered: true, on: false, hint: 'hint', onChange } });
    // No line at all: sending none would clear the lines of the group's other columns.
    fireEvent.click(screen.getByLabelText('Apply these lines to all columns'));
    expect(onChange).toHaveBeenCalledWith(true);
    // A line without its unit price is not complete either.
    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    fireEvent.click(screen.getByLabelText('Apply these lines to all columns'));
    expect(onChange).toHaveBeenCalledTimes(2);
    await settle();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('turning Apply these lines to all columns off writes nothing', async () => {
    const onChange = vi.fn();
    const { onSave } = renderPanel({
      record: roundWith([storedLine()]),
      applyToAll: { offered: true, on: true, hint: 'hint', onChange },
    });
    fireEvent.click(screen.getByLabelText('Apply these lines to all columns'));
    expect(onChange).toHaveBeenCalledWith(false);
    await settle();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('a refusal shows under the table and keeps what was typed; the next commit sends again', async () => {
    const refusal = 'Line 1: days per month must be between 0 and 31.';
    const onSave = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: refusal })
      .mockResolvedValue({ ok: true });
    renderPanel({ record: roundWith([storedLine()]), onSave });

    typeAndLeave(screen.getByLabelText('days per month'), '40');
    expect(await screen.findByText(refusal)).toBeInTheDocument();
    expect(screen.getByLabelText('days per month')).toHaveValue('40');

    fireEvent.blur(screen.getByLabelText('days per month'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(refusal)).not.toBeInTheDocument());
  });

  it('a refusal names the line by its row in the table, incomplete rows included', async () => {
    const first = storedLine();
    const second = storedLine({ id: 'l2', sort: 1, label: 'Second', working_day_profile_id: 'us', working_day_profile_code: 'US', working_day_profile_name: 'United States' });
    const onSave = vi.fn().mockResolvedValue({ ok: false, error: 'Line 1: United States has no working days for 2026.' });
    renderPanel({ record: roundWith([first, second]), onSave });

    // Row 1 loses its quantity: row 2 is sent alone, and the server calls it line 1.
    typeAndLeave(screen.getAllByLabelText('Quantity')[0], '');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual([expect.objectContaining({ label: 'Second' })]);
    expect(await screen.findByText('Line 2: United States has no working days for 2026.')).toBeInTheDocument();
    expect(screen.queryByText('Line 1: United States has no working days for 2026.')).not.toBeInTheDocument();
  });

  it('maps the server line number to the table row', () => {
    expect(tableLineMessage('Line 1: the calendar was not found.', [1, 3])).toBe('Line 2: the calendar was not found.');
    expect(tableLineMessage('Line 2: the calendar was not found.', [1, 3])).toBe('Line 4: the calendar was not found.');
    expect(tableLineMessage('Line 3: out of range.', [0])).toBe('Line 3: out of range.');
    expect(tableLineMessage('The lines could not be saved.', [1])).toBe('The lines could not be saved.');
  });

  it('keeps the disabled calendar note in the UI language after a save the server warns about', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    calendarsState.list = [{ ...FRANCE, status: 'disabled', disabled_at: '2026-06-01T00:00:00Z' }, US];
    const serverWarning = 'This calendar is disabled. The computation still uses it.';
    const onSave = vi.fn().mockResolvedValue({ ok: true, warnings: [serverWarning] });
    renderPanel({ record: roundWith([storedLine()]), onSave });

    typeAndLeave(screen.getByLabelText('Unit price'), '950');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['working-day-profiles', 'list'] }));
    expect(notes()).toHaveTextContent('France is disabled. The lines still use it.');
    expect(notes()).not.toHaveTextContent(serverWarning);
    invalidate.mockRestore();
  });

  it('a frozen column is read-only and never sent', async () => {
    const { onSave } = renderPanel({ record: roundWith([storedLine()]), frozen: true });
    expect(screen.getByLabelText('Unit price')).toBeDisabled();
    expect(screen.getByLabelText('days per month')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Full time' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add a line' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove the line' })).not.toBeInTheDocument();
    expect(notes()).toHaveTextContent('frozen');
    fireEvent.blur(screen.getByLabelText('Unit price'));
    expect(onSave).not.toHaveBeenCalled();
  });

  describe('one block per line, when the panel is narrower than the whole table', () => {
    it('puts the calculation on the first row, the sentence of when and how on the second, under a single header row', () => {
      const second = storedLine({ id: 'l2', sort: 1, label: 'Second' });
      renderPanel({ record: roundWith([storedLine(), second]), layout: 'narrow' });

      expect(LINES_TWO_ROWS_MIN_WIDTH).toBe(931);
      expect(screen.getByTestId('lines-table')).toHaveStyle({ tableLayout: 'fixed', minWidth: '931px' });
      // One header row only: the words of the second row ("from", "to", "calendar") replace the old one.
      expect(heads()).toEqual(['', 'Description', 'Quantity', 'Unit', '', 'Unit price', '', 'Amount', '']);
      expect(screen.queryByTestId('lines-head-timing')).not.toBeInTheDocument();
      const ths = pricedHeads();
      expect(ths[0]).toHaveStyle({ width: `${LINE_COLUMN_WIDTHS.number}px` });
      expect(ths[1]).toHaveStyle({ width: `${LINE_COLUMN_WIDTHS.description}px` });
      const { quantity, unit, unitPrice, amount, remove } = LINE_COLUMN_WIDTHS;
      [quantity, unit, LINE_MUL_WIDTH, unitPrice].forEach((width, i) => expect(ths[i + 2]).toHaveStyle({ width: `${width}px` }));
      [amount, remove].forEach((width, i) => expect(ths[i + 7]).toHaveStyle({ width: `${width}px` }));
      expect(screen.getByTestId('lines-head-unit-price')).toHaveStyle({ width: `${UNIT_PRICE_NUMBER_WIDTH}px`, textAlign: 'right' });

      // One body per line, two rows each, numbered like the notes under the table.
      expect(rows()).toHaveLength(2);
      rows().forEach((line) => expect(within(line).getAllByRole('row')).toHaveLength(2));
      expect(numbers()).toEqual(['1', '2']);

      const first = priced(0);
      expect(first.getByLabelText('Description')).toHaveValue('Project manager');
      expect(first.getByLabelText('Quantity')).toHaveValue('1');
      expect(first.getByRole('combobox', { name: 'Unit' })).toHaveTextContent('people');
      expect(first.getByLabelText('Unit price')).toBeInTheDocument();
      expect(first.getByRole('combobox', { name: 'Price per' })).toHaveTextContent('per day');
      expect(first.getByTestId('line-amount')).toHaveTextContent('27 000');
      expect(first.getByRole('button', { name: 'Remove the line' })).toBeInTheDocument();
      expect(first.queryByRole('checkbox', { name: 'Full time' })).not.toBeInTheDocument();
      expect(first.queryAllByPlaceholderText('labels.datePlaceholder')).toHaveLength(0);
      expect(first.queryByRole('combobox', { name: 'Calendar' })).not.toBeInTheDocument();

      // The sentence: how often under the description, then a word before each field.
      const then = timing(0);
      expect(then.getByRole('checkbox', { name: 'Full time' })).not.toBeChecked();
      expect(then.getByLabelText('days per month')).toHaveValue('5');
      expect(then.getAllByPlaceholderText('labels.datePlaceholder')).toHaveLength(2);
      expect(then.getByRole('combobox', { name: 'Calendar' })).toHaveTextContent('France');
      expect(then.queryByLabelText('Unit price')).not.toBeInTheDocument();
      expect(then.queryByTestId('line-amount')).not.toBeInTheDocument();
      expect(then.getByTestId('line-from-word')).toHaveTextContent('from');
      expect(then.getByTestId('line-to-word')).toHaveTextContent('to');
      expect(then.getByTestId('line-calendar-word')).toHaveTextContent('calendar');
      // The same tracks for every line: how often starts under the description, and the dates and the
      // calendars line up from one line to the next.
      expect(secondRowGrid(0)).toHaveStyle({
        display: 'grid',
        columnGap: `${LINE_COLUMN_GAP}px`,
        gridTemplateColumns: LINE_SECOND_ROW_WIDTHS.map((w) => `${w}px`).join(' '),
      });
      // No padding of its own: the tracks of a line's second row start where those of the first do.
      expect(within(rows()[0]).getByTestId('line-timing').firstElementChild).toHaveStyle({ paddingLeft: 0 });

      typeAndLeave(priced(1).getByLabelText('Quantity'), '');
      expect(notes()).toHaveTextContent('Line 2: Enter a quantity and a unit price to save this line.');
    });

    it('with room for it, how often goes up to the first row and the second keeps the dates and the calendar', () => {
      renderPanel({ record: roundWith([storedLine()]), layout: 'medium' });

      expect(LINES_OFTEN_FIRST_MIN_WIDTH).toBe(1046);
      expect(screen.getByTestId('lines-table')).toHaveStyle({ minWidth: '1046px' });
      expect(heads()).toEqual(['', 'Description', 'Quantity', 'Unit', '', 'Unit price', 'How often', '', 'Amount', '']);
      expect(pricedHeads()[6]).toHaveStyle({ width: `${LINE_COLUMN_WIDTHS.often}px` });

      expect(priced(0).getByRole('checkbox', { name: 'Full time' })).not.toBeChecked();
      expect(priced(0).getByLabelText('days per month')).toHaveValue('5');
      expect(timing(0).queryByRole('checkbox', { name: 'Full time' })).not.toBeInTheDocument();
      // The second row starts with "from" under the description.
      expect(timing(0).getAllByPlaceholderText('labels.datePlaceholder')).toHaveLength(2);
      expect(timing(0).getByRole('combobox', { name: 'Calendar' })).toHaveTextContent('France');
      expect(secondRowGrid(0)).toHaveStyle({ gridTemplateColumns: LINE_TIMING_ROW_WIDTHS.map((w) => `${w}px`).join(' ') });
    });

    it('a commit from the second row saves what the one-row table saves', async () => {
      const run = async (layout: 'wide' | 'medium' | 'narrow') => {
        const { onSave, unmount } = renderPanel({ record: roundWith([storedLine()]), layout });
        expect(screen.queryAllByTestId('line-timing')).toHaveLength(layout === 'wide' ? 0 : 1);
        fireEvent.click(screen.getByRole('checkbox', { name: 'Full time' }));
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        typeDate(dates(0)[1], '31/05/2026');
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
        await pick(combo(0, 'Calendar'), 'United States');
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(3));
        const calls = onSave.mock.calls;
        unmount();
        return calls;
      };
      const wide = await run('wide');
      const narrow = await run('narrow');
      expect(narrow).toEqual(wide);
      expect(await run('medium')).toEqual(wide);
      expect(narrow[0][0][0]).toMatchObject({ days_per_month: null, period_end: '2026-06-30', working_day_profile_id: 'fr' });
      expect(narrow[1][0][0]).toMatchObject({ days_per_month: null, period_end: '2026-05-31', working_day_profile_id: 'fr' });
      expect(narrow[2][0][0]).toMatchObject({ days_per_month: null, period_end: '2026-05-31', working_day_profile_id: 'us' });
    });

    it('the Date of a piece bought once sits on the second row, "on" in the From track, To left empty', async () => {
      const laptop = storedLine({ ...PIECES, label: 'Laptop', unit_price: '2000.0000', frequency: 'once', period_start: '2026-03-15', period_end: '2026-03-15' });
      const { onSave } = renderPanel({ record: roundWith([laptop]), layout: 'narrow' });
      expect(priced(0).queryAllByPlaceholderText('labels.datePlaceholder')).toHaveLength(0);
      expect(priced(0).getByTestId('line-basis')).toHaveTextContent('per piece');
      expect(timing(0).getByRole('combobox', { name: 'How often' })).toHaveTextContent('once');
      expect(timing(0).getByTestId('line-from-word')).toHaveTextContent('on');
      expect(timing(0).getByTestId('line-to-word')).toHaveTextContent('');
      // No calendar word either: a price per piece takes no calendar.
      expect(timing(0).getByTestId('line-calendar-word')).toHaveTextContent('');
      expect(timing(0).queryByRole('combobox', { name: 'Calendar' })).not.toBeInTheDocument();
      const [date, ...rest] = timing(0).getAllByPlaceholderText('labels.datePlaceholder');
      expect(rest).toHaveLength(0);

      typeDate(date, '20/05/2026');
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave.mock.calls[0][0][0]).toMatchObject({ frequency: 'once', period_start: '2026-05-20', period_end: '2026-05-20' });
    });

    it('a line with From and To but no calendar keeps "from" and "to", and no "calendar" word', () => {
      // People priced per month: two dates, no calendar.
      const monthly = storedLine({ price_basis: 'per_month', days_per_month: null, working_day_profile_id: null, working_day_profile_code: null, working_day_profile_name: null });
      renderPanel({ record: roundWith([monthly]), layout: 'narrow' });
      expect(timing(0).getAllByPlaceholderText('labels.datePlaceholder')).toHaveLength(2);
      expect(timing(0).getByTestId('line-from-word')).toHaveTextContent('from');
      expect(timing(0).getByTestId('line-to-word')).toHaveTextContent('to');
      expect(timing(0).getByTestId('line-calendar-word')).toHaveTextContent('');
    });

    it('follows the width of the panel: two rows below the whole table, how often first when it fits, one row once the table fits', () => {
      let width = LINES_OFTEN_FIRST_MIN_WIDTH - 1;
      const resized: Array<() => void> = [];
      vi.stubGlobal('ResizeObserver', class {
        constructor(callback: () => void) { resized.push(callback); }
        observe() {}
        unobserve() {}
        disconnect() {}
      });
      // One measure per frame; the frame comes at once here.
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
      vi.stubGlobal('cancelAnimationFrame', () => undefined);
      const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
      try {
        renderPanel({ record: roundWith([storedLine()]) });
        expect(timing(0).getByRole('checkbox', { name: 'Full time' })).toBeInTheDocument();

        width = LINES_OFTEN_FIRST_MIN_WIDTH;
        act(() => resized.forEach((callback) => callback()));
        expect(priced(0).getByRole('checkbox', { name: 'Full time' })).toBeInTheDocument();
        expect(timing(0).queryByRole('checkbox', { name: 'Full time' })).not.toBeInTheDocument();

        width = LINES_TABLE_MIN_WIDTH;
        act(() => resized.forEach((callback) => callback()));
        expect(screen.queryByTestId('line-timing')).not.toBeInTheDocument();
        expect(heads()).toEqual(['', 'Description', 'Quantity', 'Unit', 'Unit price', 'How often', 'From', 'To', 'Calendar', '', 'Amount', '']);

        width = LINES_TABLE_MIN_WIDTH - 1;
        act(() => resized.forEach((callback) => callback()));
        expect(screen.getByTestId('line-timing')).toBeInTheDocument();
      } finally {
        clientWidth.mockRestore();
        vi.unstubAllGlobals();
      }
    });

    it('the first line of a narrow panel is drawn on two rows at once, its Description focused', () => {
      vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
      });
      const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => 1300);
      try {
        renderPanel();
        fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
        expect(screen.getByTestId('line-timing')).toBeInTheDocument();
        // Measured before the line was added: the table was not swapped under the focus.
        expect(document.activeElement).toBe(priced(0).getByLabelText('Description'));
      } finally {
        clientWidth.mockRestore();
        vi.unstubAllGlobals();
      }
    });
  });
});

describe('LinesPanel and the stored lines (lot 3D, scenario 4)', () => {
  beforeEach(() => {
    calendarsState.list = [calendar('fr', 'France', 'FR')];
  });
  const description = () => screen.getByLabelText('Description') as HTMLInputElement;
  const theirs = () => roundWith([storedLine({ id: 'l9', label: 'Their manager', unit_price: '950.0000' })]);

  it('the drafts become the stored lines when nothing is pending, and the next save starts from them', async () => {
    const { rerender, onSave } = renderPanel({ record: roundWith([storedLine()]) });
    expect(description()).toHaveValue('Project manager');

    // Someone else's save, shown by a reload of the budget tab.
    rerender({ record: theirs() });
    await waitFor(() => expect(description()).toHaveValue('Their manager'));

    typeAndLeave(description(), 'Their manager, half time');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [lines, , startedFrom] = onSave.mock.calls[0];
    expect(lines[0]).toMatchObject({ label: 'Their manager, half time' });
    expect(startedFrom).toEqual([expect.objectContaining({ label: 'Their manager', unit_price: '950' })]);
  });

  it('a line being typed is never replaced by the stored lines', async () => {
    const { rerender } = renderPanel({ record: roundWith([storedLine()]) });
    fireEvent.change(description(), { target: { value: 'Typing…' } });
    rerender({ record: theirs() });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(description()).toHaveValue('Typing…');
  });

  it('a save of these lines starts the next one from them', async () => {
    const { onSave } = renderPanel({ record: roundWith([storedLine()]) });
    typeAndLeave(description(), 'Lead');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][2]).toEqual([expect.objectContaining({ label: 'Project manager' })]);
    typeAndLeave(description(), 'Lead, part time');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][2]).toEqual([expect.objectContaining({ label: 'Lead' })]);
  });

  it('commits made while a save is on its way go once it answered, from the lines it stored', async () => {
    let answer: (value: { ok: true }) => void = () => undefined;
    const onSave: LinesPanelProps['onSave'] = vi.fn(() => new Promise<{ ok: true }>((resolve) => { answer = resolve; }));
    renderPanel({ record: roundWith([storedLine()]), onSave });
    const calls = (onSave as ReturnType<typeof vi.fn>).mock.calls;
    typeAndLeave(description(), 'Lead');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // Quick changes while the first save is on its way (a date's arrows clicked fast): none is sent yet.
    typeAndLeave(description(), 'Lead, part time');
    typeAndLeave(description(), 'Lead, half time');
    await settle();
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => { answer({ ok: true }); });
    // One write for the latest drafts, starting from what the first save stored.
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(calls[1][0][0]).toMatchObject({ label: 'Lead, half time' });
    expect(calls[1][2]).toEqual([expect.objectContaining({ label: 'Lead' })]);
    await act(async () => { answer({ ok: true }); });
    await settle();
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('while the column waits for a choice the drafts stay; Reload the column replaces them', async () => {
    const onSave = vi.fn(async () => ({ ok: false as const, conflict: true as const }));
    const { rerender } = renderPanel({ record: roundWith([storedLine()]), onSave });
    typeAndLeave(description(), 'Mine');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // Held for the choice: no message under the table, the user's line stays.
    expect(screen.queryByText(/could not/i)).toBeNull();

    rerender({ record: theirs(), waiting: true });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(description()).toHaveValue('Mine');

    rerender({ record: theirs(), waiting: false, reloadSignal: 1 });
    await waitFor(() => expect(description()).toHaveValue('Their manager'));
  });
});
