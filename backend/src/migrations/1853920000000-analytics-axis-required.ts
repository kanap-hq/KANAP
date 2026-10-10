import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Whether an analytics dimension is required (plan planning/opex-capex-transfer.md §13.4):
 * `analytics_axes.required boolean NOT NULL DEFAULT false`. A new budget line must then hold a
 * value on it, and a held value cannot be cleared; lines already without one stay editable.
 *
 * The default fills every existing row with false: nothing to repair, no row level security
 * change. Rerun-safe (`IF NOT EXISTS`); down() drops the column.
 */
export class AnalyticsAxisRequired1853920000000 implements MigrationInterface {
  name = 'AnalyticsAxisRequired1853920000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE analytics_axes ADD COLUMN IF NOT EXISTS required boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE analytics_axes DROP COLUMN IF EXISTS required`);
  }
}
