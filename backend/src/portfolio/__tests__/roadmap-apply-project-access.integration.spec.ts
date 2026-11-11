import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { NotFoundException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

// Applying the dates of a roadmap (`POST /portfolio/projects/planning/roadmap/apply`) follows the
// project page: a person changes the planned dates of the projects they may change by
// `PATCH /portfolio/projects/:id`, and of no other.
// - A Business Contributor in the team of a project changes its planned dates.
// - The same person on a project they do not take part in: the project reads as missing, as on
//   its page, and its dates stay.
// - A list that holds one such project changes no date at all, whatever the order.
// - A project contributor without the Business Contributor role changes every project.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'roadmap-apply-project-access-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type UserKey = 'bc' | 'contributor';
type Seed = { tenantId: string; users: Record<UserKey, string>; inTeam: string; outside: string };
type Harness = { app: any; dataSource: DataSource; roadmap: any };

const START = '2026-02-01';
const END = '2026-09-30';

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for roadmap-apply-project-access.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { PortfolioRoadmapController } = require('../portfolio-roadmap.controller');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  return { app, dataSource: app.get(DataSource), roadmap: app.get(PortfolioRoadmapController) };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `roadmap-apply-${tenantId.slice(0, 8)}`;
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const user = async (key: string, roleName: string) => {
    const roleId = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, $2, $2)`, [tenantId, roleName]);
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'portfolio_projects', 'contributor')`, [tenantId, roleId]);
    return insertId(runner,
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, $3, 'Tester', $4, 'enabled')`,
      [tenantId, `${key}-${slug}@example.test`, key, roleId]);
  };
  const users: Record<UserKey, string> = {
    // The built-in role's name sets the participation scope (`resolveBusinessContributorScopeForUser`).
    bc: await user('bc', 'Business Contributor'),
    contributor: await user('contributor', 'Project Contributor'),
  };
  const project = (number: number, name: string) => insertId(runner,
    `INSERT INTO portfolio_projects (tenant_id, item_number, name, planned_start, planned_end) VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, number, name, START, END]);
  const inTeam = await project(1, 'Team project');
  const outside = await project(2, 'Other project');
  await runner.query(`INSERT INTO portfolio_project_team (tenant_id, project_id, user_id, role) VALUES ($1, $2, $3, 'member')`, [tenantId, inTeam, users.bc]);
  return { tenantId, users, inTeam, outside };
}

function ctx(runner: QueryRunner, s: Seed, user: UserKey) {
  return {
    tenantId: s.tenantId,
    userId: s.users[user],
    isAdmin: false,
    permissions: { portfolio_projects: 'contributor' },
    manager: runner.manager,
    queryRunner: runner,
  };
}

async function dates(runner: QueryRunner, id: string): Promise<[string, string]> {
  const [row] = await runner.query(
    `SELECT planned_start::date::text AS planned_start, planned_end::date::text AS planned_end FROM portfolio_projects WHERE id = $1`,
    [id],
  );
  return [row.planned_start, row.planned_end];
}

const entry = (projectId: string, plannedStart: string, plannedEnd: string) => ({ projectId, plannedStart, plannedEnd });

async function readsAsMissing(fn: () => Promise<unknown>, label: string) {
  const error = await fn().then(() => null, (caught: unknown) => caught);
  assert.ok(error instanceof NotFoundException, `${label}: refused as a missing project`);
  assert.equal(error.getStatus(), 404, `${label}: status`);
}

async function testTeamMemberChangesTheDates(h: Harness, runner: QueryRunner, s: Seed) {
  const result = await h.roadmap.applyRoadmapDates({ projects: [entry(s.inTeam, '2027-01-04', '2027-06-30')] }, ctx(runner, s, 'bc'));
  assert.deepEqual(result, { updated: 1 });
  assert.deepEqual(await dates(runner, s.inTeam), ['2027-01-04', '2027-06-30'], 'team project: dates changed');
  // The id reads the same in upper case.
  await h.roadmap.applyRoadmapDates({ projects: [entry(s.inTeam.toUpperCase(), '2027-02-01', '2027-07-30')] }, ctx(runner, s, 'bc'));
  assert.deepEqual(await dates(runner, s.inTeam), ['2027-02-01', '2027-07-30'], 'team project, upper-case id: dates changed');
}

async function testProjectOutsideTheTeamIsRefused(h: Harness, runner: QueryRunner, s: Seed) {
  await readsAsMissing(
    () => h.roadmap.applyRoadmapDates({ projects: [entry(s.outside, '2028-01-03', '2028-06-30')] }, ctx(runner, s, 'bc')),
    'project outside the team',
  );
  assert.deepEqual(await dates(runner, s.outside), [START, END], 'project outside the team: dates kept');
}

async function testOneRefusedProjectChangesNothing(h: Harness, runner: QueryRunner, s: Seed) {
  const before = await dates(runner, s.inTeam);
  const allowed = entry(s.inTeam, '2029-01-08', '2029-06-29');
  const refused = entry(s.outside, '2029-02-05', '2029-07-31');
  for (const projects of [[allowed, refused], [refused, allowed]]) {
    await readsAsMissing(() => h.roadmap.applyRoadmapDates({ projects }, ctx(runner, s, 'bc')), 'mixed list');
    assert.deepEqual(await dates(runner, s.inTeam), before, 'mixed list: the allowed project keeps its dates');
    assert.deepEqual(await dates(runner, s.outside), [START, END], 'mixed list: the refused project keeps its dates');
  }
}

async function testProjectContributorChangesEveryProject(h: Harness, runner: QueryRunner, s: Seed) {
  const result = await h.roadmap.applyRoadmapDates(
    { projects: [entry(s.inTeam, '2030-01-07', '2030-06-28'), entry(s.outside, '2030-02-04', '2030-07-31')] },
    ctx(runner, s, 'contributor'),
  );
  assert.deepEqual(result, { updated: 2 });
  assert.deepEqual(await dates(runner, s.inTeam), ['2030-01-07', '2030-06-28']);
  assert.deepEqual(await dates(runner, s.outside), ['2030-02-04', '2030-07-31']);
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      await testTeamMemberChangesTheDates(harness, runner, s);
      await testProjectOutsideTheTeamIsRefused(harness, runner, s);
      await testOneRefusedProjectChangesNothing(harness, runner, s);
      await testProjectContributorChangesEveryProject(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('roadmap-apply-project-access.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
