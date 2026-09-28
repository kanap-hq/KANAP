import type { TFunction } from 'i18next';
import type { CalendarDays, HolidayDay } from '../../services/workingDayProfiles';
import { formatShortDate } from '../../lib/dateFormat';

export const WORKING_DAY_CALENDARS_PATH = '/master-data/working-day-calendars';

/** Decimals a month's working days accept (the server's limit). */
export const DAY_DECIMALS = 6;

/** Years the server accepts. */
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

/** Fields a refusal can be attached to, so the error shows under the field that caused it. */
export type WorkingDayCalendarField =
  | 'code' | 'name' | 'description' | 'disabled_at' | 'days_by_year' | 'country_iso' | 'region_code';

const REFUSAL_FIELDS: ReadonlySet<string> = new Set<WorkingDayCalendarField>([
  'code', 'name', 'description', 'disabled_at', 'days_by_year', 'country_iso', 'region_code',
]);

/**
 * The field a server refusal names (`{ message, field }` in the 400 body), mapped to the form's fields,
 * or null when the body names none. A lifecycle refusal (`status`) belongs under the date.
 */
export function refusalField(error: unknown): WorkingDayCalendarField | null {
  const raw = (error as { response?: { data?: { field?: unknown } } } | null)?.response?.data?.field;
  const field = raw === 'status' ? 'disabled_at' : raw;
  return typeof field === 'string' && REFUSAL_FIELDS.has(field) ? (field as WorkingDayCalendarField) : null;
}

/** "Used by 3 OPEX lines and 1 CAPEX line.", or null when no line uses the calendar. */
export function calendarUsageLine(t: TFunction, opexCount: number, capexCount: number): string | null {
  const opex = opexCount > 0 ? t('workingDayCalendars.usage.opex', { count: opexCount }) : null;
  const capex = capexCount > 0 ? t('workingDayCalendars.usage.capex', { count: capexCount }) : null;
  if (opex && capex) return t('workingDayCalendars.usage.both', { opex, capex });
  if (opex || capex) return t('workingDayCalendars.usage.one', { lines: opex ?? capex });
  return null;
}

/** The line that explains a disabled Delete, or null when the calendar can be deleted. */
export function calendarDeleteBlock(t: TFunction, usage: string | null): string | null {
  return usage ? t('workingDayCalendars.deleteBlocked', { usage }) : null;
}

/** Calendar days of a month (1..12), 29 in a leap February. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

const SCALE = 10n ** BigInt(DAY_DECIMALS);

/** A non-negative decimal string in millionths, or null when it is not one (blank, negative, too many decimals). */
function toMillionths(value: string): bigint | null {
  const text = value.trim();
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) return null;
  const decimals = match[2] ?? '';
  if (decimals.length > DAY_DECIMALS) return null;
  return BigInt(match[1]) * SCALE + BigInt(decimals.padEnd(DAY_DECIMALS, '0') || '0');
}

function fromMillionths(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(DAY_DECIMALS, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** "18.500" -> "18.5", "20.0" -> "20": the server's stored form. Other text is returned trimmed. */
export function normalizeDays(value: string): string {
  const millionths = toMillionths(value);
  return millionths == null ? value.trim() : fromMillionths(millionths);
}

/** Exact sum of the filled months (no binary rounding), in the stored form. Blank months count as 0. */
export function sumDays(values: ReadonlyArray<string | null | undefined>): string {
  let total = 0n;
  for (const value of values) {
    if (value == null || value.trim() === '') continue;
    total += toMillionths(value) ?? 0n;
  }
  return fromMillionths(total);
}

export type MonthProblem = { kind: 'negative' } | { kind: 'decimals' } | { kind: 'tooMany'; max: number };

export type YearCheck = {
  /** One entry per month, January first: null when the month is fine or blank. */
  problems: Array<MonthProblem | null>;
  /** All twelve months hold a value. */
  complete: boolean;
  /** No month holds a value. */
  empty: boolean;
};

/** The server's rules (D4) checked before a write, so the page can say which month is wrong. */
export function checkYear(year: number, values: ReadonlyArray<string>): YearCheck {
  const problems: Array<MonthProblem | null> = [];
  let filled = 0;
  for (let index = 0; index < 12; index += 1) {
    const text = (values[index] ?? '').trim();
    if (text === '') {
      problems.push(null);
      continue;
    }
    filled += 1;
    if (text.startsWith('-')) {
      problems.push({ kind: 'negative' });
      continue;
    }
    const millionths = toMillionths(text);
    if (millionths == null) {
      problems.push({ kind: 'decimals' });
      continue;
    }
    const max = daysInMonth(year, index + 1);
    problems.push(millionths > BigInt(max) * SCALE ? { kind: 'tooMany', max } : null);
  }
  return { problems, complete: filled === 12, empty: filled === 0 };
}

/**
 * The years the editor offers: every stored year, the current year's neighbours, and one empty year
 * on either side of the stored ones so the next year can always be added.
 */
export function calendarTabYears(daysByYear: CalendarDays, currentYear: number): number[] {
  const stored = Object.keys(daysByYear).map(Number).filter((year) => Number.isInteger(year));
  const low = Math.max(MIN_YEAR, Math.min(currentYear - 1, ...stored.map((year) => year - 1)));
  const high = Math.min(MAX_YEAR, Math.max(currentYear + 2, ...stored.map((year) => year + 1)));
  const years: number[] = [];
  for (let year = low; year <= high; year += 1) years.push(year);
  return years;
}

/** Twelve blank months. */
export function blankYear(): string[] {
  return Array.from({ length: 12 }, () => '');
}

/** The localized month name, capitalized ("January", "Janvier"). */
export function monthLabel(locale: string, month: number): string {
  const name = new Date(2000, month - 1, 1).toLocaleString(locale, { month: 'long' });
  return name ? name.charAt(0).toLocaleUpperCase(locale) + name.slice(1) : String(month);
}

/** The yearly total with at most 2 decimals (half away from zero), in the fields' convention: "229.08". */
export function roundDaysTotal(total: string): string {
  const [whole, fraction = ''] = total.split('.');
  if (fraction.length <= 2) return total;
  let cents = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, '0'));
  if (Number(fraction[2]) >= 5) cents += 1n;
  const rest = (cents % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return rest ? `${cents / 100n}.${rest}` : `${cents / 100n}`;
}

/**
 * The years a standard calendar offers: every year the server accepts. The year tabs show five of
 * them around the selected one (the current year's neighbours at first), and the arrows move one year.
 */
export function standardTabYears(): number[] {
  const years: number[] = [];
  for (let year = MIN_YEAR; year <= MAX_YEAR; year += 1) years.push(year);
  return years;
}

/** "France (Moselle)", "France", or null on a custom calendar. */
export function calendarSourceLabel(calendar: {
  country_iso?: string | null;
  region_code?: string | null;
  country_name?: string | null;
  region_name?: string | null;
}): string | null {
  if (!calendar.country_iso) return null;
  const country = calendar.country_name || calendar.country_iso;
  const region = calendar.region_code ? calendar.region_name || calendar.region_code : null;
  return region ? `${country} (${region})` : country;
}

/** The code a standard calendar is given by default: "FR", "FR-57". */
export function standardCalendarCode(country: string, region: string | null): string {
  return region ? `${country}-${region}` : country;
}

/** "All years", "All years, 2026 edited" on a standard calendar; the stored years on a custom one. */
export function calendarYearsText(
  t: TFunction,
  calendar: { country_iso?: string | null } | null | undefined,
  years: string[] | null | undefined,
): string {
  const list = Array.isArray(years) ? years.join(', ') : '';
  if (!calendar?.country_iso) return list;
  return list
    ? t('workingDayCalendars.yearsAllEdited', { years: list })
    : t('workingDayCalendars.yearsAll');
}

/** Consecutive days of one public holiday (`start` and `end` are `YYYY-MM-DD`), or a single day. */
export type HolidayRun = { start: string; end: string; name: string; weekend: boolean };

function nextDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * The holidays of a year with the consecutive days of one holiday grouped. A group is marked as on a
 * weekend only when every one of its days is, since it then removes no working day.
 */
export function holidayRuns(holidays: HolidayDay[]): HolidayRun[] {
  const runs: HolidayRun[] = [];
  for (const day of holidays) {
    const last = runs[runs.length - 1];
    if (last && last.name === day.name && nextDay(last.end) === day.date) {
      last.end = day.date;
      last.weekend = last.weekend && day.weekend;
    } else {
      runs.push({ start: day.date, end: day.date, name: day.name, weekend: day.weekend });
    }
  }
  return runs;
}

/**
 * The dates of a holiday, day first like every short date in the app and without the year (the tab's):
 * "6 Apr", "16 to 19 May", "30 Apr to 2 May".
 */
export function holidayRunDates(t: TFunction, run: HolidayRun, locale: string): string {
  const end = formatShortDate(run.end, locale, { year: 'never', empty: run.end });
  if (run.start === run.end) return end;
  const start = run.start.slice(0, 7) === run.end.slice(0, 7)
    ? String(Number(run.start.slice(8, 10)))
    : formatShortDate(run.start, locale, { year: 'never', empty: run.start });
  return t('workingDayCalendars.days.holidayRange', { from: start, to: end });
}

/** "France, Netherlands and Italy" in the UI language. */
export function joinNames(names: string[], locale: string): string {
  // Intl.ListFormat is ES2021, one step past the compiler's lib.
  const ListFormat = (Intl as unknown as {
    ListFormat?: new (locale: string, options: Record<string, string>) => { format: (list: string[]) => string };
  }).ListFormat;
  try {
    if (ListFormat) return new ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names);
  } catch {
    // An unknown locale falls through to the plain join.
  }
  return names.join(', ');
}
