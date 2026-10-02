import * as assert from 'node:assert/strict';
import { DbMetricsService } from '../db-metrics.service';
import { OpsMetricsStore } from '../ops-metrics.store';
import { OpsMetricsController } from '../ops-metrics.controller';
import { OpsSnapshotService } from '../ops-snapshot.service';
import { poolSaturated } from '../pool-metrics';

/**
 * The ops metrics answer when the pool is saturated (they matter most then): the figures held in
 * memory are always served, the pg_stat views and the other processes' rows are given 1 s and
 * then left, flagged. The token route leaves the error messages out.
 */

const stuckDataSource = (waitingCount: number) => ({
  // DB_POOL_MAX unset: a pool of 20, all of them open.
  driver: { master: { totalCount: 20, idleCount: 0, waitingCount, connect: () => undefined } },
  query: () => new Promise(() => undefined),
});

async function testSnapshotAnswersWithoutTheDatabase(waitingCount: number) {
  const saved = { ...process.env };
  process.env.KANAP_WORKER_ID = '1';
  process.env.KANAP_WORKER_COUNT = '2';
  const ds = stuckDataSource(waitingCount) as any;
  const store = new OpsMetricsStore();
  const db = new DbMetricsService(ds);
  db.onModuleInit();
  const svc = new OpsSnapshotService(store, db, ds);
  (svc as any).logger = { warn: () => undefined, log: () => undefined };
  try {
    store.record({ ts: Date.now(), method: 'GET', route: '/spend-items/summary', statusCode: 503, latencyMs: 10_000, errorType: 'QueryFailedError', errorMessage: 'timeout exceeded when trying to connect' });
    const started = Date.now();
    const snapshot = await svc.build();
    const took = Date.now() - started;
    assert.equal(snapshot.db.statsStale, true, 'the pg_stat part is flagged');
    if (waitingCount > 0) {
      assert.ok(took < 500, `requests wait for the pool: nothing read, answered at once (${took} ms)`);
      assert.match(snapshot.db.statsError ?? '', /pool busy \(7 waiting\): not read/);
    } else {
      assert.ok(took >= 900 && took < 2_500, `database stuck: answered after the 1 s limit (${took} ms)`);
      assert.match(snapshot.db.statsError ?? '', /no answer within 1000 ms/);
    }
    assert.equal(snapshot.db.pool.inUse, 20, 'the pool figures are served');
    assert.equal(snapshot.db.pool.waitingCount, waitingCount);
    assert.equal(snapshot.processes?.length, 1, 'the other processes are left out, this one stays');
    assert.ok(snapshot.process.eventLoopLagMs, 'the event loop figures are served');

    const controller = new OpsMetricsController(svc);
    const viaToken = await controller.metrics();
    assert.deepEqual(Object.keys(viaToken.recentErrors[0]).sort(), ['count', 'errorType', 'lastSeen', 'route'], 'no error message on the token route');
  } finally {
    store.onModuleDestroy();
    db.onModuleDestroy();
    process.env = saved;
  }
}

/** Waiting while the pool opens a connection below its size is not saturation. */
function testSaturationNeedsAFullPool() {
  assert.equal(poolSaturated({ waitingCount: 2, totalCount: 2, maxPool: 20 }), false, 'connections being opened');
  assert.equal(poolSaturated({ waitingCount: 0, totalCount: 20, maxPool: 20 }), false, 'full but nobody waits');
  assert.equal(poolSaturated({ waitingCount: 1, totalCount: 20, maxPool: 20 }), true);
}

async function run() {
  testSaturationNeedsAFullPool();
  await testSnapshotAnswersWithoutTheDatabase(7);
  await testSnapshotAnswersWithoutTheDatabase(0);
  console.log('ops-saturated-pool.spec: ok');
}

run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
