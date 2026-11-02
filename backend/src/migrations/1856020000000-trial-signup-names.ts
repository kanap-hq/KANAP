import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Trial sign-up: first and last name of the person who signs up. `trial_signups` (no tenant)
 * keeps them; a new sign-up for the same slug overwrites them. The Administrator created at
 * activation gets them.
 *
 * Nullable columns only, added with `IF NOT EXISTS`: a second run changes nothing, and no row is
 * written. `down()` drops the columns.
 */
export class TrialSignupNames1856020000000 implements MigrationInterface {
  name = 'TrialSignupNames1856020000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE trial_signups ADD COLUMN IF NOT EXISTS first_name text`);
    await queryRunner.query(`ALTER TABLE trial_signups ADD COLUMN IF NOT EXISTS last_name text`);
    console.log('[Migration] Trial sign-up: first and last name');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE trial_signups DROP COLUMN IF EXISTS last_name`);
    await queryRunner.query(`ALTER TABLE trial_signups DROP COLUMN IF EXISTS first_name`);
  }
}
