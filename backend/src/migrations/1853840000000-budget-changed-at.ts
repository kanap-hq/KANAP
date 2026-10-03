import { MigrationInterface, QueryRunner } from 'typeorm';

const VERSION_TABLES = ['spend_versions', 'capex_versions'] as const;
const FUNCTION = 'budget_version_changed_at';
/** After `<table>_budget_rev` (BEFORE triggers fire in name order): it sees the counter that trigger set. */
const triggerName = (table: string) => `${table}_budget_rev_stamp`;

/**
 * When a version's budget last changed (plan planning/perf-scale, lot 3G): the
 * moment its `budget_rev` (migration 1853740000000) last moved.
 *
 * The workspace polls `GET /spend-items/:id/meta` (`spend/item-meta.ts`) and
 * says who changed the line's budget and when. The audit trail names who, but
 * only for a write that logs a row (the budget tab, the AI, the budget rows
 * import, a column copy or clear); an item CSV import writes totals without an
 * amounts audit row, a script none at all. Neither the versions nor the audit
 * rows record the counter, and `updated_at` is not touched by the children's
 * statement triggers, so without this stamp a change nothing logged would be
 * credited to the last person whose save was logged. With it, the change is
 * the audit row's only when that row was written at or after the stamp, in
 * practice by the same transaction (every budget writer holds the line's lock
 * first, `spend/budget-locks.ts`, and logs after it writes); otherwise nobody
 * is named, and the time is still the stamp's.
 *
 * - `budget_changed_at timestamptz` on spend_versions and capex_versions,
 *   NULL on the versions that exist today (unknown until their next change),
 *   `clock_timestamp()` by default on a new version (its creation is its first
 *   change; its create audit row comes after it).
 * - A BEFORE UPDATE row trigger, guarded by `NEW.budget_rev IS DISTINCT FROM
 *   OLD.budget_rev`, sets it to `clock_timestamp()`: every bump, whichever
 *   trigger made it (the version's own method trigger, which fires before it
 *   by name, or the children's statement triggers, which update the version).
 *   An update that does not move the counter (the view choice, an FX pin, the
 *   notes) leaves it. Nothing else reads or writes it; it is not exported.
 *
 * Idempotent: the column is added when missing and given its default again,
 * the function replaced, the trigger dropped and created again. No backfill,
 * no RLS change. down() drops the trigger, the function and the column.
 */
export class BudgetChangedAt1853840000000 implements MigrationInterface {
  name = 'BudgetChangedAt1853840000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION ${FUNCTION}() RETURNS trigger
      LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
      BEGIN
        NEW.budget_changed_at := clock_timestamp();
        RETURN NEW;
      END
      $fn$
    `);
    for (const table of VERSION_TABLES) {
      // No default on the ADD (no table rewrite): the rows of today stay NULL, new ones take it.
      await queryRunner.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS budget_changed_at timestamptz`);
      await queryRunner.query(`ALTER TABLE ${table} ALTER COLUMN budget_changed_at SET DEFAULT clock_timestamp()`);
      await queryRunner.query(`DROP TRIGGER IF EXISTS ${triggerName(table)} ON ${table}`);
      await queryRunner.query(`
        CREATE TRIGGER ${triggerName(table)}
        BEFORE UPDATE ON ${table}
        FOR EACH ROW WHEN (NEW.budget_rev IS DISTINCT FROM OLD.budget_rev)
        EXECUTE FUNCTION ${FUNCTION}()
      `);
    }
    console.log('[Migration] BudgetChangedAt: budget_changed_at kept on spend_versions and capex_versions.');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of VERSION_TABLES) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS ${triggerName(table)} ON ${table}`);
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS budget_changed_at`);
    }
    await queryRunner.query(`DROP FUNCTION IF EXISTS ${FUNCTION}()`);
  }
}
