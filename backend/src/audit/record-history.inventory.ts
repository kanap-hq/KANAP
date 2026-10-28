import type { PermissionLevel } from '../auth/require-level.decorator';
import type { FamilyKey } from './record-history.service';

/**
 * The records whose history the API serves (`GET /records/:table/:id/history`), by route key.
 *
 * A record entry names the reference family whose screen rule decides who may read the record (the
 * same family the history resolves its references with), the permission module that opens its page,
 * the audit labels its own rows carry, and the audit labels of its children with the kind the
 * history shows them as. The service (`record-history.service.ts`) owns the presentation; a new
 * record family only adds an entry here.
 *
 * Two declarations keep the parent rules and the data-access inventory honest:
 * - every child label has a parent rule in `audit-parent-rules.ts`, except the labels listed in
 *   `explicitParentLabels`: their write hands the record to `writeAuditLog` (`parent`), because the
 *   payload names several records and no rule can choose one (an asset link holds the ids of every
 *   line linked to the asset);
 * - every table of the data-access families `follows_line` and `link_to_line`
 *   (`data-access/data-access-tables.inventory.ts`) is a child here or an exclusion with its reason.
 *   `__tests__/record-history-inventory.spec.ts` checks both ways, beside the catalog spec.
 */
export type RecordHistoryChildKind =
  | 'version'
  | 'amounts'
  | 'allocations'
  | 'round_input'
  | 'link'
  | 'attachment'
  | 'contact'
  | 'application'
  | 'technology'
  | 'asset'
  | 'contract'
  | 'project'
  | 'request'
  | 'task';

export type RecordHistoryExclusion = {
  /** The physical table of the data-access inventory. */
  table: string;
  /** Why its writes are not a child of this record's history. */
  reason: string;
};

export type RecordHistoryRecord = {
  /** The physical table of the record, and its route key. */
  table: string;
  /** The permission resource that opens the record's page. */
  module: string;
  /** The level of that resource the page requires. */
  level: PermissionLevel;
  /** The audit labels of the record's own rows, both natures where the family has two (`budget-nature.ts`). */
  auditLabels: readonly string[];
  /**
   * The reference family whose visibility rule decides whether a person may read the record: the
   * tenant predicate and RLS under `ctx.manager`, then the family's own screen rule (participation,
   * incidents, natures). The family's module must be this entry's module.
   */
  family: FamilyKey;
  /** Audit label → the kind the child shows as. */
  children: Readonly<Record<string, RecordHistoryChildKind>>;
  /** Child labels whose write declares the record as `parent`, with no label rule. */
  explicitParentLabels: readonly string[];
  /** Data-access tables that follow the record or link to it, without a child history of their own. */
  exclusions: readonly RecordHistoryExclusion[];
};

/** The inventory, by route key. Only the budget lines are declared in this run (lot 1B). */
const RECORD_HISTORY_DEFINITION = {
  spend_items: {
    table: 'spend_items',
    module: 'budget',
    level: 'reader',
    // A CAPEX line keeps the CAPEX audit label of before lot Z1 (`budget-nature.ts`, `auditTableOf`);
    // a line that changed nature keeps rows under both labels.
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
      spend_tasks: 'task',
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
  },
  // The master-data pilots of lot 2: no child table writes under another audit label, so their
  // entries have no children and no exclusions. Their references (chart, company, parent cost
  // center, owner) resolve through the families in `record-history.service.ts`.
  accounts: {
    table: 'accounts',
    module: 'accounts',
    level: 'reader',
    auditLabels: ['accounts'],
    family: 'account',
    children: {},
    explicitParentLabels: [],
    exclusions: [],
  },
  cost_centers: {
    table: 'cost_centers',
    module: 'cost_centers',
    level: 'reader',
    auditLabels: ['cost_centers'],
    family: 'cost_center',
    children: {},
    explicitParentLabels: [],
    exclusions: [],
  },
} as const satisfies Readonly<Record<string, RecordHistoryRecord>>;

/** A physical table the history serves: the route key of `GET /records/:table/:id/history`. */
export type RecordHistoryTable = keyof typeof RECORD_HISTORY_DEFINITION;

/** The inventory, by route key. */
export const RECORD_HISTORY: Readonly<Record<RecordHistoryTable, RecordHistoryRecord>> = RECORD_HISTORY_DEFINITION;

/** The entry of a route key, or undefined when the table is outside the inventory (never a prototype key). */
export function recordHistoryEntry(table: string): RecordHistoryRecord | undefined {
  return Object.prototype.hasOwnProperty.call(RECORD_HISTORY, table)
    ? RECORD_HISTORY[table as RecordHistoryTable]
    : undefined;
}

/** The route keys of the inventory, sorted: the permission modules of `GET /records/:table/:id/history`. */
export function recordHistoryModules(): string[] {
  return Array.from(new Set(Object.values(RECORD_HISTORY).map((entry) => entry.module))).sort();
}

/** The child kind of an audit label of this record, or null for its own labels and unknown labels. */
export function recordHistoryChildKind(entry: RecordHistoryRecord, label: string): RecordHistoryChildKind | null {
  return Object.prototype.hasOwnProperty.call(entry.children, label) ? entry.children[label] : null;
}
