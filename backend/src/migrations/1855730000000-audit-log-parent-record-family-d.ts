import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The audit labels that carry an asset or a technology in their payload, for the record history
 * of family D (lot 2). This is the SQL copy of `assetsParentRules` and `technologiesParentRules`
 * (`src/audit/record-history/records/assets.ts` and `.../technologies.ts`): a migration is frozen
 * and must not import those modules, and
 * `__tests__/audit-parent-rules-family-d.spec.ts` reads this file back to check that both agree.
 *
 * The children whose audit row names the asset or the technology in `record_id`
 * (`asset_relations`, `asset_cluster_members`, `technology_versions`, the link sets...) keep
 * `parent_*` NULL on purpose: the history reads them by `record_id`, and no rule is needed.
 */
const ASSET_LABELS = [
  'asset_hardware_info',
  'asset_support_info',
  'asset_links',
  'asset_attachments',
  'asset_technologies',
] as const;

const TECHNOLOGY_LABELS = [
  'technology_links',
  'technology_attachments',
  'technology_vulnerabilities',
] as const;

const ALL_LABELS: readonly string[] = [...ASSET_LABELS, ...TECHNOLOGY_LABELS];

/** Audit rows read per statement: each UPDATE touches at most this many rows. */
const BATCH_SIZE = 50000;

const UUID_SQL = `'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'`;

/** A payload value as a uuid, NULL when it is absent or is not one. */
function uuidOrNull(expression: string): string {
  return `CASE WHEN (${expression}) ~ ${UUID_SQL} THEN (${expression})::uuid END`;
}

function labelsArray(labels: readonly string[]): string {
  return `ARRAY[${labels.map((label) => `'${label}'`).join(', ')}]`;
}

/** The parent an audit row of the family names in its payload, in `after` then `before`. */
function parentId(a: string): string {
  return `CASE
    WHEN ${a}.table_name = ANY($2::text[])
      THEN ${uuidOrNull(`COALESCE(${a}.after_json->>'asset_id', ${a}.before_json->>'asset_id')`)}
    WHEN ${a}.table_name = ANY($3::text[])
      THEN ${uuidOrNull(`COALESCE(${a}.after_json->>'technology_id', ${a}.before_json->>'technology_id')`)}
  END`;
}

/**
 * One batch: the tenant's next rows of the labels, newest first along
 * `(tenant_id, created_at DESC)`, after the last row of the previous batch, then the update of
 * those that have no parent yet and whose payload names one. The selection does not test
 * `parent_id`: the column was filled by the budget-line migration, has statistics, and the update
 * filters it so a filled row is never rewritten. The keyset keeps every batch bounded.
 */
function batchSql(after: boolean): string {
  const keyset = after
    ? `AND a.created_at <= $6::timestamptz AND (a.created_at < $6::timestamptz OR a.id < $7::uuid)`
    : '';
  return `WITH candidates AS MATERIALIZED (
      SELECT a.id, a.created_at, a.tenant_id, a.table_name, a.parent_id,
             ${parentId('a')} AS candidate_parent_id
        FROM audit_log a
       WHERE a.tenant_id = $1
         AND a.table_name = ANY($4::text[])
         ${keyset}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $5
    ), changed AS (
      UPDATE audit_log a
         SET parent_table = CASE WHEN a.table_name = ANY($2::text[]) THEN 'assets' ELSE 'technologies' END,
             parent_id = c.candidate_parent_id
        FROM candidates c
       WHERE a.id = c.id
         AND a.parent_id IS NULL
         AND c.candidate_parent_id IS NOT NULL
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

const ASSET_INDEX = 'idx_audit_log_asset_id_assets';
const TECHNOLOGY_INDEX = 'idx_audit_log_technology_id_technologies';

const ASSET_INDEX_SQL = `CREATE INDEX IF NOT EXISTS ${ASSET_INDEX}
  ON audit_log (tenant_id, (COALESCE(after_json, before_json) ->> 'asset_id'), created_at DESC, id DESC)
  WHERE table_name = ANY (${labelsArray(ASSET_LABELS)})`;

const TECHNOLOGY_INDEX_SQL = `CREATE INDEX IF NOT EXISTS ${TECHNOLOGY_INDEX}
  ON audit_log (tenant_id, (COALESCE(after_json, before_json) ->> 'technology_id'), created_at DESC, id DESC)
  WHERE table_name = ANY (${labelsArray(TECHNOLOGY_LABELS)})`;

/**
 * `audit_log.parent_table` / `parent_id` for the asset and technology children whose audit row
 * names its record in the payload, and the partial indexes their history reads.
 *
 * The backfill runs tenant by tenant with `app.current_tenant` set (transaction-local), so RLS
 * stays ENABLE + FORCE on every table it reads, and its statements take no table lock beyond ROW
 * EXCLUSIVE (`tenants` is not under RLS). Each statement reads at most `BATCH_SIZE` rows of the
 * tenant, newest first, after the last row of the previous batch, and fills those whose payload
 * names a parent: one pass over each tenant's rows (`batchSql`). A row whose payload names no
 * parent keeps `parent_*` NULL and stays readable by the payload-key branch.
 *
 * The two partial indexes are built after the fill. Their expression is the one
 * `payloadKeyExpression` builds and the history query reads; the WHERE names every label that
 * carries the key, so the index holds only this family's rows and the read never scans the
 * tenant's journal. Only rows whose `parent_id` is still NULL are touched, and a row whose parent
 * cannot be found is left untouched (not rewritten to NULL), so a second run changes nothing.
 *
 * The label counts are logged, filled and left without a parent. The updated rows leave dead
 * versions behind: `VACUUM (ANALYZE) audit_log` after the deploy gives the space back.
 */
export class AuditLogParentRecordFamilyD1855730000000 implements MigrationInterface {
  name = 'AuditLogParentRecordFamilyD1855730000000';
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
          const [batch]: BatchResult[] = await queryRunner.query(
            batchSql(last !== null),
            last
              ? [tenant.id, ASSET_LABELS, TECHNOLOGY_LABELS, ALL_LABELS, this.batchSize, last.createdAt, last.id]
              : [tenant.id, ASSET_LABELS, TECHNOLOGY_LABELS, ALL_LABELS, this.batchSize],
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
      }
    } finally {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [found ?? '']);
    }

    await queryRunner.query(ASSET_INDEX_SQL);
    await queryRunner.query(TECHNOLOGY_INDEX_SQL);

    logCounts(filled, withoutParent);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS ${ASSET_INDEX}`);
    await queryRunner.query(`DROP INDEX IF EXISTS ${TECHNOLOGY_INDEX}`);

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
            WHERE tenant_id = $1 AND table_name = ANY($2::text[])`,
          [tenant.id, ALL_LABELS],
        );
      }
    } finally {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [found ?? '']);
    }
  }
}

function logCounts(filled: Map<string, number>, missing: Map<string, number>): void {
  const prefix = '[Migration] AuditLogParentRecordFamilyD:';
  const totalFilled = Array.from(filled.values()).reduce((sum, n) => sum + n, 0);
  const totalWithout = Array.from(missing.values()).reduce((sum, n) => sum + n, 0);
  if (totalFilled === 0) console.log(`${prefix} no audit row to fill, nothing changed`);
  else console.log(`${prefix} ${totalFilled} audit row(s) given a parent, ${totalWithout} left without one`);
  for (const label of ALL_LABELS) {
    console.log(`  ${label}: ${filled.get(label) ?? 0} filled, ${missing.get(label) ?? 0} without a parent`);
  }
}
