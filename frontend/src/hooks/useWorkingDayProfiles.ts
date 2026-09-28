import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  isWorkingDayProfileActive,
  listWorkingDayProfiles,
  type WorkingDayProfile,
} from '../services/workingDayProfiles';

export const WORKING_DAY_PROFILES_QUERY_KEY = ['working-day-profiles'] as const;

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
  const query = useQuery({
    queryKey: WORKING_DAY_PROFILES_QUERY_KEY,
    queryFn: listWorkingDayProfiles,
    enabled,
    staleTime: 5 * 60_000,
  });
  const list = query.data ?? EMPTY;
  const ready = enabled && (query.isSuccess || query.isError);
  const isError = enabled && query.isError;
  return useMemo(() => buildWorkingDayProfiles(list, ready, isError), [list, ready, isError]);
}
