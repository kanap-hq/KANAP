import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { TasksUnifiedService } from '../tasks-unified.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = '33333333-3333-4333-8333-333333333333';
const OLD_PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const NEW_PROJECT_ID = '55555555-5555-4555-8555-555555555555';

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    tenant_id: TENANT_ID,
    item_number: 1,
    title: 'Move me',
    description: null,
    status: 'open',
    due_date: null,
    assignee_user_id: null,
    related_object_type: 'project',
    related_object_id: OLD_PROJECT_ID,
    task_type_id: null,
    source_id: null,
    company_id: null,
    phase_id: null,
    priority_level: 'normal',
    start_date: null,
    labels: [],
    category_id: null,
    stream_id: null,
    creator_id: USER_ID,
    owner_ids: [],
    viewer_ids: [],
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as any;
}

function makeService(existingTask: any) {
  const recalculatedProjects: string[] = [];
  const savedTasks: any[] = [];
  // The task as stored: a write sets the columns it names (`task-column-write.ts`), a read returns it.
  const stored = { ...existingTask };
  const taskRepo = {
    metadata: { columns: Object.keys(makeTask()).map((propertyName) => ({ propertyName })) },
    findOne: async () => ({ ...stored }),
    update: async (_where: unknown, set: Record<string, unknown>) => {
      Object.assign(stored, set);
      savedTasks.push({ ...stored });
    },
  };
  const manager = {
    getRepository: () => taskRepo,
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT id, source_id, category_id, stream_id, company_id FROM portfolio_projects')) {
        return [{
          id: params?.[0],
          source_id: null,
          category_id: null,
          stream_id: null,
          company_id: null,
        }];
      }
      if (sql.includes('FROM portfolio_projects') && sql.includes('WHERE id = $1')) {
        return [{ name: params?.[0] === OLD_PROJECT_ID ? 'Old project' : 'New project' }];
      }
      throw new Error(`Unexpected query in test: ${sql}`);
    },
  };

  const service = new TasksUnifiedService(
    { manager } as any,
    { log: async () => undefined } as any,
    {} as any,
    { recalculateForTask: async () => undefined } as any,
    {
      notifyTaskAssigned: async () => undefined,
      notifyStatusChange: async () => undefined,
      getTaskRecipients: async () => [],
    } as any,
    {} as any,
    { logChange: async () => undefined } as any,
    { cleanupOrphanedImages: async () => undefined } as any,
    {
      recalculateActualEffort: async (projectId: string) => {
        recalculatedProjects.push(projectId);
      },
    } as any,
  );

  return { service, manager, recalculatedProjects, savedTasks };
}

async function testRecalculatesOldAndNewProjectEffortWhenMovingBetweenProjects() {
  const { service, manager, recalculatedProjects, savedTasks } = makeService(makeTask());

  await service.updateById(
    TASK_ID,
    { related_object_type: 'project', related_object_id: NEW_PROJECT_ID } as any,
    USER_ID,
    { manager: manager as any, tenantId: TENANT_ID },
  );

  assert.equal(savedTasks[0].related_object_type, 'project');
  assert.equal(savedTasks[0].related_object_id, NEW_PROJECT_ID);
  assert.equal(savedTasks[0].phase_id, null);
  assert.deepEqual(recalculatedProjects, [OLD_PROJECT_ID, NEW_PROJECT_ID]);
}

async function testRecalculatesOldProjectEffortWhenMovingToStandalone() {
  const { service, manager, recalculatedProjects, savedTasks } = makeService(makeTask());

  await service.updateById(
    TASK_ID,
    { related_object_type: null, related_object_id: null } as any,
    USER_ID,
    { manager: manager as any, tenantId: TENANT_ID },
  );

  assert.equal(savedTasks[0].related_object_type, null);
  assert.equal(savedTasks[0].related_object_id, null);
  assert.equal(savedTasks[0].phase_id, null);
  assert.deepEqual(recalculatedProjects, [OLD_PROJECT_ID]);
}

async function run() {
  await testRecalculatesOldAndNewProjectEffortWhenMovingBetweenProjects();
  await testRecalculatesOldProjectEffortWhenMovingToStandalone();
}

void run();
