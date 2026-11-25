import type { AiQueryEntityType } from '../ai/query/ai-filter.types';

/**
 * The tables whose `updated_at` the database keeps, with their technical columns: each has the
 * trigger `<table>_updated_at` on `stamp_updated_at()` (migration 1856270000000), whose `WHEN`
 * compares every other column (`updated-at-trigger.ts`). A change of technical columns alone is
 * no edit and leaves the date; any other change takes `now()`, unless the statement writes
 * `updated_at` itself. A column added here is applied by `syncUpdatedAtTrigger` in a migration.
 *
 * A table enters here when the assistant, the MCP server or a screen list reads its date (the
 * family map below), through a migration that places its trigger.
 * `__tests__/updated-at.inventory.integration.spec.ts` compares this list with the database.
 */
export const UPDATED_AT_TABLES: Readonly<Record<string, readonly string[]>> = {
  accounts: ['status'],
  analytics_axes: ['status', 'sort_order'],
  analytics_categories: ['status', 'sort_order'],
  applications: [],
  assets: [],
  business_processes: ['status'],
  chart_of_accounts: [],
  companies: ['status'],
  connections: [],
  contacts: [],
  contracts: ['status'],
  departments: ['status'],
  documents: ['search_vector', 'revision', 'current_version_number', 'created_by', 'updated_by'],
  incidents: ['created_by', 'updated_by'],
  interfaces: [],
  locations: [],
  portfolio_projects: ['priority_score'],
  portfolio_requests: ['priority_score', 'created_by_id'],
  roles: [],
  spend_items: ['status', 'row_version'],
  suppliers: ['status'],
  tasks: ['creator_id'],
  technologies: ['catalog_state'],
  technology_versions: [],
  technology_vulnerabilities: ['state_changed_by'],
  users: ['last_login_at', 'external_synced_at', 'password_hash', 'mfa_secret'],
  working_day_profiles: ['status'],
};

/** Why a technical column is one, by column name (`status`: the lifecycle status sync). */
export const UPDATED_AT_TECHNICAL_REASONS: Readonly<Record<string, string>> = {
  status: 'derived from the end of validity; the hourly lifecycle status sync catches it up',
  sort_order: 'display order: a reorder of the list is no edit of the record',
  row_version: 'concurrency counter of the budget line, written by its own trigger',
  priority_score: 'computed from the criteria values and the override, which carry the change',
  search_vector: 'search index of the document',
  revision: 'save counter of the document (its editors\' optimistic lock): every save takes one, changed or not',
  current_version_number: 'number of the last version snapshot, which keeps a content the document already holds',
  updated_by: 'who saved last: written by every save, changed or not, and emptied when that person is deleted',
  created_by: 'author: emptied when that person is deleted (ON DELETE SET NULL), which is no edit of the record',
  created_by_id: 'author: emptied when that person is deleted (ON DELETE SET NULL), which is no edit of the record',
  creator_id: 'author: emptied when that person is deleted (ON DELETE SET NULL), which is no edit of the record',
  state_changed_by: 'who changed the state last: emptied when that person is deleted (ON DELETE SET NULL); the state itself carries the change',
  catalog_state: 'memory of the catalog synchronization (what it last applied); the columns it fills carry the change',
  last_login_at: 'sign-in stamp',
  external_synced_at: 'directory synchronization stamp',
  password_hash: 'sign-in secret',
  mfa_secret: 'sign-in secret',
};

/**
 * Every family of the assistant's and the MCP server's queries: the table whose `updated_at` it
 * shows, sorts or filters on, or why it shows none (its summaries carry `updated_at: null`, or
 * another date). A new family must take a side here: the type demands every family.
 */
export const UPDATED_AT_FAMILIES: Readonly<Record<AiQueryEntityType, string | { none: string }>> = {
  accounts: 'accounts',
  analytics_axes: 'analytics_axes',
  analytics_categories: 'analytics_categories',
  applications: 'applications',
  assets: 'assets',
  budget_lines: 'spend_items',
  business_processes: 'business_processes',
  chargeback: { none: 'a computed report, no stored row' },
  chargeback_lines: { none: 'a computed report, no stored row' },
  chart_of_accounts: 'chart_of_accounts',
  companies: 'companies',
  connections: 'connections',
  contacts: 'contacts',
  contracts: 'contracts',
  cost_centers: { none: 'the summaries carry no modification date' },
  data_access: { none: 'shows the date of the access settings (users.data_access_updated_at)' },
  departments: 'departments',
  documents: 'documents',
  exchange_rates: { none: 'shows the capture date of the rate' },
  incidents: 'incidents',
  interfaces: 'interfaces',
  locations: 'locations',
  projects: 'portfolio_projects',
  requests: 'portfolio_requests',
  role_permissions: { none: 'the summaries carry no modification date' },
  roles: 'roles',
  suppliers: 'suppliers',
  support_deadlines: { none: 'a computed report, no stored row' },
  support_gaps: { none: 'a computed report, no stored row' },
  tasks: 'tasks',
  technologies: 'technologies',
  technology_versions: 'technology_versions',
  users: 'users',
  vulnerabilities: 'technology_vulnerabilities',
  working_day_calendars: 'working_day_profiles',
};

/**
 * The tables of the inventory whose rows the search index keeps (`search_index_sync_<table>()`,
 * on the triggers `trg_search_index_<table>*`), with the `search_index.entity_type` of their
 * entries. An update of the date alone does not run the sync: the date trigger copies it to
 * `source_updated_at` (`syncSearchIndexTriggers`, `updated-at-trigger.ts`).
 */
export const UPDATED_AT_SEARCH_ENTITY_TYPES: Readonly<Record<string, readonly string[]>> = {
  accounts: ['accounts'],
  analytics_categories: ['analytics_categories'],
  applications: ['applications'],
  assets: ['assets'],
  business_processes: ['business_processes'],
  chart_of_accounts: ['chart_of_accounts'],
  companies: ['companies'],
  connections: ['connections'],
  contacts: ['contacts'],
  contracts: ['contracts'],
  departments: ['departments'],
  documents: ['documents'],
  incidents: ['incidents'],
  interfaces: ['interfaces'],
  locations: ['locations'],
  portfolio_projects: ['projects'],
  portfolio_requests: ['requests'],
  spend_items: ['spend_items', 'capex_items'],
  suppliers: ['suppliers'],
  tasks: ['tasks'],
  technologies: ['technologies'],
  users: ['users'],
};
