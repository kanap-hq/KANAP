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
// - replacing an asset's or a budget line's projects, a budget line's, a project's or a request's
//   applications keeps the links to the records they do not see; a line links only applications
//   they take part in (403 OUTSIDE_PARTICIPATION), a project or a request answers 400 as for a
//   missing one;
// - a document: unlinking a record outside the participation is 403 OUTSIDE_PARTICIPATION, a save
//   whose body carries links follows the rule of the link routes (participation, module read), and
//   keeps the links the person does not see.
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
  const { PortfolioProjectsController } = require('../../../portfolio/portfolio-projects.controller');
  const { PortfolioRequestsController } = require('../../../portfolio/portfolio-requests.controller');
  const { KnowledgeService } = require('../../../knowledge/knowledge.service');
  const { KnowledgeRelationsService } = require('../../../knowledge/knowledge-relations.service');
  const projects = app.get(PortfolioProjectsController);
  const requests = app.get(PortfolioRequestsController);
  const knowledge = app.get(KnowledgeService);
  const documentRelations = app.get(KnowledgeRelationsService);
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
    const contributor = await role('Business Contributor', { portfolio_projects: 'contributor', portfolio_requests: 'member', applications: 'reader' });
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

    const permissions = { portfolio_projects: 'contributor', portfolio_requests: 'member', applications: 'member', infrastructure: 'member', budget: 'member', knowledge: 'admin' };
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

    // A second Business Contributor, who reads the applications of their participation only.
    const otherWriter = await role('Line and asset writer', { infrastructure: 'member', budget: 'member', knowledge: 'admin' });
    const bcId = await insertId(runner,
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, 'Bob', 'Contributor', $3, 'enabled')`,
      [tenantId, `bc2-${tenantId.slice(0, 8)}@example.test`, contributor]);
    await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true), ($1, $2, $4, false)`,
      [tenantId, bcId, contributor, otherWriter]);
    await runner.query(`UPDATE portfolio_projects SET business_lead_id = $3 WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, [mine, mine2], bcId]);
    const bcCtx = { ...ctx, userId: bcId };
    const bcReq = { ...bcCtx, user: { sub: bcId }, tenant: { id: tenantId } };
    // The records of the other families: an application of the participation, two others not.
    const ownedApp = async (name: string) => {
      const id = await insertId(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, $2)`, [tenantId, name]);
      await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`, [tenantId, id, bcId]);
      return id;
    };
    const seenApp = await ownedApp('Seen');
    const seenApp2 = await ownedApp('Seen too');
    const unseenApp = application;
    const sorted = (ids: string[]) => [...ids].sort();
    const ids = async (sql: string, id: string) => sorted((await runner.query(sql, [tenantId, id])).map((row: { id: string }) => row.id));

    // An asset's projects: the unseen link stays.
    await runner.query(`INSERT INTO asset_projects (tenant_id, asset_id, project_id) VALUES ($1, $2, $3), ($1, $2, $4)`, [tenantId, asset, mine, theirs]);
    await assets.bulkReplaceProjects(asset, { project_ids: [mine2] }, bcReq);
    assert.deepEqual(await ids(`SELECT project_id AS id FROM asset_projects WHERE tenant_id = $1 AND asset_id = $2`, asset), sorted([mine2, theirs]), 'asset projects: unseen link kept');

    // A budget line's projects and applications.
    const line = await insertId(runner,
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number) VALUES ($1, 'Licences', 'EUR', '2026-01-01', 1)`, [tenantId]);
    await runner.query(`INSERT INTO portfolio_project_opex (tenant_id, project_id, opex_id) VALUES ($1, $2, $4), ($1, $3, $4)`, [tenantId, mine, theirs, line]);
    await runner.query(`INSERT INTO application_spend_items (tenant_id, application_id, spend_item_id) VALUES ($1, $2, $4), ($1, $3, $4)`, [tenantId, seenApp, unseenApp, line]);
    await lines.bulkReplaceProjects(line, { project_ids: [] }, bcCtx);
    assert.deepEqual(await ids(`SELECT project_id AS id FROM portfolio_project_opex WHERE tenant_id = $1 AND opex_id = $2`, line), [theirs], 'line projects: unseen link kept');
    const lineApps = () => ids(`SELECT application_id AS id FROM application_spend_items WHERE tenant_id = $1 AND spend_item_id = $2`, line);
    assert.equal(await codeOf(() => lines.bulkReplaceApplications(line, { application_ids: [seenApp, unseenApp] }, bcCtx)), 'OUTSIDE_PARTICIPATION', 'line applications');
    await lines.bulkReplaceApplications(line, { application_ids: [seenApp2] }, bcCtx);
    assert.deepEqual(await lineApps(), sorted([seenApp2, unseenApp]), 'line applications: unseen link kept');

    // A project's and a request's applications: 400 for an unseen one, as a missing one; the unseen link stays.
    await runner.query(`INSERT INTO application_projects (tenant_id, application_id, project_id) VALUES ($1, $2, $4), ($1, $3, $4)`, [tenantId, seenApp, unseenApp, mine2]);
    const projectApps = () => ids(`SELECT application_id AS id FROM application_projects WHERE tenant_id = $1 AND project_id = $2`, mine2);
    const badRequest = async (fn: () => Promise<unknown>) => {
      const error = await fn().then(() => null, (caught: any) => caught);
      assert.equal(error?.getStatus?.(), 400, `400 expected (got ${String(error)})`);
    };
    await badRequest(() => projects.bulkReplaceLinkedApplications(mine2, { application_ids: [seenApp, unseenApp] }, bcCtx));
    const projectAnswer = await projects.bulkReplaceLinkedApplications(mine2, { application_ids: [seenApp2] }, bcCtx);
    assert.deepEqual(await projectApps(), sorted([seenApp2, unseenApp]), 'project applications: unseen link kept');
    assert.deepEqual(projectAnswer.items.map((item: { id: string }) => item.id), [seenApp2], 'project: the answer lists what the person reads');
    const request = await insertId(runner, `INSERT INTO portfolio_requests (tenant_id, item_number, name, requestor_id) VALUES ($1, 1, 'Request', $2)`, [tenantId, bcId]);
    await runner.query(`INSERT INTO portfolio_request_applications (tenant_id, request_id, application_id) VALUES ($1, $2, $3), ($1, $2, $4)`, [tenantId, request, seenApp, unseenApp]);
    const requestApps = () => ids(`SELECT application_id AS id FROM portfolio_request_applications WHERE tenant_id = $1 AND request_id = $2`, request);
    await badRequest(() => requests.bulkReplaceApplications(request, { application_ids: [unseenApp] }, bcReq));
    await requests.bulkReplaceApplications(request, { application_ids: [] }, bcReq);
    assert.deepEqual(await requestApps(), [unseenApp], 'request applications: unseen link kept');
    console.log('  asset, budget line, project and request links: unseen links kept, unseen records refused: OK');

    // A document linked to an application of the participation and to one outside it.
    const library = await insertId(runner,
      `INSERT INTO document_libraries (tenant_id, name, slug, is_system, display_order) VALUES ($1, 'Links', 'links', false, 0)`, [tenantId]);
    const documentId = await insertId(runner,
      `INSERT INTO documents (tenant_id, item_number, title, content_markdown, content_plain, library_id, status, revision, current_version_number, created_by, updated_by)
       VALUES ($1, 1, 'Runbook', '', '', $2, 'draft', 1, 0, $3, $3)`, [tenantId, library, bcId]);
    await runner.query(`INSERT INTO document_contributors (document_id, user_id, role, is_primary) VALUES ($1, $2, 'owner', true)`, [documentId, bcId]);
    await runner.query(`INSERT INTO document_applications (tenant_id, document_id, application_id) VALUES ($1, $2, $3), ($1, $2, $4)`, [tenantId, documentId, seenApp, unseenApp]);
    const documentApps = () => ids(`SELECT application_id AS id FROM document_applications WHERE tenant_id = $1 AND document_id = $2`, documentId);
    const opts = { manager: runner.manager, userId: bcId };
    assert.equal(await codeOf(() => documentRelations.removeRelation(documentId, 'applications', unseenApp, opts)), 'OUTSIDE_PARTICIPATION', 'document: unlink an unseen record');
    assert.deepEqual(await documentApps(), sorted([seenApp, unseenApp]), 'document: nothing removed');
    await documentRelations.removeRelation(documentId, 'applications', seenApp, opts);
    assert.deepEqual(await documentApps(), [unseenApp], 'document: a seen link removed');
    // A save whose body carries links.
    const token = (await knowledge.acquireLock(documentId, bcId, { manager: runner.manager })).lock_token;
    const revision = async () => Number((await runner.query(`SELECT revision FROM documents WHERE id = $1`, [documentId]))[0].revision);
    const save = async (relations: Record<string, string[]>) =>
      knowledge.update(documentId, { relations, revision: await revision(), save_mode: 'manual' }, bcId, token, { manager: runner.manager });
    const notLinked = await insertId(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Unseen too')`, [tenantId]);
    assert.equal(await codeOf(() => save({ applications: [seenApp, notLinked] })), 'OUTSIDE_PARTICIPATION', 'document save: an unseen record added');
    assert.equal(await codeOf(() => save({ incidents: [] })), 'LINKED_MODULE_NOT_READABLE', 'document save: a family the person does not read');
    assert.deepEqual(await documentApps(), [unseenApp], 'document save: nothing written');
    await save({ applications: [seenApp2] });
    assert.deepEqual(await documentApps(), sorted([seenApp2, unseenApp]), 'document save: unseen link kept');
    console.log('  document links: unlink and save follow the participation: OK');
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
