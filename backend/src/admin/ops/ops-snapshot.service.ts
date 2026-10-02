import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { hostname } from 'node:os';
import { DataSource } from 'typeorm';
import { apiProcessCount, clusterWorkerId, isLeadProcess, processLabel } from '../../common/cluster/process-role';
import { DbMetricsService } from './db-metrics.service';
import { addInto, emptyCounts, percentileOf, totalOf } from './latency-histogram';
import { evaluateOpsHealth, OpsHealth } from './ops-health';
import { OpsMetricsStore, RouteLatency } from './ops-metrics.store';
import type { OpsSnapshotDto } from './dto/ops-snapshot.dto';
import { opsMetricsTokenWarning } from './ops-metrics-token';
import { OPS_DB_READ_TIMEOUT_MS, withTimeout } from './with-timeout';
import { poolSaturated } from './pool-metrics';

/**
 * The ops snapshot (`GET /admin/ops/snapshot` for platform admins, `GET /ops/metrics` with the
 * monitoring token): request rates and errors, p95 per route, event loop lag, pool use and wait,
 * database activity, and `health` against the documented thresholds (ops-health.ts).
 *
 * With several API processes (API_WORKERS > 1) a request reaches one of them. Each process
 * publishes a summary of itself every 15 s (UNLOGGED table `ops_process_metrics`); the snapshot
 * lists them in `processes`, the newest row per worker slot (a worker forked again after a crash
 * has a new row, the old one ages out), and adds them up in `aggregate`: sums for requests and
 * memory, current pool use summed and the fullest pool named, the worst process for the event
 * loop, merged latency counts for the p95s. With one process nothing is published and both
 * fields are absent.
 *
 * The figures held in memory (requests, latencies, event loop, pool) are always served; what the
 * snapshot reads from the database (pg_stat views, the other processes' rows) is given 1 s, so the
 * snapshot still answers, without those parts, when the pool is saturated.
 */
export type ProcessSummary = {
  label: string;
  workerId: number | null;
  pid: number;
  host: string;
  startedAt: number;
  updatedAt: number;
  rssMB: number;
  heapUsedMB: number;
  eventLoop: { p95Ms: number; maxMs: number; p95Ms5m: number; maxMs5m: number };
  pool: { maxPool: number; inUse: number; inUseMax1m: number; waiting: number; waitP95Ms1m: number; failures5m: number; waitCounts1m: number[] };
  requests: { count1m: number; count5m: number; errors5xx5m: number };
  /** 5 minutes of latency counts per route (latency-histogram.ts buckets), 30 busiest routes. */
  routes: Record<string, number[]>;
};

export type OpsAggregate = {
  processes: number;
  rssMB: number;
  eventLoop: { p95Ms: number; maxMs: number };
  pool: {
    maxPool: number;
    /** Connections in use now, summed. */
    inUse: number;
    /** Sum of each process's highest use over the minute: an upper bound (the highs need not coincide). */
    inUseMax1mUpperBound: number;
    /** The fullest pool over the minute (its highest use against its size) and its process. */
    inUsePctMax1m: number;
    fullestProcess: string | null;
    waiting: number;
    waitP95Ms1m: number;
    failures5m: number;
  };
  requests: { count1m: number; count5m: number; errors5xx5m: number };
  topRoutes: RouteLatency[];
};

const PUBLISH_EVERY_MS = 15_000;
/** A process that has not published for this long is gone (or stuck): left out. */
const PEER_FRESH_MS = 45_000;

@Injectable()
export class OpsSnapshotService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('OpsMetrics');
  private readonly processKey = `${hostname()}:${process.pid}`;
  private publishTimer: NodeJS.Timeout | null = null;
  private publishing: Promise<void> | null = null;
  private stopped = false;
  private lastPublishWarnAt = 0;

  constructor(
    private readonly store: OpsMetricsStore,
    private readonly dbMetrics: DbMetricsService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit() {
    if (apiProcessCount() <= 1) return;
    this.publishTimer = setInterval(() => { void this.publish(); }, PUBLISH_EVERY_MS);
    this.publishTimer.unref?.();
    setTimeout(() => { void this.publish(); }, 1_000).unref?.();
  }

  /**
   * Once per start (the lead process): a monitoring token too short to be accepted is said so,
   * and rows a day old are purged, also left by an earlier run with several processes when this
   * one runs alone (nothing publishes then, nothing purges).
   */
  onApplicationBootstrap() {
    if (!isLeadProcess()) return;
    const warning = opsMetricsTokenWarning();
    if (warning) this.logger.warn(warning);
    this.dataSource
      .query(`DELETE FROM ops_process_metrics WHERE updated_at < now() - interval '1 day'`)
      .catch(() => undefined);
  }

  /**
   * On a stop, the row goes with the process (after a publish in flight, which would write it
   * back); after a crash it ages out (PEER_FRESH_MS).
   */
  async onModuleDestroy() {
    if (!this.publishTimer) return;
    clearInterval(this.publishTimer);
    this.publishTimer = null;
    this.stopped = true;
    await this.publishing;
    await this.dataSource
      .query(`DELETE FROM ops_process_metrics WHERE process_key = $1`, [this.processKey])
      .catch(() => undefined);
  }

  async build(): Promise<OpsSnapshotDto> {
    const requestSnapshot = this.store.snapshot();
    const label = processLabel();
    // This process's summary first, before the snapshot's own reads take connections.
    const self = apiProcessCount() > 1 ? this.summary(requestSnapshot) : null;
    const saturated = poolSaturated(this.dbMetrics.poolMetrics.snapshot());
    // Both database reads at once, each given 1 s at most.
    const [dbSnapshot, processes] = await Promise.all([
      this.dbMetrics.snapshot(),
      self ? this.peers(self, saturated) : Promise.resolve(undefined),
    ]);
    const aggregate: OpsAggregate | undefined = processes ? aggregateProcesses(processes) : undefined;

    const health: OpsHealth = aggregate
      ? evaluateOpsHealth({
        eventLoopP95Ms: aggregate.eventLoop.p95Ms,
        poolWaitP95Ms: aggregate.pool.waitP95Ms1m,
        poolInUsePct: aggregate.pool.inUsePctMax1m,
        poolInUseLabel: aggregate.pool.fullestProcess ?? undefined,
        poolFailures5m: aggregate.pool.failures5m,
        requests5m: aggregate.requests.count5m,
        errors5xx5m: aggregate.requests.errors5xx5m,
        routes: aggregate.topRoutes,
        processes: (processes ?? []).map((p) => ({ label: p.label, rssMB: p.rssMB })),
      })
      : evaluateOpsHealth({
        eventLoopP95Ms: requestSnapshot.process.eventLoopLagMs.p95,
        poolWaitP95Ms: dbSnapshot.pool.wait.p95Ms1m,
        poolInUsePct: dbSnapshot.pool.maxPool > 0 ? (dbSnapshot.pool.inUseMax1m / dbSnapshot.pool.maxPool) * 100 : 0,
        poolFailures5m: dbSnapshot.pool.wait.failures5m,
        requests5m: requestSnapshot.windows['5m'].totalRequests,
        errors5xx5m: requestSnapshot.windows['5m'].statusClasses['5xx'],
        routes: requestSnapshot.topRoutes,
        processes: [{ label, rssMB: requestSnapshot.process.memoryMB.rss }],
      });

    return {
      ...requestSnapshot,
      db: dbSnapshot,
      processLabel: label,
      health,
      ...(processes ? { processes } : {}),
      ...(aggregate ? { aggregate } : {}),
      generatedAt: Date.now(),
    };
  }

  /** This process, as the others see it. */
  summary(snapshot = this.store.snapshot()): ProcessSummary {
    const pool = this.dbMetrics.poolMetrics.snapshot();
    const process5m = snapshot.windows['5m'];
    return {
      label: processLabel(),
      workerId: clusterWorkerId(),
      pid: process.pid,
      host: hostname(),
      startedAt: Math.round(Date.now() - process.uptime() * 1000),
      updatedAt: Date.now(),
      rssMB: snapshot.process.memoryMB.rss,
      heapUsedMB: snapshot.process.memoryMB.heapUsed,
      eventLoop: {
        p95Ms: snapshot.process.eventLoopLagMs.p95,
        maxMs: snapshot.process.eventLoopLagMs.max,
        p95Ms5m: snapshot.process.eventLoopLag5m.p95,
        maxMs5m: snapshot.process.eventLoopLag5m.max,
      },
      pool: {
        maxPool: pool.maxPool,
        inUse: pool.inUse,
        inUseMax1m: pool.inUseMax1m,
        waiting: pool.waitingCount,
        waitP95Ms1m: pool.wait.p95Ms1m,
        failures5m: pool.wait.failures5m,
        waitCounts1m: this.dbMetrics.poolMetrics.waitCounts(60),
      },
      requests: {
        count1m: snapshot.windows['1m'].totalRequests,
        count5m: process5m.totalRequests,
        errors5xx5m: process5m.statusClasses['5xx'],
      },
      routes: this.store.routeHistograms(),
    };
  }

  async publish(): Promise<void> {
    // A publish waiting for a saturated pool is not stacked on by the next ones.
    if (this.publishing || this.stopped) return;
    this.publishing = this.publishOnce().finally(() => { this.publishing = null; });
    await this.publishing;
  }

  private async publishOnce(): Promise<void> {
    try {
      const summary = this.summary();
      await this.dataSource.query(
        `INSERT INTO ops_process_metrics (process_key, worker_id, pid, host, started_at, updated_at, summary)
         VALUES ($1, $2, $3, $4, to_timestamp($5::double precision / 1000), now(), $6::jsonb)
         ON CONFLICT (process_key) DO UPDATE
           SET worker_id = EXCLUDED.worker_id, updated_at = now(), summary = EXCLUDED.summary`,
        [this.processKey, summary.workerId, summary.pid, summary.host, summary.startedAt, JSON.stringify(summary)],
      );
      await this.dataSource.query(`DELETE FROM ops_process_metrics WHERE updated_at < now() - interval '10 minutes'`);
    } catch (error) {
      const now = Date.now();
      if (now - this.lastPublishWarnAt > 60_000) {
        this.lastPublishWarnAt = now;
        this.logger.warn(`Process metrics not published: ${(error as Error)?.message ?? error}`);
      }
    }
  }

  /**
   * The live processes: this one fresh, the others as they last published, the newest row per
   * worker slot (host and worker id). Not read while this process's pool is saturated, and given
   * 1 s otherwise: without it, this process alone.
   */
  private async peers(self: ProcessSummary, saturated: boolean): Promise<ProcessSummary[]> {
    let rows: Array<{ process_key: string; summary: ProcessSummary }> = [];
    if (saturated) {
      // Every connection is taken and requests wait: the read would only queue behind them.
      return newestPerSlot([], self);
    }
    try {
      rows = await withTimeout(this.dataSource.query(
        `SELECT DISTINCT ON (host, worker_id) process_key, summary
           FROM ops_process_metrics
          WHERE updated_at > now() - make_interval(secs => $1::double precision / 1000)
          ORDER BY host, worker_id, updated_at DESC`,
        [PEER_FRESH_MS],
      ), OPS_DB_READ_TIMEOUT_MS, 'other processes');
    } catch (error) {
      this.logger.warn(`Process metrics of the other processes unavailable: ${(error as Error)?.message ?? error}`);
    }
    return newestPerSlot(rows.map((row) => row.summary), self);
  }
}

/** One summary per worker slot (host and worker id), `self` for its own slot. */
export function newestPerSlot(summaries: ProcessSummary[], self: ProcessSummary): ProcessSummary[] {
  const slot = (p: ProcessSummary) => `${p.host}:${p.workerId ?? '-'}`;
  const bySlot = new Map<string, ProcessSummary>();
  for (const p of summaries) {
    const current = bySlot.get(slot(p));
    if (!current || p.updatedAt > current.updatedAt) bySlot.set(slot(p), p);
  }
  bySlot.set(slot(self), self);
  return [...bySlot.values()].sort((a, b) => (a.workerId ?? 0) - (b.workerId ?? 0) || a.host.localeCompare(b.host));
}

export function aggregateProcesses(processes: ProcessSummary[]): OpsAggregate {
  const routes = new Map<string, number[]>();
  const waitCounts = emptyCounts();
  for (const p of processes) {
    for (const [key, counts] of Object.entries(p.routes ?? {})) {
      routes.set(key, addInto(routes.get(key) ?? emptyCounts(), counts));
    }
    addInto(waitCounts, p.pool?.waitCounts1m ?? []);
  }
  const topRoutes: RouteLatency[] = [...routes.entries()]
    .map(([key, counts]) => {
      const space = key.indexOf(' ');
      return {
        method: key.slice(0, space),
        route: key.slice(space + 1),
        count: totalOf(counts),
        p50: percentileOf(counts, 50),
        p95: percentileOf(counts, 95),
        p99: percentileOf(counts, 99),
        avg: 0,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
  const sum = (pick: (p: ProcessSummary) => number) => processes.reduce((total, p) => total + (Number(pick(p)) || 0), 0);
  const max = (pick: (p: ProcessSummary) => number) => processes.reduce((top, p) => Math.max(top, Number(pick(p)) || 0), 0);
  let fullest: { pct: number; label: string | null } = { pct: 0, label: null };
  for (const p of processes) {
    const pct = p.pool.maxPool > 0 ? (p.pool.inUseMax1m / p.pool.maxPool) * 100 : 0;
    if (pct > fullest.pct) fullest = { pct, label: p.label };
  }
  return {
    processes: processes.length,
    rssMB: Math.round(sum((p) => p.rssMB) * 10) / 10,
    eventLoop: { p95Ms: max((p) => p.eventLoop.p95Ms), maxMs: max((p) => p.eventLoop.maxMs) },
    pool: {
      maxPool: sum((p) => p.pool.maxPool),
      inUse: sum((p) => p.pool.inUse),
      inUseMax1mUpperBound: sum((p) => p.pool.inUseMax1m),
      inUsePctMax1m: Math.round(fullest.pct * 10) / 10,
      fullestProcess: fullest.label,
      waiting: sum((p) => p.pool.waiting),
      waitP95Ms1m: percentileOf(waitCounts, 95),
      failures5m: sum((p) => p.pool.failures5m),
    },
    requests: {
      count1m: sum((p) => p.requests.count1m),
      count5m: sum((p) => p.requests.count5m),
      errors5xx5m: sum((p) => p.requests.errors5xx5m),
    },
    topRoutes,
  };
}
