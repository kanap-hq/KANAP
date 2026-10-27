import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// A linked record (application, asset, request, project, contract, budget line, task, incident)
// shows, by its name, reference, description or count, only to a person who reads its module, and
// only inside their participation (Business Contributor). Otherwise the family leaves the answer or
// the screen, with no counter and no mention (quality pass Plaid and MCP, 2026-10-26, P4-1 to P4-12).
//
// Plaid and MCP (the chat and the MCP server call the same executor, entity service and tool
// registry; the tool layer adds only its surface checks, stubbed open here):
//   1. get_entity_context(projects): requests, dependencies, applications, assets, tasks.
//   2. get_entity_context(requests): resulting projects, project dependencies, applications, assets.
//   3. get_entity_context(tasks) and the tasks list: applications, assets, project, object name.
//   4. get_entity_detail(projects | requests): source requests, resulting projects, dependencies.
//   5. users: a reader gets what the users list shows them (name, email, status).
//   6. get_document: the linked families of the modules the reader reads.
//   7. get_entity_detail(incidents): linked sections and the journal's link changes.
//   (exception) get_entity_context(applications): the servers stay, as on the Deployments tab.
// Screens and API:
//   8. GET /tasks and /tasks/:id: applications, assets, related object, filter values.
//   9. GET /knowledge/:id: the linked families of the modules the reader reads.
//  10. GET /incidents/:id/entries and the incident counts.
//  11. GET /portfolio/projects/:id/applications|assets (and requests), project and request detail.
// Follow-ups decided on 2026-10-26:
//  12. A Business Contributor's task outside their participation: the project, its phase, the
//      converted request and the applications read as an unreadable module (screen and Plaid),
//      and the list's searches and name filters follow.
//  13. Document link writes (`/knowledge/:id/relations/.../bulk-replace`): a family the person
//      does not read is refused, a family left out stays, and a Business Contributor adds only
//      records inside their participation.
//  14. Counters of a hidden family: the incident journal badge counts the entries the journal
//      shows; the Relations tab and badge of an application and a project count no budget line,
//      business process or technology without the module's read.
//  15. The document's link selectors (`GET /knowledge/relation-options/:entity`): no option of a
//      family whose module the person does not read, and a Business Contributor's options inside
//      their participation.
//  16. A contract's Relations tab, badge and family routes, its link writes, what a termination
//      changes and the list's covered application filter: the applications for their readers (a
//      Business Contributor's inside their participation), the assets for readers of the
//      infrastructure; a write on a family the person does not read is refused, even empty.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'linked-records-rights-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = {
  app: any;
  dataSource: DataSource;
  executor: any;
  entities: any;
  tools: any;
  tasks: any;
  knowledge: any;
  entries: any;
  incidents: any;
  projectsController: any;
  requestsController: any;
  documentMutations: any;
  tasksController: any;
  knowledgeController: any;
};

/**
 * A: portfolio and tasks, no IT, no contracts. B: applications only. C: knowledge only (a writer).
 * D: incidents only. E: Business Contributor (projects, requests, tasks, applications, knowledge; no IT).
 * K: knowledge writer and projects reader, no applications.
 * P: projects only. Q: requests only. U: users reader. Full: Administrator.
 */
type Profile = 'a' | 'b' | 'c' | 'd' | 'e' | 'k' | 'p' | 'q' | 'u' | 'full';

const PERMISSIONS: Record<Exclude<Profile, 'full'>, Record<string, string>> = {
  a: { portfolio_projects: 'reader', portfolio_requests: 'reader', tasks: 'reader' },
  b: { applications: 'reader' },
  c: { knowledge: 'member' },
  d: { incidents: 'reader' },
  e: { portfolio_projects: 'contributor', portfolio_requests: 'contributor', tasks: 'contributor', applications: 'reader', knowledge: 'member' },
  k: { knowledge: 'member', portfolio_projects: 'reader' },
  p: { portfolio_projects: 'reader' },
  q: { portfolio_requests: 'reader' },
  u: { users: 'reader' },
};

const ROLE_NAMES: Record<Profile, string> = {
  a: 'Portfolio and tasks', b: 'Applications only', c: 'Knowledge only', d: 'Incidents only',
  e: 'Business Contributor', k: 'Knowledge and projects', p: 'Projects only', q: 'Requests only', u: 'Users reader', full: 'Administrator',
};

type Seed = {
  tenantId: string;
  users: Record<Profile, string>;
  application: string;
  asset: string;
  contract: string;
  project: string;
  dependency: string;
  request: string;
  projectTask: string;
  contractTask: string;
  outsideTask: string;
  document: string;
  incident: string;
};

const APP = 'Linked app';
const ASSET = 'Linked server';
const CONTRACT = 'Linked contract';
const PROJECT = 'Main project';
const DEPENDENCY = 'Dependency project';
const REQUEST = 'Source request';
const PROJECT_TASK = 'Project task';
const PHASE = 'Dependency phase';
const CONVERTED = 'Converted request';

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for linked-records-follow-rights.integration.spec.ts.');
  const { AppModule } = require('../../../app.module');
  const { AiQueryExecutor } = require('../../../ai/query/ai-query.executor');
  const { AiEntityService } = require('../../../ai/ai-entity.service');
  const { AiToolRegistry } = require('../../../ai/ai-tool.registry');
  const { AiPolicyService } = require('../../../ai/ai-policy.service');
  const { TasksService } = require('../../../spend/tasks.service');
  const { KnowledgeService } = require('../../../knowledge/knowledge.service');
  const { IncidentEntriesService } = require('../../../incidents/services/incident-entries.service');
  const { IncidentsService } = require('../../../incidents/services/incidents.service');
  const { PortfolioProjectsController } = require('../../../portfolio/portfolio-projects.controller');
  const { PortfolioRequestsController } = require('../../../portfolio/portfolio-requests.controller');
  const { AiDocumentMutationSupportService } = require('../../../ai/mutation/ai-document-mutation-support.service');
  const { TasksController } = require('../../../spend/tasks.controller');
  const { KnowledgeController } = require('../../../knowledge/knowledge.controller');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  // The surface checks (tenant AI settings, provider, subscription) are not what this spec tests.
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  return {
    app,
    dataSource: app.get(DataSource),
    executor: app.get(AiQueryExecutor),
    entities: app.get(AiEntityService),
    tools: app.get(AiToolRegistry),
    tasks: app.get(TasksService),
    knowledge: app.get(KnowledgeService),
    entries: app.get(IncidentEntriesService),
    incidents: app.get(IncidentsService),
    projectsController: app.get(PortfolioProjectsController),
    requestsController: app.get(PortfolioRequestsController),
    documentMutations: app.get(AiDocumentMutationSupportService),
    tasksController: app.get(TasksController),
    knowledgeController: app.get(KnowledgeController),
  };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `linked-rights-${tag}`, `linked-rights-${tag}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

  const users = {} as Record<Profile, string>;
  for (const profile of Object.keys(ROLE_NAMES) as Profile[]) {
    const roleId = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, $2, $2)`, [tenantId, ROLE_NAMES[profile]]);
    for (const [resource, level] of Object.entries(profile === 'full' ? {} : PERMISSIONS[profile])) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, roleId, resource, level]);
    }
    users[profile] = await insertId(runner,
      `INSERT INTO users (tenant_id, email, first_name, last_name, job_title, role_id, status) VALUES ($1, $2, $3, 'Tester', 'Secret job title', $4, 'enabled')`,
      [tenantId, `${profile}-${tag}@example.test`, `Profile ${profile}`, roleId]);
  }

  const company = await insertId(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Company', 'FR', 'Paris')`, [tenantId]);
  const supplier = await insertId(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Supplier')`, [tenantId]);
  const contract = await insertId(runner,
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, $2, $3, $4, '2026-01-01')`,
    [tenantId, CONTRACT, company, supplier]);
  const application = await insertId(runner,
    `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, $2, 'APP-1', 'enabled')`, [tenantId, APP]);
  const asset = await insertId(runner,
    `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, $2, 'server', 'prod')`, [tenantId, ASSET]);
  // The application runs on the server: its Deployments tab shows it to every reader of applications.
  const instance = await insertId(runner,
    `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod')`, [tenantId, application]);
  await runner.query(`INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, 'primary')`, [tenantId, instance, asset]);

  const project = await insertId(runner, `INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, $2, 1)`, [tenantId, PROJECT]);
  const dependency = await insertId(runner, `INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, $2, 2)`, [tenantId, DEPENDENCY]);
  // E takes part in the main project only: the dependency and the source request are outside.
  await runner.query(`INSERT INTO portfolio_project_team (tenant_id, project_id, user_id, role) VALUES ($1, $2, $3, 'member')`, [tenantId, project, users.e]);
  await runner.query(`INSERT INTO portfolio_project_dependencies (tenant_id, project_id, depends_on_project_id) VALUES ($1, $2, $3)`, [tenantId, project, dependency]);
  const request = await insertId(runner,
    `INSERT INTO portfolio_requests (tenant_id, item_number, name, status, criteria_values, feasibility_review, priority_override)
     VALUES ($1, 1, $2, 'approved', '{}'::jsonb, '{}'::jsonb, false)`, [tenantId, REQUEST]);
  await runner.query(`INSERT INTO portfolio_request_projects (tenant_id, request_id, project_id) VALUES ($1, $2, $3)`, [tenantId, request, project]);
  await runner.query(`INSERT INTO portfolio_request_dependencies (tenant_id, request_id, depends_on_project_id) VALUES ($1, $2, $3)`, [tenantId, request, dependency]);
  await runner.query(`INSERT INTO portfolio_request_applications (tenant_id, request_id, application_id) VALUES ($1, $2, $3)`, [tenantId, request, application]);
  await runner.query(`INSERT INTO portfolio_request_assets (tenant_id, request_id, asset_id) VALUES ($1, $2, $3)`, [tenantId, request, asset]);
  await runner.query(`INSERT INTO application_projects (tenant_id, application_id, project_id) VALUES ($1, $2, $3)`, [tenantId, application, project]);
  await runner.query(`INSERT INTO asset_projects (tenant_id, asset_id, project_id) VALUES ($1, $2, $3)`, [tenantId, asset, project]);

  const phase = await insertId(runner,
    `INSERT INTO portfolio_project_phases (tenant_id, project_id, name) VALUES ($1, $2, $3)`, [tenantId, dependency, PHASE]);
  const task = (itemNumber: number, title: string, type: string, related: string, phaseId: string | null = null) => insertId(runner,
    `INSERT INTO tasks (tenant_id, item_number, title, description, status, related_object_type, related_object_id, labels, owner_ids, viewer_ids, assignee_user_id, phase_id)
     VALUES ($1, $2, $3, '', 'open', $4, $5, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, $6, $7)`,
    [tenantId, itemNumber, title, type, related, users.e, phaseId]);
  const projectTask = await task(1, PROJECT_TASK, 'project', project);
  const contractTask = await task(2, 'Contract task', 'contract', contract);
  // E is assigned a task of the dependency project, outside their participation, converted into a
  // request they do not take part in either.
  const outsideTask = await task(3, 'Outside task', 'project', dependency, phase);
  await runner.query(
    `INSERT INTO portfolio_requests (tenant_id, item_number, name, status, criteria_values, feasibility_review, priority_override, origin_task_id)
     VALUES ($1, 2, $2, 'approved', '{}'::jsonb, '{}'::jsonb, false, $3)`, [tenantId, CONVERTED, outsideTask]);
  await runner.query(`INSERT INTO task_applications (tenant_id, task_id, application_id) VALUES ($1, $2, $3)`, [tenantId, outsideTask, application]);
  for (const taskId of [projectTask, contractTask]) {
    await runner.query(`INSERT INTO task_applications (tenant_id, task_id, application_id) VALUES ($1, $2, $3)`, [tenantId, taskId, application]);
    await runner.query(`INSERT INTO task_assets (tenant_id, task_id, asset_id) VALUES ($1, $2, $3)`, [tenantId, taskId, asset]);
  }

  const library = await insertId(runner, `INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, 'Library', $2)`, [tenantId, `library-${tag}`]);
  const document = await insertId(runner,
    `INSERT INTO documents (tenant_id, library_id, title, item_number, status) VALUES ($1, $2, 'Runbook', 1, 'published')`, [tenantId, library]);
  for (const [table, column, id] of [
    ['document_applications', 'application_id', application],
    ['document_assets', 'asset_id', asset],
    ['document_projects', 'project_id', project],
    ['document_requests', 'request_id', request],
    ['document_tasks', 'task_id', projectTask],
  ]) {
    await runner.query(`INSERT INTO ${table} (tenant_id, document_id, ${column}) VALUES ($1, $2, $3)`, [tenantId, document, id]);
  }

  const incident = await insertId(runner,
    `INSERT INTO incidents (tenant_id, title, item_number, severity) VALUES ($1, 'Outage', 1, 'minor')`, [tenantId]);
  await runner.query(`INSERT INTO incident_assets (tenant_id, incident_id, asset_id) VALUES ($1, $2, $3)`, [tenantId, incident, asset]);
  await runner.query(`INSERT INTO incident_applications (tenant_id, incident_id, application_id) VALUES ($1, $2, $3)`, [tenantId, incident, application]);
  const entry = (kind: string, content: string, changed: unknown, minutes: number) => runner.query(
    `INSERT INTO incident_entries (tenant_id, incident_id, kind, content, changed_fields, occurred_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, now() - make_interval(mins => $6))`,
    [tenantId, incident, kind, content, changed === null ? null : JSON.stringify(changed), minutes]);
  await entry('link_change', `Assets linked: ${ASSET}.`, { assets: { from: [], to: [ASSET] } }, 30);
  await entry('link_change', `Applications linked: APP-1 ${APP}.`, { applications: { from: [], to: [`APP-1 ${APP}`] } }, 20);
  await entry('note', 'Root cause found', null, 10);

  return {
    tenantId, users, application, asset, contract, project, dependency, request,
    projectTask, contractTask, outsideTask, document, incident,
  };
}

function ctx(runner: QueryRunner, s: Seed, profile: Profile, surface: 'chat' | 'mcp' = 'mcp') {
  return {
    tenantId: s.tenantId,
    userId: s.users[profile],
    isPlatformHost: false,
    surface,
    authMethod: surface === 'mcp' ? 'api_key' as const : 'session' as const,
    manager: runner.manager,
  };
}

/** The request context a guarded controller sees for `profile`. */
function tenantRequest(runner: QueryRunner, s: Seed, profile: Profile) {
  return {
    tenantId: s.tenantId,
    userId: s.users[profile],
    isAdmin: profile === 'full',
    permissions: profile === 'full' ? {} : PERMISSIONS[profile],
    manager: runner.manager,
    queryRunner: runner,
  };
}

/** The raw request of the controllers that read `req` (requests). */
function rawRequest(runner: QueryRunner, s: Seed, profile: Profile) {
  return {
    queryRunner: runner,
    isAdmin: profile === 'full',
    permissions: profile === 'full' ? {} : PERMISSIONS[profile],
    tenant: { id: s.tenantId },
    user: { sub: s.users[profile] },
  };
}

const relations = (result: any) => result.related.map((group: any) => group.relation).sort();

function hasNot(value: unknown, names: string[], label: string) {
  const text = JSON.stringify(value);
  for (const name of names) assert.ok(!text.includes(name), `${label}: ${name} is not named`);
}

function has(value: unknown, names: string[], label: string) {
  const text = JSON.stringify(value);
  for (const name of names) assert.ok(text.includes(name), `${label}: ${name} is named`);
}

/** Refused, in a savepoint so a failed statement does not end the transaction. */
async function rejects(runner: QueryRunner, fn: () => Promise<unknown>, pattern: RegExp, label: string) {
  await runner.query('SAVEPOINT expected_failure');
  try {
    await fn();
    assert.fail(`${label}: should fail`);
  } catch (error: any) {
    if (error?.code === 'ERR_ASSERTION') throw error;
    assert.match(String(error?.message ?? error), pattern, label);
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT expected_failure');
  }
}

// 1. Project context.
async function testProjectContext(h: Harness, runner: QueryRunner, s: Seed) {
  for (const surface of ['chat', 'mcp'] as const) {
    const a = await h.entities.getEntityContext(ctx(runner, s, 'a', surface), { entity_type: 'projects', entity_id: 'PRJ-1' });
    assert.deepEqual(relations(a), ['dependencies', 'project_tasks', 'source_requests'], `A (${surface}): no application, no asset`);
    hasNot(a, [APP, ASSET], `A (${surface}), project context`);
  }
  const e = await h.entities.getEntityContext(ctx(runner, s, 'e'), { entity_type: 'projects', entity_id: 'PRJ-1' });
  assert.ok(!relations(e).includes('linked_assets'), 'E: no asset without the infrastructure right');
  assert.ok(!relations(e).includes('source_requests'), 'E: the source request is outside their participation');
  hasNot(e, [ASSET, REQUEST, DEPENDENCY], 'E, project context');
  const p = await h.entities.getEntityContext(ctx(runner, s, 'p'), { entity_type: 'projects', entity_id: 'PRJ-1' });
  assert.deepEqual(relations(p), ['dependencies'], 'P: neither requests nor tasks without their right');
  hasNot(p, [REQUEST, PROJECT_TASK], 'P, project context');
  const full = await h.entities.getEntityContext(ctx(runner, s, 'full'), { entity_type: 'projects', entity_id: 'PRJ-1' });
  assert.deepEqual(relations(full), ['dependencies', 'linked_applications', 'linked_assets', 'project_tasks', 'source_requests']);
}

// 2. Request context.
async function testRequestContext(h: Harness, runner: QueryRunner, s: Seed) {
  const a = await h.entities.getEntityContext(ctx(runner, s, 'a'), { entity_type: 'requests', entity_id: 'REQ-1' });
  assert.deepEqual(relations(a), ['dependencies', 'resulting_projects'], 'A: no application, no asset');
  hasNot(a, [APP, ASSET], 'A, request context');
  const q = await h.entities.getEntityContext(ctx(runner, s, 'q'), { entity_type: 'requests', entity_id: 'REQ-1' });
  assert.deepEqual(relations(q), [], 'Q: no project, no project dependency');
  hasNot(q, [PROJECT, DEPENDENCY, APP, ASSET], 'Q, request context');
  const full = await h.entities.getEntityContext(ctx(runner, s, 'full'), { entity_type: 'requests', entity_id: 'REQ-1' });
  assert.deepEqual(relations(full), ['dependencies', 'linked_applications', 'linked_assets', 'resulting_projects']);
}

// 3. Task context and lists.
async function testTaskContextAndLists(h: Harness, runner: QueryRunner, s: Seed) {
  const projectTask = await h.entities.getEntityContext(ctx(runner, s, 'a'), { entity_type: 'tasks', entity_id: 'T-1' });
  assert.deepEqual(relations(projectTask), ['related_project'], 'A: the project, no application, no asset');
  hasNot(projectTask, [APP, ASSET], 'A, task context');
  const contractTask = await h.entities.getEntityContext(ctx(runner, s, 'a'), { entity_type: 'tasks', entity_id: 'T-2' });
  assert.equal(contractTask.entity.metadata.related_object_name, null, 'A: no contract name');
  hasNot(contractTask, [CONTRACT], 'A, contract task context');
  const fullContract = await h.entities.getEntityContext(ctx(runner, s, 'full'), { entity_type: 'tasks', entity_id: 'T-2' });
  assert.equal(fullContract.entity.metadata.related_object_name, CONTRACT, 'full: the contract name');
  assert.deepEqual(relations(fullContract), ['linked_applications', 'linked_assets']);

  const list = await h.entities.listEntities(ctx(runner, s, 'a'), { entity_type: 'tasks' });
  hasNot(list, [CONTRACT], 'A, tasks list (entity service)');
  const query = await h.executor.execute(ctx(runner, s, 'a'), { entity_type: 'tasks' });
  hasNot(query, [CONTRACT, APP, ASSET], 'A, query_entities(tasks)');
  const detail = await h.executor.executeDetail(ctx(runner, s, 'a'), { entity_type: 'tasks', entity_id: 'T-2' });
  hasNot(detail, [CONTRACT, APP, ASSET], 'A, get_entity_detail(tasks)');
  const filtered = await h.executor.execute(ctx(runner, s, 'a'), { entity_type: 'tasks', filters: { application: { op: 'eq', value: APP } } });
  assert.equal(filtered.status, 'invalid_filter', 'A: tasks do not filter on applications');
  const fullQuery = await h.executor.execute(ctx(runner, s, 'full'), { entity_type: 'tasks' });
  has(fullQuery, [CONTRACT, APP, ASSET], 'full, query_entities(tasks)');
}

// 4. Project and request detail.
async function testPortfolioDetails(h: Harness, runner: QueryRunner, s: Seed) {
  const e = await h.executor.executeDetail(ctx(runner, s, 'e'), { entity_type: 'projects', entity_id: 'PRJ-1' });
  assert.deepEqual(e.data.source_requests, [], 'E: the source request is outside their participation');
  assert.deepEqual(e.data.dependencies, [], 'E: the dependency is outside their participation');
  hasNot(e, [REQUEST, DEPENDENCY], 'E, project detail');
  const p = await h.executor.executeDetail(ctx(runner, s, 'p'), { entity_type: 'projects', entity_id: 'PRJ-1' });
  assert.equal(p.data.source_requests, null, 'P: no source request without the requests right');
  const a = await h.executor.executeDetail(ctx(runner, s, 'a'), { entity_type: 'projects', entity_id: 'PRJ-1' });
  assert.equal(a.data.source_requests.length, 1, 'A: the source request');
  assert.equal(a.data.dependencies.length, 1, 'A: the dependency');

  const q = await h.executor.executeDetail(ctx(runner, s, 'q'), { entity_type: 'requests', entity_id: 'REQ-1' });
  assert.equal(q.data.resulting_projects, null, 'Q: no resulting project without the projects right');
  assert.deepEqual(q.data.dependencies, [], 'Q: no project dependency');
  hasNot(q, [PROJECT, DEPENDENCY], 'Q, request detail');
  const fullRequest = await h.executor.executeDetail(ctx(runner, s, 'full'), { entity_type: 'requests', entity_id: 'REQ-1' });
  assert.equal(fullRequest.data.resulting_projects.length, 1, 'full: the resulting project');
  assert.equal(fullRequest.data.dependencies.length, 1, 'full: the project dependency');
}

// 5. Users.
async function testUsers(h: Harness, runner: QueryRunner, s: Seed) {
  const reader = ctx(runner, s, 'u');
  const detail = await h.executor.executeDetail(reader, { entity_type: 'users', entity_id: s.users.a });
  assert.deepEqual(Object.keys(detail.data).sort(), ['email', 'first_name', 'id', 'last_name', 'status'], 'reader: what the user page shows');
  const list = await h.executor.execute(reader, { entity_type: 'users' });
  hasNot(list, ['Secret job title'], 'reader, users list');
  const description = await h.tools.execute(reader, 'describe_entity_filters', { entity_type: 'users' });
  assert.ok(!/job_title|primary_role|team/.test(JSON.stringify(description)), 'reader: the administration fields are not described');
  const admin = await h.executor.executeDetail(ctx(runner, s, 'full'), { entity_type: 'users', entity_id: s.users.a });
  assert.equal(admin.data.job_title, 'Secret job title', 'administrator: the full row');
  has(await h.executor.execute(ctx(runner, s, 'full'), { entity_type: 'users' }), ['Secret job title'], 'administrator, users list');
}

// 6 and 9. Document relations (get_document, the document page).
async function testDocuments(h: Harness, runner: QueryRunner, s: Seed) {
  for (const surface of ['chat', 'mcp'] as const) {
    const c = await h.tools.execute(ctx(runner, s, 'c', surface), 'get_document', { document_id: 'DOC-1' });
    assert.deepEqual(Object.keys(c.relations), [], `C (${surface}): no linked family`);
    hasNot(c, [APP, ASSET, PROJECT, REQUEST, PROJECT_TASK], `C (${surface}), get_document`);
  }
  const page = await h.knowledge.get('DOC-1', { manager: runner.manager, userId: s.users.c, tenantId: s.tenantId });
  assert.deepEqual(Object.keys(page.relations), [], 'C: the document page names no linked record');
  const full = await h.tools.execute(ctx(runner, s, 'full'), 'get_document', { document_id: 'DOC-1' });
  assert.deepEqual(Object.keys(full.relations).sort(), ['applications', 'assets', 'projects', 'requests', 'tasks']);
  has(full, [APP, ASSET, PROJECT, REQUEST, PROJECT_TASK], 'full, get_document');
}

// 7 and 10. Incident detail, journal and counts.
async function testIncidents(h: Harness, runner: QueryRunner, s: Seed) {
  const d = await h.executor.executeDetail(ctx(runner, s, 'd'), { entity_type: 'incidents', entity_id: 'INC-1' });
  for (const key of ['assets', 'applications', 'technologies']) assert.ok(!(key in d.data), `D: no ${key} section`);
  assert.deepEqual(d.data.entries.map((entry: any) => entry.kind), ['note'], 'D: the note stays, the link changes go');
  hasNot(d, [APP, ASSET], 'D, incident detail');
  const full = await h.executor.executeDetail(ctx(runner, s, 'full'), { entity_type: 'incidents', entity_id: 'INC-1' });
  assert.equal(full.data.entries.length, 3, 'full: every entry');
  has(full, [APP, ASSET], 'full, incident detail');

  const opts = { manager: runner.manager, tenantId: s.tenantId, viewer: { userId: s.users.d, isAdmin: false, canReadIncidents: true, canContributeIncidents: false } };
  const journal = await h.entries.list(s.incident, { ...opts, technologies: false, applications: false });
  assert.deepEqual(journal.map((entry: any) => entry.kind), ['note'], 'journal page without IT rights: the note only');
  const withApps = await h.entries.list(s.incident, { ...opts, technologies: false, applications: true });
  assert.equal(withApps.length, 2, 'journal page with the applications right: the application link change too');
  const record = await h.incidents.get(s.incident, { ...opts, technologies: false, applications: false });
  assert.deepEqual([record.asset_count, record.application_count], [null, null], 'incident page: no linked count');
  const list = await h.incidents.list({}, { ...opts, technologies: false, applications: false });
  assert.deepEqual([list.items[0].asset_count, list.items[0].application_count], [null, null], 'incidents list: no linked count');
}

// 8. Task page and list.
async function testTaskScreens(h: Harness, runner: QueryRunner, s: Seed) {
  const { linkedReadsFromContext } = require('../linked-reads');
  const readsA = linkedReadsFromContext(tenantRequest(runner, s, 'a'));
  const opts = { manager: runner.manager, tenantId: s.tenantId, linkedReads: readsA };
  const contractTask = await h.tasks.getOne(s.contractTask, opts);
  assert.equal(contractTask.related_object_name, null, 'A: no contract name on the task page');
  assert.equal(contractTask.related_object_id, null, 'A: no contract id');
  assert.equal(contractTask.related_object_hidden, true, 'A: the task keeps its link');
  assert.equal(contractTask.related_object_type, 'contract', 'A: the task keeps its own type');
  assert.equal(contractTask.applications, null, 'A: no application field');
  assert.equal(contractTask.assets, null, 'A: no asset field');
  hasNot(contractTask, [CONTRACT, APP, ASSET], 'A, task page');
  const projectTask = await h.tasks.getOne(s.projectTask, opts);
  assert.equal(projectTask.related_object_name, PROJECT, 'A: the project name');
  const list = await h.tasks.listAllTasks({}, opts);
  hasNot(list, [CONTRACT, APP, ASSET], 'A, tasks list');
  const values = await h.tasks.listFilterValues({ fields: 'application_name,asset_name,status' }, opts);
  assert.deepEqual(Object.keys(values), ['status'], 'A: no application or asset values');

  const full = await h.tasks.getOne(s.contractTask, { ...opts, linkedReads: linkedReadsFromContext(tenantRequest(runner, s, 'full')) });
  assert.equal(full.related_object_name, CONTRACT, 'full: the contract name');
  assert.equal(full.applications.length, 1, 'full: the application');
}

// 11. Portfolio routes.
async function testPortfolioRoutes(h: Harness, runner: QueryRunner, s: Seed) {
  const a = tenantRequest(runner, s, 'a');
  await rejects(runner, () => h.projectsController.listLinkedApplications('PRJ-1', a), /cannot read applications/, 'A: project applications refused');
  await rejects(runner, () => h.projectsController.listLinkedAssets('PRJ-1', a), /cannot read assets/, 'A: project assets refused');
  const aReq = rawRequest(runner, s, 'a');
  await rejects(runner, () => h.requestsController.listLinkedApplications('REQ-1', aReq), /cannot read applications/, 'A: request applications refused');
  await rejects(runner, () => h.requestsController.listLinkedAssets('REQ-1', aReq), /cannot read assets/, 'A: request assets refused');

  const e = tenantRequest(runner, s, 'e');
  const eApps = await h.projectsController.listLinkedApplications('PRJ-1', e);
  assert.deepEqual(eApps.items, [], 'E: the application is outside their participation');
  const full = tenantRequest(runner, s, 'full');
  assert.equal((await h.projectsController.listLinkedApplications('PRJ-1', full)).items.length, 1, 'full: the application');
  assert.equal((await h.requestsController.listLinkedAssets('REQ-1', rawRequest(runner, s, 'full'))).items.length, 1, 'full: the asset');

  const pProject = await h.projectsController.get('PRJ-1', { include: 'source_requests,dependencies' }, tenantRequest(runner, s, 'p'));
  assert.equal(pProject.source_requests, null, 'P: no source request on the project page');
  const qRequest = await h.requestsController.get('REQ-1', { include: 'projects,dependencies' }, rawRequest(runner, s, 'q'));
  assert.equal(qRequest.resulting_projects, null, 'Q: no resulting project on the request page');
  assert.deepEqual(qRequest.dependencies, [], 'Q: no project dependency on the request page');
  const aRequest = await h.requestsController.get('REQ-1', { include: 'projects,dependencies' }, aReq);
  assert.equal(aRequest.resulting_projects.length, 1, 'A: the resulting project');
}

// Exception: the servers of an application stay, as on its Deployments tab.
async function testDeploymentsException(h: Harness, runner: QueryRunner, s: Seed) {
  const b = await h.entities.getEntityContext(ctx(runner, s, 'b'), { entity_type: 'applications', entity_id: 'APP-1' });
  assert.ok(relations(b).includes('linked_assets'), 'B: the servers the application runs on');
  has(b, [ASSET], 'B, application context');
}

// Review: the knowledge context, the document filters and writes, the list searches.
async function testKnowledgeContextAndSearches(h: Harness, runner: QueryRunner, s: Seed) {
  // The knowledge tab and Plaid's context name the record a document comes through only to a
  // reader of its module, inside a Business Contributor's participation (E reads knowledge).
  const eTab = await h.knowledge.getKnowledgeContextForEntity('projects', s.project, { manager: runner.manager, userId: s.users.e });
  assert.ok(eTab.groups.some((group: any) => group.key === 'direct'), 'E: the document linked to the project');
  hasNot(eTab, [ASSET, REQUEST, APP], 'E, project knowledge tab');
  const fullTab = await h.knowledge.getKnowledgeContextForEntity('projects', s.project, { manager: runner.manager, userId: s.users.full });
  has(fullTab, [ASSET, REQUEST, APP], 'full, project knowledge tab');
  // Plaid's project context carries the same groups (`testProjectContext` checks E's whole context).
  const eContext = await h.entities.getEntityContext(ctx(runner, s, 'e'), { entity_type: 'projects', entity_id: 'PRJ-1' });
  assert.ok(eContext.knowledge.groups.length > 0, 'E: the project context lists its knowledge');

  // A document's linked-name filters follow the module: refused to Plaid, ignored by the list.
  const cFilter = await h.executor.execute(ctx(runner, s, 'c'), { entity_type: 'documents', filters: { linked_application: { op: 'contains', value: 'Linked' } } });
  assert.equal(cFilter.status, 'invalid_filter', 'C: documents do not filter on applications');
  const noMatch = { filters: { linked_application: { filterType: 'text', type: 'contains', filter: 'no such application' } } };
  const cList = await h.knowledge.list(noMatch, { manager: runner.manager, tenantId: s.tenantId, userId: s.users.c });
  assert.equal(cList.total, 1, 'C: the application filter is ignored');
  const fullList = await h.knowledge.list(noMatch, { manager: runner.manager, tenantId: s.tenantId, userId: s.users.full });
  assert.equal(fullList.total, 0, 'full: the application filter applies');

  // A Plaid write never links (nor replaces) a family the person does not read.
  await rejects(runner, () => h.documentMutations.resolveRelationTargets(ctx(runner, s, 'c'), { applications: [APP] }), /cannot link applications/, 'C: no application link');
  const fullTargets = await h.documentMutations.resolveRelationTargets(ctx(runner, s, 'full'), { applications: [APP] });
  assert.equal(fullTargets.applications.length, 1, 'full: the application resolves');

  // The task and incident lists match a linked name only in the modules the person reads.
  const { linkedReadsFromContext } = require('../linked-reads');
  const taskOpts = (profile: Profile) => ({ manager: runner.manager, tenantId: s.tenantId, linkedReads: linkedReadsFromContext(tenantRequest(runner, s, profile)) });
  const byName = { filters: { related_object_name: { filterType: 'text', type: 'contains', filter: CONTRACT } } };
  assert.equal((await h.tasks.listAllTasks({ q: CONTRACT }, taskOpts('a'))).total, 0, 'A: the search does not match the contract');
  assert.equal((await h.tasks.listAllTasks(byName, taskOpts('a'))).total, 0, 'A: the related filter does not match the contract');
  assert.equal((await h.tasks.listIds({ q: CONTRACT }, taskOpts('a'))).total, 0, 'A: nor the navigation ids');
  assert.equal((await h.tasks.listAllTasks({ q: CONTRACT }, taskOpts('full'))).total, 1, 'full: the search matches the contract');
  assert.equal((await h.tasks.listAllTasks(byName, taskOpts('full'))).total, 1, 'full: the related filter matches the contract');
  const incidentOpts = { manager: runner.manager, tenantId: s.tenantId, viewer: { userId: s.users.d, isAdmin: false, canReadIncidents: true, canContributeIncidents: false } };
  assert.equal((await h.incidents.list({ q: ASSET }, { ...incidentOpts, technologies: false, applications: false })).total, 0, 'D: the search does not match the server');
  assert.equal((await h.incidents.list({ q: APP }, { ...incidentOpts, technologies: false, applications: false })).total, 0, 'D: nor the application');
  assert.equal((await h.incidents.list({ q: ASSET }, { ...incidentOpts, technologies: true, applications: true })).total, 1, 'IT reader: the search matches the server');
}

// 12. A Business Contributor's task outside their participation (screen and Plaid).
async function testTaskParticipation(h: Harness, runner: QueryRunner, s: Seed) {
  const hidden = [DEPENDENCY, PHASE, CONVERTED, APP];
  const eReq = rawRequest(runner, s, 'e');
  const outside = await h.tasksController.getOne('T-3', eReq);
  assert.equal(outside.related_object_type, 'project', 'E: the task keeps its own type');
  assert.equal(outside.related_object_hidden, true, 'E: the project reads as unreadable');
  assert.deepEqual([outside.related_object_id, outside.related_object_name], [null, null], 'E: no project id or name');
  assert.equal(outside.phase_name, null, 'E: no phase');
  assert.deepEqual([outside.converted_request_id, outside.converted_request_item_number], [null, null], 'E: no converted request');
  assert.deepEqual([outside.applications, outside.application_ids], [null, null], 'E: no application field');
  hasNot(outside, hidden, 'E, task page outside their participation');
  const inside = await h.tasksController.getOne('T-1', eReq);
  assert.equal(inside.related_object_name, PROJECT, 'E: the project they take part in');
  assert.equal(inside.applications, null, 'E: an application outside their participation hides the field');

  const list = await h.tasksController.list({}, eReq);
  hasNot(list, hidden, 'E, tasks list');
  const listed = list.items.find((item: any) => item.id === s.outsideTask);
  assert.deepEqual([listed.project_name, listed.phase_name], [null, null], 'E: the list names neither the project nor its phase');
  has(list, [PROJECT], 'E, tasks list');
  const text = (field: string, filter: string) => ({ filters: { [field]: { filterType: 'text', type: 'contains', filter } } });
  const searches: Array<[string, any]> = [
    ['search', { q: DEPENDENCY }],
    ['project filter', text('project_name', DEPENDENCY)],
    ['related filter', text('related_object_name', DEPENDENCY)],
    ['phase filter', text('phase_name', PHASE)],
    ['application filter', text('application_name', APP)],
  ];
  for (const [label, query] of searches) {
    assert.equal((await h.tasksController.list(query, eReq)).total, 0, `E: the ${label} matches nothing outside their participation`);
    assert.ok((await h.tasksController.list(query, rawRequest(runner, s, 'full'))).total > 0, `full: the ${label} matches`);
  }
  assert.equal((await h.tasksController.listIds({ q: DEPENDENCY }, eReq)).total, 0, 'E: nor the navigation ids');
  const values = await h.tasksController.listFilterValues({ fields: 'phase_name,application_name,project_stream_name' }, eReq);
  hasNot(values, [PHASE, APP], 'E, filter values');
  const fullOutside = await h.tasksController.getOne('T-3', rawRequest(runner, s, 'full'));
  assert.deepEqual([fullOutside.related_object_name, fullOutside.phase_name, fullOutside.converted_request_item_number], [DEPENDENCY, PHASE, 2], 'full: the project, its phase, the request');
  assert.equal(fullOutside.applications.length, 1, 'full: the application');
  has(await h.tasksController.listFilterValues({ fields: 'phase_name,application_name' }, rawRequest(runner, s, 'full')), [PHASE, APP], 'full, filter values');

  // Plaid and MCP: the task's context, the lists, the detail and the search.
  for (const surface of ['chat', 'mcp'] as const) {
    const context = await h.entities.getEntityContext(ctx(runner, s, 'e', surface), { entity_type: 'tasks', entity_id: 'T-3' });
    assert.equal(context.entity.metadata.related_object_name, null, `E (${surface}): no project name`);
    assert.equal(context.entity.metadata.phase, null, `E (${surface}): no phase`);
    assert.deepEqual(relations(context), [], `E (${surface}): no project, request or application`);
    hasNot(context, hidden, `E (${surface}), task context`);
  }
  const eInside = await h.entities.getEntityContext(ctx(runner, s, 'e'), { entity_type: 'tasks', entity_id: 'T-1' });
  assert.equal(eInside.entity.metadata.related_object_name, PROJECT, 'E: the project they take part in');
  hasNot(await h.entities.listEntities(ctx(runner, s, 'e'), { entity_type: 'tasks' }), [DEPENDENCY], 'E, tasks list (entity service)');
  hasNot(await h.executor.execute(ctx(runner, s, 'e'), { entity_type: 'tasks' }), hidden, 'E, query_entities(tasks)');
  hasNot(await h.executor.executeDetail(ctx(runner, s, 'e'), { entity_type: 'tasks', entity_id: 'T-3' }), hidden, 'E, get_entity_detail(tasks)');
  const eFiltered = await h.executor.execute(ctx(runner, s, 'e'), { entity_type: 'tasks', filters: { project_name: { op: 'contains', value: DEPENDENCY } } });
  assert.equal(eFiltered.total, 0, 'E: query_entities does not match the project outside their participation');
  // The per-type search (`searchTasks`), called directly: the dispatcher swallows its errors.
  assert.equal((await h.entities.searchTasks(ctx(runner, s, 'e'), DEPENDENCY, 10)).items.length, 0, 'E: the task search does not match the project');
  assert.equal((await h.entities.searchTasks(ctx(runner, s, 'full'), DEPENDENCY, 10)).items.length, 1, 'full: the task search matches the project');
  const full = await h.entities.getEntityContext(ctx(runner, s, 'full'), { entity_type: 'tasks', entity_id: 'T-3' });
  assert.equal(full.entity.metadata.related_object_name, DEPENDENCY, 'full: the project name');
  assert.deepEqual(relations(full), ['converted_request', 'linked_applications', 'related_project'], 'full: the project, the request, the application');
}

const linkCount = async (runner: QueryRunner, table: string, documentId: string) =>
  Number((await runner.query(`SELECT count(*)::int AS n FROM ${table} WHERE document_id = $1`, [documentId]))[0].n);

// 13. Document link writes through the API.
async function testDocumentLinkWrites(h: Harness, runner: QueryRunner, s: Seed) {
  const write = (profile: Profile, body: any) => h.knowledgeController.bulkReplaceRelationSets('DOC-1', body, tenantRequest(runner, s, profile));
  const family = (profile: Profile, entity: string, ids: string[]) =>
    h.knowledgeController.bulkReplaceGenericRelations('DOC-1', entity, { ids }, tenantRequest(runner, s, profile));

  // C reads no linked module: every family is refused, even an empty one, which would clear it.
  await rejects(runner, () => write('c', { applications: [] }), /cannot change the applications linked to this document/, 'C: no application write');
  await rejects(runner, () => family('c', 'projects', [s.project]), /cannot change the projects linked/, 'C: no project write');
  await rejects(runner, () => h.knowledgeController.bulkReplaceApplicationRelations('DOC-1', { application_ids: [] }, tenantRequest(runner, s, 'c')), /cannot change the applications/, 'C: nor through the family route');
  assert.equal(await linkCount(runner, 'document_applications', s.document), 1, 'C: the application link stays');

  // K reads projects, not applications: a family left out stays, an unread one is refused whole.
  await rejects(runner, () => write('k', { projects: [], applications: [] }), /cannot change the applications/, 'K: no application write');
  assert.equal(await linkCount(runner, 'document_projects', s.document), 1, 'K: a refused write changes nothing');
  await write('k', { projects: [s.project, s.dependency] });
  assert.equal(await linkCount(runner, 'document_projects', s.document), 2, 'K: the projects are replaced');
  assert.equal(await linkCount(runner, 'document_applications', s.document), 1, 'K: the applications, left out, stay');
  await write('k', { relations: { projects: [s.project] } });
  assert.equal(await linkCount(runner, 'document_projects', s.document), 1, 'K: the wrapped form too');

  // E adds only the records they take part in; a link already there may stay.
  await rejects(runner, () => write('e', { projects: [s.project, s.dependency] }), /only link projects you take part in/, 'E: no project outside their participation');
  await write('full', { requests: [] });
  await rejects(runner, () => family('e', 'requests', [s.request]), /only link requests you take part in/, 'E: no request outside their participation');
  await write('e', { projects: [s.project], applications: [s.application] });
  assert.equal(await linkCount(runner, 'document_applications', s.document), 1, 'E: the application already linked stays');
  await rejects(runner, () => write('e', { assets: [] }), /cannot change the assets/, 'E: no infrastructure write');

  await write('full', { projects: [s.project, s.dependency] });
  assert.equal(await linkCount(runner, 'document_projects', s.document), 2, 'full: any project');
}

// 14. No counter for a hidden family.
async function testHiddenFamilyCounters(h: Harness, runner: QueryRunner, s: Seed) {
  const viewer = { userId: s.users.d, isAdmin: false, canReadIncidents: true, canContributeIncidents: false };
  const entries = async (technologies: boolean, applications: boolean) =>
    (await h.incidents.get(s.incident, { manager: runner.manager, tenantId: s.tenantId, viewer, technologies, applications })).counts.entries;
  assert.equal(await entries(false, false), 1, 'D: the journal badge counts the note only, as the journal shows');
  assert.equal(await entries(false, true), 2, 'applications reader: the application link change too');
  assert.equal(await entries(true, true), 3, 'IT reader: every entry');

  // A budget line and a business process linked to the application and the project.
  const line = await insertId(runner,
    `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, nature) VALUES ($1, 'Hidden line', 'EUR', '2026-01-01', 1, 'opex')`,
    [s.tenantId]);
  await runner.query(`INSERT INTO application_spend_items (tenant_id, application_id, spend_item_id) VALUES ($1, $2, $3)`, [s.tenantId, s.application, line]);
  await runner.query(`INSERT INTO portfolio_project_opex (tenant_id, project_id, opex_id) VALUES ($1, $2, $3)`, [s.tenantId, s.project, line]);
  const process = await insertId(runner, `INSERT INTO business_processes (tenant_id, name) VALUES ($1, 'Hidden process')`, [s.tenantId]);
  await runner.query(`INSERT INTO application_business_processes (tenant_id, application_id, business_process_id) VALUES ($1, $2, $3)`, [s.tenantId, s.application, process]);

  const { ApplicationsController } = require('../../../applications/applications.controller');
  const applications = h.app.get(ApplicationsController);
  const b = await applications.relationCounts('APP-1', tenantRequest(runner, s, 'b'));
  assert.deepEqual([b.budget_lines_hidden, b.processes, b.technologies, b.total], [0, 0, 0, 0], 'B: no budget line, process or technology counted');
  const bTab = await applications.getRelations('APP-1', tenantRequest(runner, s, 'b'));
  assert.deepEqual([bTab.budget_lines, bTab.budget_lines_hidden], [null, 0], 'B: the Relations tab neither lists nor counts the budget lines');
  const full = await applications.relationCounts('APP-1', tenantRequest(runner, s, 'full'));
  assert.deepEqual([full.opex, full.processes], [1, 1], 'full: the line and the process');

  const aProject = await h.projectsController.get('PRJ-1', { include: 'financials' }, tenantRequest(runner, s, 'a'));
  assert.deepEqual([aProject.opex_items, aProject.budget_lines_hidden], [null, 0], 'A: the project counts no budget line');
  const fullProject = await h.projectsController.get('PRJ-1', { include: 'financials' }, tenantRequest(runner, s, 'full'));
  assert.equal(fullProject.opex_items.length, 1, 'full: the project lists the line');
}

// 15. The document's link selectors offer what the document shows.
async function testRelationOptions(h: Harness, runner: QueryRunner, s: Seed) {
  // A second application E owns, and a task of the dependency project E is not assigned to.
  const owned = await insertId(runner,
    `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, 'Owned app', 'APP-2', 'enabled')`, [s.tenantId]);
  await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`,
    [s.tenantId, owned, s.users.e]);
  await insertId(runner,
    `INSERT INTO tasks (tenant_id, item_number, title, description, status, related_object_type, related_object_id, labels, owner_ids, viewer_ids)
     VALUES ($1, 90, 'Unassigned task', '', 'open', 'project', $2, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`, [s.tenantId, s.dependency]);
  const options = async (profile: Profile, entity: string) => {
    const result = await h.knowledgeController.listRelationOptions(entity, { limit: 50 }, tenantRequest(runner, s, profile));
    return result.items.map((item: { label: string }) => item.label).sort();
  };

  // C reads no linked module: every selector is empty (the page shows none of these families).
  for (const entity of ['applications', 'assets', 'projects', 'requests', 'tasks', 'interfaces', 'connections', 'incidents']) {
    assert.deepEqual(await options('c', entity), [], `C: no ${entity} option`);
  }
  // K reads projects, not applications.
  assert.deepEqual(await options('k', 'projects'), [`PRJ-1 - ${PROJECT}`, `PRJ-2 - ${DEPENDENCY}`], 'K: every project');
  assert.deepEqual(await options('k', 'applications'), [], 'K: no application option');
  // E: the project they take part in, the application they own, their own tasks; no request.
  assert.deepEqual(await options('e', 'projects'), [`PRJ-1 - ${PROJECT}`], 'E: their project only');
  assert.deepEqual(await options('e', 'applications'), ['Owned app'], 'E: the application they own only');
  assert.deepEqual(await options('e', 'requests'), [], 'E: no request outside their participation');
  const eTasks = await options('e', 'tasks');
  has(eTasks, [PROJECT_TASK, 'Outside task'], 'E: their tasks');
  hasNot(eTasks, ['Unassigned task'], 'E: a task outside their participation');
  assert.deepEqual(await options('e', 'assets'), [], 'E: no asset option without infrastructure');
  // Counter-check: an administrator gets every family.
  has(await options('full', 'applications'), [APP, 'Owned app'], 'full: applications');
  has(await options('full', 'assets'), [ASSET], 'full: assets');
  has(await options('full', 'projects'), [PROJECT, DEPENDENCY], 'full: projects');
  has(await options('full', 'requests'), [REQUEST, CONVERTED], 'full: requests');
  has(await options('full', 'tasks'), [PROJECT_TASK, 'Unassigned task'], 'full: tasks');
  has(await options('full', 'incidents'), ['Outage'], 'full: incidents');
}

const contractLinks = async (runner: QueryRunner, table: string, contractId: string) =>
  (await runner.query(`SELECT * FROM ${table} WHERE contract_id = $1`, [contractId])).length;

// 16. A contract's linked applications and assets.
async function testContractRelations(h: Harness, runner: QueryRunner, s: Seed) {
  const { ContractsController } = require('../../../contracts/contracts.controller');
  const { ContractRenewalController } = require('../../../contracts/contract-renewal.controller');
  const contracts = h.app.get(ContractsController);
  const renewal = h.app.get(ContractRenewalController);
  // The contract covers the application, an application E owns and the server, which it also supports.
  const owned = await insertId(runner,
    `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, 'Covered owned app', 'APP-3', 'enabled')`, [s.tenantId]);
  await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`,
    [s.tenantId, owned, s.users.e]);
  await runner.query(`INSERT INTO application_contracts (tenant_id, contract_id, application_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
    [s.tenantId, s.contract, s.application, owned]);
  await runner.query(`INSERT INTO asset_contracts (tenant_id, contract_id, asset_id) VALUES ($1, $2, $3)`, [s.tenantId, s.contract, s.asset]);
  await runner.query(`INSERT INTO asset_support_info (tenant_id, asset_id, support_contract_id) VALUES ($1, $2, $3)`, [s.tenantId, s.asset, s.contract]);
  // A second contract covers nothing: the list's covered application filter tells them apart.
  await runner.query(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date)
     SELECT tenant_id, 'Uncovered contract', company_id, supplier_id, start_date FROM contracts WHERE id = $1`, [s.contract]);

  // The routes check the contracts right (guard); the families follow the request's permissions.
  const req = (profile: Profile, permissions: Record<string, string>) => ({ ...rawRequest(runner, s, profile), permissions });
  const contractsOnly = req('a', { contracts: 'member' });
  const appsReader = req('b', { contracts: 'member', applications: 'reader' });
  const contributor = req('e', { contracts: 'member', applications: 'reader' });
  const full = rawRequest(runner, s, 'full');
  const names = (rows: Array<{ name: string }> | null) => (rows === null ? null : rows.map((row) => row.name));
  const counts = async (r: any) => {
    const c = await contracts.relationCounts(s.contract, r);
    return [c.applications, c.assets, c.technologies, c.relations];
  };

  // Contracts only: no linked application, asset or technology, and no counter.
  const a = await contracts.relations(s.contract, contractsOnly);
  assert.deepEqual([a.applications, a.assets, a.technologies], [null, null, null], 'contracts only: no family on the tab');
  hasNot(a, [APP, 'Covered owned app', ASSET], 'contracts only: the tab');
  assert.deepEqual(await counts(contractsOnly), [null, null, null, 0], 'contracts only: no counter');
  assert.deepEqual(await contracts.listApplications(s.contract, contractsOnly), { items: null }, 'contracts only: no application list');
  assert.deepEqual(await contracts.listAssets(s.contract, contractsOnly), { items: null }, 'contracts only: no asset list');
  // B reads the applications, not the infrastructure.
  const b = await contracts.relations(s.contract, appsReader);
  assert.deepEqual([names(b.applications), b.assets, b.technologies], [['Covered owned app', APP], null, null], 'B: the applications only');
  assert.deepEqual(await counts(appsReader), [2, null, null, 2], 'B: the applications counted');
  // E: the application they own, not the other one.
  const e = await contracts.relations(s.contract, contributor);
  assert.deepEqual(names(e.applications), ['Covered owned app'], 'E: the application they take part in');
  hasNot(e, [APP], 'E: the application outside their participation');
  assert.deepEqual(await counts(contributor), [1, null, null, 1], 'E: one application counted');
  assert.deepEqual(names((await contracts.listApplications(s.contract, contributor)).items), ['Covered owned app'], 'E: the family route');
  // Counter-check: an administrator gets every family.
  const all = await contracts.relations(s.contract, full);
  assert.deepEqual([names(all.applications), names(all.assets), names(all.technologies)], [['Covered owned app', APP], [ASSET], []], 'full: every family');
  assert.deepEqual(await counts(full), [2, 1, 0, 3], 'full: every family counted');

  // What a termination changes names the same records.
  const endDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const impact = async (r: any) => {
    const view = await renewal.get(s.contract, endDate, r);
    return [names(view.impact.applications), names(view.impact.assets)];
  };
  assert.deepEqual(await impact(contractsOnly), [[], []], 'contracts only: no application or asset in the consequences');
  assert.deepEqual(await impact(appsReader), [['Covered owned app', APP], []], 'B: the applications');
  assert.deepEqual(await impact(contributor), [['Covered owned app'], []], 'E: their application');
  assert.deepEqual(await impact(full), [['Covered owned app', APP], [ASSET]], 'full: every consequence');

  // The list's covered application filter applies for a reader of the applications only.
  const covering = async (r: any) => {
    const list = await contracts.list({ filters: JSON.stringify({ covered_application: { filterType: 'set', values: ['APP-1'] } }) }, r);
    return list.items.map((row: { name: string }) => row.name).sort();
  };
  assert.deepEqual(await covering(contractsOnly), [CONTRACT, 'Uncovered contract'], 'contracts only: the filter is not applied');
  assert.deepEqual(await covering(appsReader), [CONTRACT], 'B: the contract that covers APP-1');
  assert.deepEqual(await covering(contributor), [], 'E: APP-1 is outside their participation');
  assert.deepEqual(await covering(full), [CONTRACT], 'full: the contract that covers APP-1');

  // Writes: a family the person does not read is refused, even empty (it would clear the family).
  await rejects(runner, () => contracts.bulkReplaceApplications(s.contract, { application_ids: [] }, contractsOnly), /cannot read applications/, 'contracts only: no application replacement');
  await rejects(runner, () => contracts.bulkReplaceAssets(s.contract, { asset_ids: [] }, appsReader), /cannot read assets/, 'B: no asset replacement');
  await rejects(runner, () => contracts.unlinkRelation(s.contract, 'applications', s.application, contractsOnly), /cannot read applications/, 'contracts only: no unlink');
  await rejects(runner, () => contracts.linkRelation(s.contract, 'assets', { id: s.asset }, appsReader), /cannot read assets/, 'B: no asset link');
  assert.deepEqual([await contractLinks(runner, 'application_contracts', s.contract), await contractLinks(runner, 'asset_contracts', s.contract)], [2, 1], 'refused writes change nothing');

  // E replaces the applications they see: the other one stays. Outside their participation, nothing.
  await contracts.bulkReplaceApplications(s.contract, { application_ids: [] }, contributor);
  assert.deepEqual((await runner.query(`SELECT application_id FROM application_contracts WHERE contract_id = $1`, [s.contract])).map((row: any) => row.application_id), [s.application], 'E: the application outside their participation stays');
  await rejects(runner, () => contracts.bulkReplaceApplications(s.contract, { application_ids: [s.application] }, contributor), /only link applications you take part in/, 'E: no replacement with an application outside');
  await rejects(runner, () => contracts.unlinkRelation(s.contract, 'applications', s.application, contributor), /only link applications you take part in/, 'E: no unlink outside');
  assert.deepEqual(await contracts.linkRelation(s.contract, 'applications', { id: owned }, contributor), { ok: true, changed: true }, 'E: links their application');
  assert.equal(await contractLinks(runner, 'application_contracts', s.contract), 2, 'E: both applications linked again');
  // Counter-check: B removes any application; the assets, left out, stay.
  await contracts.bulkReplaceApplications(s.contract, { application_ids: [owned] }, appsReader);
  assert.deepEqual([await contractLinks(runner, 'application_contracts', s.contract), await contractLinks(runner, 'asset_contracts', s.contract)], [1, 1], 'B: one application left, the server stays');
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      await testProjectContext(harness, runner, s);
      await testRequestContext(harness, runner, s);
      await testTaskContextAndLists(harness, runner, s);
      await testPortfolioDetails(harness, runner, s);
      await testUsers(harness, runner, s);
      await testDocuments(harness, runner, s);
      await testIncidents(harness, runner, s);
      await testTaskScreens(harness, runner, s);
      await testPortfolioRoutes(harness, runner, s);
      await testDeploymentsException(harness, runner, s);
      await testKnowledgeContextAndSearches(harness, runner, s);
      await testTaskParticipation(harness, runner, s);
      await testDocumentLinkWrites(harness, runner, s);
      await testHiddenFamilyCounters(harness, runner, s);
      await testRelationOptions(harness, runner, s);
      await testContractRelations(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('linked-records-follow-rights.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
