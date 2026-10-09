import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] AnalyticsAxisAppliesTo:';
const APPLIES_CHECK = 'analytics_axes_applies_to_check';
const DEFAULT_CHECK = 'analytics_axes_default_applies_check';

/**
 * Which budget lines an analytics dimension applies to (plan planning/opex-capex-transfer.md
 * §13.2): `opex`: OPEX lines only; `capex`: CAPEX lines only; NULL: both.
 *
 * 1. `analytics_axes.applies_to text NULL`.
 * 2. Repair, with row level security disabled on `analytics_axes` (migrations run without
 *    app.current_tenant) and restored to the state found afterwards: a value outside
 *    ('opex', 'capex'), or any value on the default dimension, is set to NULL (both). Only a
 *    column added or written by hand can hold one. The repaired count is logged.
 * 3. `analytics_axes_applies_to_check`: `applies_to IN ('opex', 'capex')`.
 * 4. `analytics_axes_default_applies_check`: the default dimension applies to both
 *    (`NOT is_default OR applies_to IS NULL`).
 *
 * No backfill otherwise: every existing dimension stays NULL (both). Each step is skipped when
 * already done: a second run repairs and changes nothing. down() drops both constraints and the
 * column.
 */
export class AnalyticsAxisAppliesTo1853900000000 implements MigrationInterface {
  name = 'AnalyticsAxisAppliesTo1853900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE analytics_axes ADD COLUMN IF NOT EXISTS applies_to text`);
    const repaired = await withoutRowSecurity(queryRunner, 'analytics_axes', async () => {
      const rows: Array<{ id: string }> = await queryRunner.query(
        `UPDATE analytics_axes SET applies_to = NULL
          WHERE applies_to IS NOT NULL AND (applies_to NOT IN ('opex', 'capex') OR is_default)
        RETURNING id`,
      );
      return rows.length;
    });
    const added: string[] = [];
    for (const [name, check] of [
      [APPLIES_CHECK, `applies_to IN ('opex', 'capex')`],
      [DEFAULT_CHECK, `NOT is_default OR applies_to IS NULL`],
    ] as const) {
      const [existing] = await queryRunner.query(
        `SELECT 1 FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid
          WHERE t.relname = 'analytics_axes' AND c.conname = $1`,
        [name],
      );
      if (existing) continue;
      await queryRunner.query(`ALTER TABLE analytics_axes ADD CONSTRAINT ${name} CHECK (${check})`);
      added.push(name);
    }
    console.log(
      `${LOG_PREFIX} column applies_to ready, ${repaired} invalid value(s) cleared, `
        + (added.length ? `constraint(s) added: ${added.join(', ')}` : 'constraints already present'),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE analytics_axes DROP CONSTRAINT IF EXISTS ${DEFAULT_CHECK}`);
    await queryRunner.query(`ALTER TABLE analytics_axes DROP CONSTRAINT IF EXISTS ${APPLIES_CHECK}`);
    await queryRunner.query(`ALTER TABLE analytics_axes DROP COLUMN IF EXISTS applies_to`);
  }
}

/**
 * Runs `fn` with row level security off on the table, then restores what was found, also when
 * `fn` fails. After a failed statement the transaction is aborted and refuses the restore: its
 * rollback restores the state then, and the error of `fn` is the one reported.
 */
async function withoutRowSecurity<T>(queryRunner: QueryRunner, table: string, fn: () => Promise<T>): Promise<T> {
  const [state] = await queryRunner.query(
    `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = to_regclass($1)`,
    [table],
  );
  const enabled = !!state?.enabled;
  const forced = !!state?.forced;
  if (enabled) await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
  let failed = false;
  try {
    return await fn();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      if (enabled) await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      if (forced) await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    } catch (restoreError) {
      if (!failed) throw restoreError;
    }
  }
}
