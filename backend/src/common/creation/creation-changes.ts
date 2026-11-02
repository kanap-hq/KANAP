import type { EntityManager } from 'typeorm';
import { recordHistoryChildKind, recordHistoryEntry } from '../../audit/record-history.inventory';
import { auditPageQuery } from '../../audit/record-history/query';
import { historyFields } from '../../audit/record-history/fields';
import { deepEqual, isPlainObject } from '../../audit/record-history/values';
import { creationCancelExpired } from './creation-token';

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

/**
 * The managed documents of a record (`integrated_document_bindings`, e.g. a request's purpose or an
 * incident's review) whose content is no longer the one they were created with (their first
 * version): a purpose written, a review filled in. A document provisioned empty or from a template
 * and left as it was is nothing to lose.
 */
export async function countEditedManagedDocuments(
  manager: EntityManager,
  tenantId: string,
  sourceEntityType: string,
  recordId: string,
): Promise<number> {
  const [row]: Array<{ total: number }> = await manager.query(
    `SELECT count(*)::int AS total
       FROM integrated_document_bindings b
       JOIN documents d ON d.id = b.document_id AND d.tenant_id = b.tenant_id
       LEFT JOIN LATERAL (
         SELECT v.content_markdown FROM document_versions v
          WHERE v.tenant_id = d.tenant_id AND v.document_id = d.id
          ORDER BY v.version_number ASC
          LIMIT 1
       ) first_version ON true
      WHERE b.tenant_id = $1 AND b.source_entity_type = $2 AND b.source_entity_id = $3
        AND CASE WHEN first_version.content_markdown IS NULL THEN coalesce(d.content_markdown, '') ~ '\\S'
                 ELSE btrim(coalesce(d.content_markdown, '')) <> btrim(first_version.content_markdown) END`,
    [tenantId, sourceEntityType, recordId],
  );
  return row?.total ?? 0;
}

/**
 * Sets the count of one child kind from a direct read (documents, attachments, journal entries),
 * in place of what the history rows counted for it: the history counts each edit, the read what
 * would go. A zero drops the kind.
 */
export function withChildCount(changes: CreationChanges, kind: string, total: number): CreationChanges {
  const children = { ...changes.children };
  if (total > 0) children[kind] = total;
  else delete children[kind];
  return { fields: changes.fields, children };
}

/**
 * How many people other than `userId` wrote on the record or its children since its creation: the
 * audit rows its history reads (as `countChangesSinceCreation`, every row, in one query), from its
 * `create` row on, by a person (`user_id` set) who is not `userId`. A system write (no person) is
 * not counted.
 */
export async function countOtherAuthorsSinceCreation(
  manager: EntityManager,
  tenantId: string,
  table: string,
  recordId: string,
  userId: string,
): Promise<number> {
  const entry = recordHistoryEntry(table);
  if (!entry) throw new Error(`No record history entry for ${table}`);
  const id = recordId.toLowerCase();
  const query = auditPageQuery(entry, tenantId, id, null, MAX_ROWS);
  // `$6` is the limit of each branch and of the page: NULL reads every row.
  const params = [...query.params];
  params[5] = null;
  const ownLabels = params.push(entry.auditLabels);
  const creator = params.push(String(userId ?? '').toLowerCase());
  const [row]: Array<{ others: number }> = await manager.query(
    `WITH h AS (${query.sql})
     SELECT count(DISTINCT h.user_id)::int AS others
       FROM h
      WHERE h.user_id IS NOT NULL
        AND lower(h.user_id::text) <> $${creator}::text
        AND h.created_at >= coalesce(
          (SELECT max(c.created_at) FROM h c
            WHERE c.action = 'create' AND c.table_name = ANY($${ownLabels}::text[]) AND c.record_id = $3::uuid),
          '-infinity'::timestamptz)`,
    params,
  );
  return row?.others ?? 0;
}

/**
 * "Cancel" of a record being created stops once another person has worked on it: 403
 * `CREATION_CANCEL_EXPIRED` when its history since its creation holds a write by anyone but
 * `userId` (the token's person). The cancel routes call it with the record locked FOR UPDATE
 * (`lock`: here, on the record's own table), so no write of another person lands between this read
 * and the delete; their preflight calls it without the lock.
 */
export async function assertCreatorAloneSinceCreation(
  manager: EntityManager,
  tenantId: string,
  table: string,
  recordId: string,
  userId: string,
  options: { lock?: boolean } = {},
): Promise<void> {
  if (options.lock) {
    const entry = recordHistoryEntry(table);
    if (!entry) throw new Error(`No record history entry for ${table}`);
    // A record not found is left to the delete, which reports it as its family does.
    const locked = await manager.query(`SELECT 1 FROM ${entry.table} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, recordId]);
    if (!locked.length) return;
  }
  if ((await countOtherAuthorsSinceCreation(manager, tenantId, table, recordId, userId)) > 0) throw creationCancelExpired();
}
