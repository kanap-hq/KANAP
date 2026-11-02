import type { PermissionLevel } from '../auth/require-level.decorator';
import type { FamilyKey } from './record-history/families';
import { accountsRecord } from './record-history/records/accounts';
import { analyticsAxesRecord } from './record-history/records/analytics_axes';
import { analyticsCategoriesRecord } from './record-history/records/analytics_categories';
import { applicationsRecord } from './record-history/records/applications';
import { assetsRecord } from './record-history/records/assets';
import { businessProcessesRecord } from './record-history/records/business_processes';
import { companiesRecord } from './record-history/records/companies';
import { connectionsRecord } from './record-history/records/connections';
import { contactsRecord } from './record-history/records/contacts';
import { contractsRecord } from './record-history/records/contracts';
import { costCentersRecord } from './record-history/records/cost_centers';
import { departmentsRecord } from './record-history/records/departments';
import { documentsRecord } from './record-history/records/documents';
import { incidentsRecord } from './record-history/records/incidents';
import { interfacesRecord } from './record-history/records/interfaces';
import { locationsRecord } from './record-history/records/locations';
import { portfolioProjectsRecord } from './record-history/records/portfolio_projects';
import { portfolioRequestsRecord } from './record-history/records/portfolio_requests';
import { spendItemsRecord } from './record-history/records/spend_items';
import { suppliersRecord } from './record-history/records/suppliers';
import { tasksRecord } from './record-history/records/tasks';
import { technologiesRecord } from './record-history/records/technologies';
import { workingDayProfilesRecord } from './record-history/records/working_day_profiles';

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
 * - every child label read through its parent columns has a parent rule in `audit-parent-rules.ts`,
 *   except the labels listed in `explicitParentLabels`: their write hands the record to
 *   `writeAuditLog` (`parent`), because the payload names several records and no rule can choose one
 *   (an asset link holds the ids of every line linked to the asset). A label read by `childReads`
 *   is not read through the parent columns, so it needs no parent rule of its own (`supplier_contacts`
 *   still has one for the supplier's page);
 * - every table of the data-access families `follows_line`, `link_to_line`, `follows_contract` and
 *   `link_to_contract` (`data-access/data-access-tables.inventory.ts`) is a child here or an
 *   exclusion with its reason.
 *   `__tests__/record-history-inventory.spec.ts` checks both ways, beside the catalog spec.
 *
 * A child label is normally read by its parent columns (`parent_table` / `parent_id`). `childReads`
 * declares the two shapes that do not fit them: a link whose `record_id` is the record itself
 * (`'record'`), and a link whose `record_id` is the link and whose payload names the record
 * (`{ payloadKey }`, a separate branch). A family that declares a payload key adds its partial
 * index in its own migration:
 *
 *   CREATE INDEX IF NOT EXISTS idx_audit_log_<key>_<family>
 *     ON audit_log (tenant_id, (COALESCE(after_json, before_json) ->> '<key>'), created_at DESC, id DESC)
 *     WHERE table_name = ANY (ARRAY['<label>', ...]);
 *
 * The expression is the one `payloadKeyExpression` builds and the page query reads; the WHERE names
 * every label that carries the key. The partial predicate is what bounds the index to the label:
 * `audit_log` is under FORCE RLS and `jsonb ->> text` is not leakproof, so PostgreSQL keeps the key
 * as a filter after the tenant predicate, but the index only holds the label's rows and the read
 * never scans the tenant's other audit rows. Without the index the branch scans the tenant's whole
 * audit log. `__tests__/record-history-payload-key.integration.spec.ts` fails when a declared key
 * has no such index and measures the plan on a table filled with other labels.
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
  | 'task'
  | 'metrics'
  | 'value'
  | 'relation'
  | 'member'
  | 'hardware'
  | 'support'
  | 'technology_version'
  | 'owner'
  | 'vulnerability'
  | 'supplier'
  | 'budget_line'
  | 'sub_item'
  | 'leg'
  | 'set'
  | 'binding'
  | 'person'
  | 'compliance_item'
  | 'instance'
  | 'assignment'
  | 'business_process'
  | 'phase'
  | 'milestone'
  | 'time_entry'
  | 'team'
  | 'dependency'
  | 'document';

export type RecordHistoryExclusion = {
  /** The physical table of the data-access inventory. */
  table: string;
  /** Why its writes are not a child of this record's history. */
  reason: string;
};

/**
 * How a child label reaches its record when the parent columns do not name it.
 * - `record`: the child's audit rows carry the record in `record_id` (a link whose record is the
 *   record itself, not the object on the other side);
 * - `{ payloadKey }`: the rows carry the link's own id in `record_id`, and the record in that key
 *   of `before_json` or `after_json` (a contact link whose parent is another record).
 */
export type RecordHistoryChildRead = 'record' | { payloadKey: string };

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
  /**
   * Child label → how its rows are found. Absent, or a label absent here, means the parent columns
   * (`parent_table` / `parent_id`), as before. A declaration is read by `readAuditPage`; the
   * inventory spec checks that every key is a child label and that no label is both the record's
   * own and a child.
   */
  childReads?: Readonly<Record<string, RecordHistoryChildRead>>;
  /** Child labels whose write declares the record as `parent`, with no label rule. */
  explicitParentLabels: readonly string[];
  /** Tables whose writes are not a child of this record, with the reason a reader will not see them. */
  exclusions: readonly RecordHistoryExclusion[];
};

/**
 * The inventory, one line per record file, sorted by table name: two record families add their own
 * file and their own line, never the same line.
 */
const RECORD_HISTORY_DEFINITION = [
  accountsRecord,
  analyticsAxesRecord,
  analyticsCategoriesRecord,
  applicationsRecord,
  assetsRecord,
  businessProcessesRecord,
  companiesRecord,
  connectionsRecord,
  contactsRecord,
  contractsRecord,
  costCentersRecord,
  departmentsRecord,
  documentsRecord,
  incidentsRecord,
  interfacesRecord,
  locationsRecord,
  portfolioProjectsRecord,
  portfolioRequestsRecord,
  spendItemsRecord,
  suppliersRecord,
  tasksRecord,
  technologiesRecord,
  workingDayProfilesRecord,
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

/** A payload key is a column name written by the family, never a value from a request. */
const PAYLOAD_KEY_RE = /^[a-z_]+$/;

export function assertPayloadKey(key: string): void {
  if (!PAYLOAD_KEY_RE.test(key)) {
    throw new Error(`Record history payload key "${key}" must match ${PAYLOAD_KEY_RE}.`);
  }
}

/**
 * The expression that reads a payload key, the one the family's partial index covers. A deletion
 * has a NULL `after_json`, so `COALESCE` keeps the key the `before_json` held. The id is compared
 * as text, and a writer may have stored either case: `lower` on both the expression and the id the
 * service passes makes the read case-insensitive, and the index holds that same expression.
 * `alias` is empty for the index definition (`pg_indexes` holds the bare columns); the query
 * passes `a`.
 */
export function payloadKeyExpression(key: string, alias = 'a'): string {
  assertPayloadKey(key);
  const prefix = alias ? `${alias}.` : '';
  return `lower((COALESCE(${prefix}after_json, ${prefix}before_json) ->> '${key}'))`;
}

/** One read by a payload key: the key and the child labels that carry it. */
export type RecordHistoryPayloadKeyRead = { key: string; labels: string[] };

/**
 * The payload-key reads of an entry, one per distinct key: the labels of a key share one branch,
 * and the branch order is stable, so a page's SQL depends only on the inventory.
 */
export function recordHistoryPayloadKeyReads(entry: RecordHistoryRecord): RecordHistoryPayloadKeyRead[] {
  const byKey = new Map<string, string[]>();
  for (const [label, mode] of Object.entries(entry.childReads ?? {})) {
    if (mode === 'record') continue;
    assertPayloadKey(mode.payloadKey);
    const labels = byKey.get(mode.payloadKey) ?? [];
    labels.push(label);
    byKey.set(mode.payloadKey, labels);
  }
  return Array.from(byKey.entries())
    .map(([key, labels]) => ({ key, labels: labels.sort() }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
