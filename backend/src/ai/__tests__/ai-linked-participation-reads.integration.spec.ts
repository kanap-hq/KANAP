import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// The assistant's read of a budget line names its linked applications and projects, and the read of
// an asset its linked projects, as the records' Relations tabs: a Business Contributor's are those of
// their participation, a person who reads every record sees them all, a person who does not read
// the module gets null (unchanged).

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-linked-participation-reads-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-linked-participation-reads.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiQueryExecutor } = require('../query/ai-query.executor');
  const { AiPolicyService } = require('../ai-policy.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  // The surface checks (tenant AI settings, provider, subscription) are not what this spec tests.
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  const executor = app.get(AiQueryExecutor);
  const runner = app.get(DataSource).createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    const slug = `ai-linked-scope-${tenantId.slice(0, 8)}`;
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
    const bcRole = await role('Business Contributor', { budget: 'reader', infrastructure: 'reader', applications: 'reader', portfolio_projects: 'reader' });
    const budgetOnly = await role('Budget reader', { budget: 'reader', infrastructure: 'reader' });
    const adminId = await user('admin', adminRole.id);
    const bcId = await user('bc', bcRole.id);
    const readerId = await user('reader', budgetOnly.id);

    const seenApp = await insertId(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Seen app')`, [tenantId]);
    await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`, [tenantId, seenApp, bcId]);
    const unseenApp = await insertId(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Secret app')`, [tenantId]);
    const seenProject = await insertId(runner, `INSERT INTO portfolio_projects (tenant_id, item_number, name, business_lead_id) VALUES ($1, 1, 'Seen project', $2)`, [tenantId, bcId]);
    const unseenProject = await insertId(runner, `INSERT INTO portfolio_projects (tenant_id, item_number, name) VALUES ($1, 2, 'Secret project')`, [tenantId]);
    const line = await insertId(runner,
      `INSERT INTO spend_items (tenant_id, nature, product_name, currency, effective_start, item_number) VALUES ($1, 'opex', 'Licences', 'EUR', '2026-01-01', 1)`, [tenantId]);
    await runner.query(`INSERT INTO application_spend_items (tenant_id, application_id, spend_item_id) VALUES ($1, $2, $4), ($1, $3, $4)`, [tenantId, seenApp, unseenApp, line]);
    await runner.query(`INSERT INTO portfolio_project_opex (tenant_id, project_id, opex_id) VALUES ($1, $2, $4), ($1, $3, $4)`, [tenantId, seenProject, unseenProject, line]);
    const asset = await insertId(runner, `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, 'Server', 'server', 'prod')`, [tenantId]);
    await runner.query(`INSERT INTO asset_projects (tenant_id, asset_id, project_id) VALUES ($1, $2, $3), ($1, $2, $4)`, [tenantId, asset, seenProject, unseenProject]);

    const ctx = (userId: string) => ({
      tenantId, userId, isPlatformHost: false, surface: 'mcp' as const, authMethod: 'api_key' as const, manager: runner.manager,
    });
    const names = (list: any) => (list === null ? null : (list.items ?? list).map((item: { name: string }) => item.name).sort());
    const lineOf = async (userId: string) => (await executor.executeDetail(ctx(userId), { entity_type: 'budget_lines', entity_id: line })).data;
    const assetOf = async (userId: string) => (await executor.executeDetail(ctx(userId), { entity_type: 'assets', entity_id: asset })).data;

    const full = await lineOf(adminId);
    assert.deepEqual(names(full.linked_applications), ['Secret app', 'Seen app'], 'full reader: line applications');
    assert.deepEqual(names(full.projects), ['Secret project', 'Seen project'], 'full reader: line projects');
    assert.deepEqual(names((await assetOf(adminId)).projects), ['Secret project', 'Seen project'], 'full reader: asset projects');
    console.log('  a person who reads everything sees every linked record: OK');

    const bcLine = await lineOf(bcId);
    assert.deepEqual(names(bcLine.linked_applications), ['Seen app'], 'contributor: line applications of their participation');
    assert.deepEqual(names(bcLine.projects), ['Seen project'], 'contributor: line projects of their participation');
    const bcAsset = await assetOf(bcId);
    assert.deepEqual(names(bcAsset.projects), ['Seen project'], 'contributor: asset projects of their participation');
    // The linked lists only: the line's own `project_name` column is the budget read engine's.
    assert.ok(!/Secret/.test(JSON.stringify([bcLine.linked_applications, bcLine.projects, bcAsset.projects])), 'contributor: no unseen name');
    assert.ok(!/Secret/.test(JSON.stringify(bcAsset)), 'contributor: nothing unseen on the asset');
    console.log('  a Business Contributor sees the linked records of their participation: OK');

    const readerLine = await lineOf(readerId);
    assert.deepEqual([readerLine.linked_applications, readerLine.projects], [null, null], 'no reader of the modules: null');
    console.log('  a person who does not read the modules gets null: OK');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await app.close();
  }
  console.log('ai-linked-participation-reads.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
