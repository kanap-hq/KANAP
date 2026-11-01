import type { EntityManager } from 'typeorm';
import { recordHistoryChildKind, recordHistoryEntry } from '../../audit/record-history.inventory';
import { auditPageQuery } from '../../audit/record-history/query';
import { historyFields } from '../../audit/record-history/fields';
import { deepEqual, isPlainObject } from '../../audit/record-history/values';

/**
 * What was written on a record and its children since its creation, read before "Cancel creation"
 * (`GET /<family>/:id/creation`) so the screen asks for a confirmation only when something besides
 * the title would go.
 *
 * It reads the audit rows the record's history reads (`record-history.inventory.ts`: the record's
 * own labels and its declared children, through `auditPageQuery`), newer than the record's
 * `create` row:
 * - `fields`: the distinct fields of the record that an update changed, among those its history
 *   shows (a hidden field such as a timestamp is no change of the person);
 * - `children`: the child rows, by the child kind of the inventory (`instance`, `link`, `owner`...).
 */

export type CreationChanges = { fields: number; children: Record<string, number> };

type Row = {
  id: string;
  table_name: string;
  record_id: string | null;
  action: string;
  before_json: unknown;
  after_json: unknown;
};

/** A record being created holds few rows; a record past this is reported as changed anyway. */
const MAX_ROWS = 1000;

function shownFieldChanges(label: string, before: unknown, after: unknown): string[] {
  const rules = historyFields(label);
  const a = isPlainObject(before) ? before : {};
  const b = isPlainObject(after) ? after : {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return Array.from(keys).filter((key) => {
    const rule = rules[key];
    if (!rule || (rule.hidden && !rule.changedWord)) return false;
    return !deepEqual(a[key], b[key]);
  });
}

export async function countChangesSinceCreation(
  manager: EntityManager,
  tenantId: string,
  table: string,
  recordId: string,
): Promise<CreationChanges> {
  const entry = recordHistoryEntry(table);
  if (!entry) throw new Error(`No record history entry for ${table}`);
  const id = recordId.toLowerCase();
  const query = auditPageQuery(entry, tenantId, id, null, MAX_ROWS);
  const rows: Row[] = await manager.query(query.sql, query.params);
  const ownLabels = new Set<string>(entry.auditLabels);
  const isOwn = (row: Row) => ownLabels.has(row.table_name) && String(row.record_id ?? '').toLowerCase() === id;
  // Newest first: the rows before the `create` row are the writes after it.
  const createIndex = rows.findIndex((row) => isOwn(row) && row.action === 'create');
  const after = createIndex < 0 ? rows : rows.slice(0, createIndex);

  const fields = new Set<string>();
  const children: Record<string, number> = {};
  for (const row of after) {
    if (isOwn(row)) {
      if (row.action === 'update') {
        for (const field of shownFieldChanges(row.table_name, row.before_json, row.after_json)) fields.add(field);
      } else {
        // A disable or a restore of the record itself: its status changed.
        fields.add('status');
      }
      continue;
    }
    const kind = recordHistoryChildKind(entry, row.table_name) ?? 'relation';
    children[kind] = (children[kind] ?? 0) + 1;
  }
  return { fields: fields.size, children };
}
