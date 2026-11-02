import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The home page layout of each person: the option that leaves out the empty tiles and the order
 * and visibility of the sections. Empty until the person customizes the page.
 */
export class DashboardLayout1856130000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE user_dashboard_config ADD COLUMN IF NOT EXISTS layout jsonb NOT NULL DEFAULT '{}'::jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE user_dashboard_config DROP COLUMN IF EXISTS layout`);
  }
}
