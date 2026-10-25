import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ItemNumberService } from '../../common/item-number.service';
import { closeMarkdownWorkers } from '../../common/markdown-worker';
import { KnowledgeService } from '../knowledge.service';
import { IntegratedDocumentsService } from '../integrated-documents.service';
import { seedManagedDocsKnowledgeAssets } from '../integrated-document-seed';
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
import { ApplicationsController } from '../../applications/applications.controller';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { User } from '../../users/user.entity';

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
  return { integrated, storage, knowledge };
}


// Recette C1a (anomaly 51): an integrated description (an application's overview, an interface's
// or a project's text) is reached through its source record. The source permission decides:
// a member of the record opens, locks and saves it with no Knowledge right; a reader opens it
// only; the Knowledge routes and any other document keep their own access rules.

async function inFixture(fn: (runner: QueryRunner, users: { member: string; reader: string }) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tag = randomUUID().slice(0, 8);
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, created_at, updated_at) VALUES ($1, $2::text, $2::text, 'active', now(), now())`,
      [tenantId, `source-grant-${tag}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await seedManagedDocsKnowledgeAssets(runner.manager as any, tenantId);
    const seedUser = async (name: string, level: string) => {
      const roleId = randomUUID();
      await runner.query(
        `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
         VALUES ($1, $2, $3, $3, false, false, now(), now())`,
        [roleId, tenantId, `${name} role`],
      );
      await runner.query(
        `INSERT INTO role_permissions (id, tenant_id, role_id, resource, level, created_at, updated_at)
         VALUES ($1, $2, $3, 'applications', $4, now(), now())`,
        [randomUUID(), tenantId, roleId, level],
      );
      const userId = randomUUID();
      await runner.query(
        `INSERT INTO users (id, tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Tester', $4, null, $5, false, 'enabled', now(), now())`,
        [userId, tenantId, name, `${name.toLowerCase()}-${tag}@example.com`, roleId],
      );
      return userId;
    };
    await fn(runner, { member: await seedUser('Member', 'member'), reader: await seedUser('Reader', 'reader') });
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function rejects(promise: Promise<unknown>, label: string) {
  await assert.rejects(promise, (error: any) => [403, 404].includes(error?.getStatus?.()), label);
}

async function testMemberWritesTheDescriptionOfItsRecord() {
  await inFixture(async (runner, { member, reader }) => {
    const { integrated, knowledge } = createServices(runner.manager, []);
    const manager = runner.manager;
    const seedApp = async (name: string) => {
      const [{ id }] = await runner.query(`INSERT INTO applications (tenant_id, name) VALUES (app_current_tenant(), $1) RETURNING id::text AS id`, [name]);
      return id as string;
    };
    const appId = await seedApp('Member application');

    // A member with no Knowledge right opens the overview of a new application: it is created.
    const opened: any = await integrated.getBySource('applications', appId, 'overview', member, { manager });
    assert.ok(opened.id, 'the overview opens for a member');
    const lock: any = await integrated.acquireLockBySource('applications', appId, 'overview', member, { manager });
    assert.ok(lock.lock_token, 'the member locks it');
    await integrated.heartbeatLockBySource('applications', appId, 'overview', member, lock.lock_token, { manager });
    await integrated.updateBySource('applications', appId, 'overview', {
      content_markdown: 'What it does.', revision: opened.revision, save_mode: 'manual',
    }, member, lock.lock_token, { manager });
    await integrated.releaseLockBySource('applications', appId, 'overview', member, lock.lock_token, { manager });
    const saved: any = await integrated.getBySource('applications', appId, 'overview', reader, { manager });
    assert.equal(saved.content_markdown, 'What it does.', 'a reader of the record reads the saved text');

    // A reader of the record cannot write it.
    await rejects(integrated.acquireLockBySource('applications', appId, 'overview', reader, { manager }), 'a reader cannot lock it');

    // Nothing leaks to Knowledge: the same document stays closed there, and a grant opens no other document.
    await rejects(knowledge.get(opened.id, { manager, userId: member }), 'the Knowledge route still applies the library rules');
    await rejects(knowledge.acquireLock(opened.id, member, { manager }), 'no lock without the source grant');
    const otherId = await seedApp('Other application');
    const other: any = await integrated.getBySource('applications', otherId, 'overview', member, { manager });
    const forged = { documentId: other.id, sourceEntityType: 'applications', sourceEntityId: appId, slotKey: 'overview', level: 'writer' as const };
    await rejects(knowledge.acquireLock(other.id, member, { manager, sourceGrant: forged }), 'a grant naming another source opens nothing');
    await rejects(
      knowledge.acquireLock(other.id, member, { manager, sourceGrant: { ...forged, documentId: opened.id, sourceEntityId: appId } }),
      'a grant for one document opens no other',
    );
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM document_edit_locks WHERE document_id = $1`, [other.id]);
    assert.equal(n, 0);
  });
}

// A new version of an application starts with the description of its source.
async function testNewVersionCopiesTheDescription() {
  await inFixture(async (runner, { member }) => {
    const { integrated } = createServices(runner.manager, []);
    const manager = runner.manager;
    const seedApp = async (name: string) => {
      const [{ id, tenant_id }] = await runner.query(`INSERT INTO applications (tenant_id, name) VALUES (app_current_tenant(), $1) RETURNING id::text AS id, tenant_id::text AS tenant_id`, [name]);
      return { id: id as string, tenant_id: tenant_id as string };
    };
    const source = await seedApp('Source');
    const target = await seedApp('Target');
    const descriptor = (app: { id: string; tenant_id: string }, name: string) => ({ ...app, item_number: null, name, reference_label: 'APP-1' });
    assert.equal(await integrated.copyApplicationOverview(source.id, descriptor(target, 'Target'), member, { manager }), false, 'no source description, nothing copied');
    await integrated.writeSourceSlotContent('applications', descriptor(source, 'Source'), 'overview', 'The **source** text.', member, { manager });
    assert.equal(await integrated.copyApplicationOverview(source.id, descriptor(target, 'Target'), member, { manager }), true);
    const copied: any = await integrated.getBySource('applications', target.id, 'overview', member, { manager });
    assert.equal(copied.content_markdown, 'The **source** text.');
    const original: any = await integrated.getBySource('applications', source.id, 'overview', member, { manager });
    assert.notEqual(copied.id, original.id, 'the new application has its own document');
    assert.match(String(copied.title), /^APP-1 - Target - /);
  });
}

// Issue 816: the page-hide beacon calls the same DELETE the editor uses
// (`X-Lock-Token` on `.../integrated-documents/:slot/locks`). Once it lands,
// another member can lock the description at once, inside the five-minute TTL.
async function testReleaseRouteFreesTheLockAtOnce() {
  await inFixture(async (runner, { member }) => {
    const { integrated } = createServices(runner.manager, []);
    const manager = runner.manager;
    const [{ tenant_id: tenantId }] = await runner.query(
      `SELECT tenant_id::text AS tenant_id FROM users WHERE id = $1`,
      [member],
    );
    const tag = randomUUID().slice(0, 8);
    const roleId = randomUUID();
    await runner.query(
      `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
       VALUES ($1, $2, $3, $3, false, false, now(), now())`,
      [roleId, tenantId, `Other member ${tag}`],
    );
    await runner.query(
      `INSERT INTO role_permissions (id, tenant_id, role_id, resource, level, created_at, updated_at)
       VALUES ($1, $2, $3, 'applications', 'member', now(), now())`,
      [randomUUID(), tenantId, roleId],
    );
    const other = randomUUID();
    await runner.query(
      `INSERT INTO users (id, tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status, created_at, updated_at)
       VALUES ($1, $2, 'Other', 'Member', $3, null, $4, false, 'enabled', now(), now())`,
      [other, tenantId, `other-${tag}@example.com`, roleId],
    );

    const [{ id: appId }] = await runner.query(
      `INSERT INTO applications (tenant_id, name) VALUES (app_current_tenant(), 'Locked application') RETURNING id::text AS id`,
    );
    const opened: any = await integrated.getBySource('applications', appId, 'overview', member, { manager });
    const lock: any = await integrated.acquireLockBySource('applications', appId, 'overview', member, { manager });
    const heldUntil = new Date(lock.expires_at).getTime() - Date.now();
    assert.ok(heldUntil > 4.5 * 60 * 1000 && heldUntil < 5.5 * 60 * 1000, 'the lock still expires after five minutes');

    const heartbeat: any = await integrated.heartbeatLockBySource('applications', appId, 'overview', member, lock.lock_token, { manager });
    const extended = new Date(heartbeat.expires_at).getTime() - Date.now();
    assert.ok(extended > 4.5 * 60 * 1000 && extended < 5.5 * 60 * 1000, 'a heartbeat still renews the five minutes');

    await assert.rejects(
      () => integrated.acquireLockBySource('applications', appId, 'overview', other, { manager }),
      (error: any) => error?.getStatus?.() === 423,
      'the other member is refused while the lock is held',
    );

    const controller = new ApplicationsController(
      { assertVisible: async () => undefined } as any,
      null as any,
      null as any,
      null as any,
      null as any,
      integrated,
      null as any,
      null as any,
      null as any,
    );
    (controller as any).readApplicationOpts = async () => ({ manager, tenantId });
    const release = (userId: string, token: string | undefined) => controller.releaseIntegratedDocumentLock(
      appId,
      'overview',
      { headers: { 'x-lock-token': token } } as any,
      { manager, userId, tenantId } as any,
    );

    await assert.rejects(
      () => release(member, 'not-the-token'),
      (error: any) => error?.getStatus?.() === 423,
      'a wrong token does not release',
    );
    await assert.rejects(
      () => release(other, lock.lock_token),
      (error: any) => error?.getStatus?.() === 423,
      'another member cannot release with the holder token',
    );
    const [{ n: stillHeld }] = await runner.query(
      `SELECT count(*)::int AS n FROM document_edit_locks WHERE document_id = $1`,
      [opened.id],
    );
    assert.equal(stillHeld, 1, 'the lock is still held');

    const released: any = await release(member, lock.lock_token);
    assert.deepEqual(released, { ok: true });
    const [{ n: freed }] = await runner.query(
      `SELECT count(*)::int AS n FROM document_edit_locks WHERE document_id = $1`,
      [opened.id],
    );
    assert.equal(freed, 0, 'the release route deletes the lock at once');

    const fresh: any = await integrated.acquireLockBySource('applications', appId, 'overview', member, { manager });
    assert.ok(fresh.lock_token && fresh.lock_token !== lock.lock_token, 'the same user takes a fresh lock');
    await release(member, fresh.lock_token);

    const taken: any = await integrated.acquireLockBySource('applications', appId, 'overview', other, { manager });
    assert.ok(taken.lock_token, 'the other member locks it without waiting for the expiry');
    const [{ holder_user_id: holder }] = await runner.query(
      `SELECT holder_user_id::text AS holder_user_id FROM document_edit_locks WHERE document_id = $1`,
      [opened.id],
    );
    assert.equal(holder, other);
  });
}

async function main() {
  await dataSource.initialize();
  try {
    await testMemberWritesTheDescriptionOfItsRecord();
    console.log('  ok testMemberWritesTheDescriptionOfItsRecord');
    await testNewVersionCopiesTheDescription();
    console.log('  ok testNewVersionCopiesTheDescription');
    await testReleaseRouteFreesTheLockAtOnce();
    console.log('  ok testReleaseRouteFreesTheLockAtOnce');
  } finally {
    await dataSource.destroy();
    await closeMarkdownWorkers();
  }
  console.log('integrated-document-source-grant.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
