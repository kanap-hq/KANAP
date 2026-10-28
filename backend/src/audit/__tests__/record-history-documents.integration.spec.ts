// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { Document } from '../../knowledge/document.entity';
import { DocumentActivity } from '../../knowledge/document-activity.entity';
import { DocumentApplication } from '../../knowledge/document-application.entity';
import { DocumentAsset } from '../../knowledge/document-asset.entity';
import { DocumentAttachment } from '../../knowledge/document-attachment.entity';
import { DocumentClassification } from '../../knowledge/document-classification.entity';
import { DocumentContributor } from '../../knowledge/document-contributor.entity';
import { DocumentEditLock } from '../../knowledge/document-edit-lock.entity';
import { DocumentFolder } from '../../knowledge/document-folder.entity';
import { DocumentLibrary } from '../../knowledge/document-library.entity';
import { DocumentProject } from '../../knowledge/document-project.entity';
import { DocumentReference } from '../../knowledge/document-reference.entity';
import { DocumentRequest } from '../../knowledge/document-request.entity';
import { DocumentTask } from '../../knowledge/document-task.entity';
import { DocumentType } from '../../knowledge/document-type.entity';
import { DocumentVersion } from '../../knowledge/document-version.entity';
import { IntegratedDocumentBinding } from '../../knowledge/integrated-document-binding.entity';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { User } from '../../users/user.entity';
import { resolveIncidentViewer } from '../../incidents/incident-visibility';
import {
  loadReferences,
  readableFamilies,
  recordIsVisible,
  type FamilyCodeCheckKey,
  type FamilyKey,
  type ReferenceReader,
} from '../record-history/families';

// The document family of the record history (lot 2, family E): the Knowledge library ACL and the
// incident review rule are not SQL, so the family calls `KnowledgeService` in code. The tests seed
// a restricted library with a member and a non-member who both read Knowledge, an incident review
// whose incident is confidential, and a cross-tenant document; then they run the two entries the
// history shares with every reference: `recordIsVisible` (the 404 of a record) and `loadReferences`
// (a cited document is named only when the reader may open it).
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

function createKnowledgeService(manager: any): KnowledgeService {
  const permissions = new PermissionsService(
    manager.getRepository(UserPageRole),
    manager.getRepository(RolePermission),
  );
  const users: any = {
    findById: async (id: string, opts?: any) => (opts?.manager ?? manager)
      .getRepository(User)
      .findOne({ where: { id }, relations: ['role'] }),
  };
  const audit: any = { log: async () => undefined };
  const storage: any = {
    putObject: async () => undefined,
    deleteObject: async () => undefined,
    getObjectStream: async () => ({ stream: null, contentType: null, contentLength: null }),
  };
  const notifications: any = { notifyShare: async () => undefined };
  const itemNumbers: any = { nextItemNumber: async () => 999999 };

  return new KnowledgeService(
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
    itemNumbers,
    audit,
    {} as any,
    {} as any,
    storage,
    {} as any,
    dataSource,
    permissions,
    users,
    {} as any,
    notifications,
  );
}

async function seedRole(
  runner: QueryRunner,
  tenantId: string,
  roleName: string,
  permissions: Record<string, 'reader' | 'member' | 'contributor' | 'admin'>,
) {
  const roleId = randomUUID();
  await runner.query(
    `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, $3, $3, false, false, now(), now())`,
    [roleId, tenantId, roleName],
  );
  for (const [resource, level] of Object.entries(permissions)) {
    await runner.query(
      `INSERT INTO role_permissions (id, tenant_id, role_id, resource, level, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())`,
      [randomUUID(), tenantId, roleId, resource, level],
    );
  }
  return roleId;
}

async function seedUser(runner: QueryRunner, tenantId: string, roleId: string, email: string) {
  const userId = randomUUID();
  await runner.query(
    `INSERT INTO users (
       id, tenant_id, first_name, last_name, email, password_hash, role_id,
       mfa_enabled, status, created_at, updated_at
     )
     VALUES ($1, $2, $3, 'Tester', $4, null, $5, false, 'enabled', now(), now())`,
    [userId, tenantId, email.split('@')[0], email, roleId],
  );
  return userId;
}

let itemCounter = 7100;
function nextItemNumber(): number {
  itemCounter += 1;
  return itemCounter;
}

async function seedLibrary(
  runner: QueryRunner,
  tenantId: string,
  tag: string,
  accessMode: 'default' | 'restricted',
) {
  const libraryId = randomUUID();
  await runner.query(
    `INSERT INTO document_libraries (id, tenant_id, name, slug, is_system, access_mode, display_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, false, $5, 9, now(), now())`,
    [libraryId, tenantId, `Library ${tag}`, `library-${tag}`, accessMode],
  );
  return libraryId;
}

async function seedFolder(runner: QueryRunner, tenantId: string, libraryId: string, name: string) {
  const folderId = randomUUID();
  await runner.query(
    `INSERT INTO document_folders (id, tenant_id, library_id, parent_id, name, display_order, created_at, updated_at)
     VALUES ($1, $2, $3, null, $4, 5, now(), now())`,
    [folderId, tenantId, libraryId, name],
  );
  return folderId;
}

async function seedDocumentType(runner: QueryRunner, tenantId: string, name: string) {
  const typeId = randomUUID();
  await runner.query(
    `INSERT INTO document_types (id, tenant_id, name, description, template_content, is_active, is_system, is_default, display_order, created_at, updated_at)
     VALUES ($1, $2, $3, $3, null, true, false, false, 10, now(), now())`,
    [typeId, tenantId, name],
  );
  return typeId;
}

async function seedDocument(
  runner: QueryRunner,
  tenantId: string,
  libraryId: string,
  folderId: string | null,
  documentTypeId: string,
  title: string,
  content = 'body',
) {
  const documentId = randomUUID();
  await runner.query(
    `INSERT INTO documents (
       id, tenant_id, item_number, title, summary, content_markdown, content_plain,
       library_id, folder_id, document_type_id, status, revision, current_version_number,
       created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, 'published', 1, 1, now(), now())`,
    [documentId, tenantId, nextItemNumber(), title, `${title} summary`, content,
      libraryId, folderId, documentTypeId],
  );
  await runner.query(
    `INSERT INTO document_versions (
       id, tenant_id, document_id, version_number, title, summary, content_markdown, content_plain,
       change_note, created_by, created_at
     )
     VALUES ($1, $2, $3, 1, $4, $5, $6, $6, 'Initial version', null, now())`,
    [randomUUID(), tenantId, documentId, title, `${title} summary`, content],
  );
  return documentId;
}

async function seedIncident(
  runner: QueryRunner,
  tenantId: string,
  title: string,
  opts: { confidential?: boolean; ownerUserId?: string | null } = {},
) {
  const incidentId = randomUUID();
  await runner.query(
    `INSERT INTO incidents (
       id, tenant_id, item_number, title, severity, status, detected_at,
       reporter_user_id, owner_user_id, confidential, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, 'minor', 'open', now(), null, $5, $6, now(), now())`,
    [incidentId, tenantId, nextItemNumber(), title, opts.ownerUserId ?? null, opts.confidential === true],
  );
  return incidentId;
}

async function bindReview(runner: QueryRunner, tenantId: string, incidentId: string, documentId: string) {
  await runner.query(
    `INSERT INTO integrated_document_bindings (
       id, tenant_id, source_entity_type, source_entity_id, slot_key, document_id,
       hidden_from_entity_knowledge, created_at, updated_at
     )
     VALUES ($1, $2, 'incidents', $3, 'review', $4, true, now(), now())`,
    [randomUUID(), tenantId, incidentId, documentId],
  );
  await runner.query(
    `INSERT INTO document_incidents (tenant_id, document_id, incident_id, created_at)
     VALUES ($1, $2, $3, now())`,
    [tenantId, documentId, incidentId],
  );
}

async function seedFixture(runner: QueryRunner, tenantId: string) {
  const tag = randomUUID().slice(0, 8);

  const roles = {
    member: await seedRole(runner, tenantId, `Knowledge member ${tag}`, { knowledge: 'member' }),
    reader: await seedRole(runner, tenantId, `Knowledge reader ${tag}`, { knowledge: 'reader' }),
    incidentReader: await seedRole(runner, tenantId, `Incident reader ${tag}`, { knowledge: 'member', incidents: 'reader' }),
    incidentOwner: await seedRole(runner, tenantId, `Incident owner ${tag}`, { knowledge: 'member', incidents: 'contributor' }),
  };
  const users = {
    member: await seedUser(runner, tenantId, roles.member, `member-${tag}@example.com`),
    nonMember: await seedUser(runner, tenantId, roles.reader, `reader-${tag}@example.com`),
    incidentReader: await seedUser(runner, tenantId, roles.incidentReader, `increader-${tag}@example.com`),
    incidentOwner: await seedUser(runner, tenantId, roles.incidentOwner, `incowner-${tag}@example.com`),
  };

  const restrictedLibrary = await seedLibrary(runner, tenantId, `restricted-${tag}`, 'restricted');
  const openLibrary = await seedLibrary(runner, tenantId, `open-${tag}`, 'default');
  const restrictedFolder = await seedFolder(runner, tenantId, restrictedLibrary, `Restricted folder ${tag}`);
  const openFolder = await seedFolder(runner, tenantId, openLibrary, `Open folder ${tag}`);
  const documentType = await seedDocumentType(runner, tenantId, `Type ${tag}`);

  await runner.query(
    `INSERT INTO document_library_members (id, tenant_id, library_id, user_id, access_level, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'reader', now(), now())`,
    [randomUUID(), tenantId, restrictedLibrary, users.member],
  );

  const docs = {
    restricted: await seedDocument(runner, tenantId, restrictedLibrary, restrictedFolder, documentType, `Restricted doc ${tag}`, `restrictedmarker${tag}`),
    open: await seedDocument(runner, tenantId, openLibrary, openFolder, documentType, `Open doc ${tag}`, `openmarker${tag}`),
    confidentialReview: await seedDocument(runner, tenantId, openLibrary, openFolder, documentType, `Confidential review ${tag}`, `reviewmarker${tag}`),
    openReview: await seedDocument(runner, tenantId, openLibrary, openFolder, documentType, `Open review ${tag}`, `reviewmarker${tag}`),
  };
  const incidents = {
    confidential: await seedIncident(runner, tenantId, `Confidential incident ${tag}`, {
      confidential: true,
      ownerUserId: users.incidentOwner,
    }),
    open: await seedIncident(runner, tenantId, `Open incident ${tag}`),
  };
  await bindReview(runner, tenantId, incidents.confidential, docs.confidentialReview);
  await bindReview(runner, tenantId, incidents.open, docs.openReview);

  return {
    tag, tenantId, roles, users, restrictedLibrary, openLibrary, restrictedFolder, openFolder,
    documentType, docs, incidents,
  };
}

async function withTenantRunner<T>(tenantId: string, fn: (runner: QueryRunner) => Promise<T>): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    return await fn(runner);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }
}

type Fixture = Awaited<ReturnType<typeof seedFixture>>;

async function readerFor(
  runner: QueryRunner,
  tenantId: string,
  userId: string,
): Promise<ReferenceReader> {
  const knowledge = createKnowledgeService(runner.manager);
  const checks = {
    knowledge_document: (ids: readonly string[]) =>
      knowledge.readableDocumentIds(runner.manager, tenantId, userId, ids),
    knowledge_folder: (ids: readonly string[]) =>
      knowledge.readableFolderIds(runner.manager, tenantId, userId, ids),
    knowledge_library: (ids: readonly string[]) =>
      knowledge.readableLibraryIds(runner.manager, tenantId, userId, ids),
  } satisfies Partial<Record<FamilyCodeCheckKey, (ids: readonly string[]) => Promise<ReadonlySet<string>>>>;
  return {
    manager: runner.manager,
    tenantId,
    userId,
    isAdmin: false,
    viewer: await resolveIncidentViewer(runner.manager, userId, tenantId),
    checks,
  };
}

async function testRestrictedLibrary(f: Fixture) {
  await withTenantRunner(f.tenantId, async (runner) => {
    const member = await readerFor(runner, f.tenantId, f.users.member);
    const nonMember = await readerFor(runner, f.tenantId, f.users.nonMember);

    assert.equal(await recordIsVisible(member, 'document', f.docs.restricted), true, 'a member reads the restricted document');
    assert.equal(await recordIsVisible(nonMember, 'document', f.docs.restricted), false, 'a non-member is refused');
    assert.equal(await recordIsVisible(nonMember, 'document', f.docs.open), true, 'the default library stays readable');

    assert.equal(await recordIsVisible(member, 'document_folder', f.restrictedFolder), true, 'the folder follows its library');
    assert.equal(await recordIsVisible(nonMember, 'document_folder', f.restrictedFolder), false, 'a folder of a restricted library is hidden');
    assert.equal(await recordIsVisible(member, 'document_library', f.restrictedLibrary), true, 'a member names the restricted library');
    assert.equal(await recordIsVisible(nonMember, 'document_library', f.restrictedLibrary), false, 'a non-member does not');
    assert.equal(await recordIsVisible(nonMember, 'document_type', f.documentType), true, 'a document type is tenant configuration');
    assert.equal(await recordIsVisible(nonMember, 'document', randomUUID()), false, 'a missing document is not visible');

    // A citation: the restricted document is named for the member, hidden for the non-member; the
    // open one is named for both.
    const ids = new Map<FamilyKey, Set<string>>([['document', new Set([f.docs.restricted, f.docs.open])]]);
    const memberRefs = await loadReferences(member, ids, readableFamilies({ isAdmin: false, permissions: { knowledge: 'member' } }));
    const memberDocs = memberRefs.get('document')!;
    assert.equal(memberDocs.size, 2, 'the member names both documents');
    assert.equal(memberDocs.get(f.docs.restricted)?.label, `Restricted doc ${f.tag}`);
    assert.match(String(memberDocs.get(f.docs.restricted)?.reference), /^DOC-\d+$/, 'the business reference is DOC-n');

    const nonMemberRefs = await loadReferences(nonMember, ids, readableFamilies({ isAdmin: false, permissions: { knowledge: 'reader' } }));
    const nonMemberDocs = nonMemberRefs.get('document')!;
    assert.equal(nonMemberDocs.size, 1, 'the non-member names only the open document');
    assert.equal(nonMemberDocs.has(f.docs.restricted), false, 'the restricted document is hidden');
    assert.equal(nonMemberDocs.get(f.docs.open)?.label, `Open doc ${f.tag}`);

    const noModule = await loadReferences(nonMember, ids, readableFamilies({ isAdmin: false, permissions: {} }));
    assert.equal(noModule.get('document')!.size, 0, 'without knowledge:reader the family is not read at all');
    console.log('  restricted library: member reads, non-member refused, references named or hidden: OK');
  });
}

async function testIncidentReview(f: Fixture) {
  await withTenantRunner(f.tenantId, async (runner) => {
    const incidentReader = await readerFor(runner, f.tenantId, f.users.incidentReader);
    const incidentOwner = await readerFor(runner, f.tenantId, f.users.incidentOwner);

    assert.equal(
      await recordIsVisible(incidentReader, 'document', f.docs.confidentialReview),
      false,
      'a confidential review is refused to an incidents reader outside its rule',
    );
    assert.equal(
      await recordIsVisible(incidentOwner, 'document', f.docs.confidentialReview),
      true,
      'its owner reads the confidential review',
    );
    assert.equal(
      await recordIsVisible(incidentReader, 'document', f.docs.openReview),
      true,
      'an open review is read by an incidents reader',
    );
    console.log('  incident review: confidential refused outside the rule, owner and open review allowed: OK');
  });
}

async function testCrossTenant(f: Fixture, foreign: { tenantId: string; documentId: string }) {
  await withTenantRunner(f.tenantId, async (runner) => {
    const member = await readerFor(runner, f.tenantId, f.users.member);
    assert.equal(await recordIsVisible(member, 'document', foreign.documentId), false, 'a document of another tenant is not visible');
  });
  console.log('  cross-tenant document: hidden: OK');
}

async function run() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('record-history-documents');
  const foreignTenantId = await createRaceTenant('record-history-documents-foreign');
  try {
    const fixture = await seed(tenantId, (runner) => seedFixture(runner, tenantId));
    const foreign = await seed(foreignTenantId, async (runner) => {
      // `seed` sets the tenant; seed a tenant row of its own is unnecessary.
      const tag = randomUUID().slice(0, 8);
      const libraryId = await seedLibrary(runner, foreignTenantId, `foreign-${tag}`, 'default');
      const documentType = await seedDocumentType(runner, foreignTenantId, `Foreign type ${tag}`);
      const documentId = await seedDocument(runner, foreignTenantId, libraryId, null, documentType, `Foreign doc ${tag}`);
      return { tenantId: foreignTenantId, documentId };
    });

    await testRestrictedLibrary(fixture);
    await testIncidentReview(fixture);
    await testCrossTenant(fixture, foreign);
    console.log('record-history-documents.integration.spec: ok');
  } finally {
    await dropRaceTenant(tenantId);
    await dropRaceTenant(foreignTenantId);
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
