import { useModuleItemNav, ModuleItemNavParams, ModuleItemNavResult } from './useModuleItemNav';

/** Prev/next through the working-day calendars list, in the list's sort, filters and status scope. */
export function useWorkingDayCalendarNav(params: ModuleItemNavParams): ModuleItemNavResult {
  return useModuleItemNav(params, {
    endpoint: '/working-day-profiles/ids',
    queryKey: 'working-day-profiles-ids',
    defaultSort: 'name:ASC',
  });
}
