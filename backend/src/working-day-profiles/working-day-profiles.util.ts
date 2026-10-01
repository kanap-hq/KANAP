import { BadRequestException } from '@nestjs/common';
import { isActiveAt, isDisabled } from '../common/status';
import { generateWorkingDays, isKnownCountry, isKnownRegion } from './public-holidays';

/**
 * Working-day calendars: the one validation of `days_by_year` shared by the
 * API, the CSV and the computation (so a value the page accepts is a value the
 * computation reads the same way), and the tenant-scoped batch loaders.
 *
 * Days are exact decimal strings, never floats: a price per day multiplies
 * them, and 6 decimals give the same cents as a workbook's 229 / 12 days.
 */

/** "2026" -> the twelve months' working days, normalised decimal strings. */
export type CalendarDays = Record<string, string[]>;

/**
 * A standard calendar has a country (and maybe a region): its working days of
 * a year follow the public holidays unless the year was edited, and
 * `days_by_year` holds the edited years only. A custom calendar has neither
 * and holds every year it has.
 */
export interface WorkingDayProfileInfo {
  id: string;
  code: string;
  name: string;
  status: 'enabled' | 'disabled';
  disabled_at: string | null;
  days_by_year: CalendarDays;
  country_iso: string | null;
  region_code: string | null;
}

export const CALENDAR_YEAR_MIN = 2000;
export const CALENDAR_YEAR_MAX = 2100;
export const CALENDAR_DAY_DECIMALS = 6;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const YEAR_KEY = /^\d{4}$/;
const DAY_VALUE = /^(\d*)(?:\.(\d*))?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<any> };

/** Calendar days of `month` (1..12) in `year`: 29 in a leap February. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function refusal(message: string, where: { year?: string; month?: number } = {}): BadRequestException {
  return new BadRequestException({ statusCode: 400, error: 'Bad Request', message, field: 'days_by_year', ...where });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One month's days as a normalised decimal string ("18", "19.083333"), or a refusal naming the month. */
function normalizeDay(raw: unknown, year: string, month: number): string {
  const label = `${MONTH_NAMES[month - 1]} ${year}`;
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    throw refusal(`Enter the working days of all twelve months of ${year}.`, { year, month });
  }
  let text: string;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw refusal(`Enter a number of days for ${label}.`, { year, month });
    text = String(raw);
  } else if (typeof raw === 'string') {
    text = raw.trim().replace(',', '.');
  } else {
    throw refusal(`Enter a number of days for ${label}.`, { year, month });
  }
  if (text.startsWith('-')) {
    throw refusal(`Enter 0 or more days for ${label}.`, { year, month });
  }
  const match = DAY_VALUE.exec(text);
  if (!match || (match[1] === '' && (match[2] ?? '') === '')) {
    throw refusal(`Enter a number of days for ${label}.`, { year, month });
  }
  const whole = match[1].replace(/^0+(?=\d)/, '') || '0';
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  if (fraction.length > CALENDAR_DAY_DECIMALS) throw refusal('Use at most 6 decimals.', { year, month });
  const max = daysInMonth(Number(year), month);
  // Exact comparison on the digits: the whole part above the month, or equal with a fraction.
  const wholeValue = whole.length > 3 ? Number.POSITIVE_INFINITY : Number(whole);
  if (wholeValue > max || (wholeValue === max && fraction !== '')) {
    throw refusal(`${label} has ${max} days: enter ${max} or less.`, { year, month });
  }
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * Validates and normalises working days per year (decision D4): a year key of
 * four digits from 2000 to 2100, exactly twelve values, each a decimal from 0
 * to the month's calendar days with at most 6 decimals, stored without
 * trailing zeros. With `partial` (a PATCH), a year set to null means "remove
 * this year" and is returned as null; otherwise null is refused. Throws a
 * BadRequestException whose message is a sentence for the user.
 */
export function normalizeDaysByYear(raw: unknown, opts: { partial?: boolean } = {}): Record<string, string[] | null> {
  if (!isPlainObject(raw)) throw refusal('Give the working days per year.');
  const result: Record<string, string[] | null> = {};
  for (const [rawKey, value] of Object.entries(raw)) {
    const year = rawKey.trim();
    if (!YEAR_KEY.test(year) || Number(year) < CALENDAR_YEAR_MIN || Number(year) > CALENDAR_YEAR_MAX) {
      throw refusal(`${rawKey} is not a year between ${CALENDAR_YEAR_MIN} and ${CALENDAR_YEAR_MAX}.`, { year: rawKey });
    }
    if (Object.prototype.hasOwnProperty.call(result, year)) {
      throw refusal(`${year} is given twice.`, { year });
    }
    if (value === null && opts.partial) {
      result[year] = null;
      continue;
    }
    if (!Array.isArray(value) || value.length !== 12) {
      throw refusal(`Enter the working days of all twelve months of ${year}.`, { year });
    }
    result[year] = value.map((day, index) => normalizeDay(day, year, index + 1));
  }
  return result;
}

/**
 * Applies a normalised PATCH to the stored years: a year sent replaces that
 * year, a year sent as null is removed, the other years are kept as stored.
 */
export function mergeDaysByYear(stored: CalendarDays | null | undefined, patch: Record<string, string[] | null>): CalendarDays {
  const merged: CalendarDays = { ...(isPlainObject(stored) ? (stored as CalendarDays) : {}) };
  for (const [year, months] of Object.entries(patch)) {
    if (months === null) delete merged[year];
    else merged[year] = [...months];
  }
  return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * A calendar can be newly assigned while it is enabled. The end of validity
 * decides when it is set (the stored status can lag behind a date that has
 * passed); without one, the status does.
 */
export function isProfileActive(p: { status: string; disabled_at: string | Date | null }, now: Date = new Date()): boolean {
  if (p.disabled_at !== null && p.disabled_at !== undefined) return isActiveAt(p.disabled_at, now);
  return !isDisabled(p.status);
}

function toInfo(row: any): WorkingDayProfileInfo {
  const disabledAt = row.disabled_at instanceof Date ? row.disabled_at.toISOString() : (row.disabled_at ?? null);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: isDisabled(row.status) ? 'disabled' : 'enabled',
    disabled_at: disabledAt,
    days_by_year: isPlainObject(row.days_by_year) ? (row.days_by_year as CalendarDays) : {},
    country_iso: row.country_iso ?? null,
    region_code: row.region_code ?? null,
  };
}

const PROFILE_COLUMNS = 'w.id, w.code, w.name, w.status, w.disabled_at, w.days_by_year, w.country_iso, w.region_code';

/**
 * The working days a computation reads for `year`: the stored year when there
 * is one; otherwise, on a standard calendar, the standard values of its
 * country (and region); otherwise null (the computation then refuses the
 * year, naming it).
 */
export function calendarDaysFor(info: WorkingDayProfileInfo, year: number): string[] | null {
  const stored = isPlainObject(info.days_by_year) ? info.days_by_year[String(year)] : undefined;
  if (Array.isArray(stored)) return stored;
  const country = info.country_iso;
  if (!country || !Number.isInteger(year) || year < CALENDAR_YEAR_MIN || year > CALENDAR_YEAR_MAX) return null;
  if (!isKnownCountry(country) || (info.region_code && !isKnownRegion(country, info.region_code))) return null;
  return generateWorkingDays(country, info.region_code, year, 'en').days;
}

/**
 * `lock: 'key share'` for a caller about to write lines naming the
 * calendar: the rows are read FOR KEY SHARE (in id order), so a concurrent
 * delete (FOR UPDATE) waits for this transaction and then finds the lines,
 * instead of this write failing on the key check after the delete commits.
 * Default: no lock.
 */
export interface LoadWorkingDayProfilesOptions {
  lock?: 'key share';
}

function lockClause(opts: LoadWorkingDayProfilesOptions): string {
  return opts.lock === 'key share' ? ' ORDER BY w.id FOR KEY SHARE OF w' : '';
}

/**
 * The tenant's calendars among `ids`, keyed by id. An id of another tenant,
 * unknown or not a uuid is simply absent (the caller says "not found").
 */
export async function loadWorkingDayProfiles(
  manager: Queryable,
  tenantId: string,
  ids: string[],
  opts: LoadWorkingDayProfilesOptions = {},
): Promise<Map<string, WorkingDayProfileInfo>> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string' && UUID.test(id)))];
  if (wanted.length === 0) return new Map();
  const rows = await manager.query(
    `SELECT ${PROFILE_COLUMNS} FROM working_day_profiles w WHERE w.tenant_id = $1 AND w.id = ANY($2::uuid[])${lockClause(opts)}`,
    [tenantId, wanted],
  );
  return new Map((rows as any[]).map((row) => [row.id as string, toInfo(row)]));
}

/** The tenant's calendars among `codes`, keyed by the trimmed lower-case code. */
export async function loadWorkingDayProfilesByCode(
  manager: Queryable,
  tenantId: string,
  codes: string[],
  opts: LoadWorkingDayProfilesOptions = {},
): Promise<Map<string, WorkingDayProfileInfo>> {
  const wanted = [...new Set(codes
    .filter((code): code is string => typeof code === 'string')
    .map((code) => code.trim().toLowerCase())
    .filter((code) => code !== ''))];
  if (wanted.length === 0) return new Map();
  const rows = await manager.query(
    `SELECT ${PROFILE_COLUMNS} FROM working_day_profiles w WHERE w.tenant_id = $1 AND lower(w.code) = ANY($2::text[])${lockClause(opts)}`,
    [tenantId, wanted],
  );
  return new Map((rows as any[]).map((row) => [String(row.code).toLowerCase(), toInfo(row)]));
}
