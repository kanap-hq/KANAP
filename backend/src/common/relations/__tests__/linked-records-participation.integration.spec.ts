import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

// A person links only the records they read, as on a document's links. A Business Contributor who
// also writes applications, assets and budget lines:
// - links to an application, an asset or a budget line (both natures) only projects they take part
//   in: another project answers 403 OUTSIDE_PARTICIPATION and nothing is written;
// - replacing an application's projects keeps the links to projects they do not see (the
//   application's Relations tab does not show them), and the answer lists only the projects they
//   take part in.
// Without a read of projects the answer is 403 LINKED_MODULE_NOT_READABLE.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'linked-records-participation-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

async function codeOf(fn: () => Promise<unknown>): Promise<string | undefined> {
  const error = await fn().then(() => null, (caught: unknown) => caught);
  assert.ok(error instanceof ForbiddenException, `403 expected (got ${String(error)})`);
  return (error.getResponse() as { code?: string }).code;
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for linked-records-participation.integration.spec.ts.');
  const { AppModule } = require('../../../app.module');
  const { ApplicationsController } = require('../../../applications/applications.controller');
  const { AssetsController } = require('../../../assets/assets.controller');
  const { SpendItemsController } = require('../../../spend/spend-items.controller');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const applications = app.get(ApplicationsController);
  const assets = app.get(AssetsController);
  const lines = app.get(SpendItemsController);
  const runner = app.get(DataSource).createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    const slug = `link-participation-${tenantId.slice(0, 8)}`;
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
      return id;
    };
    const contributor = await role('Business Contributor', { portfolio_projects: 'reader', applications: 'reader' });
    const writer = await role('Writer', { applications: 'member', infrastructure: 'member', budget: 'member' });
    const userId = await insertId(runner,
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, 'Bea', 'Contributor', $3, 'enabled')`,
      [tenantId, `bc-${tenantId.slice(0, 8)}@example.test`, contributor]);
    await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true), ($1, $2, $4, false)`,
      [tenantId, userId, contributor, writer]);
    const mine = await insertId(runner, `INSERT INTO portfolio_projects (tenant_id, item_number, name, business_lead_id) VALUES ($1, 1, 'Mine', $2)`, [tenantId, userId]);
    const mine2 = await insertId(runner, `INSERT INTO portfolio_projects (tenant_id, item_number, name, business_lead_id) VALUES ($1, 2, 'Mine too', $2)`, [tenantId, userId]);
    const theirs = await insertId(runner, `INSERT INTO portfolio_projects (tenant_id, item_number, name) VALUES ($1, 3, 'Theirs')`, [tenantId]);
    const application = await insertId(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Billing')`, [tenantId]);
    await runner.query(`INSERT INTO application_projects (tenant_id, application_id, project_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
      [tenantId, application, mine, theirs]);
    const asset = await insertId(runner, `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, 'Server', 'server', 'prod')`, [tenantId]);

    const permissions = { portfolio_projects: 'reader', applications: 'member', infrastructure: 'member', budget: 'member' };
    const ctx = { tenantId, userId, isAdmin: false, permissions, manager: runner.manager, queryRunner: runner };
    const req = { ...ctx, user: { sub: userId }, tenant: { id: tenantId } };
    const links = async () => (await runner.query(
      `SELECT project_id FROM application_projects WHERE application_id = $1 ORDER BY project_id`, [application])).map((r: any) => r.project_id);

    // A project outside the participation: refused, nothing written.
    const before = await links();
    assert.equal(await codeOf(() => applications.bulkReplaceProjects(application, { project_ids: [mine, theirs] }, ctx)), 'OUTSIDE_PARTICIPATION', 'application');
    assert.equal(await codeOf(() => assets.bulkReplaceProjects(asset, { project_ids: [theirs] }, req)), 'OUTSIDE_PARTICIPATION', 'asset');
    assert.equal(await codeOf(() => lines.bulkReplaceProjects(randomUUID(), { project_ids: [theirs] }, ctx)), 'OUTSIDE_PARTICIPATION', 'budget line');
    assert.deepEqual(await links(), before, 'nothing written');

    // A replacement by projects of the participation keeps the link the person does not see.
    const answer = await applications.bulkReplaceProjects(application, { project_ids: [mine2] }, ctx);
    assert.deepEqual(await links(), [mine2, theirs].sort(), 'unseen link kept, seen one replaced');
    assert.deepEqual(answer.items.map((item: { id: string }) => item.id), [mine2], 'the answer lists what the person reads');
    const emptied = await applications.bulkReplaceProjects(application, { project_ids: [] }, ctx);
    assert.deepEqual(await links(), [theirs], 'an empty replacement keeps the unseen link');
    assert.deepEqual(emptied.items, []);

    // Without a read of projects.
    const noRead = { ...ctx, permissions: { applications: 'member' } };
    assert.equal(await codeOf(() => applications.bulkReplaceProjects(application, { project_ids: [] }, noRead)), 'LINKED_MODULE_NOT_READABLE');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await app.close();
  }
  console.log('linked-records-participation.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
