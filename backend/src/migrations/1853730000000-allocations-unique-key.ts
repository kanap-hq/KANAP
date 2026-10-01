import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] AllocationsUniqueKey:';

/** At most this many deleted rows per table are named in the boot log. */
const LOG_ROWS = 50;

type AllocationTable = { table: 'spend_allocations' | 'capex_allocations'; index: string };

const TABLES: AllocationTable[] = [
  { table: 'spend_allocations', index: 'uq_spend_allocations_version_company_department' },
  { table: 'capex_allocations', index: 'uq_capex_allocations_version_company_department' },
];

type DeletedRow = {
  id: string;
  tenant_id: string;
  version_id: string;
  company_id: string;
  department_id: string | null;
  allocation_pct: string;
  kept_id: string;
  /** `older save`: a row of an earlier save of the key; `merged`: a row of the same save, added to the kept one. */
  reason: 'older save' | 'merged';
};

/**
 * One allocation row per (version, company, department) on spend_allocations
 * and capex_allocations (plan planning/perf-scale, lot 3A, Annexe A #11).
 *
 * A manual allocation save deleted the version's rows and inserted the new
 * set without locking the version: two saves of one version could each
 * insert their set, leaving both (a split of about 200 %). The saves now lock
 * the version first; this key makes the database refuse a second row for the
 * same company and department of a version, whatever writes it.
 *
 * 1. Both tables are locked (ACCESS EXCLUSIVE, until the migration
 *    transaction ends), so no write lands between the repair and the key.
 * 2. Repair, with row level security disabled on the table (migrations run
 *    without app.current_tenant and FORCE binds the owner, so a read would
 *    see nothing), restored afterwards to the state found. For each (version,
 *    company, department), department NULL counting as one value:
 *    - rows of an earlier save are deleted: a save inserts all its rows in
 *      one transaction, so they share created_at, and rows of the same key
 *      with an older created_at are the leftover of a save that ran at the
 *      same time as the latest one (the union described above);
 *    - rows of the same save (same created_at: the same company picked on two
 *      lines of a manual split, which the screen allows) are merged into one,
 *      their percentages added, so the version keeps the split it had.
 *    Nothing references allocation rows, so the deletes cascade nowhere. The
 *    boot log gives the counts per table and names the deleted rows (at most
 *    LOG_ROWS): the versions whose split was the union of two saves are worth
 *    a look (their total may still be above 100 % when the two saves named
 *    different companies).
 * 3. The unique index, unless it exists and is valid: on PostgreSQL 15 and
 *    later `(version_id, company_id, department_id) NULLS NOT DISTINCT`; on an
 *    older server the same key with department_id read as a fixed uuid when
 *    NULL (`NULLS NOT DISTINCT` does not exist there).
 *
 * A second run deletes, creates and logs nothing. down() drops the indexes;
 * the deleted rows are not restored (the pre-deploy snapshot is the recovery).
 */
export class AllocationsUniqueKey1853730000000 implements MigrationInterface {
  name = 'AllocationsUniqueKey1853730000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`LOCK TABLE ${TABLES.map((t) => t.table).join(', ')} IN ACCESS EXCLUSIVE MODE`);
    const [{ version }] = await queryRunner.query(`SELECT current_setting('server_version_num')::int AS version`);
    const nullsNotDistinct = Number(version) >= 150000;

    for (const target of TABLES) {
      const deleted = await withoutRowSecurity(queryRunner, target.table, () => dedupe(queryRunner, target.table));
      logDeleted(target.table, deleted);
      await createUniqueIndex(queryRunner, target, nullsNotDistinct);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const target of TABLES) {
      await queryRunner.query(`DROP INDEX IF EXISTS ${target.index}`);
    }
  }
}

/**
 * Runs `fn` with row level security off on the table, then restores what was
 * found, also when `fn` fails. After a failed statement the transaction is
 * aborted and refuses the restore: its rollback restores the state then, and
 * the error of `fn` is the one reported.
 */
async function withoutRowSecurity<T>(queryRunner: QueryRunner, table: string, fn: () => Promise<T>): Promise<T> {
  const [state] = await queryRunner.query(
    `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = $1::regclass`,
    [table],
  );
  if (state?.enabled) await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
  let failed = false;
  try {
    return await fn();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      if (state?.enabled) await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      if (state?.forced) await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    } catch (restoreError) {
      if (!failed) throw restoreError;
    }
  }
}

/**
 * Deletes the rows of earlier saves of each (version, company, department),
 * then merges the rows left of one save into the first of them (smallest id).
 */
async function dedupe(queryRunner: QueryRunner, table: string): Promise<DeletedRow[]> {
  const older: DeletedRow[] = await queryRunner.query(`
    WITH ranked AS (
      SELECT id, created_at,
             max(created_at) OVER w AS last_save,
             first_value(id) OVER (w ORDER BY created_at DESC, id) AS kept_id
      FROM ${table}
      WINDOW w AS (PARTITION BY version_id, company_id, department_id)
    ),
    d AS (
      DELETE FROM ${table} a
      USING ranked r
      WHERE a.id = r.id AND r.created_at < r.last_save
      RETURNING a.id, a.tenant_id, a.version_id, a.company_id, a.department_id, a.allocation_pct::text AS allocation_pct, r.kept_id
    )
    SELECT d.*, 'older save' AS reason FROM d ORDER BY tenant_id, version_id, company_id, department_id NULLS FIRST, id
  `);
  const merged: DeletedRow[] = await queryRunner.query(`
    WITH groups AS (
      SELECT version_id, company_id, department_id, (array_agg(id ORDER BY id))[1] AS kept_id, sum(allocation_pct) AS total
      FROM ${table}
      GROUP BY version_id, company_id, department_id
      HAVING count(*) > 1
    ),
    kept AS (
      UPDATE ${table} a SET allocation_pct = g.total, updated_at = now()
      FROM groups g
      WHERE a.id = g.kept_id
      RETURNING a.id
    ),
    d AS (
      DELETE FROM ${table} a
      USING groups g
      WHERE a.version_id = g.version_id AND a.company_id = g.company_id
        AND a.department_id IS NOT DISTINCT FROM g.department_id AND a.id <> g.kept_id
      RETURNING a.id, a.tenant_id, a.version_id, a.company_id, a.department_id, a.allocation_pct::text AS allocation_pct, g.kept_id
    )
    SELECT d.*, 'merged' AS reason FROM d ORDER BY tenant_id, version_id, company_id, department_id NULLS FIRST, id
  `);
  return [...older, ...merged];
}

function logDeleted(table: string, rows: DeletedRow[]) {
  if (rows.length === 0) return;
  const versions = new Set(rows.map((r) => r.version_id));
  const older = rows.filter((r) => r.reason === 'older save').length;
  console.log(
    `${LOG_PREFIX} ${table}: ${rows.length} duplicate row(s) deleted on ${versions.size} version(s): `
      + `${older} of an earlier save (each company and department keeps the latest save's row), `
      + `${rows.length - older} merged into a row of the same save (percentages added). Check the split of these versions.`,
  );
  for (const r of rows.slice(0, LOG_ROWS)) {
    console.log(
      `  deleted ${r.id} (${r.reason}; tenant ${r.tenant_id}, version ${r.version_id}, company ${r.company_id}, `
        + `department ${r.department_id ?? 'none'}, ${r.allocation_pct} %), kept ${r.kept_id}`,
    );
  }
  if (rows.length > LOG_ROWS) console.log(`  ... and ${rows.length - LOG_ROWS} more`);
}

async function createUniqueIndex(queryRunner: QueryRunner, target: AllocationTable, nullsNotDistinct: boolean): Promise<void> {
  const [existing] = await queryRunner.query(
    `SELECT i.indisvalid AS valid
     FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE i.indrelid = $1::regclass AND c.relname = $2`,
    [target.table, target.index],
  );
  if (existing?.valid) return;
  if (existing) await queryRunner.query(`DROP INDEX ${target.index}`);
  const key = nullsNotDistinct
    ? '(version_id, company_id, department_id) NULLS NOT DISTINCT'
    : `(version_id, company_id, COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid))`;
  await queryRunner.query(`CREATE UNIQUE INDEX ${target.index} ON ${target.table} ${key}`);
}
