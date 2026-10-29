import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { HistoryFields } from '../field-rules';
import { hidden, hiddenChanged, shown } from '../field-rules';

/**
 * The working day calendar: its page, its own audit label and its allow-list. It has no child.
 *
 * `days_by_year` is the long calendar content (one list of worked days per year): the history
 * hides it, and the calendar's own year editor reads it.
 */
export const workingDayProfilesRecord = {
  table: 'working_day_profiles',
  module: 'working_day_profiles',
  level: 'reader',
  auditLabels: ['working_day_profiles'],
  family: 'calendar',
  children: {},
  explicitParentLabels: [],
  exclusions: [],
} as const satisfies RecordHistoryRecord;

/** A calendar, as its page shows it; the year content stays out. */
const WORKING_DAY_PROFILE_FIELDS: HistoryFields = {
  code: shown(),
  name: shown(),
  description: shown(),
  country_iso: shown(),
  region_code: shown(),
  status: shown(),
  disabled_at: shown(),
  days_by_year: hiddenChanged('long calendar content, read by the calendar year editor', 'workingDaysChanged'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** The allow-list of the calendar. */
export const workingDayProfilesFields: Readonly<Record<string, HistoryFields>> = {
  working_day_profiles: WORKING_DAY_PROFILE_FIELDS,
};
