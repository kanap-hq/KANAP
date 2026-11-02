import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../../data-source';
import { ItemNumberService } from '../../item-number.service';
import { KnowledgeService } from '../../../knowledge/knowledge.service';
import { IntegratedDocumentsService } from '../../../knowledge/integrated-documents.service';
import { seedManagedDocsKnowledgeAssets } from '../../../knowledge/integrated-document-seed';
import { Document } from '../../../knowledge/document.entity';
import { DocumentActivity } from '../../../knowledge/document-activity.entity';
import { DocumentApplication } from '../../../knowledge/document-application.entity';
import { DocumentAsset } from '../../../knowledge/document-asset.entity';
import { DocumentAttachment } from '../../../knowledge/document-attachment.entity';
import { DocumentClassification } from '../../../knowledge/document-classification.entity';
import { DocumentContributor } from '../../../knowledge/document-contributor.entity';
import { DocumentEditLock } from '../../../knowledge/document-edit-lock.entity';
import { DocumentFolder } from '../../../knowledge/document-folder.entity';
import { DocumentLibrary } from '../../../knowledge/document-library.entity';
import { DocumentProject } from '../../../knowledge/document-project.entity';
import { DocumentReference } from '../../../knowledge/document-reference.entity';
import { DocumentRequest } from '../../../knowledge/document-request.entity';
import { DocumentTask } from '../../../knowledge/document-task.entity';
import { DocumentType } from '../../../knowledge/document-type.entity';
import { DocumentVersion } from '../../../knowledge/document-version.entity';
import { IntegratedDocumentBinding } from '../../../knowledge/integrated-document-binding.entity';
import { PermissionsService } from '../../../permissions/permissions.service';
import { RolePermission } from '../../../permissions/role-permission.entity';
import { UserPageRole } from '../../../permissions/user-page-role.entity';
import { User } from '../../../users/user.entity';

/**
 * Shared set-up of the "Cancel creation" specs of requests, projects and incidents (lot 1b of the
 * creation frame): a rolled-back transaction, a tenant with its managed-document library, a role at
 * the create level, two people, and the real managed-document services, so the specs create, edit
 * and delete the documents a record is created with.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'creation-cancel-spec-secret';

export async function inRolledBackTransaction(fn: (runner: QueryRunner) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

export type CreationSeed = {
  tenantId: string;
  creatorId: string;
  otherId: string;
  permissions: Record<string, string>;
};

/** A tenant, its Managed Docs library, a role with `permissions` and two people holding it. */
export async function seedCreationTenant(runner: QueryRunner, permissions: Record<string, string>): Promise<CreationSeed> {
  const tag = randomUUID().slice(0, 8);
  const tenantId = randomUUID();
  await runner.query(`INSERT INTO tenants (id, slug, name, status, created_at, updated_at) VALUES ($1, $2::text, $2::text, 'active', now(), now())`, [
    tenantId,
    `cancel-creation-${tag}`,
  ]);
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  await seedManagedDocsKnowledgeAssets(runner.manager as any, tenantId);
  const roleId = randomUUID();
  await runner.query(
    `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, 'Creators', 'Creators', false, false, now(), now())`,
    [roleId, tenantId],
  );
  for (const [resource, level] of Object.entries(permissions)) {
    await runner.query(
      `INSERT INTO role_permissions (id, tenant_id, role_id, resource, level, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())`,
      [randomUUID(), tenantId, roleId, resource, level],
    );
  }
  const user = async (name: string) => {
    const id = randomUUID();
    await runner.query(
      `INSERT INTO users (id, tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Tester', $4, null, $5, false, 'enabled', now(), now())`,
      [id, tenantId, name, `${name.toLowerCase()}-${tag}@example.com`, roleId],
    );
    return id;
  };
  return { tenantId, creatorId: await user('Creator'), otherId: await user('Other'), permissions };
}

/** The `@Tenant()` context of a route, for one person. */
export function tenantContext(seed: CreationSeed, userId: string, manager: EntityManager) {
  return { tenantId: seed.tenantId, userId, isAdmin: false, permissions: seed.permissions, manager } as any;
}

/** A storage that records the files it was asked to delete. */
export function recordingStorage() {
  const deleted: string[] = [];
  return {
    deleted,
    putObject: async () => undefined,
    deleteObject: async (path: string) => {
      deleted.push(path);
    },
    getObjectStream: async () => ({ stream: null, contentType: null, contentLength: null }),
  };
}

/** The real managed-document services (provisioning, delete), on the spec's transaction. */
export function managedDocumentServices(manager: EntityManager) {
  const permissions = new PermissionsService(manager.getRepository(UserPageRole), manager.getRepository(RolePermission));
  const users: any = {
    findById: async (id: string, opts?: any) => (opts?.manager ?? manager).getRepository(User).findOne({ where: { id }, relations: ['role'] }),
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
    recordingStorage() as any,
    {} as any,
    dataSource,
    permissions,
    users,
    {} as any,
    { notifyShare: async () => undefined } as any,
  );
  const importService: any = { convertToMarkdown: async () => ({ markdown: '', images: [], warnings: [], omittedTargets: [] }) };
  return new IntegratedDocumentsService(manager.getRepository(IntegratedDocumentBinding), knowledge, permissions, importService);
}

/** Writes `content` into the record's managed document of `slotKey`, as an edit of it would. */
export async function writeManagedDocument(runner: QueryRunner, tenantId: string, sourceType: string, recordId: string, slotKey: string, content: string) {
  const rows = await runner.query(
    `UPDATE documents d SET content_markdown = $5, updated_at = now()
       FROM integrated_document_bindings b
      WHERE b.tenant_id = $1 AND b.source_entity_type = $2 AND b.source_entity_id = $3 AND b.slot_key = $4
        AND d.id = b.document_id AND d.tenant_id = b.tenant_id
      RETURNING d.id`,
    [tenantId, sourceType, recordId, slotKey, content],
  );
  assert.equal(rows[0]?.length ?? rows.length, 1, `the ${sourceType} ${slotKey} document exists`);
}

/** The managed documents still bound to the record. */
export async function boundDocuments(runner: QueryRunner, tenantId: string, sourceType: string, recordId: string): Promise<number> {
  const [{ n }] = await runner.query(
    `SELECT count(*)::int AS n FROM integrated_document_bindings WHERE tenant_id = $1 AND source_entity_type = $2 AND source_entity_id = $3`,
    [tenantId, sourceType, recordId],
  );
  return n;
}

export async function refusedAsExpired(promise: Promise<unknown>, message: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ForbiddenException, message);
    assert.equal((error.getResponse() as any).code, 'CREATION_CANCEL_EXPIRED', message);
    return true;
  });
}

/** The `delete` audit rows of the record, by person. */
export async function deletionAuthors(runner: QueryRunner, tenantId: string, table: string, recordId: string): Promise<string[]> {
  const rows = await runner.query(
    `SELECT user_id FROM audit_log WHERE tenant_id = $1 AND table_name = $2 AND record_id = $3 AND action = 'delete'`,
    [tenantId, table, recordId],
  );
  return rows.map((row: any) => row.user_id);
}
