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
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { User } from '../../users/user.entity';

// Knowledge bulk delete in the request transaction: a row that raises a
// database error (a malformed id, 22P02) must not abort the others. The free
// documents are really gone once the request commits; the failing row is
// reported. Seeded in a committed transaction, run in one transaction with the
// tenant set and committed like the tenant interceptor, then the table is read.

const MALFORMED_ID = 'not-a-uuid';

function knowledgeService(): KnowledgeService {
  const repo = <T extends ObjectLiteral>(target: EntityTarget<T>) => dataSource.getRepository(target);
  const permissions = new PermissionsService(repo(UserPageRole), repo(RolePermission));
  const users: any = {
    findById: async (id: string, opts?: any) =>
      (opts?.manager ?? dataSource.manager).getRepository(User).findOne({ where: { id }, relations: ['role'] }),
  };
  const noAudit: any = { log: async () => undefined };
  return new KnowledgeService(
    repo(Document), repo(DocumentFolder), repo(IntegratedDocumentBinding), repo(DocumentLibrary), repo(DocumentType),
    repo(DocumentVersion), repo(DocumentEditLock), repo(DocumentAttachment), repo(DocumentActivity),
    repo(DocumentContributor), repo(DocumentClassification), repo(DocumentReference), repo(DocumentApplication),
    repo(DocumentAsset), repo(DocumentProject), repo(DocumentRequest), repo(DocumentTask),
    { nextItemNumber: async () => 999999 } as any,
    noAudit,
    {} as any,
    {} as any,
    { deleteObject: async () => undefined } as any,
    {} as any,
    dataSource,
    permissions,
    users,
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

/** The request: one transaction with the tenant set, committed on success as the interceptor does. */
async function asRequest<T>(tenantId: string, fn: (manager: EntityManager) => Promise<T>): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const result = await fn(runner.manager);
    await runner.commitTransaction();
    return result;
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }
}

async function seed(tenantId: string) {
  const tag = tenantId.slice(0, 8);
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Knowledge bulk remove', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `kb-bulk-${tag}`],
  );
  return inTenant(tenantId, async (m) => {
    const roleId = randomUUID();
    await m.query(
      `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
       VALUES ($1, $2, 'Knowledge admin', 'Knowledge admin', false, false, now(), now())`,
      [roleId, tenantId],
    );
    await m.query(
      `INSERT INTO role_permissions (id, tenant_id, role_id, resource, level, created_at, updated_at)
       VALUES ($1, $2, $3, 'knowledge', 'admin', now(), now())`,
      [randomUUID(), tenantId, roleId],
    );
    const [{ id: userId }] = await m.query(
      `INSERT INTO users (tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status)
       VALUES ($1, 'Know', 'Admin', $2, null, $3, false, 'enabled') RETURNING id`,
      [tenantId, `kb-admin-${tag}@bulk-remove.test`, roleId],
    );
    const [{ id: libraryId }] = await m.query(
      `INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, 'Bulk library', $2) RETURNING id`,
      [tenantId, `bulk-library-${tag}`],
    );
    const [{ id: folderId }] = await m.query(
      `INSERT INTO document_folders (tenant_id, library_id, name) VALUES ($1, $2, 'Bulk folder') RETURNING id`,
      [tenantId, libraryId],
    );
    const doc = async (itemNumber: number, title: string) =>
      (await m.query(
        `INSERT INTO documents (tenant_id, item_number, title, library_id, folder_id, status)
         VALUES ($1, $2, $3, $4, $5, 'published') RETURNING id`,
        [tenantId, itemNumber, title, libraryId, folderId],
      ))[0].id as string;
    return { userId: userId as string, first: await doc(1, 'First document'), second: await doc(2, 'Second document') };
  });
}

async function cleanup(tenantId: string) {
  await inTenant(tenantId, async (m) => {
    for (const table of ['documents', 'document_folders', 'document_libraries', 'role_permissions', 'users', 'roles']) {
      await m.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    }
  });
  await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
}

async function testMalformedIdDoesNotAbortTheOthers() {
  const tenantId = randomUUID();
  try {
    const ids = await seed(tenantId);
    const result = await asRequest(tenantId, (manager) =>
      knowledgeService().bulkRemove([ids.first, MALFORMED_ID, ids.second], ids.userId, { manager }),
    );

    const rows: Array<{ id: string }> = await inTenant(tenantId, (m) =>
      m.query(`SELECT id FROM documents WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, [ids.first, ids.second]]),
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      [],
      `after the commit both documents are gone; left: ${rows.length}, result: ${JSON.stringify(result)}`,
    );
    assert.deepEqual([...result.deleted].sort(), [ids.first, ids.second].sort());
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].id, MALFORMED_ID);
    assert.equal(result.failed[0].name, 'Unknown');
  } finally {
    await cleanup(tenantId);
  }
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testMalformedIdDoesNotAbortTheOthers]) {
      try {
        await test();
        console.log(`  ok ${test.name}`);
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n').slice(0, 6).join(' | ')}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`knowledge-bulk-remove.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('knowledge-bulk-remove.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
