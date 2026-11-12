import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { NotFoundException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';

// A phase or a milestone of a project is changed by the address of its own project:
// - `PATCH|DELETE /portfolio/projects/:id/phases/:phaseId`, `POST …/phases/:phaseId/toggle-milestone`
//   and `PATCH|DELETE …/milestones/:milestoneId` change a phase or a milestone of the project of the
//   address;
// - a phase or a milestone of another project, or of another tenant, reads as missing (404) and
//   stays as it was;
// - the routes ask for `portfolio_projects: member` (the person without it is refused by
//   PermissionGuard before the route runs).

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'project-phase-milestone-address-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Plan = { project: string; phase: string; milestone: string };
type Seed = { tenantId: string; userId: string; own: Plan; other: Plan; otherTenant: Plan };
type Harness = { app: any; dataSource: DataSource; projects: any };

const ROUTES = ['updatePhase', 'deletePhase', 'togglePhaseMilestone', 'updateMilestone', 'deleteMilestone'];

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for project-phase-milestone-address.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { PortfolioProjectsController } = require('../portfolio-projects.controller');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  return { app, dataSource: app.get(DataSource), projects: app.get(PortfolioProjectsController) };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
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

async function plan(runner: QueryRunner, tenantId: string, number: number): Promise<Plan> {
  const project = await insertId(runner, `INSERT INTO portfolio_projects (tenant_id, item_number, name) VALUES ($1, $2, $3)`, [tenantId, number, `Project ${number}`]);
  const phase = await insertId(runner,
    `INSERT INTO portfolio_project_phases (tenant_id, project_id, name, planned_end) VALUES ($1, $2, 'Build', '2027-03-31')`, [tenantId, project]);
  const milestone = await insertId(runner,
    `INSERT INTO portfolio_project_milestones (tenant_id, project_id, name, target_date) VALUES ($1, $2, 'Go live', '2027-04-30')`, [tenantId, project]);
  return { project, phase, milestone };
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const otherTenantId = await tenant(runner, 'phase-address-other');
  const otherTenant = await plan(runner, otherTenantId, 1);
  const tenantId = await tenant(runner, 'phase-address');
  const roleId = await insertId(runner, `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Project member')`, [tenantId]);
  await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'portfolio_projects', 'member')`, [tenantId, roleId]);
  const userId = await insertId(runner,
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, 'Mia', 'Member', $3, 'enabled')`,
    [tenantId, `member-${tenantId.slice(0, 8)}@example.test`, roleId]);
  return { tenantId, userId, own: await plan(runner, tenantId, 1), other: await plan(runner, tenantId, 2), otherTenant };
}

function ctx(runner: QueryRunner, s: Seed) {
  return {
    tenantId: s.tenantId,
    userId: s.userId,
    isAdmin: false,
    permissions: { portfolio_projects: 'member' },
    manager: runner.manager,
    queryRunner: runner,
  };
}

async function readsAsMissing(fn: () => Promise<unknown>, label: string) {
  const error = await fn().then(() => null, (caught: unknown) => caught);
  assert.ok(error instanceof NotFoundException, `${label}: answered as missing`);
  assert.equal(error.getStatus(), 404, `${label}: status`);
}

async function snapshot(runner: QueryRunner, p: Plan) {
  const phases = await runner.query(`SELECT id, name, status, planned_end::text FROM portfolio_project_phases WHERE project_id = $1 ORDER BY id`, [p.project]);
  const milestones = await runner.query(`SELECT id, name, status, phase_id FROM portfolio_project_milestones WHERE project_id = $1 ORDER BY id`, [p.project]);
  return { phases, milestones };
}

/** Every route, on the project of the address `project`, aimed at the phase and milestone of `target`. */
function calls(h: Harness, c: ReturnType<typeof ctx>, project: string, target: Plan): Array<[string, () => Promise<unknown>]> {
  return [
    ['PATCH phase', () => h.projects.updatePhase(project, target.phase, { name: 'Renamed', status: 'completed' }, c)],
    ['toggle milestone', () => h.projects.togglePhaseMilestone(project, target.phase, { enabled: true, milestone_name: 'Phase end' }, c)],
    ['PATCH milestone', () => h.projects.updateMilestone(project, target.milestone, { name: 'Renamed', status: 'achieved' }, c)],
    ['DELETE milestone', () => h.projects.deleteMilestone(project, target.milestone, c)],
    ['DELETE phase', () => h.projects.deletePhase(project, target.phase, c)],
  ];
}

async function testOtherProjectAndTenantReadAsMissing(h: Harness, runner: QueryRunner, s: Seed) {
  for (const [label, target] of [['another project', s.other], ['another tenant', s.otherTenant]] as const) {
    const before = await snapshot(runner, s.other);
    for (const [route, call] of calls(h, ctx(runner, s), s.own.project, target)) {
      await readsAsMissing(call, `${route} of ${label} by the address of the own project`);
    }
    assert.deepEqual(await snapshot(runner, s.other), before, `${label}: phases and milestones kept`);
  }
}

async function testOwnProjectChangesThem(h: Harness, runner: QueryRunner, s: Seed) {
  const c = ctx(runner, s);
  const phase = await h.projects.updatePhase(s.own.project, s.own.phase, { name: 'Design' }, c);
  assert.equal(phase.name, 'Design');
  const toggled = await h.projects.togglePhaseMilestone(s.own.project, s.own.phase, { enabled: true, milestone_name: 'Design done' }, c);
  assert.equal(toggled.milestone.project_id, s.own.project);
  const milestone = await h.projects.updateMilestone(s.own.project, s.own.milestone, { status: 'achieved' }, c);
  assert.equal(milestone.status, 'achieved');
  assert.deepEqual(await h.projects.deleteMilestone(s.own.project, s.own.milestone, c), { ok: true });
  assert.deepEqual(await h.projects.deletePhase(s.own.project, s.own.phase, c), { ok: true });
  const after = await snapshot(runner, s.own);
  assert.deepEqual([after.phases.length, after.milestones.length], [0, 0], 'own project: phase and its milestones deleted');
}

function testRoutesAskForMember(h: Harness) {
  const proto = Object.getPrototypeOf(h.projects);
  for (const route of ROUTES) {
    assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto[route]), { resource: 'portfolio_projects', level: 'member' }, route);
  }
}

async function run() {
  const harness = await createHarness();
  try {
    testRoutesAskForMember(harness);
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      await testOtherProjectAndTenantReadAsMissing(harness, runner, s);
      await testOwnProjectChangesThem(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('project-phase-milestone-address.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
