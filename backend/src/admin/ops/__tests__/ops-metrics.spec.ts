import * as assert from 'node:assert/strict';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { emptyCounts, bucketIndex, LATENCY_BUCKETS_MS, percentileOf } from '../latency-histogram';
import { evaluateOpsHealth, OPS_THRESHOLDS, OpsHealthInput } from '../ops-health';
import { OpsMetricsStore } from '../ops-metrics.store';
import { OpsMetricsTokenGuard } from '../ops-metrics.controller';
import { aggregateProcesses, newestPerSlot, ProcessSummary } from '../ops-snapshot.service';
import { opsMetricsTokenWarning } from '../ops-metrics-token';
import { PoolMetrics } from '../pool-metrics';

// Supervision (plan planning/perf-scale lot 4D): p95 per route, event loop lag over a window,
// pool in use and the wait for a connection, alert thresholds, the view over several API
// processes, and the monitoring token of GET /ops/metrics.

function testHistogram() {
  const counts = emptyCounts();
  for (let i = 0; i < 90; i += 1) counts[bucketIndex(8)] += 1; // 90 requests at 8 ms (bucket 10)
  for (let i = 0; i < 10; i += 1) counts[bucketIndex(700)] += 1; // 10 at 700 ms (bucket 1000)
  assert.equal(percentileOf(counts, 50), 10);
  assert.equal(percentileOf(counts, 90), 10);
  assert.equal(percentileOf(counts, 95), 1000, 'the p95 falls in the slow requests');
  assert.equal(percentileOf(emptyCounts(), 95), 0);
  assert.equal(bucketIndex(120_000), emptyCounts().length - 1, 'past 60 s: the overflow bucket');
}

async function testPoolWaitAndUse() {
  let now = 1_000_000;
  const metrics = new PoolMetrics(10, () => now);
  const pool: any = {
    totalCount: 4,
    idleCount: 1,
    waitingCount: 2,
    connect(callback?: (err: Error | undefined, client: unknown, done: unknown) => void) {
      if (callback) { setTimeout(() => callback(undefined, { id: 1 }, () => undefined), 30); return undefined; }
      return new Promise((resolve) => setTimeout(() => resolve({ id: 2 }), 5));
    },
  };
  assert.equal(metrics.attach(pool), true);
  // TypeORM's style (callback) and the promise style are both timed.
  await new Promise<void>((resolve) => pool.connect((_err: unknown, client: any) => { assert.equal(client.id, 1); resolve(); }));
  const client = await pool.connect();
  assert.equal(client.id, 2);
  const failing: any = { totalCount: 0, idleCount: 0, waitingCount: 0, connect: (cb: any) => cb(new Error('timeout exceeded when trying to connect')) };
  metrics.attach(failing);
  failing.connect(() => undefined);
  metrics.attach(pool);
  metrics.sample();
  now += 1_000;
  pool.idleCount = 0;
  metrics.sample();
  metrics.detach();

  const snap = metrics.snapshot();
  assert.equal(snap.maxPool, 10);
  assert.equal(snap.inUse, 4);
  assert.equal(snap.inUseMax1m, 4);
  assert.equal(snap.inUseAvg1m, 3.5, 'in use averaged over the samples (3 then 4)');
  assert.equal(snap.waitingMax1m, 2);
  assert.equal(snap.utilizationPct, 40);
  assert.equal(snap.wait.count1m, 3, 'every connection asked for is timed, failures included');
  assert.equal(snap.wait.failures5m, 1, 'a connection the pool could not give is counted');
  assert.ok(snap.wait.p95Ms1m >= 25 && snap.wait.p95Ms1m <= 50, `the 30 ms wait sets the p95 (${snap.wait.p95Ms1m})`);

  now += 6 * 60_000;
  const later = metrics.snapshot();
  assert.equal(later.wait.count1m, 0, 'a minute later the waits are out of the 1 min window');
  assert.equal(later.wait.failures5m, 0, 'and out of the 5 min window after five');
}

async function testEventLoopWindow() {
  const store = new OpsMetricsStore();
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const blockUntil = Date.now() + 250;
    while (Date.now() < blockUntil) { /* the main thread is busy */ }
    await new Promise((resolve) => setTimeout(resolve, 60));
    store.rotateLoopWindow();
    const first = store.snapshot().process;
    assert.ok(first.eventLoopLagMs.max >= 200, `a 250 ms block shows in the window (${first.eventLoopLagMs.max} ms)`);
    assert.ok(first.eventLoopLagMs.p50 < 50, 'the timer resolution is not counted as lag');
    assert.equal(typeof first.eventLoopLagMs.p95, 'number');
    await new Promise((resolve) => setTimeout(resolve, 100));
    store.rotateLoopWindow();
    const second = store.snapshot().process;
    assert.ok(second.eventLoopLagMs.max < 100, 'the next minute starts clean (the histogram is reset)');
    assert.ok(second.eventLoopLag5m.max >= 200, 'the worst minute of the last five keeps the block');
  } finally {
    store.onModuleDestroy();
  }
}

function testRouteHistograms() {
  const store = new OpsMetricsStore();
  try {
    const now = Date.now();
    for (let i = 0; i < 20; i += 1) store.record({ ts: now, method: 'GET', route: '/spend-items/summary', statusCode: 200, latencyMs: i < 18 ? 40 : 900 });
    store.record({ ts: now, method: 'PATCH', route: '/spend-items/:id', statusCode: 200, latencyMs: 12 });
    const routes = store.routeHistograms();
    assert.equal(Object.keys(routes).length, 2);
    assert.equal(percentileOf(routes['GET /spend-items/summary'], 95), 1000);
    const top = store.snapshot().topRoutes.find((r) => r.route === '/spend-items/summary')!;
    assert.equal(top.p95, 900, 'the exact p95 of this process is kept');
  } finally {
    store.onModuleDestroy();
  }
}

const quiet: OpsHealthInput = {
  eventLoopP95Ms: 3, poolWaitP95Ms: 1, poolInUsePct: 10, poolFailures5m: 0,
  requests5m: 500, errors5xx5m: 0, routes: [{ method: 'GET', route: '/spend-items/summary', count: 300, p95: 120 }],
  processes: [{ label: 'api', rssMB: 300 }],
};

function testHealth() {
  assert.deepEqual(evaluateOpsHealth(quiet), { status: 'ok', alerts: [] });
  const busy = evaluateOpsHealth({ ...quiet, eventLoopP95Ms: 150, poolInUsePct: 95 });
  assert.equal(busy.status, 'warn');
  assert.deepEqual(busy.alerts.map((a) => a.metric).sort(), ['event_loop_p95_ms', 'pool_in_use_pct']);
  const down = evaluateOpsHealth({ ...quiet, poolFailures5m: 3, errors5xx5m: 40 });
  assert.equal(down.status, 'critical');
  assert.deepEqual(down.alerts.map((a) => [a.metric, a.level]).sort(), [['error_5xx_pct', 'critical'], ['pool_failures_5m', 'critical']]);
  const slow = evaluateOpsHealth({
    ...quiet,
    routes: [
      { method: 'GET', route: '/spend-items/summary', count: 50, p95: 1500 },
      { method: 'GET', route: '/spend-items/summary/ids', count: 5, p95: 9000 },
      { method: 'POST', route: '/spend-items/import', count: 40, p95: 20000 },
    ],
  });
  assert.deepEqual(slow.alerts.map((a) => a.metric), ['route_p95_ms:GET /spend-items/summary'],
    'a route with too few requests and an import are not alerted on');
  assert.equal(evaluateOpsHealth({ ...quiet, requests5m: 10, errors5xx5m: 5 }).status, 'ok', '5xx share needs 20 requests');
  assert.equal(evaluateOpsHealth({ ...quiet, processes: [{ label: 'worker 2/2', rssMB: 1300 }] }).alerts[0].metric, 'rss_mb:worker 2/2');
  assert.equal(evaluateOpsHealth({ ...quiet, poolInUsePct: 90 }).status, 'ok', '90 % is the threshold, not above it');
  assert.equal(evaluateOpsHealth({ ...quiet, poolFailures5m: 1 }).status, 'critical', 'one failed connection is critical');
}

/**
 * Latencies of several processes are read from buckets as the bucket's upper bound: a threshold
 * is a bucket bound and an alert needs the value above it. The four cases on the pool wait p95
 * (warn 50 ms, critical 1 s) through the merged counts, then the route p95 (critical 3 s).
 */
function testThresholdsOnBucketBounds() {
  const waitP95 = (ms: number) => {
    const counts = emptyCounts();
    counts[bucketIndex(ms)] = 100;
    return percentileOf(counts, 95);
  };
  const level = (input: Partial<OpsHealthInput>, metric: string) => evaluateOpsHealth({ ...quiet, ...input }).alerts.find((a) => a.metric.startsWith(metric))?.level ?? 'none';
  assert.equal(waitP95(30), 50, 'a 30 ms wait reads as its bucket bound, 50');
  assert.equal(level({ poolWaitP95Ms: waitP95(30) }, 'pool_wait'), 'none', '30 ms: under the warning, no alert (it fired before)');
  assert.equal(level({ poolWaitP95Ms: waitP95(50) }, 'pool_wait'), 'none', '50 ms: at the warning, no alert');
  assert.equal(level({ poolWaitP95Ms: waitP95(60) }, 'pool_wait'), 'warn', '60 ms: above the warning');
  assert.equal(level({ poolWaitP95Ms: waitP95(1200) }, 'pool_wait'), 'critical', '1.2 s: above the critical threshold');
  const route = (ms: number) => [{ method: 'GET', route: '/x', count: 50, p95: waitP95(ms) }];
  assert.equal(level({ routes: route(2800) }, 'route_p95'), 'warn', '2.8 s: warning, not critical');
  assert.equal(level({ routes: route(3100) }, 'route_p95'), 'critical', '3.1 s: critical');
  for (const bound of [OPS_THRESHOLDS.poolWaitP95Ms.warn, OPS_THRESHOLDS.poolWaitP95Ms.critical, OPS_THRESHOLDS.routeP95Ms.warn, OPS_THRESHOLDS.routeP95Ms.critical]) {
    assert.ok(LATENCY_BUCKETS_MS.includes(bound), `the threshold ${bound} ms is a bucket bound`);
  }
}

function summary(workerId: number, routeCounts: Record<string, number[]>, extra: Partial<ProcessSummary> = {}): ProcessSummary {
  const wait = emptyCounts();
  wait[bucketIndex(workerId === 2 ? 800 : 2)] += 10;
  return {
    label: `worker ${workerId}/2`, workerId, pid: 100 + workerId, host: 'h', startedAt: 0, updatedAt: 0,
    rssMB: 250, heapUsedMB: 100,
    eventLoop: { p95Ms: workerId * 10, maxMs: workerId * 100, p95Ms5m: 0, maxMs5m: 0 },
    pool: { maxPool: 20, inUse: workerId, inUseMax1m: workerId + 1, waiting: 0, waitP95Ms1m: 0, failures5m: workerId - 1, waitCounts1m: wait },
    requests: { count1m: 10, count5m: 100, errors5xx5m: workerId },
    routes: routeCounts,
    ...extra,
  };
}

function testAggregate() {
  const fast = emptyCounts(); fast[bucketIndex(40)] = 95;
  const slow = emptyCounts(); slow[bucketIndex(40)] = 5; slow[bucketIndex(2000)] = 10;
  const agg = aggregateProcesses([summary(1, { 'GET /x': fast }), summary(2, { 'GET /x': slow, 'GET /y': fast })]);
  assert.equal(agg.processes, 2);
  assert.equal(agg.rssMB, 500, 'memory adds up');
  assert.deepEqual(agg.eventLoop, { p95Ms: 20, maxMs: 200 }, 'the event loop is the worst process');
  assert.deepEqual([agg.pool.maxPool, agg.pool.inUse, agg.pool.failures5m], [40, 3, 1], 'the pools add up (in use: current values)');
  assert.equal(agg.pool.inUseMax1mUpperBound, 5, 'the sum of the highs is labelled an upper bound');
  assert.deepEqual([agg.pool.inUsePctMax1m, agg.pool.fullestProcess], [15, 'worker 2/2'], 'the fullest pool is named');

  // Two pools each 50 % full at different moments: no pool was nearly full, no alert.
  const halfA = summary(1, {}, { pool: { ...summary(1, {}).pool, maxPool: 10, inUseMax1m: 5 } });
  const halfB = summary(2, {}, { pool: { ...summary(2, {}).pool, maxPool: 10, inUseMax1m: 5 } });
  const halves = aggregateProcesses([halfA, halfB]);
  assert.equal(halves.pool.inUsePctMax1m, 50);
  const health = evaluateOpsHealth({ ...quiet, poolInUsePct: halves.pool.inUsePctMax1m });
  assert.equal(health.alerts.some((a) => a.metric === 'pool_in_use_pct'), false, 'no false 90 % warning from summed highs');
  assert.equal(agg.pool.waitP95Ms1m, 1000, 'the wait p95 comes from the merged counts');
  assert.deepEqual([agg.requests.count5m, agg.requests.errors5xx5m], [200, 3]);
  const x = agg.topRoutes.find((r) => r.route === '/x')!;
  assert.equal(x.count, 110, 'a route served by both processes is counted once, merged');
  assert.equal(x.p95, 2500, 'its p95 is the merged one (10 slow requests out of 110)');
  assert.equal(agg.topRoutes[0].route, '/x', 'busiest first');
}

/** A worker forked again after a crash publishes under a new key: the newest row of its slot only. */
function testNewestRowPerSlot() {
  const self = summary(1, {}, { updatedAt: 1_000, pid: 501 });
  const oldWorker2 = summary(2, {}, { updatedAt: 500, pid: 402 });
  const newWorker2 = summary(2, {}, { updatedAt: 900, pid: 602 });
  const oldSelfRow = summary(1, {}, { updatedAt: 950, pid: 401 });
  const otherHost = summary(2, {}, { updatedAt: 800, pid: 702, host: 'h2' });
  const list = newestPerSlot([oldWorker2, newWorker2, oldSelfRow, otherHost], self);
  assert.deepEqual(list.map((p) => [p.host, p.workerId, p.pid]), [['h', 1, 501], ['h', 2, 602], ['h2', 2, 702]]);
}

function testMonitoringToken() {
  const guard = new OpsMetricsTokenGuard();
  const context = (authorization?: string) => ({
    switchToHttp: () => ({ getRequest: () => ({ headers: authorization ? { authorization } : {} }) }),
  }) as any;
  const saved = process.env.OPS_METRICS_TOKEN;
  try {
    delete process.env.OPS_METRICS_TOKEN;
    assert.throws(() => guard.canActivate(context('Bearer anything')), NotFoundException, 'no token configured: the route does not exist');
    process.env.OPS_METRICS_TOKEN = 'short';
    assert.throws(() => guard.canActivate(context('Bearer short')), NotFoundException, 'a token under 24 characters is not accepted as configured');
    process.env.OPS_METRICS_TOKEN = 'a'.repeat(40);
    assert.throws(() => guard.canActivate(context()), UnauthorizedException);
    assert.throws(() => guard.canActivate(context(`Bearer ${'a'.repeat(39)}b`)), UnauthorizedException);
    assert.equal(guard.canActivate(context(`Bearer ${'a'.repeat(40)}`)), true);
    assert.equal(opsMetricsTokenWarning({ OPS_METRICS_TOKEN: 'a'.repeat(40) } as NodeJS.ProcessEnv), null);
    assert.equal(opsMetricsTokenWarning({} as NodeJS.ProcessEnv), null, 'not set: nothing to say');
    assert.match(opsMetricsTokenWarning({ OPS_METRICS_TOKEN: 'short' } as NodeJS.ProcessEnv) ?? '', /5 characters, under 24: GET \/ops\/metrics stays disabled/);
  } finally {
    if (saved === undefined) delete process.env.OPS_METRICS_TOKEN; else process.env.OPS_METRICS_TOKEN = saved;
  }
}

async function run() {
  testHistogram();
  await testPoolWaitAndUse();
  await testEventLoopWindow();
  testRouteHistograms();
  testHealth();
  testThresholdsOnBucketBounds();
  testAggregate();
  testNewestRowPerSlot();
  testMonitoringToken();
  console.log('ops-metrics.spec: ok');
}

run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
