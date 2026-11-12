import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { KnowledgeService } from '../knowledge.service';
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
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// The trigger is the only writer of documents.search_vector. After each versioned write of a
// document (creation, manual save, status change, new version, revert), its vector equals the
// recomputed one (`documents_search_vector_compute`, migration 1856190000000), full-text search
// finds it by a word of its body, and its search_index entry does too. Real database, every test
// in a transaction that is rolled back.

let itemCounter = 7000;

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
  const itemNumbers: any = { nextItemNumber: async () => ++itemCounter };

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

type Fixture = { runner: QueryRunner; service: KnowledgeService; tenantId: string; userId: string; libraryId: string };

async function seedFixture(runner: QueryRunner, tag: string): Promise<Fixture> {
  const tenantId = await seedTenant(runner, `docvec-${tag}`);
  const roleId = randomUUID();
  await runner.query(
    `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, 'Knowledge admin', 'Knowledge admin', false, false, now(), now())`,
    [roleId, tenantId],
  );
  await runner.query(
    `INSERT INTO role_permissions (id, tenant_id, role_id, resource, level, created_at, updated_at)
     VALUES ($1, $2, $3, 'knowledge', 'admin', now(), now())`,
    [randomUUID(), tenantId, roleId],
  );
  const userId = randomUUID();
  await runner.query(
    `INSERT INTO users (
       id, tenant_id, first_name, last_name, email, password_hash, role_id,
       mfa_enabled, status, created_at, updated_at
     )
     VALUES ($1, $2, 'Writer', 'Tester', $3, null, $4, false, 'enabled', now(), now())`,
    [userId, tenantId, `writer-${tenantId.slice(0, 8)}@example.com`, roleId],
  );
  const libraryId = randomUUID();
  await runner.query(
    `INSERT INTO document_libraries (id, tenant_id, name, slug, is_system, display_order, created_at, updated_at)
     VALUES ($1, $2, 'Search vector spec', 'search-vector-spec', false, 0, now(), now())`,
    [libraryId, tenantId],
  );
  await runner.query(
    `INSERT INTO document_types (
       id, tenant_id, name, description, template_content, is_active, is_system, is_default,
       system_key, display_order, created_at, updated_at
     )
     VALUES ($1, $2, 'Document', 'Document', null, true, true, true, null, 0, now(), now())`,
    [randomUUID(), tenantId],
  );
  return { runner, service: createKnowledgeService(runner.manager), tenantId, userId, libraryId };
}

/** A document written by SQL: the trigger gives it a current vector, as an autosave would. */
async function seedDocument(f: Fixture, title: string, body: string): Promise<string> {
  const id = randomUUID();
  await f.runner.query(
    `INSERT INTO documents (
       id, tenant_id, item_number, title, summary, content_markdown, content_plain,
       library_id, status, revision, current_version_number, created_by, updated_by, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, null, $5, $5, $6, 'draft', 1, 0, $7, $7, now(), now())`,
    [id, f.tenantId, ++itemCounter, title, body, f.libraryId, f.userId],
  );
  await f.runner.query(
    `INSERT INTO document_contributors (document_id, user_id, role, is_primary)
     VALUES ($1, $2, 'owner', true)`,
    [id, f.userId],
  );
  return id;
}

async function revisionOf(f: Fixture, documentId: string): Promise<number> {
  const [row] = await f.runner.query(`SELECT revision FROM documents WHERE id = $1`, [documentId]);
  return Number(row.revision);
}

async function lock(f: Fixture, documentId: string): Promise<string> {
  const result: any = await f.service.acquireLock(documentId, f.userId, { manager: f.runner.manager });
  return result.lock_token;
}

async function save(f: Fixture, documentId: string, token: string, body: Record<string, unknown>) {
  await f.service.update(
    documentId,
    { ...body, revision: await revisionOf(f, documentId) },
    f.userId,
    token,
    { manager: f.runner.manager },
  );
}

async function assertIndexed(f: Fixture, documentId: string, word: string, step: string) {
  const [row] = await f.runner.query(
    `SELECT search_vector IS NOT NULL AS present,
            search_vector = documents_search_vector_compute(title, summary, content_plain) AS current
       FROM documents
      WHERE id = $1 AND tenant_id = $2`,
    [documentId, f.tenantId],
  );
  assert.equal(row.present, true, `${step}: the document has a search vector`);
  assert.equal(row.current, true, `${step}: the search vector matches the document text`);

  const result: any = await f.service.search({ q: word, limit: 50, offset: 0 }, { manager: f.runner.manager });
  const hit = result.items.find((item: any) => item.id === documentId);
  assert.ok(hit, `${step}: the search returns the document for "${word}"`);
  assert.ok(hit.score > 0, `${step}: the full-text index ranks the document for "${word}"`);

  const [entry] = await f.runner.query(
    `SELECT COALESCE(bool_or(search_vector @@ (plainto_tsquery('kanap_fr', $3) || plainto_tsquery('kanap_en', $3))), false) AS hit
       FROM search_index
      WHERE tenant_id = $1 AND entity_type = 'documents' AND entity_id = $2`,
    [f.tenantId, documentId, word],
  );
  assert.equal(entry.hit, true, `${step}: the search entry finds the document by "${word}"`);
}

async function testCreate() {
  await inRolledBackTransaction(async (runner) => {
    const f = await seedFixture(runner, 'create');
    const created: any = await f.service.create(
      {
        title: 'Montée en estive',
        content_markdown: 'Les vaches montent à l\'alpage au début du mois de juin.',
        library_id: f.libraryId,
        owner_user_id: f.userId,
      },
      f.tenantId,
      f.userId,
      { manager: runner.manager },
    );
    const [doc] = await runner.query(`SELECT current_version_number FROM documents WHERE id = $1`, [created.id]);
    assert.equal(Number(doc.current_version_number), 1, 'the creation keeps a first version');
    await assertIndexed(f, created.id, 'alpage', 'creation');
  });
}

async function testManualSaveWithNewContent() {
  await inRolledBackTransaction(async (runner) => {
    const f = await seedFixture(runner, 'manual');
    const id = await seedDocument(f, 'Fiche de fabrication', 'Le bain de saumure dure deux jours.');
    await assertIndexed(f, id, 'saumure', 'seeded document');
    const token = await lock(f, id);
    await save(f, id, token, { content_markdown: 'Le caillage dure une heure en cuve.', save_mode: 'manual' });
    await assertIndexed(f, id, 'caillage', 'manual save');
  });
}

async function testStatusChange() {
  await inRolledBackTransaction(async (runner) => {
    const f = await seedFixture(runner, 'status');
    const id = await seedDocument(f, 'Procédure de cave', 'La fruitière collecte le lait du matin.');
    const token = await lock(f, id);
    // An autosave that also changes the status keeps a version.
    await save(f, id, token, {
      status: 'published',
      content_markdown: 'Le retournement des meules a lieu chaque semaine.',
      save_mode: 'autosave',
    });
    const [doc] = await runner.query(`SELECT status, current_version_number FROM documents WHERE id = $1`, [id]);
    assert.equal(doc.status, 'published');
    assert.equal(Number(doc.current_version_number), 1, 'the status change keeps a version');
    await assertIndexed(f, id, 'retournement', 'status change');
  });
}

async function testCreateVersion() {
  await inRolledBackTransaction(async (runner) => {
    const f = await seedFixture(runner, 'version');
    const id = await seedDocument(f, 'Plan d\'affinage', 'Douze mois de cave au minimum.');
    const token = await lock(f, id);
    await save(f, id, token, { content_markdown: 'Le morgeage se fait à l\'eau salée.', save_mode: 'autosave' });
    const result: any = await f.service.createVersion(id, { change_note: 'Spec' }, f.userId, token, { manager: runner.manager });
    assert.equal(result.created, true, 'a version is created');
    await assertIndexed(f, id, 'morgeage', 'new version');
  });
}

async function testRevert() {
  await inRolledBackTransaction(async (runner) => {
    const f = await seedFixture(runner, 'revert');
    const id = await seedDocument(f, 'Fiche de traite', 'La traite a lieu deux fois par jour.');
    const token = await lock(f, id);
    await f.service.createVersion(id, { change_note: 'v1' }, f.userId, token, { manager: runner.manager });
    await save(f, id, token, { content_markdown: 'Le lactosérum part vers la porcherie.', save_mode: 'autosave' });
    await f.service.createVersion(id, { change_note: 'v2' }, f.userId, token, { manager: runner.manager });
    await assertIndexed(f, id, 'lactosérum', 'second version');

    await f.service.revert(id, 1, f.userId, token, { manager: runner.manager });
    const [doc] = await runner.query(`SELECT content_plain FROM documents WHERE id = $1`, [id]);
    assert.match(doc.content_plain, /traite/, 'the document is back to its first version');
    await assertIndexed(f, id, 'traite', 'revert');
  });
}

/** No TypeORM path writes the column, even when the caller hands it a value. */
async function testEntityNeverWritesTheVector() {
  await inRolledBackTransaction(async (runner) => {
    const f = await seedFixture(runner, 'entity');
    const repo = runner.manager.getRepository(Document);
    const forged = "'forged'";
    const inserted = await repo.save(repo.create({
      tenant_id: f.tenantId,
      item_number: ++itemCounter,
      title: 'Registre de la fromagerie',
      content_markdown: 'Le registre suit chaque cuve.',
      content_plain: 'Le registre suit chaque cuve.',
      library_id: f.libraryId,
      search_vector: forged,
    }));
    await assertIndexed(f, inserted.id, 'registre', 'save (insert)');

    const loaded = await repo.findOne({ where: { id: inserted.id } });
    assert.equal(loaded!.search_vector, undefined, 'the vector is not read');
    loaded!.search_vector = forged;
    loaded!.status = 'published';
    await repo.save(loaded!);
    await assertIndexed(f, inserted.id, 'registre', 'save (update)');

    await repo.update({ id: inserted.id }, { search_vector: forged, status: 'draft' });
    await assertIndexed(f, inserted.id, 'registre', 'update');

    await repo.createQueryBuilder().update(Document).set({ search_vector: forged, status: 'published' })
      .where('id = :id', { id: inserted.id }).execute();
    await assertIndexed(f, inserted.id, 'registre', 'query builder update');

    await repo.upsert({
      id: inserted.id,
      tenant_id: f.tenantId,
      item_number: inserted.item_number,
      title: 'Registre de la fromagerie',
      content_markdown: 'Le registre suit chaque cuve.',
      content_plain: 'Le registre suit chaque cuve.',
      library_id: f.libraryId,
      search_vector: forged,
    }, ['id']);
    await assertIndexed(f, inserted.id, 'registre', 'upsert');
  });
}

void runSpecs('document-search-vector.integration.spec', [
  ['testEntityNeverWritesTheVector', testEntityNeverWritesTheVector],
  ['testCreate', testCreate],
  ['testManualSaveWithNewContent', testManualSaveWithNewContent],
  ['testStatusChange', testStatusChange],
  ['testCreateVersion', testCreateVersion],
  ['testRevert', testRevert],
]);
