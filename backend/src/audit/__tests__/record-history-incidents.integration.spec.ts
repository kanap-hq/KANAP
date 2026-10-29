// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';
import { RECORD_HISTORY } from '../record-history.inventory';
import {
  RecordHistoryService,
  type RecordHistoryChange,
  type RecordHistoryContext,
  type RecordHistoryItem,
  type RecordHistoryPage,
} from '../record-history.service';
import { audit, seedHistoryData, seedPerson, type HistorySeed, type Level, type Person } from './record-history.fixtures';

// The incident history (lot 2, linked records) on the migrated database: its own rows in words
// with the description hidden, its attachments (a removal keeps the row with its removal date),
// its tasks through the task rule, its asset, application and technology links read by
// `record_id`, the references named only with the reader's modules, and the access rules: 403
// without the incidents module, 404 for an unknown or foreign incident, and for a confidential
// incident when the reader is neither a register administrator, its reporter nor its owner. The
// task of a confidential incident appears in no other history that reader can open.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const INCIDENT_ONLY: Record<string, Level> = { incidents: 'reader' };
const ALL_MODULES: Record<string, Level> = {
  incidents: 'reader', infrastructure: 'reader', applications: 'reader', tasks: 'reader', contracts: 'reader',
  portfolio_projects: 'reader',
};

type Seeded = {
  data: HistorySeed;
  confidential: string;
  task: string;
  confidentialTask: string;
  confidentialTaskRow: string;
  allReader: Person;
  incidentReader: Person;
  reporter: Person;
  noModules: Person;
};

async function readPage(
  person: Person,
  tenantId: string,
  table: string,
  id: string,
  permissions: Record<string, Level>,
): Promise<RecordHistoryPage> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
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

async function seedAudits(runner: QueryRunner, data: HistorySeed): Promise<Seeded> {
  const allReader = await seedPerson(runner, data.tenantId, { first: 'Alba', last: 'All' }, ALL_MODULES);
  const incidentReader = await seedPerson(runner, data.tenantId, { first: 'Ines', last: 'Incidents' }, INCIDENT_ONLY);
  const reporter = await seedPerson(runner, data.tenantId, { first: 'Remi', last: 'Reporter' }, ALL_MODULES);
  const noModules = await seedPerson(runner, data.tenantId, { first: 'Nino', last: 'None' }, { tasks: 'reader' });
  const incident = data.incident;
  const [stored] = await runner.query(`SELECT to_jsonb(i) AS row FROM incidents i WHERE i.id = $1`, [incident]);
  const row = stored.row as Record<string, unknown>;
  const by = { userId: allReader.id };

  await audit(runner, { table: 'incidents', recordId: incident, action: 'create', after: { ...row, description: 'Private first analysis' }, ...by });
  await audit(runner, {
    table: 'incidents', recordId: incident, action: 'update', ...by,
    before: { ...row, description: 'Private first analysis', category: 'security' },
    after: { ...row, status: 'in_progress', severity: 'critical', category: 'data', description: 'Private second analysis', owner_user_id: allReader.id },
  });

  const attachment = {
    id: randomUUID(), tenant_id: data.tenantId, incident_id: incident, original_filename: 'log.txt', stored_filename: 's.txt',
    mime_type: 'text/plain', size: 10, storage_path: 'files/log.txt', uploaded_by: allReader.id, uploaded_at: '2026-01-01T00:00:00.000Z', deleted_at: null,
  };
  await audit(runner, { table: 'incident_attachments', recordId: attachment.id, action: 'create', before: null, after: attachment, ...by });
  // A removal keeps the stored row, with its removal date, as the attachment service writes it.
  await audit(runner, {
    table: 'incident_attachments', recordId: attachment.id, action: 'delete', before: attachment,
    after: { ...attachment, deleted_at: '2026-02-01T00:00:00.000Z' }, ...by,
  });

  for (const [label, id] of [['incident_assets', data.asset], ['incident_applications', data.application], ['incident_technologies', data.technology]] as const) {
    await audit(runner, { table: label, recordId: incident, action: 'update', before: [], after: [id], ...by });
    await audit(runner, { table: label, recordId: incident, action: 'update', before: [id], after: [], ...by });
  }

  const [task] = await runner.query(
    `INSERT INTO tasks (tenant_id, item_number, title, related_object_type, related_object_id)
     VALUES ($1, 21, 'Restore the service', 'incident', $2) RETURNING id, to_jsonb(tasks) AS row`,
    [data.tenantId, incident],
  );
  await audit(runner, { table: 'tasks', recordId: task.id, action: 'create', after: task.row, ...by });

  // A confidential incident reported by `reporter`, with a task of its own.
  const [confidential] = await runner.query(
    `INSERT INTO incidents (tenant_id, item_number, title, severity, confidential, reporter_user_id)
     VALUES ($1, 5, 'Breach', 'critical', true, $2) RETURNING id, to_jsonb(incidents) AS row`,
    [data.tenantId, reporter.id],
  );
  await audit(runner, { table: 'incidents', recordId: confidential.id, action: 'create', after: confidential.row, userId: reporter.id });
  const [confidentialTask] = await runner.query(
    `INSERT INTO tasks (tenant_id, item_number, title, related_object_type, related_object_id)
     VALUES ($1, 22, 'Notify the regulator', 'incident', $2) RETURNING id, to_jsonb(tasks) AS row`,
    [data.tenantId, confidential.id],
  );
  const confidentialTaskRow = await audit(runner, { table: 'tasks', recordId: confidentialTask.id, action: 'create', after: confidentialTask.row, userId: reporter.id });
  return {
    data, confidential: confidential.id, task: task.id, confidentialTask: confidentialTask.id, confidentialTaskRow,
    allReader, incidentReader, reporter, noModules,
  };
}

async function testAccess(seeded: Seeded, foreign: HistorySeed) {
  const { data } = seeded;
  const page = await readPage(seeded.incidentReader, data.tenantId, 'incidents', data.incident, INCIDENT_ONLY);
  assert.ok(page.items.length > 0, 'a reader of the incidents reads the history');
  await assert.rejects(
    () => readPage(seeded.noModules, data.tenantId, 'incidents', data.incident, { tasks: 'reader' }),
    (error: any) => error?.status === 403 && error?.response?.code === 'MODULE_RIGHT_REQUIRED',
    'no incidents module gets 403 MODULE_RIGHT_REQUIRED',
  );
  for (const [what, id] of [['an unknown id', randomUUID()], ['another tenant\'s incident', foreign.incident]] as const) {
    await assert.rejects(
      () => readPage(seeded.allReader, data.tenantId, 'incidents', id, ALL_MODULES),
      (error: any) => error?.status === 404,
      `${what} gets 404`,
    );
  }
  console.log('  200 with incidents, 403 without, 404 unknown and foreign: OK');
}

async function testConfidential(seeded: Seeded) {
  const { data } = seeded;
  await assert.rejects(
    () => readPage(seeded.allReader, data.tenantId, 'incidents', seeded.confidential, ALL_MODULES),
    (error: any) => error?.status === 404,
    'a confidential incident is not found for a reader outside the register rule',
  );
  const page = await readPage(seeded.reporter, data.tenantId, 'incidents', seeded.confidential, ALL_MODULES);
  assert.ok(page.items.some((item) => item.subject.kind === 'record' && item.action === 'create'), 'its reporter reads its history');
  assert.equal(labelOf(one(page, 'task', 'added').change.after), 'Notify the regulator', 'its reporter sees its task');

  // The task of the confidential incident is in no other history the reader can open.
  const parent = await seed(data.tenantId, async (runner) => runner.query(
    `SELECT parent_table, parent_id::text AS parent_id FROM audit_log WHERE tenant_id = $1 AND id = $2`,
    [data.tenantId, seeded.confidentialTaskRow],
  ));
  assert.deepEqual(parent[0], { parent_table: 'incidents', parent_id: seeded.confidential }, 'the task row belongs to the confidential incident');
  const holders = Object.values(RECORD_HISTORY).filter((entry) => Object.prototype.hasOwnProperty.call(entry.children, 'tasks'));
  assert.deepEqual(holders.map((entry) => entry.table).sort(), ['contracts', 'incidents', 'portfolio_projects'], 'the records that read tasks');
  for (const [table, id] of [['incidents', data.incident], ['contracts', data.contractA], ['portfolio_projects', data.project]] as const) {
    const other = await readPage(seeded.allReader, data.tenantId, table, id, ALL_MODULES);
    const serialized = JSON.stringify(other);
    assert.ok(!other.items.some((item) => item.id === seeded.confidentialTaskRow), `${table}: the confidential task row is absent`);
    assert.ok(!serialized.includes('Notify the regulator') && !serialized.includes('Breach'), `${table}: never named`);
  }
  console.log('  a confidential incident: 404 outside the rule, 200 for its reporter, its task nowhere else: OK');
}

async function testEntries(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.allReader, data.tenantId, 'incidents', data.incident, ALL_MODULES);
  const created = page.items.find((item) => item.subject.kind === 'record' && item.action === 'create');
  assert.ok(created, 'the creation is an entry');
  assert.equal(created!.changes.find((change) => change.field === 'title')?.after, 'Outage');
  assert.equal(created!.changes.some((change) => change.field === 'description'), false, 'a creation never shows the description');
  const updated = page.items.find((item) => item.subject.kind === 'record' && item.action === 'update');
  assert.ok(updated, 'the modification is an entry');
  const field = (name: string) => updated!.changes.find((change) => change.field === name);
  assert.deepEqual([field('status')?.before, field('status')?.after], ['open', 'in_progress']);
  assert.deepEqual([field('severity')?.before, field('severity')?.after], ['major', 'critical']);
  assert.deepEqual([field('category')?.before, field('category')?.after], ['security', 'data']);
  assert.deepEqual(field('description'), { field: 'description', text: 'descriptionChanged' }, 'the description says changed');
  assert.equal(labelOf(field('owner_user_id')?.after), 'Alba All', 'the owner is named');

  assert.equal((one(page, 'attachment', 'added').change.after as any).label, 'log.txt');
  assert.equal((one(page, 'attachment', 'removed').change.before as any).label, 'log.txt', 'a soft removal reads as removed');
  for (const [kind, label] of [['asset', 'Server One'], ['application', 'Ledger App'], ['technology', 'Postgres']] as const) {
    assert.equal(labelOf(one(page, kind, 'added').change.after), label, `${kind} added and named`);
    assert.equal(labelOf(one(page, kind, 'removed').change.before), label, `${kind} removed and named`);
  }
  assert.equal(labelOf(one(page, 'task', 'added').change.after), 'Restore the service', 'the incident task is named');

  const serialized = JSON.stringify(page);
  for (const leak of ['Private first analysis', 'Private second analysis', 'files/log.txt', 'deleted_at']) {
    assert.ok(!serialized.includes(leak), `never in the answer: ${leak}`);
  }

  const narrow = await readPage(seeded.incidentReader, data.tenantId, 'incidents', data.incident, INCIDENT_ONLY);
  assert.deepEqual(one(narrow, 'asset', 'added').change.after, { hidden: true, kind: 'asset' });
  assert.deepEqual(one(narrow, 'application', 'added').change.after, { hidden: true, kind: 'application' });
  assert.deepEqual(one(narrow, 'technology', 'added').change.after, { hidden: true, kind: 'technology' });
  assert.deepEqual(one(narrow, 'task', 'added').change.after, { hidden: true, kind: 'task' });
  for (const name of ['Server One', 'Ledger App', 'Postgres', 'Restore the service']) {
    assert.ok(!JSON.stringify(narrow).includes(name), `not named without its module: ${name}`);
  }
  console.log('  incident creation, modification, attachments, links and task in words, hidden without modules: OK');
}

async function testParentRows(seeded: Seeded) {
  const { data } = seeded;
  const rows: Array<{ table_name: string; parent_table: string | null; parent_id: string | null; record_id: string }> = await seed(
    data.tenantId,
    (runner) => runner.query(
      `SELECT table_name, parent_table, parent_id::text AS parent_id, record_id::text AS record_id
         FROM audit_log
        WHERE tenant_id = $1 AND table_name IN ('incident_attachments', 'tasks', 'incident_assets')`,
      [data.tenantId],
    ),
  );
  for (const row of rows.filter((candidate) => candidate.table_name === 'incident_attachments')) {
    assert.deepEqual([row.parent_table, row.parent_id], ['incidents', data.incident], 'the attachment names its incident');
  }
  const task = rows.find((row) => row.table_name === 'tasks' && row.record_id === seeded.task);
  assert.deepEqual([task?.parent_table, task?.parent_id], ['incidents', data.incident], 'the task names its incident');
  assert.ok(rows.filter((row) => row.table_name === 'incident_assets').every((row) => row.parent_id === null), 'a link set has no parent');
  console.log('  the writer fills the incident parent of the attachments and the task: OK');
}

async function run() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('record-history-incidents');
  const foreignTenantId = await createRaceTenant('record-history-incidents-foreign');
  try {
    const seeded = await seed(tenantId, async (runner) => seedAudits(runner, await seedHistoryData(runner, tenantId)));
    const foreign = await seed(foreignTenantId, (runner) => seedHistoryData(runner, foreignTenantId));
    console.log('record history incidents');
    await testAccess(seeded, foreign);
    await testConfidential(seeded);
    await testEntries(seeded);
    await testParentRows(seeded);
    console.log('record-history-incidents.integration.spec: ok');
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
