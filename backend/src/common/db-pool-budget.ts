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

export function readPoolMax(env: NodeJS.ProcessEnv = process.env): number {
  const value = parseInt(env.DB_POOL_MAX || String(DEFAULT_POOL_MAX), 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_POOL_MAX;
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
  const message = ok
    ? `[DB] pool budget: ${shape} of ${usable} usable (${server})`
    : `[DB] pool budget exceeded: ${shape}, but only ${usable} usable (${server}). Under load, requests can fail with "too many clients". `
      + `Lower DB_POOL_MAX (to ${Math.max(1, Math.floor(usable / input.processes))} or less) or API_WORKERS, or raise max_connections on the server.`;
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
