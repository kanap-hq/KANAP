// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';
import {
  RecordHistoryService,
  type RecordHistoryChange,
  type RecordHistoryContext,
  type RecordHistoryItem,
  type RecordHistoryPage,
} from '../record-history.service';
import { audit, seedHistoryData, seedPerson, type HistorySeed, type Level, type Person } from './record-history.fixtures';

// The task history (lot 2, linked records) on the migrated database: its own rows in words (the
// record it belongs to, the hidden description, the conversion into a request), every child kind
// through the real writer (so the payload rules fill `parent_*`), the application and asset link
// sets read by `record_id`, the references named only with the reader's modules, and the access
// rules: 403 without the tasks module, 404 for an unknown or foreign task, for a Business
// Contributor who does not take part in it, for a task of a confidential incident the reader may
// not see, and for a task of a budget line outside a limited person's scope. The task also shows,
// once, in the history of its budget line.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const TASK_ONLY: Record<string, Level> = { tasks: 'reader' };
const ALL_MODULES: Record<string, Level> = {
  tasks: 'reader', budget: 'reader', applications: 'reader', infrastructure: 'reader', incidents: 'reader',
  portfolio_projects: 'reader', portfolio_requests: 'reader', companies: 'reader', contracts: 'reader',
};
const LIMITED_MODULES: Record<string, Level> = { tasks: 'reader', budget: 'reader' };
const BC_PERMISSIONS: Record<string, Level> = { tasks: 'reader', budget: 'reader' };

type Seeded = {
  data: HistorySeed;
  task: string;
  bcTask: string;
  confidentialTask: string;
  hiddenLineTask: string;
  allReader: Person;
  taskReader: Person;
  noModules: Person;
  bc: Person;
  reporter: Person;
  limited: Person;
};

async function readPage(
  person: Person,
  tenantId: string,
  table: string,
  id: string,
  permissions: Record<string, Level>,
  limited = false,
): Promise<RecordHistoryPage> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    if (limited) {
      const rows: Array<{ mode: string }> = await runner.query(`SELECT data_access_apply($1) AS mode`, [person.id]);
      assert.equal(rows[0]?.mode, 'limited', 'the transaction takes the limited role');
    }
    const ctx: RecordHistoryContext = { tenantId, userId: person.id, isAdmin: false, permissions, manager: runner.manager };
    return await new RecordHistoryService().list(ctx, table, id, { limit: '100' });
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }
}

function changes(page: RecordHistoryPage, field: string, event?: 'added' | 'removed'): Array<{ item: RecordHistoryItem; change: RecordHistoryChange }> {
  const out: Array<{ item: RecordHistoryItem; change: RecordHistoryChange }> = [];
  for (const item of page.items) {
    for (const change of item.changes) {
      if (change.field === field && (event === undefined || change.event === event)) out.push({ item, change });
    }
  }
  return out;
}

function one(page: RecordHistoryPage, field: string, event?: 'added' | 'removed') {
  const found = changes(page, field, event);
  assert.equal(found.length, 1, `${field}${event ? ` ${event}` : ''}: one change`);
  return found[0];
}

function labelOf(value: unknown): string | null {
  return value && typeof value === 'object' && !('hidden' in value) ? (value as any).label ?? null : null;
}

async function insertTask(runner: QueryRunner, tenantId: string, values: {
  itemNumber: number; title: string; type: string; relatedId: string; assignee?: string | null;
}): Promise<{ id: string; row: Record<string, unknown> }> {
  const [task] = await runner.query(
    `INSERT INTO tasks (tenant_id, item_number, title, related_object_type, related_object_id, assignee_user_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, to_jsonb(tasks) AS row`,
    [tenantId, values.itemNumber, values.title, values.type, values.relatedId, values.assignee ?? null],
  );
  return { id: task.id as string, row: task.row as Record<string, unknown> };
}

async function seedAudits(runner: QueryRunner, data: HistorySeed): Promise<Seeded> {
  const allReader = await seedPerson(runner, data.tenantId, { first: 'Alba', last: 'All' }, ALL_MODULES);
  const taskReader = await seedPerson(runner, data.tenantId, { first: 'Tess', last: 'Tasks' }, TASK_ONLY);
  const noModules = await seedPerson(runner, data.tenantId, { first: 'Nino', last: 'None' }, { budget: 'reader' });
  const reporter = await seedPerson(runner, data.tenantId, { first: 'Remi', last: 'Reporter' }, ALL_MODULES);
  const bc = await seedPerson(
    runner, data.tenantId, { first: 'Baptiste', last: 'Contributor' }, BC_PERMISSIONS, { exactRoleName: 'Business Contributor' },
  );
  const limited = await seedPerson(
    runner, data.tenantId, { first: 'Lila', last: 'Limited' }, LIMITED_MODULES, { mode: 'limited', nodeCompanyId: data.companyA },
  );

  // The fixture task (T-5) belongs to the main OPEX line.
  const task = data.task;
  const [stored] = await runner.query(`SELECT to_jsonb(t) AS row FROM tasks t WHERE t.id = $1`, [task]);
  const row = stored.row as Record<string, unknown>;
  const by = { userId: allReader.id };

  await audit(runner, { table: 'tasks', recordId: task, action: 'create', after: { ...row, description: 'Private first plan' }, ...by });
  // The portfolio classification, named as on the project.
  const [{ id: sourceId }] = await runner.query(
    `INSERT INTO portfolio_sources (tenant_id, name) VALUES ($1, 'Task source') RETURNING id`, [data.tenantId],
  );
  const [{ id: categoryId }] = await runner.query(
    `INSERT INTO portfolio_categories (tenant_id, name) VALUES ($1, 'Task category') RETURNING id`, [data.tenantId],
  );
  const [{ id: streamId }] = await runner.query(
    `INSERT INTO portfolio_streams (tenant_id, category_id, name) VALUES ($1, $2, 'Task stream') RETURNING id`,
    [data.tenantId, categoryId],
  );
  await audit(runner, {
    table: 'tasks', recordId: task, action: 'update', ...by,
    before: { ...row, description: 'Private first plan' },
    after: {
      ...row, title: 'Follow up now', status: 'in_progress', description: 'Private second plan',
      source_id: sourceId, category_id: categoryId, stream_id: streamId,
    },
  });

  const attachment = {
    id: randomUUID(), tenant_id: data.tenantId, task_id: task, original_filename: 'note.txt', stored_filename: 's.txt',
    mime_type: 'text/plain', size: 10, storage_path: 'files/note.txt', source_field: 'attachments', uploaded_by_id: allReader.id,
    uploaded_at: '2026-01-01T00:00:00.000Z',
  };
  await audit(runner, { table: 'task_attachments', recordId: attachment.id, action: 'create', before: null, after: attachment, ...by });
  await audit(runner, { table: 'task_attachments', recordId: attachment.id, action: 'delete', before: attachment, after: null, ...by });
  const entry = {
    id: randomUUID(), tenant_id: data.tenantId, task_id: task, user_id: allReader.id, hours: 2, category: 'project',
    logged_at: '2026-01-05', notes: 'Analysis', logged_by_id: allReader.id,
  };
  await audit(runner, { table: 'task_time_entries', recordId: entry.id, action: 'create', before: null, after: entry, ...by });

  // The link sets written from the task (`syncTaskLinks`): record_id is the task, `{ ids }` before and after.
  for (const [label, id] of [['task_applications', data.application], ['task_assets', data.asset]] as const) {
    await audit(runner, { table: label, recordId: task, action: 'update', before: { ids: [] }, after: { ids: [id] }, ...by });
    await audit(runner, { table: label, recordId: task, action: 'update', before: { ids: [id] }, after: { ids: [] }, ...by });
  }

  // The conversion into a request closes the task and names the request beside the saved row.
  await audit(runner, {
    table: 'tasks', recordId: task, action: 'update', ...by,
    before: { ...row, title: 'Follow up now', status: 'in_progress' },
    after: { ...row, title: 'Follow up now', status: 'done', converted_to_request_id: data.request },
  });

  // A task the contributor takes part in (assignee), on the same line.
  const bcTask = await insertTask(runner, data.tenantId, { itemNumber: 31, title: 'Contributor task', type: 'spend_item', relatedId: data.opexLine, assignee: bc.id });
  await audit(runner, { table: 'tasks', recordId: bcTask.id, action: 'create', after: bcTask.row, ...by });

  // A confidential incident reported by `reporter`, with a task of its own.
  const [incident] = await runner.query(
    `INSERT INTO incidents (tenant_id, item_number, title, severity, confidential, reporter_user_id)
     VALUES ($1, 41, 'Breach', 'critical', true, $2) RETURNING id`,
    [data.tenantId, reporter.id],
  );
  const confidentialTask = await insertTask(runner, data.tenantId, { itemNumber: 32, title: 'Notify the regulator', type: 'incident', relatedId: incident.id });
  await audit(runner, { table: 'tasks', recordId: confidentialTask.id, action: 'create', after: confidentialTask.row, userId: reporter.id });

  // A task of the line of the other company, outside the limited person's scope.
  const hiddenLineTask = await insertTask(runner, data.tenantId, { itemNumber: 33, title: 'Hidden line task', type: 'spend_item', relatedId: data.hiddenLine });
  await audit(runner, { table: 'tasks', recordId: hiddenLineTask.id, action: 'create', after: hiddenLineTask.row, ...by });

  return {
    data, task, bcTask: bcTask.id, confidentialTask: confidentialTask.id, hiddenLineTask: hiddenLineTask.id,
    allReader, taskReader, noModules, bc, reporter, limited,
  };
}

async function testAccess(seeded: Seeded, foreign: HistorySeed) {
  const { data } = seeded;
  const page = await readPage(seeded.taskReader, data.tenantId, 'tasks', seeded.task, TASK_ONLY);
  assert.ok(page.items.length > 0, 'a reader of the tasks reads the history');
  await assert.rejects(
    () => readPage(seeded.noModules, data.tenantId, 'tasks', seeded.task, { budget: 'reader' }),
    (error: any) => error?.status === 403 && error?.response?.code === 'MODULE_RIGHT_REQUIRED',
    'no tasks module gets 403 MODULE_RIGHT_REQUIRED',
  );
  for (const [what, id] of [['an unknown id', randomUUID()], ['another tenant\'s task', foreign.task]] as const) {
    await assert.rejects(
      () => readPage(seeded.allReader, data.tenantId, 'tasks', id, ALL_MODULES),
      (error: any) => error?.status === 404,
      `${what} gets 404`,
    );
  }
  console.log('  200 with tasks, 403 without, 404 unknown and foreign: OK');

  // The Business Contributor reads only the tasks they take part in, as the task screen.
  await assert.rejects(
    () => readPage(seeded.bc, data.tenantId, 'tasks', seeded.task, BC_PERMISSIONS),
    (error: any) => error?.status === 404,
    'a Business Contributor outside the task gets 404',
  );
  const bcPage = await readPage(seeded.bc, data.tenantId, 'tasks', seeded.bcTask, BC_PERMISSIONS);
  assert.ok(bcPage.items.length > 0, 'the assignee reads the history of their task');

  // A task of a confidential incident: only who sees the incident reads it.
  await assert.rejects(
    () => readPage(seeded.allReader, data.tenantId, 'tasks', seeded.confidentialTask, ALL_MODULES),
    (error: any) => error?.status === 404,
    'a task of a confidential incident gets 404 for a reader outside the register rule',
  );
  const reporterPage = await readPage(seeded.reporter, data.tenantId, 'tasks', seeded.confidentialTask, ALL_MODULES);
  assert.ok(reporterPage.items.length > 0, 'the reporter reads the task of their incident');

  // A task of a line outside a limited person's scope.
  await assert.rejects(
    () => readPage(seeded.limited, data.tenantId, 'tasks', seeded.hiddenLineTask, LIMITED_MODULES, true),
    (error: any) => error?.status === 404,
    'a task of a line outside the person\'s data access gets 404',
  );
  const limitedPage = await readPage(seeded.limited, data.tenantId, 'tasks', seeded.task, LIMITED_MODULES, true);
  assert.ok(limitedPage.items.length > 0, 'a limited person reads a task of a line in their scope');
  console.log('  404 for a contributor outside the task, a confidential incident and a line out of scope: OK');
}

async function testRecordEntries(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.allReader, data.tenantId, 'tasks', seeded.task, ALL_MODULES);
  const records = page.items.filter((item) => item.subject.kind === 'record');

  const created = records.find((item) => item.action === 'create');
  assert.ok(created, 'the creation is an entry');
  assert.equal(created!.changes.find((change) => change.field === 'title')?.after, 'Follow up', 'the title in words');
  const belongs = created!.changes.find((change) => change.field === 'related_object');
  assert.equal(labelOf(belongs?.after), 'Main line', 'the line the task belongs to is named');
  assert.equal((belongs?.after as any)?.reference, 'BL-1');

  const updated = { ...page, items: records.filter((item) => item.action === 'update') };
  const title = one(updated, 'title');
  assert.deepEqual([title.change.before, title.change.after], ['Follow up', 'Follow up now']);
  assert.deepEqual(one(updated, 'description').change, { field: 'description', text: 'descriptionChanged' }, 'the description says changed, never its text');
  assert.equal(changes(updated, 'related_object').length, 0, 'an update that keeps the record names no record');
  for (const [field, name] of [['source_id', 'Task source'], ['category_id', 'Task category'], ['stream_id', 'Task stream']] as const) {
    assert.equal(labelOf(one(updated, field).change.after), name, `${field} is named as on the project`);
  }

  const converted = one(page, 'converted_to_request');
  assert.equal(labelOf(converted.change.after), 'Request Alpha', 'the request it became is named');
  assert.equal((converted.change.after as any)?.reference, 'REQ-11');
  const closed = converted.item.changes.find((change) => change.field === 'status');
  assert.deepEqual([closed?.before, closed?.after], ['in_progress', 'done'], 'the conversion closes the task');

  const serialized = JSON.stringify(page);
  for (const leak of ['Private first plan', 'Private second plan', 'storage_path', 'files/note.txt', 'related_object_id', 'converted_to_request_id']) {
    assert.ok(!serialized.includes(leak), `never in the answer: ${leak}`);
  }
  console.log('  task creation, modification, hidden description, record and conversion in words: OK');
}

async function testChildEntries(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.allReader, data.tenantId, 'tasks', seeded.task, ALL_MODULES);
  assert.equal((one(page, 'attachment', 'added').change.after as any)?.label, 'note.txt');
  assert.ok(one(page, 'attachment', 'removed'), 'the attachment is removed');

  const entries = page.items.filter((item) => item.subject.kind === 'time_entry');
  assert.equal(entries.length, 1, 'the time entry');
  assert.equal(entries[0].changes.find((change) => change.field === 'hours')?.after, 2, 'its hours');

  for (const [field, label] of [['application', 'Ledger App'], ['asset', 'Server One']] as const) {
    assert.equal(labelOf(one(page, field, 'added').change.after), label, `${field} added and named`);
    assert.equal(labelOf(one(page, field, 'removed').change.before), label, `${field} removed and named`);
  }
  console.log('  attachment, time entry, applications and assets: OK');
}

async function testReferencesWithoutModules(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.taskReader, data.tenantId, 'tasks', seeded.task, TASK_ONLY);
  const created = page.items.find((item) => item.subject.kind === 'record' && item.action === 'create');
  assert.deepEqual(created?.changes.find((change) => change.field === 'related_object')?.after, { hidden: true, kind: 'budget_line' });
  assert.deepEqual(one(page, 'converted_to_request').change.after, { hidden: true, kind: 'request' });
  assert.deepEqual(one(page, 'application', 'added').change.after, { hidden: true, kind: 'application' });
  assert.deepEqual(one(page, 'asset', 'added').change.after, { hidden: true, kind: 'asset' });
  const updated = page.items.find((item) => item.subject.kind === 'record' && item.action === 'update' && item.changes.some((change) => change.field === 'source_id'));
  assert.equal(labelOf(updated?.changes.find((change) => change.field === 'source_id')?.after), 'Task source', 'the classification is named for every reader of the task');
  const serialized = JSON.stringify(page);
  for (const name of ['Main line', 'BL-1', 'Request Alpha', 'REQ-11', 'Ledger App', 'APP-42', 'Server One', 'AST-1']) {
    assert.ok(!serialized.includes(name), `not named without its module: ${name}`);
  }
  console.log('  a tasks-only reader sees the line, the request, the applications and assets unnamed: OK');
}

async function testLineHistory(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.allReader, data.tenantId, 'spend_items', data.opexLine, ALL_MODULES);
  const tasks = page.items.filter((item) => item.subject.kind === 'task' && item.changes.some((change) => change.event === 'added'));
  const references = tasks.map((item) => (item.changes.find((change) => change.event === 'added')?.after as any)?.reference).sort();
  assert.deepEqual(references, ['T-31', 'T-5'], 'each task created on the line shows once in its history');
  assert.ok(!JSON.stringify(page).includes('Hidden line task'), 'the task of another line is not there');
  console.log('  the tasks show in the history of their budget line: OK');
}

async function testParentRows(seeded: Seeded) {
  const { data } = seeded;
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [data.tenantId]);
    const rows: Array<{ table_name: string; record_id: string | null; parent_table: string | null; parent_id: string | null }> = await runner.query(
      `SELECT DISTINCT table_name, record_id::text AS record_id, parent_table, parent_id::text AS parent_id
         FROM audit_log
        WHERE tenant_id = $1
          AND table_name IN ('task_attachments', 'task_time_entries', 'task_applications', 'task_assets', 'tasks')`,
      [data.tenantId],
    );
    for (const label of ['task_attachments', 'task_time_entries']) {
      const parents = rows.filter((row) => row.table_name === label);
      assert.ok(parents.length > 0, `${label}: rows`);
      assert.ok(parents.every((row) => row.parent_table === 'tasks' && row.parent_id === seeded.task), `${label}: the task is the parent`);
    }
    for (const label of ['task_applications', 'task_assets']) {
      const sets = rows.filter((row) => row.table_name === label);
      assert.ok(sets.length > 0 && sets.every((row) => row.record_id === seeded.task && row.parent_id === null), `${label}: read by record_id`);
    }
    const lineTasks = rows.filter((row) => row.table_name === 'tasks' && row.record_id === seeded.task);
    assert.ok(lineTasks.every((row) => row.parent_table === 'spend_items' && row.parent_id === data.opexLine), 'a line task names its line as parent');
  } finally {
    await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }
  console.log('  the writer fills the task parent of the children and the line parent of the task: OK');
}

async function run() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('record-history-tasks');
  const foreignTenantId = await createRaceTenant('record-history-tasks-foreign');
  try {
    const seeded = await seed(tenantId, async (runner) => seedAudits(runner, await seedHistoryData(runner, tenantId)));
    const foreign = await seed(foreignTenantId, (runner) => seedHistoryData(runner, foreignTenantId));
    console.log('record history tasks');
    await testAccess(seeded, foreign);
    await testRecordEntries(seeded);
    await testChildEntries(seeded);
    await testReferencesWithoutModules(seeded);
    await testLineHistory(seeded);
    await testParentRows(seeded);
    console.log('record-history-tasks.integration.spec: ok');
  } finally {
    await dropRaceTenant(tenantId);
    await dropRaceTenant(foreignTenantId);
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
