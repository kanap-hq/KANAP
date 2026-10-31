/** Largest value stored in a PostgreSQL `integer` column (`item_number`). */
export const ITEM_NUMBER_MAX = 2_147_483_647;

/**
 * The record number in `text`, or null when it is not a PostgreSQL integer
 * from 0 through 2147483647. Leading zeros are ignored (`00012` is 12).
 * A digit string longer than 10 characters after those zeros is null, so a
 * value that would not fit in a JavaScript safe integer never reaches an
 * integer column. Empty text and any non-digit character are null.
 */
export function parseItemNumber(text: string | null | undefined): number | null {
  if (text == null) return null;
  const raw = String(text).trim();
  if (!/^\d+$/.test(raw)) return null;
  const digits = raw.replace(/^0+/, '') || '0';
  if (digits.length > 10) return null;
  const value = Number(digits);
  if (!Number.isSafeInteger(value) || value > ITEM_NUMBER_MAX) return null;
  return value;
}
