import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Trial sign-up: first and last name, and the consent to the included model of Plaid given on
 * the sign-up form (public/ai-signup-consent.ts).
 *
 * - `trial_signups` (no tenant) keeps the names and the consent of the sign-up: version of the
 *   text of the box, moment, client address. A new sign-up for the same slug overwrites them.
 * - `ai_settings` keeps the consent copied at activation, as the proof of the consent the
 *   workspace was opened with. The person is the administrator `builtin_accepted_by`.
 *
 * Nullable columns only, added with `IF NOT EXISTS`: a second run changes nothing, and no row is
 * written. `down()` drops the columns.
 */
export class TrialSignupConsent1856020000000 implements MigrationInterface {
  name = 'TrialSignupConsent1856020000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE trial_signups ADD COLUMN IF NOT EXISTS first_name text`);
    await queryRunner.query(`ALTER TABLE trial_signups ADD COLUMN IF NOT EXISTS last_name text`);
    await queryRunner.query(`ALTER TABLE trial_signups ADD COLUMN IF NOT EXISTS ai_consent_version text`);
    await queryRunner.query(`ALTER TABLE trial_signups ADD COLUMN IF NOT EXISTS ai_consent_at timestamptz`);
    await queryRunner.query(`ALTER TABLE trial_signups ADD COLUMN IF NOT EXISTS ai_consent_ip text`);
    await queryRunner.query(`ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS signup_consent_version text`);
    await queryRunner.query(`ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS signup_consent_at timestamptz`);
    await queryRunner.query(`ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS signup_consent_ip text`);
    console.log('[Migration] Trial sign-up: names and consent to the included model');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ai_settings DROP COLUMN IF EXISTS signup_consent_ip`);
    await queryRunner.query(`ALTER TABLE ai_settings DROP COLUMN IF EXISTS signup_consent_at`);
    await queryRunner.query(`ALTER TABLE ai_settings DROP COLUMN IF EXISTS signup_consent_version`);
    await queryRunner.query(`ALTER TABLE trial_signups DROP COLUMN IF EXISTS ai_consent_ip`);
    await queryRunner.query(`ALTER TABLE trial_signups DROP COLUMN IF EXISTS ai_consent_at`);
    await queryRunner.query(`ALTER TABLE trial_signups DROP COLUMN IF EXISTS ai_consent_version`);
    await queryRunner.query(`ALTER TABLE trial_signups DROP COLUMN IF EXISTS last_name`);
    await queryRunner.query(`ALTER TABLE trial_signups DROP COLUMN IF EXISTS first_name`);
  }
}
