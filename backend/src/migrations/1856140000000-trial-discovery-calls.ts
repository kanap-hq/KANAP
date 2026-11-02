import { MigrationInterface, QueryRunner } from 'typeorm';

const LOG_PREFIX = '[Migration] Trial discovery calls:';

/**
 * The discovery call of a trial workspace (`doc/discovery-call.md`): one row per tenant, with the
 * date of the call, its state (`booked` or `cancelled`), where it came from (`calcom`, the
 * booking webhook, or `manual`, set by the platform administrator), a note, and the Cal.com
 * booking uid that a reschedule or a cancellation refers to.
 *
 * RLS enabled and forced, with the policy `trial_discovery_calls_tenant_isolation` (USING and
 * WITH CHECK). The table is new and holds nothing: no backfill. Every statement uses IF NOT EXISTS
 * or drops the policy first: a second run changes nothing. down() drops the table.
 */
export class TrialDiscoveryCalls1856140000000 implements MigrationInterface {
  name = 'TrialDiscoveryCalls1856140000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS trial_discovery_calls (
        tenant_id uuid PRIMARY KEY DEFAULT app_current_tenant() REFERENCES tenants(id) ON DELETE CASCADE,
        scheduled_at timestamptz NULL,
        status text NOT NULL,
        source text NOT NULL,
        note text NULL,
        external_id text NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT trial_discovery_calls_status_check CHECK (status IN ('booked', 'cancelled')),
        CONSTRAINT trial_discovery_calls_source_check CHECK (source IN ('calcom', 'manual'))
      )`);

    await queryRunner.query(`ALTER TABLE trial_discovery_calls ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE trial_discovery_calls FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP POLICY IF EXISTS trial_discovery_calls_tenant_isolation ON trial_discovery_calls`);
    await queryRunner.query(`
      CREATE POLICY trial_discovery_calls_tenant_isolation ON trial_discovery_calls
        USING (tenant_id = app_current_tenant())
        WITH CHECK (tenant_id = app_current_tenant())
    `);

    console.log(`${LOG_PREFIX} trial_discovery_calls ready`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS trial_discovery_calls`);
  }
}
