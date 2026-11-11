import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Kad imports a budget file the way the first hour of a new workspace does (26.11.7, lot T4): a
// spreadsheet of eight lines, a title above its header, no company column, suppliers the workspace
// does not have yet. The workspace has one company.
// - One card, one approval: the card's check creates the missing suppliers, as the import dialog's
//   "Create missing suppliers" does, and the lone company pays every line. Approving it creates the
//   eight lines and the six suppliers.
// - The suppliers are created only for a person who may create suppliers (the dialog's rule): for a
//   budget administrator without that right, the check refuses the file and names them.
// - "Approve all" leaves out an import card whose check refused the file.
// The model is not called: the tools of the registry are, as the conversation calls them. The AI
// surface checks and the attachment storage are not under test: stubbed.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-import-budget-file-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; previews: any; mapping: any; files: Map<string, { name: string; buffer: Buffer }> };
type UserKey = 'admin' | 'budget';
type Seed = { tenantId: string; users: Record<UserKey, string>; conversations: Record<UserKey, string> };

const YEAR = new Date().getFullYear();
const SUPPLIERS = ['Dell', 'ESET', 'Infogérance Bretagne', 'Microsoft', 'OVHcloud', 'Orange'];

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-import-budget-file.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiMutationPreviewService } = require('../ai-mutation-preview.service');
  const { AiPolicyService } = require('../ai-policy.service');
  const { AiAttachmentService } = require('../ai-attachment.service');
  const { AiImportMappingService } = require('../import/ai-import-mapping.service');
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
  return { app, dataSource: app.get(DataSource), previews: app.get(AiMutationPreviewService), mapping: app.get(AiImportMappingService), files };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

/** A new workspace: one company, its chart of accounts, an administrator and a budget administrator, both in French. */
async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `ai-t4-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const chart = await insertId(runner, `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'PCG', 'Plan comptable', 'FR')`, [tenantId]);
  await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, 'Brasserie du Port', 'FR', 'Lorient', $2)`, [tenantId, chart]);
  for (const [number, name] of [[6135, 'Locations logicielles'], [6156, 'Maintenance'], [6262, 'Télécommunications'], [6228, 'Prestations'], [2183, 'Matériel informatique']]) {
    await runner.query(`INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, $3, $4)`, [tenantId, chart, number, name]);
  }
  const role = async (name: string, permissions: Record<string, string>) => {
    const id = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, $2, $2)`, [tenantId, name]);
    for (const [resource, level] of Object.entries(permissions)) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, id, resource, level]);
    }
    return id;
  };
  const roles: Record<UserKey, string> = {
    admin: await role('Administrator', {}),
    // The budget's import, without the right to create suppliers.
    budget: await role('Budget Administrator', { ai_chat: 'member', budget: 'admin', suppliers: 'reader' }),
  };
  const users = {} as Record<UserKey, string>;
  const conversations = {} as Record<UserKey, string>;
  for (const key of Object.keys(roles) as UserKey[]) {
    users[key] = await insertId(runner,
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, locale) VALUES ($1, $2, $3, 'Le Goff', $4, 'enabled', 'fr')`,
      [tenantId, `${key}-${slug}@example.test`, key, roles[key]]);
    conversations[key] = randomUUID();
    await runner.query(
      `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
       VALUES ($1, $2, $3, 'Budget file import', 'custom', 'import-model', 'custom', now(), now())`,
      [conversations[key], tenantId, users[key]],
    );
  }
  return { tenantId, users, conversations };
}

function ctx(runner: QueryRunner, s: Seed, user: UserKey) {
  return {
    tenantId: s.tenantId, userId: s.users[user], isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const,
    manager: runner.manager, conversationId: s.conversations[user],
  };
}

/**
 * The tester's workbook, rebuilt from the first-hour report of 8/11 (it is not kept): a title, a
 * blank row, the header on line 3, eight lines of two natures, six suppliers, no company column.
 */
function testerWorkbook(): Buffer {
  const { writeXlsx } = require('../../common/xlsx');
  const money = (value: number) => ({ kind: 'number' as const, value });
  return writeXlsx({
    language: 'fr',
    sheets: [{
      name: 'Budget',
      header: 'plain',
      headers: ['Budget IT 2026', '', '', '', ''],
      rows: [
        [null, null, null, null, null],
        ['Type', 'Libellé', 'Fournisseur', 'Poste', `Budget ${YEAR}`],
        ['Fonctionnement', 'Licences Microsoft 365', 'Microsoft', 'Logiciels', money(9600)],
        ['Fonctionnement', 'Hébergement des serveurs', 'OVHcloud', 'Hébergement', money(4800)],
        ['Fonctionnement', 'Abonnements mobiles', 'Orange', 'Télécoms', money(6240)],
        ['Fonctionnement', 'Lien fibre du site', 'Orange', 'Télécoms', money(3600)],
        ['Fonctionnement', 'Antivirus des postes', 'ESET', 'Logiciels', money(1350)],
        ['Fonctionnement', 'Infogérance', 'Infogérance Bretagne', 'Prestations', money(18000)],
        ['Investissement', 'Renouvellement PC portables', 'Dell', 'Matériel', money(24000)],
        ['Fonctionnement', 'Maintenance du matériel', 'Dell', 'Maintenance', money(2400)],
      ],
    }],
  });
}

/** The mapping Kad proposes for the workbook: the nature and the account by their words, the currency for every row. */
const MAPPING = [
  { column: 'nature', source: 1, confidence: 'high', values: { Fonctionnement: 'opex', Investissement: 'capex' } },
  { column: 'name', source: 2, confidence: 'high' },
  { column: 'supplier_name', source: 3, confidence: 'high' },
  {
    column: 'account_number', source: 4, confidence: 'medium',
    values: { Logiciels: '6135', 'Hébergement': '6135', 'Télécoms': '6262', Prestations: '6228', 'Matériel': '2183', Maintenance: '6156' },
  },
  { column: 'currency', value: 'EUR', confidence: 'high' },
  { column: `budget_${YEAR}`, source: 5, confidence: 'high' },
];

function attachWorkbook(h: Harness): string {
  const id = randomUUID();
  h.files.set(id, { name: 'Budget IT 2026.xlsx', buffer: testerWorkbook() });
  return id;
}

async function count(runner: QueryRunner, s: Seed, table: 'spend_items' | 'suppliers'): Promise<number> {
  const [row] = await runner.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [s.tenantId]);
  return row.n;
}

// The measure of the lot: the eight lines in one exchange (one card) and one approval, in French.
async function testOneCardOneApproval(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s, 'admin');
  const template = await h.mapping.describeTemplate(admin, 'budget_lines', 'fr');
  const company = template.columns.find((column: any) => column.column === 'company_name');
  assert.equal(company.required, false, 'the company is not asked for');
  assert.match(company.takes, /only company/, 'the model is told a blank company is the workspace\'s only one');

  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attachWorkbook(h), entity_type: 'budget_lines', columns: MAPPING });
  const check = card.import_mapping.validation;
  assert.equal(check.ok, true, JSON.stringify({ issues: check.issues, report: check.report }));
  assert.equal(check.inserted, 8);
  assert.equal(check.error_count, 0);
  assert.equal(check.new_suppliers, 6, 'the model is told the card creates six suppliers');
  assert.deepEqual(
    check.report.file.creates.suppliers.map((supplier: any) => supplier.name).sort(),
    SUPPLIERS,
    'the card lists the suppliers it creates',
  );
  assert.equal(await count(runner, s, 'suppliers'), 0, 'the check creates nothing');

  const done = await h.previews.executePreview(admin, card.preview_id);
  assert.equal(done.status, 'executed', done.error_message ?? '');
  assert.match(done.summary, /« Budget IT 2026\.xlsx » dans la liste Lignes budgétaires/);
  assert.equal(done.import_mapping.result.inserted, 8);

  const suppliers = await runner.query(`SELECT name FROM suppliers WHERE tenant_id = $1 ORDER BY name`, [s.tenantId]);
  assert.deepEqual(suppliers.map((row: any) => row.name), SUPPLIERS);
  const lines = await runner.query(
    `SELECT i.nature, i.product_name, s.name AS supplier, c.name AS company, a.account_number::text AS account
       FROM spend_items i
       JOIN suppliers s ON s.tenant_id = i.tenant_id AND s.id = i.supplier_id
       JOIN companies c ON c.tenant_id = i.tenant_id AND c.id = i.paying_company_id
       JOIN accounts a ON a.tenant_id = i.tenant_id AND a.id = i.account_id
      WHERE i.tenant_id = $1 AND i.nature IN ('opex', 'capex')
      ORDER BY i.product_name`,
    [s.tenantId],
  );
  assert.equal(lines.length, 8);
  assert.deepEqual(lines.filter((line: any) => line.nature === 'capex').map((line: any) => [line.product_name, line.supplier, line.account]), [
    ['Renouvellement PC portables', 'Dell', '2183'],
  ]);
  assert.ok(lines.every((line: any) => line.company === 'Brasserie du Port'), 'the lone company pays every line');
  const [total] = await runner.query(
    `SELECT COALESCE(sum(a.planned), 0)::numeric AS total
       FROM spend_amounts a
       JOIN spend_versions v ON v.tenant_id = a.tenant_id AND v.id = a.version_id
      WHERE a.tenant_id = $1 AND v.budget_year = $2`,
    [s.tenantId, YEAR],
  );
  assert.equal(Number(total.total), 69990);
  console.log('  eight lines, six suppliers: one card, one approval: OK');
}

// The dialog creates suppliers for a person at the suppliers member level: so does the card.
async function testSuppliersNeedTheirRight(h: Harness, runner: QueryRunner, s: Seed) {
  const budget = ctx(runner, s, 'budget');
  const suppliersBefore = await count(runner, s, 'suppliers');
  const linesBefore = await count(runner, s, 'spend_items');
  const card = await h.previews.createPreview(budget, 'prepare_import_mapping', { attachment_id: attachWorkbook(h), entity_type: 'budget_lines', columns: MAPPING });
  const check = card.import_mapping.validation;
  assert.equal(check.ok, false, JSON.stringify(check.issues));
  assert.equal(check.new_suppliers, 0);
  assert.ok(check.issues.some((issue: any) => issue.level === 'error' && issue.column === 'supplier_name'), JSON.stringify(check.issues));
  assert.equal((await h.previews.executePreview(budget, card.preview_id)).status, 'failed');
  assert.equal(await count(runner, s, 'suppliers'), suppliersBefore);
  assert.equal(await count(runner, s, 'spend_items'), linesBefore);
  console.log('  without the right to create suppliers: refused, nothing written: OK');
}

// "Approve all" with an import card whose check refused the file (it went stale once Kad prepared a
// better one): the card is left out, neither run again nor failed. It stays as the person sees it,
// pending, with its errors, and cannot be approved.
async function testApproveAllLeavesOutARefusedCard(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s, 'admin');
  const unknownAccount = MAPPING.map((column) => (column.column === 'account_number'
    ? { ...column, values: { ...column.values, 'Matériel': '9999' } }
    : column));
  const stale = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attachWorkbook(h), entity_type: 'budget_lines', columns: unknownAccount });
  assert.equal(stale.import_mapping.validation.ok, false);
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attachWorkbook(h), entity_type: 'budget_lines', columns: MAPPING });
  assert.equal(card.import_mapping.validation.ok, true);

  const { results } = await h.previews.executePreviewsWithFollowUps(admin, [stale.preview_id, card.preview_id]);
  assert.deepEqual(results.map((preview: any) => [preview.preview_id, preview.status]), [[card.preview_id, 'executed']]);
  const kept = (await h.previews.listConversationPreviews(admin, s.conversations.admin))
    .find((preview: any) => preview.preview_id === stale.preview_id);
  assert.equal(kept.status, 'pending');
  assert.equal(kept.error_message, null);
  assert.equal(await count(runner, s, 'spend_items'), 8, 'the lines of the approved card only');
  console.log('  approve all: the card whose check refused the file is left out: OK');
}

async function inTenant(harness: Harness, test: (h: Harness, runner: QueryRunner, s: Seed) => Promise<void>) {
  const runner = harness.dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await test(harness, runner, await seed(runner));
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function run() {
  const harness = await createHarness();
  try {
    await inTenant(harness, testOneCardOneApproval);
    await inTenant(harness, testSuppliersNeedTheirRight);
    await inTenant(harness, testApproveAllLeavesOutARefusedCard);
  } finally {
    await harness.app.close();
  }
  console.log('ai-import-budget-file.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
