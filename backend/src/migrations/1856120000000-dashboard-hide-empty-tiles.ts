import { MigrationInterface, QueryRunner } from 'typeorm';

/** The home page option that leaves out the tiles with nothing to show, on for everyone. */
export class DashboardHideEmptyTiles1856120000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE user_dashboard_config ADD COLUMN IF NOT EXISTS hide_empty_tiles boolean NOT NULL DEFAULT true`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE user_dashboard_config DROP COLUMN IF EXISTS hide_empty_tiles`);
  }
}
