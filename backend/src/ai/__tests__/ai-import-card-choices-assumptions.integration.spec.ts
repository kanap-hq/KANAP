import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Lot I6a of 26.12.1: Kad's import card says the state of the moment. The model's assumptions were
// written for the card it prepared: a card born of the person's choice (a match undone, matched again,
// a row created anyway, the "Create missing suppliers" box) shows none, even once the choices are back
// to the first card's. The note of a column whose match the person undid is gone, and back once the
// column is matched again. The first card keeps both. The model is not called: the tools are, as the
// conversation calls them. The AI surface checks and the attachment storage are not under test: stubbed.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-import-card-choices-assumptions-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; previews: any; files: Map<string, { name: string; buffer: Buffer }> };
type Seed = { tenantId: string; userId: string; conversationId: string };

const YEAR = new Date().getFullYear();
const ASSUMPTIONS = ['Les montants sont en euros.', 'La colonne « Commentaire » est laissée de côté.'];

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-import-card-choices-assumptions.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiMutationPreviewService } = require('../ai-mutation-preview.service');
  const { AiPolicyService } = require('../ai-policy.service');
  const { AiAttachmentService } = require('../ai-attachment.service');
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
  return { app, dataSource: app.get(DataSource), previews: app.get(AiMutationPreviewService), files };
}

/** A French workspace: an administrator, a chart of accounts, the supplier Cégid, the application Comptabilité. */
async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `ai-i6a-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const [chart] = await runner.query(
    `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'PCG', 'Plan comptable', 'FR') RETURNING id`, [tenantId],
  );
  await runner.query(`INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, 'Brasserie du Port', 'FR', 'Lorient', $2)`, [tenantId, chart.id]);
  await runner.query(`INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, 6135, 'Locations logicielles')`, [tenantId, chart.id]);
  await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Cégid')`, [tenantId]);
  await runner.query(`INSERT INTO applications (tenant_id, name, description) VALUES ($1, 'Comptabilité', 'Ledger')`, [tenantId]);
  const [role] = await runner.query(`INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Administrator', 'Administrator') RETURNING id`, [tenantId]);
  const [user] = await runner.query(
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, locale) VALUES ($1, $2, 'Yann', 'Le Goff', $3, 'enabled', 'fr') RETURNING id`,
    [tenantId, `admin-${slug}@example.test`, role.id],
  );
  const conversationId = randomUUID();
  await runner.query(
    `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
     VALUES ($1, $2, $3, 'Import', 'custom', 'import-model', 'custom', now(), now())`,
    [conversationId, tenantId, user.id],
  );
  return { tenantId, userId: user.id, conversationId };
}

function ctx(runner: QueryRunner, s: Seed) {
  return {
    tenantId: s.tenantId, userId: s.userId, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const,
    manager: runner.manager, conversationId: s.conversationId,
  };
}

function attach(h: Harness, name: string, rows: unknown[][]): string {
  const { writeXlsx } = require('../../common/xlsx');
  const id = randomUUID();
  h.files.set(id, { name, buffer: writeXlsx({ language: 'fr', sheets: [{ name: 'Feuille', header: 'plain', headers: rows[0], rows: rows.slice(1) }] }) });
  return id;
}

const notesOf = (card: any) => Object.fromEntries(card.import_mapping.columns.map((column: any) => [column.column, column.note]));

/** The applications: the supplier "cegid" matched to Cégid, a row that looks like Comptabilité. */
async function testApplications(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s);
  const attachment = attach(h, 'Applications.xlsx', [
    ['Nom', 'Fournisseur', 'Description'],
    ['Comptabilite', 'cegid', null],
    ['Atlas', 'cegid', 'Cartes'],
  ]);
  const columns = [
    { column: 'name', source: 1, confidence: 'high', note: 'Le nom de l\'application.' },
    { column: 'supplier_name', source: 2, confidence: 'high', note: 'cegid rapproché du fournisseur Cégid.' },
    { column: 'description', source: 3, confidence: 'high', note: 'La description.' },
  ];
  const notes = { name: 'Le nom de l\'application.', supplier_name: 'cegid rapproché du fournisseur Cégid.', description: 'La description.' };
  const first = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attachment, entity_type: 'applications', columns, assumptions: ASSUMPTIONS });
  assert.deepEqual(first.import_mapping.assumptions, ASSUMPTIONS, 'the first card keeps the model\'s assumptions');
  assert.deepEqual(notesOf(first), notes);
  assert.deepEqual(first.import_mapping.validation.report.matches.map((match: any) => [match.column, match.value, match.target]), [['supplier_name', 'cegid', 'Cégid']]);

  // Undo the match: the supplier's note and the assumptions are gone.
  const undo = [{ kind: 'unmatch', column: 'supplier_name', value: 'cegid' }];
  const undone = await h.previews.replaceImportChoices(admin, first.preview_id, undo);
  assert.deepEqual(undone.import_mapping.validation.report.undone, [{ column: 'supplier_name', value: 'cegid' }]);
  assert.deepEqual(notesOf(undone), { ...notes, supplier_name: null });
  assert.deepEqual(undone.import_mapping.assumptions, []);

  // Matched again: the note is back; the card stays without the assumptions.
  const again = await h.previews.replaceImportChoices(admin, undone.preview_id, []);
  assert.deepEqual(notesOf(again), notes);
  assert.deepEqual(again.import_mapping.assumptions, []);

  // A choice on a row that looks like Comptabilité: the notes stay, no assumptions.
  const chosen = await h.previews.replaceImportChoices(admin, again.preview_id, [{ kind: 'lookalike', line: 2, action: 'create' }]);
  assert.deepEqual(chosen.import_mapping.validation.report.lookalikes.lines.map((entry: any) => [entry.line, entry.outcome]), [[2, 'created']]);
  assert.deepEqual(notesOf(chosen), notes);
  assert.deepEqual(chosen.import_mapping.assumptions, []);

  // The model calls again for the same file: its new card shows its new assumptions.
  const model = await h.previews.createPreview(admin, 'prepare_import_mapping', {
    attachment_id: attachment, entity_type: 'applications', columns, assumptions: ['Une seule feuille.'],
  });
  assert.deepEqual(model.import_mapping.assumptions, ['Une seule feuille.']);
  console.log('  applications: undone, matched again, a row chosen: notes follow the matches, no assumptions after a choice: OK');
}

/** The budget file: the supplier "CEGID" matched to Cégid; the "Create missing suppliers" box. */
async function testBudgetFile(h: Harness, runner: QueryRunner, s: Seed) {
  const admin = ctx(runner, s);
  const attachment = attach(h, 'Budget.xlsx', [
    ['Type', 'Libellé', 'Fournisseur', `Budget ${YEAR}`],
    ['opex', 'Licences comptables', 'CEGID', { kind: 'number', value: 9600 }],
    ['opex', 'Hébergement', 'OVHcloud', { kind: 'number', value: 4800 }],
  ]);
  const columns = [
    { column: 'nature', source: 1, confidence: 'high', note: 'Toutes les lignes en fonctionnement.' },
    { column: 'name', source: 2, confidence: 'high' },
    { column: 'supplier_name', source: 3, confidence: 'high', note: 'CEGID rapproché du fournisseur Cégid.' },
    { column: 'account_number', value: '6135', confidence: 'medium', note: 'Un seul compte pour toutes les lignes.' },
    { column: 'currency', value: 'EUR', confidence: 'high' },
    { column: `budget_${YEAR}`, source: 4, confidence: 'high' },
  ];
  const notes = {
    nature: 'Toutes les lignes en fonctionnement.', name: null, supplier_name: 'CEGID rapproché du fournisseur Cégid.',
    account_number: 'Un seul compte pour toutes les lignes.', currency: null, [`budget_${YEAR}`]: null,
  };
  const first = await h.previews.createPreview(admin, 'prepare_import_mapping', { attachment_id: attachment, entity_type: 'budget_lines', columns, assumptions: ASSUMPTIONS });
  const check = first.import_mapping.validation;
  assert.equal(check.ok, true, JSON.stringify(check.issues));
  assert.ok(check.report.file.matching.matches.some((match: any) => match.column === 'supplier_name' && match.value === 'CEGID'), 'CEGID matched to Cégid');
  assert.deepEqual(first.import_mapping.assumptions, ASSUMPTIONS);
  assert.deepEqual(notesOf(first), notes);

  const undo = [{ kind: 'unmatch', column: 'supplier_name', value: 'CEGID' }];
  const undone = await h.previews.replaceImportChoices(admin, first.preview_id, undo);
  assert.deepEqual(undone.import_mapping.validation.matching.choices, undo);
  assert.deepEqual(notesOf(undone), { ...notes, supplier_name: null });
  assert.deepEqual(undone.import_mapping.assumptions, []);

  const again = await h.previews.replaceImportChoices(admin, undone.preview_id, []);
  assert.deepEqual(notesOf(again), notes);
  assert.deepEqual(again.import_mapping.assumptions, []);

  const box = await h.previews.replaceImportChoices(admin, again.preview_id, [{ kind: 'create_suppliers', value: false }]);
  assert.deepEqual(notesOf(box), notes);
  assert.deepEqual(box.import_mapping.assumptions, []);
  console.log('  budget file: undone, matched again, the suppliers box: notes follow the matches, no assumptions after a choice: OK');
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
    await inTenant(harness, testApplications);
    await inTenant(harness, testBudgetFile);
  } finally {
    await harness.app.close();
  }
  console.log('ai-import-card-choices-assumptions.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
