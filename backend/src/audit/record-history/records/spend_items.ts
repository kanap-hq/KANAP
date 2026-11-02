import type { AuditParentRule } from '../../audit-parent-rules';
import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { HistoryFields } from '../field-rules';
import { hidden, shown } from '../field-rules';

/**
 * The budget line (lot 1): its page, the audit labels of the line of either nature and of its
 * children, their allow-lists and their parent rules.
 *
 * The record entry is read by `record-history.inventory.ts`, the fields by `../fields.ts` and the
 * parent rules by `audit-parent-rules.ts`. A CAPEX line keeps the CAPEX audit label of before lot
 * Z1 (`budget-nature.ts`, `auditTableOf`); both natures write the same physical tables.
 */
export const spendItemsRecord = {
  table: 'spend_items',
  module: 'budget',
  level: 'reader',
  auditLabels: ['spend_items', 'capex_items'],
  family: 'budget_line',
  children: {
    // Versions and their budget tables: both labels of the single physical family.
    spend_versions: 'version',
    capex_versions: 'version',
    spend_amounts: 'amounts',
    capex_amounts: 'amounts',
    spend_allocations: 'allocations',
    capex_allocations: 'allocations',
    spend_round_inputs: 'round_input',
    capex_round_inputs: 'round_input',
    // Children of the line.
    spend_links: 'link',
    capex_links: 'link',
    spend_attachments: 'attachment',
    capex_attachments: 'attachment',
    spend_item_contacts: 'contact',
    capex_item_contacts: 'contact',
    // The line's tasks: the saved task names it (`related_object_type` = 'spend_item' or
    // 'capex_item', shared rule in `audit-parent-rules.ts`).
    tasks: 'task',
    // Links to another object. Both sides write the same label: from the line, `record_id` is the
    // line; from the application, technology, asset, contract, project or request, it is that
    // object. Technologies keep one label for both natures.
    application_spend_items: 'application',
    application_capex_items: 'application',
    technology_spend_items: 'technology',
    asset_spend_items: 'asset',
    asset_capex_items: 'asset',
    // Contract, project and request links hold the line of either nature under the OPEX label
    // from their own side, and under their nature's label from the line (`auditTableOf`).
    contract_spend_items: 'contract',
    contract_capex_items: 'contract',
    portfolio_project_opex: 'project',
    portfolio_project_capex: 'project',
    portfolio_request_opex: 'request',
    portfolio_request_capex: 'request',
  },
  // `record_id` names the line or the other object depending on the side that wrote, so no label
  // rule can be exact: the writer gives the line as `parent`, and the other side only when a
  // single line changed (`singleChangedId`). The line side always does
  // (`item-applications.ts`, `item-technologies.ts`, `budget-line-relations.ts`); the asset,
  // contract, project and request sides do it when their write adds or removes a single line;
  // the application and technology sides never (`audit-parent-rules.ts`).
  explicitParentLabels: [
    'application_spend_items',
    'application_capex_items',
    'technology_spend_items',
    'asset_spend_items',
    'asset_capex_items',
    'contract_spend_items',
    'contract_capex_items',
    'portfolio_project_opex',
    'portfolio_project_capex',
    'portfolio_request_opex',
    'portfolio_request_capex',
  ],
  exclusions: [
    {
      table: 'spend_tasks',
      reason: 'duplicate of the `tasks` row the same call writes for the line task (`createForTarget`, `updateForTarget`)',
    },
    {
      table: 'spend_round_input_lines',
      reason: 'the costed lines ride in the audit row of their round input (`lines`), with no audit row of their own',
    },
    {
      table: 'spend_version_totals',
      reason: 'derived by the version triggers, never audited: its changes are the amounts and allocation rows that caused them',
    },
    {
      table: 'spend_item_analytics_values',
      reason: 'the dimension values ride in the audit row of the line (`analytics_values`), with no audit row of their own',
    },
  ],
} as const satisfies RecordHistoryRecord;

/** The raw keys of an operation payload: markers and details, never field changes. */
const OPERATION_FIELDS: HistoryFields = {
  operation: hidden('write marker, never a field change'),
  year: hidden('operation year'),
  source: hidden('write source'),
  sourceYear: hidden('operation detail'),
  destinationYear: hidden('operation detail'),
  sourceColumn: hidden('operation detail'),
  destinationColumn: hidden('operation detail'),
  percentageIncrease: hidden('operation detail'),
  overwrite: hidden('operation detail'),
  column: hidden('operation detail'),
  from_nature: hidden('operation detail: the nature field carries the change'),
  to_nature: hidden('operation detail: the nature field carries the change'),
  from_year: hidden('operation detail'),
  from_reference: hidden('raw reference: predecessor and successor resolve with access'),
  to_reference: hidden('raw reference: predecessor and successor resolve with access'),
  copied: hidden('structured copy summary'),
};

/** A budget line of either nature, as its own audit rows record it. */
const BUDGET_LINE_FIELDS: HistoryFields = {
  product_name: shown(),
  description: shown(),
  currency: shown(),
  effective_start: shown(),
  legacy_effective_end: shown(),
  status: shown(),
  notes: shown(),
  run_build: shown(),
  nature: shown(),
  legacy_number: shown(),
  ppe_type: shown(),
  investment_type: shown(),
  priority: shown(),
  item_number: shown(),
  disabled_at: shown(),
  supplier_id: shown('supplier'),
  account_id: shown('account'),
  owner_it_id: shown('user'),
  owner_business_id: shown('user'),
  project_id: shown('project'),
  contract_id: shown('contract'),
  paying_company_id: shown('company'),
  cost_center_id: shown('cost_center'),
  predecessor_id: shown('budget_line'),
  // A type change names the line it continues in an operation key: resolved with access, as the
  // line's own predecessor.
  successor_id: shown('budget_line'),
  // A dimension map, presented by `dimensionChanges`.
  analytics_values: shown(),
  reason: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
  row_version: hidden('concurrency counter'),
  analytics_category_id: hidden('derived category'),
  budget_rev: hidden('budget revision counter'),
  search_vector: hidden('search index'),
  search_text: hidden('search index'),
  content_plain: hidden('search index'),
  fx_rate_set_id: hidden('rate set of the version'),
  version_id: hidden('version link'),
  spend_item_id: hidden('line link'),
  capex_item_id: hidden('line link'),
  item_id: hidden('line link'),
  related_object_id: hidden('polymorphic link'),
  related_object_type: hidden('polymorphic link'),
  sort: hidden('display order'),
  ...OPERATION_FIELDS,
};

/** A budget version of either nature. */
const BUDGET_VERSION_FIELDS: HistoryFields = {
  version_name: shown(),
  input_grain: shown(),
  is_approved: shown(),
  as_of_date: shown(),
  budget_year: shown(),
  notes: shown(),
  allocation_method: shown(),
  allocation_driver: shown(),
  reporting_currency: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  spend_item_id: hidden('line link'),
  capex_item_id: hidden('line link'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
  fx_rate_set_id: hidden('rate set'),
  budget_rev: hidden('budget revision counter'),
  budget_changed_at: hidden('budget revision timestamp'),
  ...OPERATION_FIELDS,
};

/** A round input; its costed lines have their own events. */
const ROUND_INPUT_FIELDS: HistoryFields = {
  period_start: shown(),
  period_end: shown(),
  method: shown(),
  spread_profile_name: shown(),
  fte: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  version_id: hidden('version link'),
  measure: hidden('the entry subject names the measure'),
  last_calculation: hidden('derived calculation document'),
  lines: hidden('the costed lines have their own events'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

const LINK_FIELDS: HistoryFields = {
  url: shown(),
  description: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  spend_item_id: hidden('line link'),
  capex_item_id: hidden('line link'),
  created_at: hidden('timestamp'),
};

const ATTACHMENT_FIELDS: HistoryFields = {
  original_filename: shown(),
  mime_type: shown(),
  size: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  spend_item_id: hidden('line link'),
  capex_item_id: hidden('line link'),
  stored_filename: hidden('storage detail'),
  storage_path: hidden('storage detail'),
  uploaded_at: hidden('timestamp'),
};

const CONTACT_FIELDS: HistoryFields = {
  contact_id: shown('contact'),
  role: shown(),
  origin: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  spend_item_id: hidden('line link'),
  capex_item_id: hidden('line link'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

const AMOUNT_FIELDS: HistoryFields = {
  period: shown(),
  planned: shown(),
  forecast: shown(),
  committed: shown(),
  actual: shown(),
  expected_landing: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  version_id: hidden('version link'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** Allocations expose counts, never the companies or departments of the split. */
const ALLOCATION_FIELDS: HistoryFields = {
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  version_id: hidden('version link'),
  company_id: hidden('allocations expose counts only'),
  department_id: hidden('allocations expose counts only'),
  allocation_pct: hidden('allocations expose counts only'),
  is_system_generated: hidden('allocation detail'),
  rule_id: hidden('allocation detail'),
  materialized_from: hidden('allocation detail'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
  ...OPERATION_FIELDS,
  count: hidden('read by the allocation presentation'),
};

/** The allow-lists of the budget-line audit labels: the line, its versions, amounts and children. */
export const spendItemsFields: Readonly<Record<string, HistoryFields>> = {
  spend_items: BUDGET_LINE_FIELDS,
  capex_items: BUDGET_LINE_FIELDS,
  spend_versions: BUDGET_VERSION_FIELDS,
  capex_versions: BUDGET_VERSION_FIELDS,
  spend_round_inputs: ROUND_INPUT_FIELDS,
  capex_round_inputs: ROUND_INPUT_FIELDS,
  spend_links: LINK_FIELDS,
  capex_links: LINK_FIELDS,
  spend_attachments: ATTACHMENT_FIELDS,
  capex_attachments: ATTACHMENT_FIELDS,
  spend_item_contacts: CONTACT_FIELDS,
  capex_item_contacts: CONTACT_FIELDS,
  spend_amounts: AMOUNT_FIELDS,
  capex_amounts: AMOUNT_FIELDS,
  spend_allocations: ALLOCATION_FIELDS,
  capex_allocations: ALLOCATION_FIELDS,
};

const LINE_KEYS = ['spend_item_id', 'capex_item_id'] as const;

/**
 * The audit labels that carry a budget line, and how to find it. The migration
 * `1855500000000-audit-log-parent-record.ts` copies these labels in SQL on purpose: a migration is
 * frozen and must not import this module (`__tests__/audit-parent-rules.spec.ts` compares them).
 */
export const spendItemsParentRules: Readonly<Record<string, AuditParentRule>> = {
  // Versions and their budget tables: the audit row names the version.
  spend_versions: { parentTable: 'spend_items', from: 'version', via: 'record_id' },
  capex_versions: { parentTable: 'spend_items', from: 'version', via: 'record_id' },
  spend_amounts: { parentTable: 'spend_items', from: 'version', via: 'record_id' },
  capex_amounts: { parentTable: 'spend_items', from: 'version', via: 'record_id' },
  spend_allocations: { parentTable: 'spend_items', from: 'version', via: 'record_id' },
  capex_allocations: { parentTable: 'spend_items', from: 'version', via: 'record_id' },
  // Round inputs name their version in the payload, before or after.
  spend_round_inputs: { parentTable: 'spend_items', from: 'version', via: 'payload.version_id' },
  capex_round_inputs: { parentTable: 'spend_items', from: 'version', via: 'payload.version_id' },
  // Links and attachments carry the child's line in their payload (CAPEX renames the key).
  spend_links: { parentTable: 'spend_items', from: 'payload', keys: LINE_KEYS },
  capex_links: { parentTable: 'spend_items', from: 'payload', keys: LINE_KEYS },
  spend_attachments: { parentTable: 'spend_items', from: 'payload', keys: LINE_KEYS },
  capex_attachments: { parentTable: 'spend_items', from: 'payload', keys: LINE_KEYS },
  // A contact link carries its line in the payload; the supplier sync writes the line in record_id.
  spend_item_contacts: { parentTable: 'spend_items', from: 'payload', keys: LINE_KEYS, fallback: 'record_id' },
  capex_item_contacts: { parentTable: 'spend_items', from: 'payload', keys: LINE_KEYS, fallback: 'record_id' },
  // No rule for the legacy task label (`spend_tasks`): the line history reads the `tasks` row the
  // same call writes. The rows `1855500000000` gave a parent keep it, and are not read.
  // No rule for the application, technology, asset, contract, project and request links
  // (`application_spend_items`, `application_capex_items`, `technology_spend_items`,
  // `asset_*_items`, `contract_*_items`, `portfolio_project_*`, `portfolio_request_*`): both sides
  // write the same label, and `record_id` is the line from the line, the other object from the
  // other side. The line-side writers hand the line as `parent`. From the asset, contract, project
  // or request, a write that adds or removes a single line names it (`singleChangedId`).
  // From the application or the technology, no parent: the payload lists line ids, which the
  // line's history would read as applications or technologies, and a write may touch several lines.
};
