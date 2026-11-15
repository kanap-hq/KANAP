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
// Lot I1 of 26.11.9, "match before create": Fried's case of 12/11, eight English lines of the sample
// data loaded by Kad into a French workspace that holds them, translated. Nothing is created: the
// server matches the recommended dimensions' values across languages, the model's `values` (simulated
// here, as the model would give them) the sample data's own business domain, and every match is
// listed on the card. The person's choices (a match undone, the suppliers box) make a new card.
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

/**
 * Fried's French workspace, the part of the French sample data the eight lines name: the company,
 * the accounts, the five suppliers (07-suppliers.csv: the same names in English and French), the
 * recommended dimensions in French, the sample data's business domain in French
 * (fixture-dimensions.mjs: "Retail" is "Magasins"), and the eight lines themselves, translated, loaded
 * through the budget file of the screen.
 */
async function seedFrench(h: Harness, runner: QueryRunner): Promise<Seed> {
  const { ensureRecommendedDimensions, RECOMMENDED_DIMENSION_KEYS } = require('../../analytics/recommended-dimensions.seed');
  const tenantId = randomUUID();
  const slug = `ai-i1-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"language":"fr","reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const chart = await insertId(runner, `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso, is_global_default) VALUES ($1, 'PCG', 'Plan comptable', 'FR', true)`, [tenantId]);
  await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, 'Fromage & Co SA', 'FR', 'Lyon', $2)`, [tenantId, chart]);
  for (const number of ['612100', '612200', '616100', '621100', '205000', '218300']) {
    await runner.query(`INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, $3, $4)`, [tenantId, chart, number, `Compte ${number}`]);
  }
  for (const name of ['Microsoft', 'SAP', 'Cegid', 'Orange Business', 'Fromatech Consulting', 'Ancien infogérant']) {
    await runner.query(`INSERT INTO suppliers (tenant_id, name, status) VALUES ($1, $2, 'enabled')`, [tenantId, name]);
  }
  await runner.query(`INSERT INTO analytics_axes (tenant_id, code, is_default, sort_order) VALUES ($1, 'default', true, 0)`, [tenantId]);
  await ensureRecommendedDimensions(runner.manager, tenantId, 'fr', RECOMMENDED_DIMENSION_KEYS);
  const domain = await insertId(runner,
    `INSERT INTO analytics_axes (tenant_id, code, name, sort_order) VALUES ($1, 'business_domain', 'Domaine métier', 100)`, [tenantId]);
  for (const [index, name] of ['ERP', 'E-commerce', 'Magasins', 'IT partagée', 'Ancien domaine'].entries()) {
    await runner.query(
      `INSERT INTO analytics_categories (tenant_id, axis_id, name, sort_order, disabled_at) VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, domain, name, index + 1, name === 'Ancien domaine' ? '2020-01-01T00:00:00Z' : null],
    );
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
    budget: await role('Budget Administrator', { ai_chat: 'member', budget: 'admin', suppliers: 'reader' }),
  };
  const users = {} as Record<UserKey, string>;
  const conversations = {} as Record<UserKey, string>;
  for (const key of Object.keys(roles) as UserKey[]) {
    users[key] = await insertId(runner,
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, locale) VALUES ($1, $2, $3, 'Berger', $4, 'enabled', 'fr')`,
      [tenantId, `${key}-${slug}@example.test`, key, roles[key]]);
    conversations[key] = randomUUID();
    await runner.query(
      `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
       VALUES ($1, $2, $3, 'Budget file import', 'custom', 'import-model', 'custom', now(), now())`,
      [conversations[key], tenantId, users[key]],
    );
  }
  const s = { tenantId, users, conversations };
  // The eight lines, as the French sample data holds them.
  const french = [
    'nature,name,company_name,account_number,supplier_name,currency,analytics:default,analytics:it_tower,analytics:business_domain,analytics:priority,analytics:recurrence,budget_' + YEAR,
    'opex,Caisses Cegid des magasins,Fromage & Co SA,612200,Cegid,EUR,Logiciel,Application,Magasins,,Récurrent,88000',
    'opex,Magasins — secours 4G,Fromage & Co SA,616100,Orange Business,EUR,Télécoms,Réseau,Magasins,,Récurrent,19000',
    'opex,Prestataire · support caisses niveau 2,Fromage & Co SA,621100,Fromatech Consulting,EUR,Main-d\'œuvre externe,Poste de travail,Magasins,,Ponctuel,126440',
    'opex,Microsoft Enterprise (M365 + Azure + GitHub),Fromage & Co SA,612100,Microsoft,EUR,Logiciel,Poste de travail,IT partagée,,Récurrent,650000',
    'opex,Maintenance SAP S/4HANA,Fromage & Co SA,612200,SAP,EUR,Logiciel,Application,ERP,,Récurrent,280000',
    'capex,Rénovation du data center de Paris,Fromage & Co SA,218300,,EUR,Matériel,Calcul,IT partagée,Obligatoire,Ponctuel,250000',
    'capex,Plateforme e-commerce La Boutique,Fromage & Co SA,205000,,EUR,Main-d\'œuvre externe,Application,E-commerce,Haute,Ponctuel,120000',
    'capex,Magasins — remplacement des caisses,Fromage & Co SA,218300,,EUR,Matériel,Poste de travail,Magasins,Haute,Ponctuel,140000',
  ].map((line, index) => (index === 0 ? 'item_number,' : ',') + line).join('\n');
  const { BudgetFileService } = require('../../spend/budget-file/budget-file.service');
  const { SpendItemsService, CapexItemsService } = require('../../spend/spend-items.service');
  const { AuditService } = require('../../audit/audit.service');
  const { FreezeService } = require('../../freeze/freeze.service');
  const service = h.app.get(BudgetFileService);
  const caller = { manager: runner.manager, tenantId, userId: users.admin };
  const options = { language: 'en', dateOrder: undefined, decimalMark: 'dot', createSuppliers: false, canCreateSuppliers: true };
  const checked = await service.preflight('opex', Buffer.from(french), caller, options);
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.deepEqual(checked.creates.dimensionValues, [], 'the French lines name existing values');
  await service.importFile('opex', Buffer.from(french), checked.snapshot, caller, options, {
    items: { opex: h.app.get(SpendItemsService), capex: h.app.get(CapexItemsService) }, audit: h.app.get(AuditService), freeze: h.app.get(FreezeService),
  });
  return s;
}

/** The screen's budget file routes, called as the dialog calls them (`choices` in the form, a JSON list). */
function screenCaller(h: Harness, runner: QueryRunner, s: Seed, user: UserKey, isAdmin = true) {
  const { SpendItemsController } = require('../../spend/spend-items.controller');
  const controller = h.app.get(SpendItemsController);
  const tenant = { manager: runner.manager, tenantId: s.tenantId, userId: s.users[user], isAdmin, permissions: {} };
  const file = (buffer: Buffer) => ({ buffer, originalname: 'budget.csv', mimetype: 'text/csv', size: buffer.length });
  return {
    preflight: (buffer: Buffer, choices?: unknown) => controller.preflightBudgetFile(file(buffer), 'en', '', 'dot', 'true', choices, tenant),
    load: (buffer: Buffer, snapshot: unknown, choices?: unknown) =>
      controller.importBudgetFile(file(buffer), JSON.stringify(snapshot), 'en', '', 'dot', 'true', choices, tenant, {}),
  };
}

/**
 * The eight English lines (14-spend-items.csv lines 40, 44, 97, 2, 3; 15-capex-items.csv lines 3, 4
 * and 8): one sheet, a nature column, five OPEX lines with their suppliers, three CAPEX lines.
 */
function englishWorkbook(): Buffer {
  const { writeXlsx } = require('../../common/xlsx');
  const money = (value: number) => ({ kind: 'number' as const, value });
  return writeXlsx({
    language: 'en',
    sheets: [{
      name: 'Budget',
      header: 'plain',
      headers: ['Type', 'Product', 'Supplier', 'Company', 'Account', 'Currency', 'Cost pool', 'IT tower', 'Business domain', 'Priority', 'Recurrence', `Budget ${YEAR}`],
      rows: [
        ['OPEX', 'Cegid Retail POS', 'Cegid', 'Fromage & Co SA', '612200', 'EUR', 'Software', 'Application', 'Retail', null, 'Recurring', money(88000)],
        ['OPEX', 'Shops — 4G backup', 'Orange Business', 'Fromage & Co SA', '616100', 'EUR', 'Telecom', 'Network', 'Retail', null, 'Recurring', money(19000)],
        ['OPEX', 'Contractor · Level 2 till support', 'Fromatech Consulting', 'Fromage & Co SA', '621100', 'EUR', 'External labor', 'End user', 'Retail', null, 'One-off', money(126440)],
        ['OPEX', 'Microsoft Enterprise (M365 + Azure + GitHub)', 'Microsoft', 'Fromage & Co SA', '612100', 'EUR', 'Software', 'End user', 'Shared IT', null, 'Recurring', money(650000)],
        ['OPEX', 'SAP S/4HANA Maintenance', 'SAP', 'Fromage & Co SA', '612200', 'EUR', 'Software', 'Application', 'ERP', null, 'Recurring', money(280000)],
        ['CAPEX', 'Data Center Refresh — Paris DC', null, 'Fromage & Co SA', '218300', 'EUR', 'Hardware', 'Compute', 'Shared IT', 'Mandatory', 'One-off', money(250000)],
        ['CAPEX', 'D2C E-commerce Platform — La Boutique', null, 'Fromage & Co SA', '205000', 'EUR', 'External labor', 'Application', 'E-commerce', 'High', 'One-off', money(120000)],
        ['CAPEX', 'Shops — till replacement', null, 'Fromage & Co SA', '218300', 'EUR', 'Hardware', 'End user', 'Retail', 'High', 'One-off', money(140000)],
      ],
    }],
  });
}

/**
 * Kad's mapping of the English file: every column by its header; the sample data's own business
 * domain by `values`, as the model gives them once it reads the dimension's values in the template.
 */
const ENGLISH_MAPPING = [
  { column: 'nature', source: 1, confidence: 'high' },
  { column: 'name', source: 2, confidence: 'high' },
  { column: 'supplier_name', source: 3, confidence: 'high' },
  { column: 'company_name', source: 4, confidence: 'high' },
  { column: 'account_number', source: 5, confidence: 'high' },
  { column: 'currency', source: 6, confidence: 'high' },
  { column: 'analytics:default', source: 7, confidence: 'high' },
  { column: 'analytics:it_tower', source: 8, confidence: 'high' },
  { column: 'analytics:business_domain', source: 9, confidence: 'medium', values: { Retail: 'Magasins', 'Shared IT': 'IT partagée' } },
  { column: 'analytics:priority', source: 10, confidence: 'high' },
  { column: 'analytics:recurrence', source: 11, confidence: 'high' },
  { column: `budget_${YEAR}`, source: 12, confidence: 'high' },
];

function attachEnglish(h: Harness): string {
  const id = randomUUID();
  h.files.set(id, { name: 'fromage budget EN.xlsx', buffer: englishWorkbook() });
  return id;
}

async function referenceCounts(runner: QueryRunner, s: Seed): Promise<{ suppliers: number; values: number; lines: number }> {
  const [row] = await runner.query(
    `SELECT (SELECT count(*)::int FROM suppliers WHERE tenant_id = $1) AS suppliers,
            (SELECT count(*)::int FROM analytics_categories WHERE tenant_id = $1) AS values,
            (SELECT count(*)::int FROM spend_items WHERE tenant_id = $1 AND nature IN ('opex', 'capex')) AS lines`,
    [s.tenantId],
  );
  return row;
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

  const suppliers = await runner.query(`SELECT name FROM suppliers WHERE tenant_id = $1`, [s.tenantId]);
  assert.deepEqual(suppliers.map((row: any) => row.name).sort(), SUPPLIERS);
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
  // The model reads the code of the errors and their lines, as the card numbers them.
  assert.deepEqual(check.issues, [{
    level: 'error', code: 'CSV_REFERENCE_NOT_FOUND', column: 'supplier_name', count: 8, file_lines: [4, 5, 6, 7, 8, 9, 10, 11],
  }]);
  const cardLines = (check.report as { file: { errors: Array<{ line: number }> } }).file.errors.map((error) => error.line);
  assert.deepEqual(check.issues[0].file_lines, cardLines);
  const failed = await h.previews.executePreview(budget, card.preview_id);
  assert.equal(failed.status, 'failed');
  // In the person's language, as a check that found errors: never a refusal.
  assert.match(failed.error_message, /^La vérification de ce fichier a trouvé des erreurs : rien n'a été importé\./);
  assert.doesNotMatch(failed.error_message, /refus/i);
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

/** The card's matches: column, file value, existing value, origin. */
function matchesOf(check: any): string[] {
  return check.report.file.matching.matches.map((match: any) => `${match.column}|${match.value}→${match.target}|${match.origin}`).sort();
}

// Fried's case of 12/11 (P8): zero creation. The server matches the recommended dimensions across
// languages; the model's `values` match the sample data's own business domain; the suppliers and the
// company are the same names. Every match is on the card. Each row follows its own nature (a CAPEX
// row of the same file is a CAPEX line).
async function testEnglishSampleLinesCreateNothing(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s, 'admin');
  const before = await referenceCounts(runner, s);
  assert.equal(before.lines, 8, 'the workspace holds the eight lines, in French');
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attachEnglish(h), entity_type: 'budget_lines', columns: ENGLISH_MAPPING });
  const check = card.import_mapping.validation;
  const created = { suppliers: check.new_suppliers, values: check.report.file.creates.dimensionValues };
  console.log(`  the original case, what the check creates: ${JSON.stringify(created)}`);
  const template = await h.mapping.describeTemplate(admin, 'budget_lines', 'fr');
  const domain = template.columns.find((column: any) => column.column === 'analytics:business_domain');
  assert.deepEqual(domain.values, ['ERP', 'E-commerce', 'Magasins', 'IT partagée'], 'the model reads the dimension\'s enabled values');
  assert.equal(domain.title, 'Domaine métier');
  assert.equal(check.ok, true, JSON.stringify({ issues: check.issues, errors: check.report.file.errors }));
  assert.equal(check.inserted, 8);
  assert.equal(check.new_suppliers, 0, 'no supplier created');
  assert.deepEqual(check.report.file.creates.dimensionValues, [], 'no dimension value created');
  assert.deepEqual(matchesOf(check), [
    'analytics:business_domain|Retail→Magasins|model',
    'analytics:business_domain|Shared IT→IT partagée|model',
    'analytics:default|External labor→Main-d\'œuvre externe|server',
    'analytics:default|Hardware→Matériel|server',
    'analytics:default|Software→Logiciel|server',
    'analytics:default|Telecom→Télécoms|server',
    'analytics:it_tower|Compute→Calcul|server',
    'analytics:it_tower|End user→Poste de travail|server',
    'analytics:it_tower|Network→Réseau|server',
    'analytics:priority|High→Haute|server',
    'analytics:priority|Mandatory→Obligatoire|server',
    'analytics:recurrence|One-off→Ponctuel|server',
    'analytics:recurrence|Recurring→Récurrent|server',
  ]);
  // On the lines of the person's file (header on line 1), for the card and for the model.
  const retail = check.report.file.matching.matches.find((match: any) => match.value === 'Retail');
  assert.deepEqual(retail.lines, [2, 3, 4, 9]);
  assert.equal(retail.name, 'Domaine métier');
  assert.deepEqual(check.matching.matches.find((match: any) => match.value === 'Retail').file_lines, [2, 3, 4, 9]);
  assert.deepEqual(check.matching.create_suppliers, { allowed: true, value: true }, 'the box, ticked');
  assert.deepEqual(card.import_mapping.validation.matching.choices, []);

  const done = await h.previews.executePreview(admin, card.preview_id);
  assert.equal(done.status, 'executed', done.error_message ?? '');
  const after = await referenceCounts(runner, s);
  assert.deepEqual(after, { suppliers: before.suppliers, values: before.values, lines: 16 });
  const lines = await runner.query(
    `SELECT i.nature, i.product_name, c.name AS priority
       FROM spend_items i
       LEFT JOIN spend_item_analytics_values v ON v.tenant_id = i.tenant_id AND v.item_id = i.id
       LEFT JOIN analytics_axes ax ON ax.tenant_id = v.tenant_id AND ax.id = v.axis_id AND ax.code = 'priority'
       LEFT JOIN analytics_categories c ON c.tenant_id = v.tenant_id AND c.id = v.category_id AND ax.id IS NOT NULL
      WHERE i.tenant_id = $1 AND i.product_name = 'Data Center Refresh — Paris DC' AND c.id IS NOT NULL`,
    [s.tenantId],
  );
  assert.deepEqual(lines.map((line: any) => [line.nature, line.priority]), [['capex', 'Obligatoire']], 'a CAPEX row is a CAPEX line, with the existing value');
  console.log('  the original case: eight English lines, nothing created, every match listed: OK');
}

/** The cells of a column of a downloaded prepared file, by its template header. */
async function columnOf(content: Buffer, header: string): Promise<string[]> {
  const { readTableAttachment } = require('../attachments/table-attachment');
  const { sheetCellText } = require('../../common/csv-sheet/read');
  const grid = await readTableAttachment(content);
  const index = grid.header.findIndex((cell: any) => sheetCellText(cell) === header);
  assert.ok(index >= 0, `${header} in the prepared file`);
  return grid.rows.map((row: any[]) => (row[index] ? sheetCellText(row[index]) : ''));
}

// The person undoes a match on the card: a new card, its check run again, the old card no longer
// approves. The approval replays the choice (the value is created), and so does the prepared file.
// The model's next card of the same file keeps the choice and says so.
async function testUndoAMatch(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s, 'admin');
  const attachment = attachEnglish(h);
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attachment, entity_type: 'budget_lines', columns: ENGLISH_MAPPING });
  const undo = [{ kind: 'unmatch', column: 'analytics:priority', value: 'Mandatory' }, { kind: 'unmatch', column: 'analytics:business_domain', value: 'Retail' }];
  const next = await h.previews.replaceImportChoices(admin, card.preview_id, undo);
  assert.notEqual(next.preview_id, card.preview_id);
  assert.equal(next.status, 'pending');
  assert.equal(next.replaces_preview_id, card.preview_id, 'the new card stands in for the one the conversation shows');
  const check = next.import_mapping.validation;
  assert.deepEqual(check.matching.choices, undo);
  assert.deepEqual(check.report.file.creates.dimensionValues.map((entry: any) => [entry.dimension, entry.name, entry.names]), [
    ['business_domain', 'Domaine métier', ['Retail']],
    ['priority', 'Priorité', ['Mandatory']],
  ]);
  assert.ok(!matchesOf(check).some((match) => match.startsWith('analytics:priority|Mandatory')));
  const candidates = check.report.file.matching.candidates.find((entry: any) => entry.value === 'Mandatory');
  assert.equal(candidates.outcome, 'create');

  // The old card: replaced, it no longer approves.
  const old = await h.previews.executePreview(admin, card.preview_id);
  assert.equal(old.status, 'expired');
  // A choice on it is refused; and on another person's card.
  await assert.rejects(h.previews.replaceImportChoices(admin, card.preview_id, []), /can no longer be changed/);
  await assert.rejects(h.previews.replaceImportChoices(ctx(runner, s, 'budget'), next.preview_id, []), /not found/);

  // The prepared file follows the choices: matched values written, undone ones as the file writes them.
  const file = await h.mapping.preparedFile(admin, (await previewInput(runner, s, next.preview_id)), 'fr');
  assert.deepEqual(await columnOf(file.content, 'analytics:priority'), ['', '', '', '', '', 'Mandatory', 'Haute', 'Haute']);
  assert.deepEqual(await columnOf(file.content, 'analytics:business_domain'),
    ['Retail', 'Retail', 'Retail', 'IT partagée', 'ERP', 'IT partagée', 'E-commerce', 'Retail']);

  // The model calls again for the same file: the choices that still apply are kept, and it is told.
  const again = await h.previews.createPreview(admin, 'prepare_import_mapping', {
    attachment_id: attachment, entity_type: 'budget_lines', columns: ENGLISH_MAPPING, assumptions: ['Les montants sont en euros.'],
  });
  assert.deepEqual(again.import_mapping.validation.matching.choices, undo);
  assert.equal((await h.previews.executePreview(admin, next.preview_id)).status, 'expired', 'the model\'s new card replaced it');

  const before = await referenceCounts(runner, s);
  const done = await h.previews.executePreview(admin, again.preview_id);
  assert.equal(done.status, 'executed', done.error_message ?? '');
  assert.equal((await referenceCounts(runner, s)).values, before.values + 2, 'Mandatory and Retail created, as the person chose');
  // A choice on an approved card is refused.
  await assert.rejects(h.previews.replaceImportChoices(admin, again.preview_id, []), /can no longer be changed/);
  console.log('  a match undone: new card, old one closed, the approval and the prepared file follow it: OK');
}

async function previewInput(runner: QueryRunner, s: Seed, id: string): Promise<any> {
  const [row] = await runner.query(`SELECT mutation_input FROM ai_mutation_previews WHERE tenant_id = $1 AND id = $2`, [s.tenantId, id]);
  return row.mutation_input;
}

// The "Create missing suppliers" box: ticked when the card opens, unticked by a choice, then an
// unknown supplier is refused as in the dialog; a person who may not create suppliers has no box.
async function testSuppliersBox(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s, 'admin');
  const renamed = ENGLISH_MAPPING.map((column) => (column.column === 'supplier_name'
    ? { ...column, values: { Cegid: 'Cegid Retail Group' } }
    : column));
  // The model maps Cegid to a supplier that does not exist: refused, and said; Cegid is matched as written.
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attachEnglish(h), entity_type: 'budget_lines', columns: renamed });
  assert.deepEqual(card.import_mapping.validation.matching.refused_proposals.map((entry: any) => [entry.column, entry.value, entry.target, entry.reason, entry.file_lines]),
    [['supplier_name', 'Cegid', 'Cegid Retail Group', 'missing', [2]]]);

  const id = randomUUID();
  const { writeXlsx } = require('../../common/xlsx');
  h.files.set(id, {
    name: 'nouveau.xlsx',
    buffer: writeXlsx({ language: 'en', sheets: [{ name: 'B', header: 'plain', headers: ['Type', 'Name', 'Supplier', 'Account', 'Currency', 'Budget'], rows: [
      ['OPEX', 'Hébergement', 'Hébergeur Breton', '612200', 'EUR', { kind: 'number', value: 1000 }],
      ['OPEX', 'Sauvegarde', 'Hebergeur Breton', '612200', 'EUR', { kind: 'number', value: 500 }],
    ] }] }),
  });
  const columns = [
    { column: 'nature', source: 1, confidence: 'high' }, { column: 'name', source: 2, confidence: 'high' },
    { column: 'supplier_name', source: 3, confidence: 'high' }, { column: 'account_number', source: 4, confidence: 'high' },
    { column: 'currency', source: 5, confidence: 'high' }, { column: `budget_${YEAR}`, source: 6, confidence: 'high' },
  ];
  const ticked = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: id, entity_type: 'budget_lines', columns });
  assert.equal(ticked.import_mapping.validation.ok, true);
  assert.equal(ticked.import_mapping.validation.new_suppliers, 1, 'two spellings, one supplier');
  const unticked = await h.previews.replaceImportChoices(admin, ticked.preview_id, [{ kind: 'create_suppliers', value: false }]);
  const check = unticked.import_mapping.validation;
  assert.equal(check.ok, false);
  assert.equal(check.new_suppliers, 0);
  assert.deepEqual(check.matching.create_suppliers, { allowed: true, value: false });
  assert.deepEqual(check.issues.map((issue: any) => [issue.code, issue.column, issue.count]), [['CSV_REFERENCE_NOT_FOUND', 'supplier_name', 2]]);

  const budget = ctx(runner, s, 'budget');
  const noRight = await h.previews.createPreview(budget, 'prepare_import_mapping', { attachment_id: id, entity_type: 'budget_lines', columns });
  assert.deepEqual(noRight.import_mapping.validation.matching.create_suppliers, { allowed: false, value: false }, 'no box');
  assert.equal(noRight.import_mapping.validation.ok, false);
  console.log('  the suppliers box: ticked, unticked by a choice, absent without the right: OK');
}

// The screen's dialog shares the check: the same matches for the same file, and its routes take the
// choices in the form; the load replays the choices of the check (a match undone: the value created).
async function testScreenRoutes(h: Harness, runner: QueryRunner, s: Seed) {
  const file = Buffer.from([
    `item_number,nature,name,company_name,account_number,supplier_name,currency,analytics:default,analytics:priority,budget_${YEAR}`,
    ',capex,Serveurs,Fromage & Co SA,218300,,EUR,Hardware,Mandatory,1000',
    ',opex,Support,Fromage & Co SA,621100,Fromatech Consultíng,EUR,External labor,,2000',
  ].join('\n'));
  const screen = screenCaller(h, runner, s, 'admin');
  const checked = await screen.preflight(file);
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.deepEqual(checked.matching.matches.map((match: any) => `${match.column}|${match.value}→${match.target}|${match.origin}|${match.reason}`), [
    'analytics:default|Hardware→Matériel|server|translation',
    'analytics:priority|Mandatory→Obligatoire|server|translation',
    'supplier_name|Fromatech Consultíng→Fromatech Consulting|server|accents',
    'analytics:default|External labor→Main-d\'œuvre externe|server|translation',
  ]);
  const choices = JSON.stringify([{ kind: 'unmatch', column: 'analytics:priority', value: 'Mandatory' }]);
  const undone = await screen.preflight(file, choices);
  assert.deepEqual(undone.creates.dimensionValues, [{ dimension: 'priority', name: 'Priorité', names: ['Mandatory'] }]);
  const before = await referenceCounts(runner, s);
  const loaded = await screen.load(file, undone.snapshot, choices);
  assert.equal(loaded.ok, true, JSON.stringify(loaded));
  assert.equal((await referenceCounts(runner, s)).values, before.values + 1, 'the load replays the choice: Mandatory created');
  await assert.rejects(async () => screen.preflight(file, '[{"kind":"drop"}]'), /choices are not valid/);
  console.log('  the screen\'s routes: the same matches, the choices replayed by the load: OK');
}

// The choice route: the AI surface's checks first (the frozen workspace is refused there), then the
// card of the person and of the conversation.
async function testChoiceRoute(h: Harness, runner: QueryRunner, s: Seed) {
  const { AiImportFileController } = require('../import/ai-import-file.controller');
  const { AiPolicyService } = require('../ai-policy.service');
  const controller = h.app.get(AiImportFileController);
  const policy = h.app.get(AiPolicyService);
  const admin = ctx(runner, s, 'admin');
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attachEnglish(h), entity_type: 'budget_lines', columns: ENGLISH_MAPPING });
  const req = { user: { sub: s.users.admin }, headers: {} };
  const tenant = { manager: runner.manager, tenantId: s.tenantId };
  const surface = policy.assertSurfaceAccess;
  policy.assertSurfaceAccess = async () => { throw new Error('AI features are turned off: the subscription is frozen.'); };
  try {
    await assert.rejects(controller.choose(s.conversations.admin, card.preview_id, { choices: [] }, req, tenant), /frozen/);
  } finally {
    policy.assertSurfaceAccess = surface;
  }
  await assert.rejects(controller.choose(s.conversations.budget, card.preview_id, { choices: [] }, req, tenant), /not found/);
  await assert.rejects(controller.choose(s.conversations.admin, card.preview_id, { choices: [{ kind: 'unmatch', column: 'name', value: 'x' }] }, req, tenant), /not valid/);
  const next = await controller.choose(s.conversations.admin, card.preview_id, { choices: [{ kind: 'create_suppliers', value: false }] }, req, tenant);
  assert.equal(next.replaces_preview_id, card.preview_id);
  const listed = await h.previews.listConversationPreviews(admin, s.conversations.admin);
  assert.equal(listed.find((preview: any) => preview.preview_id === next.preview_id).replaces_preview_id, card.preview_id, 'kept on the list');
  console.log('  the choice route: frozen workspace, another conversation, bad choices refused: OK');
}

async function inFrenchTenant(harness: Harness, test: (h: Harness, runner: QueryRunner, s: Seed) => Promise<void>) {
  const runner = harness.dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await test(harness, runner, await seedFrench(harness, runner));
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
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
    await inFrenchTenant(harness, testEnglishSampleLinesCreateNothing);
    if (process.env.I1_ORIGINAL_CASE_ONLY) return;
    await inFrenchTenant(harness, testUndoAMatch);
    await inFrenchTenant(harness, testSuppliersBox);
    await inFrenchTenant(harness, testScreenRoutes);
    await inFrenchTenant(harness, testChoiceRoute);
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
