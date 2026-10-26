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
};

/**
 * A: portfolio and tasks, no IT, no contracts. B: applications only. C: knowledge only.
 * D: incidents only. E: Business Contributor (projects, requests, tasks, applications; no IT).
 * P: projects only. Q: requests only. U: users reader. Full: Administrator.
 */
type Profile = 'a' | 'b' | 'c' | 'd' | 'e' | 'p' | 'q' | 'u' | 'full';

const PERMISSIONS: Record<Exclude<Profile, 'full'>, Record<string, string>> = {
  a: { portfolio_projects: 'reader', portfolio_requests: 'reader', tasks: 'reader' },
  b: { applications: 'reader' },
  c: { knowledge: 'reader' },
  d: { incidents: 'reader' },
  e: { portfolio_projects: 'contributor', portfolio_requests: 'contributor', tasks: 'contributor', applications: 'reader' },
  p: { portfolio_projects: 'reader' },
  q: { portfolio_requests: 'reader' },
  u: { users: 'reader' },
};

const ROLE_NAMES: Record<Profile, string> = {
  a: 'Portfolio and tasks', b: 'Applications only', c: 'Knowledge only', d: 'Incidents only',
  e: 'Business Contributor', p: 'Projects only', q: 'Requests only', u: 'Users reader', full: 'Administrator',
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

  const task = (itemNumber: number, title: string, type: string, related: string) => insertId(runner,
    `INSERT INTO tasks (tenant_id, item_number, title, description, status, related_object_type, related_object_id, labels, owner_ids, viewer_ids, assignee_user_id)
     VALUES ($1, $2, $3, '', 'open', $4, $5, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, $6)`,
    [tenantId, itemNumber, title, type, related, users.e]);
  const projectTask = await task(1, PROJECT_TASK, 'project', project);
  const contractTask = await task(2, 'Contract task', 'contract', contract);
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
    projectTask, contractTask, document, incident,
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
