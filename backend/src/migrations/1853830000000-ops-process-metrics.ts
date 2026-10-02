import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ops metrics with several API processes (plan planning/perf-scale lot 4D): every process
 * publishes a summary of itself every 15 s into `ops_process_metrics`, so the snapshot answered by
 * any one of them can list and add up all of them (`admin/ops/ops-snapshot.service.ts`).
 *
 * Global (no tenant data: process ids, memory, latencies per route pattern), UNLOGGED (a summary
 * is replaced 15 s later, it needs no crash safety and writes no WAL). Rows are deleted 10 minutes
 * after their process stopped publishing. Idempotent.
 */
export class OpsProcessMetrics1853830000000 implements MigrationInterface {
  name = 'OpsProcessMetrics1853830000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNLOGGED TABLE IF NOT EXISTS ops_process_metrics (
        process_key text PRIMARY KEY,
        worker_id integer,
        pid integer NOT NULL,
        host text NOT NULL,
        started_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        summary jsonb NOT NULL
      )
    `);
    await queryRunner.query(`ALTER TABLE ops_process_metrics ADD COLUMN IF NOT EXISTS worker_id integer`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_ops_process_metrics_updated ON ops_process_metrics (updated_at)`);
    console.log('[Migration] OpsProcessMetrics: ops_process_metrics ready.');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS ops_process_metrics`);
  }
}
