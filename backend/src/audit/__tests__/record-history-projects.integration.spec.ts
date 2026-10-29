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

// The project history (lot 2, linked records) on the migrated database: its own rows in words
// (the purpose hidden as changed, the scoring by criterion and option labels, the request it was
// created from), every child read by parent through the real writer (phases, milestones,
// attachments, time entries, the project's task), and the sets written from the project read by
// `record_id`: team, effort allocations, OPEX and CAPEX lines, applications, assets, technologies,
// dependencies, contacts, web links and document edits. A budget line is named only for a budget
// reader, counted otherwise, and counted for a limited person when it lies outside their scope.
// Access: 403 without the projects module, 404 for an unknown or foreign project, and for a
// Business Contributor outside the project's team.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const PROJECT_ONLY: Record<string, Level> = { portfolio_projects: 'reader' };
const ALL_MODULES: Record<string, Level> = {
  portfolio_projects: 'reader', portfolio_requests: 'reader', budget: 'reader', applications: 'reader',
  infrastructure: 'reader', contacts: 'reader', tasks: 'reader', companies: 'reader',
};
const LIMITED_MODULES: Record<string, Level> = { portfolio_projects: 'reader', budget: 'reader' };

type Seeded = {
  data: HistorySeed;
  project2: string;
  task: string;
  criterion: string;
  options: { low: string; high: string };
  allReader: Person;
  projectReader: Person;
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
    return await new RecordHistoryService().list(ctx, 'portfolio_projects', id, { limit: '100' });
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
  const projectReader = await seedPerson(runner, t, { first: 'Paco', last: 'Projects' }, PROJECT_ONLY);
  const noModules = await seedPerson(runner, t, { first: 'Nino', last: 'None' }, { budget: 'reader' });
  const limited = await seedPerson(runner, t, { first: 'Lila', last: 'Limited' }, LIMITED_MODULES, { mode: 'limited', nodeCompanyId: data.companyA });
  const contributor = await seedPerson(runner, t, { first: 'Bea', last: 'Contributor' }, PROJECT_ONLY, { exactRoleName: 'Business Contributor' });
  const [{ id: project2 }] = await runner.query(
    `INSERT INTO portfolio_projects (tenant_id, item_number, name, it_lead_id) VALUES ($1, 8, 'Project Beta', $2) RETURNING id`,
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

  const project = data.project;
  const [stored] = await runner.query(`SELECT to_jsonb(p) AS row FROM portfolio_projects p WHERE p.id = $1`, [project]);
  const row = { ...(stored.row as Record<string, unknown>), status: 'planned', priority_score: '10.00', criteria_values: { [criterion]: low } };
  const by = { userId: allReader.id };

  // The conversion of a request: the creation row names it beside the saved project.
  await audit(runner, { table: 'portfolio_projects', recordId: project, action: 'create', after: { ...row, source_request_id: data.request }, ...by });
  await audit(runner, {
    table: 'portfolio_projects', recordId: project, action: 'update', ...by,
    before: { ...row, purpose: 'Old private purpose' },
    after: { ...row, status: 'in_progress', purpose: 'New private purpose', priority_score: '20.00', criteria_values: { [criterion]: high } },
  });

  // The children read by parent: the writer finds the project in their payload.
  const phase = { id: randomUUID(), tenant_id: t, project_id: project, name: 'Design', status: 'pending', sequence: 1 };
  await audit(runner, { table: 'portfolio_project_phases', recordId: phase.id, action: 'create', after: phase, ...by });
  await audit(runner, { table: 'portfolio_project_phases', recordId: phase.id, action: 'update', before: phase, after: { ...phase, status: 'in_progress' }, ...by });
  await audit(runner, { table: 'portfolio_project_phases', recordId: phase.id, action: 'delete', before: { ...phase, status: 'in_progress' }, after: null, ...by });
  const milestone = { id: randomUUID(), tenant_id: t, project_id: project, name: 'Go-live', status: 'pending', target_date: '2026-12-01' };
  await audit(runner, { table: 'portfolio_project_milestones', recordId: milestone.id, action: 'create', after: milestone, ...by });
  await audit(runner, { table: 'portfolio_project_milestones', recordId: milestone.id, action: 'update', before: milestone, after: { ...milestone, status: 'achieved' }, ...by });
  const attachment = {
    id: randomUUID(), tenant_id: t, project_id: project, original_filename: 'plan.pdf', stored_filename: 'stored.pdf',
    mime_type: 'application/pdf', size: 1200, storage_path: 'files/plan.pdf', source_field: 'purpose',
  };
  await audit(runner, { table: 'portfolio_project_attachments', recordId: attachment.id, action: 'create', after: attachment, ...by });
  const entry = { id: randomUUID(), tenant_id: t, project_id: project, user_id: allReader.id, category: 'it', hours: '4.00', logged_at: '2026-10-20', notes: null };
  await audit(runner, { table: 'portfolio_project_time_entries', recordId: entry.id, action: 'create', after: entry, ...by });
  const [task] = await runner.query(
    `INSERT INTO tasks (tenant_id, item_number, title, related_object_type, related_object_id)
     VALUES ($1, 31, 'Prepare the kick-off', 'project', $2) RETURNING id, to_jsonb(tasks) AS row`,
    [t, project],
  );
  await audit(runner, { table: 'tasks', recordId: task.id, action: 'create', after: task.row, ...by });

  // The sets written from the project: record_id is the project, a set before and after.
  await audit(runner, { table: 'portfolio_project_team', recordId: project, action: 'update', before: { role: 'it_team', ids: [] }, after: { role: 'it_team', ids: [allReader.id] }, ...by });
  await audit(runner, { table: 'portfolio_project_team', recordId: project, action: 'update', before: { role: 'business_team', ids: [allReader.id] }, after: { role: 'business_team', ids: [] }, ...by });
  await audit(runner, {
    table: 'portfolio_project_effort_allocations', recordId: project, action: 'update', ...by,
    before: { effort_type: 'it', mode: 'auto', allocations: [{ user_id: allReader.id, allocation_pct: 40 }] },
    after: { effort_type: 'it', mode: 'manual', allocations: [{ user_id: allReader.id, allocation_pct: 60 }] },
  });
  await audit(runner, { table: 'portfolio_project_opex', recordId: project, action: 'update', before: { ids: [data.opexLine] }, after: { ids: [data.opexLine, data.hiddenLine] }, ...by });
  await audit(runner, { table: 'portfolio_project_capex', recordId: project, action: 'update', before: { ids: [] }, after: { ids: [data.capexLine] }, ...by });
  for (const [label, id] of [['application_projects', data.application], ['asset_projects', data.asset], ['technology_projects', data.technology]] as const) {
    await audit(runner, { table: label, recordId: project, action: 'update', before: { ids: [] }, after: { ids: [id] }, ...by });
  }
  await audit(runner, { table: 'portfolio_project_dependencies', recordId: project, action: 'update', before: { ids: [] }, after: { ids: [project2] }, ...by });
  await audit(runner, { table: 'portfolio_project_contacts', recordId: project, action: 'update', before: { ids: [] }, after: { ids: [data.contact] }, ...by });
  await audit(runner, {
    table: 'portfolio_project_urls', recordId: project, action: 'update', ...by,
    before: [], after: [{ url: 'https://example.invalid/board', label: 'Design board' }],
  });
  await audit(runner, { table: 'portfolio_project_documents', recordId: project, action: 'update', before: null, after: { slot: 'purpose' }, ...by });
  // On the second project: an address changed under the same label, and a second link with a label
  // the first one already carries.
  await audit(runner, {
    table: 'portfolio_project_urls', recordId: project2, action: 'update', ...by,
    before: [{ url: 'https://a.example.invalid/spec', label: 'Specification' }],
    after: [{ url: 'https://b.example.invalid/spec', label: 'Specification' }],
  });
  await audit(runner, {
    table: 'portfolio_project_urls', recordId: project2, action: 'update', ...by,
    before: [{ url: 'https://example.invalid/doc-one', label: 'Doc' }],
    after: [{ url: 'https://example.invalid/doc-one', label: 'Doc' }, { url: 'https://example.invalid/doc-two', label: 'Doc' }],
  });

  return {
    data, project2, task: task.id, criterion, options: { low, high },
    allReader, projectReader, noModules, limited, contributor,
  };
}

async function testAccess(seeded: Seeded, foreign: HistorySeed) {
  const { data } = seeded;
  const page = await readPage(seeded.allReader, data.tenantId, data.project, ALL_MODULES);
  assert.ok(page.items.length > 0, 'a reader of the projects reads the history');
  await assert.rejects(
    () => readPage(seeded.noModules, data.tenantId, data.project, { budget: 'reader' }),
    (error: any) => error?.status === 403 && error?.response?.code === 'MODULE_RIGHT_REQUIRED',
    'no projects module gets 403 MODULE_RIGHT_REQUIRED',
  );
  for (const [what, id] of [['an unknown id', randomUUID()], ['another tenant\'s project', foreign.project]] as const) {
    await assert.rejects(() => readPage(seeded.allReader, data.tenantId, id, ALL_MODULES), (error: any) => error?.status === 404, `${what} gets 404`);
  }
  // A Business Contributor reads only the projects they take part in, as the page does.
  await assert.rejects(
    () => readPage(seeded.contributor, data.tenantId, data.project, PROJECT_ONLY),
    (error: any) => error?.status === 404,
    'a Business Contributor outside the project gets 404',
  );
  const own = await readPage(seeded.contributor, data.tenantId, seeded.project2, PROJECT_ONLY);
  assert.ok(Array.isArray(own.items), 'a Business Contributor who leads the project reads its history');
  console.log('  200 with projects, 403 without, 404 unknown, foreign and outside the contributor\'s projects: OK');
}

async function testRecordEntries(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.allReader, data.tenantId, data.project, ALL_MODULES);
  const records = page.items.filter((item) => item.subject.kind === 'record');
  const created = records.find((item) => item.action === 'create');
  assert.ok(created, 'the creation is an entry');
  const source = created!.changes.find((change) => change.field === 'source_request_id');
  assert.deepEqual(source?.after, { kind: 'request', id: data.request, label: 'Request Alpha', reference: 'REQ-11' }, 'created from the request');
  assert.deepEqual(
    created!.changes.find((change) => change.field === 'criterion'),
    { field: 'criterion', dimension: 'Strategic fit', after: 'Low' },
    'the starting scoring by its labels',
  );

  const update = records.find((item) => item.action === 'update');
  assert.ok(update, 'the modification is an entry');
  const field = (name: string) => update!.changes.find((change) => change.field === name);
  assert.deepEqual([field('status')?.before, field('status')?.after], ['planned', 'in_progress']);
  assert.deepEqual([field('priority_score')?.before, field('priority_score')?.after], [10, 20], 'the score reads as a number');
  assert.deepEqual(field('purpose'), { field: 'purpose', text: 'purposeChanged' }, 'the purpose says changed, never its text');
  assert.deepEqual(field('criterion'), { field: 'criterion', dimension: 'Strategic fit', before: 'Low', after: 'High' });

  const serialized = JSON.stringify(page);
  for (const leak of ['Old private purpose', 'New private purpose', 'criteria_values', seeded.criterion, seeded.options.low, seeded.options.high, 'storage_path', 'files/plan.pdf']) {
    assert.ok(!serialized.includes(leak), `never in the answer: ${leak}`);
  }
  console.log('  project creation from a request, modification, hidden purpose and scoring labels: OK');
}

async function testChildEntries(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.allReader, data.tenantId, data.project, ALL_MODULES);

  assert.equal(one(page, 'phase', 'added').change.after, 'Design');
  assert.equal(one(page, 'phase', 'removed').change.before, 'Design');
  const phaseUpdate = page.items.find((item) => item.subject.kind === 'phase' && item.action === 'update');
  assert.equal(phaseUpdate?.subject.label, 'Design', 'an updated phase is titled by its name');
  assert.deepEqual(phaseUpdate?.changes.find((change) => change.field === 'phase_status'), { field: 'phase_status', before: 'pending', after: 'in_progress' });
  assert.equal(one(page, 'milestone', 'added').change.after, 'Go-live');
  const milestoneUpdate = page.items.find((item) => item.subject.kind === 'milestone' && item.action === 'update');
  assert.deepEqual(milestoneUpdate?.changes.find((change) => change.field === 'milestone_status'), { field: 'milestone_status', before: 'pending', after: 'achieved' });
  assert.equal(labelOf(one(page, 'attachment', 'added').change.after), 'plan.pdf', 'the attachment is named');
  assert.equal(labelOf(one(page, 'time_entry', 'added').change.after), 'Alba All', 'the time entry names the person');
  assert.equal(one(page, 'hours').change.after, 4, 'and the hours');
  assert.equal(labelOf(one(page, 'task', 'added').change.after), 'Prepare the kick-off', 'the project task is named');

  assert.equal(labelOf(one(page, 'it_team', 'added').change.after), 'Alba All', 'an IT team member added');
  assert.equal(labelOf(one(page, 'business_team', 'removed').change.before), 'Alba All', 'a business team member removed');
  const team = { ...page, items: page.items.filter((item) => item.subject.kind === 'team') };
  assert.deepEqual(one(team, 'it_effort_allocation_mode').change, { field: 'it_effort_allocation_mode', before: 'auto', after: 'manual' });
  assert.deepEqual(one(team, 'effort_allocation_it').change, { field: 'effort_allocation_it', dimension: 'Alba All', before: 40, after: 60 });

  const lines = changes(page, 'budget_line', 'added').map(({ change }) => (change.after as any).reference).sort();
  assert.deepEqual(lines, ['BL-2', 'BL-3'], 'the lines added are named for a budget reader');
  assert.equal(changes(page, 'budget_lines_outside').length, 0, 'nothing is counted out of sight for this reader');
  for (const [name, label] of [['application', 'Ledger App'], ['asset', 'Server One'], ['technology', 'Postgres']] as const) {
    assert.equal(labelOf(one(page, name, 'added').change.after), label, `${name} added and named`);
  }
  assert.equal(labelOf(one(page, 'dependency', 'added').change.after), 'Project Beta', 'the dependency names the project');
  assert.equal(labelOf(one(page, 'contact', 'added').change.after), 'Cora Contact', 'the contact is named');
  assert.equal(one(page, 'link', 'added').change.after, 'Design board', 'the web link reads by its label');
  assert.deepEqual(one(page, 'document_updated').change, { field: 'document_updated', after: 'purpose' }, 'the document slot, never its content');
  console.log('  phases, milestone, attachment, time entry, task, team, effort, lines, links, dependency, contact, document: OK');
}

async function testWebLinkPairs(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.allReader, data.tenantId, seeded.project2, ALL_MODULES);
  const links = changes(page, 'link');
  assert.deepEqual(
    links.find(({ change }) => change.event === undefined)?.change,
    { field: 'link', dimension: 'Specification', before: 'https://a.example.invalid/spec', after: 'https://b.example.invalid/spec' },
    'an address changed alone reads as the link changed, old and new address',
  );
  assert.deepEqual(
    links.filter(({ change }) => change.event).map(({ change }) => change),
    [{ field: 'link', event: 'added', after: 'Doc (https://example.invalid/doc-two)' }],
    'a second link with the same label is its own entry, named with its address',
  );
  assert.equal(links.length, 2, 'one change per real difference');
  console.log('  web links compared on address and label: OK');
}

async function testReferencesWithoutModules(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.projectReader, data.tenantId, data.project, PROJECT_ONLY);
  assert.deepEqual(one(page, 'application', 'added').change.after, { hidden: true, kind: 'application' });
  assert.deepEqual(one(page, 'asset', 'added').change.after, { hidden: true, kind: 'asset' });
  assert.deepEqual(one(page, 'technology', 'added').change.after, { hidden: true, kind: 'technology' });
  assert.deepEqual((one(page, 'contact', 'added').change.after as any)?.hidden, true, 'the contact is hidden');
  assert.deepEqual(one(page, 'task', 'added').change.after, { hidden: true, kind: 'task' }, 'the task is hidden without tasks');
  assert.deepEqual(one(page, 'source_request_id').change.after, { hidden: true, kind: 'request' }, 'the request is hidden without requests');
  assert.equal(changes(page, 'budget_line').length, 0, 'no line is named without the budget');
  const outside = changes(page, 'budget_lines_outside', 'added').map(({ change }) => change.after);
  assert.deepEqual(outside, [1, 1], 'the OPEX and the CAPEX line are counted');
  const serialized = JSON.stringify(page);
  for (const name of ['Ledger App', 'Server One', 'Postgres', 'Cora', 'Main line', 'BL-', 'T-31', 'Prepare the kick-off', 'Request Alpha', 'REQ-11']) {
    assert.ok(!serialized.includes(name), `not named without its module: ${name}`);
  }
  console.log('  a projects-only reader sees the other modules unnamed and the lines counted: OK');
}

async function testLimited(seeded: Seeded) {
  const { data } = seeded;
  const page = await readPage(seeded.limited, data.tenantId, data.project, LIMITED_MODULES, true);
  assert.deepEqual(changes(page, 'budget_line', 'added').map(({ change }) => (change.after as any).reference).sort(), ['BL-2']);
  assert.equal(one(page, 'budget_lines_outside', 'added').change.after, 1, 'the out-of-scope line added is counted');
  const serialized = JSON.stringify(page);
  assert.ok(!serialized.includes('Beta line') && !serialized.includes('BL-3'), 'the out-of-scope line is never named');
  console.log('  a limited person reads the project, the line outside their scope counted: OK');
}

async function testParentRows(seeded: Seeded) {
  const { data } = seeded;
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [data.tenantId]);
    const labels = ['portfolio_project_phases', 'portfolio_project_milestones', 'portfolio_project_attachments', 'portfolio_project_time_entries', 'tasks'];
    const rows: Array<{ table_name: string; parent_table: string | null; parent_id: string | null }> = await runner.query(
      `SELECT DISTINCT table_name, parent_table, parent_id::text AS parent_id
         FROM audit_log WHERE tenant_id = $1 AND table_name = ANY($2::text[])`,
      [data.tenantId, labels],
    );
    for (const label of labels) {
      const parents = rows.filter((row) => row.table_name === label);
      assert.ok(parents.length > 0, `${label}: rows`);
      assert.ok(parents.every((row) => row.parent_table === 'portfolio_projects' && row.parent_id === data.project), `${label}: the project is the parent`);
    }
  } finally {
    await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }
  console.log('  the writer fills the project parent of the children and the task: OK');
}

async function run() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('record-history-projects');
  const foreignTenantId = await createRaceTenant('record-history-projects-foreign');
  try {
    const seeded = await seed(tenantId, async (runner) => seedAudits(runner, await seedHistoryData(runner, tenantId)));
    const foreign = await seed(foreignTenantId, (runner) => seedHistoryData(runner, foreignTenantId));
    console.log('record history projects');
    await testAccess(seeded, foreign);
    await testRecordEntries(seeded);
    await testChildEntries(seeded);
    await testWebLinkPairs(seeded);
    await testReferencesWithoutModules(seeded);
    await testLimited(seeded);
    await testParentRows(seeded);
    console.log('record-history-projects.integration.spec: ok');
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
