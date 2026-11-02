import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { PostgresQueryRunner } from 'typeorm/driver/postgres/PostgresQueryRunner';
import {
  ActivatedTenant,
  buildServices,
  cleanupTenants,
  createActivatedTenant,
  runSpecs,
} from '../../admin/tenants/__tests__/tenant-reset-test-helpers';
import { backendPath } from './backend-root';
import { waitForBackgroundWork } from '../background-work';
import { applyHttpMiddleware, applyTenancyAndPipeline } from '../../http-app';
import { DemoDataService } from '../../demo-data/demo-data.service';
import { FxRateService } from '../../currency/fx-rate.service';
import { NvdFeedService } from '../../vulnerabilities/nvd-feed.service';

// The list filter contract, server side. `frontend/src/pages/listFilterContract.json` lists, per
// list endpoint, every column its screen lets the user filter and the kind of filter model the grid
// sends for it (derived from the screens' column definitions by `listFilterContract.test.tsx`).
// For each one, the whole application (AppModule with the HTTP wiring of main.ts) answers the
// list request with that filter, as the administrator of a fresh workspace, and the filter must
// reach the database: the statements the request runs differ from those of the same request
// without the filter, or, for a list filtered in memory, its rows go (no row matches the filter
// values used here). A filter the server ignores does neither (the Name filter of the assets list
// did, and the list showed every asset). A filter on a column no screen has is the
// control: it must leave them unchanged, which proves the comparison sees an ignored filter.

process.env.STRIPE_SECRET_KEY = '';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'list-filter-contract-spec';
delete process.env.EMAIL_OVERRIDE;

type Kind = 'text' | 'set' | 'date' | 'number';
type ListContract = { params: Record<string, string>; filters: Record<string, Kind>; fields: string[] };
const CONTRACT: Record<string, ListContract> = JSON.parse(
  fs.readFileSync(backendPath('..', 'frontend', 'src', 'pages', 'listFilterContract.json'), 'utf8'),
);

/**
 * Filters the screens offer and the server does not honour yet (`<endpoint> <column>`, or the
 * endpoint alone when an unknown column fails the request or changes it, so the comparison cannot
 * tell). Each must still fail: fix one, then remove it. The 35 found when this spec was written
 * are fixed; keep it empty.
 */
const KNOWN_GAPS = new Set<string>([]);

/** A filter model of each kind, as the grid sends it. */
function filterModel(kind: Kind): Record<string, unknown> {
  switch (kind) {
    case 'text': return { filterType: 'text', type: 'contains', filter: 'zq-contract' };
    case 'set': return { filterType: 'set', values: ['00000000-0000-4000-8000-00000000c0de'] };
    case 'date': return { filterType: 'date', type: 'equals', dateFrom: '2001-02-03 00:00:00', dateTo: null };
    case 'number': return { filterType: 'number', type: 'equals', filter: 4242 };
  }
}

/**
 * Statements of the measured request, with their parameters. The patch wraps every connection of
 * the process. A flag would also keep statements of other work that runs while the request is in
 * flight (a scheduled task, an audit write, a request still finishing), and two identical calls
 * then differ. The client and the server share this process, but a store does not cross the HTTP
 * socket: `statementsOf` sends `X-Record-Id`, and the middleware below runs the rest of that
 * request inside the store it opened. A statement is kept only when `getStore()` is that store.
 */
const recorded: string[] = [];
const recordStorage = new AsyncLocalStorage<object>();
const storesByRecordId = new Map<string, object>();
let measuredStore: object | null = null;
const realQuery = PostgresQueryRunner.prototype.query;
PostgresQueryRunner.prototype.query = function patchedQuery(this: PostgresQueryRunner, query: string, parameters?: any[], ...rest: any[]) {
  // The time of the request (a validity date compared with now) differs from one request to the next.
  if (recordStorage.getStore() === measuredStore) {
    recorded.push(`${query.replace(/\s+/g, ' ').trim()} -- ${JSON.stringify(parameters ?? []).replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, '<now>')}`);
  }
  return (realQuery as any).call(this, query, parameters, ...rest);
} as any;

/** The rows a list answer counts (its total, else its rows). */
function rowCount(body: string): number {
  try {
    const data = JSON.parse(body);
    if (Array.isArray(data)) return data.length;
    if (typeof data?.total === 'number') return data.total;
    return Array.isArray(data?.items) ? data.items.length : -1;
  } catch {
    return -1;
  }
}

function send(port: number, method: string, path: string, host: string, token: string, body?: unknown, recordId?: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const headers: Record<string, string> = { Host: host, Authorization: `Bearer ${token}` };
    if (recordId) headers['X-Record-Id'] = recordId;
    if (payload) Object.assign(headers, { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) });
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** The statements of one list request, in order. */
async function statementsOf(port: number, host: string, token: string, endpoint: string, pageParams: Record<string, string>, filters?: Record<string, unknown>) {
  const params = new URLSearchParams({ page: '1', limit: '50', ...pageParams });
  if (filters) params.set('filters', JSON.stringify(filters));
  // Work an earlier request left running in the background (`background-work.ts`) records nothing here.
  assert.equal(await waitForBackgroundWork(Date.now() + 30_000), 0, 'the background work of the earlier requests ends');
  const recordId = randomUUID();
  const store = { recordId };
  storesByRecordId.set(recordId, store);
  // Replace the measured store before clearing, so a statement still in flight from the previous
  // request cannot land in this recording.
  measuredStore = store;
  recorded.length = 0;
  try {
    const res = await send(port, 'GET', `${endpoint}?${params.toString()}`, host, token, undefined, recordId);
    return { status: res.status, body: res.body, statements: recorded.join('\n') };
  } finally {
    measuredStore = null;
    storesByRecordId.delete(recordId);
  }
}

/** Where two recordings of the same request part, to name what made them differ. */
function firstDifference(first: string, second: string): string {
  if (first === second) return '';
  const a = first.split('\n');
  const b = second.split('\n');
  const at = a.findIndex((line, index) => line !== b[index]);
  const index = at === -1 ? a.length : at;
  // Around the first character that differs: a statement can part only in its parameters, past its first lines.
  const lineA = a[index] ?? '';
  const lineB = b[index] ?? '';
  let char = 0;
  while (char < lineA.length && lineA[char] === lineB[char]) char += 1;
  const from = Math.max(0, char - 150);
  const show = (line: string | undefined) => (line === undefined ? '(none)' : `${from > 0 ? '…' : ''}${line.slice(from, from + 300)}`);
  return `; ${a.length} then ${b.length} statements, first difference at ${index}, character ${char}: ${show(a[index])} | then: ${show(b[index])}`;
}

async function testEveryOfferedFilterReachesTheDatabase() {
  const svc = buildServices();
  const { AppModule } = require('../../app.module');
  const app: INestApplication = await NestFactory.create(AppModule, { logger: ['error'] });
  applyHttpMiddleware(app);
  // After the HTTP middleware, before tenancy, so the tenant lookup and the list query both run
  // inside the store named by `X-Record-Id`. No header: the request stays outside every store.
  app.use((req: { headers: Record<string, string | string[] | undefined> }, _res: unknown, next: () => void) => {
    const header = req.headers['x-record-id'];
    const recordId = Array.isArray(header) ? header[0] : header;
    const store = recordId ? storesByRecordId.get(recordId) : undefined;
    if (store) recordStorage.run(store, next);
    else next();
  });
  applyTenancyAndPipeline(app, app.get(DataSource));
  await app.listen(0, '127.0.0.1');
  app.get(SchedulerRegistry).getCronJobs().forEach((job) => job.stop());
  // A budget list read that finds no exchange rate starts a refresh of the year's rates in the
  // background, still inside that request: its statements, and a network call of variable length,
  // fell inside later recordings and made the same request look different (#625). The lists read
  // rates the same way without it.
  app.get(FxRateService).onMissingRates(null);
  const port = (app.getHttpServer().address() as AddressInfo).port;

  let tenant: ActivatedTenant | undefined;
  const failures: string[] = [];
  const gapsSeen = new Set<string>();
  const fail = (key: string, message: string) => {
    if (KNOWN_GAPS.has(key)) gapsSeen.add(key);
    else failures.push(message);
  };
  let checked = 0;
  const emptyLists: string[] = [];
  try {
    tenant = await createActivatedTenant(svc, { tag: 'filters', orgName: 'Filter contract' });
    const host = `${tenant.slug}.lvh.me`;
    const token = svc.auth.signToken({ id: tenant.ownerId, email: tenant.ownerEmail, tenant_id: tenant.tenantId }).access_token;

    // The sample technologies name CPE products: after their commit the feed matches them and
    // collects the products it never collected, with network calls of variable length, in the
    // background. Those statements fell inside the recordings of /technologies and /vulnerabilities.
    // No collection on demand here; the matching is awaited below.
    const feed = app.get(NvdFeedService);
    feed.collectNew = async () => undefined;
    // The sample data set gives the lists rows: the fields of the columns are read on them.
    const demo = app.get(DemoDataService);
    demo.config.apiUrl = `http://127.0.0.1:${port}`;
    await demo.load({ tenantId: tenant.tenantId, actorId: tenant.ownerId, host });
    for (const until = Date.now() + 240_000; ;) {
      const state = await demo.getStatus(tenant.tenantId);
      if (state.status !== 'loading') {
        assert.equal(state.status, 'loaded', `the sample data: ${JSON.stringify(state)}`);
        break;
      }
      assert.ok(Date.now() < until, 'the sample data load ends');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    // The matching that follows the sample technologies' commit is over before the first recording.
    await feed.whenIdle(60_000);
    // The sample data load starts an exchange-rate refresh that can outlive it (a refresh request
    // stops waiting after 20 s, the run goes on, network calls included). Its statements fell
    // inside later recordings: a rate-set lock in /connections, new rates in /contracts. Every
    // tracked background work is over before the first recording.
    assert.equal(await waitForBackgroundWork(Date.now() + 120_000), 0, 'the background work of the sample data load ends');

    // Lists filtered in memory (cost centers) show a filter only by the rows it leaves: give them one.
    const companies = JSON.parse((await send(port, 'GET', '/companies', host, token)).body);
    const companyId = companies.items?.[0]?.id;
    const costCenter = await send(port, 'POST', '/cost-centers', host, token, { code: 'CC-1', name: 'Contract', kind: 'cost_center', company_id: companyId });
    assert.equal(costCenter.status, 201, `a cost center: ${costCenter.body}`);

    assert.ok(Object.keys(CONTRACT).length >= 20, 'the contract lists the list screens');
    const charts = JSON.parse((await send(port, 'GET', '/chart-of-accounts', host, token)).body);
    const chart = (charts.items ?? charts).find((item: any) => item.is_default) ?? (charts.items ?? charts)[0];
    const placeholders: Record<string, string> = { '<year>': String(new Date().getFullYear()), '<chart>': chart?.id };

    for (const [endpoint, { params: listParams, filters: fields, fields: shown }] of Object.entries(CONTRACT)) {
      const pageParams = Object.fromEntries(Object.entries(listParams).map(([key, value]) => [key, placeholders[value] ?? value]));
      // A first request may fill a cache once (the budget lists store the exchange rates of their
      // years): the comparison starts after it.
      await statementsOf(port, host, token, endpoint, pageParams);
      const baseline = await statementsOf(port, host, token, endpoint, pageParams);
      if (baseline.status !== 200) {
        fail(endpoint, `${endpoint}: the list answers ${baseline.status} ${baseline.body.slice(0, 200)}`);
        continue;
      }
      // Every field a column shows comes with the rows (a field no row has leaves the column empty).
      const rows: any[] = (() => { const data = JSON.parse(baseline.body); return Array.isArray(data) ? data : data.items ?? data.rows ?? []; })();
      if (rows.length === 0) emptyLists.push(endpoint);
      for (const field of rows.length > 0 ? shown : []) {
        const has = (row: any) => field.split('.').reduce((value: any, part) => (value != null && typeof value === 'object' && part in value ? value[part] : undefined), row) !== undefined;
        if (!rows.some(has)) fail(`${endpoint} ${field} (field)`, `${endpoint} ${field}: shown by a column, missing from the rows`);
      }
      const again = await statementsOf(port, host, token, endpoint, pageParams);
      const control = await statementsOf(port, host, token, endpoint, pageParams, { no_such_column: filterModel('text') });
      // An unknown column is either refused (400) or ignored.
      const controlIgnored = control.status === 400 || (control.status === 200 && control.statements === baseline.statements);
      if (again.statements !== baseline.statements || !controlIgnored) {
        fail(endpoint, `${endpoint}: the same request runs different statements, the comparison cannot tell (unknown column: ${control.status} ${control.body.slice(0, 200)})${firstDifference(baseline.statements, again.statements)}`);
        continue;
      }
      for (const [field, kind] of Object.entries(fields)) {
        checked += 1;
        const filtered = await statementsOf(port, host, token, endpoint, pageParams, { [field]: filterModel(kind) });
        if (filtered.status !== 200) {
          fail(`${endpoint} ${field}`, `${endpoint} ${field} (${kind}): ${filtered.status} ${filtered.body.slice(0, 200)}`);
        } else if (filtered.statements === baseline.statements && !(rowCount(baseline.body) > 0 && rowCount(filtered.body) === 0)) {
          fail(`${endpoint} ${field}`, `${endpoint} ${field} (${kind}): ignored by the server`);
        }
      }
    }

    // The derived users of an application are computed for the page after the read; their filter
    // runs the same rule in SQL (`derivedTotalUsersSql`): each value the rows show keeps exactly
    // the rows that show it.
    const appRows = (path: string) => send(port, 'GET', path, host, token).then((res) => {
      assert.equal(res.status, 200, `${path}: ${res.body.slice(0, 200)}`);
      return JSON.parse(res.body).items as Array<{ id: string; derived_total_users: number }>;
    });
    // The sample applications derive no users (no company figures): four of them get the cases of
    // the rule. Manual (42); IT users of a company read for the closest earlier year (30), plus the
    // headcount of a department of another company (7); the headcount of a company (50), its own
    // department skipped; a company with figures for a later year only and no IT users (12).
    const Y = new Date().getFullYear();
    await app.get(DataSource).transaction(async (m) => {
      const tid = tenant!.tenantId;
      await m.query(`SELECT set_config('app.current_tenant', $1, true)`, [tid]);
      const appIds: string[] = (await m.query(`SELECT id FROM applications WHERE tenant_id = $1 ORDER BY name, id LIMIT 4`, [tid])).map((row: any) => row.id);
      const [companyA, companyB]: string[] = (await m.query(`SELECT id FROM companies WHERE tenant_id = $1 ORDER BY name, id LIMIT 2`, [tid])).map((row: any) => row.id);
      assert.ok(appIds.length === 4 && companyB, 'four sample applications and two companies');
      const [a1, a2, a3, a4] = appIds;
      await m.query(`DELETE FROM application_companies WHERE tenant_id = $1 AND application_id = ANY($2)`, [tid, appIds]);
      await m.query(`DELETE FROM application_departments WHERE tenant_id = $1 AND application_id = ANY($2)`, [tid, appIds]);
      await m.query(`DELETE FROM company_metrics WHERE tenant_id = $1 AND company_id = ANY($2)`, [tid, [companyA, companyB]]);
      const [{ id: deptA }] = await m.query(`INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, 'Derived users A') RETURNING id`, [tid, companyA]);
      const [{ id: deptB }] = await m.query(`INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, 'Derived users B') RETURNING id`, [tid, companyB]);
      await m.query(`INSERT INTO company_metrics (tenant_id, company_id, fiscal_year, headcount, it_users) VALUES
        ($1, $2, $4 - 1, 50, 30), ($1, $2, $4 + 1, 80, 99), ($1, $3, $4 + 2, 12, NULL)`, [tid, companyA, companyB, Y]);
      await m.query(`INSERT INTO department_metrics (tenant_id, department_id, fiscal_year, headcount) VALUES ($1, $2, $4, 1000), ($1, $3, $4, 7)`, [tid, deptA, deptB, Y]);
      await m.query(`UPDATE applications SET users_mode = 'manual', users_override = 42 WHERE id = $1`, [a1]);
      await m.query(`UPDATE applications SET users_mode = 'it_users' WHERE id = ANY($1)`, [[a2, a4]]);
      await m.query(`UPDATE applications SET users_mode = 'headcount' WHERE id = $1`, [a3]);
      await m.query(`INSERT INTO application_companies (tenant_id, application_id, company_id) VALUES ($1, $2, $4), ($1, $3, $4), ($1, $5, $6)`, [tid, a2, a3, companyA, a4, companyB]);
      await m.query(`INSERT INTO application_departments (tenant_id, application_id, department_id) VALUES ($1, $2, $3), ($1, $4, $5)`, [tid, a2, deptB, a3, deptA]);
    });
    const apps = await appRows('/applications?page=1&limit=1000');
    const derivedValues = [...new Set(apps.map((app) => app.derived_total_users))];
    for (const value of [42, 37, 50, 12]) assert.ok(derivedValues.includes(value), `an application derives ${value} users: ${derivedValues}`);
    for (const value of derivedValues) {
      const filters = JSON.stringify({ derived_total_users: { filterType: 'number', type: 'equals', filter: value } });
      const kept = await appRows(`/applications?page=1&limit=1000&filters=${encodeURIComponent(filters)}`);
      assert.deepEqual(
        kept.map((app) => app.id).sort(),
        apps.filter((app) => app.derived_total_users === value).map((app) => app.id).sort(),
        `derived users = ${value}: the rows showing it`,
      );
    }
  } finally {
    PostgresQueryRunner.prototype.query = realQuery;
    await app.close();
    await cleanupTenants([tenant?.tenantId]);
  }
  console.log(`list-filter-contract: ${checked} filters on ${Object.keys(CONTRACT).length} lists; lists without rows to read the fields on: ${emptyLists.join(', ') || 'none'}`);
  const fixed = [...KNOWN_GAPS].filter((key) => !gapsSeen.has(key));
  assert.deepEqual(fixed, [], 'known gaps that now pass: remove them from KNOWN_GAPS');
  assert.deepEqual(failures, [], `every filter a list screen offers narrows its list on the server:\n  ${failures.join('\n  ')}`);
}

runSpecs('list-filter-contract.integration.spec', [testEveryOfferedFilterReachesTheDatabase]).catch((err) => {
  console.error(err);
  process.exit(1);
});
