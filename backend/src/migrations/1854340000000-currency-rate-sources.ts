import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-currency provenance of a rate set (`currency_rate_sets.rate_sources`).
 * No backfill: a set captured before this column lends its set-level `source`
 * to each value. `ADD COLUMN IF NOT EXISTS` keeps a rerun on a database that
 * already has the column.
 */
export class CurrencyRateSources1854340000000 implements MigrationInterface {
  name = 'CurrencyRateSources1854340000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE currency_rate_sets ADD COLUMN IF NOT EXISTS rate_sources jsonb NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE currency_rate_sets DROP COLUMN IF EXISTS rate_sources`);
  }
}
