// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import appDataSource from '../../data-source';
import { applyDataAccess } from '../data-access';
import { DATA_ACCESS_READ_ONLY_LINE_MESSAGE, DataAccessLimitedException, lineEditableField } from '../line-write-checks';
import { DATA_ACCESS_READ_ONLY_TASK_MESSAGE, DATA_ACCESS_TASK_DELETE_MESSAGE } from '../../tasks/task-data-access';
import { TaskTimeEntriesService } from '../../tasks/task-time-entries.service';
import { TaskAttachmentsService } from '../../tasks/task-attachments.service';
import { TasksDeleteService } from '../../tasks/tasks-delete.service';
import { Task } from '../../tasks/task.entity';
import { TaskTimeEntry } from '../../tasks/task-time-entry.entity';
import { TaskAttachment } from '../../tasks/task-attachment.entity';
import { replaceItemApplications } from '../../spend/item-applications';
import { readSuccessor } from '../../spend/budget-line-lineage';
import { SUMMARY_SCOPES } from '../../spend/spend-summary.builder';
import * as budgetList from '../../spend/budget-list/budget-list.service';
import { realSummaryDeps } from '../../spend/__tests__/oracle/oracle-deps';
import { LIMITED_ROLE, PgClient, roleExists } from './data-access-test-helpers';
import { nextItemNumber, Seed, seed } from './data-access-line-seed';

/**
 * Data-scoped access, lot 3 run 3B2 (planning/data-scoped-access/spec.md §4.4, §6.7, §6.8): on the
 * reference example of lot 2 (`data-access-line-seed.ts`), in one rolled-back transaction, each
 * person in a savepoint after `applyDataAccess`, through the real services:
 *
 * - the elements of a task the person may not modify (time entries, attachments) are refused with
 *   the clear 403 before anything is written, stored or deleted;
 * - a task whose line the person may not modify is not deleted by its assignee (403), its history
 *   stays;
 * - a line-side link replacement on a read-only line answers 403, on a hidden line 404;
 * - a successor out of access is unseen by the one-successor check, and the unique key refuses it
 *   (the type change turns that into 409 LINE_ALREADY_REPLACED);
 * - the budget list says `dataAccessLimited` and `editable` per row in limited mode, the line read
 *   by id says `editable`; for an unscoped person nothing is added and no query is run for it.
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 2 });

function clientOf(runner: QueryRunner): PgClient {
  return { query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params as any[]) }) } as unknown as PgClient;
}

async function refusedWith(fn: () => Promise<unknown>, message: string, status = 403): Promise<void> {
  await assert.rejects(fn, (err: any) => {
    assert.equal(err?.getStatus?.(), status, `status ${status}: ${err?.message}`);
    if (status === 403) {
      assert.ok(err instanceof DataAccessLimitedException);
      assert.equal((err.getResponse() as any).code, 'DATA_ACCESS_LIMITED');
    }
    assert.equal(err.message, message);
    return true;
  });
}

async function as(runner: QueryRunner, person: string, fn: (m: EntityManager) => Promise<void>): Promise<void> {
  await runner.query('SAVEPOINT person');
  try {
    await applyDataAccess(runner, person);
    await fn(runner.manager);
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT person');
  }
}

/** Counts the statements `fn` runs on the runner, with their text. */
async function statementsOf(runner: QueryRunner, fn: () => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const original = runner.query.bind(runner);
  (runner as any).query = (sql: string, ...rest: any[]) => { seen.push(sql); return (original as any)(sql, ...rest); };
  try {
    await fn();
  } finally {
    (runner as any).query = original;
  }
  return seen;
}

const audit = { log: async () => undefined } as any;

async function testTaskElements(runner: QueryRunner, s: Seed) {
  const { persons: p } = s;
  const q = (sql: string, params?: unknown[]) => runner.query(sql, params as any[]);
  let number = 910000 + Math.floor(Math.random() * 1000);
  const task = async (line: string, assignee: string | null, viewers: string[]) => (await q(
    `INSERT INTO tasks (tenant_id, title, item_number, related_object_type, related_object_id, assignee_user_id, owner_ids, viewer_ids)
     VALUES (app_current_tenant(), 'DA 3B2 task', $1, 'spend_item', $2, $3, '[]'::jsonb, $4::jsonb) RETURNING id`,
    [number++, line, assignee, JSON.stringify(viewers)],
  ))[0].id as string;
  // L3 is read only for Rita: she observes one task of it and is assigned another.
  const observed = await task(s.lines.L3, null, [p.rita]);
  const assigned = await task(s.lines.L3, p.rita, []);
  const entry = (await q(
    `INSERT INTO task_time_entries (tenant_id, task_id, user_id, hours, category, logged_by_id, logged_at)
     VALUES (app_current_tenant(), $1, $2, 1, 'it', $2, now()) RETURNING id`, [observed, p.rita],
  ))[0].id as string;
  const attachment = (await q(
    `INSERT INTO task_attachments (tenant_id, task_id, original_filename, stored_filename, mime_type, size, storage_path)
     VALUES (app_current_tenant(), $1, 'a.txt', 'a.txt', 'text/plain', 1, 'spec/da-3b2/a.txt') RETURNING id`, [observed],
  ))[0].id as string;
  await q(
    `INSERT INTO portfolio_activities (tenant_id, task_id, author_id, type, content) VALUES (app_current_tenant(), $1, $2, 'comment', 'kept')`,
    [assigned, p.rita],
  );

  const storage = { puts: 0, deletes: 0, putObject: async () => { storage.puts += 1; }, deleteObject: async () => { storage.deletes += 1; } };
  const aggregates = { recalculateForEntryChange: async () => undefined, recalculateUserMonth: async () => undefined } as any;
  await as(runner, p.rita, async (m) => {
    const entries = new TaskTimeEntriesService(m.getRepository(TaskTimeEntry), m.getRepository(Task), audit, { recalculateActualEffort: async () => undefined } as any, aggregates);
    await refusedWith(() => entries.create(observed, { hours: 1, logged_at: new Date() }, p.rita, false, { manager: m }), DATA_ACCESS_READ_ONLY_TASK_MESSAGE);
    await refusedWith(() => entries.update(entry, { hours: 2 }, p.rita, false, { manager: m }), DATA_ACCESS_READ_ONLY_TASK_MESSAGE);
    await refusedWith(() => entries.delete(entry, p.rita, { manager: m }), DATA_ACCESS_READ_ONLY_TASK_MESSAGE);
    // The assignee is responsible: the task is modifiable, a time entry passes.
    await entries.create(assigned, { hours: 1, logged_at: new Date() }, p.rita, false, { manager: m });

    const files = new TaskAttachmentsService(m.getRepository(TaskAttachment), storage as any, audit, {} as any, {} as any);
    const file = { originalname: 'b.txt', mimetype: 'text/plain', buffer: Buffer.from('x'), size: 1 } as any;
    await refusedWith(() => files.uploadAttachment(observed, file, p.rita, { manager: m }), DATA_ACCESS_READ_ONLY_TASK_MESSAGE);
    await refusedWith(() => files.deleteAttachment(attachment, p.rita, { manager: m }), DATA_ACCESS_READ_ONLY_TASK_MESSAGE);
    assert.deepEqual([storage.puts, storage.deletes], [0, 0], 'nothing stored or deleted before the refusal');

    // Responsible, but the line is read only: the delete would touch no row; refused, history kept.
    const deletes = new TasksDeleteService(m.getRepository(Task), audit, aggregates);
    await refusedWith(() => deletes.delete(assigned, { manager: m, userId: p.rita }), DATA_ACCESS_TASK_DELETE_MESSAGE);
    const [kept] = await m.query(`SELECT count(*)::int AS n FROM portfolio_activities WHERE task_id = $1`, [assigned]);
    assert.equal(kept.n, 1, 'the history of a task not deleted stays');
  });
  await as(runner, p.marta, async (m) => {
    // L3 is Marta's to modify: she deletes the task.
    const deletes = new TasksDeleteService(m.getRepository(Task), audit, aggregates);
    await deletes.delete(assigned, { manager: m, userId: p.marta });
    assert.equal((await m.query(`SELECT 1 FROM tasks WHERE id = $1`, [assigned])).length, 0);
  });
  console.log('  task elements and task delete: clear 403 before any write, store or delete; the object\'s editor deletes: OK');
}

async function testLineLinksAndSuccessor(runner: QueryRunner, s: Seed) {
  const { persons: p } = s;
  const deps = { manager: runner.manager, audit };
  const line = (label: 'L1' | 'L3' | 'L5') => ({ id: s.lines[label], tenant_id: s.tenantId }) as any;
  await as(runner, p.rita, async () => {
    await replaceItemApplications(deps, 'opex', line('L1'), [], p.rita);
    await refusedWith(() => replaceItemApplications(deps, 'opex', line('L3'), [], p.rita), DATA_ACCESS_READ_ONLY_LINE_MESSAGE);
    await assert.rejects(() => replaceItemApplications(deps, 'opex', line('L5'), [], p.rita), (err: any) => err?.getStatus?.() === 404);
  });
  // L5 (out of Rita's access) continues L1: Rita does not see the successor, the key refuses a second.
  await runner.query(`UPDATE spend_items SET predecessor_id = $1 WHERE id = $2`, [s.lines.L1, s.lines.L5]);
  await as(runner, p.rita, async (m) => {
    assert.equal(await readSuccessor(m, s.tenantId, s.lines.L1), null, 'a successor out of access is not seen');
    await assert.rejects(
      () => m.query(
        `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, paying_company_id, cost_center_id, predecessor_id)
         VALUES (app_current_tenant(), 'DA 3B2 successor', 'EUR', '2027-01-01', $1, $2, $3, $4)`,
        [nextItemNumber(), s.fr, s.infFr, s.lines.L1],
      ),
      (err: any) => (err?.driverError?.code ?? err?.code) === '23505' && (err?.driverError?.constraint ?? err?.constraint) === 'uq_spend_items_tenant_predecessor',
    );
  });
  await runner.query(`UPDATE spend_items SET predecessor_id = NULL WHERE id = $1`, [s.lines.L5]);
  console.log('  line-side links: 403 on a read-only line, 404 on a hidden one; a hidden successor meets the unique key: OK');
}

async function testList(runner: QueryRunner, s: Seed) {
  const { persons: p } = s;
  const scope = SUMMARY_SCOPES.opex;
  const deps = realSummaryDeps(scope);
  const query = { limit: 100, status: 'all' };
  const ours = new Set(Object.values(s.lines));
  await as(runner, p.rita, async (m) => {
    const page = await budgetList.budgetListSummary(scope, deps, query, m);
    assert.equal(page.dataAccessLimited, true);
    const editable = new Map(page.items.filter((row) => ours.has(row.id)).map((row) => [row.id, row.editable]));
    assert.deepEqual(
      Object.fromEntries((['L1', 'L2', 'L3', 'L4'] as const).map((label) => [label, editable.get(s.lines[label])])),
      { L1: true, L2: false, L3: false, L4: false },
      'editable per row, by the policies\' function',
    );
    assert.equal(editable.has(s.lines.L5), false, 'L5 is out of read access');
    const totals = await budgetList.budgetListTotals(scope, deps, query, m);
    assert.equal((totals as any).dataAccessLimited, true);
    assert.deepEqual(await lineEditableField(m, s.lines.L1), { editable: true });
    assert.deepEqual(await lineEditableField(m, s.lines.L3), { editable: false });
  });
  await as(runner, p.ulla, async (m) => {
    let page: Awaited<ReturnType<typeof budgetList.budgetListSummary>> | null = null;
    let totals: Record<string, unknown> | null = null;
    let field: Record<string, unknown> | null = null;
    const statements = await statementsOf(runner, async () => {
      page = await budgetList.budgetListSummary(scope, deps, query, m);
      totals = await budgetList.budgetListTotals(scope, deps, query, m);
      field = await lineEditableField(m, s.lines.L3);
    });
    assert.equal('dataAccessLimited' in page!, false, 'no flag for an unscoped person');
    assert.ok(page!.items.length >= 7);
    assert.ok(page!.items.every((row) => !('editable' in row)), 'no editable column for an unscoped person');
    assert.equal('dataAccessLimited' in totals!, false);
    assert.deepEqual(field, {});
    const extra = statements.filter((sql) => /data_access_line_editable|app\.da_mode/.test(sql));
    assert.deepEqual(extra, [], 'an unscoped person: no column and no query for data access');
  });
  console.log('  budget list: editable per row and dataAccessLimited when limited, nothing added (no query) when unscoped: OK');
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    if (!(await roleExists(clientOf(runner)))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`data access write checks (tasks, list): ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('data access write checks: tasks, links, list (lot 3, run 3B2)');
    await runner.startTransaction();
    try {
      const s = await seed(clientOf(runner));
      await testTaskElements(runner, s);
      await testLineLinksAndSuccessor(runner, s);
      await testList(runner, s);
    } finally {
      await runner.rollbackTransaction();
    }
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
