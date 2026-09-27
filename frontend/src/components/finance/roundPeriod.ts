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
    source_method: 'spread' | 'copied' | 'manual' | null;
  };

export type RoundInput = {
  measure: AmountMeasure;
  period_start: string;
  period_end: string;
  method: 'spread' | 'copied' | 'manual';
  spread_profile_name: string | null;
  last_calculation: LastCalculation | null;
  updated_at: string;
  updated_by: string | null;
};

export type Period = { start: string; end: string };

/** Every column, in the order the spread panel lists them. */
export const AMOUNT_MEASURES: AmountMeasure[] = ['planned', 'committed', 'forecast', 'expected_landing', 'actual'];

/**
 * The columns "Apply to all columns" spreads together. This is the product
 * default; step R makes it a tenant setting. Nothing else may test a column
 * name to decide a behaviour.
 */
export const APPLY_TO_ALL_COLUMNS: AmountMeasure[] = ['planned', 'committed', 'forecast', 'expected_landing'];

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
 * The period a column is edited with: its stored period; the whole year when it
 * has no stored period but already holds amounts (existing data behaves as
 * before); otherwise the suggestion from the item's dates; null when none.
 */
export function periodForEdit(year: number, record: RoundInput | null | undefined, hasAmounts: boolean, suggestion: Period | null): Period | null {
  if (record) return { start: record.period_start, end: record.period_end };
  if (hasAmounts) return wholeYear(year);
  return suggestion;
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

/** The one place a column gets its name, so configured names can replace it later. */
export function columnLabel(t: TFunction, measure: AmountMeasure): string {
  return t(COLUMN_LABEL_KEYS[measure]);
}

/** "+2 %" in the viewer's number format; empty for a zero or unreadable percentage. */
export function formatUplift(locale: string, pct: string | number | null | undefined): string {
  const n = Number(pct);
  if (!Number.isFinite(n) || n === 0) return '';
  return new Intl.NumberFormat(locale, { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: 2 }).format(n / 100);
}

/** How the column was produced: "Spread flat", "Copied from Budget 2025 +2 %", "Edited by hand". */
export function chipText(t: TFunction, locale: string, record: RoundInput | null | undefined): string {
  if (!record) return '';
  const calc = record.last_calculation;
  if (record.method === 'manual') return t('budgetTab.chip.manual');
  if (record.method === 'copied') {
    if (calc?.kind !== 'copy') return t('budgetTab.chip.copiedPlain');
    const column = columnLabel(t, calc.source_measure);
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
