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

// The request history (lot 2, linked records) on the migrated database: its own rows in words
// (the rich texts hidden as changed, the scoring by criterion and option labels, the task it was
// created from, named or hidden under the reader's rights, and the deletion of that task), its
// attachments read by parent through the real writer, and the sets written from the request read
// by `record_id`: business processes, team, OPEX and CAPEX lines, applications, assets,
// dependencies, contacts, web links and document edits. A budget line is named only for a budget
// reader, counted otherwise, and counted for a limited person when it lies outside their scope.
// Access: 403 without the requests module, 404 for an unknown or foreign request, and for a
// Business Contributor outside the request.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const REQUEST_ONLY: Record<string, Level> = { portfolio_requests: 'reader' };
const ALL_MODULES: Record<string, Level> = {
  portfolio_requests: 'reader', portfolio_projects: 'reader', budget: 'reader', applications: 'reader',
  infrastructure: 'reader', contacts: 'reader', tasks: 'reader', companies: 'reader', business_processes: 'reader',
};
const LIMITED_MODULES: Record<string, Level> = { portfolio_requests: 'reader', budget: 'reader' };

type Seeded = {
  data: HistorySeed;
  request2: string;
  deletedTask: string;
  criterion: string;
  options: { low: string; high: string };
  allReader: Person;
  requestReader: Person;
  noModules: Person;
  limited: Person;
  contributor: Person;
};

async function readPage(
  person: Person,
  tenantId: string,
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
    return await new RecordHistoryService().list(ctx, 'portfolio_requests', id, { limit: '100' });
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
  const t = data.tenantId;
  const allReader = await seedPerson(runner, t, { first: 'Alba', last: 'All' }, ALL_MODULES);
  const requestReader = await seedPerson(runner, t, { first: 'Rita', last: 'Requests' }, REQUEST_ONLY);
  const noModules = await seedPerson(runner, t, { first: 'Nino', last: 'None' }, { budget: 'reader' });
  const limited = await seedPerson(runner, t, { first: 'Lila', last: 'Limited' }, LIMITED_MODULES, { mode: 'limited', nodeCompanyId: data.companyA });
  const contributor = await seedPerson(runner, t, { first: 'Bea', last: 'Contributor' }, REQUEST_ONLY, { exactRoleName: 'Business Contributor' });
  const [{ id: request2 }] = await runner.query(
    `INSERT INTO portfolio_requests (tenant_id, item_number, name, requestor_id) VALUES ($1, 12, 'Request Beta', $2) RETURNING id`,
    [t, contributor.id],
  );

  const [{ id: criterion }] = await runner.query(
    `INSERT INTO portfolio_criteria (tenant_id, name) VALUES ($1, 'Strategic fit') RETURNING id`, [t],
  );
  const [{ id: low }] = await runner.query(
    `INSERT INTO portfolio_criterion_values (tenant_id, criterion_id, label, position) VALUES ($1, $2, 'Low', 0) RETURNING id`, [t, criterion],
  );
  const [{ id: high }] = await runner.query(
    `INSERT INTO portfolio_criterion_values (tenant_id, criterion_id, label, position) VALUES ($1, $2, 'High', 1) RETURNING id`, [t, criterion],
  );

  const request = data.request;
  const [stored] = await runner.query(`SELECT to_jsonb(r) AS row FROM portfolio_requests r WHERE r.id = $1`, [request]);
  const row = {
    ...(stored.row as Record<string, unknown>),
    status: 'pending_review', priority_score: '10.00', criteria_values: { [criterion]: low }, origin_task_id: data.task,
    current_situation: 'Old private situation', feasibility_review: { technical: { status: 'pending', comment: 'Old private review' } },
  };
  const by = { userId: allReader.id };

  // The creation from a task: the saved row names the task it came from.
  await audit(runner, { table: 'portfolio_requests', recordId: request, action: 'create', after: row, ...by });
  await audit(runner, {
    table: 'portfolio_requests', recordId: request, action: 'update', ...by,
    before: row,
    after: {
      ...row, status: 'candidate', priority_score: '20.00', criteria_values: { [criterion]: high },
      current_situation: 'New private situation', feasibility_review: { technical: { status: 'done', comment: 'New private review' } },
    },
  });
  // The conversion into a project: the saved row names the project beside it.
  const approved = { ...row, status: 'approved', priority_score: '64.58' };
  await audit(runner, {
    table: 'portfolio_requests', recordId: request, action: 'update', ...by,
    before: approved,
    after: { ...approved, status: 'converted', converted_to_project_id: data.project },
  });
  // The deletion of the origin task (`spend/item-delete-cleanup.ts`): its label and its id.
  const deletedTask = randomUUID();
  await audit(runner, {
    table: 'portfolio_requests', recordId: request, action: 'update', ...by,
    before: { origin_task: 'T-77: Private task title', __origin_task_id: deletedTask },
    after: { origin_task: null, __origin_task_id: null },
  });

  // The attachment read by parent: the writer finds the request in its payload.
  const attachment = {
    id: randomUUID(), tenant_id: t, request_id: request, original_filename: 'brief.pdf', stored_filename: 'stored.pdf',
    mime_type: 'application/pdf', size: 1200, storage_path: 'files/brief.pdf', source_field: null,
  };
  await audit(runner, { table: 'portfolio_request_attachments', recordId: attachment.id, action: 'create', after: attachment, ...by });
  await audit(runner, { table: 'portfolio_request_attachments', recordId: attachment.id, action: 'delete', before: attachment, after: null, ...by });

  // The sets written from the request: record_id is the request, a set before and after.
  await audit(runner, { table: 'portfolio_request_business_processes', recordId: request, action: 'update', before: [], after: [data.businessProcess], ...by });
  await audit(runner, { table: 'portfolio_request_team', recordId: request, action: 'update', before: { role: 'it_team', ids: [] }, after: { role: 'it_team', ids: [allReader.id] }, ...by });
  await audit(runner, { table: 'portfolio_request_team', recordId: request, action: 'update', before: { role: 'business_team', ids: [allReader.id] }, after: { role: 'business_team', ids: [] }, ...by });
  await audit(runner, { table: 'portfolio_request_opex', recordId: request, action: 'update', before: { ids: [data.opexLine] }, after: { ids: [data.opexLine, data.hiddenLine] }, ...by });
  await audit(runner, { table: 'portfolio_request_capex', recordId: request, action: 'update', before: { ids: [] }, after: { ids: [data.capexLine] }, ...by });
  await audit(runner, { table: 'portfolio_request_applications', recordId: request, action: 'update', before: { ids: [] }, after: { ids: [data.application] }, ...by });
  await audit(runner, { table: 'portfolio_request_assets', recordId: request, action: 'update', before: { ids: [data.asset] }, after: { ids: [] }, ...by });
  await audit(runner, {
    table: 'portfolio_request_dependencies', recordId: request, action: 'update', ...by,
    before: { ids: [], request_ids: [] }, after: { ids: [data.project], request_ids: [request2] },
  });
  await audit(runner, { table: 'portfolio_request_contacts', recordId: request, action: 'update', before: { ids: [] }, after: { ids: [data.contact] }, ...by });
  await audit(runner, {
    table: 'portfolio_request_urls', recordId: request, action: 'update', ...by,
    before: [], after: [{ url: 'https://example.invalid/brief', label: 'Brief board' }],
  });
  // An address changed under the same label reads as that link changed (address and label compared).
  await audit(runner, {
    table: 'portfolio_request_urls', recordId: request, action: 'update', ...by,
    before: [{ url: 'https://a.example.invalid/spec', label: 'Specification' }],
    after: [{ url: 'https://b.example.invalid/spec', label: 'Specification' }],
  });
  await audit(runner, { table: 'portfolio_request_documents', recordId: request, action: 'update', before: null, after: { slot: 'risks_mitigations' }, ...by });

  return {
    data, request2, deletedTask, criterion, options: { low, high },
    allReader, requestReader, noModules, limited, contributor,
  };
}

async function testAccess(seeded: Seeded, foreign: HistorySeed) {
  const { data } = seeded;
  const page = await readPage(seeded.allReader, data.tenantId, data.request, ALL_MODULES);
  assert.ok(page.items.length > 0, 'a reader of the requests reads the history');
  await assert.rejects(
    () => readPage(seeded.noModules, data.tenantId, data.request, { budget: 'reader' }),
    (error: any) => error?.status === 403 && error?.response?.code === 'MODULE_RIGHT_REQUIRED',
    'no requests module gets 403 MODULE_RIGHT_REQUIRED',
  );
  for (const [what, id] of [['an unknown id', randomUUID()], ['another tenant\'s request', foreign.request]] as const) {
    await assert.rejects(() => readPage(seeded.allReader, data.tenantId, id, ALL_MODULES), (error: any) => error?.status === 404, `${what} gets 404`);
  }
  // A Business Contributor reads only the requests they take part in, as the page does.
  await assert.rejects(
    () => readPage(seeded.contributor, data.tenantId, data.request, REQUEST_ONLY),
    (error: any) => error?.status === 404,
    'a Business Contributor outside the request gets 404',
  );
  const own = await readPage(seeded.contributor, data.tenantId, seeded.request2, REQUEST_ONLY);
  assert.ok(Array.isArray(own.items), 'a Business Contributor who requested it reads its history');
  console.log('  200 with requests, 403 without, 404 unknown, foreign and outside the contributor\'s requests: OK');
}

async function testRecordEntries(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.allReader, data.tenantId, data.request, ALL_MODULES);
  const records = page.items.filter((item) => item.subject.kind === 'record');
  const created = records.find((item) => item.action === 'create');
  assert.ok(created, 'the creation is an entry');
  const origin = created!.changes.find((change) => change.field === 'origin_task_id');
  assert.deepEqual(origin?.after, { kind: 'task', id: data.task, label: 'Follow up', reference: 'T-5' }, 'created from the task, named for a tasks reader');
  assert.deepEqual(
    created!.changes.find((change) => change.field === 'criterion'),
    { field: 'criterion', dimension: 'Strategic fit', after: 'Low' },
    'the starting scoring by its labels',
  );

  const updates = records.filter((item) => item.action === 'update');
  const update = updates.find((item) => item.changes.some((change) => change.field === 'status' && change.after === 'candidate'));
  assert.ok(update, 'the modification is an entry');
  const field = (name: string) => update!.changes.find((change) => change.field === name);
  assert.deepEqual([field('status')?.before, field('status')?.after], ['pending_review', 'candidate']);
  assert.deepEqual([field('priority_score')?.before, field('priority_score')?.after], [10, 20], 'the score reads as a number');
  assert.deepEqual(field('current_situation'), { field: 'current_situation', text: 'currentSituationChanged' }, 'the situation says changed');
  assert.deepEqual(field('feasibility_review'), { field: 'feasibility_review', text: 'feasibilityReviewChanged' }, 'the review says changed');
  assert.deepEqual(field('criterion'), { field: 'criterion', dimension: 'Strategic fit', before: 'Low', after: 'High' });

  // The conversion names the project.
  const conversion = updates.find((item) => item.changes.some((change) => change.field === 'converted_to_project'));
  assert.ok(conversion, 'the conversion is an entry');
  assert.deepEqual(conversion!.changes, [
    { field: 'converted_to_project', after: { kind: 'project', id: data.project, label: 'Project Alpha', reference: 'PRJ-7' } },
    { field: 'status', before: 'approved', after: 'converted' },
  ], 'converted to the project, named for a projects reader');
  assert.equal(updates.length, 3, 'the modification, the conversion and the task deletion');

  // The deletion of the origin task reads as the origin task, deleted, never its stored label.
  const cleanup = updates.find((item) => item.changes.some((change) => change.field === 'origin_task_id'));
  assert.ok(cleanup, 'the task deletion is an entry');
  assert.deepEqual(cleanup!.changes, [{ field: 'origin_task_id', before: { hidden: true, kind: 'task', deleted: true }, after: null }]);

  const serialized = JSON.stringify(page);
  for (const leak of [
    'Old private situation', 'New private situation', 'Old private review', 'New private review', 'Private task title', 'T-77',
    '__origin_task_id', 'converted_to_project_id', 'criteria_values', seeded.criterion, seeded.options.low, seeded.options.high, seeded.deletedTask, 'storage_path', 'files/brief.pdf',
  ]) {
    assert.ok(!serialized.includes(leak), `never in the answer: ${leak}`);
  }
  console.log('  request creation from a task, modification, hidden rich texts, scoring labels, task deleted: OK');
}

async function testChildEntries(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.allReader, data.tenantId, data.request, ALL_MODULES);

  assert.equal(labelOf(one(page, 'attachment', 'added').change.after), 'brief.pdf', 'the attachment added is named');
  assert.equal(labelOf(one(page, 'attachment', 'removed').change.before), 'brief.pdf', 'and its removal');
  assert.equal(labelOf(one(page, 'business_process', 'added').change.after), 'Order to cash', 'the business process is named');
  assert.equal(labelOf(one(page, 'it_team', 'added').change.after), 'Alba All', 'an IT team member added');
  assert.equal(labelOf(one(page, 'business_team', 'removed').change.before), 'Alba All', 'a business team member removed');

  const lines = changes(page, 'budget_line', 'added').map(({ change }) => (change.after as any).reference).sort();
  assert.deepEqual(lines, ['BL-2', 'BL-3'], 'the lines added are named for a budget reader');
  assert.equal(changes(page, 'budget_lines_outside').length, 0, 'nothing is counted out of sight for this reader');
  assert.equal(labelOf(one(page, 'application', 'added').change.after), 'Ledger App', 'the application added is named');
  assert.equal(labelOf(one(page, 'asset', 'removed').change.before), 'Server One', 'the asset removed is named');
  const dependencies = changes(page, 'dependency', 'added').map(({ change }) => labelOf(change.after)).sort();
  assert.deepEqual(dependencies, ['Project Alpha', 'Request Beta'], 'the dependencies name the project and the request');
  assert.equal(labelOf(one(page, 'contact', 'added').change.after), 'Cora Contact', 'the contact is named');
  assert.equal(one(page, 'link', 'added').change.after, 'Brief board', 'the web link reads by its label');
  assert.deepEqual(
    changes(page, 'link').find(({ change }) => change.event === undefined)?.change,
    { field: 'link', dimension: 'Specification', before: 'https://a.example.invalid/spec', after: 'https://b.example.invalid/spec' },
    'an address changed alone reads as the link changed, old and new address',
  );
  assert.deepEqual(one(page, 'document_updated').change, { field: 'document_updated', after: 'risks_mitigations' }, 'the document slot, never its content');
  console.log('  attachment, process, team, lines, application, asset, dependencies, contact, link, document: OK');
}

async function testReferencesWithoutModules(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.requestReader, data.tenantId, data.request, REQUEST_ONLY);
  assert.deepEqual(one(page, 'application', 'added').change.after, { hidden: true, kind: 'application' });
  assert.deepEqual(one(page, 'asset', 'removed').change.before, { hidden: true, kind: 'asset' });
  assert.deepEqual(one(page, 'business_process', 'added').change.after, { hidden: true, kind: 'business_process' });
  assert.deepEqual((one(page, 'contact', 'added').change.after as any)?.hidden, true, 'the contact is hidden');
  const created = page.items.find((item) => item.subject.kind === 'record' && item.action === 'create');
  assert.deepEqual(created?.changes.find((change) => change.field === 'origin_task_id')?.after, { hidden: true, kind: 'task' }, 'the origin task is hidden without tasks');
  assert.deepEqual(one(page, 'converted_to_project').change.after, { hidden: true, kind: 'project' }, 'the project is hidden without projects');
  const dependencies = changes(page, 'dependency', 'added').map(({ change }) => change.after);
  assert.ok(dependencies.some((value) => (value as any)?.hidden === true && (value as any)?.kind === 'project'), 'the project dependency is hidden without projects');
  assert.ok(dependencies.some((value) => labelOf(value) === 'Request Beta'), 'the request dependency is named for a requests reader');
  assert.equal(changes(page, 'budget_line').length, 0, 'no line is named without the budget');
  const outside = changes(page, 'budget_lines_outside', 'added').map(({ change }) => change.after);
  assert.deepEqual(outside, [1, 1], 'the OPEX and the CAPEX line are counted');
  const serialized = JSON.stringify(page);
  for (const name of ['Ledger App', 'Server One', 'Order to cash', 'Cora', 'Main line', 'BL-', 'T-5', 'Follow up', 'Project Alpha', 'PRJ-7']) {
    assert.ok(!serialized.includes(name), `not named without its module: ${name}`);
  }
  console.log('  a requests-only reader sees the other modules unnamed and the lines counted: OK');
}

async function testLimited(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.limited, data.tenantId, data.request, LIMITED_MODULES, true);
  assert.deepEqual(changes(page, 'budget_line', 'added').map(({ change }) => (change.after as any).reference).sort(), ['BL-2']);
  assert.equal(one(page, 'budget_lines_outside', 'added').change.after, 1, 'the out-of-scope line added is counted');
  const serialized = JSON.stringify(page);
  assert.ok(!serialized.includes('Beta line') && !serialized.includes('BL-3'), 'the out-of-scope line is never named');
  console.log('  a limited person reads the request, the line outside their scope counted: OK');
}

async function testParentRows(seeded: Seeded) {
  const { data } = seeded;
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [data.tenantId]);
    const rows: Array<{ parent_table: string | null; parent_id: string | null }> = await runner.query(
      `SELECT DISTINCT parent_table, parent_id::text AS parent_id
         FROM audit_log WHERE tenant_id = $1 AND table_name = 'portfolio_request_attachments'`,
      [data.tenantId],
    );
    assert.deepEqual(rows, [{ parent_table: 'portfolio_requests', parent_id: data.request }], 'the writer fills the request parent of the attachments');
  } finally {
    await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }
  console.log('  the writer fills the request parent of the attachments: OK');
}

async function run() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('record-history-requests');
  const foreignTenantId = await createRaceTenant('record-history-requests-foreign');
  try {
    const seeded = await seed(tenantId, async (runner) => seedAudits(runner, await seedHistoryData(runner, tenantId)));
    const foreign = await seed(foreignTenantId, (runner) => seedHistoryData(runner, foreignTenantId));
    console.log('record history requests');
    await testAccess(seeded, foreign);
    await testRecordEntries(seeded);
    await testChildEntries(seeded);
    await testReferencesWithoutModules(seeded);
    await testLimited(seeded);
    await testParentRows(seeded);
    console.log('record-history-requests.integration.spec: ok');
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
