// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { closeMarkdownWorkers } from '../../common/markdown-worker';
import { issueCreationToken } from '../../common/creation/creation-token';
import {
  auditedEdit,
  deletionAuthors,
  inRolledBackTransaction,
  knowledgeServiceFor,
  refusedAsExpired,
  seedCreationTenant,
  tenantContext,
  type CreationSeed,
} from '../../common/creation/__tests__/creation-cancel.fixtures';
import { KnowledgeController } from '../knowledge.controller';

// "Cancel" of a document being created (lot V4 of the creation frame): `POST /knowledge` hands the
// creator a token of the family `documents`; `GET /knowledge/:idOrRef/creation` counts what was
// written since the creation (fields, the body saved, versions, relations, attachments...), the
// template's content and the relations given at the creation excluded; `DELETE
// /knowledge/:idOrRef/creation` deletes the document for its creator at the create level (knowledge
// member, no admin), through the document delete and its audit entry, while the creator holds its
// edit lock. Another person's token, another document's, none or an expired one is refused
// (`CREATION_CANCEL_EXPIRED`), and so is the cancel of a document another person wrote on.

function controllerFor(runner: QueryRunner) {
  const audit = new AuditService(runner.manager.getRepository(AuditLog));
  const { knowledge } = knowledgeServiceFor(runner.manager, audit);
  const controller = Object.create(KnowledgeController.prototype) as KnowledgeController;
  Object.assign(controller, { docs: knowledge });
  return { controller, knowledge };
}

async function seedLibrary(runner: QueryRunner, tenantId: string): Promise<{ libraryId: string; projectId: string; templateId: string }> {
  const [library] = await runner.query(
    `INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, 'Spec library', $2) RETURNING id`,
    [tenantId, `spec-${tenantId.slice(0, 8)}`],
  );
  const [type] = await runner.query(`SELECT id FROM document_types WHERE tenant_id = $1 AND is_default = true LIMIT 1`, [tenantId]);
  if (!type) {
    await runner.query(
      `INSERT INTO document_types (tenant_id, name, is_active, is_system, is_default, display_order, created_at, updated_at)
       VALUES ($1, 'Document', true, false, true, 0, now(), now())`,
      [tenantId],
    );
  }
  const [project] = await runner.query(
    `INSERT INTO portfolio_projects (tenant_id, item_number, name, origin, status, scheduling_mode, execution_progress, criteria_values)
     VALUES ($1, 1, 'Related project', 'fast_track', 'planned', 'independent', 0, '{}'::jsonb) RETURNING id`,
    [tenantId],
  );
  // A template lives in the library of slug `templates`.
  const [templates] = await runner.query(
    `SELECT id FROM document_libraries WHERE tenant_id = $1 AND slug = 'templates'`,
    [tenantId],
  );
  const templatesId = templates?.id ?? (await runner.query(
    `INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, 'Templates', 'templates') RETURNING id`,
    [tenantId],
  ))[0].id;
  const [template] = await runner.query(
    `INSERT INTO documents (tenant_id, library_id, title, item_number, status, content_markdown, content_plain)
     VALUES ($1, $2, 'Template', 900, 'published', '# Template body', 'Template body') RETURNING id`,
    [tenantId, templatesId],
  );
  return { libraryId: library.id, projectId: project.id, templateId: template.id };
}

/** A row written after the creation's transaction (a later request), as the clock gives it. */
async function laterRelation(runner: QueryRunner, tenantId: string, documentId: string, projectId: string) {
  await runner.query(`DELETE FROM document_projects WHERE tenant_id = $1 AND document_id = $2`, [tenantId, documentId]);
  await runner.query(
    `INSERT INTO document_projects (tenant_id, document_id, project_id, created_at) VALUES ($1, $2, $3, clock_timestamp())`,
    [tenantId, documentId, projectId],
  );
}

async function documentCount(runner: QueryRunner, tenantId: string, id: string): Promise<number> {
  const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM documents WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return n;
}

function testRoutesNeedTheCreateLevel() {
  for (const method of ['create', 'creationChanges', 'cancelCreation'] as const) {
    const meta = Reflect.getMetadata(REQUIRE_LEVEL_KEY, (KnowledgeController.prototype as any)[method]);
    assert.deepEqual(meta, { resource: 'knowledge', level: 'member' }, `${method} needs knowledge:member`);
  }
}

async function testCreatorCancelsTheCreation() {
  await inRolledBackTransaction(async (runner) => {
    const seed: CreationSeed = await seedCreationTenant(runner, { knowledge: 'member' });
    const { tenantId, creatorId, otherId } = seed;
    const { libraryId, projectId, templateId } = await seedLibrary(runner, tenantId);
    const { controller, knowledge } = controllerFor(runner);
    const asCreator = tenantContext(seed, creatorId, runner.manager);

    // Created from a template, with a relation from the address: neither is a change.
    const created: any = await controller.create(
      { title: 'Cancel creation spec', library_id: libraryId, template_document_id: templateId, relations: { projects: [projectId] } },
      asCreator,
    );
    assert.equal(typeof created.creation_token, 'string', 'the create route hands a creation token');
    assert.ok(created.item_number > 0, 'the document has its reference');
    const other: any = await controller.create({ title: 'Another document', library_id: libraryId }, asCreator);

    const fresh = await controller.creationChanges(created.id, created.creation_token, asCreator);
    assert.deepEqual(fresh, { changes: { fields: 0, children: {} } }, 'nothing written since the creation');
    // By its reference too.
    const byRef = await controller.creationChanges(`DOC-${created.item_number}`, created.creation_token, asCreator);
    assert.deepEqual(byRef, fresh, 'the reference reads the same');

    // The creator takes the edit lock, saves content, then adds a relation: what the confirmation lists.
    const lock: any = await knowledge.acquireLock(created.id, creatorId, { manager: runner.manager });
    await knowledge.update(created.id, { content_markdown: '# Written body', revision: created.revision, save_mode: 'autosave' }, creatorId, lock.lock_token, { manager: runner.manager });
    await laterRelation(runner, tenantId, created.id, projectId);
    const edited = await controller.creationChanges(created.id, created.creation_token, asCreator);
    assert.deepEqual(edited, { changes: { fields: 1, children: { relation: 1 } } }, 'the body and one relation');

    // Another person's token for this document, another document's token, none, an expired one: refused.
    const asOther = tenantContext(seed, otherId, runner.manager);
    await refusedAsExpired(controller.creationChanges(created.id, created.creation_token, asOther), 'other user, preflight');
    await refusedAsExpired(controller.cancelCreation(created.id, { token: created.creation_token }, asOther), 'other user');
    await refusedAsExpired(controller.cancelCreation(created.id, { token: other.creation_token }, asCreator), 'other document');
    await refusedAsExpired(controller.cancelCreation(created.id, {}, asCreator), 'no token');
    const expired = issueCreationToken(
      { tenantId, family: 'documents', recordId: created.id, userId: creatorId },
      { now: Date.now() - 25 * 60 * 60 * 1000 },
    );
    await refusedAsExpired(controller.cancelCreation(created.id, { token: expired }, asCreator), 'expired token');

    // Another person wrote on the other document: its creator's cancel is over (preflight and cancel).
    await auditedEdit(runner, 'documents', other.id, otherId, 'title');
    await refusedAsExpired(controller.creationChanges(other.id, other.creation_token, asCreator), 'another author, preflight');
    await refusedAsExpired(controller.cancelCreation(other.id, { token: other.creation_token }, asCreator), 'another author');

    // The creator, a member without the delete level (admin), cancels it while holding its lock.
    const [{ locks }] = await runner.query(`SELECT count(*)::int AS locks FROM document_edit_locks WHERE tenant_id = $1 AND document_id = $2`, [tenantId, created.id]);
    assert.equal(locks, 1, 'the creator holds the edit lock');
    await controller.cancelCreation(created.id, { token: created.creation_token }, asCreator);
    assert.equal(await documentCount(runner, tenantId, created.id), 0, 'the document is gone');
    const [{ left }] = await runner.query(`SELECT count(*)::int AS left FROM document_edit_locks WHERE tenant_id = $1 AND document_id = $2`, [tenantId, created.id]);
    assert.equal(left, 0, 'its lock went with it');
    assert.deepEqual(await deletionAuthors(runner, tenantId, 'documents', created.id), [creatorId], 'the delete is audited under its creator');
    assert.equal(await documentCount(runner, tenantId, other.id), 1, 'the other document stays');
  });
}

async function main() {
  await dataSource.initialize();
  try {
    testRoutesNeedTheCreateLevel();
    console.log('  ok testRoutesNeedTheCreateLevel');
    await testCreatorCancelsTheCreation();
    console.log('  ok testCreatorCancelsTheCreation');
  } finally {
    await dataSource.destroy();
    await closeMarkdownWorkers();
  }
  console.log('document-cancel-creation.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
