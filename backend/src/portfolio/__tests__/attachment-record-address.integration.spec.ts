import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { NotFoundException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

// An attachment of a request or of a project belongs to one record, and its routes follow that
// record:
// - `DELETE /portfolio/requests/:id/attachments/:attachmentId` and the same route of the projects
//   delete an attachment of the record of the address. An attachment of another record reads as
//   missing (404): the row, the stored file and the history stay as they were, also for a person
//   who may edit both records.
// - A Business Contributor deletes an attachment of a record they take part in, by its address.
// - `GET /portfolio/requests/attachments/:attachmentId` and the same route of the projects serve
//   the file to a person who reads the attachment's record, and answer 404 otherwise.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'attachment-record-address-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type UserKey = 'bc' | 'member';
type Family = 'requests' | 'projects';
type Seed = {
  tenantId: string;
  users: Record<UserKey, string>;
  // `own`: the record the Business Contributor takes part in; `other`: a record without them.
  records: Record<Family, { own: string; other: string }>;
};
type Harness = { app: any; dataSource: DataSource; requests: any; projects: any; deletedObjects: string[]; servedObjects: string[] };

const PERMISSIONS = { portfolio_requests: 'member', portfolio_projects: 'member' };
const TABLES: Record<Family, { table: string; parent: string }> = {
  requests: { table: 'portfolio_request_attachments', parent: 'request_id' },
  projects: { table: 'portfolio_project_attachments', parent: 'project_id' },
};

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for attachment-record-address.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { StorageService } = require('../../common/storage/storage.service');
  const { PortfolioRequestsController } = require('../portfolio-requests.controller');
  const { PortfolioProjectsController } = require('../portfolio-projects.controller');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  // The object store is not under test: the spec records what the routes ask of it.
  const deletedObjects: string[] = [];
  const servedObjects: string[] = [];
  const storage = app.get(StorageService);
  storage.deleteObject = async (key: string) => { deletedObjects.push(key); };
  storage.getObjectStream = async (key: string) => {
    servedObjects.push(key);
    return { stream: { pipe: () => undefined }, contentType: 'text/plain', contentLength: 4 };
  };
  return {
    app,
    dataSource: app.get(DataSource),
    requests: app.get(PortfolioRequestsController),
    projects: app.get(PortfolioProjectsController),
    deletedObjects,
    servedObjects,
  };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `attachment-address-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const user = async (key: string, roleName: string) => {
    const roleId = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, $2, $2)`, [tenantId, roleName]);
    for (const [resource, level] of Object.entries(PERMISSIONS)) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, roleId, resource, level]);
    }
    return insertId(runner,
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, $3, 'Tester', $4, 'enabled')`,
      [tenantId, `${key}-${slug}@example.test`, key, roleId]);
  };
  const users: Record<UserKey, string> = {
    // The built-in role's name sets the participation scope (`resolveBusinessContributorScope`).
    bc: await user('bc', 'Business Contributor'),
    member: await user('member', 'Portfolio Member'),
  };
  const request = (number: number, name: string, requestorId: string | null) => insertId(runner,
    `INSERT INTO portfolio_requests (tenant_id, item_number, name, status, criteria_values, feasibility_review, priority_override, requestor_id)
     VALUES ($1, $2, $3, 'approved', '{}'::jsonb, '{}'::jsonb, false, $4)`, [tenantId, number, name, requestorId]);
  const project = (number: number, name: string) => insertId(runner,
    `INSERT INTO portfolio_projects (tenant_id, item_number, name) VALUES ($1, $2, $3)`, [tenantId, number, name]);
  const records = {
    requests: { own: await request(1, 'Own request', users.bc), other: await request(2, 'Other request', null) },
    projects: { own: await project(1, 'Own project'), other: await project(2, 'Other project') },
  };
  await runner.query(`INSERT INTO portfolio_project_team (tenant_id, project_id, user_id, role) VALUES ($1, $2, $3, 'member')`, [tenantId, records.projects.own, users.bc]);
  return { tenantId, users, records };
}

/** A new attachment of `recordId`, as an upload leaves it. */
async function attach(runner: QueryRunner, s: Seed, family: Family, recordId: string) {
  const { table, parent } = TABLES[family];
  const name = `${randomUUID()}_note.txt`;
  const storagePath = `files/${s.tenantId}/portfolio-${family}/${recordId}/${name}`;
  const id = await insertId(runner,
    `INSERT INTO ${table} (tenant_id, ${parent}, original_filename, stored_filename, mime_type, size, storage_path)
     VALUES ($1, $2, 'note.txt', $3, 'text/plain', 4, $4)`, [s.tenantId, recordId, name, storagePath]);
  return { id, storagePath };
}

async function attachmentExists(runner: QueryRunner, family: Family, id: string): Promise<boolean> {
  const rows = await runner.query(`SELECT 1 FROM ${TABLES[family].table} WHERE id = $1`, [id]);
  return rows.length === 1;
}

async function deleteEntries(runner: QueryRunner, s: Seed, family: Family, id: string): Promise<number> {
  const [row] = await runner.query(
    `SELECT count(*)::int AS total FROM audit_log WHERE tenant_id = $1 AND table_name = $2 AND record_id = $3 AND action = 'delete'`,
    [s.tenantId, TABLES[family].table, id],
  );
  return row.total;
}

/** What each controller reads the person from: the raw request (requests), the tenant context (projects). */
function caller(runner: QueryRunner, s: Seed, family: Family, user: UserKey) {
  return family === 'requests'
    ? { queryRunner: runner, isAdmin: false, permissions: PERMISSIONS, tenant: { id: s.tenantId }, user: { sub: s.users[user] } }
    : { tenantId: s.tenantId, userId: s.users[user], isAdmin: false, permissions: PERMISSIONS, manager: runner.manager, queryRunner: runner };
}

const controller = (h: Harness, family: Family) => (family === 'requests' ? h.requests : h.projects);
const response = () => ({ setHeader: () => undefined });

async function readsAsMissing(fn: () => Promise<unknown>, label: string) {
  const error = await fn().then(() => null, (caught: unknown) => caught);
  assert.ok(error instanceof NotFoundException, `${label}: answered as missing`);
  assert.equal(error.getStatus(), 404, `${label}: status`);
}

async function testDeleteFollowsTheRecordOfTheAddress(h: Harness, runner: QueryRunner, s: Seed, family: Family) {
  const { own, other } = s.records[family];
  const route = controller(h, family);
  const kept = await attach(runner, s, family, other);

  // The address of another record, for a person who may edit both records, then for a person who
  // takes part in the record of the address only.
  for (const user of ['member', 'bc'] as const) {
    const label = `${family}, ${user}: attachment of another record`;
    await readsAsMissing(() => route.deleteAttachment(own, kept.id, caller(runner, s, family, user)), label);
    assert.equal(await attachmentExists(runner, family, kept.id), true, `${label}: row kept`);
    assert.equal(h.deletedObjects.includes(kept.storagePath), false, `${label}: stored file kept`);
    assert.equal(await deleteEntries(runner, s, family, kept.id), 0, `${label}: no history entry`);
  }

  // The address of its own record, which the Business Contributor does not take part in.
  await readsAsMissing(
    () => route.deleteAttachment(other, kept.id, caller(runner, s, family, 'bc')),
    `${family}, bc: record outside the participation`,
  );
  assert.equal(await attachmentExists(runner, family, kept.id), true, `${family}: row kept`);

  // The address of its own record, for a person who may edit it.
  assert.deepEqual(await route.deleteAttachment(other, kept.id, caller(runner, s, family, 'member')), { ok: true });
  assert.equal(await attachmentExists(runner, family, kept.id), false, `${family}, member: row deleted`);
  assert.equal(h.deletedObjects.includes(kept.storagePath), true, `${family}, member: stored file deleted`);
  assert.equal(await deleteEntries(runner, s, family, kept.id), 1, `${family}, member: one history entry`);

  const mine = await attach(runner, s, family, own);
  assert.deepEqual(await route.deleteAttachment(own, mine.id, caller(runner, s, family, 'bc')), { ok: true });
  assert.equal(await attachmentExists(runner, family, mine.id), false, `${family}, bc: row deleted on their record`);
}

async function testDownloadFollowsTheAttachmentRecord(h: Harness, runner: QueryRunner, s: Seed, family: Family) {
  const { own, other } = s.records[family];
  const route = controller(h, family);
  const outside = await attach(runner, s, family, other);
  const inside = await attach(runner, s, family, own);

  await readsAsMissing(
    () => route.downloadAttachment(outside.id, response(), caller(runner, s, family, 'bc')),
    `${family}, bc: download outside the participation`,
  );
  assert.equal(h.servedObjects.includes(outside.storagePath), false, `${family}, bc: file not served`);

  await route.downloadAttachment(inside.id, response(), caller(runner, s, family, 'bc'));
  assert.equal(h.servedObjects.includes(inside.storagePath), true, `${family}, bc: file of their record served`);
  await route.downloadAttachment(outside.id, response(), caller(runner, s, family, 'member'));
  assert.equal(h.servedObjects.includes(outside.storagePath), true, `${family}, member: file served`);
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      for (const family of ['requests', 'projects'] as const) {
        await testDownloadFollowsTheAttachmentRecord(harness, runner, s, family);
        await testDeleteFollowsTheRecordOfTheAddress(harness, runner, s, family);
      }
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('attachment-record-address.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
