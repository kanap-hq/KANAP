import { Decimal, DecimalLimitError, DecimalLimits, divRoundHalfAway, parseLimitedDecimal } from '../common/decimal';
import { CENTS_LIMIT } from '../common/amount';
import { activeMonths, NO_ACTIVE_MONTH_MESSAGE, SpreadInputError } from './spread.util';

/**
 * Costed rounds: the months of one budget column computed from a quantity, a
 * unit price, a price index and, for a price per day, a working-day calendar.
 * Pure (no database): the bulk-upsert, its preview and the budget rows file
 * share it, so a computation reads the same everywhere.
 *
 * Everything is exact (`common/decimal.ts`): the indexed price is never
 * rounded, each month is rounded once to cents, half away from zero. A month
 * counts when the round's period covers its 15th (`activeMonths`); the other
 * months are zero.
 */

export type PricingBasis = 'per_day' | 'per_month' | 'per_period';
export const PRICING_BASES: readonly PricingBasis[] = ['per_day', 'per_month', 'per_period'];

/** What a round is computed from; decimals are exact strings without trailing zeros. */
export type CostingRecipe = {
  pricing_basis: PricingBasis;
  quantity: string;
  unit_price: string;
  price_index_pct: string;
  working_day_profile_id: string | null;
  counts_as_fte: boolean;
};

export type CostingResult = {
  /** Months 1..12 the period covers. */
  active_months: number[];
  /** The calendar's twelve day counts for the year (per day only). */
  day_counts: string[] | null;
  /** Sum of the day counts of the active months (per day only). */
  total_days: string | null;
  /** Twelve months, in cents; inactive months are zero. */
  month_cents: bigint[];
  total_cents: bigint;
  /** Yearly FTE when the round counts as FTE, else null. */
  fte: string | null;
};

/** An input the user must correct: the services answer 400 with this sentence. */
export class CostingInputError extends Error {}

// From the column types: quantity numeric(12,3), unit_price numeric(18,4), price_index_pct numeric(7,4).
export const QUANTITY_LIMITS: DecimalLimits = {
  label: 'Quantity', decimals: 3, min: '0', minMessage: 'Quantity cannot be negative.', maxAbs: '1000000000',
};
export const UNIT_PRICE_LIMITS: DecimalLimits = { label: 'Unit price', decimals: 4, maxAbs: '100000000000000' };
export const PRICE_INDEX_LIMITS: DecimalLimits = {
  label: 'Price index', decimals: 4, min: '-100', minMessage: 'The price index cannot be below -100%.', maxAbs: '1000',
};

export const CALENDAR_REQUIRED_MESSAGE = 'Choose a working-day calendar for a price per day.';
export const CALENDAR_NOT_ALLOWED_MESSAGE = 'A calendar is used only with a price per day.';
export const COMPUTED_TOO_LARGE_MESSAGE = 'The computed amount is too large.';

/** "France 218 has no working days for 2027. Add them on the Working-day calendars page." */
export function missingCalendarYearMessage(calendarName: string, year: number): string {
  return `${calendarName} has no working days for ${year}. Add them on the Working-day calendars page.`;
}

const isBlank = (value: unknown) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

function limited(value: unknown, limits: DecimalLimits): string {
  try {
    return parseLimitedDecimal(value, limits).toString();
  } catch (err) {
    if (err instanceof DecimalLimitError) throw new CostingInputError(err.message);
    throw err;
  }
}

/**
 * A recipe from a request, a file row or the database, checked against the
 * column limits and normalised: basis one of the three, quantity and unit
 * price required, index blank = 0, a calendar exactly for a price per day,
 * `counts_as_fte` a boolean (absent = false). The calendar id is only checked
 * for presence: the caller resolves it under the tenant.
 */
export function parseCostingRecipe(raw: Record<string, unknown>): CostingRecipe {
  const basisRaw = raw.pricing_basis;
  if (isBlank(basisRaw)) throw new CostingInputError('Choose a pricing basis.');
  const basis = typeof basisRaw === 'string' ? basisRaw.trim().toLowerCase() : basisRaw;
  if (!(PRICING_BASES as readonly unknown[]).includes(basis)) {
    throw new CostingInputError(`Unknown pricing basis '${String(basisRaw)}'. Use ${PRICING_BASES.join(', ')}.`);
  }
  const pricing_basis = basis as PricingBasis;
  const quantity = limited(raw.quantity, QUANTITY_LIMITS);
  const unit_price = limited(raw.unit_price, UNIT_PRICE_LIMITS);
  const price_index_pct = isBlank(raw.price_index_pct) ? '0' : limited(raw.price_index_pct, PRICE_INDEX_LIMITS);

  const calendarRaw = raw.working_day_profile_id;
  if (!isBlank(calendarRaw) && typeof calendarRaw !== 'string') throw new CostingInputError('The calendar was not found.');
  const working_day_profile_id = isBlank(calendarRaw) ? null : (calendarRaw as string).trim();
  if (pricing_basis === 'per_day' && !working_day_profile_id) throw new CostingInputError(CALENDAR_REQUIRED_MESSAGE);
  if (pricing_basis !== 'per_day' && working_day_profile_id) throw new CostingInputError(CALENDAR_NOT_ALLOWED_MESSAGE);

  const fteRaw = raw.counts_as_fte;
  if (fteRaw !== undefined && fteRaw !== null && typeof fteRaw !== 'boolean') {
    throw new CostingInputError('Counts as FTE must be true or false.');
  }
  return { pricing_basis, quantity, unit_price, price_index_pct, working_day_profile_id, counts_as_fte: fteRaw === true };
}

/** Whether two recipes (or their absence) are the same, decimals compared by value. */
export function sameRecipe(a: CostingRecipe | null, b: CostingRecipe | null): boolean {
  if (!a || !b) return !a && !b;
  return a.pricing_basis === b.pricing_basis
    && Decimal.from(a.quantity).cmp(b.quantity) === 0
    && Decimal.from(a.unit_price).cmp(b.unit_price) === 0
    && Decimal.from(a.price_index_pct).cmp(b.price_index_pct) === 0
    && (a.working_day_profile_id ?? null) === (b.working_day_profile_id ?? null)
    && a.counts_as_fte === b.counts_as_fte;
}

/** Months (1..12) whose amount is above zero: the FTE mask. */
export function positiveMonthsOf(monthCents: readonly bigint[]): number[] {
  return monthCents.flatMap((cents, i) => (cents > 0n ? [i + 1] : []));
}

/**
 * Yearly FTE of a round that counts as FTE: the quantity in each active month
 * whose amount is positive, summed, ÷ 12, rounded once half away from zero to
 * 2 decimals (plain notation, e.g. `0.75`, `1`).
 */
export function yearlyFte(quantity: string, activeMonths: number[], positiveMonths: number[]): string {
  const positive = new Set(positiveMonths);
  const counted = new Set(activeMonths.filter((m) => Number.isInteger(m) && m >= 1 && m <= 12 && positive.has(m))).size;
  return Decimal.from(quantity).mul(counted).divRound(12, 2).toString();
}

function assertInLimit(cents: bigint) {
  if ((cents < 0n ? -cents : cents) >= CENTS_LIMIT) throw new CostingInputError(COMPUTED_TOO_LARGE_MESSAGE);
}

/**
 * The twelve months of a round from its recipe:
 * - per day: days of the month × quantity × indexed price, each active month
 *   rounded to cents (a partly covered month counts all its days);
 * - per month: quantity × indexed price, each active month rounded to cents;
 * - for the whole period: quantity × indexed price rounded to cents once,
 *   split equally over the active months, the rounding remainder on the last.
 * `calendar.days` are the calendar's values for `year` (null when it has none).
 */
export function computeCosting(input: {
  year: number;
  period_start: string;
  period_end: string;
  recipe: CostingRecipe;
  calendar: { code: string; name: string; days: string[] | null } | null;
}): CostingResult {
  const { year, recipe, calendar } = input;
  let months: number[];
  try {
    months = activeMonths(year, input.period_start, input.period_end);
  } catch (err) {
    if (err instanceof SpreadInputError) throw new CostingInputError(err.message);
    throw err;
  }
  if (months.length === 0) throw new CostingInputError(NO_ACTIVE_MONTH_MESSAGE);

  // Exact: unit price (4 decimals) × (1 + index / 100) (6) has at most 10 decimals, × quantity 13.
  const perUnit = Decimal.from(recipe.quantity).mul(Decimal.from(recipe.unit_price).withPct(recipe.price_index_pct));
  const month_cents: bigint[] = Array.from({ length: 12 }, () => 0n);
  let day_counts: string[] | null = null;
  let total_days: string | null = null;

  if (recipe.pricing_basis === 'per_day') {
    if (!calendar) throw new CostingInputError(CALENDAR_REQUIRED_MESSAGE);
    if (!calendar.days) throw new CostingInputError(missingCalendarYearMessage(calendar.name, year));
    if (calendar.days.length !== 12) throw new Error(`Calendar ${calendar.code} has ${calendar.days.length} months for ${year}.`);
    const days = calendar.days.map((d) => Decimal.from(d));
    day_counts = days.map((d) => d.toString());
    let sum = Decimal.ZERO;
    for (const m of months) {
      // 6-decimal days × 13 decimals = 19: still exact.
      month_cents[m - 1] = days[m - 1].mul(perUnit).toCents();
      sum = sum.add(days[m - 1]);
    }
    total_days = sum.toString();
  } else {
    if (calendar) throw new CostingInputError(CALENDAR_NOT_ALLOWED_MESSAGE);
    if (recipe.pricing_basis === 'per_month') {
      const cents = perUnit.toCents();
      for (const m of months) month_cents[m - 1] = cents;
    } else {
      // The flat split of spreadAnnualToMonths over a window: equal shares, remainder on the last active month.
      const total = perUnit.toCents();
      assertInLimit(total);
      const share = divRoundHalfAway(total, BigInt(months.length));
      for (const m of months) month_cents[m - 1] = share;
      month_cents[months[months.length - 1] - 1] += total - share * BigInt(months.length);
    }
  }

  month_cents.forEach(assertInLimit);
  const total_cents = month_cents.reduce((acc, c) => acc + c, 0n);
  assertInLimit(total_cents);
  return {
    active_months: months,
    day_counts,
    total_days,
    month_cents,
    total_cents,
    fte: recipe.counts_as_fte ? yearlyFte(recipe.quantity, months, positiveMonthsOf(month_cents)) : null,
  };
}
