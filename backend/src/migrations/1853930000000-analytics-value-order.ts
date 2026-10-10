import { MigrationInterface, QueryRunner } from 'typeorm';
import { ICU_COLLATION } from '../common/list-engine/sql-fragments';

const LOG_PREFIX = '[Migration] AnalyticsValueOrder:';
const INDEX = 'idx_analytics_categories_axis_sort_order';
/** The backfill rewrites values; an UPDATE of a value refreshes its `search_index` row (trigger). */
const TABLES = ['analytics_categories', 'search_index'];

/**
 * The manual order of a dimension's values (plan planning/opex-capex-transfer.md §13.4, lot D3).
 * Everywhere, a dimension's values read `sort_order ASC, name ASC (ICU order), id ASC`.
 *
 * 1. `analytics_categories.sort_order integer NOT NULL DEFAULT 0`.
 * 2. Backfill, with row level security disabled on `analytics_categories` and `search_index` (the
 *    value's search trigger rewrites its row), since migrations run without app.current_tenant, and
 *    restored to the state found afterwards: the values of each dimension get 1..n in today's
 *    alphabetical order (the name in ICU order, as the pickers sort it, then the id; the database's
 *    own collation may be byte order), so nothing changes on screen. Without the ICU collation (an
 *    on-premise build) the backfill falls back to `lower(name), name, id`, so the migration and the
 *    API still start; the values list then needs ICU like the OPEX and CAPEX lists. Only dimensions whose
 *    values all still hold 0 are numbered: a dimension already ordered (by a previous run or by an
 *    admin) is left alone, and a second run changes nothing. The count is logged.
 * 3. Index `(tenant_id, axis_id, sort_order)`.
 *
 * down() drops the index and the column.
 */
export class AnalyticsValueOrder1853930000000 implements MigrationInterface {
  name = 'AnalyticsValueOrder1853930000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE analytics_categories ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0`);
    const icu = await this.hasIcuCollation(queryRunner);
    const nameOrder = icu ? `c.name COLLATE ${ICU_COLLATION}` : 'lower(c.name), c.name';
    const numbered = await withoutRowSecurity(queryRunner, TABLES, async () => {
      // An UPDATE through the query runner returns [rows, count]: the count goes through a CTE.
      const [{ n }]: Array<{ n: number }> = await queryRunner.query(
        `WITH ordered AS (
          SELECT c.tenant_id, c.id,
                 row_number() OVER (PARTITION BY c.tenant_id, c.axis_id ORDER BY ${nameOrder}, c.id) AS position
            FROM analytics_categories c
           WHERE NOT EXISTS (
             SELECT 1 FROM analytics_categories o
              WHERE o.tenant_id = c.tenant_id AND o.axis_id = c.axis_id AND o.sort_order <> 0
           )
        ),
        changed AS (
          UPDATE analytics_categories c SET sort_order = o.position
            FROM ordered o
           WHERE c.tenant_id = o.tenant_id AND c.id = o.id AND c.sort_order <> o.position
          RETURNING 1
        )
        SELECT count(*)::int AS n FROM changed`,
      );
      return n;
    });
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS ${INDEX} ON analytics_categories (tenant_id, axis_id, sort_order)`,
    );
    console.log(
      `${LOG_PREFIX} column sort_order ready, ${numbered} value(s) numbered`
        + `${icu ? '' : ' (no ICU collation: by lower(name), name)'}, index ${INDEX} ready`,
    );
  }

  /** Whether PostgreSQL has the ICU collation (an on-premise build may lack it). */
  protected async hasIcuCollation(queryRunner: QueryRunner): Promise<boolean> {
    const [row] = await queryRunner.query(
      `SELECT EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'und-x-icu' AND collprovider = 'i') AS icu`,
    );
    return row?.icu === true;
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS ${INDEX}`);
    await queryRunner.query(`ALTER TABLE analytics_categories DROP COLUMN IF EXISTS sort_order`);
  }
}

/**
 * Runs `fn` with row level security off on the tables, then restores what was found, also when
 * `fn` fails. After a failed statement the transaction is aborted and refuses the restore: its
 * rollback restores the state then, and the error of `fn` is the one reported.
 */
async function withoutRowSecurity<T>(queryRunner: QueryRunner, tables: string[], fn: () => Promise<T>): Promise<T> {
  const states: Array<{ table: string; enabled: boolean; forced: boolean }> = [];
  for (const table of tables) {
    const [state] = await queryRunner.query(
      `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = to_regclass($1)`,
      [table],
    );
    states.push({ table, enabled: !!state?.enabled, forced: !!state?.forced });
  }
  for (const state of states) {
    if (state.enabled) await queryRunner.query(`ALTER TABLE ${state.table} DISABLE ROW LEVEL SECURITY`);
  }
  let failed = false;
  try {
    return await fn();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      for (const state of states) {
        if (state.enabled) await queryRunner.query(`ALTER TABLE ${state.table} ENABLE ROW LEVEL SECURITY`);
        if (state.forced) await queryRunner.query(`ALTER TABLE ${state.table} FORCE ROW LEVEL SECURITY`);
      }
    } catch (restoreError) {
      if (!failed) throw restoreError;
    }
  }
}
