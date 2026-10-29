import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Plaid L5 lot 3: the links of a technology with its applications and its servers, written
// through `update_technology_links`, under a preview the person approves, at the screen's level.
//
// - The flagship phrase declares PostgreSQL 16 on CheeseTrack: the application link is stored with
//   `source = 'ai'` and the preview's reference, audited `ai_chat`, and the technology is queued
//   for its vulnerability match.
// - A missing version is created on the way, audited, and the card says it is new.
// - Two deployment servers: the one that already has the technology is skipped and listed as
//   equipped, the other is installed; a server outside the deployments is refused.
// - A server alone is installed and removed on its exact version.
// - Removing one version leaves the other declaration; removing without a version removes them
//   all and the card lists them.
// - Already linked and not linked write nothing; nothing to change refuses at preparation.
// - Undo removes exactly the added links and puts back exactly the removed rows (version and
//   notes); a version created on the way stays.
// - A link changed between the preview and the approval answers 409 and writes nothing.
// - The rights are the screen's: infrastructure member, applications reader for an application,
//   the Business Contributor's participation; a role lowered in between is refused at execution.
// - An operating system is refused, towards an application as towards a server.
// The AI surface checks (tenant settings, provider) are stubbed open, as in the incident spec.

process.env.AI_CHAT_ENABLED = 'true';
process.env.AI_SETTINGS_ENABLED = 'true';
process.env.AI_MCP_ENABLED = 'true';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.STRIPE_SECRET_KEY = '';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ||= 'test-bucket';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; tools: any; previews: any; feed: any; cpeEvents: Array<{ tenantId: string; technologyId: string }> };
type Seed = {
  tenantId: string;
  users: Record<'member' | 'reader' | 'serverOnly' | 'bc' | 'paul' | 'camille' | 'both' | 'inactive', string>;
  roles: Record<'member' | 'reader' | 'serverOnly' | 'bc', string>;
  apps: { cheeseTrack: string; mail: string };
  servers: { db: string; web: string; other: string };
  technologies: { postgres: string; nginx: string; linux: string; sles: string };
  versions: { pg16: string; pg14: string; pg15: string; nginx126: string; sles15: string; slesSp1: string; slesSp2: string };
  contacts: { oracle: string; desk: string };
  conversations: Record<string, string>;
};

function shortTag() {
  return randomUUID().replace(/-/g, '').slice(0, 10);
}

function shift(from: string, days: number): string {
  const date = new Date(`${from}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function seedTenant(runner: QueryRunner, tenantId: string, slug: string, name: string) {
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active',
             '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, name],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const model = await runner.query(
    `INSERT INTO ai_model_configs (
       tenant_id, name, provider, model, endpoint_url, api_key_encrypted,
       supports_vision, is_default, created_at, updated_at
     ) VALUES ($1, 'technology-write-model', 'custom', 'technology-write-model',
               'https://llm.example.test/v1', 'test-secret', true, true, now(), now())
     RETURNING id`,
    [tenantId],
  );
  await runner.query(
    `INSERT INTO ai_settings (
       tenant_id, chat_enabled, mcp_enabled, provider_source, llm_provider,
       llm_endpoint_url, llm_model, llm_api_key_encrypted, web_search_enabled,
       glpi_enabled, chat_model_config_id, created_at, updated_at
     ) VALUES ($1, true, true, 'custom', 'custom', 'https://llm.example.test/v1',
               'technology-write-model', 'test-secret', false, false, $2, now(), now())`,
    [tenantId, model[0].id],
  );
}

async function seedRole(
  runner: QueryRunner,
  tenantId: string,
  roleName: string,
  permissions: Record<string, 'reader' | 'contributor' | 'member' | 'admin'>,
) {
  const roleId = randomUUID();
  await runner.query(
    `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, $3, $4, false, false, now(), now())`,
    [roleId, tenantId, roleName, `${roleName} role`],
  );
  for (const [resource, level] of Object.entries(permissions)) {
    await runner.query(
      `INSERT INTO role_permissions (id, tenant_id, role_id, resource, level, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())`,
      [randomUUID(), tenantId, roleId, resource, level],
    );
  }
  return roleId;
}

async function seedUser(runner: QueryRunner, tenantId: string, roleId: string, email: string, firstName: string) {
  return seedNamedUser(runner, tenantId, roleId, email, firstName, 'Tester');
}

async function seedNamedUser(
  runner: QueryRunner,
  tenantId: string,
  roleId: string,
  email: string,
  firstName: string,
  lastName: string,
  status = 'enabled',
) {
  const userId = randomUUID();
  await runner.query(
    `INSERT INTO users (id, tenant_id, first_name, last_name, email, password_hash, role_id,
                        mfa_enabled, status, locale, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, null, $6, false, $7, 'en', now(), now())`,
    [userId, tenantId, firstName, lastName, email, roleId, status],
  );
  return userId;
}

async function seedGraph(runner: QueryRunner): Promise<Seed> {
  const tag = shortTag();
  const tenantId = randomUUID();
  await seedTenant(runner, tenantId, `ai-technology-write-${tag}`, `AI technology write ${tag}`);

  const memberRole = await seedRole(runner, tenantId, 'Infrastructure Member', {
    ai_chat: 'member', infrastructure: 'member', applications: 'reader', contacts: 'reader',
  });
  const readerRole = await seedRole(runner, tenantId, 'Infrastructure Reader', {
    ai_chat: 'member', infrastructure: 'reader',
  });
  const serverOnlyRole = await seedRole(runner, tenantId, 'Infrastructure Server Only', {
    ai_chat: 'member', infrastructure: 'member',
  });
  // The built-in contributor role's name is what makes the participation scope apply.
  const bcRole = await seedRole(runner, tenantId, 'Business Contributor', {
    ai_chat: 'member', infrastructure: 'member', applications: 'reader',
  });
  const users = {
    member: await seedUser(runner, tenantId, memberRole, `member-${tag}@example.test`, 'Member'),
    reader: await seedUser(runner, tenantId, readerRole, `reader-${tag}@example.test`, 'Reader'),
    serverOnly: await seedUser(runner, tenantId, serverOnlyRole, `server-${tag}@example.test`, 'Server'),
    bc: await seedUser(runner, tenantId, bcRole, `bc-${tag}@example.test`, 'Contributor'),
    paul: await seedNamedUser(runner, tenantId, memberRole, `paul-${tag}@example.test`, 'Paul', 'Martin'),
    camille: await seedNamedUser(runner, tenantId, memberRole, `camille-${tag}@example.test`, 'Camille', 'Roux'),
    both: await seedNamedUser(runner, tenantId, memberRole, `both-${tag}@example.test`, 'Both', 'Owner'),
    inactive: await seedNamedUser(runner, tenantId, memberRole, `inactive-${tag}@example.test`, 'Inactive', 'User', 'disabled'),
  };

  const app = async (n: number, name: string) => {
    const rows = await runner.query(
      `INSERT INTO applications (tenant_id, sequential_id, name, hosting_model, status)
       VALUES ($1, $2, $3, 'on_premise', 'enabled') RETURNING id`,
      [tenantId, `APP-${n}`, name],
    );
    return String(rows[0].id);
  };
  const apps = { cheeseTrack: await app(36, 'CheeseTrack'), mail: await app(2, 'Mail') };
  await runner.query(
    `INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`,
    [tenantId, apps.cheeseTrack, users.bc],
  );

  const server = async (reference: string, name: string, hostname: string) => {
    const rows = await runner.query(
      `INSERT INTO assets (tenant_id, asset_reference, name, kind, environment, status, hostname)
       VALUES ($1, $2, $3, 'physical_server', 'prod', 'active', $4) RETURNING id`,
      [tenantId, reference, name, hostname],
    );
    return String(rows[0].id);
  };
  const servers = {
    db: await server('AST-12', 'srv-db-01', 'srv-db-01.example.test'),
    web: await server('AST-13', 'srv-web-01', 'srv-web-01.example.test'),
    other: await server('AST-14', 'srv-other', 'srv-other.example.test'),
  };
  const instance = async (applicationId: string, environment: string) => {
    const rows = await runner.query(
      `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, applicationId, environment],
    );
    return String(rows[0].id);
  };
  const cheeseProd = await instance(apps.cheeseTrack, 'prod');
  await runner.query(
    `INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, 'app'), ($1, $2, $4, 'web')`,
    [tenantId, cheeseProd, servers.db, servers.web],
  );
  const mailProd = await instance(apps.mail, 'prod');
  await runner.query(
    `INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, 'app')`,
    [tenantId, mailProd, servers.other],
  );

  const technology = async (n: number, name: string, family: string) => {
    const rows = await runner.query(
      `INSERT INTO technologies (tenant_id, item_number, name, family, hosting_type, lifecycle)
       VALUES ($1, $2, $3, $4, 'on_prem', 'active') RETURNING id`,
      [tenantId, n, name, family],
    );
    return String(rows[0].id);
  };
  const technologies = {
    postgres: await technology(1, 'PostgreSQL', 'database'),
    nginx: await technology(2, 'nginx', 'web_server'),
    linux: await technology(3, 'Linux', 'operating_system'),
    sles: '',
  };
  const version = async (technologyId: string, label: string, standard: string | null) => {
    const rows = await runner.query(
      `INSERT INTO technology_versions (tenant_id, technology_id, label, standard_support_end)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenantId, technologyId, label, standard],
    );
    return String(rows[0].id);
  };
  const versions = {
    pg16: await version(technologies.postgres, '16', '2028-11-09'),
    pg14: await version(technologies.postgres, '14', '2027-06-30'),
    pg15: await version(technologies.postgres, '15', null),
    nginx126: await version(technologies.nginx, '1.26', shift('2028-01-31', 0)),
    sles15: '',
    slesSp1: '',
    slesSp2: '',
  };
  // A base release with its service packs: an alert exception on 15 carries 15 SP1 and 15 SP2.
  const slesRows = await runner.query(
    `INSERT INTO technologies (tenant_id, item_number, name, family, hosting_type, lifecycle, cpe_products)
     VALUES ($1, 4, 'SUSE Linux Enterprise Server', 'operating_system', 'on_prem', 'active', ARRAY['o:suse:linux_enterprise_server']::text[])
     RETURNING id`,
    [tenantId],
  );
  const sles = String(slesRows[0].id);
  versions.sles15 = await version(sles, '15', null);
  versions.slesSp1 = await version(sles, '15 SP1', null);
  versions.slesSp2 = await version(sles, '15 SP2', null);
  technologies.sles = sles;

  // Two version exceptions on PostgreSQL: the technology's alert setting clears them in one run.
  await runner.query(
    `UPDATE technology_versions SET vulnerability_alerts = false WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, [versions.pg14, versions.pg16]],
  );
  // Owners of TEC-1: one IT, one business, and one in both types.
  await runner.query(
    `INSERT INTO technology_owners (tenant_id, technology_id, user_id, owner_type) VALUES
       ($1, $2, $3, 'it'), ($1, $2, $4, 'business'), ($1, $2, $5, 'it'), ($1, $2, $5, 'business')`,
    [tenantId, technologies.postgres, users.member, users.bc, users.both],
  );
  // Support contacts in their display order.
  const contactRows = await runner.query(
    `INSERT INTO contacts (tenant_id, first_name, last_name, email) VALUES
       ($1, 'Oracle', 'Support', $2), ($1, 'Internal', 'Desk', $3)
     RETURNING id`,
    [tenantId, `oracle-${tag}@example.test`, `desk-${tag}@example.test`],
  );
  const contacts = { oracle: String(contactRows[0].id), desk: String(contactRows[1].id) };
  await runner.query(
    `INSERT INTO technology_support_contacts (tenant_id, technology_id, contact_id, role, created_at) VALUES
       ($1, $2, $3, 'Support', now()), ($1, $2, $4, 'Internal', now() + interval '1 microsecond')`,
    [tenantId, technologies.postgres, contacts.oracle, contacts.desk],
  );
  // The web links of TEC-1, with a description each.
  await runner.query(
    `INSERT INTO technology_links (tenant_id, technology_id, url, description) VALUES
       ($1, $2, 'https://example.com/docs', 'Docs'),
       ($1, $2, 'https://example.com/old', 'Old page')`,
    [tenantId, technologies.postgres],
  );
  const declare = (applicationId: string, technologyId: string, versionId: string | null, notes: string | null = null) => runner.query(
    `INSERT INTO application_technologies (tenant_id, application_id, technology_id, technology_version_id, notes)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, applicationId, technologyId, versionId, notes],
  );
  await declare(apps.cheeseTrack, technologies.postgres, versions.pg14, 'Database of the orders');
  await declare(apps.cheeseTrack, technologies.postgres, versions.pg15, null);
  await declare(apps.mail, technologies.postgres, versions.pg16, null);
  await declare(apps.mail, technologies.postgres, versions.pg15, 'Mail archive');
  // One of the two deployment servers of CheeseTrack already has PostgreSQL (another version).
  await runner.query(
    `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id)
     VALUES ($1, $2, $3, $4)`,
    [tenantId, servers.web, technologies.postgres, versions.pg14],
  );
  // The seed writes TEC-1..3 by hand: the technology sequence starts after them, as the screen's
  // creation route would leave it.
  await runner.query(
    `INSERT INTO item_sequences (tenant_id, entity_type, next_val) VALUES ($1, 'technology', 5)
     ON CONFLICT (tenant_id, entity_type) DO UPDATE SET next_val = GREATEST(item_sequences.next_val, 5)`,
    [tenantId],
  );

  return {
    tenantId,
    users,
    roles: { member: memberRole, reader: readerRole, serverOnly: serverOnlyRole, bc: bcRole },
    apps,
    servers,
    technologies,
    versions,
    contacts,
    conversations: {},
  };
}

function context(seed: Seed, runner: QueryRunner, label: string, userId = seed.users.member) {
  const key = `${userId}:${label}`;
  seed.conversations[key] ||= randomUUID();
  return {
    tenantId: seed.tenantId,
    userId,
    isPlatformHost: false,
    surface: 'chat' as const,
    authMethod: 'jwt' as const,
    conversationId: seed.conversations[key],
    manager: runner.manager,
  };
}

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-technology-writes.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiToolRegistry } = require('../ai-tool.registry');
  const { AiMutationPreviewService } = require('../ai-mutation-preview.service');
  const { NvdFeedService } = require('../../vulnerabilities/nvd-feed.service');
  const { TechnologyCpeEvents } = require('../../technologies/technology-cpe-events');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const cpeEvents: Array<{ tenantId: string; technologyId: string }> = [];
  app.get(TechnologyCpeEvents).subscribe(async (event: any) => {
    cpeEvents.push({ tenantId: event.tenantId, technologyId: event.technologyId });
  });
  return {
    app,
    dataSource: app.get(DataSource),
    tools: app.get(AiToolRegistry),
    previews: app.get(AiMutationPreviewService),
    feed: app.get(NvdFeedService, { strict: false }),
    cpeEvents,
  };
}

async function executeToolPreview(harness: Harness, ctx: any, toolName: string, input: Record<string, unknown>) {
  await ctx.manager.query(
    `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
     VALUES ($1, $2, $3, 'AI technology writes integration', 'custom', 'technology-write-model', 'custom', now(), now())
     ON CONFLICT (id) DO NOTHING`,
    [ctx.conversationId, ctx.tenantId, ctx.userId],
  );
  const preview = await harness.tools.execute(ctx, toolName, input) as any;
  assert.equal(preview.status, 'pending');
  assert.equal(preview.requires_confirmation, true);
  return preview;
}

async function approvePreview(harness: Harness, ctx: any, preview: any) {
  const executed = await harness.previews.executePreview(ctx, preview.preview_id) as any;
  assert.equal(executed.status, 'executed', executed.error_message || 'preview did not execute');
  return executed;
}

async function approveFailingPreview(harness: Harness, ctx: any, preview: any) {
  const executed = await harness.previews.executePreview(ctx, preview.preview_id) as any;
  assert.equal(executed.status, 'failed', 'the preview must fail at execution');
  return executed;
}

async function expectRejects(fn: () => Promise<unknown>, pattern: RegExp | string) {
  let thrown: any = null;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, 'Expected the operation to reject.');
  const message = thrown?.message ?? JSON.stringify(thrown?.response ?? thrown);
  if (typeof pattern === 'string') assert.equal(message, pattern);
  else assert.match(message, pattern);
}

async function withSeededTransaction(harness: Harness, test: (runner: QueryRunner, seed: Seed) => Promise<void>) {
  const runner = harness.dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const seed = await seedGraph(runner);
    await test(runner, seed);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

const FLAGSHIP = {
  technology: 'PostgreSQL',
  applications: { add: [{ application: 'CheeseTrack', version: '16' }] },
};

async function testFlagshipVersion16(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'flagship');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_links', FLAGSHIP);
    assert.equal(preview.summary, 'Update the links of TEC-1 - PostgreSQL.');
    assert.equal(
      preview.changes.technology_applications.to,
      '**Added**\n- APP-36 - CheeseTrack: PostgreSQL 16 (existing, end of support 2028-11-09)',
    );
    assert.equal(preview.changes.technology_servers, undefined, 'no server asked');
    const executed = await approvePreview(harness, ctx, preview);
    assert.equal(executed.summary, 'Links updated on TEC-1 - PostgreSQL.');

    const [link] = await runner.query(
      `SELECT l.id, l.source, l.source_ref, v.label
         FROM application_technologies l
         JOIN technology_versions v ON v.id = l.technology_version_id AND v.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.application_id = $2 AND v.label = '16'`,
      [seed.tenantId, seed.apps.cheeseTrack],
    );
    assert.ok(link, 'the application declaration is stored');
    assert.equal(link.source, 'ai', 'the link is marked as the assistant\'s');
    assert.equal(link.source_ref, preview.preview_id, 'with the preview as its reference');

    const [audit] = await runner.query(
      `SELECT table_name, action, source, source_ref FROM audit_log
        WHERE tenant_id = $1 AND record_id = $2 AND table_name = 'application_technologies'
        ORDER BY created_at DESC LIMIT 1`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.deepEqual(
      { table: audit.table_name, action: audit.action, source: audit.source, sourceRef: audit.source_ref },
      { table: 'application_technologies', action: 'create', source: 'ai_chat', sourceRef: preview.preview_id },
    );
    assert.ok(
      harness.cpeEvents.some((event) => event.tenantId === seed.tenantId && event.technologyId === seed.technologies.postgres),
      'the technology is emitted for its vulnerability match',
    );
  });
}

async function testCreatedVersion(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'created-version');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_links', {
      technology: 'TEC-1',
      applications: { add: [{ application: 'APP-36', version: '17' }] },
    });
    assert.equal(
      preview.changes.technology_applications.to,
      '**Added**\n- APP-36 - CheeseTrack: new version 17, no support date',
    );
    await approvePreview(harness, ctx, preview);

    const [version] = await runner.query(
      `SELECT id FROM technology_versions WHERE tenant_id = $1 AND technology_id = $2 AND label = '17'`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.ok(version, 'the version was created on the way');
    const [link] = await runner.query(
      `SELECT source, source_ref FROM application_technologies WHERE tenant_id = $1 AND application_id = $2 AND technology_version_id = $3`,
      [seed.tenantId, seed.apps.cheeseTrack, version.id],
    );
    assert.deepEqual({ source: link.source, sourceRef: link.source_ref }, { source: 'ai', sourceRef: preview.preview_id });
    const [audit] = await runner.query(
      `SELECT action, source, source_ref FROM audit_log
        WHERE tenant_id = $1 AND record_id = $2 AND table_name = 'technology_versions'
        ORDER BY created_at DESC LIMIT 1`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.deepEqual({ action: audit.action, source: audit.source, sourceRef: audit.source_ref },
      { action: 'create', source: 'ai_chat', sourceRef: preview.preview_id });

    // The undo removes the link, never the version the write created (decision 12).
    const undo = await harness.tools.execute(ctx, 'undo_preview', { preview_id: preview.preview_id }) as any;
    assert.equal(undo.status, 'pending');
    assert.match(undo.changes.technology_versions.to, /new version 17, no support date/,
      'the undo card says the created version stays');
    await approvePreview(harness, ctx, undo);
    const links = await runner.query(
      `SELECT 1 FROM application_technologies WHERE tenant_id = $1 AND application_id = $2 AND technology_version_id = $3`,
      [seed.tenantId, seed.apps.cheeseTrack, version.id],
    );
    assert.equal(links.length, 0, 'the undo removed the added link');
    const remaining = await runner.query(
      `SELECT 1 FROM technology_versions WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, version.id],
    );
    assert.equal(remaining.length, 1, 'the version created on the way stays');
  });
}

async function testDeploymentServers(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'servers');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_links', {
      technology: 'PostgreSQL',
      applications: { add: [{ application: 'CheeseTrack', version: '16', servers: ['AST-12', 'srv-web-01'] }] },
    });
    assert.equal(
      preview.changes.technology_servers.to,
      '**Added**\n- AST-12 - srv-db-01: PostgreSQL 16 (existing, end of support 2028-11-09)'
      + '\n\n**Already equipped**\n- AST-13 - srv-web-01',
    );
    await approvePreview(harness, ctx, preview);
    const installed = await runner.query(
      `SELECT a.asset_reference FROM asset_technologies l
         JOIN assets a ON a.id = l.asset_id AND a.tenant_id = l.tenant_id
         JOIN technology_versions v ON v.id = l.technology_version_id AND v.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.technology_id = $2 AND v.label = '16'
        ORDER BY a.asset_reference`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.deepEqual(installed.map((row: any) => row.asset_reference), ['AST-12'], 'only the server without the technology');
    const web = await runner.query(
      `SELECT v.label FROM asset_technologies l
         JOIN technology_versions v ON v.id = l.technology_version_id AND v.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.asset_id = $2 AND l.technology_id = $3`,
      [seed.tenantId, seed.servers.web, seed.technologies.postgres],
    );
    assert.deepEqual(web.map((row: any) => row.label), ['14'], 'the equipped server keeps its link');

    await expectRejects(
      () => executeToolPreview(harness, ctx, 'update_technology_links', {
        technology: 'PostgreSQL',
        applications: { add: [{ application: 'CheeseTrack', version: '17', servers: ['AST-14'] }] },
      }),
      'One or more servers are not deployment servers of this application.',
    );
  });
}

async function testServerOnly(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'server-only');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_links', {
      technology: 'nginx',
      servers: { add: [{ server: 'AST-12', version: '1.26' }] },
    });
    assert.equal(
      preview.changes.technology_servers.to,
      '**Added**\n- AST-12 - srv-db-01: nginx 1.26 (existing, end of support 2028-01-31)',
    );
    await approvePreview(harness, ctx, preview);
    const [link] = await runner.query(
      `SELECT l.id, l.source, v.label FROM asset_technologies l
         JOIN technology_versions v ON v.id = l.technology_version_id AND v.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.asset_id = $2 AND l.technology_id = $3`,
      [seed.tenantId, seed.servers.db, seed.technologies.nginx],
    );
    assert.equal(link.label, '1.26');
    assert.equal(link.source, 'ai');

    const removal = await executeToolPreview(harness, ctx, 'update_technology_links', {
      technology: 'nginx',
      servers: { remove: [{ server: 'srv-db-01', version: '1.26' }] },
    });
    assert.equal(
      removal.changes.technology_servers.to,
      '**Removed**\n- AST-12 - srv-db-01: nginx 1.26 (existing, end of support 2028-01-31)',
    );
    await approvePreview(harness, ctx, removal);
    const left = await runner.query(
      `SELECT 1 FROM asset_technologies WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, link.id],
    );
    assert.equal(left.length, 0, 'the exact server link is removed');
  });
}

async function testRemoveOneDeclaration(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'remove-one');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_links', {
      technology: 'PostgreSQL',
      applications: { remove: [{ application: 'CheeseTrack', version: '14' }] },
    });
    assert.equal(
      preview.changes.technology_applications.to,
      '**Removed**\n- APP-36 - CheeseTrack: PostgreSQL 14 (existing, end of support 2027-06-30)',
    );
    await approvePreview(harness, ctx, preview);
    const left = await runner.query(
      `SELECT v.label, l.notes FROM application_technologies l
         JOIN technology_versions v ON v.id = l.technology_version_id AND v.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.application_id = $2 AND l.technology_id = $3
        ORDER BY v.label`,
      [seed.tenantId, seed.apps.cheeseTrack, seed.technologies.postgres],
    );
    assert.deepEqual(left.map((row: any) => row.label), ['15'], 'only the requested declaration left');
    const [audit] = await runner.query(
      `SELECT action, source, source_ref FROM audit_log
        WHERE tenant_id = $1 AND record_id = $2 AND table_name = 'application_technologies' AND source_ref = $3
        ORDER BY created_at DESC LIMIT 1`,
      [seed.tenantId, seed.technologies.postgres, preview.preview_id],
    );
    assert.deepEqual({ action: audit.action, source: audit.source, sourceRef: audit.source_ref },
      { action: 'update', source: 'ai_chat', sourceRef: preview.preview_id });
    assert.ok(harness.cpeEvents.some((event) => event.tenantId === seed.tenantId && event.technologyId === seed.technologies.postgres),
      'the removal emits the match event');
  });
}

async function testRemoveAllDeclarations(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'remove-all');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_links', {
      technology: 'PostgreSQL',
      applications: { remove: [{ application: 'Mail' }] },
    });
    assert.match(preview.changes.technology_applications.to, /\*\*Removed\*\*/);
    assert.match(preview.changes.technology_applications.to, /APP-2 - Mail: PostgreSQL 15 \(existing, no support date\)/);
    assert.match(preview.changes.technology_applications.to, /APP-2 - Mail: PostgreSQL 16 \(existing, end of support 2028-11-09\)/);
    await approvePreview(harness, ctx, preview);
    const left = await runner.query(
      `SELECT 1 FROM application_technologies WHERE tenant_id = $1 AND application_id = $2 AND technology_id = $3`,
      [seed.tenantId, seed.apps.mail, seed.technologies.postgres],
    );
    assert.equal(left.length, 0, 'every declaration of the application is removed');
  });
}

async function testAlreadyAndAbsent(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'noop');
    await expectRejects(
      () => executeToolPreview(harness, ctx, 'update_technology_links', {
        technology: 'PostgreSQL',
        applications: { add: [{ application: 'CheeseTrack', version: '14' }], remove: [{ application: 'Mail', version: '14' }] },
      }),
      'Nothing to change: APP-36 - CheeseTrack is already linked; APP-2 - Mail is not linked.',
    );
    const audits = await runner.query(
      `SELECT 1 FROM audit_log WHERE tenant_id = $1 AND record_id = $2 AND source = 'ai_chat'`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.equal(audits.length, 0, 'nothing was written or audited');
  });
}

async function testCardListsAlreadyAndAbsentBesideAChange(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'card-already');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_links', {
      technology: 'PostgreSQL',
      applications: {
        add: [
          { application: 'CheeseTrack', version: '16', servers: ['AST-12', 'AST-13'] },
          { application: 'CheeseTrack', version: '14' },
        ],
        remove: [{ application: 'Mail', version: '14' }],
      },
    });
    const applications = preview.changes.technology_applications.to;
    assert.match(applications, /\*\*Added\*\*\n- APP-36 - CheeseTrack: PostgreSQL 16/);
    assert.match(applications, /\*\*Already linked\*\*\n- APP-36 - CheeseTrack: PostgreSQL 14/);
    assert.match(applications, /\*\*Not linked\*\*\n- APP-2 - Mail: PostgreSQL 14/);
    const servers = preview.changes.technology_servers.to;
    assert.match(servers, /\*\*Added\*\*\n- AST-12 - srv-db-01: PostgreSQL 16/);
    assert.match(servers, /\*\*Already equipped\*\*\n- AST-13 - srv-web-01/);
    await approvePreview(harness, ctx, preview);
    const [added] = await runner.query(
      `SELECT source FROM application_technologies
        WHERE tenant_id = $1 AND application_id = $2 AND technology_version_id = $3`,
      [seed.tenantId, seed.apps.cheeseTrack, seed.versions.pg16],
    );
    assert.equal(added.source, 'ai');
  });
}

async function testServerDriftIsRefused(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'server-drift');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_links', {
      technology: 'nginx', servers: { add: [{ server: 'AST-12', version: '1.26' }] },
    });
    await runner.query(
      `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id)
       VALUES ($1, $2, $3, $4)`,
      [seed.tenantId, seed.servers.db, seed.technologies.nginx, seed.versions.nginx126],
    );
    const failed = await approveFailingPreview(harness, ctx, preview);
    assert.equal(failed.error_message, 'Links of TEC-2 - nginx changed after the preview was created.');
    const [link] = await runner.query(
      `SELECT source FROM asset_technologies WHERE tenant_id = $1 AND asset_id = $2 AND technology_id = $3`,
      [seed.tenantId, seed.servers.db, seed.technologies.nginx],
    );
    assert.equal(link.source, 'manual', 'the screen link stays, nothing of the preview is written');
  });
}

async function testUndoRestoresTheRemovedRows(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'undo-restore');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_links', {
      technology: 'PostgreSQL',
      applications: { remove: [{ application: 'CheeseTrack', version: '14' }] },
    });
    await approvePreview(harness, ctx, preview);
    const undo = await harness.tools.execute(ctx, 'undo_preview', { preview_id: preview.preview_id }) as any;
    assert.equal(undo.status, 'pending');
    assert.equal(
      undo.changes.technology_applications.to,
      '**Added**\n- APP-36 - CheeseTrack: PostgreSQL 14 (existing, end of support 2027-06-30)',
    );
    await approvePreview(harness, ctx, undo);
    const [restored] = await runner.query(
      `SELECT l.notes, l.source, v.label FROM application_technologies l
         JOIN technology_versions v ON v.id = l.technology_version_id AND v.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.application_id = $2 AND v.label = '14'`,
      [seed.tenantId, seed.apps.cheeseTrack],
    );
    assert.equal(restored.label, '14');
    assert.equal(restored.notes, 'Database of the orders', 'the declaration is restored with its notes');
    assert.equal(restored.source, 'ai');
  });
}

async function testDriftIsRefused(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'drift');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_links', FLAGSHIP);
    // The screen declares the same version between the preview and the approval.
    await runner.query(
      `INSERT INTO application_technologies (tenant_id, application_id, technology_id, technology_version_id)
       VALUES ($1, $2, $3, $4)`,
      [seed.tenantId, seed.apps.cheeseTrack, seed.technologies.postgres, seed.versions.pg16],
    );
    const failed = await approveFailingPreview(harness, ctx, preview);
    assert.equal(failed.error_message, 'Links of TEC-1 - PostgreSQL changed after the preview was created.');
    const links = await runner.query(
      `SELECT source FROM application_technologies WHERE tenant_id = $1 AND application_id = $2 AND technology_version_id = $3`,
      [seed.tenantId, seed.apps.cheeseTrack, seed.versions.pg16],
    );
    assert.equal(links.length, 1);
    assert.equal(links[0].source, 'manual', 'nothing of the preview was written');
  });
}

async function testRights(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const readerCtx = context(seed, runner, 'rights-reader', seed.users.reader);
    await expectRejects(
      () => harness.previews.createPreview(readerCtx, 'update_technology_links', FLAGSHIP),
      'You need the right to modify IT infrastructure (assets, connections, technologies), which your role does not give. An administrator can add it to your role.',
    );

    const serverOnlyCtx = context(seed, runner, 'rights-server', seed.users.serverOnly);
    await expectRejects(
      () => harness.previews.createPreview(serverOnlyCtx, 'update_technology_links', FLAGSHIP),
      'You need the right to read applications and interfaces, which your role does not give. An administrator can add it to your role.',
    );
    const serverPreview = await executeToolPreview(harness, serverOnlyCtx, 'update_technology_links', {
      technology: 'nginx', servers: { add: [{ server: 'AST-14', version: '1.26' }] },
    });
    await approvePreview(harness, serverOnlyCtx, serverPreview);

    const bcCtx = context(seed, runner, 'rights-bc', seed.users.bc);
    const own = await executeToolPreview(harness, bcCtx, 'update_technology_links', {
      technology: 'nginx', applications: { add: [{ application: 'CheeseTrack', version: '1.26' }] },
    });
    await approvePreview(harness, bcCtx, own);
    await expectRejects(
      () => harness.previews.createPreview(bcCtx, 'update_technology_links', {
        technology: 'nginx', applications: { add: [{ application: 'Mail', version: '1.26' }] },
      }),
      'Application "Mail" not found.',
    );

    const ctx = context(seed, runner, 'rights-downgrade');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_links', {
      technology: 'nginx', servers: { add: [{ server: 'AST-12', version: '1.26' }] },
    });
    await runner.query(
      `UPDATE role_permissions SET level = 'reader'
        WHERE tenant_id = $1 AND role_id = $2 AND resource = 'infrastructure'`,
      [seed.tenantId, seed.roles.member],
    );
    await expectRejects(
      () => harness.previews.executePreview(ctx, preview.preview_id),
      'You need the right to modify IT infrastructure (assets, connections, technologies), which your role does not give. An administrator can add it to your role.',
    );
    const untouched = await runner.query(
      `SELECT 1 FROM asset_technologies WHERE tenant_id = $1 AND asset_id = $2 AND technology_id = $3`,
      [seed.tenantId, seed.servers.db, seed.technologies.nginx],
    );
    assert.equal(untouched.length, 0, 'the refused approval wrote nothing');
  });
}

async function testOperatingSystemIsRefused(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'os');
    for (const input of [
      { technology: 'Linux', applications: { add: [{ application: 'CheeseTrack' }] } },
      { technology: 'Linux', servers: { add: [{ server: 'AST-12' }] } },
      { technology: 'Linux', applications: { remove: [{ application: 'CheeseTrack' }] } },
    ]) {
      await expectRejects(
        () => executeToolPreview(harness, ctx, 'update_technology_links', input as any),
        "An operating system is recorded from the server's page, in its operating system field, not as a technology link.",
      );
    }
  });
}

async function testUnknownTechnologyNamesTheScreen(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'unknown');
    await expectRejects(
      () => harness.previews.createPreview(ctx, 'update_technology_links', {
        technology: 'Postgres', applications: { add: [{ application: 'CheeseTrack', version: '16' }] },
      }),
      /Technology "Postgres" is not in this workspace\. Prepare a plan that creates or adopts it \(create_business_record, entity_type technologies\) first, then declares the link\. This tool creates nothing\./,
    );
  });
}

async function testCardInFrenchEscapesLabels(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'french-card');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_links', {
      technology: 'PostgreSQL',
      applications: { add: [{ application: 'CheeseTrack', version: '16' }] },
    });
    const [stored] = await runner.query(`SELECT * FROM ai_mutation_previews WHERE id = $1`, [preview.preview_id]);
    const { AiMutationOperationRegistry } = require('../mutation/ai-mutation-operation.registry');
    const operation = harness.app.get(AiMutationOperationRegistry).getOperation('update_technology_links');
    const fr = operation.presentPreview(stored, 'fr');
    assert.equal(fr.summary, 'Modification des liens de « TEC-1 - PostgreSQL ».');
    assert.match(fr.changes.technology_applications.to, /^\*\*Ajoutées\*\*/);
  });
}

async function testNewVersionAppearingBetweenPreviewAndApproval(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'new-version-app-drift');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_links', {
      technology: 'PostgreSQL',
      applications: { add: [{ application: 'CheeseTrack', version: '17' }] },
    });
    // The screen creates version 17 and declares it with a note before the approval.
    const [version] = await runner.query(
      `INSERT INTO technology_versions (tenant_id, technology_id, label) VALUES ($1, $2, '17') RETURNING id`,
      [seed.tenantId, seed.technologies.postgres],
    );
    await runner.query(
      `INSERT INTO application_technologies (tenant_id, application_id, technology_id, technology_version_id, notes, source)
       VALUES ($1, $2, $3, $4, 'Screen note', 'manual')`,
      [seed.tenantId, seed.apps.cheeseTrack, seed.technologies.postgres, version.id],
    );
    const failed = await approveFailingPreview(harness, ctx, preview);
    assert.equal(failed.error_message, 'Links of TEC-1 - PostgreSQL changed after the preview was created.');
    const [link] = await runner.query(
      `SELECT l.source, l.notes FROM application_technologies l
         JOIN technology_versions v ON v.id = l.technology_version_id AND v.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.application_id = $2 AND v.label = '17'`,
      [seed.tenantId, seed.apps.cheeseTrack],
    );
    assert.deepEqual({ source: link.source, notes: link.notes }, { source: 'manual', notes: 'Screen note' },
      'the screen link keeps its provenance and its note');
    const versions = await runner.query(
      `SELECT 1 FROM technology_versions WHERE tenant_id = $1 AND technology_id = $2 AND lower(label) = '17'`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.equal(versions.length, 1, 'the preview created no second version 17');
  });
}

async function testNewVersionServerBetweenPreviewAndApproval(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'new-version-server-drift');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_links', {
      technology: 'nginx',
      servers: { add: [{ server: 'AST-12', version: '2.0' }] },
    });
    const [version] = await runner.query(
      `INSERT INTO technology_versions (tenant_id, technology_id, label) VALUES ($1, $2, '2.0') RETURNING id`,
      [seed.tenantId, seed.technologies.nginx],
    );
    await runner.query(
      `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id, notes, source)
       VALUES ($1, $2, $3, $4, 'Screen server note', 'manual')`,
      [seed.tenantId, seed.servers.db, seed.technologies.nginx, version.id],
    );
    const failed = await approveFailingPreview(harness, ctx, preview);
    assert.equal(failed.error_message, 'Links of TEC-2 - nginx changed after the preview was created.');
    const [link] = await runner.query(
      `SELECT source, notes FROM asset_technologies
        WHERE tenant_id = $1 AND asset_id = $2 AND technology_id = $3`,
      [seed.tenantId, seed.servers.db, seed.technologies.nginx],
    );
    assert.deepEqual({ source: link.source, notes: link.notes }, { source: 'manual', notes: 'Screen server note' });
  });
}

async function testAlreadyDeclaredWithServersKeepsItsProvenance(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'already-with-servers');
    // CheeseTrack already declares PostgreSQL 14; AST-12 has no PostgreSQL. Equipping the server
    // is the change, and it must not rewrite the manual declaration above it.
    const preview = await executeToolPreview(harness, ctx, 'update_technology_links', {
      technology: 'PostgreSQL',
      applications: { add: [{ application: 'CheeseTrack', version: '14', servers: ['AST-12'] }] },
    });
    assert.equal(
      preview.changes.technology_servers.to,
      '**Added**\n- AST-12 - srv-db-01: PostgreSQL 14 (existing, end of support 2027-06-30)',
    );
    await approvePreview(harness, ctx, preview);
    const [declaration] = await runner.query(
      `SELECT l.source, l.notes FROM application_technologies l
         JOIN technology_versions v ON v.id = l.technology_version_id AND v.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.application_id = $2 AND v.label = '14'`,
      [seed.tenantId, seed.apps.cheeseTrack],
    );
    assert.deepEqual({ source: declaration.source, notes: declaration.notes },
      { source: 'manual', notes: 'Database of the orders' }, 'the existing declaration stays manual');
    const [installed] = await runner.query(
      `SELECT l.source, v.label FROM asset_technologies l
         JOIN technology_versions v ON v.id = l.technology_version_id AND v.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.asset_id = $2 AND l.technology_id = $3`,
      [seed.tenantId, seed.servers.db, seed.technologies.postgres],
    );
    assert.deepEqual({ source: installed.source, label: installed.label }, { source: 'ai', label: '14' });
    const appAudits = await runner.query(
      `SELECT 1 FROM audit_log WHERE tenant_id = $1 AND record_id = $2 AND table_name = 'application_technologies' AND source = 'ai_chat'`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.equal(appAudits.length, 0, 'the existing declaration was not rewritten or audited');
  });
}

async function testParticipationIsReverifiedAtExecution(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'bc-scope-execution', seed.users.bc);
    const preview = await executeToolPreview(harness, ctx, 'update_technology_links', {
      technology: 'nginx',
      applications: { add: [{ application: 'CheeseTrack', version: '1.26' }] },
    });
    // The Business Contributor is taken off the application after the preview.
    await runner.query(
      `DELETE FROM application_owners WHERE tenant_id = $1 AND application_id = $2 AND user_id = $3`,
      [seed.tenantId, seed.apps.cheeseTrack, seed.users.bc],
    );
    const failed = await approveFailingPreview(harness, ctx, preview);
    assert.equal(failed.error_message, 'Application not found.');
    const links = await runner.query(
      `SELECT 1 FROM application_technologies WHERE tenant_id = $1 AND application_id = $2 AND technology_id = $3`,
      [seed.tenantId, seed.apps.cheeseTrack, seed.technologies.nginx],
    );
    assert.equal(links.length, 0, 'the withdrawn participation wrote nothing');
  });
}

async function testUndoRequiresTheExactLinkItAdded(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'undo-exact-app');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_links', {
      technology: 'nginx',
      applications: { add: [{ application: 'CheeseTrack', version: '1.26' }] },
    });
    await approvePreview(harness, ctx, preview);
    const [added] = await runner.query(
      `SELECT id FROM application_technologies
        WHERE tenant_id = $1 AND application_id = $2 AND technology_id = $3`,
      [seed.tenantId, seed.apps.cheeseTrack, seed.technologies.nginx],
    );
    // The screen removes the row, then declares it again with a note: the undo must not delete it.
    await runner.query(`DELETE FROM application_technologies WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, added.id]);
    await runner.query(
      `INSERT INTO application_technologies (tenant_id, application_id, technology_id, technology_version_id, notes, source)
       VALUES ($1, $2, $3, $4, 'Screen note', 'manual')`,
      [seed.tenantId, seed.apps.cheeseTrack, seed.technologies.nginx, seed.versions.nginx126],
    );
    await expectRejects(
      () => harness.tools.execute(ctx, 'undo_preview', { preview_id: preview.preview_id }),
      'Links of TEC-2 - nginx changed after the preview was created.',
    );
    const [screen] = await runner.query(
      `SELECT source, notes FROM application_technologies
        WHERE tenant_id = $1 AND application_id = $2 AND technology_id = $3`,
      [seed.tenantId, seed.apps.cheeseTrack, seed.technologies.nginx],
    );
    assert.deepEqual({ source: screen.source, notes: screen.notes }, { source: 'manual', notes: 'Screen note' },
      'the screen link stays after the refused undo');
  });
}

async function testUndoRequiresTheExactServerLinkItAdded(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'undo-exact-server');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_links', {
      technology: 'nginx',
      servers: { add: [{ server: 'AST-12', version: '1.26' }] },
    });
    await approvePreview(harness, ctx, preview);
    const [added] = await runner.query(
      `SELECT id FROM asset_technologies WHERE tenant_id = $1 AND asset_id = $2 AND technology_id = $3`,
      [seed.tenantId, seed.servers.db, seed.technologies.nginx],
    );
    await runner.query(`DELETE FROM asset_technologies WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, added.id]);
    await runner.query(
      `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id, notes, source)
       VALUES ($1, $2, $3, $4, 'Screen server note', 'manual')`,
      [seed.tenantId, seed.servers.db, seed.technologies.nginx, seed.versions.nginx126],
    );
    await expectRejects(
      () => harness.tools.execute(ctx, 'undo_preview', { preview_id: preview.preview_id }),
      'Links of TEC-2 - nginx changed after the preview was created.',
    );
    const [screen] = await runner.query(
      `SELECT source, notes FROM asset_technologies WHERE tenant_id = $1 AND asset_id = $2 AND technology_id = $3`,
      [seed.tenantId, seed.servers.db, seed.technologies.nginx],
    );
    assert.deepEqual({ source: screen.source, notes: screen.notes }, { source: 'manual', notes: 'Screen server note' });
  });
}

async function testApplicationsRightIsReverifiedAtExecutionAndUndo(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'app-right-execution');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_links', {
      technology: 'nginx',
      applications: { add: [{ application: 'CheeseTrack', version: '1.26' }] },
    });
    await runner.query(
      `DELETE FROM role_permissions WHERE tenant_id = $1 AND role_id = $2 AND resource = 'applications'`,
      [seed.tenantId, seed.roles.member],
    );
    const message = 'You need the right to read applications and interfaces, which your role does not give. An administrator can add it to your role.';
    await expectRejects(() => harness.previews.executePreview(ctx, preview.preview_id), message);
    const untouched = await runner.query(
      `SELECT 1 FROM application_technologies WHERE tenant_id = $1 AND application_id = $2 AND technology_id = $3`,
      [seed.tenantId, seed.apps.cheeseTrack, seed.technologies.nginx],
    );
    assert.equal(untouched.length, 0, 'the refused approval wrote nothing');
  });

  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'app-right-undo');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_links', {
      technology: 'nginx',
      applications: { add: [{ application: 'CheeseTrack', version: '1.26' }] },
    });
    await approvePreview(harness, ctx, preview);
    const undo = await harness.tools.execute(ctx, 'undo_preview', { preview_id: preview.preview_id }) as any;
    await runner.query(
      `DELETE FROM role_permissions WHERE tenant_id = $1 AND role_id = $2 AND resource = 'applications'`,
      [seed.tenantId, seed.roles.member],
    );
    await expectRejects(
      () => harness.previews.executePreview(ctx, undo.preview_id),
      'You need the right to read applications and interfaces, which your role does not give. An administrator can add it to your role.',
    );
    const left = await runner.query(
      `SELECT 1 FROM application_technologies WHERE tenant_id = $1 AND application_id = $2 AND technology_id = $3`,
      [seed.tenantId, seed.apps.cheeseTrack, seed.technologies.nginx],
    );
    assert.equal(left.length, 1, 'the refused undo kept the link');
  });
}


/** The seed's PostgreSQL and its rows, so the catalog entry is no longer adopted in this tenant. */
async function removeSeededPostgres(runner: QueryRunner, seed: Seed) {
  await runner.query(`DELETE FROM application_technologies WHERE tenant_id = $1 AND technology_id = $2`, [seed.tenantId, seed.technologies.postgres]);
  await runner.query(`DELETE FROM asset_technologies WHERE tenant_id = $1 AND technology_id = $2`, [seed.tenantId, seed.technologies.postgres]);
  await runner.query(`DELETE FROM technology_support_contacts WHERE tenant_id = $1 AND technology_id = $2`, [seed.tenantId, seed.technologies.postgres]);
  await runner.query(`DELETE FROM technology_owners WHERE tenant_id = $1 AND technology_id = $2`, [seed.tenantId, seed.technologies.postgres]);
  await runner.query(`DELETE FROM technology_links WHERE tenant_id = $1 AND technology_id = $2`, [seed.tenantId, seed.technologies.postgres]);
  await runner.query(`DELETE FROM technology_versions WHERE tenant_id = $1 AND technology_id = $2`, [seed.tenantId, seed.technologies.postgres]);
  await runner.query(`DELETE FROM technologies WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.technologies.postgres]);
}

async function testTechnologyFreeCreate(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-free-create');
    const preview = await executeToolPreview(harness, ctx, 'create_business_record', {
      entity_type: 'technologies',
      fields: { name: 'Redis', family: 'Database', lifecycle: 'Active', from_catalog: false },
    });
    assert.equal(preview.target.title, 'Redis');
    // The card carries the codes: the frontend names them from the tenant's list, in the person's language.
    assert.equal(preview.changes.family.to, 'database');
    assert.equal(preview.changes.lifecycle.to, 'active');
    const executed = await approvePreview(harness, ctx, preview);
    assert.match(executed.target.ref, /^TEC-\d+$/);
    const [technology] = await runner.query(
      `SELECT family, lifecycle FROM technologies WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, executed.target.entity_id],
    );
    assert.deepEqual({ family: technology.family, lifecycle: technology.lifecycle }, { family: 'database', lifecycle: 'active' });
    const audits = await runner.query(
      `SELECT source, source_ref FROM audit_log
        WHERE tenant_id = $1 AND record_id = $2 AND table_name = 'technologies' AND action = 'create'`,
      [seed.tenantId, executed.target.entity_id],
    );
    assert.ok(audits.some((row: any) => row.source === 'ai_chat' && row.source_ref === preview.preview_id),
      'the creation is audited with the AI source and the preview reference');
  });
}

async function testTechnologyUnknownFamilyIsRefused(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-unknown-family');
    await expectRejects(
      () => harness.previews.createPreview(ctx, 'create_business_record', {
        entity_type: 'technologies',
        fields: { name: 'Kafka', family: 'No such family', lifecycle: 'Active', from_catalog: false },
      }),
      /^Unknown family "No such family"\. Valid values: Operating system, Database, /,
    );
    const audits = await runner.query(`SELECT 1 FROM audit_log WHERE tenant_id = $1 AND source = 'ai_chat'`, [seed.tenantId]);
    assert.equal(audits.length, 0, 'the refused preparation wrote nothing');
  });
}

async function testTechnologyAdoption(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    await removeSeededPostgres(runner, seed);
    const ctx = context(seed, runner, 'technology-adoption');
    const preview = await executeToolPreview(harness, ctx, 'create_business_record', {
      entity_type: 'technologies',
      fields: { name: 'PostgreSQL', lifecycle: 'Active' },
    });
    assert.equal(preview.summary, 'Adopt technology "PostgreSQL" from the KANAP catalog.');
    assert.match(preview.changes.catalog_adoption.to, /^\*\*Adopted from the KANAP catalog\*\*/);
    assert.match(preview.changes.catalog_adoption.to, /versions, end of support from \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/);
    assert.equal(preview.changes.family.to, 'database', 'the family is a code, localised by the frontend');
    assert.equal(preview.changes.lifecycle.to, 'active', 'the lifecycle given beside the adoption is listed apart');
    const { AiMutationOperationRegistry } = require('../mutation/ai-mutation-operation.registry');
    const { TechnologyCatalogService } = require('../../technologies/catalog/technology-catalog.service');
    const catalogProduct = harness.app.get(TechnologyCatalogService).shippedProduct('postgresql');
    const supportDates = catalogProduct.versions
      .map((version: any) => version.extended_support_end ?? version.standard_support_end)
      .filter((date: any): date is string => !!date)
      .sort();
    const [storedPreview] = await runner.query(`SELECT * FROM ai_mutation_previews WHERE id = $1`, [preview.preview_id]);
    const fr = harness.app.get(AiMutationOperationRegistry).getOperation('create_business_record').presentPreview(storedPreview, 'fr');
    assert.equal(
      fr.changes.catalog_adoption.to,
      `**Adoptée du catalogue KANAP**\n- ${catalogProduct.versions.length} versions, fin de support de ${supportDates[0]} à ${supportDates[supportDates.length - 1]}`,
    );
    assert.equal(fr.changes.family.to, 'database', 'the family stays a code on the French card');
    assert.equal(fr.summary, 'Adoption de « PostgreSQL » depuis le catalogue KANAP.');
    const es = harness.app.get(AiMutationOperationRegistry).getOperation('create_business_record').presentPreview(storedPreview, 'es');
    assert.equal(es.summary, 'Adopción de «PostgreSQL» del catálogo KANAP.');
    const de = harness.app.get(AiMutationOperationRegistry).getOperation('create_business_record').presentPreview(storedPreview, 'de');
    assert.equal(de.summary, '„PostgreSQL“ aus dem KANAP-Katalog übernehmen.');
    const executed = await approvePreview(harness, ctx, preview);
    assert.match(executed.target.ref, /^TEC-\d+$/);
    const [technology] = await runner.query(
      `SELECT catalog_key, family, lifecycle FROM technologies WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, executed.target.entity_id],
    );
    assert.deepEqual(technology, { catalog_key: 'postgresql', family: 'database', lifecycle: 'active' });
    const versions = await runner.query(
      `SELECT label, standard_support_end FROM technology_versions
        WHERE tenant_id = $1 AND technology_id = $2 ORDER BY label`,
      [seed.tenantId, executed.target.entity_id],
    );
    assert.ok(versions.length > 5, 'the catalog versions are adopted');
    assert.ok(versions.some((row: any) => row.standard_support_end), 'their support dates come with them');
    const audits = await runner.query(
      `SELECT table_name, source, source_ref FROM audit_log
        WHERE tenant_id = $1 AND record_id = $2 AND source = 'ai_chat'`,
      [seed.tenantId, executed.target.entity_id],
    );
    assert.ok(audits.some((row: any) => row.table_name === 'technologies' && row.source_ref === preview.preview_id));
    assert.ok(audits.some((row: any) => row.table_name === 'technology_versions' && row.source_ref === preview.preview_id));
    // A second request on the same name gives the created reference.
    await expectRejects(
      () => harness.previews.createPreview(ctx, 'create_business_record', {
        entity_type: 'technologies',
        fields: { name: 'PostgreSQL', lifecycle: 'Active' },
      }),
      new RegExp(`^A technology with this name already exists: ${executed.target.ref}\\.$`),
    );
    // A version of the catalog says where it comes from on a versions preview.
    const versionsPreview = await executeToolPreview(harness, ctx, 'update_technology_versions', {
      technology: 'PostgreSQL',
      update: [{ version: '16', standard_support_end: '2028-12-31' }],
    });
    assert.match(versionsPreview.changes.technology_versions.to, /16: end of support .* \(from the KANAP catalog\)/);
  });
}

async function testTechnologyCatalogAmbiguousAndFreeOnRequest(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    await removeSeededPostgres(runner, seed);
    const ctx = context(seed, runner, 'technology-catalog-ambiguous');
    await expectRejects(
      () => harness.previews.createPreview(ctx, 'create_business_record', {
        entity_type: 'technologies',
        fields: { name: 'Postgres', lifecycle: 'Active' },
      }),
      /^No exact KANAP catalog entry for "Postgres"\. Closest entries: .*PostgreSQL.* Choose one of them, or ask for a free entry with from_catalog: false\.$/,
    );
    const preview = await executeToolPreview(harness, ctx, 'create_business_record', {
      entity_type: 'technologies',
      fields: { name: 'Postgres', family: 'Database', lifecycle: 'Active', from_catalog: false },
    });
    const executed = await approvePreview(harness, ctx, preview);
    const [technology] = await runner.query(
      `SELECT catalog_key FROM technologies WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, executed.target.entity_id],
    );
    assert.equal(technology.catalog_key, null, 'the typed entry takes no catalog key');
  });
}

async function testTechnologyRefusedFields(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-refused-fields');
    const messages: Record<string, RegExp> = {
      cpe_products: /CPE products are filled by the vulnerability matching/,
      cve_names: /CVE names are filled by the vulnerability matching/,
      catalog_key: /A catalog key comes from adopting the catalog entry/,
      vulnerability_alerts: /Vulnerability alerts are set with set_technology_vulnerability_alerts/,
      attachments: /Attachments are added from the technology's Relations tab/,
    };
    for (const [field, pattern] of Object.entries(messages)) {
      await expectRejects(
        () => harness.previews.createPreview(ctx, 'create_business_record', {
          entity_type: 'technologies',
          fields: { name: `Kafka ${field}`, family: 'Database', lifecycle: 'Active', from_catalog: false, [field]: field === 'cpe_products' ? ['cpe:/a:x'] : field === 'cve_names' ? [] : field === 'vulnerability_alerts' ? true : field === 'attachments' ? ['file.pdf'] : 'redis' },
        }),
        pattern,
      );
    }
  });
}

async function testTechnologyBounds(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-bounds');
    await expectRejects(
      () => harness.previews.createPreview(ctx, 'create_business_record', {
        entity_type: 'technologies',
        fields: { name: 'x'.repeat(201), family: 'Database', lifecycle: 'Active', from_catalog: false },
      }),
      'Name must be 200 characters or fewer.',
    );
    await expectRejects(
      () => harness.previews.createPreview(ctx, 'create_business_record', {
        entity_type: 'technologies',
        fields: { name: 'Kafka', family: 'Database', lifecycle: 'Active', from_catalog: false, rto_minutes: 5256001 },
      }),
      'RTO (minutes) must be an integer from 1 to 5256000.',
    );
    await expectRejects(
      () => harness.previews.createPreview(ctx, 'update_business_record', {
        entity_type: 'technologies', ref: 'TEC-1', fields: { description: 'x'.repeat(20001) },
      }),
      'Description must be 20000 characters or fewer.',
    );
  });
}

async function testTechnologyUpdateAndUndo(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-update');
    const preview = await executeToolPreview(harness, ctx, 'update_business_record', {
      entity_type: 'technologies',
      ref: 'TEC-1',
      fields: { lifecycle: 'Deprecated', replaced_by: 'nginx' },
    });
    assert.equal(preview.changes.lifecycle.to, 'deprecated');
    assert.equal(preview.changes.replaced_by_id.to, 'TEC-2 - nginx');
    await approvePreview(harness, ctx, preview);
    const [row] = await runner.query(
      `SELECT lifecycle, replaced_by_id FROM technologies WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.deepEqual({ lifecycle: row.lifecycle, replaced_by_id: row.replaced_by_id }, { lifecycle: 'deprecated', replaced_by_id: seed.technologies.nginx });
    const undo = await harness.tools.execute(ctx, 'undo_preview', { preview_id: preview.preview_id }) as any;
    await approvePreview(harness, ctx, undo);
    const [restored] = await runner.query(
      `SELECT lifecycle, replaced_by_id FROM technologies WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.deepEqual({ lifecycle: restored.lifecycle, replaced_by_id: restored.replaced_by_id }, { lifecycle: 'active', replaced_by_id: null });
  });
}

async function testTechnologyReplacementCycleIsRefused(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-cycle');
    const preview = await executeToolPreview(harness, ctx, 'update_business_record', {
      entity_type: 'technologies', ref: 'TEC-1', fields: { replaced_by: 'nginx' },
    });
    await approvePreview(harness, ctx, preview);
    await expectRejects(
      () => harness.previews.createPreview(ctx, 'update_business_record', {
        entity_type: 'technologies', ref: 'TEC-2', fields: { replaced_by: 'PostgreSQL' },
      }),
      'This replacement would make a cycle.',
    );
  });
}

async function testTechnologyUpdateDrift(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-update-drift');
    const preview = await executeToolPreview(harness, ctx, 'update_business_record', {
      entity_type: 'technologies', ref: 'TEC-1', fields: { lifecycle: 'Deprecated' },
    });
    await runner.query(`UPDATE technologies SET lifecycle = 'retired' WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.technologies.postgres]);
    const failed = await approveFailingPreview(harness, ctx, preview);
    assert.equal(failed.error_message, 'Lifecycle changed after the preview was created.');
    const [row] = await runner.query(`SELECT lifecycle FROM technologies WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.technologies.postgres]);
    assert.equal(row.lifecycle, 'retired', 'the screen value stays');
  });
}

async function testVersionAddAndUpdate(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'versions-add-update');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_versions', {
      technology: 'TEC-1',
      add: [{ label: '17', standard_support_end: '2029-11-08' }],
      update: [
        { version: '16', standard_support_end: '2028-12-31' },
        { version: '15', label: '15.1', notes: 'LTS' },
      ],
    });
    assert.match(preview.changes.technology_versions.to, /^- new version 17 \(end of support 2029-11-08\)$/m);
    assert.match(preview.changes.technology_versions.to, /^- 16: end of support 2028-11-09 → 2028-12-31$/m);
    assert.match(preview.changes.technology_versions.to, /^- 15 → 15\.1: notes updated$/m);
    const { AiMutationOperationRegistry } = require('../mutation/ai-mutation-operation.registry');
    const [storedPreview] = await runner.query(`SELECT * FROM ai_mutation_previews WHERE id = $1`, [preview.preview_id]);
    const fr = harness.app.get(AiMutationOperationRegistry).getOperation('update_technology_versions').presentPreview(storedPreview, 'fr');
    assert.equal(
      fr.changes.technology_versions.to,
      '- nouvelle version 17 (fin de support 2029-11-08)\n- 16 : fin de support 2028-11-09 → 2028-12-31\n- 15 → 15.1 : notes mises à jour',
    );
    await approvePreview(harness, ctx, preview);
    const rows = await runner.query(
      `SELECT label, to_char(standard_support_end, 'YYYY-MM-DD') AS standard_support_end, notes
         FROM technology_versions WHERE tenant_id = $1 AND technology_id = $2 ORDER BY label`,
      [seed.tenantId, seed.technologies.postgres],
    );
    const byLabel = new Map(rows.map((row: any) => [row.label, row]));
    assert.equal((byLabel.get('17') as any)?.standard_support_end, '2029-11-08');
    assert.equal((byLabel.get('16') as any)?.standard_support_end, '2028-12-31');
    assert.equal((byLabel.get('15.1') as any)?.notes, 'LTS');
    assert.equal(byLabel.has('15'), false, 'the renamed version keeps its row, under its new label');
    const audits = await runner.query(
      `SELECT action, source, source_ref FROM audit_log
        WHERE tenant_id = $1 AND table_name = 'technology_versions' AND source = 'ai_chat' ORDER BY created_at`,
      [seed.tenantId],
    );
    assert.ok(audits.some((row: any) => row.action === 'create' && row.source_ref === preview.preview_id));
    assert.ok(audits.some((row: any) => row.action === 'update' && row.source_ref === preview.preview_id));
  });
}

async function testVersionRefusals(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'versions-refusals');
    await expectRejects(
      () => harness.previews.createPreview(ctx, 'update_technology_versions', {
        technology: 'TEC-1', add: [{ label: '16' }],
      }),
      'This version already exists.',
    );
    await expectRejects(
      () => harness.previews.createPreview(ctx, 'update_technology_versions', {
        technology: 'TEC-1', add: [{ label: '17', standard_support_end: '2029-01-01', extended_support_end: '2028-01-01' }],
      }),
      'The extended support cannot end before the standard support.',
    );
    await expectRejects(
      () => harness.previews.createPreview(ctx, 'update_technology_versions', {
        technology: 'TEC-1', update: [{ version: '16', label: '14' }],
      }),
      'This version already exists.',
    );
    await expectRejects(
      () => harness.previews.createPreview(ctx, 'update_technology_versions', {
        technology: 'TEC-1', update: [{ version: '16', standard_support_end: '2028-11-09' }],
      }),
      'Version "16" already has the requested values.',
    );
  });
}

async function testVersionDrift(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'versions-drift');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_versions', {
      technology: 'TEC-1', update: [{ version: '16', standard_support_end: '2028-12-31' }],
    });
    await runner.query(
      `UPDATE technology_versions SET standard_support_end = '2028-11-10' WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.versions.pg16],
    );
    const failed = await approveFailingPreview(harness, ctx, preview);
    assert.equal(failed.error_message, 'Versions of TEC-1 - PostgreSQL changed after the preview was created.');
    const [row] = await runner.query(
      `SELECT to_char(standard_support_end, 'YYYY-MM-DD') AS standard_support_end FROM technology_versions WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.versions.pg16],
    );
    assert.equal(row.standard_support_end, '2028-11-10', 'the screen value stays');
  });
}

async function testVersionUndo(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'versions-undo');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_versions', {
      technology: 'TEC-1',
      add: [{ label: '17', standard_support_end: '2029-11-08' }],
      update: [{ version: '16', standard_support_end: '2028-12-31' }],
    });
    await approvePreview(harness, ctx, preview);
    const undo = await harness.tools.execute(ctx, 'undo_preview', { preview_id: preview.preview_id }) as any;
    assert.match(undo.changes.technology_versions.to, /\*\*Kept\*\*\n- new version 17 \(the undo restores the changed versions, not the new one\)/);
    await approvePreview(harness, ctx, undo);
    const [sixteen] = await runner.query(
      `SELECT to_char(standard_support_end, 'YYYY-MM-DD') AS standard_support_end FROM technology_versions WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.versions.pg16],
    );
    assert.equal(sixteen.standard_support_end, '2028-11-09', 'the changed version is restored');
    const [seventeen] = await runner.query(
      `SELECT label FROM technology_versions WHERE tenant_id = $1 AND technology_id = $2 AND label = '17'`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.ok(seventeen, 'the created version stays');
  });
}


async function testCreateThenLinkPlan(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    await removeSeededPostgres(runner, seed);
    const ctx = context(seed, runner, 'create-then-link');
    await runner.query(
      `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
       VALUES ($1, $2, $3, 'AI technology writes integration', 'custom', 'technology-write-model', 'custom', now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [ctx.conversationId, ctx.tenantId, ctx.userId],
    );
    // The flagship phrase when the tenant has no PostgreSQL: one plan, the creation (or the
    // adoption) first, the link second, the created reference carried into the second input.
    const plan = await harness.tools.execute(ctx, 'prepare_mutation_plan', {
      summary: 'Add PostgreSQL 16 to CheeseTrack',
      operations: [
        {
          operation_id: 'create_postgres',
          label: 'Create PostgreSQL',
          tool_name: 'create_business_record',
          input: { entity_type: 'technologies', fields: { name: 'PostgreSQL' } },
        },
        {
          operation_id: 'link_postgres',
          label: 'Declare PostgreSQL 16 on CheeseTrack',
          tool_name: 'update_technology_links',
          depends_on: ['create_postgres'],
          input: {
            technology: '{{create_postgres.ref}}',
            applications: { add: [{ application: 'CheeseTrack', version: '16' }] },
          },
        },
      ],
    }) as any;
    assert.equal(plan.total, 2);
    assert.equal(plan.previews.length, 1, 'the independent step has its preview');
    assert.equal(plan.deferred_count, 1, 'the link waits for the created technology');
    const createPreview = plan.previews[0];
    assert.equal(createPreview.tool_name, 'create_business_record');
    const created = await approvePreview(harness, ctx, createPreview);
    assert.match(created.target.ref, /^TEC-\d+$/);
    const [step] = await runner.query(
      `SELECT preview_id FROM ai_mutation_plan_steps
        WHERE tenant_id = $1 AND plan_id = $2 AND step_key = 'link_postgres'`,
      [seed.tenantId, plan.plan.plan_id],
    );
    assert.ok(step?.preview_id, 'the dependent preview is prepared after the creation');
    const linked = await harness.previews.executePreview(ctx, step.preview_id) as any;
    assert.equal(linked.status, 'executed', linked.error_message || 'the link step did not execute');
    const [link] = await runner.query(
      `SELECT l.source, l.source_ref, v.label, to_char(v.standard_support_end, 'YYYY-MM-DD') AS standard_support_end
         FROM application_technologies l
         JOIN technology_versions v ON v.id = l.technology_version_id AND v.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.application_id = $2 AND l.technology_id = $3`,
      [seed.tenantId, seed.apps.cheeseTrack, created.target.entity_id],
    );
    assert.equal(link.source, 'ai');
    assert.equal(link.source_ref, step.preview_id);
    assert.equal(link.label, '16');
    assert.ok(link.standard_support_end, 'the catalog version carries its support date');
    const [planRow] = await runner.query(
      `SELECT status FROM ai_mutation_plans WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, plan.plan.plan_id],
    );
    assert.equal(planRow.status, 'completed');
  });
}


async function testTechnologyRights(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const readerCtx = context(seed, runner, 'technology-rights-reader', seed.users.reader);
    const message = 'You need the right to modify IT infrastructure (assets, connections, technologies), which your role does not give. An administrator can add it to your role.';
    for (const [tool, input] of [
      ['create_business_record', { entity_type: 'technologies', fields: { name: 'Redis', family: 'Database', lifecycle: 'Active', from_catalog: false } }],
      ['update_business_record', { entity_type: 'technologies', ref: 'TEC-1', fields: { lifecycle: 'Deprecated' } }],
      ['update_technology_versions', { technology: 'TEC-1', add: [{ label: '18' }] }],
    ] as Array<[string, Record<string, unknown>]>) {
      await expectRejects(() => harness.previews.createPreview(readerCtx, tool, input), message);
    }
  });

  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-rights-downgrade');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_versions', {
      technology: 'TEC-1', add: [{ label: '18' }],
    });
    await runner.query(
      `UPDATE role_permissions SET level = 'reader'
        WHERE tenant_id = $1 AND role_id = $2 AND resource = 'infrastructure'`,
      [seed.tenantId, seed.roles.member],
    );
    await expectRejects(
      () => harness.previews.executePreview(ctx, preview.preview_id),
      'You need the right to modify IT infrastructure (assets, connections, technologies), which your role does not give. An administrator can add it to your role.',
    );
    const versions = await runner.query(
      `SELECT 1 FROM technology_versions WHERE tenant_id = $1 AND technology_id = $2 AND label = '18'`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.equal(versions.length, 0, 'the refused approval wrote no version');
  });
}


/** The owners and support contacts, under the lock, with the audit source and an exact undo. */
async function testTechnologyPeopleOwners(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-people-owners');
    const sage = await runner.query(
      `INSERT INTO contacts (tenant_id, first_name, last_name, email) VALUES ($1, 'Sage', 'Support', $2) RETURNING id`,
      [seed.tenantId, 'sage@example.test'],
    );
    const preview = await executeToolPreview(harness, ctx, 'update_technology_people', {
      technology: 'TEC-1',
      owners: {
        add: [
          { user: 'Paul Martin', owner_type: 'it' },
          { user: 'Camille Roux', owner_type: 'business' },
        ],
        remove: [
          { user: 'Member Tester', owner_type: 'it' },
          { user: 'Both Owner' },
        ],
      },
      support_contacts: { add: [{ contact: 'Sage Support', role: 'Sage' }] },
    });
    assert.equal(preview.summary, 'Update the people of TEC-1 - PostgreSQL.');
    assert.equal(
      preview.changes.technology_owners.to,
      '**Added**\n- Paul Martin (IT owner)\n- Camille Roux (business owner)'
      + '\n\n**Removed**\n- Member Tester (IT owner)\n- Both Owner (IT owner)\n- Both Owner (business owner)',
    );
    assert.equal(preview.changes.technology_support_contacts.to, '**Added**\n- Sage Support (role: Sage)');
    const executed = await approvePreview(harness, ctx, preview);
    assert.equal(executed.status, 'executed');
    const owners = await runner.query(
      `SELECT user_id, owner_type FROM technology_owners WHERE tenant_id = $1 AND technology_id = $2 ORDER BY owner_type, user_id`,
      [seed.tenantId, seed.technologies.postgres],
    );
    const ownerKeys = owners.map((row: any) => `${row.owner_type}:${row.user_id}`).sort();
    assert.deepEqual(ownerKeys, [
      `business:${seed.users.bc}`,
      `business:${seed.users.camille}`,
      `it:${seed.users.paul}`,
    ].sort());
    const contacts = await runner.query(
      `SELECT c.first_name, sc.role FROM technology_support_contacts sc
         JOIN contacts c ON c.tenant_id = sc.tenant_id AND c.id = sc.contact_id
        WHERE sc.tenant_id = $1 AND sc.technology_id = $2 ORDER BY sc.created_at, sc.id`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.deepEqual(contacts.map((row: any) => row.first_name), ['Oracle', 'Internal', 'Sage'], 'the added contact goes last');
    assert.equal(contacts[2].role, 'Sage');
    const audits = await runner.query(
      `SELECT table_name, source, source_ref FROM audit_log
        WHERE tenant_id = $1 AND table_name IN ('technology_owners', 'technology_support_contacts') AND source = 'ai_chat'`,
      [seed.tenantId],
    );
    assert.ok(audits.some((row: any) => row.table_name === 'technology_owners' && row.source_ref === preview.preview_id));
    assert.ok(audits.some((row: any) => row.table_name === 'technology_support_contacts' && row.source_ref === preview.preview_id));

    const undo = await harness.tools.execute(ctx, 'undo_preview', { preview_id: preview.preview_id }) as any;
    assert.match(undo.changes.technology_owners.to, /^\*\*Owners restored\*\*/);
    assert.match(undo.changes.technology_support_contacts.to, /^\*\*Support contacts restored\*\*/);
    await approvePreview(harness, ctx, undo);
    const restoredOwners = await runner.query(
      `SELECT user_id, owner_type FROM technology_owners WHERE tenant_id = $1 AND technology_id = $2`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.deepEqual(restoredOwners.map((row: any) => `${row.owner_type}:${row.user_id}`).sort(), [
      `it:${seed.users.member}`,
      `business:${seed.users.bc}`,
      `it:${seed.users.both}`,
      `business:${seed.users.both}`,
    ].sort());
    const restoredContacts = await runner.query(
      `SELECT c.first_name FROM technology_support_contacts sc
         JOIN contacts c ON c.tenant_id = sc.tenant_id AND c.id = sc.contact_id
        WHERE sc.tenant_id = $1 AND sc.technology_id = $2 ORDER BY sc.created_at, sc.id`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.deepEqual(restoredContacts.map((row: any) => row.first_name), ['Oracle', 'Internal'], 'the undo restores the order');
    void sage;
  });
}

async function testTechnologyPeopleRefusals(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-people-refusals');
    await seedNamedUser(runner, seed.tenantId, seed.roles.member, 'homonym@example.test', 'Paul', 'Martin');
    let message = '';
    try {
      await harness.previews.createPreview(ctx, 'update_technology_people', {
        technology: 'TEC-1',
        owners: { add: [{ user: 'Paul Martin', owner_type: 'it' }] },
      });
    } catch (error: any) {
      message = error?.message ?? JSON.stringify(error?.response ?? error);
    }
    assert.equal(message, 'Two active users are named "Paul Martin". Use the screen to choose the right one.');
    assert.equal(message.includes('@'), false, 'the refusal shows names only');
    await expectRejects(
      () => harness.previews.createPreview(ctx, 'update_technology_people', {
        technology: 'TEC-1',
        owners: { add: [{ user: 'Inactive User', owner_type: 'it' }] },
      }),
      'User "Inactive User" not found among the active users.',
    );
    await expectRejects(
      () => harness.previews.createPreview(ctx, 'update_technology_people', {
        technology: 'TEC-1',
        owners: { add: [{ user: 'Member Tester', owner_type: 'it' }] },
      }),
      'Nothing to change: TEC-1 - PostgreSQL already has these people.',
    );
  });
}

async function testTechnologyPeopleDrift(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-people-drift');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_people', {
      technology: 'TEC-1',
      owners: { add: [{ user: 'Paul Martin', owner_type: 'it' }] },
    });
    await runner.query(
      `INSERT INTO technology_owners (tenant_id, technology_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`,
      [seed.tenantId, seed.technologies.postgres, seed.users.camille],
    );
    const failed = await approveFailingPreview(harness, ctx, preview);
    assert.equal(failed.error_message, 'Owners of TEC-1 - PostgreSQL changed after the preview was created.');
    const paul = await runner.query(
      `SELECT 1 FROM technology_owners WHERE tenant_id = $1 AND technology_id = $2 AND user_id = $3`,
      [seed.tenantId, seed.technologies.postgres, seed.users.paul],
    );
    assert.equal(paul.length, 0, 'the approval wrote nothing');
  });
}

/** The support contacts need the contacts read, as the Operations tab's picker does. */
async function testTechnologyPeopleContactsRight(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-people-contacts-right', seed.users.serverOnly);
    await expectRejects(
      () => harness.previews.createPreview(ctx, 'update_technology_people', {
        technology: 'TEC-1',
        support_contacts: { add: [{ contact: 'Oracle Support' }] },
      }),
      'You need the right to read contacts, which your role does not give. An administrator can add it to your role.',
    );
  });
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-people-contacts-right-execution');
    await runner.query(
      `INSERT INTO contacts (tenant_id, first_name, last_name, email) VALUES ($1, 'Sage', 'Support', 'sage-execution@example.test')`,
      [seed.tenantId],
    );
    const preview = await executeToolPreview(harness, ctx, 'update_technology_people', {
      technology: 'TEC-1',
      support_contacts: { add: [{ contact: 'Sage Support' }] },
    });
    await runner.query(
      `DELETE FROM role_permissions WHERE tenant_id = $1 AND role_id = $2 AND resource = 'contacts'`,
      [seed.tenantId, seed.roles.member],
    );
    await expectRejects(
      () => harness.previews.executePreview(ctx, preview.preview_id),
      'You need the right to read contacts, which your role does not give. An administrator can add it to your role.',
    );
  });
}

/** The web links of the fiche: add, change, remove, and an undo that puts the exact rows back. */
async function testTechnologyWebLinks(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-web-links');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_web_links', {
      technology: 'TEC-1',
      add: [{ url: 'https://example.com/runbook', description: 'Runbook' }],
      update: [{ url: 'https://example.com/docs', new_url: 'https://example.com/release', description: 'Release notes' }],
      remove: [{ url: 'https://example.com/old' }],
    });
    assert.equal(
      preview.changes.technology_web_links.to,
      '**Added**\n- https://example.com/runbook (Runbook)'
      + '\n\n**Updated**\n- https://example.com/docs → https://example.com/release (description: Release notes)'
      + '\n\n**Removed**\n- https://example.com/old',
    );
    await approvePreview(harness, ctx, preview);
    const links = await runner.query(
      `SELECT url, description FROM technology_links WHERE tenant_id = $1 AND technology_id = $2 ORDER BY url`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.deepEqual(links, [
      { url: 'https://example.com/release', description: 'Release notes' },
      { url: 'https://example.com/runbook', description: 'Runbook' },
    ]);
    const undo = await harness.tools.execute(ctx, 'undo_preview', { preview_id: preview.preview_id }) as any;
    await approvePreview(harness, ctx, undo);
    const restored = await runner.query(
      `SELECT url, description FROM technology_links WHERE tenant_id = $1 AND technology_id = $2 ORDER BY url`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.deepEqual(restored, [
      { url: 'https://example.com/docs', description: 'Docs' },
      { url: 'https://example.com/old', description: 'Old page' },
    ], 'the undo removes the added link and restores the changed and removed ones');
  });
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-web-links-refusals');
    await expectRejects(
      () => harness.previews.createPreview(ctx, 'update_technology_web_links', {
        technology: 'TEC-1', add: [{ url: 'ftp://example.com/file' }],
      }),
      'A web link must be an http or https address.',
    );
    await runner.query(
      `INSERT INTO technology_links (tenant_id, technology_id, url, description) VALUES
         ($1, $2, 'https://example.com/duplicate', 'One'), ($1, $2, 'https://example.com/duplicate', 'Two')`,
      [seed.tenantId, seed.technologies.nginx],
    );
    await expectRejects(
      () => harness.previews.createPreview(ctx, 'update_technology_web_links', {
        technology: 'TEC-2', update: [{ url: 'https://example.com/duplicate', description: 'Three' }],
      }),
      'Two links have the address "https://example.com/duplicate"; use the screen to choose the right one.',
    );
  });
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-web-links-drift');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_web_links', {
      technology: 'TEC-1', add: [{ url: 'https://example.com/new', description: 'New' }],
    });
    await runner.query(
      `INSERT INTO technology_links (tenant_id, technology_id, url, description) VALUES ($1, $2, 'https://example.com/screen', 'Screen')`,
      [seed.tenantId, seed.technologies.postgres],
    );
    const failed = await approveFailingPreview(harness, ctx, preview);
    assert.equal(failed.error_message, 'Web links of TEC-1 - PostgreSQL changed after the preview was created.');
  });
}

/** The technology setting clears the exceptions; a base release's exception carries its packs. */
async function testTechnologyAlerts(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-alerts-disable');
    const preview = await executeToolPreview(harness, ctx, 'set_technology_vulnerability_alerts', {
      technology: 'TEC-1', enabled: false,
    });
    assert.equal(
      preview.changes.technology_vulnerability_alerts.to,
      '**Vulnerability alerts**\n- off\n\n- 2 version exceptions will be cleared: 14, 16',
    );
    await approvePreview(harness, ctx, preview);
    const [technology] = await runner.query(`SELECT vulnerability_alerts FROM technologies WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.technologies.postgres]);
    assert.equal(technology.vulnerability_alerts, false);
    const exceptions = await runner.query(
      `SELECT label, vulnerability_alerts FROM technology_versions WHERE tenant_id = $1 AND technology_id = $2 AND vulnerability_alerts IS NOT NULL`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.deepEqual(exceptions, [], 'every exception is cleared');
    const undo = await harness.tools.execute(ctx, 'undo_preview', { preview_id: preview.preview_id }) as any;
    assert.equal(
      undo.changes.technology_vulnerability_alerts.to,
      '**Vulnerability alerts**\n- on\n\n**Versions**\n- 14: follows the technology → alerts off\n- 16: follows the technology → alerts off',
    );
    await approvePreview(harness, ctx, undo);
    const [restoredTechnology] = await runner.query(`SELECT vulnerability_alerts FROM technologies WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.technologies.postgres]);
    assert.equal(restoredTechnology.vulnerability_alerts, true, 'the setting is back');
    const restored = await runner.query(
      `SELECT label, vulnerability_alerts FROM technology_versions
        WHERE tenant_id = $1 AND technology_id = $2 AND vulnerability_alerts IS NOT NULL ORDER BY label`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.deepEqual(restored, [
      { label: '14', vulnerability_alerts: false },
      { label: '16', vulnerability_alerts: false },
    ], 'each exception is back');
  });

  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-alerts-service-packs');
    const preview = await executeToolPreview(harness, ctx, 'set_technology_vulnerability_alerts', {
      technology: 'SUSE Linux Enterprise Server',
      versions: [{ version: '15', alerts: false }],
    });
    assert.equal(
      preview.changes.technology_vulnerability_alerts.to,
      '**Versions**\n- 15: follows the technology → alerts off\n  - the service packs 15 SP1, 15 SP2 follow base version 15',
    );
    await approvePreview(harness, ctx, preview);
    const rows = await runner.query(
      `SELECT label, vulnerability_alerts FROM technology_versions
        WHERE tenant_id = $1 AND technology_id = $2 AND label IN ('15', '15 SP1', '15 SP2') ORDER BY label`,
      [seed.tenantId, seed.technologies.sles],
    );
    assert.deepEqual(rows, [
      { label: '15', vulnerability_alerts: false },
      { label: '15 SP1', vulnerability_alerts: false },
      { label: '15 SP2', vulnerability_alerts: false },
    ]);
  });

  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-alerts-both');
    // The screen leaves the setting off, with one exception off and one on.
    await runner.query(`UPDATE technologies SET vulnerability_alerts = false WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.technologies.postgres]);
    await runner.query(
      `UPDATE technology_versions SET vulnerability_alerts = true WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.versions.pg16],
    );
    const preview = await executeToolPreview(harness, ctx, 'set_technology_vulnerability_alerts', {
      technology: 'TEC-1',
      enabled: true,
      versions: [{ version: '14', alerts: false }],
    });
    assert.equal(
      preview.changes.technology_vulnerability_alerts.to,
      '**Vulnerability alerts**\n- on\n\n- 2 version exceptions will be cleared: 14, 16'
      + '\n\n**Versions**\n- 14: follows the technology → alerts off',
    );
    await approvePreview(harness, ctx, preview);
    const [technology] = await runner.query(`SELECT vulnerability_alerts FROM technologies WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.technologies.postgres]);
    assert.equal(technology.vulnerability_alerts, true, 'the setting ran first');
    const exceptions = await runner.query(
      `SELECT label, vulnerability_alerts FROM technology_versions
        WHERE tenant_id = $1 AND technology_id = $2 AND vulnerability_alerts IS NOT NULL ORDER BY label`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.deepEqual(exceptions, [{ label: '14', vulnerability_alerts: false }], 'then the requested exception, no other');
    const undo = await harness.tools.execute(ctx, 'undo_preview', { preview_id: preview.preview_id }) as any;
    await approvePreview(harness, ctx, undo);
    const [restored] = await runner.query(`SELECT vulnerability_alerts FROM technologies WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.technologies.postgres]);
    assert.equal(restored.vulnerability_alerts, false);
    const restoredExceptions = await runner.query(
      `SELECT label, vulnerability_alerts FROM technology_versions
        WHERE tenant_id = $1 AND technology_id = $2 AND vulnerability_alerts IS NOT NULL ORDER BY label`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.deepEqual(restoredExceptions, [
      { label: '14', vulnerability_alerts: false },
      { label: '16', vulnerability_alerts: true },
    ], 'the undo puts the setting and each exception back');
  });

  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-alerts-drift');
    const preview = await executeToolPreview(harness, ctx, 'set_technology_vulnerability_alerts', {
      technology: 'TEC-1', enabled: false,
    });
    await runner.query(`UPDATE technologies SET vulnerability_alerts = false WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.technologies.postgres]);
    const failed = await approveFailingPreview(harness, ctx, preview);
    assert.equal(failed.error_message, 'Vulnerability alerts of TEC-1 - PostgreSQL changed after the preview was created.');
  });
}

/** The detail reads what the tools write: contacts, links, the setting and each version exception. */
async function testTechnologyDetailRead(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-detail-read');
    const detail = await harness.tools.execute(ctx, 'get_entity_detail', {
      entity_type: 'technologies', entity_id: 'TEC-1',
    }) as any;
    assert.equal(detail.complete, true);
    assert.equal(detail.data.vulnerability_alerts, true);
    assert.deepEqual(detail.data.support_contacts, [
      { name: 'Oracle Support', role: 'Support' },
      { name: 'Internal Desk', role: 'Internal' },
    ]);
    assert.deepEqual(
      detail.data.web_links.map((link: any) => `${link.url}|${link.description}`).sort(),
      ['https://example.com/docs|Docs', 'https://example.com/old|Old page'],
    );
    const versions = new Map(detail.data.versions.map((version: any) => [version.label, version]));
    assert.equal((versions.get('14') as any).vulnerability_alerts, false);
    assert.equal((versions.get('16') as any).vulnerability_alerts, false);
    assert.equal((versions.get('15') as any).vulnerability_alerts, null);
    assert.equal((versions.get('15') as any).vulnerability_alerts_effective, true, 'a version without an exception follows the technology');
  });
}

/** The three new writes at the screen's level: reader refused, a role lowered in between refused. */
async function testTechnologyNewToolRights(harness: Harness) {
  const message = 'You need the right to modify IT infrastructure (assets, connections, technologies), which your role does not give. An administrator can add it to your role.';
  await withSeededTransaction(harness, async (runner, seed) => {
    const readerCtx = context(seed, runner, 'technology-new-rights-reader', seed.users.reader);
    for (const [tool, input] of [
      ['update_technology_people', { technology: 'TEC-1', owners: { add: [{ user: 'Paul Martin', owner_type: 'it' }] } }],
      ['update_technology_web_links', { technology: 'TEC-1', add: [{ url: 'https://example.com/new' }] }],
      ['set_technology_vulnerability_alerts', { technology: 'TEC-1', enabled: false }],
    ] as Array<[string, Record<string, unknown>]>) {
      await expectRejects(() => harness.previews.createPreview(readerCtx, tool, input), message);
    }
  });
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-people-downgrade');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_people', {
      technology: 'TEC-1', owners: { add: [{ user: 'Paul Martin', owner_type: 'it' }] },
    });
    await runner.query(
      `UPDATE role_permissions SET level = 'reader' WHERE tenant_id = $1 AND role_id = $2 AND resource = 'infrastructure'`,
      [seed.tenantId, seed.roles.member],
    );
    await expectRejects(() => harness.previews.executePreview(ctx, preview.preview_id), message);
  });
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-web-links-downgrade');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_web_links', {
      technology: 'TEC-1', add: [{ url: 'https://example.com/new' }],
    });
    await runner.query(
      `UPDATE role_permissions SET level = 'reader' WHERE tenant_id = $1 AND role_id = $2 AND resource = 'infrastructure'`,
      [seed.tenantId, seed.roles.member],
    );
    await expectRejects(() => harness.previews.executePreview(ctx, preview.preview_id), message);
  });
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-alerts-downgrade');
    const preview = await executeToolPreview(harness, ctx, 'set_technology_vulnerability_alerts', {
      technology: 'TEC-1', enabled: false,
    });
    await runner.query(
      `UPDATE role_permissions SET level = 'reader' WHERE tenant_id = $1 AND role_id = $2 AND resource = 'infrastructure'`,
      [seed.tenantId, seed.roles.member],
    );
    await expectRejects(() => harness.previews.executePreview(ctx, preview.preview_id), message);
  });
}


/** The tenant's catalog labels in every language, the retired values and an ambiguous label. */
async function testTechnologyCatalogLabels(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-catalog-labels');
    const french = await executeToolPreview(harness, ctx, 'create_business_record', {
      entity_type: 'technologies',
      fields: { name: 'Kafka français', family: 'Base de données', lifecycle: 'Actif', from_catalog: false },
    });
    assert.equal(french.changes.family.to, 'database');
    assert.equal(french.changes.lifecycle.to, 'active');
    const german = await executeToolPreview(harness, ctx, 'create_business_record', {
      entity_type: 'technologies',
      fields: { name: 'Kafka deutsch', family: 'Datenbank', lifecycle: 'Aktiv', from_catalog: false },
    });
    assert.equal(german.changes.family.to, 'database');
    const spanish = await executeToolPreview(harness, ctx, 'create_business_record', {
      entity_type: 'technologies',
      fields: { name: 'Kafka español', family: 'Base de datos', lifecycle: 'Activo', from_catalog: false },
    });
    assert.equal(spanish.changes.family.to, 'database');
    await approvePreview(harness, ctx, french);
    const [stored] = await runner.query(
      `SELECT family, lifecycle FROM technologies WHERE tenant_id = $1 AND name = 'Kafka français'`,
      [seed.tenantId],
    );
    assert.deepEqual(stored, { family: 'database', lifecycle: 'active' });

    // Two values with the same label are an ambiguity, refused rather than letting one win.
    const { DEFAULT_TECHNOLOGY_FAMILIES } = require('../../it-ops-settings/it-ops-settings.service');
    await runner.query(
      `UPDATE tenants SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{it_ops}',
         COALESCE(metadata->'it_ops', '{}'::jsonb) || jsonb_build_object('technology_families', $2::jsonb), true)
        WHERE id = $1`,
      [seed.tenantId, JSON.stringify([
        ...DEFAULT_TECHNOLOGY_FAMILIES,
        { code: 'db_a', label: 'Famille ambiguë' },
        { code: 'db_b', label: 'Famille ambiguë' },
      ])],
    );
    await expectRejects(
      () => harness.previews.createPreview(ctx, 'create_business_record', {
        entity_type: 'technologies',
        fields: { name: 'Kafka ambigu', family: 'Famille ambiguë', lifecycle: 'Actif', from_catalog: false },
      }),
      /matches several values/,
    );
  });

  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-catalog-deprecated');
    const { DEFAULT_TECHNOLOGY_FAMILIES } = require('../../it-ops-settings/it-ops-settings.service');
    await runner.query(
      `UPDATE tenants SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{it_ops}',
         COALESCE(metadata->'it_ops', '{}'::jsonb) || jsonb_build_object('technology_families', $2::jsonb), true)
        WHERE id = $1`,
      [seed.tenantId, JSON.stringify([...DEFAULT_TECHNOLOGY_FAMILIES, { code: 'legacy_db', label: 'Legacy DB', deprecated: true }])],
    );
    await runner.query(`UPDATE technologies SET family = 'legacy_db' WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.technologies.postgres]);
    // The value the record already holds is accepted, by its label.
    const update = await executeToolPreview(harness, ctx, 'update_business_record', {
      entity_type: 'technologies', ref: 'TEC-1', fields: { family: 'Legacy DB', notes: 'Kept for the migration' },
    });
    assert.ok(update.changes.notes, 'the update is prepared');
    await approvePreview(harness, ctx, update);
    const [kept] = await runner.query(`SELECT family FROM technologies WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.technologies.postgres]);
    assert.equal(kept.family, 'legacy_db', 'the retired value the record held stays');
    // A new record cannot take a retired value.
    await expectRejects(
      () => harness.previews.createPreview(ctx, 'create_business_record', {
        entity_type: 'technologies',
        fields: { name: 'Kafka legacy', family: 'Legacy DB', lifecycle: 'Actif', from_catalog: false },
      }),
      /Unknown family "Legacy DB"/,
    );
  });
}

/** An adoption announced as new, or as completing a hand-typed record, is rechecked under its lock. */
async function testTechnologyAdoptionDriftAndCompletion(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-adoption-completion');
    const preview = await executeToolPreview(harness, ctx, 'create_business_record', {
      entity_type: 'technologies', fields: { name: 'PostgreSQL', lifecycle: 'Active' },
    });
    assert.equal(preview.target.ref, 'TEC-1', 'the card names the hand-typed record it completes');
    assert.equal(preview.target.title, 'TEC-1 - PostgreSQL');
    assert.match(preview.changes.catalog_adoption.to, /^\*\*Completes TEC-1 with the KANAP catalog\*\*/);
    assert.match(preview.changes.catalog_adoption.to, /Catalog key: postgresql/);
    assert.match(preview.changes.catalog_adoption.to, /\d+ missing versions/);
    assert.match(preview.changes.catalog_adoption.to, /Description added \(the record has none\)/);
    const { AiMutationOperationRegistry } = require('../mutation/ai-mutation-operation.registry');
    const [storedPreview] = await runner.query(`SELECT * FROM ai_mutation_previews WHERE id = $1`, [preview.preview_id]);
    const fr = harness.app.get(AiMutationOperationRegistry).getOperation('create_business_record').presentPreview(storedPreview, 'fr');
    assert.match(fr.changes.catalog_adoption.to, /^\*\*Complète TEC-1 avec le catalogue KANAP\*\*/);
    assert.match(fr.changes.catalog_adoption.to, /- Clé de catalogue : postgresql/);
    assert.match(fr.changes.catalog_adoption.to, /Description ajoutée \(la fiche n'en a pas\)/);
    await approvePreview(harness, ctx, preview);
    const [technology] = await runner.query(
      `SELECT catalog_key, lifecycle, description FROM technologies WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.equal(technology.catalog_key, 'postgresql');
    assert.equal(technology.lifecycle, 'active');
    assert.ok(technology.description, 'the empty description is filled from the catalog');
    const versions = await runner.query(
      `SELECT count(*)::int AS n FROM technology_versions WHERE tenant_id = $1 AND technology_id = $2`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.ok(versions[0].n > 3, 'the missing catalog versions are added');
    const audits = await runner.query(
      `SELECT source, source_ref FROM audit_log
        WHERE tenant_id = $1 AND table_name = 'technologies' AND record_id = $2 AND source = 'ai_chat'`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.ok(audits.some((row: any) => row.source_ref === preview.preview_id));
  });

  // The hand-typed record adopted by the screen between the preview and the approval: 409.
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-adoption-completion-drift');
    const preview = await executeToolPreview(harness, ctx, 'create_business_record', {
      entity_type: 'technologies', fields: { name: 'PostgreSQL', lifecycle: 'Active' },
    });
    await runner.query(`UPDATE technologies SET catalog_key = 'postgresql' WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.technologies.postgres]);
    const failed = await approveFailingPreview(harness, ctx, preview);
    assert.equal(failed.error_message, 'Technology "PostgreSQL" changed after the preview was created.');
    const [technology] = await runner.query(
      `SELECT catalog_key, lifecycle, description FROM technologies WHERE tenant_id = $1 AND id = $2`,
      [seed.tenantId, seed.technologies.postgres],
    );
    assert.deepEqual(technology, { catalog_key: 'postgresql', lifecycle: 'active', description: null }, 'only the screen wrote');
  });

  // A new adoption: a record of the same name or catalog key appearing in between is a drift.
  for (const mode of ['catalog', 'typed'] as const) {
    await withSeededTransaction(harness, async (runner, seed) => {
      await removeSeededPostgres(runner, seed);
      const ctx = context(seed, runner, `technology-adoption-drift-${mode}`);
      const preview = await executeToolPreview(harness, ctx, 'create_business_record', {
        entity_type: 'technologies', fields: { name: 'PostgreSQL', lifecycle: 'Active' },
      });
      const rows = await runner.query(
        `INSERT INTO technologies (tenant_id, item_number, name, family, hosting_type, lifecycle, catalog_key, description)
         VALUES ($1, 5, 'PostgreSQL', 'database', 'on_prem', 'retired', $2, 'screen description') RETURNING id`,
        [seed.tenantId, mode === 'catalog' ? 'postgresql' : null],
      );
      const failed = await approveFailingPreview(harness, ctx, preview);
      assert.equal(failed.error_message, 'A technology of this name appeared after the preview was created: TEC-5.');
      const [row] = await runner.query(`SELECT lifecycle, description FROM technologies WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, rows[0].id]);
      assert.deepEqual(row, { lifecycle: 'retired', description: 'screen description' }, 'the screen record stays as it is');
    });
  }

  // No exact catalog entry for the hand-typed name: the refusal with the reference remains.
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-completion-no-entry');
    await runner.query(
      `INSERT INTO technologies (tenant_id, item_number, name, family, hosting_type, lifecycle)
       VALUES ($1, 5, 'Postgres', 'database', 'on_prem', 'active')`,
      [seed.tenantId],
    );
    await expectRejects(
      () => harness.previews.createPreview(ctx, 'create_business_record', {
        entity_type: 'technologies', fields: { name: 'Postgres', lifecycle: 'Active' },
      }),
      'A technology with this name already exists: TEC-5.',
    );
  });
}

/** A free creation: a record of the same name that appeared in between is a drift, not the service error. */
async function testTechnologyFreeCreateDrift(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-free-create-drift');
    const preview = await executeToolPreview(harness, ctx, 'create_business_record', {
      entity_type: 'technologies',
      fields: { name: 'Kafka', family: 'Database', lifecycle: 'Active', from_catalog: false },
    });
    await runner.query(
      `INSERT INTO technologies (tenant_id, item_number, name, family, hosting_type, lifecycle)
       VALUES ($1, 5, 'Kafka', 'database', 'on_prem', 'active')`,
      [seed.tenantId],
    );
    const failed = await approveFailingPreview(harness, ctx, preview);
    assert.equal(failed.error_message, 'A technology with this name appeared after the preview was created: TEC-5.');
    const rows = await runner.query(`SELECT 1 FROM technologies WHERE tenant_id = $1 AND name = 'Kafka'`, [seed.tenantId]);
    assert.equal(rows.length, 1, 'the screen record only');
    const audits = await runner.query(
      `SELECT 1 FROM audit_log WHERE tenant_id = $1 AND source = 'ai_chat' AND record_id IS NOT NULL AND table_name = 'technologies'`,
      [seed.tenantId],
    );
    assert.equal(audits.length, 0, 'the refused approval audited nothing');
  });
}

/** A plan step reaches prepareCreatePreview without the Zod schema: empty and unknown keys are refused in words. */
async function testTechnologyWritePlanRefusals(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'technology-plan-refusals');
    await runner.query(
      `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
       VALUES ($1, $2, $3, 'AI technology writes integration', 'custom', 'technology-write-model', 'custom', now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [ctx.conversationId, ctx.tenantId, ctx.userId],
    );
    const operations = [
      { operation_id: 'versions-empty', tool_name: 'update_technology_versions', input: { technology: 'TEC-1' } },
      { operation_id: 'versions-unknown', tool_name: 'update_technology_versions', input: { technology: 'TEC-1', add: [{ label: '18' }], surprise: true } },
      { operation_id: 'versions-delete', tool_name: 'update_technology_versions', input: { technology: 'TEC-1', delete: { version: '16' } } },
      { operation_id: 'versions-cpe', tool_name: 'update_technology_versions', input: { technology: 'TEC-1', cpe_version: '16' } },
      { operation_id: 'versions-alert', tool_name: 'update_technology_versions', input: { technology: 'TEC-1', add: [{ label: '18', vulnerability_alerts: false }] } },
      { operation_id: 'people-empty', tool_name: 'update_technology_people', input: { technology: 'TEC-1' } },
      { operation_id: 'people-unknown', tool_name: 'update_technology_people', input: { technology: 'TEC-1', surprise: true } },
      { operation_id: 'links-empty', tool_name: 'update_technology_web_links', input: { technology: 'TEC-1' } },
      { operation_id: 'links-unknown', tool_name: 'update_technology_web_links', input: { technology: 'TEC-1', surprise: true } },
      { operation_id: 'alerts-empty', tool_name: 'set_technology_vulnerability_alerts', input: { technology: 'TEC-1' } },
      { operation_id: 'alerts-unknown', tool_name: 'set_technology_vulnerability_alerts', input: { technology: 'TEC-1', surprise: true } },
    ];
    const plan = await harness.tools.execute(ctx, 'prepare_mutation_plan', {
      summary: 'Refuse the empty and unknown technology writes',
      operations,
    }) as any;
    const messages = new Map((plan.errors ?? []).map((error: any) => [error.step_key, error.message]));
    assert.equal(messages.size, operations.length, JSON.stringify(plan.errors));
    assert.equal(messages.get('versions-empty'), 'Nothing to change: add a version or change one.');
    assert.equal(messages.get('versions-unknown'), 'Unknown field "surprise" for update_technology_versions. Allowed: technology, add, update.');
    assert.equal(messages.get('versions-delete'), 'Deleting a version is done in the technology screen, on the Overview tab, not here.');
    assert.equal(messages.get('versions-cpe'), 'Plaid does not write cpe_version or build_prefixes: the vulnerability matching owns them.');
    assert.equal(messages.get('versions-alert'), "A version's vulnerability alerts are set with set_technology_vulnerability_alerts, not here.");
    assert.equal(messages.get('people-empty'), 'Nothing to change: add or remove an owner or a support contact.');
    assert.equal(messages.get('people-unknown'), 'Unknown field "surprise" for update_technology_people. Allowed: technology, owners, support_contacts.');
    assert.equal(messages.get('links-empty'), 'Nothing to change: add, update or remove a web link.');
    assert.equal(messages.get('links-unknown'), 'Unknown field "surprise" for update_technology_web_links. Allowed: technology, add, update, remove.');
    assert.equal(messages.get('alerts-empty'), 'Nothing to change: set the technology alert setting or a version exception.');
    assert.equal(messages.get('alerts-unknown'), 'Unknown field "surprise" for set_technology_vulnerability_alerts. Allowed: technology, enabled, versions.');
    const previews = await runner.query(`SELECT 1 FROM ai_mutation_previews WHERE tenant_id = $1`, [seed.tenantId]);
    assert.equal(previews.length, 0, 'no empty preview was prepared');
  });
}

/** An undo with only added versions has nothing to put back; impossible days are refused. */
async function testVersionUndoAndDateRefusals(harness: Harness) {
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'versions-undo-only-created');
    const preview = await executeToolPreview(harness, ctx, 'update_technology_versions', {
      technology: 'TEC-1', add: [{ label: '18' }],
    });
    await approvePreview(harness, ctx, preview);
    await expectRejects(
      () => harness.tools.execute(ctx, 'undo_preview', { preview_id: preview.preview_id }),
      'Nothing to undo: the preview added versions, and an added version stays.',
    );
  });
  await withSeededTransaction(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'versions-impossible-date');
    await expectRejects(
      () => harness.previews.createPreview(ctx, 'update_technology_versions', {
        technology: 'TEC-1', add: [{ label: '18', standard_support_end: '2028-02-30' }],
      }),
      'Standard support end must be a date (YYYY-MM-DD).',
    );
    await expectRejects(
      () => harness.previews.createPreview(ctx, 'update_technology_versions', {
        technology: 'TEC-1', add: [{ label: '18', extended_support_end: '2028-02-30' }],
      }),
      'Extended support end must be a date (YYYY-MM-DD).',
    );
  });
}

async function run() {
  const harness = await createHarness();
  try {
    await testFlagshipVersion16(harness);
    await testCreatedVersion(harness);
    await testDeploymentServers(harness);
    await testServerOnly(harness);
    await testRemoveOneDeclaration(harness);
    await testRemoveAllDeclarations(harness);
    await testAlreadyAndAbsent(harness);
    await testCardListsAlreadyAndAbsentBesideAChange(harness);
    await testServerDriftIsRefused(harness);
    await testUndoRestoresTheRemovedRows(harness);
    await testDriftIsRefused(harness);
    await testRights(harness);
    await testOperatingSystemIsRefused(harness);
    await testUnknownTechnologyNamesTheScreen(harness);
    await testCardInFrenchEscapesLabels(harness);
    await testNewVersionAppearingBetweenPreviewAndApproval(harness);
    await testNewVersionServerBetweenPreviewAndApproval(harness);
    await testAlreadyDeclaredWithServersKeepsItsProvenance(harness);
    await testParticipationIsReverifiedAtExecution(harness);
    await testUndoRequiresTheExactLinkItAdded(harness);
    await testUndoRequiresTheExactServerLinkItAdded(harness);
    await testApplicationsRightIsReverifiedAtExecutionAndUndo(harness);
    await testTechnologyFreeCreate(harness);
    await testTechnologyUnknownFamilyIsRefused(harness);
    await testTechnologyAdoption(harness);
    await testTechnologyCatalogAmbiguousAndFreeOnRequest(harness);
    await testTechnologyRefusedFields(harness);
    await testTechnologyBounds(harness);
    await testTechnologyUpdateAndUndo(harness);
    await testTechnologyReplacementCycleIsRefused(harness);
    await testTechnologyUpdateDrift(harness);
    await testVersionAddAndUpdate(harness);
    await testVersionRefusals(harness);
    await testVersionDrift(harness);
    await testVersionUndo(harness);
    await testCreateThenLinkPlan(harness);
    await testTechnologyRights(harness);
    await testTechnologyPeopleOwners(harness);
    await testTechnologyPeopleRefusals(harness);
    await testTechnologyPeopleDrift(harness);
    await testTechnologyPeopleContactsRight(harness);
    await testTechnologyWebLinks(harness);
    await testTechnologyAlerts(harness);
    await testTechnologyDetailRead(harness);
    await testTechnologyNewToolRights(harness);
    await testTechnologyCatalogLabels(harness);
    await testTechnologyAdoptionDriftAndCompletion(harness);
    await testTechnologyFreeCreateDrift(harness);
    await testTechnologyWritePlanRefusals(harness);
    await testVersionUndoAndDateRefusals(harness);
  } finally {
    await harness.app.close();
  }
  console.log('ai-technology-writes.integration.spec: ok');
}

run().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
