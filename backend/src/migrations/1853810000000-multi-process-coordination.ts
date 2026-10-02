import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Several API processes (plan planning/perf-scale lot 4A, `API_WORKERS`): the state that lived
 * in one process's memory moves to the database.
 *
 * - `scheduled_tasks.last_tick_at`: the scheduled time of the last cron tick a process claimed.
 *   Every process schedules every task; the one that moves this column to the tick's time runs
 *   it, the others skip (`ScheduledTasksService.claimTick`).
 * - `notification_dedupe`: when an event notification was last sent, per recipient, item and
 *   trigger (`notifications/notification-dedupe.ts`). Tenant-scoped, RLS forced.
 * - `rate_limit_hits`: the HTTP rate limit counts, used when several processes run
 *   (`common/rate-limit-store.ts`). Global (keys are hashes of route and client), UNLOGGED:
 *   counts need no crash safety and write no WAL.
 *
 * Idempotent and self-healing: every step can run again on any database, including one where an
 * earlier run stopped half way.
 */
export class MultiProcessCoordination1853810000000 implements MigrationInterface {
  name = 'MultiProcessCoordination1853810000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS last_tick_at timestamptz`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notification_dedupe (
        tenant_id uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants(id) ON DELETE CASCADE,
        dedupe_key text NOT NULL,
        sent_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT notification_dedupe_pkey PRIMARY KEY (tenant_id, dedupe_key)
      )
    `);
    await queryRunner.query(`ALTER TABLE notification_dedupe ADD COLUMN IF NOT EXISTS sent_at timestamptz NOT NULL DEFAULT now()`);
    // The purge reads one tenant's rows by date.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_notification_dedupe_tenant_sent ON notification_dedupe (tenant_id, sent_at)`);
    await queryRunner.query(`ALTER TABLE notification_dedupe ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE notification_dedupe FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP POLICY IF EXISTS notification_dedupe_tenant_isolation ON notification_dedupe`);
    await queryRunner.query(`
      CREATE POLICY notification_dedupe_tenant_isolation ON notification_dedupe FOR ALL
      USING (tenant_id = app_current_tenant())
      WITH CHECK (tenant_id = app_current_tenant())
    `);

    await queryRunner.query(`
      CREATE UNLOGGED TABLE IF NOT EXISTS rate_limit_hits (
        key text PRIMARY KEY,
        hits integer NOT NULL DEFAULT 0,
        window_ends_at timestamptz NOT NULL,
        blocked_until timestamptz
      )
    `);
    await queryRunner.query(`ALTER TABLE rate_limit_hits ADD COLUMN IF NOT EXISTS blocked_until timestamptz`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_window_ends ON rate_limit_hits (window_ends_at)`);

    console.log('[Migration] MultiProcessCoordination: scheduled task ticks, notification dedupe (RLS forced), rate limit counts ready.');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS rate_limit_hits`);
    await queryRunner.query(`DROP TABLE IF EXISTS notification_dedupe`);
    await queryRunner.query(`ALTER TABLE scheduled_tasks DROP COLUMN IF EXISTS last_tick_at`);
  }
}
