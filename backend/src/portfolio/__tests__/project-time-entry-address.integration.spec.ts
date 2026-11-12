import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { NotFoundException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

// A time entry is changed by the address of its own project or task:
// - `PATCH|DELETE /portfolio/projects/:id/time-entries/:entryId` change an entry of the project of
//   the address; an entry of another project, or of another tenant, reads as missing (404) and
//   stays as it was;
// - `PATCH|DELETE /portfolio/projects/:projectId/tasks/:taskId/time-entries/:entryId` change an
//   entry of the task of the address; an entry of another task reads as missing (404).

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'project-time-entry-address-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Project = { project: string; entry: string; task: string; taskEntry: string };

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

async function tenant(runner: QueryRunner, prefix: string): Promise<string> {
  const tenantId = randomUUID();
  const slug = `${prefix}-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  return tenantId;
}

async function project(runner: QueryRunner, tenantId: string, number: number, userId: string | null): Promise<Project> {
  const id = await insertId(runner, `INSERT INTO portfolio_projects (tenant_id, item_number, name) VALUES ($1, $2, $3)`, [tenantId, number, `Project ${number}`]);
  const entry = await insertId(runner,
    `INSERT INTO portfolio_project_time_entries (tenant_id, project_id, category, user_id, logged_by_id, hours, logged_at)
     VALUES ($1, $2, 'it', $3, $3, 4, now() - interval '1 day')`, [tenantId, id, userId]);
  const task = await insertId(runner,
    `INSERT INTO tasks (tenant_id, item_number, title, related_object_type, related_object_id) VALUES ($1, $2, 'Task', 'project', $3)`,
    [tenantId, number, id]);
  const taskEntry = await insertId(runner,
    `INSERT INTO task_time_entries (tenant_id, task_id, user_id, logged_by_id, hours, logged_at)
     VALUES ($1, $2, $3, $3, 2, now() - interval '1 day')`, [tenantId, task, userId]);
  return { project: id, entry, task, taskEntry };
}

async function readsAsMissing(fn: () => Promise<unknown>, label: string) {
  const error = await fn().then(() => null, (caught: unknown) => caught);
  assert.ok(error instanceof NotFoundException, `${label}: answered as missing (got ${String(error)})`);
}

async function entries(runner: QueryRunner, p: Project) {
  return {
    project: await runner.query(`SELECT id, hours, notes FROM portfolio_project_time_entries WHERE id = $1`, [p.entry]),
    task: await runner.query(`SELECT id, hours, notes FROM task_time_entries WHERE id = $1`, [p.taskEntry]),
  };
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for project-time-entry-address.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { PortfolioProjectsController } = require('../portfolio-projects.controller');
  const { PortfolioProjectTasksController } = require('../portfolio-project-tasks.controller');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const projects = app.get(PortfolioProjectsController);
  const tasks = app.get(PortfolioProjectTasksController);
  const runner = app.get(DataSource).createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const otherTenantId = await tenant(runner, 'time-address-other');
    const otherTenant = await project(runner, otherTenantId, 1, null);
    const tenantId = await tenant(runner, 'time-address');
    const roleId = await insertId(runner, `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Project member')`, [tenantId]);
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'portfolio_projects', 'member')`, [tenantId, roleId]);
    const userId = await insertId(runner,
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, 'Mia', 'Member', $3, 'enabled')`,
      [tenantId, `member-${tenantId.slice(0, 8)}@example.test`, roleId]);
    const own = await project(runner, tenantId, 1, userId);
    const other = await project(runner, tenantId, 2, userId);
    const ctx = { tenantId, userId, isAdmin: false, permissions: { portfolio_projects: 'member' }, manager: runner.manager, queryRunner: runner };
    const req = { queryRunner: runner, user: { sub: userId }, tenant: { id: tenantId }, isAdmin: false, permissions: { portfolio_projects: 'member' } };

    for (const [label, target] of [['another project', other], ['another tenant', otherTenant]] as const) {
      const before = await entries(runner, target);
      await readsAsMissing(() => projects.updateTimeEntry(own.project, target.entry, { notes: 'Moved' }, req, ctx), `PATCH entry of ${label}`);
      await readsAsMissing(() => projects.deleteTimeEntry(own.project, target.entry, req, ctx), `DELETE entry of ${label}`);
      if (target === other) {
        await readsAsMissing(() => tasks.updateTimeEntry(own.project, own.task, target.taskEntry, { notes: 'Moved' }, req), `PATCH task entry of ${label}`);
        await readsAsMissing(() => tasks.deleteTimeEntry(own.project, own.task, target.taskEntry, req), `DELETE task entry of ${label}`);
      }
      assert.deepEqual(await entries(runner, target), before, `${label}: entries kept`);
    }

    // The own project and task change their entries.
    const updated = await projects.updateTimeEntry(own.project, own.entry, { notes: 'Checked' }, req, ctx);
    assert.equal(updated.notes, 'Checked');
    await tasks.updateTimeEntry(own.project, own.task, own.taskEntry, { notes: 'Checked' }, req);
    await tasks.deleteTimeEntry(own.project, own.task, own.taskEntry, req);
    assert.deepEqual(await projects.deleteTimeEntry(own.project, own.entry, req, ctx), { ok: true });
    const after = await entries(runner, own);
    assert.deepEqual([after.project.length, after.task.length], [0, 0], 'own entries deleted');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await app.close();
  }
  console.log('project-time-entry-address.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
