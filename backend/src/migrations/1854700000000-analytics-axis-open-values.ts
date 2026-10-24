import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Data-scoped access, lot 3 (planning/data-scoped-access/spec.md §3.5): whether anyone who may
 * modify a budget line may add a value to an analytics dimension, from the line's picker or the
 * budget file: `analytics_axes.open_values boolean NOT NULL DEFAULT false`. A closed dimension (the
 * default, the four recommended ones included) gets its values from the dimension page, reserved
 * to people with access to all data (§2.7).
 *
 * The default fills every existing row with false: nothing to repair, no row level security
 * change. Rerun-safe (`IF NOT EXISTS`); down() drops the column.
 */
export class AnalyticsAxisOpenValues1854700000000 implements MigrationInterface {
  name = 'AnalyticsAxisOpenValues1854700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE analytics_axes ADD COLUMN IF NOT EXISTS open_values boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE analytics_axes DROP COLUMN IF EXISTS open_values`);
  }
}
