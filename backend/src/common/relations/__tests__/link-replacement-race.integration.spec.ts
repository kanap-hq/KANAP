import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import dataSource from '../../../data-source';
import { cleanupTenants } from '../../../admin/tenants/__tests__/tenant-reset-test-helpers';

// A replacement of a record's links removes only the stored links the person reads and are absent
// from the sent list. A link another transaction commits between the route's read of the stored
// links and its write stays: a Business Contributor replaces a request's applications while another
// person links an application they do not read.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'link-replacement-race-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

async function inTransaction<T>(source: DataSource, tenantId: string, fn: (runner: QueryRunner) => Promise<T>): Promise<T> {
  const runner = source.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const result = await fn(runner);
    await runner.commitTransaction();
    return result;
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for link-replacement-race.integration.spec.ts.');
  const { AppModule } = require('../../../app.module');
  const { PortfolioRequestsController } = require('../../../portfolio/portfolio-requests.controller');
  const { PortfolioRequestsService } = require('../../../portfolio/portfolio-requests.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const source = app.get(DataSource);
  const service = app.get(PortfolioRequestsService);
  const replace = service.bulkReplaceApplications;
  await dataSource.initialize();
  const tenantId = randomUUID();
  try {
    const seed = await inTransaction(source, tenantId, async (runner) => {
      const slug = `link-race-${tenantId.slice(0, 8)}`;
      await runner.query(
        `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
         VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
        [tenantId, slug, slug],
      );
      const role = await insertId(runner, `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Business Contributor')`, [tenantId]);
      for (const [resource, level] of [['portfolio_requests', 'member'], ['applications', 'reader']]) {
        await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, role, resource, level]);
      }
      const bc = await insertId(runner,
        `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, 'Bea', 'Contributor', $3, 'enabled')`,
        [tenantId, `bc-${tenantId.slice(0, 8)}@example.test`, role]);
      await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, bc, role]);
      const application = (name: string) => insertId(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, $2)`, [tenantId, name]);
      const seen = await application('Seen');
      const unseen = await application('Unseen');
      const unseenLater = await application('Unseen later');
      await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`, [tenantId, seen, bc]);
      const request = await insertId(runner,
        `INSERT INTO portfolio_requests (tenant_id, item_number, name, requestor_id) VALUES ($1, 1, 'Request', $2)`, [tenantId, bc]);
      await runner.query(`INSERT INTO portfolio_request_applications (tenant_id, request_id, application_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
        [tenantId, request, seen, unseen]);
      return { bc, seen, unseen, unseenLater, request };
    });

    // Between the route's read of the stored links and its write, another transaction links an
    // application the person does not read, and commits.
    service.bulkReplaceApplications = async (...args: unknown[]) => {
      await inTransaction(source, tenantId, (other) => other.query(
        `INSERT INTO portfolio_request_applications (tenant_id, request_id, application_id) VALUES ($1, $2, $3)`,
        [tenantId, seed.request, seed.unseenLater]));
      return replace.apply(service, args);
    };
    const answer: { count: number } = await inTransaction(source, tenantId, (runner) => app.get(PortfolioRequestsController).bulkReplaceApplications(
      seed.request,
      { application_ids: [] },
      { user: { sub: seed.bc }, tenant: { id: tenantId }, isAdmin: false, permissions: { portfolio_requests: 'member', applications: 'reader' }, queryRunner: runner },
    ));
    service.bulkReplaceApplications = replace;

    const stored = await inTransaction(source, tenantId, (runner) => runner.query(
      `SELECT application_id AS id FROM portfolio_request_applications WHERE tenant_id = $1 AND request_id = $2`, [tenantId, seed.request]));
    assert.deepEqual(
      stored.map((row: { id: string }) => row.id).sort(),
      [seed.unseen, seed.unseenLater].sort(),
      'the seen link left; the unseen one and the one committed meanwhile stay',
    );
    assert.equal(answer.count, 0, 'the answer counts the links the person reads');
    console.log('  a link committed by another transaction during a replacement stays: OK');
  } finally {
    service.bulkReplaceApplications = replace;
    await cleanupTenants([tenantId]);
    await dataSource.destroy();
    await app.close();
  }
  console.log('link-replacement-race.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
