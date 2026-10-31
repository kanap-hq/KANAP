/**
 * Data-scoped access: the tables, views and functions of the budget block, as the catalog of a
 * migrated database shows them (planning/data-scoped-access/spec.md §6.4, §6.5, §10.3).
 * `data-access/__tests__/data-access-tables-inventory.spec.ts` compares the catalog with these
 * lists both ways: a table, view or function found by its rules and missing here fails, and so
 * does an entry here that the rules no longer find.
 *
 * Tables are found by two rules:
 * - foreign key: a table with a foreign key to `spend_items`, `spend_versions`, `contracts` or
 *   `tasks`, or to a table classified here as `follows_line`, `follows_contract` or
 *   `task_element` (so `spend_round_input_lines` comes through `spend_round_inputs`);
 * - polymorphic: a table with a pair of columns `<stem>_type` or `<stem>_kind` and `<stem>_id` or
 *   `<stem>_ref` (a non-empty stem), or `table_name` and `record_id`. A `<stem>_key` names a
 *   configuration key of the AI tables (provider_key, agent_key, trigger_key, target_key of the
 *   external test targets), never a KANAP object: not a pair.
 * The roots `spend_items`, `contracts` and `tasks` are listed too.
 *
 * `policies` says which run or lot gives the table its data-access policies: `lot2a` (lines and
 * the tables that follow them), `lot2b` (link tables to lines, tasks, their elements and links,
 * search index), `lot5` (contracts),
 * `null` for an excluded table. The spec checks that the tables of `data_access_expected_policies()`
 * are exactly those whose run is done (DONE_POLICY_RUNS).
 */

export type DataAccessTableClass =
  | 'line'
  | 'follows_line'
  | 'contract'
  | 'follows_contract'
  | 'link_to_line'
  | 'link_to_contract'
  | 'task'
  | 'task_element'
  | 'link_to_task'
  | 'search_index'
  | 'excluded';

export type DataAccessPolicyRun = 'lot2a' | 'lot2b' | 'lot5';

export type DataAccessTableEntry = {
  table: string;
  cls: DataAccessTableClass;
  policies: DataAccessPolicyRun | null;
  reason: string;
};

/** The runs whose policies the migrations create today. */
export const DONE_POLICY_RUNS: DataAccessPolicyRun[] = ['lot2a', 'lot2b', 'lot5'];

export const DATA_ACCESS_TABLES: DataAccessTableEntry[] = [
  // Roots.
  { table: 'spend_items', cls: 'line', policies: 'lot2a', reason: 'the budget lines (OPEX and CAPEX), spec §4.1' },
  { table: 'contracts', cls: 'contract', policies: 'lot5', reason: 'the contracts, spec §4.3' },
  { table: 'tasks', cls: 'task', policies: 'lot2b', reason: 'polymorphic (related_object_type, related_object_id); line and contract tasks are scoped, the others pass' },

  // Follow a line (foreign key to spend_items, or through its version).
  { table: 'spend_versions', cls: 'follows_line', policies: 'lot2a', reason: 'versions of a line (spend_item_id)' },
  { table: 'spend_amounts', cls: 'follows_line', policies: 'lot2a', reason: 'monthly amounts of a version (version_id)' },
  { table: 'spend_allocations', cls: 'follows_line', policies: 'lot2a', reason: 'allocations of a version (version_id)' },
  { table: 'spend_round_inputs', cls: 'follows_line', policies: 'lot2a', reason: 'round inputs of a version (version_id)' },
  { table: 'spend_round_input_lines', cls: 'follows_line', policies: 'lot2a', reason: 'priced lines of a round input (round_input_id)' },
  { table: 'spend_version_totals', cls: 'follows_line', policies: 'lot2a', reason: 'totals of a version (version_id), written by its triggers' },
  { table: 'spend_item_analytics_values', cls: 'follows_line', policies: 'lot2a', reason: 'axis values of a line (item_id)' },
  { table: 'spend_item_contacts', cls: 'follows_line', policies: 'lot2a', reason: 'contacts of a line (spend_item_id)' },
  { table: 'spend_links', cls: 'follows_line', policies: 'lot2a', reason: 'links of a line (spend_item_id)' },
  { table: 'spend_attachments', cls: 'follows_line', policies: 'lot2a', reason: 'attachments of a line (spend_item_id)' },
  { table: 'spend_tasks', cls: 'follows_line', policies: 'lot2a', reason: 'legacy tasks of a line (item_id), still read' },

  // Follow a contract.
  { table: 'contract_attachments', cls: 'follows_contract', policies: 'lot5', reason: 'attachments of a contract; read only when the parent contract is directly readable (spec §4.3, §5.4)' },
  { table: 'contract_compliance_items', cls: 'follows_contract', policies: 'lot5', reason: 'compliance items of a contract' },
  { table: 'contract_contacts', cls: 'follows_contract', policies: 'lot5', reason: 'contacts of a contract' },
  { table: 'contract_links', cls: 'follows_contract', policies: 'lot5', reason: 'document links of a contract; read only when the parent contract is directly readable (spec §4.3, §5.4)' },
  { table: 'contract_tasks', cls: 'follows_contract', policies: 'lot5', reason: 'legacy tasks of a contract, no reader left in backend/src; policies kept for safety' },

  // Links from other objects to a line.
  { table: 'application_spend_items', cls: 'link_to_line', policies: 'lot2b', reason: 'application to line' },
  { table: 'asset_spend_items', cls: 'link_to_line', policies: 'lot2b', reason: 'asset to line' },
  { table: 'technology_spend_items', cls: 'link_to_line', policies: 'lot2b', reason: 'technology to line' },
  { table: 'portfolio_project_opex', cls: 'link_to_line', policies: 'lot2b', reason: 'project to line (opex_id)' },
  { table: 'portfolio_request_opex', cls: 'link_to_line', policies: 'lot2b', reason: 'request to line (opex_id)' },

  // Links from other objects to a contract.
  { table: 'application_contracts', cls: 'link_to_contract', policies: 'lot5', reason: 'application to contract' },
  { table: 'asset_contracts', cls: 'link_to_contract', policies: 'lot5', reason: 'asset to contract' },
  { table: 'technology_contracts', cls: 'link_to_contract', policies: 'lot5', reason: 'technology to contract' },

  // Elements of a task.
  { table: 'task_applications', cls: 'task_element', policies: 'lot2b', reason: 'applications of a task' },
  { table: 'task_assets', cls: 'task_element', policies: 'lot2b', reason: 'assets of a task' },
  { table: 'task_attachments', cls: 'task_element', policies: 'lot2b', reason: 'attachments of a task' },
  { table: 'task_time_entries', cls: 'task_element', policies: 'lot2b', reason: 'time entries of a task' },

  // Links from other objects to a task.
  { table: 'document_tasks', cls: 'link_to_task', policies: 'lot2b', reason: 'relation of a knowledge document to a task: the link belongs to the document, so the task must be visible for every command, like the links to a line (spec §5.4)' },

  // Search index.
  { table: 'search_index', cls: 'search_index', policies: 'lot2b', reason: 'polymorphic (entity_type, entity_id); entries of lines, contracts and their tasks are scoped' },

  // Excluded, with the reason.
  { table: 'contract_spend_items', cls: 'excluded', policies: null, reason: 'cited by the contract policy; its writes are checked by the service (spec §6.4, lot 5)' },
  { table: 'asset_support_info', cls: 'excluded', policies: null, reason: 'support_contract_id is an attribute of an asset (assets are not scoped); an invisible support contract shows as a mention (spec §5.4), run 5C' },
  { table: 'portfolio_activities', cls: 'excluded', policies: null, reason: 'activity feed of every task (task_id, whatever its object, a budget line included) and of portfolio requests and projects (not scoped); a task\'s activities are read and written through the task, whose row is read first under the task policies (404 when hidden)' },
  { table: 'portfolio_requests', cls: 'excluded', policies: null, reason: 'origin_task_id points to the task a request came from; requests are not scoped' },
  { table: 'ai_action_requests', cls: 'excluded', policies: null, reason: 'polymorphic target; agent screens are reserved to unscoped persons (spec §10.3)' },
  { table: 'ai_agent_target_states', cls: 'excluded', policies: null, reason: 'polymorphic target_type/target_ref name objects of external providers; agent screens reserved' },
  { table: 'ai_agent_work_items', cls: 'excluded', policies: null, reason: 'polymorphic source object; agent screens reserved (spec §10.3)' },
  { table: 'ai_evidence', cls: 'excluded', policies: null, reason: 'polymorphic source object; agent screens reserved (spec §10.3)' },
  { table: 'ai_mutation_plan_steps', cls: 'excluded', policies: null, reason: 'result of a step of the person\'s own AI plan, like ai_mutation_previews' },
  { table: 'ai_mutation_previews', cls: 'excluded', policies: null, reason: 'created by the person (spec §10.3)' },
  { table: 'ai_observations', cls: 'excluded', policies: null, reason: 'polymorphic source object; agent screens reserved (spec §10.3)' },
  { table: 'asset_external_links', cls: 'excluded', policies: null, reason: 'external_type/external_id name objects of an external system' },
  { table: 'audit_log', cls: 'excluded', policies: null, reason: 'table_name/record_id; the audit log screens are reserved (spec §10.3); a record history is read only after the record itself, under the visibility rule of its history family (record-history.service list); the per-record reads serve only a record loaded first under the person\'s access: who changed a line (record-meta counterWriterSql, joined to the line read in item-meta), who wrote a conflicting field (edit-conflicts lastFieldChanges, under the line lock), who created a task (record-creator, for the task read first)' },
  { table: 'integrated_document_bindings', cls: 'excluded', policies: null, reason: 'source_entity_type CHECK names no line, contract or task (requests, projects, interfaces, applications, assets, locations, connections, incidents)' },
];

/**
 * Views and materialized views that read a scoped table. A view runs with its owner's rights, so
 * the policies do not apply through it unless `security_invoker = true`. None exists today; a new
 * one is listed here with `security_invoker` set, or with the reason it is never read by a limited
 * person.
 */
export const DATA_ACCESS_VIEWS: Array<{ view: string; reason: string }> = [];

export type DataAccessFunctionClass = 'definer' | 'access' | 'excluded';

/**
 * Functions of `public` (owned by the application role, outside extensions):
 * - every function whose body names a scoped table (any table above that is not `excluded`) is
 *   listed;
 * - every SECURITY DEFINER function is listed as `definer` or `access`.
 * `definer`: maintains derived data from the budget block (spec §6.5), SECURITY DEFINER with
 * `search_path = public, pg_temp`. `access`: a `data_access_*` function. `excluded`: stays
 * SECURITY INVOKER, with the reason.
 */
export const DATA_ACCESS_FUNCTIONS: Array<{ name: string; cls: DataAccessFunctionClass; reason: string }> = [
  // Derived data (1853720000000 version totals, 1853840000000/1853850000000 budget changed-at and
  // statement triggers, 1853740000000 freshness counters, the search index family).
  { name: 'budget_version_totals_rebuild', cls: 'definer', reason: 'rebuilds spend_version_totals of a tenant' },
  { name: 'spend_amounts_version_totals', cls: 'definer', reason: 'statement trigger: version totals from the amounts' },
  { name: 'spend_amounts_version_totals_truncate', cls: 'definer', reason: 'truncate trigger: version totals' },
  { name: 'spend_versions_budget_year_guard', cls: 'definer', reason: 'guard over all the months of a version' },
  { name: 'spend_allocations_budget_rev', cls: 'definer', reason: 'statement trigger: budget_rev and budget_changed_at of the versions' },
  { name: 'spend_round_inputs_budget_rev', cls: 'definer', reason: 'statement trigger: budget_rev and budget_changed_at of the versions' },
  { name: 'spend_round_input_lines_budget_rev', cls: 'definer', reason: 'statement trigger: budget_rev and budget_changed_at of the versions' },
  { name: 'spend_item_analytics_values_row_version', cls: 'definer', reason: 'statement trigger: row_version of the lines' },
  { name: 'spend_item_analytics_values_search_index', cls: 'definer', reason: 'statement trigger: search entries of the lines' },
  { name: 'search_index_delete', cls: 'definer', reason: 'search index family' },
  ...[
    'accounts', 'analytics_categories', 'applications', 'assets', 'budget_lines', 'business_processes',
    'capex_items', 'chart_of_accounts', 'companies', 'connections', 'contacts', 'contracts', 'departments',
    'documents', 'incidents', 'interfaces', 'locations', 'projects', 'requests', 'spend_items', 'suppliers',
    'tasks', 'technologies', 'users',
  ].map((name) => ({ name: `search_index_refresh_${name}`, cls: 'definer' as const, reason: 'search index family: writes search_index' })),
  ...[
    'accounts', 'analytics_categories', 'applications', 'assets', 'business_processes', 'chart_of_accounts',
    'companies', 'connections', 'contacts', 'contracts', 'departments', 'documents', 'incident_review_binding',
    'incident_review_document', 'incidents', 'interfaces', 'locations', 'portfolio_projects',
    'portfolio_requests', 'spend_items', 'suppliers', 'tasks', 'technologies', 'users',
    'link_application_owners', 'link_business_process_category_links', 'link_connection_protocols',
    'link_contract_spend_items', 'link_location_sub_items', 'link_portfolio_project_team',
    'link_portfolio_request_team', 'link_portfolio_team_member_configs',
  ].map((name) => ({ name: `search_index_sync_${name}`, cls: 'definer' as const, reason: 'search index family: trigger' })),
  { name: 'search_index_sync_link_incident_assets', cls: 'definer', reason: 'search index family: statement trigger, the incidents of a link change refreshed by batch of ids' },
  { name: 'search_index_sync_incident_assets_on_asset', cls: 'definer', reason: 'search index family: trigger, the incidents linked to a renamed asset refreshed by batch of ids' },
  { name: 'search_index_sync_link_incident_applications', cls: 'definer', reason: 'search index family: statement trigger, the incidents of an application link change refreshed by batch of ids' },
  { name: 'search_index_sync_link_incident_technologies', cls: 'definer', reason: 'search index family: statement trigger, the incidents of a technology link change refreshed by batch of ids' },
  { name: 'search_index_sync_incident_applications_on_application', cls: 'definer', reason: 'search index family: trigger, the incidents linked to a renamed application refreshed by batch of ids' },
  { name: 'search_index_sync_incident_technologies_on_technology', cls: 'definer', reason: 'search index family: trigger, the incidents linked to a renamed technology refreshed by batch of ids' },

  // Access functions (lots 1 and 2).
  { name: 'data_access_expected_policies', cls: 'access', reason: 'the expected policies (names the scoped tables)' },
  { name: 'data_access_sync_policies', cls: 'access', reason: 'creates the policies (names the scoped tables)' },
  { name: 'data_access_line_of_version', cls: 'access', reason: 'SECURITY DEFINER: the line of a version, for the grandchild policies' },
  { name: 'data_access_line_of_round_input', cls: 'access', reason: 'SECURITY DEFINER: the line of a round input, for its lines\' policies' },
  { name: 'data_access_contract_visible', cls: 'access', reason: 'SECURITY DEFINER depth function (spec §6.4): lisible_contrat with the person\'s settings' },
  { name: 'data_access_contract_modifiable', cls: 'access', reason: 'SECURITY DEFINER depth function: modifiable_contrat with the person\'s settings, for the writes of contract tasks' },
  { name: 'data_access_line_visible', cls: 'access', reason: 'SECURITY DEFINER helper (spec §6.4, §5.4): a budget line readable by the person, for the link triggers of a contract' },
  { name: 'data_access_contract_spend_items_link', cls: 'access', reason: 'link trigger of contract_spend_items (SECURITY INVOKER, spec §5.4, §6.4): a visible contract and a modifiable line; the same 23503 for an invisible and a nonexistent object' },
  { name: 'data_access_task_visible', cls: 'access', reason: 'SECURITY DEFINER depth function (spec §6.4): a task visible (object readable or participant)' },
  { name: 'data_access_task_modifiable', cls: 'access', reason: 'SECURITY DEFINER depth function: a task modifiable (object modifiable or responsible), for the writes of its elements' },
  { name: 'data_access_visible_contract_ids', cls: 'access', reason: 'SECURITY DEFINER set function (spec §6.4): the visible contracts, once per statement, for the search index policy' },
  { name: 'data_access_searchable_task_ids', cls: 'access', reason: 'SECURITY DEFINER set function (spec §5.4, §6.4): the tasks whose object is readable, once per statement, for the search index policy' },
  { name: 'data_access_tasks_placement', cls: 'access', reason: 'placement trigger of the tasks (SECURITY INVOKER): a new line or contract object must be modifiable in mode limited' },
  { name: 'data_access_hidden_count', cls: 'access', reason: 'SECURITY DEFINER disclosure (spec §6.6): lines linked to a visible object that the person cannot read, the closed documents of a contract opened through a line (contract_document), and the contracts of an application, an asset or a technology that the person cannot read (application_contract, asset_contract, technology_contract)' },
  { name: 'data_access_hidden_category_count', cls: 'access', reason: 'SECURITY DEFINER disclosure (spec §6.6): lines the person cannot read on one dimension value, counted per value for the analytics report; a value answers only when a line the reader may read holds it in the same tenant, dimension and window, and only values of the requested axis in the current tenant answer' },
  { name: 'data_access_reference', cls: 'access', reason: 'SECURITY DEFINER disclosure (spec §6.6): the reference of the line a visible task names, or of a visible line\'s predecessor and successor' },
  { name: 'data_access_can_read', cls: 'access', reason: 'SECURITY DEFINER disclosure (spec §5.6, §6.6): whether another person could read a line, a task or a contract, for the notifications and the warning of "Send the link"' },

  // Stays SECURITY INVOKER.
  { name: 'search_index_line_analytics', cls: 'excluded', reason: 'returns the axis values of a line: called by the definer refresh functions (it then runs as their owner); a direct call keeps the caller\'s policies; must stay inlinable (1853960000000)' },
];
