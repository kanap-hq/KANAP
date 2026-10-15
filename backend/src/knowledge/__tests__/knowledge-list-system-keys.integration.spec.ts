import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';
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

// The knowledge list filters the library and folder columns on stable keys (library slug, system
// folder key), so the screen can show the shipped libraries and folders in the reader's language.
// A tenant folder that happens to carry a system folder's English name ("Requests") stays apart
// from the system folder. The name filters stay for the assistant, which speaks in names.

function knowledgeService(): KnowledgeService {
  const repo = <T extends ObjectLiteral>(target: EntityTarget<T>) => dataSource.getRepository(target);
  return new KnowledgeService(
    repo(Document), repo(DocumentFolder), repo(IntegratedDocumentBinding), repo(DocumentLibrary), repo(DocumentType),
    repo(DocumentVersion), repo(DocumentEditLock), repo(DocumentAttachment), repo(DocumentActivity),
    repo(DocumentContributor), repo(DocumentClassification), repo(DocumentReference), repo(DocumentApplication),
    repo(DocumentAsset), repo(DocumentProject), repo(DocumentRequest), repo(DocumentTask),
    { nextItemNumber: async () => 999999 } as any,
    { log: async () => undefined } as any,
    {} as any,
    {} as any,
    { deleteObject: async () => undefined } as any,
    {} as any,
    dataSource,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

async function inTenant<T>(tenantId: string, fn: (manager: EntityManager) => Promise<T>): Promise<T> {
  return dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    return fn(manager);
  });
}

type Seeded = { managedRequest: string; tenantRequest: string; zetaDoc: string };

async function seed(tenantId: string): Promise<Seeded> {
  const tag = tenantId.slice(0, 8);
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Knowledge system keys', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `kb-keys-${tag}`],
  );
  return inTenant(tenantId, async (m) => {
    const library = async (name: string, slug: string, isSystem: boolean, order: number) =>
      (await m.query(
        `INSERT INTO document_libraries (tenant_id, name, slug, is_system, display_order)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [tenantId, name, slug, isSystem, order],
      ))[0].id as string;
    // The tenant put "Zeta" first in its library bar; alphabetically it comes last.
    const zeta = await library('Zeta', 'zeta', false, 0);
    const managed = await library('Managed Docs', 'managed-docs', true, 2);
    const folder = async (libraryId: string, name: string, systemKey: string | null) =>
      (await m.query(
        `INSERT INTO document_folders (tenant_id, library_id, name, system_key) VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenantId, libraryId, name, systemKey],
      ))[0].id as string;
    const systemRequests = await folder(managed, 'Requests', 'integrated_requests');
    const tenantRequests = await folder(zeta, 'Requests', null);
    const doc = async (itemNumber: number, title: string, libraryId: string, folderId: string | null) =>
      (await m.query(
        `INSERT INTO documents (tenant_id, item_number, title, library_id, folder_id, status)
         VALUES ($1, $2, $3, $4, $5, 'draft') RETURNING id`,
        [tenantId, itemNumber, title, libraryId, folderId],
      ))[0].id as string;
    return {
      managedRequest: await doc(1, 'Alpha managed request', managed, systemRequests),
      tenantRequest: await doc(2, 'Beta tenant request', zeta, tenantRequests),
      zetaDoc: await doc(3, 'Gamma unfiled', zeta, null),
    };
  });
}

async function cleanup(tenantId: string) {
  await inTenant(tenantId, async (m) => {
    for (const table of ['documents', 'document_folders', 'document_libraries']) {
      await m.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    }
  });
  await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
}

const setFilter = (values: Array<string | null>) => ({ filterType: 'set', values });

async function listIds(tenantId: string, query: Record<string, unknown>): Promise<string[]> {
  const result = await inTenant(tenantId, (manager) => knowledgeService().list(query, { manager, tenantId }));
  return result.items.map((row: any) => String(row.id));
}

async function run(seeded: Seeded, tenantId: string) {
  // Rows carry the stable keys beside the names.
  const all = await inTenant(tenantId, (manager) => knowledgeService().list({ sort: 'title:ASC' }, { manager, tenantId }));
  const managedRow: any = all.items.find((row: any) => row.id === seeded.managedRequest);
  const tenantRow: any = all.items.find((row: any) => row.id === seeded.tenantRequest);
  assert.equal(managedRow?.library_slug, 'managed-docs');
  assert.equal(managedRow?.folder_system_key, 'integrated_requests', 'the system folder key is on the row');
  assert.equal(tenantRow?.folder_system_key, null, 'a tenant folder has no system key');
  // The column values are the filter keys.
  assert.equal(managedRow?.library_key, 'managed-docs');
  assert.equal(managedRow?.folder_key, 'integrated_requests');
  assert.equal(tenantRow?.folder_key, 'Requests');

  // Folder filter on the system key keeps the tenant folder of the same name out.
  assert.deepEqual(
    await listIds(tenantId, { filters: JSON.stringify({ folder_key: setFilter(['integrated_requests']) }) }),
    [seeded.managedRequest],
  );
  // A tenant folder is keyed by its name; blank picks the unfiled documents.
  assert.deepEqual(
    await listIds(tenantId, { filters: JSON.stringify({ folder_key: setFilter(['Requests']) }) }),
    [seeded.tenantRequest],
  );
  assert.deepEqual(
    await listIds(tenantId, { filters: JSON.stringify({ folder_key: setFilter([null]) }) }),
    [seeded.zetaDoc],
  );

  // Library filter on the slug.
  assert.deepEqual(
    await listIds(tenantId, { filters: JSON.stringify({ library_key: setFilter(['managed-docs']) }) }),
    [seeded.managedRequest],
  );
  // The name filter the assistant uses still works.
  assert.deepEqual(
    await listIds(tenantId, { filters: JSON.stringify({ library_name: setFilter(['Managed Docs']) }) }),
    [seeded.managedRequest],
  );

  // Sorting the library column follows the library bar order, whatever the language.
  assert.deepEqual(
    await listIds(tenantId, { sort: 'library_key:ASC' }),
    [seeded.zetaDoc, seeded.tenantRequest, seeded.managedRequest],
  );

  // Filter values are the keys.
  const values: any = await inTenant(tenantId, (manager) =>
    knowledgeService().listFilterValues({ fields: 'library_key,folder_key' }, { manager, tenantId }),
  );
  assert.deepEqual([...(values.library_key ?? [])].sort(), ['managed-docs', 'zeta']);
  assert.deepEqual(
    [...(values.folder_key ?? [])].map((v: string | null) => (v === null ? '(blank)' : v)).sort(),
    ['(blank)', 'Requests', 'integrated_requests'],
  );
}

async function testListFiltersOnStableKeys() {
  const tenantId = randomUUID();
  try {
    const seeded = await seed(tenantId);
    await run(seeded, tenantId);
  } finally {
    await cleanup(tenantId);
  }
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testListFiltersOnStableKeys]) {
      try {
        await test();
        console.log(`  ok ${test.name}`);
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n').slice(0, 8).join(' | ')}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`knowledge-list-system-keys.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('knowledge-list-system-keys.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
