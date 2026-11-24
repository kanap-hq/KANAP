import { EntityManager } from 'typeorm';

/** A link table of a project or a request: the owner's column and the linked record's column. */
export interface OwnerLinkTable {
  table: string;
  owner: string;
  target: string;
}

/** The ids a replacement really removed and added, lower case. */
export interface WrittenLinks {
  removed: string[];
  added: string[];
}

const ids = (rows: Array<{ id: string }>): string[] => rows.map((row) => String(row.id).toLowerCase());

/**
 * Removes then adds links of one owner, and returns the ids it really wrote. A link the other end
 * removed or stored meanwhile (this transaction waited on it) is not among them: the caller writes
 * its activity and its audit row for these ids only, and a caller that expected a change refuses.
 * Both writes are counted through a CTE (a DELETE through the query runner returns `[rows, count]`).
 * Table and column names come from the callers' constants only.
 */
export async function writeOwnerLinks(
  manager: EntityManager,
  t: OwnerLinkTable,
  tenantId: string,
  ownerId: string,
  removed: string[],
  added: string[],
): Promise<WrittenLinks> {
  const gone: Array<{ id: string }> = removed.length === 0 ? [] : await manager.query(
    `WITH gone AS (
       DELETE FROM ${t.table} WHERE tenant_id = $1 AND ${t.owner} = $2 AND ${t.target} = ANY($3::uuid[])
       RETURNING ${t.target} AS id
     ) SELECT id FROM gone`,
    [tenantId, ownerId, removed],
  );
  const put: Array<{ id: string }> = added.length === 0 ? [] : await manager.query(
    `WITH put AS (
       INSERT INTO ${t.table} (tenant_id, ${t.owner}, ${t.target})
       SELECT $1, $2, target_id FROM unnest($3::uuid[]) AS target_id
       ON CONFLICT DO NOTHING
       RETURNING ${t.target} AS id
     ) SELECT id FROM put`,
    [tenantId, ownerId, added],
  );
  return { removed: ids(gone), added: ids(put) };
}

/** `before` (lower case) less the ids really removed, plus those really added, sorted. */
export function appliedLinks(before: string[], written: WrittenLinks): string[] {
  const gone = new Set(written.removed);
  const kept = before.map((id) => String(id).toLowerCase()).filter((id) => !gone.has(id));
  return Array.from(new Set([...kept, ...written.added])).sort();
}

/** Whether the replacement wrote anything: the activity and the audit row follow it. */
export function wroteLinks(written: WrittenLinks): boolean {
  return written.removed.length + written.added.length > 0;
}
