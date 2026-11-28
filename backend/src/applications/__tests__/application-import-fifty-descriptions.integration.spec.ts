import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { seedManagedDocsKnowledgeAssets } from '../../knowledge/integrated-document-seed';
import { runWithRequestTenant } from '../../common/tenancy/request-tenant-context';

// Lot I7b of 26.12.1, pass 8: an import of fifty applications with a description, through the real
// Markdown workers and as a request of one person (the caps of the pool apply to their key: one call
// running, two waiting, a third refused with a 503 MARKDOWN_BUSY). The description of each row is
// compared with its application's document, or read from its seed, one row after the other: never
// more calls of the person's key at once than the pool accepts.
// - The screen (the import service of its route): the export of fifty applications never opened
//   (their description is their seed) imported again is 50 unchanged; a file with new descriptions is
//   checked, then loaded (fifty documents), then imported again (50 unchanged); fifty new applications
//   too.
// - Kad: the same file of new descriptions on its card, checked then approved, then the card of the
//   same file again (50 unchanged).
// The specs before this one called the import outside a request: the key `system`, free of the caps.

process.env.AI_CHAT_ENABLED = 'true';
process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.SETTINGS_ENCRYPTION_SECRET ||= process.env.AI_SETTINGS_ENCRYPTION_SECRET || 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'application-import-fifty-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const COUNT = 50;
/** The check of fifty rows, at most (the brief's bound: past it, say what costs). */
const CHECK_MS_MAX = 10_000;

type Harness = { app: any; dataSource: DataSource; csv: any; previews: any; files: Map<string, { name: string; buffer: Buffer }> };
type Seed = { tenantId: string; userId: string; conversationId: string };
type Timing = { label: string; ms: number };

const timings: Timing[] = [];

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for application-import-fifty-descriptions.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { ApplicationsCsvService } = require('../applications-csv.service');
  const { AiMutationPreviewService } = require('../../ai/ai-mutation-preview.service');
  const { AiPolicyService } = require('../../ai/ai-policy.service');
  const { AiAttachmentService } = require('../../ai/ai-attachment.service');
  const { NotificationsService } = require('../../notifications/notifications.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const notifications = app.get(NotificationsService, { strict: false });
  for (const method of Object.getOwnPropertyNames(Object.getPrototypeOf(notifications))) {
    if (method.startsWith('notify')) notifications[method] = async () => undefined;
  }
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
    csv: app.get(ApplicationsCsvService, { strict: false }),
    previews: app.get(AiMutationPreviewService),
    files,
  };
}

async function seedTenant(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `app-fifty-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR"}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  await seedManagedDocsKnowledgeAssets(runner.manager as any, tenantId);
  const [role] = await runner.query(`INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Administrator', 'Administrator') RETURNING id`, [tenantId]);
  const [user] = await runner.query(
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, locale) VALUES ($1, $2, 'Admin', 'Tester', $3, 'enabled', 'en') RETURNING id`,
    [tenantId, `admin-${slug}@example.test`, role.id],
  );
  const conversationId = randomUUID();
  await runner.query(
    `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
     VALUES ($1, $2, $3, 'Fifty applications', 'custom', 'import-model', 'custom', now(), now())`,
    [conversationId, tenantId, user.id],
  );
  return { tenantId, userId: String(user.id), conversationId };
}

/** `test` in its own tenant, rolled back, as a request of its person: the pool's caps apply to their key. */
async function inSeed(h: Harness, test: (runner: QueryRunner, s: Seed) => Promise<void>) {
  const runner = h.dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const s = await seedTenant(runner);
    await runWithRequestTenant(s.tenantId, () => test(runner, s), { user: { sub: s.userId } });
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

const names = Array.from({ length: COUNT }, (_, i) => `Fifty app ${String(i + 1).padStart(2, '0')}`);
const seedText = (i: number) => `Seed of **${names[i]}**, written before its document.`;
const importedText = (i: number) => `Imported description of *${names[i]}*.\n\n- runs the ${i + 1}th process\n- kept by its team`;

/** Fifty applications never opened: their description is their seed, no document. */
async function seedApplications(runner: QueryRunner, s: Seed): Promise<void> {
  for (let i = 0; i < COUNT; i += 1) {
    await runner.query(`INSERT INTO applications (tenant_id, name, status, lifecycle, description) VALUES ($1, $2, 'enabled', 'active', $3)`, [s.tenantId, names[i], seedText(i)]);
  }
}

function csvFile(text: (i: number) => string): string {
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return ['name;description', ...names.map((name, i) => `${cell(name)};${cell(text(i))}`)].join('\n');
}

async function timed<T>(label: string, work: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await work();
  timings.push({ label, ms: Math.round(performance.now() - start) });
  return result;
}

async function screen(h: Harness, runner: QueryRunner, s: Seed, content: string, dryRun: boolean) {
  return h.csv.import(
    { buffer: Buffer.from(content), originalname: 'applications.csv' } as Express.Multer.File,
    { dryRun, operation: 'upsert' },
    { manager: runner.manager, tenantId: s.tenantId, userId: s.userId, access: { isAdmin: true, permissions: {} } },
  );
}

function assertCounts(label: string, result: any, expected: { inserted?: number; updated?: number; unchanged?: number }) {
  assert.equal(result.ok, true, `${label}: ${JSON.stringify(result.errors ?? result).slice(0, 600)}`);
  assert.equal(result.inserted ?? 0, expected.inserted ?? 0, `${label}: inserted`);
  assert.equal(result.updated ?? 0, expected.updated ?? 0, `${label}: updated`);
  assert.equal(result.unchanged ?? 0, expected.unchanged ?? 0, `${label}: unchanged`);
}

/** The text of each application's document, by name (absent: no document). */
async function documents(runner: QueryRunner, s: Seed): Promise<Map<string, { text: string; versions: number }>> {
  const rows: Array<{ name: string; text: string; versions: number }> = await runner.query(
    `SELECT a.name, d.content_markdown AS text,
            (SELECT count(*)::int FROM document_versions v WHERE v.tenant_id = d.tenant_id AND v.document_id = d.id) AS versions
       FROM applications a
       JOIN integrated_document_bindings b ON b.tenant_id = a.tenant_id AND b.source_entity_type = 'applications' AND b.source_entity_id = a.id AND b.slot_key = 'overview'
       JOIN documents d ON d.tenant_id = b.tenant_id AND d.id = b.document_id
      WHERE a.tenant_id = $1`,
    [s.tenantId],
  );
  return new Map(rows.map((row) => [row.name, { text: row.text, versions: row.versions }]));
}

function assertDocuments(label: string, docs: Map<string, { text: string }>, text: (i: number) => string) {
  assert.equal(docs.size, COUNT, `${label}: one document per application`);
  for (let i = 0; i < COUNT; i += 1) {
    assert.equal(docs.get(names[i])?.text.replace(/\s+/g, ' ').trim(), text(i).replace(/\s+/g, ' ').trim(), `${label}: ${names[i]}`);
  }
}

async function testScreenUpdates(h: Harness) {
  await inSeed(h, async (runner, s) => {
    await seedApplications(runner, s);
    // The export of applications never opened, imported again: their seeds, unchanged.
    assertCounts('seeds again (check)', await timed('screen: check of 50 seeds again', () => screen(h, runner, s, csvFile(seedText), true)), { unchanged: COUNT });
    assertCounts('seeds again (load)', await screen(h, runner, s, csvFile(seedText), false), { unchanged: COUNT });
    assert.equal((await documents(runner, s)).size, 0, 'seeds again: no document written');

    const file = csvFile(importedText);
    assertCounts('new descriptions (check)', await timed('screen: check of 50 new descriptions', () => screen(h, runner, s, file, true)), { updated: COUNT });
    assertCounts('new descriptions (load)', await timed('screen: load of 50 new descriptions', () => screen(h, runner, s, file, false)), { updated: COUNT });
    const written = await documents(runner, s);
    assertDocuments('new descriptions', written, importedText);

    assertCounts('same file again (check)', await timed('screen: check of the same 50 again', () => screen(h, runner, s, file, true)), { unchanged: COUNT });
    assertCounts('same file again (load)', await screen(h, runner, s, file, false), { unchanged: COUNT });
    const again = await documents(runner, s);
    for (const name of names) assert.equal(again.get(name)?.versions, written.get(name)?.versions, `same file again: no new version of ${name}`);
  });
}

async function testScreenCreates(h: Harness) {
  await inSeed(h, async (runner, s) => {
    const file = csvFile(importedText);
    assertCounts('new applications (check)', await timed('screen: check of 50 new applications', () => screen(h, runner, s, file, true)), { inserted: COUNT });
    assertCounts('new applications (load)', await screen(h, runner, s, file, false), { inserted: COUNT });
    assertDocuments('new applications', await documents(runner, s), importedText);
    assertCounts('new applications again (check)', await screen(h, runner, s, file, true), { unchanged: COUNT });
  });
}

function kadContext(runner: QueryRunner, s: Seed) {
  return {
    tenantId: s.tenantId, userId: s.userId, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const,
    manager: runner.manager, conversationId: s.conversationId,
  };
}

async function kadCard(h: Harness, runner: QueryRunner, s: Seed, content: string) {
  const id = randomUUID();
  h.files.set(id, { name: 'Applications.csv', buffer: Buffer.from(content, 'utf8') });
  const columns = [{ column: 'name', source: 1, confidence: 'high' }, { column: 'description', source: 2, confidence: 'high' }];
  const card = await h.previews.createPreview(kadContext(runner, s), 'prepare_import_mapping', { attachment_id: id, entity_type: 'applications', columns });
  assert.equal(card.import_mapping?.validation?.ok, true, `Kad's card: ${JSON.stringify(card.import_mapping?.validation ?? card).slice(0, 600)}`);
  return card;
}

async function testKad(h: Harness) {
  await inSeed(h, async (runner, s) => {
    await seedApplications(runner, s);
    const file = csvFile(importedText);
    const card = await timed("Kad: card (check) of 50 new descriptions", () => kadCard(h, runner, s, file));
    assert.match(card.import_mapping.on_approval, new RegExp(`^On approval: 0 records created, ${COUNT} updated\\b.*, 0 unchanged\\.$`), `Kad's check: ${card.import_mapping.on_approval}`);
    const done: any = await timed('Kad: approval (load) of 50 new descriptions', () => h.previews.executePreview(kadContext(runner, s), card.preview_id));
    assert.equal(done.status, 'executed', `Kad's approval: ${done.error_message ?? ''}`);
    assertCounts("Kad's load", { ok: true, ...done.import_mapping.result }, { updated: COUNT });
    assertDocuments("Kad's load", await documents(runner, s), importedText);
    const again = await kadCard(h, runner, s, file);
    assert.match(again.import_mapping.on_approval, new RegExp(`^Nothing to import: .*\\(${COUNT} records unchanged\\)`), `Kad's card of the same file: ${again.import_mapping.on_approval}`);
  });
}

async function run() {
  const failures: string[] = [];
  const harness = await createHarness();
  try {
    for (const test of [testScreenUpdates, testScreenCreates, testKad]) {
      try {
        await test(harness);
        console.log(`  ok ${test.name}`);
      } catch (error) {
        failures.push(`${test.name}: ${(error as Error).message.split('\n')[0]}`);
        console.log(`  FAILED ${test.name}: ${(error as Error).message.split('\n')[0]}`);
      }
    }
  } finally {
    await harness.app.close();
  }
  for (const { label, ms } of timings) console.log(`  ${label}: ${ms} ms`);
  const slow = timings.filter((timing) => timing.label.includes('check') && timing.ms > CHECK_MS_MAX);
  for (const timing of slow) failures.push(`${timing.label}: ${timing.ms} ms, over ${CHECK_MS_MAX} ms`);
  if (failures.length > 0) throw new Error(`${failures.length} failed:\n${failures.join('\n')}`);
  console.log('application-import-fifty-descriptions.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
