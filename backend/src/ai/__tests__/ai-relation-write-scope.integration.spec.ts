import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// A relation write asked of the assistant touches only the links the person reads; the others stay.
// A Business Contributor who also writes budget lines reads the applications and the projects of
// their participation only:
// - a project's, a request's and a budget line's applications: the preview lists the visible links,
//   the run adds and removes among them, the link to an application outside the participation stays
//   (also through an undo);
// - a budget line's projects: the same, the preview no longer names the project they do not read;
// - an application outside the participation cannot be linked: refused as a missing one, at the
//   preview, and at the run when the participation ended in between;
// - a visible link that becomes unseen between the preview and the run: the run is refused and the
//   link stays;
// - a task's applications (`update_task_fields`): the same; an application outside the
//   participation is refused as a missing one;
// - a new document's links (`create_document`): records outside the participation are not found;
// - another tenant's links are never touched.
// An application's server assignments need the member level on the infrastructure, as the screen.
// The AI surface checks are not under test: stubbed open.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-relation-write-scope-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; previews: any };

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-relation-write-scope.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiMutationPreviewService } = require('../ai-mutation-preview.service');
  const { AiPolicyService } = require('../ai-policy.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  return { app, dataSource: app.get(DataSource), previews: app.get(AiMutationPreviewService) };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

async function asTenant(runner: QueryRunner, tenantId: string): Promise<void> {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function newTenant(runner: QueryRunner, prefix: string): Promise<string> {
  const tenantId = randomUUID();
  const slug = `${prefix}-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
  await asTenant(runner, tenantId);
  return tenantId;
}

async function refusal(fn: () => Promise<unknown>): Promise<string> {
  const error = await fn().then(() => null, (caught: any) => caught);
  assert.ok(error, 'refused');
  return String(error.message);
}

async function run() {
  const h = await createHarness();
  const runner = h.dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    // Another tenant first: its link must survive everything below.
    const otherTenant = await newTenant(runner, 'ai-scope-other');
    const otherProject = await insertId(runner, `INSERT INTO portfolio_projects (tenant_id, item_number, name) VALUES ($1, 1, 'Other tenant project')`, [otherTenant]);
    const otherApp = await insertId(runner, `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, 'Other tenant app', 'APP-1', 'enabled')`, [otherTenant]);
    await runner.query(`INSERT INTO application_projects (tenant_id, application_id, project_id) VALUES ($1, $2, $3)`, [otherTenant, otherApp, otherProject]);

    const tenantId = await newTenant(runner, 'ai-scope');
    const role = async (name: string, permissions: Record<string, string>) => {
      const id = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, $2, $2)`, [tenantId, name]);
      for (const [resource, level] of Object.entries(permissions)) {
        await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, id, resource, level]);
      }
      return id;
    };
    const user = async (key: string, roleIds: string[]) => {
      const id = await insertId(runner,
        `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, $3, 'Tester', $4, 'enabled')`,
        [tenantId, `${key}-${tenantId.slice(0, 8)}@example.test`, key, roleIds[0]]);
      for (const [index, roleId] of roleIds.entries()) {
        await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, $4)`, [tenantId, id, roleId, index === 0]);
      }
      return id;
    };
    // The built-in role's name sets the participation scope; the budget role reads neither projects nor applications.
    const bcRole = await role('Business Contributor', { ai_chat: 'member', portfolio_projects: 'contributor', portfolio_requests: 'member', applications: 'reader', tasks: 'member' });
    const budgetRole = await role('Budget and document writer', { budget: 'member', knowledge: 'member' });
    const bc = await user('Bc', [bcRole, budgetRole]);
    const appMember = await user('AppMember', [await role('Application writer', { ai_chat: 'member', applications: 'member' })]);

    const project = (number: number, name: string, leadId: string | null) => insertId(runner,
      `INSERT INTO portfolio_projects (tenant_id, item_number, name, business_lead_id) VALUES ($1, $2, $3, $4)`, [tenantId, number, name, leadId]);
    const p1 = await project(1, 'Mine', bc);
    const p2 = await project(2, 'Theirs', null);
    const p3 = await project(3, 'Mine too', bc);
    const application = async (number: number, name: string, owned: boolean) => {
      const id = await insertId(runner,
        `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, $2, $3, 'enabled')`, [tenantId, name, `APP-${number}`]);
      if (owned) {
        await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`, [tenantId, id, bc]);
      }
      return id;
    };
    const a1 = await application(1, 'Seen one', true);
    const a2 = await application(2, 'Unseen', false);
    const a3 = await application(3, 'Seen three', true);
    const a4 = await application(4, 'Seen four', true);
    const r1 = await insertId(runner, `INSERT INTO portfolio_requests (tenant_id, item_number, name, requestor_id) VALUES ($1, 1, 'My request', $2)`, [tenantId, bc]);
    const line = await insertId(runner,
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number) VALUES ($1, 'Licences', 'EUR', '2026-01-01', 1)`, [tenantId]);
    await runner.query(`INSERT INTO application_projects (tenant_id, application_id, project_id) VALUES ($1, $2, $4), ($1, $3, $4)`, [tenantId, a1, a2, p1]);
    await runner.query(`INSERT INTO portfolio_request_applications (tenant_id, request_id, application_id) VALUES ($1, $2, $3), ($1, $2, $4)`, [tenantId, r1, a1, a2]);
    await runner.query(`INSERT INTO portfolio_project_opex (tenant_id, project_id, opex_id) VALUES ($1, $2, $4), ($1, $3, $4)`, [tenantId, p1, p2, line]);
    await runner.query(`INSERT INTO application_spend_items (tenant_id, application_id, spend_item_id) VALUES ($1, $2, $4), ($1, $3, $4)`, [tenantId, a1, a2, line]);

    const ctx = (userId: string) => ({
      tenantId, userId, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const, manager: runner.manager, conversationId: null,
    });
    const sorted = (ids: string[]) => [...ids].sort();
    const ids = async (sql: string, id: string) => sorted((await runner.query(sql, [tenantId, id])).map((row: { id: string }) => row.id));
    const projectApps = () => ids(`SELECT application_id AS id FROM application_projects WHERE tenant_id = $1 AND project_id = $2`, p1);
    const requestApps = () => ids(`SELECT application_id AS id FROM portfolio_request_applications WHERE tenant_id = $1 AND request_id = $2`, r1);
    const lineProjects = () => ids(`SELECT project_id AS id FROM portfolio_project_opex WHERE tenant_id = $1 AND opex_id = $2`, line);
    const lineApps = () => ids(`SELECT application_id AS id FROM application_spend_items WHERE tenant_id = $1 AND spend_item_id = $2`, line);
    const shown = (preview: any) => JSON.stringify(preview.changes ?? preview);
    const relation = (entity: string, ref: string, rel: string, extra: Record<string, unknown>) =>
      h.previews.createPreview(ctx(bc), 'update_entity_relations', { entity_type: entity, ref, relation: rel, ...extra });
    const approve = async (preview: any) => h.previews.executePreview(ctx(bc), preview.preview_id);

    // A project's applications: the preview names the visible link only, the run keeps the other.
    const add = await relation('projects', 'PRJ-1', 'applications', { add: ['APP-3'] });
    assert.ok(!shown(add).includes('Unseen'), 'the preview does not name the unseen application');
    assert.equal((await approve(add)).status, 'executed');
    assert.deepEqual(await projectApps(), sorted([a1, a2, a3]), 'project: the unseen link stays beside the addition');
    const remove = await relation('projects', 'PRJ-1', 'applications', { remove: ['APP-1'] });
    assert.equal((await approve(remove)).status, 'executed');
    assert.deepEqual(await projectApps(), sorted([a2, a3]), 'project: removal among the visible links only');
    const undo = await h.previews.createReversePreview(ctx(bc), remove.preview_id);
    assert.equal((await approve(undo)).status, 'executed');
    assert.deepEqual(await projectApps(), sorted([a1, a2, a3]), 'project: the undo keeps the unseen link');
    console.log('  project applications: unseen link kept on add, remove and undo: OK');

    // An application outside the participation: refused at the preview as a missing one.
    assert.equal(await refusal(() => relation('projects', 'PRJ-1', 'applications', { add: ['APP-2'] })), 'No applications found matching "APP-2".');
    assert.equal(await refusal(() => relation('projects', 'PRJ-1', 'applications', { remove: ['APP-2'] })), 'No applications found matching "APP-2".');
    // In the participation at the preview, outside it at the run: refused, nothing written.
    const late = await relation('projects', 'PRJ-1', 'applications', { add: ['APP-4'] });
    await runner.query(`DELETE FROM application_owners WHERE tenant_id = $1 AND application_id = $2`, [tenantId, a4]);
    const lateRun = await approve(late);
    assert.equal(lateRun.status, 'failed', 'an addition outside the participation at the run');
    assert.deepEqual(await projectApps(), sorted([a1, a2, a3]), 'nothing written');
    await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`, [tenantId, a4, bc]);
    // A visible link that becomes unseen between the preview and the run: refused, the link stays.
    const before = await relation('projects', 'PRJ-1', 'applications', { add: ['APP-4'] });
    await runner.query(`DELETE FROM application_owners WHERE tenant_id = $1 AND application_id = $2`, [tenantId, a3]);
    assert.equal((await approve(before)).status, 'failed', 'the visible links changed since the preview');
    assert.deepEqual(await projectApps(), sorted([a1, a2, a3]), 'the link become unseen stays');
    await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`, [tenantId, a3, bc]);
    console.log('  outside the participation: refused at the preview and at the run; unseen in between: kept: OK');

    // A request's applications.
    const requestAdd = await relation('requests', 'REQ-1', 'applications', { add: ['APP-3'] });
    assert.ok(!shown(requestAdd).includes('Unseen'), 'request: the preview does not name the unseen application');
    assert.equal((await approve(requestAdd)).status, 'executed');
    assert.deepEqual(await requestApps(), sorted([a1, a2, a3]), 'request: the unseen link stays');
    // A budget line's applications and projects.
    const lineAppAdd = await relation('budget_lines', 'BL-1', 'applications', { add: ['APP-3'] });
    assert.ok(!shown(lineAppAdd).includes('Unseen'), 'line: the preview does not name the unseen application');
    assert.equal((await approve(lineAppAdd)).status, 'executed');
    assert.deepEqual(await lineApps(), sorted([a1, a2, a3]), 'line applications: the unseen link stays');
    const lineProjectAdd = await relation('budget_lines', 'BL-1', 'projects', { add: ['PRJ-3'] });
    assert.ok(!shown(lineProjectAdd).includes('Theirs'), 'line: the preview does not name the project outside the participation');
    assert.equal((await approve(lineProjectAdd)).status, 'executed');
    assert.deepEqual(await lineProjects(), sorted([p1, p2, p3]), 'line projects: the unseen link stays');
    const lineProjectRemove = await relation('budget_lines', 'BL-1', 'projects', { remove: ['PRJ-1', 'PRJ-3'] });
    assert.equal((await approve(lineProjectRemove)).status, 'executed');
    assert.deepEqual(await lineProjects(), [p2], 'line projects: removing every visible link keeps the unseen one');
    assert.equal(await refusal(() => relation('budget_lines', 'BL-1', 'projects', { add: ['PRJ-2'] })), 'No projects found matching "PRJ-2".');
    console.log('  request applications, budget line applications and projects: unseen links kept: OK');

    // A task's applications.
    const task = await insertId(runner,
      `INSERT INTO tasks (tenant_id, item_number, title, status, assignee_user_id, labels, owner_ids, viewer_ids) VALUES ($1, 1, 'My task', 'open', $2, '[]', '[]', '[]')`,
      [tenantId, bc]);
    await runner.query(`INSERT INTO task_applications (tenant_id, task_id, application_id) VALUES ($1, $2, $3), ($1, $2, $4)`, [tenantId, task, a1, a2]);
    const taskApps = () => ids(`SELECT application_id AS id FROM task_applications WHERE tenant_id = $1 AND task_id = $2`, task);
    const taskFields = (applications: string[]) =>
      h.previews.createPreview(ctx(bc), 'update_task_fields', { ref: 'T-1', fields: { applications } });
    const taskSet = await taskFields(['APP-3']);
    assert.ok(!shown(taskSet).includes('Unseen'), 'task: the preview does not name the unseen application');
    assert.equal((await approve(taskSet)).status, 'executed');
    assert.deepEqual(await taskApps(), sorted([a2, a3]), 'task: the unseen link stays');
    assert.match(await refusal(() => taskFields(['APP-3', 'Unseen'])), /Unseen/, 'task: an application outside the participation');
    assert.match(await refusal(() => taskFields(['APP-3', 'APP-2'])), /APP-2/, 'task: an application outside the participation, by reference');
    assert.deepEqual(await taskApps(), sorted([a2, a3]), 'task: nothing written');
    console.log('  task applications: unseen link kept, unseen application refused: OK');

    // A new document's links.
    await runner.query(`INSERT INTO document_libraries (tenant_id, name, slug, is_system, display_order) VALUES ($1, 'Notes', 'notes', false, 0)`, [tenantId]);
    assert.match(await refusal(() => h.previews.createPreview(ctx(bc), 'create_document', { title: 'Notes', projects: ['PRJ-2'] })), /PRJ-2/);
    assert.match(await refusal(() => h.previews.createPreview(ctx(bc), 'create_document', { title: 'Notes', applications: ['Unseen'] })), /Unseen/);
    const documentPreview = await h.previews.createPreview(ctx(bc), 'create_document', { title: 'Notes', projects: ['PRJ-1'] });
    assert.ok(shown(documentPreview).includes('Mine'), 'document: a project of the participation is linked');
    console.log('  document creation: records outside the participation are not found: OK');

    // Server assignments: the member level on the infrastructure, as the Deployments tab.
    assert.match(
      await refusal(() => h.previews.createPreview(ctx(appMember), 'update_entity_relations', {
        entity_type: 'applications', ref: 'APP-1', relation: 'asset_assignments', add: [{ environment: 'prod', asset_ref: 'Any', role: 'web' }],
      })),
      /IT infrastructure/,
    );
    console.log('  server assignments need the infrastructure member level: OK');

    await asTenant(runner, otherTenant);
    const [other] = await runner.query(`SELECT count(*)::int AS n FROM application_projects WHERE tenant_id = $1`, [otherTenant]);
    assert.equal(other.n, 1, 'another tenant: nothing touched');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await h.app.close();
  }
  console.log('ai-relation-write-scope.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
