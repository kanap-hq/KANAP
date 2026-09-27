import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { withSavepoint } from '../../common/savepoint.util';
import { Application } from '../application.entity';
import { ApplicationsDeleteService } from '../applications-delete.service';

// An application delete removes its attachment files only once the row delete
// has gone through: a delete that fails at the database keeps its files. No
// foreign key refuses an application delete today, so the refusal is a failing
// statement in the same delete (the audit write), as in the item delete specs.

type AuditEntry = { table: string; recordId: string };

function fakeStorage() {
  const deleted: string[] = [];
  return { deleted, deleteObject: async (key: string) => { deleted.push(key); } };
}

/** Audit double; `failOn` runs a failing statement, which aborts the transaction like a real database error. */
function auditDouble(failOn?: (entry: AuditEntry) => boolean) {
  return {
    log: async (entry: AuditEntry, opts?: { manager?: any }) => {
      if (failOn?.(entry)) await opts!.manager.query('SELECT 1 / 0');
    },
  };
}

async function inRolledBackTransaction(fn: (runner: QueryRunner, tenantId: string) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'App delete storage', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `app-del-storage-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await fn(runner, tenantId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function seedAppWithFile(runner: QueryRunner, tenantId: string, name: string) {
  const [{ id }] = await runner.query(`INSERT INTO applications (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, name]);
  const path = `files/${tenantId}/applications/${id}/file.pdf`;
  await runner.query(
    `INSERT INTO application_attachments (tenant_id, application_id, original_filename, stored_filename, storage_path)
     VALUES ($1, $2, 'file.pdf', 'file.pdf', $3)`,
    [tenantId, id, path],
  );
  return { id: id as string, path };
}

async function count(runner: QueryRunner, tenantId: string, table: string, column: string, id: string) {
  const [row] = await runner.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1 AND ${column} = $2`, [tenantId, id]);
  return Number(row.n);
}

function service(audit: unknown, storage: unknown) {
  return new ApplicationsDeleteService(dataSource.getRepository(Application), audit as any, storage as any);
}

async function testFailedDeleteKeepsItsFile() {
  await inRolledBackTransaction(async (runner, tenantId) => {
    const app = await seedAppWithFile(runner, tenantId, 'Refused application');
    const storage = fakeStorage();
    // The savepoint stands in for the request's rollback and keeps the test transaction usable.
    await assert.rejects(
      withSavepoint(runner.manager, () =>
        service(auditDouble((e) => e.recordId === app.id), storage).delete(app.id, { manager: runner.manager }),
      ),
      (err: any) => err?.code === '22012',
    );
    assert.deepEqual(storage.deleted, [], 'the failed delete keeps its file');
    assert.equal(await count(runner, tenantId, 'applications', 'id', app.id), 1);
    assert.equal(await count(runner, tenantId, 'application_attachments', 'application_id', app.id), 1);
  });
}

async function testSuccessfulDeleteRemovesItsFile() {
  await inRolledBackTransaction(async (runner, tenantId) => {
    const app = await seedAppWithFile(runner, tenantId, 'Deleted application');
    const storage = fakeStorage();
    await service(auditDouble(), storage).delete(app.id, { manager: runner.manager });
    assert.deepEqual(storage.deleted, [app.path]);
    assert.equal(await count(runner, tenantId, 'applications', 'id', app.id), 0);
    assert.equal(await count(runner, tenantId, 'application_attachments', 'application_id', app.id), 0);
  });
}

async function testBulkDeleteKeepsTheFailedApplicationsFile() {
  await inRolledBackTransaction(async (runner, tenantId) => {
    const apps = [
      await seedAppWithFile(runner, tenantId, 'First application'),
      await seedAppWithFile(runner, tenantId, 'Middle application'),
      await seedAppWithFile(runner, tenantId, 'Third application'),
    ];
    const storage = fakeStorage();
    const result = await service(auditDouble((e) => e.recordId === apps[1].id), storage).bulkDelete(
      apps.map((a) => a.id),
      null,
      { manager: runner.manager },
    );

    assert.deepEqual(result.deleted, [apps[0].id, apps[2].id]);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].id, apps[1].id);
    assert.equal(result.failed[0].name, 'Middle application');
    assert.deepEqual(storage.deleted, [apps[0].path, apps[2].path], 'the failed application keeps its file');
    for (const [i, app] of apps.entries()) {
      const expected = i === 1 ? 1 : 0;
      assert.equal(await count(runner, tenantId, 'applications', 'id', app.id), expected, `application ${i + 1}`);
      assert.equal(await count(runner, tenantId, 'application_attachments', 'application_id', app.id), expected, `attachments ${i + 1}`);
    }
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [
      testFailedDeleteKeepsItsFile,
      testSuccessfulDeleteRemovesItsFile,
      testBulkDeleteKeepsTheFailedApplicationsFile,
    ]) {
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
    throw new Error(`applications-delete-storage.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('applications-delete-storage.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
