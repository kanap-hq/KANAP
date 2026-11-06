/**
 * Dates written with the month's name, as exports often write them (`28/Oct/26 9:41 AM` from Jira,
 * `3 janvier 2027`, `15. November 2026`, `Nov 15, 2026`): in English, French, German or Spanish,
 * full or abbreviated, accents optional.
 */

const MONTH_NAMES: ReadonlyArray<readonly string[]> = [
  ['january', 'jan', 'janvier', 'janv', 'januar', 'janner', 'enero', 'ene'],
  ['february', 'feb', 'fevrier', 'fevr', 'fev', 'februar', 'febrero'],
  ['march', 'mar', 'mars', 'marz', 'mrz', 'marzo'],
  ['april', 'apr', 'avril', 'avr', 'abril', 'abr'],
  ['may', 'mai', 'mayo'],
  ['june', 'jun', 'juin', 'juni', 'junio'],
  ['july', 'jul', 'juillet', 'juil', 'juli', 'julio'],
  ['august', 'aug', 'aout', 'agosto', 'ago'],
  ['september', 'sep', 'sept', 'septembre', 'septiembre', 'setiembre'],
  ['october', 'oct', 'octobre', 'oktober', 'okt', 'octubre'],
  ['november', 'nov', 'novembre', 'noviembre'],
  ['december', 'dec', 'decembre', 'dezember', 'dez', 'diciembre', 'dic'],
];

const MONTH_BY_NAME = new Map<string, number>(MONTH_NAMES.flatMap((names, index) => names.map((name) => [name, index + 1] as const)));

const TIME = String.raw`(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?`;
/** `28/oct/26`, `1er mars 2026`, `3 janvier 2027`, `15. november 2026`, `3 de enero de 2027`, then an optional time. */
const DAY_FIRST = new RegExp(String.raw`^(\d{1,2})(?:er|st|nd|rd|th)?\.?[\s/\-]+(?:de\s+)?([a-z]+)\.?[\s/\-,]+(?:de\s+)?(\d{4}|\d{2})(?:[\sT,]+${TIME})?$`);
/** `nov 15, 2026`, `november 15th 2026`, then an optional time. */
const MONTH_FIRST = new RegExp(String.raw`^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:[\sT,]+${TIME})?$`);

export interface NamedMonthDate {
  isoDate: string;
  /** `HH:MM:SS`, when the cell gives a time. */
  time: string | null;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function realDay(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function clock(hour?: string, minute?: string, second?: string, meridiem?: string): string | null | undefined {
  if (hour === undefined) return null;
  let h = Number(hour);
  const m = Number(minute);
  const s = second === undefined ? 0 : Number(second);
  if (meridiem) {
    if (h < 1 || h > 12) return undefined;
    const pm = meridiem.startsWith('p');
    h = h === 12 ? (pm ? 12 : 0) : pm ? h + 12 : h;
  }
  if (h > 23 || m > 59 || s > 59) return undefined;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** A day written with its month's name, with its time when the cell gives one; null for any other text. */
export function parseNamedMonthDate(raw: string): NamedMonthDate | null {
  const text = raw.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');
  const dayFirst = DAY_FIRST.exec(text);
  const monthFirst = dayFirst ? null : MONTH_FIRST.exec(text);
  const parts = dayFirst
    ? { day: dayFirst[1], month: dayFirst[2], year: dayFirst[3], time: dayFirst.slice(4, 8) }
    : monthFirst
      ? { day: monthFirst[2], month: monthFirst[1], year: monthFirst[3], time: monthFirst.slice(4, 8) }
      : null;
  if (!parts) return null;
  const month = MONTH_BY_NAME.get(parts.month);
  if (month === undefined) return null;
  const shortYear = Number(parts.year);
  const year = parts.year.length === 2 ? (shortYear < 70 ? 2000 + shortYear : 1900 + shortYear) : shortYear;
  const day = Number(parts.day);
  if (!realDay(year, month, day)) return null;
  const time = clock(...(parts.time as [string?, string?, string?, string?]));
  if (time === undefined) return null;
  return { isoDate: `${year}-${pad(month)}-${pad(day)}`, time };
}
