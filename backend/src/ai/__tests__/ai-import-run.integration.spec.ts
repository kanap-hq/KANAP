import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { seedManagedDocsKnowledgeAssets } from '../../knowledge/integrated-document-seed';

// Lot I3 of the Plaid import: the card of a column mapping carries the import's check of the file
// it builds (its dry run), and approving it runs the import, through the screens' own import
// services, in the person's transaction.
// - Applications, from a messy file (a title row, a blank row, French words): the check reports an
//   unread value on the line of the person's file, and the card cannot be approved; corrected, the
//   import creates the applications, and the audit log records an import made through Plaid.
// - Incidents: a contributor imports, as the incident import route allows; a reader is refused at
//   the card, and at the approval when their level dropped in between.
// - The budget file: a missing account fails the check; with the account, the lines are created.
// - Suppliers, an import of the master data family.
// - Every import's check runs on a file of its template's required columns, and writes nothing.
// - The file prepared for an import, downloaded from its card by the person who has it, and no one else.
// The AI surface checks and the attachment storage are not under test: stubbed.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-import-run-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; previews: any; mapping: any; files: Map<string, { name: string; buffer: Buffer }> };
type UserKey = 'admin' | 'contributor' | 'reader';
type Seed = { tenantId: string; users: Record<UserKey, string>; roles: Record<UserKey, string>; conversations: Record<UserKey, string> };

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-import-run.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiMutationPreviewService } = require('../ai-mutation-preview.service');
  const { AiPolicyService } = require('../ai-policy.service');
  const { AiAttachmentService } = require('../ai-attachment.service');
  const { AiImportMappingService } = require('../import/ai-import-mapping.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  // The spreadsheets the person attached, by attachment id: the storage is not under test.
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
    mapping: app.get(AiImportMappingService),
    files,
  };
}

function attach(h: Harness, name: string, text: string): string {
  const id = randomUUID();
  h.files.set(id, { name, buffer: Buffer.from(text, 'utf8') });
  return id;
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `ai-i3-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  // An incident's review is its managed document: the tenant needs its slots, as every tenant has.
  await seedManagedDocsKnowledgeAssets(runner.manager as any, tenantId);
  const role = async (name: string, permissions: Record<string, string>) => {
    const id = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, $2, $2)`, [tenantId, name]);
    for (const [resource, level] of Object.entries(permissions)) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, id, resource, level]);
    }
    return id;
  };
  const roles: Record<UserKey, string> = {
    admin: await role('Administrator', {}),
    contributor: await role('Incident Contributor', { ai_chat: 'member', incidents: 'contributor' }),
    reader: await role('Incident Reader', { ai_chat: 'member', incidents: 'reader' }),
  };
  const users = {} as Record<UserKey, string>;
  const conversations = {} as Record<UserKey, string>;
  for (const key of Object.keys(roles) as UserKey[]) {
    users[key] = await insertId(runner,
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, locale) VALUES ($1, $2, $3, 'Tester', $4, 'enabled', 'en')`,
      [tenantId, `${key}-${slug}@example.test`, key, roles[key]]);
    conversations[key] = randomUUID();
    await runner.query(
      `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
       VALUES ($1, $2, $3, 'AI import run integration', 'custom', 'import-model', 'custom', now(), now())`,
      [conversations[key], tenantId, users[key]],
    );
  }
  return { tenantId, users, roles, conversations };
}

function ctx(runner: QueryRunner, s: Seed, user: UserKey) {
  return {
    tenantId: s.tenantId, userId: s.users[user], isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const,
    manager: runner.manager, conversationId: s.conversations[user],
  };
}

async function refusal(fn: () => Promise<unknown>): Promise<string> {
  const error = await fn().then(() => null, (caught: any) => caught);
  assert.ok(error, 'refused');
  return String(error?.response?.message ?? error.message);
}

async function importRows(runner: QueryRunner, s: Seed) {
  return runner.query(
    `SELECT action, source, source_ref, user_id, after_json FROM audit_log WHERE tenant_id = $1 AND table_name = 'import' ORDER BY created_at, id`,
    [s.tenantId],
  );
}

async function testApplications(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s, 'admin');
  // A title row above the header, a blank row: the person's lines 3, 5 and 6 are the data rows.
  const file = attach(h, 'Inventaire applicatif.csv', [
    'Inventaire applicatif 2026;;;',
    'Appli;Etat;Mise en service;Criticité',
    'CheeseTrack;Actif;03/04/2024;Critique',
    ';;;',
    'CaveGuard;Prévu;15/11/2025;Faible',
    'Affineur;En prod;30/06/2019;Faible',
  ].join('\n'));
  const columns = [
    { column: 'name', source: 1, confidence: 'high' },
    { column: 'lifecycle', source: 2, confidence: 'medium', values: { Actif: 'Active', 'Prévu': 'Proposed' } },
    { column: 'go_live_date', source: 3, confidence: 'high', date_order: 'day-first' },
    { column: 'criticality', source: 4, confidence: 'medium', values: { Critique: 'Critical', Faible: 'Low' } },
  ];
  const first = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: file, entity_type: 'applications', columns });
  const check = first.import_mapping.validation;
  // "En prod" stands for nothing the mapping knows: the import refuses it, on line 6 of the person's file.
  assert.equal(check.dry_run, true);
  assert.equal(check.ok, false, JSON.stringify(check));
  assert.equal(check.total, 3);
  const unread = check.report.errors.find((error: any) => error.column === 'lifecycle');
  assert.ok(unread, JSON.stringify(check.report));
  assert.equal(unread.row, 6);
  assert.ok(check.issues.some((issue: any) => issue.level === 'error' && issue.column === 'lifecycle'));
  // The card cannot be approved: the server refuses it, and nothing is written.
  const refused = await h.previews.executePreview(admin, first.preview_id);
  assert.equal(refused.status, 'failed');
  assert.match(refused.error_message, /The import refused this file/);

  // The person says what "En prod" stands for: the check passes, and the approval imports.
  const corrected = columns.map((column) => (column.column === 'lifecycle'
    ? { ...column, values: { ...column.values, 'En prod': 'Active' } }
    : column));
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: file, entity_type: 'applications', columns: corrected });
  assert.equal(card.import_mapping.validation.ok, true, JSON.stringify(card.import_mapping.validation));
  assert.equal(card.import_mapping.validation.inserted, 3);
  const [before] = await runner.query(`SELECT count(*)::int AS n FROM applications WHERE tenant_id = $1`, [s.tenantId]);
  assert.equal(before.n, 0, 'the check writes nothing');
  const done = await h.previews.executePreview(admin, card.preview_id);
  assert.equal(done.status, 'executed', done.error_message ?? '');
  assert.equal(done.summary, '"Inventaire applicatif.csv" imported into the Applications list. Created: 3.');
  assert.equal(done.import_mapping.result.inserted, 3);
  const apps = await runner.query(
    `SELECT name, lifecycle, go_live_date::text AS go_live, criticality FROM applications WHERE tenant_id = $1 ORDER BY name`,
    [s.tenantId],
  );
  assert.deepEqual(apps.map((app: any) => [app.name, app.lifecycle, app.go_live, app.criticality]), [
    ['Affineur', 'active', '2019-06-30', 'low'],
    ['CaveGuard', 'proposed', '2025-11-15', 'low'],
    ['CheeseTrack', 'active', '2024-04-03', 'business_critical'],
  ]);
  const audit = await importRows(runner, s);
  assert.equal(audit.length, 1);
  assert.deepEqual(
    { ...audit[0], after_json: audit[0].after_json },
    {
      action: 'import', source: 'ai_chat', source_ref: card.preview_id, user_id: s.users.admin,
      after_json: { list: 'applications', filename: 'Inventaire applicatif.csv', rows: 3, inserted: 3, updated: 0, unchanged: 0 },
    },
  );

  // The same file attached again: the import matches the applications by name and creates none.
  const same = attach(h, 'Inventaire applicatif.csv', h.files.get(file)!.buffer.toString('utf8'));
  const again = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: same, entity_type: 'applications', columns: corrected });
  const repeat = await h.previews.executePreview(admin, again.preview_id);
  assert.equal(repeat.status, 'executed', repeat.error_message ?? '');
  assert.equal(repeat.import_mapping.result.inserted, 0);
  assert.equal(repeat.import_mapping.result.inserted + repeat.import_mapping.result.updated + repeat.import_mapping.result.unchanged, 3);
  console.log('  applications: checked on the person\'s lines, refused, corrected, imported, audited: OK');
}

// The file prepared for an import, downloaded from its card: the import's format, rebuilt from the
// attachment with the card's mapping. The card is the person's: someone else's download is refused.
async function testPreparedFile(h: Harness, runner: QueryRunner, s: Seed) {
  const { AiImportFileController } = require('../import/ai-import-file.controller');
  const { XLSX_CONTENT_TYPE } = require('../../common/xlsx/write');
  const { readTableAttachment } = require('../attachments/table-attachment');
  const controller = h.app.get(AiImportFileController);
  const admin = ctx(runner, s, 'admin');
  const file = attach(h, 'Parc applicatif.csv', ['Appli;Mise en service', 'Fromagerie Web;01/02/2023'].join('\n'));
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', {
    attachment_id: file,
    entity_type: 'applications',
    columns: [
      { column: 'name', source: 1, confidence: 'high' },
      { column: 'go_live_date', source: 2, confidence: 'high', date_order: 'day-first' },
    ],
  });
  const download = async (user: UserKey) => {
    const sent: { headers: Record<string, string>; body: Buffer | null } = { headers: {}, body: null };
    const res = {
      setHeader: (name: string, value: string) => { sent.headers[name] = value; },
      end: (body: Buffer) => { sent.body = body; },
    };
    await controller.download(s.conversations.admin, card.preview_id, { user: { sub: s.users[user] } }, { tenantId: s.tenantId, manager: runner.manager }, res);
    return sent;
  };
  const sent = await download('admin');
  assert.equal(sent.headers['Content-Type'], XLSX_CONTENT_TYPE);
  assert.match(decodeURIComponent(sent.headers['Content-Disposition']), /Parc applicatif-import\.xlsx/);
  const built = await readTableAttachment(sent.body!);
  const row = Object.fromEntries(built.header.map((cell: any, at: number) => [cell.value, built.rows[0][at]]));
  assert.deepEqual(row, { name: { kind: 'text', value: 'Fromagerie Web' }, go_live_date: { kind: 'date', iso: '2023-02-01' } });
  assert.equal(built.rows.length, 1);
  // Another person of the workspace: the card is not theirs.
  assert.match(await refusal(() => download('contributor')), /AI preview not found/);
  console.log('  prepared file: OK');
}

async function testIncidentRights(h: Harness, runner: QueryRunner, s: Seed) {
  const template = await h.mapping.describeTemplate(ctx(runner, s, 'contributor'), 'incidents', 'en');
  const required = template.columns.filter((column: any) => column.required).map((column: any) => column.column);
  assert.deepEqual(required, ['title', 'severity'], 'an incident needs a title and a severity');
  const file = attach(h, 'incidents.csv', 'Titre,Gravité\nCellar door open,major\nFridge alarm,low\n');
  const input = {
    attachment_id: file,
    entity_type: 'incidents',
    columns: [{ column: 'title', source: 1, confidence: 'high' }, { column: 'severity', source: 2, confidence: 'high' }],
  };
  // A contributor imports incidents, as the incident import route allows.
  const contributor = ctx(runner, s, 'contributor');
  const card = await h.previews.createPreview(contributor, 'prepare_import_mapping', input);
  assert.equal(card.import_mapping.validation.ok, true, JSON.stringify(card.import_mapping.validation));
  const done = await h.previews.executePreview(contributor, card.preview_id);
  assert.equal(done.status, 'executed', done.error_message ?? '');
  const incidents = await runner.query(`SELECT title FROM incidents WHERE tenant_id = $1 ORDER BY title`, [s.tenantId]);
  assert.deepEqual(incidents.map((row: any) => row.title), ['Cellar door open', 'Fridge alarm']);

  // A reader is refused the card.
  const reader = ctx(runner, s, 'reader');
  assert.match(await refusal(() => h.previews.createPreview(reader, 'prepare_import_mapping', input)), /right to contribute to incidents/);
  // A contributor whose level drops to reader before approving: refused, nothing written.
  const other = attach(h, 'more incidents.csv', 'Titre,Gravité\nPower cut,minor\n');
  const pending = await h.previews.createPreview(contributor, 'prepare_import_mapping', { ...input, attachment_id: other });
  assert.equal(pending.import_mapping.validation.ok, true, JSON.stringify(pending.import_mapping.validation));
  await runner.query(`UPDATE role_permissions SET level = 'reader' WHERE tenant_id = $1 AND role_id = $2 AND resource = 'incidents'`, [s.tenantId, s.roles.contributor]);
  assert.match(await refusal(() => h.previews.executePreview(contributor, pending.preview_id)), /right to contribute to incidents/);
  await runner.query(`UPDATE role_permissions SET level = 'contributor' WHERE tenant_id = $1 AND role_id = $2 AND resource = 'incidents'`, [s.tenantId, s.roles.contributor]);
  const [count] = await runner.query(`SELECT count(*)::int AS n FROM incidents WHERE tenant_id = $1`, [s.tenantId]);
  assert.equal(count.n, 2);
  console.log('  incidents: a contributor imports, a reader is refused: OK');
}

async function testBudgetFile(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s, 'admin');
  const chart = await insertId(runner, `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'PCG', 'Plan comptable', 'FR')`, [s.tenantId]);
  await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, 'Fromagerie', 'FR', 'Lyon', $2)`, [s.tenantId, chart]);
  await runner.query(`INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, 6000, 'Achats')`, [s.tenantId, chart]);
  const year = new Date().getFullYear();
  const budget = `budget_${year}`;
  const columns = [
    { column: 'nature', source: 1, confidence: 'high', values: { Fonctionnement: 'opex', Investissement: 'capex' } },
    { column: 'name', source: 2, confidence: 'high' },
    { column: 'company_name', source: 3, confidence: 'high' },
    { column: 'account_number', source: 4, confidence: 'high' },
    { column: 'currency', value: 'EUR', confidence: 'high' },
    { column: budget, source: 5, confidence: 'high', decimal_mark: ',' },
  ];
  const header = `Nature;Libellé;Société;Compte;Budget ${year}`;
  // An account the chart does not hold: the check names it missing, and the card cannot be approved.
  const missing = attach(h, 'budget.csv', [header, 'Fonctionnement;Licences;Fromagerie;7000;1 200,50'].join('\n'));
  const refused = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: missing, entity_type: 'budget_lines', columns });
  const check = refused.import_mapping.validation;
  assert.equal(check.ok, false, JSON.stringify(check));
  assert.equal(check.report.kind, 'budget_file');
  assert.ok(check.issues.some((issue: any) => issue.level === 'error'), JSON.stringify(check.issues));
  assert.equal(check.report.file.snapshot, undefined, 'the snapshot stays on the server');

  const clean = attach(h, 'budget corrigé.csv', [
    header,
    'Fonctionnement;Licences;Fromagerie;6000;1 200,50',
    'Investissement;Serveurs;Fromagerie;6000;8 000,00',
  ].join('\n'));
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: clean, entity_type: 'budget_lines', columns });
  assert.equal(card.import_mapping.validation.ok, true, JSON.stringify(card.import_mapping.validation));
  assert.equal(card.import_mapping.validation.inserted, 2);
  const done = await h.previews.executePreview(admin, card.preview_id);
  assert.equal(done.status, 'executed', done.error_message ?? '');
  assert.equal(done.import_mapping.result.inserted, 2);
  const lines = await runner.query(`SELECT nature, product_name FROM spend_items WHERE tenant_id = $1 ORDER BY product_name`, [s.tenantId]);
  assert.deepEqual(lines.map((line: any) => [line.nature, line.product_name]), [['opex', 'Licences'], ['capex', 'Serveurs']]);
  const [amount] = await runner.query(
    `SELECT COALESCE(sum(a.planned), 0)::text AS total
       FROM spend_amounts a JOIN spend_versions v ON v.tenant_id = a.tenant_id AND v.id = a.version_id
       JOIN spend_items i ON i.tenant_id = v.tenant_id AND i.id = v.spend_item_id
      WHERE a.tenant_id = $1 AND i.product_name = 'Licences'`,
    [s.tenantId],
  );
  assert.equal(Number(amount.total), 1200.5);
  console.log('  budget file: a missing account refused, the lines created: OK');
}

async function testSuppliers(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s, 'admin');
  const columns = [{ column: 'name', source: 1, confidence: 'high' }, { column: 'erp_supplier_id', source: 2, confidence: 'high' }];
  const file = attach(h, 'fournisseurs.csv', 'Fournisseur;Identifiant ERP\nLactalis;F-001\nSavencia;F-002\n');
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: file, entity_type: 'suppliers', columns });
  assert.equal(card.import_mapping.validation.ok, true, JSON.stringify(card.import_mapping.validation));
  const done = await h.previews.executePreview(admin, card.preview_id);
  assert.equal(done.status, 'executed', done.error_message ?? '');
  const suppliers = await runner.query(`SELECT name, erp_supplier_id FROM suppliers WHERE tenant_id = $1 ORDER BY name`, [s.tenantId]);
  assert.deepEqual(suppliers.map((row: any) => [row.name, row.erp_supplier_id]), [['Lactalis', 'F-001'], ['Savencia', 'F-002']]);

  // The supplier import replaces every value of a supplier it updates: a file without the notes
  // column would clear the notes of Lactalis. Refused, at the card and at the approval.
  await runner.query(`UPDATE suppliers SET notes = 'Contrat cadre 2026' WHERE tenant_id = $1 AND name = 'Lactalis'`, [s.tenantId]);
  const update = attach(h, 'fournisseurs v2.csv', 'Fournisseur;Identifiant ERP\nLactalis;F-101\nFromagerie Alpine;F-003\n');
  const refused = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: update, entity_type: 'suppliers', columns });
  const check = refused.import_mapping.validation;
  assert.equal(check.ok, false);
  assert.equal(check.report.errors[0].code, 'AI_IMPORT_CLEARS_COLUMNS');
  assert.equal(check.report.errors[0].params.count, 1);
  assert.match(check.report.errors[0].params.columns, /Notes/);
  assert.deepEqual(check.issues[0], { level: 'error', code: 'AI_IMPORT_CLEARS_COLUMNS', column: null, count: 1 });
  assert.equal((await h.previews.executePreview(admin, refused.preview_id)).status, 'failed');
  const [notes] = await runner.query(`SELECT notes, erp_supplier_id FROM suppliers WHERE tenant_id = $1 AND name = 'Lactalis'`, [s.tenantId]);
  assert.deepEqual(notes, { notes: 'Contrat cadre 2026', erp_supplier_id: 'F-001' });
  // New suppliers only: imported.
  const fresh = attach(h, 'nouveaux fournisseurs.csv', 'Fournisseur;Identifiant ERP\nFromagerie Alpine;F-003\n');
  const added = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: fresh, entity_type: 'suppliers', columns });
  assert.equal((await h.previews.executePreview(admin, added.preview_id)).status, 'executed');
  const [count] = await runner.query(`SELECT count(*)::int AS n FROM suppliers WHERE tenant_id = $1`, [s.tenantId]);
  assert.equal(count.n, 3);
  console.log('  suppliers: imported; an update that would clear a column refused: OK');
}

async function testEveryImportChecks(h: Harness, runner: QueryRunner, s: Seed) {
  const { AI_IMPORT_KEYS } = require('../import/ai-import-access');
  const admin = ctx(runner, s, 'admin');
  const [before] = await runner.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1`, [s.tenantId]);
  for (const key of AI_IMPORT_KEYS as string[]) {
    const template = await h.mapping.describeTemplate(admin, key, 'en');
    const required = template.columns.filter((column: any) => column.required).map((column: any) => column.column);
    const columns = required.length > 0 ? required : [template.columns[0].column];
    const file = attach(h, `${key}.csv`, `${columns.map((_: string, index: number) => `Colonne ${index + 1}`).join(';')}\n${columns.map(() => 'Plaid check').join(';')}\n`);
    const card = await h.previews.createPreview(admin, 'prepare_import_mapping', {
      attachment_id: file,
      entity_type: key,
      columns: columns.map((column: string, index: number) => ({ column, source: index + 1, confidence: 'low' })),
    });
    const check = card.import_mapping.validation;
    assert.ok(check, `${key}: checked`);
    assert.equal(check.dry_run, true, key);
    assert.equal(typeof check.ok, 'boolean', key);
    assert.equal(check.report.kind, key === 'budget_lines' ? 'budget_file' : 'rows', key);
    // Every import reads the file Plaid builds: an import that needs every column of its template gets them.
    assert.ok(!check.issues.some((issue: any) => /HEADER/.test(String(issue.code))), `${key}: ${JSON.stringify(check.issues)}`);
    for (const error of check.report.kind === 'rows' ? check.report.errors : []) {
      assert.ok(error.row === 0 || error.row === 2, `${key}: an error on the person's line 2 or on the file: ${JSON.stringify(error)}`);
    }
  }
  const [after] = await runner.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1`, [s.tenantId]);
  assert.equal(after.n, before.n, 'the checks write nothing');
  console.log(`  ${AI_IMPORT_KEYS.length} imports: checked, nothing written: OK`);
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      await testEveryImportChecks(harness, runner, s);
      await testApplications(harness, runner, s);
      await testPreparedFile(harness, runner, s);
      await testIncidentRights(harness, runner, s);
      await testBudgetFile(harness, runner, s);
      await testSuppliers(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('ai-import-run.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
