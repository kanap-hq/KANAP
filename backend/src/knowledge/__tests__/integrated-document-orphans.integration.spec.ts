import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { seedManagedDocsKnowledgeAssets } from '../integrated-document-seed';
import { releaseOrphanedManagedDocuments } from '../integrated-document-orphans';

// A managed document whose source record is gone (an application deleted before its delete took
// its documents) is released by the daily cleanup, never deleted: unbound, moved to the unfiled
// documents of its library, kept with its attachment row and file, one audit entry each. A bound
// document of a record that exists, another tenant's orphan and a dry run change nothing.

async function setTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function seedTenant(runner: QueryRunner, tag: string) {
  const tenantId = randomUUID();
  await runner.query(`INSERT INTO tenants (id, slug, name, status, created_at, updated_at) VALUES ($1, $2, $3, 'active', now(), now())`, [
    tenantId,
    `${tag}-${tenantId.slice(0, 8)}`,
    `${tag}-${tenantId.slice(0, 8)}`,
  ]);
  await seedManagedDocsKnowledgeAssets(runner.manager as any, tenantId);
  await setTenant(runner, tenantId);
  const [{ id: libraryId }] = await runner.query(`SELECT id FROM document_libraries WHERE tenant_id = $1 AND slug = 'managed-docs'`, [tenantId]);
  const folderOf = async (key: string) =>
    (await runner.query(`SELECT id FROM document_folders WHERE tenant_id = $1 AND system_key = $2`, [tenantId, key]))[0].id as string;
  return { tenantId, libraryId: libraryId as string, appsFolder: await folderOf('integrated_applications'), projectsFolder: await folderOf('integrated_projects') };
}

async function seedBoundDocument(
  runner: QueryRunner,
  t: { tenantId: string; libraryId: string },
  itemNumber: number,
  folderId: string,
  type: string,
  sourceId: string,
  slot: string,
): Promise<string> {
  const [{ id }] = await runner.query(
    `INSERT INTO documents (tenant_id, item_number, title, library_id, folder_id, content_markdown)
     VALUES ($1, $2, $3, $4, $5, 'Text a user wrote.') RETURNING id`,
    [t.tenantId, 9000 + itemNumber, `Managed ${itemNumber}`, t.libraryId, folderId],
  );
  await runner.query(
    `INSERT INTO integrated_document_bindings (tenant_id, source_entity_type, source_entity_id, slot_key, document_id) VALUES ($1, $2, $3, $4, $5)`,
    [t.tenantId, type, sourceId, slot, id],
  );
  return id;
}

async function state(runner: QueryRunner, documentId: string) {
  const [doc] = await runner.query(`SELECT library_id, folder_id, content_markdown FROM documents WHERE id = $1`, [documentId]);
  const bindings = await runner.query(`SELECT source_entity_type FROM integrated_document_bindings WHERE document_id = $1`, [documentId]);
  return { ...doc, bound: bindings.length > 0 };
}

async function testOrphanedDocumentsAreReleased() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const other = await seedTenant(runner, 'orphan-docs-b');
    const otherOrphan = await seedBoundDocument(runner, other, 1, other.appsFolder, 'applications', randomUUID(), 'overview');

    const t = await seedTenant(runner, 'orphan-docs');
    const [{ id: appId }] = await runner.query(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'Kept application') RETURNING id`, [t.tenantId]);
    const bound = await seedBoundDocument(runner, t, 1, t.appsFolder, 'applications', appId, 'overview');
    const goneAppId = randomUUID();
    const appOrphan = await seedBoundDocument(runner, t, 2, t.appsFolder, 'applications', goneAppId, 'overview');
    const projectOrphan = await seedBoundDocument(runner, t, 3, t.projectsFolder, 'projects', randomUUID(), 'purpose');
    const storagePath = `files/${t.tenantId}/knowledge/${appOrphan}/diagram.png`;
    await runner.query(
      `INSERT INTO document_attachments (tenant_id, document_id, original_filename, stored_filename, size, storage_path)
       VALUES ($1, $2, 'diagram.png', 'diagram.png', 10, $3)`,
      [t.tenantId, appOrphan, storagePath],
    );

    // A dry run finds them and changes nothing.
    const found = await releaseOrphanedManagedDocuments(runner.manager, t.tenantId, { dryRun: true });
    assert.deepEqual(found.map((doc) => doc.document_id).sort(), [appOrphan, projectOrphan].sort());
    assert.equal((await state(runner, appOrphan)).bound, true, 'a dry run leaves the binding');

    const released = await releaseOrphanedManagedDocuments(runner.manager, t.tenantId, { sourceRef: 'spec' });
    assert.deepEqual(
      released.map((doc) => [doc.document_id, doc.source_entity_type, doc.slot_key]).sort(),
      [[appOrphan, 'applications', 'overview'], [projectOrphan, 'projects', 'purpose']].sort(),
    );
    for (const id of [appOrphan, projectOrphan]) {
      assert.deepEqual(
        await state(runner, id),
        { library_id: t.libraryId, folder_id: null, content_markdown: 'Text a user wrote.', bound: false },
        'kept, unbound, unfiled in its library',
      );
    }
    assert.deepEqual(await state(runner, bound), { library_id: t.libraryId, folder_id: t.appsFolder, content_markdown: 'Text a user wrote.', bound: true });
    const attachments = await runner.query(`SELECT storage_path FROM document_attachments WHERE document_id = $1`, [appOrphan]);
    assert.deepEqual(attachments, [{ storage_path: storagePath }], 'its attachment, and so its file, stays');

    const audit = await runner.query(
      `SELECT record_id, action, source, source_ref, before_json, after_json FROM audit_log
        WHERE tenant_id = $1 AND table_name = 'documents' ORDER BY record_id`,
      [t.tenantId],
    );
    const entry = audit.find((row: { record_id: string }) => row.record_id === appOrphan);
    assert.equal(audit.length, 2, 'one audit entry per released document');
    assert.equal(entry.action, 'update');
    assert.equal(entry.source, 'system');
    assert.equal(entry.source_ref, 'spec');
    assert.deepEqual(entry.before_json.integrated_binding, { source_entity_type: 'applications', source_entity_id: goneAppId, slot_key: 'overview' });
    assert.equal(entry.before_json.folder_id, t.appsFolder);
    assert.deepEqual(entry.after_json, { folder_id: null, integrated_binding: null });

    assert.deepEqual(await releaseOrphanedManagedDocuments(runner.manager, t.tenantId), [], 'a second run finds nothing');
    await setTenant(runner, other.tenantId);
    assert.equal((await state(runner, otherOrphan)).bound, true, "another tenant's orphan waits for its own run");
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function main() {
  await dataSource.initialize();
  try {
    await testOrphanedDocumentsAreReleased();
    console.log('  ok testOrphanedDocumentsAreReleased');
  } finally {
    await dataSource.destroy();
  }
  console.log('integrated-document-orphans.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
