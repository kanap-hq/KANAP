import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import dataSource from '../../data-source';
import {
  ActivatedTenant,
  baselineSnapshot,
  buildServices,
  cleanupTenants,
  countDifferences,
  countTenantRows,
  createActivatedTenant,
  inTenant,
  runSpecs,
  Services,
} from '../../admin/tenants/__tests__/tenant-reset-test-helpers';
import { backendPath } from '../../common/__tests__/backend-root';
import { TENANT_RESETTING_CODE } from '../../common/tenancy/request-tenancy.middleware';
import { StorageService } from '../../common/storage/storage.service';
import { EmailService } from '../../email/email.service';
import { applyHttpMiddleware, applyTenancyAndPipeline } from '../../http-app';
import { DemoDataService, DemoDataState } from '../demo-data.service';

// The sample data load end to end: the whole application (AppModule with the HTTP wiring of
// main.ts, http-app.ts) listening on a local port, a trial tenant as activation leaves it, and
// the real loader (fixtures/fromage-co/setup-tenant.mjs --server-mode) calling the API over HTTP
// with the administrator's token and the tenant's Host. Then:
// - the load ends `loaded`, with the landscape (instances, interfaces, bindings, connections)
//   and the `.example` users of the data set, and no e-mail sent;
// - the loader's token is refused (401) on another tenant's host, accepted on its own;
// - the reset brings the tenant back to the state of activation, table by table;
// - a loader that fails half-way (an injected server error on the contracts import) ends
//   `failed`, the tenant back to the state of activation;
// - while a tenant is being reset its writes get 409 tenant_resetting, its reads go on, and
//   another tenant is not affected.
// No storage or mail service is reached: both are doubles.

process.env.STRIPE_SECRET_KEY = '';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'demo-data-spec';
delete process.env.EMAIL_OVERRIDE;

const FIXTURES = backendPath('fixtures', 'fromage-co');

/** Data rows of a fixture file (`;`-separated, no quoted line breaks in these files). */
function fixtureRows(name: string): string[] {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8').split(/\r?\n/).slice(1).filter((line) => line.trim() !== '');
}

type Served = {
  app: INestApplication;
  port: number;
  demo: DemoDataService;
  delivered: Array<{ to: unknown; subject?: string }>;
  storage: { put: string[]; deleted: string[] };
  loaderEnvs: Array<Record<string, string>>;
};

async function serve(): Promise<Served> {
  // Loaded after the environment above: the modules read it when they load.
  const { AppModule } = require('../../app.module');
  const app: INestApplication = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  applyHttpMiddleware(app);
  applyTenancyAndPipeline(app, app.get(DataSource));
  await app.listen(0, '127.0.0.1');
  // No scheduled job runs during the spec.
  app.get(SchedulerRegistry).getCronJobs().forEach((job) => job.stop());

  const port = (app.getHttpServer().address() as AddressInfo).port;
  const demo = app.get(DemoDataService);
  demo.config.apiUrl = `http://127.0.0.1:${port}`;
  const loaderEnvs: Served['loaderEnvs'] = [];
  const realSpawn = demo.config.spawn;
  demo.config.spawn = ((command: string, args: string[], options: any) => {
    loaderEnvs.push({ ...options.env });
    return realSpawn(command, args, options);
  }) as any;

  const delivered: Served['delivered'] = [];
  (app.get(EmailService) as any).transport = {
    name: 'spec',
    defaultMinIntervalMs: 0,
    async send(options: any) { delivered.push({ to: options.to, subject: options.subject }); },
    getRetryDelayMs: () => null,
  };
  const storage = { put: [] as string[], deleted: [] as string[] };
  const store = app.get(StorageService) as any;
  store.putObject = async (params: { key: string }) => { storage.put.push(params.key); };
  store.deleteObject = async (key: string) => { storage.deleted.push(key); };
  return { app, port, demo, delivered, storage, loaderEnvs };
}

function request(port: number, opts: { method: string; path: string; host: string; token?: string; body?: unknown }) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : Buffer.from(JSON.stringify(opts.body));
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: opts.method,
      path: opts.path,
      headers: {
        Host: opts.host,
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body: any = text;
        try { body = text ? JSON.parse(text) : null; } catch { /* text */ }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForEnd(demo: DemoDataService, tenantId: string, timeoutMs = 240_000): Promise<DemoDataState> {
  const until = Date.now() + timeoutMs;
  const steps = new Set<string>();
  for (;;) {
    const state = await demo.getStatus(tenantId);
    if (state.step) steps.add(state.step);
    if (state.status !== 'loading' && state.status !== 'resetting') return state;
    if (Date.now() > until) assert.fail(`the load did not end: ${JSON.stringify(state)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function tenantCount(tenantId: string, sql: string): Promise<number> {
  const [row] = await inTenant(tenantId, (manager) => manager.query(sql, [tenantId]));
  return Number(row.n);
}

/**
 * A loader that fails half-way: it runs the real loader behind a small proxy that answers 500
 * to the contracts import (after the companies, users, suppliers, applications... were written).
 * The proxy and the loader end before it exits.
 */
function writeFailingLoader(dir: string): string {
  const file = path.join(dir, 'failing-loader.mjs');
  fs.writeFileSync(file, `
import http from 'node:http';
import { spawn } from 'node:child_process';
const target = new URL(process.env.KANAP_DEMO_API_URL);
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/contracts/import')) {
    req.resume();
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ statusCode: 500, message: 'injected failure' }));
    return;
  }
  const upstream = http.request({ host: target.hostname, port: target.port, method: req.method, path: req.url, headers: req.headers }, (answer) => {
    res.writeHead(answer.statusCode, answer.headers);
    answer.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(upstream);
});
server.listen(0, '127.0.0.1', () => {
  const env = { ...process.env, KANAP_DEMO_API_URL: 'http://127.0.0.1:' + server.address().port };
  const child = spawn(process.execPath, [${JSON.stringify(path.join(FIXTURES, 'setup-tenant.mjs'))}, '--server-mode'], { env, stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('close', (code) => { server.close(); process.exit(code ?? 1); });
});
`, { mode: 0o644 });
  return file;
}

async function testLoadResetAndFailure() {
  const started = Date.now();
  const lap = (label: string) => console.log(`demo-data.e2e: ${label} at ${((Date.now() - started) / 1000).toFixed(1)} s`);
  const svc: Services = buildServices();
  const served = await serve();
  lap('application listening');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-data-e2e-'));
  let a: ActivatedTenant | undefined;
  let b: ActivatedTenant | undefined;
  try {
    a = await createActivatedTenant(svc, { tag: 'e2e-a', orgName: 'Fromage E2E', signup: true });
    b = await createActivatedTenant(svc, { tag: 'e2e-b', orgName: 'Neighbour E2E', signup: true });
    const hostA = `${a.slug}.lvh.me`;
    const hostB = `${b.slug}.lvh.me`;
    const initialCounts = await countTenantRows(a.tenantId);
    const initialSnapshot = await baselineSnapshot(a.tenantId);
    const neighbourCounts = await countTenantRows(b.tenantId);

    // ── Load ──
    const claimed = await served.demo.load({ tenantId: a.tenantId, actorId: a.ownerId, host: hostA });
    assert.equal(claimed.status, 'loading');
    const loaded = await waitForEnd(served.demo, a.tenantId);
    lap('load ended');
    assert.equal(loaded.status, 'loaded', `the load ended ${JSON.stringify(loaded)}`);
    assert.equal(loaded.error_code, null);

    const expected = {
      app_instances: fixtureRows('20-app-instances.csv').length,
      interfaces: fixtureRows('21-interfaces.csv').length,
      interface_bindings: fixtureRows('22-interface-bindings.csv').length,
      connections: fixtureRows('23-connections.csv').length,
      users: fixtureRows('10-users.csv').length,
    };
    const actual = {
      app_instances: await tenantCount(a.tenantId, `SELECT count(*) AS n FROM app_instances WHERE tenant_id = $1`),
      interfaces: await tenantCount(a.tenantId, `SELECT count(*) AS n FROM interfaces WHERE tenant_id = $1`),
      interface_bindings: await tenantCount(a.tenantId, `SELECT count(*) AS n FROM interface_bindings WHERE tenant_id = $1`),
      connections: await tenantCount(a.tenantId, `SELECT count(*) AS n FROM connections WHERE tenant_id = $1`),
      users: await tenantCount(a.tenantId, `SELECT count(*) AS n FROM users WHERE tenant_id = $1 AND lower(email) LIKE '%.example'`),
    };
    assert.deepEqual(actual, expected, 'the landscape and the sample users of the data set');
    assert.ok(expected.app_instances > 0 && expected.interfaces > 0 && expected.connections > 0 && expected.users > 0);
    assert.equal(await tenantCount(a.tenantId, `SELECT count(*) AS n FROM users WHERE tenant_id = $1 AND lower(email) LIKE '%.example' AND password_hash IS NOT NULL`), 0,
      'the sample users have no password');
    assert.deepEqual(served.delivered, [], 'no e-mail sent');
    assert.deepEqual(countDifferences(neighbourCounts, await countTenantRows(b.tenantId)), [], 'the neighbour tenant is untouched');

    // ── The loader's token: refused on another tenant's host, accepted on its own ──
    assert.equal(served.loaderEnvs.length, 1);
    const token = served.loaderEnvs[0].KANAP_DEMO_TOKEN;
    assert.equal((await request(served.port, { method: 'GET', path: '/companies', host: hostA, token })).status, 200);
    const foreign = await request(served.port, { method: 'GET', path: '/companies', host: hostB, token });
    assert.equal(foreign.status, 401, 'the loader token on another tenant');
    const foreignWrite = await request(served.port, { method: 'POST', path: '/suppliers', host: hostB, token, body: { name: 'Not here' } });
    assert.equal(foreignWrite.status, 401);

    // ── Reset ──
    const reset = await served.demo.reset({ tenantId: a.tenantId, actorId: a.ownerId });
    lap('reset ended');
    assert.equal(reset.status, 'idle');
    assert.deepEqual(countDifferences(initialCounts, await countTenantRows(a.tenantId), ['audit_log']), [], 'every table as at activation');
    assert.deepEqual(await baselineSnapshot(a.tenantId), initialSnapshot, 'the starting state');
    assert.deepEqual(served.storage.deleted, [], 'the data set stores no file');

    // ── A load that fails half-way ──
    served.demo.config.scriptPath = writeFailingLoader(tmp);
    await served.demo.load({ tenantId: a.tenantId, actorId: a.ownerId, host: hostA });
    const failed = await waitForEnd(served.demo, a.tenantId);
    lap('failed load ended');
    assert.equal(failed.status, 'failed', JSON.stringify(failed));
    assert.equal(failed.error_code, 'load_failed');
    assert.deepEqual(countDifferences(initialCounts, await countTenantRows(a.tenantId), ['audit_log']), [], 'every table as at activation');
    assert.deepEqual(await baselineSnapshot(a.tenantId), initialSnapshot);
    const resets = await tenantCount(a.tenantId, `SELECT count(*) AS n FROM audit_log WHERE tenant_id = $1 AND source_ref = 'demo-reset'`);
    assert.equal(resets, 2, 'the manual reset and the automatic one');
    assert.deepEqual(served.delivered, [], 'no e-mail sent');

    // ── Writes refused while the tenant is being reset ──
    const adminToken = svc.auth.signToken({ id: a.ownerId, email: a.ownerEmail, tenant_id: a.tenantId }).access_token;
    const neighbourToken = svc.auth.signToken({ id: b.ownerId, email: b.ownerEmail, tenant_id: b.tenantId }).access_token;
    await dataSource.query(
      `UPDATE tenants SET metadata = metadata || jsonb_build_object('demo', metadata->'demo' || '{"status":"resetting"}'::jsonb) WHERE id = $1`,
      [a.tenantId],
    );
    try {
      const write = await request(served.port, { method: 'POST', path: '/suppliers', host: hostA, token: adminToken, body: { name: 'During reset' } });
      assert.equal(write.status, 409);
      assert.equal(write.body?.code, TENANT_RESETTING_CODE);
      const read = await request(served.port, { method: 'GET', path: '/companies', host: hostA, token: adminToken });
      assert.equal(read.status, 200, 'reads go on');
      const neighbourWrite = await request(served.port, { method: 'POST', path: '/suppliers', host: hostB, token: neighbourToken, body: { name: 'Neighbour supplier' } });
      assert.ok(neighbourWrite.status === 201 || neighbourWrite.status === 200, `another tenant writes (${neighbourWrite.status} ${JSON.stringify(neighbourWrite.body)})`);
      assert.equal(await tenantCount(a.tenantId, `SELECT count(*) AS n FROM suppliers WHERE tenant_id = $1`), 0);
    } finally {
      await dataSource.query(
        `UPDATE tenants SET metadata = metadata || jsonb_build_object('demo', metadata->'demo' || '{"status":"failed"}'::jsonb) WHERE id = $1`,
        [a.tenantId],
      );
    }
    lap('done');
  } finally {
    served.demo.stop();
    await served.app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    await cleanupTenants([a?.tenantId, b?.tenantId]);
  }
}

runSpecs('demo-data.e2e.integration.spec', [testLoadResetAndFailure]).catch((err) => {
  console.error(err);
  process.exit(1);
});
