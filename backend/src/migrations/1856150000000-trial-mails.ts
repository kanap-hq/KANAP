import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] Trial mails:';

/**
 * The trial e-mails of a workspace (`doc/trial-mails.md`): one row per tenant, created when the
 * scheduler first sees the trial, with when each e-mail was sent (J0, J+5, J+12, the end-of-trial
 * notice, the thank-you at the first subscription), when the first sign-in was seen (J0 goes one
 * hour later when no path was chosen) and when the person unsubscribed. A stamp is set before the
 * e-mail goes out, so a milestone is sent at most once per tenant, whichever process runs it.
 *
 * `tenants.metadata` cannot hold it: the tenant reset and the platform administration rewrite that
 * column whole.
 *
 * RLS enabled and forced, with the policy `trial_mails_tenant_isolation` (USING and WITH CHECK).
 * The table is new and holds nothing: no backfill. Every statement uses IF NOT EXISTS or drops the
 * policy first: a second run changes nothing. down() drops the table.
 */
export class TrialMails1856150000000 implements MigrationInterface {
  name = 'TrialMails1856150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS trial_mails (
        tenant_id uuid PRIMARY KEY DEFAULT app_current_tenant() REFERENCES tenants(id) ON DELETE CASCADE,
        first_login_at timestamptz NULL,
        j0_sent_at timestamptz NULL,
        j5_sent_at timestamptz NULL,
        j12_sent_at timestamptz NULL,
        ended_sent_at timestamptz NULL,
        thanks_sent_at timestamptz NULL,
        unsubscribed_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`ALTER TABLE trial_mails ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE trial_mails FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP POLICY IF EXISTS trial_mails_tenant_isolation ON trial_mails`);
    await queryRunner.query(`
      CREATE POLICY trial_mails_tenant_isolation ON trial_mails
        USING (tenant_id = app_current_tenant())
        WITH CHECK (tenant_id = app_current_tenant())
    `);

    console.log(`${LOG_PREFIX} trial_mails ready`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS trial_mails`);
  }
}
