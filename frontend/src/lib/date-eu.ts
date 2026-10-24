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

function isAsciiDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function countDigits(value: string): number {
  let count = 0;
  for (const char of value) if (isAsciiDigit(char)) count += 1;
  return count;
}

function groupEuDigits(digits: string, sep: DateInputSeparator): string {
  const dd = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const yyyy = digits.slice(4);
  if (digits.length <= 2) return dd;
  if (digits.length <= 4) return `${dd}${sep}${mm}`;
  return `${dd}${sep}${mm}${sep}${yyyy}`;
}

function caretAfterDigits(text: string, digitsBefore: number): number {
  if (digitsBefore <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (isAsciiDigit(text[i])) {
      seen += 1;
      if (seen === digitsBefore) return i + 1;
    }
  }
  return text.length;
}

type EuSegment = { digits: string; start: number; end: number };

/** The raw text split on its separators, empty parts included, with each part's digit range. */
function parseEuSegments(raw: string): EuSegment[] {
  const segments: EuSegment[] = [];
  let digits = '';
  let start = 0;
  for (let i = 0; i < raw.length; i += 1) {
    if (isAsciiDigit(raw[i])) {
      if (digits === '') start = i;
      digits += raw[i];
      continue;
    }
    segments.push({ digits, start, end: i });
    digits = '';
    start = i + 1;
  }
  segments.push({ digits, start, end: raw.length });
  return segments;
}

export type EuPartialFormat = { text: string; caret: number };

/**
 * Formats a partially typed date and says where the caret belongs after formatting.
 *
 * The day, month and year keep their own places. A short day or month gets its leading zero when a
 * later part exists, so typing into the middle of a date does not shift the digits that follow; the
 * zero is dropped again when the second digit arrives. Extra digits stay in the text (and make it
 * invalid) instead of being silently swallowed.
 */
export function formatEuPartialAt(raw: string, caret: number | null, sep: DateInputSeparator = '/'): EuPartialFormat {
  const value = String(raw ?? '');
  const position = Math.max(0, Math.min(caret ?? value.length, value.length));

  // A plain digit run has no part boundaries yet: group it as dd/mm/yyyy.
  if (!/[^0-9]/.test(value)) {
    const digits = value.replace(/[^0-9]/g, '');
    const text = groupEuDigits(digits, sep);
    return { text, caret: caretAfterDigits(text, countDigits(value.slice(0, position))) };
  }

  if (countDigits(value) === 0) return { text: '', caret: 0 };

  const parsed = parseEuSegments(value);
  const widths = [2, 2, 4];
  const normalized: Array<{
    rawLength: number;
    carriedIn: number;
    removed: number;
    pad: number;
    kept: string;
  }> = [];
  let carry = '';
  let partCount = Math.min(parsed.length, 3);
  for (let i = 0; i < 3; i += 1) {
    const rawDigits = parsed[i]?.digits ?? '';
    const carriedIn = carry.length;
    let combined = carry + rawDigits;
    carry = '';
    let removed = 0;
    while (combined.length > widths[i] && combined.startsWith('0')) {
      combined = combined.slice(1);
      removed += 1;
    }
    const hasLater = i < parsed.length - 1;
    let pad = 0;
    if (i < 2 && combined.length > 0 && combined.length < widths[i] && hasLater) {
      pad = widths[i] - combined.length;
    }
    let kept = combined;
    if (kept.length > widths[i] && i < 2 && !hasLater) {
      // The month is full and no separator follows yet: the next digit starts the year.
      carry = kept.slice(widths[i]);
      kept = kept.slice(0, widths[i]);
      partCount = Math.max(partCount, i + 2);
    }
    normalized.push({ rawLength: rawDigits.length, carriedIn, removed, pad, kept });
  }

  const starts: number[] = [];
  let textLength = 0;
  for (let i = 0; i < partCount; i += 1) {
    starts.push(textLength);
    textLength += normalized[i].pad + normalized[i].kept.length;
    if (i < partCount - 1) textLength += sep.length;
  }

  const parts: string[] = [];
  for (let i = 0; i < partCount; i += 1) {
    parts.push(`${'0'.repeat(normalized[i].pad)}${normalized[i].kept}`);
  }
  const text = parts.join(sep);

  let segmentIndex = -1;
  let offset = 0;
  for (let i = 0; i < parsed.length; i += 1) {
    if (position <= parsed[i].end) {
      segmentIndex = i;
      offset = countDigits(value.slice(parsed[i].start, Math.min(position, parsed[i].end)));
      break;
    }
  }
  if (segmentIndex === -1) {
    segmentIndex = parsed.length - 1;
    offset = parsed[segmentIndex].digits.length;
  }
  if (segmentIndex >= 3) return { text, caret: text.length };

  const part = normalized[segmentIndex];
  const inPart = part.pad + Math.max(0, part.carriedIn + Math.min(offset, part.rawLength) - part.removed);
  const segmentLength = part.pad + part.kept.length;
  if (inPart <= segmentLength) {
    return { text, caret: Math.min(starts[segmentIndex] + inPart, text.length) };
  }
  const overflow = inPart - segmentLength;
  if (segmentIndex + 1 < partCount) {
    return { text, caret: Math.min(starts[segmentIndex + 1] + overflow, text.length) };
  }
  return { text, caret: text.length };
}

/** Best-effort partial formatter that inserts the separator (slashes by default) as digits are typed. */
export function formatEuPartial(raw: string, sep: DateInputSeparator = '/'): string {
  return formatEuPartialAt(raw, null, sep).text;
}
