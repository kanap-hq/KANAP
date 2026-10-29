import { AiEntityFilterRegistry } from '../ai-filter.types';
import {
  AI_CALENDAR_KINDS,
  AI_CALENDAR_STATUSES,
  AI_CALENDAR_YEAR_SOURCES,
  AI_CALENDAR_YEARS,
} from '../ai-working-day-calendars.query';

/**
 * Master data › Working-day calendars, read through the screen's service
 * (`query/ai-working-day-calendars.query.ts`): one row per calendar, `ref` its code. The year
 * filter reads the working days of one year by the screen's route (`getYear`): its source and its
 * total, summed by the server. Listed, filtered, grouped, sorted and paged in memory; the
 * `aggregate` block is descriptive and never reads its empty base table. Read with the right on
 * working-day calendars, as the screen.
 */
export const workingDayCalendarsRegistry: AiEntityFilterRegistry = {
  entityType: 'working_day_calendars',
  fields: {
    code: {
      ai: 'code',
      grid: 'code',
      type: 'text',
      description: 'Code of the calendar, unique in the workspace (its `ref`; FR for the standard calendar of France). A part of it matches.',
      sortable: true,
      groupable: false,
    },
    name: {
      ai: 'name',
      grid: 'name',
      type: 'text',
      description: 'Name of the calendar. A part of it matches.',
      sortable: true,
      groupable: false,
    },
    kind: {
      ai: 'kind',
      grid: 'kind',
      type: 'set',
      description: 'standard: a calendar of a country (and maybe a region), whose working days are the weekdays less its public holidays, unless a year was edited by hand; custom: a calendar whose every year is entered by hand.',
      values: [...AI_CALENDAR_KINDS],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    country: {
      ai: 'country',
      grid: 'country',
      type: 'text',
      description: 'Country of a standard calendar, by its name in the person\'s language or its ISO code (FR). A part of it matches. A custom calendar has none. A country without a calendar in the workspace has no calendar here.',
      sortable: true,
      groupable: true,
    },
    region: {
      ai: 'region',
      grid: 'region',
      type: 'text',
      description: 'Region of a standard calendar (its own public holidays), by name or code. A part of it matches.',
      sortable: false,
      groupable: false,
    },
    status: {
      ai: 'status',
      grid: 'status',
      type: 'set',
      description: 'enabled or disabled (past its end of validity). Every calendar is listed whatever its status; the screen shows the enabled ones by default.',
      values: [...AI_CALENDAR_STATUSES],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    disabled_at: {
      ai: 'disabled_at',
      grid: 'disabled_at',
      type: 'date',
      description: 'End of validity of the calendar.',
      sortable: false,
      groupable: false,
    },
    description: {
      ai: 'description',
      grid: 'description',
      type: 'text',
      description: 'Description of the calendar. A part of it matches.',
      sortable: false,
      groupable: false,
    },
    years_edited: {
      ai: 'years_edited',
      grid: 'years_edited',
      type: 'text',
      description: 'The years stored on the calendar: every year of a custom calendar, only the years edited by hand on a standard one (its other years follow the public holidays). Never read a year from it: the year filter reads it.',
      sortable: false,
      groupable: false,
    },
    year: {
      ai: 'year',
      grid: 'year',
      type: 'number',
      description: `The year whose working days each row gives (\`total_days\`, \`source\`), one year from ${AI_CALENDAR_YEARS.min} to ${AI_CALENDAR_YEARS.max}, as {"op": "eq", "value": 2026} (the year argument of query_entities also sets it). Without it, the rows carry no days. get_entity_detail with year adds the twelve months and the public holidays by name.`,
      sortable: false,
      groupable: false,
    },
    source: {
      ai: 'source',
      grid: 'source',
      type: 'set',
      description: 'With the year filter: edited (days entered by hand for that year), standard (the weekdays less the public holidays of the country) or none (a custom calendar without that year: it has no working days for it, never 0). null without the year filter.',
      values: [...AI_CALENDAR_YEAR_SOURCES, null],
      discoverable: true,
      sortable: false,
      groupable: true,
    },
    total_days: {
      ai: 'total_days',
      grid: 'total_days',
      type: 'number',
      description: 'With the year filter: the working days of the year, the sum of its twelve months computed by the server (months may be fractional, 19.083333). null when the year has no days (source none) or without the year filter.',
      sortable: true,
      groupable: false,
    },
    created_at: {
      ai: 'created_at',
      grid: 'created_at',
      type: 'date',
      description: 'When the calendar was created.',
      sortable: true,
      groupable: false,
    },
    updated_at: {
      ai: 'updated_at',
      grid: 'updated_at',
      type: 'date',
      description: 'When the calendar was last changed.',
      sortable: true,
      groupable: false,
    },
  },
  sortFields: {
    code: 'code',
    name: 'name',
    kind: 'kind',
    country: 'country',
    status: 'status',
    total_days: 'total_days',
    created_at: 'created_at',
    updated_at: 'updated_at',
  },
  defaultSort: {
    field: 'code',
    direction: 'asc',
  },
  aggregate: {
    baseTable: '',
    alias: 'wdc',
    groupFields: {
      kind: { expression: 'kind' },
      country: { expression: 'country' },
      status: { expression: 'status' },
      source: { expression: 'source' },
    },
  },
};
