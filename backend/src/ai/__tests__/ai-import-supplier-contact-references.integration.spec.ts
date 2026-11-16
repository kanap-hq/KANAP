import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Kad reads the reference column of a supplier or contact file (lot R3 of 26.11.9), as the
// screen's import does: a filled `SUP-n` or `CTCT-n` names the record the row updates (a contact's
// e-mail included), and the check warns of each rename and each new e-mail address (D12). A value
// is a reference for Kad only when it carries the family's prefix: a column "ID" numbering the rows
// 1 to N, mapped onto `reference`, is refused as a whole and updates nothing by its numbers. A file
// without the column updates by name (by e-mail for a contact) and clears nothing.
// The AI surface checks and the attachment storage are not under test: stubbed.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-import-supplier-contact-references-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; previews: any; mapping: any; files: Map<string, { name: string; buffer: Buffer }> };
type Seed = { tenantId: string; userId: string; conversationId: string };

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-import-supplier-contact-references.integration.spec.ts.');
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

function attach(h: Harness, name: string, lines: string[]): string {
  const id = randomUUID();
  h.files.set(id, { name, buffer: Buffer.from(`${lines.join('\n')}\n`, 'utf8') });
  return id;
}

/** An administrator; suppliers Acme (SUP-1), Beta (SUP-2), Gamma (SUP-4); contacts a@x.test Jean Dupont (CTCT-1), b@x.test Anne Morel (CTCT-2). */
async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `ai-r3-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR"}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const [role] = await runner.query(`INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Administrator', 'Administrator') RETURNING id`, [tenantId]);
  const [user] = await runner.query(
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, locale) VALUES ($1, $2, 'Admin', 'Tester', $3, 'enabled', 'en') RETURNING id`,
    [tenantId, `admin-${slug}@example.test`, role.id],
  );
  const conversationId = randomUUID();
  await runner.query(
    `INSERT INTO ai_conversations (id, tenant_id, user_id, title, provider, model, provider_source, created_at, updated_at)
     VALUES ($1, $2, $3, 'AI import references', 'custom', 'import-model', 'custom', now(), now())`,
    [conversationId, tenantId, user.id],
  );
  for (const [name, number] of [['Acme', 1], ['Beta', 2], ['Gamma', 4]] as const) {
    await runner.query(`INSERT INTO suppliers (tenant_id, name, item_number) VALUES ($1, $2, $3)`, [tenantId, name, number]);
  }
  for (const [email, first, last, number] of [['a@x.test', 'Jean', 'Dupont', 1], ['b@x.test', 'Anne', 'Morel', 2]] as const) {
    await runner.query(
      `INSERT INTO contacts (tenant_id, email, first_name, last_name, active, item_number) VALUES ($1, $2, $3, $4, true, $5)`,
      [tenantId, email, first, last, number],
    );
  }
  return { tenantId, userId: user.id, conversationId };
}

function ctx(runner: QueryRunner, s: Seed) {
  return {
    tenantId: s.tenantId, userId: s.userId, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const,
    manager: runner.manager, conversationId: s.conversationId,
  };
}

/** Every column of the file, mapped onto the template column of the same name. */
function sameNames(header: string[]) {
  return header.map((column, index) => ({ column, source: index + 1, confidence: 'high' }));
}

/** The family's file as the export writes it: every column of Kad's template, `reference` first. */
async function headerOf(h: Harness, runner: QueryRunner, s: Seed, family: 'suppliers' | 'contacts'): Promise<string[]> {
  const template = await h.mapping.describeTemplate(ctx(runner, s), family, 'en');
  const columns: string[] = template.columns.map((column: any) => column.column);
  assert.equal(columns[0], 'reference', `${family}: Kad's template leads with the reference`);
  return columns;
}

function rowOf(header: string[], values: Record<string, string>): string {
  return header.map((column) => values[column] ?? (column === 'status' ? 'enabled' : column === 'active' ? 'yes' : '')).join(';');
}

async function suppliers(runner: QueryRunner, s: Seed): Promise<string[]> {
  return (await runner.query(`SELECT 'SUP-' || item_number || ' ' || name AS r FROM suppliers WHERE tenant_id = $1 ORDER BY item_number`, [s.tenantId]))
    .map((row: any) => row.r);
}

async function contacts(runner: QueryRunner, s: Seed): Promise<string[]> {
  return (await runner.query(
    `SELECT 'CTCT-' || item_number || ' ' || coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || email || ' ' || coalesce(job_title, '-') AS r
       FROM contacts WHERE tenant_id = $1 ORDER BY item_number`,
    [s.tenantId],
  )).map((row: any) => row.r);
}

/** The check of a file whose columns are mapped onto `header`; its first line is `fileHeader` (a person's own titles). */
async function check(h: Harness, runner: QueryRunner, s: Seed, family: 'suppliers' | 'contacts', name: string, header: string[], rows: string[], fileHeader = header) {
  const file = attach(h, name, [fileHeader.join(';'), ...rows]);
  const card = await h.previews.createPreview(ctx(runner, s), 'prepare_import_mapping', { attachment_id: file, entity_type: family, columns: sameNames(header) });
  return card;
}

// The export of the suppliers with SUP-4 renamed: one update, its warning, no insertion.
async function testSupplierRename(h: Harness, runner: QueryRunner, s: Seed) {
  const header = await headerOf(h, runner, s, 'suppliers');
  const card = await check(h, runner, s, 'suppliers', 'fournisseurs.csv', header, [
    rowOf(header, { reference: 'SUP-1', name: 'Acme' }),
    rowOf(header, { reference: 'sup-4', name: 'Gamma R9' }),
    rowOf(header, { reference: 'SUP-2', name: 'Beta' }),
  ]);
  const result = card.import_mapping.validation;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual([result.inserted, result.updated, result.unchanged], [0, 1, 2], JSON.stringify(result));
  assert.deepEqual(card.import_mapping.read_errors, {});
  assert.deepEqual(result.report.warnings.map((warning: any) => [warning.row, warning.code, warning.params]), [
    [3, 'CSV_REFERENCE_RENAMES', { reference: 'SUP-4', stored: 'Gamma', name: 'Gamma R9', context: 'supplier' }],
  ]);
  const done = await h.previews.executePreview(ctx(runner, s), card.preview_id);
  assert.equal(done.status, 'executed', done.error_message ?? '');
  assert.deepEqual(await suppliers(runner, s), ['SUP-1 Acme', 'SUP-2 Beta', 'SUP-4 Gamma R9']);
  console.log('  suppliers: SUP-4 renamed by reference, with its warning, nothing inserted: OK');
}

// A column "ID" numbering the rows, mapped onto `reference`: no supplier is updated by those numbers.
async function testSupplierRowNumbers(h: Harness, runner: QueryRunner, s: Seed) {
  const before = await suppliers(runner, s);
  const header = await headerOf(h, runner, s, 'suppliers');
  for (const ids of [['1', '2'], ['SUP-1', '2']]) {
    const card = await check(h, runner, s, 'suppliers', 'fournisseurs.csv', header, [
      rowOf(header, { reference: ids[0], name: 'Delta' }),
      rowOf(header, { reference: ids[1], name: 'Epsilon' }),
    ], ['ID', ...header.slice(1)]);
    const result = card.import_mapping.validation;
    assert.deepEqual(card.import_mapping.read_errors, { reference: 'reference-without-prefix' }, ids.join(','));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual([result.inserted, result.updated], [2, 0], JSON.stringify(result));
    assert.deepEqual(result.report.warnings, [], JSON.stringify(result.report.warnings));
  }
  assert.deepEqual(await suppliers(runner, s), before, 'nothing written by the checks');
  console.log('  suppliers: a column of row numbers mapped onto reference updates nothing: OK');
}

// A person's own file, without the reference column: it updates by name, and clears nothing.
async function testSupplierOwnFile(h: Harness, runner: QueryRunner, s: Seed) {
  const header = (await headerOf(h, runner, s, 'suppliers')).filter((column) => column !== 'reference');
  const card = await check(h, runner, s, 'suppliers', 'mes-fournisseurs.csv', header, [rowOf(header, { name: 'Acme', erp_supplier_id: 'F-1' })]);
  const result = card.import_mapping.validation;
  assert.equal(result.ok, true, JSON.stringify(result.report.errors));
  assert.deepEqual([result.inserted, result.updated], [0, 1], JSON.stringify(result));
  assert.deepEqual(result.report.warnings, []);
  console.log('  suppliers: a file without the reference column updates by name, without refusal: OK');
}

// The export of the contacts with CTCT-1 given another e-mail and CTCT-2 renamed: two updates, their
// warnings, no insertion; the e-mail changes on the contact the reference names.
async function testContactChanges(h: Harness, runner: QueryRunner, s: Seed) {
  const header = await headerOf(h, runner, s, 'contacts');
  const card = await check(h, runner, s, 'contacts', 'contacts.csv', header, [
    rowOf(header, { reference: 'CTCT-1', first_name: 'Jean', last_name: 'Dupont', email: 'jean.dupont@x.test' }),
    rowOf(header, { reference: 'CTCT-2', first_name: 'Anne', last_name: 'Martin', email: 'b@x.test' }),
  ]);
  const result = card.import_mapping.validation;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual([result.inserted, result.updated], [0, 2], JSON.stringify(result));
  assert.deepEqual(card.import_mapping.read_errors, {});
  assert.deepEqual(result.report.warnings.map((warning: any) => [warning.row, warning.code, warning.params]), [
    [2, 'CSV_REFERENCE_EMAIL_CHANGES', { reference: 'CTCT-1', name: 'Jean Dupont', from: 'a@x.test', to: 'jean.dupont@x.test' }],
    [3, 'CSV_REFERENCE_RENAMES', { reference: 'CTCT-2', stored: 'Anne Morel', name: 'Anne Martin', context: 'contact' }],
  ]);
  const done = await h.previews.executePreview(ctx(runner, s), card.preview_id);
  assert.equal(done.status, 'executed', done.error_message ?? '');
  assert.deepEqual(await contacts(runner, s), ['CTCT-1 Jean Dupont jean.dupont@x.test -', 'CTCT-2 Anne Martin b@x.test -']);
  console.log('  contacts: e-mail and name changed by reference, with their warnings, nothing inserted: OK');
}

// Row numbers mapped onto `reference` are not read; a file without the column updates by e-mail and clears nothing.
async function testContactRowNumbersAndOwnFile(h: Harness, runner: QueryRunner, s: Seed) {
  const before = await contacts(runner, s);
  const header = await headerOf(h, runner, s, 'contacts');
  const numbered = await check(h, runner, s, 'contacts', 'contacts.csv', header, [
    rowOf(header, { reference: '1', first_name: 'New', email: 'new1@x.test' }),
    rowOf(header, { reference: '2', first_name: 'New', email: 'new2@x.test' }),
  ], ['ID', ...header.slice(1)]);
  assert.deepEqual(numbered.import_mapping.read_errors, { reference: 'reference-without-prefix' });
  assert.deepEqual([numbered.import_mapping.validation.inserted, numbered.import_mapping.validation.updated], [2, 0]);
  const own = header.filter((column) => column !== 'reference');
  const card = await check(h, runner, s, 'contacts', 'mes-contacts.csv', own, [rowOf(own, { first_name: 'Anne', last_name: 'Martin', email: 'B@x.test', job_title: 'Buyer' })]);
  const result = card.import_mapping.validation;
  assert.equal(result.ok, true, JSON.stringify(result.report.errors));
  assert.deepEqual([result.inserted, result.updated], [0, 1], JSON.stringify(result));
  assert.deepEqual(result.report.warnings, []);
  assert.deepEqual(await contacts(runner, s), before, 'nothing written by the checks');
  console.log('  contacts: row numbers are no references, a file without the column updates by e-mail: OK');
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      await testSupplierRowNumbers(harness, runner, s);
      await testSupplierOwnFile(harness, runner, s);
      await testSupplierRename(harness, runner, s);
      await testContactRowNumbersAndOwnFile(harness, runner, s);
      await testContactChanges(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('ai-import-supplier-contact-references.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
