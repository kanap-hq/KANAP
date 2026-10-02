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
 * Changing a table's storage parameters takes its owner. A database where the KANAP role does not
 * own the table (tables created by another role) keeps its settings and logs why; nothing fails.
 * Idempotent.
 */
const TABLES = ['spend_amounts', 'capex_amounts'];

export class AmountsAutovacuum1853820000000 implements MigrationInterface {
  name = 'AmountsAutovacuum1853820000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ version }] = await queryRunner.query(`SELECT current_setting('server_version_num')::int AS version`);
    const settings = [
      'autovacuum_vacuum_scale_factor = 0.02',
      'autovacuum_analyze_scale_factor = 0.01',
      ...(Number(version) >= 130000 ? ['autovacuum_vacuum_insert_scale_factor = 0.05'] : []),
    ];
    for (const table of TABLES) {
      const [row] = await queryRunner.query(
        `SELECT c.oid IS NOT NULL AS present,
                COALESCE(pg_has_role(current_user, c.relowner, 'USAGE'), false) AS owned
           FROM (SELECT to_regclass($1) AS oid) r
           LEFT JOIN pg_class c ON c.oid = r.oid`,
        [table],
      );
      if (!row?.present) {
        console.log(`[Migration] AmountsAutovacuum: ${table} not found, skipped.`);
        continue;
      }
      if (!row.owned) {
        console.log(`[Migration] AmountsAutovacuum: ${table} is owned by another role, its autovacuum settings are left as they are (set them as its owner: ALTER TABLE ${table} SET (${settings.join(', ')})).`);
        continue;
      }
      await queryRunner.query(`ALTER TABLE ${table} SET (${settings.join(', ')})`);
      console.log(`[Migration] AmountsAutovacuum: ${table} set (${settings.join(', ')}).`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ version }] = await queryRunner.query(`SELECT current_setting('server_version_num')::int AS version`);
    const names = [
      'autovacuum_vacuum_scale_factor',
      'autovacuum_analyze_scale_factor',
      ...(Number(version) >= 130000 ? ['autovacuum_vacuum_insert_scale_factor'] : []),
    ];
    for (const table of TABLES) {
      const [row] = await queryRunner.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [table]);
      if (row?.present) await queryRunner.query(`ALTER TABLE ${table} RESET (${names.join(', ')})`);
    }
  }
}
