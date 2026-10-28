import * as assert from 'node:assert/strict';
import { AiQueryExecutor } from '../query/ai-query.executor';

// `get_entity_detail` on an incident (chat and MCP) returns the same linked sections as the
// REST routes: assets and technologies with the infrastructure read, applications with the
// applications read inside a Business Contributor's scope, tasks with the tasks read. A section
// without its right is absent from the result, never an error. The record loader is stubbed:
// what this spec pins is the access context the assistant hands it, and the shape it returns.

const INCIDENT_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

type Rights = 'technologies' | 'applications' | 'tasks';

function harness(allowed: Set<Rights>, businessContributor = false) {
  const policyCalls: string[] = [];
  const loadCalls: any[] = [];
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
    counts: { assets: 1, applications: 1, technologies: 1, tasks: 1 },
  };
  const incidents = {
    get: async () => incident,
  };
  const incidentRecords = {
    load: async (_id: string, opts: any) => {
      loadCalls.push(opts);
      return {
        incident,
        entries: [],
        assets: opts.technologies ? [{ id: 'asset-1', reference: 'AST-1', name: 'Alpha srv' }] : null,
        applications: opts.applications ? [{ id: 'app-1', reference: 'APP-1', name: 'Alpha app' }] : null,
        technologies: opts.technologies ? [{ id: 'tech-1', reference: 'TEC-1', name: 'PostgreSQL' }] : null,
        tasks: opts.tasks ? [{ id: 'task-1', item_number: 28, title: 'Restore mail flow', status: 'open', assignee_name: 'Ada Martin' }] : null,
        documents: [],
        attachments: [],
        review: null,
      };
    },
  };
  const policy = {
    canReadEntityType: async (_context: any, entityType: string) => {
      policyCalls.push(entityType);
      return allowed.has(entityType as Rights);
    },
  };
  const manager = {
    query: async (sql: string) => {
      if (sql.includes('user_ok')) return [{ user_ok: true, is_administrator: false, level_rank: null }];
      if (businessContributor && sql.includes('role_name')) {
        return [{ role_id: 'role-bc', role_name: 'business contributor', level: null }];
      }
      return [];
    },
  };
  const args: any[] = Array.from({ length: 25 }, () => undefined);
  args[20] = incidents;
  args[21] = incidentRecords;
  args[23] = policy;
  const executor = new AiQueryExecutor(...(args as [any, any, any, any, any, any, any, any, any, any, any, any, any, any, any, any, any, any, any, any, any, any, any, any, any]));
  const context = {
    tenantId: TENANT_ID,
    userId: USER_ID,
    isPlatformHost: false,
    surface: 'mcp' as const,
    authMethod: 'api_key' as const,
    manager: manager as any,
  };
  return { executor, context, policyCalls, loadCalls };
}

function has(data: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}

async function testNoModuleRight() {
  const { executor, context, policyCalls, loadCalls } = harness(new Set());
  const detail = await executor.executeDetail(context, { entity_type: 'incidents', entity_id: INCIDENT_ID });
  const data = detail.data;
  assert.equal(has(data, 'assets'), false);
  assert.equal(has(data, 'applications'), false);
  assert.equal(has(data, 'technologies'), false);
  assert.equal(has(data, 'tasks'), false);
  assert.deepEqual(data.entries, []);
  assert.deepEqual(data.documents, []);
  assert.deepEqual(data.attachments, []);
  assert.equal(data.review_markdown, null);
  assert.deepEqual(policyCalls.sort(), ['applications', 'tasks', 'technologies']);
  assert.equal(loadCalls.length, 1);
  assert.equal(loadCalls[0].technologies, false);
  assert.equal(loadCalls[0].applications, false);
  assert.equal(loadCalls[0].tasks, false);
  assert.equal(loadCalls[0].applicationScope, undefined);
}

async function testEveryModuleRight() {
  const { executor, context, loadCalls } = harness(new Set<Rights>(['technologies', 'applications', 'tasks']));
  const detail = await executor.executeDetail(context, { entity_type: 'incidents', entity_id: INCIDENT_ID });
  const data = detail.data;
  assert.deepEqual(data.assets, [{ id: 'asset-1', reference: 'AST-1', name: 'Alpha srv' }]);
  assert.deepEqual(data.applications, [{ id: 'app-1', reference: 'APP-1', name: 'Alpha app' }]);
  assert.deepEqual(data.technologies, [{ id: 'tech-1', reference: 'TEC-1', name: 'PostgreSQL' }]);
  assert.deepEqual(data.tasks, [{ id: 'task-1', item_number: 28, title: 'Restore mail flow', status: 'open', assignee_name: 'Ada Martin' }]);
  assert.equal(loadCalls[0].technologies, true);
  assert.equal(loadCalls[0].applications, true);
  assert.equal(loadCalls[0].tasks, true);
}

async function testApplicationsOnlyCarriesTheBusinessContributorScope() {
  const { executor, context, loadCalls } = harness(new Set<Rights>(['applications']), true);
  const detail = await executor.executeDetail(context, { entity_type: 'incidents', entity_id: INCIDENT_ID });
  assert.equal(has(detail.data, 'assets'), false);
  assert.equal(has(detail.data, 'technologies'), false);
  assert.equal(has(detail.data, 'tasks'), false);
  assert.ok(has(detail.data, 'applications'));
  assert.equal(loadCalls[0].applications, true);
  assert.equal(loadCalls[0].technologies, false);
  assert.equal(loadCalls[0].tasks, false);
  assert.deepEqual(loadCalls[0].applicationScope, { userId: USER_ID });
}

async function run() {
  await testNoModuleRight();
  await testEveryModuleRight();
  await testApplicationsOnlyCarriesTheBusinessContributorScope();
  console.log('ai-incident-detail-rights.spec.ts: ok');
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
