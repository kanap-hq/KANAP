// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { ItemNumberService } from '../../common/item-number.service';
import { closeMarkdownWorkers } from '../../common/markdown-worker';
import { inRolledBackTransaction, managedDocumentServices, seedCreationTenant } from '../../common/creation/__tests__/creation-cancel.fixtures';
import { tasksRegistry } from '../../ai/query/registries/tasks.registry';
import { PortfolioProject } from '../../portfolio/portfolio-project.entity';
import { PortfolioRequest } from '../../portfolio/portfolio-request.entity';
import { PortfolioProjectsCrudService } from '../../portfolio/services/portfolio-projects-crud.service';
import { TasksService } from '../../spend/tasks.service';
import { Task } from '../task.entity';
import { TasksUnifiedService } from '../tasks-unified.service';
import { shownTaskClassification } from '../task-shown-classification';

// The stream a task of a project shows (lot I7a of 26.12.1, review case A2): its project's only when
// the task has no category of its own or its project's. A task moved to another category than its
// project shows no stream, never a stream of the project's category: in the list, on the record, in
// Kad's grouping, and in the TypeScript form the services and the export read.

async function seed(runner: QueryRunner) {
  const base = await seedCreationTenant(runner, { portfolio_projects: 'admin', portfolio_requests: 'admin', tasks: 'admin' });
  const { tenantId } = base;
  const ids = { it: randomUUID(), biz: randomUUID(), opsIt: randomUUID(), opsBiz: randomUUID() };
  await runner.query(`INSERT INTO portfolio_categories (id, tenant_id, name) VALUES ($1, $3, 'IT'), ($2, $3, 'Business')`, [ids.it, ids.biz, tenantId]);
  await runner.query(
    `INSERT INTO portfolio_streams (id, tenant_id, category_id, name) VALUES ($1, $3, $4, 'Ops IT'), ($2, $3, $5, 'Ops Business')`,
    [ids.opsIt, ids.opsBiz, tenantId, ids.it, ids.biz],
  );
  return { ...base, ids };
}

function services(runner: QueryRunner) {
  const manager = runner.manager;
  const audit = new AuditService(manager.getRepository(AuditLog));
  const quiet = { notifyTeamAdded: () => undefined, notifyItLeadOfTeamChange: () => undefined, getProjectRecipients: async () => [], notifyStatusChange: () => undefined };
  const projects = new PortfolioProjectsCrudService(
    manager.getRepository(PortfolioProject), manager.getRepository(PortfolioRequest), audit,
    { calculateEffortFromCriteria: async () => ({ estimated_effort_it: null, estimated_effort_business: null }) } as any,
    quiet as any, new ItemNumberService(), managedDocumentServices(manager),
  );
  const tasks = new TasksUnifiedService(
    manager.getRepository(Task), audit, undefined as any, { recalculateForTask: async () => undefined } as any, quiet as any, new ItemNumberService(),
    { logChange: async () => undefined } as any, undefined as any, { recalculateActualEffort: async () => undefined } as any,
  );
  return { projects, tasks };
}

async function testShownStream() {
  await inRolledBackTransaction(async (runner) => {
    const { ids, tenantId, creatorId } = await seed(runner);
    const { projects, tasks } = services(runner);
    const opts = { manager: runner.manager, tenantId };
    const project: any = await projects.create({ name: 'Project IT', origin: 'fast_track', category_id: ids.it, stream_id: ids.opsIt } as any, tenantId, creatorId, { manager: runner.manager });
    const create = async (title: string) => (await tasks.createForTarget({ type: 'project', id: project.id, payload: { title } as any }, creatorId, opts) as any).id as string;
    const follows = await create('Follows its project');
    const ownIt = await create('Own category, the project one');
    const moved = await create('Moved to Business');
    const ownStream = await create('Own Business stream');
    // Tasks that follow their project, as the backfill left them, and the category changed alone (A2).
    await runner.query(`UPDATE tasks SET category_id = NULL, stream_id = NULL WHERE id = $1`, [follows]);
    await runner.query(`UPDATE tasks SET stream_id = NULL WHERE id = $1`, [ownIt]);
    await tasks.updateById(moved, { category_id: ids.biz } as any, creatorId, opts);
    await tasks.updateById(ownStream, { category_id: ids.biz, stream_id: ids.opsBiz } as any, creatorId, opts);
    const expected: Record<string, [string, string | null]> = {
      [follows]: [ids.it, ids.opsIt],
      [ownIt]: [ids.it, ids.opsIt],
      [moved]: [ids.biz, null],
      [ownStream]: [ids.biz, ids.opsBiz],
    };

    // The list and the record.
    const list = new TasksService(dataSource);
    const { items } = await list.listAllTasks({ limit: '50' }, opts as any);
    for (const [id, [category, stream]] of Object.entries(expected)) {
      const item: any = items.find((row: any) => row.id === id);
      assert.ok(item, `listed: ${id}`);
      assert.deepEqual([item.category_id, item.stream_id], [category, stream], `the list: ${item.title}`);
      assert.equal(item.stream_name, stream === ids.opsIt ? 'Ops IT' : stream === ids.opsBiz ? 'Ops Business' : null, `the list name: ${item.title}`);
      const record: any = await list.getOne(id, opts as any);
      assert.deepEqual([record.category_id, record.stream_id], [category, stream], `the record: ${item.title}`);
    }

    // Kad's grouping by stream.
    const group = (tasksRegistry as any).aggregate.groupFields.stream;
    const grouped = await runner.query(
      `SELECT t.id::text AS id, ${group.expression} AS stream FROM tasks t ${[...new Set(group.joins as string[])].join(' ')} WHERE t.tenant_id = $1`,
      [tenantId],
    );
    const streamName = (id: string) => grouped.find((row: any) => row.id === id)?.stream ?? null;
    assert.deepEqual([streamName(follows), streamName(ownIt), streamName(moved), streamName(ownStream)], ['Ops IT', 'Ops IT', null, 'Ops Business'], 'Kad');

    // The TypeScript form gives the same values.
    const [stored] = await runner.query(`SELECT category_id, stream_id FROM portfolio_projects WHERE id = $1`, [project.id]);
    for (const [id, [category, stream]] of Object.entries(expected)) {
      const [task] = await runner.query(`SELECT source_id, category_id, stream_id, company_id FROM tasks WHERE id = $1`, [id]);
      const shown = shownTaskClassification(task, stored);
      assert.deepEqual([shown.category_id, shown.stream_id], [category, stream], `the TypeScript form: ${id}`);
    }
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const [name, test] of [['the stream a project task shows', testShownStream]] as Array<[string, () => Promise<void>]>) {
      try {
        await test();
        console.log(`ok - ${name}`);
      } catch (error) {
        failures.push(name);
        console.error(`not ok - ${name}\n${(error as Error).stack}`);
      }
    }
  } finally {
    await closeMarkdownWorkers();
    await dataSource.destroy();
  }
  if (failures.length > 0) process.exit(1);
}

void main();
