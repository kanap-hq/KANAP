import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Autovacuum of the monthly amounts (plan planning/perf-scale lot 4C). `spend_amounts` is the
 * largest table (300,000 rows for 5,000 lines over 5 years) and every budget save, column copy
 * and import rewrites part of it. With the defaults, PostgreSQL vacuums it after 20% of its rows
 * are dead (60,000) and refreshes its statistics after 10% changed: plans then work from stale
 * counts after a large import. Per table, no server setting and no restart:
 * - vacuum after 2% dead rows, statistics after 1% changed;
 * - on PostgreSQL 13+, vacuum after 5% inserted rows too (keeps the visibility map current for
 *   index-only scans after imports).
 * Same for `capex_amounts`. No memory cost: it only starts the same work earlier, in smaller runs.
 *
 * Self-healing, never blocking a deploy:
 * - changing a table's storage parameters takes its owner: a table the KANAP role does not own
 *   keeps its settings, and the migration logs the statement to run as the owner;
 * - the ALTER waits for its lock (SHARE UPDATE EXCLUSIVE: it never blocks reads and writes, but
 *   waits for a running VACUUM, ANALYZE or index build) at most 5 s, then skips the table and
 *   logs the same statement. The lock timeout in force before is restored after.
 * Idempotent.
 */
const TABLES = ['spend_amounts', 'capex_amounts'];
const LOCK_TIMEOUT = '5s';
const VALUES: Record<string, string> = {
  autovacuum_vacuum_scale_factor: '0.02',
  autovacuum_analyze_scale_factor: '0.01',
  // PostgreSQL 13 and later only.
  autovacuum_vacuum_insert_scale_factor: '0.05',
};

async function settingNames(queryRunner: QueryRunner): Promise<string[]> {
  const [{ version }] = await queryRunner.query(`SELECT current_setting('server_version_num')::int AS version`);
  return Object.keys(VALUES).filter((name) => name !== 'autovacuum_vacuum_insert_scale_factor' || Number(version) >= 130000);
}

/** Whether the table exists and the current role may change it (owner or member of the owner). */
async function ownership(queryRunner: QueryRunner, table: string): Promise<'missing' | 'owned' | 'other'> {
  const [row] = await queryRunner.query(
    `SELECT c.oid IS NOT NULL AS present,
            COALESCE(pg_has_role(current_user, c.relowner, 'USAGE'), false) AS owned
       FROM (SELECT to_regclass($1) AS oid) r
       LEFT JOIN pg_class c ON c.oid = r.oid`,
    [table],
  );
  if (!row?.present) return 'missing';
  return row.owned ? 'owned' : 'other';
}

/**
 * Runs `sql` on `table` with a bounded lock wait. Inside the migration transaction a savepoint
 * keeps a timeout from aborting it. Returns false when the lock was not obtained in time.
 */
async function alterWithLockTimeout(queryRunner: QueryRunner, sql: string): Promise<boolean> {
  const inTransaction = queryRunner.isTransactionActive;
  const [{ previous }] = await queryRunner.query(`SELECT current_setting('lock_timeout') AS previous`);
  await queryRunner.query(`SELECT set_config('lock_timeout', $1, $2)`, [LOCK_TIMEOUT, inTransaction]);
  try {
    if (inTransaction) await queryRunner.query(`SAVEPOINT amounts_autovacuum`);
    try {
      await queryRunner.query(sql);
      if (inTransaction) await queryRunner.query(`RELEASE SAVEPOINT amounts_autovacuum`);
      return true;
    } catch (error: any) {
      if (inTransaction) await queryRunner.query(`ROLLBACK TO SAVEPOINT amounts_autovacuum`);
      const code = error?.driverError?.code ?? error?.code;
      if (code === '55P03') return false;
      throw error;
    }
  } finally {
    await queryRunner.query(`SELECT set_config('lock_timeout', $1, $2)`, [previous, inTransaction]);
  }
}

export class AmountsAutovacuum1853820000000 implements MigrationInterface {
  name = 'AmountsAutovacuum1853820000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const names = await settingNames(queryRunner);
    const settings = names.map((name) => `${name} = ${VALUES[name]}`);
    for (const table of TABLES) {
      const statement = `ALTER TABLE ${table} SET (${settings.join(', ')})`;
      const state = await ownership(queryRunner, table);
      if (state === 'missing') {
        console.log(`[Migration] AmountsAutovacuum: ${table} not found, skipped.`);
        continue;
      }
      if (state === 'other') {
        console.log(`[Migration] AmountsAutovacuum: ${table} is owned by another role, its autovacuum settings are left as they are (as its owner: ${statement}).`);
        continue;
      }
      if (await alterWithLockTimeout(queryRunner, statement)) {
        console.log(`[Migration] AmountsAutovacuum: ${table} set (${settings.join(', ')}).`);
      } else {
        console.log(`[Migration] AmountsAutovacuum: ${table} was busy (lock not obtained in ${LOCK_TIMEOUT}), its autovacuum settings are left as they are (later: ${statement}).`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const names = await settingNames(queryRunner);
    for (const table of TABLES) {
      const state = await ownership(queryRunner, table);
      if (state !== 'owned') {
        console.log(`[Migration] AmountsAutovacuum (revert): ${table} ${state === 'missing' ? 'not found' : 'owned by another role'}, left as it is.`);
        continue;
      }
      const statement = `ALTER TABLE ${table} RESET (${names.join(', ')})`;
      if (!(await alterWithLockTimeout(queryRunner, statement))) {
        console.log(`[Migration] AmountsAutovacuum (revert): ${table} was busy, left as it is (later: ${statement}).`);
      }
    }
  }
}
