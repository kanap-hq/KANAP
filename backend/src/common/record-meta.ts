import { EditConflictAuthor, displayName } from './edit-conflicts';

/**
 * What a workspace polls to learn that the record it shows changed elsewhere
 * (plan planning/perf-scale, lot 3G). Shared by every entity that adopts it;
 * the OPEX and CAPEX lines are the first (`GET /spend-items/:id/meta`,
 * `GET /capex-items/:id/meta`, `spend/item-meta.ts`). Presence (lot 3H, "Marie
 * is viewing this line") will be one more key of the same answer.
 *
 * Contract:
 * - Same read permission as the record's detail; the session's tenant, named
 *   in the statement besides RLS. 404 when the record is not there.
 * - `row_version`: the record's freshness counter, kept by the database (lot
 *   3B). It only grows. The screen compares it with the counter it last read
 *   or wrote: a larger one means someone else (or the same user in another
 *   window) changed the record since.
 * - `changed_by` / `changed_at`: who wrote the record's current version, and
 *   when. The audit row that wrote it is the one that recorded the current
 *   counter in its `after` and another one in its `before` (a row that changed
 *   nothing counted, or created the record): exactly one write produced each
 *   value of the counter. It is looked for among the record's newest audit
 *   rows only (`COUNTER_WRITER_WINDOW`): the write that produced the current
 *   counter is the record's latest change, so only rows of writes that changed
 *   nothing counted can come after it. A change no audit row explains (a
 *   script, a referenced row deleted by `ON DELETE SET NULL`, a record whose
 *   history predates the counters) names nobody and has no time: never the
 *   record's last editor (the rule of lot 3C).
 * - `changed_by.name`: first and last name only, null for a user who has
 *   none (the screen says "a user"); `changed_by` is null when the user is
 *   gone from the tenant.
 * - One cheap statement, bounded whatever the record's history: every open
 *   workspace asks every 30 seconds.
 * An entity adds its own parts (a budget line: the `budget_rev` of each of its
 * versions, `BudgetLineMeta`).
 */

export type RecordChange = {
  /** Who, null when the audit trail cannot say (or the user is gone). */
  changed_by: EditConflictAuthor | null;
  /** When, ISO timestamp, null when unknown. */
  changed_at: string | null;
};

export type RecordMeta = RecordChange & {
  id: string;
  row_version: number;
};

/**
 * How many of a record's newest audit rows (of any table: the rows keyed by
 * the record's id) are searched for the one that wrote its counter. Those
 * after it come from writes that changed nothing counted (a value saved
 * again, a relation, a budget column operation logged on the line): a few.
 * Bounds the read for a record with thousands of rows and none that carries
 * the counter (a history older than the counters).
 */
export const COUNTER_WRITER_WINDOW = 50;

/**
 * The audit row that wrote the record's current counter (see the contract), as
 * a subquery for a `LEFT JOIN LATERAL`: `user_id`, `created_at`. `tenant`,
 * `recordId` and `counter` are SQL expressions of the outer query (a parameter,
 * a column); `table` is the audited table's name, a constant of the caller.
 * At most `COUNTER_WRITER_WINDOW` entries of `idx_audit_log_tenant_record_created`.
 */
export function counterWriterSql(opts: { tenant: string; table: string; recordId: string; counter: string }): string {
  return `SELECT r.user_id, r.created_at
            FROM (
              SELECT a.user_id, a.created_at, a.table_name, a.before_json, a.after_json
                FROM audit_log a
               WHERE a.tenant_id = ${opts.tenant} AND a.record_id = ${opts.recordId}
               ORDER BY a.created_at DESC
               LIMIT ${COUNTER_WRITER_WINDOW}
            ) r
           WHERE r.table_name = '${opts.table}'
             AND r.after_json->>'row_version' = (${opts.counter})::text
             AND (r.before_json->>'row_version') IS DISTINCT FROM (r.after_json->>'row_version')
           ORDER BY r.created_at DESC
           LIMIT 1`;
}

/**
 * The author as the meta statement reads it: `author_id`, the user still in the tenant (null
 * without an author or when the user is gone), and their name columns.
 */
export type AuthorColumns = {
  author_id: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

/** Who and when, as the answer gives them: nobody without a user still in the tenant, no time without one. */
export function recordChange(author: AuthorColumns | null | undefined, at: Date | string | null | undefined): RecordChange {
  const when = at ? new Date(at) : null;
  return {
    changed_by: author?.author_id ? { id: author.author_id, name: displayName(author) || null } : null,
    changed_at: when && !Number.isNaN(when.getTime()) ? when.toISOString() : null,
  };
}
