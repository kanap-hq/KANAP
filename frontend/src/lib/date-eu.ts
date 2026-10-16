// Utilities for typed day-first dates: dd/mm/yyyy, or dd.mm.yyyy in German (dateInputSeparator).
// Parsing accepts '/', '.' and '-' in every language.

function pad2(n: number): string { return String(n).padStart(2, '0'); }

export type DateInputSeparator = '/' | '.';

/** The separator of a typed date in a language: German writes 15.10.2026, the others 15/10/2026. */
export function dateInputSeparator(locale?: string | null): DateInputSeparator {
  return String(locale || 'en').split('-')[0].toLowerCase() === 'de' ? '.' : '/';
}

export function isoToEuDate(iso?: string | null, sep: DateInputSeparator = '/'): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dd = pad2(d.getDate());
  const mm = pad2(d.getMonth() + 1);
  const yyyy = d.getFullYear();
  return `${dd}${sep}${mm}${sep}${yyyy}`;
}

/**
 * Parse a dd/mm/yyyy (or dd-mm-yyyy / dd.mm.yyyy) string into an end-of-day ISO string.
 * Returns null if the input is empty or invalid.
 */
export function euDateToIsoEndOfDay(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  // Accept dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy
  const parts = trimmed.replace(/[.\-]/g, '/').split('/');
  if (parts.length !== 3) return null;
  const [ddStr, mmStr, yyyyStr] = parts;
  const dd = Number(ddStr);
  const mm = Number(mmStr);
  const yyyy = Number(yyyyStr);
  if (!Number.isInteger(dd) || !Number.isInteger(mm) || !Number.isInteger(yyyy)) return null;
  if (yyyy < 1900 || yyyy > 9999) return null;
  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;
  // Basic month/day validation (avoids 31 Feb). JS Date will roll over; we prevent that.
  const maxDay = new Date(yyyy, mm, 0).getDate();
  if (dd > maxDay) return null;
  const local = new Date(yyyy, mm - 1, dd, 23, 59, 0, 0);
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString();
}

/** Returns today's date as dd/mm/yyyy */
export function todayEu(): string {
  const t = new Date();
  return `${pad2(t.getDate())}/${pad2(t.getMonth() + 1)}/${t.getFullYear()}`;
}

/** Convert dd/mm/yyyy to YYYY-MM-DD (string), or '' if invalid/empty. */
export function euToYmd(value?: string | null): string {
  if (!value) return '';
  const iso = euDateToIsoEndOfDay(value);
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Convert YYYY-MM-DD to dd/mm/yyyy (or with `sep`); returns '' when invalid/empty. */
export function ymdToEu(value?: string | null, sep: DateInputSeparator = '/'): string {
  if (!value) return '';
  const parts = String(value).split('-');
  if (parts.length !== 3) return '';
  const [y, m, d] = parts;
  const yyyy = Number(y), mm = Number(m), dd = Number(d);
  if (!yyyy || !mm || !dd) return '';
  const dt = new Date(yyyy, mm - 1, dd);
  if (Number.isNaN(dt.getTime())) return '';
  const dd2 = String(dd).padStart(2, '0');
  const mm2 = String(mm).padStart(2, '0');
  return `${dd2}${sep}${mm2}${sep}${yyyy}`;
}

/** Best-effort partial formatter that inserts the separator (slashes by default) as digits are typed. */
export function formatEuPartial(raw: string, sep: DateInputSeparator = '/'): string {
  const digits = String(raw).replace(/[^0-9]/g, '').slice(0, 8);
  const dd = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);
  if (digits.length <= 2) return dd;
  if (digits.length <= 4) return `${dd}${sep}${mm}`;
  return `${dd}${sep}${mm}${sep}${yyyy}`;
}
