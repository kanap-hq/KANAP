import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { TasksUnifiedService } from '../tasks-unified.service';

// The audit rows of a task's application and asset links carry the caller's audit source, from the
// task side (`setApplicationLinks`, `setAssetLinks`) and from the application or asset side
// (`bulkReplaceTasksForApplication`, `bulkReplaceTasksForAsset`) alike: the assistant passes its
// source and preview, a screen passes nothing and keeps the default.
// This spec does not open the data source: it runs in the parallel (non-database) lane.

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = '33333333-3333-4333-8333-333333333333';
const TARGET_ID = '44444444-4444-4444-8444-444444444444';
const AUDIT = { source: 'ai_chat', sourceRef: 'preview-1' };

type Logged = { table: string; recordId: string; source?: string; sourceRef?: string | null; after: unknown };

function makeService() {
  const logged: Logged[] = [];
  const audit = { log: async (entry: Logged) => { logged.push(entry); } };
  const activities = { logChange: async () => undefined };
  const service = new TasksUnifiedService(
    undefined as any, audit as any, undefined as any, undefined as any, undefined as any,
    undefined as any, activities as any, undefined as any, undefined as any,
  ) as any;
  // The checks and lookups that read other tables: the task exists, the target exists, no link yet.
  service.validateTaskIds = async () => undefined;
  service.validateLinkedIds = async () => undefined;
  service.listTaskLinkedTargetIds = async () => [];
  service.resolveLinkNames = async () => [];
  // Not a limited transaction, no stored link, and the writes succeed.
  const manager = { query: async () => [] } as any;
  return { service: service as TasksUnifiedService, logged, manager };
}

async function testTargetSidePassesTheSource() {
  for (const [method, table] of [
    ['bulkReplaceTasksForApplication', 'task_applications'],
    ['bulkReplaceTasksForAsset', 'task_assets'],
  ] as const) {
    const { service, logged, manager } = makeService();
    await service[method](TARGET_ID, [TASK_ID], { manager, tenantId: TENANT_ID, userId: USER_ID, audit: AUDIT });
    assert.equal(logged.length, 1, `${method}: one audit row`);
    assert.equal(logged[0].table, table);
    assert.equal(logged[0].recordId, TASK_ID, `${method}: the task in record_id`);
    assert.deepEqual(logged[0].after, { ids: [TARGET_ID] });
    assert.equal(logged[0].source, AUDIT.source, `${method}: the caller's source`);
    assert.equal(logged[0].sourceRef, AUDIT.sourceRef, `${method}: the caller's source reference`);

    const screen = makeService();
    await screen.service[method](TARGET_ID, [TASK_ID], { manager: screen.manager, tenantId: TENANT_ID, userId: USER_ID });
    assert.equal(screen.logged[0].source, undefined, `${method}: a screen keeps the default source`);
    assert.equal(screen.logged[0].sourceRef, null);
  }
}

async function testTaskSidePassesTheSource() {
  for (const [method, table] of [
    ['setApplicationLinks', 'task_applications'],
    ['setAssetLinks', 'task_assets'],
  ] as const) {
    const { service, logged, manager } = makeService();
    await service[method](TASK_ID, [TARGET_ID], { manager, tenantId: TENANT_ID, userId: USER_ID, audit: AUDIT });
    assert.equal(logged.length, 1, `${method}: one audit row`);
    assert.equal(logged[0].table, table);
    assert.equal(logged[0].source, AUDIT.source, `${method}: the caller's source`);
    assert.equal(logged[0].sourceRef, AUDIT.sourceRef);
  }
}

async function run() {
  await testTargetSidePassesTheSource();
  await testTaskSidePassesTheSource();
  console.log('tasks-link-audit-source.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
