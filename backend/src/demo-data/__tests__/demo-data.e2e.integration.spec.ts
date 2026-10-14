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
import { ensureCapexDimensions } from '../../analytics/capex-dimensions.seed';
import { RECOMMENDED_DIMENSIONS } from '../../analytics/recommended-dimensions.seed';
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
// - the tenant is French (activated from a French browser): its budget lines carry the
//   recommended dimensions in French ("Matériel" for the files' "Hardware"), no English value is
//   added next to them, and every line has a cost pool, an IT tower and a business domain;
// - every contact has the supplier and contact type of 09b-contact-suppliers.csv;
// - the loader's token is refused (401) on another tenant's host, accepted on its own;
// - the reset brings the tenant back to the state of activation, table by table;
// - a loader that fails half-way (an injected server error on the contracts import) ends
//   `failed`, the tenant back to the state of activation;
// - while a tenant is being reset its writes get 409 tenant_resetting, its reads go on, and
//   another tenant is not affected.
// And a workspace activated before the recommended dimensions (an unnamed, empty default
// dimension and the three required CAPEX dimensions) loads too: the cost pool goes on the default
// dimension, the investment type stands for the purpose, the PP&E type follows the cost pool.
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

/** How many rows of a fixture file have a value in each `analytics:<code>` column (no `;` inside these cells). */
function fixtureDimensionCounts(name: string): Map<string, number> {
  const [header] = fs.readFileSync(path.join(FIXTURES, name), 'utf8').split(/\r?\n/, 1);
  const columns = header.split(';');
  const counts = new Map<string, number>();
  for (const line of fixtureRows(name)) {
    const cells = line.split(';');
    columns.forEach((column, index) => {
      if (!column.startsWith('analytics:')) return;
      const code = column.slice('analytics:'.length);
      counts.set(code, (counts.get(code) ?? 0) + (cells[index]?.trim() ? 1 : 0));
    });
  }
  return counts;
}

/**
 * The dimensions after the load: lines with a value per dimension and nature (printed), the
 * recommended dimensions in the tenant's language with no other value, and every line with a
 * cost pool, an IT tower and a business domain.
 */
async function checkDimensions(tenantId: string) {
  const files = { opex: '14-spend-items.csv', capex: '15-capex-items.csv' } as const;
  const lines = await inTenant(tenantId, (m) => m.query(
    `SELECT nature, count(*)::int AS n FROM spend_items WHERE tenant_id = $1 GROUP BY nature`, [tenantId]));
  const total = Object.fromEntries(lines.map((row: any) => [row.nature, row.n])) as Record<'opex' | 'capex', number>;
  assert.deepEqual(total, { opex: fixtureRows(files.opex).length, capex: fixtureRows(files.capex).length }, 'every budget line of the files');

  const axes: Array<{ code: string; name: string; values: string[] }> = await inTenant(tenantId, (m) => m.query(
    `SELECT a.code, a.name, coalesce(array_agg(c.name ORDER BY c.sort_order, c.name) FILTER (WHERE c.id IS NOT NULL), '{}') AS values
       FROM analytics_axes a LEFT JOIN analytics_categories c ON c.axis_id = a.id AND c.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1 GROUP BY a.id, a.code, a.name ORDER BY a.code`, [tenantId]));
  assert.deepEqual(axes.map((axis) => axis.code), ['business_domain', 'default', 'it_tower', 'priority', 'purpose', 'recurrence', 'reference'],
    'the recommended dimensions and the data set\'s own two; no cost type, PP&E type or investment type');
  for (const seed of RECOMMENDED_DIMENSIONS.fr) {
    const axis = axes.find((item) => item.code === (seed.key === 'cost_pool' ? 'default' : seed.code))!;
    assert.equal(axis.name, seed.name, `${seed.key}: named in French`);
    assert.deepEqual(axis.values, seed.values.map((value) => value.name), `${seed.key}: the French values only, none added by the load`);
  }

  const rows: Array<{ code: string; nature: 'opex' | 'capex'; n: number }> = await inTenant(tenantId, (m) => m.query(
    `SELECT a.code, s.nature, count(*)::int AS n
       FROM spend_item_analytics_values v
       JOIN analytics_axes a ON a.id = v.axis_id AND a.tenant_id = v.tenant_id
       JOIN spend_items s ON s.id = v.item_id AND s.tenant_id = v.tenant_id
      WHERE v.tenant_id = $1
      GROUP BY a.code, s.nature`, [tenantId]));
  const actual = (code: string, nature: 'opex' | 'capex') => rows.find((row) => row.code === code && row.nature === nature)?.n ?? 0;
  const expected = { opex: fixtureDimensionCounts(files.opex), capex: fixtureDimensionCounts(files.capex) };
  console.log('demo-data.e2e: lines with a value / lines, per dimension');
  for (const axis of axes) {
    const cells = (['opex', 'capex'] as const).map((nature) => `${nature} ${actual(axis.code, nature)}/${total[nature]}`);
    console.log(`  ${axis.code.padEnd(16)} ${axis.name.padEnd(22)} ${cells.join('  ')}`);
    for (const nature of ['opex', 'capex'] as const) {
      assert.equal(actual(axis.code, nature), expected[nature].get(axis.code) ?? 0, `${axis.code}, ${nature}: the lines the file gives a value`);
    }
  }
  for (const code of ['default', 'it_tower', 'business_domain']) {
    for (const nature of ['opex', 'capex'] as const) assert.equal(actual(code, nature), total[nature], `${code}: every ${nature} line`);
  }
  for (const code of ['purpose', 'priority']) assert.equal(actual(code, 'capex'), total.capex, `${code}: every CAPEX line`);

  const [dataCenter] = await inTenant(tenantId, (m) => m.query(
    `SELECT c.name FROM spend_items s
       JOIN spend_item_analytics_values v ON v.item_id = s.id AND v.tenant_id = s.tenant_id
       JOIN analytics_axes a ON a.id = v.axis_id AND a.tenant_id = v.tenant_id AND a.is_default
       JOIN analytics_categories c ON c.id = v.category_id AND c.tenant_id = v.tenant_id
      WHERE s.tenant_id = $1 AND s.product_name = 'Data center de Paris — hébergement et énergie'`, [tenantId]));
  assert.equal(dataCenter?.name, 'Locaux et énergie', 'the file\'s "Facilities and power", in French');
}

type Served = {
  app: INestApplication;
  port: number;
  demo: DemoDataService;
  delivered: Array<{ to: unknown; subject?: string }>;
  storage: { put: string[]; deleted: string[] };
  loaderEnvs: Array<Record<string, string>>;
};

/**
 * Every contact of the data set has the supplier and contact type of 09b-contact-suppliers.csv,
 * as its supplier and as its one primary supplier link, so each supplier lists its contacts.
 */
async function checkContactSuppliers(tenantId: string) {
  const expected = fixtureRows('09b-contact-suppliers.csv').map((line) => line.split(';').map((cell) => cell.trim()).join('|')).sort();
  assert.equal(expected.length, fixtureRows('09-contacts.csv').length, 'one supplier per contact of the data set');
  const rows: Array<{ first_name: string; last_name: string; supplier: string; role: string }> = await inTenant(tenantId, (m) => m.query(
    `SELECT c.first_name, c.last_name, s.name AS supplier, sc.role::text AS role
       FROM contacts c
       JOIN suppliers s ON s.tenant_id = c.tenant_id AND s.id = c.supplier_id
       JOIN supplier_contacts sc ON sc.tenant_id = c.tenant_id AND sc.contact_id = c.id AND sc.supplier_id = c.supplier_id AND sc.is_primary
      WHERE c.tenant_id = $1`, [tenantId]));
  assert.deepEqual(rows.map((r) => [r.first_name, r.last_name, r.supplier, r.role].join('|')).sort(), expected, 'contacts with their supplier and type');
  const contacts = await tenantCount(tenantId, `SELECT count(*) AS n FROM contacts WHERE tenant_id = $1`);
  const links = await tenantCount(tenantId, `SELECT count(*) AS n FROM supplier_contacts WHERE tenant_id = $1`);
  assert.deepEqual({ contacts, links }, { contacts: expected.length, links: expected.length }, 'one supplier link per contact');
}

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
    a = await createActivatedTenant(svc, { tag: 'e2e-a', orgName: 'Fromage E2E', signup: true, language: 'fr' });
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
    await checkDimensions(a.tenantId);
    await checkContactSuppliers(a.tenantId);

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

async function testOlderWorkspace() {
  const svc: Services = buildServices();
  const served = await serve();
  let a: ActivatedTenant | undefined;
  try {
    a = await createActivatedTenant(svc, { tag: 'e2e-old', orgName: 'Fromage E2E older', signup: true });
    const tenantId = a.tenantId;
    // As the seed left a workspace before lot D.
    await inTenant(tenantId, async (m) => {
      await m.query(`DELETE FROM analytics_categories WHERE tenant_id = $1`, [tenantId]);
      await m.query(`DELETE FROM analytics_axes WHERE tenant_id = $1 AND NOT is_default`, [tenantId]);
      await m.query(`UPDATE analytics_axes SET name = NULL, description = NULL WHERE tenant_id = $1 AND is_default`, [tenantId]);
      await ensureCapexDimensions(m, tenantId);
    });
    await served.demo.load({ tenantId, actorId: a.ownerId, host: `${a.slug}.lvh.me` });
    const loaded = await waitForEnd(served.demo, tenantId);
    assert.equal(loaded.status, 'loaded', `the load ended ${JSON.stringify(loaded)}`);

    const rows: Array<{ code: string; name: string; nature: string | null; n: number }> = await inTenant(tenantId, (m) => m.query(
      `SELECT a.code, a.name, s.nature, count(s.id)::int AS n
         FROM analytics_axes a
         LEFT JOIN spend_item_analytics_values v ON v.axis_id = a.id AND v.tenant_id = a.tenant_id
         LEFT JOIN spend_items s ON s.id = v.item_id AND s.tenant_id = v.tenant_id
        WHERE a.tenant_id = $1
        GROUP BY a.id, a.code, a.name, s.nature
        ORDER BY a.code, s.nature`, [tenantId]));
    const opex = fixtureRows('14-spend-items.csv').length;
    const capex = fixtureRows('15-capex-items.csv').length;
    const count = (code: string, nature: string) => rows.find((row) => row.code === code && row.nature === nature)?.n ?? 0;
    assert.deepEqual([...new Set(rows.map((row) => row.code))],
      ['business_domain', 'default', 'investment_type', 'it_tower', 'ppe_type', 'priority', 'recurrence', 'reference'], 'no purpose next to the investment type');
    assert.equal(rows.find((row) => row.code === 'default')?.name, 'Cost pool', 'the empty default dimension became the cost pool');
    for (const code of ['default', 'it_tower', 'business_domain']) {
      assert.deepEqual([count(code, 'opex'), count(code, 'capex')], [opex, capex], `${code}: every line`);
    }
    for (const code of ['ppe_type', 'investment_type', 'priority']) {
      assert.deepEqual([count(code, 'opex'), count(code, 'capex')], [0, capex], `${code}: every CAPEX line`);
    }
    const ppe = await inTenant(tenantId, (m) => m.query(
      `SELECT c.name, count(*)::int AS n FROM spend_item_analytics_values v
         JOIN analytics_axes a ON a.id = v.axis_id AND a.tenant_id = v.tenant_id AND a.code = 'ppe_type'
         JOIN analytics_categories c ON c.id = v.category_id AND c.tenant_id = v.tenant_id
        WHERE v.tenant_id = $1 GROUP BY c.name ORDER BY c.name`, [tenantId]));
    assert.deepEqual(ppe.map((row: any) => [row.name, row.n]), [['Hardware', 8], ['Software', 7]], 'the PP&E type follows the cost pool');
  } finally {
    served.demo.stop();
    await served.app.close();
    await cleanupTenants([a?.tenantId]);
  }
}

runSpecs('demo-data.e2e.integration.spec', [testLoadResetAndFailure, testOlderWorkspace]).catch((err) => {
  console.error(err);
  process.exit(1);
});
