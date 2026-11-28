import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { waitForBackgroundWork } from '../../common/background-work';
import { lineImportTables } from '../../spend/budget-import-statistics';

// The planner statistics after a large budget file import approved in Kad (lot I5 of 26.11.9, T-I5d):
// Kad does what the import dialog does (`analyzeAfterLargeImport`). Once the approval's transaction
// is committed, a budget file load that wrote at least 1,000 rows has the screen's tables analysed,
// in the background, plus the suppliers when it created some. A load under the threshold and a card
// only checked analyse nothing. The model is not called: the card is prepared and approved through
// the preview service, as the conversation does, then the orchestrator's step after the approval's
// transaction runs. The AI surface checks and the attachment storage are not under test: stubbed.
// @database-spec: run-ci-tests.js runs this file on a database lane.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.SETTINGS_ENCRYPTION_SECRET ||= process.env.AI_SETTINGS_ENCRYPTION_SECRET || 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-import-statistics-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; previews: any; orchestrator: any; files: Map<string, { name: string; buffer: Buffer }> };
type Seed = { tenantId: string; userId: string; conversationId: string };

const YEAR = new Date().getFullYear();

/** The tables the step after the approval analyses (`ai/import/ai-import-statistics.ts`). */
const tablesToAnalyze = (previews: unknown[], approvedSince: number): string[] =>
  require('../import/ai-import-statistics').importTablesToAnalyze(previews, approvedSince);
const LARGE = 1000;

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-import-statistics.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiMutationPreviewService } = require('../ai-mutation-preview.service');
  const { AiPolicyService } = require('../ai-policy.service');
  const { AiAttachmentService } = require('../ai-attachment.service');
  const { AiChatOrchestratorService } = require('../ai-chat-orchestrator.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  const files = new Map<string, { name: string; buffer: Buffer }>();
  const attachments = app.get(AiAttachmentService);
  attachments.assertAndLoadAttachments = async (ids: string[]) => ids.map((id) => {
    const file = files.get(id);
    if (!file) throw new Error('One or more attachments are invalid for this conversation');
    return { id, kind: 'table', original_filename: file.name };
  });
  attachments.loadAttachmentBuffer = async (id: string) => ({ attachment: { id }, buffer: files.get(id)!.buffer });
  return {
    app,
    dataSource: app.get(DataSource),
    previews: app.get(AiMutationPreviewService),
    orchestrator: app.get(AiChatOrchestratorService),
    files,
  };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

/** A workspace with one company, one account, an administrator and a conversation, committed. */
async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `ai-i5c-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const chart = await insertId(runner, `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'PCG', 'Plan comptable', 'FR')`, [tenantId]);
  await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, 'Brasserie du Port', 'FR', 'Lorient', $2)`, [tenantId, chart]);
  await runner.query(`INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, 6135, 'Locations logicielles')`, [tenantId, chart]);
  const role = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Administrator', 'Administrator')`, [tenantId]);
  const userId = await insertId(runner,
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, locale) VALUES ($1, $2, 'Yann', 'Le Goff', $3, 'enabled', 'fr')`,
    [tenantId, `admin-${slug}@example.test`, role]);
  const conversationId = randomUUID();
  await runner.query(
    `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
     VALUES ($1, $2, $3, 'Budget file import', 'custom', 'import-model', 'custom', now(), now())`,
    [conversationId, tenantId, userId],
  );
  return { tenantId, userId, conversationId };
}

async function withCommittedTenant(h: Harness, test: (s: Seed) => Promise<void>) {
  const { purgeTenantTables } = require('../../admin/tenants/tenant-data-purge');
  const { TENANT_PURGE_TABLES } = require('../../admin/tenants/tenant-purge.inventory');
  const { withTenantExecution } = require('../../common/tenant-runner');
  const setup = h.dataSource.createQueryRunner();
  await setup.connect();
  await setup.startTransaction();
  let s: Seed;
  try {
    s = await seed(setup);
    await setup.commitTransaction();
  } catch (error) {
    if (setup.isTransactionActive) await setup.rollbackTransaction();
    throw error;
  } finally {
    await setup.release();
  }
  try {
    await test(s);
  } finally {
    await withTenantExecution(h.dataSource, s.tenantId, (manager: any) => purgeTenantTables(manager, TENANT_PURGE_TABLES))
      .catch((error: unknown) => console.error(`could not purge ${s.tenantId}:`, error));
    await h.dataSource.query(`DELETE FROM tenants WHERE id = $1`, [s.tenantId])
      .catch((error: unknown) => console.error(`could not delete ${s.tenantId}:`, error));
  }
}

/** `fn` in a committed transaction of the workspace, as the conversation's `runWithContext`. */
async function inTransaction(h: Harness, s: Seed, fn: (context: any) => Promise<any>): Promise<any> {
  const runner = h.dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [s.tenantId]);
    const result = await fn({
      tenantId: s.tenantId, userId: s.userId, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const,
      manager: runner.manager, conversationId: s.conversationId,
    });
    await runner.commitTransaction();
    return result;
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
}

/** A spreadsheet of `rows` running costs, one new supplier, each line its own name and amount. */
function attachWorkbook(h: Harness, rows: number): string {
  const { writeXlsx } = require('../../common/xlsx');
  const id = randomUUID();
  const lines = Array.from({ length: rows }, (_, index) => [
    'Fonctionnement', randomUUID(), 'Dell', 'Logiciels', { kind: 'number' as const, value: 1000 + index * 7 },
  ]);
  h.files.set(id, {
    name: `Budget ${rows}.xlsx`,
    buffer: writeXlsx({ language: 'fr', sheets: [{ name: 'Budget', header: 'plain', headers: ['Type', 'Libellé', 'Fournisseur', 'Poste', `Budget ${YEAR}`], rows: lines }] }),
  });
  return id;
}

const MAPPING = [
  { column: 'nature', source: 1, confidence: 'high', values: { Fonctionnement: 'opex' } },
  { column: 'name', source: 2, confidence: 'high' },
  { column: 'supplier_name', source: 3, confidence: 'high' },
  { column: 'account_number', source: 4, confidence: 'high', values: { Logiciels: '6135' } },
  { column: 'currency', value: 'EUR', confidence: 'high' },
  { column: `budget_${YEAR}`, source: 5, confidence: 'high' },
];

/** analyze_count of the given tables, read on a connection of its own. */
async function analyzeCounts(h: Harness, tables: readonly string[]): Promise<Record<string, number>> {
  const rows: Array<{ name: string; n: number }> = await h.dataSource.query(
    `SELECT relname::text AS name, analyze_count::int AS n FROM pg_stat_user_tables WHERE relname = ANY ($1::text[])`,
    [tables],
  );
  return Object.fromEntries(rows.map((row) => [row.name, row.n]));
}

/** Kad prepares the card of a file of `rows` lines: its check passes and creates the supplier. */
async function prepareCard(h: Harness, s: Seed, rows: number) {
  const card = await inTransaction(h, s, (context) => h.previews.createPreview(context, 'prepare_import_mapping', {
    attachment_id: attachWorkbook(h, rows), entity_type: 'budget_lines', columns: MAPPING,
  }));
  const check = card.import_mapping.validation;
  assert.equal(check.ok, true, JSON.stringify({ issues: check.issues }));
  assert.equal(check.inserted, rows);
  assert.equal(check.new_suppliers, 1);
  return card;
}

/** The approval as the conversation runs it: the cards executed in a transaction, then the step after its commit. */
async function approve(h: Harness, s: Seed, previewId: string) {
  const approvedSince = Date.now();
  const { results } = await inTransaction(h, s, (context) => h.previews.executePreviewsWithFollowUps(context, [previewId]));
  assert.equal(results[0].status, 'executed', results[0].error_message ?? '');
  return { results, approvedSince };
}

async function testLargeImportAnalysedAfterCommit(h: Harness) {
  await withCommittedTenant(h, async (s) => {
    const card = await prepareCard(h, s, LARGE);
    // A card only checked: nothing to analyse.
    assert.deepEqual(tablesToAnalyze([card], 0), [], 'a check analyses nothing');

    const tables = [...lineImportTables('opex'), 'suppliers'];
    const before = await analyzeCounts(h, tables);
    const { results, approvedSince } = await approve(h, s, card.preview_id);
    const result = results[0].import_mapping.result;
    assert.equal(result.dry_run, false);
    assert.equal(result.inserted, LARGE);
    assert.equal(result.created_suppliers, true, 'the load says it created suppliers');
    assert.deepEqual(tablesToAnalyze(results, approvedSince), tables, 'the screen\'s tables, and the suppliers created');

    h.orchestrator.analyzeLargeImportsAfterApproval(results, approvedSince);
    assert.equal(await waitForBackgroundWork(Date.now() + 60000), 0, 'the ANALYZE finished');
    const after = await analyzeCounts(h, tables);
    for (const table of tables) assert.ok(after[table] > before[table], `${table} analysed (${before[table]} -> ${after[table]})`);

    // The same card approved again (a second request): it was executed before, nothing new to analyse.
    const again = await inTransaction(h, s, (context) => h.previews.executePreviewsWithFollowUps(context, [card.preview_id]));
    assert.deepEqual(tablesToAnalyze(again.results, Date.now()), [], 'a card executed earlier analyses nothing');
  });
  console.log('  a large budget file approved in Kad: its tables analysed after the commit: OK');
}

async function testSmallImportAnalysesNothing(h: Harness) {
  await withCommittedTenant(h, async (s) => {
    const card = await prepareCard(h, s, 8);
    const { results, approvedSince } = await approve(h, s, card.preview_id);
    assert.equal(results[0].import_mapping.result.inserted, 8);
    assert.deepEqual(tablesToAnalyze(results, approvedSince), [], 'under the threshold: nothing');
  });
  console.log('  a budget file under the threshold: nothing analysed: OK');
}

async function run() {
  const harness = await createHarness();
  try {
    await testSmallImportAnalysesNothing(harness);
    await testLargeImportAnalysedAfterCommit(harness);
  } finally {
    await harness.app.close();
  }
  console.log('ai-import-statistics.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
