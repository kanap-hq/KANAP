import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The audit labels of an interface's mapping groups and rules. This is the SQL copy of
 * `interfaceMappingDetailParentRules` (`src/audit/record-history/records/interfaces.ts`): a
 * migration is frozen and must not import the module, and
 * `record-history-interface-mappings-migration.integration.spec.ts` reads this list back from the
 * file to check that both agree.
 *
 * Mapping sets stay in `1855720000000`. These two labels joined the interface history later: their
 * rows name the group or the rule in `record_id` and the interface in `interface_id`.
 */
const LABELS = ['interface_mapping_groups', 'interface_mapping_rules'] as const;

/** Audit rows read per statement: each UPDATE touches at most this many rows. */
const BATCH_SIZE = 50000;

const UUID_SQL = `'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'`;

/** The interface a child's payload names, in `after` then `before`, as a uuid (NULL when absent). */
function payloadInterface(alias: string): string {
  const expression = `COALESCE(${alias}.after_json->>'interface_id', ${alias}.before_json->>'interface_id')`;
  return `CASE WHEN (${expression}) ~ ${UUID_SQL} THEN (${expression})::uuid END`;
}

/**
 * One batch: the tenant's next rows of the labels, newest first along the index
 * `(tenant_id, created_at DESC)`, after the last row of the previous batch, then the update of
 * those that have no parent yet and whose interface is found. The selection does not test
 * `parent_id` (the walk stays keyset and the update tests the column).
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
      SELECT a.id, ${payloadInterface('a')} AS interface_id
        FROM candidates a
       WHERE a.parent_id IS NULL
    ), changed AS (
      UPDATE audit_log a
         SET parent_table = 'interfaces',
             parent_id = b.interface_id
        FROM payloads b
       WHERE a.id = b.id
         AND a.parent_id IS NULL
         AND b.interface_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM interfaces p WHERE p.tenant_id = a.tenant_id AND p.id = b.interface_id)
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
 * `audit_log.parent_table` / `parent_id`: the interface a mapping group or mapping rule audit row
 * belongs to, so the interface history can read it.
 *
 * The backfill runs tenant by tenant with `app.current_tenant` set (transaction-local), so RLS
 * stays ENABLE + FORCE on every table it reads. Each statement reads at most `BATCH_SIZE` rows of
 * the tenant, newest first, after the last row of the previous batch, and fills those whose
 * interface it finds: one pass over each tenant's rows. Rows whose payload key is absent, is not
 * a uuid, or names an interface absent from the tenant stay NULL. Only rows whose `parent_id` is
 * still NULL are touched, so a second run changes nothing. The label counts are logged.
 */
export class AuditLogParentInterfaceMappings1855960000000 implements MigrationInterface {
  name = 'AuditLogParentInterfaceMappings1855960000000';
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
            WHERE tenant_id = $1
              AND table_name = ANY($2::text[])
              AND parent_table = 'interfaces'`,
          [tenant.id, LABELS],
        );
      }
    } finally {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [found ?? '']);
    }
  }
}

function logCounts(filled: Map<string, number>, missing: Map<string, number>): void {
  const prefix = '[Migration] AuditLogParentInterfaceMappings:';
  const totalFilled = Array.from(filled.values()).reduce((sum, n) => sum + n, 0);
  const totalWithout = Array.from(missing.values()).reduce((sum, n) => sum + n, 0);
  if (totalFilled === 0) console.log(`${prefix} no audit row to fill, nothing changed`);
  else console.log(`${prefix} ${totalFilled} audit row(s) given a parent, ${totalWithout} left without one`);
  for (const label of LABELS) {
    console.log(`  ${label}: ${filled.get(label) ?? 0} filled, ${missing.get(label) ?? 0} without a parent`);
  }
}
