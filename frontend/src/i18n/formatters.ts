export function formatNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

/**
 * App-wide amount format: European style with space thousands separators and no
 * currency symbol (e.g. 18 750). The currency is shown contextually (properties
 * panel / column header), not per value. Matches the OPEX list grid convention.
 */
export function formatAmount(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '';
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
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

// `useGrouping: 'always'` (ES2023) groups four-digit numbers too, so Spanish writes 7.486 like the
// AG Grid pagination next to it, where Intl's default would write 7486.
const COUNT_OPTIONS = { maximumFractionDigits: 0, useGrouping: 'always' } as unknown as Intl.NumberFormatOptions;

/** A count (rows, results, people) with the thousand separator of the language: 7,486, 7 486, 7.486. */
export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, COUNT_OPTIONS).format(value);
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
