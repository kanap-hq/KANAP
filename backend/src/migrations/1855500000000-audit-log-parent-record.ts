import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The audit labels that carry a budget line, by the rule that finds it. This
 * is the SQL copy of `src/audit/audit-parent-rules.ts`: a migration is frozen
 * and must not import the module, and `audit-parent-rules.spec.ts` reads this
 * list back from the file to check that both agree.
 *
 * The line itself (`spend_items`, `capex_items`) is absent on purpose: its
 * rows name it in `record_id` and keep `parent_*` NULL.
 */
const LABELS = {
  /** The line id is a payload key (`spend_item_id`, CAPEX: `capex_item_id`). */
  payload: ['spend_links', 'capex_links', 'spend_attachments', 'capex_attachments'],
  /** The contact link's payload key, else the line in `record_id` (the supplier sync). */
  payloadOrRecord: ['spend_item_contacts', 'capex_item_contacts'],
  /** The saved task names its line in `related_object_id`. */
  relatedLine: ['spend_tasks'],
  /** The row names a version in `record_id`, whose `spend_item_id` is the line. */
  versionRecord: ['spend_versions', 'capex_versions', 'spend_amounts', 'capex_amounts', 'spend_allocations', 'capex_allocations'],
  /** The row names a version in the payload's `version_id`, before or after. */
  versionPayload: ['spend_round_inputs', 'capex_round_inputs'],
} as const;

/**
 * Links written from both sides under one label, with no write rule: `record_id` is the line when
 * the line wrote, the application or technology when that side did (the writers now hand the
 * parent explicitly). The backfill takes `record_id` only when it is a budget line of the row's
 * tenant. The asset links (`asset_*_items`) name the asset in `record_id` and are not filled.
 */
const LINE_RECORD_LABELS = ['application_spend_items', 'application_capex_items', 'technology_spend_items'] as const;

const ALL_LABELS: readonly string[] = [...Object.values(LABELS).flat(), ...LINE_RECORD_LABELS];

/** Audit rows read per statement: each UPDATE touches at most this many rows. */
const BATCH_SIZE = 50000;

const UUID_SQL = `'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'`;

/** A payload value as a uuid, NULL when it is absent or is not one. */
function uuidOrNull(expression: string): string {
  return `CASE WHEN (${expression}) ~ ${UUID_SQL} THEN (${expression})::uuid END`;
}

function inList(labels: readonly string[]): string {
  return labels.map((label) => `'${label}'`).join(', ');
}

/** The line a child's payload names: the OPEX key, the CAPEX one, in `after` then `before`. */
function payloadLine(alias: string): string {
  return `COALESCE(
    ${alias}.after_json->>'spend_item_id', ${alias}.after_json->>'capex_item_id',
    ${alias}.before_json->>'spend_item_id', ${alias}.before_json->>'capex_item_id'
  )`;
}

/** The version a round input's payload names, in `after` then `before`. */
function payloadVersion(alias: string): string {
  return `COALESCE(${alias}.after_json->>'version_id', ${alias}.before_json->>'version_id')`;
}

/**
 * The payload values of audit row `a` a rule reads, as uuids (NULL when absent or not a uuid). They
 * are computed in a first, materialized step: the version lookup then compares `spend_versions.id`
 * with a plain value. A comparison with the payload expression itself (`->>`, `~`) is not leakproof,
 * so under RLS it cannot use the primary key and would scan `spend_versions` once per row.
 */
function payloadColumns(a: string): string {
  return `${uuidOrNull(payloadLine(a))} AS payload_line,
         ${uuidOrNull(`COALESCE(${a}.after_json->>'related_object_id', ${a}.before_json->>'related_object_id')`)} AS related_line,
         ${uuidOrNull(payloadVersion(a))} AS payload_version`;
}

/** The line of candidate row `c` (with `payloadColumns`), by its label; NULL when it has none. */
function parentOf(c: string): string {
  return `CASE
    WHEN ${c}.table_name IN (${inList(LABELS.payload)}) THEN ${c}.payload_line
    WHEN ${c}.table_name IN (${inList(LABELS.payloadOrRecord)}) THEN COALESCE(${c}.payload_line, ${c}.record_id)
    WHEN ${c}.table_name IN (${inList(LABELS.relatedLine)}) THEN ${c}.related_line
    WHEN ${c}.table_name IN (${inList(LINE_RECORD_LABELS)})
      THEN (SELECT s.id FROM spend_items s WHERE s.tenant_id = ${c}.tenant_id AND s.id = ${c}.record_id)
    WHEN ${c}.table_name IN (${inList(LABELS.versionRecord)})
      THEN (SELECT v.spend_item_id FROM spend_versions v WHERE v.tenant_id = ${c}.tenant_id AND v.id = ${c}.record_id)
    WHEN ${c}.table_name IN (${inList(LABELS.versionPayload)})
      THEN (SELECT v.spend_item_id FROM spend_versions v WHERE v.tenant_id = ${c}.tenant_id AND v.id = ${c}.payload_version)
  END`;
}

/**
 * One batch: the tenant's next rows of the labels, newest first along the index
 * `(tenant_id, created_at DESC)`, after the last row of the previous batch, then the update of
 * those that have no parent yet and whose line is found. The selection does not test `parent_id`:
 * the column was just added, has no statistics, and `IS NULL` would be estimated at 0.5 % of the
 * rows, which turns the walk into a sequential scan and a sort of the whole tenant per batch. The
 * update tests it, so a filled row is never rewritten. It joins on the primary key; RLS keeps it in
 * the tenant.
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
      SELECT a.id, a.tenant_id, a.table_name, a.record_id, ${payloadColumns('a')}
        FROM candidates a
       WHERE a.parent_id IS NULL
    ), batch AS MATERIALIZED (
      SELECT c.id, ${parentOf('c')} AS line_id FROM payloads c
    ), changed AS (
      UPDATE audit_log a
         SET parent_table = 'spend_items',
             parent_id = b.line_id
        FROM batch b
       WHERE a.id = b.id
         AND a.parent_id IS NULL
         AND b.line_id IS NOT NULL
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
 * `audit_log.parent_table` / `parent_id`: the budget line an audit row belongs
 * to, for the per-record history (plan record-history, lot 1A).
 *
 * The backfill runs tenant by tenant with `app.current_tenant` set (transaction-local), so RLS
 * stays ENABLE + FORCE on every table it reads, and its statements take no table lock beyond
 * ROW EXCLUSIVE (`tenants` is not under RLS). Each statement reads at most `BATCH_SIZE` rows of
 * the tenant, newest first, after the last row of the previous batch, and fills those whose line
 * it finds: one pass over each tenant's rows (`batchSql`). The index is built after the fill.
 *
 * Adding the two nullable columns is a catalog change only, but it takes ACCESS EXCLUSIVE on
 * `audit_log`, and TypeORM runs the pending migrations in one transaction: that lock is held until
 * the commit, as for any column added by a release. The API does not serve while the migrations
 * run (`scripts/migrate-and-start.js`).
 *
 * Only rows whose `parent_id` is still NULL are touched, and a row whose
 * parent cannot be found is left untouched (not rewritten to NULL), so a
 * second run changes nothing. Rows of a line, and rows of a child removed
 * since the write (a deleted version, then amounts and allocations), stay NULL:
 * the former are read by `record_id`, the latter have no line to point at.
 * So do the application and technology links written from that side (`record_id` is not a line)
 * and the asset links (`record_id` is the asset).
 *
 * The label counts are logged, filled and left without a parent. The index
 * serves the history read: one line's children, newest first. The updated rows leave dead
 * versions behind: `VACUUM (ANALYZE) audit_log` after the deploy gives the space back to the table.
 */
export class AuditLogParentRecord1855500000000 implements MigrationInterface {
  name = 'AuditLogParentRecord1855500000000';
  /** Rows per statement; the spec lowers it to run several batches on a few rows. */
  batchSize = BATCH_SIZE;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS parent_table text`);
    await queryRunner.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS parent_id uuid`);

    const [{ found }]: Array<{ found: string | null }> = await queryRunner.query(
      `SELECT current_setting('app.current_tenant', true) AS found`,
    );
    const tenants: Array<{ id: string }> = await queryRunner.query(`SELECT id FROM tenants ORDER BY created_at ASC, id ASC`);

    const filled = new Map<string, number>();
    const withoutParent = new Map<string, number>();
    const lineRows = new Map<string, number>();
    try {
      for (const tenant of tenants) {
        await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
        let last: { createdAt: string; id: string } | null = null;
        for (;;) {
          const [batch]: BatchResult[] = await queryRunner.query(
            batchSql(last !== null),
            last
              ? [tenant.id, ALL_LABELS, last.createdAt, last.id, this.batchSize]
              : [tenant.id, ALL_LABELS, this.batchSize],
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
          [tenant.id, ALL_LABELS],
        ));
        addCounts(lineRows, await queryRunner.query(
          `SELECT table_name, count(*)::int AS n
             FROM audit_log
            WHERE tenant_id = $1 AND table_name IN ('spend_items', 'capex_items')
            GROUP BY table_name`,
          [tenant.id],
        ));
      }
    } finally {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [found ?? '']);
    }

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_parent_created
      ON audit_log (tenant_id, parent_table, parent_id, created_at DESC)
      WHERE parent_id IS NOT NULL
    `);

    logCounts(filled, withoutParent, lineRows);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_audit_log_tenant_parent_created`);
    await queryRunner.query(`ALTER TABLE audit_log DROP COLUMN IF EXISTS parent_id`);
    await queryRunner.query(`ALTER TABLE audit_log DROP COLUMN IF EXISTS parent_table`);
  }
}

function logCounts(filled: Map<string, number>, missing: Map<string, number>, lineRows: Map<string, number>): void {
  const prefix = '[Migration] AuditLogParentRecord:';
  const totalFilled = Array.from(filled.values()).reduce((sum, n) => sum + n, 0);
  const totalWithout = Array.from(missing.values()).reduce((sum, n) => sum + n, 0);
  if (totalFilled === 0) console.log(`${prefix} no audit row to fill, nothing changed`);
  else console.log(`${prefix} ${totalFilled} audit row(s) given a parent, ${totalWithout} left without one`);
  for (const label of ALL_LABELS) {
    console.log(`  ${label}: ${filled.get(label) ?? 0} filled, ${missing.get(label) ?? 0} without a parent`);
  }
  for (const [table, n] of Array.from(lineRows.entries()).sort()) {
    console.log(`  ${table}: ${n} line row(s), parent NULL by design (read by record_id)`);
  }
}
