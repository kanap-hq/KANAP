/**
 * Account numbers and consolidation numbers: whole numbers greater than zero, at most 15 digits.
 * The server holds the same bound (`backend/src/accounts/account-number.ts`); 15 digits stay
 * exact as JavaScript numbers.
 */
export const ACCOUNT_NUMBER_MAX_DIGITS = 15;
export const ACCOUNT_NUMBER_MAX = 10 ** ACCOUNT_NUMBER_MAX_DIGITS - 1;

/** A typed account number (digits only, leading zeros dropped), or null when it is not one. */
export function parseAccountNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const significant = trimmed.replace(/^0+/, '');
  if (significant === '' || significant.length > ACCOUNT_NUMBER_MAX_DIGITS) return null;
  return Number(significant);
}

/** A stored account number as a number: the server may send a large number as text. */
export function toAccountNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
