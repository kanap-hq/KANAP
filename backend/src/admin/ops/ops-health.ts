/**
 * Alert thresholds of the ops metrics (plan planning/perf-scale lot 4D), documented for operators
 * in doc/architecture.md ("Supervision") and the on-premise operations guide. The snapshot
 * carries `health: { status, alerts }` computed from them, so a monitoring probe can read one
 * field. With several API processes the thresholds apply to the aggregate (worst process for the
 * event loop and for the pool's use, merged counts for latencies, sums for errors), and memory to
 * each process.
 *
 * An alert fires when the value is above its threshold (`>`). Latencies of several processes are
 * read from histogram buckets as the bucket's upper bound (latency-histogram.ts): their thresholds
 * are bucket bounds, so a value at most the threshold never reads as above it.
 */
export const OPS_THRESHOLDS = {
  /** Event loop lag p95 over the last minute: every request of the process waits that long. */
  eventLoopP95Ms: { warn: 100, critical: 500 },
  /** Time to get a database connection, p95 over the last minute (bucket bounds). */
  poolWaitP95Ms: { warn: 50, critical: 1000 },
  /** Connections in use, highest over the last minute, against the pool size, in the fullest process. */
  poolInUsePct: { warn: 90 },
  /** Connections the pool could not give (timeout after DB_POOL_CONNECTION_TIMEOUT, database down), 5 minutes. */
  poolFailures5m: { critical: 0 },
  /** Share of 5xx answers over 5 minutes, from 20 requests on. */
  error5xxPct: { warn: 1, critical: 5, minRequests: 20 },
  /** p95 of one route over 5 minutes, from 20 requests on that route (bucket bounds). */
  routeP95Ms: { warn: 1000, critical: 3000, minRequests: 20 },
  /** Resident memory of one API process. */
  rssMB: { warn: 1024 },
} as const;

/** Routes slow by nature (AI streaming, Netbox, imports, exports, bulk writes): no p95 alert. */
export const ROUTES_WITHOUT_P95_ALERT = /\/ai\/|\/netbox\/|import|export|bulk|\/csv/i;

export type OpsAlert = {
  level: 'warn' | 'critical';
  metric: string;
  value: number;
  threshold: number;
  message: string;
};

export type OpsHealth = {
  status: 'ok' | 'warn' | 'critical';
  alerts: OpsAlert[];
};

export type OpsHealthInput = {
  eventLoopP95Ms: number;
  poolWaitP95Ms: number;
  /** Highest share of its pool a process used over the last minute (the fullest process). */
  poolInUsePct: number;
  /** The process that share belongs to, for the message. */
  poolInUseLabel?: string;
  poolFailures5m: number;
  requests5m: number;
  errors5xx5m: number;
  routes: Array<{ method: string; route: string; count: number; p95: number }>;
  processes: Array<{ label: string; rssMB: number }>;
};

export function evaluateOpsHealth(input: OpsHealthInput): OpsHealth {
  const alerts: OpsAlert[] = [];
  const check = (metric: string, value: number, limits: { warn?: number; critical?: number }, message: string) => {
    if (limits.critical !== undefined && value > limits.critical) {
      alerts.push({ level: 'critical', metric, value, threshold: limits.critical, message });
    } else if (limits.warn !== undefined && value > limits.warn) {
      alerts.push({ level: 'warn', metric, value, threshold: limits.warn, message });
    }
  };
  const t = OPS_THRESHOLDS;

  check('event_loop_p95_ms', input.eventLoopP95Ms, t.eventLoopP95Ms,
    'The API main thread is busy: every request waits behind it. More API processes (API_WORKERS) or less work per request.');
  check('pool_wait_p95_ms', input.poolWaitP95Ms, t.poolWaitP95Ms,
    'Requests wait for a database connection. Raise DB_POOL_MAX within max_connections, or find the requests that hold connections long.');
  check('pool_in_use_pct', Math.round(input.poolInUsePct * 10) / 10, t.poolInUsePct,
    `The database pool${input.poolInUseLabel ? ` of ${input.poolInUseLabel}` : ''} was nearly full over the last minute.`);
  check('pool_failures_5m', input.poolFailures5m, t.poolFailures5m,
    'Requests got no database connection (pool timeout or database unreachable) and were answered 503.');
  if (input.requests5m >= t.error5xxPct.minRequests) {
    const pct = Math.round((input.errors5xx5m / input.requests5m) * 1000) / 10;
    check('error_5xx_pct', pct, t.error5xxPct, 'Share of server errors (5xx) over 5 minutes.');
  }
  for (const route of input.routes) {
    if (route.count < t.routeP95Ms.minRequests || ROUTES_WITHOUT_P95_ALERT.test(route.route)) continue;
    check(`route_p95_ms:${route.method} ${route.route}`, route.p95, t.routeP95Ms, `Slow route over 5 minutes: ${route.method} ${route.route}.`);
  }
  for (const process of input.processes) {
    check(`rss_mb:${process.label}`, process.rssMB, t.rssMB, `Memory of ${process.label}.`);
  }

  const status = alerts.some((a) => a.level === 'critical') ? 'critical' : alerts.length > 0 ? 'warn' : 'ok';
  return { status, alerts };
}
