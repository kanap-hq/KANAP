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

// `useGrouping: 'always'` (ES2023) groups four-digit numbers too, so Spanish writes 7.486 like the
// AG Grid pagination next to it, where Intl's default would write 7486.
const COUNT_OPTIONS = { maximumFractionDigits: 0, useGrouping: 'always' } as unknown as Intl.NumberFormatOptions;

/** A count (rows, results, people) with the thousand separator of the language: 7,486, 7 486, 7.486. */
export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, COUNT_OPTIONS).format(value);
}

/** The thousand and decimal separators of the language, as Intl writes them. */
export function numberSeparators(locale: string): { thousand: string; decimal: string } {
  const parts = new Intl.NumberFormat(locale, { useGrouping: 'always' } as unknown as Intl.NumberFormatOptions).formatToParts(1234.5);
  return {
    thousand: parts.find((part) => part.type === 'group')?.value ?? ',',
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
  };
}
