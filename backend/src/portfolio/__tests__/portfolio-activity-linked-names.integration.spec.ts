import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// The activities of a project or a request name the applications and assets whose links changed.
// They show those names only to a person who reads every record of the family:
// - a person who reads everything sees the names, as before;
// - a Business Contributor, who reads the applications of their participation only, gets each
//   side of an application change as a number (`{ labels: null, hidden }`), whether the change
//   came from a replacement of the list or from the Relations tab, one link at a time;
// - a person who does not read applications (or assets) gets the numbers too.
// The fact that a link changed stays; no name or reference of an unread record leaves the server.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'portfolio-activity-linked-names-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

function sortedChanges(changes: unknown[][]): unknown[][] {
  return [...changes].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

type Activity = { author_id: string; changed_fields: Record<string, unknown> | null };

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for portfolio-activity-linked-names.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { PortfolioProjectsController } = require('../portfolio-projects.controller');
  const { PortfolioRequestsController } = require('../portfolio-requests.controller');
  const { PortfolioRequestsService } = require('../portfolio-requests.service');
  const { PortfolioProjectsService } = require('../services/portfolio-projects.service');
  const { PortfolioRelationsService } = require('../portfolio-relations.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const projects = app.get(PortfolioProjectsController);
  const requests = app.get(PortfolioRequestsController);
  const requestsSvc = app.get(PortfolioRequestsService);
  const projectsSvc = app.get(PortfolioProjectsService);
  const relations = app.get(PortfolioRelationsService);
  const runner = app.get(DataSource).createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    const slug = `activity-names-${tenantId.slice(0, 8)}`;
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
    const user = async (name: string, roleId: string) => insertId(runner,
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, $3, 'Reader', $4, 'enabled')`,
      [tenantId, `${name}-${tenantId.slice(0, 8)}@example.test`, name, roleId]);

    const bcRole = await role('Business Contributor', {
      portfolio_projects: 'contributor', portfolio_requests: 'member', applications: 'reader', infrastructure: 'reader',
    });
    const portfolioOnly = await role('Portfolio reader', { portfolio_projects: 'reader', portfolio_requests: 'reader' });
    const adminRole = await role('Administrator', {});
    const adminId = await user('admin', adminRole.id);
    const bcId = await user('bc', bcRole.id);
    const readerId = await user('reader', portfolioOnly.id);
    await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true), ($1, $4, $5, true)`,
      [tenantId, bcId, bcRole.id, readerId, portfolioOnly.id]);

    const project = await insertId(runner, `INSERT INTO portfolio_projects (tenant_id, item_number, name, business_lead_id) VALUES ($1, 1, 'Mine', $2)`, [tenantId, bcId]);
    const request = await insertId(runner, `INSERT INTO portfolio_requests (tenant_id, item_number, name, requestor_id) VALUES ($1, 1, 'Request', $2)`, [tenantId, bcId]);
    const seen = await insertId(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Seen app')`, [tenantId]);
    await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`, [tenantId, seen, bcId]);
    const unseen = await insertId(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Secret app')`, [tenantId]);
    const asset = await insertId(runner, `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, 'Secret server', 'server', 'prod')`, [tenantId]);

    // Written by a person who reads everything: a replacement of the lists, then one link at a time.
    const write = { manager: runner.manager, userId: adminId };
    await requestsSvc.bulkReplaceApplications(request, [seen, unseen], write);
    await requestsSvc.bulkReplaceAssets(request, [asset], write);
    await projectsSvc.bulkReplaceLinkedApplications(project, [seen, unseen], write);
    const all = { budget_lines: true, applications: true, assets: true, technologies: true, source_requests: true, processes: true, resulting_projects: true };
    const tab = { manager: runner.manager, tenantId, userId: adminId, access: all, writes: { processes: true } };
    await relations.setRequestLink('applications', unseen, false, tab, async () => ({ id: request, tenantId }));
    await relations.setProjectLink('applications', unseen, false, tab, async () => ({ id: project, tenantId }));

    const ctxOf = (userId: string, permissions: Record<string, string>, isAdmin = false) => ({
      tenantId, userId, isAdmin, permissions, manager: runner.manager, queryRunner: runner, user: { sub: userId }, tenant: { id: tenantId },
    });
    const full = ctxOf(adminId, {}, true);
    const bc = ctxOf(bcId, bcRole.permissions);
    const reader = ctxOf(readerId, portfolioOnly.permissions);
    const activities = async (ctx: any, kind: 'project' | 'request'): Promise<Activity[]> => (kind === 'project'
      ? await projects.get(project, { include: 'activities' }, ctx)
      : await requests.get(request, { include: 'activities' }, ctx)).activities;
    const changes = (rows: Activity[], field: string) => rows
      .map((row) => row.changed_fields?.[field])
      .filter((change): change is unknown[] => Array.isArray(change))
      // One transaction: every row has the same time. Compared in a fixed order.
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

    // A person who reads everything: the names, as before.
    const fullRequest = await activities(full, 'request');
    assert.deepEqual(changes(fullRequest, 'applications'), sortedChanges([[[], ['Secret app', 'Seen app']], [['Secret app', 'Seen app'], ['Seen app']]]), 'full reader: request application names');
    assert.deepEqual(changes(fullRequest, 'assets'), [[[], ['Secret server']]], 'full reader: request asset names');
    assert.deepEqual(changes(await activities(full, 'project'), 'applications'), sortedChanges([[[], ['Secret app', 'Seen app']], [['Secret app', 'Seen app'], ['Seen app']]]), 'full reader: project application names');
    console.log('  a person who reads everything sees the names: OK');

    // A Business Contributor: the numbers of applications, the asset names (no participation on assets).
    for (const kind of ['request', 'project'] as const) {
      const rows = await activities(bc, kind);
      assert.ok(!JSON.stringify(rows).includes('Secret app'), `contributor: no unseen application name (${kind})`);
      assert.deepEqual(changes(rows, 'applications'), sortedChanges([
        [{ labels: null, hidden: 0 }, { labels: null, hidden: 2 }],
        [{ labels: null, hidden: 2 }, { labels: null, hidden: 1 }],
      ]), `contributor: the numbers (${kind})`);
    }
    assert.deepEqual(changes(await activities(bc, 'request'), 'assets'), [[[], ['Secret server']]], 'contributor: asset names, they read assets');
    console.log('  a Business Contributor gets the numbers of applications changed: OK');

    // A person who reads neither applications nor assets: the numbers of both.
    const readerRequest = await activities(reader, 'request');
    assert.ok(!/Secret|Seen app/.test(JSON.stringify(readerRequest)), 'no reader of applications or assets: no name');
    assert.deepEqual(changes(readerRequest, 'assets'), [[{ labels: null, hidden: 0 }, { labels: null, hidden: 1 }]], 'no reader of assets: the number');
    assert.equal(changes(readerRequest, 'applications').length, 2, 'no reader of applications: the changes stay');
    console.log('  a person who reads neither family gets the numbers: OK');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await app.close();
  }
  console.log('portfolio-activity-linked-names.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
