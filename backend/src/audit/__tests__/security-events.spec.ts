import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { Controller, Get, Post } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { defer, lastValueFrom, of, Subject } from 'rxjs';
import { completeExport, ExportEventsInterceptor } from '../export-events.interceptor';
import {
  AUDIT_EVENT_ACTIONS as SCREEN_ACTIONS,
  AUTH_EVENT_REASONS as SCREEN_REASONS,
  EXPORT_RESOURCE_KEYS,
} from '../../../../frontend/src/pages/admin/auditLogLabels';
import {
  AUTH_EVENT_ACTIONS,
  AUTH_EVENT_REASONS,
  AUTH_EVENT_TABLE,
  authEventEntry,
  EXPORT_QUERY_MAX_LENGTH,
  exportEventEntry,
  exportFormatOfContentType,
  exportQuery,
  exportResource,
  ExportRoute,
  exportRoutePath,
  QUERY_AS_SENT,
  handlerRoutePaths,
  isExportRoutePath,
  joinRoutePath,
  USER_AGENT_MAX_LENGTH,
} from '../security-events';
import { SecurityEventsService } from '../security-events.service';
import { fileSigns, scanRoutes } from './controller-routes';

// Security events in the audit log, without a database:
// - a sign-in event row holds the account, a code from the list and
//   `after_json = { ip, user_agent }`, nothing else; values outside the lists
//   are left out;
// - every route of the API that sends a file the server produces (path ending
//   with `/export`, or marked `@ExportRoute()`) is recorded by
//   ExportEventsInterceptor, which writes its row in the request's transaction
//   before the handler runs, and writes nothing for other routes; the other
//   routes that send a file send a stored file (attachment, inline image, logo);
// - the row says the query (bounded, `ctx` as its id), never the body; one UPDATE
//   in a savepoint adds the format the response is sent in (its Content-Type) and
//   the row count: called by a handler that answers itself before it sends
//   (completeExport), or run after a handler that returns a value, never after a
//   response that has left; in the request transaction read again at that moment;
// - the event writer never rejects, and writes nothing without a tenant.

const request = (headers: Record<string, unknown> = {}, ip: unknown = '198.51.100.7') => ({ ip, headers });

function testAuthEventRowHoldsAddressAndAgentOnly() {
  const entry = authEventEntry({ action: 'login_failed', userId: 'user-1', reason: 'bad_password' }, request({ 'user-agent': 'Probe/1.0' }));
  assert.deepEqual(entry, {
    table: AUTH_EVENT_TABLE,
    recordId: 'user-1',
    action: 'login_failed',
    before: null,
    after: { ip: '198.51.100.7', user_agent: 'Probe/1.0' },
    userId: 'user-1',
    source: 'user',
    sourceRef: 'bad_password',
  });
  // The address is the request's client address (common/client-address.ts), never a header.
  const fromHeaders = authEventEntry(
    { action: 'login' },
    request({ 'x-forwarded-for': '192.0.2.1', 'x-real-ip': '192.0.2.2', 'cf-connecting-ip': '192.0.2.3' }, '203.0.113.9'),
  );
  assert.deepEqual(fromHeaders?.after, { ip: '203.0.113.9', user_agent: null });
  assert.deepEqual(authEventEntry({ action: 'logout' }, null)?.after, { ip: null, user_agent: null }, 'no request: empty values');
}

function testValuesOutsideTheListsAreLeftOut() {
  // Extra fields on the event never reach the row, whatever they hold.
  const event: any = { action: 'login', userId: 'user-2', password: 'Plain-pass-1', token: 'token-value', email: 'ada@example.com' };
  const entry = authEventEntry(event, request({ authorization: 'Bearer token-value', cookie: 'refresh_token=token-value' }));
  const serialized = JSON.stringify(entry);
  for (const value of ['Plain-pass-1', 'token-value', 'ada@example.com', 'Bearer']) {
    assert.ok(!serialized.includes(value), `${value} is not in the row`);
  }
  assert.deepEqual(Object.keys(entry?.after ?? {}).sort(), ['ip', 'user_agent']);
  // A reason outside the list is dropped; an action outside the list gives no row.
  assert.equal(authEventEntry({ action: 'login_failed', reason: 'free text' as any }, request())?.sourceRef, null);
  assert.equal(authEventEntry({ action: 'signed_in' as any }, request()), null);
  assert.equal(authEventEntry({ action: 'login', userId: '' }, request())?.userId, null);
}

function testUserAgentIsCut() {
  const long = `Probe/${'x'.repeat(500)}`;
  const entry = authEventEntry({ action: 'login' }, request({ 'user-agent': `  ${long}  ` }));
  assert.equal(entry?.after.user_agent, long.slice(0, USER_AGENT_MAX_LENGTH));
  assert.equal(entry?.after.user_agent.length, 200);
}

function testAddressIsAValidIpOrNothing() {
  const address = (ip: unknown) => authEventEntry({ action: 'login' }, request({}, ip))?.after.ip;
  for (const ip of ['198.51.100.7', '2001:db8::1', '::ffff:198.51.100.7', '0000:0000:0000:0000:0000:ffff:255.255.255.255']) {
    assert.equal(address(ip), ip, `${ip} is kept`);
  }
  // Anything else is left out: a list, a name, free text, an address longer than 45 characters.
  const long = `198.51.100.9, ${'z'.repeat(3000)}`;
  for (const ip of [long, '198.51.100.9, 192.0.2.1', 'unknown', 'proxy.example.test', `fe80::1%${'x'.repeat(40)}`, '', 42, null]) {
    assert.equal(address(ip), null, `${String(ip).slice(0, 30)} is not kept`);
  }
}

function testExportRouteMatching() {
  for (const route of ['/suppliers/export', '/chart-of-accounts/:id/accounts/export', '/knowledge/:idOrRef/export', '/export', '/portfolio/reports/weekly/export']) {
    assert.ok(isExportRoutePath(route), `${route} is an export route`);
  }
  for (const route of ['/assets/csv-fields', '/exports', '/export-settings', '/suppliers/exported', '/suppliers', '/suppliers/:id', '/report/export/:id']) {
    assert.ok(!isExportRoutePath(route), `${route} is not an export route`);
  }
  assert.equal(exportResource('/suppliers/export'), 'suppliers');
  assert.equal(exportResource('/chart-of-accounts/:id/accounts/export'), 'chart-of-accounts/accounts');
  assert.equal(exportResource('/spend-items/budget-file/export'), 'spend-items/budget-file');
  assert.equal(exportResource('/knowledge/:idOrRef/export'), 'knowledge');
  assert.equal(exportResource('/export'), 'document');
  assert.equal(exportResource('/incidents/:id/report'), 'incidents/report');
  assert.equal(joinRoutePath('export', '/'), '/export');
  assert.equal(joinRoutePath('/portfolio/reports/', 'weekly/export'), '/portfolio/reports/weekly/export');
}

@Controller('export')
class DocumentExportProbe {
  @Post()
  exportDocument() {
    return 'document';
  }
}

@Controller('chart-of-accounts')
class ChartProbe {
  @Get(':id/accounts/export')
  exportAccounts() {
    return 'accounts';
  }

  @Get(':id')
  get() {
    return 'chart';
  }

  @ExportRoute()
  @Get(':id/report')
  report() {
    return 'report';
  }
}

function testRoutePathsComeFromNestMetadata() {
  assert.deepEqual(handlerRoutePaths(DocumentExportProbe, DocumentExportProbe.prototype.exportDocument), ['/export']);
  assert.deepEqual(handlerRoutePaths(ChartProbe, ChartProbe.prototype.exportAccounts), ['/chart-of-accounts/:id/accounts/export']);
  assert.deepEqual(handlerRoutePaths(ChartProbe, ChartProbe.prototype.get), ['/chart-of-accounts/:id']);
  // The route an export is recorded under: a path ending with `/export`, or any path marked `@ExportRoute()`.
  assert.equal(exportRoutePath(ChartProbe, ChartProbe.prototype.exportAccounts), '/chart-of-accounts/:id/accounts/export');
  assert.equal(exportRoutePath(ChartProbe, ChartProbe.prototype.report), '/chart-of-accounts/:id/report');
  assert.equal(exportRoutePath(ChartProbe, ChartProbe.prototype.get), undefined);
}

function testFileSignsAreFound() {
  const res = ['res'];
  assert.deepEqual(fileSigns('return new StreamableFile(stream);', res), ['StreamableFile']);
  assert.deepEqual(fileSigns("res.setHeader('Content-Disposition', contentDisposition(name));", res), ['Content-Disposition']);
  assert.deepEqual(fileSigns("@Header('content-disposition', 'attachment')", res), ['Content-Disposition']);
  assert.deepEqual(fileSigns('res.download(filePath);', res), ['download']);
  assert.deepEqual(fileSigns('res.send(result.buffer);', res), ['body sent']);
  assert.deepEqual(fileSigns('res.status(200).end(buffer);', res), ['body sent']);
  assert.deepEqual(fileSigns('obj.stream.pipe(reply);', ['reply']), ['stream sent']);
  // A JSON answer, an empty end, a redirect or a returned value send no file.
  for (const text of ['res.json({ ok: true });', 'res.end();', 'res.status(204).end();', "res.redirect('/login');", 'return { items };']) {
    assert.deepEqual(fileSigns(text, res), [], text);
  }
}

// The routes that send a file the server produces, on 2026-10-09: list and report CSV or
// spreadsheet files, budget files, document files, the PDF report of an incident. Each is
// recorded by ExportEventsInterceptor.
const KNOWN_EXPORT_ROUTES = [
  'GET /accounts/export',
  'GET /admin/coa-templates/:id/export',
  'GET /analytics-categories/export',
  'GET /applications/export',
  'GET /assets/export',
  'GET /audit-logs/export',
  'GET /budget-lines/budget-file/export',
  'GET /business-processes/export',
  'GET /capex-items/budget-file/export',
  'GET /chart-of-accounts/:id/accounts/export',
  'GET /companies/export',
  'GET /contacts/export',
  'GET /contracts/compliance-register/export',
  'GET /contracts/export',
  'GET /cost-centers/export',
  'GET /data-access/export',
  'GET /departments/export',
  'GET /incidents/:id/report',
  'GET /incidents/export',
  'GET /portfolio/projects/export',
  'GET /portfolio/reports/capacity-heatmap/export',
  'GET /portfolio/reports/time-logged/export',
  'GET /portfolio/reports/weekly/export',
  'GET /portfolio/requests/export',
  'GET /reports/budget/analytics/export',
  'GET /reports/budget/columns-compare/export',
  'GET /reports/budget/comparison/export',
  'GET /reports/budget/consolidation/export',
  'GET /reports/budget/cost-per-fte/export',
  'GET /reports/budget/increases-decreases/export',
  'GET /reports/budget/staffing/export',
  'GET /reports/budget/top-lines/export',
  'GET /reports/chargeback/company/export',
  'GET /reports/chargeback/global/export',
  'GET /spend-items/budget-file/export',
  'GET /suppliers/export',
  'GET /tasks/export',
  'GET /technologies/:id/applications/export',
  'GET /technologies/application-links/export',
  'GET /technologies/asset-links/export',
  'GET /technologies/reports/administration/export',
  'GET /technologies/reports/end-of-support/export',
  'GET /users/export',
  'GET /vulnerabilities/export',
  'GET /working-day-profiles/export',
  'POST /export',
  'POST /knowledge/:idOrRef/export',
];

// The routes that send a stored file someone added (an attachment, an inline image, the
// workspace logo) rather than data the server produces: not exports.
const STORED_FILE_ROUTES = [
  'GET /ai/conversations/:id/attachments/:attachmentId/inline',
  'GET /applications/attachments/:attachmentId',
  'GET /assets/attachments/:attachmentId',
  'GET /capex-items/attachments/:attachmentId',
  'GET /contracts/attachments/:attachmentId',
  'GET /incidents/attachments/:attachmentId',
  'GET /interfaces/attachments/:attachmentId',
  'GET /knowledge/attachments/:attachmentId',
  'GET /knowledge/inline/:tenantSlug/:attachmentId',
  'GET /portfolio/projects/attachments/:attachmentId',
  'GET /portfolio/projects/inline/:tenantSlug/:attachmentId',
  'GET /portfolio/requests/attachments/:attachmentId',
  'GET /portfolio/requests/inline/:tenantSlug/:attachmentId',
  'GET /public/branding/logo',
  'GET /spend-items/attachments/:attachmentId',
  'GET /tasks/attachments/:attachmentId',
  'GET /tasks/attachments/:tenantSlug/:attachmentId/inline',
  'GET /technologies/attachments/:attachmentId',
];

// Routes whose name looks like an export but that send no exported data.
const NOT_EXPORTS = new Set(['/applications/csv-fields', '/assets/csv-fields', '/incidents/csv-fields', '/portfolio/projects/csv-fields', '/portfolio/requests/csv-fields', '/tasks/csv-fields']);

function testEveryRouteThatSendsAFileIsRecorded() {
  const routes = scanRoutes();
  assert.ok(routes.length > 500, `the scan reads the controllers (${routes.length} routes)`);
  const recorded = [...new Set(routes.filter((route) => route.recordedAsExport).map((route) => route.route))].sort();
  assert.deepEqual(recorded, [...KNOWN_EXPORT_ROUTES].sort(), 'the recorded export routes');

  // A route that sends a file (StreamableFile, Content-Disposition, a download, a body or a
  // stream written to the response) is recorded, unless it sends a stored file.
  const storedFiles = new Set(STORED_FILE_ROUTES);
  const unrecorded = routes
    .filter((route) => route.fileSigns.length > 0 && !route.recordedAsExport && !storedFiles.has(route.route))
    .map((route) => `${route.route} (${route.handler}: ${route.fileSigns.join(', ')})`);
  assert.deepEqual(unrecorded, [], 'a route that sends a file the server produces ends with /export or is marked @ExportRoute()');
  for (const route of KNOWN_EXPORT_ROUTES) {
    assert.ok(routes.some((scanned) => scanned.route === route && scanned.fileSigns.length > 0), `the scan sees the file ${route} sends`);
  }
  for (const route of STORED_FILE_ROUTES) {
    const scanned = routes.filter((candidate) => candidate.route === route);
    assert.ok(scanned.length > 0 && scanned.every((candidate) => candidate.fileSigns.length > 0 && !candidate.recordedAsExport), `${route} still sends a stored file`);
  }

  // A route named like an export (`report.csv`, `exports`, `download`) ends with /export.
  const exportLike = routes.filter((route) => {
    const routePath = route.route.split(' ')[1];
    return /export|csv|xlsx|download/i.test(routePath) && !isExportRoutePath(routePath) && !NOT_EXPORTS.has(routePath);
  });
  assert.deepEqual(exportLike, [], 'every export-like route ends with /export');
}

function fakeContext(controller: object, handler: object, req: any) {
  return {
    getType: () => 'http',
    getClass: () => controller,
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => req.res }),
  } as any;
}

function recordingRequest(extra: Record<string, unknown> = {}) {
  const inserted: any[] = [];
  const updates: Array<{ sql: string; params: unknown[] }> = [];
  const order: string[] = [];
  const manager = {
    getRepository: () => ({
      insert: async (row: any) => {
        order.push('audit');
        inserted.push(row);
        return { identifiers: [{ id: 'row-1' }] };
      },
    }),
    query: async (sql: string, params: unknown[]) => {
      const step = sql.startsWith('UPDATE') ? 'rows' : sql.split(' ')[0].toLowerCase();
      order.push(step);
      if (step === 'rows') {
        updates.push({ sql, params });
        if (failUpdate.value) throw new Error('update refused');
      }
      return [];
    },
  };
  const failUpdate = { value: false };
  const headers: Record<string, unknown> = {};
  const res = { getHeader: (name: string) => headers[name.toLowerCase()], setHeader: (name: string, value: unknown) => { headers[name.toLowerCase()] = value; } };
  const req: any = {
    tenant: { id: 'tenant-1' }, user: { sub: 'user-9' }, path: '/chart-of-accounts/abc/accounts/export',
    ip: '198.51.100.20', headers: { 'user-agent': 'Probe browser' }, queryRunner: { manager, isReleased: false }, res, ...extra,
  };
  (res as any).req = req;
  return { req, res, inserted, updates, order, manager, failUpdate };
}

async function testInterceptorWritesTheExportBeforeTheHandler() {
  const interceptor = new ExportEventsInterceptor();
  const { req, inserted, order } = recordingRequest();
  const next = { handle: () => { order.push('handler'); return of('file'); } };
  const value = await lastValueFrom(interceptor.intercept(fakeContext(ChartProbe, ChartProbe.prototype.exportAccounts, req), next));
  assert.equal(value, 'file');
  assert.deepEqual(order, ['audit', 'handler'], 'the row is written in the request transaction, before the export');
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].table_name, 'export');
  assert.equal(inserted[0].action, 'export');
  assert.equal(inserted[0].user_id, 'user-9');
  assert.deepEqual(inserted[0].after_json, {
    resource: 'chart-of-accounts/accounts', path: '/chart-of-accounts/abc/accounts/export', query: {}, ip: '198.51.100.20', user_agent: 'Probe browser',
  }, 'the address and agent as for sign-in events; no format before the handler');
  assert.deepEqual(exportEventEntry('/export', { path: '/export', user: { sub: 'user-9' } }).after, {
    resource: 'document', path: '/export', query: {}, ip: null, user_agent: null,
  });
  const unchecked = exportEventEntry('/export', { path: '/export', ip: 'not-an-address', headers: { 'user-agent': `  ${'a'.repeat(300)}  ` } }).after;
  assert.equal(unchecked.ip, null, 'an address that is not a valid IP is left out');
  assert.equal(unchecked.user_agent, 'a'.repeat(200), 'the agent is cut like on sign-in events');
  const longPath = `/knowledge/${'x'.repeat(900)}/export`;
  assert.equal(exportEventEntry('/knowledge/:idOrRef/export', { path: longPath }).after.path, longPath.slice(0, 500), 'the path is cut to 500 characters');

  // A route marked `@ExportRoute()`: recorded under its own path.
  const marked = recordingRequest({ path: '/chart-of-accounts/abc/report' });
  const pdf = { handle: () => defer(async () => { marked.res.setHeader('Content-Type', 'application/pdf'); return 'pdf'; }) };
  assert.equal(await lastValueFrom(interceptor.intercept(fakeContext(ChartProbe, ChartProbe.prototype.report, marked.req), pdf)), 'pdf');
  assert.deepEqual(marked.inserted.map((row) => row.after_json), [
    { resource: 'chart-of-accounts/report', path: '/chart-of-accounts/abc/report', query: {}, ip: '198.51.100.20', user_agent: 'Probe browser' },
  ]);
  assert.deepEqual(marked.updates.map((update) => update.params), [['{"format":"pdf"}', 'row-1', 'tenant-1']], 'the format the response was sent in');

  // Another route: nothing written. No tenant transaction: nothing written, the handler still runs.
  const other = recordingRequest();
  assert.equal(await lastValueFrom(interceptor.intercept(fakeContext(ChartProbe, ChartProbe.prototype.get, other.req), { handle: () => of('chart') })), 'chart');
  assert.equal(other.inserted.length, 0);
  const noTransaction = recordingRequest({ queryRunner: undefined });
  assert.equal(await lastValueFrom(interceptor.intercept(fakeContext(DocumentExportProbe, DocumentExportProbe.prototype.exportDocument, noTransaction.req), { handle: () => of('doc') })), 'doc');
  assert.equal(noTransaction.inserted.length, 0);
}

function testExportFormat() {
  assert.equal(exportFormatOfContentType('text/csv; charset=utf-8'), 'csv');
  assert.equal(exportFormatOfContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'xlsx');
  assert.equal(exportFormatOfContentType('Application/PDF'), 'pdf', 'any case');
  assert.equal(exportFormatOfContentType('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'docx');
  assert.equal(exportFormatOfContentType('application/vnd.oasis.opendocument.text'), 'odt');
  assert.equal(exportFormatOfContentType('text/markdown; charset=utf-8'), 'markdown');
  assert.equal(exportFormatOfContentType(['application/zip']), 'application/zip', 'another type: the bare media type');
  assert.equal(exportFormatOfContentType(`application/${'x'.repeat(80)}; a=b`), `application/${'x'.repeat(28)}`, 'cut to 40 characters');
  for (const none of [undefined, null, '', ' ; charset=utf-8', 42]) {
    assert.equal(exportFormatOfContentType(none), undefined, `no format for ${String(none)}`);
  }
  // The body never reaches the row.
  const document = exportEventEntry('/export', { path: '/export', body: { format: 'pdf', content: '# Secret plan', title: 'Plan' } } as any).after;
  assert.equal(document.format, undefined, 'no format before the handler');
  assert.ok(!JSON.stringify(document).includes('Secret plan') && !JSON.stringify(document).includes('Plan'), 'no body in the row');
}

function testExportQuery() {
  assert.deepEqual(
    exportQuery({ sort: 'name:ASC', columns: 'budget,actual', amountYears: ['2026', '2027'], all: 'true', format: 'xlsx', nested: { a: 1 }, empty: undefined }),
    { all: 'true', amountYears: ['2026', '2027'], columns: 'budget,actual', format: 'xlsx', nested: '{"a":1}', sort: 'name:ASC' },
  );
  assert.deepEqual(Object.keys(exportQuery({ z: '1', a: '2', m: '3' })), ['a', 'm', 'z'], 'keys sorted');
  assert.deepEqual(exportQuery(undefined), {});
  assert.deepEqual(exportQuery('x=1'), {});

  // A saved list context: the row keeps its id, not the filters ListContextInterceptor merged in.
  const req: any = { path: '/suppliers/export', query: { filters: '{"status":"enabled"}', sort: 'name:ASC' } };
  req[QUERY_AS_SENT] = { ctx: 'c0ffee00-1234-4abc-8def-000000000001', sort: 'name:ASC', format: 'xlsx' };
  const withContext = exportEventEntry('/suppliers/export', req).after;
  assert.deepEqual(withContext.query, { ctx: 'c0ffee00-1234-4abc-8def-000000000001', format: 'xlsx', sort: 'name:ASC' });
  assert.equal(withContext.format, undefined, 'the format asked for is not the format sent');

  // Bounded: the longest entries go first, the short ones stay, and the object says it was cut.
  const long = exportQuery({ q: 'widget', filters: 'f'.repeat(1500), sort: 'name:ASC', search: 's'.repeat(900), ctx: 'abc' });
  assert.deepEqual(long, { ctx: 'abc', q: 'widget', search: 's'.repeat(900), sort: 'name:ASC', truncated: true });
  assert.ok(JSON.stringify(long).length <= EXPORT_QUERY_MAX_LENGTH);
  const many = exportQuery(Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`k${String(index).padStart(3, '0')}`, 'v'.repeat(index % 7)])));
  assert.ok(JSON.stringify(many).length <= EXPORT_QUERY_MAX_LENGTH, 'many short values: still within the bound');
  assert.equal(many.truncated, true);
  assert.equal(many.k000, '', 'the shortest are kept');
  assert.deepEqual(exportQuery({ ['k'.repeat(3000)]: '1' }), { truncated: true }, 'a key longer than the bound is dropped');
  const exact = exportQuery({ a: 'x'.repeat(EXPORT_QUERY_MAX_LENGTH - 8) });
  assert.equal(JSON.stringify(exact).length, EXPORT_QUERY_MAX_LENGTH, 'exactly at the bound: kept whole');
  assert.equal(exact.truncated, undefined);
}

async function testRowCount() {
  const interceptor = new ExportEventsInterceptor();
  const context = (req: any) => fakeContext(ChartProbe, ChartProbe.prototype.exportAccounts, req);

  // A handler that answers itself completes its row before sending: format and count, in the same
  // transaction, now; the interceptor adds nothing after it.
  const counted = recordingRequest();
  const handler = {
    handle: () => defer(async () => {
      counted.order.push('handler');
      counted.res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      await completeExport(counted.res, { rows: 42 });
      await completeExport(counted.res, { rows: 7 });
      counted.order.push('send');
      return undefined;
    }),
  };
  await lastValueFrom(interceptor.intercept(context(counted.req), handler), { defaultValue: undefined });
  assert.deepEqual(counted.order, ['audit', 'handler', 'savepoint', 'rows', 'release', 'send'], 'one UPDATE in a savepoint, before the response');
  assert.equal(counted.updates.length, 1, 'once per request');
  assert.match(counted.updates[0].sql, /UPDATE audit_log SET after_json = coalesce\(after_json, '\{\}'::jsonb\) \|\| \$1::jsonb\s+WHERE id = \$2 AND tenant_id = \$3 AND table_name = 'export'/);
  assert.deepEqual(counted.updates[0].params, ['{"format":"csv","rows":42}', 'row-1', 'tenant-1'], 'format and count together, its own row, scoped by tenant');

  // A handler that returns a value: completed after it. The route ignores `?format=xlsx` and sends a CSV: the row says csv.
  const asked = recordingRequest({ query: { format: 'xlsx' } });
  const csv = { handle: () => defer(async () => { asked.res.setHeader('Content-Type', 'text/csv; charset=utf-8'); return 'file'; }) };
  await lastValueFrom(interceptor.intercept(context(asked.req), csv));
  assert.deepEqual(asked.updates.map((update) => update.params[0]), ['{"format":"csv"}'], 'what was sent, not what was asked');

  // A handler that reports nothing: no rows on the row.
  const silent = recordingRequest();
  await lastValueFrom(interceptor.intercept(context(silent.req), { handle: () => of('file') }));
  assert.deepEqual(silent.order, ['audit'], 'no Content-Type and no count: no update');
  assert.equal(silent.updates.length, 0);

  // A response that has left (a handler that answered itself without completing): no update, and
  // no step at all: the chain completes in the same tick as the handler.
  const sent = recordingRequest();
  sent.res.setHeader('Content-Type', 'application/pdf');
  const handled = new Subject<unknown>();
  let completed = false;
  const subscription = interceptor.intercept(context(sent.req), { handle: () => handled }).subscribe({ complete: () => { completed = true; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sent.order, ['audit']);
  (sent.res as any).headersSent = true;
  handled.complete();
  assert.equal(completed, true, 'no asynchronous step after a response that has left');
  subscription.unsubscribe();
  assert.deepEqual(sent.order, ['audit'], 'no update after a response that has left');

  // A count that is not a whole number of rows is not recorded; zero rows is a count.
  for (const count of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const odd = recordingRequest();
    const reportOdd = { handle: () => defer(async () => { await completeExport(odd.res, { rows: count }); return undefined; }) };
    await lastValueFrom(interceptor.intercept(context(odd.req), reportOdd), { defaultValue: undefined });
    assert.deepEqual(odd.order, ['audit'], `no count for ${count}`);
  }
  const zero = recordingRequest();
  const reportZero = { handle: () => defer(async () => { await completeExport(zero.res, { rows: 0 }); return undefined; }) };
  await lastValueFrom(interceptor.intercept(context(zero.req), reportZero), { defaultValue: undefined });
  assert.deepEqual(zero.updates.map((update) => update.params[0]), ['{"rows":0}'], 'zero rows is a count');
  // Outside an export: nothing, no error.
  await completeExport(null, { rows: 3 });
  await completeExport({}, { rows: 3 });
  const outside = recordingRequest();
  await completeExport(outside.res, { rows: 3 });
  assert.deepEqual(outside.order, [], 'a request without an export row');

  // A refused export: the error goes on to TenantInterceptor, which rolls the row back; nothing after the handler.
  const refused = recordingRequest();
  const failing = {
    handle: () => defer(async () => {
      throw new BadRequestException('format must be csv or xlsx.');
    }),
  };
  await assert.rejects(lastValueFrom(interceptor.intercept(context(refused.req), failing)), /format must be csv or xlsx/);
  assert.deepEqual(refused.order, ['audit'], 'nothing after the failed handler');
  assert.equal(refused.updates.length, 0);
}

async function testUpdateUsesTheTransactionOfTheMoment() {
  const interceptor = new ExportEventsInterceptor();
  const context = (req: any) => fakeContext(ChartProbe, ChartProbe.prototype.exportAccounts, req);
  const reporting = (probe: ReturnType<typeof recordingRequest>, after?: () => void) => ({
    handle: () => defer(async () => {
      probe.res.setHeader('Content-Type', 'text/csv');
      after?.();
      return 'file';
    }),
  });

  // The handler released the request transaction (work outside it): no update, no error.
  const released = recordingRequest();
  await lastValueFrom(interceptor.intercept(context(released.req), reporting(released, () => { released.req.queryRunner.isReleased = true; })));
  assert.deepEqual(released.order, ['audit'], 'a released transaction is not used');

  // The request holds another runner by then: the update goes to that one.
  const first = recordingRequest();
  const second = recordingRequest();
  await lastValueFrom(interceptor.intercept(context(first.req), reporting(first, () => { first.req.queryRunner = second.req.queryRunner; })));
  assert.deepEqual(first.order, ['audit']);
  assert.deepEqual(second.order, ['savepoint', 'rows', 'release'], 'the runner is read again after the handler');

  // A failed update is rolled back to its savepoint: the export row stays, the request goes on.
  const failing = recordingRequest();
  failing.failUpdate.value = true;
  assert.equal(await lastValueFrom(interceptor.intercept(context(failing.req), reporting(failing))), 'file');
  assert.deepEqual(failing.order, ['audit', 'savepoint', 'rows', 'rollback']);
}

async function testEventWriterNeverRejects() {
  const warnings: string[] = [];
  let runners = 0;
  const failing = {
    createQueryRunner: () => {
      runners += 1;
      throw new Error('no connection');
    },
  };
  const service = new SecurityEventsService(failing as any);
  (service as any).logger = { warn: (line: string) => warnings.push(line) };
  // A failed write resolves (a warning line), it never rejects.
  assert.equal(await service.recordAuthEvent('tenant-1', { action: 'login' }, request()), undefined);
  assert.equal(runners, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /recordAuthEvent failed: no connection/);
  // Without a tenant, or for an action outside the list, nothing is written.
  await service.recordAuthEvent(undefined, { action: 'login' }, request());
  await service.recordAuthEvent('tenant-1', { action: 'unknown' as any }, request());
  assert.equal(runners, 1);
}

// The audit log page (frontend/src/pages/admin/auditLogLabels.ts, imported here) has a plain label
// for every action, reason and exported resource the API writes.
function testTheAuditLogPageLabelsEveryEvent() {
  assert.deepEqual([...SCREEN_ACTIONS].sort(), [...AUTH_EVENT_ACTIONS, 'export'].sort(), 'actions');
  assert.deepEqual([...SCREEN_REASONS].sort(), [...AUTH_EVENT_REASONS].sort(), 'reasons');
  const resources = [...new Set(KNOWN_EXPORT_ROUTES.map((route) => exportResource(route.split(' ')[1])))].sort();
  assert.deepEqual(Object.keys(EXPORT_RESOURCE_KEYS).sort(), resources, 'one label per exported resource');
}

async function run() {
  testAuthEventRowHoldsAddressAndAgentOnly();
  testValuesOutsideTheListsAreLeftOut();
  testUserAgentIsCut();
  testAddressIsAValidIpOrNothing();
  testExportRouteMatching();
  testRoutePathsComeFromNestMetadata();
  testFileSignsAreFound();
  testEveryRouteThatSendsAFileIsRecorded();
  testTheAuditLogPageLabelsEveryEvent();
  testExportFormat();
  testExportQuery();
  await testInterceptorWritesTheExportBeforeTheHandler();
  await testRowCount();
  await testUpdateUsesTheTransactionOfTheMoment();
  await testEventWriterNeverRejects();
  console.log('security-events.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
