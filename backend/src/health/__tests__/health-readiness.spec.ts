import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { PATH_METADATA } from '@nestjs/common/constants';
import type { DataSource } from 'typeorm';
import { IS_PUBLIC_KEY } from '../../auth/public.decorator';
import { METRICS_SKIPPED_ROUTES } from '../../admin/ops/request-metrics.middleware';
import { HealthController } from '../health.controller';
import { ReadinessCheck, ReadinessDeps, dataSourceReadiness } from '../readiness';

/**
 * The readiness route (`GET /health/ready`, readiness.ts): 200 when the database answers and no
 * migration is pending, 503 without detail when the database is unreachable or a migration is
 * pending, 200 `busy` when the pool is saturated. The liveness route (`GET /health`) keeps its
 * body and reads no database.
 */

type Fake = ReadinessDeps & { pings: number; pendingReads: number };

function fake(overrides: Partial<ReadinessDeps> & { pending?: number[] } = {}): Fake {
  const pending = overrides.pending ?? [0];
  const deps: Fake = {
    pings: 0,
    pendingReads: 0,
    ping: async () => {
      deps.pings += 1;
      return overrides.ping ? overrides.ping() : [{ '?column?': 1 }];
    },
    pendingMigrations: async () => {
      deps.pendingReads += 1;
      return pending[Math.min(deps.pendingReads - 1, pending.length - 1)];
    },
    poolSaturated: overrides.poolSaturated ?? (() => false),
  };
  return deps;
}

const READY = { statusCode: 200, body: { status: 'ok' } };
const UNAVAILABLE = { statusCode: 503, body: { status: 'unavailable' } };
const BUSY = { statusCode: 200, body: { status: 'ok', database: 'busy' } };

async function testCheck(): Promise<void> {
  // The database answers, nothing pending: ready.
  {
    const deps = fake();
    assert.deepEqual(await new ReadinessCheck(deps).check(), READY);
    assert.deepEqual([deps.pings, deps.pendingReads], [1, 1]);
  }

  // The database is unreachable (refused, lost): 503 without detail.
  for (const error of [
    Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' }),
    new Error('Connection terminated unexpectedly'),
    Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' }),
  ]) {
    const deps = fake({ ping: async () => { throw error; } });
    assert.deepEqual(await new ReadinessCheck(deps).check(), UNAVAILABLE, error.message);
    assert.equal(deps.pendingReads, 0, 'the migrations are not read without a database');
  }

  // Migrations pending (an API started with SKIP_MIGRATIONS before the migration step): 503 until
  // the step ran; then ready, and the migrations are not read again.
  {
    const deps = fake({ pending: [3, 3, 0] });
    const check = new ReadinessCheck(deps);
    assert.deepEqual(await check.check(), UNAVAILABLE, 'three pending');
    assert.deepEqual(await check.check(), UNAVAILABLE, 'still pending');
    assert.deepEqual(await check.check(), READY, 'the migration step ran');
    assert.deepEqual(await check.check(), READY);
    assert.equal(deps.pendingReads, 3, 'remembered once nothing is pending');
    assert.equal(deps.pings, 4, 'the database is still checked on every call');
  }

  // The pool is saturated: 200 busy, and no query is sent.
  {
    const deps = fake({ poolSaturated: () => true });
    assert.deepEqual(await new ReadinessCheck(deps).check(), BUSY);
    assert.deepEqual([deps.pings, deps.pendingReads], [0, 0]);
  }

  // No answer within the deadline, or the pool's own wait gives up: busy, never 503.
  {
    let release: () => void = () => undefined;
    const deps = fake({ ping: () => new Promise((resolve) => { release = () => resolve([]); }) });
    const started = Date.now();
    assert.deepEqual(await new ReadinessCheck(deps, 50).check(), BUSY);
    assert.ok(Date.now() - started < 1000, 'answered at the deadline');
    release();
    const poolWait = fake({ ping: async () => { throw new Error('timeout exceeded when trying to connect'); } });
    assert.deepEqual(await new ReadinessCheck(poolWait).check(), BUSY);
  }

  // A probe that fails after the deadline leaves no unhandled rejection.
  {
    let fail: () => void = () => undefined;
    const deps = fake({ ping: () => new Promise((_, reject) => { fail = () => reject(Object.assign(new Error('x'), { code: 'ECONNRESET' })); }) });
    assert.deepEqual(await new ReadinessCheck(deps, 20).check(), BUSY);
    fail();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function testPoolSaturation(): void {
  const readiness = (master: unknown) => dataSourceReadiness({ driver: { master } } as unknown as DataSource);
  assert.equal(readiness({ totalCount: 3, idleCount: 1, waitingCount: 0, options: { max: 3 } }).poolSaturated(), false, 'an idle connection');
  assert.equal(readiness({ totalCount: 2, idleCount: 0, waitingCount: 0, options: { max: 3 } }).poolSaturated(), false, 'room for one more');
  assert.equal(readiness({ totalCount: 3, idleCount: 0, waitingCount: 0, options: { max: 3 } }).poolSaturated(), true, 'every connection taken');
  assert.equal(readiness({ totalCount: 1, idleCount: 0, waitingCount: 2, options: { max: 3 } }).poolSaturated(), true, 'requests waiting');
  assert.equal(readiness(undefined).poolSaturated(), false, 'no pool yet');
}

async function testController(): Promise<void> {
  // The routes: GET /health and GET /health/ready, both public (no tenant transaction).
  assert.equal(Reflect.getMetadata(PATH_METADATA, HealthController), 'health');
  assert.equal(Reflect.getMetadata(PATH_METADATA, HealthController.prototype.ready), 'ready');
  assert.equal(Reflect.getMetadata(IS_PUBLIC_KEY, HealthController.prototype.ready), true);
  assert.equal(Reflect.getMetadata(IS_PUBLIC_KEY, HealthController.prototype.get), true);

  // The liveness route reads no database and keeps its body.
  let queries = 0;
  const unreachable = {
    driver: { master: { totalCount: 0, idleCount: 0, waitingCount: 0, options: { max: 10 } } },
    query: async () => {
      queries += 1;
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    },
  } as unknown as DataSource;
  const controller = new HealthController(unreachable);
  const live = controller.get();
  assert.deepEqual(Object.keys(live), ['status', 'text_processing']);
  assert.equal(live.status, 'ok');
  assert.equal(queries, 0, '/health sends no query');

  // The readiness route sets the status and answers the body, nothing else.
  const statuses: number[] = [];
  const res = { status(code: number) { statuses.push(code); return res; } };
  assert.deepEqual(await controller.ready(res as never), { status: 'unavailable' });
  assert.deepEqual(statuses, [503]);
  assert.equal(queries, 1);

  // The request metrics leave both probes out, with and without the /api prefix.
  for (const route of ['/health', '/api/health', '/health/ready', '/api/health/ready']) {
    assert.ok(METRICS_SKIPPED_ROUTES.has(route), `${route} is left out of the request metrics`);
  }
}

async function main(): Promise<void> {
  await testCheck();
  testPoolSaturation();
  await testController();
  console.log('health-readiness.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
