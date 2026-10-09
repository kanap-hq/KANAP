import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { Controller, Get, Post } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ExportEventsInterceptor } from '../export-events.interceptor';
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
  exportEventEntry,
  exportResource,
  ExportRoute,
  exportRoutePath,
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
  'GET /business-processes/export',
  'GET /capex-items/budget-file/export',
  'GET /chart-of-accounts/:id/accounts/export',
  'GET /companies/export',
  'GET /contacts/export',
  'GET /contracts/export',
  'GET /cost-centers/export',
  'GET /departments/export',
  'GET /incidents/:id/report',
  'GET /incidents/export',
  'GET /portfolio/projects/export',
  'GET /portfolio/reports/weekly/export',
  'GET /portfolio/requests/export',
  'GET /spend-items/budget-file/export',
  'GET /suppliers/export',
  'GET /tasks/export',
  'GET /users/export',
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
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

function recordingRequest(extra: Record<string, unknown> = {}) {
  const inserted: any[] = [];
  const order: string[] = [];
  const manager = { getRepository: () => ({ insert: async (row: any) => { order.push('audit'); inserted.push(row); } }) };
  const req = {
    tenant: { id: 'tenant-1' }, user: { sub: 'user-9' }, path: '/chart-of-accounts/abc/accounts/export',
    ip: '198.51.100.20', headers: { 'user-agent': 'Probe browser' }, queryRunner: { manager, isReleased: false }, ...extra,
  };
  return { req, inserted, order };
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
    resource: 'chart-of-accounts/accounts', path: '/chart-of-accounts/abc/accounts/export', ip: '198.51.100.20', user_agent: 'Probe browser',
  }, 'the address and agent as for sign-in events');
  assert.deepEqual(exportEventEntry('/export', { path: '/export', user: { sub: 'user-9' } }).after, { resource: 'document', path: '/export', ip: null, user_agent: null });
  const unchecked = exportEventEntry('/export', { path: '/export', ip: 'not-an-address', headers: { 'user-agent': `  ${'a'.repeat(300)}  ` } }).after;
  assert.equal(unchecked.ip, null, 'an address that is not a valid IP is left out');
  assert.equal(unchecked.user_agent, 'a'.repeat(200), 'the agent is cut like on sign-in events');
  const longPath = `/knowledge/${'x'.repeat(900)}/export`;
  assert.equal(exportEventEntry('/knowledge/:idOrRef/export', { path: longPath }).after.path, longPath.slice(0, 500), 'the path is cut to 500 characters');

  // A route marked `@ExportRoute()`: recorded under its own path.
  const marked = recordingRequest({ path: '/chart-of-accounts/abc/report' });
  assert.equal(await lastValueFrom(interceptor.intercept(fakeContext(ChartProbe, ChartProbe.prototype.report, marked.req), { handle: () => of('pdf') })), 'pdf');
  assert.deepEqual(marked.inserted.map((row) => row.after_json), [
    { resource: 'chart-of-accounts/report', path: '/chart-of-accounts/abc/report', ip: '198.51.100.20', user_agent: 'Probe browser' },
  ]);

  // Another route: nothing written. No tenant transaction: nothing written, the handler still runs.
  const other = recordingRequest();
  assert.equal(await lastValueFrom(interceptor.intercept(fakeContext(ChartProbe, ChartProbe.prototype.get, other.req), { handle: () => of('chart') })), 'chart');
  assert.equal(other.inserted.length, 0);
  const noTransaction = recordingRequest({ queryRunner: undefined });
  assert.equal(await lastValueFrom(interceptor.intercept(fakeContext(DocumentExportProbe, DocumentExportProbe.prototype.exportDocument, noTransaction.req), { handle: () => of('doc') })), 'doc');
  assert.equal(noTransaction.inserted.length, 0);
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
  await testInterceptorWritesTheExportBeforeTheHandler();
  await testEventWriterNeverRejects();
  console.log('security-events.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
