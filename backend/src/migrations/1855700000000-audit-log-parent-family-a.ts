import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The audit labels of family A that carry a record, by the payload key that names it. This is the
 * SQL copy of `src/audit/audit-parent-rules.ts`: a migration is frozen and must not import the
 * module, and `__tests__/audit-parent-rules-family-a.spec.ts` reads this list back from the file to
 * check that both agree.
 *
 * The records themselves (companies, departments, working_day_profiles, business_processes,
 * analytics_axes, analytics_categories) are absent on purpose: their own rows name them in
 * `record_id` and keep `parent_*` NULL. The application link of a process is read by `record_id`
 * (`childReads: 'record'`) and needs no parent.
 */
type Rule = { label: string; parentTable: string; payloadKey: string };

const RULES: readonly Rule[] = [
  { label: 'analytics_categories', parentTable: 'analytics_axes', payloadKey: 'axis_id' },
  { label: 'company_metrics', parentTable: 'companies', payloadKey: 'company_id' },
  { label: 'department_metrics', parentTable: 'departments', payloadKey: 'department_id' },
];

const ALL_LABELS: readonly string[] = RULES.map((rule) => rule.label);

/** Audit rows read per statement: each UPDATE touches at most this many rows. */
const BATCH_SIZE = 50000;

const UUID_SQL = `'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'`;

function inList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

/** The label → parent mapping, as a VALUES list: `jsonb ->> <payload_key>` keeps the key a value. */
function ruleValues(): string {
  return RULES.map((rule) => `('${rule.label}', '${rule.parentTable}', '${rule.payloadKey}')`).join(',\n      ');
}

/**
 * One batch: the tenant's next rows of the labels, newest first along the index
 * `(tenant_id, created_at DESC)`, after the last row of the previous batch, then the update of
 * those that have no parent yet and whose payload names one. The selection does not test
 * `parent_id`: it has no statistics and `IS NULL` would turn the walk into a sequential scan. The
 * update tests it, so a filled row is never rewritten. The payload value is cast only when it is a
 * uuid, and the parent row must exist in the same tenant (`EXISTS`).
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
      SELECT a.id, r.parent_table,
             CASE WHEN COALESCE(a.after_json->>r.payload_key, a.before_json->>r.payload_key) ~ ${UUID_SQL}
                  THEN COALESCE(a.after_json->>r.payload_key, a.before_json->>r.payload_key)::uuid END AS parent_id
        FROM candidates a
        JOIN (VALUES
      ${ruleValues()}
        ) AS r(label, parent_table, payload_key) ON r.label = a.table_name
       WHERE a.parent_id IS NULL
    ), batch AS MATERIALIZED (
      SELECT p.id, p.parent_table, p.parent_id
        FROM payloads p
       WHERE p.parent_id IS NOT NULL
         AND (
           (p.parent_table = 'companies'
             AND EXISTS (SELECT 1 FROM companies x WHERE x.tenant_id = $1 AND x.id = p.parent_id))
           OR (p.parent_table = 'departments'
             AND EXISTS (SELECT 1 FROM departments x WHERE x.tenant_id = $1 AND x.id = p.parent_id))
           OR (p.parent_table = 'analytics_axes'
             AND EXISTS (SELECT 1 FROM analytics_axes x WHERE x.tenant_id = $1 AND x.id = p.parent_id))
         )
    ), changed AS (
      UPDATE audit_log a
         SET parent_table = b.parent_table,
             parent_id = b.parent_id
        FROM batch b
       WHERE a.id = b.id
         AND a.parent_id IS NULL
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
 * The parent of the family A children written before their write rules existed: a company metric,
 * a department metric and an analytics value name their parent in the payload. The backfill runs
 * tenant by tenant with `app.current_tenant` set (transaction-local), so RLS stays ENABLE + FORCE
 * on every table it reads. Each statement reads at most `BATCH_SIZE` rows of the tenant, newest
 * first, after the last row of the previous batch, and fills those whose parent it finds: one pass
 * over each tenant's rows.
 *
 * Only rows whose `parent_id` is still NULL are touched, and a row whose parent cannot be found (an
 * absent key, a value that is not a uuid, or a record absent from the tenant) is left untouched, so
 * a second run changes nothing. The label counts are logged, filled and left without a parent. The
 * parent index `idx_audit_log_tenant_parent_created` was built by `1855500000000`.
 */
export class AuditLogParentFamilyA1855700000000 implements MigrationInterface {
  name = 'AuditLogParentFamilyA1855700000000';
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
      }
    } finally {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [found ?? '']);
    }

    logCounts(filled, withoutParent);
  }

  /**
   * Revert the rule the migration applied: its three labels lose the parent tables it owns, tenant
   * by tenant with `app.current_tenant` set, as every family migration does. A parent another
   * family set on one of these labels stays, and RLS is never disabled.
   */
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
              AND parent_table IN ('companies', 'departments', 'analytics_axes')`,
          [tenant.id, ALL_LABELS],
        );
      }
    } finally {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [found ?? '']);
    }
  }
}

function logCounts(filled: Map<string, number>, missing: Map<string, number>): void {
  const prefix = '[Migration] AuditLogParentFamilyA:';
  const totalFilled = Array.from(filled.values()).reduce((sum, n) => sum + n, 0);
  const totalWithout = Array.from(missing.values()).reduce((sum, n) => sum + n, 0);
  if (totalFilled === 0) console.log(`${prefix} no audit row to fill, nothing changed`);
  else console.log(`${prefix} ${totalFilled} audit row(s) given a parent, ${totalWithout} left without one`);
  for (const label of ALL_LABELS) {
    console.log(`  ${label}: ${filled.get(label) ?? 0} filled, ${missing.get(label) ?? 0} without a parent`);
  }
}
