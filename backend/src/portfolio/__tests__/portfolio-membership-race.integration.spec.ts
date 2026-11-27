import 'dotenv/config';
import 'reflect-metadata';
import type { EntityManager } from 'typeorm';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { ItemNumberService } from '../../common/item-number.service';
import { managedDocumentServices } from '../../common/creation/__tests__/creation-cancel.fixtures';
import { assert, assertSucceeded, progress, Race, runRaceSpecs, settle, withRace } from '../../spend/__tests__/race-harness';
import { Task } from '../../tasks/task.entity';
import { TasksUnifiedService } from '../../tasks/tasks-unified.service';
import { PortfolioProject } from '../portfolio-project.entity';
import { PortfolioRequest } from '../portfolio-request.entity';
import { PortfolioRequestsService } from '../portfolio-requests.service';
import { PortfolioProjectsCrudService } from '../services/portfolio-projects-crud.service';

// Two writes of a stream pair at the same moment (lot I7a of 26.12.1): one sets the stream, the other
// changes the category. The record is read under the write's lock (`membershipReadLock`), so the second
// write waits for the first and is checked on what it stored: the category changed after the stream
// drops it, and no record ends with a stream of another category. A request, a project and a task.

type Seeded = { it: string; biz: string; opsIt: string; request: string; project: string; task: string; user: string };

async function seedRecords(race: Race): Promise<Seeded> {
  return race.seedWith(async (runner) => {
    const tenant = race.tenantId;
    const [it] = await runner.query(`INSERT INTO portfolio_categories (tenant_id, name) VALUES ($1, 'IT') RETURNING id`, [tenant]);
    const [biz] = await runner.query(`INSERT INTO portfolio_categories (tenant_id, name) VALUES ($1, 'Business') RETURNING id`, [tenant]);
    const [opsIt] = await runner.query(`INSERT INTO portfolio_streams (tenant_id, category_id, name) VALUES ($1, $2, 'Ops') RETURNING id`, [tenant, it.id]);
    const [request] = await runner.query(
      `INSERT INTO portfolio_requests (tenant_id, item_number, name, status, category_id) VALUES ($1, 1, 'Request', 'pending_review', $2) RETURNING id`,
      [tenant, it.id],
    );
    const [project] = await runner.query(
      `INSERT INTO portfolio_projects (tenant_id, item_number, name, status, origin, execution_progress, category_id)
       VALUES ($1, 1, 'Project', 'in_progress', 'fast_track', 0, $2) RETURNING id`,
      [tenant, it.id],
    );
    const [task] = await runner.query(
      `INSERT INTO tasks (tenant_id, item_number, title, status, category_id, labels, viewer_ids, owner_ids)
       VALUES ($1, 1, 'Task', 'open', $2, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb) RETURNING id`,
      [tenant, it.id],
    );
    const [role] = await runner.query(
      `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in) VALUES ($1, 'Race writer', 'Race writer', false, false) RETURNING id`,
      [tenant],
    );
    const [user] = await runner.query(
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, mfa_enabled, status) VALUES ($1, 'race-membership@example.com', 'Race', 'Writer', $2, false, 'enabled') RETURNING id`,
      [tenant, role.id],
    );
    return { it: it.id, biz: biz.id, opsIt: opsIt.id, request: request.id, project: project.id, task: task.id, user: user.id };
  });
}

const quiet = { notifyTeamAdded: () => undefined, notifyItLeadOfTeamChange: () => undefined, getProjectRecipients: async () => [], getRequestRecipients: async () => [], notifyStatusChange: () => undefined };

/** The write of one family, on the party's connection. */
function writer(family: 'request' | 'project' | 'task', tenantId: string, userId: string) {
  return (manager: EntityManager, id: string, body: Record<string, unknown>): Promise<unknown> => {
    const audit = new AuditService(manager.getRepository(AuditLog));
    if (family === 'request') {
      const service = new PortfolioRequestsService(
        manager.getRepository(PortfolioRequest), audit, {} as any, {} as any, { logChange: async () => undefined } as any, quiet as any,
        new ItemNumberService(), {} as any, managedDocumentServices(manager),
      );
      return service.update(id, body as any, tenantId, null as any, { manager });
    }
    if (family === 'project') {
      const service = new PortfolioProjectsCrudService(
        manager.getRepository(PortfolioProject), manager.getRepository(PortfolioRequest), audit,
        { calculateEffortFromCriteria: async () => ({ estimated_effort_it: null, estimated_effort_business: null }) } as any,
        quiet as any, new ItemNumberService(), managedDocumentServices(manager),
      );
      return service.update(id, body as any, tenantId, null, { manager });
    }
    const service = new TasksUnifiedService(
      manager.getRepository(Task), audit, undefined as any, { recalculateForTask: async () => undefined } as any, quiet as any, new ItemNumberService(),
      { logChange: async () => undefined } as any, undefined as any, { recalculateActualEffort: async () => undefined } as any,
    );
    return service.updateById(id, body as any, userId, { manager, tenantId });
  };
}

/** The membership check of the stream write: it has read its record, and pauses before it checks. */
const streamCheck = (text: string) => /FROM portfolio_streams\s+WHERE tenant_id/.test(text);

function streamThenCategory(family: 'request' | 'project' | 'task') {
  const table = { request: 'portfolio_requests', project: 'portfolio_projects', task: 'tasks' }[family];
  return async () => {
    await withRace(`membership-${family}`, async (race) => {
      const seeded = await seedRecords(race);
      const id = seeded[family];
      const write = writer(family, race.tenantId, seeded.user);
      const streamSide = await race.open('the stream write');
      const categorySide = await race.open('the category write');
      const checking = race.gate(streamSide, { label: 'the stream checked', when: 'before', match: streamCheck });
      const stream = race.start(streamSide, (manager) => write(manager, id, { stream_id: seeded.opsIt }));
      assert.equal(await progress(stream, { party: streamSide, gate: checking }), 'gated', 'harness: the stream write pauses at its check');
      const category = race.start(categorySide, (manager) => write(manager, id, { category_id: seeded.biz }));
      assert.equal(await progress(category, { party: categorySide }), 'blocked', `${family}: the category write waits for the stream write`);
      checking.release();
      assertSucceeded(await settle(stream), 'the stream write');
      assertSucceeded(await settle(category), 'the category write');
      const stored = await race.readOne(`SELECT category_id, stream_id FROM ${table} WHERE id = $1`, [id]);
      assert.deepEqual(stored, { category_id: seeded.biz, stream_id: null }, `${family}: the category changed after the stream drops it`);
    });
  };
}

void runRaceSpecs('portfolio-membership-race', [
  ['a request: the stream and the category written at the same moment', streamThenCategory('request')],
  ['a project: the stream and the category written at the same moment', streamThenCategory('project')],
  ['a task: the stream and the category written at the same moment', streamThenCategory('task')],
]);
