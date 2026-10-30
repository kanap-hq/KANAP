import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { HolidayDay } from '../../working-day-profiles/public-holidays';
import type {
  WorkingDayProfileListRow,
  WorkingDayProfileYear,
  WorkingDayProfilesService,
} from '../../working-day-profiles/working-day-profiles.service';
import { CALENDAR_DAY_DECIMALS, CALENDAR_YEAR_MAX, CALENDAR_YEAR_MIN } from '../../working-day-profiles/working-day-profiles.util';
import { compareText, dateMatch, numberMatch, paged, setMatch, textMatch } from './ai-support.query';

/**
 * Master data › Working-day calendars as the screen shows them, for the assistant and the MCP
 * server: the family `working_day_calendars`, one row per calendar, read through
 * `WorkingDayProfilesService` (`list`, `get`, `getYear`: the routes of the screen), never a
 * second formula. A standard calendar (a country, maybe a region) stores only the years edited by
 * hand: the days of any other year follow the public holidays, so a year is always read by
 * `getYear`, never from the stored years. A custom calendar holds every year it has: a year it
 * lacks has no days (`source` none), never 0.
 *
 * The list is small (the calendars of a tenant): filtered, grouped, sorted and paged in memory,
 * here. The yearly total is summed by the server, exactly (the months are decimal strings).
 */

export type AiCalendarKind = 'standard' | 'custom';
export type AiCalendarYearSource = WorkingDayProfileYear['source'];

export const AI_CALENDAR_KINDS: readonly AiCalendarKind[] = ['standard', 'custom'];
export const AI_CALENDAR_YEAR_SOURCES: readonly AiCalendarYearSource[] = ['edited', 'standard', 'none'];
export const AI_CALENDAR_STATUSES = ['enabled', 'disabled'] as const;

/** The years a calendar reads, as the screen and `GET /working-day-profiles/:id/years/:year`. */
export const AI_CALENDAR_YEARS = { min: CALENDAR_YEAR_MIN, max: CALENDAR_YEAR_MAX } as const;
export const AI_CALENDAR_YEAR_REFUSAL = `A working-day calendar reads one year, from ${CALENDAR_YEAR_MIN} to ${CALENDAR_YEAR_MAX}: give year as {"op": "eq", "value": 2026}.`;

/** What the year of a row says, with the result. */
export const AI_CALENDAR_YEAR_NOTE = '`total_days` is the sum of the twelve months, computed by the server: quote it, never add the months up. '
  + '`source` edited: days entered by hand for that year; standard: the weekdays less the public holidays of the calendar\'s country (and region); '
  + 'none: a custom calendar without that year, which has no working days for it (not 0). '
  + 'A country without a calendar in the workspace has no calendar here: say so, and never compute its days.';

export const AI_CALENDAR_NO_YEAR_NOTE = 'Give the year filter ({"op": "eq", "value": 2026}) to read the working days of a year: `total_days` and `source` are null without it.';

export type AiWorkingDayCalendarRow = {
  id: string;
  code: string;
  name: string;
  kind: AiCalendarKind;
  /** The country and the region in the person's language; null on a custom calendar. */
  country: string | null;
  country_code: string | null;
  region: string | null;
  region_code: string | null;
  status: 'enabled' | 'disabled';
  disabled_at: string | null;
  description: string | null;
  /** The years stored on the calendar: every year of a custom one, the edited years of a standard one. */
  years_edited: string[];
  created_at: string;
  updated_at: string;
  /** With the year filter: the year read, its source and its total. */
  year: number | null;
  source: AiCalendarYearSource | null;
  total_days: number | null;
};

export type AiWorkingDayCalendarServices = { calendars: Pick<WorkingDayProfilesService, 'list' | 'get' | 'getYear'> };

export type AiWorkingDayCalendarOpts = {
  manager: EntityManager;
  tenantId: string;
  userId?: string | null;
  /** The person's language (`readAiScreenLanguage`); English when their profile sets none. */
  lang: string;
  /** The year argument of query_entities, when no year filter is given. */
  year?: number | null;
};

export type AiWorkingDayCalendarList = {
  items: AiWorkingDayCalendarRow[];
  total: number;
  page: number;
  limit: number;
  year: number | null;
};

export const WORKING_DAY_CALENDAR_SORTS = new Set(['code', 'name', 'kind', 'country', 'status', 'total_days', 'created_at', 'updated_at']);

const MILLION = 10n ** BigInt(CALENDAR_DAY_DECIMALS);

function toMillionths(value: string): bigint {
  const [whole, fraction = ''] = String(value).trim().split('.');
  return BigInt(whole || '0') * MILLION + BigInt(fraction.slice(0, CALENDAR_DAY_DECIMALS).padEnd(CALENDAR_DAY_DECIMALS, '0'));
}

/** The exact sum of decimal day strings ("19.083333" × 12 = "228.999996"), as a decimal string. */
export function sumCalendarDays(values: readonly string[]): string {
  const total = values.reduce((sum, value) => sum + toMillionths(value), 0n);
  const fraction = (total % MILLION).toString().padStart(CALENDAR_DAY_DECIMALS, '0').replace(/0+$/, '');
  return fraction ? `${total / MILLION}.${fraction}` : `${total / MILLION}`;
}

/** The year asked: one year, `eq` only, within the calendar's years; else refused in words. */
export function calendarYearOf(filters: Record<string, any> | undefined, fallback?: number | null): number | null {
  const model = filters?.year;
  const value = model ? Number(model.filter) : fallback == null ? null : Number(fallback);
  if (value == null) return null;
  if ((model && (model.filterType !== 'number' || model.type !== 'equals')) || !Number.isInteger(value)
    || value < CALENDAR_YEAR_MIN || value > CALENDAR_YEAR_MAX) {
    throw new BadRequestException(AI_CALENDAR_YEAR_REFUSAL);
  }
  return value;
}

function toRow(row: WorkingDayProfileListRow): AiWorkingDayCalendarRow {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.country_iso ? 'standard' : 'custom',
    country: row.country_name,
    country_code: row.country_iso,
    region: row.region_name,
    region_code: row.region_code,
    status: row.status,
    disabled_at: row.disabled_at,
    description: row.description,
    years_edited: [...row.years],
    created_at: row.created_at,
    updated_at: row.updated_at,
    year: null,
    source: null,
    total_days: null,
  };
}

/** Every calendar of the tenant, disabled ones included (their status says it), in the screen's order. */
async function readCalendars(services: AiWorkingDayCalendarServices, opts: AiWorkingDayCalendarOpts): Promise<AiWorkingDayCalendarRow[]> {
  const ctx = { manager: opts.manager, tenantId: opts.tenantId, userId: opts.userId ?? null };
  const rows: WorkingDayProfileListRow[] = [];
  for (let page = 1; ; page += 1) {
    const result = await services.calendars.list({ includeDisabled: 'true', lang: opts.lang, page, limit: 100 }, ctx);
    rows.push(...(result.items as WorkingDayProfileListRow[]));
    if (result.items.length === 0 || rows.length >= result.total) break;
  }
  return rows.map(toRow);
}

/** One year of a calendar, with its exact total: `getYear`, the screen's route. */
export async function readCalendarYear(
  services: AiWorkingDayCalendarServices,
  opts: AiWorkingDayCalendarOpts,
  id: string,
  year: number,
): Promise<WorkingDayProfileYear & { total_days: number | null; standard_total_days: number | null }> {
  const ctx = { manager: opts.manager, tenantId: opts.tenantId, userId: opts.userId ?? null };
  const read = await services.calendars.getYear(id, String(year), ctx, opts.lang);
  return {
    ...read,
    total_days: read.days ? Number(sumCalendarDays(read.days)) : null,
    standard_total_days: read.standard_days ? Number(sumCalendarDays(read.standard_days)) : null,
  };
}

function filtered(rows: AiWorkingDayCalendarRow[], query: Record<string, any>): AiWorkingDayCalendarRow[] {
  const filters = query.filters;
  const needle = String(query.q ?? '').trim().toLowerCase();
  return rows.filter((row) => textMatch(row.code, filters?.code)
    && textMatch(row.name, filters?.name)
    && setMatch(row.kind, filters?.kind)
    && textMatch([row.country, row.country_code].filter(Boolean).join(' ') || null, filters?.country)
    && textMatch([row.region, row.region_code].filter(Boolean).join(' ') || null, filters?.region)
    && setMatch(row.status, filters?.status)
    && dateMatch(row.disabled_at, filters?.disabled_at)
    && textMatch(row.description, filters?.description)
    && textMatch(row.years_edited.join(', ') || null, filters?.years_edited)
    && setMatch(row.source, filters?.source)
    && numberMatch(row.total_days, filters?.total_days)
    && dateMatch(row.created_at, filters?.created_at)
    && dateMatch(row.updated_at, filters?.updated_at)
    // The screen's quick search: code, name, description and the country (and region).
    && (!needle || [row.code, row.name, row.description, row.country, row.region, row.country_code]
      .some((value) => value != null && value.toLowerCase().includes(needle))));
}

function sortValue(row: AiWorkingDayCalendarRow, field: string): string | number | null {
  switch (field) {
    case 'code': return row.code;
    case 'name': return row.name;
    case 'kind': return AI_CALENDAR_KINDS.indexOf(row.kind);
    case 'country': return row.country ? (row.region ? `${row.country} (${row.region})` : row.country) : null;
    case 'status': return row.status;
    case 'total_days': return row.total_days;
    case 'created_at': return row.created_at;
    case 'updated_at': return row.updated_at;
    default: return null;
  }
}

function sortRows(rows: AiWorkingDayCalendarRow[], sort: string | undefined): AiWorkingDayCalendarRow[] {
  const [requested, requestedDirection] = String(sort ?? '').split(':');
  const field = WORKING_DAY_CALENDAR_SORTS.has(requested) ? requested : 'code';
  const descending = String(requestedDirection ?? 'asc').toLowerCase() === 'desc';
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row, field) }))
    .sort((a, b) => {
      // Null last whatever the direction, as the screen's grid.
      if (a.value == null || b.value == null) return a.value == null && b.value == null ? a.index - b.index : a.value == null ? 1 : -1;
      const order = typeof a.value === 'number' && typeof b.value === 'number'
        ? a.value - b.value
        : compareText(String(a.value), String(b.value));
      // Ties keep the screen's order (by code).
      if (order === 0) return a.index - b.index;
      return descending ? -order : order;
    })
    .map((entry) => entry.row);
}

export async function listAiWorkingDayCalendars(
  services: AiWorkingDayCalendarServices,
  query: Record<string, any>,
  opts: AiWorkingDayCalendarOpts,
  readAll = false,
): Promise<AiWorkingDayCalendarList> {
  const year = calendarYearOf(query.filters, opts.year);
  const rows = await readCalendars(services, opts);
  if (year != null) {
    // One after the other: every read shares the request's connection.
    for (const row of rows) {
      const read = await readCalendarYear(services, opts, row.id, year);
      row.year = year;
      row.source = read.source;
      row.total_days = read.total_days;
    }
  }
  return { ...paged(sortRows(filtered(rows, query), query.sort), query, readAll), year };
}

/** The group key of a row, for the in-memory aggregate. */
export function workingDayCalendarGroupValue(row: AiWorkingDayCalendarRow, groupBy: string): string | null {
  switch (groupBy) {
    case 'kind': return row.kind;
    case 'country': return row.country;
    case 'status': return row.status;
    case 'source': return row.source;
    default: return null;
  }
}

/** The calendars of each group of the filtered rows, most first. */
export function aggregateWorkingDayCalendarRows(
  rows: AiWorkingDayCalendarRow[],
  groupBy: string,
): Array<{ key: string | null; count: number }> {
  const groups = new Map<string | null, number>();
  for (const row of rows) {
    const key = workingDayCalendarGroupValue(row, groupBy);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || compareText(a.key, b.key));
}

/** The twelve months of a year as the screen's month fields, January first. */
export function calendarMonths(days: readonly string[] | null): Array<{ month: number; days: number }> | null {
  if (!days) return null;
  return days.map((value, index) => ({ month: index + 1, days: Number(value) }));
}

/** The public holidays of the year by name, in the person's language, as the screen lists them. */
export function calendarHolidays(holidays: readonly HolidayDay[]): Array<{ date: string; name: string; weekend: boolean }> {
  return holidays.map((holiday) => ({ date: holiday.date, name: holiday.name, weekend: holiday.weekend }));
}
