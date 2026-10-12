import { MigrationInterface, QueryRunner } from 'typeorm';

export class BudgetDashboardConfig1854030000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE user_dashboard_config ADD COLUMN IF NOT EXISTS budget_tiles jsonb NOT NULL DEFAULT '[]'::jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE user_dashboard_config DROP COLUMN IF EXISTS budget_tiles`);
  }
}
