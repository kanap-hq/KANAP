import * as assert from 'node:assert/strict';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApplicationsController } from '../applications.controller';
import { InterfacesController } from '../../interfaces/interfaces.controller';

// Recette C1a: the routes that write a description (locks, text, images, import, revert) check
// that the caller sees the record, as the route that reads it does.

const ctx = { manager: {}, tenantId: 't', userId: 'u' } as any;
const req = { headers: {} } as any;
const file = { buffer: Buffer.from('x'), originalname: 'x.png' } as any;

function recordingDocuments(calls: string[]) {
  return new Proxy({}, { get: (_target, name) => async () => { calls.push(String(name)); return { ok: true }; } });
}

type Writer = {
  acquireIntegratedDocumentLock(id: string, slotKey: string, ctx: any): Promise<unknown>;
  heartbeatIntegratedDocumentLock(id: string, slotKey: string, req: any, ctx: any): Promise<unknown>;
  releaseIntegratedDocumentLock(id: string, slotKey: string, req: any, ctx: any): Promise<unknown>;
  updateIntegratedDocument(id: string, slotKey: string, body: any, req: any, ctx: any): Promise<unknown>;
  uploadIntegratedDocumentInlineAttachment(id: string, slotKey: string, file: any, ctx: any): Promise<unknown>;
  importIntegratedDocumentInlineAttachment(id: string, slotKey: string, body: any, ctx: any): Promise<unknown>;
  importIntegratedDocument(id: string, slotKey: string, file: any, req: any, ctx: any): Promise<unknown>;
  revertIntegratedDocument(id: string, slotKey: string, versionNumber: string, req: any, ctx: any): Promise<unknown>;
};

function writes(controller: Writer, slotKey: string): Array<[string, () => Promise<unknown>]> {
  return [
    ['lock', () => controller.acquireIntegratedDocumentLock('x', slotKey, ctx)],
    ['heartbeat', () => controller.heartbeatIntegratedDocumentLock('x', slotKey, req, ctx)],
    ['release', () => controller.releaseIntegratedDocumentLock('x', slotKey, req, ctx)],
    ['update', () => controller.updateIntegratedDocument('x', slotKey, { content_markdown: 'x' }, req, ctx)],
    ['image', () => controller.uploadIntegratedDocumentInlineAttachment('x', slotKey, file, ctx)],
    ['image import', () => controller.importIntegratedDocumentInlineAttachment('x', slotKey, { source_url: 'https://example.com/x.png' }, ctx)],
    ['import', () => controller.importIntegratedDocument('x', slotKey, file, req, ctx)],
    ['revert', () => controller.revertIntegratedDocument('x', slotKey, '1', req, ctx)],
  ];
}

async function expectRefused(label: string, call: () => Promise<unknown>, kind: Function) {
  await assert.rejects(call, (error: unknown) => error instanceof kind, label);
}

async function testApplicationWritesNeedAVisibleApplication() {
  const calls: string[] = [];
  let visible = false;
  const svc = { assertVisible: async () => { if (!visible) throw new NotFoundException('Application not found'); } };
  const controller = new ApplicationsController(svc as any, null as any, null as any, null as any, null as any, recordingDocuments(calls) as any, null as any, null as any, null as any);
  (controller as any).readApplicationOpts = async () => ({ manager: ctx.manager, tenantId: 't', accessScope: { userId: 'u' } });
  for (const [label, call] of writes(controller as unknown as Writer, 'overview')) await expectRefused(`application ${label}`, call, NotFoundException);
  assert.deepEqual(calls, [], 'nothing reached the documents');
  visible = true;
  for (const [, call] of writes(controller as unknown as Writer, 'overview')) await call();
  assert.equal(calls.length, 8, 'a visible application is written');
}

async function testInterfaceWritesNeedAnUnrestrictedReader() {
  const calls: string[] = [];
  let restricted = true;
  const controller = new InterfacesController(null as any, null as any, recordingDocuments(calls) as any, null as any, null as any);
  (controller as any).assertUnrestrictedApplicationReader = async () => {
    if (restricted) throw new ForbiddenException('Business Contributor cannot access interfaces');
  };
  for (const [label, call] of writes(controller as unknown as Writer, 'specification')) await expectRefused(`interface ${label}`, call, ForbiddenException);
  assert.deepEqual(calls, [], 'nothing reached the documents');
  restricted = false;
  for (const [, call] of writes(controller as unknown as Writer, 'specification')) await call();
  assert.equal(calls.length, 8);
}

/**
 * The Relations tab resolves four participation scopes on the request's connection. Two queries in
 * flight at once are the node-postgres warning (`client.query() when the client is already executing
 * a query`).
 */
async function testRelationsScopesRunOneAfterTheOther() {
  let busy = 0;
  let queries = 0;
  const manager = {
    query: async () => {
      if (busy > 0) throw new Error('client.query() when the client is already executing a query');
      busy += 1;
      try {
        await new Promise((resolve) => setImmediate(resolve));
        queries += 1;
        return [{ role_id: '11111111-1111-4111-8111-111111111111', role_name: 'administrator', level: 'admin' }];
      } finally {
        busy -= 1;
      }
    },
  };
  let received: { scopes?: unknown } | undefined;
  const relations = {
    getRelations: async (_id: string, context: { scopes?: unknown }) => {
      received = context;
      return { ok: true };
    },
  };
  const controller = new ApplicationsController(
    null as any, null as any, null as any, null as any, null as any, null as any, null as any, null as any, relations as any,
  );
  const result = await controller.getRelations('app-1', {
    manager,
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    isAdmin: false,
    permissions: { applications: 'reader' },
  } as any);
  assert.deepEqual(result, { ok: true });
  assert.equal(queries, 4, 'one role read per scope');
  assert.ok(received?.scopes);
}

(async () => {
  await testApplicationWritesNeedAVisibleApplication();
  await testInterfaceWritesNeedAnUnrestrictedReader();
  await testRelationsScopesRunOneAfterTheOther();
  console.log('integrated-document-write-visibility.spec: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
