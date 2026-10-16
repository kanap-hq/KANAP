import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ItemNumberService } from '../../common/item-number.service';
import { closeMarkdownWorkers } from '../../common/markdown-worker';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { IntegratedDocumentsService } from '../../knowledge/integrated-documents.service';
import { seedManagedDocsKnowledgeAssets } from '../../knowledge/integrated-document-seed';
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
import { Application } from '../application.entity';
import { ApplicationsDeleteService } from '../applications-delete.service';

// An application's managed documents (its overview and other integrated slots) are bound to it by
// `integrated_document_bindings (source_entity_type, source_entity_id)`, a polymorphic reference no
// foreign key can cover (common/reference-keys.inventory.ts). Deleting the application deletes
// them, as deleting an interface or a request does, audited under the user who deleted it; the
// application delete right covers them, so a user with no Knowledge right deletes them too.
// Another application's documents stay.

type AuditEntry = { table: string; recordId: string; action: string; userId: string | null };

function createServices(manager: any, audited: AuditEntry[]) {
  const permissions = new PermissionsService(manager.getRepository(UserPageRole), manager.getRepository(RolePermission));
  const users: any = {
    findById: async (id: string, opts?: any) =>
      (opts?.manager ?? manager).getRepository(User).findOne({ where: { id }, relations: ['role'] }),
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
    { log: async (entry: AuditEntry) => { audited.push(entry); } } as any,
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
  const importService: any = {
    convertToMarkdown: async () => ({ markdown: '', images: [], warnings: [], omittedTargets: [] }),
  };
  const integrated = new IntegratedDocumentsService(manager.getRepository(IntegratedDocumentBinding), knowledge, permissions, importService);
  return { integrated, storage };
}

async function inFixture(fn: (runner: QueryRunner, tenantId: string, writerId: string, deleterId: string) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tag = randomUUID().slice(0, 8);
    const tenantId = randomUUID();
    await runner.query(`INSERT INTO tenants (id, slug, name, status, created_at, updated_at) VALUES ($1, $2, $3, 'active', now(), now())`, [
      tenantId,
      `app-del-docs-${tag}`,
      `app-del-docs-${tag}`,
    ]);
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await seedManagedDocsKnowledgeAssets(runner.manager as any, tenantId);
    /** A user whose role holds `resources` at the admin level. */
    const seedUser = async (name: string, resources: string[]) => {
      const roleId = randomUUID();
      await runner.query(
        `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
         VALUES ($1, $2, $3, $3, false, false, now(), now())`,
        [roleId, tenantId, `${name} role`],
      );
      for (const resource of resources) {
        await runner.query(
          `INSERT INTO role_permissions (id, tenant_id, role_id, resource, level, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'admin', now(), now())`,
          [randomUUID(), tenantId, roleId, resource],
        );
      }
      const userId = randomUUID();
      await runner.query(
        `INSERT INTO users (id, tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Tester', $4, null, $5, false, 'enabled', now(), now())`,
        [userId, tenantId, name, `${name.toLowerCase()}-${tag}@example.com`, roleId],
      );
      return userId;
    };
    // The documents are opened by a Knowledge user; the application is deleted by a user with no Knowledge right.
    const writerId = await seedUser('Writer', ['applications', 'knowledge']);
    const deleterId = await seedUser('Deleter', ['applications']);
    await fn(runner, tenantId, writerId, deleterId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function bindings(runner: QueryRunner, applicationId: string): Promise<Array<{ document_id: string }>> {
  return runner.query(
    `SELECT document_id FROM integrated_document_bindings WHERE source_entity_type = 'applications' AND source_entity_id = $1`,
    [applicationId],
  );
}

async function testDeletedApplicationTakesItsManagedDocuments() {
  await inFixture(async (runner, tenantId, writerId, deleterId) => {
    const audited: AuditEntry[] = [];
    const { integrated, storage } = createServices(runner.manager, audited);
    const seedApp = async (name: string) => {
      const [{ id }] = await runner.query(
        `INSERT INTO applications (tenant_id, name, description) VALUES ($1, $2, 'What it does.') RETURNING id::text AS id`,
        [tenantId, name],
      );
      await integrated.getBySource('applications', id, 'overview', writerId, { manager: runner.manager });
      return id as string;
    };
    const goneId = await seedApp('Gone application');
    const keptId = await seedApp('Kept application');
    const [goneBinding] = await bindings(runner, goneId);
    assert.ok(goneBinding, 'opening the overview creates its managed document');
    assert.equal((await bindings(runner, keptId)).length, 1);

    const service = new ApplicationsDeleteService(
      dataSource.getRepository(Application),
      { log: async () => undefined } as any,
      storage,
      integrated,
    );
    await service.delete(goneId, { manager: runner.manager, userId: deleterId });

    assert.deepEqual(await bindings(runner, goneId), [], 'no binding names the deleted application');
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM documents WHERE id = $1`, [goneBinding.document_id]);
    assert.equal(n, 0, 'its managed document is deleted');
    const deletions = audited.filter((entry) => entry.table === 'documents' && entry.action === 'delete');
    assert.deepEqual(
      deletions.map((entry) => [entry.recordId, entry.userId]),
      [[goneBinding.document_id, deleterId]],
      'the document delete is audited under the user who deleted the application',
    );
    assert.equal((await bindings(runner, keptId)).length, 1, 'the other application keeps its document');
  });
}

async function main() {
  await dataSource.initialize();
  try {
    await testDeletedApplicationTakesItsManagedDocuments();
    console.log('  ok testDeletedApplicationTakesItsManagedDocuments');
  } finally {
    await dataSource.destroy();
    await closeMarkdownWorkers();
  }
  console.log('applications-delete-integrated-documents.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
