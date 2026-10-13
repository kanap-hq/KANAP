import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] BudgetLinePredecessor:';
const FOREIGN_KEY = 'spend_items_predecessor_fk';
const UNIQUE_INDEX = 'uq_spend_items_tenant_predecessor';
/**
 * The line triggers the repair must not fire: the freshness counter (`row_version`, 1853740000000:
 * a cleared reference nobody could read is no change of the line) and the line's search entry
 * (it does not read the column).
 */
const QUIET_TRIGGERS = ['spend_items_row_version', 'trg_search_index_spend_items'];

/** An UPDATE through the query runner returns [rows, count]: every count goes through a CTE. */
async function countChanged(queryRunner: QueryRunner, update: string): Promise<number> {
  const [{ n }]: Array<{ n: number }> = await queryRunner.query(
    `WITH changed AS (${update} RETURNING 1) SELECT count(*)::int AS n FROM changed`,
  );
  return n;
}

/**
 * The line a budget line continues (plan planning/budget-unifie.md, lot M, decision U4): when the
 * type of a line changes from a later year than its first one, the line ends on 31 December of the
 * year before and a new line of the other type carries the later years. The new line names the
 * line it continues; the line it continues finds its successor by the reverse read.
 *
 * 1. `spend_items.predecessor_id uuid NULL`.
 * 2. With row level security off on `spend_items` (migrations run without app.current_tenant) and
 *    the line triggers above off, both restored as found, also on failure, a column added by hand
 *    is repaired: a reference to itself, or to no line of the same tenant, is cleared; when several
 *    lines name the same line, the earliest one (created_at, id) keeps it. The counts are logged.
 *    A column added here holds no value: nothing to repair, nothing disabled.
 * 3. Foreign key `(tenant_id, predecessor_id) REFERENCES spend_items (tenant_id, id)
 *    ON DELETE SET NULL (predecessor_id)`: the line continued is of the same tenant, and its delete
 *    clears the reference only (the referential actions ignore row level security).
 * 4. Unique partial index `(tenant_id, predecessor_id) WHERE predecessor_id IS NOT NULL`: a line
 *    has one successor at most; it also serves the reverse read and the delete's action.
 *
 * No new table: neither the tenant isolation nor the purge inventory changes. Each step is skipped
 * when already done: a second run changes nothing. down() drops the index, the key and the column
 * (the links between lines are lost; the lines and their history stay).
 */
export class BudgetLinePredecessor1854000000000 implements MigrationInterface {
  name = 'BudgetLinePredecessor1854000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE spend_items ADD COLUMN IF NOT EXISTS predecessor_id uuid`);

    const repaired = await withoutRowSecurity(queryRunner, ['spend_items'], async () => {
      const [{ n: held }]: Array<{ n: number }> = await queryRunner.query(
        `SELECT count(*)::int AS n FROM spend_items WHERE predecessor_id IS NOT NULL`,
      );
      if (held === 0) return { held, dangling: 0, duplicates: 0 };
      return withoutTriggers(queryRunner, 'spend_items', QUIET_TRIGGERS, async () => {
        const dangling = await countChanged(
          queryRunner,
          `UPDATE spend_items s SET predecessor_id = NULL
            WHERE s.predecessor_id IS NOT NULL
              AND (s.predecessor_id = s.id
                OR NOT EXISTS (SELECT 1 FROM spend_items p WHERE p.tenant_id = s.tenant_id AND p.id = s.predecessor_id))`,
        );
        const duplicates = await countChanged(
          queryRunner,
          `UPDATE spend_items s SET predecessor_id = NULL
            WHERE s.predecessor_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM spend_items o
                 WHERE o.tenant_id = s.tenant_id AND o.predecessor_id = s.predecessor_id
                   AND (o.created_at, o.id) < (s.created_at, s.id)
              )`,
        );
        return { held, dangling, duplicates };
      });
    });

    const [existing] = await queryRunner.query(
      `SELECT 1 FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'spend_items' AND c.conname = $1`,
      [FOREIGN_KEY],
    );
    if (!existing) {
      await queryRunner.query(
        `ALTER TABLE spend_items ADD CONSTRAINT ${FOREIGN_KEY}
           FOREIGN KEY (tenant_id, predecessor_id) REFERENCES spend_items (tenant_id, id) ON DELETE SET NULL (predecessor_id)`,
      );
    }
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ${UNIQUE_INDEX} ON spend_items (tenant_id, predecessor_id) WHERE predecessor_id IS NOT NULL`,
    );

    console.log(
      `${LOG_PREFIX} column predecessor_id ready, ${repaired.held} reference(s) found, `
        + `${repaired.dangling} naming no line of its tenant cleared, ${repaired.duplicates} second successor(s) cleared, `
        + (existing ? 'foreign key already present' : `foreign key added: ${FOREIGN_KEY}`),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [column] = await queryRunner.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'spend_items' AND column_name = 'predecessor_id'`,
    );
    let dropped = 0;
    if (column) {
      dropped = await withoutRowSecurity(queryRunner, ['spend_items'], async () => {
        const [{ n }]: Array<{ n: number }> = await queryRunner.query(
          `SELECT count(*)::int AS n FROM spend_items WHERE predecessor_id IS NOT NULL`,
        );
        return n;
      });
    }
    await queryRunner.query(`DROP INDEX IF EXISTS ${UNIQUE_INDEX}`);
    await queryRunner.query(`ALTER TABLE spend_items DROP CONSTRAINT IF EXISTS ${FOREIGN_KEY}`);
    await queryRunner.query(`ALTER TABLE spend_items DROP COLUMN IF EXISTS predecessor_id`);
    console.log(`${LOG_PREFIX} column predecessor_id dropped, ${dropped} link(s) between lines removed`);
  }
}

/**
 * Runs `fn` with row level security off on the tables, then restores what was found, also when
 * `fn` fails (1853950000000). After a failed statement the transaction is aborted and refuses the
 * restore: its rollback restores the state then, and the error of `fn` is the one reported.
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

/** How `pg_trigger.tgenabled` reads back once enabled again: origin (the default), always, replica. */
const ENABLE_TRIGGER: Record<string, string> = { O: 'ENABLE TRIGGER', A: 'ENABLE ALWAYS TRIGGER', R: 'ENABLE REPLICA TRIGGER' };

/**
 * Runs `fn` with the named triggers of `table` disabled, those that exist and are enabled, then
 * enables each as found (1853950000000); restored like `withoutRowSecurity`.
 */
async function withoutTriggers<T>(queryRunner: QueryRunner, table: string, triggers: string[], fn: () => Promise<T>): Promise<T> {
  const found: Array<{ trigger: string; enable: string }> = [];
  for (const trigger of triggers) {
    const [state] = await queryRunner.query(
      `SELECT tgenabled::text AS enabled FROM pg_trigger WHERE tgrelid = $1::regclass AND tgname = $2 AND NOT tgisinternal`,
      [table, trigger],
    );
    const enable = state ? ENABLE_TRIGGER[String(state.enabled)] : undefined;
    if (enable) found.push({ trigger, enable });
  }
  for (const { trigger } of found) await queryRunner.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  let failed = false;
  try {
    return await fn();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      for (const { trigger, enable } of found) await queryRunner.query(`ALTER TABLE ${table} ${enable} ${trigger}`);
    } catch (restoreError) {
      if (!failed) throw restoreError;
    }
  }
}
