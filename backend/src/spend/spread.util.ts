import { divRoundHalfAway, parseDecimalLiteral } from '../common/decimal';

/**
 * Spreading a total over months, in integer cents.
 *
 * Weights are integers (or decimals converted exactly to a common integer
 * scale), so no step goes through binary floating point. Each month gets
 * round-half-away-from-zero(total × weightᵢ / Σweights); what rounding leaves
 * over (positive or negative) goes to the last month of the year, or of the
 * quarter. So 0.30 over twelve equal months is 0.03 × 11 and −0.03 in
 * December: every month is the nearest cent, the total is exact.
 *
 * A spread may be limited to a period (a window). A month is active when the
 * period covers its 15th, both bounds inclusive; the other months get zero,
 * the weights of the active months are renormalised over their own sum and the
 * remainder goes to the last active month (of the year, or of the quarter).
 */

/** A spread input the caller must correct (bad period, no month counts…): the services answer 400. */
export class SpreadInputError extends Error {}

export const NO_ACTIVE_MONTH_MESSAGE = 'No month of the period counts: a month counts when the period covers its 15th.';

/** Period of a spread, as `YYYY-MM-DD` dates; a missing bound is January 1 or December 31. */
export type SpreadWindow = { start?: string | null; end?: string | null };

export type SpreadMeasure = 'planned' | 'forecast' | 'committed' | 'actual' | 'expected_landing';
export type SpreadRow = { period: string } & Partial<Record<SpreadMeasure, bigint>>;

const SPREAD_MEASURES: readonly SpreadMeasure[] = ['planned', 'forecast', 'committed', 'actual', 'expected_landing'];

export const FLAT_WEIGHTS: readonly bigint[] = Array.from({ length: 12 }, () => 1n);
const QUARTER_WEIGHTS = { equal: [1n, 1n, 1n], '445': [4n, 4n, 5n] } as const;

function monthPeriods(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`);
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function assertDateInYear(value: unknown, year: number, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = ISO_DATE.exec(text);
  const [y, m, d] = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (!match || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new SpreadInputError(`The ${label} of the period '${String(value ?? '')}' is not a date; use YYYY-MM-DD.`);
  }
  if (y !== year) throw new SpreadInputError(`The period must lie within ${year}; its ${label} is ${text}.`);
  return text;
}

/**
 * Months (1..12) whose 15th lies in [start, end], both inclusive. A missing
 * bound is January 1 or December 31. Refuses a date that is not a real date,
 * a date outside `year` and a start after the end; an empty result is the
 * caller's to refuse.
 */
export function activeMonths(year: number, start?: string | null, end?: string | null): number[] {
  const from = start == null ? `${year}-01-01` : assertDateInYear(start, year, 'start');
  const to = end == null ? `${year}-12-31` : assertDateInYear(end, year, 'end');
  if (from > to) throw new SpreadInputError(`The period starts after it ends (${from} to ${to}).`);
  const months: number[] = [];
  for (let month = 1; month <= 12; month++) {
    const fifteenth = `${year}-${String(month).padStart(2, '0')}-15`;
    if (fifteenth >= from && fifteenth <= to) months.push(month);
  }
  return months;
}

function windowMonths(year: number, window: SpreadWindow): number[] {
  const months = activeMonths(year, window.start, window.end);
  if (months.length === 0) throw new SpreadInputError(NO_ACTIVE_MONTH_MESSAGE);
  return months;
}

/** Split `total` cents by `weights` (Σ > 0); the rounding remainder goes to the last share. */
function split(total: bigint, weights: readonly bigint[]): bigint[] {
  const sum = weights.reduce((acc, w) => acc + w, 0n);
  if (sum <= 0n) throw new Error('Spread weights must add up to more than zero');
  const shares = weights.map((w) => divRoundHalfAway(total * w, sum));
  const allocated = shares.reduce((acc, s) => acc + s, 0n);
  shares[shares.length - 1] += total - allocated;
  return shares;
}

/**
 * Twelve stored profile weights as exact integers on a common scale, or null
 * when the profile cannot be used (not twelve entries, or not adding up to
 * more than zero). A value that is not a number counts as zero.
 */
export function profileWeights(raw: unknown): bigint[] | null {
  if (!Array.isArray(raw) || raw.length !== 12) return null;
  const parsed = raw.map((w) => {
    if ((typeof w !== 'number' || !Number.isFinite(w)) && typeof w !== 'string') return null;
    try {
      return parseDecimalLiteral(w);
    } catch {
      return null;
    }
  });
  const scale = Math.max(0, ...parsed.map((p) => (p ? p.scale : 0)));
  const weights = parsed.map((p) => (p ? p.mantissa * 10n ** BigInt(scale - p.scale) : 0n));
  return weights.reduce((acc, w) => acc + w, 0n) > 0n ? weights : null;
}

/**
 * Yearly totals (cents) over the twelve months; the rows carry only the
 * measures given. With a window, only its active months get a share.
 */
export function spreadAnnualToMonths(
  year: number,
  totals: Partial<Record<SpreadMeasure, bigint>>,
  weights: readonly bigint[] = FLAT_WEIGHTS,
  window?: SpreadWindow,
): SpreadRow[] {
  if (weights.length !== 12) throw new Error('A yearly spread needs twelve weights');
  const indexes = window ? windowMonths(year, window).map((m) => m - 1) : weights.map((_, i) => i);
  const active = indexes.map((i) => weights[i]);
  if (window && active.reduce((acc, w) => acc + w, 0n) <= 0n) {
    throw new SpreadInputError('The spread profile gives no weight to the months of the period.');
  }
  const rows: SpreadRow[] = monthPeriods(year).map((period) => ({ period }));
  for (const measure of SPREAD_MEASURES) {
    const total = totals[measure];
    if (total === undefined) continue;
    if (window) rows.forEach((row) => { row[measure] = 0n; });
    split(total, active).forEach((share, i) => { rows[indexes[i]][measure] = share; });
  }
  return rows;
}

/**
 * Quarter totals (cents, an omitted quarter is zero) of one measure over the
 * twelve months. With a window, each quarter is split over its active months;
 * a quarter without one must be zero.
 */
export function spreadQuarterlyToMonths(
  year: number,
  measure: SpreadMeasure,
  quarters: Partial<Record<'Q1' | 'Q2' | 'Q3' | 'Q4', bigint>>,
  distribution: 'equal' | '445',
  window?: SpreadWindow,
): SpreadRow[] {
  const weights = QUARTER_WEIGHTS[distribution];
  if (!window) {
    const shares = (['Q1', 'Q2', 'Q3', 'Q4'] as const).flatMap((q) => split(quarters[q] ?? 0n, weights));
    return monthPeriods(year).map((period, i) => ({ period, [measure]: shares[i] }));
  }
  const months = windowMonths(year, window);
  const shares: bigint[] = Array.from({ length: 12 }, () => 0n);
  (['Q1', 'Q2', 'Q3', 'Q4'] as const).forEach((quarter, q) => {
    const total = quarters[quarter] ?? 0n;
    const inQuarter = months.filter((m) => Math.ceil(m / 3) === q + 1);
    if (inQuarter.length === 0) {
      if (total !== 0n) throw new SpreadInputError(`${quarter} has an amount, but no month of ${quarter} is in the period.`);
      return;
    }
    split(total, inQuarter.map((m) => weights[(m - 1) % 3])).forEach((share, i) => { shares[inQuarter[i] - 1] = share; });
  });
  return monthPeriods(year).map((period, i) => ({ period, [measure]: shares[i] }));
}
