import { formatDecimal } from '../../i18n/formatters';

function language(locale: string): string {
  return locale.toLowerCase().split('-')[0];
}

/**
 * A portfolio figure rounded the way `toFixed` rounds, then written with the
 * separators of the interface language. Trailing zeros are dropped, so 2 stays 2
 * and 6.5 is 6,5 in French.
 */
export function formatFigure(value: number, locale: string, digits = 1): string {
  const n = Number.isFinite(value) ? value : 0;
  return formatDecimal(Number(n.toFixed(digits)), locale, digits);
}

/**
 * A figure that English still writes with `toFixed` (2.00, 1.5). French, German
 * and Spanish use the same rounding and drop the trailing zeros (2, 1,5).
 */
export function formatLocaleFigure(value: number, locale: string, digits: number): string {
  const n = Number.isFinite(value) ? value : 0;
  if (language(locale) === 'en') return n.toFixed(digits);
  return formatFigure(n, locale, digits);
}
