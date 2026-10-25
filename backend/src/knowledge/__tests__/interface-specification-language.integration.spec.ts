/**
 * A new interface specification is written in the language of the user who creates
 * it (`users.locale`). English is the fallback. An existing document is left as it
 * is, and the library template stays the English copy: a tenant has no language,
 * and a re-seed does not rewrite a template that already exists.
 *
 * Runs the real SQL against `DATABASE_URL`; the test seeds inside a transaction
 * that is rolled back afterwards.
 */
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ItemNumberService } from '../../common/item-number.service';
import { closeMarkdownWorkers } from '../../common/markdown-worker';
import { KnowledgeService } from '../knowledge.service';
import { IntegratedDocumentsService } from '../integrated-documents.service';
import { seedManagedDocsKnowledgeAssets } from '../integrated-document-seed';
import {
  buildInterfaceSpecificationMarkdown,
  interfaceSpecificationHeadings,
  interfaceSpecificationLanguageOf,
  type InterfaceSpecificationSource,
} from '../interface-specification-markdown';
import { Document } from '../document.entity';
import { DocumentActivity } from '../document-activity.entity';
import { DocumentApplication } from '../document-application.entity';
import { DocumentAsset } from '../document-asset.entity';
import { DocumentAttachment } from '../document-attachment.entity';
import { DocumentClassification } from '../document-classification.entity';
import { DocumentContributor } from '../document-contributor.entity';
import { DocumentEditLock } from '../document-edit-lock.entity';
import { DocumentFolder } from '../document-folder.entity';
import { DocumentLibrary } from '../document-library.entity';
import { DocumentProject } from '../document-project.entity';
import { DocumentReference } from '../document-reference.entity';
import { DocumentRequest } from '../document-request.entity';
import { DocumentTask } from '../document-task.entity';
import { DocumentType } from '../document-type.entity';
import { DocumentVersion } from '../document-version.entity';
import { IntegratedDocumentBinding } from '../integrated-document-binding.entity';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { User } from '../../users/user.entity';

type Fixture = Awaited<ReturnType<typeof seedFixture>>;

const EMPTY_SOURCE: InterfaceSpecificationSource = {
  business_purpose: null,
  overview_notes: null,
  impact_of_failure: null,
  business_objects: null,
  main_use_cases: null,
  functional_rules: null,
  core_transformations_summary: null,
  error_handling_summary: null,
  typical_data: null,
  audit_logging: null,
  security_controls_summary: null,
};

function headingLines(markdown: string | null | undefined): string[] {
  return String(markdown || '').split('\n').filter((line) => line.startsWith('## '));
}

function expectedHeadings(language: string): string[] {
  return interfaceSpecificationHeadings(language).map((heading) => `## ${heading}`);
}

/** The four copies, and the English structure the workers already shipped. No database. */
function testHeadingsFollowTheLanguage() {
  assert.deepEqual(expectedHeadings('en'), [
    '## Business Purpose & Overview',
    '## Business Objects',
    '## Use Cases',
    '## Business Rules',
    '## Impact of Failure',
    '## Transformations Overview',
    '## Error Handling',
    '## Data & Compliance Notes',
  ]);
  assert.deepEqual(expectedHeadings('fr'), [
    "## Objet métier et vue d'ensemble",
    '## Objets métier',
    "## Cas d'usage",
    '## Règles métier',
    '## Impact en cas de défaillance',
    "## Vue d'ensemble des transformations",
    '## Traitement des erreurs',
    '## Données et notes de conformité',
  ]);
  assert.deepEqual(headingLines(buildInterfaceSpecificationMarkdown(EMPTY_SOURCE, (text) => text, 'de')), expectedHeadings('de'));
  assert.deepEqual(headingLines(buildInterfaceSpecificationMarkdown(EMPTY_SOURCE, (text) => text, 'es')), expectedHeadings('es'));
  assert.deepEqual(headingLines(buildInterfaceSpecificationMarkdown(EMPTY_SOURCE, (text) => text, 'pt')), expectedHeadings('en'), 'anything else is English');

  const filled = buildInterfaceSpecificationMarkdown({
    ...EMPTY_SOURCE,
    business_purpose: 'Envoyer la paie',
    overview_notes: 'Note conservée',
  }, (text) => text, 'fr');
  assert.match(filled, /### Objet métier\n\nEnvoyer la paie/);
  assert.match(filled, /### Notes de vue d'ensemble\n\nNote conservée/);
  assert.equal(filled.includes('Business purpose'), false);

  const english = buildInterfaceSpecificationMarkdown({
    ...EMPTY_SOURCE,
    business_purpose: 'Sync payroll',
  }, (text) => text);
  assert.match(english, /## Business Purpose & Overview\n\n### Business purpose\n\nSync payroll/);
  assert.equal(interfaceSpecificationLanguageOf(filled), 'fr');
  assert.equal(interfaceSpecificationLanguageOf(english), 'en');
  assert.equal(interfaceSpecificationLanguageOf('## Notre spécification\n'), null);
}

function createServices(manager: any) {
  const permissions = new PermissionsService(
    manager.getRepository(UserPageRole),
    manager.getRepository(RolePermission),
  );
  const users: any = {
    findById: async (id: string, opts?: any) => (opts?.manager ?? manager)
      .getRepository(User)
      .findOne({ where: { id }, relations: ['role'] }),
  };
  const storage: any = {
    putObject: async () => undefined,
    deleteObject: async () => undefined,
    getObjectStream: async () => ({ stream: null, contentType: null, contentLength: null }),
  };
  const knowledge = new KnowledgeService(
    manager.getRepository(Document),
    manager.getRepository(DocumentFolder),
    manager.getRepository(IntegratedDocumentBinding),
    manager.getRepository(DocumentLibrary),
    manager.getRepository(DocumentType),
    manager.getRepository(DocumentVersion),
    manager.getRepository(DocumentEditLock),
    manager.getRepository(DocumentAttachment),
    manager.getRepository(DocumentActivity),
    manager.getRepository(DocumentContributor),
    manager.getRepository(DocumentClassification),
    manager.getRepository(DocumentReference),
    manager.getRepository(DocumentApplication),
    manager.getRepository(DocumentAsset),
    manager.getRepository(DocumentProject),
    manager.getRepository(DocumentRequest),
    manager.getRepository(DocumentTask),
    new ItemNumberService() as any,
    { log: async () => undefined } as any,
    {} as any,
    {} as any,
    storage,
    {} as any,
    dataSource,
    permissions,
    users,
    {} as any,
    { notifyShare: async () => undefined } as any,
  );
  const integrated = new IntegratedDocumentsService(
    manager.getRepository(IntegratedDocumentBinding),
    knowledge,
    permissions,
    { convertToMarkdown: async () => ({ markdown: '', images: [], warnings: [], omittedTargets: [] }) } as any,
  );
  return { integrated };
}

async function setCurrentTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function seedFixture(runner: QueryRunner) {
  const tag = randomUUID().slice(0, 8);
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', now(), now())`,
    [tenantId, `spec-lang-${tag}`, `spec-lang-${tag}`],
  );
  await setCurrentTenant(runner, tenantId);
  await seedManagedDocsKnowledgeAssets(runner.manager as any, tenantId);

  const roleId = randomUUID();
  await runner.query(
    `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, $3, $3, false, false, now(), now())`,
    [roleId, tenantId, `Spec language ${tag}`],
  );
  const userId = randomUUID();
  await runner.query(
    `INSERT INTO users (id, tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status, locale, created_at, updated_at)
     VALUES ($1, $2, 'Spec', 'Tester', $3, null, $4, false, 'enabled', 'en', now(), now())`,
    [userId, tenantId, `spec-lang-${tag}@example.com`, roleId],
  );
  const sourceId = (await runner.query(
    `INSERT INTO applications (tenant_id, name) VALUES ($1, $2) RETURNING id::text AS id`,
    [tenantId, `CRM ${tag}`],
  ))[0].id as string;
  const targetId = (await runner.query(
    `INSERT INTO applications (tenant_id, name) VALUES ($1, $2) RETURNING id::text AS id`,
    [tenantId, `ERP ${tag}`],
  ))[0].id as string;
  return { tag, tenantId, userId, sourceId, targetId };
}

async function setLocale(runner: QueryRunner, fixture: Fixture, locale: string | null) {
  await runner.query(
    `UPDATE users SET locale = $3 WHERE id = $1 AND tenant_id = $2`,
    [fixture.userId, fixture.tenantId, locale],
  );
}

async function insertInterface(
  runner: QueryRunner,
  fixture: Fixture,
  name: string,
  reference: string,
  notes: string | null = null,
) {
  const [row] = await runner.query(
    `INSERT INTO interfaces (
       tenant_id, name, business_purpose, overview_notes, source_application_id, target_application_id,
       data_category, integration_route_type, interface_reference, lifecycle
     ) VALUES ($1, $2, 'Envoyer la paie', $3, $4, $5, 'master_data', 'direct', $6, 'active')
     RETURNING id::text AS id, tenant_id::text AS tenant_id, name, interface_reference`,
    [fixture.tenantId, name, notes, fixture.sourceId, fixture.targetId, reference],
  );
  return {
    id: row.id as string,
    tenant_id: row.tenant_id as string,
    item_number: null,
    name: row.name as string,
    reference_label: row.interface_reference as string,
  };
}

async function specificationOf(runner: QueryRunner, fixture: Fixture, interfaceId: string) {
  const [row] = await runner.query(
    `SELECT d.title, d.content_markdown
     FROM integrated_document_bindings b
     JOIN documents d ON d.id = b.document_id AND d.tenant_id = b.tenant_id
     WHERE b.tenant_id = $1
       AND b.source_entity_type = 'interfaces'
       AND b.source_entity_id = $2
       AND b.slot_key = 'specification'`,
    [fixture.tenantId, interfaceId],
  );
  return row as { title: string; content_markdown: string } | undefined;
}

async function libraryTemplate(runner: QueryRunner) {
  const [row] = await runner.query(
    `SELECT d.content_markdown
     FROM integrated_document_slot_settings s
     JOIN documents d ON d.id = s.template_document_id AND d.tenant_id = s.tenant_id
     WHERE s.tenant_id = app_current_tenant()
       AND s.source_entity_type = 'interfaces'
       AND s.slot_key = 'specification'`,
  );
  return String(row?.content_markdown || '');
}

async function testNewInterfaceSpecificationFollowsTheCreatorLanguage() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const fixture = await seedFixture(runner);
    const { integrated } = createServices(runner.manager);
    const englishTemplate = await libraryTemplate(runner);
    assert.deepEqual(headingLines(englishTemplate), expectedHeadings('en'), 'the library template stays English');

    const english = await insertInterface(runner, fixture, 'Payroll', 'INT-8091');
    await integrated.provisionForInterface(english, { specification: null }, fixture.userId, { manager: runner.manager });
    const englishDoc = await specificationOf(runner, fixture, english.id);
    assert.ok(englishDoc, 'the English specification exists');
    assert.deepEqual(headingLines(englishDoc.content_markdown), expectedHeadings('en'));
    assert.match(englishDoc.content_markdown, /### Business purpose\n\nEnvoyer la paie/);
    assert.equal(englishDoc.title, 'INT-8091 - Payroll - Specification');
    const englishBody = englishDoc.content_markdown;

    await setLocale(runner, fixture, 'fr');
    await integrated.provisionForInterface(english, { specification: null }, fixture.userId, { manager: runner.manager });
    const englishAfter = await specificationOf(runner, fixture, english.id);
    assert.equal(englishAfter?.content_markdown, englishBody, 'an existing specification is not rewritten');
    assert.equal(englishAfter?.title, englishDoc.title);

    const french = await insertInterface(runner, fixture, 'Paie', 'INT-8092', 'Note conservée');
    await integrated.provisionForInterface(french, { specification: null }, fixture.userId, { manager: runner.manager });
    const frenchDoc = await specificationOf(runner, fixture, french.id);
    assert.ok(frenchDoc);
    assert.deepEqual(headingLines(frenchDoc.content_markdown), expectedHeadings('fr'));
    assert.match(frenchDoc.content_markdown, /### Objet métier\n\nEnvoyer la paie/);
    assert.match(frenchDoc.content_markdown, /### Notes de vue d'ensemble\n\nNote conservée/);
    assert.equal(frenchDoc.title, "INT-8092 - Paie - Spécification");
    await integrated.verifySourceEntity('interfaces', french.id, { manager: runner.manager });

    await setLocale(runner, fixture, 'de');
    const german = await insertInterface(runner, fixture, 'Lohn', 'INT-8093');
    await integrated.provisionForInterface(german, { specification: null }, fixture.userId, { manager: runner.manager });
    const germanDoc = await specificationOf(runner, fixture, german.id);
    assert.deepEqual(headingLines(germanDoc?.content_markdown), expectedHeadings('de'));
    assert.equal(germanDoc?.title, 'INT-8093 - Lohn - Spezifikation');

    await setLocale(runner, fixture, 'es');
    const spanish = await insertInterface(runner, fixture, 'Nómina', 'INT-8094');
    await integrated.provisionForInterface(spanish, { specification: null }, fixture.userId, { manager: runner.manager });
    const spanishDoc = await specificationOf(runner, fixture, spanish.id);
    assert.deepEqual(headingLines(spanishDoc?.content_markdown), expectedHeadings('es'));
    assert.equal(spanishDoc?.title, 'INT-8094 - Nómina - Especificación');

    await setLocale(runner, fixture, null);
    const fallback = await insertInterface(runner, fixture, 'Fallback', 'INT-8095');
    await integrated.provisionForInterface(fallback, { specification: null }, null, { manager: runner.manager });
    const fallbackDoc = await specificationOf(runner, fixture, fallback.id);
    assert.deepEqual(headingLines(fallbackDoc?.content_markdown), expectedHeadings('en'), 'no user falls back to English');

    const supplied = await insertInterface(runner, fixture, 'Fourni', 'INT-8096');
    await setLocale(runner, fixture, 'fr');
    await integrated.provisionForInterface(supplied, { specification: '## Déjà rédigé\n\nCorps.' }, fixture.userId, { manager: runner.manager });
    const suppliedDoc = await specificationOf(runner, fixture, supplied.id);
    assert.match(String(suppliedDoc?.content_markdown), /## Déjà rédigé/);
    assert.equal(headingLines(suppliedDoc?.content_markdown).includes("## Objet métier et vue d'ensemble"), false, 'a written specification is kept');

    const repaired = await insertInterface(runner, fixture, 'Réparé', 'INT-8097', 'Note conservée');
    await integrated.repairSourceSlot('interfaces', repaired.id, 'specification', {
      manager: runner.manager,
      actorUserId: fixture.userId,
    });
    const repairedDoc = await specificationOf(runner, fixture, repaired.id);
    assert.deepEqual(headingLines(repairedDoc?.content_markdown), expectedHeadings('fr'), 'a missing specification is written in the opener\'s language');

    await seedManagedDocsKnowledgeAssets(runner.manager as any, fixture.tenantId);
    assert.deepEqual(headingLines(await libraryTemplate(runner)), expectedHeadings('en'), 'a re-seed keeps the English library template');
    assert.equal((await specificationOf(runner, fixture, english.id))?.content_markdown, englishBody, 'a re-seed leaves the existing document');
    assert.deepEqual(headingLines((await specificationOf(runner, fixture, french.id))?.content_markdown), expectedHeadings('fr'));
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function run() {
  testHeadingsFollowTheLanguage();
  console.log('  ok testHeadingsFollowTheLanguage');
  await dataSource.initialize();
  try {
    await testNewInterfaceSpecificationFollowsTheCreatorLanguage();
    console.log('  ok testNewInterfaceSpecificationFollowsTheCreatorLanguage');
  } finally {
    await dataSource.destroy();
    await closeMarkdownWorkers();
  }
}

run()
  .then(() => console.log('interface-specification-language.integration.spec.ts OK'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
