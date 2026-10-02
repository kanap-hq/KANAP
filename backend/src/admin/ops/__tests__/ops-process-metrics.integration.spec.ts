import 'dotenv/config';
import * as assert from 'node:assert/strict';
import dataSource from '../../../data-source';
import { DbMetricsService } from '../db-metrics.service';
import { OpsMetricsStore } from '../ops-metrics.store';
import { OpsSnapshotService } from '../ops-snapshot.service';

// Ops metrics with several API processes (lot 4D): each process publishes its summary to
// ops_process_metrics; the snapshot answered by any one of them lists all the live ones and adds
// them up; a process that stops removes its row. Two services in this process stand for two
// workers (this process plays worker 1 of 2).

process.env.KANAP_WORKER_ID = '1';
process.env.KANAP_WORKER_COUNT = '2';

function worker(key: string) {
  const store = new OpsMetricsStore();
  const db = new DbMetricsService(dataSource);
  const svc = new OpsSnapshotService(store, db, dataSource);
  (svc as any).processKey = key;
  (svc as any).logger = { warn: () => undefined, log: () => undefined };
  return { store, db, svc };
}

async function main() {
  process.exitCode = 1;
  await dataSource.initialize();
  const keys = [`spec-a-${process.pid}`, `spec-b-${process.pid}`];
  const a = worker(keys[0]);
  const b = worker(keys[1]);
  try {
    const now = Date.now();
    for (let i = 0; i < 30; i += 1) a.store.record({ ts: now, method: 'GET', route: '/spec/route', statusCode: 200, latencyMs: 20 });
    for (let i = 0; i < 10; i += 1) b.store.record({ ts: now, method: 'GET', route: '/spec/route', statusCode: i < 2 ? 500 : 200, latencyMs: 700 });
    await a.svc.publish();
    await b.svc.publish();

    const snapshot = await a.svc.build();
    const mine = (snapshot.processes ?? []).filter((p) => p.pid === process.pid);
    assert.equal(mine.length, 2, 'both workers are listed');
    assert.ok(snapshot.aggregate, 'an aggregate is given with several processes');
    const route = snapshot.aggregate!.topRoutes.find((r) => r.route === '/spec/route')!;
    assert.equal(route.count, 40, 'the route counts of both workers add up');
    assert.equal(route.p95, 1000, 'the p95 comes from the merged counts (the slow worker)');
    assert.ok(snapshot.aggregate!.requests.errors5xx5m >= 2, 'errors add up');
    assert.ok(['ok', 'warn', 'critical'].includes(snapshot.health.status));

    (b.svc as any).publishTimer = setInterval(() => undefined, 60_000);
    await b.svc.onModuleDestroy();
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
