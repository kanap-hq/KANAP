import { Decimal, DECIMAL_SCALE_DIGITS, DecimalLimitError, DecimalLimits, divRoundHalfAway, parseDecimalLiteral, parseLimitedDecimal } from '../common/decimal';
import { CENTS_LIMIT } from '../common/amount';
import { activeMonths, NO_ACTIVE_MONTH_MESSAGE, splitTowardZero, SpreadInputError } from './spread.util';

/**
 * Quantity × price lines: the months of one budget column computed from its
 * lines, each a quantity in a unit (people, days or pieces) times a unit
 * price whose basis follows the unit (per day, per month or per piece), over
 * the line's own period. Pure (no database).
 *
 * The unit decides the rest:
 * - people, per day, full time (`days_per_month` null): the calendar's
 *   working days of the month × quantity × unit price, rounded to cents per
 *   month; FTE of the month = the quantity;
 * - people, per day, N days per month: N × quantity × unit price per month;
 *   FTE of the month = quantity × N ÷ the calendar's working days of that
 *   month (6 decimals, 0 when the calendar has none that month);
 * - people, per month: quantity × unit price per month; FTE = the quantity;
 * - days (a bundle, per day, once): quantity × unit price rounded to cents
 *   once, split equally over the active months (`splitTowardZero`: each
 *   share rounded toward zero, what is left on the last month); the days
 *   split the same way (6 decimals), and the FTE of a month is its share ÷
 *   the calendar's working days of that month;
 * - pieces, per piece, per month: quantity × unit price per month; FTE 0;
 * - pieces, per piece, once: quantity × unit price rounded once, split
 *   equally the same way (one date: all of it in that date's month); FTE 0.
 *
 * People are counted per month (`frequency` per_month), days once over their
 * period, pieces either. Everything is exact (`common/decimal.ts`) and
 * rounded half away from zero where said, except the equal splits above. A
 * month counts for a line when the line's period covers its 15th
 * (`activeMonths`); a line bought once on one date (start = end) counts that
 * date's month. Its other months are zero.
 */

export type QuantityUnit = 'days' | 'people' | 'pieces';
export type PriceBasis = 'per_day' | 'per_month' | 'per_piece';
export type Frequency = 'per_month' | 'once';
export const QUANTITY_UNITS: readonly QuantityUnit[] = ['days', 'people', 'pieces'];
export const PRICE_BASES: readonly PriceBasis[] = ['per_day', 'per_month', 'per_piece'];
export const FREQUENCIES: readonly Frequency[] = ['per_month', 'once'];
/** The price bases each unit takes (the lines tables' basis CHECK). */
export const BASES_BY_UNIT: Readonly<Record<QuantityUnit, readonly PriceBasis[]>> = {
  days: ['per_day'],
  people: ['per_day', 'per_month'],
  pieces: ['per_piece'],
};
/** How often each unit counts (the lines tables' frequency CHECK); a unit with one choice takes it when none is sent. */
export const FREQUENCIES_BY_UNIT: Readonly<Record<QuantityUnit, readonly Frequency[]>> = {
  days: ['once'],
  people: ['per_month'],
  pieces: ['per_month', 'once'],
};
/** Days per month of a person priced per day (null: full time): above 0, at most 31, 3 decimals (numeric(6,3)). */
export const DAYS_PER_MONTH_MAX = '31';

export const MAX_LINES = 50;
export const LABEL_MAX_LENGTH = 200;

/** A line as validated; decimals are exact strings without trailing zeros. */
export type CostLine = {
  label: string;
  quantity_unit: QuantityUnit;
  quantity: string;
  unit_price: string;
  price_basis: PriceBasis;
  frequency: Frequency;
  /** People priced per day only: the days worked each month; null is full time (the calendar's days). */
  days_per_month: string | null;
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
  /** The twelve FTE months summed, ÷ 12, 2 decimals: the full-year average. */
  fte: string;
  /** The FTE months summed, ÷ the number of active months, 2 decimals: the average over the line's period. */
  fte_period: string;
};

/** A column: the sum of its lines. */
export type ColumnResult = {
  lines: LineResult[];
  /** Months (1..12) at least one line covers. */
  active_months: number[];
  month_cents: bigint[];
  total_cents: bigint;
  fte_months: string[];
  /** The twelve FTE months summed, ÷ 12, 2 decimals: the full-year average (stored on the round). */
  fte: string;
  /** The FTE of the months where a people or days line is active summed, ÷ their number, 2 decimals (0 without one; pieces do not count). */
  fte_period: string;
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
  days: 'a price for days is per day.',
  people: 'a price for people is per day or per month.',
  pieces: 'a price for pieces is per piece.',
};
// The units with one way of counting (pieces take both): another is refused with this sentence.
const FREQUENCY_FOR_UNIT: Partial<Record<QuantityUnit, string>> = {
  days: 'days are counted once over their period.',
  people: 'people are counted per month.',
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

/** One of `allowed` (trimmed, any case); `blank` is the refusal when nothing is given. */
function choice<T extends string>(value: unknown, allowed: readonly T[], n: number, what: string, blank: string): T {
  if (isBlank(value)) throw lineError(n, blank);
  const text = typeof value === 'string' ? value.trim().toLowerCase() : value;
  if (!(allowed as readonly unknown[]).includes(text)) {
    throw lineError(n, `unknown ${what} '${String(value)}'. Use ${allowed.slice(0, -1).join(', ')} or ${allowed[allowed.length - 1]}.`);
  }
  return text as T;
}

/**
 * The days per month of a person priced per day, sent as a number: above 0,
 * at most 31, at most 3 decimals. Full time is sent as null, so anything else
 * that is not a number is neither.
 */
function parseDaysPerMonth(value: unknown, n: number): string {
  let literal: { mantissa: bigint; scale: number } | null = null;
  if (!isBlank(value) && (typeof value === 'string' || typeof value === 'number')) {
    try {
      literal = parseDecimalLiteral(value);
    } catch {
      literal = null;
    }
  }
  if (!literal) throw lineError(n, 'enter the days per month, or tick Full time.');
  let { mantissa, scale } = literal;
  while (scale > 0 && mantissa % 10n === 0n) {
    mantissa /= 10n;
    scale -= 1;
  }
  if (scale > 3) throw lineError(n, 'days per month accepts at most 3 decimals.');
  const days = Decimal.from(`${mantissa}e${-scale}`);
  if (days.cmp(0) <= 0 || days.cmp(DAYS_PER_MONTH_MAX) > 0) throw lineError(n, 'days per month must be more than 0 and at most 31.');
  return days.toString();
}

/**
 * A line's active months: those whose 15th its period covers; a line bought
 * once on one date (start = end, the pieces' date) counts that date's month.
 */
function lineMonths(year: number, line: Pick<CostLine, 'frequency' | 'period_start' | 'period_end'>, n: number): number[] {
  let months: number[];
  try {
    months = activeMonths(year, line.period_start, line.period_end);
  } catch (err) {
    if (err instanceof SpreadInputError) throw lineError(n, continued(err.message));
    throw err;
  }
  if (months.length === 0 && line.frequency === 'once' && line.period_start === line.period_end) {
    months = [Number(line.period_start.slice(5, 7))];
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

  const quantity_unit = choice(line.quantity_unit, QUANTITY_UNITS, n, 'unit', 'choose a unit: days, people or pieces.');
  const quantity = limited(line.quantity, QUANTITY_LIMITS, n);
  const unit_price = limited(line.unit_price, UNIT_PRICE_LIMITS, n);
  const price_basis = choice(line.price_basis, PRICE_BASES, n, 'price basis', 'choose a price basis: per day, per month or per piece.');
  if (!BASES_BY_UNIT[quantity_unit].includes(price_basis)) throw lineError(n, BASIS_FOR_UNIT[quantity_unit]);
  const frequencies = FREQUENCIES_BY_UNIT[quantity_unit];
  const frequency = isBlank(line.frequency) && frequencies.length === 1
    ? frequencies[0]
    : choice(line.frequency, FREQUENCIES, n, 'frequency', 'choose how often: per month or once.');
  if (price_basis === 'per_month' && frequency !== 'per_month') throw lineError(n, 'a price per month applies per month.');
  if (!frequencies.includes(frequency)) throw lineError(n, FREQUENCY_FOR_UNIT[quantity_unit]!);
  const perDayPerson = quantity_unit === 'people' && price_basis === 'per_day';
  let days_per_month: string | null = null;
  if (perDayPerson) {
    if (line.days_per_month !== null && line.days_per_month !== undefined) days_per_month = parseDaysPerMonth(line.days_per_month, n);
  } else if (!isBlank(line.days_per_month)) {
    throw lineError(n, 'days per month apply to people priced per day.');
  }

  if (isBlank(line.period_start) || isBlank(line.period_end)) throw lineError(n, 'give the start and the end of its period.');
  const period_start = String(line.period_start).trim();
  const period_end = String(line.period_end).trim();
  lineMonths(year, { frequency, period_start, period_end }, n);

  const calendarRaw = line.working_day_profile_id;
  if (!isBlank(calendarRaw) && typeof calendarRaw !== 'string') throw lineError(n, 'the calendar was not found.');
  const working_day_profile_id = isBlank(calendarRaw) ? null : (calendarRaw as string).trim();
  if (price_basis === 'per_day' && !working_day_profile_id) throw lineError(n, 'choose a calendar for a price per day.');
  if (price_basis !== 'per_day' && working_day_profile_id) throw lineError(n, 'a calendar is used only with a price per day.');

  return {
    label, quantity_unit, quantity, unit_price, price_basis, frequency, days_per_month, period_start, period_end, working_day_profile_id,
  };
}

/** The lines of a request: a list of at most 50, each checked (see `parseCostLine`). */
export function parseCostLines(raw: unknown, year: number): CostLine[] {
  if (!Array.isArray(raw)) throw new CostingInputError('Send the lines as a list.');
  if (raw.length > MAX_LINES) throw new CostingInputError(`A column holds at most ${MAX_LINES} lines.`);
  return raw.map((entry, index) => parseCostLine(entry, year, index + 1));
}

const sameDecimal = (a: string | null, b: string | null) => (a === null || b === null ? a === b : Decimal.from(a).cmp(b) === 0);

/** Whether two lists of lines ask for the same computation, in the same order; decimals compared by value. */
export function sameLines(a: readonly CostLine[], b: readonly CostLine[]): boolean {
  return a.length === b.length && a.every((line, i) => {
    const other = b[i];
    return line.label === other.label
      && line.quantity_unit === other.quantity_unit
      && Decimal.from(line.quantity).cmp(other.quantity) === 0
      && Decimal.from(line.unit_price).cmp(other.unit_price) === 0
      && line.price_basis === other.price_basis
      && line.frequency === other.frequency
      && sameDecimal(line.days_per_month ?? null, other.days_per_month ?? null)
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

/** `total` cents split equally over `months` (see `splitTowardZero`); the other months are zero. */
function splitCents(total: bigint, months: number[]): bigint[] {
  const cents = zeros(0n);
  splitTowardZero(total, months.map(() => 1n)).forEach((share, i) => { cents[months[i] - 1] = share; });
  return cents;
}

const DAY_SCALE = 10n ** BigInt(DECIMAL_SCALE_DIGITS - 6);

/** The days of a line bought once, split like its price: equal shares in millionths of a day (6 decimals), the rest on the last month. */
function splitDays(quantity: Decimal, months: number[]): Decimal[] {
  const days = zeros(Decimal.ZERO);
  // A quantity has at most 3 decimals: in millionths of a day it is exact.
  const millionths = quantity.divRound(1, 6).units / DAY_SCALE;
  splitTowardZero(millionths, months.map(() => 1n)).forEach((share, i) => { days[months[i] - 1] = Decimal.from(`${share}e-6`); });
  return days;
}

/**
 * The FTE averages of twelve FTE months: the full-year average (summed, ÷ 12)
 * and the average over `months` (their FTE summed, ÷ their number; 0 without
 * a month), both rounded once to 2 decimals, half away from zero.
 */
function fteAverages(fte: readonly Decimal[], months: readonly number[]): { fte: Decimal; fte_period: Decimal } {
  const year = fte.reduce((acc, d) => acc.add(d), Decimal.ZERO);
  const period = months.reduce((acc, m) => acc.add(fte[m - 1]), Decimal.ZERO);
  return { fte: year.divRound(12, 2), fte_period: months.length > 0 ? period.divRound(months.length, 2) : Decimal.ZERO };
}

/**
 * One line's twelve months (see the file header). `calendar` is the line's
 * calendar with its days for `year` (per day only); `n` names the line in
 * the refusals.
 */
export function computeLine(line: CostLine, year: number, calendar: LineCalendar | null, n = 1): LineResult {
  const months = lineMonths(year, line, n);
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

  // A person priced per day works N days a month, or full time: the calendar's days.
  const presence = line.days_per_month == null ? null : Decimal.from(line.days_per_month);
  let month_cents = zeros(0n);
  if (line.frequency === 'once') {
    // Bought once: the price rounded once, split equally (toward zero), the rest on the last month.
    month_cents = splitCents(inLimit(perUnit.toCents()), months);
  } else {
    for (const m of months) {
      // Per day: 6-decimal days (3 for N) × 7 decimals = 13 at most, still exact.
      month_cents[m - 1] = line.price_basis === 'per_day' ? (presence ?? days![m - 1]).mul(perUnit).toCents() : perUnit.toCents();
    }
  }
  month_cents.forEach(inLimit);
  const total_cents = inLimit(month_cents.reduce((acc, c) => acc + c, 0n));

  const fte = zeros(Decimal.ZERO);
  const perWorkingDay = (worked: Decimal, m: number) => (days![m - 1].cmp(0) > 0 ? divide(worked, days![m - 1], 6) : Decimal.ZERO);
  if (line.quantity_unit === 'people') {
    // N days a month: the quantity × N ÷ the month's working days; else the quantity.
    for (const m of months) fte[m - 1] = presence ? perWorkingDay(quantity.mul(presence), m) : quantity;
  } else if (line.quantity_unit === 'days') {
    // The bundle's days split like its price, each month's share ÷ the month's working days.
    const bought = splitDays(quantity, months);
    for (const m of months) fte[m - 1] = perWorkingDay(bought[m - 1], m);
  }
  const averages = fteAverages(fte, months);

  return {
    active_months: months,
    day_counts: days ? days.map((d) => d.toString()) : null,
    total_days: days ? months.reduce((acc, m) => acc.add(days![m - 1]), Decimal.ZERO).toString() : null,
    month_cents,
    total_cents,
    fte_months: fte.map((d) => d.toString()),
    fte: averages.fte.toString(),
    fte_period: averages.fte_period.toString(),
  };
}

/**
 * A column from its lines: each line computed (its calendar looked up in
 * `calendars` by id), then the twelve months, the total and the FTE summed.
 * The FTE is the twelve months' FTE summed, ÷ 12 (the full-year average,
 * stored on the round), and `fte_period` the FTE of the months where a
 * people or days line is active summed, ÷ their number (pieces do not widen
 * the period; 0 without such a month); both rounded once to 2 decimals. Each month
 * and the total must fit the amount columns, and the FTE the round's column.
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
  const counted = new Set<number>();
  results.forEach((result, index) => {
    result.month_cents.forEach((cents, i) => { month_cents[i] += cents; });
    result.fte_months.forEach((value, i) => { fte[i] = fte[i].add(value); });
    result.active_months.forEach((m) => active.add(m));
    if (lines[index].quantity_unit !== 'pieces') result.active_months.forEach((m) => counted.add(m));
  });
  const total_cents = month_cents.reduce((acc, c) => acc + c, 0n);
  for (const cents of [...month_cents, total_cents]) {
    if ((cents < 0n ? -cents : cents) >= CENTS_LIMIT) throw new CostingInputError(COMPUTED_TOO_LARGE_MESSAGE);
  }
  const active_months = [...active].sort((a, b) => a - b);
  const averages = fteAverages(fte, [...counted]);
  if (averages.fte.cmp(FTE_LIMIT) >= 0) throw new CostingInputError(FTE_TOO_LARGE_MESSAGE);
  return {
    lines: results,
    active_months,
    month_cents,
    total_cents,
    fte_months: fte.map((d) => d.toString()),
    fte: averages.fte.toString(),
    fte_period: averages.fte_period.toString(),
  };
}
