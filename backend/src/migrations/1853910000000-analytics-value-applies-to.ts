import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] AnalyticsValueAppliesTo:';
const APPLIES_CHECK = 'analytics_categories_applies_to_check';
/** The repair joins the first two; an UPDATE of a value refreshes its `search_index` row (trigger). */
const TABLES = ['analytics_categories', 'analytics_axes', 'search_index'];

/**
 * Which budget lines an analytics value applies to (plan planning/opex-capex-transfer.md §15.3):
 * `opex`: OPEX lines only; `capex`: CAPEX lines only; NULL: both.
 *
 * 1. `analytics_categories.applies_to text NULL`.
 * 2. Repair, with row level security disabled on `analytics_categories`, `analytics_axes` (the
 *    repair joins them) and `search_index` (the value's search trigger rewrites its row), since
 *    migrations run without app.current_tenant, and restored to the state found afterwards: a value outside ('opex', 'capex'), or one that contradicts its dimension's
 *    non-null `applies_to` (dimension OPEX only, value CAPEX only), is set to NULL (both). Only a
 *    column added or written by hand can hold one. The repaired count is logged.
 * 3. `analytics_categories_applies_to_check`: `applies_to IN ('opex', 'capex')`.
 *
 * The coherence with the dimension stays a service rule (no cross-table constraint). No backfill
 * otherwise: every existing value stays NULL (both). Each step is skipped when already done: a
 * second run repairs and changes nothing. down() drops the constraint and the column.
 */
export class AnalyticsValueAppliesTo1853910000000 implements MigrationInterface {
  name = 'AnalyticsValueAppliesTo1853910000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE analytics_categories ADD COLUMN IF NOT EXISTS applies_to text`);
    const repaired = await withoutRowSecurity(queryRunner, TABLES, async () => {
      // An UPDATE through the query runner returns [rows, count]: the count goes through a CTE.
      const [{ n }]: Array<{ n: number }> = await queryRunner.query(
        `WITH changed AS (
          UPDATE analytics_categories c SET applies_to = NULL
          WHERE c.applies_to IS NOT NULL
            AND (
              c.applies_to NOT IN ('opex', 'capex')
              OR EXISTS (
                SELECT 1 FROM analytics_axes a
                 WHERE a.tenant_id = c.tenant_id AND a.id = c.axis_id
                   AND a.applies_to IS NOT NULL AND a.applies_to <> c.applies_to
              )
            )
          RETURNING 1
        )
        SELECT count(*)::int AS n FROM changed`,
      );
      return n;
    });
    const [existing] = await queryRunner.query(
      `SELECT 1 FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'analytics_categories' AND c.conname = $1`,
      [APPLIES_CHECK],
    );
    if (!existing) {
      await queryRunner.query(
        `ALTER TABLE analytics_categories ADD CONSTRAINT ${APPLIES_CHECK} CHECK (applies_to IN ('opex', 'capex'))`,
      );
    }
    console.log(
      `${LOG_PREFIX} column applies_to ready, ${repaired} invalid value(s) cleared, `
        + (existing ? 'constraint already present' : `constraint added: ${APPLIES_CHECK}`),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE analytics_categories DROP CONSTRAINT IF EXISTS ${APPLIES_CHECK}`);
    await queryRunner.query(`ALTER TABLE analytics_categories DROP COLUMN IF EXISTS applies_to`);
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
