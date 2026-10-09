import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] AnalyticsAxisAppliesTo:';
const APPLIES_CHECK = 'analytics_axes_applies_to_check';
const DEFAULT_CHECK = 'analytics_axes_default_applies_check';

/**
 * Which budget lines an analytics dimension applies to (plan planning/opex-capex-transfer.md
 * §13.2): `opex`: OPEX lines only; `capex`: CAPEX lines only; NULL: both.
 *
 * 1. `analytics_axes.applies_to text NULL`.
 * 2. `analytics_axes_applies_to_check`: `applies_to IN ('opex', 'capex')`.
 * 3. `analytics_axes_default_applies_check`: the default dimension applies to both
 *    (`NOT is_default OR applies_to IS NULL`).
 *
 * No backfill: every existing dimension stays NULL (both), so no row can violate either
 * constraint, unless the column was added by hand before; such a run fails loudly on the
 * constraint rather than guessing. Each step is skipped when already done: a second run
 * changes nothing. down() drops both constraints and the column.
 */
export class AnalyticsAxisAppliesTo1853900000000 implements MigrationInterface {
  name = 'AnalyticsAxisAppliesTo1853900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE analytics_axes ADD COLUMN IF NOT EXISTS applies_to text`);
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
      `${LOG_PREFIX} column applies_to ready, `
        + (added.length ? `constraint(s) added: ${added.join(', ')}` : 'constraints already present'),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE analytics_axes DROP CONSTRAINT IF EXISTS ${DEFAULT_CHECK}`);
    await queryRunner.query(`ALTER TABLE analytics_axes DROP CONSTRAINT IF EXISTS ${APPLIES_CHECK}`);
    await queryRunner.query(`ALTER TABLE analytics_axes DROP COLUMN IF EXISTS applies_to`);
  }
}
