import * as assert from 'node:assert/strict';
import { IncidentsController } from '../incidents.controller';

// GET /incidents/:id/report passes the caller's module reads to the PDF builder exactly as the
// Relations tab does: infrastructure for assets and technologies, applications (with a Business
// Contributor's scope), tasks for the follow-up. Without them the PDF would print linked objects
// the reader may not see.

const INCIDENT_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function harness(roleRows: any[] = []) {
  const captured: any[] = [];
  const svc = { ensureIncident: async () => ({ id: INCIDENT_ID, tenant_id: TENANT_ID }) };
  const report = {
    exportPdf: async (id: string, lang: string | undefined, opts: any) => {
      captured.push({ id, lang, opts });
      return { mimeType: 'application/pdf', filename: 'INC-12-incident-report.pdf', buffer: Buffer.from('pdf') };
    },
  };
  const inlineImages = { exporter: () => undefined };
  const args: any[] = Array.from({ length: 12 }, () => undefined);
  args[0] = svc;
  args[5] = report;
  args[10] = inlineImages;
  const controller = new (IncidentsController as any)(...args) as IncidentsController;
  const manager = {
    query: async (sql: string) => {
      if (sql.includes('role_name')) return roleRows;
      return [];
    },
  };
  const ctx = {
    manager,
    tenantId: TENANT_ID,
    userId: USER_ID,
    isAdmin: false,
    permissions: { incidents: 'reader', infrastructure: 'reader', applications: 'reader', tasks: 'reader' },
  } as any;
  const res = {
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value; },
    send() { return undefined; },
  };
  return { controller, captured, ctx, res };
}

async function testReaderWithoutModuleRights() {
  const { controller, captured, ctx, res } = harness();
  ctx.permissions = { incidents: 'reader' };
  await controller.exportReport(INCIDENT_ID, 'fr', undefined, res as any, {} as any, ctx);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].id, INCIDENT_ID);
  assert.equal(captured[0].lang, 'fr');
  const opts = captured[0].opts;
  assert.equal(opts.technologies, false);
  assert.equal(opts.applications, false);
  assert.equal(opts.tasks, false);
  assert.equal(opts.imageFetchCookie, null);
  assert.deepEqual(opts.viewer, { userId: USER_ID, isAdmin: false });
  assert.equal(res.headers['Content-Type'], 'application/pdf');
}

async function testEveryModuleRight() {
  const { controller, captured, ctx, res } = harness();
  await controller.exportReport(INCIDENT_ID, 'en', undefined, res as any, { headers: { cookie: 'refresh_token=abc' } } as any, ctx);
  const opts = captured[0].opts;
  assert.equal(opts.technologies, true);
  assert.equal(opts.applications, true);
  assert.equal(opts.tasks, true);
  assert.equal(opts.applicationScope, undefined, 'a member role is not a business contributor');
  assert.equal(opts.imageFetchCookie, 'refresh_token=abc');
}

async function testBusinessContributorScope() {
  const { controller, captured, ctx, res } = harness([
    { role_id: 'role-bc', role_name: 'business contributor', level: null },
  ]);
  await controller.exportReport(INCIDENT_ID, 'en', undefined, res as any, {} as any, ctx);
  assert.deepEqual(captured[0].opts.applicationScope, { userId: USER_ID });
}

async function run() {
  await testReaderWithoutModuleRights();
  await testEveryModuleRight();
  await testBusinessContributorScope();
  console.log('incidents.controller.report-rights.spec.ts: ok');
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
