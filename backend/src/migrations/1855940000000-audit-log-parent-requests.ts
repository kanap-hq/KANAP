import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The audit labels that carry a portfolio request, for the record history of the linked records
 * (lot 2, requests). This is the SQL copy of `portfolioRequestsParentRules`
 * (`src/audit/record-history/records/portfolio_requests.ts`): a migration is frozen and must not
 * import that module, and `__tests__/audit-parent-rules-requests.spec.ts` reads this file back to
 * check that both agree.
 *
 * The children whose audit row names the request in `record_id` (its business processes, team,
 * budget lines, applications, assets, dependencies, contacts, web links and document edits) keep
 * `parent_*` NULL on purpose: the history reads them by `record_id`.
 */
const REQUEST_LABELS = [
  'portfolio_request_attachments',
] as const;

/** The payload key that names the request. */
const REQUEST_KEY = 'request_id';

/** Audit rows read per statement: each UPDATE touches at most this many rows. */
const BATCH_SIZE = 50000;

const UUID_SQL = `'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'`;

/** A payload key as a uuid, from `after` then `before`; NULL when neither side holds one. */
function payloadUuid(a: string, key: string): string {
  return `CASE
        WHEN (${a}.after_json->>'${key}') ~ ${UUID_SQL} THEN (${a}.after_json->>'${key}')::uuid
        WHEN (${a}.before_json->>'${key}') ~ ${UUID_SQL} THEN (${a}.before_json->>'${key}')::uuid
      END`;
}

/**
 * One batch: the tenant's next rows of the labels, newest first along `(tenant_id, created_at
 * DESC)`, after the last row of the previous batch, then the update of those that have no parent
 * yet and whose payload names a request of the same tenant. The keyset keeps every batch bounded;
 * a filled row is never rewritten. `$2` the labels, `$3` the batch size.
 */
function batchSql(after: boolean): string {
  const keyset = after
    ? `AND a.created_at <= $4::timestamptz AND (a.created_at < $4::timestamptz OR a.id < $5::uuid)`
    : '';
  return `WITH candidates AS MATERIALIZED (
      SELECT a.id, a.created_at, a.table_name,
             ${payloadUuid('a', REQUEST_KEY)} AS candidate_parent_id
        FROM audit_log a
       WHERE a.tenant_id = $1
         AND a.table_name = ANY($2::text[])
         ${keyset}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $3
    ), changed AS (
      UPDATE audit_log a
         SET parent_table = 'portfolio_requests',
             parent_id = c.candidate_parent_id
        FROM candidates c
       WHERE a.id = c.id
         AND a.tenant_id = $1
         AND a.parent_id IS NULL
         AND c.candidate_parent_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM portfolio_requests r WHERE r.tenant_id = a.tenant_id AND r.id = c.candidate_parent_id)
      RETURNING a.table_name
    ), last AS (
      SELECT c.created_at::text AS at, c.id::text AS id FROM candidates c ORDER BY c.created_at ASC, c.id ASC LIMIT 1
    )
    SELECT (SELECT count(*)::int FROM candidates) AS scanned,
           (SELECT at FROM last) AS last_created_at,
           (SELECT id FROM last) AS last_id,
           (SELECT json_agg(f) FROM (SELECT table_name, count(*)::int AS n FROM changed GROUP BY table_name) f) AS filled`;
}

/** The rows of the labels still without a parent. */
const WITHOUT_PARENT_SQL = `SELECT a.table_name, count(*)::int AS n
     FROM audit_log a
    WHERE a.tenant_id = $1
      AND a.parent_id IS NULL
      AND a.table_name = ANY($2::text[])
    GROUP BY a.table_name`;

type Count = { table_name: string; n: number };

function addCounts(target: Map<string, number>, rows: Count[]): void {
  for (const row of rows) target.set(row.table_name, (target.get(row.table_name) ?? 0) + Number(row.n));
}

type BatchResult = { scanned: number; last_created_at: string | null; last_id: string | null; filled: Count[] | null };

/**
 * `audit_log.parent_table` / `parent_id` for the request children whose audit row names the
 * request in the payload (`request_id`): its attachments.
 *
 * The backfill runs tenant by tenant with `app.current_tenant` set (transaction-local), so RLS
 * stays ENABLE + FORCE on every table it reads, and its statements take no table lock beyond ROW
 * EXCLUSIVE (`tenants` is not under RLS). Each statement reads at most `batchSize` rows of the
 * tenant, newest first, after the last row of the previous batch, and fills those whose payload
 * names a request that exists in the tenant: one pass over each tenant's rows. A row whose request
 * cannot be found keeps `parent_*` NULL and is not rewritten, so a second run changes nothing. No
 * index is added: the label is read by the parent columns (`idx_audit_log_tenant_parent_created`).
 *
 * The label counts are logged, filled and left without a parent. The updated rows leave dead
 * versions behind: `VACUUM (ANALYZE) audit_log` after the deploy gives the space back.
 */
export class AuditLogParentRequests1855940000000 implements MigrationInterface {
  name = 'AuditLogParentRequests1855940000000';
  /** Rows per statement; the spec lowers it to run several batches on a few rows. */
  batchSize = BATCH_SIZE;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ found }]: Array<{ found: string | null }> = await queryRunner.query(
      `SELECT current_setting('app.current_tenant', true) AS found`,
    );
    const tenants: Array<{ id: string }> = await queryRunner.query(`SELECT id FROM tenants ORDER BY created_at ASC, id ASC`);

    const filled = new Map<string, number>();
    const withoutParent = new Map<string, number>();
    try {
      for (const tenant of tenants) {
        await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
        let last: { createdAt: string; id: string } | null = null;
        for (;;) {
          const params: unknown[] = [tenant.id, REQUEST_LABELS, this.batchSize];
          if (last) params.push(last.createdAt, last.id);
          const [batch]: BatchResult[] = await queryRunner.query(batchSql(last !== null), params);
          addCounts(filled, batch.filled ?? []);
          if (batch.scanned < this.batchSize || !batch.last_created_at || !batch.last_id) break;
          last = { createdAt: batch.last_created_at, id: batch.last_id };
        }
        addCounts(withoutParent, await queryRunner.query(WITHOUT_PARENT_SQL, [tenant.id, REQUEST_LABELS]));
      }
    } finally {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [found ?? '']);
    }

    logCounts(filled, withoutParent);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ found }]: Array<{ found: string | null }> = await queryRunner.query(
      `SELECT current_setting('app.current_tenant', true) AS found`,
    );
    const tenants: Array<{ id: string }> = await queryRunner.query(`SELECT id FROM tenants ORDER BY created_at ASC, id ASC`);
    try {
      for (const tenant of tenants) {
        await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
        await queryRunner.query(
          `UPDATE audit_log
              SET parent_table = NULL, parent_id = NULL
            WHERE tenant_id = $1 AND table_name = ANY($2::text[])
              AND parent_table = 'portfolio_requests'`,
          [tenant.id, REQUEST_LABELS],
        );
      }
    } finally {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [found ?? '']);
    }
  }
}

function logCounts(filled: Map<string, number>, missing: Map<string, number>): void {
  const prefix = '[Migration] AuditLogParentRequests:';
  const totalFilled = Array.from(filled.values()).reduce((sum, n) => sum + n, 0);
  const totalWithout = Array.from(missing.values()).reduce((sum, n) => sum + n, 0);
  if (totalFilled === 0) console.log(`${prefix} no audit row to fill, nothing changed`);
  else console.log(`${prefix} ${totalFilled} audit row(s) given a parent, ${totalWithout} left without one`);
  for (const label of REQUEST_LABELS) {
    console.log(`  ${label}: ${filled.get(label) ?? 0} filled, ${missing.get(label) ?? 0} without a parent`);
  }
}
