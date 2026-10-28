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

type Harness = { app: any; dataSource: DataSource; tools: any; previews: any; feed: any };
type Seed = {
  tenantId: string;
  users: Record<'member' | 'reader' | 'serverOnly' | 'bc', string>;
  roles: Record<'member' | 'reader' | 'serverOnly' | 'bc', string>;
  apps: { cheeseTrack: string; mail: string };
  servers: { db: string; web: string; other: string };
  technologies: { postgres: string; nginx: string; linux: string };
  versions: { pg16: string; pg14: string; pg15: string; nginx126: string };
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
  const userId = randomUUID();
  await runner.query(
    `INSERT INTO users (id, tenant_id, first_name, last_name, email, password_hash, role_id,
                        mfa_enabled, status, locale, created_at, updated_at)
     VALUES ($1, $2, $3, 'Tester', $4, null, $5, false, 'enabled', 'en', now(), now())`,
    [userId, tenantId, firstName, email, roleId],
  );
  return userId;
}

async function seedGraph(runner: QueryRunner): Promise<Seed> {
  const tag = shortTag();
  const tenantId = randomUUID();
  await seedTenant(runner, tenantId, `ai-technology-write-${tag}`, `AI technology write ${tag}`);

  const memberRole = await seedRole(runner, tenantId, 'Infrastructure Member', {
    ai_chat: 'member', infrastructure: 'member', applications: 'reader',
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
  };
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

  return {
    tenantId,
    users,
    roles: { member: memberRole, reader: readerRole, serverOnly: serverOnlyRole, bc: bcRole },
    apps,
    servers,
    technologies,
    versions,
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
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  return {
    app,
    dataSource: app.get(DataSource),
    tools: app.get(AiToolRegistry),
    previews: app.get(AiMutationPreviewService),
    feed: app.get(NvdFeedService, { strict: false }),
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
    if (harness.feed) {
      assert.ok(harness.feed.pendingTechnologyIds(seed.tenantId).includes(seed.technologies.postgres),
        'the technology is queued for its vulnerability match');
    }
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
      + '\n\n**Already equipped**\n- AST-13 - srv-web-01 (already equipped)',
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
      /Technology "Postgres" is not in this workspace\. Add it on the Technologies screen/,
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
    assert.match(fr.changes.technology_applications.to, /^\*\*Ajoutés\*\*/);
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
    await testUndoRestoresTheRemovedRows(harness);
    await testDriftIsRefused(harness);
    await testRights(harness);
    await testOperatingSystemIsRefused(harness);
    await testUnknownTechnologyNamesTheScreen(harness);
    await testCardInFrenchEscapesLabels(harness);
  } finally {
    await harness.app.close();
  }
  console.log('ai-technology-writes.integration.spec: ok');
}

run().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
