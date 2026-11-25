import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Kad's reads of a portfolio record's classification (lot I7a of 26.12.1):
//
// - The detail of a request, a project and a task names its source, category and stream, as the list
//   does (the record's read left them as ids, so Kad saw none).

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-portfolio-classification-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; executor: any; support: any };
type Seed = { tenantId: string; reader: string; requestsOnly: string; ids: Record<string, string> };

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-portfolio-classification-reads.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiQueryExecutor } = require('../query/ai-query.executor');
  const { AiBusinessRecordMutationSupportService } = require('../mutation/ai-business-record-mutation-support.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  return { app, dataSource: app.get(DataSource), executor: app.get(AiQueryExecutor), support: app.get(AiBusinessRecordMutationSupportService) };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ai-classif-${tag}`, `AI classification ${tag}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const role = async (name: string, resources: string[]) => {
    const id = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, $2, $2)`, [tenantId, name]);
    for (const resource of resources) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, 'reader')`, [tenantId, id, resource]);
    }
    return id;
  };
  const user = async (key: string, roleId: string) => insertId(runner,
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, $3, 'Tester', $4, 'enabled')`,
    [tenantId, `${key}-${tag}@example.test`, key, roleId]);
  const reader = await user('Reader', await role('Portfolio Reader', ['portfolio_requests', 'portfolio_projects', 'tasks']));
  // Reads the requests and nothing of the portfolio settings: the record's picker still lists the streams.
  const requestsOnly = await user('Requests', await role('Requests Reader', ['portfolio_requests']));

  const ids: Record<string, string> = {};
  ids.intake = await insertId(runner, `INSERT INTO portfolio_sources (tenant_id, name) VALUES ($1, 'Intake')`, [tenantId]);
  ids.unusedSource = await insertId(runner, `INSERT INTO portfolio_sources (tenant_id, name) VALUES ($1, 'Partner')`, [tenantId]);
  ids.infra = await insertId(runner, `INSERT INTO portfolio_categories (tenant_id, name) VALUES ($1, 'Infrastructure')`, [tenantId]);
  ids.apps = await insertId(runner, `INSERT INTO portfolio_categories (tenant_id, name) VALUES ($1, 'Business applications')`, [tenantId]);
  const stream = (category: string, name: string, active = true) => insertId(runner,
    `INSERT INTO portfolio_streams (tenant_id, category_id, name, is_active) VALUES ($1, $2, $3, $4)`, [tenantId, category, name, active]);
  ids.customer = await stream(ids.apps, 'Customer experience');
  ids.opsInfra = await stream(ids.infra, 'R12 Ops');
  ids.opsApps = await stream(ids.apps, 'R12 Ops');
  ids.retired = await stream(ids.infra, 'Retired stream', false);
  for (let i = 1; i <= 11; i += 1) await stream(ids.infra, `Infra ${String(i).padStart(2, '0')}`);

  ids.request = await insertId(runner,
    `INSERT INTO portfolio_requests (tenant_id, item_number, name, status, source_id, category_id, stream_id)
     VALUES ($1, 4, 'Request four', 'pending_review', $2, $3, $4)`, [tenantId, ids.intake, ids.apps, ids.customer]);
  ids.project = await insertId(runner,
    `INSERT INTO portfolio_projects (tenant_id, item_number, name, status, origin, execution_progress, source_id, category_id, stream_id)
     VALUES ($1, 1, 'Project one', 'in_progress', 'fast_track', 0, $2, $3, $4)`, [tenantId, ids.intake, ids.apps, ids.customer]);
  ids.task = await insertId(runner,
    `INSERT INTO tasks (tenant_id, item_number, title, status, source_id, category_id, stream_id)
     VALUES ($1, 1, 'Task one', 'open', $2, $3, $4)`, [tenantId, ids.intake, ids.apps, ids.customer]);
  return { tenantId, reader, requestsOnly, ids };
}

function context(runner: QueryRunner, seed: Seed, userId = seed.reader) {
  return { tenantId: seed.tenantId, userId, isPlatformHost: false, surface: 'mcp' as const, authMethod: 'api_key' as const, manager: runner.manager };
}

async function testDetails(harness: Harness, runner: QueryRunner, s: Seed) {
  const ctx = context(runner, s);
  for (const [entity_type, entity_id] of [['requests', 'REQ-4'], ['projects', 'PRJ-1'], ['tasks', 'T-1']]) {
    const detail = await harness.executor.executeDetail(ctx, { entity_type, entity_id });
    const { source, category, stream } = detail.entity.metadata;
    assert.deepEqual({ source, category, stream }, { source: 'Intake', category: 'Business applications', stream: 'Customer experience' }, `${entity_type}: the classification by its names`);
  }
  console.log('  details name their source, category and stream: OK');
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      await testDetails(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('ai-portfolio-classification-reads.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
