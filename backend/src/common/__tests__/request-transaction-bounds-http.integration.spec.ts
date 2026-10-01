import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { Controller, Get, INestApplication, Module, Post, Req } from '@nestjs/common';
import { HttpAdapterHost, NestFactory, Reflector } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';
import dataSource from '../../data-source';
import { ReleaseTenantRunnerFilter } from '../filters/release-tenant-runner.filter';
import { BULK_WRITE_TIMEOUTS, LongRunningRequest } from '../request-db-timeouts';
import { ClientAbortedError, createRequestFinalizer } from '../request-finalizer.middleware';
import { TenantInitGuard } from '../tenant-init.guard';
import { TenantInterceptor } from '../tenant.interceptor';

// The request transaction's bounds, end to end over HTTP against PostgreSQL,
// with the production wiring of main.ts (plan planning/perf-scale, lot 1D):
// - a database error a race can cause answers 409 / 503 with a stable code
//   (503 with Retry-After), never a 500;
// - the transaction runs with lock_timeout, statement_timeout and
//   idle_in_transaction_session_timeout, raised by @LongRunningRequest, whether
//   TenantInitGuard or TenantInterceptor opened it;
// - a client abort rolls back (nothing committed), fences the handler's later
//   queries, gives the connection back and logs one warning line, no error.

const PROBE = 'bounds-probe';
const DEFAULT_AXIS = `(SELECT id FROM analytics_axes WHERE tenant_id = app_current_tenant() AND is_default)`;

const SETTINGS_SQL = `SELECT name, setting::int AS ms FROM pg_settings
  WHERE name IN ('lock_timeout', 'statement_timeout', 'idle_in_transaction_session_timeout') ORDER BY name`;

const abortProbe: { finished: boolean; error: unknown } = { finished: false, error: undefined };
let lockedTenantId = '';

function settingsOf(rows: Array<{ name: string; ms: number }>) {
  return Object.fromEntries(rows.map((r) => [r.name, Number(r.ms)]));
}

@Controller('bounds')
class BoundsProbeController {
  @Get('settings')
  async settings(@Req() req: any) {
    return settingsOf(await req.queryRunner.manager.query(SETTINGS_SQL));
  }

  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Get('settings-bulk')
  async settingsBulk(@Req() req: any) {
    return settingsOf(await req.queryRunner.manager.query(SETTINGS_SQL));
  }

  @Post('duplicate')
  async duplicate(@Req() req: any) {
    const q = (sql: string) => req.queryRunner.manager.query(sql);
    await q(`CREATE TEMP TABLE bounds_unique (k int UNIQUE) ON COMMIT DROP`);
    await q(`INSERT INTO bounds_unique (k) VALUES (1), (1)`);
  }

  @Post('parent-gone')
  async parentGone(@Req() req: any) {
    const q = (sql: string) => req.queryRunner.manager.query(sql);
    await q(`CREATE TEMP TABLE bounds_parent (id int PRIMARY KEY) ON COMMIT DROP`);
    await q(`CREATE TEMP TABLE bounds_child (parent_id int REFERENCES bounds_parent (id)) ON COMMIT DROP`);
    await q(`INSERT INTO bounds_child (parent_id) VALUES (1)`);
  }

  @Post('in-use')
  async inUse(@Req() req: any) {
    const q = (sql: string) => req.queryRunner.manager.query(sql);
    await q(`CREATE TEMP TABLE bounds_used (id int PRIMARY KEY) ON COMMIT DROP`);
    await q(`CREATE TEMP TABLE bounds_user (used_id int REFERENCES bounds_used (id)) ON COMMIT DROP`);
    await q(`INSERT INTO bounds_used (id) VALUES (1)`);
    await q(`INSERT INTO bounds_user (used_id) VALUES (1)`);
    await q(`DELETE FROM bounds_used WHERE id = 1`);
  }

  // A real deadlock needs two requests in a cycle; its SQLSTATE is what the filter reads.
  @Post('deadlock')
  async deadlock() {
    throw new QueryFailedError('UPDATE spend_amounts SET planned = 1', [], Object.assign(new Error('deadlock detected'), { code: '40P01' }));
  }

  @Post('lock-busy')
  async lockBusy(@Req() req: any) {
    await req.queryRunner.manager.query(`SELECT 1 FROM tenants WHERE id = $1 FOR UPDATE NOWAIT`, [lockedTenantId]);
  }

  @Post('statement-busy')
  async statementBusy(@Req() req: any) {
    await req.queryRunner.manager.query(`SET LOCAL statement_timeout = '50ms'`);
    await req.queryRunner.manager.query(`SELECT pg_sleep(1)`);
  }

  // The handler succeeds; COMMIT fails on a deferred unique key.
  @Post('commit-duplicate')
  async commitDuplicate(@Req() req: any) {
    const q = (sql: string) => req.queryRunner.manager.query(sql);
    await q(`CREATE TEMP TABLE bounds_deferred (k int UNIQUE DEFERRABLE INITIALLY DEFERRED) ON COMMIT DROP`);
    await q(`INSERT INTO bounds_deferred (k) VALUES (1), (1)`);
    return { ok: true };
  }

  // Waits, then writes: the client is gone by then.
  @Post('abort-then-write')
  async abortThenWrite(@Req() req: any) {
    try {
      await req.queryRunner.manager.query(`SELECT pg_sleep(0.4)`);
      await req.queryRunner.manager.query(
        `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES (app_current_tenant(), ${DEFAULT_AXIS}, $1)`,
        [`${PROBE}-abort`],
      );
      return { ok: true };
    } catch (error) {
      abortProbe.error = error;
      throw error;
    } finally {
      abortProbe.finished = true;
    }
  }
}

@Module({ controllers: [BoundsProbeController] })
class BoundsProbeModule {}

async function createApp(tenantId: string, opts: { guard: boolean }): Promise<INestApplication> {
  const app = await NestFactory.create(BoundsProbeModule, { logger: false });
  const reflector = app.get(Reflector);
  app.use((req: any, _res: any, next: () => void) => {
    req.tenant = { id: tenantId, slug: PROBE, name: 'Bounds probe' };
    next();
  });
  if (opts.guard) app.useGlobalGuards(new TenantInitGuard(dataSource, reflector));
  app.useGlobalInterceptors(new TenantInterceptor(dataSource, reflector));
  app.use(createRequestFinalizer());
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new ReleaseTenantRunnerFilter(httpAdapter));
  await app.listen(0, '127.0.0.1');
  return app;
}

/** Connections the test itself holds (the row locker), not the request's. */
let heldByTest = 0;

/** Wait until every pooled connection is back, i.e. the request transaction is finished. */
async function waitForIdlePool() {
  const pool: any = (dataSource.driver as any).master;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (pool.totalCount - pool.idleCount === heldByTest && pool.waitingCount === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('request transaction did not finish within 5 s');
}

function url(app: INestApplication, path: string) {
  const { port } = app.getHttpServer().address() as AddressInfo;
  return `http://127.0.0.1:${port}/bounds/${path}`;
}

async function call(app: INestApplication, method: 'GET' | 'POST', path: string) {
  const res = await fetch(url(app, path), { method });
  const text = await res.text();
  await waitForIdlePool();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, retryAfter: res.headers.get('retry-after') };
}

/** Runs `fn` with console.warn / console.error captured. */
async function capturingLogs<T>(fn: () => Promise<T>): Promise<{ result: T; warn: string[]; error: string[] }> {
  const warn: string[] = [];
  const error: string[] = [];
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (...args: any[]) => { warn.push(args.map(String).join(' ')); };
  console.error = (...args: any[]) => { error.push(args.map(String).join(' ')); };
  try {
    return { result: await fn(), warn, error };
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
}

async function probeRows(tenantId: string, name: string): Promise<number> {
  return dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const rows = await manager.query(`SELECT count(*)::int AS n FROM analytics_categories WHERE name = $1`, [name]);
    return rows[0].n as number;
  });
}

async function testDatabaseErrors(app: INestApplication, tenantId: string, failures: string[]) {
  const expected: Array<[string, number, string]> = [
    ['duplicate', 409, 'duplicate'],
    ['parent-gone', 409, 'parent_gone'],
    ['in-use', 409, 'in_use'],
    ['deadlock', 409, 'retry'],
    ['statement-busy', 503, 'busy'],
    ['commit-duplicate', 409, 'duplicate'],
  ];
  // A row lock held by another transaction: the request's lock gives up (55P03).
  lockedTenantId = tenantId;
  const locker = dataSource.createQueryRunner();
  await locker.connect();
  await locker.startTransaction();
  await locker.query(`SELECT 1 FROM tenants WHERE id = $1 FOR UPDATE`, [tenantId]);
  heldByTest = 1;
  try {
    expected.push(['lock-busy', 503, 'busy']);
    const { warn } = await capturingLogs(async () => {
      for (const [path, status, code] of expected) {
        const res = await call(app, 'POST', path);
        if (res.status !== status || res.body?.code !== code) {
          failures.push(`${path}: HTTP ${res.status} ${JSON.stringify(res.body)}, expected ${status} ${code}`);
          continue;
        }
        if (typeof res.body?.message !== 'string' || res.body.message.length < 10) failures.push(`${path}: no plain-language message`);
        if (status === 503 && res.retryAfter !== '2') failures.push(`${path}: Retry-After ${res.retryAfter}, expected 2`);
        if (status === 409 && res.retryAfter !== null) failures.push(`${path}: unexpected Retry-After on a 409`);
      }
    });
    for (const [path, status, code] of expected) {
      if (!warn.some((line) => line.startsWith('[db] POST /bounds/' + path + ':') && line.endsWith(`answered ${status} ${code}`))) {
        failures.push(`${path}: no "[db]" warning line (${JSON.stringify(warn)})`);
      }
    }
  } finally {
    await locker.rollbackTransaction();
    await locker.release();
    heldByTest = 0;
  }
}

async function testTimeouts(appGuard: INestApplication, appInterceptor: INestApplication, failures: string[]) {
  const defaults = { idle_in_transaction_session_timeout: 60_000, lock_timeout: 5_000, statement_timeout: 30_000 };
  const bulk = { idle_in_transaction_session_timeout: 300_000, lock_timeout: 30_000, statement_timeout: 120_000 };
  for (const [opener, app] of [['TenantInitGuard', appGuard], ['TenantInterceptor', appInterceptor]] as const) {
    const plain = await call(app, 'GET', 'settings');
    try { assert.deepEqual(plain.body, defaults); } catch { failures.push(`${opener}: settings ${JSON.stringify(plain.body)}, expected ${JSON.stringify(defaults)}`); }
    const raised = await call(app, 'GET', 'settings-bulk');
    try { assert.deepEqual(raised.body, bulk); } catch { failures.push(`${opener}: bulk settings ${JSON.stringify(raised.body)}, expected ${JSON.stringify(bulk)}`); }
  }
  // The environment overrides a default, read per request.
  process.env.DB_LOCK_TIMEOUT_MS = '2500';
  try {
    const res = await call(appGuard, 'GET', 'settings');
    if (res.body?.lock_timeout !== 2_500) failures.push(`DB_LOCK_TIMEOUT_MS=2500: lock_timeout ${res.body?.lock_timeout}`);
  } finally {
    delete process.env.DB_LOCK_TIMEOUT_MS;
  }
  // The values are transaction-local: a connection back in the pool has PostgreSQL's defaults.
  const [{ ms }] = await dataSource.query(`SELECT setting::int AS ms FROM pg_settings WHERE name = 'lock_timeout'`);
  if (Number(ms) !== 0) failures.push(`a pooled connection kept lock_timeout = ${ms} ms`);
}

async function testClientAbort(app: INestApplication, tenantId: string, failures: string[]) {
  abortProbe.finished = false;
  abortProbe.error = undefined;
  const { warn, error } = await capturingLogs(async () => {
    const controller = new AbortController();
    const request = fetch(url(app, 'abort-then-write'), { method: 'POST', signal: controller.signal }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 150));
    controller.abort();
    await request;
    const deadline = Date.now() + 5000;
    while (!abortProbe.finished && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    await waitForIdlePool();
    // Let the filter run on the handler's error.
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  if (!abortProbe.finished) failures.push('abort: the handler never finished');
  if (!(abortProbe.error instanceof ClientAbortedError)) {
    failures.push(`abort: the handler's write after the abort ended with ${(abortProbe.error as Error)?.constructor?.name}: ${(abortProbe.error as Error)?.message}`);
  }
  if (await probeRows(tenantId, `${PROBE}-abort`) !== 0) failures.push('abort: the write after the abort was committed');
  const aborted = warn.filter((line) => line.includes('client aborted, transaction rolled back'));
  if (aborted.length !== 1) failures.push(`abort: ${aborted.length} "client aborted" warning lines, expected 1 (${JSON.stringify(warn)})`);
  if (warn.length !== 1) failures.push(`abort: other warnings logged: ${JSON.stringify(warn)}`);
  if (error.length > 0) failures.push(`abort: errors logged: ${JSON.stringify(error)}`);
}

async function main() {
  await dataSource.initialize();
  const tenantId = randomUUID();
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Bounds probe', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `${PROBE}-${tenantId.slice(0, 8)}`],
  );
  await dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await manager.query(`INSERT INTO analytics_axes (tenant_id, code, is_default) VALUES ($1, 'default', true)`, [tenantId]);
  });
  const appGuard = await createApp(tenantId, { guard: true });
  const appInterceptor = await createApp(tenantId, { guard: false });
  const failures: string[] = [];
  try {
    await testDatabaseErrors(appGuard, tenantId, failures);
    await testTimeouts(appGuard, appInterceptor, failures);
    await testClientAbort(appGuard, tenantId, failures);
  } finally {
    await appGuard.close();
    await appInterceptor.close();
    await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      await manager.query(`DELETE FROM analytics_categories WHERE tenant_id = $1`, [tenantId]);
      await manager.query(`DELETE FROM analytics_axes WHERE tenant_id = $1`, [tenantId]);
    });
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`request-transaction-bounds-http.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('request-transaction-bounds-http.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
