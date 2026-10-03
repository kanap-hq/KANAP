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
  | { ok: false; blank: false };

export interface DateOrderDecision {
  order: CsvDateOrder | null;
  settledByFile: boolean;
  notice: string | null;
  error: string | null;
}

/**
 * Settle day or month first. A part above 12 settles it. When both orders
 * appear, the file is refused. When nothing settles it, the language's order
 * applies, or `override` when the preflight switch was used.
 */
export function resolveDateOrder(
  texts: readonly string[],
  language: CsvLanguage,
  override?: CsvDateOrder,
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
      notice: null,
      error: `This file shows dates ${which} (${shown}). The date order cannot be switched.`,
    };
  }
  if (evidence) return { order: evidence, settledByFile: true, notice: null, error: null };
  if (!ambiguous) return { order: null, settledByFile: false, notice: null, error: null };
  const order = override ?? csvProfile(language).dateOrder;
  return { order, settledByFile: false, notice: dateOrderNotice(order), error: null };
}

/** One date cell. `order` is required for a local day or month form. Empty is blank, not an error. */
export function parseCsvDateCell(raw: string, order: CsvDateOrder | null): ParsedDateCell {
  const text = raw.trim();
  if (text === '') return { ok: false, blank: true };
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
