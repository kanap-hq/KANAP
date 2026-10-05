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

/** What a line's quantity counts: it decides how the line is priced and whether it gives FTE. */
export type QuantityUnit = 'people' | 'days' | 'pieces';
export const QUANTITY_UNITS: QuantityUnit[] = ['people', 'days', 'pieces'];

/** What the unit price is for. */
export type PriceBasis = 'per_day' | 'per_month' | 'per_piece';

/** How often the quantity counts: every month of the period (people), once over it (days), or either (pieces). */
export type Frequency = 'per_month' | 'once';

/** The prices each unit allows, the first one being the default. */
export const BASES_BY_UNIT: Record<QuantityUnit, PriceBasis[]> = {
  people: ['per_day', 'per_month'],
  days: ['per_day'],
  pieces: ['per_piece'],
};

/** How often each unit may count: people every month, days once over their period (a bundle), pieces either. */
export const FREQUENCIES_BY_UNIT: Record<QuantityUnit, Frequency[]> = {
  people: ['per_month'],
  days: ['once'],
  pieces: ['per_month', 'once'],
};

/** How often a line counts when it takes a unit. */
export const DEFAULT_FREQUENCY: Record<QuantityUnit, Frequency> = {
  people: 'per_month',
  days: 'once',
  pieces: 'once',
};

/** True when the line says how many days a month its people work: people priced per day. */
export function takesDaysPerMonth(line: { quantity_unit: QuantityUnit; price_basis: PriceBasis }): boolean {
  return line.quantity_unit === 'people' && line.price_basis === 'per_day';
}

/** The price a line keeps when its unit changes: the same when the unit allows it, else the unit's default. */
export function basisForUnit(unit: QuantityUnit, basis: PriceBasis): PriceBasis {
  const allowed = BASES_BY_UNIT[unit];
  return allowed.includes(basis) ? basis : allowed[0];
}

/**
 * A line counted once, on one date: pieces bought once. It is stored from = to = that date, so it
 * lands in the date's month. A range sent by another client stays a range.
 */
export function isDateLine(line: { quantity_unit: QuantityUnit; frequency: Frequency; period_start: string; period_end: string }): boolean {
  return line.quantity_unit === 'pieces' && line.frequency === 'once' && line.period_start === line.period_end;
}

/** A stored line of a column, in `sort` order. Decimals are plain strings. */
export type RoundLine = {
  id: string;
  sort: number;
  label: string;
  quantity_unit: QuantityUnit;
  quantity: string;
  unit_price: string;
  price_basis: PriceBasis;
  frequency: Frequency;
  /** People priced per day: the days they work each month; null is full time (the calendar's working days). */
  days_per_month: string | null;
  period_start: string;
  period_end: string;
  working_day_profile_id: string | null;
  working_day_profile_code: string | null;
  working_day_profile_name: string | null;
};

/** One line of the explanation of a computation: what it was computed with, and its result. */
export type LineCalculation = {
  label: string;
  quantity_unit: QuantityUnit;
  quantity: string;
  unit_price: string;
  price_basis: PriceBasis;
  frequency: Frequency;
  /** People priced per day: the days they work each month; null is full time (the calendar's working days). */
  days_per_month: string | null;
  period_start: string;
  period_end: string;
  working_day_profile_id: string | null;
  working_day_profile_code: string | null;
  working_day_profile_name: string | null;
  active_months: number[];
  day_counts: string[] | null;
  total_days: string | null;
  month_amounts: string[];
  fte_months: string[];
  /** The line's FTE: the full-year average, and the average over its active months. */
  fte: string | null;
  fte_period: string | null;
  total: string;
};

/** The explanation of a column computed from its lines. Months are 1..12, arrays hold twelve values. */
export type LinesCalculation = {
  kind: 'computed';
  total: string;
  /** The column's FTE: the full-year average (as stored and listed), and the average over its active months. */
  fte: string | null;
  fte_period: string | null;
  month_amounts: string[];
  fte_months: string[];
  active_months: number[];
  lines: LineCalculation[];
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
  | LinesCalculation;

export type RoundInput = {
  measure: AmountMeasure;
  period_start: string;
  period_end: string;
  method: RoundMethod;
  spread_profile_name: string | null;
  last_calculation: LastCalculation | null;
  updated_at: string;
  updated_by: string | null;
  /** The column's yearly FTE from its lines; null without lines. */
  fte: string | null;
  /** The column's lines, kept as a reference after a hand edit or a spread; empty without lines. */
  lines: RoundLine[];
};

/** A line as `bulk-upsert` `kind: 'lines'` takes it. */
export type LinePayload = {
  label: string;
  quantity_unit: QuantityUnit;
  quantity: string;
  unit_price: string;
  price_basis: PriceBasis;
  frequency: Frequency;
  /** People priced per day: the days they work each month; null is full time (the calendar's working days). */
  days_per_month: string | null;
  period_start: string;
  period_end: string;
  working_day_profile_id: string | null;
};

/** Body of `bulk-upsert` with `kind: 'lines'`: the column's lines, replaced wholesale ([] removes them). */
export type LinesRequest = {
  kind: 'lines';
  year: number;
  measure: AmountMeasure;
  also_measures?: AmountMeasure[];
  lines: LinePayload[];
};

/** True when the column keeps lines, computed from them or kept as a reference. */
export function hasLines(record: RoundInput | null | undefined): record is RoundInput {
  return (record?.lines?.length ?? 0) > 0;
}

/**
 * True when the column's amounts come from its lines: it has lines and was computed from them. A
 * spread, a hand edit or a copy keeps the lines as a reference only.
 */
export function followsLines(record: RoundInput | null | undefined): boolean {
  return hasLines(record) && record.method === 'computed';
}

/** A decimal string without trailing zeros ("1.000" is "1", "400.5000" is "400.5"), so lines compare by value. */
export function trimDecimal(value: string | number | null | undefined): string {
  const text = String(value ?? '').trim();
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) return text;
  const [, sign, int, frac = ''] = match;
  const digits = int.replace(/^0+(?=\d)/, '');
  const decimals = frac.replace(/0+$/, '');
  if (digits === '0' && !decimals) return '0';
  return `${sign}${digits}${decimals ? `.${decimals}` : ''}`;
}

/** A stored line (or a line of the explanation) as it would be sent again. */
export function linePayloadOf(line: LinePayload): LinePayload {
  return {
    label: line.label.trim(),
    quantity_unit: line.quantity_unit,
    quantity: trimDecimal(line.quantity),
    unit_price: trimDecimal(line.unit_price),
    price_basis: line.price_basis,
    frequency: line.frequency,
    days_per_month: takesDaysPerMonth(line) && line.days_per_month != null ? trimDecimal(line.days_per_month) : null,
    period_start: line.period_start,
    period_end: line.period_end,
    working_day_profile_id: line.price_basis === 'per_day' ? line.working_day_profile_id : null,
  };
}

/** True when two lines ask for the same computation. */
export function sameLine(a: LinePayload, b: LinePayload): boolean {
  return JSON.stringify(linePayloadOf(a)) === JSON.stringify(linePayloadOf(b));
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

export type DateProblem = 'dateMissing' | 'dateInvalid' | 'dateOutsideYear';

/** Why the one date of a line cannot be saved, or null when it can: any real date in `year`. */
export function dateProblem(year: number, date: string): DateProblem | null {
  if (!date) return 'dateMissing';
  if (!isYmd(date)) return 'dateInvalid';
  return date.slice(0, 4) === String(year) ? null : 'dateOutsideYear';
}

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
 * A decimal string from the server (days, FTE, quantity, price) as the budget tab writes numbers:
 * space groups, dot decimals, no trailing zeros ("163", "171.75", "0.75"). Read from the string.
 */
export function formatDecimal(value: string | null | undefined): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value ?? '').trim());
  if (!match) return String(value ?? '');
  const [, sign, int, frac = ''] = match;
  const decimals = frac.replace(/0+$/, '');
  const grouped = int.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  if (grouped === '0' && !decimals) return '0';
  return `${sign}${grouped}${decimals ? `.${decimals}` : ''}`;
}

/** FTE as the server rounds it, always two decimals ("1.00", "0.75"). Read from the string. */
export function formatFteValue(value: string | null | undefined): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value ?? '').trim());
  if (!match) return String(value ?? '');
  const [, sign, int, frac = ''] = match;
  const grouped = int.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${grouped}.${frac.padEnd(2, '0').slice(0, 2)}`;
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

/** True when a line counts days or people: pieces give no FTE. */
export function countsFte(lines: Array<{ quantity_unit: QuantityUnit }> | null | undefined): boolean {
  return (lines ?? []).some((line) => line.quantity_unit !== 'pieces');
}

/** True when the column's FTE means something: a line counts days or people. */
function linesGiveFte(record: RoundInput): boolean {
  return record.fte != null && countsFte(record.lines);
}

/**
 * How the column was produced, in parts that a narrow header wraps whole, grouped by line: "Spread
 * flat", "Copied from Budget 2025 +2 %", "Edited by hand", or "Quantity and price" then "3 lines ·
 * 1.00 FTE". A column that keeps lines it was not computed from shows them first, then on its own
 * line what produced the amounts ("Spread 4-4-5", "Edited by hand").
 */
function chipParts(
  t: TFunction,
  locale: string,
  record: RoundInput | null | undefined,
  nameOf: (measure: AmountMeasure) => string,
): string[][] {
  if (!record) return [];
  if ((record.lines?.length ?? 0) === 0) return [[record.method === 'computed' ? t('budgetTab.chip.lines') : methodPart(t, locale, record, nameOf)]];
  const detail = [
    t('budgetTab.chip.lineCount', { count: record.lines.length }),
    linesGiveFte(record) ? t('budgetTab.chip.fte', { value: formatFteValue(record.fte) }) : '',
  ].filter(Boolean).join(' · ');
  const lines = [t('budgetTab.chip.lines'), detail];
  return record.method === 'computed' ? [lines] : [lines, [methodPart(t, locale, record, nameOf)]];
}

/** What produced the amounts of a column not computed from its lines. */
function methodPart(
  t: TFunction,
  locale: string,
  record: RoundInput,
  nameOf: (measure: AmountMeasure) => string,
): string {
  const calc = record.last_calculation;
  if (record.method === 'manual') return t('budgetTab.chip.manual');
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
 * How the column was produced: "Spread flat", "Copied from Budget 2025 +2 %", "Edited by hand",
 * "Quantity and price · 3 lines · 1.00 FTE", "Quantity and price · 3 lines · Spread 4-4-5".
 * `nameOf` names the source column of a copy (the tenant's names; the product names by default).
 */
export function chipText(
  t: TFunction,
  locale: string,
  record: RoundInput | null | undefined,
  nameOf: (measure: AmountMeasure) => string = (measure) => columnLabel(t, measure),
): string {
  return chipParts(t, locale, record, nameOf).flat().join(' · ');
}

/**
 * The chip in the units a narrow header wraps whole, one array per line of text: "Quantity and price ·"
 * then "3 lines · 1.00 FTE", so the count never ends a line alone; what produced the amounts of a
 * column that keeps lines starts a line of its own. Joined with spaces, the units read as `chipText`.
 */
export function chipLines(
  t: TFunction,
  locale: string,
  record: RoundInput | null | undefined,
  nameOf: (measure: AmountMeasure) => string = (measure) => columnLabel(t, measure),
): string[][] {
  const lines = chipParts(t, locale, record, nameOf);
  const last = lines.flat().length - 1;
  let index = 0;
  return lines.map((parts) => parts.map((part) => (index++ < last ? `${part} ·` : part)));
}

/** The chip's units, every line of it in a row: `chipLines` flattened. */
export function chipUnits(
  t: TFunction,
  locale: string,
  record: RoundInput | null | undefined,
  nameOf: (measure: AmountMeasure) => string = (measure) => columnLabel(t, measure),
): string[] {
  return chipLines(t, locale, record, nameOf).flat();
}

function shortMonth(locale: string, month: number): string {
  return new Date(2000, month - 1, 1).toLocaleString(locale, { month: 'short' });
}

/** The sentence of a line, by what it counts ("1 person × 1 200 per day, 5 days per month"). */
function lineSentenceKey(line: Pick<RoundLine, 'quantity_unit' | 'price_basis' | 'frequency' | 'days_per_month'>): string {
  if (line.quantity_unit === 'people') {
    if (line.price_basis === 'per_month') return 'people_per_month';
    return line.days_per_month == null ? 'people_full_time' : 'people_days';
  }
  if (line.quantity_unit === 'days') return 'days';
  return line.frequency === 'once' ? 'pieces_once' : 'pieces_per_month';
}

/** One line in words: "Project manager: 1 person × 1 200 per day, 5 days per month, Feb to Jul". */
export function lineText(
  t: TFunction,
  locale: string,
  line: Pick<RoundLine, 'label' | 'quantity_unit' | 'quantity' | 'unit_price' | 'price_basis' | 'frequency' | 'days_per_month' | 'period_start' | 'period_end'>,
): string {
  const year = Number(line.period_start.slice(0, 4));
  // A line bought once on one date (pieces, or days written by the API) lands in that date's month.
  const months = line.frequency === 'once' && line.period_start === line.period_end && isYmd(line.period_start)
    ? [Number(line.period_start.slice(5, 7))]
    : activeMonths(year, line.period_start, line.period_end);
  const when = months.length === 0 ? ''
    : months.length === 1 ? shortMonth(locale, months[0])
      : t('budgetTab.monthRange', { from: shortMonth(locale, months[0]), to: shortMonth(locale, months[months.length - 1]) });
  const days = line.days_per_month == null ? ''
    : t('budgetTab.lines.daysPerMonthCount', { count: Number(line.days_per_month), value: formatDecimal(line.days_per_month) });
  const text = t(`budgetTab.lines.lineText.${lineSentenceKey(line)}`, {
    quantity: t(`budgetTab.lines.count.${line.quantity_unit}`, { count: Number(line.quantity), value: formatDecimal(line.quantity) }),
    price: formatDecimal(line.unit_price),
    days,
    months: when,
  });
  const label = line.label.trim();
  return label ? t('budgetTab.lines.labeled', { label, text }) : text;
}

/**
 * The lines of a column, one per text line, for a tooltip; empty without lines. A column that keeps
 * lines it was not computed from lists them too: its chip names them.
 */
export function linesText(t: TFunction, locale: string, record: RoundInput | null | undefined): string {
  if (!hasLines(record)) return '';
  return record.lines.map((line) => lineText(t, locale, line)).join('\n');
}

/**
 * The active months whose working days differ between the last computation (`before`) and the
 * calendar now (`after`), compared by value.
 */
export function changedDays(
  before: string[] | null | undefined,
  after: string[] | null | undefined,
  months: number[],
): Array<{ month: number; before: string; after: string }> {
  if (!before || !after) return [];
  return months
    .filter((m) => before[m - 1] != null && after[m - 1] != null && Number(before[m - 1]) !== Number(after[m - 1]))
    .map((m) => ({ month: m, before: before[m - 1], after: after[m - 1] }));
}

/** "March: 20 days, now 19". */
export function dayChangeText(t: TFunction, locale: string, change: { month: number; before: string; after: string }): string {
  return t('budgetTab.lines.dayChange', {
    count: Number(change.before),
    month: capitalize(monthName(locale, change.month), locale),
    before: formatDecimal(change.before),
    after: formatDecimal(change.after),
  });
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
