import { AiEntityFilterRegistry } from '../ai-filter.types';
import { technologyVersionFiguresColumns, SUPPORT_STATUSES } from '../ai-technologies.query';
import { technologyServerFiguresSql } from '../../../technologies/technology-reach.service';
import { versionInUseSql } from '../../../technologies/reports/version-support';

/**
 * Technology versions (lot 1 of Plaid L5): read through `listAiTechnologyVersions`
 * (`ai-technologies.query.ts`), one item per version of a technology, as the technology detail
 * lists them. The support state and its date follow the End of support report
 * (`technologies/reports/version-support.ts`), the same SQL as the detail, so the figures of this
 * family and of `get_entity_detail` on a technology are the same. `application_count` counts the
 * applications in service that declare the version itself, within the user's application read
 * scope, and is no metric: an aggregate expression cannot carry that scope. A row has no
 * reference of its own: it names its technology by `TEC-n` (`technology`) and its label. There is
 * no single-record detail for a version; the detail of its technology gives every version.
 */
export const technologyVersionsRegistry: AiEntityFilterRegistry = {
  entityType: 'technology_versions',
  fields: {
    label: {
      ai: 'label',
      grid: 'label',
      type: 'set',
      description: 'Version label, exact and without case: 16 keeps the versions labelled 16, never 16.4. Sortable; not groupable.',
      acceptedValueKind: 'exact version label',
      examples: ['16'],
      dynamic: true,
      discoverable: true,
      sortable: true,
      groupable: false,
    },
    technology: {
      ai: 'technology',
      grid: 'technology',
      type: 'set',
      description: 'The technology of the version: its reference (TEC-n) or its exact name, without case. Values come from get_filter_values (the names). Each item carries the reference (technology) and the name (technology_name). Grouping counts the versions of one technology under its name.',
      acceptedValueKind: 'TEC-n reference or technology name',
      examples: ['TEC-12'],
      lookupEntity: 'technologies',
      dynamic: true,
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    support_status: {
      ai: 'support_status',
      grid: 'support_status',
      type: 'set',
      description: 'Support state of the version, as the End of support report states it: out_of_support (past every end of support, standard and extended), extended_support (past its standard end, within its extended support), supported (before its standard end), unknown (no end of support date). Each item carries support_date, the date of that state.',
      values: [...SUPPORT_STATUSES],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    in_use: {
      ai: 'in_use',
      grid: 'in_use',
      type: 'set',
      description: 'Whether the version is in use: installed on a server in service, or declared by an application in service. A version out of use keeps its dates and state. true or false; values come from get_filter_values or are taken as written.',
      values: ['true', 'false'],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    end_of_standard_support: {
      ai: 'end_of_standard_support',
      grid: 'end_of_standard_support',
      type: 'date',
      description: 'End of standard support of the version, as recorded (the standard end). null when none is recorded, even if an extended end is. Filter on it for standard support ending soon; the support state of the version tells whether it is out of support.',
      blankable: true,
      sortable: true,
      groupable: false,
      aggregable: true,
    },
    end_of_support: {
      ai: 'end_of_support',
      grid: 'end_of_support',
      type: 'date',
      description: 'End of all support of the version, as recorded (the extended end when one is set). null when none is recorded. After it the version has no support at all; the state of a version with an extended end stays supported or extended_support until that date.',
      blankable: true,
      sortable: true,
      groupable: false,
      aggregable: true,
    },
    family: {
      ai: 'family',
      grid: 'family',
      type: 'set',
      description: 'Technology family code from the tenant catalog (for example database, operating_system, identity).',
      dynamic: true,
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    lifecycle: {
      ai: 'lifecycle',
      grid: 'lifecycle',
      type: 'set',
      description: 'Lifecycle status of the technology in the tenant.',
      dynamic: true,
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    end_of_support_year: {
      ai: 'end_of_support_year',
      grid: 'end_of_support_year',
      type: 'set',
      description: 'Year (YYYY) of the date of the version\'s support state (support_date): the year support ends for a supported version, the year it ended for a version out of support or in extended support. null for a version without a support date. Grouping answers "which versions end in 2027". Values come from get_filter_values.',
      acceptedValueKind: 'year, as YYYY',
      examples: ['2027'],
      dynamic: true,
      discoverable: true,
      sortable: false,
      groupable: true,
    },
    server_count: {
      ai: 'server_count',
      grid: 'server_count',
      type: 'number',
      description: 'Number of servers in service this version is installed on directly; clusters excluded, retired assets not counted.',
      sortable: true,
      groupable: false,
      aggregable: true,
    },
    application_count: {
      ai: 'application_count',
      grid: 'application_count',
      type: 'number',
      description: 'Number of applications in service that declare this version itself, among the applications the user can read. A version nobody declares is 0, never its technology\'s other versions. null when the user cannot read applications.',
      sortable: true,
      groupable: false,
    },
  },
  sortFields: {
    label: 'label',
    technology: 'technology',
    support_status: 'support_status',
    in_use: 'in_use',
    end_of_standard_support: 'end_of_standard_support',
    end_of_support: 'end_of_support',
    family: 'family',
    lifecycle: 'lifecycle',
    server_count: 'server_count',
    application_count: 'application_count',
    created_at: 'created_at',
    updated_at: 'updated_at',
  },
  defaultSort: {
    field: 'technology',
    direction: 'asc',
  },
  aggregate: {
    baseTable: 'technology_versions',
    alias: 'v',
    groupFields: {
      technology: {
        expression: 't.name',
        joins: [`JOIN technologies t ON t.tenant_id = v.tenant_id AND t.id = v.technology_id`],
      },
      support_status: { expression: technologyVersionFiguresColumns('v', 'sf').support_status },
      in_use: {
        expression: `CASE WHEN ${versionInUseSql('v')} THEN 'true' ELSE 'false' END`,
      },
      family: {
        expression: 't.family',
        joins: [`JOIN technologies t ON t.tenant_id = v.tenant_id AND t.id = v.technology_id`],
      },
      lifecycle: {
        expression: 't.lifecycle',
        joins: [`JOIN technologies t ON t.tenant_id = v.tenant_id AND t.id = v.technology_id`],
      },
      end_of_support_year: { expression: technologyVersionFiguresColumns('v', 'sf').support_year },
    },
    metricFields: {
      // As text, so a minimum or maximum reads as YYYY-MM-DD (same order as the dates).
      end_of_standard_support: { expression: `to_char(v.standard_support_end, 'YYYY-MM-DD')`, type: 'date' },
      end_of_support: { expression: `to_char(v.extended_support_end, 'YYYY-MM-DD')`, type: 'date' },
      server_count: {
        expression: technologyVersionFiguresColumns('v', 'sf').servers,
        joins: [`LEFT JOIN ${technologyServerFiguresSql('$1')} sf ON sf.technology_id = v.technology_id`],
        type: 'number',
      },
    },
  },
};
