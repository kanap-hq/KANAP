import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale } from '../i18n/useLocale';
import {
  getWorkingDayProfileYear,
  isWorkingDayProfileActive,
  listCalendarSuggestions,
  listCountries,
  listWorkingDayProfiles,
  type CalendarCountry,
  type CalendarSuggestion,
  type WorkingDayProfile,
  type WorkingDayProfileYear,
} from '../services/workingDayProfiles';

/**
 * Every calendar query starts with `['working-day-profiles']`, so invalidating that prefix refreshes
 * them all after a create or a delete. The list of every calendar sits under
 * `WORKING_DAY_PROFILES_QUERY_KEY`, one entry per language.
 */
export const WORKING_DAY_PROFILES_QUERY_KEY = ['working-day-profiles', 'list'] as const;

export function workingDayProfileDetailKey(id: string, lang: string) {
  return ['working-day-profiles', 'detail', id, lang] as const;
}

export function workingDayProfileYearKey(id: string, year: number, lang: string) {
  return ['working-day-profiles', 'year', id, year, lang] as const;
}

/** Every loaded year of one calendar, in every language: the prefix to refresh after a days write. */
export function workingDayProfileYearsKey(id: string) {
  return ['working-day-profiles', 'year', id] as const;
}

export const CALENDAR_SUGGESTIONS_QUERY_KEY = ['working-day-profiles', 'suggestions'] as const;

export type WorkingDayProfiles = {
  /** False until the calendars are loaded (or while the hook is disabled). */
  ready: boolean;
  /** The last load failed: `profiles` is then empty and says nothing about the tenant. */
  isError: boolean;
  /** Every calendar, disabled ones included, by name then code. */
  profiles: WorkingDayProfile[];
  /** Calendars enabled now, in order. A new assignment offers these only. */
  enabled: WorkingDayProfile[];
  byId: Map<string, WorkingDayProfile>;
};

function compareProfiles(a: WorkingDayProfile, b: WorkingDayProfile): number {
  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  if (byName !== 0) return byName;
  return a.code.localeCompare(b.code, undefined, { sensitivity: 'base' });
}

/** Pure core of the hook, exported for tests and callers that already hold the calendars. */
export function buildWorkingDayProfiles(
  list: WorkingDayProfile[],
  ready = true,
  isError = false,
  asOf: Date = new Date(),
): WorkingDayProfiles {
  const profiles = [...list].sort(compareProfiles);
  const byId = new Map<string, WorkingDayProfile>();
  for (const profile of profiles) byId.set(profile.id, profile);
  return {
    ready,
    isError,
    profiles,
    enabled: profiles.filter((profile) => isWorkingDayProfileActive(profile, asOf)),
    byId,
  };
}

const EMPTY: WorkingDayProfile[] = [];

export function useWorkingDayProfiles(options?: { enabled?: boolean }): WorkingDayProfiles {
  const enabled = options?.enabled ?? true;
  const lang = useLocale();
  const query = useQuery({
    queryKey: [...WORKING_DAY_PROFILES_QUERY_KEY, lang],
    queryFn: () => listWorkingDayProfiles(lang),
    enabled,
    staleTime: 5 * 60_000,
  });
  const list = query.data ?? EMPTY;
  const ready = enabled && (query.isSuccess || query.isError);
  const isError = enabled && query.isError;
  return useMemo(() => buildWorkingDayProfiles(list, ready, isError), [list, ready, isError]);
}

/** The countries a standard calendar can follow, in the UI language. They do not change while the app runs. */
export function useCalendarCountries(options?: { enabled?: boolean }): { countries: CalendarCountry[]; ready: boolean } {
  const lang = useLocale();
  const query = useQuery({
    queryKey: ['working-day-calendar-countries', lang],
    queryFn: () => listCountries(lang),
    enabled: options?.enabled ?? true,
    staleTime: Infinity,
  });
  return { countries: query.data ?? EMPTY_COUNTRIES, ready: query.isSuccess };
}

const EMPTY_COUNTRIES: CalendarCountry[] = [];
const EMPTY_SUGGESTIONS: CalendarSuggestion[] = [];

/** The countries of the tenant's companies without a standard calendar, in the UI language. */
export function useCalendarSuggestions(options?: { enabled?: boolean }): CalendarSuggestion[] {
  const lang = useLocale();
  const query = useQuery({
    queryKey: [...CALENDAR_SUGGESTIONS_QUERY_KEY, lang],
    queryFn: () => listCalendarSuggestions(lang),
    enabled: options?.enabled ?? true,
    staleTime: 60_000,
  });
  return query.data ?? EMPTY_SUGGESTIONS;
}

/**
 * One year of a standard calendar: its standard values and public holidays, and the days in effect
 * with their source. Idle for a custom calendar (`enabled: false`). A month edit changes the days in
 * effect: the calendar workspace refreshes `workingDayProfileYearsKey(id)` after a days write.
 */
export function useWorkingDayProfileYear(
  id: string | null,
  year: number,
  options?: { enabled?: boolean },
): { data: WorkingDayProfileYear | undefined; isError: boolean } {
  const lang = useLocale();
  const enabled = (options?.enabled ?? true) && !!id;
  const query = useQuery({
    queryKey: workingDayProfileYearKey(id ?? '', year, lang),
    queryFn: () => getWorkingDayProfileYear(id as string, year, lang),
    enabled,
    staleTime: 5 * 60_000,
  });
  return { data: enabled ? query.data : undefined, isError: enabled && query.isError };
}
