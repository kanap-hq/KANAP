import type { TFunction } from 'i18next';

/**
 * Period of a budget column (a "round" on the server) and the texts built from
 * it. Pure: the same 15th rule as `backend/src/spend/spread.util.ts`.
 */

/**
 * The five budget columns. Their technical names are storage keys only: every
 * column has a period and a record, and no behaviour depends on which one it is.
 */
export type AmountMeasure = 'planned' | 'committed' | 'forecast' | 'actual' | 'expected_landing';

export type RoundMethod = 'spread' | 'copied' | 'manual' | 'computed';

export type PricingBasis = 'per_day' | 'per_month' | 'per_period';
export const PRICING_BASES: PricingBasis[] = ['per_day', 'per_month', 'per_period'];

/** The explanation of a computation. Decimals are plain strings; months are 1..12, arrays hold twelve values. */
export type ComputedCalculation = {
  kind: 'computed';
  pricing_basis: PricingBasis;
  quantity: string;
  unit_price: string;
  price_index_pct: string;
  working_day_profile_code: string | null;
  working_day_profile_name: string | null;
  active_months: number[];
  day_counts: string[] | null;
  total_days: string | null;
  month_amounts: string[];
  total: string;
  counts_as_fte: boolean;
};

export type LastCalculation =
  | { kind: 'annual'; total: string; profile: 'flat' | '4-4-5'; active_months: number[]; weights: string[]; source?: 'item_csv' }
  | { kind: 'quarterly'; quarters: { Q1: string; Q2: string; Q3: string; Q4: string }; distribution: 'equal' | '445'; active_months: number[] }
  | {
    kind: 'copy';
    source_year: number;
    source_measure: AmountMeasure;
    uplift_pct: string;
    source_total: string;
    total: string;
    source_method: RoundMethod | null;
  }
  | ComputedCalculation;

export type RoundInput = {
  measure: AmountMeasure;
  period_start: string;
  period_end: string;
  method: RoundMethod;
  spread_profile_name: string | null;
  last_calculation: LastCalculation | null;
  updated_at: string;
  updated_by: string | null;
  /** The recipe: all null (and `counts_as_fte` false) when the column has none. */
  pricing_basis: PricingBasis | null;
  quantity: string | null;
  unit_price: string | null;
  price_index_pct: string | null;
  working_day_profile_id: string | null;
  working_day_profile_code: string | null;
  working_day_profile_name: string | null;
  counts_as_fte: boolean;
};

/** Body of `bulk-upsert` with `kind: 'computed'` and of `compute-preview`. */
export type ComputeRequest = {
  kind: 'computed';
  year: number;
  measure: AmountMeasure;
  period_start: string;
  period_end: string;
  pricing_basis: PricingBasis;
  quantity: string;
  unit_price: string;
  price_index_pct: string;
  working_day_profile_id: string | null;
  counts_as_fte: boolean;
};

/** What `compute-preview` answers: the computation and how it differs from what is stored. Writes nothing. */
export type ComputePreview = {
  active_months: number[];
  day_counts: string[] | null;
  total_days: string | null;
  month_amounts: string[];
  total: string;
  fte: string | null;
  calendar: { id: string; code: string; name: string; disabled: boolean } | null;
  stored: { month_amounts: string[]; method: RoundMethod | null; last_calculation: LastCalculation | null };
  changed_months: number[];
  calendar_changed_months: number[];
  warnings: string[];
};

/** True when the column keeps a recipe (a computation, or a file that gave one), so it can be recomputed. */
export function hasRecipe(record: RoundInput | null | undefined): record is RoundInput & { pricing_basis: PricingBasis } {
  return !!record?.pricing_basis;
}

export type Period = { start: string; end: string };

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written `YYYY-MM-DD`. */
export function isYmd(value: string | null | undefined): value is string {
  const match = YMD.exec(value ?? '');
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const pad = (n: number) => String(n).padStart(2, '0');
const yearStart = (year: number) => `${year}-01-01`;
const yearEnd = (year: number) => `${year}-12-31`;

export function wholeYear(year: number): Period {
  return { start: yearStart(year), end: yearEnd(year) };
}

/**
 * Months (1..12) whose 15th lies within [start, end], both inclusive. A missing
 * bound means January 1 / December 31. Invalid dates, dates outside `year` or a
 * start after the end give no month.
 */
export function activeMonths(year: number, start: string | null | undefined, end: string | null | undefined): number[] {
  const from = start || yearStart(year);
  const to = end || yearEnd(year);
  if (!isYmd(from) || !isYmd(to)) return [];
  if (from.slice(0, 4) !== String(year) || to.slice(0, 4) !== String(year) || from > to) return [];
  const months: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const fifteenth = `${year}-${pad(m)}-15`;
    if (from <= fifteenth && to >= fifteenth) months.push(m);
  }
  return months;
}

export type PeriodProblem = 'missing' | 'invalid' | 'outsideYear' | 'startAfterEnd' | 'noMonth';

/** Why a period typed in the spread panel cannot be applied, or null when it can. */
export function periodProblem(year: number, start: string, end: string): PeriodProblem | null {
  if (!start || !end) return 'missing';
  if (!isYmd(start) || !isYmd(end)) return 'invalid';
  if (start.slice(0, 4) !== String(year) || end.slice(0, 4) !== String(year)) return 'outsideYear';
  if (start > end) return 'startAfterEnd';
  return activeMonths(year, start, end).length === 0 ? 'noMonth' : null;
}

/**
 * The item's dates intersected with the year. `endOfValidity` is the calendar
 * date the item page shows; missing bounds mean January 1 / December 31.
 * Null when the item is not valid on any day of the year.
 */
export function suggestedPeriod(year: number, effectiveStart?: string | null, endOfValidity?: string | null): Period | null {
  const first = yearStart(year);
  const last = yearEnd(year);
  const start = isYmd(effectiveStart) && effectiveStart > first ? effectiveStart : first;
  const end = isYmd(endOfValidity) && endOfValidity < last ? endOfValidity : last;
  return start <= end ? { start, end } : null;
}

/**
 * A column's own period, as shown and as a typed yearly total is spread over:
 * its stored period; the whole year when it has no stored period but already
 * holds amounts (existing data behaves as before); otherwise the suggestion
 * from the item's dates; null when none.
 */
export function columnPeriod(year: number, record: RoundInput | null | undefined, hasAmounts: boolean, suggestion: Period | null): Period | null {
  if (record) return { start: record.period_start, end: record.period_end };
  if (hasAmounts) return wholeYear(year);
  return suggestion;
}

/**
 * The period the spread panel proposes: the column's own period within the
 * item's dates (the suggestion). No suggestion: the column's period. When the
 * two share no day: the suggestion. The user can still widen it.
 */
export function periodForEdit(year: number, record: RoundInput | null | undefined, hasAmounts: boolean, suggestion: Period | null): Period | null {
  const period = columnPeriod(year, record, hasAmounts, suggestion);
  if (!period || !suggestion) return period;
  const start = period.start > suggestion.start ? period.start : suggestion.start;
  const end = period.end < suggestion.end ? period.end : suggestion.end;
  return start <= end ? { start, end } : suggestion;
}

export function monthName(locale: string, month: number): string {
  return new Date(2000, month - 1, 1).toLocaleString(locale, { month: 'long' });
}

function capitalize(text: string, locale: string): string {
  return text ? text.charAt(0).toLocaleUpperCase(locale) + text.slice(1) : text;
}

/** Contiguous runs of months, each written "April" or "April to June". */
function monthRuns(t: TFunction, locale: string, months: number[]): string[] {
  const sorted = [...months].sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  sorted.forEach((m) => {
    const last = runs[runs.length - 1];
    if (last && m === last[1] + 1) last[1] = m;
    else runs.push([m, m]);
  });
  return runs.map(([from, to]) => (from === to
    ? monthName(locale, from)
    : t('budgetTab.monthRange', { from: monthName(locale, from), to: monthName(locale, to) })));
}

function joinRuns(t: TFunction, runs: string[]): string {
  return runs.reduce((acc, run) => (acc ? t('budgetTab.monthAnd', { first: acc, second: run }) : run), '');
}

/** "9 months, April to December", "1 month, April". Empty when no month counts. */
export function periodText(t: TFunction, locale: string, months: number[]): string {
  if (months.length === 0) return '';
  return t('budgetTab.periodText', { count: months.length, months: joinRuns(t, monthRuns(t, locale, months)) });
}

/** "January to March will be set to zero." Empty when every month counts. */
export function zeroedMonthsText(t: TFunction, locale: string, active: number[]): string {
  const zeroed = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => !active.includes(m));
  if (zeroed.length === 0 || active.length === 0) return '';
  return capitalize(t('budgetTab.zeroedMonths', { count: zeroed.length, months: joinRuns(t, monthRuns(t, locale, zeroed)) }), locale);
}

const COLUMN_LABEL_KEYS: Record<AmountMeasure, string> = {
  planned: 'operations.budgetColumns.budget',
  committed: 'operations.budgetColumns.revision',
  forecast: 'operations.budgetColumns.forecast',
  expected_landing: 'operations.budgetColumns.landing',
  actual: 'operations.budgetColumns.followUp',
};

/** The product name of a column; screens show the tenant's names from `useBudgetColumns`. */
export function columnLabel(t: TFunction, measure: AmountMeasure): string {
  return t(COLUMN_LABEL_KEYS[measure]);
}

/** "+2 %" in the viewer's number format; empty for a zero or unreadable percentage. */
export function formatUplift(locale: string, pct: string | number | null | undefined): string {
  const n = Number(pct);
  if (!Number.isFinite(n) || n === 0) return '';
  return new Intl.NumberFormat(locale, { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: 2 }).format(n / 100);
}

/**
 * How the column was produced: "Spread flat", "Copied from Budget 2025 +2 %", "Edited by hand",
 * "Computed per day, France 218".
 * `nameOf` names the source column of a copy (the tenant's names; the product names by default).
 */
export function chipText(
  t: TFunction,
  locale: string,
  record: RoundInput | null | undefined,
  nameOf: (measure: AmountMeasure) => string = (measure) => columnLabel(t, measure),
): string {
  if (!record) return '';
  const calc = record.last_calculation;
  if (record.method === 'manual') return t('budgetTab.chip.manual');
  if (record.method === 'computed') {
    const basis = calc?.kind === 'computed' ? calc.pricing_basis : record.pricing_basis;
    if (basis === 'per_day') {
      const calendar = record.working_day_profile_name ?? (calc?.kind === 'computed' ? calc.working_day_profile_name : null);
      return calendar ? t('budgetTab.chip.computedPerDay', { calendar }) : t('budgetTab.chip.computedPerDayPlain');
    }
    if (basis === 'per_month') return t('budgetTab.chip.computedPerMonth');
    if (basis === 'per_period') return t('budgetTab.chip.computedPerPeriod');
    return t('budgetTab.chip.computed');
  }
  if (record.method === 'copied') {
    if (calc?.kind !== 'copy') return t('budgetTab.chip.copiedPlain');
    const column = nameOf(calc.source_measure);
    const uplift = formatUplift(locale, calc.uplift_pct);
    return uplift
      ? t('budgetTab.chip.copiedUplift', { column, year: calc.source_year, uplift })
      : t('budgetTab.chip.copied', { column, year: calc.source_year });
  }
  if (calc?.kind === 'quarterly') return t('budgetTab.chip.spreadQuarterly');
  const profile = calc?.kind === 'annual' ? calc.profile : record.spread_profile_name;
  if (profile === '4-4-5') return t('budgetTab.chip.spread445');
  if (profile === 'flat' || profile == null) return t('budgetTab.chip.spreadFlat');
  return t('budgetTab.chip.spread');
}

/**
 * A decimal string from the server (days, FTE, quantity, price) as the budget tab writes numbers:
 * space groups, dot decimals, no trailing zeros ("163", "171.75", "0.75"). Read from the string.
 */
function formatDecimal(value: string | null | undefined): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value ?? '').trim());
  if (!match) return String(value ?? '');
  const [, sign, int, frac = ''] = match;
  const decimals = frac.replace(/0+$/, '');
  const grouped = int.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  if (grouped === '0' && !decimals) return '0';
  return `${sign}${grouped}${decimals ? `.${decimals}` : ''}`;
}

/**
 * A money string from the server as the budget fields show it ("65 200", "91 599.96"): whole
 * units unless there are cents. Read from the string, so nothing goes through a float.
 */
export function formatMoney(value: string | null | undefined): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value ?? '').trim());
  if (!match) return String(value ?? '');
  const [, sign, int, frac = ''] = match;
  const cents = frac.padEnd(2, '0').slice(0, 2);
  const grouped = int.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  if (grouped === '0' && cents === '00') return '0';
  return `${sign}${grouped}${cents === '00' ? '' : `.${cents}`}`;
}

/** The recipe in one line, for a tooltip: "Per day · Quantity 1 · Unit price 400 · Calendar France 218 · Counts as FTE". */
export function recipeText(t: TFunction, locale: string, record: RoundInput | null | undefined): string {
  if (!hasRecipe(record)) return '';
  const index = Number(record.price_index_pct);
  const calendar = record.working_day_profile_name
    ?? (record.last_calculation?.kind === 'computed' ? record.last_calculation.working_day_profile_name : null);
  return [
    t(`budgetTab.basis.${record.pricing_basis}`),
    t('budgetTab.recipe.quantity', { value: formatDecimal(record.quantity) }),
    t('budgetTab.recipe.unitPrice', { value: formatDecimal(record.unit_price) }),
    Number.isFinite(index) && index !== 0 ? t('budgetTab.recipe.index', { value: formatUplift(locale, record.price_index_pct) }) : '',
    record.pricing_basis === 'per_day' && calendar ? t('budgetTab.recipe.calendar', { name: calendar }) : '',
    record.counts_as_fte ? t('budgetTab.recipe.countsAsFte') : '',
  ].filter(Boolean).join(' · ');
}

/** The live line of the compute panel: "9 months · 163 days · 65 200 · 0.75 FTE" (days per day only, FTE when counted). */
export function computeLineText(t: TFunction, locale: string, preview: ComputePreview): string {
  const days = preview.total_days == null ? null : Number(preview.total_days);
  return [
    t('budgetTab.compute.months', { count: preview.active_months.length }),
    days == null ? '' : t('budgetTab.compute.days', { count: days, days: formatDecimal(preview.total_days) }),
    formatMoney(preview.total),
    preview.fte == null ? '' : t('budgetTab.compute.fte', { value: formatDecimal(preview.fte) }),
  ].filter(Boolean).join(' · ');
}

/**
 * What a recompute would change, one line per month: the calendar days that changed since the
 * last computation ("March: 20 days, now 19"), then the amounts that would change ("March: 8 000, now 7 600").
 */
export function computeChangeLines(t: TFunction, locale: string, preview: ComputePreview): { days: string[]; amounts: string[] } {
  const calc = preview.stored.last_calculation;
  const storedDays = calc?.kind === 'computed' ? calc.day_counts : null;
  const month = (m: number) => capitalize(monthName(locale, m), locale);
  const days = storedDays && preview.day_counts
    ? preview.calendar_changed_months.map((m) => t('budgetTab.compute.dayChange', {
      count: Number(storedDays[m - 1]),
      month: month(m),
      before: formatDecimal(storedDays[m - 1]),
      after: formatDecimal(preview.day_counts![m - 1]),
    }))
    : [];
  const amounts = preview.changed_months.map((m) => t('budgetTab.compute.amountChange', {
    month: month(m),
    before: formatMoney(preview.stored.month_amounts[m - 1] ?? '0'),
    after: formatMoney(preview.month_amounts[m - 1] ?? '0'),
  }));
  return { days, amounts };
}

/** "A", "A and B", "A, B and C" in the viewer's language. */
export function joinList(t: TFunction, items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return t('budgetTab.listAnd', { first: items.slice(0, -1).join(', '), last: items[items.length - 1] });
}

/** Integer cents of an amount, so column sums never go through a float total. */
export function toCents(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Cents written as a two-decimal string (`'6000.00'`), the exact form sent to the server. */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
