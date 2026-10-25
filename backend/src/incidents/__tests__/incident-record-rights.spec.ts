import * as assert from 'node:assert/strict';
import { IncidentRecordService } from '../services/incident-record.service';

// The complete record (PDF and chat detail) loads each linked section only when the caller reads
// its module. The sections of a caller without the right are null, never an error and never a
// row of another module; the application scope of a Business Contributor reaches the same query
// the Relations tab uses, and the tasks' assignee name is resolved for the PDF.

const INCIDENT_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const ASSIGNEE_ID = '44444444-4444-4444-8444-444444444444';

type Calls = {
  incident: Array<{ id: string; opts: any }>;
  relations: Array<{ id: string; opts: any }>;
  tasks: Array<{ target: any; opts: any }>;
  userQueries: string[];
};

function harness(options: {
  assets?: any[] | null;
  applications?: any[] | null;
  technologies?: any[] | null;
  tasks?: any[];
} = {}) {
  const calls: Calls = { incident: [], relations: [], tasks: [], userQueries: [] };
  const incident = {
    id: INCIDENT_ID,
    tenant_id: TENANT_ID,
    item_number: 12,
    title: 'Mail outage',
    category: 'infrastructure',
    severity: 'major',
    status: 'open',
    reporter_user_id: USER_ID,
    owner_user_id: null,
    confidential: false,
  };
  const incidents = {
    get: async (id: string, opts: any) => {
      calls.incident.push({ id, opts });
      return incident;
    },
  };
  const entries = { list: async () => [] };
  const relations = {
    listForRecord: async (id: string, opts: any) => {
      calls.relations.push({ id, opts });
      return {
        assets: opts?.technologies === true ? (options.assets ?? [{ id: 'asset-1', reference: 'AST-1', name: 'Alpha srv' }]) : null,
        applications: opts?.applications === true ? (options.applications ?? [{ id: 'app-1', reference: 'APP-1', name: 'Alpha app' }]) : null,
        technologies: opts?.technologies === true ? (options.technologies ?? [{ id: 'tech-1', reference: 'TEC-1', name: 'PostgreSQL' }]) : null,
      };
    },
  };
  const attachments = { listAttachments: async () => [] };
  const tasks = {
    listForTarget: async (target: any, opts: any) => {
      calls.tasks.push({ target, opts });
      return options.tasks ?? [{
        id: 'task-1',
        item_number: 28,
        title: 'Restore mail flow',
        status: 'open',
        assignee_user_id: ASSIGNEE_ID,
        due_date: '2026-03-20',
      }];
    },
  };
  const knowledge = { listDocumentsForEntity: async () => ({ access: 'granted', items: [] }) };
  const manager = {
    query: async (sql: string) => {
      if (sql.includes('FROM users')) {
        calls.userQueries.push(sql);
        return [{ id: ASSIGNEE_ID, name: 'Ada Martin' }];
      }
      return [];
    },
  };
  const service = new IncidentRecordService(
    incidents as any,
    entries as any,
    relations as any,
    attachments as any,
    tasks as any,
    knowledge as any,
  );
  return { service, calls, manager, incident };
}

async function testSectionsWithoutRightAreNull() {
  const { service, calls, manager } = harness();
  const record = await service.load(INCIDENT_ID, {
    manager: manager as any,
    tenantId: TENANT_ID,
    userId: USER_ID,
    viewer: { userId: USER_ID, isAdmin: false },
    technologies: false,
    applications: false,
    tasks: false,
  });
  assert.equal(record.assets, null);
  assert.equal(record.applications, null);
  assert.equal(record.technologies, null);
  assert.equal(record.tasks, null);
  assert.equal(calls.relations.length, 1, 'the relations service applies both module reads itself');
  assert.equal(calls.tasks.length, 0, 'no task is read without the tasks right');
  assert.deepEqual(record.entries, []);
  assert.equal(record.review, null);
  assert.deepEqual(calls.incident[0].opts.viewer, { userId: USER_ID, isAdmin: false });
}

async function testSectionsWithRightAreLoaded() {
  const { service, calls, manager, incident } = harness();
  const scope = { userId: USER_ID };
  const record = await service.load(INCIDENT_ID, {
    manager: manager as any,
    tenantId: TENANT_ID,
    userId: USER_ID,
    viewer: { userId: USER_ID, isAdmin: false },
    technologies: true,
    applications: true,
    applicationScope: scope,
    tasks: true,
  });
  assert.deepEqual(record.assets, [{ id: 'asset-1', reference: 'AST-1', name: 'Alpha srv' }]);
  assert.deepEqual(record.applications, [{ id: 'app-1', reference: 'APP-1', name: 'Alpha app' }]);
  assert.deepEqual(record.technologies, [{ id: 'tech-1', reference: 'TEC-1', name: 'PostgreSQL' }]);
  assert.equal(record.tasks?.length, 1);
  assert.equal(record.tasks?.[0].assignee_name, 'Ada Martin');
  assert.equal(record.tasks?.[0].due_date, '2026-03-20');
  assert.equal(record.incident, incident as any);
  assert.equal(calls.relations[0].opts.applicationScope, scope);
  assert.equal(calls.relations[0].opts.technologies, true);
  assert.equal(calls.relations[0].opts.applications, true);
  assert.deepEqual(calls.tasks[0].target, { type: 'incident', id: INCIDENT_ID });
  assert.deepEqual(calls.tasks[0].opts, { manager, tenantId: TENANT_ID });
  assert.equal(calls.userQueries.length, 1, 'one query for every assignee of the record');
}

async function testUnreadableTaskAssigneeStaysNull() {
  const { service, manager } = harness({
    tasks: [{
      id: 'task-2',
      item_number: 29,
      title: 'Archive logs',
      status: 'done',
      assignee_user_id: ASSIGNEE_ID,
      due_date: null,
    }],
  });
  // A manager that answers nothing: a deleted or unreadable user never blocks the record.
  manager.query = async () => [];
  const record = await service.load(INCIDENT_ID, {
    manager: manager as any,
    tenantId: TENANT_ID,
    userId: USER_ID,
    viewer: { userId: USER_ID, isAdmin: false },
    tasks: true,
  });
  assert.equal(record.tasks?.[0].assignee_name, null);
  assert.equal(record.assets, null);
  assert.equal(record.applications, null);
  assert.equal(record.technologies, null);
}

async function run() {
  await testSectionsWithoutRightAreNull();
  await testSectionsWithRightAreLoaded();
  await testUnreadableTaskAssigneeStaysNull();
  console.log('incident-record-rights.spec.ts: ok');
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
