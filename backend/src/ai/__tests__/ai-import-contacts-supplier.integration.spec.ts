import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Kad's import of the contacts sets each contact's main supplier (lot I4 of 26.11.9, fourth pass): the
// template carries `supplier_name` and `supplier_role`, an Outlook export's "Company" column mapped onto
// the supplier attaches its contacts, a name found beyond case is listed on the card as on the screen,
// and the screen's route counts the file Kad builds as the card does. The AI surface checks and the
// attachment storage are not under test: stubbed.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-import-contacts-supplier-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; previews: any; mapping: any; files: Map<string, { name: string; buffer: Buffer }> };
type Seed = { tenantId: string; userId: string; conversationId: string };

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-import-contacts-supplier.integration.spec.ts.');
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

/** An administrator; suppliers Acme (SUP-1) and Société Générale Info (SUP-2). */
async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `ai-ctsup-${tenantId.slice(0, 8)}`;
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
     VALUES ($1, $2, $3, 'AI import contacts', 'custom', 'import-model', 'custom', now(), now())`,
    [conversationId, tenantId, user.id],
  );
  for (const [name, number] of [['Acme', 1], ['Société Générale Info', 2]] as const) {
    await runner.query(`INSERT INTO suppliers (tenant_id, name, item_number) VALUES ($1, $2, $3)`, [tenantId, name, number]);
  }
  return { tenantId, userId: user.id, conversationId };
}

function ctx(runner: QueryRunner, s: Seed) {
  return {
    tenantId: s.tenantId, userId: s.userId, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const,
    manager: runner.manager, conversationId: s.conversationId,
  };
}

// Kad's template for the contacts offers the supplier and the type, titled in the four languages: the
// model meets `supplier_name` among the columns it maps a file's "Company" onto.
async function testTemplate(h: Harness, runner: QueryRunner, s: Seed) {
  const { isImportMatchedColumn } = require('../import/ai-import-targets');
  const titles: Record<string, [string, string]> = {};
  for (const language of ['en', 'fr', 'de', 'es'] as const) {
    const template = await h.mapping.describeTemplate(ctx(runner, s), 'contacts', language);
    const supplier = template.columns.find((column: any) => column.column === 'supplier_name');
    const role = template.columns.find((column: any) => column.column === 'supplier_role');
    assert.ok(supplier && role, `${language}: the template carries both columns`);
    assert.equal(supplier.kind, 'reference');
    assert.match(supplier.takes, /company/, 'what the column takes says it is the company the contact works for');
    assert.match(supplier.takes, /SUP-n/);
    assert.deepEqual(role.codes, ['commercial', 'technical', 'support', 'other']);
    titles[language] = [supplier.title, role.title];
    if (language === 'fr') assert.deepEqual(role.entries.map((entry: any) => entry.name), ['Commercial', 'Technique', 'Support', 'Autre']);
  }
  assert.deepEqual(titles, {
    en: ['Supplier', 'Contact type'], fr: ['Fournisseur', 'Type de contact'], de: ['Lieferant', 'Kontakttyp'], es: ['Proveedor', 'Tipo de contacto'],
  });
  assert.equal(isImportMatchedColumn('contacts', 'supplier_name'), true, 'a match of the supplier may be undone from the card');
  console.log('  template: supplier_name and supplier_role, titled in four languages: OK');
}

// An Outlook export: its "Company" column, mapped onto supplier_name, attaches each contact to its
// supplier; a name without its accents is listed as a match, as on the screen. The screen's route
// counts the file Kad builds as the card does.
async function testOutlookFile(h: Harness, runner: QueryRunner, s: Seed) {
  const id = randomUUID();
  h.files.set(id, {
    name: 'contacts-outlook.csv',
    buffer: Buffer.from([
      'First Name;Last Name;E-mail Address;Company',
      'Ana;Lopez;ana@x.test;Acme',
      'Ben;Roy;ben@x.test;SOCIETE GENERALE INFO',
      'Cy;Nul;cy@x.test;',
    ].join('\n') + '\n', 'utf8'),
  });
  const input = {
    attachment_id: id,
    entity_type: 'contacts',
    columns: [
      { column: 'first_name', source: 1, confidence: 'high' },
      { column: 'last_name', source: 2, confidence: 'high' },
      { column: 'email', source: 3, confidence: 'high' },
      { column: 'supplier_name', source: 4, confidence: 'high' },
    ],
  };
  const card = await h.previews.createPreview(ctx(runner, s), 'prepare_import_mapping', input);
  const check = card.import_mapping.validation;
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.deepEqual([check.inserted, check.updated, check.unchanged, check.cleared], [3, 0, 0, 0], JSON.stringify(check));
  const matches = (check.report.matches ?? []).map((match: any) => [match.column, match.value, match.target, match.ref, match.origin, match.lines, match.undoable]);
  assert.deepEqual(matches, [['supplier_name', 'SOCIETE GENERALE INFO', 'Société Générale Info', 'SUP-2', 'server', [3], true]]);

  const { ContactsController } = require('../../contacts/contacts.controller');
  const prepared = await h.mapping.preparedFile(ctx(runner, s), input, 'en');
  const file = { buffer: prepared.content, originalname: 'contacts.xlsx', size: prepared.content.length } as Express.Multer.File;
  const route = await h.app.get(ContactsController).import(file, 'true', 'en', undefined, undefined, undefined, {
    queryRunner: { manager: runner.manager }, tenant: { id: s.tenantId }, user: { sub: s.userId }, isAdmin: true, permissions: {},
  });
  assert.deepEqual(
    [route.ok, route.inserted, route.updated, route.unchanged ?? 0, route.cleared ?? 0, (route.matches ?? []).map((match: any) => [match.value, match.ref])],
    [check.ok, check.inserted, check.updated, check.unchanged, check.cleared, [['SOCIETE GENERALE INFO', 'SUP-2']]],
    'the route counts as the card',
  );

  const done = await h.previews.executePreview(ctx(runner, s), card.preview_id);
  assert.equal(done.status, 'executed', done.error_message ?? '');
  const rows = await runner.query(
    `SELECT c.email, coalesce('SUP-' || s.item_number, '-') AS supplier,
            coalesce((SELECT string_agg(l.role::text, ',') FROM supplier_contacts l WHERE l.tenant_id = c.tenant_id AND l.contact_id = c.id AND l.is_primary), '-') AS role
       FROM contacts c LEFT JOIN suppliers s ON s.id = c.supplier_id AND s.tenant_id = c.tenant_id
      WHERE c.tenant_id = $1 ORDER BY c.email`,
    [s.tenantId],
  );
  assert.deepEqual(rows.map((row: any) => `${row.email} ${row.supplier} ${row.role}`), [
    'ana@x.test SUP-1 commercial', 'ben@x.test SUP-2 commercial', 'cy@x.test - -',
  ]);
  assert.equal(Number((await runner.query(`SELECT count(*)::int AS n FROM suppliers WHERE tenant_id = $1`, [s.tenantId]))[0].n), 2, 'no supplier created');
  console.log('  an Outlook file attaches its contacts to their suppliers, counted as the route does: OK');
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      await testTemplate(harness, runner, s);
      await testOutlookFile(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('ai-import-contacts-supplier.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
