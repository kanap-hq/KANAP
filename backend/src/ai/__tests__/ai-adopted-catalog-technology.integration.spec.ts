import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { PRODUCT_NAME } from '../../config/product';

// An entry of the technology catalog already adopted in this workspace is recognized by its
// catalog key, the same read the screen uses (`TechnologyCatalogService.notAdopted`). Kad names
// the existing technology and prepares no creation. A typed technology of the same name, and an
// entry the workspace has not adopted, stay on the paths they already had.

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

const CATALOG_NAME = 'Alpine Linux';
const CURRENT_NAME = 'Workspace Alpine';
const REFERENCE = 'TEC-17';
const RIGHT_REFUSAL = 'You need the right to modify IT infrastructure (assets, connections, technologies), which your role does not give. An administrator can add it to your role.';

/** The text the model reads when the catalog entry is already in this workspace. */
function alreadyAdopted(catalogName: string, reference: string, currentName: string): string {
  return `"${catalogName}" from the ${PRODUCT_NAME} catalog is already in this workspace: ${reference}, currently named "${currentName}". Tell the person this technology already exists, give this reference and the current name, and offer to open it or to change it. Prepare no creation and no second adoption.`;
}

type Harness = { app: any; dataSource: DataSource; previews: any };
type Seed = {
  tenantId: string;
  users: { member: string; noInfra: string };
  technologyId: string;
};

function tag() {
  return randomUUID().replace(/-/g, '').slice(0, 10);
}

async function seedTenant(runner: QueryRunner, tenantId: string, slug: string) {
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active',
             '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, `Catalog recognition ${slug}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const model = await runner.query(
    `INSERT INTO ai_model_configs (
       tenant_id, name, provider, model, endpoint_url, api_key_encrypted,
       supports_vision, is_default, created_at, updated_at
     ) VALUES ($1, 'catalog-recognition-model', 'custom', 'catalog-recognition-model',
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
               'catalog-recognition-model', 'test-secret', false, false, $2, now(), now())`,
    [tenantId, model[0].id],
  );
}

async function seedRole(runner: QueryRunner, tenantId: string, name: string, permissions: Record<string, string>) {
  const roleId = randomUUID();
  await runner.query(
    `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, $3, $4, false, false, now(), now())`,
    [roleId, tenantId, name, name],
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

async function seedUser(runner: QueryRunner, tenantId: string, roleId: string, email: string) {
  const userId = randomUUID();
  await runner.query(
    `INSERT INTO users (id, tenant_id, first_name, last_name, email, password_hash, role_id,
                        mfa_enabled, status, locale, created_at, updated_at)
     VALUES ($1, $2, 'Ada', 'Tester', $3, null, $4, false, 'enabled', 'en', now(), now())`,
    [userId, tenantId, email, roleId],
  );
  return userId;
}

async function seedGraph(runner: QueryRunner): Promise<Seed> {
  const id = tag();
  const tenantId = randomUUID();
  await seedTenant(runner, tenantId, `cat-${id}`);
  const memberRole = await seedRole(runner, tenantId, 'Infrastructure Member', {
    ai_chat: 'member', infrastructure: 'member',
  });
  const noInfraRole = await seedRole(runner, tenantId, 'Chat Only', { ai_chat: 'member' });
  const users = {
    member: await seedUser(runner, tenantId, memberRole, `member-${id}@example.test`),
    noInfra: await seedUser(runner, tenantId, noInfraRole, `noread-${id}@example.test`),
  };
  // Adopted, then renamed: the catalog key stays, the name does not.
  const rows = await runner.query(
    `INSERT INTO technologies (tenant_id, item_number, name, family, hosting_type, lifecycle, catalog_key)
     VALUES ($1, 17, $2, 'operating_system', 'on_prem', 'active', 'alpine-linux')
     RETURNING id`,
    [tenantId, CURRENT_NAME],
  );
  return { tenantId, users, technologyId: String(rows[0].id) };
}

function context(seed: Seed, runner: QueryRunner, label: string, userId = seed.users.member) {
  return {
    tenantId: seed.tenantId,
    userId,
    isPlatformHost: false,
    surface: 'chat' as const,
    authMethod: 'jwt' as const,
    conversationId: randomUUID(),
    manager: runner.manager,
    label,
  };
}

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-adopted-catalog-technology.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiMutationPreviewService } = require('../ai-mutation-preview.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  return { app, dataSource: app.get(DataSource), previews: app.get(AiMutationPreviewService) };
}

async function withSeed(harness: Harness, test: (runner: QueryRunner, seed: Seed) => Promise<void>) {
  const runner = harness.dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await test(runner, await seedGraph(runner));
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function openConversation(ctx: ReturnType<typeof context>) {
  await ctx.manager.query(
    `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
     VALUES ($1, $2, $3, 'Catalog recognition', 'custom', 'catalog-recognition-model', 'custom', now(), now())`,
    [ctx.conversationId, ctx.tenantId, ctx.userId],
  );
}

function ask(name: string, extra: Record<string, unknown> = {}) {
  return {
    entity_type: 'technologies',
    fields: { name, ...extra },
  };
}

/** The whole refusal, message and body, so a leaked reference cannot hide beside the message. */
async function refusalText(fn: () => Promise<unknown>): Promise<string> {
  try {
    const value = await fn();
    return `RESOLVED ${JSON.stringify(value)}`;
  } catch (error) {
    const err = error as { message?: string; getResponse?: () => unknown };
    const response = typeof err.getResponse === 'function' ? err.getResponse() : undefined;
    return JSON.stringify({ message: err.message ?? String(error), response });
  }
}

async function previewCount(runner: QueryRunner, tenantId: string): Promise<number> {
  const [{ n }] = await runner.query(
    `SELECT count(*)::int AS n FROM ai_mutation_previews WHERE tenant_id = $1`,
    [tenantId],
  );
  return n;
}

/** Adopted, then renamed: the tool names the existing technology and prepares nothing. */
async function testRenamedAdoptedEntry(harness: Harness) {
  await withSeed(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'renamed');
    const text = await refusalText(() => harness.previews.createPreview(ctx, 'create_business_record', ask(CATALOG_NAME)));
    assert.equal(text, JSON.stringify({
      message: alreadyAdopted(CATALOG_NAME, REFERENCE, CURRENT_NAME),
      response: { message: alreadyAdopted(CATALOG_NAME, REFERENCE, CURRENT_NAME), error: 'Bad Request', statusCode: 400 },
    }));
    assert.equal(await previewCount(runner, seed.tenantId), 0, 'no creation preview');
    const [{ n }] = await runner.query(
      `SELECT count(*)::int AS n FROM technologies WHERE tenant_id = $1 AND catalog_key = 'alpine-linux'`,
      [seed.tenantId],
    );
    assert.equal(n, 1, 'the adopted technology stays the only one');
  });
}

/** Adopted, and still carrying the catalog name: the same recognition, not the name-duplicate refusal. */
async function testAdoptedEntryUnderItsCatalogName(harness: Harness) {
  await withSeed(harness, async (runner, seed) => {
    await runner.query(`UPDATE technologies SET name = $3 WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.technologyId, CATALOG_NAME]);
    const ctx = context(seed, runner, 'same-name');
    const text = await refusalText(() => harness.previews.createPreview(ctx, 'create_business_record', ask(CATALOG_NAME)));
    const message = alreadyAdopted(CATALOG_NAME, REFERENCE, CATALOG_NAME);
    assert.equal(text, JSON.stringify({
      message,
      response: { message, error: 'Bad Request', statusCode: 400 },
    }));
    assert.equal(text.includes('A technology with this name already exists'), false);
    assert.equal(await previewCount(runner, seed.tenantId), 0);
  });
}

/** An entry this workspace has never adopted is still an adoption from the catalog. */
async function testNeverAdoptedEntry(harness: Harness) {
  await withSeed(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'debian');
    await openConversation(ctx);
    const preview = await harness.previews.createPreview(ctx, 'create_business_record', ask('Debian')) as any;
    assert.equal(preview.summary, `Adopt technology "Debian" from the ${PRODUCT_NAME} catalog.`);
    assert.match(String(preview.changes.catalog_adoption.to), new RegExp(`^\\*\\*Adopted from the ${PRODUCT_NAME} catalog\\*\\*`));
    const stored = await runner.query(`SELECT mutation_input FROM ai_mutation_previews WHERE id = $1`, [preview.preview_id]);
    assert.equal(stored[0].mutation_input.adopt.catalog_key, 'debian');
    assert.equal(stored[0].mutation_input.adopt.completes, null);
  });
}

/** The same catalog entry adopted in another workspace does not count here. */
async function testAdoptedInAnotherWorkspace(harness: Harness) {
  await withSeed(harness, async (runner, seed) => {
    const other = randomUUID();
    await seedTenant(runner, other, `other-${tag()}`);
    await runner.query(
      `INSERT INTO technologies (tenant_id, item_number, name, family, hosting_type, lifecycle, catalog_key)
       VALUES ($1, 3, 'Other Workspace Rocky', 'operating_system', 'on_prem', 'active', 'rocky-linux')`,
      [other],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [seed.tenantId]);
    const ctx = context(seed, runner, 'other-workspace');
    await openConversation(ctx);
    const preview = await harness.previews.createPreview(ctx, 'create_business_record', ask('Rocky Linux')) as any;
    assert.equal(preview.summary, `Adopt technology "Rocky Linux" from the ${PRODUCT_NAME} catalog.`);
    const stored = await runner.query(`SELECT mutation_input FROM ai_mutation_previews WHERE id = $1`, [preview.preview_id]);
    assert.equal(stored[0].mutation_input.adopt.catalog_key, 'rocky-linux');
    assert.equal(JSON.stringify(preview).includes('Other Workspace Rocky'), false);
    assert.equal(JSON.stringify(stored).includes('Other Workspace Rocky'), false);
  });
}

/** A person who cannot read technologies gets the ordinary right refusal, with no record in it. */
async function testUnreadableTechnologyIsNotNamed(harness: Harness) {
  await withSeed(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'no-read', seed.users.noInfra);
    const text = await refusalText(() => harness.previews.createPreview(ctx, 'create_business_record', ask(CATALOG_NAME)));
    assert.equal(text.includes(RIGHT_REFUSAL), true, text);
    assert.equal(text.includes(CURRENT_NAME), false, text);
    assert.equal(text.includes(REFERENCE), false, text);
    assert.equal(text.includes(seed.technologyId), false, text);
    assert.equal(await previewCount(runner, seed.tenantId), 0);
  });
}

/**
 * Asking for a separate technology keeps today's name check: the current name is refused as a
 * duplicate, and the catalog name, now free because the adopted record was renamed, is a typed
 * technology with no catalog key.
 */
async function testSeparateTechnologyKeepsTheNameCheck(harness: Harness) {
  await withSeed(harness, async (runner, seed) => {
    const ctx = context(seed, runner, 'separate-same');
    const duplicate = await refusalText(() => harness.previews.createPreview(ctx, 'create_business_record', ask(CURRENT_NAME, {
      family: 'Operating system', lifecycle: 'Active', from_catalog: false,
    })));
    assert.equal(duplicate.includes(`A technology with this name already exists: ${REFERENCE}.`), true, duplicate);
    assert.equal(duplicate.includes('currently named'), false, duplicate);

    await openConversation(ctx);
    const preview = await harness.previews.createPreview(ctx, 'create_business_record', ask(CATALOG_NAME, {
      family: 'Operating system', lifecycle: 'Active', from_catalog: false,
    })) as any;
    assert.equal(preview.summary, `Create technology "${CATALOG_NAME}".`);
    assert.equal(preview.changes.catalog_adoption, undefined);
    const stored = await runner.query(`SELECT mutation_input FROM ai_mutation_previews WHERE id = $1`, [preview.preview_id]);
    assert.equal(stored[0].mutation_input.adopt, undefined);
    assert.equal(stored[0].mutation_input.fields.name, CATALOG_NAME);
  });
}

/** The operating-system preview already lands on the adopted record after a rename. */
async function testOperatingSystemPreviewKeepsTheRenamedRecord(harness: Harness) {
  await withSeed(harness, async (runner, seed) => {
    const { OperatingSystemService } = require('../../technologies/operating-system.service');
    const preview = await harness.app.get(OperatingSystemService).preview(runner.manager, seed.tenantId, CATALOG_NAME);
    assert.deepEqual(
      { label: preview?.label, technology: preview?.technology },
      { label: CURRENT_NAME, technology: 'tenant' },
    );
  });
}

async function run() {
  const harness = await createHarness();
  const tests = [
    ['renamed adopted entry', testRenamedAdoptedEntry],
    ['adopted entry under its catalog name', testAdoptedEntryUnderItsCatalogName],
    ['never adopted entry', testNeverAdoptedEntry],
    ['adopted in another workspace', testAdoptedInAnotherWorkspace],
    ['unreadable technology is not named', testUnreadableTechnologyIsNotNamed],
    ['separate technology keeps the name check', testSeparateTechnologyKeepsTheNameCheck],
    ['operating system preview keeps the renamed record', testOperatingSystemPreviewKeepsTheRenamedRecord],
  ] as const;
  let failed = 0;
  try {
    for (const [name, test] of tests) {
      try {
        await test(harness);
        console.log(`PASS ${name}`);
      } catch (error) {
        failed += 1;
        console.log(`FAIL ${name}`);
        console.log(error instanceof Error ? error.stack ?? error.message : String(error));
      }
    }
  } finally {
    await harness.app.close();
  }
  console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

void run();
