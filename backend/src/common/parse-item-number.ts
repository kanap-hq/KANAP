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

/**
 * The prefixes of the references the database numbers at insertion (suppliers, companies,
 * contacts, departments, contracts: migration 1856240000000). Their records also carry codes of
 * their own that look like one (`SUP-013`, the ERP ID of a sample supplier): a number written with
 * a leading zero is no reference of these families.
 */
const PADDED_NUMBER_REFUSED_PREFIXES: ReadonlySet<string> = new Set(['SUP', 'COMP', 'CTCT', 'DEPT', 'CTR']);

/**
 * True when `digits`, read as a number of a `prefix` reference (or as the bare number of that
 * family), is written with a leading zero in a family whose references refuse it (`SUP-013`).
 */
export function isPaddedReferenceNumber(prefix: string | null | undefined, digits: string): boolean {
  return !!prefix && PADDED_NUMBER_REFUSED_PREFIXES.has(prefix.toUpperCase()) && /^0\d/.test(digits);
}
