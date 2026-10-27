/**
 * §3.7 / §3.3 integration coverage for the incident review document.
 *
 * Runs the real SQL against `DATABASE_URL` (CI migrates a blank `appdb` first).
 * Every test seeds inside a transaction that is rolled back afterwards.
 */
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { KnowledgeService } from '../knowledge.service';
import {
  buildIncidentReviewImportContext,
  buildIncidentReviewSourceContext,
  documentIncidentVisibilitySql,
  resolveDocumentIncidentViewer,
} from '../document-entity-visibility';
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
import { AiQueryExecutor } from '../../ai/query/ai-query.executor';
import { AiAggregateExecutor } from '../../ai/query/ai-aggregate.executor';
import { AiEntityService } from '../../ai/ai-entity.service';
import { collectAliveInlineAttachmentIds } from '../../cleanup/orphaned-attachment-cleanup.service';
import { resolveIncidentViewer } from '../../incidents/incident-visibility';

type Fixture = Awaited<ReturnType<typeof seedFixture>>;

const shareCalls: any[] = [];

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
  const notifications: any = { notifyShare: async (params: any) => { shareCalls.push(params); } };
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

async function setCurrentTenant(runner: QueryRunner, tenantId: string) {
  await runner.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
}

async function seedTenant(runner: QueryRunner, tenantId: string, slug: string) {
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', now(), now())`,
    [tenantId, slug, slug],
  );
}

async function seedRole(
  runner: QueryRunner,
  tenantId: string,
  roleName: string,
  permissions: Record<string, 'reader' | 'contributor' | 'member' | 'admin'>,
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

let itemCounter = 5000;
function nextItemNumber(): number {
  itemCounter += 1;
  return itemCounter;
}

async function seedDocument(
  runner: QueryRunner,
  tenantId: string,
  libraryId: string,
  folderId: string,
  documentTypeId: string,
  title: string,
  content: string,
) {
  const documentId = randomUUID();
  await runner.query(
    `INSERT INTO documents (
       id, tenant_id, item_number, title, summary, content_markdown, content_plain,
       library_id, folder_id, document_type_id, status, revision, current_version_number,
       created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'published', 1, 1, now(), now())`,
    [documentId, tenantId, nextItemNumber(), title, `${title} summary`, content, content,
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
  opts: {
    title: string;
    confidential?: boolean;
    status?: string;
    ownerUserId?: string | null;
    reporterUserId?: string | null;
  },
) {
  const incidentId = randomUUID();
  await runner.query(
    `INSERT INTO incidents (
       id, tenant_id, item_number, title, severity, status, detected_at,
       reporter_user_id, owner_user_id, confidential, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, 'minor', $5, now(), $6, $7, $8, now(), now())`,
    [incidentId, tenantId, nextItemNumber(), opts.title, opts.status ?? 'open',
      opts.reporterUserId ?? null, opts.ownerUserId ?? null, opts.confidential === true],
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

async function seedFixture(runner: QueryRunner) {
  const tag = randomUUID().slice(0, 8);
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  await seedTenant(runner, tenantId, `a2-${tag}`);
  await seedTenant(runner, otherTenantId, `a2-other-${tag}`);
  await setCurrentTenant(runner, tenantId);

  const roles = {
    // Reads applications too: the Knowledge branch names a document's linked applications to their readers.
    incidentsAdmin: await seedRole(runner, tenantId, `IncAdmin ${tag}`, { incidents: 'admin', knowledge: 'member', applications: 'reader' }),
    incidentsContributor: await seedRole(runner, tenantId, `IncContrib ${tag}`, { incidents: 'contributor', knowledge: 'member' }),
    incidentsReader: await seedRole(runner, tenantId, `IncReader ${tag}`, { incidents: 'reader', knowledge: 'member' }),
    // Reporter with no Knowledge permission at all: only the source context can let them in.
    incidentsOnly: await seedRole(runner, tenantId, `IncOnly ${tag}`, { incidents: 'contributor' }),
    knowledgeMember: await seedRole(runner, tenantId, `KnowMember ${tag}`, { knowledge: 'member' }),
    knowledgeAdmin: await seedRole(runner, tenantId, `KnowAdmin ${tag}`, { knowledge: 'admin' }),
  };

  const users = {
    incidentsAdmin: await seedUser(runner, tenantId, roles.incidentsAdmin, `incadmin-${tag}@example.com`),
    owner: await seedUser(runner, tenantId, roles.incidentsContributor, `owner-${tag}@example.com`),
    reporter: await seedUser(runner, tenantId, roles.incidentsOnly, `reporter-${tag}@example.com`),
    thirdParty: await seedUser(runner, tenantId, roles.knowledgeMember, `third-${tag}@example.com`),
    knowledgeAdmin: await seedUser(runner, tenantId, roles.knowledgeAdmin, `knowadmin-${tag}@example.com`),
    incidentsReaderOnly: await seedUser(runner, tenantId, roles.incidentsReader, `increader-${tag}@example.com`),
  };

  const libraryId = randomUUID();
  await runner.query(
    `INSERT INTO document_libraries (id, tenant_id, name, slug, is_system, display_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, true, 9, now(), now())`,
    [libraryId, tenantId, `Managed Docs ${tag}`, `managed-docs-${tag}`],
  );
  const folderId = randomUUID();
  await runner.query(
    `INSERT INTO document_folders (id, tenant_id, library_id, parent_id, name, system_key, display_order, created_at, updated_at)
     VALUES ($1, $2, $3, null, $4, $5, 5, now(), now())`,
    [folderId, tenantId, libraryId, `Incidents ${tag}`, `integrated_incidents_${tag}`],
  );
  const documentTypeId = randomUUID();
  await runner.query(
    `INSERT INTO document_types (
       id, tenant_id, name, description, template_content, is_active, is_system, is_default,
       system_key, display_order, created_at, updated_at
     )
     VALUES ($1, $2, $3, $3, null, true, true, false, $4, 105, now(), now())`,
    [documentTypeId, tenantId, `Incident review ${tag}`, `integrated_incident_review_${tag}`],
  );
  // A separate type for the plain document, so filter values prove the review
  // type never surfaces to a caller without incidents rights.
  const plainDocumentTypeId = randomUUID();
  await runner.query(
    `INSERT INTO document_types (
       id, tenant_id, name, description, template_content, is_active, is_system, is_default,
       system_key, display_order, created_at, updated_at
     )
     VALUES ($1, $2, $3, $3, null, true, false, false, null, 10, now(), now())`,
    [plainDocumentTypeId, tenantId, `Plain type ${tag}`],
  );

  const incidents = {
    open: await seedIncident(runner, tenantId, {
      title: `Open incident ${tag}`, ownerUserId: users.owner, reporterUserId: users.reporter,
    }),
    confidential: await seedIncident(runner, tenantId, {
      title: `Confidential incident ${tag}`, confidential: true,
      ownerUserId: users.owner, reporterUserId: users.reporter,
    }),
    confidentialOwnerOnly: await seedIncident(runner, tenantId, {
      title: `Confidential owner-only ${tag}`, confidential: true,
      ownerUserId: users.owner, reporterUserId: null,
    }),
    confidentialReporterOnly: await seedIncident(runner, tenantId, {
      title: `Confidential reporter-only ${tag}`, confidential: true,
      ownerUserId: null, reporterUserId: users.reporter,
    }),
    confidentialNobody: await seedIncident(runner, tenantId, {
      title: `Confidential nobody ${tag}`, confidential: true, ownerUserId: null, reporterUserId: null,
    }),
    closed: await seedIncident(runner, tenantId, {
      title: `Closed incident ${tag}`, status: 'closed',
      ownerUserId: users.owner, reporterUserId: users.reporter,
    }),
  };

  const docs = {
    plain: await seedDocument(runner, tenantId, libraryId, folderId, plainDocumentTypeId, `Plain doc ${tag}`, `plainmarker${tag}`),
    open: await seedDocument(runner, tenantId, libraryId, folderId, documentTypeId, `Open review ${tag}`, `reviewmarker${tag}`),
    confidential: await seedDocument(runner, tenantId, libraryId, folderId, documentTypeId, `Conf review ${tag}`, `reviewmarker${tag}`),
    confidentialOwnerOnly: await seedDocument(runner, tenantId, libraryId, folderId, documentTypeId, `Conf owner review ${tag}`, `reviewmarker${tag}`),
    confidentialReporterOnly: await seedDocument(runner, tenantId, libraryId, folderId, documentTypeId, `Conf reporter review ${tag}`, `reviewmarker${tag}`),
    confidentialNobody: await seedDocument(runner, tenantId, libraryId, folderId, documentTypeId, `Conf nobody review ${tag}`, `reviewmarker${tag}`),
    closed: await seedDocument(runner, tenantId, libraryId, folderId, documentTypeId, `Closed review ${tag}`, `reviewmarker${tag}`),
    orphan: await seedDocument(runner, tenantId, libraryId, folderId, documentTypeId, `Orphan review ${tag}`, `reviewmarker${tag}`),
  };

  await bindReview(runner, tenantId, incidents.open, docs.open);
  await bindReview(runner, tenantId, incidents.confidential, docs.confidential);
  await bindReview(runner, tenantId, incidents.confidentialOwnerOnly, docs.confidentialOwnerOnly);
  await bindReview(runner, tenantId, incidents.confidentialReporterOnly, docs.confidentialReporterOnly);
  await bindReview(runner, tenantId, incidents.confidentialNobody, docs.confidentialNobody);
  await bindReview(runner, tenantId, incidents.closed, docs.closed);
  // Orphan: the binding points at an incident row that does not exist.
  await runner.query(
    `INSERT INTO integrated_document_bindings (
       id, tenant_id, source_entity_type, source_entity_id, slot_key, document_id,
       hidden_from_entity_knowledge, created_at, updated_at
     )
     VALUES ($1, $2, 'incidents', $3, 'review', $4, true, now(), now())`,
    [randomUUID(), tenantId, randomUUID(), docs.orphan],
  );

  return {
    tag, tenantId, otherTenantId, roles, users, libraryId, folderId,
    documentTypeId, plainDocumentTypeId, incidents, docs,
  };
}

async function selectVisibleDocumentIds(
  runner: QueryRunner,
  fixture: Fixture,
  userId: string | null,
): Promise<Set<string>> {
  const viewer = await resolveDocumentIncidentViewer(runner.manager, userId, fixture.tenantId);
  const params: unknown[] = [fixture.tenantId];
  const clause = documentIncidentVisibilitySql('d', viewer, params);
  const rows: Array<{ id: string }> = await runner.manager.query(
    `SELECT d.id::text AS id FROM documents d WHERE d.tenant_id = $1 ${clause}`,
    params,
  );
  return new Set(rows.map((row) => row.id));
}

function assertSet(actual: Set<string>, expected: string[], label: string) {
  const expectedSet = new Set(expected);
  assert.deepEqual(
    [...actual].sort(),
    [...expectedSet].sort(),
    `${label}: unexpected visible documents`,
  );
}

async function withFixture(fn: (runner: QueryRunner, fixture: Fixture) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const fixture = await seedFixture(runner);
    await setCurrentTenant(runner, fixture.tenantId);
    await fn(runner, fixture);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

// ---------------------------------------------------------------------------
// 1. The executed SQL matrix
// ---------------------------------------------------------------------------

async function testExecutedSqlMatrix() {
  await withFixture(async (runner, f) => {
    const all = Object.values(f.docs);
    const nonIncident = [f.docs.plain];

    assertSet(
      await selectVisibleDocumentIds(runner, f, f.users.incidentsAdmin),
      all.filter((id) => id !== f.docs.orphan),
      'incidents admin sees every review except the orphan binding',
    );
    assertSet(
      await selectVisibleDocumentIds(runner, f, f.users.owner),
      [f.docs.plain, f.docs.open, f.docs.confidential, f.docs.confidentialOwnerOnly, f.docs.closed],
      'owner',
    );
    assertSet(
      await selectVisibleDocumentIds(runner, f, f.users.reporter),
      [f.docs.plain, f.docs.open, f.docs.confidential, f.docs.confidentialReporterOnly, f.docs.closed],
      'reporter',
    );
    assertSet(
      await selectVisibleDocumentIds(runner, f, f.users.incidentsReaderOnly),
      [f.docs.plain, f.docs.open, f.docs.closed],
      'third party with incidents:reader',
    );
    assertSet(
      await selectVisibleDocumentIds(runner, f, f.users.thirdParty),
      nonIncident,
      'Knowledge member without incidents rights sees no review at all',
    );
    assertSet(
      await selectVisibleDocumentIds(runner, f, f.users.knowledgeAdmin),
      nonIncident,
      'Knowledge admin is not a registry admin',
    );
    assertSet(
      await selectVisibleDocumentIds(runner, f, null),
      nonIncident,
      'anonymous',
    );

    // Tenant separation: a user of tenant B resolves to no incidents rights and
    // the predicate is evaluated per tenant anyway.
    const crossTenantViewer = await resolveDocumentIncidentViewer(
      runner.manager,
      f.users.incidentsAdmin,
      f.otherTenantId,
    );
    assert.deepEqual(
      crossTenantViewer,
      { userId: f.users.incidentsAdmin, isAdmin: false, canReadIncidents: false, canContributeIncidents: false },
      'permissions are never inherited across tenants',
    );
  });
}

// ---------------------------------------------------------------------------
// 2. Unit reads through KnowledgeService
// ---------------------------------------------------------------------------

async function expectNotFound(promise: Promise<unknown>, label: string) {
  await assert.rejects(promise, (error: any) => {
    const status = error?.getStatus?.();
    assert.ok(status === 404 || status === 403, `${label}: expected 404/403, got ${status} (${error?.message})`);
    return true;
  }, label);
}

async function testUnitReads() {
  await withFixture(async (runner, f) => {
    const knowledge = createKnowledgeService(runner.manager);

    // Authorized: owner reads the confidential review through Knowledge.
    const ownerView = await knowledge.get(f.docs.confidential, { manager: runner.manager, userId: f.users.owner });
    assert.equal(ownerView.id, f.docs.confidential);
    assert.equal(ownerView.can_write, true, 'owner is incidents:contributor on an open incident');

    // Third party with Knowledge rights but no incidents rights: 404 everywhere.
    for (const [label, run] of Object.entries({
      get: () => knowledge.get(f.docs.confidential, { manager: runner.manager, userId: f.users.thirdParty }),
      versions: () => knowledge.listVersions(f.docs.confidential, { manager: runner.manager, userId: f.users.thirdParty }),
      version: () => knowledge.getVersion(f.docs.confidential, 1, { manager: runner.manager, userId: f.users.thirdParty }),
      compare: () => knowledge.compareVersions(f.docs.confidential, 1, 1, { manager: runner.manager, userId: f.users.thirdParty }),
      activities: () => knowledge.listActivities(f.docs.confidential, { manager: runner.manager, userId: f.users.thirdParty }),
      attachments: () => knowledge.listAttachments(f.docs.confidential, { manager: runner.manager, userId: f.users.thirdParty }),
      backlinks: () => knowledge.listIncomingReferences(f.docs.confidential, { manager: runner.manager, userId: f.users.thirdParty }),
      export: () => knowledge.exportDocument(f.docs.confidential, 'pdf', { manager: runner.manager, userId: f.users.thirdParty }),
    })) {
      await expectNotFound(run(), `third party ${label}`);
    }

    // Even a non-confidential review needs incidents rights.
    await expectNotFound(
      knowledge.get(f.docs.open, { manager: runner.manager, userId: f.users.thirdParty }),
      'third party on a non-confidential review',
    );
    // …and a plain document in the same library stays readable.
    assert.equal(
      (await knowledge.get(f.docs.plain, { manager: runner.manager, userId: f.users.thirdParty })).id,
      f.docs.plain,
    );

    // Knowledge admin without incidents:admin cannot read a confidential review.
    await expectNotFound(
      knowledge.get(f.docs.confidential, { manager: runner.manager, userId: f.users.knowledgeAdmin }),
      'Knowledge admin',
    );

    // Orphan binding: refused for everyone, admin included.
    await expectNotFound(
      knowledge.get(f.docs.orphan, { manager: runner.manager, userId: f.users.incidentsAdmin }),
      'orphan binding',
    );

    // Reader-level incidents user: reads, cannot write.
    const readerView = await knowledge.get(f.docs.open, { manager: runner.manager, userId: f.users.incidentsReaderOnly });
    assert.equal(readerView.can_write, false, 'incidents:reader must not be offered write actions');

    // Closed incident: readable, never writable.
    const closedView = await knowledge.get(f.docs.closed, { manager: runner.manager, userId: f.users.owner });
    assert.equal(closedView.can_write, false, 'a closed incident freezes its review in Knowledge too');
  });
}

// ---------------------------------------------------------------------------
// 3. List / search / option paths
// ---------------------------------------------------------------------------

async function testListPaths() {
  await withFixture(async (runner, f) => {
    const knowledge = createKnowledgeService(runner.manager);
    const marker = `reviewmarker${f.tag}`;

    const asThirdParty = { manager: runner.manager, userId: f.users.thirdParty, tenantId: f.tenantId };
    const asOwner = { manager: runner.manager, userId: f.users.owner, tenantId: f.tenantId };

    const listThird = await knowledge.list({ limit: 100 }, asThirdParty);
    const listThirdIds = new Set(listThird.items.map((row: any) => String(row.id)));
    assert.equal(listThirdIds.has(f.docs.plain), true);
    for (const documentId of [f.docs.open, f.docs.confidential, f.docs.closed, f.docs.orphan]) {
      assert.equal(listThirdIds.has(documentId), false, 'list must hide reviews from a user without incidents rights');
    }

    const idsThird = await knowledge.listIds({ limit: 1000 }, asThirdParty);
    assert.equal(idsThird.ids.includes(f.docs.open), false);
    const idsOwner = await knowledge.listIds({ limit: 1000 }, asOwner);
    assert.equal(idsOwner.ids.includes(f.docs.open), true);
    assert.equal(idsOwner.ids.includes(f.docs.confidentialNobody), false);
    assert.ok(idsOwner.total > idsThird.total, 'totals are filtered before pagination');

    const searchThird = await knowledge.search({ q: marker, limit: 100 }, asThirdParty);
    assert.equal(searchThird.items.length, 0, 'search leaks nothing to a user without incidents rights');
    assert.equal(searchThird.total, 0);
    const searchOwner = await knowledge.search({ q: marker, limit: 100 }, asOwner);
    const searchOwnerIds = new Set(searchOwner.items.map((row: any) => String(row.id)));
    assert.equal(searchOwnerIds.has(f.docs.open), true);
    assert.equal(searchOwnerIds.has(f.docs.confidentialNobody), false);
    assert.equal(searchOwnerIds.has(f.docs.orphan), false);

    const mentionsThird = await knowledge.searchMentionOptions({ q: `Conf review ${f.tag}`, limit: 50 }, asThirdParty);
    assert.equal(mentionsThird.items.length, 0);
    const linkThird = await knowledge.listLinkOptions({ q: `Conf review ${f.tag}`, limit: 50 }, asThirdParty);
    assert.equal(linkThird.items.length, 0);

    const filterThird = await knowledge.listFilterValues({ fields: 'document_type_name' }, asThirdParty);
    const filterOwner = await knowledge.listFilterValues({ fields: 'document_type_name' }, asOwner);
    assert.deepEqual(
      filterThird.document_type_name,
      [`Plain type ${f.tag}`],
      'filter values are computed on the readable rows only',
    );
    assert.equal(
      (filterOwner.document_type_name as string[]).includes(`Incident review ${f.tag}`),
      true,
      'the owner does see the review type they can read',
    );

    // Relation options: the picker never lists an invisible incident.
    const optionsThird = await knowledge.listRelationOptions('incidents', { limit: 50 }, {
      manager: runner.manager, userId: f.users.thirdParty, tenantId: f.tenantId,
    });
    assert.equal(optionsThird.items.length, 0, 'no incidents:reader ⇒ no incident options');
    const optionsReader = await knowledge.listRelationOptions('incidents', { limit: 50 }, {
      manager: runner.manager, userId: f.users.incidentsReaderOnly, tenantId: f.tenantId,
    });
    const optionIds = new Set(optionsReader.items.map((item) => item.id));
    assert.equal(optionIds.has(f.incidents.open), true);
    assert.equal(optionIds.has(f.incidents.confidential), false);

    // `relations.incidents` on a plain document linked to a confidential incident.
    await runner.manager.query(
      `INSERT INTO document_incidents (tenant_id, document_id, incident_id, created_at)
       VALUES ($1, $2, $3, now())`,
      [f.tenantId, f.docs.plain, f.incidents.confidential],
    );
    const plainForThird = await knowledge.get(f.docs.plain, { manager: runner.manager, userId: f.users.thirdParty });
    // A reader of incidents gets an empty list; anyone else no incidents family at all.
    assert.deepEqual(plainForThird.relations.incidents ?? [], [], 'a linked confidential incident is not disclosed');
    const plainForOwner = await knowledge.get(f.docs.plain, { manager: runner.manager, userId: f.users.owner });
    assert.equal(plainForOwner.relations.incidents.length, 1);

    // Entity document lists and knowledge context. The review is normally hidden
    // from the entity panel by its binding; unhide it so the incident filter
    // itself is what is being exercised here.
    await runner.manager.query(
      `UPDATE integrated_document_bindings SET hidden_from_entity_knowledge = false WHERE document_id = $1`,
      [f.docs.confidential],
    );
    const forEntityThird = await knowledge.listDocumentsForEntity('incidents', f.incidents.confidential, asThirdParty);
    assert.equal(
      forEntityThird.items.some((row: any) => String(row.id) === f.docs.confidential),
      false,
      'the entity document list hides the review from a user without incidents rights',
    );
    const forEntityOwner = await knowledge.listDocumentsForEntity('incidents', f.incidents.confidential, asOwner);
    assert.equal(
      forEntityOwner.items.some((row: any) => String(row.id) === f.docs.confidential),
      true,
    );
    assert.ok(forEntityOwner.total > forEntityThird.total, 'the entity total is filtered too');

    const contextThird = await knowledge.getKnowledgeContextForEntity('incidents', f.incidents.confidential, asThirdParty);
    assert.equal(contextThird.total, 0, 'an invisible incident yields no knowledge context source at all');
    const contextOwner = await knowledge.getKnowledgeContextForEntity('incidents', f.incidents.confidential, asOwner);
    assert.ok(contextOwner.total > 0);
  });
}

// ---------------------------------------------------------------------------
// 4. Direct /knowledge writes
// ---------------------------------------------------------------------------

async function readDocumentState(runner: QueryRunner, documentId: string) {
  const rows = await runner.manager.query(
    `SELECT d.content_markdown, d.revision,
            (SELECT count(*)::int FROM document_versions v WHERE v.document_id = d.id) AS versions,
            (SELECT count(*)::int FROM document_attachments a WHERE a.document_id = d.id) AS attachments
     FROM documents d WHERE d.id = $1`,
    [documentId],
  );
  return rows[0];
}

async function testDirectWrites() {
  await withFixture(async (runner, f) => {
    const knowledge = createKnowledgeService(runner.manager);
    const documentId = f.docs.confidential;

    // The owner is a legitimate writer: acquire a lock and save.
    const ownerLock = await knowledge.acquireLock(documentId, f.users.owner, { manager: runner.manager });
    const before = await readDocumentState(runner, documentId);

    // …but the token is not transferable: a third party with Knowledge write rights
    // is refused before any side effect, even holding a token.
    for (const [label, userId] of Object.entries({
      'third party with Knowledge write': f.users.thirdParty,
      'Knowledge admin without incidents admin': f.users.knowledgeAdmin,
      'incidents reader only': f.users.incidentsReaderOnly,
    })) {
      await expectNotFound(
        knowledge.update(
          documentId,
          { content_markdown: `hijacked by ${label}`, revision: before.revision, save_mode: 'manual' },
          userId,
          ownerLock.lock_token,
          { manager: runner.manager },
        ),
        `${label} update`,
      );
      await expectNotFound(
        knowledge.acquireLock(documentId, userId, { manager: runner.manager }),
        `${label} acquireLock`,
      );
      await expectNotFound(
        knowledge.revert(documentId, 1, userId, ownerLock.lock_token, { manager: runner.manager }),
        `${label} revert`,
      );
      await expectNotFound(
        knowledge.createActivity(documentId, { content: 'hi' }, userId, { manager: runner.manager }),
        `${label} createActivity`,
      );
      await expectNotFound(
        knowledge.finalizeImportedDocument(
          documentId,
          { markdown: 'imported', images: [], warnings: [], omittedTargets: [] } as any,
          userId,
          ownerLock.lock_token,
          { manager: runner.manager },
        ),
        `${label} import`,
      );
    }

    const after = await readDocumentState(runner, documentId);
    assert.deepEqual(after, before, 'no refused write may have touched content, revision, versions or attachments');

    // The owner's own save goes through.
    const saved = await knowledge.update(
      documentId,
      { content_markdown: 'owner update', revision: before.revision, save_mode: 'manual' },
      f.users.owner,
      ownerLock.lock_token,
      { manager: runner.manager },
    );
    assert.equal(saved.content_markdown, 'owner update');

    // Force-release needs incidents:admin, not just Knowledge admin.
    await expectNotFound(
      knowledge.forceReleaseLock(documentId, { manager: runner.manager, userId: f.users.knowledgeAdmin }),
      'force release by Knowledge admin',
    );
    await knowledge.forceReleaseLock(documentId, { manager: runner.manager, userId: f.users.incidentsAdmin });
    const remaining = await runner.manager.query(
      'SELECT count(*)::int AS total FROM document_edit_locks WHERE document_id = $1',
      [documentId],
    );
    assert.equal(remaining[0].total, 0);
  });
}

// ---------------------------------------------------------------------------
// 5. Closure freeze, lock rules, and a token obtained before the closure
// ---------------------------------------------------------------------------

async function testClosureFreeze() {
  await withFixture(async (runner, f) => {
    const knowledge = createKnowledgeService(runner.manager);
    const documentId = f.docs.open;

    const lock = await knowledge.acquireLock(documentId, f.users.owner, { manager: runner.manager });
    const before = await readDocumentState(runner, documentId);

    // The incident closes while the editor still holds a valid token.
    await runner.manager.query("UPDATE incidents SET status = 'closed' WHERE id = $1", [f.incidents.open]);

    await expectNotFound(
      knowledge.update(
        documentId,
        { content_markdown: 'after closure', revision: before.revision, save_mode: 'autosave' },
        f.users.owner,
        lock.lock_token,
        { manager: runner.manager },
      ),
      'autosave after closure',
    );
    await expectNotFound(
      knowledge.heartbeatLock(documentId, f.users.owner, lock.lock_token, { manager: runner.manager }),
      'heartbeat after closure',
    );
    await expectNotFound(
      knowledge.acquireLock(documentId, f.users.owner, { manager: runner.manager }),
      'acquire after closure',
    );

    assert.deepEqual(await readDocumentState(runner, documentId), before, 'the frozen review is untouched');

    // Releasing one's own lock stays possible after the closure.
    await knowledge.releaseLock(documentId, f.users.owner, lock.lock_token, { manager: runner.manager });
    const remaining = await runner.manager.query(
      'SELECT count(*)::int AS total FROM document_edit_locks WHERE document_id = $1',
      [documentId],
    );
    assert.equal(remaining[0].total, 0, 'own release must succeed on a closed incident');
  });
}

async function testConfidentialityChangeRevokesImmediately() {
  await withFixture(async (runner, f) => {
    const knowledge = createKnowledgeService(runner.manager);
    const documentId = f.docs.open;

    await expectNotFound(
      knowledge.acquireLock(documentId, f.users.incidentsReaderOnly, { manager: runner.manager }),
      'incidents:reader must never obtain an edit lock',
    );

    const editorLock = await knowledge.acquireLock(documentId, f.users.owner, { manager: runner.manager });
    const before = await readDocumentState(runner, documentId);

    // The incident becomes confidential and the owner is reassigned away.
    await runner.manager.query(
      "UPDATE incidents SET confidential = true, owner_user_id = null, reporter_user_id = null WHERE id = $1",
      [f.incidents.open],
    );

    await expectNotFound(
      knowledge.update(
        documentId,
        { content_markdown: 'after revocation', revision: before.revision, save_mode: 'autosave' },
        f.users.owner,
        editorLock.lock_token,
        { manager: runner.manager },
      ),
      'write after losing access',
    );
    await expectNotFound(
      knowledge.get(documentId, { manager: runner.manager, userId: f.users.owner }),
      'read after losing access',
    );
    assert.deepEqual(await readDocumentState(runner, documentId), before);
  });
}

// ---------------------------------------------------------------------------
// 6. Source access context (reporter without any Knowledge permission)
// ---------------------------------------------------------------------------

async function testSourceAccessContext() {
  await withFixture(async (runner, f) => {
    const knowledge = createKnowledgeService(runner.manager);
    const documentId = f.docs.confidential;
    const sourceContext = buildIncidentReviewSourceContext({
      userId: f.users.reporter,
      tenantId: f.tenantId,
      incidentId: f.incidents.confidential,
    })!;

    // Without the context the reporter has no Knowledge permission at all.
    await expectNotFound(
      knowledge.get(documentId, { manager: runner.manager, userId: f.users.reporter }),
      'reporter through plain Knowledge',
    );

    // With it, read / version / lock / save all work.
    const view = await knowledge.get(documentId, { manager: runner.manager, userId: f.users.reporter, sourceContext });
    assert.equal(view.id, documentId);
    assert.equal(view.can_write, true);
    assert.equal(view.can_manage_library, false, 'the source context never grants library management');

    const versions = await knowledge.listVersions(documentId, {
      manager: runner.manager, userId: f.users.reporter, sourceContext,
    });
    assert.ok(versions.length >= 1);

    const lock = await knowledge.acquireLock(documentId, f.users.reporter, { manager: runner.manager, sourceContext });
    const updated = await knowledge.update(
      documentId,
      { content_markdown: 'written by the reporter', revision: view.revision, save_mode: 'autosave' },
      f.users.reporter,
      lock.lock_token,
      { manager: runner.manager, sourceContext },
    );
    assert.equal(updated.content_markdown, 'written by the reporter');

    // The context is bound to this document only: it grants nothing elsewhere.
    await expectNotFound(
      knowledge.get(f.docs.plain, { manager: runner.manager, userId: f.users.reporter, sourceContext }),
      'source context leaking to another document',
    );
    await expectNotFound(
      knowledge.get(f.docs.open, { manager: runner.manager, userId: f.users.reporter, sourceContext }),
      'source context leaking to another review',
    );

    // A context forged for an incident the user cannot see is refused.
    const forged = buildIncidentReviewSourceContext({
      userId: f.users.reporter,
      tenantId: f.tenantId,
      incidentId: f.incidents.confidentialNobody,
    })!;
    await expectNotFound(
      knowledge.get(f.docs.confidentialNobody, { manager: runner.manager, userId: f.users.reporter, sourceContext: forged }),
      'forged context on an invisible incident',
    );
  });
}

/**
 * S3: reached through the incident's own routes, the caller has no Knowledge
 * right on the document. The review body is theirs; the document's Knowledge
 * neighbourhood (linked applications/projects/…, the template it came from) is
 * not, and must not leak just because the incident let them in.
 */
async function testSourceContextHidesKnowledgeNeighbourhood() {
  await withFixture(async (runner, f) => {
    const knowledge = createKnowledgeService(runner.manager);
    const documentId = f.docs.confidential;

    const applicationId = randomUUID();
    await runner.manager.query(
      `INSERT INTO applications (id, tenant_id, name) VALUES ($1, $2, $3)`,
      [applicationId, f.tenantId, `Linked app ${f.tag}`],
    );
    await runner.manager.query(
      `INSERT INTO document_applications (tenant_id, document_id, application_id, created_at)
       VALUES ($1, $2, $3, now())`,
      [f.tenantId, documentId, applicationId],
    );
    // The plain document stands in for the template this review was created from.
    await runner.manager.query(
      `UPDATE documents SET template_document_id = $1 WHERE id = $2`,
      [f.docs.plain, documentId],
    );

    // Knowledge branch (registry admin who is also a Knowledge member): everything shows.
    const viaKnowledge: any = await knowledge.get(documentId, {
      manager: runner.manager, userId: f.users.incidentsAdmin,
    });
    assert.deepEqual(
      viaKnowledge.relations.applications.map((row: any) => row.id),
      [applicationId],
      'the Knowledge branch still lists the linked applications',
    );
    assert.ok(viaKnowledge.template_document_title, 'the Knowledge branch still names the template');

    // Source branch (reporter with no Knowledge permission at all).
    const sourceContext = buildIncidentReviewSourceContext({
      userId: f.users.reporter,
      tenantId: f.tenantId,
      incidentId: f.incidents.confidential,
    })!;
    const viaSource: any = await knowledge.get(documentId, {
      manager: runner.manager, userId: f.users.reporter, sourceContext,
    });
    assert.equal(viaSource.id, documentId, 'the review itself is still readable');
    for (const kind of ['applications', 'assets', 'projects', 'requests', 'tasks', 'interfaces']) {
      // Empty on the source path; absent as well when the reader cannot read the module.
      assert.deepEqual(viaSource.relations[kind] ?? [], [], `relations.${kind} must be empty on the source path`);
    }
    assert.deepEqual(
      viaSource.relations.incidents.map((row: any) => row.id),
      [f.incidents.confidential],
      'the incident the caller can see stays, it is filtered on its own rights',
    );
    for (const field of [
      'template_document_id',
      'template_document_title',
      'template_document_item_number',
      'template_document_type_id',
      'template_document_type_name',
    ]) {
      assert.equal(viaSource[field], null, `${field} must not leak on the source path`);
    }
  });
}

/**
 * A3: the register viewer and the document viewer must agree on what a user is.
 * A disabled account is nobody on both paths.
 */
async function testDisabledUserFailsClosedOnBothPaths() {
  await withFixture(async (runner, f) => {
    await runner.manager.query(
      `UPDATE users SET status = 'disabled' WHERE id = $1`,
      [f.users.incidentsAdmin],
    );

    const registerViewer = await resolveIncidentViewer(runner.manager, f.users.incidentsAdmin, f.tenantId);
    assert.equal(registerViewer.isAdmin, false, 'a disabled registry admin is not an admin on the register path');

    const documentViewer = await resolveDocumentIncidentViewer(
      runner.manager, f.users.incidentsAdmin, f.tenantId,
    );
    assert.equal(documentViewer.isAdmin, false);
    assert.equal(documentViewer.canReadIncidents, false);
    assert.equal(documentViewer.canContributeIncidents, false);

    assertSet(
      await selectVisibleDocumentIds(runner, f, f.users.incidentsAdmin),
      [f.docs.plain],
      'a disabled user reaches no incident-bound document',
    );

    const knowledge = createKnowledgeService(runner.manager);
    await expectNotFound(
      knowledge.get(f.docs.open, { manager: runner.manager, userId: f.users.incidentsAdmin }),
      'disabled registry admin on a review',
    );
  });
}

// ---------------------------------------------------------------------------
// 7. Versioning policy (§3.3)
// ---------------------------------------------------------------------------

async function testVersioningPolicy() {
  await withFixture(async (runner, f) => {
    const knowledge = createKnowledgeService(runner.manager);

    const reviewId = f.docs.open;
    const lock = await knowledge.acquireLock(reviewId, f.users.owner, { manager: runner.manager });
    let state = await readDocumentState(runner, reviewId);
    const baseVersions = state.versions;

    const first = await knowledge.update(
      reviewId,
      { content_markdown: 'autosaved once', revision: state.revision, save_mode: 'autosave' },
      f.users.owner,
      lock.lock_token,
      { manager: runner.manager },
    );
    state = await readDocumentState(runner, reviewId);
    assert.equal(state.versions, baseVersions + 1, 'an autosave that changes the review creates a version');

    await knowledge.update(
      reviewId,
      { content_markdown: 'autosaved once', revision: first.revision, save_mode: 'autosave' },
      f.users.owner,
      lock.lock_token,
      { manager: runner.manager },
    );
    state = await readDocumentState(runner, reviewId);
    assert.equal(state.versions, baseVersions + 1, 'an identical save adds no version');

    // Another document type keeps the historical behaviour.
    const plainLock = await knowledge.acquireLock(f.docs.plain, f.users.owner, { manager: runner.manager });
    const plainBefore = await readDocumentState(runner, f.docs.plain);
    await knowledge.update(
      f.docs.plain,
      { content_markdown: 'plain autosave', revision: plainBefore.revision, save_mode: 'autosave' },
      f.users.owner,
      plainLock.lock_token,
      { manager: runner.manager },
    );
    const plainAfter = await readDocumentState(runner, f.docs.plain);
    assert.equal(plainAfter.versions, plainBefore.versions, 'ordinary documents still version on manual save only');
  });
}

// ---------------------------------------------------------------------------
// 8. Inline attachments, including images kept only by an older version
// ---------------------------------------------------------------------------

async function testInlineAttachments() {
  await withFixture(async (runner, f) => {
    const knowledge = createKnowledgeService(runner.manager) as any;
    const documentId = f.docs.confidential;
    const attachmentId = randomUUID();
    const url = `/api/knowledge/inline/tenant/${attachmentId}`;

    await runner.manager.query(
      `INSERT INTO document_attachments (
         id, tenant_id, document_id, original_filename, stored_filename, mime_type, size,
         storage_path, source_field, uploaded_by_id, uploaded_at
       )
       VALUES ($1, $2, $3, 'shot.png', 'shot.png', 'image/png', 10, $4, 'content_markdown', $5, now())`,
      [attachmentId, f.tenantId, documentId, `files/${attachmentId}.png`, f.users.owner],
    );

    // Put the image in the current body, save (creates a version), then remove it.
    const lock = await knowledge.acquireLock(documentId, f.users.owner, { manager: runner.manager });
    let state = await readDocumentState(runner, documentId);
    const withImage = await knowledge.update(
      documentId,
      { content_markdown: `![shot](${url})`, revision: state.revision, save_mode: 'manual' },
      f.users.owner,
      lock.lock_token,
      { manager: runner.manager },
    );
    await knowledge.update(
      documentId,
      { content_markdown: 'image removed', revision: withImage.revision, save_mode: 'manual' },
      f.users.owner,
      lock.lock_token,
      { manager: runner.manager },
    );

    const stillThere = await runner.manager.query(
      'SELECT count(*)::int AS total FROM document_attachments WHERE id = $1',
      [attachmentId],
    );
    assert.equal(stillThere[0].total, 1, 'an image kept by an older version is not an orphan');

    // Same rule for the nightly cron: `document_versions` is one of its content
    // sources, so the attachment is in the alive set and never swept.
    const alive = await collectAliveInlineAttachmentIds(runner.manager);
    assert.equal(
      alive.has(attachmentId),
      true,
      'the orphan-cleanup cron must treat an attachment kept by a version as alive',
    );

    // ACL on the exact parent, from the cookie identity, with no knowledge:reader fallback.
    const parent = { documentId, integratedBinding: { source_entity_type: 'incidents' as const } };
    const gate = (userId: string | null) => {
      const service = createKnowledgeService(runner.manager) as any;
      service.resolveUserIdFromRefreshToken = async () => userId;
      return service.ensureInlineAttachmentAccess(runner.manager, f.tenantId, 'cookie', parent);
    };
    assert.equal(await gate(f.users.owner), true);
    assert.equal(await gate(f.users.reporter), true, 'a reporter without Knowledge rights still sees the image');
    assert.equal(await gate(f.users.knowledgeAdmin), false, 'knowledge:reader is no fallback for an incident review');
    assert.equal(await gate(f.users.incidentsReaderOnly), false, 'confidential incident, not owner nor reporter');
    assert.equal(await gate(f.users.incidentsAdmin), true);
    assert.equal(await gate(null), false, 'no cookie identity');
  });
}

// ---------------------------------------------------------------------------
// 9. Share recipients
// ---------------------------------------------------------------------------

async function testShareRecipients() {
  await withFixture(async (runner, f) => {
    const knowledge = createKnowledgeService(runner.manager);
    shareCalls.length = 0;

    await assert.rejects(
      knowledge.share(
        f.docs.confidential,
        { recipient_user_ids: [f.users.thirdParty] } as any,
        f.tenantId,
        f.users.owner,
        { manager: runner.manager },
      ),
      (error: any) => {
        assert.equal(error?.getStatus?.(), 403);
        assert.equal(/confidential|incident|INC-/i.test(String(error?.message)), false, 'the error must not describe the document');
        return true;
      },
    );
    assert.equal(shareCalls.length, 0, 'nothing is queued when a recipient is not allowed');

    await assert.rejects(
      knowledge.share(
        f.docs.confidential,
        { recipient_emails: ['outside@example.com'] } as any,
        f.tenantId,
        f.users.owner,
        { manager: runner.manager },
      ),
      (error: any) => error?.getStatus?.() === 403,
    );
    assert.equal(shareCalls.length, 0);

    await knowledge.share(
      f.docs.confidential,
      { recipient_user_ids: [f.users.incidentsAdmin] } as any,
      f.tenantId,
      f.users.owner,
      { manager: runner.manager },
    );
    assert.equal(shareCalls.length, 1, 'an authorized recipient goes through');
  });
}

// ---------------------------------------------------------------------------
// 10. AI document tools
// ---------------------------------------------------------------------------

function createAiHarness(manager: any, knowledge: KnowledgeService) {
  const stubs = new Array(23).fill({} as any);
  const queryExecutor = new (AiQueryExecutor as any)(
    ...stubs.slice(0, 10), knowledge, ...stubs.slice(0, 12),
  ) as AiQueryExecutor;
  const aggregateExecutor = new (AiAggregateExecutor as any)(
    ...stubs.slice(0, 10), knowledge, ...stubs.slice(0, 11),
  ) as AiAggregateExecutor;
  const entityService: any = Object.create(AiEntityService.prototype);
  entityService.knowledge = knowledge;
  return { queryExecutor, aggregateExecutor, entityService };
}

async function testAiDocumentTools() {
  await withFixture(async (runner, f) => {
    const knowledge = createKnowledgeService(runner.manager);
    const { queryExecutor, aggregateExecutor, entityService } = createAiHarness(runner.manager, knowledge);
    const marker = `reviewmarker${f.tag}`;

    const contextFor = (userId: string) => ({
      tenantId: f.tenantId,
      userId,
      isPlatformHost: false,
      surface: 'chat',
      authMethod: 'jwt',
      manager: runner.manager,
    }) as any;

    // query_entities documents
    const queried = await queryExecutor.execute(contextFor(f.users.thirdParty), {
      entity_type: 'documents', limit: 100,
    } as any);
    const queriedIds = new Set((queried.items || []).map((row: any) => String(row.id)));
    assert.equal(queriedIds.has(f.docs.plain), true, 'the tool still returns readable documents');
    assert.equal(queriedIds.has(f.docs.open), false);
    assert.equal(queriedIds.has(f.docs.confidential), false);
    const queriedOwner = await queryExecutor.execute(contextFor(f.users.owner), {
      entity_type: 'documents', limit: 100,
    } as any);
    assert.equal(
      new Set((queriedOwner.items || []).map((row: any) => String(row.id))).has(f.docs.open),
      true,
      'the owner still sees the review through query_entities',
    );

    // aggregate_entities documents with `q` must not become a content oracle
    const aggThird = await aggregateExecutor.execute(contextFor(f.users.thirdParty), {
      entity_type: 'documents', group_by: 'status', q: marker,
    } as any);
    assert.equal(aggThird.total, 0, 'no review may be counted for a user without incidents rights');
    const aggOwner = await aggregateExecutor.execute(contextFor(f.users.owner), {
      entity_type: 'documents', group_by: 'status', q: marker,
    } as any);
    assert.ok(aggOwner.total > 0, 'the owner still counts the reviews they can read');
    assert.ok(aggOwner.total < 6, 'the owner does not count the reviews they cannot read');

    // get_filter_values documents
    const filterThird = await queryExecutor.executeFilterValues(contextFor(f.users.thirdParty), {
      entity_type: 'documents', fields: ['document_type'],
    } as any);
    const serialized = JSON.stringify(filterThird);
    assert.equal(serialized.includes(`Incident review ${f.tag}`), false, 'filter values leak no review metadata');

    // search_index scope clause
    const searchOwner = await entityService.runSearchIndexQuery(
      contextFor(f.users.owner), ['documents'], marker, 50, 0,
    );
    assert.equal(
      searchOwner.rows.some((row: any) => String(row.entity_id) === f.docs.open),
      true,
      'guard against a vacuous test: the index must actually carry the review',
    );
    assert.equal(
      searchOwner.rows.some((row: any) => String(row.entity_id) === f.docs.confidentialNobody),
      false,
      'the indexed search hides a confidential incident the owner is not on',
    );
    const searchThird = await entityService.runSearchIndexQuery(
      contextFor(f.users.thirdParty), ['documents'], marker, 50, 0,
    );
    assert.equal(
      searchThird.rows.length,
      0,
      'the indexed search hides reviews from a user without incidents rights',
    );
  });
}

// ---------------------------------------------------------------------------
// 11. Dashboard widget exclusion
// ---------------------------------------------------------------------------

async function testDashboardExcludesManagedDocs() {
  await withFixture(async (runner, f) => {
    const { DashboardDataService } = await import('../../dashboard/dashboard-data.service');
    const service: any = Object.create(DashboardDataService.prototype);

    const workflowId = randomUUID();
    await runner.manager.query(
      `INSERT INTO document_workflows (id, tenant_id, document_id, status, requested_revision, requested_by, requested_at)
       VALUES ($1, $2, $3, 'pending_review', 1, $4, now())`,
      [workflowId, f.tenantId, f.docs.confidential, f.users.owner],
    );
    await runner.manager.query(
      `INSERT INTO document_workflow_participants (id, tenant_id, workflow_id, user_id, stage, decision, created_at)
       VALUES ($1, $2, $3, $4, 'reviewer', 'pending', now())`,
      [randomUUID(), f.tenantId, workflowId, f.users.thirdParty],
    );

    const items = await service.getKnowledgeReviewItems(f.users.thirdParty, 5, { manager: runner.manager });
    assert.deepEqual(items, [], 'a managed integrated document never reaches the review widget');
  });
}

// ---------------------------------------------------------------------------
// 12. CSV import exemption (§3.8 primitive)
// ---------------------------------------------------------------------------

async function testImportContextIsFreezeOnly() {
  await withFixture(async (runner, f) => {
    const knowledge = createKnowledgeService(runner.manager);
    const documentId = f.docs.closed;
    const before = await readDocumentState(runner, documentId);

    const importContext = buildIncidentReviewImportContext({
      userId: f.users.owner, tenantId: f.tenantId, incidentId: f.incidents.closed,
    })!;
    const written = await knowledge.updateManagedDocument(
      documentId,
      { content_markdown: 'imported on a closed incident', create_version: true },
      f.users.owner,
      { manager: runner.manager, sourceContext: importContext },
    );
    assert.equal(written.content_markdown, 'imported on a closed incident');
    const after = await readDocumentState(runner, documentId);
    assert.equal(after.versions, before.versions + 1, 'a CSV change of the review keeps a version');

    // The exemption never lifts confidentiality.
    const forged = buildIncidentReviewImportContext({
      userId: f.users.thirdParty, tenantId: f.tenantId, incidentId: f.incidents.confidential,
    })!;
    await expectNotFound(
      knowledge.updateManagedDocument(
        f.docs.confidential,
        { content_markdown: 'nope', create_version: true },
        f.users.thirdParty,
        { manager: runner.manager, sourceContext: forged },
      ),
      'import context on an invisible incident',
    );

    // A null identity with no explicit system marker is refused.
    await assert.rejects(
      knowledge.updateManagedDocument(
        f.docs.plain,
        { content_markdown: 'nope', create_version: false },
        null,
        { manager: runner.manager },
      ),
      /system operation/i,
    );
  });
}

async function run() {
  await dataSource.initialize();
  try {
    await testExecutedSqlMatrix();
    await testUnitReads();
    await testListPaths();
    await testDirectWrites();
    await testClosureFreeze();
    await testConfidentialityChangeRevokesImmediately();
    await testSourceAccessContext();
    await testSourceContextHidesKnowledgeNeighbourhood();
    await testDisabledUserFailsClosedOnBothPaths();
    await testVersioningPolicy();
    await testInlineAttachments();
    await testShareRecipients();
    await testAiDocumentTools();
    await testDashboardExcludesManagedDocs();
    await testImportContextIsFreezeOnly();
    console.log('incident-review-access.integration.spec: all assertions passed');
  } finally {
    await dataSource.destroy();
  }
}

void run();
