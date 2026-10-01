import { parseDecimalLiteral, rescale } from './decimal';

export type AmountInput = string | number | bigint | null | undefined;

/** Amount columns are numeric(18,2): at most 16 digits before the decimal point, so |cents| < 10^18. */
export const CENTS_LIMIT = 10n ** 18n;

/**
 * Convert an amount into cents (a bigint with 2 decimal precision).
 *
 * The value is read as a decimal, never through binary floating point: a
 * number is taken in its shortest round-trip form (`String(1.005)` is
 * "1.005"), a string is parsed digit by digit (whitespace and `_` are ignored,
 * a comma is a decimal separator, exponent notation is accepted). It is then
 * rounded half away from zero at the third decimal: "1.005" is 101 cents,
 * "-1.125" is -113.
 *
 * Empty, null and undefined are zero, as is a non-finite number; any other
 * input that is not a decimal throws `Invalid amount`.
 */
export function toCents(value: AmountInput): bigint {
  if (value == null) return 0n;
  if (typeof value === 'number' && !Number.isFinite(value)) return 0n;
  if (typeof value === 'string' && value.trim() === '') return 0n;
  const { mantissa, scale } = parseDecimalLiteral(value);
  return rescale(mantissa, scale, 2);
}

export function addCents(current: bigint, value: AmountInput): bigint {
  return current + toCents(value);
}

export function formatCents(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const str = abs.toString().padStart(3, '0');
  const intPart = str.length > 2 ? str.slice(0, -2) : '0';
  const decPart = str.slice(-2);
  const formatted = decPart === '00' ? intPart : `${intPart}.${decPart}`;
  return neg ? `-${formatted}` : formatted;
}

export function formatAmount(value: AmountInput): string {
  return formatCents(toCents(value));
}
