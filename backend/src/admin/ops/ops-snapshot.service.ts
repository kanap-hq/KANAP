import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { hostname } from 'node:os';
import { DataSource } from 'typeorm';
import { apiProcessCount, clusterWorkerId, processLabel } from '../../common/cluster/process-role';
import { DbMetricsService } from './db-metrics.service';
import { addInto, emptyCounts, percentileOf, totalOf } from './latency-histogram';
import { evaluateOpsHealth, OpsHealth } from './ops-health';
import { OpsMetricsStore, RouteLatency } from './ops-metrics.store';
import type { OpsSnapshotDto } from './dto/ops-snapshot.dto';

/**
 * The ops snapshot (`GET /admin/ops/snapshot` for platform admins, `GET /ops/metrics` with the
 * monitoring token): request rates and errors, p95 per route, event loop lag, pool use and wait,
 * database activity, and `health` against the documented thresholds (ops-health.ts).
 *
 * With several API processes (API_WORKERS > 1) a request reaches one of them. Each process
 * publishes a summary of itself every 15 s (UNLOGGED table `ops_process_metrics`); the snapshot
 * lists them in `processes` and adds them up in `aggregate`: sums for requests, memory and the
 * pool, the worst process for the event loop, merged latency counts for the p95s. With one
 * process nothing is published and both fields are absent.
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
  pool: { maxPool: number; inUse: number; inUseMax1m: number; waiting: number; waitP95Ms1m: number; failures5m: number };
  requests: { count1m: number; count5m: number; errors5xx5m: number };
  topRoutes: RouteLatency[];
};

const PUBLISH_EVERY_MS = 15_000;
/** A process that has not published for this long is gone (or stuck): left out. */
const PEER_FRESH_MS = 45_000;

@Injectable()
export class OpsSnapshotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('OpsMetrics');
  private readonly processKey = `${hostname()}:${process.pid}`;
  private publishTimer: NodeJS.Timeout | null = null;
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

  /** On a stop, the row goes with the process; after a crash it ages out (PEER_FRESH_MS). */
  async onModuleDestroy() {
    if (!this.publishTimer) return;
    clearInterval(this.publishTimer);
    this.publishTimer = null;
    await this.dataSource
      .query(`DELETE FROM ops_process_metrics WHERE process_key = $1`, [this.processKey])
      .catch(() => undefined);
  }

  async build(): Promise<OpsSnapshotDto> {
    const requestSnapshot = this.store.snapshot();
    const dbSnapshot = await this.dbMetrics.snapshot();
    const label = processLabel();
    let processes: ProcessSummary[] | undefined;
    let aggregate: OpsAggregate | undefined;
    if (apiProcessCount() > 1) {
      processes = await this.peers(this.summary(requestSnapshot));
      aggregate = aggregateProcesses(processes);
    }

    const health: OpsHealth = aggregate
      ? evaluateOpsHealth({
        eventLoopP95Ms: aggregate.eventLoop.p95Ms,
        poolWaitP95Ms: aggregate.pool.waitP95Ms1m,
        poolInUseMax1m: aggregate.pool.inUseMax1m,
        poolMax: aggregate.pool.maxPool,
        poolFailures5m: aggregate.pool.failures5m,
        requests5m: aggregate.requests.count5m,
        errors5xx5m: aggregate.requests.errors5xx5m,
        routes: aggregate.topRoutes,
        processes: (processes ?? []).map((p) => ({ label: p.label, rssMB: p.rssMB })),
      })
      : evaluateOpsHealth({
        eventLoopP95Ms: requestSnapshot.process.eventLoopLagMs.p95,
        poolWaitP95Ms: dbSnapshot.pool.wait.p95Ms1m,
        poolInUseMax1m: dbSnapshot.pool.inUseMax1m,
        poolMax: dbSnapshot.pool.maxPool,
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

  /** The live processes: this one fresh, the others as they last published. */
  private async peers(self: ProcessSummary): Promise<ProcessSummary[]> {
    let rows: Array<{ process_key: string; summary: ProcessSummary }> = [];
    try {
      rows = await this.dataSource.query(
        `SELECT process_key, summary FROM ops_process_metrics
          WHERE updated_at > now() - make_interval(secs => $1::double precision / 1000)
          ORDER BY worker_id NULLS FIRST, process_key`,
        [PEER_FRESH_MS],
      );
    } catch (error) {
      this.logger.warn(`Process metrics of the other processes unavailable: ${(error as Error)?.message ?? error}`);
    }
    const others = rows.filter((row) => row.process_key !== this.processKey).map((row) => row.summary);
    return [...others, self].sort((a, b) => (a.workerId ?? 0) - (b.workerId ?? 0));
  }
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
  return {
    processes: processes.length,
    rssMB: Math.round(sum((p) => p.rssMB) * 10) / 10,
    eventLoop: { p95Ms: max((p) => p.eventLoop.p95Ms), maxMs: max((p) => p.eventLoop.maxMs) },
    pool: {
      maxPool: sum((p) => p.pool.maxPool),
      inUse: sum((p) => p.pool.inUse),
      inUseMax1m: sum((p) => p.pool.inUseMax1m),
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
