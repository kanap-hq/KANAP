import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { seedManagedDocsKnowledgeAssets } from '../../knowledge/integrated-document-seed';

// Lot I7b of 26.12.1 (decision P14): the description of an application has one source, its
// `overview` document. The column `applications.description` is its seed only, read while no
// document exists (the page makes the document of it when it first opens the application).
// - The import, the API and Kad write the document (a new version), the column following; a text the
//   document already holds writes nothing, the column left behind included.
// - The export, the record's read (screen API, Kad's card, the MCP server's detail), Kad's context,
//   the map summary, the copy, the conversion into a technology and the delete read the document.
// - Another tenant's application and document are never reached.
// - The search (migration 1856300000000): an application's entry carries no description; the search
//   shows the document's text as its summary; the document, saved on the page (autosave included), is
//   found by a word of its text by a person who reads the Knowledge, as a project's purpose is. The
//   search without the index follows the same rule.

process.env.AI_CHAT_ENABLED = 'true';
process.env.AI_SETTINGS_ENABLED = 'true';
process.env.AI_MCP_ENABLED = 'true';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.SETTINGS_ENCRYPTION_SECRET ||= process.env.AI_SETTINGS_ENCRYPTION_SECRET || 'test-ai-secret';
process.env.STRIPE_SECRET_KEY = '';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ||= 'test-bucket';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = {
  app: any; dataSource: DataSource; tools: any; previews: any; support: any; csv: any; apps: any; list: any;
  docs: any; deletes: any; executor: any; entities: any; conversion: any;
};
type Seed = { tenantId: string; userId: string };

const PERMISSIONS: Record<string, string> = { ai_chat: 'member', applications: 'member', infrastructure: 'member' };

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return String((await runner.query(sql, params))[0].id);
}

async function useTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function seedTenant(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR"}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `app-description-${tag}`, `App description ${tag}`],
  );
  await useTenant(runner, tenantId);
  const model = await one(runner,
    `INSERT INTO ai_model_configs (tenant_id, name, provider, model, endpoint_url, api_key_encrypted, supports_vision, is_default, created_at, updated_at)
     VALUES ($1, 'description-model', 'custom', 'description-model', 'https://llm.example.test/v1', 'test-secret', true, true, now(), now()) RETURNING id`, [tenantId]);
  await runner.query(
    `INSERT INTO ai_settings (tenant_id, chat_enabled, mcp_enabled, provider_source, llm_provider, llm_endpoint_url, llm_model,
                              llm_api_key_encrypted, web_search_enabled, glpi_enabled, chat_model_config_id, created_at, updated_at)
     VALUES ($1, true, true, 'custom', 'custom', 'https://llm.example.test/v1', 'description-model', 'test-secret', false, false, $2, now(), now())`,
    [tenantId, model]);
  const roleId = await one(runner,
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, 'Description member', 'Description member', false, false, now(), now()) RETURNING id`, [tenantId]);
  for (const [resource, level] of Object.entries(PERMISSIONS)) {
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level, created_at, updated_at) VALUES ($1, $2, $3, $4, now(), now())`,
      [tenantId, roleId, resource, level]);
  }
  const userId = await one(runner,
    `INSERT INTO users (tenant_id, first_name, last_name, email, role_id, mfa_enabled, status, locale, created_at, updated_at)
     VALUES ($1, 'Member', 'Tester', $2, $3, false, 'enabled', 'en', now(), now()) RETURNING id`,
    [tenantId, `member-${tag}@example.test`, roleId]);
  await seedManagedDocsKnowledgeAssets(runner.manager as any, tenantId);
  return { tenantId, userId };
}

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for application-description-document.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiToolRegistry } = require('../../ai/ai-tool.registry');
  const { AiMutationPreviewService } = require('../../ai/ai-mutation-preview.service');
  const { AiBusinessRecordMutationSupportService } = require('../../ai/mutation/ai-business-record-mutation-support.service');
  const { AiQueryExecutor } = require('../../ai/query/ai-query.executor');
  const { AiEntityService } = require('../../ai/ai-entity.service');
  const { ApplicationsCsvService } = require('../applications-csv.service');
  const { ApplicationsService } = require('../services/applications.service');
  const { ApplicationsListService } = require('../services/applications-list.service');
  const { ApplicationsDeleteService } = require('../applications-delete.service');
  const { IntegratedDocumentsService } = require('../../knowledge/integrated-documents.service');
  const { ApplicationConversionService } = require('../../technologies/application-conversion.service');
  const { NotificationsService } = require('../../notifications/notifications.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  // Nothing is sent from this spec.
  const notifications = app.get(NotificationsService, { strict: false });
  for (const method of Object.getOwnPropertyNames(Object.getPrototypeOf(notifications))) {
    if (method.startsWith('notify')) notifications[method] = async () => undefined;
  }
  const get = (type: any) => app.get(type, { strict: false });
  return {
    app,
    dataSource: app.get(DataSource),
    tools: get(AiToolRegistry),
    previews: get(AiMutationPreviewService),
    support: get(AiBusinessRecordMutationSupportService),
    csv: get(ApplicationsCsvService),
    apps: get(ApplicationsService),
    list: get(ApplicationsListService),
    docs: get(IntegratedDocumentsService),
    deletes: get(ApplicationsDeleteService),
    executor: get(AiQueryExecutor),
    entities: get(AiEntityService),
    conversion: get(ApplicationConversionService),
  };
}

function context(s: Seed, runner: QueryRunner) {
  return {
    tenantId: s.tenantId, userId: s.userId, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const,
    conversationId: randomUUID(), manager: runner.manager,
  };
}

async function inSeed(harness: Harness, test: (runner: QueryRunner, s: Seed) => Promise<void>) {
  const runner = harness.dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await test(runner, await seedTenant(runner));
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

/** An application whose column holds `seed`. */
async function application(runner: QueryRunner, s: Seed, name: string, seed: string | null): Promise<string> {
  return one(runner, `INSERT INTO applications (tenant_id, name, status, lifecycle, description) VALUES ($1, $2, 'enabled', 'active', $3) RETURNING id`, [s.tenantId, name, seed]);
}

/** The page opens the application (its document made of the seed), then the person writes `text` in it. */
async function openedAndEdited(harness: Harness, runner: QueryRunner, s: Seed, appId: string, text: string) {
  await harness.docs.repairSourceSlot('applications', appId, 'overview', { manager: runner.manager, actorUserId: s.userId });
  const [app] = await runner.query(`SELECT id::text AS id, tenant_id::text AS tenant_id, name, sequential_id FROM applications WHERE id = $1`, [appId]);
  await harness.docs.writeSourceSlotContent('applications', { ...app, item_number: null, reference_label: app.sequential_id }, 'overview', text, s.userId, { manager: runner.manager });
}

async function documentOf(runner: QueryRunner, s: Seed, appId: string): Promise<{ id: string; text: string; versions: string[] } | null> {
  const [doc] = await runner.query(
    `SELECT d.id::text AS id, d.content_markdown AS text
       FROM integrated_document_bindings b JOIN documents d ON d.id = b.document_id AND d.tenant_id = b.tenant_id
      WHERE b.tenant_id = $1 AND b.source_entity_type = 'applications' AND b.source_entity_id = $2 AND b.slot_key = 'overview'`,
    [s.tenantId, appId],
  );
  if (!doc) return null;
  const versions = await runner.query(`SELECT content_markdown FROM document_versions WHERE tenant_id = $1 AND document_id = $2 ORDER BY version_number`, [s.tenantId, doc.id]);
  return { id: doc.id, text: doc.text, versions: versions.map((row: any) => row.content_markdown) };
}

async function column(runner: QueryRunner, s: Seed, appId: string): Promise<string | null> {
  const [row] = await runner.query(`SELECT description FROM applications WHERE tenant_id = $1 AND id = $2`, [s.tenantId, appId]);
  return row?.description ?? null;
}

async function historyRows(runner: QueryRunner, s: Seed, appId: string): Promise<Array<{ before: any; after: any; source: string | null }>> {
  return runner.query(
    `SELECT before_json AS before, after_json AS after, source FROM audit_log
      WHERE tenant_id = $1 AND table_name = 'applications' AND record_id = $2 AND action = 'update' ORDER BY created_at, id`,
    [s.tenantId, appId],
  );
}

async function importFile(harness: Harness, runner: QueryRunner, s: Seed, content: string, operation = 'upsert') {
  const result = await harness.csv.import(
    { buffer: Buffer.from(content), originalname: 'applications.csv' } as Express.Multer.File,
    { dryRun: false, operation },
    { manager: runner.manager, tenantId: s.tenantId, userId: s.userId, access: { isAdmin: true, permissions: {} } },
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return result;
}

async function exported(harness: Harness, runner: QueryRunner, s: Seed): Promise<string> {
  const result = await harness.csv.export({ manager: runner.manager, tenantId: s.tenantId, language: 'en', fields: ['name', 'description'] });
  return String(result.content);
}

/** What each reader gives as the application's description. */
async function readers(harness: Harness, runner: QueryRunner, s: Seed, appId: string) {
  const ctx = context(s, runner);
  const opts = { manager: runner.manager, tenantId: s.tenantId };
  return {
    screen: (await harness.apps.get(appId, opts)).description,
    kadCard: (await harness.support.getRecordSnapshot(ctx, 'applications', appId)).description,
    mcpDetail: (await harness.executor.executeDetail(ctx, { entity_type: 'applications', entity_id: appId })).entity.summary,
    kadContext: (await harness.entities.getEntityContext(ctx, { entity_type: 'applications', entity_id: appId })).entity.summary,
    mapSummary: (await harness.list.mapSummary(appId, opts)).description,
  };
}

function assertReaders(read: Record<string, unknown>, text: string) {
  for (const [reader, value] of Object.entries(read)) assert.equal(value, text, `${reader} reads the document`);
}

/** An import over an application whose document exists writes the document; every reader shows it. */
async function testImportWritesTheDocument(harness: Harness) {
  await inSeed(harness, async (runner, s) => {
    const appId = await application(runner, s, 'Alpha', 'Seed of Alpha');
    await openedAndEdited(harness, runner, s, appId, 'Written on the page');
    const before = await documentOf(runner, s, appId);
    assert.equal(await column(runner, s, appId), 'Seed of Alpha', 'harness: the page wrote the document only');
    assertReaders(await readers(harness, runner, s, appId), 'Written on the page');

    const result = await importFile(harness, runner, s, 'name;description\nAlpha;Imported description\n');
    assert.equal(result.updated, 1);
    const after = await documentOf(runner, s, appId);
    assert.equal(after?.id, before?.id, 'the same document');
    assert.equal(after?.text, 'Imported description', 'the document holds the imported description');
    assert.equal(after?.versions.length, (before?.versions.length ?? 0) + 1, 'one new version of the document');
    assert.equal(await column(runner, s, appId), 'Imported description', 'the column follows');
    assertReaders(await readers(harness, runner, s, appId), 'Imported description');
    const file = await exported(harness, runner, s);
    assert.match(file, /Alpha[;,]"?Imported description/, `the export reads the document: ${file}`);
    const history = await historyRows(runner, s, appId);
    assert.equal(history.length, 1, 'one history row');
    assert.equal(history[0].before.description, 'Written on the page', 'the history says what the document held');
    assert.equal(history[0].after.description, 'Imported description');
  });
}

/** A description the document already holds writes nothing, the column left behind included. */
async function testUnchangedWritesNothing(harness: Harness) {
  await inSeed(harness, async (runner, s) => {
    const appId = await application(runner, s, 'Alpha', 'Seed of Alpha');
    await openedAndEdited(harness, runner, s, appId, 'Written on the page');
    const before = await documentOf(runner, s, appId);
    const check = await harness.csv.import(
      { buffer: Buffer.from('name;description\nAlpha;Written on the page\n'), originalname: 'applications.csv' } as Express.Multer.File,
      { dryRun: true, operation: 'upsert' },
      { manager: runner.manager, tenantId: s.tenantId, userId: s.userId, access: { isAdmin: true, permissions: {} } },
    );
    assert.equal(check.unchanged, 1, 'the check finds the row unchanged');
    const result = await importFile(harness, runner, s, 'name;description\nAlpha;Written on the page\n');
    assert.equal(result.unchanged, 1, 'the load finds it unchanged');
    assert.equal(result.updated, 0);
    assert.deepEqual(await documentOf(runner, s, appId), before, 'no new version');
    assert.equal(await column(runner, s, appId), 'Seed of Alpha', 'the column is not written');
    assert.equal((await historyRows(runner, s, appId)).length, 0, 'no history row');

    // Another column changes: the description, unchanged, stays out of the history.
    await importFile(harness, runner, s, 'name;description;version\nAlpha;Written on the page;2.0\n');
    assert.deepEqual((await documentOf(runner, s, appId))?.versions, before?.versions, 'no new version of the document');
    const history = await historyRows(runner, s, appId);
    assert.equal(history.length, 1);
    assert.equal(history[0].before.description, history[0].after.description, 'the description is no change of the row');

    // The API, with the text the document holds.
    await harness.apps.update(appId, { description: 'Written on the page' }, s.userId, { manager: runner.manager, tenantId: s.tenantId });
    assert.deepEqual((await documentOf(runner, s, appId))?.versions, before?.versions, 'the API writes no version either');
  });
}

/** A new application, and one whose document does not exist yet. */
async function testNewAndUnopenedApplications(harness: Harness) {
  await inSeed(harness, async (runner, s) => {
    const unopened = await application(runner, s, 'Gamma', 'Seed of Gamma');
    await importFile(harness, runner, s, 'name;description\nBeta;Description of a new application\nGamma;Replaced seed\n');
    const [{ id: beta }] = await runner.query(`SELECT id::text AS id FROM applications WHERE tenant_id = $1 AND name = 'Beta'`, [s.tenantId]);
    assert.equal((await documentOf(runner, s, beta))?.text, 'Description of a new application', 'a new application has its document');
    assertReaders(await readers(harness, runner, s, beta), 'Description of a new application');
    const gamma = await documentOf(runner, s, unopened);
    assert.equal(gamma?.text, 'Replaced seed', 'the document of an application never opened holds the new text');
    assert.ok(gamma?.versions.includes('Seed of Gamma'), `its history starts from the seed: ${JSON.stringify(gamma?.versions)}`);
    assertReaders(await readers(harness, runner, s, unopened), 'Replaced seed');

    // A seed nobody opened is read where no document exists.
    const seedOnly = await application(runner, s, 'Delta', 'Only a seed');
    assertReaders(await readers(harness, runner, s, seedOnly), 'Only a seed');
    assert.equal(await documentOf(runner, s, seedOnly), null, 'reading creates no document');
  });
}

/** The API writes the document, once, with one history row. */
async function testApiWritesTheDocument(harness: Harness) {
  await inSeed(harness, async (runner, s) => {
    const appId = await application(runner, s, 'Alpha', 'Seed of Alpha');
    await openedAndEdited(harness, runner, s, appId, 'Written on the page');
    const before = await documentOf(runner, s, appId);
    const saved = await harness.apps.update(appId, { description: 'Written by the API' }, s.userId, { manager: runner.manager, tenantId: s.tenantId });
    assert.equal(saved.description, 'Written by the API');
    const after = await documentOf(runner, s, appId);
    assert.equal(after?.text, 'Written by the API');
    assert.equal(after?.versions.length, (before?.versions.length ?? 0) + 1);
    const history = await historyRows(runner, s, appId);
    assert.equal(history.length, 1);
    assert.equal(history[0].before.description, 'Written on the page');
    assertReaders(await readers(harness, runner, s, appId), 'Written by the API');

    // Created with a description: its document holds it.
    const created = await harness.apps.create({ name: 'Created', description: 'Given at the creation' }, s.userId, { manager: runner.manager, tenantId: s.tenantId });
    assert.equal((await documentOf(runner, s, created.id))?.text, 'Given at the creation');
  });
}

async function card(harness: Harness, ctx: any, tool: string, input: Record<string, unknown>) {
  await ctx.manager.query(
    `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
     VALUES ($1, $2, $3, 'Application description', 'custom', 'description-model', 'custom', now(), now()) ON CONFLICT (id) DO NOTHING`,
    [ctx.conversationId, ctx.tenantId, ctx.userId],
  );
  const preview = await harness.tools.execute(ctx, tool, input) as any;
  assert.equal(preview.status, 'pending', JSON.stringify(preview));
  return preview;
}

/** Kad's card shows the document's text before the change, and its approval writes the document. */
async function testKadWritesTheDocument(harness: Harness) {
  await inSeed(harness, async (runner, s) => {
    const appId = await application(runner, s, 'Alpha', 'Seed of Alpha');
    await openedAndEdited(harness, runner, s, appId, 'Written on the page');
    const before = await documentOf(runner, s, appId);
    const ctx = context(s, runner);
    const preview = await card(harness, ctx, 'update_business_record', { entity_type: 'applications', ref: appId, fields: { description: 'Written by Kad' } });
    assert.equal(preview.changes.description.from, 'Written on the page', 'the card shows what the document holds');
    const executed = await harness.previews.executePreview(ctx, preview.preview_id) as any;
    assert.equal(executed.status, 'executed', executed.error_message);
    const after = await documentOf(runner, s, appId);
    assert.equal(after?.text, 'Written by Kad');
    assert.equal(after?.versions.length, (before?.versions.length ?? 0) + 1);
    const history = await historyRows(runner, s, appId);
    assert.equal(history.length, 1, 'one history row for the card');
    assert.equal(history[0].before.description, 'Written on the page');
    assertReaders(await readers(harness, runner, s, appId), 'Written by Kad');
  });
}

/** The copy, the conversion into a technology and the delete read the document. */
async function testCopyConversionDelete(harness: Harness) {
  await inSeed(harness, async (runner, s) => {
    const appId = await application(runner, s, 'Alpha', 'Seed of Alpha');
    await openedAndEdited(harness, runner, s, appId, 'Written on the page');
    const copy = await harness.apps.copyApplication(appId, 'Alpha copy', s.userId, { manager: runner.manager, tenantId: s.tenantId });
    assert.equal((await documentOf(runner, s, copy.id))?.text, 'Written on the page', 'the copy has the document\'s text');
    assert.equal(await column(runner, s, copy.id), 'Written on the page');

    // The delete counts a description its document holds, never the column it left behind.
    const emptied = await application(runner, s, 'Emptied', 'Stale seed');
    await openedAndEdited(harness, runner, s, emptied, '');
    const described = (await harness.deletes.deleteCheck([emptied], { manager: runner.manager })).removes.find((usage: any) => usage.type === 'descriptions');
    assert.equal(described, undefined, 'an emptied document is no description');
    const counted = (await harness.deletes.deleteCheck([appId], { manager: runner.manager })).removes.find((usage: any) => usage.type === 'descriptions');
    assert.equal(counted?.total, 1, 'the document\'s description is counted');

    const converted = await harness.conversion.convert(appId, { family: 'database' }, { manager: runner.manager, tenantId: s.tenantId, userId: s.userId });
    const [technology] = await runner.query(`SELECT description FROM technologies WHERE tenant_id = $1 AND id = $2`, [s.tenantId, converted.technology.id]);
    assert.equal(technology.description, 'Written on the page', 'the technology takes the document\'s text');
  });
}

/** The search reads the description from the document, and finds the document by its words. */
async function testSearchReadsTheDocument(harness: Harness) {
  await inSeed(harness, async (runner, s) => {
    const opts = { manager: runner.manager, tenantId: s.tenantId, userId: s.userId };
    const created = await harness.apps.create({ name: 'Ledger', description: 'Keeps the zebrafish accounts' }, s.userId, opts);
    // The person edits the description on the page: the editor autosaves.
    const docs = harness.docs;
    const opened: any = await docs.getBySource('applications', created.id, 'overview', s.userId, { manager: runner.manager });
    const lock: any = await docs.acquireLockBySource('applications', created.id, 'overview', s.userId, { manager: runner.manager });
    await docs.updateBySource('applications', created.id, 'overview', {
      content_markdown: 'Keeps the narwhal accounts', revision: opened.revision, save_mode: 'autosave',
    }, s.userId, lock.lock_token, { manager: runner.manager });
    await docs.releaseLockBySource('applications', created.id, 'overview', s.userId, lock.lock_token, { manager: runner.manager });
    assert.equal(await column(runner, s, created.id), 'Keeps the zebrafish accounts', 'the seed is left behind by the page');

    const ctx = context(s, runner);
    const search = async (query: string) => (await harness.entities.searchAll(ctx, { query })).items
      .map((item: any) => [item.type, item.label, item.summary ?? null]);
    // Without a right on the Knowledge: neither the old nor the new words find anything.
    assert.deepEqual(await search('zebrafish'), [], 'the seed left behind finds nothing');
    assert.deepEqual(await search('narwhal'), [], 'without the Knowledge, the document is not searched');
    assert.deepEqual(await search('Ledger'), [['applications', 'Ledger', 'Keeps the narwhal accounts']], 'the summary is the document\'s text');
    // The search without the index (`AI_SEARCH_INDEX_ENABLED=false`) follows the same rule.
    process.env.AI_SEARCH_INDEX_ENABLED = 'false';
    try {
      const legacy = async (query: string) => (await harness.entities.searchAll(ctx, { query, entity_types: ['applications'] })).items
        .map((item: any) => [item.type, item.label, item.summary ?? null]);
      assert.deepEqual(await legacy('zebrafish'), [], 'without the index: the seed left behind finds nothing');
      assert.deepEqual(await legacy('narwhal'), [], 'without the index: the description is no search field');
      assert.deepEqual(await legacy('Ledger'), [['applications', 'Ledger', 'Keeps the narwhal accounts']], 'without the index: the document\'s text');
    } finally {
      delete process.env.AI_SEARCH_INDEX_ENABLED;
    }

    // With the Knowledge read: the document is found by its words.
    await runner.query(
      `INSERT INTO role_permissions (tenant_id, role_id, resource, level, created_at, updated_at)
       SELECT tenant_id, role_id, 'knowledge', 'reader', now(), now() FROM users WHERE tenant_id = $1 AND id = $2`,
      [s.tenantId, s.userId]);
    const hits = await search('narwhal');
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.equal(hits[0][0], 'documents');
    assert.match(String(hits[0][1]), /Ledger - Overview$/, 'the overview document, by its title');
  });
}

/**
 * "Update APP-n" whose target the load did not lock (the application the row looked like when the load
 * locked went, another looks like it since): the row is refused, the load writes nothing.
 */
async function testLookalikeTargetNotLocked(harness: Harness) {
  await inSeed(harness, async (runner, s) => {
    const target = await application(runner, s, 'Rácé one', 'Seed');
    const csv = harness.csv as any;
    const original = csv.lookalikeTargets;
    // The decision the load took when it locked: no target (the one it saw is gone since).
    csv.lookalikeTargets = async (_rows: unknown, _context: unknown, look: any) => { look.locked = new Set(); return []; };
    try {
      const result = await harness.csv.import(
        { buffer: Buffer.from('name;version;description\nRace one;2.0;New text\n'), originalname: 'applications.csv' } as Express.Multer.File,
        { dryRun: false, operation: 'upsert', lookalikes: [{ kind: 'lookalike', line: 2, action: 'update', id: target }] },
        { manager: runner.manager, tenantId: s.tenantId, userId: s.userId, access: { isAdmin: true, permissions: {} } },
      );
      assert.equal(result.ok, false);
      assert.deepEqual(result.errors.map((error: any) => error.code), ['CSV_LOOKALIKE_NEW']);
    } finally {
      csv.lookalikeTargets = original;
    }
    const [row] = await runner.query(`SELECT version, description FROM applications WHERE id = $1`, [target]);
    assert.deepEqual(row, { version: null, description: 'Seed' }, 'nothing written');
    assert.equal(await documentOf(runner, s, target), null);
  });
}

/** An import of one tenant never reaches another tenant's application or document. */
async function testOtherTenant(harness: Harness) {
  await inSeed(harness, async (runner, s) => {
    const other = await seedTenant(runner);
    const otherApp = await application(runner, other, 'Alpha', 'Seed of the other tenant');
    await openedAndEdited(harness, runner, other, otherApp, 'Other tenant\'s text');
    const otherBefore = await documentOf(runner, other, otherApp);

    await useTenant(runner, s.tenantId);
    const appId = await application(runner, s, 'Alpha', 'Seed of Alpha');
    await openedAndEdited(harness, runner, s, appId, 'Written on the page');
    await importFile(harness, runner, s, 'name;description\nAlpha;Imported description\n');
    assert.equal((await documentOf(runner, s, appId))?.text, 'Imported description');
    const { applicationDescriptions } = require('../application-description');
    const crossed = await applicationDescriptions(runner.manager, s.tenantId, [{ id: otherApp, description: 'fallback' }]);
    assert.equal(crossed.get(otherApp), 'fallback', 'another tenant\'s document is never read');

    await useTenant(runner, other.tenantId);
    assert.deepEqual(await documentOf(runner, other, otherApp), otherBefore, 'the other tenant\'s document is untouched');
    assert.equal(await column(runner, other, otherApp), 'Seed of the other tenant');
  });
}

async function run() {
  const harness = await createHarness();
  try {
    const failures: string[] = [];
    for (const test of [
      testImportWritesTheDocument, testUnchangedWritesNothing, testNewAndUnopenedApplications, testApiWritesTheDocument,
      testKadWritesTheDocument, testCopyConversionDelete, testOtherTenant, testSearchReadsTheDocument, testLookalikeTargetNotLocked,
    ]) {
      try {
        await test(harness);
        console.log(`ok - ${test.name}`);
      } catch (error) {
        failures.push(`${test.name}: ${(error as Error).stack ?? (error as Error).message}`);
        console.log(`not ok - ${test.name}`);
      }
    }
    if (failures.length) throw new Error(failures.join('\n\n'));
    console.log('application-description-document.integration.spec.ts passed');
  } finally {
    await harness.app.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
