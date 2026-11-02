export function formatNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

// `useGrouping: 'always'` (ES2023) groups four-digit numbers too, so Spanish writes 7.486 like the
// AG Grid pagination next to it, where Intl's default would write 7486.
const WHOLE_NUMBER_OPTIONS = { maximumFractionDigits: 0, useGrouping: 'always' } as unknown as Intl.NumberFormatOptions;

// One formatter per locale: building one is far slower than formatting a cell.
const wholeAmountFormatters = new Map<string, Intl.NumberFormat>();

function wholeAmountFormatter(locale: string): Intl.NumberFormat {
  let formatter = wholeAmountFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, WHOLE_NUMBER_OPTIONS);
    wholeAmountFormatters.set(locale, formatter);
  }
  return formatter;
}

/**
 * A whole amount with no currency symbol. The currency is shown beside the value
 * (a column header, a properties panel).
 *
 * Without a language, thousands stay separated by a space (18 750). The rest of
 * the app still uses that form.
 * With a language, the separators follow it: 650,000 in English, 650.000 in
 * German and Spanish, 650 000 in French. Grouping applies under 10 000 too.
 */
export function formatAmount(value: number | null | undefined, locale?: string): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '';
  const rounded = Math.round(n);
  if (!locale) return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return wholeAmountFormatter(locale).format(rounded);
}

export function formatCurrency(
  value: number,
  locale: string,
  currency: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    ...options,
  }).format(value);
}

/**
 * An amount in euro as the interface language writes money: 0,00 EUR in French,
 * EUR 0.00 in English. `fractionDigits` keeps the two cents of a total, or the
 * four decimals of a sub-cent agent estimate.
 */
export function formatEuro(value: number, locale: string, fractionDigits = 2): string {
  const amount = Number.isFinite(value) ? value : 0;
  return formatCurrency(amount, locale, 'EUR', {
    currencyDisplay: 'code',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    useGrouping: 'always',
  } as unknown as Intl.NumberFormatOptions);
}

/** A count (rows, results, people) with the thousand separator of the language: 7,486, 7 486, 7.486. */
export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, WHOLE_NUMBER_OPTIONS).format(value);
}

/** A decimal (turnover, a total that keeps a fraction) with the separators of the language. */
export function formatDecimal(value: number, locale: string, maximumFractionDigits = 3): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits,
    useGrouping: 'always',
  } as unknown as Intl.NumberFormatOptions).format(value);
}

const EM_DASH = '\u2014';

/** The gap before k, M or B: none in English (340.1k), a no-break space in French, German and Spanish (340,1 k). */
function compactUnitGap(locale: string): string {
  return locale.toLowerCase().split('-')[0] === 'en' ? '' : '\u00a0';
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : null;
}

/**
 * An overview amount in thousands of the interface language: 7,846k in English, 7 846 k in French.
 * Rounded to the nearest thousand. An unreadable amount is an em dash.
 */
export function formatThousandsAmount(value: unknown, locale: string): string {
  const n = finiteNumber(value);
  if (n == null) return EM_DASH;
  const thousands = Math.round(n / 1000);
  return `${formatCount(thousands === 0 ? 0 : thousands, locale)}${compactUnitGap(locale)}k`;
}

const COMPACT_TIERS = [
  { at: 1_000_000_000, unit: 'B' },
  { at: 1_000_000, unit: 'M' },
  { at: 1_000, unit: 'k' },
] as const;

/**
 * A short amount for a change, in the interface language.
 * Below one thousand the amount stays as it is (300). Above that, one decimal and a unit: 340.1k, 340,1 k, 1.5M.
 */
export function formatCompactAmount(value: unknown, locale: string): string {
  const n = finiteNumber(value);
  if (n == null) return EM_DASH;
  const abs = Math.abs(n === 0 ? 0 : n);
  const tier = COMPACT_TIERS.find((item) => abs >= item.at);
  if (!tier) return formatDecimal(n === 0 ? 0 : n, locale, 1);
  return `${formatDecimal(n / tier.at, locale, 1)}${compactUnitGap(locale)}${tier.unit}`;
}

/**
 * A ratio already written in percent points (4.95 means 4.95%, not 495%).
 * `fractionDigits` keeps the one or two decimals the report already showed.
 */
export function formatPercentPoints(value: number, locale: string, fractionDigits: number): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value / 100);
}

/** A grid share cell: blank when the share is absent, otherwise `formatPercentPoints`. */
export function formatSharePercent(value: unknown, locale: string, fractionDigits: number): string {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return formatPercentPoints(n, locale, fractionDigits);
}

/** The thousand and decimal separators of the language, as Intl writes them. */
export function numberSeparators(locale: string): { thousand: string; decimal: string } {
  const parts = new Intl.NumberFormat(locale, { useGrouping: 'always' } as unknown as Intl.NumberFormatOptions).formatToParts(1234.5);
  return {
    thousand: parts.find((part) => part.type === 'group')?.value ?? ',',
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
  };
}

/** The decimal mark of the application language: a comma in French, German and Spanish, a point in English. */
export function decimalMark(locale: string): '.' | ',' {
  return numberSeparators(locale).decimal === ',' ? ',' : '.';
}

const NO_BREAK_SPACE = '\u00a0';
const NARROW_NO_BREAK_SPACE = '\u202f';

/**
 * French typography, applied to the text instead of the locale files: a no-break space inside
 * guillemets and before a colon, a narrow no-break space before a semicolon, an exclamation mark
 * and a question mark. Only an ordinary space changes, so a text that already follows the rule and
 * a text without a space stay as they are.
 */
export function frenchSpacing(value: string): string {
  return value
    .replace(/« /g, `«${NO_BREAK_SPACE}`)
    .replace(/ »/g, `${NO_BREAK_SPACE}»`)
    .replace(/ :/g, `${NO_BREAK_SPACE}:`)
    .replace(/ ([;!?])/g, `${NARROW_NO_BREAK_SPACE}$1`);
}
