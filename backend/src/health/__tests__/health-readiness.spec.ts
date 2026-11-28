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
 * migration is pending; 503 without detail on any error of the check, a pending migration, no
 * answer within 2 s, or a saturated pool before the process was ever ready; 200 `busy` when the
 * pool is saturated once the process has been ready. One check at a time. The liveness route
 * (`GET /health`) keeps its body and reads no database.
 */

type Fake = ReadinessDeps & { pings: number; pendingReads: number };

function fake(overrides: Partial<ReadinessDeps> & { pending?: number[] } = {}): Fake {
  const pending = overrides.pending ?? [0];
  const deps: Fake = {
    pings: 0,
    pendingReads: 0,
    ping: async (timeoutMs: number) => {
      deps.pings += 1;
      return overrides.ping ? overrides.ping(timeoutMs) : [{ '?column?': 1 }];
    },
    pendingMigrations: async () => {
      deps.pendingReads += 1;
      if (overrides.pendingMigrations) return overrides.pendingMigrations();
      return pending[Math.min(deps.pendingReads - 1, pending.length - 1)];
    },
    poolSaturated: overrides.poolSaturated ?? (() => false),
  };
  return deps;
}

const READY = { statusCode: 200, body: { status: 'ok' } };
const UNAVAILABLE = { statusCode: 503, body: { status: 'unavailable' } };
const BUSY = { statusCode: 200, body: { status: 'ok', database: 'busy' } };

const coded = (message: string, code: string) => Object.assign(new Error(message), { code });

async function testCheck(): Promise<void> {
  // The database answers, nothing pending: ready.
  {
    const deps = fake();
    assert.deepEqual(await new ReadinessCheck(deps).check(), READY);
    assert.deepEqual([deps.pings, deps.pendingReads], [1, 1]);
  }

  // Any error of SELECT 1 is 503 without detail, whatever it is: refused, lost, unknown host,
  // unroutable address, refused password, missing database, a pool connection timeout.
  for (const error of [
    coded('connect ECONNREFUSED 10.0.0.5:5432', 'ECONNREFUSED'),
    new Error('Connection terminated unexpectedly'),
    coded('terminating connection due to administrator command', '57P01'),
    coded('getaddrinfo ENOTFOUND db.example', 'ENOTFOUND'),
    coded('connect ENETUNREACH 10.255.0.1:5432', 'ENETUNREACH'),
    coded('password authentication failed for user "kanap"', '28P01'),
    coded('database "kanap" does not exist', '3D000'),
    new Error('timeout exceeded when trying to connect'),
    new Error('Query read timeout'),
  ]) {
    const deps = fake({ ping: async () => { throw error; } });
    assert.deepEqual(await new ReadinessCheck(deps).check(), UNAVAILABLE, error.message);
    assert.equal(deps.pendingReads, 0, 'the migrations are not read without a database');
  }

  // An error reading the migrations is 503 too (a permission refused on the table, 42501).
  {
    const deps = fake({ pendingMigrations: async () => { throw coded('permission denied for table migrations', '42501'); } });
    assert.deepEqual(await new ReadinessCheck(deps).check(), UNAVAILABLE);
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

  // The pool is saturated before the process was ever ready: 503, and no query is sent. A process
  // a migration behind is never declared ready because it is loaded.
  {
    const deps = fake({ poolSaturated: () => true, pending: [3] });
    assert.deepEqual(await new ReadinessCheck(deps).check(), UNAVAILABLE);
    assert.deepEqual([deps.pings, deps.pendingReads], [0, 0]);
  }

  // Once ready, a saturated pool is 200 busy, and no query is sent.
  {
    let saturated = false;
    const deps = fake({ poolSaturated: () => saturated });
    const check = new ReadinessCheck(deps);
    assert.deepEqual(await check.check(), READY);
    saturated = true;
    assert.deepEqual(await check.check(), BUSY);
    assert.deepEqual([deps.pings, deps.pendingReads], [1, 1]);
  }

  // No answer within the deadline: 503, before and after the process was ready; at the deadline.
  {
    const releases: Array<() => void> = [];
    let slow = false;
    const deps = fake({ ping: () => (slow ? new Promise((resolve) => { releases.push(() => resolve([])); }) : Promise.resolve([])) });
    const check = new ReadinessCheck(deps, 50);
    slow = true;
    const started = Date.now();
    assert.deepEqual(await check.check(), UNAVAILABLE, 'never ready, no answer');
    assert.ok(Date.now() - started < 1000, 'answered at the deadline');
    releases.splice(0).forEach((release) => release());
    await new Promise((resolve) => setImmediate(resolve));
    slow = false;
    assert.deepEqual(await check.check(), READY);
    slow = true;
    assert.deepEqual(await check.check(), UNAVAILABLE, 'ready once, the query sent, no answer');
    releases.splice(0).forEach((release) => release());
  }

  // Two probes at once on a slow database: one query, one outcome for both. A probe that arrives
  // while the first check still waits past its deadline shares it too: no second connection.
  {
    let release: () => void = () => undefined;
    let answers = false;
    const deps = fake({ ping: () => (answers ? Promise.resolve([]) : new Promise((resolve) => { release = () => resolve([]); })) });
    const check = new ReadinessCheck(deps, 50);
    const [first, second] = await Promise.all([check.check(), check.check()]);
    assert.deepEqual([first, second], [UNAVAILABLE, UNAVAILABLE]);
    assert.deepEqual(await check.check(), UNAVAILABLE, 'the first check still waits');
    assert.equal(deps.pings, 1, 'one query in flight, shared');
    answers = true;
    release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(await check.check(), READY, 'the next check, once the first settled');
    assert.equal(deps.pings, 2);
  }

  // A probe that fails after the deadline leaves no unhandled rejection.
  {
    let fail: () => void = () => undefined;
    const deps = fake({ ping: () => new Promise((_, reject) => { fail = () => reject(coded('x', 'ECONNRESET')); }) });
    assert.deepEqual(await new ReadinessCheck(deps, 20).check(), UNAVAILABLE);
    fail();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * The ping of the data source: one connection through a TypeORM query runner, `SELECT 1` with
 * node-postgres' `query_timeout`, the connection released, and released with the error (out of
 * the pool) when the query failed.
 */
async function testPing(): Promise<void> {
  const record = { queries: [] as unknown[], released: [] as unknown[] };
  const failure = new Error('Query read timeout');
  let fail = false;
  const runner = {
    connect: async () => ({
      query: async (config: unknown) => {
        record.queries.push(config);
        if (fail) throw failure;
        return { rows: [] };
      },
    }),
    release: async () => { record.released.push('release'); },
    releasePostgresConnection: async (err?: unknown) => { record.released.push(err); },
  };
  const deps = dataSourceReadiness({ createQueryRunner: () => runner } as unknown as DataSource);
  await deps.ping(2000);
  assert.deepEqual(record.queries, [{ text: 'SELECT 1', query_timeout: 2000 }]);
  assert.deepEqual(record.released, ['release']);
  fail = true;
  await assert.rejects(deps.ping(2000), failure);
  assert.deepEqual(record.released, ['release', failure], 'a failed connection leaves the pool');
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
    createQueryRunner: () => ({
      connect: async () => {
        queries += 1;
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      },
      release: async () => undefined,
      releasePostgresConnection: async () => undefined,
    }),
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
  await testPing();
  testPoolSaturation();
  await testController();
  console.log('health-readiness.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
