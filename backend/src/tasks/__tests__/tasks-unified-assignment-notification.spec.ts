import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { TasksUnifiedService } from '../tasks-unified.service';

// The "task assigned" e-mail goes out when the assignee is someone other than the person who
// saved the task. It stays when no signed-in person made the change (a renewal task the system
// creates passes no userId; a route with no user passes null). Assigning a task to yourself
// sends nothing, on create and on update.

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '66666666-6666-4666-8666-666666666666';
const TASK_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const CONTRACT_ID = '55555555-5555-4555-8555-555555555555';

type AssignmentCall = { assigneeId: string; taskId: string };

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    tenant_id: TENANT_ID,
    item_number: 7,
    title: 'Write the note',
    description: null,
    status: 'open',
    due_date: null,
    assignee_user_id: null,
    related_object_type: 'project',
    related_object_id: PROJECT_ID,
    task_type_id: null,
    source_id: null,
    company_id: null,
    phase_id: null,
    priority_level: 'normal',
    start_date: null,
    labels: [],
    category_id: null,
    stream_id: null,
    creator_id: ACTOR_ID,
    owner_ids: [],
    viewer_ids: [],
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeService(existingTask: Record<string, unknown> | null) {
  const calls: AssignmentCall[] = [];
  const stored = existingTask ? { ...existingTask } : null;
  const taskRepo = {
    manager: null as unknown,
    metadata: { columns: Object.keys(makeTask()).map((propertyName) => ({ propertyName })) },
    create: (row: Record<string, unknown>) => ({ id: TASK_ID, tenant_id: TENANT_ID, item_number: 7, ...row }),
    save: async (entity: Record<string, unknown>) => entity,
    findOne: async () => (stored ? { ...stored } : null),
    update: async (_where: unknown, set: Record<string, unknown>) => {
      if (!stored) throw new Error('no stored task');
      Object.assign(stored, set);
      return { affected: 1 };
    },
  };
  const manager = {
    getRepository: () => taskRepo,
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("current_setting('app.da_mode'")) return [{ limited: false }];
      if (sql.includes('FROM contracts WHERE id = $1')) return [{ id: params?.[0] }];
      if (sql.includes('FROM portfolio_projects WHERE id = $1')) {
        return [{ source_id: null, category_id: null, stream_id: null, company_id: null }];
      }
      if (sql.includes('JOIN roles')) return [{ email: 'assignee@example.com', locale: 'en' }];
      if (sql.includes('first_name, last_name FROM users')) return [{ first_name: 'Ada', last_name: 'Lovelace' }];
      if (sql.includes('AS display FROM users')) {
        const ids = Array.isArray(params?.[0]) ? params[0] as string[] : [];
        return ids.map((id) => ({ id, display: 'Named person' }));
      }
      throw new Error(`Unexpected query in test: ${sql}`);
    },
  };
  taskRepo.manager = manager;

  const service = new TasksUnifiedService(
    { manager } as any,
    { log: async () => undefined } as any,
    {} as any,
    { recalculateForTask: async () => undefined } as any,
    {
      notifyTaskAssigned: async (params: { assigneeId: string; taskId: string }) => {
        calls.push({ assigneeId: params.assigneeId, taskId: params.taskId });
      },
      notifyStatusChange: async () => undefined,
      getTaskRecipients: async () => [],
    } as any,
    { nextItemNumber: async () => 7 } as any,
    { logChange: async () => undefined } as any,
    { cleanupOrphanedImages: async () => undefined } as any,
    { recalculateActualEffort: async () => undefined } as any,
  );

  return { service, manager, calls };
}

/** notifyTaskAssigned is fired and forgotten: let that turn finish before reading the calls. */
async function settled(calls: AssignmentCall[]): Promise<AssignmentCall[]> {
  await new Promise((resolve) => setImmediate(resolve));
  return calls;
}

async function testCreateAssignedToTheActorSendsNothing() {
  const { service, manager, calls } = makeService(null);
  await service.createForTarget(
    { type: 'project', id: PROJECT_ID, payload: { title: 'Write the note', assignee_user_id: ACTOR_ID } as any },
    ACTOR_ID,
    { manager: manager as any, tenantId: TENANT_ID },
  );
  assert.deepEqual(await settled(calls), []);
}

async function testUpdateByIdAssignedToTheActorSendsNothing() {
  const { service, manager, calls } = makeService(makeTask());
  await service.updateById(
    TASK_ID,
    { assignee_user_id: ACTOR_ID, related_object_type: 'project', related_object_id: PROJECT_ID } as any,
    ACTOR_ID,
    { manager: manager as any, tenantId: TENANT_ID },
  );
  assert.deepEqual(await settled(calls), []);
}

async function testUpdateForTargetAssignedToTheActorSendsNothing() {
  const { service, manager, calls } = makeService(makeTask());
  await service.updateForTarget(
    { type: 'project', id: PROJECT_ID, payload: { id: TASK_ID, assignee_user_id: ACTOR_ID } as any },
    ACTOR_ID,
    { manager: manager as any, tenantId: TENANT_ID },
  );
  assert.deepEqual(await settled(calls), []);
}

async function testCreateAssignedToSomeoneElseSendsOnce() {
  const { service, manager, calls } = makeService(null);
  await service.createForTarget(
    { type: 'project', id: PROJECT_ID, payload: { title: 'Write the note', assignee_user_id: OTHER_ID } as any },
    ACTOR_ID,
    { manager: manager as any, tenantId: TENANT_ID },
  );
  assert.deepEqual(await settled(calls), [{ assigneeId: OTHER_ID, taskId: TASK_ID }]);
}

async function testUpdateAssignedToSomeoneElseSendsOnce() {
  const { service, manager, calls } = makeService(makeTask());
  await service.updateById(
    TASK_ID,
    { assignee_user_id: OTHER_ID, related_object_type: 'project', related_object_id: PROJECT_ID } as any,
    ACTOR_ID,
    { manager: manager as any, tenantId: TENANT_ID },
  );
  assert.deepEqual(await settled(calls), [{ assigneeId: OTHER_ID, taskId: TASK_ID }]);
}

async function testCreateWithNoActorStillSends() {
  const { service, manager, calls } = makeService(null);
  // A contract renewal creates the decision task with no signed-in person.
  await service.createForTarget(
    { type: 'contract', id: CONTRACT_ID, payload: { title: 'Renew the contract', assignee_user_id: ACTOR_ID } as any },
    undefined,
    { manager: manager as any, tenantId: TENANT_ID },
  );
  assert.deepEqual(await settled(calls), [{ assigneeId: ACTOR_ID, taskId: TASK_ID }]);
}

async function testCreateWithNullActorStillSends() {
  const { service, manager, calls } = makeService(null);
  // Routes pass `req.user?.sub ?? null` when the request has no user.
  await service.createForTarget(
    { type: 'contract', id: CONTRACT_ID, payload: { title: 'Renew the contract', assignee_user_id: OTHER_ID } as any },
    null as unknown as string,
    { manager: manager as any, tenantId: TENANT_ID },
  );
  assert.deepEqual(await settled(calls), [{ assigneeId: OTHER_ID, taskId: TASK_ID }]);
}

async function run() {
  await testCreateAssignedToTheActorSendsNothing();
  await testUpdateByIdAssignedToTheActorSendsNothing();
  await testUpdateForTargetAssignedToTheActorSendsNothing();
  await testCreateAssignedToSomeoneElseSendsOnce();
  await testUpdateAssignedToSomeoneElseSendsOnce();
  await testCreateWithNoActorStillSends();
  await testCreateWithNullActorStillSends();
}

void run();
