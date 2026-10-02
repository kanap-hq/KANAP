import { Injectable } from '@nestjs/common';
import { monitorEventLoopDelay } from 'perf_hooks';
import { bucketIndex, emptyCounts } from './latency-histogram';

export interface RequestEntry {
  ts: number;
  method: string;
  route: string;
  statusCode: number;
  latencyMs: number;
  errorType?: string;
  errorMessage?: string;
}

export interface WindowStats {
  totalRequests: number;
  statusClasses: { '2xx': number; '3xx': number; '4xx': number; '5xx': number };
  exact429: number;
  exact401: number;
  exact403: number;
  requestsPerMinute: number;
}

export interface AuthStats {
  loginAttempts: number;
  loginFailures: number;
  refreshAttempts: number;
  refreshFailures: number;
}

export interface RouteLatency {
  route: string;
  method: string;
  count: number;
  p50: number;
  p95: number;
  p99: number;
  avg: number;
}

export interface ErrorEntry {
  errorType: string;
  errorMessage: string;
  lastSeen: number;
  count: number;
  route: string;
}

export interface ProcessMetrics {
  uptimeSeconds: number;
  memoryMB: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  /**
   * Event loop lag over the last full minute (the current minute until one has passed): how late
   * a timer fires beyond its 10 ms resolution, i.e. how long the main thread was busy while
   * something waited. Every request of the process waits behind it.
   */
  eventLoopLagMs: {
    min: number;
    max: number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
    windowSeconds: number;
  };
  /** Worst minute of the last five. */
  eventLoopLag5m: {
    p95: number;
    max: number;
  };
  cpuUsage: {
    userMs: number;
    systemMs: number;
  };
}

type LoopWindow = { endedAt: number; seconds: number; min: number; max: number; mean: number; p50: number; p95: number; p99: number };

const MAX_AGE_MS = 15 * 60_000; // 15 minutes
const PRUNE_INTERVAL_MS = 60_000; // prune every 60 seconds
const MAX_ROUTE_GROUPS = 30;
const MAX_ERROR_ENTRIES = 15;
/** Event loop sampling: a timer every 10 ms; its histogram is summed up and reset every minute. */
const LOOP_RESOLUTION_MS = 10;
const LOOP_WINDOW_MS = 60_000;
const LOOP_WINDOWS_KEPT = 15;

@Injectable()
export class OpsMetricsStore {
  private entries: RequestEntry[] = [];
  private pruneTimer: ReturnType<typeof setInterval>;
  private loopTimer: ReturnType<typeof setInterval>;
  private eld: ReturnType<typeof monitorEventLoopDelay>;
  private eldSince = Date.now();
  private loopWindows: LoopWindow[] = [];
  private startCpu = process.cpuUsage();

  constructor() {
    this.pruneTimer = setInterval(() => this.prune(), PRUNE_INTERVAL_MS);
    this.pruneTimer.unref?.();
    this.eld = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
    this.eld.enable();
    this.loopTimer = setInterval(() => this.rotateLoopWindow(), LOOP_WINDOW_MS);
    this.loopTimer.unref?.();
  }

  /** Closes the current event loop minute: keeps its summary, starts a new histogram. */
  rotateLoopWindow(now = Date.now()): void {
    this.loopWindows.push(this.summarizeLoop(now));
    if (this.loopWindows.length > LOOP_WINDOWS_KEPT) this.loopWindows.shift();
    this.eld.reset();
    this.eldSince = now;
  }

  private summarizeLoop(now: number): LoopWindow {
    // The histogram holds each timer's full interval: the lag is what exceeds the resolution.
    const lag = (ns: number) => {
      if (!Number.isFinite(ns) || ns <= 0) return 0;
      return Math.max(0, Math.round((ns / 1e6 - LOOP_RESOLUTION_MS) * 100) / 100);
    };
    const empty = this.eld.count === 0;
    return {
      endedAt: now,
      seconds: Math.round((now - this.eldSince) / 1000),
      min: empty ? 0 : lag(this.eld.min),
      max: empty ? 0 : lag(this.eld.max),
      mean: empty ? 0 : lag(this.eld.mean),
      p50: empty ? 0 : lag(this.eld.percentile(50)),
      p95: empty ? 0 : lag(this.eld.percentile(95)),
      p99: empty ? 0 : lag(this.eld.percentile(99)),
    };
  }

  /** Requests of the window, grouped by route, as latency bucket counts (for the cross-process view). */
  routeHistograms(windowMs = 5 * 60_000): Record<string, number[]> {
    const now = Date.now();
    const result: Record<string, { count: number; counts: number[] }> = {};
    for (const e of this.entries) {
      if (now - e.ts > windowMs) continue;
      const key = `${e.method} ${e.route}`;
      const group = result[key] ?? (result[key] = { count: 0, counts: emptyCounts() });
      group.count += 1;
      group.counts[bucketIndex(e.latencyMs)] += 1;
    }
    const top = Object.entries(result).sort((a, b) => b[1].count - a[1].count).slice(0, MAX_ROUTE_GROUPS);
    return Object.fromEntries(top.map(([key, group]) => [key, group.counts]));
  }

  record(entry: RequestEntry): void {
    this.entries.push(entry);
  }

  snapshot() {
    const now = Date.now();
    this.prune();

    const entries1m = this.entries.filter((e) => now - e.ts <= 60_000);
    const entries5m = this.entries.filter((e) => now - e.ts <= 5 * 60_000);
    const entries15m = this.entries;

    return {
      windows: {
        '1m': this.computeWindowStats(entries1m, 1),
        '5m': this.computeWindowStats(entries5m, 5),
        '15m': this.computeWindowStats(entries15m, 15),
      },
      auth: this.computeAuthStats(entries5m),
      topRoutes: this.computeRouteLatencies(entries5m),
      recentErrors: this.computeRecentErrors(entries15m),
      process: this.computeProcessMetrics(),
      collectedSince: this.entries.length > 0 ? this.entries[0].ts : now,
      totalEntriesInMemory: this.entries.length,
    };
  }

  private prune(): void {
    const cutoff = Date.now() - MAX_AGE_MS;
    // Binary-ish search: entries are chronologically ordered
    let i = 0;
    while (i < this.entries.length && this.entries[i].ts < cutoff) i++;
    if (i > 0) this.entries.splice(0, i);
  }

  private computeWindowStats(entries: RequestEntry[], windowMinutes: number): WindowStats {
    const statusClasses = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
    let exact429 = 0;
    let exact401 = 0;
    let exact403 = 0;

    for (const e of entries) {
      const cls = Math.floor(e.statusCode / 100);
      if (cls === 2) statusClasses['2xx']++;
      else if (cls === 3) statusClasses['3xx']++;
      else if (cls === 4) statusClasses['4xx']++;
      else if (cls === 5) statusClasses['5xx']++;

      if (e.statusCode === 429) exact429++;
      if (e.statusCode === 401) exact401++;
      if (e.statusCode === 403) exact403++;
    }

    return {
      totalRequests: entries.length,
      statusClasses,
      exact429,
      exact401,
      exact403,
      requestsPerMinute: windowMinutes > 0 ? Math.round((entries.length / windowMinutes) * 10) / 10 : 0,
    };
  }

  private computeAuthStats(entries: RequestEntry[]): AuthStats {
    let loginAttempts = 0;
    let loginFailures = 0;
    let refreshAttempts = 0;
    let refreshFailures = 0;

    for (const e of entries) {
      if (e.route === '/auth/login' && e.method === 'POST') {
        loginAttempts++;
        if (e.statusCode >= 400) loginFailures++;
      }
      if (e.route === '/auth/refresh' && e.method === 'POST') {
        refreshAttempts++;
        if (e.statusCode >= 400) refreshFailures++;
      }
    }

    return { loginAttempts, loginFailures, refreshAttempts, refreshFailures };
  }

  private computeRouteLatencies(entries: RequestEntry[]): RouteLatency[] {
    const grouped = new Map<string, { method: string; latencies: number[] }>();

    for (const e of entries) {
      const key = `${e.method} ${e.route}`;
      let group = grouped.get(key);
      if (!group) {
        group = { method: e.method, latencies: [] };
        grouped.set(key, group);
      }
      group.latencies.push(e.latencyMs);
    }

    const results: RouteLatency[] = [];
    for (const [key, group] of grouped) {
      const route = key.slice(group.method.length + 1);
      const sorted = group.latencies.sort((a, b) => a - b);
      const len = sorted.length;
      results.push({
        route,
        method: group.method,
        count: len,
        p50: sorted[Math.floor(len * 0.5)] ?? 0,
        p95: sorted[Math.floor(len * 0.95)] ?? 0,
        p99: sorted[Math.floor(len * 0.99)] ?? 0,
        avg: Math.round((sorted.reduce((a, b) => a + b, 0) / len) * 10) / 10,
      });
    }

    // Sort by count descending, return top N
    results.sort((a, b) => b.count - a.count);
    return results.slice(0, MAX_ROUTE_GROUPS);
  }

  private computeRecentErrors(entries: RequestEntry[]): ErrorEntry[] {
    const errorMap = new Map<string, ErrorEntry>();

    for (const e of entries) {
      if (!e.errorType) continue;
      const key = `${e.errorType}:${e.errorMessage ?? ''}`;
      const existing = errorMap.get(key);
      if (existing) {
        existing.count++;
        if (e.ts > existing.lastSeen) {
          existing.lastSeen = e.ts;
          existing.route = `${e.method} ${e.route}`;
        }
      } else {
        errorMap.set(key, {
          errorType: e.errorType,
          errorMessage: (e.errorMessage ?? '').slice(0, 200),
          lastSeen: e.ts,
          count: 1,
          route: `${e.method} ${e.route}`,
        });
      }
    }

    const results = [...errorMap.values()];
    results.sort((a, b) => b.count - a.count);
    return results.slice(0, MAX_ERROR_ENTRIES);
  }

  private computeProcessMetrics(): ProcessMetrics {
    const mem = process.memoryUsage();
    const toMB = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

    const cpu = process.cpuUsage(this.startCpu);

    const now = Date.now();
    const lastWindow = this.loopWindows[this.loopWindows.length - 1];
    const loop = lastWindow ?? this.summarizeLoop(now);
    const recent = this.loopWindows.filter((w) => now - w.endedAt <= 5 * LOOP_WINDOW_MS);
    const current = this.summarizeLoop(now);
    const fiveMinutes = [...recent, current];

    return {
      uptimeSeconds: Math.round(process.uptime()),
      memoryMB: {
        rss: toMB(mem.rss),
        heapUsed: toMB(mem.heapUsed),
        heapTotal: toMB(mem.heapTotal),
        external: toMB(mem.external),
      },
      eventLoopLagMs: {
        min: loop.min,
        max: loop.max,
        mean: loop.mean,
        p50: loop.p50,
        p95: loop.p95,
        p99: loop.p99,
        windowSeconds: loop.seconds,
      },
      eventLoopLag5m: {
        p95: Math.max(...fiveMinutes.map((w) => w.p95)),
        max: Math.max(...fiveMinutes.map((w) => w.max)),
      },
      cpuUsage: {
        userMs: Math.round(cpu.user / 1000),
        systemMs: Math.round(cpu.system / 1000),
      },
    };
  }

  onModuleDestroy() {
    clearInterval(this.pruneTimer);
    clearInterval(this.loopTimer);
    this.eld.disable();
  }
}
