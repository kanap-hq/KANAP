import * as assert from 'node:assert/strict';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { emptyCounts, bucketIndex, percentileOf } from '../latency-histogram';
import { evaluateOpsHealth, OpsHealthInput } from '../ops-health';
import { OpsMetricsStore } from '../ops-metrics.store';
import { OpsMetricsTokenGuard } from '../ops-metrics.controller';
import { aggregateProcesses, ProcessSummary } from '../ops-snapshot.service';
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
  eventLoopP95Ms: 3, poolWaitP95Ms: 1, poolInUseMax1m: 2, poolMax: 20, poolFailures5m: 0,
  requests5m: 500, errors5xx5m: 0, routes: [{ method: 'GET', route: '/spend-items/summary', count: 300, p95: 120 }],
  processes: [{ label: 'api', rssMB: 300 }],
};

function testHealth() {
  assert.deepEqual(evaluateOpsHealth(quiet), { status: 'ok', alerts: [] });
  const busy = evaluateOpsHealth({ ...quiet, eventLoopP95Ms: 150, poolInUseMax1m: 19 });
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
  assert.deepEqual([agg.pool.maxPool, agg.pool.inUse, agg.pool.inUseMax1m, agg.pool.failures5m], [40, 3, 5, 1], 'the pools add up');
  assert.equal(agg.pool.waitP95Ms1m, 1000, 'the wait p95 comes from the merged counts');
  assert.deepEqual([agg.requests.count5m, agg.requests.errors5xx5m], [200, 3]);
  const x = agg.topRoutes.find((r) => r.route === '/x')!;
  assert.equal(x.count, 110, 'a route served by both processes is counted once, merged');
  assert.equal(x.p95, 2500, 'its p95 is the merged one (10 slow requests out of 110)');
  assert.equal(agg.topRoutes[0].route, '/x', 'busiest first');
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
  testAggregate();
  testMonitoringToken();
  console.log('ops-metrics.spec: ok');
}

run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
