import {
  payloadKeyExpression,
  recordHistoryPayloadKeyReads,
  type RecordHistoryPayloadKeyRead,
  type RecordHistoryRecord,
} from '../record-history.inventory';

/**
 * The SQL of one audit page (`readAuditPage`). A page reads three shapes of rows, each branch on
 * its own index and with the same cursor and limit:
 * - the record's own labels and its child labels declared `record`, by `record_id`;
 * - its other child labels, by `parent_table` / `parent_id`;
 * - one branch per distinct payload key of `childReads`, by that key of `before_json` /
 *   `after_json` (`COALESCE(after_json, before_json) ->> '<key>'`, so a deletion still matches).
 *
 * `UNION` (not `UNION ALL`) keeps a row two branches both find exactly once: a child whose parent
 * is the record and whose payload key also names it is the case. Each branch reads at most
 * `limit + 1` rows; the outer sort and limit cut the page, and the caller reads one extra row to
 * learn whether another page exists.
 */

export type AuditCursor = { at: string; id: string };

const AUDIT_COLUMNS = `a.id, a.table_name, a.record_id, a.action, a.before_json, a.after_json,
       a.user_id, a.source, a.created_at, a.created_at::text AS created_at_text`;

const CURSOR = `($4::timestamptz IS NULL OR (a.created_at, a.id) < ($4::timestamptz, $5::uuid))`;

export type AuditPageQuery = { sql: string; params: unknown[] };

export type PayloadKeyAuditQuery = { sql: string; params: unknown[] };

/** One branch of the page: the branch's own rows, newest first, cut at the cursor and the limit. */
function branch(predicate: string): string {
  return `(SELECT ${AUDIT_COLUMNS}
             FROM audit_log a
            WHERE ${predicate}
              AND ${CURSOR}
            ORDER BY a.created_at DESC, a.id DESC
            LIMIT $6)`;
}

/**
 * The payload-key branch alone, with the parameters `$1` tenant, `$2` labels, `$3` record id,
 * `$4` cursor timestamp, `$5` cursor id and `$6` limit. The EXPLAIN spec runs this exact text, so
 * a change here is measured there too.
 */
export function payloadKeyAuditQuery(
  read: RecordHistoryPayloadKeyRead,
  tenantId: string,
  id: string,
  cursor: AuditCursor | null,
  fetch: number,
): PayloadKeyAuditQuery {
  return {
    sql: `SELECT ${AUDIT_COLUMNS}
            FROM audit_log a
           WHERE a.tenant_id = $1
             AND a.table_name = ANY($2::text[])
             AND ${payloadKeyExpression(read.key)} = $3::text
             AND ${CURSOR}
           ORDER BY a.created_at DESC, a.id DESC
           LIMIT $6`,
    params: [tenantId, read.labels, id, cursor?.at ?? null, cursor?.id ?? null, fetch],
  };
}

/** The child labels read by `record_id`, beside the record's own labels. */
function recordChildLabels(entry: RecordHistoryRecord): string[] {
  return Object.entries(entry.childReads ?? {})
    .filter(([, mode]) => mode === 'record')
    .map(([label]) => label);
}

/**
 * The page query: the three branches and their parameters. `closedLabels` are child labels this
 * reader may not read (a contract's documents, see `contractClosedLabels`): no branch reads them.
 */
export function auditPageQuery(
  entry: RecordHistoryRecord,
  tenantId: string,
  id: string,
  cursor: AuditCursor | null,
  fetch: number,
  closedLabels: readonly string[] = [],
): AuditPageQuery {
  const open = (label: string) => !closedLabels.includes(label);
  const recordLabels = Array.from(new Set([...entry.auditLabels, ...recordChildLabels(entry).filter(open)])).sort();
  const childLabels = Object.keys(entry.children).filter(open).sort();
  const payloadKeyReads = recordHistoryPayloadKeyReads(entry)
    .map((read) => ({ ...read, labels: read.labels.filter(open) }))
    .filter((read) => read.labels.length > 0);
  const params: unknown[] = [
    tenantId,
    recordLabels,
    id,
    cursor?.at ?? null,
    cursor?.id ?? null,
    fetch,
    entry.table,
    childLabels,
  ];
  const branches = [
    branch(`a.tenant_id = $1 AND a.table_name = ANY($2::text[]) AND a.record_id = $3::uuid`),
    branch(`a.tenant_id = $1 AND a.parent_table = $7 AND a.parent_id = $3::uuid AND a.table_name = ANY($8::text[])`),
  ];
  for (const read of payloadKeyReads) {
    const labelParam = params.length + 1;
    params.push(read.labels);
    branches.push(branch(
      `a.tenant_id = $1 AND a.table_name = ANY($${labelParam}::text[])
        AND ${payloadKeyExpression(read.key)} = $3::text`,
    ));
  }
  return {
    sql: `SELECT h.id, h.table_name, h.record_id, h.action, h.before_json, h.after_json,
            h.user_id, h.source, h.created_at, h.created_at_text
       FROM (
         ${branches.join('\n         UNION\n')}
       ) h
      ORDER BY h.created_at DESC, h.id DESC
      LIMIT $6`,
    params,
  };
}
