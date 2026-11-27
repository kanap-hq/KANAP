// @database-spec
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { applyDataAccess } from '../../data-access/data-access';

// The activity of a task that changes its object (lot I7e of 26.12.1). The move stores the kind and
// the id of the object left and of the object reached, never a name; `GET /tasks/:id/activities`
// (and its project route) names each side with the reader's rights, through the reference
// resolution of the record history:
// - a person who reads both objects sees their names and references (`PRJ-1`, `CTR-1`, `BL-1`);
// - a person who does not read contracts gets `{ hidden: true, kind: 'contract' }` for that side,
//   and nothing in the whole answer names the contract: no name, no reference, no id;
// - a person in limited data access gets the line and the contract outside their scope the same
//   way, the project they read named;
// - another tenant does not find the task;
// - an older row, which stored a text, shows the kind its text tells, or a neutral mention, to
//   every reader: the stored text never leaves the server.
// The moves change neither the assignee nor the status: nothing is sent (the e-mail service is
// watched).

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'task-activity-related-object-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

type Activity = { id: string; changed_fields: Record<string, unknown> | null };

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for task-activity-related-object.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { TasksController } = require('../../spend/tasks.controller');
  const { PortfolioProjectTasksController } = require('../../portfolio/portfolio-project-tasks.controller');
  const { TasksUnifiedService } = require('../tasks-unified.service');
  const { EmailService } = require('../../email/email.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const tasksController = app.get(TasksController);
  const projectTasksController = app.get(PortfolioProjectTasksController);
  const tasks = app.get(TasksUnifiedService);
  const sent: unknown[] = [];
  const email = app.get(EmailService);
  email.send = async (options: unknown) => { sent.push(options); };
  const runner = app.get(DataSource).createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    const otherTenantId = randomUUID();
    for (const id of [tenantId, otherTenantId]) {
      await runner.query(
        `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
         VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
        [id, `task-related-${id.slice(0, 8)}`, `task-related-${id.slice(0, 8)}`],
      );
    }
    const inTenant = (id: string) => runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [id]);
    await inTenant(tenantId);

    const role = async (name: string, permissions: Record<string, string>) => {
      const id = await insertId(runner, `INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2)`, [tenantId, name]);
      for (const [resource, level] of Object.entries(permissions)) {
        await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, id, resource, level]);
      }
      return { id, permissions };
    };
    const user = async (name: string, roleId: string, mode: 'all' | 'limited' = 'all') => {
      const id = await insertId(runner,
        `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, data_access_mode) VALUES ($1, $2, $3, 'Reader', $4, 'enabled', $5)`,
        [tenantId, `${name}-${tenantId.slice(0, 8)}@example.test`, name, roleId, mode]);
      await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, id, roleId]);
      return id;
    };
    const everything = { tasks: 'reader', portfolio_projects: 'reader', contracts: 'reader', budget: 'reader' };
    const adminRole = await role('Administrator', {});
    const fullRole = await role('Reads everything', everything);
    const noContractsRole = await role('Reads no contracts', { tasks: 'reader', portfolio_projects: 'reader', budget: 'reader' });
    const adminId = await user('admin', adminRole.id);
    const fullId = await user('full', fullRole.id);
    const noContractsId = await user('nocontracts', noContractsRole.id);
    const limitedId = await user('limited', fullRole.id, 'limited');

    const company = async (name: string, n: number) => insertId(runner,
      `INSERT INTO companies (tenant_id, name, country_iso, city, item_number) VALUES ($1, $2, 'FR', 'Brest', $3)`, [tenantId, name, n]);
    const companyIn = await company('Company in scope', 1);
    const companyOut = await company('Company out of scope', 2);
    await runner.query(
      `INSERT INTO user_data_access_nodes (tenant_id, user_id, node_type, company_id, access) VALUES ($1, $2, 'company', $3, 'read')`,
      [tenantId, limitedId, companyIn]);
    const supplier = await insertId(runner, `INSERT INTO suppliers (tenant_id, name, item_number) VALUES ($1, 'Supplier', 1)`, [tenantId]);
    const project = await insertId(runner, `INSERT INTO portfolio_projects (tenant_id, item_number, name) VALUES ($1, 7, 'Visible project')`, [tenantId]);
    const contract = await insertId(runner,
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, item_number) VALUES ($1, 'Secret contract', $2, $3, '2026-01-01', 5)`,
      [tenantId, companyOut, supplier]);
    const line = await insertId(runner,
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, nature, paying_company_id)
       VALUES ($1, 'Secret line', 'EUR', '2026-01-01', 9, 'opex', $2)`,
      [tenantId, companyOut]);
    // No assignee: a task created or moved with one would notify.
    const task = async (n: number, type: string, id: string) => insertId(runner,
      `INSERT INTO tasks (tenant_id, item_number, title, status, labels, owner_ids, viewer_ids, related_object_type, related_object_id)
       VALUES ($1, $2, $3, 'open', '[]', '[]', '[]', $4, $5)`,
      [tenantId, n, `Task ${n}`, type, id]);
    const fromProject = await task(1, 'project', project);
    const fromLine = await task(2, 'spend_item', line);

    // Written by an administrator: the project task goes to the contract; the line's task goes to
    // the contract, then to the project.
    const write = { manager: runner.manager, tenantId };
    await tasks.updateById(fromProject, { related_object_type: 'contract', related_object_id: contract }, adminId, write);
    await tasks.updateById(fromLine, { related_object_type: 'contract', related_object_id: contract }, adminId, write);
    await tasks.updateById(fromLine, { related_object_type: 'project', related_object_id: project }, adminId, write);

    const req = (userId: string, permissions: Record<string, string>, isAdmin = false) => ({
      user: { sub: userId }, isAdmin, permissions, tenant: { id: tenantId }, queryRunner: runner,
    });
    const read = async (taskId: string, request: any): Promise<Activity[]> => tasksController.listActivities(taskId, request);
    const moves = (rows: Activity[]) => rows
      .map((row) => row.changed_fields?.related_to)
      .filter((change): change is unknown[] => Array.isArray(change));
    const asLimited = async <T>(fn: () => Promise<T>): Promise<T> => {
      await runner.query('SAVEPOINT limited_reader');
      try {
        assert.equal(await applyDataAccess(runner, limitedId), 'limited');
        return await fn();
      } finally {
        await runner.query('ROLLBACK TO SAVEPOINT limited_reader');
      }
    };

    const projectRef = { kind: 'project', id: project, label: 'Visible project', reference: 'PRJ-7' };
    const contractRef = { kind: 'contract', id: contract, label: 'Secret contract', reference: 'CTR-5' };
    const lineRef = { kind: 'budget_line', id: line, label: 'Secret line', reference: 'BL-9' };

    // The stored row: the kind and the id of each side, no name.
    const [stored] = await runner.query(
      `SELECT changed_fields FROM portfolio_activities WHERE tenant_id = $1 AND task_id = $2 AND changed_fields ? 'related_to'`,
      [tenantId, fromProject]);
    assert.deepEqual(stored.changed_fields.related_to, [{ kind: 'project', id: project }, { kind: 'contract', id: contract }], 'stored: kind and id');
    console.log('  a move stores the kind and the id of each side: OK');

    // A person who reads both: names and references.
    const full = req(fullId, fullRole.permissions);
    assert.deepEqual(moves(await read(fromProject, full)), [[projectRef, contractRef]], 'full reader: project to contract');
    const fullLine = moves(await read(fromLine, full));
    assert.equal(fullLine.length, 2);
    assert.ok(fullLine.some((move) => JSON.stringify(move) === JSON.stringify([lineRef, contractRef])), 'full reader: line to contract');
    assert.ok(fullLine.some((move) => JSON.stringify(move) === JSON.stringify([contractRef, projectRef])), 'full reader: contract to project');
    console.log('  a person who reads both objects sees their names and references: OK');

    // A person who does not read contracts: the kind alone, nothing of the contract in the answer.
    const noContracts = await read(fromProject, req(noContractsId, noContractsRole.permissions));
    assert.deepEqual(moves(noContracts), [[projectRef, { hidden: true, kind: 'contract' }]], 'no reader of contracts: the kind');
    const noContractsText = JSON.stringify(noContracts);
    for (const secret of ['Secret contract', 'CTR-5', contract]) {
      assert.equal(noContractsText.includes(secret), false, `no reader of contracts: no ${secret} in the answer`);
    }
    console.log('  a person who does not read contracts gets the kind alone: OK');

    // A person in limited data access: the line and the contract outside their scope by their kind.
    for (const [route, call] of [
      ['task route', () => read(fromLine, req(limitedId, fullRole.permissions))],
      ['project route', () => projectTasksController.listActivities(project, fromLine, req(limitedId, fullRole.permissions))],
    ] as const) {
      const limited: Activity[] = await asLimited(call);
      const limitedMoves = moves(limited);
      assert.equal(limitedMoves.length, 2, `limited (${route}): both moves`);
      assert.ok(limitedMoves.some((move) => JSON.stringify(move) === JSON.stringify([{ hidden: true, kind: 'budget_line' }, { hidden: true, kind: 'contract' }])), `limited (${route}): line to contract`);
      assert.ok(limitedMoves.some((move) => JSON.stringify(move) === JSON.stringify([{ hidden: true, kind: 'contract' }, projectRef])), `limited (${route}): contract to project`);
      const text = JSON.stringify(limited);
      for (const secret of ['Secret contract', 'Secret line', 'CTR-5', 'BL-9', contract, line]) {
        assert.equal(text.includes(secret), false, `limited (${route}): no ${secret} in the answer`);
      }
    }
    console.log('  a person in limited data access gets the line and the contract outside their scope by their kind: OK');

    // An older row stored a text: the kind its text tells, or a neutral mention, for every reader.
    const old = async (before: string, after: string) => insertId(runner,
      `INSERT INTO portfolio_activities (tenant_id, task_id, author_id, type, changed_fields)
       VALUES ($1, $2, $3, 'change', jsonb_build_object('related_to', jsonb_build_array($4::text, $5::text)))`,
      [tenantId, fromProject, adminId, before, after]);
    const oldOne = await old('PRJ-7: Visible project', 'Contract: Secret contract');
    const oldTwo = await old('Spend: Secret line', contract);
    const oldThree = await old('CAPEX: Secret line', 'INC-3 · Secret incident');
    const oldFour = await old('A budget line', 'A contract');
    for (const [who, request] of [['full', full], ['admin', req(adminId, {}, true)], ['no contracts', req(noContractsId, noContractsRole.permissions)]] as const) {
      const rows = await read(fromProject, request);
      const byId = new Map(rows.map((row) => [row.id, row]));
      assert.deepEqual(byId.get(oldOne)?.changed_fields?.related_to, [{ hidden: true, kind: 'project' }, { hidden: true, kind: 'contract' }], `${who}: an older project to contract`);
      assert.deepEqual(byId.get(oldTwo)?.changed_fields?.related_to, [{ hidden: true, kind: 'budget_line' }, { hidden: true }], `${who}: an older line to an id`);
      assert.deepEqual(byId.get(oldThree)?.changed_fields?.related_to, [{ hidden: true, kind: 'budget_line' }, { hidden: true, kind: 'incident' }], `${who}: an older CAPEX line to an incident`);
      assert.deepEqual(byId.get(oldFour)?.changed_fields?.related_to, [{ hidden: true, kind: 'budget_line' }, { hidden: true, kind: 'contract' }], `${who}: an older unread line to an unread contract`);
      const oldText = JSON.stringify([oldOne, oldTwo, oldThree, oldFour].map((id) => byId.get(id)));
      for (const secret of ['Secret', 'PRJ-7', 'INC-3', contract]) {
        assert.equal(oldText.includes(secret), false, `${who}: no ${secret} from an older row`);
      }
    }
    console.log('  an older row shows the kind its text tells, or a neutral mention: OK');

    // Another tenant: the task is not found.
    await inTenant(otherTenantId);
    await assert.rejects(() => read(fromProject, { ...full, tenant: { id: otherTenantId } }), /not found/i, 'another tenant: not found');
    await inTenant(tenantId);
    console.log('  another tenant does not find the task: OK');

    assert.deepEqual(sent, [], 'no e-mail: the moves change neither the assignee nor the status');
    console.log('  nothing is sent: OK');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await app.close();
  }
}

run().then(() => console.log('task-activity-related-object.integration.spec: all passed'), (error) => {
  console.error(error);
  process.exitCode = 1;
});
