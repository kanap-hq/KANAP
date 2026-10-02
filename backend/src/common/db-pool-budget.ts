/**
 * Database connection budget of the API (plan planning/perf-scale lot 4B).
 *
 * Every API process has its own pool of `DB_POOL_MAX` connections (default 20), so the API can
 * open up to processes × pool connections. They must fit in the server's `max_connections`,
 * minus the connections reserved for superusers (`superuser_reserved_connections`, plus
 * `reserved_connections` on PostgreSQL 16+) and a margin for everything else that connects:
 * the migrations at start, the cluster primary's migration connection, a psql session, a
 * backup, a monitoring probe. The check runs once per start (the single process, or worker 1)
 * and only warns: the API still starts, and a pool that never fills never hits the limit.
 */
export const POOL_BUDGET_MARGIN = 10;
export const DEFAULT_POOL_MAX = 20;
/**
 * The smallest pool that works: a scheduled task holds one connection for its lock while its
 * queries take another, and with several processes a rate-limited request takes a second one
 * for its count. `DB_POOL_MAX` below it is raised to it, with a warning at start.
 */
export const MIN_POOL_MAX = 2;

function configuredPoolMax(env: NodeJS.ProcessEnv): number {
  const value = parseInt(env.DB_POOL_MAX || String(DEFAULT_POOL_MAX), 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_POOL_MAX;
}

export function readPoolMax(env: NodeJS.ProcessEnv = process.env): number {
  return Math.max(MIN_POOL_MAX, configuredPoolMax(env));
}

/** The warning for a `DB_POOL_MAX` under the minimum, or null. */
export function poolMaxFloorWarning(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = configuredPoolMax(env);
  if (configured >= MIN_POOL_MAX) return null;
  return `[DB] DB_POOL_MAX=${configured} raised to ${MIN_POOL_MAX}, the minimum: a scheduled task holds one connection for its lock while its queries need another.`;
}

export type PoolBudget = {
  processes: number;
  poolMax: number;
  /** processes × poolMax */
  needed: number;
  maxConnections: number;
  reserved: number;
  margin: number;
  /** max_connections − reserved − margin */
  usable: number;
  ok: boolean;
  message: string;
};

type Query = (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>;

export function evaluatePoolBudget(input: {
  processes: number;
  poolMax: number;
  maxConnections: number;
  reserved: number;
  margin?: number;
}): PoolBudget {
  const margin = input.margin ?? POOL_BUDGET_MARGIN;
  const needed = input.processes * input.poolMax;
  const usable = input.maxConnections - input.reserved - margin;
  const ok = needed <= usable;
  const shape = `${input.processes} process${input.processes > 1 ? 'es' : ''} × ${input.poolMax} connections = ${needed}`;
  const server = `max_connections ${input.maxConnections}, ${input.reserved} reserved, ${margin} kept for migrations, psql and monitoring`;
  const fitting = Math.floor(usable / input.processes);
  const advice = fitting >= MIN_POOL_MAX
    ? `Lower DB_POOL_MAX (to ${fitting} or less) or API_WORKERS, or raise max_connections on the server.`
    : `Lower API_WORKERS (each process needs at least ${MIN_POOL_MAX} connections) or raise max_connections on the server.`;
  const message = ok
    ? `[DB] pool budget: ${shape} of ${usable} usable (${server})`
    : `[DB] pool budget exceeded: ${shape}, but only ${usable} usable (${server}). Under load, requests can fail with "too many clients". ${advice}`;
  return { processes: input.processes, poolMax: input.poolMax, needed, maxConnections: input.maxConnections, reserved: input.reserved, margin, usable, ok, message };
}

export async function checkPoolBudget(query: Query, opts: { processes: number; poolMax: number; margin?: number }): Promise<PoolBudget> {
  const [row] = await query(
    `SELECT current_setting('max_connections')::int AS max_connections,
            current_setting('superuser_reserved_connections')::int AS superuser_reserved,
            COALESCE(NULLIF(current_setting('reserved_connections', true), ''), '0')::int AS reserved`,
  );
  const maxConnections = Number(row?.max_connections ?? 0);
  const reserved = Number(row?.superuser_reserved ?? 0) + Number(row?.reserved ?? 0);
  return evaluatePoolBudget({ processes: opts.processes, poolMax: opts.poolMax, maxConnections, reserved, margin: opts.margin });
}
