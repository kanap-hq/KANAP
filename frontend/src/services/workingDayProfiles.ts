import api from '../api';
import { deriveStatusFromDisabledAt } from '../constants/status';

/**
 * Working-day calendars (`/working-day-profiles`; "working-day profile" is the storage word, the UI
 * says calendar). A calendar holds, per year, the working days of each month: twelve decimal strings
 * (at most 6 decimals, none above the month's calendar days). A price per day multiplies them.
 *
 * A standard calendar has a country (and maybe a region): the working days of any year follow that
 * country's public holidays, and `days_by_year` holds only the years edited by hand. A custom
 * calendar has neither and holds every year it knows.
 */
export type WorkingDayProfileStatus = 'enabled' | 'disabled';

/** "2026" -> twelve decimal strings, January first. */
export type CalendarDays = Record<string, string[]>;

export type WorkingDayProfile = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  days_by_year: CalendarDays;
  status: WorkingDayProfileStatus;
  disabled_at: string | null;
  /** Two upper-case letters on a standard calendar, null on a custom one. Set at creation only. */
  country_iso: string | null;
  /** A region of the country, or null for the whole country (always null on a custom calendar). */
  region_code: string | null;
  /** The names in the requested language. */
  country_name: string | null;
  region_name: string | null;
  created_at?: string;
  updated_at?: string;
};

/** A row of `GET /working-day-profiles`: the calendar and its years, oldest first. */
export type WorkingDayProfileListRow = WorkingDayProfile & { years: string[] };

/** `GET /working-day-profiles/:id`, and the create and update responses. */
export type WorkingDayProfileDetail = WorkingDayProfile & {
  opex_count: number;
  capex_count: number;
};

export type WorkingDayProfileWrite = {
  code: string;
  name: string;
  description?: string | null;
  days_by_year?: CalendarDays;
  status?: WorkingDayProfileStatus;
  disabled_at?: string | null;
  /** Creation only: the server refuses a change afterwards. */
  country_iso?: string | null;
  region_code?: string | null;
};

/** Any subset. `days_by_year` merges per year: a year sent replaces that year, `null` removes it. */
export type WorkingDayProfilePatch = Partial<Omit<WorkingDayProfileWrite, 'days_by_year'>> & {
  days_by_year?: Record<string, string[] | null>;
};

export type WorkingDayProfileBulkDeleteResult = {
  deleted: string[];
  failed: Array<{ id: string; name: string; reason: string }>;
};

export const WORKING_DAY_PROFILES_ENDPOINT = '/working-day-profiles';

/** A public holiday of a year: `date` is `YYYY-MM-DD`; `weekend` when it falls on a Saturday or Sunday. */
export type HolidayDay = { date: string; name: string; weekend: boolean };

/** `GET /working-day-profiles/countries`: every country the holiday rules know, by name. */
export type CalendarCountry = {
  code: string;
  name: string;
  regions: Array<{ code: string; name: string }>;
};

/**
 * `GET /working-day-profiles/:id/years/:year`. `source`: `edited` when the calendar holds the year,
 * `standard` when its values come from the public holidays, `none` on a custom calendar without it.
 * `standard_days` and `holidays` are the public-holiday values of a standard calendar (also on an
 * edited year), null and empty on a custom one.
 */
export type WorkingDayProfileYear = {
  year: number;
  source: 'edited' | 'standard' | 'none';
  days: string[] | null;
  standard_days: string[] | null;
  holidays: HolidayDay[];
};

/** `GET /working-day-profiles/suggestions`: a country of the tenant's companies without a standard calendar. */
export type CalendarSuggestion = { country_iso: string; country_name: string; companies: string[] };

/** A calendar whose working days follow a country's public holidays. */
export function isStandardCalendar(profile: { country_iso?: string | null } | null | undefined): boolean {
  return !!profile?.country_iso;
}

/** Enabled now: a calendar disabled from a future date still counts as enabled. */
export function isWorkingDayProfileActive(
  profile: { status: string; disabled_at: string | null },
  asOf: Date = new Date(),
): boolean {
  return profile.status !== 'disabled' && deriveStatusFromDisabledAt(profile.disabled_at, asOf) === 'enabled';
}

/** Every calendar of the tenant, disabled ones included (pickers and budget screens). Names in `lang`. */
export async function listWorkingDayProfiles(lang: string): Promise<WorkingDayProfileListRow[]> {
  const res = await api.get<{ items: WorkingDayProfileListRow[] }>(WORKING_DAY_PROFILES_ENDPOINT, {
    params: { page: 1, limit: 1000, sort: 'name:ASC', includeDisabled: true, lang },
  });
  return Array.isArray(res.data?.items) ? res.data.items : [];
}

export async function getWorkingDayProfile(id: string, lang: string): Promise<WorkingDayProfileDetail> {
  const res = await api.get<WorkingDayProfileDetail>(`${WORKING_DAY_PROFILES_ENDPOINT}/${id}`, { params: { lang } });
  return res.data;
}

/** The countries a standard calendar can follow, names and regions in `lang`. */
export async function listCountries(lang: string): Promise<CalendarCountry[]> {
  const res = await api.get<{ items: CalendarCountry[] }>(`${WORKING_DAY_PROFILES_ENDPOINT}/countries`, { params: { lang } });
  return Array.isArray(res.data?.items) ? res.data.items : [];
}

/** One year of a calendar: its effective days, and on a standard calendar the standard values and public holidays. */
export async function getWorkingDayProfileYear(id: string, year: number, lang: string): Promise<WorkingDayProfileYear> {
  const res = await api.get<WorkingDayProfileYear>(`${WORKING_DAY_PROFILES_ENDPOINT}/${id}/years/${year}`, { params: { lang } });
  return res.data;
}

/** The countries of the tenant's companies that have no standard calendar yet. */
export async function listCalendarSuggestions(lang: string): Promise<CalendarSuggestion[]> {
  const res = await api.get<{ items: CalendarSuggestion[] }>(`${WORKING_DAY_PROFILES_ENDPOINT}/suggestions`, { params: { lang } });
  return Array.isArray(res.data?.items) ? res.data.items : [];
}

export async function createWorkingDayProfile(body: WorkingDayProfileWrite): Promise<WorkingDayProfileDetail> {
  const res = await api.post<WorkingDayProfileDetail>(WORKING_DAY_PROFILES_ENDPOINT, body);
  return res.data;
}

/** `lang`: the language of the country and region names in the response (the caller caches it as the detail). */
export async function updateWorkingDayProfile(
  id: string,
  patch: WorkingDayProfilePatch,
  lang?: string,
): Promise<WorkingDayProfileDetail> {
  const res = await api.patch<WorkingDayProfileDetail>(
    `${WORKING_DAY_PROFILES_ENDPOINT}/${id}`,
    patch,
    lang ? { params: { lang } } : undefined,
  );
  return res.data;
}

export async function deleteWorkingDayProfile(id: string): Promise<void> {
  await api.delete(`${WORKING_DAY_PROFILES_ENDPOINT}/${id}`);
}

export async function deleteWorkingDayProfiles(ids: string[]): Promise<WorkingDayProfileBulkDeleteResult> {
  const res = await api.delete<WorkingDayProfileBulkDeleteResult>(`${WORKING_DAY_PROFILES_ENDPOINT}/bulk`, { data: { ids } });
  return res.data;
}
