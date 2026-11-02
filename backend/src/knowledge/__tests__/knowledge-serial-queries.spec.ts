import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { KnowledgeService } from '../knowledge.service';
import { KnowledgeWorkflowService } from '../knowledge-workflow.service';

/**
 * The request's manager is one node-postgres client. A second query started while the first is
 * still running is the warning these reads must not raise (and a future pg will reject it).
 */
const OVERLAP = 'client.query() when the client is already executing a query';

function busyManager(rowsFor?: (sql: string) => unknown) {
  let busy = 0;
  let maxBusy = 0;
  let calls = 0;
  const occupy = async <T>(work: () => Promise<T> | T): Promise<T> => {
    if (busy > 0) throw new Error(OVERLAP);
    busy += 1;
    maxBusy = Math.max(maxBusy, busy);
    calls += 1;
    try {
      await new Promise((resolve) => setImmediate(resolve));
      return await work();
    } finally {
      busy -= 1;
    }
  };
  const manager = {
    query: (sql: string) => occupy(() => (rowsFor ? rowsFor(sql) : []) as unknown[]),
    getRepository: () => ({
      find: () => occupy(async () => []),
      findOne: () => occupy(async () => null),
    }),
  };
  return { manager, maxBusy: () => maxBusy, calls: () => calls };
}

function knowledgeService(users: Record<string, unknown> = {}): KnowledgeService {
  const args: unknown[] = Array.from({ length: 28 }, () => ({}));
  args[25] = users;
  return new (KnowledgeService as unknown as new (...args: unknown[]) => KnowledgeService)(...args);
}

async function testClassificationOptionsAreSerial() {
  const busy = busyManager(() => [
    { id: 'c1', name: 'Run', is_active: true, category_id: 'c1' },
  ]);
  const result = await knowledgeService().listClassificationOptions({ manager: busy.manager as any });
  assert.equal(result.categories.length, 1);
  assert.equal(result.streams.length, 1);
  assert.equal(busy.calls(), 2);
  assert.equal(busy.maxBusy(), 1);
}

async function testFilterValuesAreSerial() {
  const busy = busyManager(() => []);
  const result = await knowledgeService().listFilterValues({}, { manager: busy.manager as any });
  assert.ok(Array.isArray(result.status));
  assert.ok(busy.calls() > 2);
  assert.equal(busy.maxBusy(), 1);
}

async function testDocumentGetRelationsAreSerial() {
  const documentId = randomUUID();
  const busy = busyManager((sql) => (
    sql.includes('SELECT d.*')
      ? [{
        id: documentId,
        item_number: 12,
        title: 'Runbook',
        status: 'draft',
        revision: 1,
        tenant_id: randomUUID(),
        library_id: randomUUID(),
      }]
      : []
  ));
  const service = knowledgeService();
  (service as any).resolveDocumentId = async () => documentId;
  (service as any).resolveDocumentAccess = async () => ({
    granted_by_source_context: false,
    effective_access_level: 'writer',
    can_manage: true,
    can_write: true,
    is_restricted: false,
  });
  const document = await service.get('DOC-12', { manager: busy.manager as any });
  assert.equal(document.item_ref, 'DOC-12');
  assert.equal(document.title, 'Runbook');
  assert.ok(busy.calls() > 5);
  assert.equal(busy.maxBusy(), 1);
}

async function testCompareVersionsIsSerial() {
  const busy = busyManager();
  const service = knowledgeService();
  let version = 0;
  (service as any).getVersion = async () => {
    await busy.manager.query('SELECT version');
    version += 1;
    return { title: `v${version}`, summary: 's', content_markdown: 'c' };
  };
  const compared = await service.compareVersions('DOC-1', 1, 2, { manager: busy.manager as any });
  assert.equal(compared.changed.title, true);
  assert.equal(busy.calls(), 2);
  assert.equal(busy.maxBusy(), 1);
}

async function testKnowledgeContextDefinitionsAreSerial() {
  const userId = randomUUID();
  const busy = busyManager(() => []);
  const service = knowledgeService({
    findById: async () => ({
      id: userId,
      status: 'enabled',
      role_id: 'role-1',
      role: { role_name: 'Administrator' },
    }),
  });
  for (const entity of ['requests', 'projects', 'applications', 'assets'] as const) {
    const before = busy.calls();
    const result = await service.getKnowledgeContextForEntity(entity, randomUUID(), {
      manager: busy.manager as any,
      userId,
    });
    assert.equal(result.access, 'granted');
    assert.ok(busy.calls() - before >= 5, entity);
  }
  assert.equal(busy.maxBusy(), 1);
}

async function testSourceDocumentRowsAreSerial() {
  const busy = busyManager(() => []);
  const rows = await (knowledgeService() as any).listDocumentRowsForKnowledgeSources([
    { entity_type: 'applications', entity_id: randomUUID(), name: 'Billing' },
    { entity_type: 'assets', entity_id: randomUUID(), name: 'Host' },
  ], busy.manager, null);
  assert.equal(rows.size, 0);
  assert.equal(busy.calls(), 2);
  assert.equal(busy.maxBusy(), 1);
}

async function testWorkflowCancellationChecksAreSerial() {
  const busy = busyManager(() => []);
  const workflow = new KnowledgeWorkflowService(knowledgeService({ findById: async () => null }));
  await assert.rejects(
    () => (workflow as any).assertWorkflowCancellationAllowed('doc-1', 'wf-1', 'reviewer', 'user-1', busy.manager),
    (error: unknown) => {
      assert.ok(error instanceof ForbiddenException);
      const response = error.getResponse() as { code?: string };
      assert.equal(response.code, 'WORKFLOW_CANCEL_NOT_ALLOWED');
      return true;
    },
  );
  assert.equal(busy.calls(), 3);
  assert.equal(busy.maxBusy(), 1);
}

async function run() {
  await testClassificationOptionsAreSerial();
  await testFilterValuesAreSerial();
  await testDocumentGetRelationsAreSerial();
  await testCompareVersionsIsSerial();
  await testKnowledgeContextDefinitionsAreSerial();
  await testSourceDocumentRowsAreSerial();
  await testWorkflowCancellationChecksAreSerial();
  console.log('knowledge-serial-queries: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
