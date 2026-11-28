import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The last GLPI connection test of a workspace: `ai_settings.glpi_last_test jsonb NULL`
 * (`{ ok, tested_at }`), kept when a test runs on the saved address and tokens, emptied when a
 * save changes them. The other connections keep theirs in `ai_adapter_configs.metadata_json`;
 * GLPI lives on `ai_settings`, which has no such column.
 *
 * Every workspace starts without a test: nothing is written. `ai_settings` is already under
 * tenant isolation and keeps no modification date by trigger: the column changes no policy and
 * no trigger. Rerun-safe (`IF NOT EXISTS`); down() drops the column.
 */
export class GlpiLastTest1856350000000 implements MigrationInterface {
  name = 'GlpiLastTest1856350000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS glpi_last_test jsonb NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ai_settings DROP COLUMN IF EXISTS glpi_last_test`);
  }
}
