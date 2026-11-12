import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// A task's Applications field shows the applications the person reads:
// - a person who reads every application: all of them, as before;
// - a Business Contributor: the applications of their participation, the field stays (one
//   application outside it no longer hides the whole field); a save of the field keeps the others;
// - a person who does not read applications: no field (null), as before.
// The task page and the tasks list read the same way.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'task-readable-applications-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for task-readable-applications.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { TasksController } = require('../../spend/tasks.controller');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const tasks = app.get(TasksController);
  const runner = app.get(DataSource).createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    const slug = `task-apps-${tenantId.slice(0, 8)}`;
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, slug, slug],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const role = async (name: string, permissions: Record<string, string>) => {
      const id = await insertId(runner, `INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2)`, [tenantId, name]);
      for (const [resource, level] of Object.entries(permissions)) {
        await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, id, resource, level]);
      }
      return { id, permissions };
    };
    const user = async (name: string, roleId: string) => {
      const id = await insertId(runner,
        `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, $3, 'Reader', $4, 'enabled')`,
        [tenantId, `${name}-${tenantId.slice(0, 8)}@example.test`, name, roleId]);
      await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, id, roleId]);
      return id;
    };
    const adminRole = await role('Administrator', {});
    const bcRole = await role('Business Contributor', { tasks: 'member', applications: 'reader' });
    const tasksOnly = await role('Task reader', { tasks: 'reader' });
    const adminId = await user('admin', adminRole.id);
    const bcId = await user('bc', bcRole.id);
    const readerId = await user('reader', tasksOnly.id);

    const seen = await insertId(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Seen app')`, [tenantId]);
    await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`, [tenantId, seen, bcId]);
    const unseen = await insertId(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Secret app')`, [tenantId]);
    const task = await insertId(runner,
      `INSERT INTO tasks (tenant_id, item_number, title, status, assignee_user_id, labels, owner_ids, viewer_ids) VALUES ($1, 1, 'Shared task', 'open', $2, '[]', '[]', '[]')`,
      [tenantId, bcId]);
    await runner.query(`INSERT INTO task_applications (tenant_id, task_id, application_id) VALUES ($1, $2, $3), ($1, $2, $4)`, [tenantId, task, seen, unseen]);

    const reqOf = (userId: string, permissions: Record<string, string>, isAdmin = false) => ({
      tenantId, userId, isAdmin, permissions, manager: runner.manager, queryRunner: runner, user: { sub: userId }, tenant: { id: tenantId },
    });
    const names = (row: any) => (row.applications === null ? null : row.applications.map((app: { name: string }) => app.name).sort());
    const ids = (row: any) => (row.application_ids === null ? null : [...row.application_ids].sort());
    const listed = async (req: any) => (await tasks.list({}, req)).items.find((item: any) => item.id === task);
    // A second task, on an application the contributor takes part in, whose name sorts between the two.
    const between = await insertId(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Security app')`, [tenantId]);
    await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`, [tenantId, between, bcId]);
    const second = await insertId(runner,
      `INSERT INTO tasks (tenant_id, item_number, title, status, assignee_user_id, labels, owner_ids, viewer_ids) VALUES ($1, 2, 'Second task', 'open', $2, '[]', '[]', '[]')`,
      [tenantId, bcId]);
    await runner.query(`INSERT INTO task_applications (tenant_id, task_id, application_id) VALUES ($1, $2, $3)`, [tenantId, second, between]);
    const sorted = async (req: any) => (await tasks.list({ sort: 'application_name:ASC' }, req)).items.map((item: any) => item.id);
    const byApplication = async (req: any, applicationId: string) => (await tasks.list({ applicationId }, req)).items.map((item: any) => item.id).sort();

    // A person who reads everything: both applications, as before.
    const full = reqOf(adminId, {}, true);
    assert.deepEqual(names(await tasks.getOne(task, full)), ['Secret app', 'Seen app'], 'full reader: both applications');
    assert.deepEqual(ids(await listed(full)), [seen, unseen].sort(), 'full reader: both in the list');
    // Sorted by application: the first name of every link (Secret app, then Security app).
    assert.deepEqual(await sorted(full), [task, second], 'full reader: sorted on every application');
    assert.deepEqual(await byApplication(full, unseen), [task], 'full reader: filtered on any application');
    console.log('  a person who reads everything sees every application: OK');

    // A Business Contributor: the field shows the application they take part in, nothing of the other.
    const bc = reqOf(bcId, bcRole.permissions);
    const page = await tasks.getOne(task, bc);
    assert.deepEqual(names(page), ['Seen app'], 'contributor: the application of their participation');
    assert.deepEqual(ids(page), [seen], 'contributor: its id only');
    assert.ok(!JSON.stringify(page).includes(unseen) && !JSON.stringify(page).includes('Secret'), 'contributor: nothing of the other application');
    const row = await listed(bc);
    assert.deepEqual(ids(row), [seen], 'contributor: the list reads the same way');
    assert.ok(!JSON.stringify(row).includes(unseen), 'contributor: the list names nothing of the other application');
    // The order and the filter read the applications of their participation only (Security app, then Seen app).
    assert.deepEqual(await sorted(bc), [second, task], 'contributor: sorted on the applications they read');
    assert.deepEqual(await byApplication(bc, unseen), [], 'contributor: an application outside their participation filters nothing in');
    assert.deepEqual(await byApplication(bc, seen), [task], 'contributor: their application filters as before');
    // Saving the field as shown (here emptied) keeps the link the person does not see.
    await tasks.updateTask(task, { application_ids: [] }, bc);
    const stored = (await runner.query(`SELECT application_id FROM task_applications WHERE tenant_id = $1 AND task_id = $2`, [tenantId, task]))
      .map((r: { application_id: string }) => r.application_id);
    assert.deepEqual(stored, [unseen], 'contributor: the unseen link stays');
    assert.deepEqual(ids(await tasks.getOne(task, bc)), [], 'contributor: an empty field');
    console.log('  a Business Contributor sees the applications of their participation: OK');

    // A person who does not read applications: no field, as before.
    const reader = reqOf(readerId, tasksOnly.permissions);
    const unread = await tasks.getOne(task, reader);
    assert.deepEqual([unread.applications, unread.application_ids], [null, null], 'no reader of applications: no field');
    assert.deepEqual(await byApplication(reader, unseen), [], 'no reader of applications: the filter matches nothing');
    assert.equal((await sorted(reader)).length, 2, 'no reader of applications: the sort still lists the tasks');
    console.log('  a person who does not read applications gets no field: OK');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await app.close();
  }
  console.log('task-readable-applications.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
