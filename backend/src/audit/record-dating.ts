import type { EntityManager } from 'typeorm';
import { UPDATED_AT_TABLES } from '../common/updated-at.inventory';
import { touchUpdatedAtMany } from '../common/updated-at-trigger';
import { isAuditUuid } from './audit-parent-rules';
import { RECORD_HISTORY, type RecordHistoryRecord } from './record-history.inventory';
import { isHistoryEntry, presentItem, type AuditRow, type PageContext } from './record-history/presenters';

/**
 * The modification date follows the history (`doc/architecture.md`, "Modification Dates"): an
 * audit row that a record's history shows dates that record, in the transaction that writes the
 * row. Every writer of `audit_log` calls `dateHistoryRecords` with its rows: `writeAuditLog`,
 * `writeAuditLogs`, and the writers in SQL (`accounts/consolidation.ts`, the budget file load).
 *
 * Which records: those whose history page reads the row, exactly as `record-history/query.ts`
 * reads it, from the same inventory (`record-history.inventory.ts`):
 * - the record's own labels and its child labels declared `record`: the record named in `record_id`;
 * - the other child labels: the parent the row names (`parent_table` / `parent_id`);
 * - a child label declared `{ payloadKey }`: the record named by that key of the payload (`after`,
 *   else `before`).
 * `__tests__/updated-at.history.integration.spec.ts` compares this with the page query, label by
 * label. Only the tables of `common/updated-at.inventory.ts` are dated.
 *
 * Which rows: those the page shows as an entry (`isHistoryEntry`, the page's own filter): an update
 * that presents no change (a record saved unchanged, a set written back as it was) dates nothing.
 * The presentation runs with no names resolved, as for a reader of every module: a hidden name is
 * a change, never an unchanged value.
 *
 * Without useless writes: a record's own creation (the row was just born) and deletion (it is gone)
 * are skipped; the statement only touches a row whose date is not already the transaction's `now()`
 * (the trigger or an earlier row of the same transaction dated it); one statement per table.
 *
 * Without waiting (`touchUpdatedAtMany`): the rows are locked `FOR NO KEY UPDATE SKIP LOCKED`, in
 * id order (the lock is taken above the sort). A record another transaction holds at that instant
 * is not dated by this one: the dating never adds a wait or a deadlock to the gesture. A record
 * held without being changed (a lock before a write, a budget operation holding its lines) keeps
 * its date while its history gains the entry: an accepted gap.
 *
 * Under data-scoped access the statement runs with the writer's rights: a record the person may
 * only read (a line linked from an application) is not touched, and nothing fails.
 */

/** One audit row as it is stored (`before_json`, `after_json`), with the parent it names. */
export type AuditedRow = {
  table: string;
  recordId?: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
  parent?: { table: string; id: string } | null;
};

const ZERO_ID = '00000000-0000-0000-0000-000000000000';

function lowerUuid(value: unknown): string | null {
  return isAuditUuid(value) ? value.toLowerCase() : null;
}

function fieldOf(value: unknown, key: string): unknown {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined;
}

/** The value as `jsonb` keeps it: dates as text, no undefined, null for nothing. */
function stored(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  const text = JSON.stringify(value);
  return text === undefined ? null : JSON.parse(text);
}

/**
 * The records whose history page reads this row: the three branches of `auditPageQuery`, for every
 * record of the inventory, whatever its table. The payload must be the stored one.
 */
export function historyRecordsReading(row: AuditedRow): Array<{ entry: RecordHistoryRecord; id: string }> {
  const found: Array<{ entry: RecordHistoryRecord; id: string }> = [];
  const recordId = lowerUuid(row.recordId);
  const parentId = lowerUuid(row.parent?.id);
  for (const entry of Object.values(RECORD_HISTORY) as RecordHistoryRecord[]) {
    const ids = new Set<string>();
    const read = Object.prototype.hasOwnProperty.call(entry.childReads ?? {}, row.table) ? entry.childReads![row.table] : undefined;
    if (recordId && (entry.auditLabels.includes(row.table) || read === 'record')) ids.add(recordId);
    if (parentId && row.parent?.table === entry.table && Object.prototype.hasOwnProperty.call(entry.children, row.table)) ids.add(parentId);
    if (read && read !== 'record') {
      const named = lowerUuid(fieldOf(row.after ?? row.before, read.payloadKey));
      if (named) ids.add(named);
    }
    for (const id of ids) found.push({ entry, id });
  }
  return found;
}

/** Whether the page of `entry` shows the row as an entry, for a reader of every module. */
function shownAsEntry(row: AuditedRow, entry: RecordHistoryRecord, id: string): boolean {
  const auditRow: AuditRow = {
    id: ZERO_ID,
    table_name: row.table,
    record_id: lowerUuid(row.recordId),
    action: row.action,
    before_json: row.before ?? null,
    after_json: row.after ?? null,
    user_id: null,
    source: null,
    created_at: new Date(0),
    created_at_text: new Date(0).toISOString(),
  };
  const ctx: PageContext = {
    entry,
    recordId: id,
    users: new Map(),
    versions: new Map(),
    references: new Map(),
    deleted: new Map(),
    readable: {} as PageContext['readable'],
    dimensions: new Map(),
    categories: new Map(),
    entityLabels: new Map(),
    instances: new Map(),
    criteria: new Map(),
    criterionOptions: new Map(),
  };
  try {
    return isHistoryEntry(presentItem(auditRow, entry, ctx));
  } catch {
    // A payload the presenter cannot read: the page would fail on it too; the record is dated.
    return true;
  }
}

/** The records these rows date, by table (tables and ids sorted). */
export function recordsToDate(rows: readonly AuditedRow[]): Map<string, string[]> {
  const byTable = new Map<string, Set<string>>();
  for (const raw of rows) {
    const row: AuditedRow = { ...raw, before: stored(raw.before), after: stored(raw.after) };
    for (const { entry, id } of historyRecordsReading(row)) {
      if (!UPDATED_AT_TABLES[entry.table]) continue;
      const own = entry.auditLabels.includes(row.table) && id === lowerUuid(row.recordId);
      if (own && (row.action === 'create' || row.action === 'delete')) continue;
      if (byTable.get(entry.table)?.has(id)) continue;
      if (!shownAsEntry(row, entry, id)) continue;
      const ids = byTable.get(entry.table) ?? new Set<string>();
      ids.add(id);
      byTable.set(entry.table, ids);
    }
  }
  return new Map(Array.from(byTable.keys()).sort().map((table) => [table, Array.from(byTable.get(table)!).sort()]));
}

/**
 * Dates the records whose history shows these rows, with the manager that wrote them (its
 * transaction and tenant): one statement per table. Call it after the rows are written.
 */
export async function dateHistoryRecords(manager: Pick<EntityManager, 'query'>, rows: readonly AuditedRow[]): Promise<void> {
  for (const [table, ids] of recordsToDate(rows)) await touchUpdatedAtMany(manager, table, ids);
}
