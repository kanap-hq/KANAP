import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { seedManagedDocsKnowledgeAssets } from '../../knowledge/integrated-document-seed';
import { runWithRequestTenant } from '../../common/tenancy/request-tenant-context';

// Lot I7b of 26.12.1, pass 9: the imports whose texts live in bound documents (a project's and a
// request's purpose, an incident's review) read and compare those texts one row after the other, as
// a request of one person through the real Markdown workers, whose pool keeps two calls of a
// person waiting at most (a third is refused with a 503 MARKDOWN_BUSY).
// - Ten projects and ten requests never opened (their purpose is their column, no document): the
//   same text again is unchanged, a new purpose is checked, loaded and imported again (unchanged);
//   on the screen (the import service of its route) and on Kad's card.
// - Ten incidents with a review document: a new review is checked, loaded and imported again.
// Nothing is sent: no owner, sponsor or assignee, and the notifications are silenced.

process.env.AI_CHAT_ENABLED = 'true';
process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'document-text-imports-pool-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const COUNT = 10;

type Harness = { app: any; dataSource: DataSource; projects: any; requests: any; incidents: any; previews: any; files: Map<string, { name: string; buffer: Buffer }> };
type Seed = { tenantId: string; userId: string; conversationId: string };

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for document-text-imports-pool.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { PortfolioProjectsCsvService } = require('../../portfolio/portfolio-projects-csv.service');
  const { PortfolioRequestsCsvService } = require('../../portfolio/portfolio-requests-csv.service');
  const { IncidentsCsvService } = require('../../incidents/incidents-csv.service');
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
    projects: app.get(PortfolioProjectsCsvService, { strict: false }),
    requests: app.get(PortfolioRequestsCsvService, { strict: false }),
    incidents: app.get(IncidentsCsvService, { strict: false }),
    previews: app.get(AiMutationPreviewService),
    files,
  };
}

async function seedTenant(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `doc-texts-${tenantId.slice(0, 8)}`;
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
     VALUES ($1, $2, $3, 'Ten records', 'custom', 'import-model', 'custom', now(), now())`,
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

function kadContext(runner: QueryRunner, s: Seed) {
  return {
    tenantId: s.tenantId, userId: s.userId, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const,
    manager: runner.manager, conversationId: s.conversationId,
  };
}


const refs = Array.from({ length: COUNT }, (_, i) => i + 1);
const nameOf = (family: string, i: number) => `${family} record ${String(i).padStart(2, '0')}`;
const seedText = (family: string, i: number) => `Seed of **${nameOf(family, i)}**, written before its document.`;
const newText = (family: string, i: number) => `New text of *${nameOf(family, i)}*.\n\n- point ${i}\n- kept by its team`;
const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;

function assertCounts(label: string, result: any, expected: { inserted?: number; updated?: number; unchanged?: number }) {
  assert.equal(result.ok, true, `${label}: ${JSON.stringify(result.errors ?? result).slice(0, 600)}`);
  assert.equal(result.inserted ?? 0, expected.inserted ?? 0, `${label}: inserted`);
  assert.equal(result.updated ?? 0, expected.updated ?? 0, `${label}: updated`);
  assert.equal(result.unchanged ?? 0, expected.unchanged ?? 0, `${label}: unchanged`);
}

function file(content: string): Express.Multer.File {
  return { buffer: Buffer.from(content), originalname: 'records.csv' } as Express.Multer.File;
}

/** The texts of the family's documents of `slot`, by record id. */
async function texts(runner: QueryRunner, s: Seed, type: string, slot: string): Promise<string[]> {
  const rows: Array<{ text: string }> = await runner.query(
    `SELECT d.content_markdown AS text FROM integrated_document_bindings b JOIN documents d ON d.tenant_id = b.tenant_id AND d.id = b.document_id
      WHERE b.tenant_id = $1 AND b.source_entity_type = $2 AND b.slot_key = $3 ORDER BY d.content_markdown`,
    [s.tenantId, type, slot],
  );
  return rows.map((row) => row.text.replace(/\s+/g, ' ').trim());
}

const PORTFOLIO = [
  { family: 'Project', type: 'projects', table: 'portfolio_projects', service: 'projects' as const, kadKey: 'portfolio_projects' },
  { family: 'Request', type: 'requests', table: 'portfolio_requests', service: 'requests' as const, kadKey: 'portfolio_requests' },
];

/** Ten records never opened: their purpose is the column's, no document. */
async function seedPortfolio(runner: QueryRunner, s: Seed, table: string, family: string) {
  for (const i of refs) {
    await runner.query(`INSERT INTO ${table} (tenant_id, item_number, name, purpose) VALUES ($1, $2, $3, $4)`, [s.tenantId, 900 + i, nameOf(family, i), seedText(family, i)]);
  }
}

const portfolioFile = (family: string, text: (family: string, i: number) => string) =>
  ['name;purpose', ...refs.map((i) => `${cell(nameOf(family, i))};${cell(text(family, i))}`)].join('\n');

async function testPortfolioScreen(h: Harness, target: (typeof PORTFOLIO)[number]) {
  {
    await inSeed(h, async (runner, s) => {
      await seedPortfolio(runner, s, target.table, target.family);
      const run = (content: string, dryRun: boolean) => h[target.service].import(file(content), { dryRun, operation: 'upsert' },
        { manager: runner.manager, tenantId: s.tenantId, userId: s.userId, access: { isAdmin: true, permissions: {} } });
      assertCounts(`${target.type}: seeds again (check)`, await run(portfolioFile(target.family, seedText), true), { unchanged: COUNT });
      const next = portfolioFile(target.family, newText);
      assertCounts(`${target.type}: new purpose (check)`, await run(next, true), { updated: COUNT });
      assertCounts(`${target.type}: new purpose (load)`, await run(next, false), { updated: COUNT });
      const written = await texts(runner, s, target.type, 'purpose');
      assert.deepEqual(written, refs.map((i) => newText(target.family, i).replace(/\s+/g, ' ').trim()).sort(), `${target.type}: the documents hold the new purpose`);
      assertCounts(`${target.type}: same file again (check)`, await run(next, true), { unchanged: COUNT });
    });
  }
}

async function kadCard(h: Harness, runner: QueryRunner, s: Seed, key: string, content: string) {
  const id = randomUUID();
  h.files.set(id, { name: 'Records.csv', buffer: Buffer.from(content, 'utf8') });
  const columns = [{ column: 'name', source: 1, confidence: 'high' }, { column: 'purpose', source: 2, confidence: 'high' }];
  const card = await h.previews.createPreview(kadContext(runner, s), 'prepare_import_mapping', { attachment_id: id, entity_type: key, columns });
  assert.equal(card.import_mapping?.validation?.ok, true, `Kad's card (${key}): ${JSON.stringify(card.import_mapping?.validation ?? card).slice(0, 600)}`);
  return card;
}

async function testPortfolioKad(h: Harness, target: (typeof PORTFOLIO)[number]) {
  {
    await inSeed(h, async (runner, s) => {
      await seedPortfolio(runner, s, target.table, target.family);
      const next = portfolioFile(target.family, newText);
      const card = await kadCard(h, runner, s, target.kadKey, next);
      assert.match(card.import_mapping.on_approval, new RegExp(`^On approval: 0 records created, ${COUNT} updated\\b.*, 0 unchanged\\.$`), `${target.type}: ${card.import_mapping.on_approval}`);
      const done: any = await h.previews.executePreview(kadContext(runner, s), card.preview_id);
      assert.equal(done.status, 'executed', `${target.type}: Kad's approval: ${done.error_message ?? ''}`);
      assertCounts(`${target.type}: Kad's load`, { ok: true, ...done.import_mapping.result }, { updated: COUNT });
      const again = await kadCard(h, runner, s, target.kadKey, next);
      assert.match(again.import_mapping.on_approval, new RegExp(`^Nothing to import: .*\\(${COUNT} records unchanged\\)`), `${target.type}: ${again.import_mapping.on_approval}`);
    });
  }
}

const incidentFile = (text: (family: string, i: number) => string) =>
  ['ref;title;severity;review', ...refs.map((i) => `INC-${900 + i};${cell(nameOf('Incident', i))};major;${cell(text('Incident', i))}`)].join('\n');

async function testIncidents(h: Harness) {
  await inSeed(h, async (runner, s) => {
    for (const i of refs) {
      await runner.query(`INSERT INTO incidents (tenant_id, item_number, title, severity) VALUES ($1, $2, $3, 'major')`, [s.tenantId, 900 + i, nameOf('Incident', i)]);
    }
    const run = (content: string, dryRun: boolean) => h.incidents.import(file(content), { dryRun, operation: 'upsert' },
      { manager: runner.manager, tenantId: s.tenantId, userId: s.userId, isAdmin: true, access: { isAdmin: true, permissions: {} } });
    // Each incident's review document, written by a first import.
    assertCounts('incidents: first review (load)', await run(incidentFile(seedText), false), { updated: COUNT });
    assert.equal((await texts(runner, s, 'incidents', 'review')).length, COUNT, 'incidents: one review document each');
    const next = incidentFile(newText);
    assertCounts('incidents: new review (check)', await run(next, true), { updated: COUNT });
    assertCounts('incidents: new review (load)', await run(next, false), { updated: COUNT });
    assert.deepEqual(await texts(runner, s, 'incidents', 'review'), refs.map((i) => newText('Incident', i).replace(/\s+/g, ' ').trim()).sort(), 'incidents: the documents hold the new review');
    assertCounts('incidents: same file again (check)', await run(next, true), { unchanged: COUNT });
  });
}

async function run() {
  const failures: string[] = [];
  const harness = await createHarness();
  try {
    const tests: Array<[string, () => Promise<void>]> = [
      ...PORTFOLIO.flatMap((target) => [
        [`${target.type} on the screen`, () => testPortfolioScreen(harness, target)],
        [`${target.type} on Kad's card`, () => testPortfolioKad(harness, target)],
      ] as Array<[string, () => Promise<void>]>),
      ['incidents on the screen', () => testIncidents(harness)],
    ];
    for (const [name, test] of tests) {
      try {
        await test();
        console.log(`  ok ${name}`);
      } catch (error) {
        failures.push(`${name}: ${(error as Error).message.split('\n')[0]}`);
        console.log(`  FAILED ${name}: ${(error as Error).message.split('\n')[0]}`);
      }
    }
  } finally {
    await harness.app.close();
  }
  if (failures.length > 0) throw new Error(`${failures.length} failed:\n${failures.join('\n')}`);
  console.log('document-text-imports-pool.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
