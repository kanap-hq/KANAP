import { DataSource } from 'typeorm';
import { pendingMigrationCount } from '../common/startup-migrations';

/**
 * Readiness (`GET /health/ready`): whether this API process may receive traffic. An orchestrator
 * takes the process out of its service while the answer is 503 and puts it back on 200; it never
 * restarts it for that (the liveness route, `/health`, says whether the process is alive).
 *
 * - 200 `{ status: 'ok' }`: `SELECT 1` answered within 2 s, and no migration of this build is
 *   pending. Once that is true the process is ready, and that is remembered: the build's
 *   migrations never change while the process runs, so the table is no longer read.
 * - 503 `{ status: 'unavailable' }`: any error of `SELECT 1` or of the read of the migrations (a
 *   refused or lost connection, an unknown host, a refused password, a missing database), a
 *   migration pending (an API started with SKIP_MIGRATIONS before the migration step ran), or no
 *   answer within 2 s. Until the process has been ready once, a saturated pool is 503 too: a
 *   process a migration behind is never declared ready because it is loaded. No detail in the
 *   body: the route is public.
 * - 200 `{ status: 'ok', database: 'busy' }`: the process has been ready, and every connection of
 *   its pool is taken or requests wait for one. No query is sent. A loaded instance stays in
 *   service: taking it out would move its load to the others.
 *
 * Once ready, a check that runs out of time is 503 as well. It asks the pool for its connection
 * in the same tick as it found the pool not saturated, so it does not wait in the pool's queue
 * (unless requests of that same tick took the last idle connection): the 2 s went to the
 * database, opening a connection or answering `SELECT 1`.
 *
 * One check at a time: probes that arrive while a check runs share its outcome, so a database that
 * does not answer holds at most one connection of the pool. That connection is bounded too:
 * `SELECT 1` carries node-postgres' `query_timeout` (2 s; a frozen server never enforces a
 * server-side `statement_timeout`), and a connection that failed or ran out of time leaves the
 * pool instead of returning to it.
 *
 * It reads nothing else: no storage, no Markdown workers, no external service.
 */
export const READINESS_TIMEOUT_MS = 2000;

export type ReadinessDeps = {
  /** `SELECT 1` on one connection of the pool, given up after `timeoutMs`. */
  ping(timeoutMs: number): Promise<unknown>;
  /** How many migrations of this build the database has not run (reads only). */
  pendingMigrations(): Promise<number>;
  /** Whether every connection of the pool is taken, or requests already wait for one. */
  poolSaturated(): boolean;
};

export type ReadinessResult = {
  statusCode: 200 | 503;
  body: { status: 'ok' | 'unavailable'; database?: 'busy' };
};

const READY: ReadinessResult = { statusCode: 200, body: { status: 'ok' } };
const BUSY: ReadinessResult = { statusCode: 200, body: { status: 'ok', database: 'busy' } };
const UNAVAILABLE: ReadinessResult = { statusCode: 503, body: { status: 'unavailable' } };

const PENDING = Symbol('pending migrations');
const TIMED_OUT = Symbol('timed out');

export class ReadinessCheck {
  private migrationsUpToDate = false;
  /** The check in flight, shared by the probes that arrive meanwhile. */
  private running: Promise<void> | null = null;

  constructor(private readonly deps: ReadinessDeps, private readonly timeoutMs = READINESS_TIMEOUT_MS) {}

  async check(): Promise<ReadinessResult> {
    if (!this.running) {
      if (this.deps.poolSaturated()) return this.migrationsUpToDate ? BUSY : UNAVAILABLE;
      const probe = this.probe();
      this.running = probe;
      // Cleared once it settles, whoever waits on it; a probe that settles after the deadline of
      // every caller is dropped (no unhandled rejection).
      probe.then(() => { this.running = null; }, () => { this.running = null; });
    }
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(TIMED_OUT), this.timeoutMs);
    });
    try {
      await Promise.race([this.running, deadline]);
      return READY;
    } catch {
      return UNAVAILABLE;
    } finally {
      clearTimeout(timer);
    }
  }

  private async probe(): Promise<void> {
    await this.deps.ping(this.timeoutMs);
    if (this.migrationsUpToDate) return;
    if ((await this.deps.pendingMigrations()) > 0) throw PENDING;
    this.migrationsUpToDate = true;
  }
}

type PgClient = { query(config: { text: string; query_timeout?: number }): Promise<unknown> };
type PgPool = { totalCount?: number; idleCount?: number; waitingCount?: number; options?: { max?: number } };
type PostgresRunner = { connect(): Promise<PgClient>; release(): Promise<void>; releasePostgresConnection(err?: unknown): Promise<void> };

/** The readiness of the API's data source: its pg pool, its migrations. */
export function dataSourceReadiness(dataSource: DataSource): ReadinessDeps {
  return {
    // A TypeORM query runner holds the connection (it listens to the connection's errors while it
    // is out of the pool); the query goes to the pg client itself, for its `query_timeout`.
    ping: async (timeoutMs) => {
      const runner = dataSource.createQueryRunner() as unknown as PostgresRunner;
      let client: PgClient;
      try {
        client = await runner.connect();
      } catch (error) {
        await runner.release().catch(() => undefined);
        throw error;
      }
      try {
        await client.query({ text: 'SELECT 1', query_timeout: timeoutMs });
      } catch (error) {
        // Released with the error: the pool closes this connection instead of reusing it.
        await runner.releasePostgresConnection(error).catch(() => undefined);
        throw error;
      }
      await runner.release();
    },
    pendingMigrations: () => pendingMigrationCount(dataSource),
    poolSaturated: () => {
      const pool = (dataSource.driver as unknown as { master?: PgPool }).master;
      if (!pool) return false;
      if ((pool.waitingCount ?? 0) > 0) return true;
      const max = pool.options?.max;
      return max != null && (pool.totalCount ?? 0) >= max && (pool.idleCount ?? 0) === 0;
    },
  };
}
