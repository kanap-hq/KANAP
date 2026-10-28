import type { PermissionLevel } from '../auth/require-level.decorator';
import type { FamilyKey } from './record-history/families';
import { accountsRecord } from './record-history/records/accounts';
import { costCentersRecord } from './record-history/records/cost_centers';
import { spendItemsRecord } from './record-history/records/spend_items';

/**
 * The records whose history the API serves (`GET /records/:table/:id/history`), by route key.
 *
 * A record entry names the reference family whose screen rule decides who may read the record (the
 * same family the history resolves its references with), the permission module that opens its page,
 * the audit labels its own rows carry, and the audit labels of its children with the kind the
 * history shows them as. The service (`record-history.service.ts`) owns the presentation; a new
 * record family only adds a file in `record-history/records/`.
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

/**
 * The inventory, one line per record file, sorted by table name: two record families add their own
 * file and their own line, never the same line.
 */
const RECORD_HISTORY_DEFINITION = [
  accountsRecord,
  costCentersRecord,
  spendItemsRecord,
] as const satisfies readonly RecordHistoryRecord[];

/** A physical table the history serves: the route key of `GET /records/:table/:id/history`. */
export type RecordHistoryTable = (typeof RECORD_HISTORY_DEFINITION)[number]['table'];

/** The inventory, by route key. */
export const RECORD_HISTORY = Object.fromEntries(
  RECORD_HISTORY_DEFINITION.map((entry) => [entry.table, entry]),
) as unknown as Readonly<Record<RecordHistoryTable, RecordHistoryRecord>>;

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
