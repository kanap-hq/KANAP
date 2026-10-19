import { AiEntityFilterRegistry } from '../ai-filter.types';
import {
  technologyEndOfSupportSql,
  technologyOpenVulnerabilitiesSql,
  technologyServerCountSql,
} from '../ai-technologies.query';

/**
 * Technologies (lot C2b): read through `listAiTechnologies` (`ai-technologies.query.ts`), which
 * defines the four computed figures. `application_count` filters and sorts within the caller's
 * application read scope; it is no metric, since an aggregate expression cannot carry that scope.
 */
export const technologiesRegistry: AiEntityFilterRegistry = {
  entityType: 'technologies',
  fields: {
    reference: {
      ai: 'reference',
      grid: 'reference',
      type: 'set',
      description: 'Technology reference, such as TEC-12.',
      acceptedValueKind: 'TEC-n reference',
      examples: ['TEC-12'],
      sortable: true,
      groupable: false,
    },
    name: {
      ai: 'name',
      grid: 'name',
      type: 'text',
      description: 'Technology name (contains, without case).',
      sortable: true,
      groupable: false,
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
    publisher: {
      ai: 'publisher',
      grid: 'editor',
      type: 'set',
      description: 'Publisher of the technology (exact name, without case).',
      aliases: ['editor', 'vendor'],
      dynamic: true,
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    hosting_type: {
      ai: 'hosting_type',
      grid: 'hosting_type',
      type: 'set',
      description: 'How the technology is run: a hosting type code of the tenant catalog (installed on premises, subscribed as a service...).',
      aliases: ['mode'],
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
    admin_zone: {
      ai: 'admin_zone',
      grid: 'admin_zone',
      type: 'set',
      description: 'Administration zone of the technology (directory technologies).',
      dynamic: true,
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    server_count: {
      ai: 'server_count',
      grid: 'server_count',
      type: 'number',
      description: 'Number of servers the technology is installed on directly; retired assets are not counted.',
      sortable: true,
      groupable: false,
      aggregable: true,
    },
    application_count: {
      ai: 'application_count',
      grid: 'application_count',
      type: 'number',
      description: 'Number of applications in service that declare the technology directly, among the applications the user can read. null when the user cannot read applications.',
      sortable: true,
      groupable: false,
    },
    end_of_support: {
      ai: 'end_of_support',
      grid: 'end_of_support',
      type: 'date',
      description: 'Earliest end of support among the versions in use (on a server in service or declared by an application in service): a version\'s standard end, or its extended end when it has no standard one, as in the End of support report. A date in the past means a version in use is out of standard support. null when no version in use has a date.',
      blankable: true,
      sortable: true,
      groupable: false,
      aggregable: true,
    },
    open_vulnerabilities: {
      ai: 'open_vulnerabilities',
      grid: 'open_vulnerabilities',
      type: 'number',
      description: 'Number of matched vulnerabilities (CVE) still to review. null when the vulnerability feed is off.',
      sortable: true,
      groupable: false,
      aggregable: true,
    },
  },
  sortFields: {
    label: 'name',
    reference: 'reference',
    name: 'name',
    family: 'family',
    publisher: 'editor',
    hosting_type: 'hosting_type',
    lifecycle: 'lifecycle',
    admin_zone: 'admin_zone',
    server_count: 'server_count',
    application_count: 'application_count',
    end_of_support: 'end_of_support',
    open_vulnerabilities: 'open_vulnerabilities',
    created_at: 'created_at',
    updated_at: 'updated_at',
  },
  defaultSort: {
    field: 'name',
    direction: 'asc',
  },
  aggregate: {
    baseTable: 'technologies',
    alias: 't',
    groupFields: {
      family: { expression: 't.family' },
      // Grouped without case, as the publisher filter compares: one group per publisher, named by
      // its first spelling in binary order (capitals first).
      publisher: {
        expression: `(SELECT min(pt.editor COLLATE "C") FROM technologies pt
                       WHERE pt.tenant_id = t.tenant_id AND lower(pt.editor) = lower(t.editor))`,
      },
      hosting_type: { expression: 't.hosting_type' },
      lifecycle: { expression: 't.lifecycle' },
      admin_zone: { expression: 't.admin_zone' },
    },
    metricFields: {
      server_count: { expression: technologyServerCountSql('t'), type: 'number' },
      // As text, so a minimum or maximum reads as YYYY-MM-DD (same order as the dates).
      end_of_support: { expression: `to_char(${technologyEndOfSupportSql('t')}, 'YYYY-MM-DD')`, type: 'date' },
      open_vulnerabilities: { expression: technologyOpenVulnerabilitiesSql('t'), type: 'number' },
    },
  },
};
