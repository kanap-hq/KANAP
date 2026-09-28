import { Decimal, DecimalLimitError, DecimalLimits, divRoundHalfAway, parseLimitedDecimal } from '../common/decimal';
import { CENTS_LIMIT } from '../common/amount';
import { activeMonths, NO_ACTIVE_MONTH_MESSAGE, SpreadInputError } from './spread.util';

/**
 * Quantity × price lines: the months of one budget column computed from its
 * lines, each a quantity in a unit (people, days or units) times a unit price
 * (per day, per month or once) over the line's own period. Pure (no
 * database).
 *
 * The unit decides the rest:
 * - people × per day: calendar days of the month × quantity × unit price,
 *   rounded to cents per month; FTE of the month = the quantity;
 * - people × per month: quantity × unit price per month; FTE = the quantity;
 * - days × per day: quantity × unit price rounded to cents once, split
 *   equally over the active months (remainder on the last); the days split
 *   the same way (6 decimals), and the FTE of a month is its days ÷ the
 *   calendar's working days of that month;
 * - units × per month: quantity × unit price per month; FTE 0;
 * - units × once: quantity × unit price rounded once, split equally; FTE 0.
 *
 * Everything is exact (`common/decimal.ts`) and rounded half away from zero
 * where said. A month counts for a line when the line's period covers its
 * 15th (`activeMonths`); its other months are zero.
 */

export type QuantityUnit = 'people' | 'days' | 'units';
export type PriceBasis = 'per_day' | 'per_month' | 'once';
export const QUANTITY_UNITS: readonly QuantityUnit[] = ['people', 'days', 'units'];
export const PRICE_BASES: readonly PriceBasis[] = ['per_day', 'per_month', 'once'];
/** The price bases each unit takes (the lines tables' basis CHECK). */
export const BASES_BY_UNIT: Readonly<Record<QuantityUnit, readonly PriceBasis[]>> = {
  people: ['per_day', 'per_month'],
  days: ['per_day'],
  units: ['per_month', 'once'],
};

export const MAX_LINES = 50;
export const LABEL_MAX_LENGTH = 200;

/** A line as validated; decimals are exact strings without trailing zeros. */
export type CostLine = {
  label: string;
  quantity_unit: QuantityUnit;
  quantity: string;
  unit_price: string;
  price_basis: PriceBasis;
  period_start: string;
  period_end: string;
  working_day_profile_id: string | null;
};

/** What one line computes to; arrays hold the twelve months. */
export type LineResult = {
  active_months: number[];
  /** The calendar's working days of the year (price per day only). */
  day_counts: string[] | null;
  /** The calendar's working days over the line's active months (price per day only). */
  total_days: string | null;
  month_cents: bigint[];
  total_cents: bigint;
  /** FTE of each month, at most 6 decimals. */
  fte_months: string[];
};

/** A column: the sum of its lines. */
export type ColumnResult = {
  lines: LineResult[];
  /** Months (1..12) at least one line covers. */
  active_months: number[];
  month_cents: bigint[];
  total_cents: bigint;
  fte_months: string[];
  /** The twelve FTE months summed, ÷ 12, 2 decimals. */
  fte: string;
};

/** The calendar of a per-day line: its name (for messages) and its twelve days of the year, null when it has none. */
export type LineCalendar = { name: string; days: string[] | null };

/** An input the user must correct: the services answer 400 with this sentence. */
export class CostingInputError extends Error {}

// From the line columns: quantity numeric(12,3), unit_price numeric(18,4). A
// line's refusals read "Line 2: quantity accepts at most 3 decimals.".
export const QUANTITY_LIMITS: DecimalLimits = {
  label: 'quantity', decimals: 3, min: '0', minMessage: 'quantity cannot be negative.', maxAbs: '1000000000',
};
export const UNIT_PRICE_LIMITS: DecimalLimits = { label: 'unit price', decimals: 4, maxAbs: '100000000000000' };
// The round's fte column is numeric(9,2).
const FTE_LIMIT = '10000000';

export const COMPUTED_TOO_LARGE_MESSAGE = 'The computed amount is too large.';
export const FTE_TOO_LARGE_MESSAGE = 'The lines add up to too many FTE.';

const BASIS_FOR_UNIT: Record<QuantityUnit, string> = {
  people: 'a price for people is per day or per month.',
  days: 'a price for days is per day.',
  units: 'a price for units is per month or once.',
};

/** "France 218 has no working days for 2027. Add them on the Working-day calendars page." */
export function missingCalendarYearMessage(calendarName: string, year: number): string {
  return `${calendarName} has no working days for ${year}. Add them on the Working-day calendars page.`;
}

function lineError(n: number, text: string): CostingInputError {
  return new CostingInputError(`Line ${n}: ${text}`);
}

/** A sentence that starts with a common word, continued after "Line N: ". */
const continued = (sentence: string) => sentence.charAt(0).toLowerCase() + sentence.slice(1);

const isBlank = (value: unknown) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

function limited(value: unknown, limits: DecimalLimits, n: number): string {
  try {
    return parseLimitedDecimal(value, limits).toString();
  } catch (err) {
    if (err instanceof DecimalLimitError) throw lineError(n, err.message);
    throw err;
  }
}

function choice<T extends string>(value: unknown, allowed: readonly T[], n: number, what: string, spoken: string): T {
  if (isBlank(value)) throw lineError(n, `choose a ${what}: ${spoken}.`);
  const text = typeof value === 'string' ? value.trim().toLowerCase() : value;
  if (!(allowed as readonly unknown[]).includes(text)) {
    throw lineError(n, `unknown ${what} '${String(value)}'. Use ${allowed.slice(0, -1).join(', ')} or ${allowed[allowed.length - 1]}.`);
  }
  return text as T;
}

function linePeriod(year: number, start: string, end: string, n: number): number[] {
  let months: number[];
  try {
    months = activeMonths(year, start, end);
  } catch (err) {
    if (err instanceof SpreadInputError) throw lineError(n, continued(err.message));
    throw err;
  }
  if (months.length === 0) throw lineError(n, continued(NO_ACTIVE_MONTH_MESSAGE));
  return months;
}

/**
 * One line of a request, checked and normalised; `n` (from 1) names it in
 * the refusals. The description is trimmed and may be blank. The calendar id
 * is only checked for presence: the caller resolves it under the tenant.
 */
export function parseCostLine(raw: unknown, year: number, n: number): CostLine {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw lineError(n, 'send the line as an object.');
  const line = raw as Record<string, unknown>;

  const labelRaw = line.label ?? '';
  if (typeof labelRaw !== 'string') throw lineError(n, 'the description must be text.');
  const label = labelRaw.trim();
  // Counted in characters, as char_length counts them.
  if (Array.from(label).length > LABEL_MAX_LENGTH) {
    throw lineError(n, `the description is longer than ${LABEL_MAX_LENGTH} characters.`);
  }

  const quantity_unit = choice(line.quantity_unit, QUANTITY_UNITS, n, 'unit', 'people, days or units');
  const quantity = limited(line.quantity, QUANTITY_LIMITS, n);
  const unit_price = limited(line.unit_price, UNIT_PRICE_LIMITS, n);
  const price_basis = choice(line.price_basis, PRICE_BASES, n, 'price basis', 'per day, per month or once');
  if (!BASES_BY_UNIT[quantity_unit].includes(price_basis)) throw lineError(n, BASIS_FOR_UNIT[quantity_unit]);

  if (isBlank(line.period_start) || isBlank(line.period_end)) throw lineError(n, 'give the start and the end of its period.');
  const period_start = String(line.period_start).trim();
  const period_end = String(line.period_end).trim();
  linePeriod(year, period_start, period_end, n);

  const calendarRaw = line.working_day_profile_id;
  if (!isBlank(calendarRaw) && typeof calendarRaw !== 'string') throw lineError(n, 'the calendar was not found.');
  const working_day_profile_id = isBlank(calendarRaw) ? null : (calendarRaw as string).trim();
  if (price_basis === 'per_day' && !working_day_profile_id) throw lineError(n, 'choose a calendar for a price per day.');
  if (price_basis !== 'per_day' && working_day_profile_id) throw lineError(n, 'a calendar is used only with a price per day.');

  return { label, quantity_unit, quantity, unit_price, price_basis, period_start, period_end, working_day_profile_id };
}

/** The lines of a request: a list of at most 50, each checked (see `parseCostLine`). */
export function parseCostLines(raw: unknown, year: number): CostLine[] {
  if (!Array.isArray(raw)) throw new CostingInputError('Send the lines as a list.');
  if (raw.length > MAX_LINES) throw new CostingInputError(`A column holds at most ${MAX_LINES} lines.`);
  return raw.map((entry, index) => parseCostLine(entry, year, index + 1));
}

/** Whether two lists of lines ask for the same computation, in the same order; decimals compared by value. */
export function sameLines(a: readonly CostLine[], b: readonly CostLine[]): boolean {
  return a.length === b.length && a.every((line, i) => {
    const other = b[i];
    return line.label === other.label
      && line.quantity_unit === other.quantity_unit
      && Decimal.from(line.quantity).cmp(other.quantity) === 0
      && Decimal.from(line.unit_price).cmp(other.unit_price) === 0
      && line.price_basis === other.price_basis
      && line.period_start === other.period_start
      && line.period_end === other.period_end
      && (line.working_day_profile_id ?? null) === (other.working_day_profile_id ?? null);
  });
}

/** `a ÷ b` (b > 0), rounded once, half away from zero, to `decimals` places. */
function divide(a: Decimal, b: Decimal, decimals: number): Decimal {
  return Decimal.from(`${divRoundHalfAway(a.units * 10n ** BigInt(decimals), b.units)}e-${decimals}`);
}

const zeros = <T>(value: T): T[] => Array.from({ length: 12 }, () => value);

/** `total` split equally over `months`, the rounding remainder on the last. */
function splitCents(total: bigint, months: number[]): bigint[] {
  const cents = zeros(0n);
  const share = divRoundHalfAway(total, BigInt(months.length));
  for (const m of months) cents[m - 1] = share;
  cents[months[months.length - 1] - 1] += total - share * BigInt(months.length);
  return cents;
}

/**
 * One line's twelve months (see the file header). `calendar` is the line's
 * calendar with its days for `year` (per day only); `n` names the line in
 * the refusals.
 */
export function computeLine(line: CostLine, year: number, calendar: LineCalendar | null, n = 1): LineResult {
  const months = linePeriod(year, line.period_start, line.period_end, n);
  const quantity = Decimal.from(line.quantity);
  // Exact: quantity (3 decimals) × unit price (4) has 7 decimals.
  const perUnit = quantity.mul(line.unit_price);
  const inLimit = (cents: bigint) => {
    if ((cents < 0n ? -cents : cents) >= CENTS_LIMIT) throw lineError(n, 'the computed amount is too large.');
    return cents;
  };

  let days: Decimal[] | null = null;
  if (line.price_basis === 'per_day') {
    if (!calendar) throw lineError(n, 'choose a calendar for a price per day.');
    if (!calendar.days) throw lineError(n, missingCalendarYearMessage(calendar.name, year));
    if (calendar.days.length !== 12) throw new Error(`Calendar ${calendar.name} has ${calendar.days.length} months for ${year}.`);
    days = calendar.days.map((d) => Decimal.from(d));
  }

  let month_cents = zeros(0n);
  const fte = zeros(Decimal.ZERO);
  if (line.quantity_unit === 'days') {
    // The days bought are spread like their price: equal shares, the remainder on the last month.
    month_cents = splitCents(inLimit(perUnit.toCents()), months);
    const share = quantity.divRound(months.length, 6);
    const last = months[months.length - 1];
    for (const m of months) {
      const bought = m === last ? quantity.sub(share.mul(months.length - 1)) : share;
      fte[m - 1] = days![m - 1].cmp(0) > 0 ? divide(bought, days![m - 1], 6) : Decimal.ZERO;
    }
  } else if (line.price_basis === 'once') {
    month_cents = splitCents(inLimit(perUnit.toCents()), months);
  } else {
    for (const m of months) {
      // Per day: 6-decimal days × 7 decimals = 13, still exact.
      month_cents[m - 1] = line.price_basis === 'per_day' ? days![m - 1].mul(perUnit).toCents() : perUnit.toCents();
      if (line.quantity_unit === 'people') fte[m - 1] = quantity;
    }
  }
  month_cents.forEach(inLimit);
  const total_cents = inLimit(month_cents.reduce((acc, c) => acc + c, 0n));

  return {
    active_months: months,
    day_counts: days ? days.map((d) => d.toString()) : null,
    total_days: days ? months.reduce((acc, m) => acc.add(days![m - 1]), Decimal.ZERO).toString() : null,
    month_cents,
    total_cents,
    fte_months: fte.map((d) => d.toString()),
  };
}

/**
 * A column from its lines: each line computed (its calendar looked up in
 * `calendars` by id), then the twelve months, the total and the FTE summed.
 * The yearly FTE is the twelve months' FTE summed, ÷ 12, rounded once to 2
 * decimals. Each month and the total must fit the amount columns, and the
 * FTE the round's column.
 */
export function computeColumn(lines: readonly CostLine[], year: number, calendars: ReadonlyMap<string, LineCalendar>): ColumnResult {
  const results = lines.map((line, index) => computeLine(
    line,
    year,
    line.working_day_profile_id ? calendars.get(line.working_day_profile_id) ?? null : null,
    index + 1,
  ));
  const month_cents = zeros(0n);
  const fte = zeros(Decimal.ZERO);
  const active = new Set<number>();
  for (const result of results) {
    result.month_cents.forEach((cents, i) => { month_cents[i] += cents; });
    result.fte_months.forEach((value, i) => { fte[i] = fte[i].add(value); });
    result.active_months.forEach((m) => active.add(m));
  }
  const total_cents = month_cents.reduce((acc, c) => acc + c, 0n);
  for (const cents of [...month_cents, total_cents]) {
    if ((cents < 0n ? -cents : cents) >= CENTS_LIMIT) throw new CostingInputError(COMPUTED_TOO_LARGE_MESSAGE);
  }
  const yearly = fte.reduce((acc, d) => acc.add(d), Decimal.ZERO).divRound(12, 2);
  if (yearly.cmp(FTE_LIMIT) >= 0) throw new CostingInputError(FTE_TOO_LARGE_MESSAGE);
  return {
    lines: results,
    active_months: [...active].sort((a, b) => a - b),
    month_cents,
    total_cents,
    fte_months: fte.map((d) => d.toString()),
    fte: yearly.toString(),
  };
}
