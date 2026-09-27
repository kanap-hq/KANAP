/**
 * A date cell of the OPEX and CAPEX item CSV files. The export writes
 * YYYY-MM-DD, so only that format is read, and only real calendar days: a
 * spreadsheet's local format (01/03/2026) is ambiguous, and 2026-02-30 would
 * pass a JavaScript check but fail in the database at load.
 */
export function csvDateError(field: string): string {
  return `${field} must be a valid date in YYYY-MM-DD format`;
}

/** The trimmed date, `null` for a blank cell, or `undefined` when the cell is not a YYYY-MM-DD calendar day. */
export function parseCsvDate(raw: unknown): string | null | undefined {
  const str = raw == null ? '' : String(raw).trim();
  if (str === '') return null;
  // Year 0000 does not exist in PostgreSQL.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str) || str.startsWith('0000')) return undefined;
  const day = new Date(`${str}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === str ? str : undefined;
}
