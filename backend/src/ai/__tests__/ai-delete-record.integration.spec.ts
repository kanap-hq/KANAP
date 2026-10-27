import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Lot L3, lot 1: Plaid deletes one task, one contact or one location under preview.
// - A task deletes through its screen service, with the counts of what goes with it and an
//   `ai_chat` audit entry naming the preview; its comments and time entries go.
// - A task that started a request is refused before any preview exists, and a task outside a
//   Business Contributor's scope reads as missing.
// - A contact deletes for its administrator, with its links counted by readable family and the
//   others left unnamed; a member and a limited person are refused, at the preview and at the run.
// - A location deletes for a member, and its assets keep existing without a location.
// - A reader is refused, a record changed between the preview and the run is refused, and two
//   deletes never enter a mutation plan.
// The AI surface checks are stubbed open: this spec tests the operation, not the routes.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-delete-record-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; previews: any; tools: any };
type UserKey = 'taskAdmin' | 'contactsAdmin' | 'member' | 'reader' | 'limited' | 'limitedLater' | 'bc';
type Seed = {
  tenantId: string;
  users: Record<UserKey, string>;
  task: string;
  originTask: string;
  bcTask: string;
  otherTask: string;
  contact: string;
  location: string;
  secondLocation: string;
  asset: string;
};

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-delete-record.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiMutationPreviewService } = require('../ai-mutation-preview.service');
  const { AiPolicyService } = require('../ai-policy.service');
  const { AiToolRegistry } = require('../ai-tool.registry');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const policy = app.get(AiPolicyService);
  policy.assertSurfaceAccess = async () => undefined;
  return { app, dataSource: app.get(DataSource), previews: app.get(AiMutationPreviewService), tools: app.get(AiToolRegistry) };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `ai-l3-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

  const role = async (name: string, permissions: Record<string, string>) => {
    const id = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, $2, $2)`, [tenantId, name]);
    for (const [resource, level] of Object.entries(permissions)) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, id, resource, level]);
    }
    return id;
  };
  const user = async (key: string, roleId: string, dataAccessMode = 'all') => insertId(runner,
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, data_access_mode)
     VALUES ($1, $2, $3, 'Tester', $4, 'enabled', $5)`,
    [tenantId, `${key}-${slug}@example.test`, key, roleId, dataAccessMode]);
  const users: Record<UserKey, string> = {
    taskAdmin: await user('TaskAdmin', await role('Task Administrator', {
      ai_chat: 'member', tasks: 'admin', applications: 'reader', infrastructure: 'reader', knowledge: 'reader',
    })),
    contactsAdmin: await user('ContactsAdmin', await role('Contacts Administrator', {
      ai_chat: 'member', contacts: 'admin', suppliers: 'reader', portfolio_projects: 'reader',
    })),
    member: await user('Member', await role('Member', {
      ai_chat: 'member', tasks: 'member', contacts: 'member', locations: 'member', infrastructure: 'reader',
    })),
    reader: await user('Reader', await role('Reader', {
      ai_chat: 'member', tasks: 'reader', contacts: 'reader', locations: 'reader',
    })),
    limited: await user('Limited', await role('Limited Contacts Administrator', { ai_chat: 'member', contacts: 'admin' }), 'limited'),
    limitedLater: await user('LimitedLater', await role('Later Limited Contacts Administrator', { ai_chat: 'member', contacts: 'admin' })),
    // The built-in role's name sets the participation scope (`resolveBusinessContributorScopeForUser`).
    bc: await user('BusinessContributor', await role('Business Contributor', { ai_chat: 'member', tasks: 'admin' })),
  };

  const task = (number: number, title: string, assignee: string) => insertId(runner,
    `INSERT INTO tasks (tenant_id, item_number, title, status, assignee_user_id, labels, owner_ids, viewer_ids, created_at, updated_at)
     VALUES ($1, $2, $3, 'open', $4, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, now(), now())`,
    [tenantId, number, title, assignee]);
  const task1 = await task(1, 'Migration', users.taskAdmin);
  const originTask = await task(2, 'Origin task', users.taskAdmin);
  const bcTask = await task(3, 'BC task', users.bc);
  const otherTask = await task(4, 'Other task', users.taskAdmin);

  // A request started from the second task: its delete is the screen's 409.
  await runner.query(
    `INSERT INTO portfolio_requests (tenant_id, item_number, name, status, current_situation, expected_benefits,
       origin_task_id, criteria_values, feasibility_review, priority_override, created_at, updated_at)
     VALUES ($1, 201, 'Started by a task', 'pending_review', 'Situation', 'Benefits', $2,
       '{}'::jsonb, '{}'::jsonb, false, now(), now())`,
    [tenantId, originTask],
  );

  const application = await insertId(runner,
    `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, 'CheeseTrack', 'APP-1', 'enabled')`, [tenantId]);
  await runner.query(
    `INSERT INTO portfolio_activities (tenant_id, task_id, author_id, type, content, changed_fields, created_at, updated_at)
     VALUES ($1, $2, $3, 'comment', 'A comment', null, now(), now()),
            ($1, $2, $3, 'change', null, '{"status":["open","in_progress"]}'::jsonb, now(), now())`,
    [tenantId, task1, users.taskAdmin],
  );
  await runner.query(
    `INSERT INTO task_time_entries (tenant_id, task_id, hours, logged_at) VALUES ($1, $2, 1.5, now())`,
    [tenantId, task1],
  );
  await runner.query(
    `INSERT INTO task_attachments (tenant_id, task_id, original_filename, stored_filename, storage_path)
     VALUES ($1, $2, 'notes.txt', 'notes.txt', 'spec/notes.txt')`,
    [tenantId, task1],
  );
  await runner.query(`INSERT INTO task_applications (tenant_id, task_id, application_id) VALUES ($1, $2, $3)`, [tenantId, task1, application]);

  const contact = await insertId(runner,
    `INSERT INTO contacts (tenant_id, first_name, last_name, email) VALUES ($1, 'Camille', 'Roux', $2)`,
    [tenantId, `camille-${slug}@example.test`]);
  const supplier = await insertId(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Fromagerie')`, [tenantId]);
  const project = await insertId(runner,
    `INSERT INTO portfolio_projects (tenant_id, item_number, name, origin, status, scheduling_mode, execution_progress, criteria_values)
     VALUES ($1, 1, 'Migration project', 'fast_track', 'planned', 'independent', 0, '{}'::jsonb)`, [tenantId]);
  await runner.query(`INSERT INTO supplier_contacts (tenant_id, supplier_id, contact_id, role) VALUES ($1, $2, $3, 'other')`, [tenantId, supplier, contact]);
  await runner.query(`INSERT INTO portfolio_project_contacts (tenant_id, project_id, contact_id) VALUES ($1, $2, $3)`, [tenantId, project, contact]);
  await runner.query(`INSERT INTO application_support_contacts (tenant_id, application_id, contact_id) VALUES ($1, $2, $3)`, [tenantId, application, contact]);

  const location = await insertId(runner,
    `INSERT INTO locations (tenant_id, location_reference, name, hosting_type) VALUES ($1, 'LOC-1', 'Paris DC', 'cloud')`, [tenantId]);
  const secondLocation = await insertId(runner,
    `INSERT INTO locations (tenant_id, location_reference, name, hosting_type) VALUES ($1, 'LOC-2', 'Lyon DC', 'cloud')`, [tenantId]);
  const asset = await insertId(runner,
    `INSERT INTO assets (tenant_id, name, kind, environment, location_id) VALUES ($1, 'srv-paris', 'server', 'prod', $2)`,
    [tenantId, location]);
  const locationContact = await insertId(runner,
    `INSERT INTO contacts (tenant_id, first_name, last_name, email) VALUES ($1, 'Louis', 'Site', $2)`,
    [tenantId, `louis-${slug}@example.test`]);
  await runner.query(`INSERT INTO location_contacts (tenant_id, location_id, contact_id) VALUES ($1, $2, $3)`, [tenantId, location, locationContact]);
  await runner.query(`INSERT INTO location_user_contacts (tenant_id, location_id, user_id) VALUES ($1, $2, $3)`, [tenantId, location, users.taskAdmin]);
  await runner.query(`INSERT INTO location_links (tenant_id, location_id, url) VALUES ($1, $2, 'https://example.test/rack')`, [tenantId, location]);
  await runner.query(`INSERT INTO location_sub_items (tenant_id, location_id, name) VALUES ($1, $2, 'Rack A')`, [tenantId, location]);
  const library = await insertId(runner,
    `INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, 'Spec library', $2)`, [tenantId, `spec-${slug}`]);
  const document = await insertId(runner,
    `INSERT INTO documents (tenant_id, library_id, title, item_number, status) VALUES ($1, $2, 'Rack layout', 1, 'published')`,
    [tenantId, library]);
  await runner.query(`INSERT INTO document_locations (tenant_id, document_id, location_id) VALUES ($1, $2, $3)`, [tenantId, document, location]);

  return { tenantId, users, task: task1, originTask, bcTask, otherTask, contact, location, secondLocation, asset };
}

function ctx(runner: QueryRunner, s: Seed, user: UserKey) {
  return {
    tenantId: s.tenantId,
    userId: s.users[user],
    isPlatformHost: false,
    surface: 'chat' as const,
    authMethod: 'jwt' as const,
    manager: runner.manager,
    conversationId: null,
  };
}

async function refusal(fn: () => Promise<unknown>): Promise<string> {
  const error = await fn().then(() => null, (caught: any) => caught);
  assert.ok(error, 'refused');
  return String(error.message);
}

async function count(runner: QueryRunner, table: string, where: string, params: unknown[]): Promise<number> {
  const [row] = await runner.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params);
  return Number(row.n);
}

async function latestAudit(runner: QueryRunner, tenantId: string, table: string, recordId: string) {
  const [row] = await runner.query(
    `SELECT action, source, source_ref, user_id FROM audit_log
      WHERE tenant_id = $1 AND table_name = $2 AND record_id = $3
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, table, recordId],
  );
  return row;
}

async function testTaskDelete(h: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'taskAdmin');
  const preview = await h.previews.createPreview(context, 'delete_record', { entity_type: 'tasks', ref: 'T-1' });
  assert.equal(preview.status, 'pending');
  assert.equal(preview.target.entity_type, 'tasks');
  assert.equal(preview.target.entity_id, s.task);
  assert.equal(preview.target.ref, 'T-1');
  assert.equal(preview.target.title, 'Migration');
  assert.equal(preview.changes.deletion.format, 'markdown');
  const impact = String(preview.changes.deletion.to);
  for (const line of ['Comments and changes: 2', 'Time entries: 1', 'Attachments: 1', 'Applications: 1']) {
    assert.ok(impact.includes(line), `${line} in:\n${impact}`);
  }
  assert.match(preview.summary, /^Delete task "Migration"\.$/);

  const executed = await h.previews.executePreview(context, preview.preview_id);
  assert.equal(executed.status, 'executed', executed.error_message ?? '');
  assert.equal(await count(runner, 'tasks', 'tenant_id = $1 AND id = $2', [s.tenantId, s.task]), 0);
  assert.equal(await count(runner, 'portfolio_activities', 'tenant_id = $1 AND task_id = $2', [s.tenantId, s.task]), 0);
  assert.equal(await count(runner, 'task_time_entries', 'tenant_id = $1 AND task_id = $2', [s.tenantId, s.task]), 0);
  assert.equal(await count(runner, 'task_attachments', 'tenant_id = $1 AND task_id = $2', [s.tenantId, s.task]), 0);
  const audit = await latestAudit(runner, s.tenantId, 'tasks', s.task);
  assert.equal(audit.action, 'delete');
  assert.equal(audit.source, 'ai_chat');
  assert.equal(audit.source_ref, preview.preview_id);
  assert.equal(audit.user_id, s.users.taskAdmin);
  console.log('  task deleted through its screen service, with its counts and AI audit: OK');
}

async function testOriginTaskRefused(h: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'taskAdmin');
  const before = await count(runner, 'ai_mutation_previews', 'tenant_id = $1', [s.tenantId]);
  const message = await refusal(() => h.previews.createPreview(context, 'delete_record', { entity_type: 'tasks', ref: 'T-2' }));
  assert.match(message, /origin of request REQ-201/);
  assert.match(message, /Delete the request first, or change its origin task/);
  assert.equal(await count(runner, 'ai_mutation_previews', 'tenant_id = $1', [s.tenantId]), before);
  assert.equal(await count(runner, 'tasks', 'tenant_id = $1 AND id = $2', [s.tenantId, s.originTask]), 1);
  console.log('  task that started a request refused before any preview: OK');
}

async function testBusinessContributorScope(h: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'bc');
  const preview = await h.previews.createPreview(context, 'delete_record', { entity_type: 'tasks', ref: 'T-3' });
  assert.equal(preview.status, 'pending');
  assert.equal(preview.target.entity_id, s.bcTask);
  // Out of scope reads as missing, exactly like a task that does not exist.
  assert.equal(await refusal(() => h.previews.createPreview(context, 'delete_record', { entity_type: 'tasks', ref: 'T-4' })), 'Task not found.');
  assert.equal(await refusal(() => h.previews.createPreview(context, 'delete_record', { entity_type: 'tasks', ref: 'T-99' })), 'Task not found.');
  console.log('  Business Contributor: in scope previews, out of scope reads as missing: OK');
}

async function testContactDelete(h: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'contactsAdmin');
  const preview = await h.previews.createPreview(context, 'delete_record', { entity_type: 'contacts', ref: 'Camille Roux' });
  assert.equal(preview.status, 'pending');
  assert.equal(preview.target.entity_type, 'contacts');
  assert.equal(preview.target.ref, null);
  assert.equal(preview.target.title, 'Camille Roux');
  const impact = String(preview.changes.deletion.to);
  assert.ok(impact.includes('- Suppliers: 1'), impact);
  assert.ok(impact.includes('- Projects: 1'), impact);
  assert.ok(impact.includes("- Other links: 1"), impact);
  assert.ok(!impact.includes('Applications'), impact);
  assert.ok(impact.includes('The linked records stay.'), impact);

  const executed = await h.previews.executePreview(context, preview.preview_id);
  assert.equal(executed.status, 'executed', executed.error_message ?? '');
  assert.equal(await count(runner, 'contacts', 'tenant_id = $1 AND id = $2', [s.tenantId, s.contact]), 0);
  assert.equal(await count(runner, 'supplier_contacts', 'tenant_id = $1 AND contact_id = $2', [s.tenantId, s.contact]), 0);
  assert.equal(await count(runner, 'portfolio_project_contacts', 'tenant_id = $1 AND contact_id = $2', [s.tenantId, s.contact]), 0);
  assert.equal(await count(runner, 'application_support_contacts', 'tenant_id = $1 AND contact_id = $2', [s.tenantId, s.contact]), 0);
  const audit = await latestAudit(runner, s.tenantId, 'contacts', s.contact);
  assert.equal(audit.source, 'ai_chat');
  assert.equal(audit.source_ref, preview.preview_id);
  console.log('  contact deleted by its administrator, readable families counted, the rest unnamed: OK');
}

async function testContactRefusals(h: Harness, runner: QueryRunner, s: Seed) {
  const member = await refusal(() => h.previews.createPreview(ctx(runner, s, 'member'), 'delete_record', {
    entity_type: 'contacts', ref: 'Camille Roux',
  }));
  assert.match(member, /contacts/);
  const limited = ctx(runner, s, 'limited');
  assert.equal(
    await refusal(() => h.previews.createPreview(limited, 'delete_record', { entity_type: 'contacts', ref: 'Camille Roux' })),
    'This action is reserved to people with access to all data.',
  );
  assert.equal(await count(runner, 'contacts', 'tenant_id = $1 AND id = $2', [s.tenantId, s.contact]), 1);

  // A preview asked before the access became limited is refused when it runs, and the contact stays.
  const later = ctx(runner, s, 'limitedLater');
  const preview = await h.previews.createPreview(later, 'delete_record', { entity_type: 'contacts', ref: 'Camille Roux' });
  await runner.query(`UPDATE users SET data_access_mode = 'limited' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.users.limitedLater]);
  const message = await refusal(() => h.previews.executePreview(later, preview.preview_id));
  assert.equal(message, 'This action is reserved to people with access to all data.');
  assert.equal(await count(runner, 'contacts', 'tenant_id = $1 AND id = $2', [s.tenantId, s.contact]), 1);
  await runner.query(`UPDATE users SET data_access_mode = 'all' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.users.limitedLater]);
  console.log('  contact refused to a member and to a limited person, at the preview and at the run: OK');
}

async function testLocationDelete(h: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'member');
  const preview = await h.previews.createPreview(context, 'delete_record', { entity_type: 'locations', ref: 'LOC-1' });
  assert.equal(preview.status, 'pending');
  assert.equal(preview.target.entity_type, 'locations');
  assert.equal(preview.target.ref, 'LOC-1');
  assert.equal(preview.target.title, 'LOC-1 - Paris DC');
  const impact = String(preview.changes.deletion.to);
  for (const line of [
    'Assets that will lose their location: 1',
    'Contacts: 2',
    'Links: 1',
    'Sub-items: 1',
    // The member does not read the documents: their link is counted, not named.
    'Other links: 1',
  ]) {
    assert.ok(impact.includes(line), `${line} in:\n${impact}`);
  }
  assert.ok(!impact.includes('documents'), impact);

  const executed = await h.previews.executePreview(context, preview.preview_id);
  assert.equal(executed.status, 'executed', executed.error_message ?? '');
  assert.equal(await count(runner, 'locations', 'tenant_id = $1 AND id = $2', [s.tenantId, s.location]), 0);
  const [asset] = await runner.query(`SELECT location_id FROM assets WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.asset]);
  assert.equal(asset.location_id, null);
  assert.equal(await count(runner, 'location_contacts', 'tenant_id = $1 AND location_id = $2', [s.tenantId, s.location]), 0);
  assert.equal(await count(runner, 'location_user_contacts', 'tenant_id = $1 AND location_id = $2', [s.tenantId, s.location]), 0);
  assert.equal(await count(runner, 'location_links', 'tenant_id = $1 AND location_id = $2', [s.tenantId, s.location]), 0);
  assert.equal(await count(runner, 'location_sub_items', 'tenant_id = $1 AND location_id = $2', [s.tenantId, s.location]), 0);
  assert.equal(await count(runner, 'document_locations', 'tenant_id = $1 AND location_id = $2', [s.tenantId, s.location]), 0);
  const audit = await latestAudit(runner, s.tenantId, 'locations', s.location);
  assert.equal(audit.source, 'ai_chat');
  assert.equal(audit.source_ref, preview.preview_id);
  console.log('  location deleted by a member, assets kept without a location, audit names the preview: OK');
}

async function testReaderRefused(h: Harness, runner: QueryRunner, s: Seed) {
  const message = await refusal(() => h.previews.createPreview(ctx(runner, s, 'reader'), 'delete_record', {
    entity_type: 'locations', ref: 'LOC-2',
  }));
  assert.match(message, /locations/);
  assert.equal(await count(runner, 'locations', 'tenant_id = $1 AND id = $2', [s.tenantId, s.secondLocation]), 1);
  console.log('  reader refused: OK');
}

async function testDriftRefused(h: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'member');
  const preview = await h.previews.createPreview(context, 'delete_record', { entity_type: 'locations', ref: 'LOC-2' });
  await runner.query(`UPDATE locations SET name = 'Lyon DC moved', updated_at = clock_timestamp() WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.secondLocation]);
  const executed = await h.previews.executePreview(context, preview.preview_id);
  assert.equal(executed.status, 'failed');
  assert.equal(executed.error_message, 'Location changed after the preview was created.');
  assert.equal(await count(runner, 'locations', 'tenant_id = $1 AND id = $2', [s.tenantId, s.secondLocation]), 1);
  console.log('  record changed between preview and run refused: OK');
}

async function testOnePendingDelete(h: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'taskAdmin');
  const first = await h.previews.createPreview(context, 'delete_record', { entity_type: 'tasks', ref: 'T-3' });
  assert.equal(first.status, 'pending');
  // While one delete waits, another record's delete is refused: no batch approval deletes two.
  assert.match(
    await refusal(() => h.previews.createPreview(context, 'delete_record', { entity_type: 'tasks', ref: 'T-4' })),
    /one at a time/,
  );
  await h.previews.rejectPreview(context, first.preview_id);
  const next = await h.previews.createPreview(context, 'delete_record', { entity_type: 'tasks', ref: 'T-4' });
  assert.equal(next.status, 'pending');
  await h.previews.rejectPreview(context, next.preview_id);
  console.log('  one pending delete at a time, the next once the first is answered: OK');
}

async function testDeleteNeverInPlan(h: Harness, runner: QueryRunner, s: Seed) {
  const before = await count(runner, 'ai_mutation_plans', 'tenant_id = $1', [s.tenantId]);
  await assert.rejects(
    () => h.previews.createMutationPlan(ctx(runner, s, 'taskAdmin'), {
      summary: 'Delete two records.',
      operations: [
        { operation_id: 'task_3', tool_name: 'delete_record', input: { entity_type: 'tasks', ref: 'T-3' } },
        { operation_id: 'task_4', tool_name: 'delete_record', input: { entity_type: 'tasks', ref: 'T-4' } },
      ],
    }),
    /one record at a time and cannot be part of a mutation plan/,
  );
  assert.equal(await count(runner, 'ai_mutation_plans', 'tenant_id = $1', [s.tenantId]), before);
  console.log('  two delete previews never enter a mutation plan: OK');
}

async function testDeleteRecordIsChatOnly(h: Harness, runner: QueryRunner, s: Seed) {
  const chat = await h.tools.listAvailableTools(ctx(runner, s, 'taskAdmin'));
  assert.ok(chat.some((tool: { name: string }) => tool.name === 'delete_record'));
  const mcp = await h.tools.listAvailableTools({ ...ctx(runner, s, 'taskAdmin'), surface: 'mcp' as const, authMethod: 'api_key' as const });
  assert.ok(!mcp.some((tool: { name: string }) => tool.name === 'delete_record'));
  console.log('  delete_record offered on chat only: OK');
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      await testTaskDelete(harness, runner, s);
      await testOriginTaskRefused(harness, runner, s);
      await testBusinessContributorScope(harness, runner, s);
      await testContactRefusals(harness, runner, s);
      await testContactDelete(harness, runner, s);
      await testLocationDelete(harness, runner, s);
      await testReaderRefused(harness, runner, s);
      await testDriftRefused(harness, runner, s);
      await testOnePendingDelete(harness, runner, s);
      await testDeleteNeverInPlan(harness, runner, s);
      await testDeleteRecordIsChatOnly(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('ai-delete-record.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
