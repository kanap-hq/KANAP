import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { parse } from 'csv-parse/sync';
import * as jwt from 'jsonwebtoken';
import { DataSource, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { buildAccessTokenPayload } from '../../auth/auth.service';
import { StripeConfigService } from '../../billing/stripe/stripe.config';
import { ListContextsService } from '../../common/list-context/list-contexts.service';
import { RATE_LIMITS } from '../../common/rate-limit';
import { useRequestPipeline } from '../../common/request-pipeline';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { User } from '../../users/user.entity';
import { UsersService } from '../../users/users.service';
import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';
import { AuditLog } from '../audit.entity';
import { AuditLogsController } from '../audit-logs.controller';
import {
  AUDIT_LOG_EXPORT_BATCH_ROWS,
  AUDIT_LOG_EXPORT_HEADERS,
  AUDIT_LOG_EXPORT_MAX_ROWS,
  AUDIT_LOG_EXPORT_TRUNCATED_HEADER,
  AuditLogsService,
} from '../audit-logs.service';

// `GET /audit-logs/export` over HTTP, with the real controller, its real guards (JwtAuthGuard on a
// signed access token, PermissionGuard on roles stored in the database, the export rate limit) and
// the request pipeline main.ts installs: the list's rows as a CSV file with flat, stable columns
// (the person as the page shows them: name, address only without a name, fixed codes otherwise;
// address and user agent of sign-in events; values as compact JSON), the list's filters and sort, every cell that a spreadsheet would read as a formula
// prefixed, the tenant's rows only, `users:admin` only, a row limit announced in a header, and the
// export itself recorded in the audit log. The file is read in batches and written as they come:
// batches neither repeat nor skip a row, a read error halfway closes the connection (the file is
// incomplete for the client, the request rolls back, the server keeps answering). The list and the
// export share their filters: the grid's date filter applies, and a parameter that is not a date or
// a user id is refused with a 400.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file in its serial database lane.

process.env.JWT_SECRET = process.env.JWT_SECRET || `audit-log-export-${randomUUID()}`;
// The rate limit is switched on for its own check at the end (isRateLimitEnabled reads it per request).
process.env.RATE_LIMIT_ENABLED = 'false';

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }])],
  controllers: [AuditLogsController],
  providers: [
    ListContextsService,
    { provide: AuditLogsService, useFactory: () => new AuditLogsService(dataSource.getRepository(AuditLog)) },
    // PermissionGuard's dependencies, as the lookup access spec builds them (no Stripe: no freeze check).
    { provide: UsersService, useFactory: () => new (UsersService as any)(dataSource.getRepository(User)) },
    {
      provide: PermissionsService,
      useFactory: () => new PermissionsService(dataSource.getRepository(UserPageRole), dataSource.getRepository(RolePermission)),
    },
    { provide: DataSource, useValue: dataSource },
    { provide: StripeConfigService, useValue: { isConfigured: () => false } },
  ],
})
class AuditExportProbeModule {}

type Person = { id: string; email: string; tenant_id: string };
type Level = 'reader' | 'contributor' | 'member' | 'admin';

async function seedPerson(
  runner: QueryRunner,
  tenantId: string,
  names: { first: string; last: string },
  permissions: Record<string, Level>,
  roleName: string,
): Promise<Person> {
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
  const roleId = await one(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING id`, [tenantId, roleName]);
  for (const [resource, level] of Object.entries(permissions)) {
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, roleId, resource, level]);
  }
  const email = `audit-export-${randomUUID()}@example.invalid`;
  const id = await one(
    `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status) VALUES ($1, $2, $3, $4, $5, 'enabled') RETURNING id`,
    [tenantId, roleId, names.first, names.last, email],
  );
  return { id, email, tenant_id: tenantId };
}

type AuditSeed = {
  table: string;
  action: string;
  recordId?: string | null;
  userId?: string | null;
  source?: string;
  sourceRef?: string | null;
  before?: unknown;
  after?: unknown;
  /** Minutes before now. */
  ageMinutes?: number;
  /** An exact date instead (ISO 8601); rows given the same date tie on it. */
  createdAt?: string;
};

async function insertAudit(runner: QueryRunner, tenantId: string, row: AuditSeed) {
  await runner.query(
    `INSERT INTO audit_log (tenant_id, table_name, record_id, action, before_json, after_json, user_id, source, source_ref, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, coalesce($11::timestamptz, now() - make_interval(mins => $10)))`,
    [
      tenantId,
      row.table,
      row.recordId ?? null,
      row.action,
      row.before === undefined ? null : JSON.stringify(row.before),
      row.after === undefined ? null : JSON.stringify(row.after),
      row.userId ?? null,
      row.source ?? 'user',
      row.sourceRef ?? null,
      row.ageMinutes ?? 0,
      row.createdAt ?? null,
    ],
  );
}

function token(user: Person): string {
  return jwt.sign(buildAccessTokenPayload(user), process.env.JWT_SECRET as string, { expiresIn: '10m' });
}

async function exportRows(tenantId: string): Promise<any[]> {
  return dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    return manager.query(
      `SELECT user_id, after_json FROM audit_log WHERE tenant_id = $1 AND table_name = 'export' ORDER BY created_at, id`,
      [tenantId],
    );
  });
}

/** Wait until every pooled connection is back, i.e. the request transaction is finished. */
async function waitForIdlePool() {
  const pool: any = (dataSource.driver as any).master;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (pool.totalCount === pool.idleCount && pool.waitingCount === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`a request left a connection out of the pool (total ${pool.totalCount}, idle ${pool.idleCount})`);
}

type Answer = {
  status: number;
  bytes: Buffer;
  text: string;
  type: string | null;
  disposition: string | null;
  truncated: string | null;
  /** The parsed file: header row first. */
  table: string[][];
};

function parseCsv(text: string): string[][] {
  return parse(text, { delimiter: ',', relax_column_count: false }) as string[][];
}

async function main() {
  await dataSource.initialize();
  const tenantA = await createRaceTenant('audit-export');
  const tenantB = await createRaceTenant('audit-export-b');
  let app: INestApplication | undefined;
  try {
    const a = await seed(tenantA, async (runner) => {
      const admin = await seedPerson(runner, tenantA, { first: 'Alice', last: 'Admin' }, {}, 'Administrator');
      const dash = await seedPerson(runner, tenantA, { first: '-Dash', last: 'Person' }, { users: 'admin' }, 'Audit export people admin');
      const reader = await seedPerson(runner, tenantA, { first: 'Rita', last: 'Reader' }, { users: 'member' }, 'Audit export people member');
      const french = await seedPerson(runner, tenantA, { first: 'Francine', last: 'Admin' }, { users: 'admin' }, 'Audit export people admin fr');
      await runner.query(`UPDATE users SET locale = 'fr' WHERE tenant_id = $1 AND id = $2`, [tenantA, french.id]);
      const recordId = randomUUID();
      await insertAudit(runner, tenantA, {
        table: 'auth', action: 'login_failed', sourceRef: 'unknown_user',
        after: { ip: '198.51.100.7', user_agent: '=probe agent' }, ageMinutes: 50,
      });
      await insertAudit(runner, tenantA, {
        table: 'auth', action: 'login', recordId: admin.id, userId: admin.id,
        after: { ip: '2001:db8::1', user_agent: 'Probe browser' }, ageMinutes: 40,
      });
      await insertAudit(runner, tenantA, {
        table: 'suppliers', action: 'update', recordId, userId: dash.id, source: 'system', sourceRef: '+import-7',
        before: { name: 'Old supplier', ip: '203.0.113.9' }, after: { name: '@New supplier', amount: -12 }, ageMinutes: 30,
      });
      await insertAudit(runner, tenantA, {
        table: 'suppliers', action: 'create', recordId: randomUUID(), userId: admin.id, sourceRef: '@sheet-2',
        after: { name: 'Tenant A supplier' }, ageMinutes: 20,
      });
      return { admin, dash, reader, french, recordId };
    });
    const b = await seed(tenantB, async (runner) => {
      const admin = await seedPerson(runner, tenantB, { first: 'Bob', last: 'Admin' }, {}, 'Administrator');
      await insertAudit(runner, tenantB, {
        table: 'suppliers', action: 'create', recordId: randomUUID(), userId: admin.id,
        after: { name: 'Tenant B supplier' }, ageMinutes: 10,
      });
      return { admin };
    });

    app = await NestFactory.create(AuditExportProbeModule, { logger: false });
    // The tenant middleware's job, from a header: the token must name the same tenant.
    app.use((req: any, _res: any, next: () => void) => {
      const tenantId = req.headers['x-probe-tenant'];
      if (tenantId) req.tenant = { id: tenantId, slug: 'audit-export-probe', name: 'Audit export probe' };
      next();
    });
    useRequestPipeline(app, dataSource);
    await app.listen(0, '127.0.0.1');
    const service = app.get(AuditLogsService);
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

    const get = async (query: Record<string, string>, user: Person, tenantId = user.tenant_id): Promise<Answer> => {
      const search = new URLSearchParams(query);
      const res = await fetch(`${base}/audit-logs/export?${search.toString()}`, {
        headers: { authorization: `Bearer ${token(user)}`, 'x-probe-tenant': tenantId, 'user-agent': 'Export probe' },
        signal: AbortSignal.timeout(10_000),
      });
      // The bytes as sent (`res.text()` would drop a BOM).
      const bytes = Buffer.from(await res.arrayBuffer());
      const text = bytes.toString('utf8');
      await waitForIdlePool();
      const type = res.headers.get('content-type');
      return {
        status: res.status,
        bytes,
        text,
        type,
        disposition: res.headers.get('content-disposition'),
        truncated: res.headers.get(AUDIT_LOG_EXPORT_TRUNCATED_HEADER),
        table: res.status === 200 ? parseCsv(text) : [],
      };
    };
    const rowsOf = (answer: Answer) => {
      const [header, ...rows] = answer.table;
      return rows.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i]])) as Record<string, string>);
    };

    // 1. The file: header, columns, names (no e-mail address), sign-in details, compact JSON.
    assert.equal(AUDIT_LOG_EXPORT_MAX_ROWS, 100_000);
    assert.equal(service.exportRowLimit, AUDIT_LOG_EXPORT_MAX_ROWS);
    const full = await get({}, a.admin);
    assert.equal(full.status, 200, full.text);
    assert.match(full.type ?? '', /^text\/csv/);
    assert.match(full.disposition ?? '', /audit-log-\d{4}-\d{2}-\d{2}\.csv/);
    assert.equal(full.truncated, null, 'no row limit reached: no header');
    assert.notEqual(full.bytes[0], 0xef, 'UTF-8 without a BOM');
    assert.ok(full.text.startsWith(`${AUDIT_LOG_EXPORT_HEADERS.join(',')}\n`), 'comma-separated English header line');
    assert.deepEqual(full.table[0], [...AUDIT_LOG_EXPORT_HEADERS]);
    const rows = rowsOf(full);
    // The export's own row is written in the request transaction before the file is read.
    assert.deepEqual(rows.map((row) => `${row.table}/${row.action}`), [
      'export/export', 'suppliers/create', 'suppliers/update', 'auth/login', 'auth/login_failed',
    ], 'newest first, every row of the tenant');
    const [own, created, updated, login, failed] = rows;
    assert.match(own.date, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'ISO 8601 date');
    assert.equal(own.user, 'Alice Admin');
    assert.deepEqual(JSON.parse(own.after), { resource: 'audit-logs', path: '/audit-logs/export', ip: '127.0.0.1', user_agent: 'Export probe' });
    assert.equal(own.ip, '127.0.0.1', 'an export row fills the address column');
    assert.equal(own.user_agent, 'Export probe', 'an export row fills the agent column');
    assert.equal(created.user, 'Alice Admin');
    assert.equal(login.user, 'Alice Admin');
    assert.equal(login.record_id, a.admin.id);
    assert.equal(login.ip, '2001:db8::1');
    assert.equal(login.user_agent, 'Probe browser');
    assert.equal(login.source, 'user');
    assert.equal(failed.user, 'Unknown account', 'an attempt on an unknown account names nobody');
    assert.equal(failed.source_ref, 'unknown_user');
    assert.equal(failed.ip, '198.51.100.7');
    assert.equal(failed.before, '');
    assert.deepEqual(JSON.parse(failed.after), { ip: '198.51.100.7', user_agent: '=probe agent' });
    // Compact JSON (the database orders the keys of a jsonb value).
    for (const row of rows) {
      for (const cell of [row.before, row.after].filter(Boolean)) assert.equal(cell, JSON.stringify(JSON.parse(cell)), 'compact JSON');
    }
    assert.equal(updated.record_id, a.recordId);
    assert.equal(updated.source, 'system');
    assert.equal(updated.ip, '', "another table's `ip` field stays in its values");
    assert.equal(updated.user_agent, '');
    assert.deepEqual(JSON.parse(updated.before), { name: 'Old supplier', ip: '203.0.113.9' });
    assert.deepEqual(JSON.parse(updated.after), { name: '@New supplier', amount: -12 });
    for (const person of [a.admin, a.dash, a.reader]) {
      assert.ok(!full.text.includes(person.email), 'a person with a name shows by name only');
    }
    console.log('ok - flat, stable columns: ISO date, codes, names only, address and agent of sign-in and export events, compact JSON');

    // 2. Cells a spreadsheet would read as a formula are prefixed; a plain negative amount is not touched.
    assert.equal(failed.user_agent, "'=probe agent");
    assert.equal(updated.source_ref, "'+import-7");
    assert.equal(updated.user, "'-Dash Person");
    assert.equal(created.source_ref, "'@sheet-2");
    console.log('ok - cells starting with =, +, - or @ are prefixed');

    // 3. The list's filters, search and sort.
    const authOnly = rowsOf(await get({ filters: JSON.stringify({ table_name: { filterType: 'set', values: ['auth'] } }) }, a.admin));
    assert.deepEqual(authOnly.map((row) => row.action), ['login', 'login_failed'], 'column filter');
    const failedOnly = rowsOf(await get({ action: 'login_failed' }, a.admin));
    assert.deepEqual(failedOnly.map((row) => row.source_ref), ['unknown_user'], 'action parameter');
    const searched = rowsOf(await get({ q: 'Dash' }, a.admin));
    assert.deepEqual(searched.map((row) => row.action), ['update'], 'search on the person');
    const ascending = rowsOf(await get({ sort: 'created_at:ASC', filters: JSON.stringify({ table_name: { filterType: 'set', values: ['suppliers'] } }) }, a.admin));
    assert.deepEqual(ascending.map((row) => row.action), ['update', 'create'], 'sort');
    console.log('ok - the filters, search and sort of the list apply');

    // 3b. One fixed format whatever the language: a user in French, with or without a `language`
    // parameter, gets the same bytes as a user in English for the same rows.
    const suppliersOnly = { filters: JSON.stringify({ table_name: { filterType: 'set', values: ['suppliers'] } }) };
    const inEnglish = await get(suppliersOnly, a.admin);
    const inFrench = await get(suppliersOnly, a.french);
    const inFrenchAsked = await get({ ...suppliersOnly, language: 'fr' }, a.french);
    const unknownAsked = await get({ ...suppliersOnly, language: 'xx' }, a.french);
    assert.equal(inEnglish.status, 200, inEnglish.text);
    assert.equal(rowsOf(inEnglish).length, 2);
    for (const answer of [inFrench, inFrenchAsked, unknownAsked]) {
      assert.equal(answer.status, 200, answer.text);
      assert.notEqual(answer.bytes[0], 0xef, 'no BOM');
      assert.ok(answer.text.startsWith(`${AUDIT_LOG_EXPORT_HEADERS.join(',')}\n`), 'comma separator, English headers');
      assert.ok(answer.bytes.equals(inEnglish.bytes), 'the same bytes as for a user in English');
    }
    console.log('ok - one fixed format: commas, no BOM, English headers, whatever the language');

    // 4. Only `users:admin`: a people member is refused, another administrator is not.
    const refusedBefore = (await exportRows(tenantA)).length;
    const refused = await get({}, a.reader);
    assert.equal(refused.status, 403);
    assert.equal((await exportRows(tenantA)).length, refusedBefore, 'a refused export writes no row');
    assert.equal((await get({ action: 'create' }, a.dash)).status, 200, 'users:admin without the Administrator role');
    console.log('ok - users:admin only');

    // 5. The tenant's rows only.
    const fromB = await get({}, b.admin);
    assert.equal(fromB.status, 200);
    assert.ok(fromB.text.includes('Tenant B supplier'));
    assert.ok(!fromB.text.includes('Tenant A supplier') && !fromB.text.includes('198.51.100.7'), "no row of tenant A");
    assert.deepEqual(rowsOf(fromB).map((row) => `${row.table}/${row.action}`), ['export/export', 'suppliers/create']);
    assert.ok(!full.text.includes('Tenant B supplier'), 'no row of tenant B in tenant A');
    const crossed = await get({}, b.admin, tenantA);
    assert.equal(crossed.status, 401, "a token of tenant B on tenant A's address");
    console.log('ok - each administrator exports the rows of their own tenant');

    // 6. Each export is recorded in the audit log of its tenant.
    const recordedA = await exportRows(tenantA);
    assert.equal(recordedA.length, 10, 'one row per export made in tenant A (ten answered 200)');
    for (const row of recordedA) {
      assert.deepEqual(row.after_json, { resource: 'audit-logs', path: '/audit-logs/export', ip: '127.0.0.1', user_agent: 'Export probe' });
    }
    assert.equal(recordedA.filter((row) => row.user_id === a.dash.id).length, 1);
    const recordedB = await exportRows(tenantB);
    assert.deepEqual(recordedB.map((row) => row.user_id), [b.admin.id]);
    console.log('ok - every export writes its `export` row');

    // 7. The row limit: the export stops and says so in a header.
    service.exportRowLimit = 3;
    const capped = await get({}, a.admin);
    assert.equal(capped.status, 200);
    assert.equal(capped.truncated, '3');
    assert.equal(rowsOf(capped).length, 3, 'three rows, the newest');
    assert.equal(rowsOf(capped)[0].table, 'export');
    const underCap = await get({ table_name: 'auth' }, a.admin);
    assert.equal(underCap.truncated, null, 'two rows under a limit of three');
    assert.equal(rowsOf(underCap).length, 2);
    const exact = await get({ filters: JSON.stringify({ table_name: { filterType: 'set', values: ['auth', 'suppliers'] } }), action: 'login' }, a.admin);
    assert.equal(exact.truncated, null);
    service.exportRowLimit = 2;
    const atLimit = await get({ table_name: 'auth' }, a.admin);
    assert.equal(atLimit.truncated, null, 'exactly as many rows as the limit: complete');
    assert.equal(rowsOf(atLimit).length, 2);
    service.exportRowLimit = AUDIT_LOG_EXPORT_MAX_ROWS;
    console.log('ok - the row limit is held and announced');

    // 9. Its own tenant predicate: under the tenant of A, asking for the rows of B gives none (RLS
    // alone would give A's rows).
    const exportInTransaction = (asTenant: string, forTenant: string) => dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [asTenant]);
      const result = await service.exportCsv({}, { manager, tenantId: forTenant });
      let text = '';
      for await (const part of result.chunks) text += part;
      return { truncated: result.truncated, table: parseCsv(text) };
    });
    const sameTenant = await exportInTransaction(tenantA, tenantA);
    assert.ok(sameTenant.table.length > 1, 'the rows of A are there for A');
    service.exportRowLimit = 1;
    const otherTenant = await exportInTransaction(tenantA, tenantB);
    service.exportRowLimit = AUDIT_LOG_EXPORT_MAX_ROWS;
    assert.deepEqual(otherTenant.table, [[...AUDIT_LOG_EXPORT_HEADERS]], 'no row: the tenant predicate holds besides RLS');
    assert.equal(otherTenant.truncated, false, 'the count has the same predicate');
    console.log('ok - the export keeps its own tenant predicate besides RLS');

    // 10. Batches: rows tied on their date come once each, in the same order whatever the batch size.
    const tied = await seed(tenantA, async (runner) => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const recordId = randomUUID();
        ids.push(recordId);
        await insertAudit(runner, tenantA, { table: 'tie', action: 'update', recordId, createdAt: '2001-02-03T12:00:00.000Z' });
      }
      await insertAudit(runner, tenantA, { table: 'tie', action: 'create', recordId: randomUUID(), createdAt: '2001-02-04T08:00:00.123456Z' });
      return ids;
    });
    assert.equal(service.exportBatchSize, AUDIT_LOG_EXPORT_BATCH_ROWS);
    const tieIds = async (query: Record<string, string>, batch: number) => {
      service.exportBatchSize = batch;
      try {
        const answer = await get({ table_name: 'tie', ...query }, a.admin);
        assert.equal(answer.status, 200, answer.text);
        return rowsOf(answer).map((row) => row.record_id);
      } finally {
        service.exportBatchSize = AUDIT_LOG_EXPORT_BATCH_ROWS;
      }
    };
    for (const sort of ['created_at:DESC', 'created_at:ASC', 'action:ASC', 'table_name:DESC']) {
      const whole = await tieIds({ sort }, AUDIT_LOG_EXPORT_BATCH_ROWS);
      assert.equal(whole.length, 6);
      assert.equal(new Set(whole).size, 6);
      for (const batch of [1, 2, 4]) {
        assert.deepEqual(await tieIds({ sort }, batch), whole, `${sort}, batches of ${batch}`);
      }
    }
    const newestFirst = await tieIds({}, 2);
    assert.deepEqual([...newestFirst.slice(1)].sort(), [...tied].sort(), 'the newest row, then the five tied rows');
    // Every row of the tenant, in batches of two: the same file, plus the newer export row on top.
    const inOne = rowsOf(await get({}, a.admin));
    service.exportBatchSize = 2;
    const inTwos = rowsOf(await get({}, a.admin));
    service.exportBatchSize = AUDIT_LOG_EXPORT_BATCH_ROWS;
    assert.equal(inTwos.length, inOne.length + 1);
    assert.equal(inTwos[0].table, 'export');
    assert.deepEqual(inTwos.slice(1), inOne);
    console.log('ok - batches neither repeat nor skip a row, whatever the sort');

    // 11. The row limit inside a batch, and on its last row.
    service.exportBatchSize = 2;
    service.exportRowLimit = 3;
    const cutInBatch = await get({ table_name: 'tie' }, a.admin);
    assert.equal(cutInBatch.truncated, '3');
    assert.deepEqual(rowsOf(cutInBatch).map((row) => row.record_id), newestFirst.slice(0, 3));
    service.exportRowLimit = 6;
    const allSix = await get({ table_name: 'tie' }, a.admin);
    assert.equal(allSix.truncated, null, 'six rows under a limit of six');
    assert.equal(rowsOf(allSix).length, 6);
    service.exportRowLimit = AUDIT_LOG_EXPORT_MAX_ROWS;
    service.exportBatchSize = AUDIT_LOG_EXPORT_BATCH_ROWS;
    console.log('ok - the row limit holds across batches');

    // 12. A read that fails halfway: the connection closes (no complete-looking file), the request
    // rolls back (no `export` row), and the server answers the next export.
    const exportCsv = service.exportCsv.bind(service);
    service.exportCsv = async (...args: Parameters<typeof exportCsv>) => {
      const result = await exportCsv(...args);
      async function* failing() {
        let parts = 0;
        for await (const part of result.chunks) {
          if (parts++ === 2) throw new Error('the next batch could not be read');
          yield part;
        }
      }
      return { ...result, chunks: failing() };
    };
    service.exportBatchSize = 2;
    const exportsBefore = (await exportRows(tenantA)).length;
    const broken = await fetch(`${base}/audit-logs/export?table_name=tie`, {
      headers: { authorization: `Bearer ${token(a.admin)}`, 'x-probe-tenant': tenantA },
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(broken.status, 200, 'the status went out with the first part');
    await assert.rejects(broken.arrayBuffer(), 'the body ends with the connection, not with a complete file');
    await waitForIdlePool();
    service.exportCsv = exportCsv;
    service.exportBatchSize = AUDIT_LOG_EXPORT_BATCH_ROWS;
    assert.equal((await exportRows(tenantA)).length, exportsBefore, 'the failed export is rolled back');
    const after = await get({ table_name: 'tie' }, a.admin);
    assert.equal(after.status, 200);
    assert.equal(rowsOf(after).length, 6);
    console.log('ok - a read error halfway closes the connection and leaves the server answering');

    // 13. The grid's date filter, on the list and the export (by day).
    const list = async (query: Record<string, string>, user: Person = a.admin) => {
      const res = await fetch(`${base}/audit-logs?${new URLSearchParams(query).toString()}`, {
        headers: { authorization: `Bearer ${token(user)}`, 'x-probe-tenant': user.tenant_id },
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.json();
      await waitForIdlePool();
      return { status: res.status, body };
    };
    const onDay = JSON.stringify({ created_at: { filterType: 'date', type: 'equals', dateFrom: '2001-02-03 00:00:00', dateTo: null } });
    const twoDays = JSON.stringify({ created_at: { filterType: 'date', type: 'inRange', dateFrom: '2001-02-03 00:00:00', dateTo: '2001-02-04 00:00:00' } });
    const before = JSON.stringify({ created_at: { filterType: 'date', type: 'lessThan', dateFrom: '2001-02-04 00:00:00', dateTo: null } });
    assert.equal((await list({ filters: onDay })).body.total, 5);
    assert.equal((await list({ filters: twoDays })).body.total, 6);
    assert.equal((await list({ filters: before })).body.total, 5);
    assert.deepEqual(rowsOf(await get({ filters: onDay }, a.admin)).map((row) => row.record_id).sort(), [...tied].sort());
    assert.equal(rowsOf(await get({ filters: twoDays }, a.admin)).length, 6);
    console.log('ok - the date filter of the grid applies to the list and the export');

    // 14. Parameters that are not a date or a user id: 400 on the list and the export, not a 500.
    const exportsBeforeRefusals = (await exportRows(tenantA)).length;
    const refusedQueries: Record<string, string>[] = [
      { to: '9999-99-99' },
      { from: '2026-02-30' },
      { from: 'not a date' },
      { to: '+275760-09-13' },
      { user_id: 'abc' },
      { filters: JSON.stringify({ user_id: { filterType: 'text', type: 'equals', filter: 'abc' } }) },
      { filters: JSON.stringify({ user_id: { filterType: 'set', values: [a.admin.id, 'abc'] } }) },
      { filters: JSON.stringify({ created_at: { filterType: 'date', type: 'equals', dateFrom: 'soon' } }) },
      { filters: JSON.stringify({ created_at: { filterType: 'date', type: 'inRange', dateFrom: '2001-02-03 00:00:00', dateTo: '2001-02-30 00:00:00' } }) },
    ];
    for (const query of refusedQueries) {
      const listed = await list(query);
      assert.equal(listed.status, 400, `list ${JSON.stringify(query)}: ${JSON.stringify(listed.body)}`);
      assert.equal(typeof listed.body.message, 'string');
      const exported = await get(query, a.admin);
      assert.equal(exported.status, 400, `export ${JSON.stringify(query)}: ${exported.text}`);
    }
    assert.equal((await exportRows(tenantA)).length, exportsBeforeRefusals, 'a refused export writes no row');
    const byUser = await list({ user_id: a.dash.id, from: '2000-01-01', to: '2999-12-31' });
    assert.equal(byUser.status, 200);
    assert.deepEqual(byUser.body.items.map((item: any) => item.action), ['export', 'update']);
    const byUserFilter = await get({ filters: JSON.stringify({ user_id: { filterType: 'set', values: [a.dash.id] } }) }, a.admin);
    assert.deepEqual(rowsOf(byUserFilter).map((row) => row.action), ['export', 'update']);
    console.log('ok - a parameter that is not a date or a user id is refused with a 400');

    // 15. The person without a name: their address, as on the page; otherwise fixed codes, never an id.
    const who = await seed(tenantA, async (runner) => {
      const nameless = await seedPerson(runner, tenantA, { first: ' ', last: '' }, {}, 'Audit export nameless');
      const ids = { nameless: randomUUID(), gone: randomUUID(), webhook: randomUUID(), system: randomUUID() };
      await insertAudit(runner, tenantA, { table: 'who', action: 'update', recordId: ids.nameless, userId: nameless.id, ageMinutes: 5 });
      await insertAudit(runner, tenantA, { table: 'who', action: 'update', recordId: ids.gone, userId: randomUUID(), ageMinutes: 5 });
      await insertAudit(runner, tenantA, { table: 'who', action: 'update', recordId: ids.webhook, source: 'webhook', ageMinutes: 5 });
      await insertAudit(runner, tenantA, { table: 'who', action: 'update', recordId: ids.system, source: 'system', ageMinutes: 5 });
      return { nameless, ids };
    });
    const whoRows = rowsOf(await get({ table_name: 'who' }, a.admin));
    const userOf = Object.fromEntries(whoRows.map((row) => [row.record_id, row.user]));
    assert.equal(userOf[who.ids.nameless], who.nameless.email, 'no name: the address, as on the page');
    assert.equal(userOf[who.ids.gone], 'Unknown account', 'a person no longer in the workspace: no id');
    assert.equal(userOf[who.ids.webhook], 'Webhook');
    assert.equal(userOf[who.ids.system], 'System');
    console.log('ok - the user column falls back like the page, without ids');

    // 8. The export rate limit of the other file exports, per address.
    process.env.RATE_LIMIT_ENABLED = 'true';
    const statuses: number[] = [];
    for (let i = 0; i < RATE_LIMITS.documentExport.limit + 1; i++) statuses.push((await get({ action: 'login' }, a.admin)).status);
    assert.deepEqual(statuses, [...Array(RATE_LIMITS.documentExport.limit).fill(200), 429]);
    console.log('ok - the export rate limit applies');
  } finally {
    process.env.RATE_LIMIT_ENABLED = 'false';
    if (app) await app.close();
    await dropRaceTenant(tenantA);
    await dropRaceTenant(tenantB);
    await dataSource.destroy();
  }
}

main().then(() => console.log('audit-log-export-http.integration.spec: ok')).catch((err) => {
  console.error(err);
  process.exit(1);
});
