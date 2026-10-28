import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The audit labels that carry a site, a connection or an interface, by the payload key that names
 * it. This is the SQL copy of the family C record files
 * (`src/audit/record-history/records/{locations,connections,interfaces}.ts`): a migration is frozen
 * and must not import the module, and `record-history-family-c-migration.spec.ts` reads this list
 * back from the file to check that both agree.
 *
 * The site, connection and interface themselves are absent on purpose: their rows name them in
 * `record_id` and keep `parent_*` NULL.
 */
const LABELS = {
  /** The child's payload names the site in `location_id`. */
  location: ['location_user_contacts', 'location_contacts', 'location_links', 'location_sub_items'],
  /** The segment's payload names the connection in `connection_id`. */
  connection: ['connection_legs'],
  /** The child's payload names the interface in `interface_id`; the sets name it in `record_id`. */
  interface: ['interface_links', 'interface_bindings', 'interface_mapping_sets', 'interface_attachments'],
} as const;

const ALL_LABELS: readonly string[] = Object.values(LABELS).flat();

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

/** One payload key as its family names it, in `after` then `before`. */
function payloadKey(alias: string, key: string): string {
  return uuidOrNull(`COALESCE(${alias}.after_json->>'${key}', ${alias}.before_json->>'${key}')`);
}

/** The id a child's payload names, by the family of its label. */
function payloadParent(alias: string): string {
  return `CASE
    WHEN ${alias}.table_name IN (${inList(LABELS.location)}) THEN ${payloadKey(alias, 'location_id')}
    WHEN ${alias}.table_name IN (${inList(LABELS.connection)}) THEN ${payloadKey(alias, 'connection_id')}
    WHEN ${alias}.table_name IN (${inList(LABELS.interface)}) THEN ${payloadKey(alias, 'interface_id')}
  END`;
}

/** The parent table of candidate row `c`, by its label. */
function parentTableOf(c: string): string {
  return `CASE
    WHEN ${c}.table_name IN (${inList(LABELS.location)}) THEN 'locations'
    WHEN ${c}.table_name IN (${inList(LABELS.connection)}) THEN 'connections'
    WHEN ${c}.table_name IN (${inList(LABELS.interface)}) THEN 'interfaces'
  END`;
}

/**
 * One batch: the tenant's next rows of the labels, newest first along the index
 * `(tenant_id, created_at DESC)`, after the last row of the previous batch, then the update of
 * those that have no parent yet and whose parent is found. The selection does not test `parent_id`
 * (it has statistics now, but the walk stays keyset and the update tests the column), and the
 * update joins on the primary key; RLS keeps every read in the tenant.
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
      SELECT a.id, a.table_name, ${payloadParent('a')} AS parent_id
        FROM candidates a
       WHERE a.parent_id IS NULL
    ), batch AS MATERIALIZED (
      SELECT c.id, ${parentTableOf('c')} AS parent_table, c.parent_id
        FROM payloads c
    ), changed AS (
      UPDATE audit_log a
         SET parent_table = b.parent_table,
             parent_id = b.parent_id
        FROM batch b
       WHERE a.id = b.id
         AND a.parent_id IS NULL
         AND b.parent_id IS NOT NULL
         AND b.parent_table IS NOT NULL
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
 * `audit_log.parent_table` / `parent_id`: the site, connection or interface an audit row belongs
 * to, for the per-record history of lot 2 family C.
 *
 * The backfill runs tenant by tenant with `app.current_tenant` set (transaction-local), so RLS
 * stays ENABLE + FORCE on every table it reads. Each statement reads at most `BATCH_SIZE` rows of
 * the tenant, newest first, after the last row of the previous batch, and fills those whose parent
 * it finds: one pass over each tenant's rows. Rows whose payload key is absent, is not a uuid, or
 * belongs to another family stay NULL, and the label counts are logged (filled and left without a
 * parent). Only rows whose `parent_id` is still NULL are touched, so a second run changes nothing.
 *
 * The interface sets (`interface_legs`, `interface_owners`, `interface_companies`,
 * `interface_dependencies`, `interface_key_identifiers`, `interface_data_residency`) and the
 * whole-set replacement of `interface_links` name the interface in `record_id`: they need no
 * parent and are absent from the backfill. A sub-location or connection-leg reorder writes the
 * parent in `record_id` with no payload key: its writer now hands an explicit parent, and its older
 * rows stay without one (the payload cannot tell the parent from the child id).
 */
export class AuditLogParentRecordFamilyC1855720000000 implements MigrationInterface {
  name = 'AuditLogParentRecordFamilyC1855720000000';
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
              AND parent_table IN ('locations', 'connections', 'interfaces')`,
          [tenant.id, ALL_LABELS],
        );
      }
    } finally {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [found ?? '']);
    }
  }
}

function logCounts(filled: Map<string, number>, missing: Map<string, number>): void {
  const prefix = '[Migration] AuditLogParentRecordFamilyC:';
  const totalFilled = Array.from(filled.values()).reduce((sum, n) => sum + n, 0);
  const totalWithout = Array.from(missing.values()).reduce((sum, n) => sum + n, 0);
  if (totalFilled === 0) console.log(`${prefix} no audit row to fill, nothing changed`);
  else console.log(`${prefix} ${totalFilled} audit row(s) given a parent, ${totalWithout} left without one`);
  for (const label of ALL_LABELS) {
    console.log(`  ${label}: ${filled.get(label) ?? 0} filled, ${missing.get(label) ?? 0} without a parent`);
  }
}
