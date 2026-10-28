import type { EntityManager } from 'typeorm';
import type { RecordHistoryTable } from './record-history.inventory';
import { assetsParentRules } from './record-history/records/assets';
import { spendItemsParentRules } from './record-history/records/spend_items';
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
 *    record, or the version lookup when the row names a version whose record is the parent. A
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
  | { parentTable: RecordHistoryTable; from: 'version'; via: 'record_id' | 'payload.version_id' };

/**
 * The rule sets of the record files, one line per file, sorted by table name: a family run adds its
 * own file and its own line, never the same line.
 */
const PARENT_RULE_SETS = [
  assetsParentRules,
  spendItemsParentRules,
  technologiesParentRules,
] as const;

/** The audit labels that carry a record, and how to find it. */
export const AUDIT_PARENT_RULES: Readonly<Record<string, AuditParentRule>> = Object.freeze(
  Object.assign({}, ...PARENT_RULE_SETS) as Record<string, AuditParentRule>,
);

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
