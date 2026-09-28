import type { TFunction } from 'i18next';
import type { CalendarDays } from '../../services/workingDayProfiles';

export const WORKING_DAY_CALENDARS_PATH = '/master-data/working-day-calendars';

/** Decimals a month's working days accept (the server's limit). */
export const DAY_DECIMALS = 6;

/** Years the server accepts. */
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

/** Fields a refusal can be attached to, so the error shows under the field that caused it. */
export type WorkingDayCalendarField = 'code' | 'name' | 'description' | 'disabled_at' | 'days_by_year';

const REFUSAL_FIELDS: ReadonlySet<string> = new Set<WorkingDayCalendarField>([
  'code', 'name', 'description', 'disabled_at', 'days_by_year',
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
