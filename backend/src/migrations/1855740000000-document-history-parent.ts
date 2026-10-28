import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The audit labels that carry a Knowledge document, by the rule that finds it. This is the SQL copy
 * of `src/audit/record-history/records/documents.ts` (`documentsParentRules`): a migration is frozen
 * and must not import the module, and `document-history-parent-migration.integration.spec.ts` reads
 * this list back from the file to check that both agree.
 *
 * The document itself (`documents`) is absent on purpose: its rows name it in `record_id` and keep
 * `parent_*` NULL.
 */
const LABELS = ['document_attachments'] as const;

/** Audit rows read per statement: each UPDATE touches at most this many rows. */
const BATCH_SIZE = 50000;

const UUID_SQL = `'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'`;

/** The document a child's payload names, in `after` then `before`, as a uuid (NULL when absent). */
function payloadDocument(alias: string): string {
  const expression = `COALESCE(${alias}.after_json->>'document_id', ${alias}.before_json->>'document_id')`;
  return `CASE WHEN (${expression}) ~ ${UUID_SQL} THEN (${expression})::uuid END`;
}

/**
 * One batch: the tenant's next rows of the labels, newest first along the index
 * `(tenant_id, created_at DESC)`, after the last row of the previous batch, then the update of
 * those that have no parent yet and whose document is found. The selection does not test
 * `parent_id`: the column has no statistics for a freshly migrated tenant and `IS NULL` would be
 * estimated at 0.5 % of the rows, which turns the walk into a sequential scan and a sort of the
 * whole tenant per batch. The update tests it, so a filled row is never rewritten.
 */
function batchSql(after: boolean): string {
  const keyset = after ? `AND a.created_at <= $3::timestamptz AND (a.created_at < $3::timestamptz OR a.id < $4::uuid)` : '';
  return `WITH candidates AS MATERIALIZED (
      SELECT a.id, a.created_at, a.tenant_id, a.table_name, a.record_id, a.parent_id, a.before_json, a.after_json
        FROM audit_log a
       WHERE a.tenant_id = $1
         AND a.table_name = ANY($2::text[])
         ${keyset}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${after ? 5 : 3}
    ), payloads AS MATERIALIZED (
      SELECT a.id, ${payloadDocument('a')} AS document_id
        FROM candidates a
       WHERE a.parent_id IS NULL
    ), changed AS (
      UPDATE audit_log a
         SET parent_table = 'documents',
             parent_id = b.document_id
        FROM payloads b
       WHERE a.id = b.id
         AND a.parent_id IS NULL
         AND b.document_id IS NOT NULL
      RETURNING a.table_name
    ), last AS (
      SELECT c.created_at::text AS at, c.id::text AS id FROM candidates c ORDER BY c.created_at ASC, c.id ASC LIMIT 1
    )
    SELECT (SELECT count(*)::int FROM candidates) AS scanned,
           (SELECT at FROM last) AS last_created_at,
           (SELECT id FROM last) AS last_id,
           (SELECT json_agg(f) FROM (SELECT table_name, count(*)::int AS n FROM changed GROUP BY table_name) f) AS filled`;
}

type Count = { table_name: string; n: number };

function addCounts(target: Map<string, number>, rows: Count[]): void {
  for (const row of rows) target.set(row.table_name, (target.get(row.table_name) ?? 0) + Number(row.n));
}

type BatchResult = { scanned: number; last_created_at: string | null; last_id: string | null; filled: Count[] | null };

/**
 * `audit_log.parent_table` / `parent_id`: the Knowledge document an audit row belongs to, for the
 * per-record history (lot 2, family E).
 *
 * The backfill runs tenant by tenant with `app.current_tenant` set (transaction-local), so RLS
 * stays ENABLE + FORCE on every table it reads, and its statements take no table lock beyond
 * ROW EXCLUSIVE (`tenants` is not under RLS). Each statement reads at most `BATCH_SIZE` rows of the
 * tenant, newest first, after the last row of the previous batch, and fills those whose document it
 * finds: one pass over each tenant's rows. No index is added: the generic
 * `idx_audit_log_tenant_parent_created` of `1855500000000` serves the read.
 *
 * Only rows whose `parent_id` is still NULL are touched, and a row whose payload names no uuid is
 * left untouched (not rewritten to NULL), so a second run changes nothing. The attachment of a
 * document deleted since still names its document in the payload, as the write rule does.
 *
 * The label counts are logged, filled and left without a parent. The updated rows leave dead
 * versions behind: `VACUUM (ANALYZE) audit_log` after the deploy gives the space back to the table.
 */
export class DocumentHistoryParent1855740000000 implements MigrationInterface {
  name = 'DocumentHistoryParent1855740000000';
  /** Rows per statement; the spec lowers it to run several batches on a few rows. */
  batchSize = BATCH_SIZE;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ found }]: Array<{ found: string | null }> = await queryRunner.query(
      `SELECT current_setting('app.current_tenant', true) AS found`,
    );
    const tenants: Array<{ id: string }> = await queryRunner.query(`SELECT id FROM tenants ORDER BY created_at ASC, id ASC`);

    const filled = new Map<string, number>();
    const withoutParent = new Map<string, number>();
    const documentRows = new Map<string, number>();
    try {
      for (const tenant of tenants) {
        await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
        let last: { createdAt: string; id: string } | null = null;
        for (;;) {
          const [batch]: BatchResult[] = await queryRunner.query(
            batchSql(last !== null),
            last
              ? [tenant.id, LABELS, last.createdAt, last.id, this.batchSize]
              : [tenant.id, LABELS, this.batchSize],
          );
          addCounts(filled, batch.filled ?? []);
          if (batch.scanned < this.batchSize || !batch.last_created_at || !batch.last_id) break;
          last = { createdAt: batch.last_created_at, id: batch.last_id };
        }
        addCounts(withoutParent, await queryRunner.query(
          `SELECT table_name, count(*)::int AS n
             FROM audit_log
            WHERE tenant_id = $1 AND parent_id IS NULL AND table_name = ANY($2::text[])
            GROUP BY table_name`,
          [tenant.id, LABELS],
        ));
        addCounts(documentRows, await queryRunner.query(
          `SELECT table_name, count(*)::int AS n
             FROM audit_log
            WHERE tenant_id = $1 AND table_name = 'documents'
            GROUP BY table_name`,
          [tenant.id],
        ));
      }
    } finally {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [found ?? '']);
    }

    logCounts(filled, withoutParent, documentRows);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Undo this rule's writes: an attachment's parent is always this migration's document.
    await queryRunner.query(
      `UPDATE audit_log SET parent_table = NULL, parent_id = NULL
        WHERE table_name = ANY($1::text[]) AND parent_table = 'documents'`,
      [LABELS],
    );
  }
}

function logCounts(filled: Map<string, number>, missing: Map<string, number>, documentRows: Map<string, number>): void {
  const prefix = '[Migration] DocumentHistoryParent:';
  const totalFilled = Array.from(filled.values()).reduce((sum, n) => sum + n, 0);
  const totalWithout = Array.from(missing.values()).reduce((sum, n) => sum + n, 0);
  if (totalFilled === 0) console.log(`${prefix} no audit row to fill, nothing changed`);
  else console.log(`${prefix} ${totalFilled} audit row(s) given a parent, ${totalWithout} left without one`);
  for (const label of LABELS) {
    console.log(`  ${label}: ${filled.get(label) ?? 0} filled, ${missing.get(label) ?? 0} without a parent`);
  }
  for (const [table, n] of Array.from(documentRows.entries()).sort()) {
    console.log(`  ${table}: ${n} document row(s), parent NULL by design (read by record_id)`);
  }
}
