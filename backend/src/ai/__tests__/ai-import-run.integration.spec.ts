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

/** A card with nothing to import: its approval alone is refused, the card stays pending, in the person's language. */
async function assertNothingRefused(h: Harness, context: any, previewId: string) {
  const { PREVIEW_IMPORT_NOTHING_MESSAGE, previewErrorText } = require('../ai-write-texts');
  const refused = await h.previews.executePreview(context, previewId);
  assert.equal(refused.status, 'pending', JSON.stringify(refused));
  assert.equal(refused.error_message, PREVIEW_IMPORT_NOTHING_MESSAGE);
  assert.match(refused.error_message, /^Nothing to import:/);
  assert.match(previewErrorText('fr', PREVIEW_IMPORT_NOTHING_MESSAGE), /^Rien à importer/);
  // "Approve all" of this card alone: refused the same way, never run.
  const { results } = await h.previews.executePreviewsWithFollowUps(context, [previewId]);
  assert.deepEqual(results.map((preview: any) => [preview.status, preview.error_message]), [['pending', PREVIEW_IMPORT_NOTHING_MESSAGE]]);
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
  // A check that found errors, said as such: not a refusal of the person or of their rights.
  assert.match(refused.error_message, /^The check of this file found errors, so nothing was imported\./);

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

  // The facts of the approval, for every import (lot I2 of 26.11.9): counts only.
  assert.equal(card.import_mapping.on_approval, 'On approval: 3 records created, 0 updated, 0 unchanged.');

  // The same file attached again: every application is stored as the file says. Nothing to import
  // (P5 of 26.11.9): the card says so, and its approval alone is refused and leaves it pending.
  const same = attach(h, 'Inventaire applicatif.csv', h.files.get(file)!.buffer.toString('utf8'));
  const again = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: same, entity_type: 'applications', columns: corrected });
  const nothing = again.import_mapping.validation;
  assert.equal(nothing.ok, true, JSON.stringify(nothing));
  assert.deepEqual([nothing.inserted, nothing.updated, nothing.unchanged], [0, 0, 3]);
  assert.equal(nothing.nothing_to_import, true);
  assert.equal(again.import_mapping.on_approval,
    'Nothing to import: the approval would create and update nothing (3 records unchanged). The card cannot be approved.');
  await assertNothingRefused(h, admin, again.preview_id);
  assert.equal((await importRows(runner, s)).length, 1, 'nothing imported');
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

  // A row that looks like a stored line and that the person chose to update with it: its `-` clears the
  // stored description (lot I6 of 26.11.9); the card counts the value cleared and its approval sentence says it.
  await runner.query(`UPDATE spend_items SET description = 'Contrat annuel' WHERE tenant_id = $1`, [s.tenantId]);
  const dash = attach(h, 'budget effacement.csv', ['Nature;Libellé;Société;Compte;Description', 'Fonctionnement;Licences;Fromagerie;6000;-'].join('\n'));
  const clearColumns = [...columns.slice(0, 4), { column: 'currency', value: 'EUR', confidence: 'high' }, { column: 'description', source: 5, confidence: 'high' }];
  const looking = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: dash, entity_type: 'budget_lines', columns: clearColumns });
  const target = looking.import_mapping.validation.report.file.lookalikes.lines.find((entry: any) => entry.line === 2)?.target;
  assert.ok(target, JSON.stringify(looking.import_mapping.validation.report.file.lookalikes));
  const clearing = await h.previews.replaceImportChoices(admin, looking.preview_id, [{ kind: 'lookalike', line: 2, action: 'update', item: target.item, state: target.state }]);
  const clears = clearing.import_mapping.validation;
  assert.equal(clears.ok, true, JSON.stringify(clears.issues));
  assert.deepEqual([clears.inserted, clears.updated, clears.cleared], [0, 1, 1]);
  assert.match(clearing.import_mapping.on_approval, /; 1 stored value cleared \(cells holding "-"\)/);
  const clearedDone = await h.previews.executePreview(admin, clearing.preview_id);
  assert.equal(clearedDone.status, 'executed', clearedDone.error_message ?? '');
  assert.equal(clearedDone.import_mapping.result.cleared, 1);
  const described = await runner.query(`SELECT product_name, description FROM spend_items WHERE tenant_id = $1 ORDER BY product_name`, [s.tenantId]);
  assert.deepEqual(described.map((line: any) => [line.product_name, line.description]), [['Licences', null], ['Serveurs', 'Contrat annuel']]);

  // `-` in a day column of the person's file (« Fin de validité »), mapped by the model: read as the
  // clearing mark, as the screen's budget file reads it (lot I6 of 26.11.9, pass F).
  await runner.query(`UPDATE spend_items SET disabled_at = '2030-12-31T12:00:00Z' WHERE tenant_id = $1 AND product_name = 'Licences'`, [s.tenantId]);
  const endDash = attach(h, 'budget fin.csv', ['Nature;Libellé;Société;Compte;Fin de validité', 'Fonctionnement;Licences;Fromagerie;6000;-'].join('\n'));
  const endColumns = [...columns.slice(0, 4), { column: 'currency', value: 'EUR', confidence: 'high' }, { column: 'end_of_validity', source: 5, confidence: 'high' }];
  const endCard = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: endDash, entity_type: 'budget_lines', columns: endColumns });
  const endRead = endCard.import_mapping.columns.find((column: any) => column.column === 'end_of_validity');
  assert.deepEqual([endRead?.filled, endRead?.unread], [1, 0], `the dash is read: ${JSON.stringify(endRead)}`);
  const endTarget = endCard.import_mapping.validation.report.file.lookalikes.lines.find((entry: any) => entry.line === 2)?.target;
  assert.ok(endTarget, JSON.stringify(endCard.import_mapping.validation.report.file.lookalikes));
  const endClearing = await h.previews.replaceImportChoices(admin, endCard.preview_id, [{ kind: 'lookalike', line: 2, action: 'update', item: endTarget.item, state: endTarget.state }]);
  const endClears = endClearing.import_mapping.validation;
  assert.equal(endClears.ok, true, JSON.stringify(endClears.issues));
  assert.deepEqual([endClears.updated, endClears.cleared], [1, 1]);
  assert.match(endClearing.import_mapping.on_approval, /; 1 stored value cleared \(cells holding "-"\)/);
  const endDone = await h.previews.executePreview(admin, endClearing.preview_id);
  assert.equal(endDone.status, 'executed', endDone.error_message ?? '');
  assert.equal(endDone.import_mapping.result.cleared, 1);
  const [ended] = await runner.query(`SELECT disabled_at FROM spend_items WHERE tenant_id = $1 AND product_name = 'Licences'`, [s.tenantId]);
  assert.equal(ended.disabled_at, null);
  console.log('  budget file: a missing account refused, the lines created, `-` clears and the card says it: OK');
}

/**
 * The six imports of the shared import follow the clearing rule through Kad (lot I6 of 26.11.9), here
 * the applications: a column named like a template column is read unmapped, its `-` clears the stored
 * value, a blank cell keeps it; the card counts the value cleared and its approval sentence says it.
 */
async function testApplicationsClear(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s, 'admin');
  await runner.query(
    `INSERT INTO applications (tenant_id, name, description) VALUES ($1, 'Effacement I6', 'Ancienne description'), ($1, 'Garde I6', 'Gardée')`,
    [s.tenantId],
  );
  const file = attach(h, 'applications effacement.csv', 'Nom;Description\nEffacement I6;-\nGarde I6;\n');
  const columns = [{ column: 'name', source: 1, confidence: 'high' }];
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: file, entity_type: 'applications', columns });
  const read = card.import_mapping.columns.find((column: any) => column.column === 'description');
  assert.deepEqual(read?.source, { position: 2, header: 'Description' }, 'the column the screen reads is read');
  const check = card.import_mapping.validation;
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.deepEqual([check.updated, check.unchanged, check.cleared], [1, 1, 1]);
  const [effacement] = await runner.query(`SELECT sequential_id FROM applications WHERE tenant_id = $1 AND name = 'Effacement I6'`, [s.tenantId]);
  assert.equal(card.import_mapping.on_approval,
    `On approval: 0 records created, 1 updated (file line 2: ${effacement.sequential_id} Effacement I6), 1 unchanged; 1 stored value cleared (cells holding "-").`);
  const done = await h.previews.executePreview(admin, card.preview_id);
  assert.equal(done.status, 'executed', done.error_message ?? '');
  assert.equal(done.import_mapping.result.cleared, 1);
  const rows = await runner.query(`SELECT name, description FROM applications WHERE tenant_id = $1 AND name LIKE '% I6' ORDER BY name`, [s.tenantId]);
  assert.deepEqual(rows.map((row: any) => [row.name, row.description]), [['Effacement I6', null], ['Garde I6', 'Gardée']]);
  console.log('  applications: a named column read, `-` clears, a blank cell keeps, the card says it: OK');
}

/**
 * The file a card builds, checked by the screen's import route: the same counts as the card's check
 * (lot I4 of 26.11.9, the clearing rule of every import route).
 */
async function assertSameAsTheRoute(h: Harness, runner: QueryRunner, s: Seed, input: any, check: any) {
  const { SuppliersController } = require('../../suppliers/suppliers.controller');
  const prepared = await h.mapping.preparedFile(ctx(runner, s, 'admin'), input, 'en');
  const file = { buffer: prepared.content, originalname: 'suppliers.xlsx', size: prepared.content.length } as Express.Multer.File;
  const route = await h.app.get(SuppliersController).import(file, 'true', 'en', undefined, undefined, {
    queryRunner: { manager: runner.manager }, tenant: { id: s.tenantId }, user: { sub: s.users.admin },
  });
  assert.deepEqual(
    [route.ok, route.inserted, route.updated, route.unchanged ?? 0, route.cleared ?? 0],
    [check.ok, check.inserted, check.updated, check.unchanged, check.cleared],
    'the route counts as the card',
  );
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

  // The clearing rule of every import (D21 of 26.11.9), as on the screen: a file of two columns updates
  // Lactalis without touching the notes it does not carry, and the card announces no value cleared.
  await runner.query(`UPDATE suppliers SET notes = 'Contrat cadre 2026' WHERE tenant_id = $1 AND name = 'Lactalis'`, [s.tenantId]);
  const update = attach(h, 'fournisseurs v2.csv', 'Fournisseur;Identifiant ERP\nLactalis;F-101\nFromagerie Alpine;F-003\n');
  const updating = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: update, entity_type: 'suppliers', columns });
  const check = updating.import_mapping.validation;
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.deepEqual([check.inserted, check.updated, check.cleared], [1, 1, 0]);
  const [lactalis] = await runner.query(`SELECT item_number FROM suppliers WHERE tenant_id = $1 AND name = 'Lactalis'`, [s.tenantId]);
  assert.equal(updating.import_mapping.on_approval, `On approval: 1 records created, 1 updated (file line 2: SUP-${lactalis.item_number} Lactalis), 0 unchanged.`);
  await assertSameAsTheRoute(h, runner, s, { attachment_id: update, entity_type: 'suppliers', columns }, check);
  const updated = await h.previews.executePreview(admin, updating.preview_id);
  assert.equal(updated.status, 'executed', updated.error_message ?? '');
  assert.deepEqual([updated.import_mapping.result.updated, updated.import_mapping.result.cleared], [1, 0]);
  const [kept] = await runner.query(`SELECT notes, erp_supplier_id FROM suppliers WHERE tenant_id = $1 AND name = 'Lactalis'`, [s.tenantId]);
  assert.deepEqual(kept, { notes: 'Contrat cadre 2026', erp_supplier_id: 'F-101' });

  // `-` in a cell clears the value: the card counts it and its approval sentence says it; a blank
  // cell keeps the notes of Savencia.
  await runner.query(`UPDATE suppliers SET notes = 'Affineur' WHERE tenant_id = $1 AND name = 'Savencia'`, [s.tenantId]);
  const notesColumns = [{ column: 'name', source: 1, confidence: 'high' }, { column: 'notes', source: 2, confidence: 'high' }];
  const dash = attach(h, 'fournisseurs v3.csv', 'Fournisseur;Notes\nLactalis;-\nSavencia;\n');
  const clearing = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: dash, entity_type: 'suppliers', columns: notesColumns });
  const clears = clearing.import_mapping.validation;
  assert.equal(clears.ok, true, JSON.stringify(clears));
  assert.deepEqual([clears.updated, clears.unchanged, clears.cleared], [1, 1, 1]);
  assert.equal(clearing.import_mapping.on_approval,
    `On approval: 0 records created, 1 updated (file line 2: SUP-${lactalis.item_number} Lactalis), 1 unchanged; 1 stored value cleared (cells holding "-").`);
  await assertSameAsTheRoute(h, runner, s, { attachment_id: dash, entity_type: 'suppliers', columns: notesColumns }, clears);
  const cleared = await h.previews.executePreview(admin, clearing.preview_id);
  assert.equal(cleared.status, 'executed', cleared.error_message ?? '');
  assert.equal(cleared.import_mapping.result.cleared, 1);
  const notes = await runner.query(`SELECT name, notes FROM suppliers WHERE tenant_id = $1 AND name IN ('Lactalis', 'Savencia') ORDER BY name`, [s.tenantId]);
  assert.deepEqual(notes.map((row: any) => [row.name, row.notes]), [['Lactalis', null], ['Savencia', 'Affineur']]);
  const [count] = await runner.query(`SELECT count(*)::int AS n FROM suppliers WHERE tenant_id = $1`, [s.tenantId]);
  assert.equal(count.n, 3);

  // A column the model leaves out is still read when its header names a template column, as the screen
  // reads it (here the German title of the notes): its `-` clears. Unless the person asked to leave it
  // aside (`left_aside`), which the card keeps for its approval.
  const named = attach(h, 'fournisseurs v4.csv', 'Fournisseur;Notizen\nSavencia;-\n');
  const nameColumn = [{ column: 'name', source: 1, confidence: 'high' }];
  const aside = await h.previews.createPreview(admin, 'prepare_import_mapping', {
    attachment_id: named, entity_type: 'suppliers', columns: nameColumn, left_aside: ['Notizen'],
  });
  assert.deepEqual(aside.import_mapping.columns.map((column: any) => column.column), ['name']);
  assert.deepEqual([aside.import_mapping.validation.unchanged, aside.import_mapping.validation.cleared], [1, 0]);
  const [stored] = await runner.query(
    `SELECT mutation_input->'left_aside' AS aside FROM ai_mutation_previews WHERE tenant_id = $1 AND id = $2`,
    [s.tenantId, aside.preview_id],
  );
  assert.deepEqual(stored.aside, ['Notizen']);
  const reading = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: named, entity_type: 'suppliers', columns: nameColumn });
  const read = reading.import_mapping.columns.find((column: any) => column.column === 'notes');
  assert.deepEqual([read?.source, read?.confidence], [{ position: 2, header: 'Notizen' }, 'high']);
  const readCheck = reading.import_mapping.validation;
  assert.deepEqual([readCheck.ok, readCheck.updated, readCheck.cleared], [true, 1, 1], JSON.stringify(readCheck));
  await assertSameAsTheRoute(h, runner, s, { attachment_id: named, entity_type: 'suppliers', columns: nameColumn }, readCheck);
  const readDone = await h.previews.executePreview(admin, reading.preview_id);
  assert.equal(readDone.status, 'executed', readDone.error_message ?? '');
  const [savencia] = await runner.query(`SELECT notes FROM suppliers WHERE tenant_id = $1 AND name = 'Savencia'`, [s.tenantId]);
  assert.equal(savencia.notes, null);
  console.log('  suppliers: imported; a blank cell or an absent column keeps, `-` clears, as the route: OK');
}

// Imports that write beyond their record's columns (owners, data residency, viewers): their check
// compares those too, so a file that changes only them updates the record and is approvable.
async function testOwnersAndResidency(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s, 'admin');
  const [{ email }] = await runner.query(`SELECT email FROM users WHERE id = $1`, [s.users.admin]);
  const approve = async (name: string, text: string, entity: string, columns: any[]) => {
    const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attach(h, name, text), entity_type: entity, columns });
    const check = card.import_mapping.validation;
    assert.equal(check.ok, true, JSON.stringify(check));
    assert.equal(check.nothing_to_import, undefined, `${name}: something to import`);
    const done = await h.previews.executePreview(admin, card.preview_id);
    assert.equal(done.status, 'executed', done.error_message ?? '');
    return check;
  };
  const owners = await approve('responsables.csv', `Appli;Responsable métier\nCheeseTrack;${email}\n`, 'applications', [
    { column: 'name', source: 1, confidence: 'high' },
    { column: 'business_owner_email_1', source: 2, confidence: 'high' },
  ]);
  assert.deepEqual([owners.inserted, owners.updated], [0, 1]);
  const residency = await approve('résidence.csv', 'Appli;Résidence\nCheeseTrack;France\n', 'applications', [
    { column: 'name', source: 1, confidence: 'high' },
    { column: 'data_residency', source: 2, confidence: 'high' },
  ]);
  assert.deepEqual([residency.inserted, residency.updated], [0, 1]);
  const [app] = await runner.query(
    `SELECT (SELECT count(*)::int FROM application_owners o WHERE o.tenant_id = a.tenant_id AND o.application_id = a.id) AS owners,
            (SELECT string_agg(country_iso, ',') FROM application_data_residency r WHERE r.tenant_id = a.tenant_id AND r.application_id = a.id) AS residency
       FROM applications a WHERE a.tenant_id = $1 AND a.name = 'CheeseTrack'`,
    [s.tenantId],
  );
  assert.deepEqual(app, { owners: 1, residency: 'FR' });

  const task = [{ column: 'title', source: 1, confidence: 'high' }];
  await approve('tâches.csv', 'Tâche\nInventaire des caves\n', 'tasks', task);
  const viewers = await approve('observateurs.csv', `Tâche;Observateur;Responsable\nInventaire des caves;${email};${email}\n`, 'tasks', [
    ...task,
    { column: 'viewer_email_1', source: 2, confidence: 'high' },
    { column: 'owner_email_1', source: 3, confidence: 'high' },
  ]);
  assert.deepEqual([viewers.inserted, viewers.updated], [0, 1]);
  const [stored] = await runner.query(`SELECT viewer_ids, owner_ids FROM tasks WHERE tenant_id = $1 AND title = 'Inventaire des caves'`, [s.tenantId]);
  assert.deepEqual(stored, { viewer_ids: [s.users.admin], owner_ids: [s.users.admin] });
  console.log('  owners, data residency, viewers: a file that changes only them is approvable: OK');
}

// Projects: a status named in French is read; the same file again has nothing to import, and
// "Approve all" leaves out its cards. A status the screen's import refuses is named in the
// person's language, and the model reads each code with its name.
async function testProjects(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s, 'admin');
  const text = "Projet;Statut\nCave connectée;Liste d'attente\nAffinage;Suspendu\n";
  const columns = [{ column: 'name', source: 1, confidence: 'high' }, { column: 'status', source: 2, confidence: 'high' }];
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attach(h, 'projets.csv', text), entity_type: 'portfolio_projects', columns });
  assert.equal(card.import_mapping.validation.ok, true, JSON.stringify(card.import_mapping.validation));
  assert.equal(card.import_mapping.on_approval, 'On approval: 2 records created, 0 updated, 0 unchanged.');
  assert.equal((await h.previews.executePreview(admin, card.preview_id)).status, 'executed');
  const stored = await runner.query(`SELECT name, status FROM portfolio_projects WHERE tenant_id = $1 ORDER BY name`, [s.tenantId]);
  assert.deepEqual(stored.map((row: any) => [row.name, row.status]), [['Affinage', 'on_hold'], ['Cave connectée', 'waiting_list']]);

  const first = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attach(h, 'projets.csv', text), entity_type: 'portfolio_projects', columns });
  const second = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attach(h, 'projets (copie).csv', text), entity_type: 'portfolio_projects', columns });
  for (const pending of [first, second]) {
    assert.equal(pending.import_mapping.validation.nothing_to_import, true, JSON.stringify(pending.import_mapping.validation));
    assert.match(pending.import_mapping.on_approval, /^Nothing to import: the approval would create and update nothing \(2 records unchanged\)/);
  }
  const { results } = await h.previews.executePreviewsWithFollowUps(admin, [first.preview_id, second.preview_id]);
  assert.deepEqual(results, [], 'approve all leaves out a card with nothing to import');
  const kept = (await h.previews.listConversationPreviews(admin, s.conversations.admin))
    .filter((preview: any) => preview.preview_id === first.preview_id || preview.preview_id === second.preview_id);
  assert.deepEqual(kept.map((preview: any) => [preview.status, preview.error_message]), [['pending', null], ['pending', null]]);
  await assertNothingRefused(h, admin, first.preview_id);
  await h.previews.rejectPreview(admin, first.preview_id);
  await h.previews.rejectPreview(admin, second.preview_id);

  // The model reads each status with its name in the person's language.
  const template = await h.mapping.describeTemplate(admin, 'portfolio_projects', 'fr');
  const status = template.columns.find((column: any) => column.column === 'status');
  assert.ok(status.codes.includes('waiting_list'));
  assert.deepEqual(status.entries.find((entry: any) => entry.code === 'on_hold'), { code: 'on_hold', name: 'Suspendu' });

  // The screen's import: a status it does not know is refused with the names of the person's
  // language, and a name of the list is read as its status.
  const { PortfolioProjectsCsvService } = require('../../portfolio/portfolio-projects-csv.service');
  const screen = h.app.get(PortfolioProjectsCsvService);
  const csv = { fieldname: 'file', originalname: 'p.csv', encoding: '7bit', mimetype: 'text/csv',
    buffer: Buffer.from('name;status\nVieillissement;Bidon\nAffinage;Planifié\n', 'utf8') } as any;
  const checked = await screen.import(csv, { dryRun: true, mode: 'enrich', operation: 'upsert' }, { manager: runner.manager, tenantId: s.tenantId, userId: s.users.admin, language: 'fr' });
  assert.deepEqual(checked.errors.map((error: any) => [error.row, error.code, error.params]), [
    [2, 'CSV_ENUM_INVALID', { value: 'Bidon', allowed: "Liste d'attente, Planifié, En cours, En test, Suspendu, Terminé, Annulé" }],
  ]);
  assert.equal(checked.updated, 1, 'Planifié read as planned');
  console.log('  projects: names read, nothing to import, approve all leaves the cards out, statuses named: OK');
}

// Lot I3 of 26.11.9: a supplier named without its accents is found and listed on the person's lines;
// one nothing finds keeps the stored supplier of the application the row updates (Kad merges).
async function testSupplierNamesBeyondCase(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s, 'admin');
  const [sg] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Société Générale') RETURNING id, item_number`, [s.tenantId]);
  const [cegid] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Cegid I3') RETURNING id`, [s.tenantId]);
  await runner.query(`INSERT INTO applications (tenant_id, name, supplier_id) VALUES ($1, 'Atlas I3', $2)`, [s.tenantId, cegid.id]);
  // A blank row: the data rows are the person's lines 2 and 4 (lines 2 and 3 of the file Kad builds).
  const file = attach(h, 'Fournisseurs.csv', ['Appli;Fournisseur', 'Atlas I3;Banque Inconnue', ';', 'Hermes I3;Societe Generale'].join('\n'));
  const columns = [
    { column: 'name', source: 1, confidence: 'high' },
    { column: 'supplier_name', source: 2, confidence: 'high' },
  ];
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: file, entity_type: 'applications', columns });
  const check = card.import_mapping.validation;
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.deepEqual(check.report.matches, [{
    column: 'supplier_name', name: null, value: 'Societe Generale', target: 'Société Générale', ref: `SUP-${sg.item_number}`,
    origin: 'server', reason: 'accents', lines: [4], count: 1, undoable: true,
  }]);
  assert.equal(check.report.matchesTotal, 1);
  assert.deepEqual(check.report.warnings.map((warning: any) => [warning.row, warning.code, warning.params]), [
    [2, 'CSV_REFERENCE_NOT_FOUND_KEPT', { value: 'Banque Inconnue' }],
  ]);
  assert.deepEqual([check.inserted, check.updated, check.unchanged], [1, 0, 1]);
  const done = await h.previews.executePreview(admin, card.preview_id);
  assert.equal(done.status, 'executed', done.error_message ?? '');
  const apps = await runner.query(
    `SELECT name, supplier_id FROM applications WHERE tenant_id = $1 AND name LIKE '% I3' ORDER BY name`,
    [s.tenantId],
  );
  assert.deepEqual(apps.map((app: any) => [app.name, app.supplier_id]), [['Atlas I3', cegid.id], ['Hermes I3', sg.id]]);
  console.log('  applications: a supplier found beyond accents is listed on the person\'s lines, an unknown one keeps the stored supplier: OK');
}

async function testEveryImportChecks(h: Harness, runner: QueryRunner, s: Seed) {
  const { AI_IMPORT_KEYS } = require('../import/ai-import-access');
  const admin = ctx(runner, s, 'admin');
  const [before] = await runner.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1`, [s.tenantId]);
  for (const key of AI_IMPORT_KEYS as string[]) {
    const template = await h.mapping.describeTemplate(admin, key, 'en');
    const required = template.columns.filter((column: any) => column.required).map((column: any) => column.column);
    // A link file needs its subject and its technology, each by reference or by name (lot I4 of 26.11.9).
    const linkKeys: Record<string, string[]> = {
      technology_asset_links: ['asset_name', 'technology_name'],
      technology_application_links: ['application_name', 'technology_name'],
    };
    const columns = required.length > 0 ? required : linkKeys[key] ?? [template.columns[0].column];
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
    // Every import reads the file Plaid builds, with the columns the mapping fills only.
    assert.ok(!check.issues.some((issue: any) => /HEADER/.test(String(issue.code))), `${key}: ${JSON.stringify(check.issues)}`);
    // A value nothing names beyond case: no match listed.
    if (check.report.kind === 'rows') assert.equal(check.report.matches, undefined, key);
    for (const error of check.report.kind === 'rows' ? check.report.errors : []) {
      assert.ok(error.row === 0 || error.row === 2, `${key}: an error on the person's line 2 or on the file: ${JSON.stringify(error)}`);
    }
  }
  const [after] = await runner.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1`, [s.tenantId]);
  assert.equal(after.n, before.n, 'the checks write nothing');
  console.log(`  ${AI_IMPORT_KEYS.length} imports: checked, nothing written: OK`);
}

// Lot I3 of 26.11.9: Kad's contracts import finds a company case aside and a supplier without its
// accents; the match is listed on the person's lines (a blank row shifts them).
async function testContractNamesBeyondCase(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s, 'admin');
  await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Fromage I3 SA', 'FR', 'Lyon')`, [s.tenantId]);
  const [sg] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Société Générale I3') RETURNING id, item_number`, [s.tenantId]);
  const file = attach(h, 'Contrats.csv', [
    'Contrat;Société;Fournisseur;Début',
    'Maintenance I3;fromage i3 sa;SOCIETE GENERALE I3;2026-01-01',
    ';;;',
    'Licences I3;Fromage I3 SA;Societe Generale I3;2026-02-01',
  ].join('\n'));
  const columns = [
    { column: 'name', source: 1, confidence: 'high' },
    { column: 'company_name', source: 2, confidence: 'high' },
    { column: 'supplier_name', source: 3, confidence: 'high' },
    { column: 'start_date', source: 4, confidence: 'high' },
  ];
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: file, entity_type: 'contracts', columns });
  const check = card.import_mapping.validation;
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.deepEqual(check.report.matches, [{
    column: 'supplier_name', name: null, value: 'SOCIETE GENERALE I3', target: 'Société Générale I3', ref: `SUP-${sg.item_number}`,
    origin: 'server', reason: 'accents', lines: [2, 4], count: 2, undoable: true,
  }]);
  assert.equal(check.report.matchesTotal, 1);
  assert.deepEqual([check.inserted, check.updated, check.unchanged], [2, 0, 0]);
  const done = await h.previews.executePreview(admin, card.preview_id);
  assert.equal(done.status, 'executed', done.error_message ?? '');
  const stored = await runner.query(
    `SELECT name, supplier_id FROM contracts WHERE tenant_id = $1 AND name LIKE '% I3' ORDER BY name`,
    [s.tenantId],
  );
  assert.deepEqual(stored.map((row: any) => [row.name, row.supplier_id]), [['Licences I3', sg.id], ['Maintenance I3', sg.id]]);
  console.log('  contracts: a company case aside and a supplier beyond accents, listed on the person\'s lines: OK');
}

// Lot I3 of 26.11.9, second pass: Kad's `values` for an application's supplier are proposals the
// import checks. "Cegid P2" exists: accepted, listed as Kad's on the person's line; "Cegid SA P2" does
// not: refused as missing, and the file's "CGD2" follows its own rule (nothing finds it). A person who
// does not read the suppliers has every proposal refused as missing, naming nothing of the list.
async function testSupplierProposals(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s, 'admin');
  const [cegid] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Cegid P2') RETURNING id, item_number`, [s.tenantId]);
  const file = attach(h, 'Editeurs.csv', ['Appli;Editeur', 'Zephyr P2;CGD', 'Boreas P2;CGD2'].join('\n'));
  const columns = [
    { column: 'name', source: 1, confidence: 'high' },
    { column: 'supplier_name', source: 2, confidence: 'high', values: { CGD: 'Cegid P2', CGD2: 'Cegid SA P2' } },
  ];
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: file, entity_type: 'applications', columns });
  const check = card.import_mapping.validation;
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.deepEqual(check.report.matches, [{
    column: 'supplier_name', name: null, value: 'CGD', target: 'Cegid P2', ref: `SUP-${cegid.item_number}`,
    origin: 'model', reason: 'model', lines: [2], count: 1, undoable: true,
  }]);
  assert.deepEqual(check.report.refusedProposals, [
    { column: 'supplier_name', name: null, value: 'CGD2', target: 'Cegid SA P2', reason: 'missing', lines: [3], count: 1 },
  ]);
  assert.equal(check.report.refusedProposalsTotal, 1);
  assert.deepEqual(check.report.warnings.map((warning: any) => [warning.row, warning.column, warning.params?.value]), [[3, 'supplier_name', 'CGD2']]);
  assert.match(check.report.warnings[0].code, /^CSV_REFERENCE_NOT_FOUND/);
  const done = await h.previews.executePreview(admin, card.preview_id);
  assert.equal(done.status, 'executed', done.error_message ?? '');
  const apps = await runner.query(`SELECT name, supplier_id FROM applications WHERE tenant_id = $1 AND name LIKE '% P2' ORDER BY name`, [s.tenantId]);
  assert.deepEqual(apps.map((app: any) => [app.name, app.supplier_id]), [['Boreas P2', null], ['Zephyr P2', cegid.id]]);

  // Without the suppliers' module: refused as missing, under Kad's own words.
  const role = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Apps P2', 'Apps P2')`, [s.tenantId]);
  for (const [resource, level] of [['ai_chat', 'member'], ['applications', 'admin']]) {
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [s.tenantId, role, resource, level]);
  }
  const user = await insertId(runner,
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, locale) VALUES ($1, $2, 'Apps', 'Tester', $3, 'enabled', 'en')`,
    [s.tenantId, `apps-p2-${s.tenantId.slice(0, 8)}@example.test`, role]);
  const conversation = randomUUID();
  await runner.query(
    `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
     VALUES ($1, $2, $3, 'AI import run integration', 'custom', 'import-model', 'custom', now(), now())`,
    [conversation, s.tenantId, user],
  );
  const apps2 = { ...admin, userId: user, conversationId: conversation };
  const blind = await h.previews.createPreview(apps2, 'prepare_import_mapping', {
    attachment_id: attach(h, 'Editeurs.csv', ['Appli;Editeur', 'Notus P2;CGD'].join('\n')), entity_type: 'applications', columns,
  });
  const unread = blind.import_mapping.validation;
  assert.equal(unread.report.matches, undefined);
  assert.deepEqual(unread.report.refusedProposals, [
    { column: 'supplier_name', name: null, value: 'CGD', target: 'Cegid P2', reason: 'missing', lines: [2], count: 1 },
  ]);
  console.log('  applications: Kad\'s supplier accepted when it exists, refused when missing or unread: OK');
}

// Lot I3 of 26.11.9, second pass: on a contracts card, the person undoes the match of a supplier
// found without its accents, through the card's choice route. The next card no longer makes it, and
// the supplier is unknown; a new card of the model for the same file keeps the choice. The route
// refuses a choice of the budget file's, and a column the import does not match.
async function testContractMatchUndoneByTheRoute(h: Harness, runner: QueryRunner, s: Seed) {
  const { AiImportFileController } = require('../import/ai-import-file.controller');
  const controller = h.app.get(AiImportFileController);
  const admin = ctx(runner, s, 'admin');
  await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Fromage P2 SA', 'FR', 'Lyon')`, [s.tenantId]);
  await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Société Générale P2')`, [s.tenantId]);
  const file = attach(h, 'Contrats.csv', ['Contrat;Société;Fournisseur;Début', 'Hébergement P2;Fromage P2 SA;Societe Generale P2;2026-03-01'].join('\n'));
  const columns = [
    { column: 'name', source: 1, confidence: 'high' },
    { column: 'company_name', source: 2, confidence: 'high' },
    { column: 'supplier_name', source: 3, confidence: 'high' },
    { column: 'start_date', source: 4, confidence: 'high' },
  ];
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: file, entity_type: 'contracts', columns });
  assert.deepEqual(card.import_mapping.validation.report.matches.map((match: any) => [match.value, match.target, match.origin, match.undoable]), [
    ['Societe Generale P2', 'Société Générale P2', 'server', true],
  ]);
  const req = { user: { sub: s.users.admin }, headers: {} };
  const tenant = { manager: runner.manager, tenantId: s.tenantId };
  for (const choices of [[{ kind: 'create_suppliers', value: false }], [{ kind: 'unmatch', column: 'name', value: 'Hébergement P2' }]]) {
    await assert.rejects(controller.choose(s.conversations.admin, card.preview_id, { choices }, req, tenant), /not valid/);
  }
  const undo = [{ kind: 'unmatch', column: 'supplier_name', value: 'Societe Generale P2' }];
  const next = await controller.choose(s.conversations.admin, card.preview_id, { choices: undo }, req, tenant);
  assert.equal(next.replaces_preview_id, card.preview_id);
  const check = next.import_mapping.validation;
  assert.equal(check.ok, false);
  assert.equal(check.report.matches, undefined, 'the next card no longer makes the match');
  assert.deepEqual(check.report.errors.map((error: any) => [error.row, error.column, error.code]), [[2, 'supplier_name', 'CSV_REFERENCE_NOT_FOUND']]);
  // The model maps the same file again: the choice stays.
  const again = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: file, entity_type: 'contracts', columns });
  assert.equal(again.import_mapping.validation.report.matches, undefined);
  assert.deepEqual(again.import_mapping.validation.report.errors.map((error: any) => error.code), ['CSV_REFERENCE_NOT_FOUND']);
  console.log('  contracts: a match undone through the card\'s route is gone from the next cards, the supplier unknown: OK');
}

// Lot I3 of 26.11.9, second pass: the imports that read their own lists check Kad's proposals too: a
// business process's parent, a cost center's company, a task's related object (a contract of the
// earlier tests) and a request's company (the shared resolver).
async function testProposalsOfTheOtherImports(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s, 'admin');
  const card = async (entity_type: string, csv: string[], columns: unknown[]) => (await h.previews.createPreview(admin, 'prepare_import_mapping', {
    attachment_id: attach(h, `${entity_type}.csv`, csv.join('\n')), entity_type, columns,
  })).import_mapping.validation;
  const summary = (check: any) => ({
    matches: (check.report.matches ?? []).map((match: any) => [match.column, match.value, match.target, match.origin]),
    refused: (check.report.refusedProposals ?? []).map((entry: any) => [entry.column, entry.value, entry.target, entry.reason]),
  });
  const processes = await card('business_processes', ['Processus;Parent', 'Finance P2;', 'Clôture P2;FIN', 'Paie P2;RH'], [
    { column: 'name', source: 1, confidence: 'high' },
    { column: 'parent_name', source: 2, confidence: 'high', values: { FIN: 'finance p2', RH: 'Ressources humaines P2' } },
  ]);
  assert.deepEqual(summary(processes), {
    matches: [['parent_name', 'FIN', 'Finance P2', 'model']],
    refused: [['parent_name', 'RH', 'Ressources humaines P2', 'missing']],
  });
  const centers = await card('cost_centers', ['Code;Type;Nom;Société', 'CC-P2;cost_center;Centre P2;FPS'], [
    { column: 'code', source: 1, confidence: 'high' },
    { column: 'kind', source: 2, confidence: 'high' },
    { column: 'name', source: 3, confidence: 'high' },
    { column: 'company_name', source: 4, confidence: 'high', values: { FPS: 'Fromage P2 SA' } },
  ]);
  assert.equal(centers.ok, true, JSON.stringify(centers));
  assert.deepEqual(summary(centers), { matches: [['company_name', 'FPS', 'Fromage P2 SA', 'model']], refused: [] });
  const tasks = await card('tasks', ['Tâche;Type;Objet', 'Relancer P2;contract;MAINT'], [
    { column: 'title', source: 1, confidence: 'high' },
    { column: 'related_object_type', source: 2, confidence: 'high' },
    { column: 'related_object_name', source: 3, confidence: 'high', values: { MAINT: 'maintenance i3' } },
  ]);
  assert.deepEqual(summary(tasks), { matches: [['related_object_name', 'MAINT', 'Maintenance I3', 'model']], refused: [] });
  const requests = await card('portfolio_requests', ['Demande;Société', 'Portail P2;FPS'], [
    { column: 'name', source: 1, confidence: 'high' },
    { column: 'company_name', source: 2, confidence: 'high', values: { FPS: 'Fromage P2 SA' } },
  ]);
  assert.deepEqual(summary(requests), { matches: [['company_name', 'FPS', 'Fromage P2 SA', 'model']], refused: [] });
  console.log('  processes, cost centers, tasks, requests: Kad\'s proposals checked against their lists: OK');
}

// Lot I3 of 26.11.9, merge of the fourth and fifth passes: Kad's import of server links finds a
// server written without its accents, for a person who reads the infrastructure, lists the match on
// the card, and the card's choice route undoes it: the next card no longer makes it.
async function testLinkServerNameUndoneByTheRoute(h: Harness, runner: QueryRunner, s: Seed) {
  const { AiImportFileController } = require('../import/ai-import-file.controller');
  const controller = h.app.get(AiImportFileController);
  const admin = ctx(runner, s, 'admin');
  const [server] = await runner.query(
    `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, 'Serveur Énergie F45', 'virtual_machine', 'prod') RETURNING asset_reference`,
    [s.tenantId],
  );
  await runner.query(`INSERT INTO technologies (tenant_id, item_number, name, family) VALUES ($1, 4501, 'Moteur F45', 'other')`, [s.tenantId]);
  const file = attach(h, 'Liens.csv', ['Serveur;Technologie', 'Serveur Energie F45;Moteur F45'].join('\n'));
  const columns = [
    { column: 'asset_name', source: 1, confidence: 'high' },
    { column: 'technology_name', source: 2, confidence: 'high' },
  ];
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: file, entity_type: 'technology_asset_links', columns });
  const check = card.import_mapping.validation;
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.deepEqual(check.report.matches, [{
    column: 'asset_name', name: null, value: 'Serveur Energie F45', target: 'Serveur Énergie F45', ref: server.asset_reference,
    origin: 'server', reason: 'accents', lines: [2], count: 1, undoable: true,
  }]);
  const req = { user: { sub: s.users.admin }, headers: {} };
  const tenant = { manager: runner.manager, tenantId: s.tenantId };
  const undo = [{ kind: 'unmatch', column: 'asset_name', value: 'Serveur Energie F45' }];
  const next = await controller.choose(s.conversations.admin, card.preview_id, { choices: undo }, req, tenant);
  assert.equal(next.replaces_preview_id, card.preview_id);
  const undone = next.import_mapping.validation;
  assert.equal(undone.report.matches, undefined, 'the next card no longer makes the match');
  assert.deepEqual(undone.report.undone, [{ column: 'asset_name', value: 'Serveur Energie F45' }]);
  assert.deepEqual(undone.report.errors.map((error: any) => [error.row, error.column, error.code]), [[2, 'asset_name', 'CSV_REFERENCE_NOT_FOUND']]);
  console.log('  server links: a server beyond accents matched on the card, undone through its route: OK');
}

// Lot I3 of 26.11.9, merge of the fourth and fifth passes: Kad's import of servers finds "Ubuntu
// 22.04" as the catalog's "22.04 LTS" (a match of reason version, undoable from the card), and the
// card says how each site the file names hosts its servers (T-I3f).
async function testServerVersionAndHosting(h: Harness, runner: QueryRunner, s: Seed) {
  const { AiImportFileController } = require('../import/ai-import-file.controller');
  const controller = h.app.get(AiImportFileController);
  const admin = ctx(runner, s, 'admin');
  await runner.query(
    `INSERT INTO locations (tenant_id, location_reference, name, hosting_type, provider)
     VALUES ($1, 'LOC-4501', 'Datacenter Rennes F45', 'on_prem', NULL), ($1, 'LOC-4502', 'AWS Paris F45', 'public_cloud', 'AWS')`,
    [s.tenantId],
  );
  const file = attach(h, 'Serveurs.csv', [
    'Nom;Site;Type;Environnement;Système',
    'srv-f45-a;LOC-4502;virtual_machine;prod;Ubuntu 22.04',
    'srv-f45-b;loc-4501;virtual_machine;prod;Ubuntu 22.04',
    'srv-f45-c;LOC-4502;virtual_machine;prod;',
  ].join('\n'));
  const columns = [
    { column: 'name', source: 1, confidence: 'high' },
    { column: 'location_reference', source: 2, confidence: 'high' },
    { column: 'kind', source: 3, confidence: 'high' },
    { column: 'environment', source: 4, confidence: 'high' },
    { column: 'operating_system', source: 5, confidence: 'high' },
  ];
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: file, entity_type: 'assets', columns });
  const check = card.import_mapping.validation;
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.deepEqual(check.report.matches, [{
    column: 'operating_system', name: null, value: 'Ubuntu 22.04', target: 'Ubuntu 22.04 LTS', ref: null,
    origin: 'server', reason: 'version', lines: [2, 3], count: 2, undoable: true,
  }]);
  // Each site once, in the order of the file, with its hosting as the location screen shows it.
  const hosting = [
    { ref: 'LOC-4502', name: 'AWS Paris F45', hostingType: 'public_cloud', label: 'Public cloud', category: 'cloud', provider: 'AWS' },
    { ref: 'LOC-4501', name: 'Datacenter Rennes F45', hostingType: 'on_prem', label: 'On-prem', category: 'on_prem', provider: null },
  ];
  assert.deepEqual(check.report.hosting, hosting);
  const req = { user: { sub: s.users.admin }, headers: {} };
  const tenant = { manager: runner.manager, tenantId: s.tenantId };
  const undo = [{ kind: 'unmatch', column: 'operating_system', value: 'Ubuntu 22.04' }];
  const next = await controller.choose(s.conversations.admin, card.preview_id, { choices: undo }, req, tenant);
  const undone = next.import_mapping.validation;
  assert.equal(undone.report.matches, undefined, 'the next card no longer makes the match');
  assert.deepEqual(
    undone.report.warnings.map((warning: any) => [warning.row, warning.code, warning.params?.value]),
    [[2, 'CSV_TECHNOLOGY_VERSION_CREATED', '22.04'], [3, 'CSV_TECHNOLOGY_VERSION_CREATED', '22.04']],
    'the version is created as written',
  );
  assert.deepEqual(undone.report.hosting, hosting);
  console.log('  servers: Ubuntu 22.04 found as 22.04 LTS and undone from the card; the sites\' hosting said: OK');
}

/** A person of the workspace with these rights, and a conversation of theirs: the context of their card. */
async function personWith(runner: QueryRunner, s: Seed, name: string, permissions: Record<string, string>) {
  const role = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, $2, $2)`, [s.tenantId, name]);
  for (const [resource, level] of Object.entries(permissions)) {
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [s.tenantId, role, resource, level]);
  }
  const user = await insertId(runner,
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, locale) VALUES ($1, $2, $3, 'Tester', $4, 'enabled', 'en')`,
    [s.tenantId, `${name.toLowerCase().replace(/\W+/g, '-')}-${s.tenantId.slice(0, 8)}@example.test`, name, role]);
  const conversation = randomUUID();
  await runner.query(
    `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
     VALUES ($1, $2, $3, 'AI import run integration', 'custom', 'import-model', 'custom', now(), now())`,
    [conversation, s.tenantId, user],
  );
  return { role, context: { ...ctx(runner, s, 'admin'), userId: user, conversationId: conversation } };
}

// Fixes after the adversarial review (finding 6): the card names the hosting of the sites only to a
// person who reads the sites (the right the sites screen asks); without it, no hosting at all.
async function testHostingNeedsTheSites(h: Harness, runner: QueryRunner, s: Seed) {
  await runner.query(
    `INSERT INTO locations (tenant_id, location_reference, name, hosting_type, provider) VALUES ($1, 'LOC-4601', 'Site secret F46', 'public_cloud', 'AWS')`,
    [s.tenantId],
  );
  const { role, context } = await personWith(runner, s, 'Infra sans sites', { ai_chat: 'member', infrastructure: 'admin' });
  const columns = [
    { column: 'name', source: 1, confidence: 'high' },
    { column: 'location_reference', source: 2, confidence: 'high' },
    { column: 'kind', source: 3, confidence: 'high' },
    { column: 'environment', source: 4, confidence: 'high' },
  ];
  const file = () => attach(h, 'Serveurs F46.csv', ['Nom;Site;Type;Environnement', 'srv-f46;LOC-4601;virtual_machine;prod'].join('\n'));
  const blind = await h.previews.createPreview(context, 'prepare_import_mapping', { attachment_id: file(), entity_type: 'assets', columns });
  assert.equal(blind.import_mapping.validation.report.hosting, undefined, 'no site named without the sites right');
  assert.doesNotMatch(JSON.stringify(blind), /Site secret F46/);
  await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'locations', 'reader')`, [s.tenantId, role]);
  const seeing = await h.previews.createPreview(context, 'prepare_import_mapping', { attachment_id: file(), entity_type: 'assets', columns });
  assert.deepEqual(seeing.import_mapping.validation.report.hosting?.map((site: any) => site.name), ['Site secret F46']);
  console.log('  servers: the sites\' hosting named to a person who reads the sites only: OK');
}

// Fixes after the adversarial review (finding 9): the file prepared from a card is imported by the
// list's own import, which reads no proposal of Kad: the file writes each proposal the check took,
// all of them (more than the card's 200 first matches), in a cell of several names (clusters) too.
async function testPreparedFileKeepsEveryProposal(h: Harness, runner: QueryRunner, s: Seed) {
  const { AiImportFileController } = require('../import/ai-import-file.controller');
  const { readTableAttachment } = require('../attachments/table-attachment');
  const controller = h.app.get(AiImportFileController);
  const admin = ctx(runner, s, 'admin');
  const download = async (previewId: string) => {
    const sent: { body: Buffer | null } = { body: null };
    const res = { setHeader: () => undefined, end: (body: Buffer) => { sent.body = body; } };
    await controller.download(s.conversations.admin, previewId, { user: { sub: s.users.admin } }, { tenantId: s.tenantId, manager: runner.manager }, res);
    const built = await readTableAttachment(sent.body!);
    const header = built.header.map((cell: any) => cell.value);
    return built.rows.map((row: any[]) => Object.fromEntries(header.map((name: string, at: number) => [name, row[at]?.value ?? ''])));
  };

  const count = 205;
  await runner.query(`INSERT INTO suppliers (tenant_id, name) SELECT $1, 'Fournisseur PF ' || g FROM generate_series(1, $2::int) g`, [s.tenantId, count]);
  const lines = ['Appli;Editeur'];
  const values: Record<string, string> = {};
  for (let n = 1; n <= count; n += 1) {
    lines.push(`Appli PF ${n};FPF ${n}`);
    values[`FPF ${n}`] = `Fournisseur PF ${n}`;
  }
  const apps = await h.previews.createPreview(admin, 'prepare_import_mapping', {
    attachment_id: attach(h, 'Applications PF.csv', lines.join('\n')),
    entity_type: 'applications',
    columns: [
      { column: 'name', source: 1, confidence: 'high' },
      { column: 'supplier_name', source: 2, confidence: 'high', values },
    ],
  });
  assert.equal(apps.import_mapping.validation.report.matchesTotal, count);
  const appRows = await download(apps.preview_id);
  assert.equal(appRows.length, count);
  assert.deepEqual(appRows.filter((row: any) => row.supplier_name !== row.name.replace('Appli', 'Fournisseur')).map((row: any) => row.name), [], 'every proposal written');

  await runner.query(
    `INSERT INTO assets (tenant_id, name, kind, environment, is_cluster) VALUES ($1, 'Grappe A PF', 'vm', 'prod', true), ($1, 'Grappe B PF', 'vm', 'prod', true)`,
    [s.tenantId],
  );
  await runner.query(
    `INSERT INTO locations (tenant_id, location_reference, name, hosting_type) VALUES ($1, 'LOC-4701', 'Site PF', 'on_prem')`,
    [s.tenantId],
  );
  const nodes = await h.previews.createPreview(admin, 'prepare_import_mapping', {
    attachment_id: attach(h, 'Noeuds PF.csv', ['Nom;Site;Type;Environnement;Grappes', 'node-pf;LOC-4701;virtual_machine;prod;GA, GB'].join('\n')),
    entity_type: 'assets',
    columns: [
      { column: 'name', source: 1, confidence: 'high' },
      { column: 'location_reference', source: 2, confidence: 'high' },
      { column: 'kind', source: 3, confidence: 'high' },
      { column: 'environment', source: 4, confidence: 'high' },
      { column: 'cluster', source: 5, confidence: 'high', values: { GA: 'Grappe A PF', GB: 'Grappe B PF' } },
    ],
  });
  const check = nodes.import_mapping.validation;
  assert.equal(check.ok, true, JSON.stringify(check.report.errors));
  const [node] = await download(nodes.preview_id);
  assert.equal(node.cluster, 'Grappe A PF, Grappe B PF', 'each name of the cell written');
  console.log('  prepared file: every proposal the check took written, beyond 200 and in a cell of several names: OK');
}

/**
 * Kad reads the numbered columns beyond the fourth as the screen does (lot I6 of 26.11.9, pass F): a
 * file naming five business owners, by their titles, stores the five, and the check announces no
 * value cleared. The model maps the name only; the owner columns are read by their headers.
 */
async function testFiveOwners(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s, 'admin');
  const app = await insertId(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Cinq responsables')`, [s.tenantId]);
  const emails: string[] = [];
  for (let n = 1; n <= 5; n += 1) {
    const email = `owner-${n}-${s.tenantId.slice(0, 8)}@example.test`;
    await runner.query(
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, locale) SELECT $1, $2, $3, 'Owner', role_id, 'enabled', 'en' FROM users WHERE id = $4`,
      [s.tenantId, email, `Owner${n}`, s.users.admin],
    );
    emails.push(email);
  }
  const header = ['Name', ...emails.map((_, i) => `Business owner ${i + 1} email`)].join(';');
  const file = attach(h, 'five owners.csv', `${header}\nCinq responsables;${emails.join(';')}\n`);
  const card = await h.previews.createPreview(admin, 'prepare_import_mapping', {
    attachment_id: file, entity_type: 'applications', columns: [{ column: 'name', source: 1, confidence: 'high' }],
  });
  const read = card.import_mapping.columns.map((column: any) => column.column);
  assert.ok(read.includes('business_owner_email_5'), `the fifth owner column is read: ${JSON.stringify(read)}`);
  assert.deepEqual(card.import_mapping.unplaced, [], 'every column of the file is placed');
  const check = card.import_mapping.validation;
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.deepEqual([check.updated, check.cleared], [1, 0], 'five owners, none cleared');
  const done = await h.previews.executePreview(admin, card.preview_id);
  assert.equal(done.status, 'executed', done.error_message ?? '');
  const stored = await runner.query(
    `SELECT u.email FROM application_owners o JOIN users u ON u.tenant_id = o.tenant_id AND u.id = o.user_id
      WHERE o.tenant_id = $1 AND o.application_id = $2 AND o.owner_type = 'business' ORDER BY u.email`,
    [s.tenantId, app],
  );
  assert.deepEqual(stored.map((row: any) => row.email), [...emails].sort());
  console.log('  applications: five owners by their titles, the five stored, none cleared: OK');
}

/**
 * Q1 of 26.11.9: the check of a row import names the records it updates, by the line of the person's
 * file and the record's reference (its name when its family has none), and nothing for the rows that
 * change nothing; the facts of the approval name them too. The same file imported twice by Kad, with
 * one value changed and a blank row that shifts the person's lines.
 */
async function testUpdatesNamed(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s, 'admin');
  const twice = async (entity: string, name: string, columns: any[], first: string[], second: string[]) => {
    const created = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attach(h, name, first.join('\n')), entity_type: entity, columns });
    assert.equal(created.import_mapping.validation.ok, true, JSON.stringify(created.import_mapping.validation));
    assert.equal(created.import_mapping.validation.report.updates, undefined, `${entity}: a first import updates nothing`);
    assert.equal((await h.previews.executePreview(admin, created.preview_id)).status, 'executed');
    const again = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attach(h, name, second.join('\n')), entity_type: entity, columns });
    return again.import_mapping;
  };

  // Projects: five rows, the fourth changes its status; a blank row puts it on the person's line 5.
  const projectRows = ['Q1 Cave', 'Q1 Affinage', 'Q1 Wi-Fi des entrepôts', 'Q1 Étiquettes', 'Q1 Traçabilité'];
  const projectFile = (onHold: string) => ['Projet;Statut', ...projectRows.slice(0, 2).map((row) => `${row};Planifié`), ';',
    ...projectRows.slice(2).map((row) => `${row};${row === 'Q1 Étiquettes' ? onHold : 'Planifié'}`)];
  const projects = await twice('portfolio_projects', 'projets Q1.csv', [
    { column: 'name', source: 1, confidence: 'high' },
    { column: 'status', source: 2, confidence: 'high', values: { 'Planifié': 'planned', 'En attente': 'on_hold' } },
  ], projectFile('Planifié'), projectFile('En attente'));
  const [project] = await runner.query(`SELECT item_number FROM portfolio_projects WHERE tenant_id = $1 AND name = 'Q1 Étiquettes'`, [s.tenantId]);
  const projectCheck = projects.validation;
  assert.equal(projectCheck.ok, true, JSON.stringify(projectCheck));
  assert.deepEqual([projectCheck.inserted, projectCheck.updated, projectCheck.unchanged], [0, 1, 4]);
  assert.deepEqual(projectCheck.report.updates, [{ row: 6, ref: `PRJ-${project.item_number}`, name: 'Q1 Étiquettes' }]);
  assert.equal(projectCheck.report.updatesTotal, 1);
  assert.equal(projects.on_approval, `On approval: 0 records created, 1 updated (file line 6: PRJ-${project.item_number} Q1 Étiquettes), 4 unchanged.`);

  // Applications: the same, by their APP-n reference.
  const appFile = (criticality: string) => ['Appli;Criticité', 'Q1 Atlas;Faible', ';', `Q1 Hermes;${criticality}`, 'Q1 Iris;Faible'];
  const apps = await twice('applications', 'applications Q1.csv', [
    { column: 'name', source: 1, confidence: 'high' },
    { column: 'criticality', source: 2, confidence: 'high', values: { Faible: 'Low', Critique: 'Critical' } },
  ], appFile('Faible'), appFile('Critique'));
  const [app] = await runner.query(`SELECT sequential_id FROM applications WHERE tenant_id = $1 AND name = 'Q1 Hermes'`, [s.tenantId]);
  assert.match(app.sequential_id, /^APP-\d+$/);
  assert.deepEqual([apps.validation.updated, apps.validation.unchanged], [1, 2]);
  assert.deepEqual(apps.validation.report.updates, [{ row: 4, ref: app.sequential_id, name: 'Q1 Hermes' }]);

  // A master-data import (suppliers, SUP-n), and one whose family has no reference (cost centers, by name).
  const supplierColumns = [{ column: 'name', source: 1, confidence: 'high' }, { column: 'erp_supplier_id', source: 2, confidence: 'high' }];
  const suppliers = await twice('suppliers', 'fournisseurs Q1.csv', supplierColumns,
    ['Fournisseur;ERP', 'Q1 Lactalis;Q1-1', 'Q1 Savencia;Q1-2'], ['Fournisseur;ERP', 'Q1 Lactalis;Q1-1', 'Q1 Savencia;Q1-3']);
  const [supplier] = await runner.query(`SELECT item_number FROM suppliers WHERE tenant_id = $1 AND name = 'Q1 Savencia'`, [s.tenantId]);
  assert.deepEqual(suppliers.validation.report.updates, [{ row: 3, ref: `SUP-${supplier.item_number}`, name: 'Q1 Savencia' }]);
  const centerColumns = [
    { column: 'code', source: 1, confidence: 'high' }, { column: 'name', source: 2, confidence: 'high' }, { column: 'kind', source: 3, confidence: 'high' },
  ];
  const centers = await twice('cost_centers', 'centres Q1.csv', centerColumns,
    ['Code;Nom;Type', 'Q1-CC1;Q1 Caves;group', 'Q1-CC2;Q1 Siège;group'],
    ['Code;Nom;Type', 'Q1-CC1;Q1 Caves;group', 'Q1-CC2;Q1 Siège social;group']);
  assert.deepEqual(centers.validation.report.updates?.map((entry: any) => [entry.row, entry.ref]), [[3, null]]);
  console.log('  updates named: projects, applications, suppliers, cost centers on the person\'s lines: OK');
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
      await testOwnersAndResidency(harness, runner, s);
      await testProjects(harness, runner, s);
      await testPreparedFile(harness, runner, s);
      await testIncidentRights(harness, runner, s);
      await testBudgetFile(harness, runner, s);
      await testApplicationsClear(harness, runner, s);
      await testFiveOwners(harness, runner, s);
      await testSuppliers(harness, runner, s);
      await testSupplierNamesBeyondCase(harness, runner, s);
      await testContractNamesBeyondCase(harness, runner, s);
      await testSupplierProposals(harness, runner, s);
      await testContractMatchUndoneByTheRoute(harness, runner, s);
      await testProposalsOfTheOtherImports(harness, runner, s);
      await testLinkServerNameUndoneByTheRoute(harness, runner, s);
      await testServerVersionAndHosting(harness, runner, s);
      await testHostingNeedsTheSites(harness, runner, s);
      await testPreparedFileKeepsEveryProposal(harness, runner, s);
      await testUpdatesNamed(harness, runner, s);
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
