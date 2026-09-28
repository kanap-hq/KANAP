import api from '../api';
import { deriveStatusFromDisabledAt } from '../constants/status';

/**
 * Working-day calendars (`/working-day-profiles`; "working-day profile" is the storage word, the UI
 * says calendar). A calendar holds, per year, the working days of each month: twelve decimal strings
 * (at most 6 decimals, none above the month's calendar days). A price per day multiplies them.
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

/** Enabled now: a calendar disabled from a future date still counts as enabled. */
export function isWorkingDayProfileActive(
  profile: { status: string; disabled_at: string | null },
  asOf: Date = new Date(),
): boolean {
  return profile.status !== 'disabled' && deriveStatusFromDisabledAt(profile.disabled_at, asOf) === 'enabled';
}

/** Every calendar of the tenant, disabled ones included (pickers and budget screens). */
export async function listWorkingDayProfiles(): Promise<WorkingDayProfileListRow[]> {
  const res = await api.get<{ items: WorkingDayProfileListRow[] }>(WORKING_DAY_PROFILES_ENDPOINT, {
    params: { page: 1, limit: 1000, sort: 'name:ASC', includeDisabled: true },
  });
  return Array.isArray(res.data?.items) ? res.data.items : [];
}

export async function getWorkingDayProfile(id: string): Promise<WorkingDayProfileDetail> {
  const res = await api.get<WorkingDayProfileDetail>(`${WORKING_DAY_PROFILES_ENDPOINT}/${id}`);
  return res.data;
}

export async function createWorkingDayProfile(body: WorkingDayProfileWrite): Promise<WorkingDayProfileDetail> {
  const res = await api.post<WorkingDayProfileDetail>(WORKING_DAY_PROFILES_ENDPOINT, body);
  return res.data;
}

export async function updateWorkingDayProfile(id: string, patch: WorkingDayProfilePatch): Promise<WorkingDayProfileDetail> {
  const res = await api.patch<WorkingDayProfileDetail>(`${WORKING_DAY_PROFILES_ENDPOINT}/${id}`, patch);
  return res.data;
}

export async function deleteWorkingDayProfile(id: string): Promise<void> {
  await api.delete(`${WORKING_DAY_PROFILES_ENDPOINT}/${id}`);
}

export async function deleteWorkingDayProfiles(ids: string[]): Promise<WorkingDayProfileBulkDeleteResult> {
  const res = await api.delete<WorkingDayProfileBulkDeleteResult>(`${WORKING_DAY_PROFILES_ENDPOINT}/bulk`, { data: { ids } });
  return res.data;
}
