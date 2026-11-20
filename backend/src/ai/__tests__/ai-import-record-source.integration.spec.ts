import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { seedManagedDocsKnowledgeAssets } from '../../knowledge/integrated-document-seed';

// Lot I5 of 26.11.9: an import leaves the same trace on the screen and through Kad. The history row of
// each record an import creates or changes carries the person on the screen (`user`), and Kad's card
// through Kad (`ai_chat`, `source_ref` = the approved card), as any other write of Kad.
// - One family of each path of the source: the applications and their owners and residency (the
//   shared import), the suppliers (an option the service had), the contracts (the option added), the
//   cost centers (the caller), the accounts, a server's technology link, the budget file.
// - The contacts and the servers: one row per record created or changed, read by the record history
//   with the expected actor; an unchanged row writes none; a contact's supplier changed with its
//   values is one row.
// - A task the import attaches to a contract shows in the contract's history, as on the screen.
// The screen is the same service, called as its route calls it: the import runner without Kad's card.
// The AI surface checks and the attachment storage are not under test: stubbed.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-import-record-source-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; previews: any; mapping: any; runner: any; files: Map<string, { name: string; buffer: Buffer }> };
type Seed = { tenantId: string; userId: string; email: string; conversationId: string };
type Column = { column: string; source?: number; value?: string; confidence: string; values?: Record<string, string> };
type AuditRow = { id: string; table_name: string; record_id: string | null; action: string; source: string; source_ref: string | null; user_id: string | null; before_json: any; after_json: any; parent_table: string | null; parent_id: string | null };

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-import-record-source.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiMutationPreviewService } = require('../ai-mutation-preview.service');
  const { AiPolicyService } = require('../ai-policy.service');
  const { AiAttachmentService } = require('../ai-attachment.service');
  const { AiImportMappingService } = require('../import/ai-import-mapping.service');
  const { AiImportRunnerService } = require('../import/ai-import-runner.service');
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
    mapping: app.get(AiImportMappingService),
    runner: app.get(AiImportRunnerService),
    files,
  };
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `ai-i5b-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  await seedManagedDocsKnowledgeAssets(runner.manager as any, tenantId);
  const [role] = await runner.query(`INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Administrator', 'Administrator') RETURNING id`, [tenantId]);
  const email = `admin-${slug}@example.test`;
  const [user] = await runner.query(
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, locale) VALUES ($1, $2, 'Admin', 'Tester', $3, 'enabled', 'en') RETURNING id`,
    [tenantId, email, role.id],
  );
  const conversationId = randomUUID();
  await runner.query(
    `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
     VALUES ($1, $2, $3, 'AI import record source', 'custom', 'import-model', 'custom', now(), now())`,
    [conversationId, tenantId, user.id],
  );
  return { tenantId, userId: user.id, email, conversationId };
}

function ctx(runner: QueryRunner, s: Seed) {
  return {
    tenantId: s.tenantId, userId: s.userId, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const,
    manager: runner.manager, conversationId: s.conversationId,
  };
}

function attach(h: Harness, name: string, lines: string[]): string {
  const id = randomUUID();
  h.files.set(id, { name, buffer: Buffer.from(lines.join('\n'), 'utf8') });
  return id;
}

/** The ids of the tenant's audit rows so far: what a step writes is what is not in it. */
async function mark(runner: QueryRunner, s: Seed): Promise<Set<string>> {
  const rows: Array<{ id: string }> = await runner.query(`SELECT id::text AS id FROM audit_log WHERE tenant_id = $1`, [s.tenantId]);
  return new Set(rows.map((row) => row.id));
}

/** The record rows a step wrote: every audit row since `before` but the import's own row (pass A's subject). */
async function written(runner: QueryRunner, s: Seed, before: Set<string>): Promise<AuditRow[]> {
  const rows: AuditRow[] = await runner.query(
    `SELECT id::text AS id, table_name, record_id::text AS record_id, action, source, source_ref, user_id::text AS user_id, before_json, after_json, parent_table, parent_id::text AS parent_id
       FROM audit_log WHERE tenant_id = $1 AND table_name <> 'import' ORDER BY created_at, id`,
    [s.tenantId],
  );
  return rows.filter((row) => !before.has(row.id));
}

/** Kad: the card prepared, checked and approved. Returns the card's id and the record rows it wrote. */
async function byKad(h: Harness, runner: QueryRunner, s: Seed, key: string, name: string, lines: string[], columns: Column[]) {
  const before = await mark(runner, s);
  const card = await h.previews.createPreview(ctx(runner, s), 'prepare_import_mapping', { attachment_id: attach(h, name, lines), entity_type: key, columns });
  assert.equal(card.import_mapping.validation.ok, true, `${key}: ${JSON.stringify(card.import_mapping.validation)}`);
  const done = await h.previews.executePreview(ctx(runner, s), card.preview_id);
  assert.equal(done.status, 'executed', `${key}: ${done.error_message ?? ''}`);
  return { cardId: card.preview_id as string, rows: await written(runner, s, before) };
}

/** The screen: the same file, through the same import service as its route, without Kad's card. */
async function byScreen(h: Harness, runner: QueryRunner, s: Seed, key: string, name: string, lines: string[], columns: Column[]) {
  const before = await mark(runner, s);
  const input = { attachment_id: attach(h, name, lines), entity_type: key, columns };
  const prepared = await h.mapping.preparedFile(ctx(runner, s), input, 'en');
  const rows = Array.from({ length: prepared.rows }, (_, i) => i + 2);
  const result = await h.runner.run(key, prepared.content, { dryRun: false, language: 'en', lines: rows }, ctx(runner, s));
  assert.equal(result.ok, true, `${key} (screen): ${JSON.stringify(result)}`);
  return { rows: await written(runner, s, before) };
}

function assertKad(label: string, rows: AuditRow[], cardId: string, tables: string[]) {
  for (const table of tables) assert.ok(rows.some((row) => row.table_name === table), `${label}: a ${table} row is written (${JSON.stringify(rows.map((row) => row.table_name))})`);
  for (const row of rows) {
    assert.deepEqual([row.table_name, row.source, row.source_ref], [row.table_name, 'ai_chat', cardId], `${label}: ${row.table_name} ${row.action} written as ${row.source} ${row.source_ref}`);
  }
}

function assertScreen(label: string, rows: AuditRow[], tables: string[], source = 'user') {
  for (const table of tables) assert.ok(rows.some((row) => row.table_name === table), `${label}: a ${table} row is written (${JSON.stringify(rows.map((row) => row.table_name))})`);
  for (const row of rows) {
    assert.deepEqual([row.table_name, row.source, row.source_ref], [row.table_name, source, null], `${label}: ${row.table_name} ${row.action} written as ${row.source} ${row.source_ref}`);
  }
}

async function history(runner: QueryRunner, s: Seed, table: string, id: string) {
  const { RecordHistoryService } = require('../../audit/record-history.service');
  const page = await new RecordHistoryService().list(
    { tenantId: s.tenantId, userId: s.userId, isAdmin: true, permissions: {}, manager: runner.manager },
    table,
    id,
  );
  return page.items as Array<{ action: string; actor: { kind: string; name: string | null }; changes: unknown[] }>;
}

const name = (column: string, source: number): Column => ({ column, source, confidence: 'high' });

async function testApplications(h: Harness, runner: QueryRunner, s: Seed) {
  const columns = [name('name', 1), name('business_owner_email_1', 2), name('data_residency', 3)];
  const kad = await byKad(h, runner, s, 'applications', 'Applis.csv', ['Nom;Responsable;Résidence', `Appli K5;${s.email};FR`], columns);
  assertKad('applications', kad.rows, kad.cardId, ['applications', 'application_owners', 'application_data_residency']);
  const screen = await byScreen(h, runner, s, 'applications', 'Applis.csv', ['Nom;Responsable;Résidence', `Appli E5;${s.email};DE`], columns);
  assertScreen('applications', screen.rows, ['applications', 'application_owners', 'application_data_residency']);
  console.log('  applications, owners and residency: Kad\'s card through Kad, the person on the screen: OK');
}

async function testSuppliers(h: Harness, runner: QueryRunner, s: Seed) {
  const kad = await byKad(h, runner, s, 'suppliers', 'Fournisseurs.csv', ['Nom', 'Fournisseur K5'], [name('name', 1)]);
  assertKad('suppliers', kad.rows, kad.cardId, ['suppliers']);
  const screen = await byScreen(h, runner, s, 'suppliers', 'Fournisseurs.csv', ['Nom', 'Fournisseur E5'], [name('name', 1)]);
  assertScreen('suppliers', screen.rows, ['suppliers']);
  console.log('  suppliers: OK');
}

async function testContracts(h: Harness, runner: QueryRunner, s: Seed) {
  await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Société K5', 'FR', 'Lyon')`, [s.tenantId]);
  await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Fournisseur C5'), ($1, 'Fournisseur D5')`, [s.tenantId]);
  const columns = [name('name', 1), name('company_name', 2), name('supplier_name', 3), name('start_date', 4)];
  const header = 'Contrat;Société;Fournisseur;Début';
  const kad = await byKad(h, runner, s, 'contracts', 'Contrats.csv', [header, 'Contrat K5;Société K5;Fournisseur C5;2026-01-01'], columns);
  assertKad('contracts', kad.rows, kad.cardId, ['contracts']);
  const screen = await byScreen(h, runner, s, 'contracts', 'Contrats.csv', [header, 'Contrat E5;Société K5;Fournisseur D5;2026-01-01'], columns);
  assertScreen('contracts', screen.rows, ['contracts']);
  console.log('  contracts: OK');
}

async function testCostCenters(h: Harness, runner: QueryRunner, s: Seed) {
  const columns = [name('code', 1), name('kind', 2), name('name', 3)];
  const kad = await byKad(h, runner, s, 'cost_centers', 'Centres.csv', ['Code;Type;Nom', 'K5;group;Groupe K5'], columns);
  assertKad('cost_centers', kad.rows, kad.cardId, ['cost_centers']);
  const screen = await byScreen(h, runner, s, 'cost_centers', 'Centres.csv', ['Code;Type;Nom', 'E5;group;Groupe E5'], columns);
  assertScreen('cost_centers', screen.rows, ['cost_centers']);
  console.log('  cost centers: OK');
}

async function testAccounts(h: Harness, runner: QueryRunner, s: Seed) {
  await runner.query(`INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'PCGK5', 'Plan K5', 'FR')`, [s.tenantId]);
  const columns = [name('coa_code', 1), name('account_number', 2), name('account_name', 3)];
  const kad = await byKad(h, runner, s, 'accounts', 'Comptes.csv', ['Plan;Numéro;Libellé', 'PCGK5;6150;Entretien K5'], columns);
  assertKad('accounts', kad.rows, kad.cardId, ['accounts']);
  const screen = await byScreen(h, runner, s, 'accounts', 'Comptes.csv', ['Plan;Numéro;Libellé', 'PCGK5;6160;Entretien E5'], columns);
  assertScreen('accounts', screen.rows, ['accounts']);
  console.log('  accounts: OK');
}

async function testTechnologyLinks(h: Harness, runner: QueryRunner, s: Seed) {
  await runner.query(
    `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, 'srv-lien-k5', 'virtual_machine', 'prod'), ($1, 'srv-lien-e5', 'virtual_machine', 'prod')`,
    [s.tenantId],
  );
  // An operating system on a server that has none: the import marks it (pass D of lot I5).
  await runner.query(
    `INSERT INTO technologies (tenant_id, item_number, name, family) VALUES ($1, 5501, 'Moteur K5', 'other'), ($1, 5502, 'Système K5', 'operating_system')`,
    [s.tenantId],
  );
  const columns = [name('asset_name', 1), name('technology_name', 2)];
  const kad = await byKad(h, runner, s, 'technology_asset_links', 'Liens.csv', ['Serveur;Technologie', 'srv-lien-k5;Moteur K5', 'srv-lien-k5;Système K5'], columns);
  assertKad('technology links', kad.rows, kad.cardId, ['asset_technologies']);
  assert.ok(kad.rows.some((row) => row.table_name === 'asset_technologies' && row.after_json?.is_operating_system === true), 'the operating system is marked');
  const screen = await byScreen(h, runner, s, 'technology_asset_links', 'Liens.csv', ['Serveur;Technologie', 'srv-lien-e5;Moteur K5', 'srv-lien-e5;Système K5'], columns);
  assertScreen('technology links', screen.rows, ['asset_technologies']);
  console.log('  a server\'s technology link: OK');
}

async function testBudgetFile(h: Harness, runner: QueryRunner, s: Seed) {
  const chart = (await runner.query(`INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'PCGB5', 'Plan B5', 'FR') RETURNING id`, [s.tenantId]))[0].id;
  await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, 'Fromagerie B5', 'FR', 'Lyon', $2)`, [s.tenantId, chart]);
  await runner.query(`INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, 6000, 'Achats')`, [s.tenantId, chart]);
  const year = new Date().getFullYear();
  const columns: Column[] = [
    { column: 'nature', source: 1, confidence: 'high', values: { Fonctionnement: 'opex', Investissement: 'capex' } },
    name('name', 2),
    name('company_name', 3),
    name('account_number', 4),
    name('supplier_name', 5),
    { column: 'currency', value: 'EUR', confidence: 'high' },
    name(`budget_${year}`, 6),
  ];
  const header = `Nature;Libellé;Société;Compte;Fournisseur;Budget ${year}`;
  // A supplier the file creates: its row follows the same rule as the lines'.
  const kad = await byKad(h, runner, s, 'budget_lines', 'budget.csv', [
    header,
    'Fonctionnement;Licences B5;Fromagerie B5;6000;Éditeur K5;1200',
    'Investissement;Serveurs B5;Fromagerie B5;6000;;8000',
  ], columns);
  assertKad('budget file', kad.rows, kad.cardId, ['spend_items', 'capex_items', 'suppliers']);
  const screen = await byScreen(h, runner, s, 'budget_lines', 'budget.csv', [
    header,
    'Fonctionnement;Licences E5;Fromagerie B5;6000;Éditeur E5;1200',
  ], columns);
  // On the screen the budget file keeps its own source (actor "Import").
  assertScreen('budget file', screen.rows, ['spend_items', 'suppliers'], 'budget_file');
  console.log('  the budget file: Kad\'s card through Kad, `budget_file` on the screen: OK');
}

async function testContacts(h: Harness, runner: QueryRunner, s: Seed) {
  const insert = async (email: string, job: string) => (await runner.query(
    `INSERT INTO contacts (tenant_id, email, first_name, last_name, job_title) VALUES ($1, $2, 'Camille', $2, $3) RETURNING id`,
    [s.tenantId, email, job],
  ))[0].id as string;
  await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Fournisseur T5')`, [s.tenantId]);
  const columns = [name('email', 1), name('job_title', 2), name('supplier_name', 3)];
  const header = 'Courriel;Fonction;Fournisseur';
  for (const [via, tag] of [['kad', 'k5'], ['screen', 'e5']] as const) {
    const changed = await insert(`changed-${tag}@example.test`, 'Ancienne');
    const same = await insert(`same-${tag}@example.test`, 'Stable');
    const file = [
      header,
      `new-${tag}@example.test;Nouvelle;`,
      // The values and the main supplier of one contact: one gesture, one row.
      `changed-${tag}@example.test;Nouvelle;Fournisseur T5`,
      `same-${tag}@example.test;Stable;`,
    ];
    const run = via === 'kad'
      ? await byKad(h, runner, s, 'contacts', 'Contacts.csv', file, columns)
      : { cardId: null, ...(await byScreen(h, runner, s, 'contacts', 'Contacts.csv', file, columns)) };
    const [created] = await runner.query(`SELECT id::text AS id FROM contacts WHERE tenant_id = $1 AND email = $2`, [s.tenantId, `new-${tag}@example.test`]);
    const contactRows = run.rows.filter((row) => row.table_name === 'contacts');
    assert.deepEqual(
      contactRows.map((row) => [row.record_id, row.action]).sort(),
      [[created.id, 'create'], [changed, 'update']].sort(),
      `${via}: one row per contact created or changed, none for the unchanged one`,
    );
    const update = contactRows.find((row) => row.record_id === changed)!;
    assert.equal(update.before_json.job_title, 'Ancienne');
    assert.equal(update.before_json.supplier_id, null);
    assert.equal(update.after_json.job_title, 'Nouvelle');
    assert.ok(update.after_json.supplier_id, `${via}: the supplier is in the same row`);
    assert.ok(run.rows.some((row) => row.table_name === 'supplier_contacts'), `${via}: the main supplier link is audited`);
    if (via === 'kad') assertKad('contacts', run.rows, run.cardId!, ['contacts']);
    else assertScreen('contacts', run.rows, ['contacts']);
    const actor = via === 'kad' ? 'assistant' : 'user';
    for (const id of [created.id, changed]) {
      const items = await history(runner, s, 'contacts', id);
      assert.ok(items.length > 0, `${via}: the contact's history shows the import`);
      assert.ok(items.every((item) => item.actor.kind === actor), `${via}: ${JSON.stringify(items.map((item) => item.actor))}`);
      assert.equal(items[0].actor.name, 'Admin Tester');
    }
    assert.deepEqual(await history(runner, s, 'contacts', same), [], `${via}: the unchanged contact has no row`);
  }
  console.log('  contacts: one row per contact created or changed, the supplier in the same row, read by the history: OK');
}

async function testServers(h: Harness, runner: QueryRunner, s: Seed) {
  await runner.query(`INSERT INTO locations (tenant_id, location_reference, name, hosting_type) VALUES ($1, 'LOC-5501', 'Salle K5', 'on_prem')`, [s.tenantId]);
  const columns = [name('name', 1), name('kind', 2), name('environment', 3), name('location_reference', 4)];
  const header = 'Nom;Type;Environnement;Site';
  for (const [via, tag] of [['kad', 'k5'], ['screen', 'e5']] as const) {
    const [changed] = await runner.query(
      `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, $2, 'virtual_machine', 'dev') RETURNING id::text AS id`,
      [s.tenantId, `srv-changed-${tag}`],
    );
    const [same] = await runner.query(
      `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, $2, 'virtual_machine', 'prod') RETURNING id::text AS id`,
      [s.tenantId, `srv-same-${tag}`],
    );
    // A blank site keeps the stored one: only the new server names it.
    const file = [header, `srv-new-${tag};virtual_machine;prod;LOC-5501`, `srv-changed-${tag};virtual_machine;prod;`, `srv-same-${tag};virtual_machine;prod;`];
    const run = via === 'kad'
      ? await byKad(h, runner, s, 'assets', 'Serveurs.csv', file, columns)
      : { cardId: null, ...(await byScreen(h, runner, s, 'assets', 'Serveurs.csv', file, columns)) };
    const [created] = await runner.query(`SELECT id::text AS id FROM assets WHERE tenant_id = $1 AND name = $2`, [s.tenantId, `srv-new-${tag}`]);
    const assetRows = run.rows.filter((row) => row.table_name === 'assets');
    assert.deepEqual(
      assetRows.map((row) => [row.record_id, row.action]).sort(),
      [[created.id, 'create'], [changed.id, 'update']].sort(),
      `${via}: one row per server created or changed, none for the unchanged one`,
    );
    if (via === 'kad') assertKad('servers', run.rows, run.cardId!, ['assets']);
    else assertScreen('servers', run.rows, ['assets']);
    const actor = via === 'kad' ? 'assistant' : 'user';
    const createdItems = await history(runner, s, 'assets', created.id);
    assert.deepEqual(createdItems.map((item) => [item.action, item.actor.kind]), [['create', actor]]);
    const changedItems = await history(runner, s, 'assets', changed.id);
    assert.deepEqual(changedItems.map((item) => [item.action, item.actor.kind]), [['update', actor]]);
    // Read as a change made on the screen: the environment, from dev to prod.
    assert.ok(JSON.stringify(changedItems[0].changes).includes('environment'), JSON.stringify(changedItems[0].changes));
    assert.deepEqual(await history(runner, s, 'assets', same.id), [], `${via}: the unchanged server has no row`);
  }
  console.log('  servers: one row per server created or changed, read by the history: OK');
}

/** The rows of the server's operating-system links and of the clusters' memberships among `rows`. */
const linkRows = (rows: AuditRow[]) => rows.filter((row) => row.table_name === 'asset_technologies' || row.table_name === 'asset_cluster_members');

/**
 * A server's operating system and clusters (pass D of lot I5): the rows of its operating-system link
 * (created, marked with a version, deleted when another one takes its place) and of the cluster's
 * memberships carry Kad's card through Kad, the person on the screen; Kad's direct write of a
 * server's operating system carries its card too.
 */
async function testServerOperatingSystemsAndClusters(h: Harness, runner: QueryRunner, s: Seed) {
  const columns = [name('name', 1), name('kind', 2), name('environment', 3), name('operating_system', 4), name('cluster', 5)];
  const header = 'Nom;Type;Environnement;Système;Cluster';
  for (const [via, tag] of [['kad', 'k5'], ['screen', 'e5']] as const) {
    await runner.query(
      `INSERT INTO assets (tenant_id, name, kind, environment, is_cluster) VALUES ($1, $2, 'virtual_machine', 'prod', true), ($1, $3, 'virtual_machine', 'prod', false)`,
      [s.tenantId, `clu-os-${tag}`, `srv-os-${tag}`],
    );
    // A first system and a cluster, then another system (the first link deleted), then its version (the link marked anew).
    const steps = [`Zorglux ${tag};clu-os-${tag}`, `Quarkos ${tag};clu-os-${tag}`, `Quarkos ${tag} 2;clu-os-${tag}`];
    const actions: string[][] = [];
    for (const step of steps) {
      const file = [header, `srv-os-${tag};virtual_machine;prod;${step}`];
      const run = via === 'kad'
        ? await byKad(h, runner, s, 'assets', 'Serveurs.csv', file, columns)
        : { cardId: null, ...(await byScreen(h, runner, s, 'assets', 'Serveurs.csv', file, columns)) };
      const links = linkRows(run.rows);
      actions.push(links.map((row) => `${row.table_name} ${row.action}`));
      for (const row of links) {
        const expected = via === 'kad' ? ['ai_chat', run.cardId] : ['user', null];
        assert.deepEqual([row.source, row.source_ref], expected, `${via}, ${step}: ${row.table_name} ${row.action} written as ${row.source} ${row.source_ref}`);
      }
    }
    assert.deepEqual(actions, [
      ['asset_technologies create', 'asset_cluster_members update'],
      ['asset_technologies delete', 'asset_technologies create'],
      ['asset_technologies update'],
    ], `${via}: the rows of the operating system and of the cluster`);
  }

  // Kad's direct write of a server's operating system: its card on the link's rows. (Its card reads a
  // stored operating system as none, so a server that has one is not the case here.)
  const [server] = await runner.query(
    `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, 'srv-os-direct', 'virtual_machine', 'prod') RETURNING id::text AS id`,
    [s.tenantId],
  );
  {
    const system = 'Zorglux direct';
    const before = await mark(runner, s);
    const card = await h.previews.createPreview(ctx(runner, s), 'update_business_record', { entity_type: 'assets', ref: server.id, fields: { operating_system: system } });
    const done = await h.previews.executePreview(ctx(runner, s), card.preview_id);
    assert.equal(done.status, 'executed', done.error_message ?? '');
    const links = linkRows(await written(runner, s, before));
    assert.ok(links.length > 0, `${system}: the link is written`);
    for (const row of links) {
      assert.deepEqual([row.source, row.source_ref], ['ai_chat', card.preview_id], `${system}: ${row.table_name} ${row.action} written as ${row.source} ${row.source_ref}`);
    }
  }
  console.log('  a server\'s operating system and clusters, imported and written by Kad: Kad\'s card; on the screen, the person: OK');
}

/**
 * The integrated documents a project, a request or an incident import creates (pass E of lot I5): their
 * rows carry Kad's card through Kad, the person on the screen, as the record's own row.
 */
async function testIntegratedDocuments(h: Harness, runner: QueryRunner, s: Seed) {
  for (const [key, titleColumn, textColumn] of [['portfolio_projects', 'name', 'purpose'], ['portfolio_requests', 'name', 'purpose'], ['incidents', 'title', 'review']]) {
    for (const [via, tag] of [['kad', 'k'], ['screen', 'e']] as const) {
      const check = (label: string, run: { cardId: string | null; rows: AuditRow[] }) => {
        if (via === 'kad') assertKad(label, run.rows, run.cardId!, ['documents']);
        else assertScreen(label, run.rows, ['documents']);
        for (const row of run.rows) assert.equal(row.user_id, s.userId, `${label}: ${row.table_name} ${row.action} names the person`);
        return run.rows.map((row) => `${row.table_name} ${row.action}`);
      };
      const load = (lines: string[], columns: Column[]) => (via === 'kad'
        ? byKad(h, runner, s, key, `${key}.csv`, lines, columns)
        : byScreen(h, runner, s, key, `${key}.csv`, lines, columns).then((run) => ({ cardId: null, ...run })));
      const title = `${key} E5 ${tag}`;
      if (key === 'incidents') {
        // An incident is created by each row (the template has no reference): its review provisioned,
        // then written with the row's text.
        const run = await load(['Titre;Gravité;Analyse', `${title};major;Analyse E5 ${tag}`], [name(titleColumn, 1), name('severity', 2), name(textColumn, 3)]);
        const actions = check(`${key} ${via}`, run);
        assert.ok(actions.includes('incidents create') && actions.includes('documents create') && actions.includes('documents update'), `${key} ${via}: ${JSON.stringify(actions)}`);
        continue;
      }
      // A project or a request created with its documents, then matched by its name: its purpose written anew.
      const created = check(`${key} ${via}, created`, await load(['Nom', title], [name(titleColumn, 1)]));
      assert.ok(created.includes(`${key} create`) && created.includes('documents create'), `${key} ${via}: ${JSON.stringify(created)}`);
      const updated = check(`${key} ${via}, updated`, await load(['Nom;Objectif', `${title};Objectif E5 ${tag}`], [name(titleColumn, 1), name(textColumn, 2)]));
      assert.ok(updated.includes('documents update'), `${key} ${via}: ${JSON.stringify(updated)}`);
    }
  }
  console.log('  the integrated documents of an imported project, request or incident: Kad\'s card; on the screen, the person: OK');
}

async function testTaskOfAContract(h: Harness, runner: QueryRunner, s: Seed) {
  const [company] = await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Société T5', 'FR', 'Lyon') RETURNING id`, [s.tenantId]);
  const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Fournisseur X5') RETURNING id`, [s.tenantId]);
  const [contract] = await runner.query(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'Contrat T5', $2, $3, '2026-01-01') RETURNING id::text AS id`,
    [s.tenantId, company.id, supplier.id],
  );
  const columns = [name('title', 1), name('related_object_type', 2), name('related_object_id', 3)];
  const kad = await byKad(h, runner, s, 'tasks', 'Tâches.csv', ['Titre;Type;Objet', `Renouveler K5;contract;${contract.id}`], columns);
  assertKad('tasks', kad.rows, kad.cardId, ['tasks']);
  const task = kad.rows.find((row) => row.table_name === 'tasks')!;
  // The row names the contract it belongs to, as the screen's write does: the contract's history shows it.
  assert.deepEqual([task.parent_table, task.parent_id], ['contracts', contract.id]);
  const items = await history(runner, s, 'contracts', contract.id);
  assert.ok(items.some((item) => item.action === 'create' && item.actor.kind === 'assistant' && JSON.stringify(item).includes('Renouveler K5')), JSON.stringify(items));
  console.log('  a task imported onto a contract: in the contract\'s history: OK');
}

async function run() {
  const failures: string[] = [];
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      const tests = [
        testApplications, testSuppliers, testContracts, testCostCenters, testAccounts, testTechnologyLinks,
        testBudgetFile, testContacts, testServers, testServerOperatingSystemsAndClusters, testTaskOfAContract,
        testIntegratedDocuments,
      ];
      // Each family under its own savepoint: one that fails is reported, and the next ones still run.
      for (const test of tests) {
        await runner.query('SAVEPOINT family');
        try {
          await test(harness, runner, s);
          await runner.query('RELEASE SAVEPOINT family');
        } catch (error) {
          await runner.query('ROLLBACK TO SAVEPOINT family');
          failures.push(`${test.name}: ${(error as Error).message.split('\n')[0]}`);
          console.log(`  FAILED ${test.name}: ${(error as Error).message.split('\n')[0]}`);
        }
      }
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  if (failures.length > 0) throw new Error(`${failures.length} failed:\n${failures.join('\n')}`);
  console.log('ai-import-record-source.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
