// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { ItemNumberService } from '../../common/item-number.service';
import { PortfolioProject } from '../portfolio-project.entity';
import { PortfolioRequest } from '../portfolio-request.entity';
import { PortfolioProjectsCrudService } from '../services/portfolio-projects-crud.service';
import {
  assert,
  captureAudit,
  inRolledBackTransaction,
  runSpecs,
  seedTenant,
} from '../../spend/__tests__/round-inputs.fixtures';

// An approved request converts once. Converting it again is a 400 and writes no project.
// A second project for the same need is created from the portfolio and linked to the request.

const ALREADY_CONVERTED = 'This request has already been converted to a project.';

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(sql, params);
  return rows[0].id as string;
}

async function seed(runner: QueryRunner) {
  const tenantId = await seedTenant(runner, 'req-convert');
  const role = await one(runner, `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Member') RETURNING id`, [tenantId]);
  const userId = await one(
    runner,
    `INSERT INTO users (tenant_id, email, role_id, first_name, last_name) VALUES ($1, $2, $3, 'Ada', 'Spec') RETURNING id`,
    [tenantId, `ada-${randomUUID().slice(0, 8)}@example.test`, role],
  );
  const requestId = await one(
    runner,
    `INSERT INTO portfolio_requests (tenant_id, name, item_number, status, requestor_id) VALUES ($1, 'Cave climate', 3, 'approved', $2) RETURNING id`,
    [tenantId, userId],
  );
  return { tenantId, userId, requestId };
}

function crudFor(runner: QueryRunner) {
  return new PortfolioProjectsCrudService(
    runner.manager.getRepository(PortfolioProject),
    runner.manager.getRepository(PortfolioRequest),
    captureAudit() as any,
    { calculateEffortFromCriteria: async () => ({ estimated_effort_it: 0, estimated_effort_business: 0 }) } as any,
    { notifyTeamAdded: () => undefined, notifyItLeadOfTeamChange: () => undefined } as any,
    new ItemNumberService(),
    { createProjectPurposeFromRequest: async () => undefined } as any,
  );
}

async function projectCount(runner: QueryRunner, tenantId: string): Promise<number> {
  const [row] = await runner.query(
    `SELECT count(*)::int AS n FROM portfolio_projects WHERE tenant_id = $1`,
    [tenantId],
  );
  return row.n as number;
}

function messageOf(err: unknown): string {
  if (!(err instanceof BadRequestException)) return '';
  const response = err.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  return Array.isArray(message) ? message.join(' ') : String(message ?? err.message);
}

async function testApprovedConvertsOnce() {
  await inRolledBackTransaction(async (runner) => {
    const data = await seed(runner);
    const crud = crudFor(runner);
    const opts = { manager: runner.manager, userId: data.userId };

    const project = await crud.convertFromRequest(data.requestId, {}, data.tenantId, data.userId, opts);
    assert.ok(project.id, 'an approved request converts');
    assert.equal(await projectCount(runner, data.tenantId), 1, 'the first conversion creates one project');
    const [request] = await runner.query(`SELECT status FROM portfolio_requests WHERE id = $1`, [data.requestId]);
    assert.equal(request.status, 'converted');

    await assert.rejects(
      () => crud.convertFromRequest(data.requestId, { name: 'Second project' }, data.tenantId, data.userId, opts),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException, `expected 400, got ${err}`);
        assert.equal(err.getStatus(), 400);
        assert.equal(messageOf(err), ALREADY_CONVERTED);
        return true;
      },
    );
    assert.equal(await projectCount(runner, data.tenantId), 1, 'a second conversion creates no project');
    const [still] = await runner.query(
      `SELECT name FROM portfolio_projects WHERE tenant_id = $1`,
      [data.tenantId],
    );
    assert.equal(still.name, 'Cave climate', 'the refused name is not written');
  });
}

void runSpecs('request-convert-once.integration.spec', [
  ['an approved request converts once; a second conversion is a 400', testApprovedConvertsOnce],
]);
