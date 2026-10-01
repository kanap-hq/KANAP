import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { Controller, Get, INestApplication, Module, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { HttpAdapterHost, NestFactory, Reflector } from '@nestjs/core';
import { FileInterceptor } from '@nestjs/platform-express';
import { DataSource, QueryFailedError } from 'typeorm';
import dataSource from '../../data-source';
import { ReleaseTenantRunnerFilter } from '../filters/release-tenant-runner.filter';
import { createRequestCommitThenRun } from '../import-connection';
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
//   queries, gives the connection back and logs one warning line, no error;
//   a genuine error the handler ends with after the abort is still logged (at
//   error level, unanswered); an abort that lands during the COMMIT leaves the
//   commit alone and says the changes may be saved;
// - a transaction the server ended after the idle limit never answers 2xx:
//   the handler that wrote then idled gets 503 busy and nothing is committed,
//   the handler that idled then queried gets 503 busy (not a 500); a handler
//   that commits first and gives its connection back (the user invitation)
//   can wait on outside work as long as it needs;
// - a file upload whose body arrives slowly is not ended by the idle limit
//   (multipart requests get the idle limit of outside work);
// - no free connection in the pool (after the tenant lookup): 503 busy, from
//   TenantInitGuard as from TenantInterceptor.

const PROBE = 'bounds-probe';
const DEFAULT_AXIS = `(SELECT id FROM analytics_axes WHERE tenant_id = app_current_tenant() AND is_default)`;

const SETTINGS_SQL = `SELECT name, setting::int AS ms FROM pg_settings
  WHERE name IN ('lock_timeout', 'statement_timeout', 'idle_in_transaction_session_timeout') ORDER BY name`;

const abortProbe: { finished: boolean; error: unknown } = { finished: false, error: undefined };
let lockedTenantId = '';

/** The idle limit the idle probes run with (the server ends their transaction after it). */
const SHORT_IDLE_MS = 300;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const shortIdle = (req: any) => req.queryRunner.manager.query(
  `SELECT set_config('idle_in_transaction_session_timeout', $1, true)`, [String(SHORT_IDLE_MS)],
);
const insertProbe = (req: any, name: string) => req.queryRunner.manager.query(
  `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES (app_current_tenant(), ${DEFAULT_AXIS}, $1)`,
  [name],
);

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

  // Writes, then waits longer than the idle limit (outside work), then returns.
  @Post('write-idle-commit')
  async writeIdleCommit(@Req() req: any) {
    await shortIdle(req);
    await insertProbe(req, `${PROBE}-idle-commit`);
    await sleep(SHORT_IDLE_MS * 3);
    return { ok: true };
  }

  // Waits longer than the idle limit, then queries.
  @Post('idle-query')
  async idleQuery(@Req() req: any) {
    await shortIdle(req);
    await sleep(SHORT_IDLE_MS * 3);
    await insertProbe(req, `${PROBE}-idle-query`);
    return { ok: true };
  }

  // Writes, commits and gives the connection back, then waits on outside work (the invitation's e-mail).
  @Post('commit-then-outside')
  async commitThenOutside(@Req() req: any) {
    await shortIdle(req);
    await insertProbe(req, `${PROBE}-commit-then-outside-${req.query.run}`);
    await createRequestCommitThenRun(req)(async () => { await sleep(SHORT_IDLE_MS * 3); });
    return { ok: true };
  }

  // A file upload: the body arrives after the transaction opened.
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: any, @Req() req: any) {
    const [row] = await req.queryRunner.manager.query(`SELECT setting::int AS ms FROM pg_settings WHERE name = 'idle_in_transaction_session_timeout'`);
    return { size: file?.size ?? null, idleMs: Number(row.ms) };
  }

  // A genuine bug, thrown once the client is gone.
  @Post('abort-then-bug')
  async abortThenBug() {
    await sleep(400);
    abortProbe.finished = true;
    throw new TypeError('genuine bug after the abort');
  }

  // Writes; its COMMIT runs a deferred trigger that takes 600 ms.
  @Post('slow-commit')
  async slowCommit(@Req() req: any) {
    const q = (sql: string, params?: unknown[]) => req.queryRunner.manager.query(sql, params);
    await q(`CREATE FUNCTION pg_temp.bounds_slow_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.6); RETURN NULL; END $$`);
    await q(`CREATE TEMP TABLE bounds_slow (k int) ON COMMIT DROP`);
    await q(`CREATE CONSTRAINT TRIGGER bounds_slow_trg AFTER INSERT ON bounds_slow DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pg_temp.bounds_slow_commit()`);
    await q(`INSERT INTO bounds_slow (k) VALUES (1)`);
    await insertProbe(req, `${PROBE}-slow-commit`);
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

async function createApp(tenantId: string, opts: { guard: boolean; source?: DataSource }): Promise<INestApplication> {
  const source = opts.source ?? dataSource;
  const app = await NestFactory.create(BoundsProbeModule, { logger: false });
  const reflector = app.get(Reflector);
  app.use((req: any, _res: any, next: () => void) => {
    req.tenant = { id: tenantId, slug: PROBE, name: 'Bounds probe' };
    next();
  });
  if (opts.guard) app.useGlobalGuards(new TenantInitGuard(source, reflector));
  app.useGlobalInterceptors(new TenantInterceptor(source, reflector));
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

/** The server ends a transaction left idle: never a 2xx with nothing committed, never a raw 500. */
async function testIdleTransactionEnded(app: INestApplication, tenantId: string, failures: string[]) {
  const { result, warn, error } = await capturingLogs(async () => ({
    writeIdle: await call(app, 'POST', 'write-idle-commit'),
    idleQuery: await call(app, 'POST', 'idle-query'),
  }));
  for (const [path, res] of Object.entries({ 'write-idle-commit': result.writeIdle, 'idle-query': result.idleQuery })) {
    if (res.status !== 503 || res.body?.code !== 'busy') failures.push(`${path}: HTTP ${res.status} ${JSON.stringify(res.body)}, expected 503 busy`);
    if (res.retryAfter !== '2') failures.push(`${path}: Retry-After ${res.retryAfter}, expected 2`);
    if (!warn.some((line) => line.startsWith(`[db] POST /bounds/${path}: connection lost`) && line.endsWith('answered 503 busy'))) {
      failures.push(`${path}: no "[db] … connection lost … answered 503 busy" line (${JSON.stringify(warn)})`);
    }
  }
  if (await probeRows(tenantId, `${PROBE}-idle-commit`) !== 0) failures.push('write-idle-commit: the write was committed although the transaction was ended');
  // Committed before the outside work: the idle limit never applies to it.
  const run = randomUUID().slice(0, 8);
  const committedFirst = await call(app, 'POST', `commit-then-outside?run=${run}`);
  if (committedFirst.status !== 201) failures.push(`commit-then-outside: HTTP ${committedFirst.status} ${JSON.stringify(committedFirst.body)}, expected 201`);
  if (await probeRows(tenantId, `${PROBE}-commit-then-outside-${run}`) !== 1) failures.push('commit-then-outside: the write committed before the outside work is missing');
  if (await probeRows(tenantId, `${PROBE}-idle-query`) !== 0) failures.push('idle-query: a write reached the database outside the request transaction');
  if (error.length > 0) failures.push(`idle: errors logged: ${JSON.stringify(error)}`);
}

/** A multipart body that takes longer than the default idle limit to arrive. */
async function testSlowUpload(app: INestApplication, failures: string[]) {
  process.env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS = String(SHORT_IDLE_MS);
  try {
    const { port } = app.getHttpServer().address() as AddressInfo;
    const boundary = `bounds${Date.now()}`;
    const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\n`;
    const tail = `hello\r\n--${boundary}--\r\n`;
    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port, path: '/bounds/upload', method: 'POST',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': Buffer.byteLength(head + tail) },
      }, (response) => {
        let body = '';
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
      });
      req.on('error', reject);
      req.write(head);
      // The rest of the body arrives three idle limits later.
      setTimeout(() => req.end(tail), SHORT_IDLE_MS * 3);
    });
    await waitForIdlePool();
    let body: any = null;
    try { body = JSON.parse(res.body); } catch { body = res.body; }
    if (res.status !== 201 || body?.size !== 5) failures.push(`slow upload: HTTP ${res.status} ${res.body}, expected 201 with the 5-byte file`);
    else if (body.idleMs !== 600_000) failures.push(`slow upload: idle limit ${body.idleMs} ms, expected the outside-work 600000`);
  } finally {
    delete process.env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS;
  }
}

/** No free connection after the tenant lookup: 503 busy whichever of the guard or the interceptor asks. */
async function testPoolExhausted(tenantId: string, failures: string[]) {
  const tiny = new DataSource({ ...(dataSource.options as any), extra: { max: 1, connectionTimeoutMillis: 200 } });
  await tiny.initialize();
  const holder = tiny.createQueryRunner();
  await holder.connect();
  const appGuard = await createApp(tenantId, { guard: true, source: tiny });
  const appInterceptor = await createApp(tenantId, { guard: false, source: tiny });
  try {
    for (const [opener, app] of [['TenantInitGuard', appGuard], ['TenantInterceptor', appInterceptor]] as const) {
      const { result, warn } = await capturingLogs(async () => {
        const res = await fetch(url(app, 'settings'));
        return { status: res.status, body: await res.json().catch(() => null), retryAfter: res.headers.get('retry-after') };
      });
      if (result.status !== 503 || result.body?.code !== 'busy') failures.push(`pool exhausted (${opener}): HTTP ${result.status} ${JSON.stringify(result.body)}, expected 503 busy`);
      if (result.retryAfter !== '2') failures.push(`pool exhausted (${opener}): Retry-After ${result.retryAfter}`);
      if (!warn.some((line) => line.startsWith('[db] GET /bounds/settings: no connection') && line.endsWith('answered 503 busy'))) {
        failures.push(`pool exhausted (${opener}): no "[db] … no connection … answered 503 busy" line (${JSON.stringify(warn)})`);
      }
    }
  } finally {
    await holder.release();
    await appGuard.close();
    await appInterceptor.close();
    await tiny.destroy();
  }
}

/** After a client abort: a genuine error is logged at error level (unanswered); the abort's own fallout is not. */
async function testErrorAfterAbort(app: INestApplication, failures: string[]) {
  abortProbe.finished = false;
  const { warn, error } = await capturingLogs(async () => {
    const controller = new AbortController();
    const request = fetch(url(app, 'abort-then-bug'), { method: 'POST', signal: controller.signal }).catch(() => undefined);
    await sleep(150);
    controller.abort();
    await request;
    const deadline = Date.now() + 5000;
    while (!abortProbe.finished && Date.now() < deadline) await sleep(20);
    await waitForIdlePool();
    await sleep(100);
  });
  if (!error.some((line) => line.includes('[request] POST /bounds/abort-then-bug: error after the client aborted') && line.includes('genuine bug after the abort'))) {
    failures.push(`abort then bug: the genuine error was not logged at error level (${JSON.stringify(error)})`);
  }
  if (warn.filter((line) => line.includes('client aborted, transaction rolled back')).length !== 1) failures.push(`abort then bug: warnings ${JSON.stringify(warn)}`);
}

/** An abort during the COMMIT: the commit finishes, the warning says the changes may be saved. */
async function testAbortDuringCommit(app: INestApplication, tenantId: string, failures: string[]) {
  const { warn, error } = await capturingLogs(async () => {
    const controller = new AbortController();
    const request = fetch(url(app, 'slow-commit'), { method: 'POST', signal: controller.signal }).catch(() => undefined);
    await sleep(300);
    controller.abort();
    await request;
    await sleep(800);
    await waitForIdlePool();
  });
  if (!warn.some((line) => line.includes('[request] POST /bounds/slow-commit: client aborted during the commit, its changes may be saved'))) {
    failures.push(`abort during commit: warnings ${JSON.stringify(warn)}`);
  }
  if (warn.some((line) => line.includes('transaction rolled back'))) failures.push('abort during commit: claims a rollback');
  if (await probeRows(tenantId, `${PROBE}-slow-commit`) !== 1) failures.push('abort during commit: the commit did not go through');
  if (error.length > 0) failures.push(`abort during commit: errors logged: ${JSON.stringify(error)}`);
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
    await testIdleTransactionEnded(appGuard, tenantId, failures);
    await testIdleTransactionEnded(appInterceptor, tenantId, failures);
    await testSlowUpload(appGuard, failures);
    await testPoolExhausted(tenantId, failures);
    await testErrorAfterAbort(appGuard, failures);
    await testAbortDuringCommit(appGuard, tenantId, failures);
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
