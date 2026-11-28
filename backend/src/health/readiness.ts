import { DataSource } from 'typeorm';
import { isConnectionError } from '../common/database-connection-error';
import { pendingMigrationCount } from '../common/startup-migrations';

/**
 * Readiness (`GET /health/ready`): whether this API process may receive traffic. An orchestrator
 * takes the process out of its service while the answer is 503 and puts it back on 200; it never
 * restarts it for that (the liveness route, `/health`, says whether the process is alive).
 *
 * - 200 `{ status: 'ok' }`: `SELECT 1` answered within 2 s, and no migration of this build is
 *   pending. Once no migration is pending, that is remembered: the build's migrations never change
 *   while the process runs, so the table is no longer read.
 * - 503 `{ status: 'unavailable' }`: the database does not answer (a lost or refused connection,
 *   `isConnectionError`), or a migration is pending (an API started with SKIP_MIGRATIONS before
 *   the migration step ran). No detail in the body: the route is public.
 * - 200 `{ status: 'ok', database: 'busy' }`: the connection pool is saturated, or the check did not
 *   finish within 2 s for another reason. A loaded instance stays in service: taking it out would
 *   move its load to the others. When the pool is saturated, no query is sent at all.
 *
 * It reads nothing else: no storage, no Markdown workers, no external service.
 */
export const READINESS_TIMEOUT_MS = 2000;

export type ReadinessDeps = {
  /** `SELECT 1` on the pool. */
  ping(): Promise<unknown>;
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

  constructor(private readonly deps: ReadinessDeps, private readonly timeoutMs = READINESS_TIMEOUT_MS) {}

  async check(): Promise<ReadinessResult> {
    if (this.deps.poolSaturated()) return BUSY;
    const probe = this.probe();
    // A probe still running at the deadline settles later: its outcome is dropped.
    probe.catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(TIMED_OUT), this.timeoutMs);
    });
    try {
      await Promise.race([probe, deadline]);
      return READY;
    } catch (error) {
      if (error === PENDING || isConnectionError(error)) return UNAVAILABLE;
      return BUSY;
    } finally {
      clearTimeout(timer);
    }
  }

  private async probe(): Promise<void> {
    await this.deps.ping();
    if (this.migrationsUpToDate) return;
    if ((await this.deps.pendingMigrations()) > 0) throw PENDING;
    this.migrationsUpToDate = true;
  }
}

type PgPool = { totalCount?: number; idleCount?: number; waitingCount?: number; options?: { max?: number } };

/** The readiness of the API's data source: its pg pool, its migrations. */
export function dataSourceReadiness(dataSource: DataSource): ReadinessDeps {
  return {
    ping: () => dataSource.query('SELECT 1'),
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
