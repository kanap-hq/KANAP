// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { ItemNumberService } from '../../common/item-number.service';
import { closeMarkdownWorkers } from '../../common/markdown-worker';
import { issueCreationToken } from '../../common/creation/creation-token';
import {
  boundDocuments,
  deletionAuthors,
  inRolledBackTransaction,
  managedDocumentServices,
  recordingStorage,
  refusedAsExpired,
  seedCreationTenant,
  tenantContext,
  writeManagedDocument,
} from '../../common/creation/__tests__/creation-cancel.fixtures';
import { PortfolioProjectsController } from '../portfolio-projects.controller';
import { PortfolioProjectsCrudService } from '../services/portfolio-projects-crud.service';
import { PortfolioProjectCreationService } from '../services/portfolio-project-creation.service';
import { UserTimeAggregateService } from '../services/user-time-aggregate.service';

// "Cancel creation" of a project (lot 1b of the creation frame). Projects have no delete: the
// cancel route is their only one. `POST /portfolio/projects` hands the creator a token;
// `GET :id/creation` counts what was written since the creation (history, the edited purpose,
// attachments, time entries); `DELETE :id/creation` removes the project and what belongs to it
// (phases, tasks, team, attachments and their files, time entries and their totals). A project
// linked to a request is refused (`PROJECT_FROM_REQUEST`); another person's token, another
// project's, a missing or an expired one is refused with `CREATION_CANCEL_EXPIRED`.

function controllerFor(runner: QueryRunner) {
  const manager = runner.manager;
  const audit = new AuditService(manager.getRepository(AuditLog));
  const integrated = managedDocumentServices(manager);
  const crud = new PortfolioProjectsCrudService(
    undefined as any,
    undefined as any,
    audit,
    undefined as any,
    { getProjectRecipients: async () => [], notifyStatusChange: () => undefined } as any,
    new ItemNumberService() as any,
    integrated,
  );
  const storage = recordingStorage();
  const creationSvc = new PortfolioProjectCreationService(audit, storage as any, integrated, new UserTimeAggregateService());
  const controller = Object.create(PortfolioProjectsController.prototype) as PortfolioProjectsController;
  Object.assign(controller, {
    svc: { create: (body: any, tenantId: string, userId: string | null, opts: any) => crud.create(body, tenantId, userId, opts) },
    creationSvc,
  });
  return { controller, storage };
}

function testRoutesNeedTheCreateLevel() {
  for (const method of ['create', 'creationChanges', 'cancelCreation'] as const) {
    const meta = Reflect.getMetadata(REQUIRE_LEVEL_KEY, (PortfolioProjectsController.prototype as any)[method]);
    assert.deepEqual(meta, { resource: 'portfolio_projects', level: 'member' }, `${method} needs portfolio_projects:member`);
  }
}

async function count(runner: QueryRunner, sql: string, params: unknown[]): Promise<number> {
  const [{ n }] = await runner.query(sql, params);
  return n;
}

async function testCreatorCancelsTheCreation() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedCreationTenant(runner, { portfolio_projects: 'member' });
    const { tenantId, creatorId, otherId } = seed;
    const { controller, storage } = controllerFor(runner);
    const asCreator = tenantContext(seed, creatorId, runner.manager);

    const created: any = await controller.create({ name: 'Cancel creation spec', origin: 'fast_track' } as any, asCreator);
    assert.equal(typeof created.creation_token, 'string', 'the create route hands a creation token');
    assert.equal(await boundDocuments(runner, tenantId, 'projects', created.id), 1, 'the purpose is provisioned');
    const other: any = await controller.create({ name: 'Another project', origin: 'fast_track' } as any, asCreator);

    const fresh = await controller.creationChanges(created.id, created.creation_token, asCreator);
    assert.deepEqual(fresh, { changes: { fields: 0, children: {} } }, 'nothing written since the creation');

    // A phase, a task, a team member, an attachment, a time entry and a written purpose.
    await runner.query(`INSERT INTO portfolio_project_phases (tenant_id, project_id, name) VALUES ($1, $2, 'Build')`, [tenantId, created.id]);
    const [{ id: taskId }] = await runner.query(
      `INSERT INTO tasks (tenant_id, title, item_number, related_object_type, related_object_id)
       VALUES ($1, 'Kick-off', 990001, 'project', $2) RETURNING id`,
      [tenantId, created.id],
    );
    await runner.query(`INSERT INTO portfolio_project_team (tenant_id, project_id, user_id, role) VALUES ($1, $2, $3, 'it_team')`, [tenantId, created.id, otherId]);
    const path = `projects/${created.id}/plan.pdf`;
    await runner.query(
      `INSERT INTO portfolio_project_attachments (tenant_id, project_id, original_filename, stored_filename, size, storage_path)
       VALUES ($1, $2, 'plan.pdf', 'plan.pdf', 10, $3)`,
      [tenantId, created.id, path],
    );
    await runner.query(
      `INSERT INTO portfolio_project_time_entries (tenant_id, project_id, user_id, category, hours, logged_at)
       VALUES ($1, $2, $3, 'it', 3, '2026-10-15T10:00:00Z')`,
      [tenantId, created.id, otherId],
    );
    const aggregates = new UserTimeAggregateService();
    await aggregates.recalculateUserMonth(otherId, new Date('2026-10-01T00:00:00Z'), runner.manager);
    const hoursOf = () => count(
      runner,
      `SELECT coalesce(sum(project_hours), 0)::int AS n FROM user_time_monthly_aggregates WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, otherId],
    );
    assert.equal(await hoursOf(), 3, 'the time entry counts in the month total');
    await writeManagedDocument(runner, tenantId, 'projects', created.id, 'purpose', 'Why we do it.');

    const edited = await controller.creationChanges(created.id, created.creation_token, asCreator);
    assert.deepEqual(edited.changes.children.document, 1, 'the written purpose');
    assert.deepEqual(edited.changes.children.attachment, 1, 'the attachment');
    assert.deepEqual(edited.changes.children.time_entry, 1, 'the time entry');

    // Another person's token, another project's, none, an expired one: refused.
    const asOther = tenantContext(seed, otherId, runner.manager);
    await refusedAsExpired(controller.creationChanges(created.id, created.creation_token, asOther), 'other user, preflight');
    await refusedAsExpired(controller.cancelCreation(created.id, { token: created.creation_token }, asOther), 'other user');
    await refusedAsExpired(controller.cancelCreation(created.id, { token: other.creation_token }, asCreator), 'other project');
    await refusedAsExpired(controller.cancelCreation(created.id, {}, asCreator), 'no token');
    const expired = issueCreationToken(
      { tenantId, family: 'projects', recordId: created.id, userId: creatorId },
      { now: Date.now() - 25 * 60 * 60 * 1000 },
    );
    await refusedAsExpired(controller.cancelCreation(created.id, { token: expired }, asCreator), 'expired token');

    await controller.cancelCreation(created.id, { token: created.creation_token }, asCreator);
    const left = (table: string, column = 'project_id') =>
      count(runner, `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1 AND ${column} = $2`, [tenantId, created.id]);
    assert.equal(await left('portfolio_projects', 'id'), 0, 'the project is gone');
    assert.equal(await left('portfolio_project_phases'), 0, 'its phase is gone');
    assert.equal(await left('portfolio_project_team'), 0, 'its team is gone');
    assert.equal(await left('portfolio_project_attachments'), 0, 'its attachment row is gone');
    assert.equal(await left('portfolio_project_time_entries'), 0, 'its time entry is gone');
    assert.equal(await count(runner, `SELECT count(*)::int AS n FROM tasks WHERE tenant_id = $1 AND id = $2`, [tenantId, taskId]), 0, 'its task is gone');
    assert.equal(await boundDocuments(runner, tenantId, 'projects', created.id), 0, 'its purpose is gone');
    assert.deepEqual(storage.deleted, [path], 'its attachment file is removed');
    assert.equal(await hoursOf(), 0, 'the month total is computed again');
    assert.deepEqual(await deletionAuthors(runner, tenantId, 'portfolio_projects', created.id), [creatorId], 'the delete is audited under its creator');
    assert.equal(await count(runner, `SELECT count(*)::int AS n FROM portfolio_projects WHERE tenant_id = $1 AND id = $2`, [tenantId, other.id]), 1, 'the other project stays');
  });
}

async function testRequestLinkedProjectIsRefused() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedCreationTenant(runner, { portfolio_projects: 'member' });
    const { tenantId, creatorId } = seed;
    const { controller } = controllerFor(runner);
    const asCreator = tenantContext(seed, creatorId, runner.manager);
    const created: any = await controller.create({ name: 'Linked project', origin: 'fast_track' } as any, asCreator);
    const [{ id: requestId }] = await runner.query(
      `INSERT INTO portfolio_requests (tenant_id, name, item_number) VALUES ($1, 'Origin request', 990001) RETURNING id`,
      [tenantId],
    );
    await runner.query(`INSERT INTO portfolio_request_projects (tenant_id, request_id, project_id) VALUES ($1, $2, $3)`, [tenantId, requestId, created.id]);

    await assert.rejects(controller.cancelCreation(created.id, { token: created.creation_token }, asCreator), (error: unknown) => {
      assert.ok(error instanceof ConflictException, 'a 409');
      assert.equal((error.getResponse() as any).code, 'PROJECT_FROM_REQUEST');
      return true;
    });
    assert.equal(await count(runner, `SELECT count(*)::int AS n FROM portfolio_projects WHERE tenant_id = $1 AND id = $2`, [tenantId, created.id]), 1, 'the project stays');
  });
}

async function main() {
  await dataSource.initialize();
  try {
    testRoutesNeedTheCreateLevel();
    console.log('  ok testRoutesNeedTheCreateLevel');
    await testCreatorCancelsTheCreation();
    console.log('  ok testCreatorCancelsTheCreation');
    await testRequestLinkedProjectIsRefused();
    console.log('  ok testRequestLinkedProjectIsRefused');
  } finally {
    await dataSource.destroy();
    await closeMarkdownWorkers();
  }
  console.log('project-cancel-creation.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
