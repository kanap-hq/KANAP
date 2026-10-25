import { csvProfile, dateOrderNotice } from './language';
import { CsvDateOrder, CsvLanguage, CsvParsedDate } from './types';

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
// A full timestamp: calendar day, T, hours to seconds, optional fraction, Z or ±HH:mm.
const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?([Zz]|[+-]\d{2}:\d{2})$/;
const YEAR_FIRST = /^(\d{4})([/.\-])(\d{1,2})\2(\d{1,2})(?: +(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const DAY_MONTH = /^(\d{1,2})([/.\-])(\d{1,2})\2(\d{4})(?: +(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

export type ParsedDateCell =
  | { ok: true; blank: false; value: CsvParsedDate }
  | { ok: false; blank: true }
  | { ok: false; blank: false; clear: true }
  | { ok: false; blank: false };

export interface DateOrderDecision {
  order: CsvDateOrder | null;
  settledByFile: boolean;
  source: 'file' | 'switch' | 'export' | 'language' | null;
  notice: string | null;
  error: string | null;
}

/**
 * Settle day or month first. A part above 12 settles it. When both orders
 * appear, the file is refused. Without evidence, use the preflight switch,
 * then the export's language hint, then the screen language.
 */
export function resolveDateOrder(
  texts: readonly string[],
  language: CsvLanguage,
  override?: CsvDateOrder,
  hint?: CsvLanguage,
): DateOrderDecision {
  let dayFirst: string | null = null;
  let monthFirst: string | null = null;
  let ambiguous = false;
  for (const raw of texts) {
    const text = raw.trim();
    const local = DAY_MONTH.exec(text);
    if (!local) continue;
    if (ISO_DAY.test(text) || ISO_TIMESTAMP.test(text)) continue;
    const first = Number(local[1]);
    const second = Number(local[3]);
    if (first > 12 && second > 12) continue;
    if (first > 12) dayFirst ??= text;
    else if (second > 12) monthFirst ??= text;
    else ambiguous = true;
  }

  if (dayFirst && monthFirst) {
    return {
      order: null,
      settledByFile: false,
      source: null,
      notice: null,
      error: `This file uses both date orders (${dayFirst} and ${monthFirst}).`,
    };
  }
  const evidence: CsvDateOrder | null = dayFirst ? 'day-first' : monthFirst ? 'month-first' : null;
  if (evidence && override && override !== evidence) {
    const shown = evidence === 'day-first' ? dayFirst : monthFirst;
    const which = evidence === 'day-first' ? 'day first' : 'month first';
    return {
      order: null,
      settledByFile: false,
      source: null,
      notice: null,
      error: `This file shows dates ${which} (${shown}). The date order cannot be switched.`,
    };
  }
  if (evidence) return { order: evidence, settledByFile: true, source: 'file', notice: null, error: null };
  if (!ambiguous) return { order: null, settledByFile: false, source: null, notice: null, error: null };
  const order = override ?? csvProfile(hint ?? language).dateOrder;
  const source = override ? 'switch' : hint ? 'export' : 'language';
  return { order, settledByFile: false, source, notice: dateOrderNotice(order), error: null };
}

/** One date cell. `order` is required for a local day or month form. Empty is blank, not an error. */
export function parseCsvDateCell(raw: string, order: CsvDateOrder | null): ParsedDateCell {
  const text = raw.trim();
  if (text === '') return { ok: false, blank: true };
  // `-` clears a detail that allows it. It is not an invalid date.
  if (text === '-') return { ok: false, blank: false, clear: true };
  if (text.startsWith('0000')) return { ok: false, blank: false };

  const instant = parseInstant(text);
  if (instant) return { ok: true, blank: false, value: instant };
  if (ISO_TIMESTAMP.test(text)) return { ok: false, blank: false };

  const iso = ISO_DAY.exec(text);
  if (iso) {
    const value = calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]), null);
    return value ? { ok: true, blank: false, value } : { ok: false, blank: false };
  }

  const yearFirst = YEAR_FIRST.exec(text);
  if (yearFirst && !ISO_DAY.test(text)) {
    const time = clock(yearFirst[5], yearFirst[6], yearFirst[7]);
    if (yearFirst[5] != null && !time) return { ok: false, blank: false };
    const value = calendarDate(Number(yearFirst[1]), Number(yearFirst[3]), Number(yearFirst[4]), time);
    return value ? { ok: true, blank: false, value } : { ok: false, blank: false };
  }

  const local = DAY_MONTH.exec(text);
  if (!local) return { ok: false, blank: false };
  if (!order) return { ok: false, blank: false };
  const time = clock(local[5], local[6], local[7]);
  if (local[5] != null && !time) return { ok: false, blank: false };
  const first = Number(local[1]);
  const second = Number(local[3]);
  const year = Number(local[4]);
  const day = order === 'day-first' ? first : second;
  const month = order === 'day-first' ? second : first;
  const value = calendarDate(year, month, day, time);
  return value ? { ok: true, blank: false, value } : { ok: false, blank: false };
}

/**
 * A calendar day in the user's language, or an ISO timestamp when the value
 * has a time. English calendar days stay `YYYY-MM-DD`.
 */
export function formatCsvDate(value: string, language: CsvLanguage): string {
  const text = value.trim();
  if (ISO_TIMESTAMP.test(text)) {
    const instant = parseInstant(text);
    if (!instant || instant.kind !== 'instant') throw new Error(`Invalid date '${value}'.`);
    return instant.iso;
  }
  const iso = ISO_DAY.exec(text);
  if (!iso) throw new Error(`Invalid date '${value}'.`);
  const year = Number(iso[1]);
  const month = Number(iso[2]);
  const day = Number(iso[3]);
  if (!isRealDay(year, month, day)) throw new Error(`Invalid date '${value}'.`);
  const mm = iso[2];
  const dd = iso[3];
  if (language === 'en') return `${iso[1]}-${mm}-${dd}`;
  if (language === 'de') return `${dd}.${mm}.${iso[1]}`;
  return `${dd}/${mm}/${iso[1]}`;
}

/**
 * An instant written for a file: its calendar day the language's way, then the
 * time, both as a clock in `timeZone` shows them (`16/10/2026 10:38` in
 * Europe/Paris for 08:38 UTC; `2026-10-16 08:38:59` in UTC). Seconds only when
 * set. The shared reader takes this form back (`parseCsvDateCell`), and
 * `instantInTimeZone` turns it into the instant again; the header of the column
 * names the zone (`timeZoneHeader`). An unreadable value is written as given.
 */
export function formatCsvDateTime(value: Date | string, language: CsvLanguage, timeZone = 'UTC'): string {
  const date = value instanceof Date ? value : new Date(String(value).trim());
  if (Number.isNaN(date.getTime())) return String(value);
  const wall = new Date(date.getTime() + zoneOffset(date.getTime(), timeZone)).toISOString();
  const seconds = wall.slice(17, 19);
  return `${formatCsvDate(wall.slice(0, 10), language)} ${wall.slice(11, 16)}${seconds === '00' ? '' : `:${seconds}`}`;
}

/**
 * An instant as an ISO date-time in `timeZone`, with the zone's explicit offset
 * at that instant (`2026-06-02T07:50:00+02:00`). Used where a reader must not
 * guess the zone, such as the AI tool results. A value that is not a date, and
 * a zone nobody knows, give null. Date-only values are not written this way:
 * a reader keeps their calendar day.
 */
export function isoDateTimeInTimeZone(value: Date | string, timeZone: string): string | null {
  if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}T/.test(value.trim())) return null;
  const date = value instanceof Date ? value : new Date(String(value).trim());
  const epochMs = date.getTime();
  if (Number.isNaN(epochMs)) return null;
  let offsetMs: number;
  try {
    offsetMs = zoneOffset(epochMs, timeZone);
  } catch {
    return null;
  }
  const wall = new Date(epochMs + offsetMs).toISOString();
  const offsetMinutes = Math.round(offsetMs / 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const minutes = String(absolute % 60).padStart(2, '0');
  const milliseconds = wall.slice(20, 23);
  return `${wall.slice(0, 19)}${milliseconds === '000' ? '' : `.${milliseconds}`}${sign}${hours}:${minutes}`;
}

/**
 * The instant a clock in `timeZone` shows as this day and time (`HH:mm` or
 * `HH:mm:ss`; no time is the zone's midnight). In the hour the clocks repeat
 * in autumn, the second pass is taken; a time the clocks skip in spring reads
 * as the instant one hour later on the clock.
 */
export function instantInTimeZone(isoDate: string, time: string | null, timeZone: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  const [hour, minute, second] = (time ?? '00:00').split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute, second || 0);
  const first = wall - zoneOffset(wall, timeZone);
  return new Date(wall - zoneOffset(first, timeZone));
}

/** The zone's canonical IANA name (`europe/paris` is Europe/Paris), or null for a zone nobody knows. */
export function knownTimeZone(value: string | null | undefined): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: text }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/**
 * The header of a date-time column: the stable column name, then the zone its
 * cells are written in (`detected_at (Europe/Paris)`).
 */
export function timeZoneHeader(column: string, timeZone: string): string {
  return `${column} (${timeZone})`;
}

/** A header that names a zone, split into its column and its zone (as written, unchecked); null otherwise. */
export function readTimeZoneHeader(header: string): { column: string; zone: string } | null {
  const match = /^\s*(.*?\S)\s*\(\s*([^()]*?)\s*\)\s*$/.exec(header);
  return match ? { column: match[1], zone: match[2] } : null;
}

const ZONE_CLOCKS = new Map<string, Intl.DateTimeFormat>();

/** How far the zone's clocks are ahead of UTC at this instant, in milliseconds. */
function zoneOffset(epochMs: number, timeZone: string): number {
  let clock = ZONE_CLOCKS.get(timeZone);
  if (!clock) {
    clock = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    ZONE_CLOCKS.set(timeZone, clock);
  }
  const parts: Record<string, number> = {};
  for (const part of clock.formatToParts(new Date(epochMs))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return wall - Math.floor(epochMs / 1000) * 1000;
}

/**
 * A stored end of validity written for a file: its calendar day (UTC), the
 * language's way. The time of day is left out so a spreadsheet reads the cell
 * as a date. A day picked by a user is stored at noon UTC, so it writes the
 * day picked; an instant set by the switch writes its day, and that day read
 * back keeps the instant (`keepStoredEndOfValidity`).
 */
export function formatCsvEndOfValidity(iso: string | null, language: CsvLanguage): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return formatCsvDate(date.toISOString().slice(0, 10), language);
}

/**
 * The end of validity an import writes, against the stored one. A day read
 * from a file is noon UTC (`endOfValidityFromDate`). When it is the stored
 * instant's day, the file says what the export wrote: the stored instant comes
 * back, time of day included, so the row stays unchanged. Anything else is
 * returned as given, in the form given (a Date or an ISO text).
 */
export function keepStoredEndOfValidity<T extends Date | string | null | undefined>(
  stored: Date | string | null | undefined,
  next: T,
): T {
  if (next == null || next === '' || stored == null || stored === '') return next;
  const day = next instanceof Date ? next : new Date(next);
  const kept = stored instanceof Date ? stored : new Date(stored);
  if (Number.isNaN(day.getTime()) || Number.isNaN(kept.getTime())) return next;
  const noon = day.getUTCHours() === 12
    && day.getUTCMinutes() === 0
    && day.getUTCSeconds() === 0
    && day.getUTCMilliseconds() === 0;
  if (!noon || kept.toISOString().slice(0, 10) !== day.toISOString().slice(0, 10)) return next;
  return (next instanceof Date ? new Date(kept.getTime()) : kept.toISOString()) as T;
}

function parseInstant(text: string): CsvParsedDate | null {
  const match = ISO_TIMESTAMP.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const zone = match[8];
  if (!isRealDay(year, month, day)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (zone !== 'Z' && zone !== 'z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return null;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return { kind: 'instant', iso: parsed.toISOString() };
}

function calendarDate(year: number, month: number, day: number, time: string | null): CsvParsedDate | null {
  if (!isRealDay(year, month, day)) return null;
  const isoDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { kind: 'date', isoDate, time };
}

function clock(hour: string | undefined, minute: string | undefined, second: string | undefined): string | null {
  if (hour == null) return null;
  const h = Number(hour);
  const m = Number(minute);
  const s = second == null ? 0 : Number(second);
  if (h > 23 || m > 59 || s > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function isRealDay(year: number, month: number, day: number): boolean {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}
