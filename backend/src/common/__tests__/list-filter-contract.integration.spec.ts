import 'reflect-metadata';
import * as assert from 'node:assert/strict';
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
import { applyHttpMiddleware, applyTenancyAndPipeline } from '../../http-app';
import { DemoDataService } from '../../demo-data/demo-data.service';

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
 * Filters the screens offer and the server does not honour yet, found by this spec when it was
 * written (`<endpoint> <column>`, or the endpoint alone when an unknown column fails the request
 * or changes it, so the comparison cannot tell). Each must still fail: fix one, then remove it.
 */
const KNOWN_GAPS = new Set([
  '/tasks item_number',
  '/tasks priority_score',
  '/business-processes primary_category_name',
  '/business-processes owner_name',
  '/business-processes updated_at',
  '/users mfa_enabled',
  '/analytics-categories updated_at',
  '/portfolio/requests item_number',
  '/portfolio/requests updated_at',
  '/portfolio/projects item_number',
  '/portfolio/projects updated_at',
  '/applications derived_total_users',
  '/accounts',
  '/suppliers',
  '/budget-lines/summary',
  '/audit-logs record_id',
  '/audit-logs user_email',
  '/audit-logs user_id',
  '/audit-logs user_name',
  '/audit-logs source_ref',
  '/audit-logs tenant_id',
  '/knowledge item_ref',
  '/knowledge title',
  '/knowledge status',
  '/knowledge current_version_number',
  '/knowledge updated_at',
  '/contracts linked_lines_count',
  '/contracts start_date',
  '/contracts auto_renewal',
  '/contracts end_date',
  '/contracts cancellation_deadline',
  '/contracts latest_task_text',
  '/contacts job_title',
  '/contacts active',
  '/contacts created_at',
]);

/** A filter model of each kind, as the grid sends it. */
function filterModel(kind: Kind): Record<string, unknown> {
  switch (kind) {
    case 'text': return { filterType: 'text', type: 'contains', filter: 'zq-contract' };
    case 'set': return { filterType: 'set', values: ['00000000-0000-4000-8000-00000000c0de'] };
    case 'date': return { filterType: 'date', type: 'equals', dateFrom: '2001-02-03 00:00:00', dateTo: null };
    case 'number': return { filterType: 'number', type: 'equals', filter: 4242 };
  }
}

/** Every statement the database receives while recording, with its parameters. */
const recorded: string[] = [];
let recording = false;
const realQuery = PostgresQueryRunner.prototype.query;
PostgresQueryRunner.prototype.query = function patchedQuery(this: PostgresQueryRunner, query: string, parameters?: any[], ...rest: any[]) {
  // The time of the request (a validity date compared with now) differs from one request to the next.
  if (recording) recorded.push(`${query.replace(/\s+/g, ' ').trim()} -- ${JSON.stringify(parameters ?? []).replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, '<now>')}`);
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

function send(port: number, method: string, path: string, host: string, token: string, body?: unknown) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const headers: Record<string, string> = { Host: host, Authorization: `Bearer ${token}` };
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
  recorded.length = 0;
  recording = true;
  try {
    const res = await send(port, 'GET', `${endpoint}?${params.toString()}`, host, token);
    return { status: res.status, body: res.body, statements: recorded.join('\n') };
  } finally {
    recording = false;
  }
}

async function testEveryOfferedFilterReachesTheDatabase() {
  const svc = buildServices();
  const { AppModule } = require('../../app.module');
  const app: INestApplication = await NestFactory.create(AppModule, { logger: ['error'] });
  applyHttpMiddleware(app);
  applyTenancyAndPipeline(app, app.get(DataSource));
  await app.listen(0, '127.0.0.1');
  app.get(SchedulerRegistry).getCronJobs().forEach((job) => job.stop());
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
        fail(endpoint, `${endpoint}: the same request runs different statements, the comparison cannot tell (unknown column: ${control.status} ${control.body.slice(0, 200)})`);
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
