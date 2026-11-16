import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Kad reads the reference column of a company, department (lot R2 of 26.11.9) or contract file (R4), as the
// screen's import does: a filled `COMP-n` or `DEPT-n` names the record the row updates, and the
// check warns of each rename and each move (D12). A value is a reference for Kad only when it
// carries the family's prefix: a column "ID" numbering the rows 1 to N, mapped onto `reference`,
// is refused as a whole and updates nothing by its numbers.
// The AI surface checks and the attachment storage are not under test: stubbed.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-import-references-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; previews: any; mapping: any; files: Map<string, { name: string; buffer: Buffer }> };
type Seed = { tenantId: string; userId: string; conversationId: string; alpha: string; beta: string; dell: string };

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-import-references.integration.spec.ts.');
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

/** An administrator; companies Alpha (COMP-1), Beta (COMP-2), Kaasmeester BV (COMP-4); departments of Alpha, Achat (DEPT-1) and Finance (DEPT-2). */
async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `ai-r2-${tenantId.slice(0, 8)}`;
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
  const company = async (name: string, number: number, country: string, city: string) => (await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city, base_currency, item_number) VALUES ($1, $2, $3, $4, 'EUR', $5) RETURNING id`,
    [tenantId, name, country, city, number],
  ))[0].id as string;
  const alpha = await company('Alpha', 1, 'FR', 'Lyon');
  const beta = await company('Beta', 2, 'FR', 'Paris');
  await company('Kaasmeester BV', 4, 'NL', 'Gouda');
  for (const [name, number] of [['Achat', 1], ['Finance', 2]] as const) {
    await runner.query(`INSERT INTO departments (tenant_id, company_id, name, item_number) VALUES ($1, $2, $3, $4)`, [tenantId, alpha, name, number]);
  }
  // Contracts of Alpha with Dell: Support (CTR-1) and Licences (CTR-2), with notes; a supplier HP.
  const supplier = async (name: string) => (await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, name]))[0].id as string;
  const dell = await supplier('Dell');
  await supplier('HP');
  for (const [name, number] of [['Support', 1], ['Licences', 2]] as const) {
    await runner.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, duration_months, item_number, yearly_amount_at_signature, currency, notes)
       VALUES ($1, $2, $3, $4, '2026-01-01', 12, $5, 100, 'EUR', 'Kept notes')`,
      [tenantId, name, alpha, dell, number],
    );
  }
  return { tenantId, userId: user.id, conversationId, alpha, beta, dell };
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

/** The company file as the export writes it: every column of the template, after `reference`. */
async function companyHeader(h: Harness, runner: QueryRunner, s: Seed): Promise<string[]> {
  const template = await h.mapping.describeTemplate(ctx(runner, s), 'companies', 'en');
  return ['reference', ...template.columns.map((column: any) => column.column).filter((column: string) => column !== 'reference')];
}

function companyRow(header: string[], values: Record<string, string>): string {
  return header.map((column) => values[column] ?? (column === 'status' ? 'enabled' : '')).join(';');
}

async function companies(runner: QueryRunner, s: Seed): Promise<string[]> {
  return (await runner.query(`SELECT 'COMP-' || item_number || ' ' || name AS r FROM companies WHERE tenant_id = $1 ORDER BY item_number`, [s.tenantId]))
    .map((row: any) => row.r);
}

// The export of the companies with COMP-4 renamed: one update, its warning, no insertion.
async function testCompanyRename(h: Harness, runner: QueryRunner, s: Seed) {
  const header = await companyHeader(h, runner, s);
  const file = attach(h, 'c1-rename.csv', [
    header.join(';'),
    companyRow(header, { reference: 'COMP-1', name: 'Alpha', country_iso: 'FR', city: 'Lyon', base_currency: 'EUR' }),
    companyRow(header, { reference: 'comp-4', name: 'Kaasmeester BV R9', country_iso: 'NL', city: 'Gouda', base_currency: 'EUR' }),
    companyRow(header, { reference: 'COMP-2', name: 'Beta', country_iso: 'FR', city: 'Paris', base_currency: 'EUR' }),
  ]);
  const card = await h.previews.createPreview(ctx(runner, s), 'prepare_import_mapping', { attachment_id: file, entity_type: 'companies', columns: sameNames(header) });
  const check = card.import_mapping.validation;
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.deepEqual([check.inserted, check.updated, check.unchanged], [0, 1, 2], JSON.stringify(check));
  assert.deepEqual(card.import_mapping.read_errors, {});
  assert.deepEqual(check.report.warnings.map((warning: any) => [warning.row, warning.code, warning.params]), [
    [3, 'CSV_REFERENCE_RENAMES', { reference: 'COMP-4', stored: 'Kaasmeester BV', name: 'Kaasmeester BV R9', context: 'company' }],
  ]);
  const done = await h.previews.executePreview(ctx(runner, s), card.preview_id);
  assert.equal(done.status, 'executed', done.error_message ?? '');
  assert.deepEqual(await companies(runner, s), ['COMP-1 Alpha', 'COMP-2 Beta', 'COMP-4 Kaasmeester BV R9']);
  console.log('  companies: COMP-4 renamed by reference, with its warning, nothing inserted: OK');
}

// A person's own file, without the reference column: a row named as an existing company updates it
// by name, as on the screen. The reference column the file lacks clears nothing: no refusal.
async function testOwnFileWithoutReference(h: Harness, runner: QueryRunner, s: Seed) {
  const before = await companies(runner, s);
  const header = (await companyHeader(h, runner, s)).filter((column) => column !== 'reference');
  const file = attach(h, 'mes-societes.csv', [
    header.join(';'),
    companyRow(header, { name: 'Alpha', country_iso: 'FR', city: 'Lyon 2', base_currency: 'EUR' }),
  ]);
  const card = await h.previews.createPreview(ctx(runner, s), 'prepare_import_mapping', { attachment_id: file, entity_type: 'companies', columns: sameNames(header) });
  const check = card.import_mapping.validation;
  assert.equal(check.ok, true, JSON.stringify(check.report.errors));
  assert.deepEqual([check.inserted, check.updated], [0, 1], JSON.stringify(check));
  assert.deepEqual(await companies(runner, s), before, 'nothing written by the check');
  console.log('  companies: a file without the reference column updates by name, without refusal: OK');
}

// The departments' file: a rename and a move to another company, each with its warning.
async function testDepartmentChanges(h: Harness, runner: QueryRunner, s: Seed) {
  const header = ['reference', 'company_name', 'name', 'description', 'status', 'disabled_at'];
  const file = attach(h, 'd2-changes.csv', [
    header.join(';'),
    'DEPT-1;Alpha;Achats;;enabled;',
    'DEPT-2;Beta;Finance;;enabled;',
  ]);
  const card = await h.previews.createPreview(ctx(runner, s), 'prepare_import_mapping', { attachment_id: file, entity_type: 'departments', columns: sameNames(header) });
  const check = card.import_mapping.validation;
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.deepEqual([check.inserted, check.updated], [0, 2], JSON.stringify(check));
  assert.deepEqual(check.report.warnings.map((warning: any) => [warning.row, warning.code, warning.params]), [
    [2, 'CSV_REFERENCE_RENAMES', { reference: 'DEPT-1', stored: 'Achat', name: 'Achats', context: 'department' }],
    [3, 'CSV_REFERENCE_MOVES', { reference: 'DEPT-2', name: 'Finance', from: 'Alpha', to: 'Beta', context: 'company' }],
  ]);
  const done = await h.previews.executePreview(ctx(runner, s), card.preview_id);
  assert.equal(done.status, 'executed', done.error_message ?? '');
  const rows = await runner.query(
    `SELECT 'DEPT-' || d.item_number || ' ' || d.name || ' (' || c.name || ')' AS r FROM departments d JOIN companies c ON c.id = d.company_id
     WHERE d.tenant_id = $1 ORDER BY d.item_number`,
    [s.tenantId],
  );
  assert.deepEqual(rows.map((row: any) => row.r), ['DEPT-1 Achats (Alpha)', 'DEPT-2 Finance (Beta)']);
  console.log('  departments: renamed and moved by reference, with both warnings: OK');
}

// A column "ID" numbering the rows 1 to N, mapped onto `reference`: no company is updated by
// those numbers. The card names the column as not read; the rows keep the key by name.
async function testRowNumbersAreNoReferences(h: Harness, runner: QueryRunner, s: Seed) {
  const before = await companies(runner, s);
  const header = await companyHeader(h, runner, s);
  const fileHeader = ['ID', ...header.slice(1)];
  for (const ids of [['1', '2'], ['COMP-1', '2']]) {
    const file = attach(h, 'societes.csv', [
      fileHeader.join(';'),
      companyRow(header, { reference: ids[0], name: 'Gamma', country_iso: 'FR', city: 'Nantes', base_currency: 'EUR' }),
      companyRow(header, { reference: ids[1], name: 'Delta', country_iso: 'FR', city: 'Brest', base_currency: 'EUR' }),
    ]);
    const card = await h.previews.createPreview(ctx(runner, s), 'prepare_import_mapping', { attachment_id: file, entity_type: 'companies', columns: sameNames(header) });
    const check = card.import_mapping.validation;
    assert.deepEqual(card.import_mapping.read_errors, { reference: 'reference-without-prefix' }, ids.join(','));
    assert.equal(check.ok, true, JSON.stringify(check));
    assert.deepEqual([check.inserted, check.updated], [2, 0], JSON.stringify(check));
    assert.deepEqual(check.report.warnings, [], JSON.stringify(check.report.warnings));
    assert.equal(card.import_mapping.columns.find((column: any) => column.column === 'reference').filled, 0);
  }
  assert.deepEqual(await companies(runner, s), before, 'nothing written by the checks');
  console.log('  companies: a column of row numbers mapped onto reference updates nothing: OK');
}

// Two rows of Achat by its company and name, the second in another case: the card refuses the second
// on its line, as the screen's check does (one row per department), and the check writes nothing.
async function testDepartmentSameNameTwice(h: Harness, runner: QueryRunner, s: Seed) {
  const read = async () => (await runner.query(
    `SELECT 'DEPT-' || item_number || ' ' || name || ' ' || coalesce(description, '-') AS r FROM departments WHERE tenant_id = $1 ORDER BY item_number`,
    [s.tenantId],
  )).map((row: any) => row.r);
  const before = await read();
  const header = ['reference', 'company_name', 'name', 'description', 'status', 'disabled_at'];
  const file = attach(h, 'd2-doublon.csv', [
    header.join(';'),
    ';Alpha;Achat;first;enabled;',
    ';Alpha;ACHAT;second;enabled;',
  ]);
  const card = await h.previews.createPreview(ctx(runner, s), 'prepare_import_mapping', { attachment_id: file, entity_type: 'departments', columns: sameNames(header) });
  const check = card.import_mapping.validation;
  assert.equal(check.ok, false, JSON.stringify(check));
  assert.deepEqual(
    check.report.errors.map((error: any) => [error.row, error.column, error.code, error.params]),
    [[3, 'name', 'CSV_SAME_RECORD', { firstRow: 2, reference: 'DEPT-1' }]],
    JSON.stringify(check.report.errors),
  );
  assert.deepEqual(await read(), before, 'nothing written by the check');
  console.log('  departments: a second row of the same company and name is refused on its line: OK');
}

/** The contracts file as the export writes it: every column of the template, `reference` first. */
async function contractHeader(h: Harness, runner: QueryRunner, s: Seed): Promise<string[]> {
  const template = await h.mapping.describeTemplate(ctx(runner, s), 'contracts', 'en');
  return ['reference', ...template.columns.map((column: any) => column.column).filter((column: string) => column !== 'reference')];
}

function contractRow(header: string[], values: Record<string, string>): string {
  const defaults: Record<string, string> = {
    company_name: 'Alpha', supplier_name: 'Dell', start_date: '2026-01-01', duration_months: '12', auto_renewal: 'yes',
    notice_period_months: '1', yearly_amount_at_signature: '100', currency: 'EUR', billing_frequency: 'annual', status: 'enabled', notes: 'Kept notes',
  };
  return header.map((column) => values[column] ?? defaults[column] ?? '').join(';');
}

async function contracts(runner: QueryRunner, s: Seed): Promise<string[]> {
  return (await runner.query(
    `SELECT 'CTR-' || c.item_number || ' ' || c.name || ' (' || su.name || ') ' || c.yearly_amount_at_signature::int || ' ' || coalesce(c.notes, '-') AS r
       FROM contracts c JOIN suppliers su ON su.id = c.supplier_id WHERE c.tenant_id = $1 ORDER BY c.item_number`,
    [s.tenantId],
  )).map((row: any) => row.r);
}

// The export of the contracts with CTR-1 renamed and moved to HP: one update, its two warnings.
async function testContractRenameAndMove(h: Harness, runner: QueryRunner, s: Seed) {
  const header = await contractHeader(h, runner, s);
  const file = attach(h, 'contrats-export.csv', [
    header.join(';'),
    contractRow(header, { reference: 'CTR-1', name: 'Support R9', supplier_name: 'HP' }),
    contractRow(header, { reference: 'ctr-2', name: 'Licences' }),
  ]);
  const card = await h.previews.createPreview(ctx(runner, s), 'prepare_import_mapping', { attachment_id: file, entity_type: 'contracts', columns: sameNames(header) });
  const check = card.import_mapping.validation;
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.deepEqual([check.inserted, check.updated, check.unchanged], [0, 1, 1], JSON.stringify(check));
  assert.deepEqual(card.import_mapping.read_errors, {});
  assert.deepEqual(check.report.warnings.map((warning: any) => [warning.row, warning.code, warning.params]), [
    [2, 'CSV_REFERENCE_RENAMES', { reference: 'CTR-1', stored: 'Support', name: 'Support R9', context: 'contract' }],
    [2, 'CSV_REFERENCE_MOVES', { reference: 'CTR-1', name: 'Support', from: 'Dell', to: 'HP', context: 'supplier' }],
  ]);
  const done = await h.previews.executePreview(ctx(runner, s), card.preview_id);
  assert.equal(done.status, 'executed', done.error_message ?? '');
  assert.deepEqual(await contracts(runner, s), ['CTR-1 Support R9 (HP) 100 Kept notes', 'CTR-2 Licences (Dell) 100 Kept notes']);
  console.log('  contracts: CTR-1 renamed and moved by reference, with both warnings: OK');
}

// A column "ID" numbering the rows, mapped onto `reference`: not read; the rows keep the key by
// name and supplier, so two new contracts.
async function testContractRowNumbersAreNoReferences(h: Harness, runner: QueryRunner, s: Seed) {
  const before = await contracts(runner, s);
  const header = await contractHeader(h, runner, s);
  const fileHeader = ['ID', ...header.slice(1)];
  const file = attach(h, 'contrats.csv', [
    fileHeader.join(';'),
    contractRow(header, { reference: '1', name: 'Gamma' }),
    contractRow(header, { reference: '2', name: 'Delta' }),
  ]);
  const card = await h.previews.createPreview(ctx(runner, s), 'prepare_import_mapping', { attachment_id: file, entity_type: 'contracts', columns: sameNames(header) });
  const check = card.import_mapping.validation;
  assert.deepEqual(card.import_mapping.read_errors, { reference: 'reference-without-prefix' });
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.deepEqual([check.inserted, check.updated], [2, 0], JSON.stringify(check));
  assert.deepEqual(check.report.warnings ?? [], []);
  assert.deepEqual(await contracts(runner, s), before, 'nothing written by the check');
  console.log('  contracts: a column of row numbers mapped onto reference updates nothing: OK');
}

// A person's own file without the reference column: the row updates its contract by name and
// supplier, and empties none of its values.
async function testContractFileWithoutReference(h: Harness, runner: QueryRunner, s: Seed) {
  const header = (await contractHeader(h, runner, s)).filter((column) => column !== 'reference');
  const file = attach(h, 'mes-contrats.csv', [
    header.join(';'),
    contractRow(header, { name: 'Licences', yearly_amount_at_signature: '250' }),
  ]);
  const card = await h.previews.createPreview(ctx(runner, s), 'prepare_import_mapping', { attachment_id: file, entity_type: 'contracts', columns: sameNames(header) });
  const check = card.import_mapping.validation;
  assert.equal(check.ok, true, JSON.stringify(check.report.errors));
  assert.deepEqual([check.inserted, check.updated], [0, 1], JSON.stringify(check));
  assert.deepEqual(check.report.warnings ?? [], []);
  const done = await h.previews.executePreview(ctx(runner, s), card.preview_id);
  assert.equal(done.status, 'executed', done.error_message ?? '');
  assert.deepEqual(await contracts(runner, s), ['CTR-1 Support R9 (HP) 100 Kept notes', 'CTR-2 Licences (Dell) 250 Kept notes']);
  console.log('  contracts: a file without the reference column updates by name and supplier, nothing emptied: OK');
}

// Two rows of CTR-2, the second under another name: the card refuses the second on its line, as the
// screen's check does (one row per contract), and the check writes nothing.
async function testContractSameReferenceTwice(h: Harness, runner: QueryRunner, s: Seed) {
  const before = await contracts(runner, s);
  const header = await contractHeader(h, runner, s);
  const file = attach(h, 'contrats-doublon.csv', [
    header.join(';'),
    contractRow(header, { reference: 'CTR-2', name: 'Licences', yearly_amount_at_signature: '300' }),
    contractRow(header, { reference: 'CTR-2', name: 'Licences bis', yearly_amount_at_signature: '400' }),
  ]);
  const card = await h.previews.createPreview(ctx(runner, s), 'prepare_import_mapping', { attachment_id: file, entity_type: 'contracts', columns: sameNames(header) });
  const check = card.import_mapping.validation;
  assert.equal(check.ok, false, JSON.stringify(check));
  assert.deepEqual(
    check.report.errors.map((error: any) => [error.row, error.column, error.code, error.params]),
    [[3, 'reference', 'CSV_SAME_RECORD', { firstRow: 2, reference: 'CTR-2' }]],
    JSON.stringify(check.report.errors),
  );
  assert.deepEqual(await contracts(runner, s), before, 'nothing written by the check');
  console.log('  contracts: a second row of the same reference is refused on its line: OK');
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      await testRowNumbersAreNoReferences(harness, runner, s);
      await testOwnFileWithoutReference(harness, runner, s);
      await testCompanyRename(harness, runner, s);
      await testDepartmentSameNameTwice(harness, runner, s);
      await testDepartmentChanges(harness, runner, s);
      await testContractRowNumbersAreNoReferences(harness, runner, s);
      await testContractRenameAndMove(harness, runner, s);
      await testContractFileWithoutReference(harness, runner, s);
      await testContractSameReferenceTwice(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('ai-import-references.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
