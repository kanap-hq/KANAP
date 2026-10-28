import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The contact's history reads three link labels by the `contact_id` key of their payload
 * (`records/contacts.ts`): `supplier_contacts`, `contract_contacts` and the two budget-line
 * contact links. This migration does the two things that family needs on existing data:
 *
 * 1. It gives every `supplier_contacts` row its supplier as `parent_table` / `parent_id`, the
 *    parent rule of `audit-parent-rules.ts` (`suppliersParentRules`). The supplier's history reads
 *    those rows by parent; the contact's history reads the same rows by `contact_id`. Only rows
 *    whose `parent_id` is still NULL are touched, and only when that supplier still exists in the
 *    tenant (`EXISTS`), so a payload naming a deleted record never becomes a parent.
 * 2. It creates the partial index that bounds the `contact_id` branch of the contact's page to
 *    the four labels. Without it the branch scans the tenant's whole journal.
 *
 * The SQL copies the family's TypeScript rule on purpose: a migration is frozen and must not
 * import `audit-parent-rules.ts`. `__tests__/audit-log-contact-links-migration.integration.spec.ts`
 * reads this file, compares its labels and key with the inventory, runs it on a seeded database
 * (two tenants, several batches, a rerun, down and up) and measures the contact page's plan.
 *
 * The backfill loops over the tenants with `app.current_tenant` set (transaction-local), so
 * `audit_log` stays under FORCE RLS. Each statement reads at most `BATCH_SIZE` rows of one tenant,
 * newest first, after the last row of the previous batch (keyset on `(created_at, id)`), and fills
 * those whose supplier id is a uuid and whose supplier row exists in the same tenant. A link whose
 * supplier was deleted since the write keeps no parent; its history stays readable by the
 * `contact_id` branch.
 */
const CONTACT_LINK_LABEL = 'supplier_contacts';
const PARENT_TABLE = 'suppliers';
const PARENT_KEY = 'supplier_id';
const CONTACT_KEY = 'contact_id';
const CONTACT_LINK_LABELS = [
  'supplier_contacts',
  'contract_contacts',
  'spend_item_contacts',
  'capex_item_contacts',
] as const;

/** The index name of the payload-key branch: `idx_audit_log_<key>_<family>`. */
const INDEX_NAME = `idx_audit_log_${CONTACT_KEY}_contacts`;

/** Audit rows read per statement: each UPDATE touches at most this many rows. */
const BATCH_SIZE = 50000;

const UUID_SQL = `'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'`;

/** The supplier a link row names, in `after` then `before`, as a uuid or NULL. */
function payloadSupplier(alias: string): string {
  const value = `COALESCE(${alias}.after_json->>'${PARENT_KEY}', ${alias}.before_json->>'${PARENT_KEY}')`;
  return `CASE WHEN (${value}) ~ ${UUID_SQL} THEN (${value})::uuid END`;
}

/**
 * One batch: the tenant's next rows of the label, newest first along
 * `(tenant_id, created_at DESC)`, after the last row of the previous batch, then the update of
 * those that have no parent yet and whose supplier id is a uuid. The selection does not test
 * `parent_id` (its statistics are stale and `IS NULL` would turn the walk into a scan); the update
 * tests it, so a filled row is never rewritten.
 */
function batchSql(after: boolean): string {
  const keyset = after ? `AND a.created_at <= $3::timestamptz AND (a.created_at < $3::timestamptz OR a.id < $4::uuid)` : '';
  return `WITH candidates AS MATERIALIZED (
      SELECT a.id, a.created_at, a.tenant_id, a.parent_id, a.before_json, a.after_json
        FROM audit_log a
       WHERE a.tenant_id = $1
         AND a.table_name = $2
         ${keyset}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${after ? 5 : 3}
    ), batch AS MATERIALIZED (
      SELECT c.id, ${payloadSupplier('c')} AS supplier_id
        FROM candidates c
       WHERE c.parent_id IS NULL
    ), changed AS (
      UPDATE audit_log a
         SET parent_table = '${PARENT_TABLE}',
             parent_id = b.supplier_id
        FROM batch b
       WHERE a.id = b.id
         AND a.parent_id IS NULL
         AND b.supplier_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM suppliers p WHERE p.tenant_id = a.tenant_id AND p.id = b.supplier_id)
      RETURNING 1
    ), last AS (
      SELECT c.created_at::text AS at, c.id::text AS id FROM candidates c ORDER BY c.created_at ASC, c.id ASC LIMIT 1
    )
    SELECT (SELECT count(*)::int FROM candidates) AS scanned,
           (SELECT at FROM last) AS last_created_at,
           (SELECT id FROM last) AS last_id,
           (SELECT count(*)::int FROM changed) AS filled`;
}

type BatchResult = { scanned: number; last_created_at: string | null; last_id: string | null; filled: number };

/** The link labels of the contact's payload-key branch, in one index predicate. */
function indexLabels(): string {
  return CONTACT_LINK_LABELS.map((label) => `'${label}'`).join(', ');
}

function indexSql(): string {
  return `CREATE INDEX IF NOT EXISTS ${INDEX_NAME}
            ON audit_log (tenant_id, (lower(COALESCE(after_json, before_json) ->> '${CONTACT_KEY}')), created_at DESC, id DESC)
            WHERE table_name = ANY (ARRAY[${indexLabels()}])`;
}

export class AuditLogContactLinks1855710000000 implements MigrationInterface {
  name = 'AuditLogContactLinks1855710000000';
  /** Rows per statement; the spec lowers it to run several batches on a few rows. */
  batchSize = BATCH_SIZE;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ found }]: Array<{ found: string | null }> = await queryRunner.query(
      `SELECT current_setting('app.current_tenant', true) AS found`,
    );
    const tenants: Array<{ id: string }> = await queryRunner.query(`SELECT id FROM tenants ORDER BY created_at ASC, id ASC`);

    let filled = 0;
    let withoutParent = 0;
    try {
      for (const tenant of tenants) {
        await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
        let last: { createdAt: string; id: string } | null = null;
        for (;;) {
          const [batch]: BatchResult[] = await queryRunner.query(
            batchSql(last !== null),
            last
              ? [tenant.id, CONTACT_LINK_LABEL, last.createdAt, last.id, this.batchSize]
              : [tenant.id, CONTACT_LINK_LABEL, this.batchSize],
          );
          filled += Number(batch.filled ?? 0);
          if (batch.scanned < this.batchSize || !batch.last_created_at || !batch.last_id) break;
          last = { createdAt: batch.last_created_at, id: batch.last_id };
        }
        const [remaining]: Array<{ n: number }> = await queryRunner.query(
          `SELECT count(*)::int AS n
             FROM audit_log
            WHERE tenant_id = $1 AND table_name = $2 AND parent_id IS NULL`,
          [tenant.id, CONTACT_LINK_LABEL],
        );
        withoutParent += Number(remaining?.n ?? 0);
      }
    } finally {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [found ?? '']);
    }

    await queryRunner.query(indexSql());
    logCounts(filled, withoutParent);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS ${INDEX_NAME}`);
    // Clearing the parents is a write on a FORCE RLS table: tenant by tenant, as the backfill.
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
            WHERE tenant_id = $1 AND table_name = $2 AND parent_table = $3`,
          [tenant.id, CONTACT_LINK_LABEL, PARENT_TABLE],
        );
      }
    } finally {
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [found ?? '']);
    }
  }
}

function logCounts(filled: number, withoutParent: number): void {
  const prefix = '[Migration] AuditLogContactLinks:';
  if (filled === 0) {
    console.log(`${prefix} no audit row to fill, nothing changed`);
  } else {
    console.log(`${prefix} ${filled} audit row(s) given a supplier, ${withoutParent} left without one`);
  }
  console.log(`  ${CONTACT_LINK_LABEL}: ${filled} filled, ${withoutParent} without a parent`);
  console.log(`  index ${INDEX_NAME}: ${CONTACT_LINK_LABELS.join(', ')}`);
}
