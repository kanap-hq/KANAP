import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// The screen writes a task's, a project's or a request's address with its reference (`T-1`, `PRJ-1`):
// - a record opened by its reference answers as by its uuid, for a person who reads everything, a
//   Business Contributor and a person who does not read projects (a refusal included);
// - the project number added to a row (a task's project, the dashboard's status changes) leaves
//   with the project's name only: nothing of a project the person does not read.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'reference-addresses-rights-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

/** The answer of a call, or the status of its refusal, to compare two addresses of one record. */
async function outcome(call: () => Promise<unknown>): Promise<unknown> {
  try {
    return { ok: await call() };
  } catch (error: any) {
    return { refused: error?.status ?? error?.getStatus?.() ?? String(error) };
  }
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for reference-addresses-rights.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { TasksController } = require('../../spend/tasks.controller');
  const { PortfolioProjectsController } = require('../portfolio-projects.controller');
  const { DashboardController } = require('../../dashboard/dashboard.controller');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const tasks = app.get(TasksController);
  const projects = app.get(PortfolioProjectsController);
  const dashboard = app.get(DashboardController);
  const runner = app.get(DataSource).createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    const slug = `ref-addresses-${tenantId.slice(0, 8)}`;
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
    const bcRole = await role('Business Contributor', { tasks: 'member', portfolio_projects: 'reader' });
    const tasksOnly = await role('Task reader', { tasks: 'reader' });
    const adminId = await user('admin', adminRole.id);
    const bcId = await user('bc', bcRole.id);
    const readerId = await user('reader', tasksOnly.id);

    const seenProject = await insertId(runner, `INSERT INTO portfolio_projects (tenant_id, item_number, name, business_lead_id) VALUES ($1, 1, 'Seen project', $2)`, [tenantId, bcId]);
    const unseenProject = await insertId(runner, `INSERT INTO portfolio_projects (tenant_id, item_number, name) VALUES ($1, 2, 'Secret project')`, [tenantId]);
    const task = (itemNumber: number, projectId: string) => insertId(runner,
      `INSERT INTO tasks (tenant_id, item_number, title, status, assignee_user_id, labels, owner_ids, viewer_ids, related_object_type, related_object_id)
       VALUES ($1, $2, $3, 'open', $4, '[]', '[]', '[]', 'project', $5)`,
      [tenantId, itemNumber, `Task ${itemNumber}`, bcId, projectId]);
    const seenTask = await task(1, seenProject);
    const unseenTask = await task(2, unseenProject);
    for (const projectId of [seenProject, unseenProject]) {
      await runner.query(
        `INSERT INTO portfolio_activities (tenant_id, project_id, author_id, type, changed_fields)
         VALUES ($1, $2, $3, 'change', '{"status":["planned","in_progress"]}'::jsonb)`,
        [tenantId, projectId, adminId]);
    }

    const reqOf = (userId: string, permissions: Record<string, string>, isAdmin = false) => ({
      tenantId, userId, userRoles: [], isAdmin, permissions, manager: runner.manager, queryRunner: runner, user: { sub: userId }, tenant: { id: tenantId },
    });
    const full = reqOf(adminId, {}, true);
    const bc = reqOf(bcId, bcRole.permissions);
    const reader = reqOf(readerId, tasksOnly.permissions);
    const taskBoth = async (req: any, ref: string, id: string) => {
      const byRef = await outcome(() => tasks.getOne(ref, req));
      assert.deepEqual(byRef, await outcome(() => tasks.getOne(id, req)), `${ref}: the same answer by its reference and by its uuid`);
      return (byRef as { ok: any }).ok;
    };

    // A person who reads everything: the task names its project's number.
    assert.equal((await taskBoth(full, 'T-1', seenTask)).project_item_number, 1, 'full reader: the project number');
    assert.equal((await taskBoth(full, 'T-2', unseenTask)).project_item_number, 2, 'full reader: the other project number');
    console.log('  a person who reads everything opens a task by its reference and reads its project number: OK');

    // A Business Contributor: the number of the project they take part in, nothing of the other.
    assert.equal((await taskBoth(bc, 'T-1', seenTask)).project_item_number, 1, 'contributor: their project number');
    const outside = await taskBoth(bc, 'T-2', unseenTask);
    assert.equal(outside.project_item_number, null, 'contributor: no number of a project outside their participation');
    assert.equal(outside.related_object_name, null, 'contributor: no name of it either');
    console.log('  a Business Contributor reads the number of their projects only: OK');

    // A person who does not read projects: no number.
    const unread = await taskBoth(reader, 'T-1', seenTask);
    assert.equal(unread.project_item_number, null, 'no reader of projects: no project number');
    console.log('  a person who does not read projects gets no project number: OK');

    // The project page answers the same by its reference and by its uuid, a refusal included.
    const projectBoth = async (req: any, ref: string, id: string) => {
      const byRef = await outcome(() => projects.get(ref, {}, req));
      assert.deepEqual(byRef, await outcome(() => projects.get(id, {}, req)), `${ref}: the same answer by its reference and by its uuid`);
      return byRef as { ok?: any; refused?: unknown };
    };
    assert.equal((await projectBoth(full, 'PRJ-2', unseenProject)).ok?.item_number, 2, 'full reader: the project by its reference');
    assert.equal((await projectBoth(bc, 'PRJ-1', seenProject)).ok?.item_number, 1, 'contributor: their project by its reference');
    assert.ok((await projectBoth(bc, 'PRJ-2', unseenProject)).refused, 'contributor: a project outside their participation is refused both ways');
    // A person without the projects right is refused by the route's level, whatever the address.
    console.log('  a project opens by its reference as by its uuid, refusals included: OK');

    // The dashboard's status changes: the number with the project's row, inside the person's scope.
    const changes = async (req: any) => (await dashboard.getProjectStatusChanges('5', '5', req))
      .map((row: { projectId: string; projectItemNumber: number }) => [row.projectId, row.projectItemNumber])
      .sort((a: [string, number], b: [string, number]) => a[1] - b[1]);
    assert.deepEqual(await changes(full), [[seenProject, 1], [unseenProject, 2]], 'full reader: both rows with their numbers');
    assert.deepEqual(await changes(bc), [[seenProject, 1]], 'contributor: the row of their project only');
    console.log('  the dashboard names the numbers of the projects the person reads: OK');

    // The other rows that link to a project or a task carry its number with its name.
    await runner.query(
      `UPDATE portfolio_projects SET status = 'in_progress', estimated_effort_business = 10,
         planned_start = CURRENT_DATE - 10, planned_end = CURRENT_DATE + 60 WHERE id = $1`,
      [seenProject]);
    await runner.query(`INSERT INTO task_time_entries (tenant_id, task_id, hours, logged_at) VALUES ($1, $2, 2, now())`, [tenantId, seenTask]);
    const { TaskTimeEntriesService } = require('../../tasks/task-time-entries.service');
    const { PortfolioCapacityReportService } = require('../services/portfolio-capacity-report.service');
    const { PortfolioRoadmapService } = require('../services/portfolio-roadmap.service');
    const timeEntries = await app.get(TaskTimeEntriesService).listForProject(seenProject, { manager: runner.manager });
    assert.deepEqual(timeEntries.map((row: any) => row.task_item_number), [1], 'project time: the task number of each entry');
    assert.deepEqual((await dashboard.getMyLeadershipProjects('5', bc)).map((row: any) => row.item_number), [1], 'projects I lead: their numbers');
    const timeline = await projects.getTimelineData(undefined, undefined, undefined, bc);
    assert.deepEqual(timeline.projects.map((row: any) => row.item_number), [1], 'planning: the numbers of the projects the person reads');
    const breakdown = await app.get(PortfolioCapacityReportService)
      .getContributorBreakdown(tenantId, bcId, ['in_progress'], { manager: runner.manager });
    assert.deepEqual(breakdown.projects.map((row: any) => row.projectItemNumber), [1], 'capacity: the numbers of the contributor projects');
    const roadmap = await app.get(PortfolioRoadmapService)
      .generateRoadmap(tenantId, { startDate: '2026-12-07', statuses: ['in_progress'] }, { manager: runner.manager }, { skipSensitivity: true });
    const named = [...roadmap.schedule, ...roadmap.reservations, ...roadmap.unschedulable].map((row: any) => row.projectId);
    assert.ok(named.includes(seenProject), 'roadmap: the project is named');
    assert.deepEqual(roadmap.projectItemNumbers, { [seenProject]: 1 }, 'roadmap: the numbers of the projects it names, no other');
    console.log('  time entries, planning, capacity and roadmap rows carry the numbers: OK');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await app.close();
  }
  console.log('reference-addresses-rights.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
