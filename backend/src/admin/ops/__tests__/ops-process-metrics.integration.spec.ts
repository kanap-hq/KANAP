import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { hostname } from 'node:os';
import dataSource from '../../../data-source';
import { DbMetricsService } from '../db-metrics.service';
import { OpsMetricsStore } from '../ops-metrics.store';
import { OpsSnapshotService } from '../ops-snapshot.service';

// Ops metrics with several API processes (lot 4D): each process publishes its summary to
// ops_process_metrics; the snapshot answered by any one of them lists all the live ones (the
// newest row per worker slot: a worker forked again after a crash leaves an older row behind)
// and adds them up; a process that stops removes its row. Two services in this process stand for
// workers 1 and 2.

process.env.KANAP_WORKER_ID = '1';
process.env.KANAP_WORKER_COUNT = '2';

function worker(key: string, id: number) {
  const store = new OpsMetricsStore();
  const db = new DbMetricsService(dataSource);
  const svc = new OpsSnapshotService(store, db, dataSource);
  (svc as any).processKey = key;
  (svc as any).logger = { warn: () => undefined, log: () => undefined };
  const summary = svc.summary.bind(svc);
  svc.summary = (snapshot?: any) => ({ ...summary(snapshot), workerId: id, label: `worker ${id}/2` });
  return { store, db, svc };
}

async function main() {
  process.exitCode = 1;
  await dataSource.initialize();
  const keys = [`spec-a-${process.pid}`, `spec-b-${process.pid}`, `spec-old-${process.pid}`];
  const a = worker(keys[0], 1);
  const b = worker(keys[1], 2);
  try {
    // The row a crashed worker 2 left 20 s ago, still fresh enough to be read.
    await dataSource.query(
      `INSERT INTO ops_process_metrics (process_key, worker_id, pid, host, started_at, updated_at, summary)
       VALUES ($1, 2, 999999, $2, now() - interval '1 hour', now() - interval '20 seconds', $3::jsonb)`,
      [keys[2], hostname(), JSON.stringify({ ...b.svc.summary(), pid: 999999, rssMB: 5000 })],
    );
    const now = Date.now();
    for (let i = 0; i < 30; i += 1) a.store.record({ ts: now, method: 'GET', route: '/spec/route', statusCode: 200, latencyMs: 20 });
    for (let i = 0; i < 10; i += 1) b.store.record({ ts: now, method: 'GET', route: '/spec/route', statusCode: i < 2 ? 500 : 200, latencyMs: 700 });
    await a.svc.publish();
    await b.svc.publish();

    const snapshot = await a.svc.build();
    const mine = (snapshot.processes ?? []).filter((p) => p.pid === process.pid);
    assert.equal(mine.length, 2, 'both workers are listed');
    assert.equal((snapshot.processes ?? []).some((p) => p.pid === 999999), false, 'the older row of slot 2 is left out');
    assert.ok(snapshot.aggregate, 'an aggregate is given with several processes');
    const route = snapshot.aggregate!.topRoutes.find((r) => r.route === '/spec/route')!;
    assert.equal(route.count, 40, 'the route counts of both workers add up');
    assert.equal(route.p95, 1000, 'the p95 comes from the merged counts (the slow worker)');
    assert.ok(snapshot.aggregate!.requests.errors5xx5m >= 2, 'errors add up');
    assert.ok(['ok', 'warn', 'critical'].includes(snapshot.health.status));

    // A publish still in flight when the worker stops must not write the row back.
    (b.svc as any).publishTimer = setInterval(() => undefined, 60_000);
    const inFlight = b.svc.publish();
    await b.svc.onModuleDestroy();
    await inFlight;
    await b.svc.publish();
    const [{ n }] = await dataSource.query(`SELECT count(*)::int AS n FROM ops_process_metrics WHERE process_key = $1`, [keys[1]]);
    assert.equal(n, 0, 'a worker that stops removes its row');
    const after = await a.svc.build();
    assert.equal((after.processes ?? []).filter((p) => p.pid === process.pid).length, 1);
    console.log('ops-process-metrics.integration.spec: ok');
    process.exitCode = 0;
  } finally {
    await dataSource.query(`DELETE FROM ops_process_metrics WHERE process_key = ANY($1)`, [keys]);
    for (const w of [a, b]) { w.store.onModuleDestroy(); w.db.onModuleDestroy(); }
    await dataSource.destroy();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
