import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { seedManagedDocsKnowledgeAssets } from '../../knowledge/integrated-document-seed';

// Lot D11: a contributor writes through Plaid what the screen lets them write, on the records of
// their scope, checked when the preview is asked and again when it runs.
// - A Business Contributor in the team of a project changes its purpose (preview, then run) and
//   links an application to it; the same on a project outside their scope is refused, at the
//   preview and at the run, also when the scope changes between the two.
// - The name of a project is not opened to a contributor (the project page): refused, saying so.
// - A project out of scope reads as missing, as a project that does not exist.
// - A link needs the read of the linked family, as the Relations tab.
// - A project contributor without the Business Contributor role writes on every project.
// - A reader stays refused; a member renames as before.
// - The write tools offered follow the level: a contributor gets the tools that change a project.
// The AI surface checks are not under test: stubbed open.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-contributor-writes-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; previews: any; tools: any; policy: any };
type UserKey = 'bc' | 'contributor' | 'reader' | 'member';
type Seed = { tenantId: string; users: Record<UserKey, string>; inScope: string; outOfScope: string; third: string; application: string };

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-contributor-writes.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiMutationPreviewService } = require('../ai-mutation-preview.service');
  const { AiPolicyService } = require('../ai-policy.service');
  const { AiToolRegistry } = require('../ai-tool.registry');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const policy = app.get(AiPolicyService);
  policy.assertSurfaceAccess = async () => undefined;
  return { app, dataSource: app.get(DataSource), previews: app.get(AiMutationPreviewService), tools: app.get(AiToolRegistry), policy };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `ai-d11-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
  // The purpose of a project is its managed document: the tenant needs its slots.
  await seedManagedDocsKnowledgeAssets(runner.manager as any, tenantId);
  const role = async (name: string, permissions: Record<string, string>) => {
    const id = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, $2, $2)`, [tenantId, name]);
    for (const [resource, level] of Object.entries(permissions)) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, id, resource, level]);
    }
    return id;
  };
  const user = async (key: string, roleId: string) => insertId(runner,
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, $3, 'Tester', $4, 'enabled')`,
    [tenantId, `${key}-${slug}@example.test`, key, roleId]);
  const users: Record<UserKey, string> = {
    // The built-in role's name sets the participation scope (`resolveBusinessContributorScopeForUser`).
    bc: await user('Bc', await role('Business Contributor', { ai_chat: 'member', portfolio_projects: 'contributor', applications: 'reader' })),
    contributor: await user('Contributor', await role('Project Contributor', { ai_chat: 'member', portfolio_projects: 'contributor' })),
    reader: await user('Reader', await role('Project Reader', { ai_chat: 'member', portfolio_projects: 'reader' })),
    member: await user('Member', await role('Project Member', { ai_chat: 'member', portfolio_projects: 'member' })),
  };
  const project = (number: number, name: string, leadId: string | null) => insertId(runner,
    `INSERT INTO portfolio_projects (tenant_id, item_number, name, origin, status, scheduling_mode, execution_progress, business_lead_id, criteria_values)
     VALUES ($1, $2, $3, 'fast_track', 'planned', 'independent', 0, $4, '{}'::jsonb)`,
    [tenantId, number, name, leadId]);
  const inScope = await project(1, 'Contributor project', users.bc);
  const outOfScope = await project(2, 'Other project', null);
  // A project without a purpose document, for the member's rename.
  const third = await project(3, 'Third project', null);
  const application = await insertId(runner,
    `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, 'Owned app', 'APP-1', 'enabled')`, [tenantId]);
  await runner.query(
    `INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`,
    [tenantId, application, users.bc],
  );
  return { tenantId, users, inScope, outOfScope, third, application };
}

function ctx(runner: QueryRunner, s: Seed, user: UserKey) {
  return { tenantId: s.tenantId, userId: s.users[user], isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const, manager: runner.manager, conversationId: null };
}

async function refusal(fn: () => Promise<unknown>): Promise<string> {
  const error = await fn().then(() => null, (caught: any) => caught);
  assert.ok(error, 'refused');
  return String(error.message);
}

/** The name of a project, and its purpose: the content of its managed document. */
async function projectRow(runner: QueryRunner, s: Seed, id: string) {
  const [row] = await runner.query(
    `SELECT p.name, d.content_markdown AS purpose
       FROM portfolio_projects p
       LEFT JOIN integrated_document_bindings b
         ON b.tenant_id = p.tenant_id AND b.source_entity_type = 'projects' AND b.source_entity_id = p.id AND b.slot_key = 'purpose'
       LEFT JOIN documents d ON d.tenant_id = b.tenant_id AND d.id = b.document_id
      WHERE p.tenant_id = $1 AND p.id = $2`,
    [s.tenantId, id],
  );
  return row as { name: string; purpose: string | null };
}

async function testBusinessContributorInScope(h: Harness, runner: QueryRunner, s: Seed) {
  const bc = ctx(runner, s, 'bc');
  const preview = await h.previews.createPreview(bc, 'update_business_record', { entity_type: 'projects', ref: 'PRJ-1', fields: { purpose: 'Written by Plaid' } });
  assert.equal(preview.status, 'pending');
  const executed = await h.previews.executePreview(bc, preview.preview_id);
  assert.equal(executed.status, 'executed', executed.error_message ?? '');
  assert.equal((await projectRow(runner, s, s.inScope)).purpose, 'Written by Plaid');

  // The Relations tab: a contributor links an application of their scope to their project.
  const link = await h.previews.createPreview(bc, 'update_entity_relations', { entity_type: 'projects', ref: 'PRJ-1', relation: 'applications', add: ['APP-1'] });
  assert.equal((await h.previews.executePreview(bc, link.preview_id)).status, 'executed');
  const [linked] = await runner.query(`SELECT count(*)::int AS n FROM application_projects WHERE tenant_id = $1 AND project_id = $2 AND application_id = $3`, [s.tenantId, s.inScope, s.application]);
  assert.equal(linked.n, 1);
  console.log('  Business Contributor writes on their project: OK');
}

async function testOutOfScopeAndFields(h: Harness, runner: QueryRunner, s: Seed) {
  const bc = ctx(runner, s, 'bc');
  // Outside their scope: refused at the preview, as the screen (404), as a project that does not exist.
  assert.equal(await refusal(() => h.previews.createPreview(bc, 'update_business_record', { entity_type: 'projects', ref: 'PRJ-2', fields: { purpose: 'No' } })), 'No projects found matching "PRJ-2".');
  assert.equal(await refusal(() => h.previews.createPreview(bc, 'update_business_record', { entity_type: 'projects', ref: 'PRJ-99', fields: { purpose: 'No' } })), 'No projects found matching "PRJ-99".');
  assert.equal(await refusal(() => h.previews.createPreview(bc, 'update_entity_relations', { entity_type: 'projects', ref: 'PRJ-2', relation: 'applications', add: ['APP-1'] })), 'No projects found matching "PRJ-2".');
  // By name too: the name of a project out of scope is not told.
  assert.equal(await refusal(() => h.previews.createPreview(bc, 'update_entity_relations', { entity_type: 'projects', ref: 'Other project', relation: 'applications', add: ['APP-1'] })), 'No projects found matching "Other project".');
  // A field the project page does not open to a contributor.
  const renamed = await refusal(() => h.previews.createPreview(bc, 'update_business_record', { entity_type: 'projects', ref: 'PRJ-1', fields: { name: 'Renamed' } }));
  assert.match(renamed, /^Your role lets you contribute to projects but not change Name: that needs the right to modify projects/);
  // A link needs the read of the linked family, as the Relations tab: no infrastructure, no asset.
  assert.equal(
    await refusal(() => h.previews.createPreview(bc, 'update_entity_relations', { entity_type: 'projects', ref: 'PRJ-1', relation: 'assets', add: ['Any asset'] })),
    'You need the right to read IT infrastructure (assets, connections, technologies), which your role does not give. An administrator can add it to your role.',
  );

  // The scope changes between the preview and the run: the run is refused, nothing is written.
  const preview = await h.previews.createPreview(bc, 'update_business_record', { entity_type: 'projects', ref: 'PRJ-1', fields: { purpose: 'Too late' } });
  await runner.query(`UPDATE portfolio_projects SET business_lead_id = NULL WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.inScope]);
  assert.equal(await refusal(() => h.previews.executePreview(bc, preview.preview_id)), 'Project not found.');
  assert.equal((await projectRow(runner, s, s.inScope)).purpose, 'Written by Plaid');
  await runner.query(`UPDATE portfolio_projects SET business_lead_id = $3 WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.inScope, s.users.bc]);
  console.log('  out of scope, closed field, scope changed before the run: refused');
}

async function testOtherLevels(h: Harness, runner: QueryRunner, s: Seed) {
  // A project contributor without the Business Contributor role: every project, same fields.
  const contributor = ctx(runner, s, 'contributor');
  const preview = await h.previews.createPreview(contributor, 'update_business_record', { entity_type: 'projects', ref: 'PRJ-2', fields: { purpose: 'Contributor purpose' } });
  const ran = await h.previews.executePreview(contributor, preview.preview_id);
  assert.equal(ran.status, 'executed', ran.error_message ?? '');
  assert.match(
    await refusal(() => h.previews.createPreview(contributor, 'update_business_record', { entity_type: 'projects', ref: 'PRJ-2', fields: { name: 'Renamed' } })),
    /^Your role lets you contribute to projects but not change Name/,
  );
  // Without the read of applications, no application link.
  assert.equal(
    await refusal(() => h.previews.createPreview(contributor, 'update_entity_relations', { entity_type: 'projects', ref: 'PRJ-2', relation: 'applications', add: ['APP-1'] })),
    'You need the right to read applications and interfaces, which your role does not give. An administrator can add it to your role.',
  );
  // A contributor still creates no project (the screen asks member).
  assert.equal(
    await refusal(() => h.previews.createPreview(contributor, 'create_business_record', { entity_type: 'projects', fields: { name: 'New', origin: 'fast_track' } })),
    'You need the right to modify projects, which your role does not give. An administrator can add it to your role.',
  );

  // A reader is refused; a member renames as before.
  assert.equal(
    await refusal(() => h.previews.createPreview(ctx(runner, s, 'reader'), 'update_business_record', { entity_type: 'projects', ref: 'PRJ-1', fields: { purpose: 'No' } })),
    'You need the right to contribute to projects, which your role does not give. An administrator can add it to your role.',
  );
  const member = ctx(runner, s, 'member');
  const rename = await h.previews.createPreview(member, 'update_business_record', { entity_type: 'projects', ref: 'PRJ-3', fields: { name: 'Renamed by a member' } });
  const renamedRun = await h.previews.executePreview(member, rename.preview_id);
  assert.equal(renamedRun.status, 'executed', renamedRun.error_message ?? '');
  assert.equal((await projectRow(runner, s, s.third)).name, 'Renamed by a member');
  console.log('  project contributor, reader, member: OK');
}

async function testOfferedTools(h: Harness, runner: QueryRunner, s: Seed) {
  const names = async (user: UserKey) => new Set((await h.tools.listAvailableTools(ctx(runner, s, user))).map((tool: { name: string }) => tool.name));
  const contributor = await names('contributor');
  assert.ok(contributor.has('update_business_record'), 'contributor: update_business_record');
  assert.ok(contributor.has('update_entity_relations'), 'contributor: update_entity_relations');
  assert.ok(!contributor.has('create_business_record'), 'contributor: no create_business_record');
  const reader = await names('reader');
  for (const tool of ['update_business_record', 'update_entity_relations', 'create_business_record']) {
    assert.ok(!reader.has(tool), `reader: no ${tool}`);
  }
  assert.ok((await names('member')).has('create_business_record'), 'member: create_business_record');

  const rights = await h.policy.describeWriteRights(ctx(runner, s, 'contributor'), runner.manager);
  assert.deepEqual(rights.modifiableModules, []);
  assert.match(rights.contributableModules.join(' '), /^projects they take part in/);
  console.log('  offered tools and write rights follow the level: OK');
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      await testBusinessContributorInScope(harness, runner, s);
      await testOutOfScopeAndFields(harness, runner, s);
      await testOtherLevels(harness, runner, s);
      await testOfferedTools(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('ai-contributor-writes.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
