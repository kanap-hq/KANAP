// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { ItemNumberService } from '../../common/item-number.service';
import { issueCreationToken, verifyCreationToken } from '../../common/creation/creation-token';
import {
  auditedEdit,
  deletionAuthors,
  inRolledBackTransaction,
  refusedAsExpired,
  seedCreationTenant,
  type CreationSeed,
} from '../../common/creation/__tests__/creation-cancel.fixtures';
import { applyDataAccess } from '../../data-access/data-access';
import { CapexTasksController } from '../../spend/capex-tasks.controller';
import { ContractsController } from '../../contracts/contracts.controller';
import { IncidentsTasksController } from '../../incidents/incidents-tasks.controller';
import { PortfolioProjectTasksController } from '../../portfolio/portfolio-project-tasks.controller';
import { SpendTasksController } from '../../spend/spend-tasks.controller';
import { TasksController } from '../../spend/tasks.controller';
import { seedCompany } from '../../spend/__tests__/cost-center.fixtures';
import { Task } from '../task.entity';
import { TasksDeleteService } from '../tasks-delete.service';
import { TasksUnifiedService } from '../tasks-unified.service';

// "Cancel" of a task being created (lot V4 of the creation frame): every create route of a task
// hands its creator a token of the family `tasks`; `GET /tasks/:id/creation` counts what was written
// since the creation (fields, description included, attachments, time entries, comments);
// `DELETE /tasks/:id/creation` deletes it for its creator at the create level (tasks member, no
// admin), through the task delete and its audit entry. A project task goes the same way through its
// project's routes (portfolio_projects contributor), never through another project's. Another
// person's token, another task's, none or an expired one is refused (`CREATION_CANCEL_EXPIRED`), and
// so is the cancel of a task another person wrote on. A person with limited data access cancels a
// task they created on a budget line they may modify, under their limited role.

function services(runner: QueryRunner) {
  const manager = runner.manager;
  const audit = new AuditService(manager.getRepository(AuditLog));
  const unified = new TasksUnifiedService(
    manager.getRepository(Task),
    audit,
    dataSource,
    { recalculateUserMonth: async () => undefined } as any,
    {} as any,
    new ItemNumberService(),
    {} as any,
    {} as any,
    {} as any,
  );
  const deleteSvc = new TasksDeleteService(manager.getRepository(Task), audit, { recalculateUserMonth: async () => undefined } as any);
  const tasks = Object.create(TasksController.prototype) as TasksController;
  Object.assign(tasks, { unified, deleteSvc });
  const projectTasks = Object.create(PortfolioProjectTasksController.prototype) as PortfolioProjectTasksController;
  Object.assign(projectTasks, { tasksSvc: unified, deleteSvc, projectsSvc: { assertVisible: async () => undefined } });
  const spendTasks = Object.create(SpendTasksController.prototype) as SpendTasksController;
  Object.assign(spendTasks, {
    svc: { createForItem: (id: string, body: any, userId: any, opts: any) => unified.createForTarget({ type: 'spend_item', id, payload: body }, userId, opts) },
  });
  return { unified, tasks, projectTasks, spendTasks };
}

/** The task routes read the Express request: tenant, person and the transaction's manager. */
function req(seed: { tenantId: string }, userId: string, runner: QueryRunner) {
  return { tenant: { id: seed.tenantId }, user: { sub: userId }, isAdmin: false, queryRunner: { manager: runner.manager } };
}

async function taskCount(runner: QueryRunner, tenantId: string, id: string): Promise<number> {
  const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM tasks WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return n;
}

async function seedProject(runner: QueryRunner, tenantId: string, itemNumber: number): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO portfolio_projects (tenant_id, item_number, name, origin, status, scheduling_mode, execution_progress, criteria_values)
     VALUES ($1, $2, $3, 'fast_track', 'planned', 'independent', 0, '{}'::jsonb) RETURNING id`,
    [tenantId, itemNumber, `Project ${itemNumber}`],
  );
  return row.id;
}

function testRoutesNeedTheCreateLevel() {
  for (const method of ['createStandalone', 'creationChanges', 'cancelCreation'] as const) {
    const meta = Reflect.getMetadata(REQUIRE_LEVEL_KEY, (TasksController.prototype as any)[method]);
    assert.deepEqual(meta, { resource: 'tasks', level: 'member' }, `${method} needs tasks:member`);
  }
  for (const method of ['createTask', 'creationChanges', 'cancelCreation'] as const) {
    const meta = Reflect.getMetadata(REQUIRE_LEVEL_KEY, (PortfolioProjectTasksController.prototype as any)[method]);
    assert.deepEqual(meta, { resource: 'portfolio_projects', level: 'contributor' }, `project ${method} needs portfolio_projects:contributor`);
  }
}

/** The routes whose target is read by another service hand the token of what that service created. */
async function testEveryCreateRouteHandsAToken() {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const subject = { tenantId, family: 'tasks', userId };
  const manager = { query: async () => [] } as any;
  const created = () => ({ id: randomUUID(), title: 'T' });
  const request = { tenant: { id: tenantId }, user: { sub: userId }, queryRunner: { manager } };

  const contracts = Object.create(ContractsController.prototype) as ContractsController;
  Object.assign(contracts, { svc: { createTask: async () => created() } });
  const capex = Object.create(CapexTasksController.prototype) as CapexTasksController;
  Object.assign(capex, { unified: { createForTarget: async () => created() } });
  const incidents = Object.create(IncidentsTasksController.prototype) as IncidentsTasksController;
  Object.assign(incidents, { unified: { createForTarget: async () => created() }, incidents: { ensureEditable: async () => undefined } });
  const id = randomUUID();
  const results: Array<[string, any]> = [
    ['contracts', await contracts.createTask(id, { title: 'T' }, request)],
    ['capex', await capex.create(id, { title: 'T' }, request)],
    ['incidents', await incidents.create(id, { title: 'T' }, { tenantId, userId, manager } as any)],
  ];
  for (const [route, result] of results) {
    assert.ok(verifyCreationToken(result.creation_token, { ...subject, recordId: result.id }), `${route} hands a task creation token`);
  }
}

async function testCreatorCancelsTheCreation() {
  await inRolledBackTransaction(async (runner) => {
    const seed: CreationSeed = await seedCreationTenant(runner, { tasks: 'member' });
    const { tenantId, creatorId, otherId } = seed;
    const { tasks } = services(runner);
    const asCreator = req(seed, creatorId, runner);

    const created: any = await tasks.createStandalone({ title: 'Cancel creation spec' }, asCreator);
    assert.equal(typeof created.creation_token, 'string', 'the standalone route hands a creation token');
    assert.ok(created.item_number > 0, 'the task has its reference');
    const other: any = await tasks.createStandalone({ title: 'Another task' }, asCreator);

    const fresh = await tasks.creationChanges(created.id, created.creation_token, asCreator);
    assert.deepEqual(fresh, { changes: { fields: 0, children: {} } }, 'nothing written since the creation');

    // A description, an attachment, a time entry and a comment: what the confirmation lists.
    await auditedEdit(runner, 'tasks', created.id, creatorId, 'description');
    await runner.query(
      `INSERT INTO task_attachments (tenant_id, task_id, original_filename, stored_filename, size, storage_path)
       VALUES ($1, $2, 'brief.pdf', 'brief.pdf', 10, $3)`,
      [tenantId, created.id, `tasks/${created.id}/brief.pdf`],
    );
    await runner.query(`INSERT INTO task_time_entries (tenant_id, task_id, hours, logged_at) VALUES ($1, $2, 1.5, now())`, [tenantId, created.id]);
    await runner.query(
      `INSERT INTO portfolio_activities (tenant_id, task_id, author_id, type, content) VALUES ($1, $2, $3, 'comment', 'A note')`,
      [tenantId, created.id, creatorId],
    );
    const edited = await tasks.creationChanges(created.id, created.creation_token, asCreator);
    assert.deepEqual(
      edited,
      { changes: { fields: 1, children: { attachment: 1, time_entry: 1, comment: 1 } } },
      'the description, one attachment, one time entry, one comment',
    );

    // Another person's token for this task, another task's token, none, an expired one: refused.
    await refusedAsExpired(tasks.creationChanges(created.id, created.creation_token, req(seed, otherId, runner)), 'other user, preflight');
    await refusedAsExpired(tasks.cancelCreation(created.id, { token: created.creation_token }, req(seed, otherId, runner)), 'other user');
    await refusedAsExpired(tasks.cancelCreation(created.id, { token: other.creation_token }, asCreator), 'other task');
    await refusedAsExpired(tasks.cancelCreation(created.id, {}, asCreator), 'no token');
    const expired = issueCreationToken(
      { tenantId, family: 'tasks', recordId: created.id, userId: creatorId },
      { now: Date.now() - 25 * 60 * 60 * 1000 },
    );
    await refusedAsExpired(tasks.cancelCreation(created.id, { token: expired }, asCreator), 'expired token');

    // Another person wrote on the other task: its creator's cancel is over (preflight and cancel).
    await auditedEdit(runner, 'tasks', other.id, otherId, 'title');
    await refusedAsExpired(tasks.creationChanges(other.id, other.creation_token, asCreator), 'another author, preflight');
    await refusedAsExpired(tasks.cancelCreation(other.id, { token: other.creation_token }, asCreator), 'another author');

    // The creator, a member without the delete level (admin), cancels it with its token.
    await tasks.cancelCreation(created.id, { token: created.creation_token }, asCreator);
    assert.equal(await taskCount(runner, tenantId, created.id), 0, 'the task is gone');
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM portfolio_activities WHERE tenant_id = $1 AND task_id = $2`, [tenantId, created.id]);
    assert.equal(n, 0, 'its comments are gone');
    assert.deepEqual(await deletionAuthors(runner, tenantId, 'tasks', created.id), [creatorId], 'the delete is audited under its creator');
    assert.equal(await taskCount(runner, tenantId, other.id), 1, 'the other task stays');
  });
}

async function testProjectTaskThroughItsProject() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedCreationTenant(runner, { tasks: 'reader', portfolio_projects: 'contributor' });
    const { tenantId, creatorId } = seed;
    const { projectTasks } = services(runner);
    const asCreator = req(seed, creatorId, runner);
    const projectId = await seedProject(runner, tenantId, 1);
    const otherProjectId = await seedProject(runner, tenantId, 2);

    const created: any = await projectTasks.createTask(projectId, { title: 'Project task' } as any, asCreator);
    assert.ok(verifyCreationToken(created.creation_token, { tenantId, family: 'tasks', recordId: created.id, userId: creatorId }), 'the project route hands a task token');
    const fresh = await projectTasks.creationChanges(projectId, created.id, created.creation_token, asCreator);
    assert.deepEqual(fresh, { changes: { fields: 0, children: {} } }, 'nothing written since the creation');

    // Through another project: the task is not that project's.
    await assert.rejects(
      projectTasks.cancelCreation(otherProjectId, created.id, { token: created.creation_token }, asCreator),
      (error: unknown) => error instanceof BadRequestException,
      'another project refuses the cancel',
    );
    assert.equal(await taskCount(runner, tenantId, created.id), 1, 'the task stays');
    await refusedAsExpired(projectTasks.cancelCreation(projectId, created.id, {}, asCreator), 'no token');

    await projectTasks.cancelCreation(projectId, created.id, { token: created.creation_token }, asCreator);
    assert.equal(await taskCount(runner, tenantId, created.id), 0, 'the project task is gone');
    assert.deepEqual(await deletionAuthors(runner, tenantId, 'tasks', created.id), [creatorId], 'audited under its creator');
  });
}

async function testLimitedPersonCancelsATaskOfTheirLine() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedCreationTenant(runner, { tasks: 'member' });
    const { tenantId, creatorId: limitedId } = seed;
    const { companyId } = await seedCompany(runner, tenantId, 'Scoped company');
    await runner.query(`UPDATE users SET data_access_mode = 'limited' WHERE tenant_id = $1 AND id = $2`, [tenantId, limitedId]);
    await runner.query(
      `INSERT INTO user_data_access_nodes (tenant_id, user_id, node_type, company_id, cost_center_id, access)
       VALUES ($1, $2, 'company', $3, NULL, 'edit')`,
      [tenantId, limitedId, companyId],
    );
    const [line] = await runner.query(
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, paying_company_id)
       VALUES ($1, 'Scoped line', 'EUR', '2020-01-01', 1, $2) RETURNING id`,
      [tenantId, companyId],
    );
    const { spendTasks, tasks } = services(runner);
    const asLimited = req(seed, limitedId, runner);
    assert.equal(await applyDataAccess(runner.manager, limitedId), 'limited');

    const created: any = await spendTasks.create(line.id, { title: 'Line task' }, asLimited);
    assert.equal(typeof created.creation_token, 'string', 'the line route hands a creation token');
    const fresh = await tasks.creationChanges(created.id, created.creation_token, asLimited);
    assert.deepEqual(fresh, { changes: { fields: 0, children: {} } }, 'nothing written since the creation');

    await tasks.cancelCreation(created.id, { token: created.creation_token }, asLimited);
    const [state] = await runner.query(`SELECT current_setting('role', true) AS role`);
    assert.equal(state.role, 'kanap_data_limited', 'the cancel ran under the limited role');
    assert.equal(await taskCount(runner, tenantId, created.id), 0, 'the limited person\'s task is gone');
    assert.deepEqual(await deletionAuthors(runner, tenantId, 'tasks', created.id), [limitedId], 'audited under its creator');
  });
}

async function main() {
  await dataSource.initialize();
  try {
    testRoutesNeedTheCreateLevel();
    console.log('  ok testRoutesNeedTheCreateLevel');
    await testEveryCreateRouteHandsAToken();
    console.log('  ok testEveryCreateRouteHandsAToken');
    await testCreatorCancelsTheCreation();
    console.log('  ok testCreatorCancelsTheCreation');
    await testProjectTaskThroughItsProject();
    console.log('  ok testProjectTaskThroughItsProject');
    await testLimitedPersonCancelsATaskOfTheirLine();
    console.log('  ok testLimitedPersonCancelsATaskOfTheirLine');
  } finally {
    await dataSource.destroy();
  }
  console.log('task-cancel-creation.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
