import { DEFAULT_HORIZON, HORIZONS } from '../../../technologies/reports/end-of-support.service';
import { APPLICATIONS_UNREAD_NOTE } from '../ai-support.query';
import { AiEntityFilterRegistry } from '../ai-filter.types';

/**
 * The "Deadlines" list of the End of support report (lot 2 of Plaid L5), read through
 * `EndOfSupportService.deadlines` (`technologies/reports/end-of-support.service.ts`) as the
 * report's Deadlines tab shows it: one row per deadline inside `horizon_months`, the four types of
 * the screen (technology, operating_system, application, hardware) and the report's state. The
 * caller needs the report's `infrastructure` right; the application rows follow the caller's
 * application read scope, exactly as the service filters them. The service returns a complete,
 * small list: the list is filtered, grouped, sorted and paged in memory
 * (`query/ai-support.query.ts`), never by a second SQL formula. The `aggregate` block is
 * descriptive: `aggregate_entities` groups the same rows in memory and never reads its empty base
 * table.
 *
 * A row names its subject by `subject` (business reference where the record has one, its name
 * otherwise), never by an identifier. There is no record detail: read the subject's own family
 * with its reference.
 */
export const supportDeadlinesRegistry: AiEntityFilterRegistry = {
  entityType: 'support_deadlines',
  fields: {
    subject_type: {
      ai: 'subject_type',
      grid: 'subject_type',
      type: 'set',
      description: `Type of the subject, as the screen names them: technology (a technology version), operating_system (an operating system version), application (an application date), hardware (a physical asset end of life or support contract). Grouping counts the deadlines of each type. ${APPLICATIONS_UNREAD_NOTE}`,
      values: ['technology', 'operating_system', 'application', 'hardware'],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    subject: {
      ai: 'subject',
      grid: 'subject',
      type: 'text',
      description: 'Business reference of the subject (APP-n, AST-n, TEC-n), or its name when it has none. A reference compares exactly; any other value matches the name.',
      sortable: true,
      groupable: false,
    },
    subject_name: {
      ai: 'subject_name',
      grid: 'subject_name',
      type: 'text',
      description: 'Name of the subject: the technology version\'s technology, the application or the asset.',
      sortable: true,
      groupable: false,
    },
    version: {
      ai: 'version',
      grid: 'version',
      type: 'text',
      description: 'The technology or operating system version concerned. Null for an application or a piece of hardware.',
      sortable: true,
      groupable: false,
    },
    date: {
      ai: 'date',
      grid: 'date',
      type: 'date',
      description: 'The date that matters: the next end of support, or the one that passed. For hardware, the end of life or the end of the support contract. YYYY-MM-DD.',
      sortable: true,
      groupable: false,
      aggregable: true,
    },
    state: {
      ai: 'state',
      grid: 'state',
      type: 'set',
      description: 'State on that date, as the report states it: out_of_support (the date passed), extended_support (past the standard end, within extended support), upcoming (the date is to come).',
      values: ['out_of_support', 'extended_support', 'upcoming'],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    end_of_support_year: {
      ai: 'end_of_support_year',
      grid: 'end_of_support_year',
      type: 'set',
      description: 'Year (YYYY) of the deadline date. Grouping answers "which deadlines fall in a year"; filters take the year as a four-digit string.',
      acceptedValueKind: 'year, as YYYY',
      examples: ['2027'],
      sortable: false,
      groupable: true,
    },
    horizon_months: {
      ai: 'horizon_months',
      grid: 'horizon_months',
      type: 'set',
      description: `The horizon of the report, as the screen's selector: 6, 12, 24 or 36 months. ${DEFAULT_HORIZON} by default. One value: several horizons cannot be read as one list and are refused.`,
      values: HORIZONS.map((months) => String(months)),
      discoverable: true,
      sortable: false,
      groupable: false,
    },
    // The row's metadata, readable and filterable: an empty count means the caller does not read
    // the family (applications), never that the record has none.
    server_count: {
      ai: 'server_count',
      grid: 'server_count',
      type: 'number',
      description: 'Number of servers the deadline reaches (in service, clusters excluded), as the report counts them.',
      sortable: false,
      groupable: false,
    },
    servers: {
      ai: 'servers',
      grid: 'servers',
      type: 'text',
      description: 'Names of the servers the deadline reaches, at most ten then "and N other servers". Null when none.',
      sortable: false,
      groupable: false,
    },
    application_count: {
      ai: 'application_count',
      grid: 'application_count',
      type: 'number',
      description: 'Number of applications the deadline reaches. Null when the caller does not read applications, which is not "none".',
      sortable: false,
      groupable: false,
    },
    applications: {
      ai: 'applications',
      grid: 'applications',
      type: 'text',
      description: 'Names of the applications the deadline reaches, at most ten then "and N other applications". Null when the caller does not read applications, which is not "none".',
      sortable: false,
      groupable: false,
    },
    milestone: {
      ai: 'milestone',
      grid: 'milestone',
      type: 'set',
      description: 'For hardware, the date that matters: end_of_life (the asset end of life) or support_contract (the end of its support contract). Null for every other type.',
      values: ['end_of_life', 'support_contract'],
      discoverable: true,
      sortable: false,
      groupable: false,
    },
    standard_support_end: {
      ai: 'standard_support_end',
      grid: 'standard_support_end',
      type: 'date',
      description: 'End of standard support of the technology version, or the application date for an application. YYYY-MM-DD; null when none is recorded.',
      sortable: false,
      groupable: false,
      blankable: true,
    },
    extended_support_end: {
      ai: 'extended_support_end',
      grid: 'extended_support_end',
      type: 'date',
      description: 'End of extended support of the technology version. YYYY-MM-DD; null when none is recorded.',
      sortable: false,
      groupable: false,
      blankable: true,
    },
  },
  sortFields: {
    subject_type: 'subject_type',
    subject: 'subject',
    subject_name: 'subject_name',
    version: 'version',
    date: 'date',
    state: 'state',
  },
  defaultSort: {
    field: 'date',
    direction: 'asc',
  },
  aggregate: {
    baseTable: '',
    alias: 'd',
    groupFields: {
      subject_type: { expression: 'subject_type' },
      state: { expression: 'state' },
      end_of_support_year: { expression: 'end_of_support_year' },
    },
    metricFields: {
      date: { expression: 'date', type: 'date' },
    },
  },
};
