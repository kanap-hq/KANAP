import { GAP_KINDS } from '../../../technologies/reports/end-of-support.service';
import { APPLICATIONS_UNREAD_NOTE } from '../ai-support.query';
import { AiEntityFilterRegistry } from '../ai-filter.types';

/**
 * The "What is missing" list of the End of support report (lot 2 of Plaid L5), read through
 * `EndOfSupportService.gaps` (`technologies/reports/end-of-support.service.ts`) as the report's
 * Gaps tab shows it: one row per record to complete, with the report's `infrastructure` right and
 * the caller's application read scope. The service returns a complete, small list: the list is
 * filtered, grouped, sorted and paged in memory (`query/ai-support.query.ts`), never by a second
 * SQL formula. The `aggregate` block is descriptive: `aggregate_entities` groups the same rows in
 * memory and never reads its empty base table.
 *
 * A row names its record by `subject` (business reference where the record has one, its name
 * otherwise), never by an identifier. There is no record detail: read the subject's own family
 * (`get_entity_detail` on applications, assets or technologies) with its reference.
 */
export const supportGapsRegistry: AiEntityFilterRegistry = {
  entityType: 'support_gaps',
  fields: {
    gap: {
      ai: 'gap',
      grid: 'gap',
      type: 'set',
      description: 'Kind of missing data: application_without_server (an application in service on premises or private cloud with no server in service), vm_without_host (a virtual machine in service with no host), technology_not_installed (an on-premises technology installed on no server), technology_without_hosting_type (a hosting type outside the tenant catalog), database_server_without_dbms (a server with a database role and no database technology), sso_application_without_identity (an SSO application with no directory technology), link_without_version (a server or application linked without a version), version_without_end_date (a version in use with no end of support date).',
      values: [...GAP_KINDS],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    subject_type: {
      ai: 'subject_type',
      grid: 'subject_type',
      type: 'set',
      description: `Family of the record to complete: application, asset or technology. Grouping counts the records of each family. ${APPLICATIONS_UNREAD_NOTE}`,
      values: ['application', 'asset', 'technology'],
      discoverable: true,
      sortable: true,
      groupable: true,
    },
    subject: {
      ai: 'subject',
      grid: 'subject',
      type: 'text',
      description: 'Business reference of the record to complete (APP-n, AST-n, TEC-n), or its name when it has none. A reference compares exactly; any other value matches the name.',
      sortable: true,
      groupable: false,
    },
    subject_name: {
      ai: 'subject_name',
      grid: 'subject_name',
      type: 'text',
      description: 'Name of the record to complete.',
      sortable: true,
      groupable: false,
    },
    related: {
      ai: 'related',
      grid: 'related',
      type: 'text',
      description: 'The other end of a link without version (a server or an application), by its business reference (AST-n, APP-n) or its name when it has none. Null otherwise. A reference compares exactly; any other value matches the name.',
      sortable: true,
      groupable: false,
    },
    related_type: {
      ai: 'related_type',
      grid: 'related_type',
      type: 'set',
      description: 'Family of the other end of a link without version: asset or application. Null for every other gap.',
      values: ['asset', 'application'],
      discoverable: true,
      sortable: false,
      groupable: false,
    },
    version: {
      ai: 'version',
      grid: 'version',
      type: 'text',
      description: 'The version concerned by a link without version or a version without end date. Null otherwise.',
      sortable: true,
      groupable: false,
    },
  },
  sortFields: {
    gap: 'gap',
    subject_type: 'subject_type',
    subject: 'subject',
    subject_name: 'subject_name',
    related: 'related',
    version: 'version',
  },
  defaultSort: {
    field: 'gap',
    direction: 'asc',
  },
  aggregate: {
    baseTable: '',
    alias: 'g',
    groupFields: {
      gap: { expression: 'gap' },
      subject_type: { expression: 'subject_type' },
    },
  },
};
