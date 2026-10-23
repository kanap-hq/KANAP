/**
 * Reference columns without a foreign key. A reference column is one that names a row by its id:
 * a column named `*_id` or `*_ids`, or any `uuid` / `uuid[]` column other than `id`. Every one
 * of them has a foreign key (`common/migration-reference-keys.ts`, migrations 1854070000000,
 * 1854080000000, 1854090000000, 1854160000000 and earlier) or is listed here with the reason it
 * has none. `__tests__/reference-keys.inventory.integration.spec.ts` reads the database and fails
 * on a reference column that has neither, and on an entry here whose column is gone or keyed. It
 * also fails on a key that deletes or clears rows without an index leading with its columns.
 *
 * A new reference column gets a key in its migration: ON DELETE CASCADE for a row that means
 * nothing without the row it names, SET NULL for a nullable reference, RESTRICT when the delete
 * service refuses a row still in use. An entry here is for a column no key can serve: a list, a
 * polymorphic reference (cleaned by the delete services, named in the reason), a record kept as
 * written, or an identifier from another system.
 */

/** Column names that never carry a key, whatever the table. */
export const UNKEYED_COLUMN_NAMES: Readonly<Record<string, string>> = {
  tenant_id:
    'The tenant of the row. Row level security isolates it, and the tenant purge deletes the rows of every ' +
    'tenant table in order (admin/tenants/tenant-purge.inventory.ts) before the tenant goes.',
};

const DORMANT_CAPEX =
  'Dormant CAPEX table: no code reads or writes it since lot Z1 (spend/budget-nature.ts); it is dropped in lot Z2.';
const AI_RECORD =
  'AI activity record: names what the assistant read, targeted or produced at the time, and is kept as written ' +
  'once that row is gone (pruned by the AI retention jobs).';
const AI_CLAIM =
  'Claim of the agent work queue: set and released as a whole with claim_status and claim_expires_at, and ' +
  'taken over once expired. A key clearing one id alone would leave half a claim.';
const PLAN_STEP_COPY =
  'Copy of the value on the step\'s plan: the step goes with its plan (plan_id ON DELETE CASCADE), whose own key covers it.';
const EXTERNAL = 'Identifier in another system (Stripe, Entra, Netbox, an ERP, an OAuth client), not a row here.';
const NOT_A_REFERENCE = 'Not a reference: a token, a business number or a technical identifier.';

/** `table.column` → why it has no foreign key. */
export const UNKEYED_REFERENCE_COLUMNS: Readonly<Record<string, string>> = {
  // AI records and work queue.
  'ai_action_requests.evidence_ids': AI_RECORD,
  'ai_action_requests.target_id': AI_RECORD,
  'ai_agent_work_items.last_action_request_ids': AI_RECORD,
  'ai_approvals.evidence_ids': AI_RECORD,
  'ai_decisions.evidence_ids': AI_RECORD,
  'ai_evidence.source_object_id': AI_RECORD,
  'ai_mutation_plan_steps.result_entity_id': AI_RECORD,
  'ai_mutation_previews.target_entity_id': AI_RECORD,
  'ai_observations.evidence_ids': AI_RECORD,
  'ai_observations.source_object_id': AI_RECORD,
  'ai_recommendations.evidence_ids': AI_RECORD,
  'ai_agent_target_states.claim_owner_action_request_ids': AI_CLAIM,
  'ai_agent_target_states.claim_owner_run_id': AI_CLAIM,
  'ai_agent_target_states.claim_owner_work_item_id': AI_CLAIM,
  'ai_mutation_plan_steps.conversation_id': PLAN_STEP_COPY,
  'ai_mutation_plan_steps.user_id': PLAN_STEP_COPY,
  'ai_settings.builtin_accepted_by': 'Who accepted the built-in AI terms: an acceptance record, kept once that user is gone.',

  // Records kept as written.
  'audit_log.record_id': 'Audit trail: names the row and the user as they were, and is never rewritten.',
  'audit_log.user_id': 'Audit trail: names the row and the user as they were, and is never rewritten.',
  'search_index.entity_id': 'Search index (entity_type, entity_id): the row triggers of each source table write and remove its entry.',
  'platform_ai_config.updated_by': 'Platform administrator who changed a platform setting: platform scope, outside any tenant.',
  'tenants.frozen_by': 'Who froze the tenant, kept on the tenant row as a record (often a platform administrator, outside the tenant).',
  'tenants.deletion_requested_by': 'Who asked for the tenant deletion, kept on the tenant row as a record.',
  'users.data_access_updated_by': 'Who last changed the person\'s data access: kept on the user row as a record, like the audit trail.',

  // Polymorphic references and lists, cleaned by the delete services.
  'tasks.related_object_id':
    'Polymorphic (related_object_type). Deleting a budget line, a contract or an incident deletes its tasks ' +
    '(spend/item-delete-cleanup.ts, deleteItemTasks); projects are never deleted.',
  'integrated_document_bindings.source_entity_id':
    'Polymorphic (source_entity_type). Deleting an application, an interface, a request or an incident deletes its managed ' +
    'documents (IntegratedDocumentsService.deleteForEntity); projects are never deleted. A document ' +
    'whose source is gone anyway is released by the daily cleanup (knowledge/integrated-document-orphans.ts).',
  'tasks.owner_ids': 'List of users (jsonb). Deleting a user removes it from the lists (UsersDeleteService).',
  'tasks.viewer_ids': 'List of users (jsonb). Deleting a user removes it from the lists (UsersDeleteService).',
  'asset_external_links.candidate_asset_ids':
    'Match candidates (uuid[]) recomputed at every Netbox sync; the reader drops the ids of assets that are gone.',
  'allocation_rules.company_ids':
    'List of companies (uuid[]). A company named here cannot be deleted: the company delete check counts the ' +
    'default allocation methods that spread over it (companies/company-usages.ts).',

  // Vulnerabilities (NVD feed).
  'technology_vulnerabilities.cve_id':
    'Names a CVE of the platform cache (vulnerability_cves) without a key, so that the tenant export and the tenant ' +
    'purge stay within the tenant\'s tables. The feed never deletes a CVE that a tenant row names.',
  'vulnerability_cves.cve_id':
    'Not a reference: the CVE number published by the NVD, primary key of the platform cache.',
  'vulnerability_cves.euvd_id':
    'Not a reference: the ENISA identifier of the same CVE (EUVD-AAAA-NNNNN), stored when the European mapping names one.',
  'vulnerability_cve_records.cve_id':
    'Not a reference: the CVE number published by CVE.org, primary key of the platform cache.',

  // Identifiers of other systems.
  'ai_api_keys.oauth_client_id': EXTERNAL,
  'asset_external_links.external_id': EXTERNAL,
  'location_sub_items.external_id': EXTERNAL,
  'subscriptions.default_payment_method_id': EXTERNAL,
  'subscriptions.latest_invoice_id': EXTERNAL,
  'subscriptions.stripe_customer_id': EXTERNAL,
  'subscriptions.stripe_price_id': EXTERNAL,
  'subscriptions.stripe_product_id': EXTERNAL,
  'subscriptions.stripe_subscription_id': EXTERNAL,
  'suppliers.erp_supplier_id': EXTERNAL,
  'tenants.billing_tax_id': EXTERNAL,
  'tenants.entra_tenant_id': EXTERNAL,
  'tenants.stripe_customer_id': EXTERNAL,

  // Not references.
  'ai_api_keys.oauth_code_jti': NOT_A_REFERENCE,
  'ai_runs.request_id': NOT_A_REFERENCE,
  'applications.sequential_id': NOT_A_REFERENCE,
  'interfaces.interface_id': NOT_A_REFERENCE,
  'ops_process_metrics.worker_id': NOT_A_REFERENCE,
  'tenants.deletion_token': NOT_A_REFERENCE,

  // Dormant CAPEX tables.
  'capex_allocations.company_id': DORMANT_CAPEX,
  'capex_allocations.department_id': DORMANT_CAPEX,
  'capex_allocations.rule_id': DORMANT_CAPEX,
  'capex_attachments.capex_item_id': DORMANT_CAPEX,
  'capex_item_analytics_values.axis_id': DORMANT_CAPEX,
  'capex_item_analytics_values.category_id': DORMANT_CAPEX,
  'capex_items.cost_center_id': DORMANT_CAPEX,
  'capex_items.project_id': DORMANT_CAPEX,
  'capex_items.supplier_id': DORMANT_CAPEX,
  'capex_links.capex_item_id': DORMANT_CAPEX,
  'capex_round_input_lines.working_day_profile_id': DORMANT_CAPEX,
  'capex_round_inputs.updated_by': DORMANT_CAPEX,
  'contract_capex_items.capex_item_id': DORMANT_CAPEX,
  'contract_capex_items.contract_id': DORMANT_CAPEX,
};

/**
 * Tables whose foreign keys that delete or clear rows (ON DELETE CASCADE or SET NULL) may go
 * without an index leading with the key's columns, each with the reason: a table that stays tiny
 * whatever the tenant does. Every other such key has one (migration 1854180000000), so deleting the
 * parent row does not read the whole child table.
 */
export const UNINDEXED_DELETING_KEY_TABLES: Readonly<Record<string, string>> = {};

/**
 * Columns whose key comes with a migration of another change: accepted with or without a key
 * until it lands, then removed from here.
 */
export const KEYED_BY_PENDING_MIGRATION: readonly string[] = [];
