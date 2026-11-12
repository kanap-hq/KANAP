import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// A task turned into a request gives the request a copy of each task attachment, naming the same
// stored file. A copy and a delete of the task's attachment that run at the same time never leave
// a row naming a file that is gone:
// - the copy is not yet committed when the delete runs: the delete waits for it, sees the copy and
//   keeps the file;
// - the delete is not yet committed when the copy runs: the copy waits for it and does not copy the
//   deleted attachment.
// - the request's text keeps the task's inline images (their address names the task attachment):
//   an image taken out of the task's description stays, row and file, while the request shows it.
// Two connections, on a tenant committed for the spec and purged at the end.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'attachment-file-copy-race-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Seed = { tenantId: string; userId: string };
type Attachment = { taskId: string; attachmentId: string; storagePath: string };

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

async function seedTenant(dataSource: DataSource): Promise<Seed> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    const tag = tenantId.slice(0, 8);
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `file-race-${tag}`, `File race ${tag}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const { seedManagedDocsKnowledgeAssets } = require('../../knowledge/integrated-document-seed');
    await seedManagedDocsKnowledgeAssets(runner, tenantId);
    const roleId = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Spec editor', 'Spec editor')`, [tenantId]);
    const userId = await insertId(runner,
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, 'Race', 'Tester', $3, 'enabled')`,
      [tenantId, `race-${tag}@example.test`, roleId]);
    await runner.commitTransaction();
    return { tenantId, userId };
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
}

/** A committed task with one attachment. */
async function seedTask(dataSource: DataSource, s: Seed, itemNumber: number): Promise<Attachment> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [s.tenantId]);
    const taskId = await insertId(runner,
      `INSERT INTO tasks (tenant_id, item_number, title, status, labels, owner_ids, viewer_ids)
       VALUES ($1, $2, $3, 'open', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`, [s.tenantId, itemNumber, `Race task ${itemNumber}`]);
    const name = `${randomUUID()}_note.txt`;
    const storagePath = `files/${s.tenantId}/tasks/${taskId}/${name}`;
    const attachmentId = await insertId(runner,
      `INSERT INTO task_attachments (tenant_id, task_id, original_filename, stored_filename, mime_type, size, storage_path)
       VALUES ($1, $2, 'note.txt', $3, 'text/plain', 4, $4)`, [s.tenantId, taskId, name, storagePath]);
    await runner.commitTransaction();
    return { taskId, attachmentId, storagePath };
  } finally {
    await runner.release();
  }
}

async function openTenantTransaction(dataSource: DataSource, tenantId: string): Promise<QueryRunner> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  return runner;
}

/** The promise's value when it settles within `ms`, else `pending`. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | 'pending'> {
  return Promise.race([promise, new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), ms))]);
}

async function requestCopiesNaming(dataSource: DataSource, tenantId: string, storagePath: string): Promise<number> {
  const runner = await openTenantTransaction(dataSource, tenantId);
  try {
    const [row] = await runner.query(
      `SELECT count(*)::int AS total FROM portfolio_request_attachments WHERE tenant_id = $1 AND storage_path = $2`,
      [tenantId, storagePath],
    );
    return row.total;
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for attachment-file-copy-race.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { StorageService } = require('../storage/storage.service');
  const { TaskAttachmentsService } = require('../../tasks/task-attachments.service');
  const { PortfolioRequestsService } = require('../../portfolio/portfolio-requests.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const deletedObjects: string[] = [];
  const storage = app.get(StorageService);
  storage.deleteObject = async (key: string) => { deletedObjects.push(key); };
  const dataSource = app.get(DataSource);
  const tasks = app.get(TaskAttachmentsService);
  const requests = app.get(PortfolioRequestsService);
  const seed = await seedTenant(dataSource);
  try {
    const convert = (runner: QueryRunner, taskId: string) => requests.convertFromTask(taskId, {}, seed.tenantId, seed.userId, { manager: runner.manager });
    const deleteAttachment = (runner: QueryRunner, attachmentId: string) => tasks.deleteAttachment(attachmentId, seed.userId, { manager: runner.manager });

    // The copy runs first and is not committed when the delete runs.
    {
      const shared = await seedTask(dataSource, seed, 1);
      const copy = await openTenantTransaction(dataSource, seed.tenantId);
      const del = await openTenantTransaction(dataSource, seed.tenantId);
      try {
        await convert(copy, shared.taskId);
        const deleting = deleteAttachment(del, shared.attachmentId);
        const early = await within(deleting, 400);
        await copy.commitTransaction();
        if (early === 'pending') await deleting;
        await del.commitTransaction();
      } finally {
        if (copy.isTransactionActive) await copy.rollbackTransaction();
        if (del.isTransactionActive) await del.rollbackTransaction();
        await copy.release();
        await del.release();
      }
      assert.equal(await requestCopiesNaming(dataSource, seed.tenantId, shared.storagePath), 1, 'copy first: the request copy is there');
      assert.equal(deletedObjects.includes(shared.storagePath), false, 'copy first: the file the request copy names is kept');
    }

    // The delete runs first and is not committed when the copy runs.
    {
      const shared = await seedTask(dataSource, seed, 2);
      const copy = await openTenantTransaction(dataSource, seed.tenantId);
      const del = await openTenantTransaction(dataSource, seed.tenantId);
      try {
        await deleteAttachment(del, shared.attachmentId);
        const copying = convert(copy, shared.taskId);
        const early = await within(copying, 400);
        await del.commitTransaction();
        if (early === 'pending') await copying;
        await copy.commitTransaction();
      } finally {
        if (copy.isTransactionActive) await copy.rollbackTransaction();
        if (del.isTransactionActive) await del.rollbackTransaction();
        await copy.release();
        await del.release();
      }
      const copies = await requestCopiesNaming(dataSource, seed.tenantId, shared.storagePath);
      assert.ok(
        copies === 0 || !deletedObjects.includes(shared.storagePath),
        'delete first: no request copy names a deleted file',
      );
    }

    // An inline image of the task, shown by the request's text after the conversion.
    {
      const shared = await seedTask(dataSource, seed, 3);
      const runner = await openTenantTransaction(dataSource, seed.tenantId);
      try {
        const [{ slug }] = await runner.query(`SELECT slug FROM tenants WHERE id = $1`, [seed.tenantId]);
        await runner.query(`UPDATE task_attachments SET source_field = 'description' WHERE id = $1`, [shared.attachmentId]);
        const description = `Before\n\n![shot](/api/tasks/attachments/${slug}/${shared.attachmentId}/inline)\n\nAfter`;
        await runner.query(`UPDATE tasks SET description = $2 WHERE id = $1`, [shared.taskId, description]);
        await convert(runner, shared.taskId);
        const [shown] = await runner.query(
          `SELECT count(*)::int AS total FROM documents WHERE tenant_id = $1 AND content_markdown LIKE '%' || $2 || '%'`,
          [seed.tenantId, shared.attachmentId],
        );
        assert.equal(shown.total, 1, 'inline image: the request text shows the task image');
        // The task's description loses the image, as a save does, then its images are cleaned up.
        await runner.query(`UPDATE tasks SET description = 'Before' WHERE id = $1`, [shared.taskId]);
        await tasks.cleanupOrphanedImages(shared.taskId, 'description', description, 'Before', { manager: runner.manager });
        const kept = await runner.query(`SELECT 1 FROM task_attachments WHERE id = $1`, [shared.attachmentId]);
        assert.equal(kept.length, 1, 'inline image: the row the request text names is kept');
        assert.equal(deletedObjects.includes(shared.storagePath), false, 'inline image: its file is kept');
        await runner.commitTransaction();
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
      }
    }
  } finally {
    const { withTenantExecution } = require('../tenant-runner');
    const { purgeTenantTables } = require('../../admin/tenants/tenant-data-purge');
    const { TENANT_PURGE_TABLES } = require('../../admin/tenants/tenant-purge.inventory');
    await withTenantExecution(dataSource, seed.tenantId, (manager: any) => purgeTenantTables(manager, TENANT_PURGE_TABLES))
      .catch((error: unknown) => console.error(`could not purge ${seed.tenantId}:`, error));
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [seed.tenantId])
      .catch((error: unknown) => console.error(`could not delete ${seed.tenantId}:`, error));
    await app.close();
  }
  console.log('attachment-file-copy-race.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
