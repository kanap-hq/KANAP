import type { EntityManager } from 'typeorm';
import type { RecordHistoryTable } from './record-history.inventory';
import { analyticsAxesParentRules } from './record-history/records/analytics_axes';
import { applicationsParentRules } from './record-history/records/applications';
import { assetsParentRules } from './record-history/records/assets';
import { companiesParentRules } from './record-history/records/companies';
import { connectionsParentRules } from './record-history/records/connections';
import { contractsParentRules } from './record-history/records/contracts';
import { departmentsParentRules } from './record-history/records/departments';
import { documentsParentRules } from './record-history/records/documents';
import { incidentsParentRules } from './record-history/records/incidents';
import { interfacesParentRules } from './record-history/records/interfaces';
import { locationsParentRules } from './record-history/records/locations';
import { portfolioProjectsParentRules } from './record-history/records/portfolio_projects';
import { spendItemsParentRules } from './record-history/records/spend_items';
import { suppliersParentRules } from './record-history/records/suppliers';
import { tasksParentRules } from './record-history/records/tasks';
import { technologiesParentRules } from './record-history/records/technologies';

/**
 * How an audit row finds the record it belongs to, by its audit label (`audit_log.table_name`).
 * A record's own labels have no rule: their rows name it in `record_id`, and `parent_*` stays NULL.
 * Every `parentTable` is a table of `record-history.inventory.ts`.
 *
 * The budget-line labels keep their CAPEX name (`budget-nature.ts`, `auditTableOf`); both natures
 * write the same physical tables, so every existing rule points at `spend_items`. A family declares
 * the rules of its own labels in its record file (`record-history/records/<table>.ts`, export
 * `<table>ParentRules`); this file only aggregates them, one line per record file.
 *
 * Adding a family (the procedure, so a later run follows it):
 * 1. Declare the child labels in that family's `RECORD_HISTORY` entry, then add their rules to the
 *    record file's `<table>ParentRules` and its import line below: the payload key that names the
 *    record, the version lookup when the row names a version whose record is the parent, or the
 *    deployment lookup when the row names an application's deployment (`from: 'instance'`). A task
 *    names its record and that record's type (`payload_typed`): a family adds its type to
 *    `TASK_PARENT_TABLES`, one line, and backfills that type's rows in its own migration. A
 *    label whose write knows the parent names it explicitly (`AuditParent`) instead, when no rule
 *    can choose safely.
 * 2. Write a backfill migration for that family, never edit `1855500000000-audit-log-parent-record.ts`
 *    (frozen). It copies the family's rules in SQL, stays idempotent (only rows still missing
 *    `parent_*`), loops over the tenants with `set_config('app.current_tenant', <tenant>, true)`,
 *    reads bounded batches as `1855500000000` does (keyset on `(created_at, id)`, a fixed batch
 *    size), and never disables the RLS.
 * 3. Add a spec that reads the new migration and compares its labels and lookups with these TS
 *    rules, as `__tests__/audit-parent-rules.spec.ts` does for the budget lines.
 *
 * The migration `1855500000000-audit-log-parent-record.ts` copies the budget-line labels in SQL on
 * purpose: a migration is frozen and must not import this module.
 * `__tests__/audit-parent-rules.spec.ts` reads the migration text and checks that both lists agree.
 */
export type AuditParentRule =
  /** The record id is a key of the before/after payload (a line: the child's `spend_item_id`, CAPEX: `capex_item_id`). */
  | { parentTable: RecordHistoryTable; from: 'payload'; keys: readonly string[]; fallback?: 'record_id' }
  /** The row names a version, through `record_id` or the payload's `version_id`, whose record is the parent. */
  | { parentTable: RecordHistoryTable; from: 'version'; via: 'record_id' | 'payload.version_id' }
  /**
   * The payload names the record by a key and its type by another (a task: `related_object_id` and
   * `related_object_type`): the table follows the type, read from the same payload as the id. A type
   * absent from `tables` gives no parent. It has no single `parentTable`: `auditParentRuleTables`
   * lists its tables.
   */
  | {
    parentTable?: never;
    from: 'payload_typed';
    keys: readonly string[];
    typeKey: string;
    tables: Readonly<Record<string, RecordHistoryTable>>;
  }
  /**
   * The row names a deployment (an `app_instances` row) by one of the payload keys, and the parent is
   * that deployment's application (`app_instances.application_id`): two hops, resolved at write time
   * in the writer's tenant. A row whose deployment no longer exists keeps no parent.
   */
  | { parentTable: RecordHistoryTable; from: 'instance'; keys: readonly string[] };

/**
 * The record a task belongs to, by its `related_object_type`: one line per type, sorted, added by
 * the run that gives that record its history, whose own migration backfills the type's rows.
 */
export const TASK_PARENT_TABLES = {
  capex_item: 'spend_items',
  contract: 'contracts',
  incident: 'incidents',
  project: 'portfolio_projects',
  spend_item: 'spend_items',
} as const satisfies Readonly<Record<string, RecordHistoryTable>>;

/**
 * A task names its record in the saved task (`related_object_id`), and the record's type beside it.
 * The task's own history reads its rows by `record_id`; the parent is the record it belongs to.
 * `1855900000000-audit-log-parent-contracts-incidents.ts` copies the contract and incident entries
 * in SQL (`__tests__/audit-parent-rules-contracts-incidents.spec.ts` compares them), and
 * `1855920000000-audit-log-parent-tasks.ts` the budget-line entries: both natures are in
 * `spend_items` (`__tests__/audit-parent-rules-tasks.spec.ts`).
 * `1855930000000-audit-log-parent-projects.ts` the project entry (`audit-parent-rules-projects.spec.ts`).
 */
const TASK_PARENT_RULES: Readonly<Record<string, AuditParentRule>> = {
  tasks: { from: 'payload_typed', keys: ['related_object_id'], typeKey: 'related_object_type', tables: TASK_PARENT_TABLES },
};

/**
 * The rule sets of the record files, one line per file, sorted by table name: a family run adds its
 * own file and its own line, never the same line.
 */
const PARENT_RULE_SETS = [
  analyticsAxesParentRules,
  applicationsParentRules,
  assetsParentRules,
  companiesParentRules,
  connectionsParentRules,
  contractsParentRules,
  departmentsParentRules,
  documentsParentRules,
  incidentsParentRules,
  interfacesParentRules,
  locationsParentRules,
  portfolioProjectsParentRules,
  spendItemsParentRules,
  suppliersParentRules,
  tasksParentRules,
  technologiesParentRules,
] as const;

/** The audit labels that carry a record, and how to find it. The task rule is shared by its types. */
export const AUDIT_PARENT_RULES: Readonly<Record<string, AuditParentRule>> = Object.freeze(
  Object.assign({}, ...PARENT_RULE_SETS, TASK_PARENT_RULES) as Record<string, AuditParentRule>,
);

/** The record tables a rule may name: its `parentTable`, or every table of a typed rule. */
export function auditParentRuleTables(rule: AuditParentRule): RecordHistoryTable[] {
  return rule.from === 'payload_typed' ? Array.from(new Set(Object.values(rule.tables))).sort() : [rule.parentTable];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAuditUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** The parent a write names explicitly, when it is a valid one. */
export type AuditParent = { table: RecordHistoryTable; id: string };

/** The fields of an audit write the parent resolution reads (`AuditEntry` in `audit.service.ts`). */
export type AuditParentInput = {
  table: string;
  recordId?: string | null;
  before?: unknown;
  after?: unknown;
  parent?: AuditParent | null;
};

function fieldOf(value: unknown, key: string): unknown {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined;
}

/** The first valid uuid among the rule's keys, in `after` then `before`. */
export function payloadParentId(rule: { keys: readonly string[] }, after: unknown, before: unknown): string | null {
  for (const payload of [after, before]) {
    for (const key of rule.keys) {
      const value = fieldOf(payload, key);
      if (isAuditUuid(value)) return value;
    }
  }
  return null;
}

/**
 * The record a typed payload names: in `after` then `before`, the first payload whose type is in
 * the rule's tables and whose key holds a valid uuid. The type and the id come from the same
 * payload, so a task moved from one record to another names the record it is on after the write.
 */
export function typedPayloadParent(
  rule: { keys: readonly string[]; typeKey: string; tables: Readonly<Record<string, RecordHistoryTable>> },
  after: unknown,
  before: unknown,
): AuditParent | null {
  for (const payload of [after, before]) {
    const type = fieldOf(payload, rule.typeKey);
    if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(rule.tables, type)) continue;
    for (const key of rule.keys) {
      const value = fieldOf(payload, key);
      if (isAuditUuid(value)) return { table: rule.tables[type], id: value };
    }
  }
  return null;
}

/** The version id a round-input row names, in `after` then `before`. */
export function payloadVersionId(after: unknown, before: unknown): string | null {
  for (const payload of [after, before]) {
    const value = fieldOf(payload, 'version_id');
    if (isAuditUuid(value)) return value;
  }
  return null;
}

function idsOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : fieldOf(value, 'ids');
  return Array.isArray(list) ? list.filter(isAuditUuid).map((id) => id.toLowerCase()) : [];
}

/**
 * The one id a link-set write added or removed, from its before and after sets (an id array, or
 * `{ ids }` as the asset writers and `auditedLinkSet` shape them); null when none or several
 * changed. A write from the other side of a line link names the line as parent only through this.
 */
export function singleChangedId(before: unknown, after: unknown): string | null {
  const beforeSet = new Set(idsOf(before));
  const afterSet = new Set(idsOf(after));
  const changed = [
    ...Array.from(afterSet).filter((id) => !beforeSet.has(id)),
    ...Array.from(beforeSet).filter((id) => !afterSet.has(id)),
  ];
  return changed.length === 1 ? changed[0] : null;
}

/**
 * The parent of one audit write, resolved before the insert: the caller's
 * `parent` when given, else the rule of its label. A label without a rule (a
 * line, a contract, a task of another module) has no parent: NULL.
 *
 * A version lookup runs on the same `manager` as the insert and names the
 * transaction's tenant (`app_current_tenant()`, the default of the row's
 * `tenant_id`), beside RLS: the writer reads its own line. A manager outside a
 * tenant transaction finds no version and leaves the parent NULL, but its insert
 * then fails anyway: `audit_log.tenant_id` is NOT NULL and takes the same default.
 */
export async function resolveAuditParent(
  manager: Pick<EntityManager, 'query'>,
  entry: AuditParentInput,
): Promise<AuditParent | null> {
  if (entry.parent) return isAuditUuid(entry.parent.id) ? { table: entry.parent.table, id: entry.parent.id } : null;
  const rule = AUDIT_PARENT_RULES[entry.table];
  if (!rule) return null;
  return resolveRuleParent(manager, rule, entry);
}

/**
 * The parent one rule finds for one write: the payload key, the typed payload's record, the
 * version's line, or the deployment's application. The two lookups run on the writer's `manager`,
 * in its tenant (`app_current_tenant()`).
 */
export async function resolveRuleParent(
  manager: Pick<EntityManager, 'query'>,
  rule: AuditParentRule,
  entry: AuditParentInput,
): Promise<AuditParent | null> {
  if (rule.from === 'payload_typed') return typedPayloadParent(rule, entry.after, entry.before);
  if (rule.from === 'instance') {
    const instanceId = payloadParentId(rule, entry.after, entry.before);
    if (!instanceId) return null;
    const rows: Array<{ application_id: string }> = await manager.query(
      'SELECT application_id FROM app_instances WHERE tenant_id = app_current_tenant() AND id = $1',
      [instanceId],
    );
    const applicationId = rows[0]?.application_id;
    return isAuditUuid(applicationId) ? { table: rule.parentTable, id: applicationId } : null;
  }
  if (rule.from === 'payload') {
    const fromPayload = payloadParentId(rule, entry.after, entry.before);
    if (fromPayload) return { table: rule.parentTable, id: fromPayload };
    if (rule.fallback === 'record_id' && isAuditUuid(entry.recordId)) return { table: rule.parentTable, id: entry.recordId };
    return null;
  }
  const versionId = rule.via === 'record_id' ? entry.recordId : payloadVersionId(entry.after, entry.before);
  if (!isAuditUuid(versionId)) return null;
  const rows: Array<{ spend_item_id: string }> = await manager.query(
    'SELECT spend_item_id FROM spend_versions WHERE tenant_id = app_current_tenant() AND id = $1',
    [versionId],
  );
  const lineId = rows[0]?.spend_item_id;
  return isAuditUuid(lineId) ? { table: rule.parentTable, id: lineId } : null;
}
