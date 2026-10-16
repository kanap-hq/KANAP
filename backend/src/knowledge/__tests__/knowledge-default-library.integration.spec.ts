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

// The default library (the first tenant library of the library bar, where documents go when no
// library is named) cannot be deleted: the refusal is a 409 with a code the screen translates, and
// nothing moves. Another library is deleted as before, its documents moved to the default one.

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
     VALUES ($1, $2, 'Knowledge default library', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `kb-default-${tag}`],
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
      [tenantId, `kb-admin-${tag}@default-library.test`, roleId],
    );
    const library = async (name: string, slug: string, isSystem: boolean, order: number) =>
      (await m.query(
        `INSERT INTO document_libraries (tenant_id, name, slug, is_system, display_order, owner_user_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [tenantId, name, slug, isSystem, order, userId],
      ))[0].id as string;
    const documents = await library('Documents', 'documents', false, 0);
    await library('Templates', 'templates', true, 1);
    const team = await library('Team', 'team', false, 3);
    const doc = async (itemNumber: number, libraryId: string) =>
      (await m.query(
        `INSERT INTO documents (tenant_id, item_number, title, library_id, status) VALUES ($1, $2, $3, $4, 'draft') RETURNING id`,
        [tenantId, itemNumber, `Doc ${itemNumber}`, libraryId],
      ))[0].id as string;
    return { userId: userId as string, documents, team, inDocuments: await doc(1, documents), inTeam: await doc(2, team) };
  });
}

async function cleanup(tenantId: string) {
  await inTenant(tenantId, async (m) => {
    for (const table of ['documents', 'document_folders', 'document_library_members', 'document_libraries', 'role_permissions', 'users', 'roles']) {
      await m.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    }
  });
  await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
}

async function testDefaultLibraryIsRefused() {
  const tenantId = randomUUID();
  try {
    const ids = await seed(tenantId);
    const service = knowledgeService();

    const detail: any = await inTenant(tenantId, (manager) => service.getLibrary(ids.documents, { manager, userId: ids.userId }));
    assert.equal(detail.is_default, true, 'the library dialog knows the default library');
    const teamDetail: any = await inTenant(tenantId, (manager) => service.getLibrary(ids.team, { manager, userId: ids.userId }));
    assert.equal(teamDetail.is_default, false);

    let refusal: any = null;
    try {
      await asRequest(tenantId, (manager) => service.deleteLibrary(ids.documents, ids.userId, { manager }));
    } catch (err) {
      refusal = err;
    }
    assert.ok(refusal, 'deleting the default library is refused');
    assert.equal(refusal.getStatus?.(), 409);
    assert.equal(refusal.getResponse?.().code, 'knowledge_default_library');
    const left: Array<{ library_id: string }> = await inTenant(tenantId, (m) =>
      m.query(`SELECT library_id FROM documents WHERE tenant_id = $1 AND id = $2`, [tenantId, ids.inDocuments]),
    );
    assert.equal(left[0]?.library_id, ids.documents, 'nothing moved');

    await asRequest(tenantId, (manager) => service.deleteLibrary(ids.team, ids.userId, { manager }));
    const moved: Array<{ library_id: string }> = await inTenant(tenantId, (m) =>
      m.query(`SELECT library_id FROM documents WHERE tenant_id = $1 AND id = $2`, [tenantId, ids.inTeam]),
    );
    assert.equal(moved[0]?.library_id, ids.documents, 'another library is deleted, its documents go to the default library');
  } finally {
    await cleanup(tenantId);
  }
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testDefaultLibraryIsRefused]) {
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
    throw new Error(`knowledge-default-library.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('knowledge-default-library.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
